import { Hono } from "hono";
import { z } from "zod";
import { HANDOFF_SELECT, HandoffRow, SafeZoneRow, loadHandoffRow, toHandoff, toSafeZone } from "../db/fulfillment.js";
import { loadOrderRow, transitionOrder, type OrderRow } from "../db/market.js";
import { loadMeetingInputs, loadSchool } from "../db/tutoring.js";
import { loadUsersPublic } from "../db/users.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { idempotent, type IdempotencyStore } from "../middleware/idempotency.js";
import { AgreeReq, CodeReq, ConfirmReq, LocationReq, MeetupSuggestion, ProposeReq } from "../schemas/handoffs.js";
import { expandMeetings, freeBlocks, type BusyInterval } from "../services/availability.js";
import { withinRadius } from "../services/geo.js";
import { freeBusy } from "../services/google.js";
import { agreeToProposal, confirmHandoff, handoffCode, handoffSecret, type HandoffStatus } from "../services/handoff.js";
import { suggestMeetups } from "../services/meetups.js";
import { nextOrderStatus, payoutFor, type OrderEvent } from "../services/orders.js";
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

/** Writes a handoff change only if nobody else changed it since we read it. */
async function saveHandoff(handoff: HandoffRow, patch: Record<string, unknown>) {
  const { data, error } = await adminClient().from("handoffs").update(patch)
    .eq("id", handoff.id).eq("school_id", handoff.school_id).eq("updated_at", handoff.updated_at)
    .select(HANDOFF_SELECT).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(409, "INVALID_STATE", "This handoff just changed; reload it");
  return HandoffRow.parse(data);
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

async function handoffOut(handoff: HandoffRow) {
  const users = await loadUsersPublic([handoff.giver_id, handoff.receiver_id], handoff.school_id);
  return toHandoff(handoff, users);
}

const otherParty = (handoff: HandoffRow, actorId: string) => (handoff.giver_id === actorId ? handoff.receiver_id : handoff.giver_id);

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
    return c.json(one(await handoffOut(handoff)));
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
    return c.json(one(await handoffOut(saved)));
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
    const orderStatus = orderNext(order, "meetup_agreed");

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
    return c.json(one(await handoffOut(saved)));
  });

  app.post("/handoffs/:id/location", async (c) => {
    const input = await parseBody(c, LocationReq);
    const { id: userId, schoolId } = c.var.user;
    const handoff = await loadHandoffRow(parseId(c.req.param("id")), userId, schoolId);
    requireStatus(handoff, "agreed", "arriving");
    if (!handoff.safe_zone) throw new ApiError(409, "INVALID_STATE", "Handoff has no agreed safe zone");

    const zone = { lat: handoff.safe_zone.lat, lng: handoff.safe_zone.lng };
    const nearby = withinRadius(input.location, zone, handoff.safe_zone.radius_m, input.accuracy_m);
    const field = userId === handoff.giver_id ? "giver_nearby" : "receiver_nearby";
    // Both phones post here often, so this is a plain field update rather than a checked transition.
    const { data, error } = await adminClient().from("handoffs").update({ [field]: nearby })
      .eq("id", handoff.id).eq("school_id", schoolId).in("status", ["agreed", "arriving"])
      .select("giver_nearby, receiver_nearby").maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(409, "INVALID_STATE", "This handoff just changed; reload it");
    const presence = z.object({ giver_nearby: z.boolean(), receiver_nearby: z.boolean() }).parse(data);
    return c.json(one(presence));
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
    const orderStatus = orderNext(order, input.item_ok ? "handoff_confirmed" : "dispute");

    const saved = await saveHandoff(handoff, {
      status: result.handoff, receiver_at: new Date().toISOString(), receiver_nearby: true, item_ok: input.item_ok,
    });
    if (order && orderStatus) {
      const seller = await adminClient().from("profiles").select("payouts_enabled")
        .eq("id", order.seller_id).eq("school_id", schoolId).single();
      if (seller.error) throw seller.error;
      const { payouts_enabled } = z.object({ payouts_enabled: z.boolean() }).parse(seller.data);
      const payout = payoutFor(orderStatus, payouts_enabled);
      const moved = await transitionOrder(order, {
        status: orderStatus, payout_status: payout, ...(payout === "released" ? { released_at: new Date().toISOString() } : {}),
      });
      if (moved.status === "completed") {
        const sold = await adminClient().from("listings").update({ status: "sold" }).eq("id", order.listing_id).eq("school_id", schoolId);
        if (sold.error) throw sold.error;
      }
      const title = moved.status === "completed" ? "Order completed" : "Order disputed";
      const body = moved.status === "completed" ? "The handoff is done." : "The buyer flagged a problem with the item.";
      await notifyOrder(moved, userId, title, body);
    }
    await notifyOther(saved, userId, "Handoff confirmed", input.item_ok ? "All done." : "They reported a problem with the item.");
    return c.json(one(await handoffOut(saved)));
  });

  return app;
};
