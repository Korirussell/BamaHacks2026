import { Hono } from "hono";
import { z } from "zod";
import { ClassMeetingRow, toMeetingInput } from "../db/academics.js";
import { HandoffRow, SafeZoneRow, toHandoff, toSafeZone } from "../db/fulfillment.js";
import { SchoolRow } from "../db/rows.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { idempotent, supabaseIdempotencyStore } from "../middleware/idempotency.js";
import { AgreeReq, CodeReq, ConfirmReq, LocationReq, ProposeReq } from "../schemas/handoffs.js";
import { expandMeetings, freeBlocks } from "../services/availability.js";
import { agreeToProposal, confirmHandoff, handoffCode, handoffSecret, type HandoffStatus } from "../services/handoff.js";
import { withinRadius } from "../services/geo.js";
import { suggestMeetups } from "../services/meetups.js";
import { nextOrderStatus, payoutFor, type OrderStatus } from "../services/orders.js";

const HANDOFF_SELECT = "*, giver:profiles!handoffs_giver_id_fkey(*), receiver:profiles!handoffs_receiver_id_fkey(*), safe_zone:safe_zones(*)";

async function loadSchool(schoolId: string) {
  const result = await adminClient().from("schools").select("*").eq("id", schoolId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ApiError(404, "NOT_FOUND", "School not found");
  return SchoolRow.parse(result.data);
}

async function loadHandoff(id: string, schoolId: string, userId: string) {
  const result = await adminClient().from("handoffs").select(HANDOFF_SELECT).eq("id", id).eq("school_id", schoolId).or(`giver_id.eq.${userId},receiver_id.eq.${userId}`).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ApiError(404, "NOT_FOUND", "Handoff not found");
  return HandoffRow.parse(result.data);
}

async function loadMeetings(userId: string, schoolId: string) {
  const result = await adminClient().from("class_meetings").select("*, course:courses(*), building:buildings(*)").eq("school_id", schoolId).eq("user_id", userId);
  if (result.error) throw result.error;
  return z.array(ClassMeetingRow).parse(result.data);
}

async function checkZone(id: string, schoolId: string) {
  const result = await adminClient().from("safe_zones").select("id").eq("id", id).eq("school_id", schoolId).eq("active", true).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ApiError(400, "VALIDATION", "Invalid request", { safe_zone_id: "Safe zone must belong to your school" });
}

function requireStatus(handoff: HandoffRow, ...statuses: HandoffStatus[]) {
  if (!statuses.includes(handoff.status)) throw new ApiError(409, "INVALID_STATE", `Handoff is ${handoff.status}`);
}

function requireSecret() {
  try {
    return handoffSecret();
  } catch (error) {
    console.error("HANDOFF_SECRET is missing or shorter than 32 characters; handoff codes are unavailable");
    throw error;
  }
}

async function notifyOther(handoff: HandoffRow, actorId: string, title: string, body: string) {
  const userId = handoff.giver_id === actorId ? handoff.receiver_id : handoff.giver_id;
  await notify({ schoolId: handoff.school_id, userId, type: "handoff.updated", title, body, deepLink: `/handoffs/${handoff.id}`, data: { handoff_id: handoff.id, status: handoff.status } });
}

async function notifyOrder(handoff: HandoffRow, actorId: string, status: OrderStatus) {
  if (handoff.context_type !== "order") return;
  const userId = handoff.giver_id === actorId ? handoff.receiver_id : handoff.giver_id;
  await notify({ schoolId: handoff.school_id, userId, type: "order.updated", title: "Order updated", body: `Your order is now ${status.replaceAll("_", " ")}.`, deepLink: `/orders/${handoff.context_id}`, data: { order_id: handoff.context_id, status } });
}

async function responseFor(handoff: HandoffRow, userId: string) {
  return toHandoff(await loadHandoff(handoff.id, handoff.school_id, userId), await loadSchool(handoff.school_id));
}

export const handoffRoutes = (verify: TokenVerifier) => {
  const app = new Hono<AuthEnv>().use("/handoffs/*", requireUser(verify));

  app.get("/handoffs/:id", async (c) => {
    const handoff = await loadHandoff(c.req.param("id"), c.var.user.schoolId, c.var.user.id);
    return c.json(one(await responseFor(handoff, c.var.user.id)));
  });

  app.post("/handoffs/:id/suggest", idempotent(supabaseIdempotencyStore()), async (c) => {
    const handoff = await loadHandoff(c.req.param("id"), c.var.user.schoolId, c.var.user.id);
    requireStatus(handoff, "proposing");
    const currentSchool = await loadSchool(c.var.user.schoolId);
    const [giverMeetings, receiverMeetings, zones] = await Promise.all([
      loadMeetings(handoff.giver_id, handoff.school_id),
      loadMeetings(handoff.receiver_id, handoff.school_id),
      adminClient().from("safe_zones").select("*").eq("school_id", handoff.school_id).eq("active", true),
    ]);
    if (zones.error) throw zones.error;
    const safeZones = z.array(SafeZoneRow).parse(zones.data);
    const start = Date.now();
    const end = start + 7 * 86_400_000;
    const party = (meetings: z.infer<typeof ClassMeetingRow>[]) => ({ free: freeBlocks(expandMeetings(meetings.map(toMeetingInput), start, end), start, end, currentSchool.timezone), fallback: { lat: currentSchool.center_lat, lng: currentSchool.center_lng } });
    const suggestions = suggestMeetups({ me: party(giverMeetings), them: party(receiverMeetings), zones: safeZones.map((zone) => ({ ...toSafeZone(zone), location: { lat: zone.lat, lng: zone.lng } })), tz: currentSchool.timezone, now: start }).map((item) => ({ ...item, safe_zone: toSafeZone(safeZones.find((zone) => zone.id === item.safe_zone_id)!) }));
    const updated = await adminClient().from("handoffs").update({ suggestions }).eq("id", handoff.id).eq("school_id", handoff.school_id);
    if (updated.error) throw updated.error;
    return c.json(one({ suggestions }));
  });

  app.post("/handoffs/:id/propose", idempotent(supabaseIdempotencyStore()), async (c) => {
    const input = await parseBody(c, ProposeReq);
    const handoff = await loadHandoff(c.req.param("id"), c.var.user.schoolId, c.var.user.id);
    requireStatus(handoff, "proposing");
    await checkZone(input.safe_zone_id, handoff.school_id);
    const updated = await adminClient().from("handoffs").update({ proposed_by: c.var.user.id, proposed_start: input.start, proposed_zone_id: input.safe_zone_id }).eq("id", handoff.id).eq("school_id", handoff.school_id).eq("status", "proposing");
    if (updated.error) throw updated.error;
    await notifyOther(handoff, c.var.user.id, "Meetup proposed", "The other party proposed a handoff time and place.");
    return c.json(one(await responseFor(handoff, c.var.user.id)));
  });

  app.post("/handoffs/:id/agree", idempotent(supabaseIdempotencyStore()), async (c) => {
    const input = await parseBody(c, AgreeReq);
    const handoff = await loadHandoff(c.req.param("id"), c.var.user.schoolId, c.var.user.id);
    agreeToProposal({
      status: handoff.status,
      proposedBy: handoff.proposed_by,
      proposedStart: handoff.proposed_start,
      proposedZoneId: handoff.proposed_zone_id,
    }, c.var.user.id, { start: input.start, safeZoneId: input.safe_zone_id });
    await checkZone(input.safe_zone_id, handoff.school_id);
    const end = new Date(Date.parse(input.start) + 10 * 60_000).toISOString();
    const updated = await adminClient().from("handoffs").update({ agreed_start: input.start, agreed_end: end, safe_zone_id: input.safe_zone_id, status: "agreed" }).eq("id", handoff.id).eq("school_id", handoff.school_id).eq("status", "proposing");
    if (updated.error) throw updated.error;
    if (handoff.context_type === "order") {
      const order = await adminClient().from("orders").select("status").eq("id", handoff.context_id).eq("school_id", handoff.school_id).maybeSingle();
      if (order.error) throw order.error;
      if (!order.data) throw new ApiError(404, "NOT_FOUND", "Order not found");
      const status = nextOrderStatus(order.data.status as OrderStatus, "meetup_agreed");
      const moved = await adminClient().from("orders").update({ status }).eq("id", handoff.context_id).eq("school_id", handoff.school_id);
      if (moved.error) throw moved.error;
      await notifyOrder(handoff, c.var.user.id, status);
    }
    await notifyOther(handoff, c.var.user.id, "Meetup agreed", "The handoff time and place are confirmed.");
    return c.json(one(await responseFor(handoff, c.var.user.id)));
  });

  app.post("/handoffs/:id/location", idempotent(supabaseIdempotencyStore()), async (c) => {
    const input = await parseBody(c, LocationReq);
    const handoff = await loadHandoff(c.req.param("id"), c.var.user.schoolId, c.var.user.id);
    requireStatus(handoff, "agreed", "arriving");
    if (!handoff.safe_zone) throw new ApiError(409, "INVALID_STATE", "Handoff has no agreed safe zone");
    const nearby = withinRadius(input.location, { lat: handoff.safe_zone.lat, lng: handoff.safe_zone.lng }, handoff.safe_zone.radius_m, input.accuracy_m);
    const field = c.var.user.id === handoff.giver_id ? "giver_nearby" : "receiver_nearby";
    const updated = await adminClient().from("handoffs").update({ [field]: nearby }).eq("id", handoff.id).eq("school_id", handoff.school_id);
    if (updated.error) throw updated.error;
    await notifyOther(handoff, c.var.user.id, "Handoff location updated", "The other party updated their meetup location.");
    return c.json(one({ giver_nearby: field === "giver_nearby" ? nearby : handoff.giver_nearby, receiver_nearby: field === "receiver_nearby" ? nearby : handoff.receiver_nearby }));
  });

  app.post("/handoffs/:id/code", idempotent(supabaseIdempotencyStore()), async (c) => {
    const input = await parseBody(c, CodeReq);
    const secret = requireSecret();
    const handoff = await loadHandoff(c.req.param("id"), c.var.user.schoolId, c.var.user.id);
    requireStatus(handoff, "agreed", "arriving");
    if (c.var.user.id !== handoff.giver_id) throw new ApiError(403, "FORBIDDEN", "Only the giver can create a handoff code");
    if (!handoff.safe_zone || !withinRadius(input.location, { lat: handoff.safe_zone.lat, lng: handoff.safe_zone.lng }, handoff.safe_zone.radius_m, input.accuracy_m)) throw new ApiError(403, "NOT_NEARBY", "You need to be at the meetup spot");
    const updated = await adminClient().from("handoffs").update({ giver_at: new Date().toISOString(), giver_nearby: true }).eq("id", handoff.id).eq("school_id", handoff.school_id);
    if (updated.error) throw updated.error;
    await notifyOther(handoff, c.var.user.id, "Handoff code ready", "The giver is ready at the meetup spot.");
    return c.json(one(handoffCode(secret, handoff.id, Date.now())));
  });

  app.post("/handoffs/:id/confirm", idempotent(supabaseIdempotencyStore()), async (c) => {
    const input = await parseBody(c, ConfirmReq);
    const secret = requireSecret();
    const handoff = await loadHandoff(c.req.param("id"), c.var.user.schoolId, c.var.user.id);
    if (c.var.user.id !== handoff.receiver_id) throw new ApiError(403, "FORBIDDEN", "Only the receiver can confirm a handoff");
    if (!handoff.safe_zone) throw new ApiError(409, "INVALID_STATE", "Handoff has no agreed safe zone");
    const result = confirmHandoff(secret, handoff.id, Date.now(), { status: handoff.status, zone: { location: { lat: handoff.safe_zone.lat, lng: handoff.safe_zone.lng }, radiusM: handoff.safe_zone.radius_m }, receiverAt: input.location, accuracyM: input.accuracy_m, code: input, itemOk: input.item_ok });
    const updated = await adminClient().from("handoffs").update({ status: result.handoff, receiver_at: new Date().toISOString(), receiver_nearby: true, item_ok: input.item_ok }).eq("id", handoff.id).eq("school_id", handoff.school_id);
    if (updated.error) throw updated.error;
    if (handoff.context_type === "order") {
      const order = await adminClient().from("orders").select("seller:profiles!orders_seller_id_fkey(payouts_enabled)").eq("id", handoff.context_id).eq("school_id", handoff.school_id).maybeSingle();
      if (order.error) throw order.error;
      if (!order.data) throw new ApiError(404, "NOT_FOUND", "Order not found");
      const seller = z.object({ payouts_enabled: z.boolean() }).parse(order.data.seller);
      const payout = payoutFor(result.order, seller.payouts_enabled);
      const moved = await adminClient().from("orders").update({ status: result.order, payout_status: payout, ...(result.order === "completed" ? { released_at: new Date().toISOString() } : {}) }).eq("id", handoff.context_id).eq("school_id", handoff.school_id);
      if (moved.error) throw moved.error;
      await notifyOrder(handoff, c.var.user.id, result.order);
    }
    await notifyOther(handoff, c.var.user.id, "Handoff completed", "The handoff has been confirmed.");
    return c.json(one(await responseFor(handoff, c.var.user.id)));
  });

  return app;
};
