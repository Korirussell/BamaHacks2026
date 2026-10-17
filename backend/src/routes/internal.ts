import { Hono, type Context } from "hono";
import { safeEqual } from "../lib/crypto.js";
import { ApiError } from "../lib/errors.js";
import type { TickResult } from "../workers/order-timers.js";

// Server-to-server endpoints (not in the public contract). Mount at /internal.
// POST|GET /sweep runs one pass of the order timers (unpaid cancels, campus-mail auto-complete,
// offer expiry, overdue meetups). It's for hosts where nothing long-running lives (Vercel):
// Vercel Cron calls it with GET and "Authorization: Bearer $CRON_SECRET".

export interface InternalDeps {
  /** CRON_SECRET; null rejects every call. */
  cronSecret: string | null;
  sweep: () => Promise<TickResult>;
}

function checkBearer(c: Context, secret: string | null) {
  if (!secret) throw new ApiError(403, "FORBIDDEN", "Sweep is not configured");
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new ApiError(401, "UNAUTHENTICATED", "Missing bearer token");
  if (!safeEqual(token, secret)) throw new ApiError(401, "UNAUTHENTICATED", "Invalid bearer token");
}

export const internalRoutes = (deps: InternalDeps) => {
  const sweep = async (c: Context) => {
    checkBearer(c, deps.cronSecret);
    return c.json({ data: await deps.sweep() });
  };
  return new Hono().post("/sweep", sweep).get("/sweep", sweep);
};
