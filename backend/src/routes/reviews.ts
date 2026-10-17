import { Hono } from "hono";
import { z } from "zod";
import { loadUsersPublic, type UserPublicOut } from "../db/users.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { CreateReviewReq, Review } from "../schemas/reviews.js";

const SessionForReview = z.object({ id: z.guid(), tutor_id: z.guid(), student_id: z.guid(), status: z.string() });
export const REVIEW_SELECT = "id, from_id, to_id, context_type, context_id, stars, on_time, as_described, comment, created_at";
export const ReviewRow = z.object({
  id: z.guid(), from_id: z.guid(), to_id: z.guid(), context_type: z.literal("tutoring_session"), context_id: z.guid(),
  stars: z.number().int(), on_time: z.boolean(), as_described: z.boolean(), comment: z.string().nullable(), created_at: z.string(),
});

/** Review per the contract; `from` must be the author's UserPublic. */
export function toReview(row: z.infer<typeof ReviewRow>, from: UserPublicOut): Review {
  return Review.parse({
    id: row.id, from, to_user_id: row.to_id, context: { type: row.context_type, id: row.context_id }, stars: row.stars,
    on_time: row.on_time, as_described: row.as_described, comment: row.comment, created_at: new Date(row.created_at).toISOString(),
  });
}

export const reviewsRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .use("/reviews/*", requireUser(verify))
  .post("/reviews", async (c) => {
    const input = await parseBody(c, CreateReviewReq);
    if (input.context.type !== "tutoring_session") {
      throw new ApiError(400, "VALIDATION", "Invalid request", { "context.type": "Only completed tutoring sessions can be reviewed" });
    }
    const { id: fromId, schoolId } = c.var.user;
    const db = adminClient();
    const sessionResult = await db.from("tutoring_sessions").select("id, tutor_id, student_id, status")
      .eq("id", input.context.id).eq("school_id", schoolId).maybeSingle();
    if (sessionResult.error) throw sessionResult.error;
    const session = sessionResult.data ? SessionForReview.parse(sessionResult.data) : null;
    if (!session || (session.tutor_id !== fromId && session.student_id !== fromId)) {
      throw new ApiError(404, "NOT_FOUND", "Tutoring session not found");
    }
    if (session.status !== "completed") {
      throw new ApiError(400, "VALIDATION", "Invalid request", { "context.id": "Reviews unlock after the session is completed" });
    }
    const existing = await db.from("reviews").select("id").eq("from_id", fromId).eq("context_type", "tutoring_session").eq("context_id", session.id).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) throw new ApiError(409, "INVALID_STATE", "You already reviewed this session");

    const toId = session.tutor_id === fromId ? session.student_id : session.tutor_id;
    const inserted = await db.from("reviews").insert({
      school_id: schoolId, from_id: fromId, to_id: toId, context_type: "tutoring_session", context_id: session.id,
      stars: input.stars, on_time: input.on_time, as_described: input.as_described, comment: input.comment ?? null,
    }).select(REVIEW_SELECT).single();
    // The unique (from_id, context_type, context_id) index catches a double-submit that slips past the check above.
    if (inserted.error?.code === "23505") throw new ApiError(409, "INVALID_STATE", "You already reviewed this session");
    if (inserted.error) throw inserted.error;
    const row = ReviewRow.parse(inserted.data);
    const users = await loadUsersPublic([fromId, toId], schoolId);
    const from = users.get(fromId);
    if (!from) throw new Error("Review author is missing");
    const review = toReview(row, from);
    await notify({
      schoolId, userId: toId, type: "review.created", title: "New tutoring review",
      body: `${from.display_name} left you a ${row.stars}-star review`, deepLink: `/users/${toId}/reviews`, data: { review_id: row.id },
    });
    return c.json(one(review), 201);
  });
