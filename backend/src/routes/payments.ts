import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { stripeClient } from "../lib/stripe.js";
import { one } from "../lib/respond.js";
import { parseQuery } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import {
  accountStatus, defaultConnectDeps, ensureConnectAccount, NOT_ONBOARDED, onboardingLink, connectUrlsFromEnv,
  type ConnectDeps, type ConnectStripe, type ConnectUrls,
} from "../services/stripe-connect.js";

/** The shared lazy client (503 when STRIPE_SECRET_KEY is missing); it's the real SDK, so it has accounts and accountLinks. */
const defaultStripe = (): ConnectStripe => stripeClient() as unknown as ConnectStripe;

const OnboardQuery = z.object({ client: z.enum(["web", "ios"]).default("web") });

export const paymentsRoutes = (
  verify: TokenVerifier,
  stripeFactory: () => ConnectStripe = defaultStripe,
  deps: ConnectDeps = defaultConnectDeps(),
  urls: () => ConnectUrls = connectUrlsFromEnv,
) =>
  new Hono<AuthEnv>()
    .use("/payments/*", requireUser(verify))
    // ?client=ios (optional) makes Stripe return to the app's URL scheme instead of the website.
    .post("/payments/onboard", async (c) => {
      const { client } = parseQuery(c, OnboardQuery);
      const stripe = stripeFactory();
      const accountId = await ensureConnectAccount(stripe, c.var.user, deps);
      return c.json(one({ onboarding_url: await onboardingLink(stripe, accountId, client, urls()) }));
    })
    .get("/payments/status", async (c) => {
      const profile = await deps.store.profile(c.var.user.id);
      if (!profile) throw new ApiError(404, "NOT_FOUND", "Profile not set up yet");
      if (!profile.stripe_account_id) return c.json(one({ ...NOT_ONBOARDED, requirements_due: [...NOT_ONBOARDED.requirements_due] }));
      return c.json(one(await accountStatus(stripeFactory(), profile.stripe_account_id, deps)));
    });
