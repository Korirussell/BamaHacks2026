import { Hono } from "hono";
import { z } from "zod";
import { adminClient } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";

// POST /me/push-subscriptions (module 12): stores where to push. Delivery (Web Push / APNs) plugs into lib/notify.ts.

const WebSubscription = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2000),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});
const DeviceSubscription = z.object({ token: z.string().trim().min(8).max(500) });

export const PushSubscriptionReq = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("web"), subscription: WebSubscription }),
  z.object({ platform: z.enum(["ios", "android"]), subscription: DeviceSubscription }),
]);

/** The unique key a subscription is upserted on: the Web Push endpoint, or the device token. */
export const subscriptionKey = (req: z.output<typeof PushSubscriptionReq>) =>
  req.platform === "web" ? req.subscription.endpoint : `${req.platform}:${req.subscription.token}`;

export const pushRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .use("/me/push-subscriptions", requireUser(verify))

  .post("/me/push-subscriptions", async (c) => {
    const body = await parseBody(c, PushSubscriptionReq);
    const { id, schoolId } = c.var.user;
    const saved = await adminClient().from("push_subscriptions").upsert({
      school_id: schoolId, user_id: id, platform: body.platform, endpoint: subscriptionKey(body), subscription: body.subscription,
    }, { onConflict: "endpoint" });
    if (saved.error) throw saved.error;
    return c.body(null, 204);
  });
