import { Hono } from "hono";
import { z } from "zod";
import { ClassRecordRow, CourseRow, toClassRecord, toCourse } from "../db/academics.js";
import { TranscriptRow, toTranscript } from "../db/transcripts.js";
import { ApiError } from "../lib/errors.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { meetsThreshold } from "../services/grades.js";
import { pdfRows } from "../services/pdf.js";
import { UnrecognizedTranscriptError, parseBannerTranscript, type ParsedTranscript } from "../services/transcript.js";

export interface MediaRecord {
  id: string;
  bucket: string;
  path: string;
  kind: string;
  purpose: string;
  uploaded: boolean;
}

export interface CatalogEntry { code: string; title: string; department: string }

export interface ClassRecordWrite {
  school_id: string;
  user_id: string;
  course_id: string;
  term: string;
  status: "current" | "past";
  grade: string | null;
  grade_source: "transcript" | "self_reported";
  grade_verified: boolean;
}

type ClassRecordOut = z.infer<typeof ClassRecordRow>;

/** DB + storage + PDF I/O for transcript import, injectable so the flow is testable without Supabase. */
export interface TranscriptStore {
  findMedia(mediaId: string, userId: string, schoolId: string): Promise<MediaRecord | null>;
  /** Inserts the transcript (parsing) and its transcript_parse job, linked both ways. */
  create(input: { userId: string; schoolId: string; mediaId: string; jobStatus: "queued" | "running" }): Promise<{ transcriptId: string; jobId: string }>;
  finish(ids: { transcriptId: string; jobId: string }, outcome: { status: "needs_review"; parsed: ParsedTranscript } | { status: "failed"; error: string }): Promise<void>;
  download(media: MediaRecord): Promise<Uint8Array>;
  pdfRows(bytes: Uint8Array): Promise<string[][]>;
  /** Finds courses by code, creating any the catalog is missing. Keys are normalized codes. */
  resolveCourses(schoolId: string, entries: CatalogEntry[]): Promise<Map<string, string>>;
  findTranscript(id: string, userId: string, schoolId: string): Promise<TranscriptRow | null>;
  courseIdsInSchool(schoolId: string, ids: string[]): Promise<Set<string>>;
  tutorMinGrade(schoolId: string): Promise<string>;
  upsertClassRecords(rows: ClassRecordWrite[]): Promise<ClassRecordOut[]>;
  markConfirmed(transcriptId: string): Promise<void>;
  verifiedPastRecords(userId: string, schoolId: string): Promise<ClassRecordOut[]>;
}

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

const MediaRow = z.object({ id: z.guid(), bucket: z.string(), path: z.string(), kind: z.string(), purpose: z.string(), uploaded: z.boolean() });
const Id = z.object({ id: z.guid() });

export const supabaseTranscriptStore: TranscriptStore = {
  async findMedia(mediaId, userId, schoolId) {
    const data = check(await adminClient().from("media").select("id, bucket, path, kind, purpose, uploaded").eq("id", mediaId).eq("owner_id", userId).eq("school_id", schoolId).maybeSingle());
    return data ? MediaRow.parse(data) : null;
  },
  async create({ userId, schoolId, mediaId, jobStatus }) {
    const db = adminClient();
    const transcriptId = Id.parse(check(await db.from("transcripts").insert({ school_id: schoolId, user_id: userId, media_id: mediaId }).select("id").single())).id;
    const jobId = Id.parse(check(await db.from("jobs").insert({ kind: "transcript_parse", status: jobStatus, payload: { transcript_id: transcriptId, media_id: mediaId }, user_id: userId, school_id: schoolId }).select("id").single())).id;
    check(await db.from("transcripts").update({ job_id: jobId }).eq("id", transcriptId).select("id").single());
    return { transcriptId, jobId };
  },
  async finish({ transcriptId, jobId }, outcome) {
    const db = adminClient();
    if (outcome.status === "needs_review") {
      check(await db.from("transcripts").update({ status: "needs_review", parsed: outcome.parsed, error: null }).eq("id", transcriptId).select("id").single());
      check(await db.from("jobs").update({ status: "succeeded", result: { transcript_id: transcriptId }, error: null }).eq("id", jobId).select("id").single());
    } else {
      check(await db.from("transcripts").update({ status: "failed", error: outcome.error }).eq("id", transcriptId).select("id").single());
      check(await db.from("jobs").update({ status: "failed", error: outcome.error }).eq("id", jobId).select("id").single());
    }
  },
  async download(media) {
    const result = await adminClient().storage.from(media.bucket).download(media.path);
    if (result.error) throw result.error;
    return new Uint8Array(await result.data.arrayBuffer());
  },
  pdfRows,
  async resolveCourses(schoolId, entries) {
    const db = adminClient();
    const codes = entries.map((e) => e.code);
    if (!codes.length) return new Map();
    check(await db.from("courses").upsert(entries.map((e) => ({ school_id: schoolId, code: e.code, title: e.title, department: e.department })), { onConflict: "school_id,code", ignoreDuplicates: true }));
    const rows = z.array(CourseRow).parse(check(await db.from("courses").select("*").eq("school_id", schoolId).in("code", codes)));
    return new Map(rows.map((r) => [normalizeCode(r.code), r.id]));
  },
  async findTranscript(id, userId, schoolId) {
    const data = check(await adminClient().from("transcripts").select("*").eq("id", id).eq("user_id", userId).eq("school_id", schoolId).maybeSingle());
    return data ? TranscriptRow.parse(data) : null;
  },
  async courseIdsInSchool(schoolId, ids) {
    if (!ids.length) return new Set();
    return new Set(z.array(Id).parse(check(await adminClient().from("courses").select("id").eq("school_id", schoolId).in("id", ids))).map((r) => r.id));
  },
  async tutorMinGrade(schoolId) {
    const data = check(await adminClient().from("schools").select("tutor_min_grade").eq("id", schoolId).maybeSingle());
    if (!data) throw new ApiError(404, "NOT_FOUND", "School not found");
    return z.object({ tutor_min_grade: z.string() }).parse(data).tutor_min_grade;
  },
  async upsertClassRecords(rows) {
    return z.array(ClassRecordRow).parse(check(await adminClient().from("class_records").upsert(rows, { onConflict: "user_id,course_id,term" }).select("*, course:courses(*)")));
  },
  async markConfirmed(transcriptId) {
    check(await adminClient().from("transcripts").update({ status: "confirmed", confirmed_at: new Date().toISOString() }).eq("id", transcriptId).select("id").single());
  },
  async verifiedPastRecords(userId, schoolId) {
    return z.array(ClassRecordRow).parse(check(await adminClient().from("class_records").select("*, course:courses(*)").eq("user_id", userId).eq("school_id", schoolId).eq("status", "past").eq("grade_verified", true)));
  },
};

const CreateTranscriptReq = z.object({ media_id: z.guid() });
const ConfirmReq = z.object({
  classes: z.array(z.object({ course_id: z.guid(), term: z.string().trim().min(1), status: z.enum(["current", "past"]), grade: z.string().trim().min(1).nullable().optional() })).max(200),
});

const UNREADABLE = "We couldn't read this transcript. Upload the PDF from myBama → Student Profile → Academic Transcript (print/save as PDF).";
const READ_FAILED = "Couldn't read that file";

/** Uppercase, single-spaced: "cs  100" → "CS 100". */
export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, " ");

// Path-scoped so routers mounted at "/" never put sign-in in front of public or unknown routes.
export const transcriptRoutes = (verify: TokenVerifier, store: TranscriptStore = supabaseTranscriptStore) => new Hono<AuthEnv>()
  .use("/transcripts", requireUser(verify))
  .use("/transcripts/*", requireUser(verify))
  .post("/transcripts", async (c) => {
    const { media_id } = await parseBody(c, CreateTranscriptReq);
    const { id: userId, schoolId } = c.var.user;
    const media = await store.findMedia(media_id, userId, schoolId);
    if (!media) throw new ApiError(404, "NOT_FOUND", "Media not found");
    if (media.purpose !== "transcript") throw new ApiError(400, "VALIDATION", "Invalid request", { media_id: "Media must be uploaded with purpose transcript" });
    if (!media.uploaded) throw new ApiError(400, "VALIDATION", "Invalid request", { media_id: "Upload hasn't finished" });

    if (media.kind !== "pdf") {
      // The AI reader for transcript photos isn't built yet; leave the transcript parsing and the job queued for it.
      const ids = await store.create({ userId, schoolId, mediaId: media.id, jobStatus: "queued" });
      return c.json(one({ job_id: ids.jobId, transcript_id: ids.transcriptId }), 202);
    }

    const ids = await store.create({ userId, schoolId, mediaId: media.id, jobStatus: "running" });
    try {
      const parsed = parseBannerTranscript(await store.pdfRows(await store.download(media)));
      const entries = new Map<string, CatalogEntry>();
      for (const term of parsed.terms) {
        for (const cls of term.classes) {
          const code = normalizeCode(cls.course_code);
          if (!entries.has(code)) entries.set(code, { code, title: cls.title, department: code.split(" ")[0] ?? code });
        }
      }
      const courseIds = await store.resolveCourses(schoolId, [...entries.values()]);
      for (const term of parsed.terms) for (const cls of term.classes) cls.matched_course_id = courseIds.get(normalizeCode(cls.course_code)) ?? null;
      await store.finish(ids, { status: "needs_review", parsed });
    } catch (err) {
      const unreadable = err instanceof UnrecognizedTranscriptError;
      if (!unreadable) console.error("transcript parse failed", err);
      await store.finish(ids, { status: "failed", error: unreadable ? UNREADABLE : READ_FAILED });
    }
    return c.json(one({ job_id: ids.jobId, transcript_id: ids.transcriptId }), 202);
  })
  .get("/transcripts/:id", async (c) => {
    const row = await findOwn(store, c.req.param("id"), c.var.user.id, c.var.user.schoolId);
    return c.json(one(toTranscript(row)));
  })
  .post("/transcripts/:id/confirm", async (c) => {
    const { id: userId, schoolId } = c.var.user;
    const row = await findOwn(store, c.req.param("id"), userId, schoolId);
    const { classes } = await parseBody(c, ConfirmReq);
    if (row.status !== "needs_review") throw new ApiError(409, "INVALID_STATE", "This transcript isn't waiting for review");

    const known = await store.courseIdsInSchool(schoolId, [...new Set(classes.map((k) => k.course_id))]);
    const fieldErrors: Record<string, string> = {};
    const seen = new Set<string>();
    classes.forEach((k, i) => {
      if (!known.has(k.course_id)) fieldErrors[`classes.${i}.course_id`] = "Course must belong to your school";
      else if (seen.has(`${k.course_id}|${k.term}`)) fieldErrors[`classes.${i}.course_id`] = "Duplicate course and term";
      seen.add(`${k.course_id}|${k.term}`);
    });
    if (Object.keys(fieldErrors).length) throw new ApiError(400, "VALIDATION", "Invalid request", fieldErrors);

    // A grade counts as verified only when it is exactly one the transcript parser read.
    const parsedKeys = new Set((row.parsed?.terms ?? []).flatMap((t) => t.classes.flatMap((k) => (k.matched_course_id && k.grade ? [`${k.matched_course_id}|${t.term}|${k.grade}`] : []))));
    const writes: ClassRecordWrite[] = classes.map((k) => {
      const base = { school_id: schoolId, user_id: userId, course_id: k.course_id, term: k.term, status: k.status };
      if (k.status === "current" || !k.grade) return { ...base, grade: null, grade_source: "transcript", grade_verified: false };
      const verified = parsedKeys.has(`${k.course_id}|${k.term}|${k.grade}`);
      return { ...base, grade: k.grade, grade_source: verified ? "transcript" : "self_reported", grade_verified: verified };
    });

    const saved = writes.length ? await store.upsertClassRecords(writes) : [];
    await store.markConfirmed(row.id);

    const minGrade = await store.tutorMinGrade(schoolId);
    const eligible = new Map<string, z.infer<typeof CourseRow>>();
    for (const r of await store.verifiedPastRecords(userId, schoolId)) {
      if (r.grade_verified && meetsThreshold(r.grade, minGrade)) eligible.set(r.course.id, r.course);
    }
    return c.json(one({ classes: saved.map(toClassRecord), tutor_eligible_courses: [...eligible.values()].map(toCourse) }));
  });

async function findOwn(store: TranscriptStore, id: string, userId: string, schoolId: string) {
  const row = z.guid().safeParse(id).success ? await store.findTranscript(id, userId, schoolId) : null;
  if (!row) throw new ApiError(404, "NOT_FOUND", "Transcript not found");
  return row;
}
