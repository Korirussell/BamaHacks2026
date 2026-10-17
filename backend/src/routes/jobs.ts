import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { Job } from "../schemas/jobs.js";

const JobRow = z.object({ id: z.uuid(), kind: Job.shape.kind, status: Job.shape.status, result: z.record(z.string(), z.unknown()).nullable(), error: z.string().nullable() });

/** Job per the API contract: `result` and `error` are omitted while null. */
export const toJob = (row: z.infer<typeof JobRow>) => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  ...(row.result ? { result: row.result } : {}),
  ...(row.error ? { error: row.error } : {}),
});

export const jobsRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .use("/jobs/*", requireUser(verify))
  .get("/jobs/:id", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) throw new ApiError(404, "NOT_FOUND", "Job not found");
    const result = await adminClient().from("jobs").select("id, kind, status, result, error").eq("id", id.data).eq("user_id", c.var.user.id).eq("school_id", c.var.user.schoolId).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new ApiError(404, "NOT_FOUND", "Job not found");
    return c.json(one(toJob(JobRow.parse(result.data))));
  });
