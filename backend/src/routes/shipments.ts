import { Hono } from "hono";
import { z } from "zod";
import { placeholderLabelRenderer } from "../adapters/stubs.js";
import { DropOffPointRow, ShipmentRow, toShipment } from "../db/fulfillment.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { idempotent, supabaseIdempotencyStore } from "../middleware/idempotency.js";
import { CreateShipmentReq, DroppedOffReq, ReceivedReq } from "../schemas/orders.js";
import { nextOrderStatus, payoutFor } from "../services/orders.js";
import { buildLabel, verifyDropOff, verifyReceived } from "../services/shipping.js";

const ORDER_STATUS = z.enum(["awaiting_payment", "paid", "scheduled", "handing_off", "in_transit", "completed", "cancelled", "disputed", "refunded"]);
const ORDER_SELECT = "*, buyer:profiles!orders_buyer_id_fkey(*), seller:profiles!orders_seller_id_fkey(*), listing:listings(*)";
const SHIPMENT_SELECT = "*, drop_off:drop_off_points(*)";
const OrderRow = z.object({ id: z.guid(), school_id: z.guid(), buyer_id: z.guid(), seller_id: z.guid(), status: ORDER_STATUS, payout_status: z.enum(["held", "awaiting_onboarding", "released", "reversed"]), buyer: z.object({ display_name: z.string(), mail_stop_code: z.string().nullable() }), seller: z.object({ display_name: z.string(), payouts_enabled: z.boolean() }), listing: z.object({ title: z.string() }) });
const ShipmentOrder = z.object({ id: z.guid(), school_id: z.guid(), buyer_id: z.guid(), seller_id: z.guid(), status: ORDER_STATUS, seller: z.object({ payouts_enabled: z.boolean() }) });

async function orderFor(id: string, schoolId: string, userId: string) {
  const result = await adminClient().from("orders").select(ORDER_SELECT).eq("id", id).eq("school_id", schoolId).or(`buyer_id.eq.${userId},seller_id.eq.${userId}`).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ApiError(404, "NOT_FOUND", "Order not found");
  return OrderRow.parse(result.data);
}

async function shipmentFor(id: string, schoolId: string, userId: string) {
  const shipmentResult = await adminClient().from("shipments").select(SHIPMENT_SELECT).eq("id", id).eq("school_id", schoolId).maybeSingle();
  if (shipmentResult.error) throw shipmentResult.error;
  if (!shipmentResult.data) throw new ApiError(404, "NOT_FOUND", "Shipment not found");
  const row = ShipmentRow.parse(shipmentResult.data);
  const orderResult = await adminClient().from("orders").select("id, school_id, buyer_id, seller_id, status, seller:profiles!orders_seller_id_fkey(payouts_enabled)").eq("id", row.order_id).eq("school_id", schoolId).maybeSingle();
  if (orderResult.error) throw orderResult.error;
  if (!orderResult.data) throw new ApiError(404, "NOT_FOUND", "Shipment not found");
  const order = ShipmentOrder.parse(orderResult.data);
  if (userId !== order.buyer_id && userId !== order.seller_id) throw new ApiError(404, "NOT_FOUND", "Shipment not found");
  return { row, order };
}

async function notifyOther(order: z.infer<typeof ShipmentOrder>, actorId: string, type: "shipment.updated" | "order.updated", title: string, body: string, deepLink: string, data: Record<string, unknown>) {
  await notify({ schoolId: order.school_id, userId: order.buyer_id === actorId ? order.seller_id : order.buyer_id, type, title, body, deepLink, data });
}

export const shipmentRoutes = (verify: TokenVerifier) => {
  const app = new Hono<AuthEnv>().use("/orders/*", requireUser(verify)).use("/shipments/*", requireUser(verify));

  app.get("/shipments/:id", async (c) => {
    const { row } = await shipmentFor(c.req.param("id"), c.var.user.schoolId, c.var.user.id);
    return c.json(one(toShipment(row)));
  });

  app.post("/orders/:id/shipment", idempotent(supabaseIdempotencyStore()), async (c) => {
    const input = await parseBody(c, CreateShipmentReq);
    const order = await orderFor(c.req.param("id"), c.var.user.schoolId, c.var.user.id);
    if (order.seller_id !== c.var.user.id) throw new ApiError(403, "FORBIDDEN", "Only the seller can create a shipment");
    let points = adminClient().from("drop_off_points").select("*").eq("school_id", order.school_id).eq("active", true);
    if (input.drop_off_point_id) points = points.eq("id", input.drop_off_point_id);
    const pointResult = await points.limit(1);
    if (pointResult.error) throw pointResult.error;
    const point = z.array(DropOffPointRow).parse(pointResult.data)[0];
    if (!point) throw new ApiError(400, "VALIDATION", "Invalid request", { drop_off_point_id: "Active drop-off point must belong to your school" });
    const label = buildLabel({ orderId: order.id, buyer: { name: order.buyer.display_name, mailStopCode: order.buyer.mail_stop_code }, sellerName: order.seller.display_name, itemTitle: order.listing.title, dropOff: { name: point.name, instructions: point.instructions } });
    const rendered = await placeholderLabelRenderer.render(label);
    const inserted = await adminClient().from("shipments").insert({ school_id: order.school_id, order_id: order.id, label_code: label.label_code, to_name: label.to.name, to_mail_stop_code: label.to.mail_stop_code, drop_off_point_id: point.id }).select(SHIPMENT_SELECT).single();
    if (inserted.error) throw inserted.error;
    const status = nextOrderStatus(order.status, "label_created");
    const moved = await adminClient().from("orders").update({ status }).eq("id", order.id).eq("school_id", order.school_id).eq("seller_id", c.var.user.id);
    if (moved.error) throw moved.error;
    const shipment = ShipmentRow.parse(inserted.data);
    const notifyOrderRow = ShipmentOrder.parse({ ...order, status });
    await notifyOther(notifyOrderRow, c.var.user.id, "shipment.updated", "Shipment created", "A campus-mail shipment label is ready.", `/shipments/${shipment.id}`, { shipment_id: shipment.id, status: shipment.status });
    await notifyOther(notifyOrderRow, c.var.user.id, "order.updated", "Order updated", "Your order is scheduled for campus mail.", `/orders/${order.id}`, { order_id: order.id, status });
    return c.json(one(toShipment(shipment, rendered.pdfUrl)));
  });

  app.post("/shipments/:id/dropped-off", idempotent(supabaseIdempotencyStore()), async (c) => {
    const input = await parseBody(c, DroppedOffReq);
    const { row, order } = await shipmentFor(c.req.param("id"), c.var.user.schoolId, c.var.user.id);
    if (order.seller_id !== c.var.user.id) throw new ApiError(403, "FORBIDDEN", "Only the seller can drop off a shipment");
    const patch = verifyDropOff({ status: row.status, at: input.location, accuracyM: input.accuracy_m, point: { location: { lat: row.drop_off.lat, lng: row.drop_off.lng }, radiusM: row.drop_off.radius_m }, photoMediaId: input.photo_media_id, now: Date.now() });
    const updated = await adminClient().from("shipments").update({ ...patch, drop_off_proof_media_id: input.photo_media_id, drop_off_lat: input.location.lat, drop_off_lng: input.location.lng }).eq("id", row.id).eq("school_id", row.school_id).select(SHIPMENT_SELECT).single();
    if (updated.error) throw updated.error;
    const status = nextOrderStatus(order.status, "dropped_off");
    const moved = await adminClient().from("orders").update({ status }).eq("id", row.order_id).eq("school_id", row.school_id).eq("seller_id", c.var.user.id);
    if (moved.error) throw moved.error;
    const shipment = ShipmentRow.parse(updated.data);
    await notifyOther(order, c.var.user.id, "shipment.updated", "Shipment dropped off", "Your package has been dropped off.", `/shipments/${shipment.id}`, { shipment_id: shipment.id, status: shipment.status });
    await notifyOther(ShipmentOrder.parse({ ...order, status }), c.var.user.id, "order.updated", "Order updated", "Your order is in transit.", `/orders/${row.order_id}`, { order_id: row.order_id, status });
    return c.json(one(toShipment(shipment)));
  });

  app.post("/shipments/:id/received", idempotent(supabaseIdempotencyStore()), async (c) => {
    const input = await parseBody(c, ReceivedReq);
    const { row, order } = await shipmentFor(c.req.param("id"), c.var.user.schoolId, c.var.user.id);
    if (order.buyer_id !== c.var.user.id) throw new ApiError(403, "FORBIDDEN", "Only the buyer can receive a shipment");
    verifyReceived({ status: row.status, expectedCode: row.label_code, givenCode: input.label_code });
    const updated = await adminClient().from("shipments").update({ status: "received", received_at: new Date().toISOString() }).eq("id", row.id).eq("school_id", row.school_id).select(SHIPMENT_SELECT).single();
    if (updated.error) throw updated.error;
    const status = nextOrderStatus(order.status, "received");
    const payout = payoutFor(status, order.seller.payouts_enabled);
    const moved = await adminClient().from("orders").update({ status, payout_status: payout, ...(status === "completed" ? { released_at: new Date().toISOString() } : {}) }).eq("id", row.order_id).eq("school_id", row.school_id).eq("buyer_id", c.var.user.id);
    if (moved.error) throw moved.error;
    const shipment = ShipmentRow.parse(updated.data);
    await notifyOther(order, c.var.user.id, "shipment.updated", "Shipment received", "The package was marked received.", `/shipments/${shipment.id}`, { shipment_id: shipment.id, status: shipment.status });
    await notifyOther(ShipmentOrder.parse({ ...order, status }), c.var.user.id, "order.updated", "Order completed", "The order is complete.", `/orders/${row.order_id}`, { order_id: row.order_id, status, payout_status: payout });
    return c.json(one({ shipment: toShipment(shipment), order: { id: row.order_id, status, payout: { status: payout } } }));
  });

  return app;
};
