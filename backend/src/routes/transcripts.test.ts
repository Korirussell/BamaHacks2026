import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { TranscriptRow } from "../db/transcripts.js";
import { ApiError, errorResponse } from "../lib/errors.js";
import type { TokenVerifier } from "../middleware/auth.js";
import { UnrecognizedTranscriptError, parseBannerTranscript } from "../services/transcript.js";
import { SYNTHETIC_ROWS } from "../test/transcript-fixture.js";
import { normalizeCode, transcriptRoutes, type ClassRecordWrite, type MediaRecord, type TranscriptStore } from "./transcripts.js";

const schoolId = "00000000-0000-4000-a000-000000000001";
const userId = "00000000-0000-4000-a000-000000000005";
const otherUser = "00000000-0000-4000-a000-000000000006";
const mediaId = "00000000-0000-4000-a000-000000000009";
const transcriptId = "00000000-0000-4000-a000-0000000000c1";
const jobId = "00000000-0000-4000-a000-0000000000aa";
const verify: TokenVerifier = async (token) => (token === "good" ? { sub: userId, email: null, schoolId } : null);
const cid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

const build = (store: TranscriptStore) => {
  const app = new Hono();
  app.route("/", transcriptRoutes(verify, store));
  app.onError((err, c) => (err instanceof ApiError ? errorResponse(c, err) : c.json({ error: { code: "INTERNAL" } }, 500)));
  return app;
};
const call = (app: Hono, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { Authorization: "Bearer good", "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

interface Fake {
  store: TranscriptStore;
  catalog: Map<string, string>;
  created: { jobStatus: string }[];
  finished: { status: string; error?: string; parsed?: ReturnType<typeof parseBannerTranscript> }[];
  writes: ClassRecordWrite[];
  transcripts: Map<string, TranscriptRow>;
}

function fake(opts: { media?: Partial<MediaRecord> | null; rows?: string[][] | Error; minGrade?: string; existingVerified?: { grade: string; course: number }[] } = {}): Fake {
  const catalog = new Map<string, string>([["CS 100", cid(1)]]);
  const courseTitles = new Map<string, string>([[cid(1), "CS I for Majors"]]);
  const created: Fake["created"] = [];
  const finished: Fake["finished"] = [];
  const writes: ClassRecordWrite[] = [];
  const transcripts = new Map<string, TranscriptRow>();
  const media = opts.media === null ? null : { id: mediaId, bucket: "private-docs", path: "t.pdf", kind: "pdf", purpose: "transcript", uploaded: true, ...opts.media };
  const store: TranscriptStore = {
    findMedia: async () => media,
    create: async ({ jobStatus }) => {
      created.push({ jobStatus });
      return { transcriptId, jobId };
    },
    finish: async (_ids, outcome) => {
      finished.push(outcome);
    },
    download: async () => new Uint8Array(),
    pdfRows: async () => {
      const rows = opts.rows ?? SYNTHETIC_ROWS;
      if (rows instanceof Error) throw rows;
      return rows;
    },
    resolveCourses: async (_s, entries) => {
      const out = new Map<string, string>();
      for (const e of entries) {
        if (!catalog.has(e.code)) {
          const id = cid(10 + catalog.size);
          catalog.set(e.code, id);
          courseTitles.set(id, e.title);
        }
        out.set(e.code, catalog.get(e.code)!);
      }
      return out;
    },
    findTranscript: async (id, user, school) => {
      const row = transcripts.get(id);
      return row && row.user_id === user && row.school_id === school ? row : null;
    },
    courseIdsInSchool: async (_s, ids) => new Set(ids.filter((id) => courseTitles.has(id))),
    tutorMinGrade: async () => opts.minGrade ?? "A-",
    upsertClassRecords: async (rows) => {
      writes.push(...rows);
      return rows.map((r, i) => ({ id: cid(60 + i), ...r, course: { id: r.course_id, school_id: schoolId, code: [...catalog].find(([, id]) => id === r.course_id)?.[0] ?? "XX 000", title: courseTitles.get(r.course_id) ?? "", department: "XX" } }));
    },
    markConfirmed: async () => {
      const row = transcripts.get(transcriptId);
      if (row) transcripts.set(transcriptId, { ...row, status: "confirmed" });
    },
    verifiedPastRecords: async () => {
      const fromWrites = writes.filter((w) => w.status === "past" && w.grade_verified);
      const records = [
        ...fromWrites.map((w) => ({ grade: w.grade, course: w.course_id })),
        ...(opts.existingVerified ?? []).map((e) => ({ grade: e.grade, course: cid(e.course) })),
      ];
      return records.map((r, i) => ({
        id: cid(80 + i), school_id: schoolId, user_id: userId, course_id: r.course, term: "T", status: "past" as const, grade: r.grade, grade_source: "transcript" as const, grade_verified: true,
        course: { id: r.course, school_id: schoolId, code: [...catalog].find(([, id]) => id === r.course)?.[0] ?? "XX 000", title: courseTitles.get(r.course) ?? "", department: "XX" },
      }));
    },
  };
  return { store, catalog, created, finished, writes, transcripts };
}

/** Seeds a needs_review transcript by parsing the synthetic rows and matching codes to catalog ids. */
function seedReview(f: Fake, overrides: Partial<TranscriptRow> = {}, owner = userId) {
  const parsed = parseBannerTranscript(SYNTHETIC_ROWS);
  let n = 20;
  for (const t of parsed.terms) for (const c of t.classes) {
    const code = normalizeCode(c.course_code);
    if (!f.catalog.has(code)) f.catalog.set(code, cid(n++));
    c.matched_course_id = f.catalog.get(code)!;
  }
  f.transcripts.set(transcriptId, { id: transcriptId, school_id: schoolId, user_id: owner, media_id: mediaId, job_id: jobId, status: "needs_review", parsed, error: null, ...overrides });
  return parsed;
}
// Course ids are registered with titles lazily; make the fake aware of every catalog id.
const withCatalog = (f: Fake) => {
  const orig = f.store.courseIdsInSchool;
  f.store.courseIdsInSchool = async (s, ids) => {
    const known = new Set(f.catalog.values());
    return ids.length ? new Set(ids.filter((id) => known.has(id))) : orig(s, ids);
  };
};

test("all three routes require a token", async () => {
  const app = build(fake().store);
  assert.equal((await app.request("/transcripts", { method: "POST" })).status, 401);
  assert.equal((await app.request(`/transcripts/${transcriptId}`)).status, 401);
  assert.equal((await app.request(`/transcripts/${transcriptId}/confirm`, { method: "POST" })).status, 401);
  assert.equal((await app.request("/nope")).status, 404);
});

test("POST parses a PDF inline, matches or creates courses, and returns 202", async () => {
  const f = fake();
  const res = await call(build(f.store), "POST", "/transcripts", { media_id: mediaId });
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { data: { job_id: jobId, transcript_id: transcriptId } });
  assert.deepEqual(f.created, [{ jobStatus: "running" }]);
  const outcome = f.finished[0]!;
  assert.equal(outcome.status, "needs_review");
  const classes = outcome.parsed!.terms.flatMap((t) => t.classes);
  assert.ok(classes.every((c) => c.matched_course_id));
  assert.equal(classes.find((c) => c.course_code === "CS 100")?.matched_course_id, cid(1));
  assert.ok(f.catalog.has("MIS 505") && f.catalog.has("ECE 380"));
  assert.ok(outcome.parsed!.terms.every((t) => t.section));
});

test("POST validates media", async () => {
  const run = (media: Partial<MediaRecord> | null, body: unknown = { media_id: mediaId }) => call(build(fake({ media }).store), "POST", "/transcripts", body);
  assert.equal((await run(null)).status, 404);
  const wrong = await run({ purpose: "schedule" });
  assert.equal(wrong.status, 400);
  assert.ok(((await wrong.json()) as { error: { field_errors: object } }).error.field_errors);
  assert.equal((await run({ uploaded: false })).status, 400);
  assert.equal((await run({}, { media_id: "nope" })).status, 400);
  assert.equal((await run({}, {})).status, 400);
});

test("unrecognized PDF fails the transcript and job with guidance", async () => {
  const f = fake({ rows: [["Grocery list"]] });
  const res = await call(build(f.store), "POST", "/transcripts", { media_id: mediaId });
  assert.equal(res.status, 202);
  assert.equal(f.finished[0]?.status, "failed");
  assert.match(f.finished[0]?.error ?? "", /myBama/);
  assert.ok(new UnrecognizedTranscriptError("x") instanceof Error);
});

test("other read errors fail with a generic message", async () => {
  const f = fake({ rows: new Error("boom") });
  await call(build(f.store), "POST", "/transcripts", { media_id: mediaId });
  assert.deepEqual(f.finished[0], { status: "failed", error: "Couldn't read that file" });
});

test("image transcripts stay queued", async () => {
  const f = fake({ media: { kind: "image" } });
  const res = await call(build(f.store), "POST", "/transcripts", { media_id: mediaId });
  assert.equal(res.status, 202);
  assert.deepEqual(f.created, [{ jobStatus: "queued" }]);
  assert.equal(f.finished.length, 0);
});

test("GET returns own transcript without section; others and bad ids are 404", async () => {
  const f = fake();
  seedReview(f);
  const app = build(f.store);
  const res = await call(app, "GET", `/transcripts/${transcriptId}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: { status: string; parsed: { student_name: string; gpa: number; terms: { section?: string }[] } } };
  assert.equal(body.data.status, "needs_review");
  assert.equal(body.data.parsed.student_name, "Jordan Sample");
  assert.equal(body.data.parsed.gpa, 3.9);
  assert.ok(body.data.parsed.terms.every((t) => !("section" in t)));
  assert.equal((await call(app, "GET", "/transcripts/not-an-id")).status, 404);
  assert.equal((await call(app, "GET", "/transcripts/00000000-0000-4000-a000-0000000000ff")).status, 404);

  const g = fake();
  seedReview(g, {}, otherUser);
  assert.equal((await call(build(g.store), "GET", `/transcripts/${transcriptId}`)).status, 404);
  assert.equal((await call(build(g.store), "POST", `/transcripts/${transcriptId}/confirm`, { classes: [] })).status, 404);
});

test("GET while parsing returns an empty parsed", async () => {
  const f = fake();
  seedReview(f, { status: "parsing", parsed: null });
  const body = (await (await call(build(f.store), "GET", `/transcripts/${transcriptId}`)).json()) as { data: unknown };
  assert.deepEqual(body.data, { id: transcriptId, status: "parsing", parsed: { student_name: null, terms: [], gpa: null } });
});

test("confirm requires needs_review", async () => {
  const f = fake();
  seedReview(f, { status: "confirmed" });
  const res = await call(build(f.store), "POST", `/transcripts/${transcriptId}/confirm`, { classes: [] });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "INVALID_STATE");
});

test("confirm rejects courses outside the school", async () => {
  const f = fake();
  seedReview(f);
  withCatalog(f);
  const res = await call(build(f.store), "POST", `/transcripts/${transcriptId}/confirm`, { classes: [{ course_id: cid(1), term: "Fall 2024", status: "past", grade: "A+" }, { course_id: cid(99), term: "Fall 2024", status: "past" }] });
  assert.equal(res.status, 400);
  const err = ((await res.json()) as { error: { field_errors: Record<string, string> } }).error.field_errors;
  assert.deepEqual(Object.keys(err), ["classes.1.course_id"]);
  assert.equal(f.writes.length, 0);
});

test("confirm verifies exact transcript grades and downgrades tampered ones", async () => {
  const f = fake();
  seedReview(f);
  withCatalog(f);
  const ece = f.catalog.get("ECE 380")!;
  const math = f.catalog.get("MATH 125")!;
  const mis = f.catalog.get("MIS 505")!;
  const res = await call(build(f.store), "POST", `/transcripts/${transcriptId}/confirm`, {
    classes: [
      { course_id: cid(1), term: "Fall 2024", status: "past", grade: "A+" }, // matches
      { course_id: ece, term: "Spring 2025", status: "past", grade: "A" }, // tampered (transcript says A-)
      { course_id: math, term: "Fall 2024", status: "past", grade: "A+" }, // matches
      { course_id: math, term: "Spring 2030", status: "past", grade: "A+" }, // wrong term
      { course_id: mis, term: "Fall 2025", status: "current", grade: "A" }, // current never graded
    ],
  });
  assert.equal(res.status, 200);
  const by = (course: string, term: string) => f.writes.find((w) => w.course_id === course && w.term === term)!;
  assert.deepEqual([by(cid(1), "Fall 2024").grade_source, by(cid(1), "Fall 2024").grade_verified], ["transcript", true]);
  assert.deepEqual([by(ece, "Spring 2025").grade, by(ece, "Spring 2025").grade_source, by(ece, "Spring 2025").grade_verified], ["A", "self_reported", false]);
  assert.equal(by(math, "Fall 2024").grade_verified, true);
  assert.equal(by(math, "Spring 2030").grade_verified, false);
  assert.deepEqual([by(mis, "Fall 2025").grade, by(mis, "Fall 2025").grade_source, by(mis, "Fall 2025").grade_verified], [null, "transcript", false]);
  assert.ok(f.writes.every((w) => !w.grade_verified || w.grade_source === "transcript"));
  const body = (await res.json()) as { data: { classes: unknown[]; tutor_eligible_courses: { id: string }[] } };
  assert.equal(body.data.classes.length, 5);
  assert.deepEqual(body.data.tutor_eligible_courses.map((c) => c.id).sort(), [cid(1), math].sort());
  assert.equal(f.transcripts.get(transcriptId)?.status, "confirmed");
});

test("tutor_eligible_courses respects the school threshold", async () => {
  const f = fake({ minGrade: "A+", existingVerified: [{ grade: "A", course: 1 }] });
  seedReview(f);
  withCatalog(f);
  const res = await call(build(f.store), "POST", `/transcripts/${transcriptId}/confirm`, { classes: [{ course_id: cid(1), term: "Fall 2024", status: "past", grade: "A+" }] });
  const body = (await res.json()) as { data: { tutor_eligible_courses: { id: string }[] } };
  assert.deepEqual(body.data.tutor_eligible_courses.map((c) => c.id), [cid(1)]);

  const g = fake({ minGrade: "A+" });
  seedReview(g);
  withCatalog(g);
  const ece = g.catalog.get("ECE 380")!;
  const res2 = await call(build(g.store), "POST", `/transcripts/${transcriptId}/confirm`, { classes: [{ course_id: ece, term: "Spring 2025", status: "past", grade: "A-" }] });
  assert.deepEqual(((await res2.json()) as { data: { tutor_eligible_courses: unknown[] } }).data.tutor_eligible_courses, []);
});

test("confirm caps classes at 200", async () => {
  const f = fake();
  seedReview(f);
  const classes = Array.from({ length: 201 }, () => ({ course_id: cid(1), term: "Fall 2024", status: "past" }));
  assert.equal((await call(build(f.store), "POST", `/transcripts/${transcriptId}/confirm`, { classes })).status, 400);
});
