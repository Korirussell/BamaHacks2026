import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { createApp } from "../app.js";
import type { SyllabusRow } from "../db/study-groups.js";
import { ApiError, errorResponse } from "../lib/errors.js";
import type { TokenVerifier } from "../middleware/auth.js";
import { syllabiRoutes, type CourseEventWrite, type SyllabusStore } from "./syllabi.js";
import type { MediaRecord } from "./transcripts.js";

process.env["SUPABASE_URL"] ??= "https://example.supabase.co";

const schoolId = "00000000-0000-4000-a000-000000000001";
const userId = "00000000-0000-4000-a000-000000000005";
const courseId = "00000000-0000-4000-a000-0000000000c5";
const mediaId = "00000000-0000-4000-a000-000000000009";
const syllabusId = "00000000-0000-4000-a000-0000000000d1";
const jobId = "00000000-0000-4000-a000-0000000000aa";
const signedIn: TokenVerifier = async () => ({ sub: userId, email: "s@crimson.ua.edu", schoolId });
const auth = { headers: { Authorization: "Bearer test", "Content-Type": "application/json" } };
const app = createApp({ verify: signedIn, log: false });
const post = (path: string, body: unknown) => app.request(`/api/v1${path}`, { method: "POST", body: JSON.stringify(body), ...auth });

const future = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const group = { course_id: courseId, title: "Midterm cram", mode: "virtual", start: future(24), end: future(26), capacity: 6, cross_campus: false };

test("study group routes need a sign-in", async () => {
  const anon = createApp({ verify: async () => null, log: false });
  assert.equal((await anon.request("/api/v1/study-groups")).status, 401);
  assert.equal((await anon.request("/api/v1/study-groups/suggested-times?course_id=" + courseId)).status, 401);
  assert.equal((await anon.request("/api/v1/syllabi", { method: "POST" })).status, 401);
  assert.equal((await anon.request(`/api/v1/courses/${courseId}/events?term=Fall%202026`)).status, 401);
});

test("POST /study-groups validates the body before touching the database", async () => {
  assert.equal((await post("/study-groups", {})).status, 400);
  assert.equal((await post("/study-groups", { ...group, capacity: 1 })).status, 400);
  assert.equal((await post("/study-groups", { ...group, capacity: 51 })).status, 400);
  assert.equal((await post("/study-groups", { ...group, mode: "hybrid" })).status, 400);
  const noPlace = await post("/study-groups", { ...group, mode: "in_person" });
  assert.equal(noPlace.status, 400);
  assert.ok(((await noPlace.json()) as { error: { field_errors: Record<string, string> } }).error.field_errors["place"]);
  assert.equal((await post("/study-groups", { ...group, end: group.start })).status, 400);
  assert.equal((await post("/study-groups", { ...group, end: future(40) })).status, 400);
  assert.equal((await post("/study-groups", { ...group, start: future(-2), end: future(-1) })).status, 400);
  assert.equal((await post("/study-groups", { ...group, meeting_url: "http://insecure.example" })).status, 400);
});

test("study group queries and ids are checked", async () => {
  assert.equal((await app.request("/api/v1/study-groups?scope=galaxy", auth)).status, 400);
  assert.equal((await app.request("/api/v1/study-groups?course_id=nope", auth)).status, 400);
  assert.equal((await app.request("/api/v1/study-groups/suggested-times", auth)).status, 400);
  assert.equal((await app.request(`/api/v1/study-groups/suggested-times?course_id=${courseId}&before_event_id=x`, auth)).status, 400);
  assert.equal((await post("/study-groups/not-a-uuid/join", {})).status, 404);
  assert.equal((await post("/study-groups/not-a-uuid/leave", {})).status, 404);
  assert.equal((await app.request("/api/v1/courses/not-a-uuid/events?term=Fall%202026", auth)).status, 404);
  assert.equal((await app.request(`/api/v1/courses/${courseId}/events`, auth)).status, 400);
});

test("syllabus requests validate the body", async () => {
  assert.equal((await post("/syllabi", { course_id: courseId, term: "Fall 2026" })).status, 400);
  assert.equal((await post("/syllabi", { course_id: "x", term: "Fall 2026", media_id: mediaId })).status, 400);
  assert.equal((await post("/syllabi/not-a-uuid/confirm", { events: [] })).status, 404);
});

// ---------------------------------------------------------------- syllabus flow with a fake store

const PDF_ROWS = [["Week 7", "Tuesday, October 24", "Midterm Exam"], ["Homework 3 due 10/02 11:59 pm"], ["Office hours: Mon 2-3 pm"]];

function fake(opts: { media?: Partial<MediaRecord> | null; course?: boolean; rows?: string[][] | Error; status?: SyllabusRow["status"] } = {}) {
  const created: string[] = [];
  const finished: Parameters<SyllabusStore["finish"]>[1][] = [];
  const confirmed: CourseEventWrite[][] = [];
  const media = opts.media === null ? null : { id: mediaId, bucket: "private-docs", path: "s.pdf", kind: "pdf", purpose: "syllabus", uploaded: true, ...opts.media };
  const row: SyllabusRow = { id: syllabusId, school_id: schoolId, user_id: userId, course_id: courseId, term: "Fall 2026", media_id: mediaId, job_id: jobId, status: opts.status ?? "needs_review", parsed: { events: [] }, error: null };
  const store: SyllabusStore = {
    findMedia: async () => media,
    courseInSchool: async () => opts.course ?? true,
    timezone: async () => "America/Chicago",
    create: async ({ jobStatus }) => {
      created.push(jobStatus);
      return { syllabusId, jobId };
    },
    finish: async (_ids, outcome) => {
      finished.push(outcome);
    },
    download: async () => new Uint8Array(),
    pdfRows: async () => {
      const rows = opts.rows ?? PDF_ROWS;
      if (rows instanceof Error) throw rows;
      return rows;
    },
    findSyllabus: async (id) => (id === syllabusId ? row : null),
    confirm: async (_row, events) => {
      confirmed.push(events);
      return events.map((e, i) => ({ id: `00000000-0000-4000-a000-0000000000e${i}`, course_id: courseId, kind: e.kind, title: e.title, due_at: new Date(e.due_at).toISOString(), source: "syllabus" as const, confirmations: 1 }));
    },
    courseEvents: async () => [],
  };
  const http = new Hono();
  http.route("/", syllabiRoutes(signedIn, store));
  http.onError((err, c) => (err instanceof ApiError ? errorResponse(c, err) : c.json({ error: { code: "INTERNAL" } }, 500)));
  const call = (method: string, path: string, body?: unknown) => http.request(path, { method, ...auth, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { call, created, finished, confirmed };
}

const createBody = { course_id: courseId, term: "Fall 2026", media_id: mediaId };

test("POST /syllabi parses a PDF into events for review", async () => {
  const f = fake();
  const res = await f.call("POST", "/syllabi", createBody);
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { data: { job_id: jobId, syllabus_id: syllabusId } });
  assert.deepEqual(f.created, ["running"]);
  const outcome = f.finished[0];
  assert.equal(outcome?.status, "needs_review");
  if (outcome?.status !== "needs_review") return;
  assert.deepEqual(outcome.parsed.events.map((e) => [e.kind, e.date, e.title]), [["assignment", "2026-10-02", "Homework 3"], ["exam", "2026-10-24", "Midterm Exam"]]);
});

test("POST /syllabi checks media and course, queues photos and records read failures", async () => {
  assert.equal((await fake({ media: null }).call("POST", "/syllabi", createBody)).status, 404);
  assert.equal((await fake({ media: { purpose: "transcript" } }).call("POST", "/syllabi", createBody)).status, 400);
  assert.equal((await fake({ media: { uploaded: false } }).call("POST", "/syllabi", createBody)).status, 400);
  assert.equal((await fake({ course: false }).call("POST", "/syllabi", createBody)).status, 404);

  const photo = fake({ media: { kind: "image" } });
  assert.equal((await photo.call("POST", "/syllabi", createBody)).status, 202);
  assert.deepEqual(photo.created, ["queued"]);
  assert.equal(photo.finished.length, 0);

  const broken = fake({ rows: new Error("bad pdf") });
  const origError = console.error;
  console.error = () => {};
  try {
    assert.equal((await broken.call("POST", "/syllabi", createBody)).status, 202);
  } finally {
    console.error = origError;
  }
  assert.deepEqual(broken.finished, [{ status: "failed", error: "Couldn't read that file" }]);
});

test("POST /syllabi/{id}/confirm saves deduplicated events, only while waiting for review", async () => {
  const f = fake();
  const ev = { kind: "exam", title: "Midterm", due_at: "2026-10-24T14:30:00Z" };
  const res = await f.call("POST", `/syllabi/${syllabusId}/confirm`, { events: [ev, { ...ev, title: " midterm " }, { kind: "quiz", title: "Quiz 1", due_at: "2026-09-10T13:00:00Z" }] });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { data: unknown[] }).data.length, 2);
  assert.equal(f.confirmed[0]?.length, 2);

  assert.equal((await f.call("POST", `/syllabi/${syllabusId}/confirm`, { events: [{ ...ev, kind: "party" }] })).status, 400);
  assert.equal((await f.call("POST", `/syllabi/00000000-0000-4000-a000-0000000000ff/confirm`, { events: [] })).status, 404);
  assert.equal((await fake({ status: "confirmed" }).call("POST", `/syllabi/${syllabusId}/confirm`, { events: [] })).status, 409);
});

test("GET /courses/{id}/events needs a course in the caller's school", async () => {
  assert.equal((await fake({ course: false }).call("GET", `/courses/${courseId}/events?term=Fall%202026`)).status, 404);
  const ok = await fake().call("GET", `/courses/${courseId}/events?term=Fall%202026`);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { data: [], next_cursor: null });
});
