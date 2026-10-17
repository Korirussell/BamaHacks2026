import { Hono } from "hono";
import { z } from "zod";
import { demoSession } from "../lib/demo-auth.js";
import { one } from "../lib/respond.js";
import { parseBody } from "../lib/validate.js";

// DEMO_AUTH=on only (app.ts mounts it at /demo): sign in as any existing account by email, no code.
const LoginReq = z.object({ email: z.email().transform((e) => e.toLowerCase()) });

export const demoRoutes = () => new Hono()
  .post("/login", async (c) => {
    const { email } = await parseBody(c, LoginReq);
    return c.json(one(await demoSession(email)));
  });
