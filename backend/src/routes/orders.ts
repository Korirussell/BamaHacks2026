import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { OrderRow, loadListingRow, loadOrderRow, loadViewer, orderOut, ordersOut } from "../db/market.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { one, page } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { idempotent, type IdempotencyStore } from "../middleware/idempotency.js";
import { nextOrderStatus, payoutFor } from "../services/orders.js";

/** "demo" marks orders paid on the spot (no card); "stripe" is step 10 and isn't built yet. */
export type PaymentsMode = "demo" | "stripe";

const CancelReq = z.object({ reason: z.string().trim().min(1).max(500) });

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

const parseId = (raw: string) => {
  const id = z.guid().safeParse(raw);
  if (!id.success) throw new ApiError(404, "NOT_FOUND", "Order not found");
  return id.data;
};

/** Writes an order change only if nobody else changed it since we read it. */
async function transition(row: OrderRow, patch: Record<string, unknown>) {
  const data = check(
    await adminClient().from("orders").update(patch).eq("id", row.id).eq("updated_at", row.updated_at).select("*").maybeSingle(),
  );
  if (!data) throw new ApiError(409, "INVALID_STATE", "This order just changed; reload it");
  return OrderRow.parse(data);
}

/** In-person orders get a handoff to schedule once they're paid; the seller gives, the buyer receives. */
async function openHandoff(order: OrderRow) {
  const db = adminClient();
  const created = await db.from("handoffs").upsert(
    { school_id: order.school_id, context_type: "order", context_id: order.id, giver_id: order.seller_id, receiver_id: order.buyer_id },
    { onConflict: "context_type,context_id", ignoreDuplicates: false },
  ).select("id").single<{ id: string }>();
  if (created.error) throw created.error;
  const linked = await db.from("orders").update({ handoff_id: created.data.id }).eq("id", order.id).select("*").single();
  if (linked.error) throw linked.error;
  return OrderRow.parse(linked.data);
}

export const ordersRoutes = (verify: TokenVerifier, idempotency: IdempotencyStore, payments: PaymentsMode) => new Hono<AuthEnv>()
  .use("/orders/*", requireUser(verify))
  .use("/me/orders/*", requireUser(verify))

  .get("/me/orders", async (c) => {
    const q = parseQuery(c, z.object({ role: z.enum(["buyer", "seller"]).default("buyer"), status: OrderRow.shape.status.optional() }));
    const { id, schoolId } = c.var.user;
    let query = adminClient().from("orders").select("*").eq("school_id", schoolId).eq(q.role === "buyer" ? "buyer_id" : "seller_id", id);
    if (q.status) query = query.eq("status", q.status);
    const rows = z.array(OrderRow).parse(check(await query.order("created_at", { ascending: false }).limit(100)));
    return c.json(page(await ordersOut(rows, schoolId, await loadViewer(id, schoolId))));
  })

  .get("/orders/:id", async (c) => {
    const { id: userId, schoolId } = c.var.user;
    const row = await loadOrderRow(parseId(c.req.param("id")), userId, schoolId);
    return c.json(one(await orderOut(row, await loadViewer(userId, schoolId))));
  })

  .post("/orders/:id/pay", idempotent(idempotency), async (c) => {
    const { id: userId, schoolId } = c.var.user;
    const row = await loadOrderRow(parseId(c.req.param("id")), userId, schoolId);
    if (row.buyer_id !== userId) throw new ApiError(403, "FORBIDDEN", "Only the buyer pays");
    const status = nextOrderStatus(row.status, "payment_succeeded");
    if (payments !== "demo") throw new ApiError(503, "INTERNAL", "Card payments aren't set up yet");

    // Demo: the payment "succeeds" at once and the money counts as held on the platform.
    const paymentIntentId = `demo_pi_${randomUUID()}`;
    let paid = await transition(row, {
      status, payment_status: "succeeded", payment_intent_id: paymentIntentId, paid_at: new Date().toISOString(), payout_status: "held",
    });
    if (paid.fulfillment === "in_person") paid = await openHandoff(paid);

    const listing = await loadListingRow(paid.listing_id, schoolId);
    const next = paid.fulfillment === "in_person" ? "Pick a time and safe spot to meet." : "Print the campus-mail label and drop it off.";
    await notify({
      schoolId, userId: paid.seller_id, type: "order.updated", title: "Payment received",
      body: `${listing.textbook_title ?? listing.title}: ${next}`, deepLink: `/orders/${paid.id}`, data: { order_id: paid.id },
    });
    return c.json(one({ client_secret: null, payment_intent_id: paymentIntentId, demo: true, order: await orderOut(paid, await loadViewer(userId, schoolId)) }));
  })

  .post("/orders/:id/cancel", async (c) => {
    const { reason } = await parseBody(c, CancelReq);
    const { id: userId, schoolId } = c.var.user;
    const row = await loadOrderRow(parseId(c.req.param("id")), userId, schoolId);
    const status = nextOrderStatus(row.status, "cancel");
    const refunded = status === "refunded";
    const db = adminClient();
    const cancelled = await transition(row, {
      status, cancel_reason: reason, payout_status: payoutFor(status, false),
      ...(refunded ? { payment_status: "refunded" } : {}),
    });
    if (row.handoff_id) {
      const h = await db.from("handoffs").update({ status: "cancelled" }).eq("id", row.handoff_id).not("status", "in", "(completed,cancelled)");
      if (h.error) throw h.error;
    }
    // Back on the market.
    const relisted = await db.from("listings").update({ status: "active" }).eq("id", row.listing_id).eq("status", "pending");
    if (relisted.error) throw relisted.error;

    const otherId = row.buyer_id === userId ? row.seller_id : row.buyer_id;
    await notify({
      schoolId, userId: otherId, type: "order.updated", title: "Order cancelled",
      body: refunded ? `Refunded. Reason: ${reason}` : `Reason: ${reason}`, deepLink: `/orders/${row.id}`, data: { order_id: row.id },
    });
    return c.json(one(await orderOut(cancelled, await loadViewer(userId, schoolId))));
  });
