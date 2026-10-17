import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import { createApp } from "../app.js";
import type { OrderRow } from "../db/market.js";
import type { EscrowSession } from "../services/tutoring-escrow.js";
import type { WebhookDeps } from "./webhooks.js";

process.env["SUPABASE_URL"] ??= "https://example.supabase.co";

const school = "33333333-3333-4333-8333-333333333333";
const orderBase = {
  id: "11111111-1111-4111-8111-111111111111", school_id: school, buyer_id: "55555555-5555-4555-8555-555555555555",
  seller_id: "66666666-6666-4666-8666-666666666666", status: "awaiting_payment", payment_intent_id: "pi_1",
} as OrderRow;

function harness(order: OrderRow | null = orderBase, session: EscrowSession | null = null) {
  const log: string[] = [];
  const seen = new Set<string>();
  const deps: WebhookDeps = {
    constructEvent: (raw, sig) => {
      if (sig !== "good") throw new Error("bad signature");
      return JSON.parse(raw) as Stripe.Event;
    },
    events: {
      begin: async (id) => { if (seen.has(id)) return false; seen.add(id); return true; },
      complete: async (id) => { log.push(`complete:${id}`); },
      abandon: async (id) => { seen.delete(id); log.push(`abandon:${id}`); },
    },
    loadOrder: async () => order,
    loadOrderByPaymentIntent: async () => order,
    updateOrder: async (o, patch) => { log.push(`update:${JSON.stringify(patch)}`); return { ...o, ...patch } as OrderRow; },
    markPaid: async (o, ref) => { log.push(`markPaid:${ref}`); return { ...o, status: "paid" } as OrderRow; },
    afterPaid: async (o) => { log.push("afterPaid"); return o; },
    notify: async (n) => { log.push(`notify:${n.userId}:${n.title}`); },
    syncConnectAccount: async (a) => { log.push(`sync:${a.id}`); },
    loadSession: async () => session,
    loadSessionByPaymentIntent: async () => session,
    updateSession: async (s, patch) => { log.push(`updateSession:${JSON.stringify(patch)}`); return { ...s, ...patch } as EscrowSession; },
    markSessionPaid: async (s, ref) => { log.push(`markSessionPaid:${ref}`); return { ...s, status: "paid" } as EscrowSession; },
  };
  const app = createApp({ webhooks: deps, log: false });
  const post = (event: unknown, sig = "good") =>
    app.request("/api/v1/webhooks/stripe", { method: "POST", headers: { "stripe-signature": sig }, body: JSON.stringify(event) });
  return { log, post, app };
}

const pi = (type: string, metadata: Record<string, string> = { kind: "order", order_id: orderBase.id, school_id: school }) =>
  ({ id: `evt_${type}`, type, data: { object: { id: "pi_1", metadata } } });

test("a bad or missing signature is a 400 and nothing runs", async () => {
  const h = harness();
  assert.equal((await h.post(pi("payment_intent.succeeded"), "nope")).status, 400);
  const none = await h.app.request("/api/v1/webhooks/stripe", { method: "POST", body: "{}" });
  assert.equal(none.status, 400);
  assert.deepEqual(h.log, []);
});

test("payment_intent.succeeded marks the order paid, runs afterPaid, and a redelivery is a no-op", async () => {
  const h = harness();
  assert.equal((await h.post(pi("payment_intent.succeeded"))).status, 200);
  assert.deepEqual(h.log, ["markPaid:pi_1", "afterPaid", "complete:evt_payment_intent.succeeded"]);
  const again = await h.post(pi("payment_intent.succeeded"));
  assert.equal(again.status, 200);
  assert.equal(h.log.length, 3);
});

test("succeeded ignores other kinds, mismatched schools and already-paid orders", async () => {
  const h = harness();
  await h.post({ ...pi("payment_intent.succeeded", { kind: "tutoring" }), id: "e1" });
  await h.post({ ...pi("payment_intent.succeeded", { kind: "order", order_id: orderBase.id, school_id: "99999999-9999-4999-8999-999999999999" }), id: "e2" });
  assert.equal(h.log.some((l) => l.startsWith("markPaid")), false);
  const paid = harness({ ...orderBase, status: "paid" });
  assert.equal((await paid.post(pi("payment_intent.succeeded"))).status, 200);
  assert.equal(paid.log.some((l) => l.startsWith("markPaid")), false);
});

test("payment_failed keeps the order retryable and tells the buyer", async () => {
  const h = harness();
  assert.equal((await h.post(pi("payment_intent.payment_failed"))).status, 200);
  assert.deepEqual(h.log.slice(0, 2), ['update:{"payment_status":"failed"}', `notify:${orderBase.buyer_id}:Payment didn't go through`]);
});

test("a chargeback moves a legal order to disputed and notifies both sides", async () => {
  const h = harness({ ...orderBase, status: "scheduled" });
  const event = { id: "evt_d", type: "charge.dispute.created", data: { object: { id: "dp_1", payment_intent: "pi_1" } } };
  assert.equal((await h.post(event)).status, 200);
  assert.equal(h.log[0], 'update:{"status":"disputed","dispute_reason":"stripe_chargeback"}');
  assert.equal(h.log.filter((l) => l.startsWith("notify")).length, 2);
  const final = harness({ ...orderBase, status: "completed" });
  assert.equal((await final.post(event)).status, 200);
  assert.equal(final.log.some((l) => l.startsWith("update")), false);
});

test("account.updated syncs the connect account; refunds and unknown events are acknowledged", async () => {
  const h = harness();
  await h.post({ id: "e1", type: "account.updated", data: { object: { id: "acct_1" } } });
  await h.post({ id: "e2", type: "charge.refunded", data: { object: {} } });
  await h.post({ id: "e3", type: "customer.created", data: { object: {} } });
  assert.ok(h.log.includes("sync:acct_1"));
});

test("a handler failure frees the event for Stripe's retry and returns 500", async () => {
  const h = harness();
  const app = createApp({ webhooks: { ...({} as WebhookDeps), constructEvent: (raw) => JSON.parse(raw) as Stripe.Event, events: { begin: async () => true, complete: async () => {}, abandon: async () => { h.log.push("abandoned"); } }, loadOrder: async () => { throw new Error("db down"); } }, log: false });
  const res = await app.request("/api/v1/webhooks/stripe", { method: "POST", headers: { "stripe-signature": "x" }, body: JSON.stringify(pi("payment_intent.succeeded")) });
  assert.equal(res.status, 500);
  assert.deepEqual(h.log, ["abandoned"]);
});

test("pay still needs auth and an Idempotency-Key (demo-compatible)", async () => {
  const app = createApp({ verify: async () => null, log: false });
  assert.equal((await app.request("/api/v1/orders/11111111-1111-4111-8111-111111111111/pay", { method: "POST" })).status, 401);
});

const sessionBase = {
  id: "77777777-7777-4777-8777-777777777777", school_id: school, student_id: "55555555-5555-4555-8555-555555555555",
  tutor_id: "66666666-6666-4666-8666-666666666666", status: "accepted", payment_intent_id: "pi_1",
} as EscrowSession;
const tutoringMeta = { kind: "tutoring_session", tutoring_session_id: sessionBase.id, school_id: school };

test("a tutoring payment marks the session paid once; other schools and finished sessions are ignored", async () => {
  const h = harness(null, sessionBase);
  assert.equal((await h.post(pi("payment_intent.succeeded", tutoringMeta))).status, 200);
  assert.deepEqual(h.log, ["markSessionPaid:pi_1", "complete:evt_payment_intent.succeeded"]);
  await h.post(pi("payment_intent.succeeded", tutoringMeta));
  assert.equal(h.log.length, 2);

  const other = harness(null, sessionBase);
  await other.post(pi("payment_intent.succeeded", { ...tutoringMeta, school_id: "99999999-9999-4999-8999-999999999999" }));
  const cancelled = harness(null, { ...sessionBase, status: "cancelled" });
  await cancelled.post(pi("payment_intent.succeeded", tutoringMeta));
  for (const x of [other, cancelled]) assert.equal(x.log.some((l) => l.startsWith("markSessionPaid") || l.startsWith("markPaid")), false);
});

test("a failed tutoring payment keeps the session payable and tells the student", async () => {
  const h = harness(null, sessionBase);
  await h.post(pi("payment_intent.payment_failed", tutoringMeta));
  assert.deepEqual(h.log.slice(0, 2), ['updateSession:{"payment_status":"failed"}', `notify:${sessionBase.student_id}:Payment didn't go through`]);
});

test("a chargeback on a tutoring payment notifies both sides and changes nothing", async () => {
  const h = harness(null, { ...sessionBase, status: "paid" });
  await h.post({ id: "evt_d2", type: "charge.dispute.created", data: { object: { id: "dp_2", payment_intent: "pi_1" } } });
  assert.equal(h.log.filter((l) => l.startsWith("notify")).length, 2);
  assert.equal(h.log.some((l) => l.startsWith("update")), false);
});
