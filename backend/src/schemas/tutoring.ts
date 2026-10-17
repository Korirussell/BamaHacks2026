import { z } from "zod";
import { Cents, Timestamp, Uuid } from "./common.js";
import { UserPublic } from "./me.js";
import { Course, WallTime, Weekday } from "./schedule.js";

export const TimeBlock = z.object({ start: Timestamp, end: Timestamp, kind: z.enum(["free", "busy", "class"]) });
const TutorMode = z.enum(["in_person", "virtual"]);
export const TutorAvailability = z.object({
  recurring: z.array(z.object({ days: z.array(Weekday).min(1), start: WallTime, end: WallTime }).refine((window) => window.end > window.start, {
    path: ["end"], message: "Must be after start",
  })),
  one_off: z.array(TimeBlock.refine((block) => Date.parse(block.end) > Date.parse(block.start), {
    path: ["end"], message: "Must be after start",
  })),
});

export const TutorProfile = z.object({
  user_id: Uuid, enabled: z.boolean(), courses: z.array(z.object({ course: Course, grade: z.string(), verified: z.boolean() })), hourly_rate_cents: Cents,
  bio: z.string().nullable(), modes: z.array(TutorMode), open_to_requests: z.boolean(), rating: z.number(), sessions_completed: z.number().int(),
});
export const PutTutorProfileReq = z.object({ enabled: z.boolean(), course_ids: z.array(Uuid), hourly_rate_cents: Cents, bio: z.string().optional(), modes: z.array(TutorMode), open_to_requests: z.boolean() });
const QueryBoolean = z.enum(["true", "false"]).transform((value) => value === "true");
export const TutorsQuery = z
  .object({
    course_id: Uuid,
    from: Timestamp.default(() => new Date().toISOString()),
    to: Timestamp.optional(),
    duration_min: z.coerce.number().int().positive().default(60),
    max_rate_cents: z.coerce.number().int().nonnegative().optional(),
    include_unverified: QueryBoolean.default(false),
    sort: z.enum(["match", "rating", "price", "grade"]).default("match"),
  })
  .transform((query) => ({ ...query, to: query.to ?? new Date(Date.parse(query.from) + 7 * 86_400_000).toISOString() }));
export const TutorMatch = z.object({
  tutor: UserPublic, profile: TutorProfile, grade: z.string(), grade_verified: z.boolean(), term_taken: z.string(), rating: z.number(), review_count: z.number().int(), hourly_rate_cents: Cents,
  open_slots: z.array(TimeBlock), mutual_slots: z.array(TimeBlock), match: z.object({ score: z.number(), mutual_minutes: z.number().int(), reasons: z.array(z.string()) }),
});
export const TutoringSession = z.object({
  id: Uuid, tutor: UserPublic, student: UserPublic, course: Course, start: Timestamp, end: Timestamp, price_cents: Cents,
  location: z.object({ kind: z.enum(["library_room", "safe_zone", "virtual"]), name: z.string().nullable(), meeting_url: z.string().nullable() }),
  room_booking: z.object({ status: z.enum(["not_needed", "pending", "booked", "manual_required"]), room: z.string().nullable(), booking_url: z.string().nullable() }),
  status: z.enum(["requested", "accepted", "paid", "completed", "cancelled", "no_show"]), waiting_on: z.enum(["tutor", "student"]).nullable(),
  history: z.array(z.object({ by: z.enum(["tutor", "student"]), action: z.enum(["propose", "counter", "accept", "decline"]), start: Timestamp, end: Timestamp, at: Timestamp })), handoff_id: Uuid.nullable(),
});
export const CreateSessionReq = z.object({ tutor_id: Uuid, course_id: Uuid, start: Timestamp, end: Timestamp, location_pref: z.enum(["library_room", "safe_zone", "virtual"]), notes: z.string().optional() });
export const CounterSessionReq = z.object({ start: Timestamp, end: Timestamp, message: z.string().optional() });
export const TutorEligibilityItem = z.object({ course: Course, grade: z.string(), verified: z.boolean(), eligible: z.boolean(), reason: z.string().nullable() });

export type TutorProfile = z.infer<typeof TutorProfile>;
export type PutTutorProfileReq = z.infer<typeof PutTutorProfileReq>;
export type TutorsQuery = z.infer<typeof TutorsQuery>;
export type TutorMatch = z.infer<typeof TutorMatch>;
export type TutoringSession = z.infer<typeof TutoringSession>;
export type CreateSessionReq = z.infer<typeof CreateSessionReq>;
export type CounterSessionReq = z.infer<typeof CounterSessionReq>;
export type TutorEligibilityItem = z.infer<typeof TutorEligibilityItem>;
export type TimeBlock = z.infer<typeof TimeBlock>;
export type TutorAvailability = z.infer<typeof TutorAvailability>;
