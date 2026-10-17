import { z } from "zod";
import { adminClient } from "../lib/supabase.js";
import { ApiError } from "../lib/errors.js";
import { libcalSpaceId } from "../adapters/libcal.js";
import { TutorAvailability, TutoringSession, type RoomBooking } from "../schemas/tutoring.js";
import type { BusyInterval, MeetingInput } from "../services/availability.js";
import type { Eligibility, GradeRecord } from "../services/tutoring.js";
import { ClassMeetingRow, ClassRecordRow, CourseRow, toCourse, toMeetingInput } from "./academics.js";
import { SchoolRow } from "./rows.js";
import type { UserPublicOut } from "./users.js";

const Mode = z.enum(["in_person", "virtual"]);
const Side = z.enum(["tutor", "student"]);
const ts = z.string().transform((v) => new Date(v).toISOString());
const tsNull = z.string().nullable().transform((v) => (v ? new Date(v).toISOString() : null));
export const SessionPaymentStatus = z.enum(["none", "requires_payment", "succeeded", "failed", "refunded"]);
export const SessionPayoutStatus = z.enum(["held", "awaiting_onboarding", "released", "reversed"]);

export const TutorProfileRow = z.object({
  user_id: z.guid(), school_id: z.guid(), enabled: z.boolean(), hourly_rate_cents: z.number().int(),
  bio: z.string().nullable(), modes: z.array(Mode), open_to_requests: z.boolean(), availability: TutorAvailability,
});
export const TutorStatsRow = z.object({ user_id: z.guid(), rating: z.number(), review_count: z.number().int(), sessions_completed: z.number().int() });
export const HistoryEntry = z.object({ by: Side, action: z.enum(["propose", "counter", "accept", "decline"]), start: z.string(), end: z.string(), at: z.string() });
export const SessionRow = z.object({
  id: z.guid(), school_id: z.guid(), tutor_id: z.guid(), student_id: z.guid(), course_id: z.guid(),
  start_at: ts, end_at: ts, price_cents: z.number().int(),
  location_kind: z.enum(["library_room", "safe_zone", "virtual"]), location_name: z.string().nullable(), meeting_url: z.string().nullable(),
  room_booking_status: z.enum(["not_needed", "pending", "booked", "manual_required"]), room: z.string().nullable(), booking_url: z.string().nullable(),
  status: z.enum(["requested", "accepted", "paid", "completed", "cancelled", "no_show"]), waiting_on: Side.nullable(),
  history: z.array(HistoryEntry), notes: z.string().nullable(), handoff_id: z.guid().nullable(), cancel_reason: z.string().nullable(),
  safe_zone_id: z.guid().nullable(), payment_intent_id: z.string().nullable(),
  // 0019_tutoring_escrow; the defaults keep sessions readable on a database that doesn't have it yet.
  payment_status: SessionPaymentStatus.default("none"), payout_status: SessionPayoutStatus.nullable().default(null),
  fee_cents: z.number().int().nullable().default(null), tutor_payout_cents: z.number().int().nullable().default(null),
  paid_at: tsNull.default(null), released_at: tsNull.default(null),
  course: CourseRow,
});
export type TutorProfileRow = z.infer<typeof TutorProfileRow>;
export type TutorStatsRow = z.infer<typeof TutorStatsRow>;
export type SessionRow = z.infer<typeof SessionRow>;
export type HistoryEntry = z.infer<typeof HistoryEntry>;

export const SESSION_SELECT = "*, course:courses(*)";

export function toSession(row: SessionRow, users: Map<string, UserPublicOut>) {
  const tutor = users.get(row.tutor_id);
  const student = users.get(row.student_id);
  if (!tutor || !student) throw new Error(`Session ${row.id} references a missing profile`);
  return TutoringSession.parse({
    id: row.id, tutor, student, course: toCourse(row.course), start: row.start_at, end: row.end_at, price_cents: row.price_cents,
    location: { kind: row.location_kind, name: row.location_name, meeting_url: row.meeting_url },
    room_booking: toRoomBooking(row),
    status: row.status, waiting_on: row.waiting_on, history: row.history, handoff_id: row.handoff_id,
    payment: { status: row.payment_status, paid_at: row.paid_at },
    payout: { status: row.payout_status, released_at: row.released_at, tutor_payout_cents: row.tutor_payout_cents },
  });
}

/**
 * RoomBooking from the session's room columns. There's no room_id column: `room` holds the name and the id is
 * read back from the LibCal booking URL (/space/{eid}); rooms without one (demo booker) use the name as id.
 */
export function toRoomBooking(row: Pick<SessionRow, "room_booking_status" | "room" | "booking_url">): RoomBooking {
  return {
    status: row.room_booking_status,
    room: row.room ? { id: libcalSpaceId(row.booking_url) ?? row.room, name: row.room } : null,
    booking_url: row.booking_url,
  };
}

/** TutorProfile: the listed courses with the grade that earned each one. */
export function toTutorProfile(
  row: TutorProfileRow,
  courses: CourseRow[],
  eligibility: Map<string, Eligibility>,
  stats: TutorStatsRow | undefined,
) {
  return {
    user_id: row.user_id,
    enabled: row.enabled,
    courses: courses.map((c) => {
      const e = eligibility.get(c.id);
      return { course: toCourse(c), grade: e?.grade ?? "", verified: e?.verified ?? false };
    }),
    hourly_rate_cents: row.hourly_rate_cents,
    bio: row.bio,
    modes: row.modes,
    open_to_requests: row.open_to_requests,
    rating: stats?.rating ?? 0,
    sessions_completed: stats?.sessions_completed ?? 0,
  };
}

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

export async function loadSchool(schoolId: string) {
  const data = check(await adminClient().from("schools").select("*").eq("id", schoolId).maybeSingle());
  if (!data) throw new ApiError(404, "NOT_FOUND", "School not found");
  return SchoolRow.parse(data);
}

/** Every class record for these users, with its course, keyed by user. */
export async function loadClassRecords(userIds: string[], schoolId: string) {
  const out = new Map<string, z.infer<typeof ClassRecordRow>[]>();
  if (!userIds.length) return out;
  const data = check(await adminClient().from("class_records").select("*, course:courses(*)").eq("school_id", schoolId).in("user_id", userIds));
  for (const r of z.array(ClassRecordRow).parse(data)) out.set(r.user_id, [...(out.get(r.user_id) ?? []), r]);
  return out;
}

export const toGradeRecord = (r: z.infer<typeof ClassRecordRow>): GradeRecord => ({
  courseId: r.course_id, term: r.term, status: r.status, grade: r.grade, verified: r.grade_verified,
});

export async function loadTutorProfiles(userIds: string[]) {
  const empty = { profiles: new Map<string, TutorProfileRow>(), courses: new Map<string, CourseRow[]>(), stats: new Map<string, TutorStatsRow>() };
  if (!userIds.length) return empty;
  const db = adminClient();
  const [profiles, courses, stats] = await Promise.all([
    db.from("tutor_profiles").select("user_id, school_id, enabled, hourly_rate_cents, bio, modes, open_to_requests, availability").in("user_id", userIds),
    db.from("tutor_courses").select("user_id, course:courses(*)").in("user_id", userIds),
    db.from("tutor_stats").select("*").in("user_id", userIds),
  ]);
  for (const p of z.array(TutorProfileRow).parse(check(profiles))) empty.profiles.set(p.user_id, p);
  for (const tc of z.array(z.object({ user_id: z.guid(), course: CourseRow })).parse(check(courses))) {
    empty.courses.set(tc.user_id, [...(empty.courses.get(tc.user_id) ?? []), tc.course].sort((a, b) => a.code.localeCompare(b.code)));
  }
  for (const s of z.array(TutorStatsRow).parse(check(stats))) empty.stats.set(s.user_id, s);
  return empty;
}

/** Weekly class meetings for these users, keyed by user. */
export async function loadMeetingInputs(userIds: string[], schoolId: string) {
  const out = new Map<string, MeetingInput[]>();
  if (!userIds.length) return out;
  const data = check(await adminClient().from("class_meetings").select("*, course:courses(*), building:buildings(*)").eq("school_id", schoolId).in("user_id", userIds));
  for (const m of z.array(ClassMeetingRow).parse(data)) out.set(m.user_id, [...(out.get(m.user_id) ?? []), toMeetingInput(m)]);
  return out;
}

/** Open or booked tutoring sessions that already block these users' time inside [from, to). */
export async function loadSessionBusy(userIds: string[], from: number, to: number) {
  const out = new Map<string, BusyInterval[]>();
  if (!userIds.length) return out;
  const ids = userIds.join(",");
  const data = check(
    await adminClient()
      .from("tutoring_sessions")
      .select("tutor_id, student_id, start_at, end_at")
      .in("status", ["requested", "accepted", "paid"])
      .or(`tutor_id.in.(${ids}),student_id.in.(${ids})`)
      .lt("start_at", new Date(to).toISOString())
      .gt("end_at", new Date(from).toISOString()),
  );
  const rows = z.array(z.object({ tutor_id: z.guid(), student_id: z.guid(), start_at: z.string(), end_at: z.string() })).parse(data);
  const wanted = new Set(userIds);
  for (const s of rows) {
    const block: BusyInterval = { start: Date.parse(s.start_at), end: Date.parse(s.end_at), kind: "busy", label: "Tutoring session" };
    for (const id of [s.tutor_id, s.student_id]) if (wanted.has(id)) out.set(id, [...(out.get(id) ?? []), block]);
  }
  return out;
}

/** Where tutoring meets by default: the school's first library safe zone. */
export async function loadLibrary(schoolId: string) {
  const data = check(
    await adminClient().from("safe_zones").select("id, name, lat, lng").eq("school_id", schoolId).eq("kind", "library").order("name").limit(1).maybeSingle(),
  );
  return data ? z.object({ id: z.guid(), name: z.string(), lat: z.number(), lng: z.number() }).parse(data) : null;
}
