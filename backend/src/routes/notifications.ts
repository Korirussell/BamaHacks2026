import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { page } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";

const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
const NotificationRow = z.object({
  id: z.guid(), type: z.string(), title: z.string(), body: z.string(), deep_link: z.string(), data: z.record(z.string(), z.unknown()),
  read_at: z.string().nullable(), created_at: z.string(),
});
const ReadReq = z.object({ ids: z.array(z.guid()).max(200).default([]), all: z.boolean().optional() });

export const notificationsRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .use("/me/notifications/*", requireUser(verify))

  .get("/me/notifications", async (c) => {
    const { data, error } = await adminClient().from("notifications").select("id, type, title, body, deep_link, data, read_at, created_at")
      .eq("user_id", c.var.user.id).order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return c.json(page(z.array(NotificationRow).parse(data).map((n) => ({ ...n, read_at: iso(n.read_at), created_at: new Date(n.created_at).toISOString() }))));
  })

  .post("/me/notifications/read", async (c) => {
    const body = await parseBody(c, ReadReq);
    if (!body.all && !body.ids.length) throw new ApiError(400, "VALIDATION", "Invalid request", { ids: "Pass ids or all: true" });
    let q = adminClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", c.var.user.id).is("read_at", null);
    if (!body.all) q = q.in("id", body.ids);
    const { error } = await q;
    if (error) throw error;
    return c.body(null, 204);
  });
