import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import { heldCents } from "../db/market.js";
import type { TokenVerifier } from "../middleware/auth.js";
import type { IdempotencyStore } from "../middleware/idempotency.js";
import { DisputeReq, EscrowRes, ResolveReq } from "../schemas/orders.js";
import { disputeText } from "./orders.js";

process.env["SUPABASE_URL"] ??= "https://example.supabase.co";

const orderId = "11111111-1111-4111-8111-111111111111";
const school = "33333333-3333-4333-8333-333333333333";
const verify: TokenVerifier = async () => ({ sub: "22222222-2222-4222-8222-222222222222", email: null, schoolId: school });
const store: IdempotencyStore = { begin: async () => null, complete: async () => {}, abandon: async () => {} };
const app = createApp({ verify, idempotency: store, log: false });
const auth = { Authorization: "Bearer t", "Content-Type": "application/json" };

test("held_cents is holds minus releases and refunds, floored at zero", () => {
  assert.equal(heldCents([]), 0);
  assert.equal(heldCents([{ kind: "hold", amount_cents: 5000 }]), 5000);
  assert.equal(heldCents([{ kind: "hold", amount_cents: 5000 }, { kind: "release", amount_cents: 4750 }]), 250);
  assert.equal(heldCents([{ kind: "hold", amount_cents: 5000 }, { kind: "refund", amount_cents: 5000 }]), 0);
  assert.equal(heldCents([{ kind: "refund", amount_cents: 100 }]), 0);
});

test("dispute text joins reason and details and is capped at 1000 characters", () => {
  assert.equal(disputeText("no_show", "Waited 20 minutes"), "no_show: Waited 20 minutes");
  assert.equal(disputeText("other", "x".repeat(2000)).length, 1000);
});

test("dispute, resolve and escrow schemas", () => {
  assert.equal(DisputeReq.safeParse({ reason: "no_show", details: "gone", media_ids: [] }).success, true);
  assert.deepEqual(DisputeReq.parse({ reason: "other", details: "hi" }).media_ids, []);
  assert.equal(DisputeReq.safeParse({ reason: "bogus", details: "hi" }).success, false);
  assert.equal(DisputeReq.safeParse({ reason: "other", details: "  " }).success, false);
  assert.equal(DisputeReq.safeParse({ reason: "other", details: "hi", media_ids: ["nope"] }).success, false);
  assert.equal(ResolveReq.safeParse({ outcome: "refund", note: "seller no-show" }).success, true);
  assert.equal(ResolveReq.safeParse({ outcome: "split", note: "x" }).success, false);
  assert.equal(EscrowRes.safeParse({ entries: [{ kind: "hold", amount_cents: 100, provider: "demo", created_at: "2026-10-17T12:00:00.000Z", reason: null }], held_cents: 100 }).success, true);
});

test("new money routes require a token", async () => {
  for (const [method, path] of [
    ["POST", `/api/v1/orders/${orderId}/dispute`],
    ["GET", `/api/v1/orders/${orderId}/escrow`],
    ["POST", `/api/v1/admin/orders/${orderId}/resolve`],
  ] as const) {
    assert.equal((await createApp({ verify: async () => null, log: false }).request(path, { method })).status, 401, path);
  }
});

test("dispute needs an Idempotency-Key and a valid body before touching the database", async () => {
  const path = `/api/v1/orders/${orderId}/dispute`;
  const body = JSON.stringify({ reason: "no_show", details: "They never came" });
  const noKey = await app.request(path, { method: "POST", headers: auth, body });
  assert.equal(noKey.status, 400);
  const bad = await app.request(path, { method: "POST", headers: { ...auth, "Idempotency-Key": "k1" }, body: JSON.stringify({ reason: "nope", details: "x" }) });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { error: { code: string } }).error.code, "VALIDATION");
});

test("a malformed order id is a 404 on dispute and escrow", async () => {
  const res = await app.request("/api/v1/orders/not-a-uuid/escrow", { headers: auth });
  assert.equal(res.status, 404);
  const d = await app.request("/api/v1/orders/not-a-uuid/dispute", { method: "POST", headers: { ...auth, "Idempotency-Key": "k2" }, body: JSON.stringify({ reason: "other", details: "x" }) });
  assert.equal(d.status, 404);
});
