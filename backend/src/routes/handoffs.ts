import { Hono } from "hono";
import { z } from "zod";
import {
  HANDOFF_SELECT, HandoffRow, SafeZoneRow, WIPE_POSITIONS, loadHandoffRow, loadSharing, saveHandoff, toSafeZone, trackingFor,
} from "../db/fulfillment.js";
import { announce, handoffOut, reportNoShow, sellerPayoutsEnabled } from "../db/handoff-actions.js";
import { loadOrderRow, transitionOrder, type OrderRow } from "../db/market.js";
import { loadMeetingInputs, loadSchool } from "../db/tutoring.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { idempotent, type IdempotencyStore } from "../middleware/idempotency.js";
import { AgreeReq, CodeReq, ConfirmReq, LocationReq, LocationRes, MeetupSuggestion, NoShowReq, ProposeReq, TapReq, TapRes } from "../schemas/handoffs.js";
import { expandMeetings, freeBlocks, type BusyInterval } from "../services/availability.js";
import { withinRadius } from "../services/geo.js";
import { freeBusy } from "../services/google.js";
import { settleOrder } from "../services/escrow.js";
import {
  agreeToProposal, checkNoShow, confirmHandoff, decideTap, handoffCode, handoffSecret, presenceAfterPing, readZone, sharingWindow,
  tapExpiresAt, tapStillValid, type HandoffStatus, type Party, type TapPoint,
} from "../services/handoff.js";
import { suggestMeetups } from "../services/meetups.js";
import { nextOrderStatus, type OrderEvent } from "../services/orders.js";
import { DAY, MINUTE } from "../services/time.js";

const MEETUP_MINUTES = 10;

const parseId = (raw: string) => {
  const id = z.guid().safeParse(raw);
  if (!id.success) throw new ApiError(404, "NOT_FOUND", "Handoff not found");
  return id.data;
};

function requireStatus(handoff: HandoffRow, ...statuses: HandoffStatus[]) {
  if (!statuses.includes(handoff.status)) throw new ApiError(409, "INVALID_STATE", `Handoff is ${handoff.status}`);
}

/** Missing HANDOFF_SECRET is a server misconfiguration: log it loudly and return 500 INTERNAL. */
function requireSecret() {
  try {
    return handoffSecret();
  } catch (error) {
    console.error("HANDOFF_SECRET is missing or shorter than 32 characters; handoff codes are unavailable");
    throw error;
  }
}

async function checkZone(id: string, schoolId: string) {
  const { data, error } = await adminClient().from("safe_zones").select("id")
    .eq("id", id).eq("school_id", schoolId).eq("active", true).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(400, "VALIDATION", "Invalid request", { safe_zone_id: "Pick an active safe zone at your school" });
}

/** The order behind an order handoff (giver = seller, receiver = buyer), or null for tutoring. */
async function orderFor(handoff: HandoffRow, userId: string) {
  if (handoff.context_type !== "order") return null;
  return loadOrderRow(handoff.context_id, userId, handoff.school_id);
}

/** Checks the order can take this event before anything is written, then returns its next status. */
function orderNext(order: OrderRow | null, event: OrderEvent) {
  return order ? nextOrderStatus(order.status, event) : null;
}

const otherParty = (handoff: HandoffRow, actorId: string) => (handoff.giver_id === actorId ? handoff.receiver_id : handoff.giver_id);

/**
 * Final money move for a finished handoff: completed → release via settleOrder; item rejected → disputed,
 * money stays held. The status was already validated with orderNext before anything was written.
 */
async function settleHandoffOrder(order: OrderRow, itemOk: boolean, reason: string): Promise<OrderRow> {
  if (!itemOk) return transitionOrder(order, { status: nextOrderStatus(order.status, "dispute") });
  if (nextOrderStatus(order.status, "handoff_confirmed") !== "completed") throw new ApiError(409, "INVALID_STATE", "Order can't be completed");
  return settleOrder(order, "completed", { reason, sellerPayoutsEnabled: await sellerPayoutsEnabled(order.seller_id, order.school_id) });
}

const nowIso = (now: number) => new Date(now).toISOString();
const sideOf = (h: HandoffRow, userId: string): Party => (userId === h.giver_id ? "giver" : "receiver");

async function notifyOther(handoff: HandoffRow, actorId: string, title: string, body: string) {
  await notify({
    schoolId: handoff.school_id, userId: otherParty(handoff, actorId), type: "handoff.updated", title, body,
    deepLink: `/handoffs/${handoff.id}`, data: { handoff_id: handoff.id, status: handoff.status },
  });
}

async function notifyOrder(order: OrderRow, actorId: string, title: string, body: string) {
  await notify({
    schoolId: order.school_id, userId: order.buyer_id === actorId ? order.seller_id : order.buyer_id, type: "order.updated",
    title, body, deepLink: `/orders/${order.id}`, data: { order_id: order.id, status: order.status },
  });
}

export const handoffRoutes = (verify: TokenVerifier, idempotency: IdempotencyStore) => {
  const app = new Hono<AuthEnv>().use("/handoffs/*", requireUser(verify));

  app.get("/handoffs/:id", async (c) => {
    const { id: userId, schoolId } = c.var.user;
    const handoff = await loadHandoffRow(parseId(c.req.param("id")), userId, schoolId);
    return c.json(one(await handoffOut(handoff, userId)));
  });

  app.post("/handoffs/:id/suggest", async (c) => {
    const { id: userId, schoolId } = c.var.user;
    const handoff = await loadHandoffRow(parseId(c.req.param("id")), userId, schoolId);
    requireStatus(handoff, "proposing");

    const now = Date.now();
    const to = now + 7 * DAY;
    const partyIds = [handoff.giver_id, handoff.receiver_id];
    const [school, meetings, calendars, zoneResult] = await Promise.all([
      loadSchool(schoolId),
      loadMeetingInputs(partyIds, schoolId),
      Promise.all(partyIds.map((id) => freeBusy(id, now, to))),
      adminClient().from("safe_zones").select("*").eq("school_id", schoolId).eq("active", true),
    ]);
    if (zoneResult.error) throw zoneResult.error;
    const zones = z.array(SafeZoneRow).parse(zoneResult.data);

    const party = (id: string, i: number) => {
      const google: BusyInterval[] = (calendars[i] ?? []).map((b) => ({ ...b, kind: "busy" }));
      const busy = [...expandMeetings(meetings.get(id) ?? [], now, to), ...google];
      return { free: freeBlocks(busy, now, to, school.timezone), fallback: { lat: school.center_lat, lng: school.center_lng } };
    };
    // "me" is whoever asked, so walk times and class context read from their side.
    const meIndex = userId === handoff.giver_id ? 0 : 1;
    const themIndex = 1 - meIndex;
    const raw = suggestMeetups({
      me: party(partyIds[meIndex] ?? userId, meIndex),
      them: party(partyIds[themIndex] ?? userId, themIndex),
      zones: zones.map((zone) => ({ id: zone.id, name: zone.name, kind: zone.kind, location: { lat: zone.lat, lng: zone.lng }, hours: zone.hours })),
      tz: school.timezone,
      now,
      durationMin: MEETUP_MINUTES,
    });

    const byId = new Map(zones.map((zone) => [zone.id, zone]));
    const suggestions = raw.flatMap((s) => {
      const zone = byId.get(s.safe_zone_id);
      if (!zone) return [];
      return [MeetupSuggestion.parse({
        start: s.start, end: s.end, safe_zone: toSafeZone(zone), walk_minutes: s.walk_minutes,
        context: {
          me: { before: s.context.me.before ?? null, after: s.context.me.after ?? null },
          them: { before: s.context.them.before ?? null, after: s.context.them.after ?? null },
        },
        reason: s.reason, score: s.score,
      })];
    });
    await saveHandoff(handoff, { suggestions });
    return c.json(one({ suggestions }));
  });

  app.post("/handoffs/:id/propose", async (c) => {
    const input = await parseBody(c, ProposeReq);
    const { id: userId, schoolId } = c.var.user;
    const handoff = await loadHandoffRow(parseId(c.req.param("id")), userId, schoolId);
    requireStatus(handoff, "proposing");
    if (Date.parse(input.start) <= Date.now()) {
      throw new ApiError(400, "VALIDATION", "Invalid request", { start: "Pick a time in the future" });
    }
    await checkZone(input.safe_zone_id, schoolId);

    // A new proposal replaces any earlier one; the other party has to agree to this exact one.
    const saved = await saveHandoff(handoff, { proposed_by: userId, proposed_start: input.start, proposed_zone_id: input.safe_zone_id });
    await notifyOther(saved, userId, "Meetup proposed", "Check the proposed time and safe spot.");
    await announce(saved.id, "handoff.updated", await handoffOut(saved));
    return c.json(one(await handoffOut(saved, userId)));
  });

  app.post("/handoffs/:id/agree", async (c) => {
    const input = await parseBody(c, AgreeReq);
    const { id: userId, schoolId } = c.var.user;
    const handoff = await loadHandoffRow(parseId(c.req.param("id")), userId, schoolId);
    agreeToProposal(
      { status: handoff.status, proposedBy: handoff.proposed_by, proposedStart: handoff.proposed_start, proposedZoneId: handoff.proposed_zone_id },
      userId,
      { start: input.start, safeZoneId: input.safe_zone_id },
    );
    await checkZone(input.safe_zone_id, schoolId);
    const order = await orderFor(handoff, userId);
    // After a missed meetup the order is already `scheduled` (no scheduled→paid edge), so only a `paid` order moves.
    const orderStatus = order && order.status !== "scheduled" ? orderNext(order, "meetup_agreed") : null;

    const start = Date.parse(input.start);
    const saved = await saveHandoff(handoff, {
      status: "agreed",
      agreed_start: new Date(start).toISOString(),
      agreed_end: new Date(start + MEETUP_MINUTES * MINUTE).toISOString(),
      safe_zone_id: input.safe_zone_id,
    });
    if (order && orderStatus) {
      const moved = await transitionOrder(order, { status: orderStatus });
      await notifyOrder(moved, userId, "Meetup set", "Your handoff time and safe spot are confirmed.");
    }
    await notifyOther(saved, userId, "Meetup agreed", "The handoff time and place are confirmed.");
    await announce(saved.id, "handoff.updated", await handoffOut(saved));
    return c.json(one(await handoffOut(saved, userId)));
  });

  app.post("/handoffs/:id/location", async (c) => {
    const input = await parseBody(c, LocationReq);
    const { id: userId, schoolId } = c.var.user;
    const handoff = await loadHandoffRow(parseId(c.req.param("id")), userId, schoolId);
    requireStatus(handoff, "agreed", "arriving");
    if (!handoff.safe_zone || !handoff.agreed_start || !handoff.agreed_end) throw new ApiError(409, "INVALID_STATE", "Handoff has no agreed safe zone");

    const now = Date.now();
    const zone = { location: { lat: handoff.safe_zone.lat, lng: handoff.safe_zone.lng }, radiusM: handoff.safe_zone.radius_m };
    const reading = readZone({ location: input.location, accuracyM: input.accuracy_m }, zone);
    const me = sideOf(handoff, userId);
    const nearby = presenceAfterPing(me === "giver" ? handoff.giver_nearby : handoff.receiver_nearby, reading);
    const arrivedAt = me === "giver" ? handoff.giver_arrived_at : handoff.receiver_arrived_at;
    // Latest position only; poor fixes refresh last-seen but never change presence. Both phones post
    // often, so this is a plain field update rather than a checked transition.
    const { data, error } = await adminClient().from("handoffs").update({
      [`${me}_lat`]: input.location.lat, [`${me}_lng`]: input.location.lng, [`${me}_accuracy_m`]: input.accuracy_m,
      [`${me}_seen_at`]: nowIso(now), [`${me}_nearby`]: nearby,
      ...(reading.inside && !arrivedAt ? { [`${me}_arrived_at`]: nowIso(now) } : {}),
    }).eq("id", handoff.id).eq("school_id", schoolId).in("status", ["agreed", "arriving"]).select(HANDOFF_SELECT).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(409, "INVALID_STATE", "This handoff just changed; reload it");
    let row = HandoffRow.parse(data);

    if (row.giver_nearby && row.receiver_nearby && row.status === "agreed") {
      const arriving = await adminClient().from("handoffs").update({ status: "arriving" })
        .eq("id", row.id).eq("school_id", schoolId).eq("status", "agreed").select(HANDOFF_SELECT).maybeSingle();
      if (arriving.error) throw arriving.error;
      if (arriving.data) {
        row = HandoffRow.parse(arriving.data);
        try {
          const order = await orderFor(row, userId);
          if (order?.status === "scheduled") await transitionOrder(order, { status: nextOrderStatus(order.status, "both_nearby") });
        } catch (e) {
          console.error("both_nearby order step failed", e instanceof Error ? e.message : e); // the handoff can still finish from `scheduled`
        }
        await announce(row.id, "handoff.updated", await handoffOut(row));
      }
    }
    if (nearby !== (me === "giver" ? handoff.giver_nearby : handoff.receiver_nearby)) {
      await announce(row.id, "handoff.presence", { giver_nearby: row.giver_nearby, receiver_nearby: row.receiver_nearby });
    }

    const tracking = trackingFor(row, { id: userId, now, sharing: await loadSharing([row.giver_id, row.receiver_id], schoolId) });
    const window = sharingWindow(Date.parse(handoff.agreed_start), Date.parse(handoff.agreed_end));
    return c.json(one(LocationRes.parse({
      giver_nearby: row.giver_nearby, receiver_nearby: row.receiver_nearby,
      me: { inside_zone: reading.inside, distance_to_zone_m: reading.distanceToZoneM, accuracy_ok: reading.accuracyOk },
      other: tracking.other,
      sharing_window: { starts_at: nowIso(window.startsAt), ends_at: nowIso(window.endsAt) },
    })));
  });

  app.post("/handoffs/:id/code", async (c) => {
    const input = await parseBody(c, CodeReq);
    const secret = requireSecret();
    const { id: userId, schoolId } = c.var.user;
    const handoff = await loadHandoffRow(parseId(c.req.param("id")), userId, schoolId);
    requireStatus(handoff, "agreed", "arriving");
    if (userId !== handoff.giver_id) throw new ApiError(403, "FORBIDDEN", "Only the giver shows the handoff code");
    if (!handoff.safe_zone) throw new ApiError(409, "INVALID_STATE", "Handoff has no agreed safe zone");

    const zone = { lat: handoff.safe_zone.lat, lng: handoff.safe_zone.lng };
    if (!withinRadius(input.location, zone, handoff.safe_zone.radius_m, input.accuracy_m)) {
      throw new ApiError(403, "NOT_NEARBY", "You need to be at the meetup spot");
    }
    const { error } = await adminClient().from("handoffs")
      .update({ giver_at: new Date().toISOString(), giver_nearby: true })
      .eq("id", handoff.id).eq("school_id", schoolId).in("status", ["agreed", "arriving"]);
    if (error) throw error;
    if (!handoff.giver_at) await notifyOther(handoff, userId, "They're at the spot", "Scan their code to finish the handoff.");
    return c.json(one(handoffCode(secret, handoff.id, Date.now())));
  });

  app.post("/handoffs/:id/confirm", idempotent(idempotency), async (c) => {
    const input = await parseBody(c, ConfirmReq);
    const secret = requireSecret();
    const { id: userId, schoolId } = c.var.user;
    const handoff = await loadHandoffRow(parseId(c.req.param("id")), userId, schoolId);
    if (userId !== handoff.receiver_id) throw new ApiError(403, "FORBIDDEN", "Only the receiver confirms a handoff");
    requireStatus(handoff, "agreed", "arriving");
    if (!handoff.safe_zone) throw new ApiError(409, "INVALID_STATE", "Handoff has no agreed safe zone");

    const result = confirmHandoff(secret, handoff.id, Date.now(), {
      status: handoff.status,
      zone: { location: { lat: handoff.safe_zone.lat, lng: handoff.safe_zone.lng }, radiusM: handoff.safe_zone.radius_m },
      receiverAt: input.location,
      accuracyM: input.accuracy_m,
      code: input,
      itemOk: input.item_ok,
    });
    const order = await orderFor(handoff, userId);
    orderNext(order, input.item_ok ? "handoff_confirmed" : "dispute"); // reject before writing anything

    const saved = await saveHandoff(handoff, {
      status: result.handoff, receiver_at: nowIso(Date.now()), receiver_nearby: true, item_ok: input.item_ok, ...WIPE_POSITIONS,
    });
    if (order) {
      const moved = await settleHandoffOrder(order, input.item_ok, "handoff_confirmed");
      const title = moved.status === "completed" ? "Order completed" : "Order disputed";
      const body = moved.status === "completed" ? "The handoff is done." : "The buyer flagged a problem with the item.";
      await notifyOrder(moved, userId, title, body);
    }
    await notifyOther(saved, userId, "Handoff confirmed", input.item_ok ? "All done." : "They reported a problem with the item.");
    await announce(saved.id, "handoff.completed", await handoffOut(saved));
    return c.json(one(await handoffOut(saved, userId)));
  });

  app.post("/handoffs/:id/tap", idempotent(idempotency), async (c) => {
    const input = await parseBody(c, TapReq);
    const { id: userId, schoolId } = c.var.user;
    const id = parseId(c.req.param("id"));
    let handoff = await loadHandoffRow(id, userId, schoolId);
    const me = sideOf(handoff, userId);
    const them: Party = me === "giver" ? "receiver" : "giver";
    if (me === "receiver" && input.item_ok === undefined) {
      throw new ApiError(400, "VALIDATION", "Invalid request", { item_ok: "The receiver must say whether the item is as described" });
    }

    for (let attempt = 0; ; attempt++) {
      requireStatus(handoff, "agreed", "arriving");
      if (!handoff.safe_zone) throw new ApiError(409, "INVALID_STATE", "Handoff has no agreed safe zone");
      const now = Date.now();
      const zone = { location: { lat: handoff.safe_zone.lat, lng: handoff.safe_zone.lng }, radiusM: handoff.safe_zone.radius_m };
      const reading = readZone({ location: input.location, accuracyM: input.accuracy_m }, zone);
      if (!reading.accuracyOk || !reading.inside) {
        throw new ApiError(403, "NOT_NEARBY", reading.accuracyOk
          ? "You need to be at the meetup spot to confirm. If your location is off, use the QR code instead."
          : "Your location isn't accurate enough. Move outdoors, or use the QR code instead.");
      }

      const mine: TapPoint = { at: now, location: input.location, accuracyM: input.accuracy_m };
      const otherAt = them === "giver" ? handoff.giver_tap_at : handoff.receiver_tap_at;
      const otherLat = them === "giver" ? handoff.giver_tap_lat : handoff.receiver_tap_lat;
      const otherLng = them === "giver" ? handoff.giver_tap_lng : handoff.receiver_tap_lng;
      const otherAcc = them === "giver" ? handoff.giver_tap_accuracy_m : handoff.receiver_tap_accuracy_m;
      const theirs: TapPoint | null = tapStillValid(otherAt ? Date.parse(otherAt) : null, now) && otherLat !== null && otherLng !== null && otherAcc !== null
        ? { at: Date.parse(otherAt ?? ""), location: { lat: otherLat, lng: otherLng }, accuracyM: otherAcc }
        : null;
      const decision = decideTap(mine, theirs, zone);
      const itemOk = me === "receiver" ? (input.item_ok ?? false) : (handoff.receiver_tap_item_ok ?? false);

      const order = decision.outcome === "paired" ? await orderFor(handoff, userId) : null;
      if (decision.outcome === "paired") orderNext(order, itemOk ? "handoff_confirmed" : "dispute"); // reject before writing anything

      const patch = {
        [`${me}_tap_at`]: nowIso(now), [`${me}_tap_lat`]: input.location.lat, [`${me}_tap_lng`]: input.location.lng,
        [`${me}_tap_accuracy_m`]: input.accuracy_m, ...(me === "receiver" ? { receiver_tap_item_ok: input.item_ok ?? null } : {}),
        [`${me}_nearby`]: true, [`${me}_seen_at`]: nowIso(now),
        ...(me === "giver" ? { giver_arrived_at: handoff.giver_arrived_at ?? nowIso(now) } : { receiver_arrived_at: handoff.receiver_arrived_at ?? nowIso(now) }),
      };
      let saved: HandoffRow;
      try {
        saved = await saveHandoff(handoff, decision.outcome === "paired"
          ? { ...patch, status: "completed", giver_at: nowIso(now), receiver_at: nowIso(now), giver_nearby: true, receiver_nearby: true, item_ok: itemOk, ...WIPE_POSITIONS }
          : patch);
      } catch (e) {
        // Both phones tap at nearly the same moment, so lose the race gracefully: reload and decide again.
        if (e instanceof ApiError && e.status === 409 && attempt < 2) {
          handoff = await loadHandoffRow(id, userId, schoolId);
          continue;
        }
        throw e;
      }

      const expires = nowIso(tapExpiresAt(now));
      if (decision.outcome !== "paired") {
        await announce(saved.id, "handoff.tap", { by: me, expires_at: expires });
        await notifyOther(saved, userId, "Confirm the trade", "They tapped Confirm trade. Tap yours within a minute.");
        return c.json(one(TapRes.parse({ handoff: await handoffOut(saved, userId), status: "waiting_for_other", tap_expires_at: expires })));
      }
      if (order) {
        const moved = await settleHandoffOrder(order, itemOk, "handoff_tap_confirmed");
        await notifyOrder(moved, userId, moved.status === "completed" ? "Order completed" : "Order disputed",
          moved.status === "completed" ? "The handoff is done." : "The buyer flagged a problem with the item.");
      }
      await notifyOther(saved, userId, "Handoff confirmed", itemOk ? "All done." : "They reported a problem with the item.");
      await announce(saved.id, "handoff.completed", await handoffOut(saved));
      await announce(saved.id, "handoff.updated", await handoffOut(saved));
      return c.json(one(TapRes.parse({ handoff: await handoffOut(saved, userId), status: itemOk ? "completed" : "disputed", tap_expires_at: expires })));
    }
  });

  app.post("/handoffs/:id/no-show", async (c) => {
    const input = await parseBody(c, NoShowReq);
    const { id: userId, schoolId } = c.var.user;
    const handoff = await loadHandoffRow(parseId(c.req.param("id")), userId, schoolId);
    requireStatus(handoff, "agreed", "arriving");
    if (!handoff.safe_zone || !handoff.agreed_start) throw new ApiError(409, "INVALID_STATE", "Handoff has no agreed safe zone");
    const me = sideOf(handoff, userId);
    const absent: Party = me === "giver" ? "receiver" : "giver";

    const check = checkNoShow({
      status: handoff.status, now: Date.now(), agreedStart: Date.parse(handoff.agreed_start),
      reporter: { location: input.location, accuracyM: input.accuracy_m },
      zone: { location: { lat: handoff.safe_zone.lat, lng: handoff.safe_zone.lng }, radiusM: handoff.safe_zone.radius_m },
      otherNearby: absent === "giver" ? handoff.giver_nearby : handoff.receiver_nearby,
      otherTapped: (absent === "giver" ? handoff.giver_tap_at : handoff.receiver_tap_at) !== null,
    });
    if (!check.ok) {
      switch (check.reason) {
        case "too_early": throw new ApiError(409, "INVALID_STATE", "You can report a no-show 15 minutes after the meetup start");
        case "bad_accuracy": throw new ApiError(403, "NOT_NEARBY", "Your location isn't accurate enough. Move outdoors and try again.");
        case "not_in_zone": throw new ApiError(403, "NOT_NEARBY", "You need to be at the meetup spot to report a no-show");
        case "other_arrived": throw new ApiError(409, "INVALID_STATE", "The other person has arrived");
        default: throw new ApiError(409, "INVALID_STATE", `Handoff is ${handoff.status}`);
      }
    }
    const saved = await reportNoShow(handoff, userId, absent, "reported");
    return c.json(one(await handoffOut(saved, userId)));
  });

  return app;
};
