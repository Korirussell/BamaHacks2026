import { Hono } from "hono";
import { z } from "zod";
import { CourseRow } from "../db/academics.js";
import { CourseEventRow, STUDY_GROUP_SELECT, StudyGroupRow, toStudyGroup, type StudyGroupOut } from "../db/study-groups.js";
import { loadMeetingInputs, loadSchool, loadSessionBusy } from "../db/tutoring.js";
import { loadUsersPublic, type UserPublicOut } from "../db/users.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { one, page } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { Place } from "../schemas/common.js";
import { expandMeetings, freeBlocks, type BusyInterval, type FreeBlock } from "../services/availability.js";
import { freeBusy } from "../services/google.js";
import { suggestStudyTimes } from "../services/study-groups.js";
import { DAY, HOUR, MINUTE, iso } from "../services/time.js";
import { loadConfirmations } from "./syllabi.js";

const MIN_GROUP_MIN = 15;
const MAX_GROUP_HOURS = 6;
const MAX_CLASSMATES = 30;
const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 14;

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

export const CreateStudyGroupReq = z.object({
  course_id: z.guid(),
  title: z.string().trim().min(1).max(120),
  target_event_id: z.guid().optional(),
  mode: z.enum(["in_person", "virtual"]),
  place: Place.optional(),
  meeting_url: z.url({ protocol: /^https$/ }).max(500).optional(),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  capacity: z.number().int().min(2).max(50),
  cross_campus: z.boolean(),
}).superRefine((v, ctx) => {
  const minutes = (Date.parse(v.end) - Date.parse(v.start)) / MINUTE;
  if (minutes < MIN_GROUP_MIN || minutes > MAX_GROUP_HOURS * 60) ctx.addIssue({ code: "custom", path: ["end"], message: `Groups run ${MIN_GROUP_MIN} minutes to ${MAX_GROUP_HOURS} hours` });
  if (v.mode === "in_person" && !v.place) ctx.addIssue({ code: "custom", path: ["place"], message: "In-person groups need a place" });
});

const ListQuery = z.object({ course_id: z.guid().optional(), scope: z.enum(["campus", "all_schools"]).default("campus") });
const SuggestQuery = z.object({ course_id: z.guid(), before_event_id: z.guid().optional() });

/** UserPublic for every host and member; cross-campus groups mix schools, so load per school. */
async function loadGroupUsers(rows: StudyGroupRow[]): Promise<Map<string, UserPublicOut>> {
  const bySchool = new Map<string, Set<string>>();
  const add = (schoolId: string, userId: string) => bySchool.set(schoolId, (bySchool.get(schoolId) ?? new Set()).add(userId));
  for (const r of rows) {
    add(r.school_id, r.host_id);
    for (const m of r.members) add(m.school_id, m.user_id);
  }
  const maps = await Promise.all([...bySchool].map(([schoolId, ids]) => loadUsersPublic([...ids], schoolId)));
  return new Map(maps.flatMap((m) => [...m]));
}

async function groupsOut(rows: StudyGroupRow[]): Promise<StudyGroupOut[]> {
  const [users, confirmations] = await Promise.all([
    loadGroupUsers(rows),
    loadConfirmations(rows.flatMap((r) => (r.target_event ? [r.target_event.id] : []))),
  ]);
  return rows.flatMap((r) => toStudyGroup(r, users, confirmations) ?? []);
}

async function loadGroup(id: string): Promise<StudyGroupRow | null> {
  const data = check(await adminClient().from("study_groups").select(STUDY_GROUP_SELECT).eq("id", id).maybeSingle());
  return data ? StudyGroupRow.parse(data) : null;
}

/** A group the caller can see: their school's, or a cross-campus one. */
async function visibleGroup(id: string, schoolId: string) {
  const row = z.guid().safeParse(id).success ? await loadGroup(id) : null;
  if (!row || (row.school_id !== schoolId && !row.cross_campus)) throw new ApiError(404, "NOT_FOUND", "Study group not found");
  return row;
}

async function groupOut(id: string) {
  const row = await loadGroup(id);
  const out = row ? (await groupsOut([row]))[0] : undefined;
  if (!out) throw new ApiError(404, "NOT_FOUND", "Study group not found");
  return out;
}

async function loadCourse(courseId: string, schoolId: string) {
  const data = check(await adminClient().from("courses").select("*").eq("id", courseId).eq("school_id", schoolId).maybeSingle());
  if (!data) throw new ApiError(404, "NOT_FOUND", "Course not found");
  return CourseRow.parse(data);
}

const isFull = (err: unknown) => typeof err === "object" && err !== null && "message" in err && String(err.message).includes("study_group_full");

/** Each person's free time in [from, to): class schedule, Google Calendar busy time and tutoring sessions (as tutoring's freeTimeFor). */
async function freeTimeOf(userIds: string[], schoolId: string, tz: string, from: number, to: number): Promise<Map<string, FreeBlock[]>> {
  const [meetings, sessions, calendars] = await Promise.all([
    loadMeetingInputs(userIds, schoolId),
    loadSessionBusy(userIds, from, to),
    Promise.all(userIds.map((id) => freeBusy(id, from, to))),
  ]);
  return new Map(userIds.map((id, i) => {
    const google: BusyInterval[] = (calendars[i] ?? []).map((b) => ({ ...b, kind: "busy" }));
    return [id, freeBlocks([...expandMeetings(meetings.get(id) ?? [], from, to), ...(sessions.get(id) ?? []), ...google], from, to, tz)];
  }));
}

export const studyGroupsRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .use("/study-groups", requireUser(verify))
  .use("/study-groups/*", requireUser(verify))
  .post("/study-groups", async (c) => {
    const input = await parseBody(c, CreateStudyGroupReq);
    const { id: userId, schoolId } = c.var.user;
    if (Date.parse(input.start) < Date.now()) throw new ApiError(400, "VALIDATION", "Invalid request", { start: "Must be in the future" });
    await loadCourse(input.course_id, schoolId);
    const db = adminClient();
    if (input.target_event_id) {
      const event = check(await db.from("course_events").select("id").eq("id", input.target_event_id).eq("course_id", input.course_id).eq("school_id", schoolId).maybeSingle());
      if (!event) throw new ApiError(400, "VALIDATION", "Invalid request", { target_event_id: "Must be an event of this course" });
    }
    const created = z.object({ id: z.guid() }).parse(check(await db.from("study_groups").insert({
      school_id: schoolId, course_id: input.course_id, host_id: userId, title: input.title, target_event_id: input.target_event_id ?? null,
      mode: input.mode, place_label: input.place?.label ?? null, place_lat: input.place?.location.lat ?? null, place_lng: input.place?.location.lng ?? null,
      meeting_url: input.meeting_url ?? null, start_at: input.start, end_at: input.end, capacity: input.capacity, cross_campus: input.cross_campus,
    }).select("id").single()));
    check(await db.from("study_group_members").insert({ group_id: created.id, user_id: userId, school_id: schoolId }));
    return c.json(one(await groupOut(created.id)), 201);
  })
  .get("/study-groups", async (c) => {
    const q = parseQuery(c, ListQuery);
    const { schoolId } = c.var.user;
    const now = new Date().toISOString();
    const db = adminClient();
    const base = () => db.from("study_groups").select(STUDY_GROUP_SELECT).gt("end_at", now).order("start_at").limit(50);
    const course = q.course_id ? await loadCourse(q.course_id, schoolId) : null;

    let campus = base().eq("school_id", schoolId);
    if (course) campus = campus.eq("course_id", course.id);
    const rows = z.array(StudyGroupRow).parse(check(await campus));

    if (q.scope === "all_schools") {
      // Other schools' cross-campus groups; a course matches by its code.
      let other = base().neq("school_id", schoolId).eq("cross_campus", true);
      if (course) {
        const sameCode = z.array(z.object({ id: z.guid() })).parse(check(await db.from("courses").select("id").eq("code", course.code).neq("school_id", schoolId))).map((r) => r.id);
        other = other.in("course_id", sameCode.length ? sameCode : [course.id]);
      }
      rows.push(...z.array(StudyGroupRow).parse(check(await other)));
      rows.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    }
    return c.json(page(await groupsOut(rows.slice(0, 50))));
  })
  .get("/study-groups/suggested-times", async (c) => {
    const q = parseQuery(c, SuggestQuery);
    const { id: userId, schoolId } = c.var.user;
    const [school] = await Promise.all([loadSchool(schoolId), loadCourse(q.course_id, schoolId)]);
    const db = adminClient();
    const now = Date.now();
    const from = Math.ceil(now / (30 * MINUTE)) * 30 * MINUTE;

    let eventQuery = db.from("course_events").select("*").eq("course_id", q.course_id).eq("school_id", schoolId);
    eventQuery = q.before_event_id ? eventQuery.eq("id", q.before_event_id) : eventQuery.gt("due_at", iso(from + HOUR)).order("due_at").limit(1);
    const event = z.array(CourseEventRow).parse(check(await eventQuery))[0];
    if (q.before_event_id && !event) throw new ApiError(404, "NOT_FOUND", "Course event not found");
    const due = event ? Date.parse(event.due_at) : from + DEFAULT_WINDOW_DAYS * DAY;
    if (due <= from) throw new ApiError(409, "INVALID_STATE", "That event has already passed");
    const to = Math.min(due, from + MAX_WINDOW_DAYS * DAY);

    const classmateRows = z.array(z.object({ user_id: z.guid() })).parse(check(
      await db.from("class_records").select("user_id").eq("course_id", q.course_id).eq("school_id", schoolId).eq("status", "current").neq("user_id", userId).limit(MAX_CLASSMATES),
    ));
    const classmates = [...new Set(classmateRows.map((r) => r.user_id))];
    const free = await freeTimeOf([userId, ...classmates], schoolId, school.timezone, from, to);
    const slots = suggestStudyTimes(free.get(userId) ?? [], classmates.map((id) => free.get(id) ?? []), { from, to });
    return c.json(page(slots.map((s) => ({ start: iso(s.start), end: iso(s.end), classmates_free: s.classmates_free }))));
  })
  .post("/study-groups/:id/join", async (c) => {
    const { id: userId, schoolId } = c.var.user;
    const row = await visibleGroup(c.req.param("id"), schoolId);
    if (row.members.some((m) => m.user_id === userId)) return c.json(one(await groupOut(row.id)));
    if (Date.parse(row.end_at) <= Date.now()) throw new ApiError(409, "INVALID_STATE", "This study group has ended");
    if (row.members.length >= row.capacity) throw new ApiError(409, "INVALID_STATE", "This study group is full");
    const saved = await adminClient().from("study_group_members").upsert({ group_id: row.id, user_id: userId, school_id: schoolId }, { onConflict: "group_id,user_id", ignoreDuplicates: true });
    if (saved.error) {
      if (isFull(saved.error)) throw new ApiError(409, "INVALID_STATE", "This study group is full");
      throw saved.error;
    }
    await notify({ schoolId: row.school_id, userId: row.host_id, type: "study_group.joined", title: "New study group member", body: `Someone joined ${row.title}`, deepLink: `/study-groups/${row.id}`, data: { study_group_id: row.id } });
    return c.json(one(await groupOut(row.id)));
  })
  .post("/study-groups/:id/leave", async (c) => {
    const { id: userId, schoolId } = c.var.user;
    const row = await visibleGroup(c.req.param("id"), schoolId);
    if (row.host_id === userId) throw new ApiError(409, "INVALID_STATE", "Hosts can't leave their own study group");
    check(await adminClient().from("study_group_members").delete().eq("group_id", row.id).eq("user_id", userId));
    return c.body(null, 204);
  });
