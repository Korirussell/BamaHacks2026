import { z } from "zod";
import { LatLng, Uuid } from "./common.js";

// Schedule objects from docs/API_CONTRACT.md → Shared objects + schedule endpoints.
export const Weekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export const WallTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");
export const DateOnly = z.iso.date();
export const ScheduleSource = z.enum(["manual", "ics", "screenshot", "google"]);

export const Course = z.object({
  id: Uuid,
  code: z.string(),
  title: z.string(),
  department: z.string(),
});

export const Building = z.object({
  id: Uuid,
  school_id: Uuid,
  name: z.string(),
  code: z.string(),
  location: LatLng,
});

export const ClassMeeting = z.object({
  id: Uuid,
  course: Course,
  section: z.string().nullable(),
  days: z.array(Weekday).min(1),
  start: WallTime,
  end: WallTime,
  timezone: z.string(),
  term: z.string(),
  term_start: DateOnly,
  term_end: DateOnly,
  building: Building.nullable(),
  room: z.string().nullable(),
  source: ScheduleSource,
});

export const ClassMeetingInput = z.object({
  course_id: Uuid,
  section: z.string().nullish(),
  days: z.array(Weekday).min(1),
  start: WallTime,
  end: WallTime,
  timezone: z.string().optional(),
  term: z.string(),
  term_start: DateOnly,
  term_end: DateOnly,
  building_id: Uuid.nullish(),
  room: z.string().nullish(),
  source: ScheduleSource,
});

export const PutClassScheduleReq = z.object({ meetings: z.array(ClassMeetingInput) });

export const ImportClassScheduleReq = z.object({
  kind: z.enum(["ics", "screenshot"]),
  media_id: Uuid,
});

export const ScheduleImportResult = z.object({
  drafts: z.array(ClassMeetingInput),
  unmatched: z.array(
    z.object({
      raw_text: z.string(),
      reason: z.enum(["course_not_found", "building_not_found", "unreadable"]),
    }),
  ),
  confidence: z.number(),
});

export type Course = z.infer<typeof Course>;
export type Building = z.infer<typeof Building>;
export type ClassMeeting = z.infer<typeof ClassMeeting>;
export type ClassMeetingInput = z.infer<typeof ClassMeetingInput>;
export type ScheduleImportResult = z.infer<typeof ScheduleImportResult>;
