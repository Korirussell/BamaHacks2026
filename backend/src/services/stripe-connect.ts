import type Stripe from "stripe";
import { OrderRow } from "../db/market.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { adminClient } from "../lib/supabase.js";
import { releaseAwaitingPayout } from "./escrow.js";

// Stripe Connect Express onboarding for sellers. Everything Stripe-facing goes through the small
// ConnectStripe interface (the real client satisfies it) and every database touch through
// ConnectStore, so tests run with fakes and no network.

export interface ConnectStripe {
  accounts: {
    create(params: Stripe.AccountCreateParams, options?: { idempotencyKey?: string }): Promise<Stripe.Account>;
    retrieve(id: string): Promise<Stripe.Account>;
  };
  accountLinks: {
    create(params: Stripe.AccountLinkCreateParams): Promise<{ url: string }>;
  };
}

export type StripeStatus = "none" | "pending" | "ready";

export interface ConnectProfile {
  id: string;
  school_id: string;
  email: string;
  stripe_account_id: string | null;
  stripe_status: StripeStatus;
  payouts_enabled: boolean;
}

export interface ConnectStore {
  profile(userId: string): Promise<ConnectProfile | null>;
  profileByAccount(accountId: string): Promise<ConnectProfile | null>;
  /** Sets stripe_account_id only if it is still null; false when someone else got there first. */
  claimAccount(userId: string, accountId: string): Promise<boolean>;
  update(userId: string, patch: { stripe_status: StripeStatus; payouts_enabled: boolean }): Promise<void>;
  /** The seller's completed orders still waiting for them to be payable. */
  awaitingPayoutOrders(sellerId: string): Promise<OrderRow[]>;
}

export interface ConnectDeps {
  store: ConnectStore;
  release: (order: OrderRow) => Promise<unknown>;
  notify: typeof notify;
}

const COLUMNS = "id, school_id, email, stripe_account_id, stripe_status, payouts_enabled";

function ok<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw r.error;
  return r.data;
}

export const supabaseConnectStore: ConnectStore = {
  async profile(userId) {
    return ok(await adminClient().from("profiles").select(COLUMNS).eq("id", userId).maybeSingle()) as ConnectProfile | null;
  },
  async profileByAccount(accountId) {
    return ok(await adminClient().from("profiles").select(COLUMNS).eq("stripe_account_id", accountId).maybeSingle()) as ConnectProfile | null;
  },
  async claimAccount(userId, accountId) {
    const rows = ok(
      await adminClient().from("profiles")
        .update({ stripe_account_id: accountId, stripe_status: "pending" })
        .eq("id", userId).is("stripe_account_id", null).select("id"),
    );
    return (rows ?? []).length > 0;
  },
  async update(userId, patch) {
    ok(await adminClient().from("profiles").update(patch).eq("id", userId).select("id"));
  },
  async awaitingPayoutOrders(sellerId) {
    const rows = ok(
      await adminClient().from("orders").select("*")
        .eq("seller_id", sellerId).eq("status", "completed").eq("payout_status", "awaiting_onboarding"),
    );
    return (rows ?? []).map((r) => OrderRow.parse(r));
  },
};

export const defaultConnectDeps = (): ConnectDeps => ({ store: supabaseConnectStore, release: releaseAwaitingPayout, notify });

/** Returns the seller's Stripe account id, creating the Express account the first time. */
export async function ensureConnectAccount(
  stripe: ConnectStripe,
  user: { id: string },
  deps: ConnectDeps = defaultConnectDeps(),
): Promise<string> {
  const profile = await deps.store.profile(user.id);
  if (!profile) throw new ApiError(404, "NOT_FOUND", "Profile not set up yet");
  if (profile.stripe_account_id) return profile.stripe_account_id;

  // The idempotency key makes two concurrent calls get the same Stripe account back.
  const account = await stripe.accounts.create(
    {
      type: "express",
      country: "US",
      email: profile.email,
      capabilities: { transfers: { requested: true } },
      business_type: "individual",
      metadata: { user_id: profile.id, school_id: profile.school_id },
    },
    { idempotencyKey: `acct:${profile.id}` },
  );
  if (await deps.store.claimAccount(profile.id, account.id)) return account.id;
  const current = await deps.store.profile(user.id);
  if (!current?.stripe_account_id) throw new ApiError(409, "INVALID_STATE", "Couldn't save your payout account; try again");
  return current.stripe_account_id;
}

export interface ConnectUrls {
  webOrigin: string;
  appUrlScheme?: string | undefined;
}

export const connectUrlsFromEnv = (env: NodeJS.ProcessEnv = process.env): ConnectUrls => ({
  webOrigin: (env["WEB_ORIGIN"] ?? "http://localhost:3000").replace(/\/+$/, ""),
  appUrlScheme: env["APP_URL_SCHEME"] || undefined,
});

export type OnboardingClient = "web" | "ios";

/** Where Stripe sends the seller back to. iOS uses the app's URL scheme when one is configured. */
export function onboardingReturnUrls(client: OnboardingClient, urls: ConnectUrls): { refresh_url: string; return_url: string } {
  const at = (kind: "refresh" | "return") =>
    client === "ios" && urls.appUrlScheme
      ? `${urls.appUrlScheme.replace(/:\/*$/, "")}://payments?stripe=${kind}`
      : `${urls.webOrigin.replace(/\/+$/, "")}/settings/payments?stripe=${kind}`;
  return { refresh_url: at("refresh"), return_url: at("return") };
}

export async function onboardingLink(
  stripe: ConnectStripe,
  accountId: string,
  client: OnboardingClient = "web",
  urls: ConnectUrls = connectUrlsFromEnv(),
): Promise<string> {
  const link = await stripe.accountLinks.create({ account: accountId, type: "account_onboarding", ...onboardingReturnUrls(client, urls) });
  return link.url;
}

const centsToUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Applies a Stripe account's state to its seller's profile (account.updated webhook, or a status
 * check). When payouts turn on, releases the payouts that were waiting. Safe to run repeatedly.
 */
export async function applyConnectAccount(
  account: Stripe.Account,
  deps: ConnectDeps = defaultConnectDeps(),
): Promise<{ stripe_status: StripeStatus; payouts_enabled: boolean; released: number } | null> {
  const profile = await deps.store.profileByAccount(account.id);
  if (!profile) return null;

  const payoutsEnabled = account.payouts_enabled === true && account.capabilities?.transfers === "active";
  const status: StripeStatus = payoutsEnabled && account.details_submitted === true ? "ready" : "pending";
  const flipped = payoutsEnabled && !profile.payouts_enabled;
  if (status !== profile.stripe_status || payoutsEnabled !== profile.payouts_enabled) {
    await deps.store.update(profile.id, { stripe_status: status, payouts_enabled: payoutsEnabled });
  }

  let released = 0;
  let releasedCents = 0;
  if (payoutsEnabled) {
    // Runs on every sync while enabled, not only on the flip, so a release that failed once retries.
    for (const order of await deps.store.awaitingPayoutOrders(profile.id)) {
      try {
        await deps.release(order);
        released += 1;
        releasedCents += order.seller_payout_cents;
      } catch (err) {
        console.error("payout release failed", order.id, err instanceof Error ? err.message : err);
      }
    }
  }
  if (flipped || released > 0) {
    await deps.notify({
      schoolId: profile.school_id, userId: profile.id, type: "notification.created",
      title: "Payouts are on",
      body: released > 0 ? `Payouts are on — ${centsToUsd(releasedCents)} released` : "Payouts are on",
      deepLink: "/settings/payments",
      data: { released_cents: releasedCents },
    });
  }
  return { stripe_status: status, payouts_enabled: payoutsEnabled, released };
}

/** Webhook entry point (account.updated): same as applyConnectAccount without the result. */
export async function syncConnectAccount(account: Stripe.Account, deps: ConnectDeps = defaultConnectDeps()): Promise<void> {
  await applyConnectAccount(account, deps);
}

export interface AccountStatus {
  charges_enabled: boolean;
  payouts_enabled: boolean;
  requirements_due: string[];
}

export const NOT_ONBOARDED: AccountStatus = { charges_enabled: false, payouts_enabled: false, requirements_due: ["onboarding"] };

/** Live status from Stripe; also refreshes the profile so it's right even if a webhook was missed. */
export async function accountStatus(
  stripe: ConnectStripe,
  accountId: string,
  deps: ConnectDeps = defaultConnectDeps(),
): Promise<AccountStatus> {
  const account = await stripe.accounts.retrieve(accountId);
  await syncConnectAccount(account, deps);
  return {
    charges_enabled: account.charges_enabled === true,
    payouts_enabled: account.payouts_enabled === true,
    requirements_due: account.requirements?.currently_due ?? [],
  };
}
