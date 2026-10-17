import { Hono } from "hono";
import type Stripe from "stripe";
import { OrderRow, transitionOrder } from "../db/market.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { stripeClient } from "../lib/stripe.js";
import { adminClient } from "../lib/supabase.js";
import { markPaid } from "../services/escrow.js";
import { nextOrderStatus } from "../services/orders.js";
import { syncConnectAccount } from "../services/stripe-connect.js";
import { afterPaid } from "./orders.js";

/** Remembers which Stripe events were already received (public.stripe_events). */
export interface StripeEventStore {
  /** true = new (or an earlier attempt crashed before finishing), process it; false = already handled. */
  begin(id: string, type: string): Promise<boolean>;
  complete(id: string): Promise<void>;
  /** Handling failed: free the event so Stripe's retry is processed. */
  abandon(id: string): Promise<void>;
}

export interface WebhookDeps {
  constructEvent(raw: string, signature: string): Stripe.Event;
  events: StripeEventStore;
  loadOrder(id: string): Promise<OrderRow | null>;
  loadOrderByPaymentIntent(paymentIntentId: string): Promise<OrderRow | null>;
  updateOrder(order: OrderRow, patch: Record<string, unknown>): Promise<OrderRow>;
  markPaid(order: OrderRow, ref: string): Promise<OrderRow>;
  afterPaid(order: OrderRow): Promise<OrderRow>;
  notify: typeof notify;
  syncConnectAccount(account: Stripe.Account): Promise<void>;
}

const UNIQUE_VIOLATION = "23505";

export function supabaseEventStore(): StripeEventStore {
  const table = () => adminClient().from("stripe_events");
  return {
    async begin(id, type) {
      const inserted = await table().insert({ id, type });
      if (!inserted.error) return true;
      if (inserted.error.code !== UNIQUE_VIOLATION) throw inserted.error;
      const { data, error } = await table().select("processed_at").eq("id", id).maybeSingle<{ processed_at: string | null }>();
      if (error) throw error;
      return !data?.processed_at;
    },
    async complete(id) {
      const { error } = await table().update({ processed_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    async abandon(id) {
      const { error } = await table().delete().eq("id", id).is("processed_at", null);
      if (error) console.error("stripe_events abandon failed", id, error.message);
    },
  };
}

async function fetchOrder(column: "id" | "payment_intent_id", value: string): Promise<OrderRow | null> {
  const { data, error } = await adminClient().from("orders").select("*").eq(column, value).maybeSingle();
  if (error) throw error;
  return data ? OrderRow.parse(data) : null;
}

export function defaultWebhookDeps(): WebhookDeps {
  return {
    constructEvent: (raw, signature) => {
      const secret = process.env["STRIPE_WEBHOOK_SECRET"];
      if (!secret) throw new ApiError(503, "INTERNAL", "Card payments aren't configured");
      return stripeClient().webhooks.constructEvent(raw, signature, secret);
    },
    events: supabaseEventStore(),
    loadOrder: (id) => fetchOrder("id", id),
    loadOrderByPaymentIntent: (pi) => fetchOrder("payment_intent_id", pi),
    updateOrder: transitionOrder,
    markPaid,
    afterPaid,
    notify,
    syncConnectAccount,
  };
}

const idOf = (v: string | { id: string } | null | undefined): string | null => (typeof v === "string" ? v : v?.id ?? null);

async function handle(event: Stripe.Event, d: WebhookDeps): Promise<void> {
  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = event.data.object;
      if (pi.metadata["kind"] !== "order") return; // tutoring etc. come later
      const order = await d.loadOrder(pi.metadata["order_id"] ?? "");
      if (!order || order.school_id !== pi.metadata["school_id"]) {
        console.warn("stripe webhook: no matching order for payment", event.id);
        return;
      }
      if (order.status !== "awaiting_payment") return; // already paid (pay route saw it first) or cancelled
      const paid = await d.markPaid(order, pi.id);
      if (paid.status !== "awaiting_payment") await d.afterPaid(paid);
      return;
    }
    case "payment_intent.payment_failed": {
      const pi = event.data.object;
      if (pi.metadata["kind"] !== "order") return;
      const order = await d.loadOrder(pi.metadata["order_id"] ?? "");
      if (!order || order.school_id !== pi.metadata["school_id"] || order.status !== "awaiting_payment") return;
      // Stays awaiting_payment so the buyer can try another card.
      await d.updateOrder(order, { payment_status: "failed" });
      await d.notify({
        schoolId: order.school_id, userId: order.buyer_id, type: "order.updated", title: "Payment didn't go through",
        body: "Your card was declined. Try another payment method.", deepLink: `/orders/${order.id}`, data: { order_id: order.id },
      });
      return;
    }
    case "charge.dispute.created": {
      const pi = idOf(event.data.object.payment_intent);
      const order = pi ? await d.loadOrderByPaymentIntent(pi) : null;
      if (!order) {
        console.warn("stripe webhook: dispute for an unknown payment", event.id);
        return;
      }
      let status;
      try {
        status = nextOrderStatus(order.status, "dispute");
      } catch {
        console.warn(`stripe webhook: chargeback on order ${order.id} while ${order.status}; needs manual review`);
        return;
      }
      await d.updateOrder(order, { status, dispute_reason: "stripe_chargeback" });
      for (const userId of [order.buyer_id, order.seller_id]) {
        await d.notify({
          schoolId: order.school_id, userId, type: "order.updated", title: "Order disputed",
          body: "The card payment was disputed with the bank. The team will review it.", deepLink: `/orders/${order.id}`, data: { order_id: order.id, status },
        });
      }
      return;
    }
    case "charge.refunded":
      return; // our ledger already recorded the refund when we issued it
    case "account.updated":
      await d.syncConnectAccount(event.data.object);
      return;
    default:
      return;
  }
}

export const webhookRoutes = (overrides: Partial<WebhookDeps> = {}) => {
  const d: WebhookDeps = { ...defaultWebhookDeps(), ...overrides };
  return new Hono().post("/webhooks/stripe", async (c) => {
    const signature = c.req.header("stripe-signature");
    const raw = await c.req.text();
    let event: Stripe.Event;
    try {
      if (!signature) throw new Error("missing signature");
      event = d.constructEvent(raw, signature);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(400, "VALIDATION", "Invalid webhook signature");
    }
    if (!(await d.events.begin(event.id, event.type))) return c.json({ data: { received: true, duplicate: true } });
    try {
      await handle(event, d);
    } catch (err) {
      await d.events.abandon(event.id);
      throw err;
    }
    await d.events.complete(event.id);
    return c.json({ data: { received: true } });
  });
};
