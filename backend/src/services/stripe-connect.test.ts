import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type Stripe from "stripe";
import { ApiError, errorResponse } from "../lib/errors.js";
import { createApp } from "../app.js";
import type { OrderRow } from "../db/market.js";
import type { TokenVerifier } from "../middleware/auth.js";
import { paymentsRoutes } from "../routes/payments.js";
import {
  accountStatus, applyConnectAccount, ensureConnectAccount, onboardingLink,
  type ConnectDeps, type ConnectProfile, type ConnectStripe, type ConnectStore,
} from "./stripe-connect.js";

process.env["SUPABASE_URL"] ??= "https://example.supabase.co";

const school = "33333333-3333-4333-8333-333333333333";
const uid = "22222222-2222-4222-8222-222222222222";

function fakes(initial?: Partial<ConnectProfile>, orders: Array<Partial<OrderRow>> = []) {
  const p: ConnectProfile = {
    id: uid, school_id: school, email: "a@ua.edu", stripe_account_id: null, stripe_status: "none", payouts_enabled: false, ...initial,
  };
  const pending = new Map(orders.map((o) => [o.id as string, o as OrderRow]));
  const log = { created: [] as Array<{ params: Stripe.AccountCreateParams; key: string | undefined }>, links: [] as Stripe.AccountLinkCreateParams[], released: [] as string[], notes: [] as string[] };
  let account: Partial<Stripe.Account> = { id: "acct_1" };
  const stripe: ConnectStripe = {
    accounts: {
      create: async (params, o) => { log.created.push({ params, key: o?.idempotencyKey }); return { id: "acct_1" } as Stripe.Account; },
      retrieve: async () => account as Stripe.Account,
    },
    accountLinks: { create: async (params) => { log.links.push(params); return { url: "https://connect.stripe.test/x" }; } },
  };
  const store: ConnectStore = {
    profile: async () => ({ ...p }),
    profileByAccount: async (id) => (p.stripe_account_id === id ? { ...p } : null),
    claimAccount: async (_u, id) => { if (p.stripe_account_id) return false; p.stripe_account_id = id; p.stripe_status = "pending"; return true; },
    update: async (_u, patch) => { Object.assign(p, patch); },
    awaitingPayoutOrders: async () => [...pending.values()],
  };
  const deps: ConnectDeps = {
    store,
    release: async (o) => { log.released.push(o.id); pending.delete(o.id); },
    notify: async (n) => { log.notes.push(n.body); },
  };
  return { p, stripe, deps, log, setAccount: (a: Partial<Stripe.Account>) => { account = { id: "acct_1", ...a }; } };
}

const urls = { webOrigin: "https://app.test", appUrlScheme: "campus" };

test("account is created once with an idempotency key, then reused", async () => {
  const f = fakes();
  assert.equal(await ensureConnectAccount(f.stripe, { id: uid }, f.deps), "acct_1");
  assert.equal(await ensureConnectAccount(f.stripe, { id: uid }, f.deps), "acct_1");
  assert.equal(f.log.created.length, 1);
  assert.equal(f.log.created[0]?.key, `acct:${uid}`);
  assert.equal(f.log.created[0]?.params.type, "express");
  assert.deepEqual(f.log.created[0]?.params.metadata, { user_id: uid, school_id: school });
  assert.equal(f.p.stripe_status, "pending");
  const existing = fakes({ stripe_account_id: "acct_9", stripe_status: "pending" });
  assert.equal(await ensureConnectAccount(existing.stripe, { id: uid }, existing.deps), "acct_9");
  assert.equal(existing.log.created.length, 0);
});

test("a lost race re-reads the winner's account id", async () => {
  const f = fakes();
  f.deps.store.claimAccount = async () => { f.p.stripe_account_id = "acct_winner"; return false; };
  assert.equal(await ensureConnectAccount(f.stripe, { id: uid }, f.deps), "acct_winner");
});

test("onboarding link urls: web by default, app scheme for ios", async () => {
  const f = fakes();
  await onboardingLink(f.stripe, "acct_1", "web", urls);
  await onboardingLink(f.stripe, "acct_1", "ios", urls);
  await onboardingLink(f.stripe, "acct_1", "ios", { webOrigin: "https://app.test/" });
  assert.deepEqual(f.log.links[0], { account: "acct_1", type: "account_onboarding", refresh_url: "https://app.test/settings/payments?stripe=refresh", return_url: "https://app.test/settings/payments?stripe=return" });
  assert.equal(f.log.links[1]?.return_url, "campus://payments?stripe=return");
  assert.equal(f.log.links[1]?.refresh_url, "campus://payments?stripe=refresh");
  assert.equal(f.log.links[2]?.return_url, "https://app.test/settings/payments?stripe=return");
});

const order = { id: "o1", seller_payout_cents: 4750 };

test("sync flips status and releases awaiting orders exactly once", async () => {
  const f = fakes({ stripe_account_id: "acct_1", stripe_status: "pending" }, [order]);
  const partial = { id: "acct_1", payouts_enabled: false, details_submitted: true, capabilities: { transfers: "inactive" } } as Stripe.Account;
  assert.deepEqual(await applyConnectAccount(partial, f.deps), { stripe_status: "pending", payouts_enabled: false, released: 0 });
  assert.equal(f.log.released.length, 0);

  const on = { id: "acct_1", payouts_enabled: true, details_submitted: true, capabilities: { transfers: "active" } } as Stripe.Account;
  assert.equal((await applyConnectAccount(on, f.deps))?.released, 1);
  assert.equal(f.p.stripe_status, "ready");
  assert.equal(f.p.payouts_enabled, true);
  assert.deepEqual(f.log.notes, ["Payouts are on — $47.50 released"]);
  await applyConnectAccount(on, f.deps);
  assert.deepEqual(f.log.released, ["o1"]);
  assert.equal(f.log.notes.length, 1);
});

test("payouts need the transfers capability; unknown accounts are ignored; a failing release doesn't stop the rest", async () => {
  const f = fakes({ stripe_account_id: "acct_1" }, [order, { id: "o2", seller_payout_cents: 100 }]);
  const noTransfers = { id: "acct_1", payouts_enabled: true, details_submitted: true, capabilities: {} } as Stripe.Account;
  assert.equal((await applyConnectAccount(noTransfers, f.deps))?.payouts_enabled, false);
  assert.equal(await applyConnectAccount({ id: "acct_other" } as Stripe.Account, f.deps), null);

  const realRelease = f.deps.release;
  f.deps.release = async (o) => { if (o.id === "o1") throw new Error("boom"); return realRelease(o); };
  const on = { id: "acct_1", payouts_enabled: true, details_submitted: true, capabilities: { transfers: "active" } } as Stripe.Account;
  const res = await applyConnectAccount(on, f.deps);
  assert.equal(res?.released, 1);
  assert.deepEqual(f.log.released, ["o2"]);
});

test("status maps Stripe's account and refreshes the profile", async () => {
  const f = fakes({ stripe_account_id: "acct_1", stripe_status: "pending" });
  f.setAccount({ charges_enabled: true, payouts_enabled: true, details_submitted: true, capabilities: { transfers: "active" } as Stripe.Account.Capabilities, requirements: { currently_due: [] } as unknown as Stripe.Account.Requirements });
  assert.deepEqual(await accountStatus(f.stripe, "acct_1", f.deps), { charges_enabled: true, payouts_enabled: true, requirements_due: [] });
  assert.equal(f.p.stripe_status, "ready");
  f.setAccount({ charges_enabled: false, payouts_enabled: false, requirements: { currently_due: ["external_account"] } as unknown as Stripe.Account.Requirements });
  assert.deepEqual(await accountStatus(f.stripe, "acct_1", f.deps), { charges_enabled: false, payouts_enabled: false, requirements_due: ["external_account"] });
  assert.equal(f.p.stripe_status, "pending");
  assert.equal(f.p.payouts_enabled, false);
  f.setAccount({});
  assert.deepEqual((await accountStatus(f.stripe, "acct_1", f.deps)).requirements_due, []);
});

// ---- routes

const verify: TokenVerifier = async () => ({ sub: uid, email: null, schoolId: school });
const H = { Authorization: "Bearer t" };
const mount = (f: ReturnType<typeof fakes>, factory: () => ConnectStripe = () => f.stripe) => {
  const app = new Hono();
  app.route("/", paymentsRoutes(verify, factory, f.deps, () => urls));
  app.onError((err, c) => (err instanceof ApiError ? errorResponse(c, err) : c.json({ error: { code: "INTERNAL" } }, 500)));
  return app;
};

test("payments routes require a token", async () => {
  const app = createApp({ verify: async () => null, log: false });
  assert.equal((await app.request("/api/v1/payments/onboard", { method: "POST" })).status, 401);
  assert.equal((await app.request("/api/v1/payments/status")).status, 401);
});

test("POST /payments/onboard returns the hosted link; ?client=ios uses the app scheme", async () => {
  const f = fakes();
  const app = mount(f);
  const res = await app.request("/payments/onboard", { method: "POST", headers: H });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { data: { onboarding_url: "https://connect.stripe.test/x" } });
  await app.request("/payments/onboard?client=ios", { method: "POST", headers: H });
  assert.equal(f.log.links[1]?.return_url, "campus://payments?stripe=return");
  assert.equal(f.log.created.length, 1);
  assert.equal((await app.request("/payments/onboard?client=tv", { method: "POST", headers: H })).status, 400);
});

test("GET /payments/status answers locally with no account, even when Stripe isn't configured", async () => {
  const f = fakes();
  const boom = () => { throw new Error("must not be called"); };
  const res = await mount(f, boom).request("/payments/status", { headers: H });
  assert.deepEqual(await res.json(), { data: { charges_enabled: false, payouts_enabled: false, requirements_due: ["onboarding"] } });
});

test("with an account, status calls Stripe; unconfigured Stripe gives 503", async () => {
  const f = fakes({ stripe_account_id: "acct_1" });
  f.setAccount({ charges_enabled: true, payouts_enabled: false, requirements: { currently_due: ["individual.dob.day"] } as unknown as Stripe.Account.Requirements });
  const ok = await mount(f).request("/payments/status", { headers: H });
  assert.deepEqual(await ok.json(), { data: { charges_enabled: true, payouts_enabled: false, requirements_due: ["individual.dob.day"] } });

  const off = () => { throw new ApiError(503, "INTERNAL", "Card payments aren't configured"); };
  const res = await mount(f, off).request("/payments/status", { headers: H });
  assert.equal(res.status, 503);
});
