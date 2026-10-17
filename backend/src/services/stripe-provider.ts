import type Stripe from "stripe";
import { ApiError } from "../lib/errors.js";
import { adminClient } from "../lib/supabase.js";
import type { StripeLike } from "../lib/stripe.js";
import type { Payable, PaymentProvider } from "./escrow.js";

// Separate charges and transfers: the buyer is charged on the platform account (held there as
// escrow), and the seller is paid with a Transfer when the trade is confirmed. Idempotency keys
// are per order so a retried request or a retried settle never moves money twice.

const USABLE: Stripe.PaymentIntent.Status[] = ["requires_payment_method", "requires_confirmation", "requires_action", "processing"];
const CANCELLABLE: Stripe.PaymentIntent.Status[] = ["requires_payment_method", "requires_confirmation", "requires_action", "processing", "requires_capture"];

const chargeIdOf = (pi: Stripe.PaymentIntent): string | null => {
  const c = pi.latest_charge;
  return typeof c === "string" ? c : c?.id ?? null;
};

// Orders keep their original keys and metadata; tutoring sessions get their own prefix so the
// two can never share an idempotency key.
const isSession = (p: Payable) => p.kind === "tutoring_session";
const keyOf = (p: Payable, op: "pi" | "tr" | "re") => (isSession(p) ? `${op}:ts:${p.id}` : `${op}:${p.id}`);
const refMeta = (p: Payable): Record<string, string> => (isSession(p) ? { tutoring_session_id: p.id } : { order_id: p.id });
const intentMeta = (p: Payable): Record<string, string> => (isSession(p)
  ? { kind: "tutoring_session", tutoring_session_id: p.id, school_id: p.school_id, student_id: p.buyer_id, tutor_id: p.seller_id }
  : { kind: "order", order_id: p.id, school_id: p.school_id, buyer_id: p.buyer_id, seller_id: p.seller_id });

export type SellerAccountLookup = (sellerId: string, schoolId: string) => Promise<string | null>;

const supabaseSellerAccount: SellerAccountLookup = async (sellerId, schoolId) => {
  const { data, error } = await adminClient().from("profiles").select("stripe_account_id").eq("id", sellerId).eq("school_id", schoolId).maybeSingle<{ stripe_account_id: string | null }>();
  if (error) throw error;
  return data?.stripe_account_id ?? null;
};

export function stripeProvider(stripe: StripeLike, sellerAccount: SellerAccountLookup = supabaseSellerAccount): PaymentProvider {
  return {
    name: "stripe",

    async startPayment(order) {
      let key = keyOf(order, "pi");
      if (order.payment_intent_id) {
        const existing = await stripe.paymentIntents.retrieve(order.payment_intent_id);
        if (USABLE.includes(existing.status) && existing.client_secret) {
          return { ref: existing.id, clientSecret: existing.client_secret, settled: false };
        }
        // Already charged: the caller marks the order paid (the webhook would do the same).
        if (existing.status === "succeeded") return { ref: existing.id, clientSecret: null, settled: true };
        key = `${keyOf(order, "pi")}:${existing.id}`; // cancelled earlier → a fresh intent needs a fresh key
      }
      const pi = await stripe.paymentIntents.create({
        amount: order.amount_cents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        transfer_group: order.id,
        metadata: intentMeta(order),
      }, { idempotencyKey: key });
      return { ref: pi.id, clientSecret: pi.client_secret, settled: false };
    },

    async cancelPayment(order) {
      if (!order.payment_intent_id) return;
      try {
        const pi = await stripe.paymentIntents.retrieve(order.payment_intent_id);
        if (!CANCELLABLE.includes(pi.status)) return; // already cancelled or succeeded
        await stripe.paymentIntents.cancel(order.payment_intent_id);
      } catch (err) {
        // Cancelled/succeeded between our read and the cancel: nothing left to abandon.
        if ((err as { code?: string }).code === "payment_intent_unexpected_state") return;
        throw err;
      }
    },

    async release(order, amountCents) {
      if (!order.payment_intent_id) throw new ApiError(409, "INVALID_STATE", "Order has no payment to release");
      const destination = await sellerAccount(order.seller_id, order.school_id);
      if (!destination) throw new ApiError(409, "INVALID_STATE", "Seller has no payout account");
      const pi = await stripe.paymentIntents.retrieve(order.payment_intent_id);
      const charge = chargeIdOf(pi);
      if (!charge) throw new ApiError(409, "INVALID_STATE", "Payment has no charge to pay out from");
      const transfer = await stripe.transfers.create({
        amount: amountCents, currency: "usd", destination, transfer_group: order.id, source_transaction: charge, metadata: refMeta(order),
      }, { idempotencyKey: keyOf(order, "tr") });
      return { ref: transfer.id };
    },

    async refund(order, amountCents) {
      if (!order.payment_intent_id) throw new ApiError(409, "INVALID_STATE", "Order has no payment to refund");
      const refund = await stripe.refunds.create({
        payment_intent: order.payment_intent_id, amount: amountCents, metadata: refMeta(order),
      }, { idempotencyKey: keyOf(order, "re") });
      return { ref: refund.id };
    },
  };
}
