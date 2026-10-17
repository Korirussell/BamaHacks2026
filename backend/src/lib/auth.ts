import { createMiddleware } from "hono/factory";
import { verify } from "hono/jwt";
import { z } from "zod";
import { DEMO_SCHOOL_ID, DEMO_USER_ID } from "../db/seed.js";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

export type AuthUser = { id: string; schoolId: string };
export type AuthEnv = { Variables: { user: AuthUser } };

const Claims = z.object({
  sub: z.uuid(),
  // Set by the Supabase auth hook (contract → Sign-in).
  app_metadata: z.object({ school_id: z.uuid() }),
});

// Reads the Supabase access token. `school_id` comes from the token, never the client.
// Until Supabase is set up (no SUPABASE_JWT_SECRET), accepts `Bearer dev` or `Bearer dev:<user uuid>`.
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const token = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new ApiError(401, "UNAUTHENTICATED", "Missing bearer token");

  if (!config.supabaseJwtSecret) {
    const devId = token === "dev" ? DEMO_USER_ID : token.match(/^dev:(.+)$/)?.[1];
    if (!devId || !z.uuid().safeParse(devId).success) {
      throw new ApiError(401, "UNAUTHENTICATED", "Dev mode: use `Bearer dev` or `Bearer dev:<uuid>`");
    }
    c.set("user", { id: devId, schoolId: DEMO_SCHOOL_ID });
    return next();
  }

  const payload = await verify(token, config.supabaseJwtSecret, "HS256").catch(() => null);
  const claims = Claims.safeParse(payload);
  if (!claims.success) throw new ApiError(401, "UNAUTHENTICATED", "Invalid or expired token");
  c.set("user", { id: claims.data.sub, schoolId: claims.data.app_metadata.school_id });
  return next();
});
