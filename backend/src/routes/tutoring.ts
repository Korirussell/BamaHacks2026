import { Hono } from "hono";
import { z } from "zod";
import type { RoomBooker } from "../adapters/ports.js";
import { toCourse } from "../db/academics.js";
import {
  SESSION_SELECT, SessionRow, loadClassRecords, loadLibrary, loadMeetingInputs, loadSchool, loadSessionBusy,
  loadTutorProfiles, toGradeRecord, toSession, toTutorProfile, type HistoryEntry,
} from "../db/tutoring.js";
import { loadUsersPublic } from "../db/users.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { CounterSessionReq, CreateSessionReq, PutTutorProfileReq, TutorsQuery } from "../schemas/tutoring.js";
import { expandMeetings, freeBlocks, type BusyInterval } from "../services/availability.js";
import { freeBusy } from "../services/google.js";
import { DAY, MINUTE, iso } from "../services/time.js";
import {
  acceptSession, cancelSession, completeSession, counterSession, declineSession, findTutorMatches, priceFor,
  tutorEligibility, type Side, type SessionState, type TutorCandidate,
} from "../services/tutoring.js";

const MIN_SESSION_MIN = 15;
const MAX_SESSION_MIN = 240;
const MAX_SEARCH_DAYS = 14;

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

/** Eligibility for one user, by course id. */
async function eligibilityFor(userId: string, schoolId: string, minGrade: string) {
  const records = (await loadClassRecords([userId], schoolId)).get(userId) ?? [];
  return { records, eligibility: tutorEligibility(records.map(toGradeRecord), minGrade) };
}

async function myTutorProfile(userId: string, schoolId: string) {
  const school = await loadSchool(schoolId);
  const [{ eligibility }, tp] = await Promise.all([eligibilityFor(userId, schoolId, school.tutor_min_grade), loadTutorProfiles([userId])]);
  const row = tp.profiles.get(userId);
  return row ? toTutorProfile(row, tp.courses.get(userId) ?? [], eligibility, tp.stats.get(userId)) : null;
}

/** Each person's free time in [from, to): class schedule, Google Calendar busy time and sessions already on the books. */
async function freeTimeFor(userIds: string[], schoolId: string, tz: string, from: number, to: number) {
  const [meetings, sessions, calendars] = await Promise.all([
    loadMeetingInputs(userIds, schoolId),
    loadSessionBusy(userIds, from, to),
    Promise.all(userIds.map((id) => freeBusy(id, from, to))),
  ]);
  return new Map(userIds.map((id, i) => {
    const google: BusyInterval[] = (calendars[i] ?? []).map((b) => ({ ...b, kind: "busy" }));
    const busy: BusyInterval[] = [...expandMeetings(meetings.get(id) ?? [], from, to), ...(sessions.get(id) ?? []), ...google];
    return [id, freeBlocks(busy, from, to, tz)];
  }));
}

async function loadSessionRow(id: string, userId: string) {
  const data = check(await adminClient().from("tutoring_sessions").select(`${SESSION_SELECT}, updated_at`).eq("id", id).maybeSingle());
  const parsed = data ? SessionRow.extend({ updated_at: z.string() }).parse(data) : null;
  if (!parsed || (parsed.tutor_id !== userId && parsed.student_id !== userId)) throw new ApiError(404, "NOT_FOUND", "Session not found");
  return parsed;
}

async function sessionOut(row: SessionRow) {
  const users = await loadUsersPublic([row.tutor_id, row.student_id], row.school_id);
  return toSession(row, users);
}

const stateOf = (row: SessionRow, hourlyRateCents = 0): SessionState => ({
  status: row.status, waitingOn: row.waiting_on, start: row.start_at, end: row.end_at, hourlyRateCents,
});

const sideOf = (row: SessionRow, userId: string): Side => (row.tutor_id === userId ? "tutor" : "student");

function validateWindow(start: string, end: string, now: number) {
  const minutes = (Date.parse(end) - Date.parse(start)) / MINUTE;
  if (Date.parse(start) < now) throw new ApiError(400, "VALIDATION", "Invalid request", { start: "Must be in the future" });
  if (minutes < MIN_SESSION_MIN || minutes > MAX_SESSION_MIN) {
    throw new ApiError(400, "VALIDATION", "Invalid request", { end: `Sessions run ${MIN_SESSION_MIN}-${MAX_SESSION_MIN} minutes` });
  }
}

async function tutorBusyDuring(tutorId: string, start: string, end: string, ignoreId?: string) {
  let q = adminClient().from("tutoring_sessions").select("id").eq("tutor_id", tutorId).in("status", ["requested", "accepted", "paid"])
    .lt("start_at", end).gt("end_at", start);
  if (ignoreId) q = q.neq("id", ignoreId);
  return (check(await q) as unknown[]).length > 0;
}

/** Applies a state change with an optimistic check so two taps can't both win. */
async function saveTransition(row: SessionRow & { updated_at: string }, patch: Record<string, unknown>) {
  const data = check(
    await adminClient().from("tutoring_sessions").update(patch).eq("id", row.id).eq("updated_at", row.updated_at).select(SESSION_SELECT).maybeSingle(),
  );
  if (!data) throw new ApiError(409, "INVALID_STATE", "The session changed; reload and try again");
  return SessionRow.parse(data);
}

async function tellOtherSide(row: SessionRow, actorId: string, title: string, body: string) {
  const other = row.tutor_id === actorId ? row.student_id : row.tutor_id;
  await notify({ schoolId: row.school_id, userId: other, type: "tutoring.updated", title, body, deepLink: `/tutoring/sessions/${row.id}`, data: { session_id: row.id, status: row.status } });
}

const historyEntry = (by: Side, action: HistoryEntry["action"], start: string, end: string): HistoryEntry => ({ by, action, start, end, at: new Date().toISOString() });

const fmt = (isoTs: string, tz: string) =>
  new Date(isoTs).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const SessionsQuery = z.object({
  role: z.enum(["tutor", "student"]).optional(),
  status: z.enum(["requested", "accepted", "paid", "completed", "cancelled", "no_show"]).optional(),
});
const CancelReq = z.object({ reason: z.string().trim().min(1).max(500) });

export const tutoringRoutes = (verify: TokenVerifier, rooms: RoomBooker) => {
  const app = new Hono<AuthEnv>()
    .use("/me/tutor-eligibility/*", requireUser(verify))
    .use("/me/tutor-profile/*", requireUser(verify))
    .use("/tutors/*", requireUser(verify))
    .use("/tutoring/*", requireUser(verify));

  app.get("/me/tutor-eligibility", async (c) => {
    const { id, schoolId } = c.var.user;
    const school = await loadSchool(schoolId);
    const { records, eligibility } = await eligibilityFor(id, schoolId, school.tutor_min_grade);
    const courses = new Map(records.map((r) => [r.course_id, r.course]));
    const items = [...eligibility.values()]
      .map((e) => ({ course: toCourse(courses.get(e.courseId)!), grade: e.grade, verified: e.verified, eligible: e.eligible, reason: e.reason }))
      .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.course.code.localeCompare(b.course.code));
    return c.json(one(items));
  });

  app.get("/me/tutor-profile", async (c) => c.json(one(await myTutorProfile(c.var.user.id, c.var.user.schoolId))));

  app.put("/me/tutor-profile", async (c) => {
    const input = await parseBody(c, PutTutorProfileReq);
    const { id, schoolId } = c.var.user;
    const school = await loadSchool(schoolId);
    const { eligibility } = await eligibilityFor(id, schoolId, school.tutor_min_grade);
    const courseIds = [...new Set(input.course_ids)];
    const fieldErrors: Record<string, string> = {};
    courseIds.forEach((courseId, i) => {
      const e = eligibility.get(courseId);
      if (!e?.eligible) fieldErrors[`course_ids.${i}`] = e?.reason ?? `Needs a verified ${school.tutor_min_grade} or better in this course`;
    });
    if (!input.modes.length) fieldErrors.modes = "Pick at least one";
    if (input.enabled && !courseIds.length) fieldErrors.course_ids = "Pick at least one course to tutor";
    if (Object.keys(fieldErrors).length) throw new ApiError(400, "VALIDATION", "Invalid request", fieldErrors);

    const db = adminClient();
    check(await db.from("tutor_profiles").upsert({
      user_id: id, school_id: schoolId, enabled: input.enabled, hourly_rate_cents: input.hourly_rate_cents,
      bio: input.bio ?? null, modes: [...new Set(input.modes)], open_to_requests: input.open_to_requests,
    }));
    check(await db.from("tutor_courses").delete().eq("user_id", id));
    if (courseIds.length) check(await db.from("tutor_courses").insert(courseIds.map((course_id) => ({ user_id: id, course_id }))));
    check(await db.from("profiles").update({ tutor_opt_in: input.enabled }).eq("id", id));
    return c.json(one(await myTutorProfile(id, schoolId)));
  });

  app.get("/tutors", async (c) => {
    const q = parseQuery(c, TutorsQuery);
    const { id: studentId, schoolId } = c.var.user;
    const from = Date.parse(q.from);
    const to = Date.parse(q.to);
    if (to <= from) throw new ApiError(400, "VALIDATION", "Invalid request", { to: "Must be after from" });
    if (to - from > MAX_SEARCH_DAYS * DAY) throw new ApiError(400, "VALIDATION", "Invalid request", { to: `Maximum range is ${MAX_SEARCH_DAYS} days` });

    const db = adminClient();
    const [school, library, course, offered] = await Promise.all([
      loadSchool(schoolId),
      loadLibrary(schoolId),
      db.from("courses").select("*").eq("id", q.course_id).eq("school_id", schoolId).maybeSingle(),
      db.from("tutor_courses").select("user_id").eq("course_id", q.course_id),
    ]);
    if (!check(course)) throw new ApiError(404, "NOT_FOUND", "Course not found");
    const tutorIds = [...new Set(z.array(z.object({ user_id: z.guid() })).parse(check(offered)).map((r) => r.user_id))].filter((t) => t !== studentId);

    const [tp, records, free, users] = await Promise.all([
      loadTutorProfiles(tutorIds),
      loadClassRecords(tutorIds, schoolId),
      freeTimeFor([studentId, ...tutorIds], schoolId, school.timezone, from, to),
      loadUsersPublic(tutorIds, schoolId),
    ]);
    const fallback = { lat: school.center_lat, lng: school.center_lng };
    const place = library ? { lat: library.lat, lng: library.lng } : null;
    const eligibility = new Map(tutorIds.map((t) => [t, tutorEligibility((records.get(t) ?? []).map(toGradeRecord), school.tutor_min_grade)]));

    const candidates: TutorCandidate[] = [];
    for (const t of tutorIds) {
      const p = tp.profiles.get(t);
      if (!p || p.school_id !== schoolId || !users.has(t)) continue;
      const e = eligibility.get(t)?.get(q.course_id);
      const stats = tp.stats.get(t);
      candidates.push({
        userId: t, enabled: p.enabled && p.open_to_requests, courseIds: (tp.courses.get(t) ?? []).map((x) => x.id),
        hourlyRateCents: p.hourly_rate_cents, rating: stats?.rating ?? 0, reviewCount: stats?.review_count ?? 0, sessionsCompleted: stats?.sessions_completed ?? 0,
        record: e ? { grade: e.grade, verified: e.verified, term: e.term } : null,
        party: { free: free.get(t) ?? [], fallback },
      });
    }
    const matches = findTutorMatches({
      courseId: q.course_id, student: { userId: studentId, free: free.get(studentId) ?? [], fallback }, candidates,
      minGrade: school.tutor_min_grade, meetingPlace: place, durationMin: q.duration_min, now: Date.now(),
      includeUnverified: q.include_unverified, sort: q.sort, ...(q.max_rate_cents !== undefined ? { maxRateCents: q.max_rate_cents } : {}),
    });
    return c.json(one(matches.map((m) => {
      const profile = toTutorProfile(tp.profiles.get(m.user_id)!, tp.courses.get(m.user_id) ?? [], eligibility.get(m.user_id)!, tp.stats.get(m.user_id));
      const { user_id: _id, ...rest } = m;
      return {
        tutor: users.get(m.user_id)!, profile, ...rest,
        open_slots: (free.get(m.user_id) ?? []).map((b) => ({ start: iso(b.start), end: iso(b.end), kind: "free" as const })),
      };
    })));
  });

  app.post("/tutoring/sessions", async (c) => {
    const input = await parseBody(c, CreateSessionReq);
    const { id: studentId, schoolId } = c.var.user;
    if (input.tutor_id === studentId) throw new ApiError(400, "VALIDATION", "Invalid request", { tutor_id: "You can't book yourself" });
    validateWindow(input.start, input.end, Date.now());

    const school = await loadSchool(schoolId);
    const [tp, { eligibility }, library] = await Promise.all([
      loadTutorProfiles([input.tutor_id]), eligibilityFor(input.tutor_id, schoolId, school.tutor_min_grade), loadLibrary(schoolId),
    ]);
    const profile = tp.profiles.get(input.tutor_id);
    const offers = (tp.courses.get(input.tutor_id) ?? []).some((x) => x.id === input.course_id);
    if (!profile || profile.school_id !== schoolId || !profile.enabled || !profile.open_to_requests || !offers || !eligibility.get(input.course_id)?.eligible) {
      throw new ApiError(400, "VALIDATION", "Invalid request", { tutor_id: "This tutor isn't taking requests for that course" });
    }
    const virtual = input.location_pref === "virtual";
    if (!profile.modes.includes(virtual ? "virtual" : "in_person")) {
      throw new ApiError(400, "VALIDATION", "Invalid request", { location_pref: virtual ? "This tutor only meets in person" : "This tutor only meets online" });
    }
    if (await tutorBusyDuring(input.tutor_id, input.start, input.end)) {
      throw new ApiError(409, "INVALID_STATE", "The tutor already has a session then");
    }

    const start = new Date(input.start).toISOString();
    const end = new Date(input.end).toISOString();
    const inserted = check(await adminClient().from("tutoring_sessions").insert({
      school_id: schoolId, tutor_id: input.tutor_id, student_id: studentId, course_id: input.course_id,
      start_at: start, end_at: end, price_cents: priceFor(profile.hourly_rate_cents, start, end),
      location_kind: input.location_pref, location_name: virtual ? null : library?.name ?? null, safe_zone_id: virtual ? null : library?.id ?? null,
      room_booking_status: input.location_pref === "library_room" ? "pending" : "not_needed",
      status: "requested", waiting_on: "tutor", notes: input.notes ?? null, history: [historyEntry("student", "propose", start, end)],
    }).select(SESSION_SELECT).single());
    const row = SessionRow.parse(inserted);
    await tellOtherSide(row, studentId, "New tutoring request", `${row.course.code} · ${fmt(start, school.timezone)}`);
    return c.json(one(await sessionOut(row)), 201);
  });

  app.get("/tutoring/sessions", async (c) => {
    const q = parseQuery(c, SessionsQuery);
    const me = c.var.user.id;
    let query = adminClient().from("tutoring_sessions").select(SESSION_SELECT);
    query = q.role === "tutor" ? query.eq("tutor_id", me) : q.role === "student" ? query.eq("student_id", me) : query.or(`tutor_id.eq.${me},student_id.eq.${me}`);
    if (q.status) query = query.eq("status", q.status);
    const rows = z.array(SessionRow).parse(check(await query.order("start_at").limit(100)));
    const users = await loadUsersPublic(rows.flatMap((r) => [r.tutor_id, r.student_id]), c.var.user.schoolId);
    return c.json(one(rows.map((r) => toSession(r, users))));
  });

  app.get("/tutoring/sessions/:id", async (c) => c.json(one(await sessionOut(await loadSessionRow(c.req.param("id"), c.var.user.id)))));

  app.post("/tutoring/sessions/:id/counter", async (c) => {
    const input = await parseBody(c, CounterSessionReq);
    const me = c.var.user.id;
    const row = await loadSessionRow(c.req.param("id"), me);
    const by = sideOf(row, me);
    validateWindow(input.start, input.end, Date.now());
    const start = new Date(input.start).toISOString();
    const end = new Date(input.end).toISOString();
    const tp = await loadTutorProfiles([row.tutor_id]);
    const next = counterSession(stateOf(row, tp.profiles.get(row.tutor_id)?.hourly_rate_cents ?? 0), by, start, end);
    if (await tutorBusyDuring(row.tutor_id, start, end, row.id)) throw new ApiError(409, "INVALID_STATE", "The tutor already has a session then");
    const saved = await saveTransition(row, {
      start_at: start, end_at: end, waiting_on: next.waitingOn, price_cents: priceFor(next.hourlyRateCents, start, end),
      history: [...row.history, historyEntry(by, "counter", start, end)],
    });
    const school = await loadSchool(row.school_id);
    await tellOtherSide(saved, me, "New time suggested", `${saved.course.code} · ${fmt(start, school.timezone)}${input.message ? ` · "${input.message}"` : ""}`);
    return c.json(one(await sessionOut(saved)));
  });

  app.post("/tutoring/sessions/:id/accept", async (c) => {
    const me = c.var.user.id;
    const row = await loadSessionRow(c.req.param("id"), me);
    const by = sideOf(row, me);
    const next = acceptSession(stateOf(row), by);
    let saved = await saveTransition(row, {
      status: next.status, waiting_on: next.waitingOn, history: [...row.history, historyEntry(by, "accept", row.start_at, row.end_at)],
    });
    if (saved.location_kind === "library_room") saved = await bookRoom(saved, rooms);
    await tellOtherSide(saved, me, "Tutoring session confirmed", `${saved.course.code}${saved.room ? ` · ${saved.room}` : ""}`);
    return c.json(one(await sessionOut(saved)));
  });

  app.post("/tutoring/sessions/:id/decline", async (c) => {
    const me = c.var.user.id;
    const row = await loadSessionRow(c.req.param("id"), me);
    const by = sideOf(row, me);
    const next = declineSession(stateOf(row), by);
    const saved = await saveTransition(row, {
      status: next.status, waiting_on: null, room_booking_status: row.room_booking_status === "pending" ? "not_needed" : row.room_booking_status,
      history: [...row.history, historyEntry(by, "decline", row.start_at, row.end_at)],
    });
    await tellOtherSide(saved, me, "Tutoring request declined", saved.course.code);
    return c.json(one(await sessionOut(saved)));
  });

  app.post("/tutoring/sessions/:id/cancel", async (c) => {
    const { reason } = await parseBody(c, CancelReq);
    const me = c.var.user.id;
    const row = await loadSessionRow(c.req.param("id"), me);
    cancelSession(stateOf(row));
    const saved = await saveTransition(row, { status: "cancelled", waiting_on: null, cancel_reason: reason });
    await tellOtherSide(saved, me, "Tutoring session cancelled", `${saved.course.code} · ${reason}`);
    return c.json(one(await sessionOut(saved)));
  });

  app.post("/tutoring/sessions/:id/complete", async (c) => {
    const me = c.var.user.id;
    const row = await loadSessionRow(c.req.param("id"), me);
    completeSession(stateOf(row), Date.now());
    const saved = await saveTransition(row, { status: "completed", waiting_on: null });
    await tellOtherSide(saved, me, "How was your session?", `Leave a review for ${saved.course.code}`);
    return c.json(one(await sessionOut(saved)));
  });

  app.post("/tutoring/sessions/:id/book-room", async (c) => {
    const row = await loadSessionRow(c.req.param("id"), c.var.user.id);
    if (row.location_kind !== "library_room") throw new ApiError(409, "INVALID_STATE", "This session isn't in a library room");
    if (row.status !== "accepted" && row.status !== "paid") throw new ApiError(409, "INVALID_STATE", "Accept the session first");
    const saved = row.room_booking_status === "booked" ? row : await bookRoom(row, rooms);
    return c.json(one({ status: saved.room_booking_status, room: saved.room, booking_url: saved.booking_url }));
  });

  return app;
};

async function bookRoom(row: SessionRow, rooms: RoomBooker): Promise<SessionRow> {
  const result = await rooms.book({ schoolId: row.school_id, start: row.start_at, end: row.end_at, partySize: 2 });
  const data = check(
    await adminClient().from("tutoring_sessions")
      .update({ room_booking_status: result.status, room: result.room, booking_url: result.bookingUrl })
      .eq("id", row.id).select(SESSION_SELECT).single(),
  );
  return SessionRow.parse(data);
}
