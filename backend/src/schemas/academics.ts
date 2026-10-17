import { z } from "zod";
import { Place, Timestamp, Uuid } from "./common.js";

// Shared objects from docs/API_CONTRACT.md used by Academics (module 8) and Schedule (module 9).
export const ClassStatus = z.enum(["current", "past", "planned"]);
export const Day = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM (24h)");

export const Course = z.object({
  id: Uuid,
  code: z.string(),
  title: z.string(),
  department: z.string(),
});

export const ClassRecord = z.object({
  id: Uuid,
  course: Course,
  term: z.string(),
  status: ClassStatus,
  grade: z.string().nullable(),
  grade_source: z.enum(["transcript", "self_reported"]),
  grade_verified: z.boolean(),
});

export const ClassMeeting = z
  .object({
    course_id: Uuid,
    days: z.array(Day).min(1),
    start: HHMM,
    end: HHMM,
    place: Place.nullable().optional(),
  })
  .refine((m) => m.start < m.end, { message: "end must be after start", path: ["end"] });

export const TimeBlock = z.object({
  start: Timestamp,
  end: Timestamp,
  kind: z.enum(["free", "busy", "class"]),
});

export type ClassStatus = z.infer<typeof ClassStatus>;
export type Day = z.infer<typeof Day>;
export type Course = z.infer<typeof Course>;
export type ClassRecord = z.infer<typeof ClassRecord>;
export type ClassMeeting = z.infer<typeof ClassMeeting>;
export type TimeBlock = z.infer<typeof TimeBlock>;
