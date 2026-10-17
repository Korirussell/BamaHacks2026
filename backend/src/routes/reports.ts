import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { Uuid } from "../schemas/common.js";

// POST /reports (module 13): flag a user, listing or offer for the team. One report per target per day.

export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const ReportReq = z.object({
  target: z.object({ type: z.enum(["user", "listing", "offer"]), id: Uuid }),
  reason: z.enum(["scam", "unsafe", "spam", "other"]),
  details: z.string().trim().max(2000),
});
type Target = z.output<typeof ReportReq>["target"];

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

/** True when the reporter can see the target: same school, and for offers one of its parties. */
async function targetExists(target: Target, reporterId: string, schoolId: string) {
  const db = adminClient();
  if (target.type === "user") return !!check(await db.from("profiles").select("id").eq("id", target.id).eq("school_id", schoolId).maybeSingle());
  if (target.type === "listing") return !!check(await db.from("listings").select("id").eq("id", target.id).eq("school_id", schoolId).maybeSingle());
  const offer = check(await db.from("offers").select("buyer_id, seller_id").eq("id", target.id).eq("school_id", schoolId).maybeSingle());
  const parties = offer ? z.object({ buyer_id: z.guid(), seller_id: z.guid().nullable() }).parse(offer) : null;
  return !!parties && (parties.buyer_id === reporterId || parties.seller_id === reporterId);
}

export const reportsRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .use("/reports", requireUser(verify))

  .post("/reports", async (c) => {
    const body = await parseBody(c, ReportReq);
    const { id: reporterId, schoolId } = c.var.user;
    if (body.target.type === "user" && body.target.id === reporterId) {
      throw new ApiError(400, "VALIDATION", "Invalid request", { "target.id": "You can't report yourself" });
    }
    if (!(await targetExists(body.target, reporterId, schoolId))) throw new ApiError(404, "NOT_FOUND", "Report target not found");

    const db = adminClient();
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
    const recent = check(await db.from("reports").select("id").eq("reporter_id", reporterId)
      .eq("target_type", body.target.type).eq("target_id", body.target.id).gte("created_at", since).limit(1));
    if ((recent as unknown[]).length) throw new ApiError(409, "RATE_LIMITED", "You already reported this in the last 24 hours");

    const report = z.object({ id: z.guid() }).parse(check(await db.from("reports").insert({
      school_id: schoolId, reporter_id: reporterId, target_type: body.target.type, target_id: body.target.id,
      reason: body.reason, details: body.details,
    }).select("id").single()));

    const admins = z.array(z.object({ id: z.guid() })).parse(check(
      await db.from("profiles").select("id").eq("school_id", schoolId).eq("is_admin", true).neq("id", reporterId),
    ));
    await Promise.all(admins.map((a) => notify({
      schoolId, userId: a.id, type: "report.created",
      title: `New report: ${body.reason}`, body: `A ${body.target.type} was reported${body.details ? `: ${body.details.slice(0, 120)}` : "."}`,
      deepLink: `/admin/reports/${report.id}`, data: { report_id: report.id, target: body.target },
    })));
    return c.body(null, 204);
  });
