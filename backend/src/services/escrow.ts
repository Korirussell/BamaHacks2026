import { randomUUID } from "node:crypto";
import { transitionOrder, type OrderRow } from "../db/market.js";
import { ApiError } from "../lib/errors.js";
import { adminClient } from "../lib/supabase.js";
import { payoutFor, type OrderStatus } from "./orders.js";

// Escrow without Stripe: the buyer's money is "held" on the platform from pay until the trade is
// confirmed (released to the seller) or falls through (refunded to the buyer). Every movement goes
// through a PaymentProvider and is written to escrow_entries. Only the demo provider exists today;
// a Stripe provider plugs in here later without touching the routes.

export type EscrowKind = "hold" | "release" | "refund";

export interface PaymentProvider {
  readonly name: "demo" | "stripe";
  hold(order: OrderRow): Promise<{ ref: string }>;
  release(order: OrderRow, amountCents: number): Promise<{ ref: string }>;
  refund(order: OrderRow, amountCents: number): Promise<{ ref: string }>;
}

/** Money "moves" instantly and nothing leaves the platform. */
export const demoProvider: PaymentProvider = {
  name: "demo",
  hold: async () => ({ ref: `demo_pi_${randomUUID()}` }),
  release: async () => ({ ref: `demo_tr_${randomUUID()}` }),
  refund: async () => ({ ref: `demo_re_${randomUUID()}` }),
};

let provider: PaymentProvider = demoProvider;
/** Swap the provider (tests, or Stripe later). */
export function setPaymentProvider(p: PaymentProvider) {
  provider = p;
}

async function record(order: OrderRow, kind: EscrowKind, amountCents: number, ref: string, reason: string | null) {
  const { error } = await adminClient().from("escrow_entries").insert({
    school_id: order.school_id, order_id: order.id, kind, amount_cents: amountCents, provider: provider.name, provider_ref: ref, reason,
  });
  // 23505 = this movement was already recorded (a retried request); the first one wins.
  if (error && error.code !== "23505") throw error;
}

/** Buyer pays: hold the full amount. Order must be awaiting_payment; returns it as paid. */
export async function holdFunds(order: OrderRow): Promise<OrderRow> {
  const { ref } = await provider.hold(order);
  const paid = await transitionOrder(order, {
    status: "paid", payment_status: "succeeded", payment_intent_id: ref, paid_at: new Date().toISOString(), payout_status: "held",
  });
  await record(paid, "hold", paid.amount_cents, ref, "buyer_paid");
  return paid;
}

export type SettleStatus = Extract<OrderStatus, "completed" | "refunded" | "cancelled">;

/**
 * Move an order to a final state and settle the held money:
 * - completed → release the seller's payout (or awaiting_onboarding until they can be paid), listing sold
 * - refunded / cancelled → refund the buyer if they had paid, listing back on the market
 * `status` must already be the result of nextOrderStatus(...) so illegal transitions are rejected first.
 */
export async function settleOrder(
  order: OrderRow,
  status: SettleStatus,
  opts: { reason: string; sellerPayoutsEnabled?: boolean; patch?: Record<string, unknown> },
): Promise<OrderRow> {
  const db = adminClient();
  const wasPaid = order.payment_status === "succeeded";
  const payout = payoutFor(status, opts.sellerPayoutsEnabled ?? false);
  const now = new Date().toISOString();

  if (status === "completed") {
    if (!wasPaid) throw new ApiError(409, "INVALID_STATE", "Order was never paid");
    const moved = await transitionOrder(order, {
      ...opts.patch, status, payout_status: payout, ...(payout === "released" ? { released_at: now } : {}),
    });
    if (payout === "released") {
      const { ref } = await provider.release(moved, moved.seller_payout_cents);
      await record(moved, "release", moved.seller_payout_cents, ref, opts.reason);
    }
    const sold = await db.from("listings").update({ status: "sold" }).eq("id", order.listing_id).eq("school_id", order.school_id);
    if (sold.error) throw sold.error;
    return moved;
  }

  const moved = await transitionOrder(order, {
    ...opts.patch, status, payout_status: payout, ...(wasPaid ? { payment_status: "refunded" } : {}),
  });
  if (wasPaid) {
    const { ref } = await provider.refund(moved, moved.amount_cents);
    await record(moved, "refund", moved.amount_cents, ref, opts.reason);
  }
  const relisted = await db.from("listings").update({ status: "active" }).eq("id", order.listing_id).eq("status", "pending");
  if (relisted.error) throw relisted.error;
  return moved;
}

/** Seller finished payout onboarding: release anything completed while they couldn't be paid. */
export async function releaseAwaitingPayout(order: OrderRow): Promise<OrderRow> {
  if (order.status !== "completed" || order.payout_status !== "awaiting_onboarding") return order;
  const moved = await transitionOrder(order, { payout_status: "released", released_at: new Date().toISOString() });
  const { ref } = await provider.release(moved, moved.seller_payout_cents);
  await record(moved, "release", moved.seller_payout_cents, ref, "seller_onboarded");
  return moved;
}
