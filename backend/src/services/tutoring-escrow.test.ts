import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import type { IdempotencyStore } from "../middleware/idempotency.js";
import { demoProvider, setPaymentProvider, type Payable, type PaymentProvider } from "./escrow.js";
import {
  beginSessionPayment, markSessionPaid, releaseAwaitingSessionPayout, sessionPayable, settleSession,
  type EscrowSession, type SessionEscrowDeps,
} from "./tutoring-escrow.js";

process.env["SUPABASE_URL"] ??= "https://example.supabase.co";

const school = "33333333-3333-4333-8333-333333333333";
const tutor = "66666666-6666-4666-8666-666666666666";
const student = "55555555-5555-4555-8555-555555555555";
const sessionId = "77777777-7777-4777-8777-777777777777";

const base = {
  id: sessionId, school_id: school, tutor_id: tutor, student_id: student, course_id: "88888888-8888-4888-8888-888888888888",
  start_at: "2026-10-20T15:00:00.000Z", end_at: "2026-10-20T16:00:00.000Z", price_cents: 3000,
  location_kind: "library_room", location_name: "Gorgas Library", meeting_url: null, safe_zone_id: "99999999-9999-4999-8999-999999999999",
  room_booking_status: "booked", room: "Room 201", booking_url: null, status: "accepted", waiting_on: null, history: [], notes: null,
  handoff_id: null, cancel_reason: null, payment_intent_id: null, payment_status: "none", payout_status: null,
  fee_cents: null, tutor_payout_cents: null, paid_at: null, released_at: null, updated_at: "v0",
  course: { code: "CS 101" },
} as unknown as EscrowSession;

function fakes(opts: { payoutsEnabled?: boolean } = {}) {
  const log: string[] = [];
  let version = 0;
  const deps: SessionEscrowDeps = {
    store: {
      update: async (row, patch) => { log.push(`update:${Object.keys(patch).sort().join(",")}`); return { ...row, ...patch, updated_at: `v${++version}` } as EscrowSession; },
      record: async (_row, kind, amount, ref, reason) => { log.push(`record:${kind}:${amount}:${ref}:${reason}`); },
      payoutsEnabled: async () => opts.payoutsEnabled ?? true,
      openHandoff: async (row) => { log.push("openHandoff"); return { ...row, handoff_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }; },
      cancelHandoff: async (row) => { log.push(`cancelHandoff:${row.handoff_id ?? "none"}`); },
    },
    notify: async (n) => { log.push(`notify:${n.userId === tutor ? "tutor" : "student"}:${n.title}`); },
  };
  return { deps, log };
}

/** A provider that records calls; `settled: false` behaves like Stripe (wait for the webhook). */
function recordingProvider(settled: boolean) {
  const calls: Array<{ fn: string; payable: Payable; amount?: number }> = [];
  const p: PaymentProvider = {
    name: settled ? "demo" : "stripe",
    startPayment: async (payable) => { calls.push({ fn: "start", payable }); return { ref: "pi_t1", clientSecret: settled ? null : "pi_t1_secret", settled }; },
    cancelPayment: async (payable) => { calls.push({ fn: "cancel", payable }); },
    release: async (payable, amount) => { calls.push({ fn: "release", payable, amount }); return { ref: "tr_t1" }; },
    refund: async (payable, amount) => { calls.push({ fn: "refund", payable, amount }); return { ref: "re_t1" }; },
  };
  setPaymentProvider(p);
  return calls;
}

test.afterEach(() => setPaymentProvider(demoProvider));

test("sessionPayable maps student → buyer and tutor → seller", () => {
  assert.deepEqual(sessionPayable(base), {
    kind: "tutoring_session", id: sessionId, school_id: school, buyer_id: student, seller_id: tutor, amount_cents: 3000, payment_intent_id: null,
  });
});

test("demo pay holds at once: fee fixed, ledger hold, handoff opened, tutor told", async () => {
  recordingProvider(true);
  const { deps, log } = fakes();
  const out = await beginSessionPayment(base, { idempotencyKey: "k", feeBps: 500 }, deps);
  assert.equal(out.clientSecret, null);
  assert.equal(out.session.status, "paid");
  assert.equal(out.session.payment_status, "succeeded");
  assert.equal(out.session.payout_status, "held");
  assert.equal(out.session.fee_cents, 150);
  assert.equal(out.session.tutor_payout_cents, 2850);
  assert.equal(out.session.handoff_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.deepEqual(log.filter((l) => !l.startsWith("update")), ["record:hold:3000:pi_t1:student_paid", "openHandoff", "notify:tutor:Session paid"]);
});

test("stripe pay stores the PaymentIntent and waits; the webhook's markSessionPaid is idempotent", async () => {
  const calls = recordingProvider(false);
  const { deps, log } = fakes();
  const out = await beginSessionPayment(base, { idempotencyKey: "k", feeBps: 500 }, deps);
  assert.equal(out.clientSecret, "pi_t1_secret");
  assert.equal(out.session.status, "accepted");
  assert.equal(out.session.payment_status, "requires_payment");
  assert.equal(out.session.payment_intent_id, "pi_t1");
  assert.equal(calls[0]?.payable.kind, "tutoring_session");
  assert.equal(log.some((l) => l.startsWith("record")), false);

  // A retry with the same intent doesn't write again.
  const before = log.length;
  await beginSessionPayment(out.session, { idempotencyKey: "k", feeBps: 500 }, deps);
  assert.equal(log.length, before);

  const paid = await markSessionPaid(out.session, "pi_t1", deps);
  assert.equal(paid.status, "paid");
  const again = await markSessionPaid(paid, "pi_t1", deps);
  assert.equal(again, paid);
  assert.equal(log.filter((l) => l.startsWith("record:hold")).length, 1);
});

test("virtual sessions don't get a handoff", async () => {
  recordingProvider(true);
  const { deps, log } = fakes();
  const out = await beginSessionPayment({ ...base, location_kind: "virtual", safe_zone_id: null }, { idempotencyKey: "k", feeBps: 0 }, deps);
  assert.equal(out.session.status, "paid");
  assert.equal(out.session.tutor_payout_cents, 3000);
  assert.equal(log.includes("openHandoff"), false);
});

test("pay is rejected unless the session is accepted, unpaid and not free", async () => {
  recordingProvider(true);
  const { deps } = fakes();
  const opts = { idempotencyKey: "k", feeBps: 500 };
  await assert.rejects(beginSessionPayment({ ...base, status: "requested", waiting_on: "tutor" }, opts, deps), /requested session/);
  await assert.rejects(beginSessionPayment({ ...base, status: "paid", payment_status: "succeeded" }, opts, deps), /already paid/);
  await assert.rejects(beginSessionPayment({ ...base, status: "cancelled" }, opts, deps), /cancelled session/);
  await assert.rejects(beginSessionPayment({ ...base, price_cents: 0 }, opts, deps), /free/);
});

const paidSession = {
  ...base, status: "paid", payment_status: "succeeded", payout_status: "held", payment_intent_id: "pi_t1",
  fee_cents: 150, tutor_payout_cents: 2850, handoff_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
} as EscrowSession;

test("completing a paid session transfers the tutor's share", async () => {
  const calls = recordingProvider(false);
  const { deps, log } = fakes({ payoutsEnabled: true });
  const done = await settleSession(paidSession, "completed", { reason: "handoff_confirmed" }, deps);
  assert.equal(done.status, "completed");
  assert.equal(done.payout_status, "released");
  assert.ok(done.released_at);
  assert.deepEqual(calls.map((c) => [c.fn, c.amount]), [["release", 2850]]);
  assert.ok(log.includes("record:release:2850:tr_t1:handoff_confirmed"));
});

test("a tutor without payouts waits in awaiting_onboarding, then onboarding releases it once", async () => {
  const calls = recordingProvider(false);
  const { deps, log } = fakes({ payoutsEnabled: false });
  const done = await settleSession(paidSession, "completed", { reason: "student_completed" }, deps);
  assert.equal(done.payout_status, "awaiting_onboarding");
  assert.equal(calls.length, 0);
  const released = await releaseAwaitingSessionPayout(done, deps);
  assert.equal(released.payout_status, "released");
  assert.deepEqual(calls.map((c) => [c.fn, c.amount]), [["release", 2850]]);
  assert.ok(log.includes("record:release:2850:tr_t1:tutor_onboarded"));
  assert.equal(await releaseAwaitingSessionPayout(released, deps), released);
});

test("cancel or no-show of a paid session refunds the student in full and cancels the handoff", async () => {
  for (const outcome of ["cancelled", "no_show"] as const) {
    const calls = recordingProvider(false);
    const { deps, log } = fakes();
    const out = await settleSession(paidSession, outcome, { reason: "r", patch: { cancel_reason: "sick" } }, deps);
    assert.equal(out.status, outcome);
    assert.equal(out.payment_status, "refunded");
    assert.equal(out.payout_status, "reversed");
    assert.deepEqual(calls.map((c) => [c.fn, c.amount]), [["refund", 3000]]);
    assert.ok(log.includes("record:refund:3000:re_t1:r"));
    assert.ok(log.includes("cancelHandoff:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
  }
});

test("cancelling before the payment went through abandons the intent and moves no money", async () => {
  const calls = recordingProvider(false);
  const { deps, log } = fakes();
  const out = await settleSession({ ...base, payment_intent_id: "pi_t1", payment_status: "requires_payment" }, "cancelled", { reason: "r" }, deps);
  assert.equal(out.status, "cancelled");
  assert.deepEqual(calls.map((c) => c.fn), ["cancel"]);
  assert.equal(log.some((l) => l.startsWith("record")), false);
  const free = recordingProvider(false);
  await settleSession(base, "completed", { reason: "r" }, deps);
  assert.equal(free.length, 0);
});

// ---- route: POST /tutoring/sessions/{id}/pay -----------------------------------------------

const verifyAs = (sub: string) => async () => ({ sub, email: null, schoolId: school });
const store: IdempotencyStore = { begin: async () => null, complete: async () => {}, abandon: async () => {} };
const payPath = `/api/v1/tutoring/sessions/${sessionId}/pay`;

test("pay needs a token and an Idempotency-Key", async () => {
  assert.equal((await createApp({ verify: async () => null, log: false }).request(payPath, { method: "POST" })).status, 401);
  const app = createApp({ verify: verifyAs(student), idempotency: store, log: false, tutoringPayments: { loadSession: async () => base } });
  const res = await app.request(payPath, { method: "POST", headers: { Authorization: "Bearer t" } });
  assert.equal(res.status, 400);
});

test("only the student pays, and only an accepted session", async () => {
  const headers = { Authorization: "Bearer t", "Idempotency-Key": "k1" };
  const asTutor = createApp({ verify: verifyAs(tutor), idempotency: store, log: false, tutoringPayments: { loadSession: async () => base } });
  const forbidden = await asTutor.request(payPath, { method: "POST", headers });
  assert.equal(forbidden.status, 403);
  const requested = { ...base, status: "requested", waiting_on: "tutor" } as EscrowSession;
  const asStudent = createApp({ verify: verifyAs(student), idempotency: store, log: false, tutoringPayments: { loadSession: async () => requested } });
  const conflict = await asStudent.request(payPath, { method: "POST", headers });
  assert.equal(conflict.status, 409);
  assert.equal(((await conflict.json()) as { error: { code: string } }).error.code, "INVALID_STATE");
});
