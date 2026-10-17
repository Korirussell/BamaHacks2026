import { Hono } from "hono";
import { z } from "zod";
import { DropOffPointRow, SHIPMENT_SELECT, ShipmentRow, toShipment } from "../db/fulfillment.js";
import { loadListingRow, loadOrderRow, loadViewer, orderOut, transitionOrder, type OrderRow } from "../db/market.js";
import { loadSchool } from "../db/tutoring.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { idempotent, type IdempotencyStore } from "../middleware/idempotency.js";
import { CreateShipmentReq, DroppedOffReq, ReceivedReq } from "../schemas/orders.js";
import { settleOrder } from "../services/escrow.js";
import { nextOrderStatus } from "../services/orders.js";
import { buildLabel, verifyDropOff, verifyReceived } from "../services/shipping.js";

const UNIQUE_VIOLATION = "23505";
const PartyName = z.object({ id: z.guid(), display_name: z.string(), mail_stop_code: z.string().nullable(), mail_name: z.string().nullish(), payouts_enabled: z.boolean() });

const parseId = (raw: string, what: string) => {
  const id = z.guid().safeParse(raw);
  if (!id.success) throw new ApiError(404, "NOT_FOUND", `${what} not found`);
  return id.data;
};

/** A shipment plus its order; the user must be the buyer or seller, else 404. */
async function loadShipment(id: string, userId: string, schoolId: string) {
  const { data, error } = await adminClient().from("shipments").select(SHIPMENT_SELECT)
    .eq("id", id).eq("school_id", schoolId).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "NOT_FOUND", "Shipment not found");
  const shipment = ShipmentRow.parse(data);
  try {
    return { shipment, order: await loadOrderRow(shipment.order_id, userId, schoolId) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) throw new ApiError(404, "NOT_FOUND", "Shipment not found");
    throw err;
  }
}

async function loadParties(order: OrderRow) {
  const { data, error } = await adminClient().from("profiles").select("id, display_name, mail_stop_code, mail_name, payouts_enabled")
    .eq("school_id", order.school_id).in("id", [order.buyer_id, order.seller_id]);
  if (error) throw error;
  const rows = new Map(z.array(PartyName).parse(data).map((p) => [p.id, p]));
  const buyer = rows.get(order.buyer_id);
  const seller = rows.get(order.seller_id);
  if (!buyer || !seller) throw new Error(`Order ${order.id} references missing profiles`);
  return { buyer, seller };
}

async function notifyBoth(order: OrderRow, shipment: ShipmentRow, actorId: string, title: string, body: string) {
  const userId = order.buyer_id === actorId ? order.seller_id : order.buyer_id;
  await notify({
    schoolId: order.school_id, userId, type: "shipment.updated", title, body,
    deepLink: `/shipments/${shipment.id}`, data: { shipment_id: shipment.id, status: shipment.status },
  });
  await notify({
    schoolId: order.school_id, userId, type: "order.updated", title, body,
    deepLink: `/orders/${order.id}`, data: { order_id: order.id, status: order.status },
  });
}

/** `demoAuth` (DEMO_AUTH=on) skips the drop-off window's opening hours, so a weekend demo can drop off. */
export const shipmentRoutes = (verify: TokenVerifier, idempotency: IdempotencyStore, demoAuth = false) => {
  const app = new Hono<AuthEnv>()
    .use("/orders/:id/shipment", requireUser(verify))
    .use("/shipments/*", requireUser(verify));

  app.get("/shipments/:id", async (c) => {
    const { id: userId, schoolId } = c.var.user;
    const { shipment } = await loadShipment(parseId(c.req.param("id"), "Shipment"), userId, schoolId);
    return c.json(one(toShipment(shipment)));
  });

  app.post("/orders/:id/shipment", async (c) => {
    const input = await parseBody(c, CreateShipmentReq);
    const { id: userId, schoolId } = c.var.user;
    const order = await loadOrderRow(parseId(c.req.param("id"), "Order"), userId, schoolId);
    if (order.seller_id !== userId) throw new ApiError(403, "FORBIDDEN", "Only the seller creates the shipment");
    if (order.fulfillment !== "campus_mail") throw new ApiError(409, "INVALID_STATE", "This order is an in-person handoff");
    const status = nextOrderStatus(order.status, "label_created");
    const school = await loadSchool(schoolId);
    if (!school.campus_mail_supported) throw new ApiError(409, "INVALID_STATE", "Campus mail isn't available at your school");

    let points = adminClient().from("drop_off_points").select("*").eq("school_id", schoolId).eq("active", true);
    if (input.drop_off_point_id) points = points.eq("id", input.drop_off_point_id);
    const pointResult = await points.order("name").limit(1);
    if (pointResult.error) throw pointResult.error;
    const point = z.array(DropOffPointRow).parse(pointResult.data)[0];
    if (!point) {
      throw new ApiError(400, "VALIDATION", "Invalid request", { drop_off_point_id: "Pick an active drop-off point at your school" });
    }

    const [{ buyer, seller }, listing] = await Promise.all([loadParties(order), loadListingRow(order.listing_id, schoolId)]);
    const label = buildLabel({
      orderId: order.id,
      buyer: { name: buyer.mail_name ?? "", mailStopCode: buyer.mail_stop_code },
      sellerName: seller.display_name,
      itemTitle: listing.textbook_title ?? listing.title,
      dropOff: { name: point.name, instructions: point.instructions },
    });
    const inserted = await adminClient().from("shipments").insert({
      school_id: schoolId, order_id: order.id, label_code: label.label_code,
      to_name: label.to.name, to_mail_stop_code: label.to.mail_stop_code, drop_off_point_id: point.id,
    }).select(SHIPMENT_SELECT).single();
    if (inserted.error?.code === UNIQUE_VIOLATION) throw new ApiError(409, "INVALID_STATE", "This order already has a shipment");
    if (inserted.error) throw inserted.error;
    const shipment = ShipmentRow.parse(inserted.data);

    const moved = await transitionOrder(order, { status });
    await notifyBoth(moved, shipment, userId, "Label ready", "The seller is sending your item by campus mail.");
    return c.json(one(toShipment(shipment)));
  });

  app.post("/shipments/:id/dropped-off", idempotent(idempotency), async (c) => {
    const input = await parseBody(c, DroppedOffReq);
    const { id: userId, schoolId } = c.var.user;
    const { shipment, order } = await loadShipment(parseId(c.req.param("id"), "Shipment"), userId, schoolId);
    if (order.seller_id !== userId) throw new ApiError(403, "FORBIDDEN", "Only the seller drops off the package");
    const status = nextOrderStatus(order.status, "dropped_off");

    const photo = await adminClient().from("media").select("id")
      .eq("id", input.photo_media_id).eq("school_id", schoolId).eq("owner_id", userId).maybeSingle();
    if (photo.error) throw photo.error;
    if (!photo.data) throw new ApiError(400, "VALIDATION", "Invalid request", { photo_media_id: "Upload the drop-off photo first" });

    const patch = verifyDropOff({
      status: shipment.status,
      at: input.location,
      accuracyM: input.accuracy_m,
      point: { location: { lat: shipment.drop_off.lat, lng: shipment.drop_off.lng }, radiusM: shipment.drop_off.radius_m, ...(demoAuth ? {} : { hours: shipment.drop_off.hours }), name: shipment.drop_off.name },
      photoMediaId: input.photo_media_id,
      now: Date.now(),
      tz: (await loadSchool(schoolId)).timezone,
    });
    const updated = await adminClient().from("shipments").update({
      ...patch, drop_off_proof_media_id: input.photo_media_id, drop_off_lat: input.location.lat, drop_off_lng: input.location.lng,
    }).eq("id", shipment.id).eq("school_id", schoolId).eq("status", "label_created").select(SHIPMENT_SELECT).maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) throw new ApiError(409, "INVALID_STATE", "This shipment just changed; reload it");
    const saved = ShipmentRow.parse(updated.data);

    const moved = await transitionOrder(order, { status });
    await notifyBoth(moved, saved, userId, "Package dropped off", "Your item is in campus mail.");
    return c.json(one(toShipment(saved)));
  });

  app.post("/shipments/:id/received", idempotent(idempotency), async (c) => {
    const input = await parseBody(c, ReceivedReq);
    const { id: userId, schoolId } = c.var.user;
    const { shipment, order } = await loadShipment(parseId(c.req.param("id"), "Shipment"), userId, schoolId);
    if (order.buyer_id !== userId) throw new ApiError(403, "FORBIDDEN", "Only the buyer marks the package received");
    const status = nextOrderStatus(order.status, input.item_ok ? "received" : "dispute");
    verifyReceived({ status: shipment.status, expectedCode: shipment.label_code, givenCode: input.label_code });

    const updated = await adminClient().from("shipments").update({ status: "received", received_at: new Date().toISOString() })
      .eq("id", shipment.id).eq("school_id", schoolId).eq("status", "dropped_off").select(SHIPMENT_SELECT).maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) throw new ApiError(409, "INVALID_STATE", "This shipment just changed; reload it");
    const saved = ShipmentRow.parse(updated.data);

    const moved = input.item_ok
      ? await settleOrder(order, "completed", { reason: "campus_mail_received", sellerPayoutsEnabled: (await loadParties(order)).seller.payouts_enabled })
      // A problem: the money stays held until the dispute is resolved.
      : await transitionOrder(order, { status, dispute_reason: "not_as_described: the buyer flagged a problem when the package arrived" });
    const body = moved.status === "completed" ? "The buyer got the package." : "The buyer flagged a problem with the item.";
    await notifyBoth(moved, saved, userId, moved.status === "completed" ? "Order completed" : "Order disputed", body);
    return c.json(one({ shipment: toShipment(saved), order: await orderOut(moved, await loadViewer(userId, schoolId)) }));
  });

  return app;
};
