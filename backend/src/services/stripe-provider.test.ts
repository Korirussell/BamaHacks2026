import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import type { OrderRow } from "../db/market.js";
import type { StripeLike } from "../lib/stripe.js";
import { stripeProvider } from "./stripe-provider.js";

const order = {
  id: "11111111-1111-4111-8111-111111111111", school_id: "33333333-3333-4333-8333-333333333333", listing_id: "44444444-4444-4444-8444-444444444444",
  buyer_id: "55555555-5555-4555-8555-555555555555", seller_id: "66666666-6666-4666-8666-666666666666", amount_cents: 5000, payment_intent_id: null,
} as OrderRow;

type Call = { fn: string; args: unknown[] };
function fake(pi: Partial<Stripe.PaymentIntent> = {}, cancelError?: unknown) {
  const calls: Call[] = [];
  const intent = (over: Partial<Stripe.PaymentIntent> = {}) => ({ id: "pi_1", status: "requires_payment_method", client_secret: "pi_1_secret", latest_charge: "ch_1", ...pi, ...over }) as Stripe.PaymentIntent;
  const stripe: StripeLike = {
    paymentIntents: {
      create: async (...args) => { calls.push({ fn: "pi.create", args }); return intent({ status: "requires_payment_method" }); },
      retrieve: async (...args) => { calls.push({ fn: "pi.retrieve", args }); return intent(); },
      cancel: async (...args) => { calls.push({ fn: "pi.cancel", args }); if (cancelError) throw cancelError; return intent({ status: "canceled" }); },
    },
    transfers: { create: async (...args) => { calls.push({ fn: "tr.create", args }); return { id: "tr_1" } as Stripe.Transfer; } },
    refunds: { create: async (...args) => { calls.push({ fn: "re.create", args }); return { id: "re_1" } as Stripe.Refund; } },
    webhooks: { constructEvent: () => { throw new Error("unused"); } },
  };
  return { stripe, calls };
}

test("startPayment creates an intent with transfer_group, metadata and a per-order idempotency key", async () => {
  const { stripe, calls } = fake();
  const out = await stripeProvider(stripe, async () => "acct_1").startPayment(order, { idempotencyKey: "k" });
  assert.deepEqual(out, { ref: "pi_1", clientSecret: "pi_1_secret", settled: false });
  assert.deepEqual(calls[0]?.args, [{
    amount: 5000, currency: "usd", automatic_payment_methods: { enabled: true }, transfer_group: order.id,
    metadata: { kind: "order", order_id: order.id, school_id: order.school_id, buyer_id: order.buyer_id, seller_id: order.seller_id },
  }, { idempotencyKey: `pi:${order.id}` }]);
});

test("startPayment reuses a usable intent, and reports an already-succeeded one as settled", async () => {
  const withPi = { ...order, payment_intent_id: "pi_1" };
  const usable = fake({ status: "requires_action" });
  assert.deepEqual(await stripeProvider(usable.stripe).startPayment(withPi, { idempotencyKey: "k" }), { ref: "pi_1", clientSecret: "pi_1_secret", settled: false });
  assert.equal(usable.calls.some((c) => c.fn === "pi.create"), false);
  const done = fake({ status: "succeeded" });
  assert.deepEqual(await stripeProvider(done.stripe).startPayment(withPi, { idempotencyKey: "k" }), { ref: "pi_1", clientSecret: null, settled: true });
  const cancelled = fake({ status: "canceled" });
  await stripeProvider(cancelled.stripe).startPayment(withPi, { idempotencyKey: "k" });
  assert.deepEqual((cancelled.calls.find((c) => c.fn === "pi.create")?.args[1]), { idempotencyKey: `pi:${order.id}:pi_1` });
});

test("cancelPayment cancels open intents and tolerates finished ones", async () => {
  const withPi = { ...order, payment_intent_id: "pi_1" };
  const open = fake();
  await stripeProvider(open.stripe).cancelPayment(withPi);
  assert.equal(open.calls.some((c) => c.fn === "pi.cancel"), true);
  const done = fake({ status: "succeeded" });
  await stripeProvider(done.stripe).cancelPayment(withPi);
  assert.equal(done.calls.some((c) => c.fn === "pi.cancel"), false);
  const raced = fake({}, Object.assign(new Error("state"), { code: "payment_intent_unexpected_state" }));
  await stripeProvider(raced.stripe).cancelPayment(withPi);
  const broken = fake({}, new Error("network"));
  await assert.rejects(stripeProvider(broken.stripe).cancelPayment(withPi), /network/);
});

test("release transfers to the seller's account from the PaymentIntent's charge", async () => {
  const withPi = { ...order, payment_intent_id: "pi_1" };
  const { stripe, calls } = fake({ latest_charge: "ch_9" });
  const out = await stripeProvider(stripe, async (sellerId) => (sellerId === order.seller_id ? "acct_seller" : null)).release(withPi, 4750);
  assert.deepEqual(out, { ref: "tr_1" });
  assert.deepEqual(calls.find((c) => c.fn === "tr.create")?.args, [
    { amount: 4750, currency: "usd", destination: "acct_seller", transfer_group: order.id, source_transaction: "ch_9", metadata: { order_id: order.id } },
    { idempotencyKey: `tr:${order.id}` },
  ]);
  await assert.rejects(stripeProvider(fake().stripe, async () => null).release(withPi, 1), /payout account/);
});

test("refund targets the PaymentIntent with a per-order idempotency key", async () => {
  const { stripe, calls } = fake();
  const out = await stripeProvider(stripe).refund({ ...order, payment_intent_id: "pi_1" }, 5000);
  assert.deepEqual(out, { ref: "re_1" });
  assert.deepEqual(calls[0]?.args, [{ payment_intent: "pi_1", amount: 5000, metadata: { order_id: order.id } }, { idempotencyKey: `re:${order.id}` }]);
});

test("tutoring sessions get their own metadata and idempotency keys", async () => {
  const session = { ...order, kind: "tutoring_session" as const, id: "77777777-7777-4777-8777-777777777777" };
  const { stripe, calls } = fake({ latest_charge: "ch_9" });
  const p = stripeProvider(stripe, async (id) => (id === order.seller_id ? "acct_tutor" : null));
  await p.startPayment(session, { idempotencyKey: "k" });
  assert.deepEqual(calls[0]?.args, [{
    amount: 5000, currency: "usd", automatic_payment_methods: { enabled: true }, transfer_group: session.id,
    metadata: { kind: "tutoring_session", tutoring_session_id: session.id, school_id: order.school_id, student_id: order.buyer_id, tutor_id: order.seller_id },
  }, { idempotencyKey: `pi:ts:${session.id}` }]);
  const withPi = { ...session, payment_intent_id: "pi_1" };
  await p.release(withPi, 4750);
  assert.deepEqual(calls.find((c) => c.fn === "tr.create")?.args[1], { idempotencyKey: `tr:ts:${session.id}` });
  assert.equal((calls.find((c) => c.fn === "tr.create")?.args[0] as Stripe.TransferCreateParams).destination, "acct_tutor");
  await p.refund(withPi, 5000);
  assert.deepEqual(calls.find((c) => c.fn === "re.create")?.args, [
    { payment_intent: "pi_1", amount: 5000, metadata: { tutoring_session_id: session.id } }, { idempotencyKey: `re:ts:${session.id}` },
  ]);
});
