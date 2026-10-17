import { z } from "zod";
import { CourseRow, toCourse } from "./academics.js";
import type { UserPublicOut } from "./users.js";

export const EventKind = z.enum(["exam", "assignment", "project", "quiz"]);

const ParsedEvent = z.object({
  kind: EventKind,
  title: z.string(),
  date: z.string(),
  time: z.string().nullable(),
  due_at: z.string(),
  source_line: z.string(),
});
export const ParsedSyllabusJson = z.object({ events: z.array(ParsedEvent) });

export const SyllabusRow = z.object({
  id: z.guid(),
  school_id: z.guid(),
  user_id: z.guid(),
  course_id: z.guid(),
  term: z.string(),
  media_id: z.guid(),
  job_id: z.guid().nullable(),
  status: z.enum(["parsing", "needs_review", "confirmed", "failed"]),
  parsed: ParsedSyllabusJson.nullable(),
  error: z.string().nullable(),
});
export type SyllabusRow = z.infer<typeof SyllabusRow>;

export const CourseEventRow = z.object({
  id: z.guid(),
  school_id: z.guid(),
  course_id: z.guid(),
  term: z.string(),
  kind: EventKind,
  title: z.string(),
  due_at: z.string(),
  source: z.enum(["syllabus", "manual"]),
});
export type CourseEventRow = z.infer<typeof CourseEventRow>;

export const toCourseEvent = (row: CourseEventRow, confirmations: number) => ({
  id: row.id,
  course_id: row.course_id,
  kind: row.kind,
  title: row.title,
  due_at: new Date(row.due_at).toISOString(),
  source: row.source,
  confirmations,
});
export type CourseEventOut = ReturnType<typeof toCourseEvent>;

export const MemberRow = z.object({ user_id: z.guid(), school_id: z.guid(), joined_at: z.string() });

export const STUDY_GROUP_SELECT = "*, course:courses(*), target_event:course_events(*), members:study_group_members(user_id, school_id, joined_at)";

export const StudyGroupRow = z.object({
  id: z.guid(),
  school_id: z.guid(),
  course_id: z.guid(),
  host_id: z.guid(),
  title: z.string(),
  target_event_id: z.guid().nullable(),
  mode: z.enum(["in_person", "virtual"]),
  place_label: z.string().nullable(),
  place_lat: z.number().nullable(),
  place_lng: z.number().nullable(),
  meeting_url: z.string().nullable(),
  start_at: z.string(),
  end_at: z.string(),
  capacity: z.number().int(),
  cross_campus: z.boolean(),
  course: CourseRow,
  target_event: CourseEventRow.nullable(),
  members: z.array(MemberRow),
});
export type StudyGroupRow = z.infer<typeof StudyGroupRow>;

/** StudyGroup per the contract; members in join order, host first. Null when the host's profile is gone. */
export function toStudyGroup(row: StudyGroupRow, users: Map<string, UserPublicOut>, confirmations: Map<string, number>) {
  const host = users.get(row.host_id);
  if (!host) return null;
  const members = [...row.members]
    .sort((a, b) => Number(b.user_id === row.host_id) - Number(a.user_id === row.host_id) || a.joined_at.localeCompare(b.joined_at))
    .flatMap((m) => users.get(m.user_id) ?? []);
  return {
    id: row.id,
    course: toCourse(row.course),
    title: row.title,
    host,
    target_event: row.target_event ? toCourseEvent(row.target_event, confirmations.get(row.target_event.id) ?? 0) : null,
    mode: row.mode,
    place: row.place_label !== null && row.place_lat !== null && row.place_lng !== null ? { label: row.place_label, location: { lat: row.place_lat, lng: row.place_lng } } : null,
    meeting_url: row.meeting_url,
    start: new Date(row.start_at).toISOString(),
    end: new Date(row.end_at).toISOString(),
    capacity: row.capacity,
    members,
    cross_campus: row.cross_campus,
  };
}
export type StudyGroupOut = NonNullable<ReturnType<typeof toStudyGroup>>;
