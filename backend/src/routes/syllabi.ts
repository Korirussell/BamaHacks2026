import { Hono } from "hono";
import { z } from "zod";
import { CourseEventRow, EventKind, SyllabusRow, toCourseEvent, type CourseEventOut } from "../db/study-groups.js";
import { ApiError } from "../lib/errors.js";
import { one, page } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { pdfRows } from "../services/pdf.js";
import { rowsToText, textSyllabusParser, type ParsedSyllabus, type SyllabusParser } from "../services/syllabus.js";
import type { MediaRecord } from "./transcripts.js";

export interface CourseEventWrite {
  kind: z.infer<typeof EventKind>;
  title: string;
  due_at: string;
}

/** DB + storage + PDF I/O for syllabus import, injectable so the flow is testable without Supabase. */
export interface SyllabusStore {
  findMedia(mediaId: string, userId: string, schoolId: string): Promise<MediaRecord | null>;
  courseInSchool(courseId: string, schoolId: string): Promise<boolean>;
  timezone(schoolId: string): Promise<string>;
  /** Inserts the syllabus (parsing) and its syllabus_parse job, linked both ways. */
  create(input: { userId: string; schoolId: string; courseId: string; term: string; mediaId: string; jobStatus: "queued" | "running" }): Promise<{ syllabusId: string; jobId: string }>;
  finish(ids: { syllabusId: string; jobId: string }, outcome: { status: "needs_review"; parsed: ParsedSyllabus } | { status: "failed"; error: string }): Promise<void>;
  download(media: MediaRecord): Promise<Uint8Array>;
  pdfRows(bytes: Uint8Array): Promise<string[][]>;
  findSyllabus(id: string, userId: string, schoolId: string): Promise<SyllabusRow | null>;
  /** Upserts the events (shared across classmates), records this user's confirmation, marks the syllabus confirmed. */
  confirm(syllabus: SyllabusRow, events: CourseEventWrite[]): Promise<CourseEventOut[]>;
  courseEvents(courseId: string, term: string): Promise<CourseEventOut[]>;
}

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

const MediaRow = z.object({ id: z.guid(), bucket: z.string(), path: z.string(), kind: z.string(), purpose: z.string(), uploaded: z.boolean() });
const Id = z.object({ id: z.guid() });

/** Confirmation counts by event id. */
export async function loadConfirmations(eventIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!eventIds.length) return out;
  const rows = z.array(z.object({ event_id: z.guid() })).parse(check(await adminClient().from("course_event_confirmations").select("event_id").in("event_id", eventIds)));
  for (const r of rows) out.set(r.event_id, (out.get(r.event_id) ?? 0) + 1);
  return out;
}

async function withCounts(rows: CourseEventRow[]) {
  const counts = await loadConfirmations(rows.map((r) => r.id));
  return rows.map((r) => toCourseEvent(r, counts.get(r.id) ?? 0));
}

export const supabaseSyllabusStore: SyllabusStore = {
  async findMedia(mediaId, userId, schoolId) {
    const data = check(await adminClient().from("media").select("id, bucket, path, kind, purpose, uploaded").eq("id", mediaId).eq("owner_id", userId).eq("school_id", schoolId).maybeSingle());
    return data ? MediaRow.parse(data) : null;
  },
  async courseInSchool(courseId, schoolId) {
    return Boolean(check(await adminClient().from("courses").select("id").eq("id", courseId).eq("school_id", schoolId).maybeSingle()));
  },
  async timezone(schoolId) {
    const data = check(await adminClient().from("schools").select("timezone").eq("id", schoolId).maybeSingle());
    if (!data) throw new ApiError(404, "NOT_FOUND", "School not found");
    return z.object({ timezone: z.string() }).parse(data).timezone;
  },
  async create({ userId, schoolId, courseId, term, mediaId, jobStatus }) {
    const db = adminClient();
    const syllabusId = Id.parse(check(await db.from("syllabi").insert({ school_id: schoolId, user_id: userId, course_id: courseId, term, media_id: mediaId }).select("id").single())).id;
    const jobId = Id.parse(check(await db.from("jobs").insert({ kind: "syllabus_parse", status: jobStatus, payload: { syllabus_id: syllabusId, media_id: mediaId }, user_id: userId, school_id: schoolId }).select("id").single())).id;
    check(await db.from("syllabi").update({ job_id: jobId }).eq("id", syllabusId).select("id").single());
    return { syllabusId, jobId };
  },
  async finish({ syllabusId, jobId }, outcome) {
    const db = adminClient();
    if (outcome.status === "needs_review") {
      check(await db.from("syllabi").update({ status: "needs_review", parsed: outcome.parsed, error: null }).eq("id", syllabusId).select("id").single());
      check(await db.from("jobs").update({ status: "succeeded", result: { syllabus_id: syllabusId, event_count: outcome.parsed.events.length }, error: null }).eq("id", jobId).select("id").single());
    } else {
      check(await db.from("syllabi").update({ status: "failed", error: outcome.error }).eq("id", syllabusId).select("id").single());
      check(await db.from("jobs").update({ status: "failed", error: outcome.error }).eq("id", jobId).select("id").single());
    }
  },
  async download(media) {
    const result = await adminClient().storage.from(media.bucket).download(media.path);
    if (result.error) throw result.error;
    return new Uint8Array(await result.data.arrayBuffer());
  },
  pdfRows,
  async findSyllabus(id, userId, schoolId) {
    const data = check(await adminClient().from("syllabi").select("*").eq("id", id).eq("user_id", userId).eq("school_id", schoolId).maybeSingle());
    return data ? SyllabusRow.parse(data) : null;
  },
  async confirm(syllabus, events) {
    const db = adminClient();
    let saved: CourseEventRow[] = [];
    if (events.length) {
      const writes = events.map((e) => ({
        school_id: syllabus.school_id, course_id: syllabus.course_id, term: syllabus.term, kind: e.kind, title: e.title, due_at: e.due_at,
        source: "syllabus", created_by: syllabus.user_id, syllabus_id: syllabus.id,
      }));
      check(await db.from("course_events").upsert(writes, { onConflict: "course_id,term,kind,title_key,due_at", ignoreDuplicates: true }));
      const existing = z.array(CourseEventRow).parse(check(await db.from("course_events").select("*").eq("course_id", syllabus.course_id).eq("term", syllabus.term).in("kind", [...new Set(events.map((e) => e.kind))])));
      const wanted = new Set(events.map((e) => eventKey(e.kind, e.title, e.due_at)));
      saved = existing.filter((r) => wanted.has(eventKey(r.kind, r.title, r.due_at)));
      check(await db.from("course_event_confirmations").upsert(saved.map((r) => ({ event_id: r.id, user_id: syllabus.user_id, school_id: syllabus.school_id })), { onConflict: "event_id,user_id", ignoreDuplicates: true }));
    }
    check(await db.from("syllabi").update({ status: "confirmed", confirmed_at: new Date().toISOString() }).eq("id", syllabus.id).select("id").single());
    return (await withCounts(saved)).sort((a, b) => a.due_at.localeCompare(b.due_at));
  },
  async courseEvents(courseId, term) {
    return withCounts(z.array(CourseEventRow).parse(check(await adminClient().from("course_events").select("*").eq("course_id", courseId).eq("term", term).order("due_at"))));
  },
};

const eventKey = (kind: string, title: string, dueAt: string) => `${kind}|${title.trim().toLowerCase()}|${Date.parse(dueAt)}`;

const CreateSyllabusReq = z.object({ course_id: z.guid(), term: z.string().trim().min(1).max(40), media_id: z.guid() });
const ConfirmReq = z.object({
  events: z.array(z.object({ kind: EventKind, title: z.string().trim().min(1).max(200), due_at: z.iso.datetime({ offset: true }) })).max(100),
});
const EventsQuery = z.object({ term: z.string().trim().min(1).max(40) });

const READ_FAILED = "Couldn't read that file";

// Path-scoped so routers mounted at "/" never put sign-in in front of public or unknown routes.
export const syllabiRoutes = (verify: TokenVerifier, store: SyllabusStore = supabaseSyllabusStore, parser: SyllabusParser = textSyllabusParser) => new Hono<AuthEnv>()
  .use("/syllabi", requireUser(verify))
  .use("/syllabi/*", requireUser(verify))
  .use("/courses/:id/events", requireUser(verify))
  .post("/syllabi", async (c) => {
    const { course_id, term, media_id } = await parseBody(c, CreateSyllabusReq);
    const { id: userId, schoolId } = c.var.user;
    const media = await store.findMedia(media_id, userId, schoolId);
    if (!media) throw new ApiError(404, "NOT_FOUND", "Media not found");
    if (media.purpose !== "syllabus") throw new ApiError(400, "VALIDATION", "Invalid request", { media_id: "Media must be uploaded with purpose syllabus" });
    if (!media.uploaded) throw new ApiError(400, "VALIDATION", "Invalid request", { media_id: "Upload hasn't finished" });
    if (!(await store.courseInSchool(course_id, schoolId))) throw new ApiError(404, "NOT_FOUND", "Course not found");

    if (media.kind !== "pdf") {
      // The AI reader for syllabus photos isn't built yet; leave the syllabus parsing and the job queued for it.
      const ids = await store.create({ userId, schoolId, courseId: course_id, term, mediaId: media.id, jobStatus: "queued" });
      return c.json(one({ job_id: ids.jobId, syllabus_id: ids.syllabusId }), 202);
    }

    const ids = await store.create({ userId, schoolId, courseId: course_id, term, mediaId: media.id, jobStatus: "running" });
    try {
      const text = rowsToText(await store.pdfRows(await store.download(media)));
      const parsed = parser.parse(text, { term, timezone: await store.timezone(schoolId) });
      // No dated items still goes to review, where the user can add events by hand.
      await store.finish(ids, { status: "needs_review", parsed });
    } catch (err) {
      console.error("syllabus parse failed", err);
      await store.finish(ids, { status: "failed", error: READ_FAILED });
    }
    return c.json(one({ job_id: ids.jobId, syllabus_id: ids.syllabusId }), 202);
  })
  .post("/syllabi/:id/confirm", async (c) => {
    const { id: userId, schoolId } = c.var.user;
    const id = c.req.param("id");
    const row = z.guid().safeParse(id).success ? await store.findSyllabus(id, userId, schoolId) : null;
    if (!row) throw new ApiError(404, "NOT_FOUND", "Syllabus not found");
    const { events } = await parseBody(c, ConfirmReq);
    if (row.status !== "needs_review") throw new ApiError(409, "INVALID_STATE", "This syllabus isn't waiting for review");
    const unique = new Map(events.map((e) => [eventKey(e.kind, e.title, e.due_at), e]));
    return c.json(one(await store.confirm(row, [...unique.values()])));
  })
  .get("/courses/:id/events", async (c) => {
    const id = c.req.param("id");
    if (!z.guid().safeParse(id).success) throw new ApiError(404, "NOT_FOUND", "Course not found");
    const { term } = parseQuery(c, EventsQuery);
    if (!(await store.courseInSchool(id, c.var.user.schoolId))) throw new ApiError(404, "NOT_FOUND", "Course not found");
    return c.json(page(await store.courseEvents(id, term)));
  });
