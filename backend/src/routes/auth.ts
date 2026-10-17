import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { one } from "../lib/respond.js";

const CheckEmailReq = z.object({ email: z.email() });

// POST /auth/check-email — UX-only pre-check; the Supabase auth hook enforces it for real.
export const auth = new Hono().post("/check-email", async (c) => {
  const parsed = CheckEmailReq.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION", "Invalid request body", { email: "Must be a valid email" });
  }
  const domain = parsed.data.email.split("@")[1]?.toLowerCase() ?? "";
  if (!domain.endsWith(".edu")) {
    return c.json(one({ allowed: false, school: null, reason: "NOT_EDU_EMAIL" }));
  }
  // TODO: look up schools by domain in Supabase.
  return c.json(one({ allowed: false, school: null, reason: "SCHOOL_NOT_SUPPORTED" }));
});
