import { z } from "zod";
import { Timestamp, Uuid } from "./common.js";
import { UserPublic } from "./me.js";

const ReviewContext = z.object({ type: z.enum(["order", "tutoring_session", "ride"]), id: Uuid });

export const CreateReviewReq = z.object({
  context: ReviewContext,
  stars: z.number().int().min(1).max(5),
  on_time: z.boolean(),
  as_described: z.boolean(),
  comment: z.string().max(2_000).optional(),
});

export const Review = z.object({
  id: Uuid,
  from: UserPublic,
  to_user_id: Uuid,
  context: ReviewContext,
  stars: z.number().int().min(1).max(5),
  on_time: z.boolean(),
  as_described: z.boolean(),
  comment: z.string().nullable(),
  created_at: Timestamp,
});

export type CreateReviewReq = z.infer<typeof CreateReviewReq>;
export type Review = z.infer<typeof Review>;
