import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { ApiError, errorResponse } from "../lib/errors.js";
import type { TokenVerifier } from "../middleware/auth.js";
import { toJob, jobsRoutes } from "./jobs.js";
import { scheduleImportRoutes, type MediaRecord, type ScheduleImportStore } from "./schedule-import.js";

const schoolId = "00000000-0000-4000-a000-000000000001";
const userId = "00000000-0000-4000-a000-000000000005";
const mediaId = "00000000-0000-4000-a000-000000000009";
const verify: TokenVerifier = async (token) => (token === "good" ? { sub: userId, email: null, schoolId } : null);

const build = (...routers: Hono<any>[]) => {
  const app = new Hono();
  routers.forEach((r) => app.route("/", r));
  app.onError((err, c) => (err instanceof ApiError ? errorResponse(c, err) : c.json({ error: { code: "INTERNAL" } }, 500)));
  return app;
};

const ICS = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART;TZID=America/Chicago:20260819T090000", "DTEND;TZID=America/Chicago:20260819T095000", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261211T055959Z", "SUMMARY:CS 101", "LOCATION:SH 1093", "END:VEVENT", "END:VCALENDAR"].join("\r\n");

function fakeStore(media: Partial<MediaRecord> | null, text: string | Error = ICS) {
  const jobs: { id: string; status: string; outcome?: unknown }[] = [];
  const store: ScheduleImportStore = {
    findMedia: async () => (media ? { id: mediaId, bucket: "private-docs", path: "x.ics", kind: "ics", purpose: "schedule", uploaded: true, ...media } : null),
    createJob: async ({ status }) => {
      jobs.push({ id: "00000000-0000-4000-a000-0000000000aa", status });
      return jobs[jobs.length - 1]!.id;
    },
    finishJob: async (_id, outcome) => {
      jobs[0]!.status = outcome.status;
      jobs[0]!.outcome = outcome;
    },
    downloadText: async () => {
      if (text instanceof Error) throw text;
      return text;
    },
    loadSchool: async () => ({ timezone: "America/Chicago", courses: [{ id: "00000000-0000-4000-8000-000000000006", code: "CS 101" }], buildings: [{ id: "00000000-0000-4000-9000-000000000003", code: "SH", name: "Shelby Hall" }] }),
  };
  return { store, jobs };
}

const post = (app: Hono, body: unknown) => app.request("/me/class-schedule/import", { method: "POST", headers: { Authorization: "Bearer good", "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("import and jobs routes require a token", async () => {
  const app = build(scheduleImportRoutes(verify, fakeStore(null).store), jobsRoutes(verify));
  assert.equal((await app.request("/me/class-schedule/import", { method: "POST" })).status, 401);
  assert.equal((await app.request("/jobs/00000000-0000-4000-a000-0000000000aa")).status, 401);
  assert.equal((await app.request("/nope")).status, 404);
});

test("ics import runs inline and returns 202 job_id", async () => {
  const { store, jobs } = fakeStore({});
  const res = await post(build(scheduleImportRoutes(verify, store)), { kind: "ics", media_id: mediaId });
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { data: { job_id: "00000000-0000-4000-a000-0000000000aa" } });
  assert.equal(jobs[0]?.status, "succeeded");
  const outcome = jobs[0]?.outcome as { result: { drafts: { days: string[]; room: string }[] } };
  assert.deepEqual(outcome.result.drafts[0]?.days, ["mon", "wed", "fri"]);
  assert.equal(outcome.result.drafts[0]?.room, "1093");
});

test("download failure marks the job failed but still returns 202", async () => {
  const { store, jobs } = fakeStore({}, new Error("boom"));
  const res = await post(build(scheduleImportRoutes(verify, store)), { kind: "ics", media_id: mediaId });
  assert.equal(res.status, 202);
  assert.deepEqual(jobs[0]?.outcome, { status: "failed", error: "Couldn't read that calendar file" });
});

test("screenshot import leaves the job queued", async () => {
  const { store, jobs } = fakeStore({ kind: "image" });
  const res = await post(build(scheduleImportRoutes(verify, store)), { kind: "screenshot", media_id: mediaId });
  assert.equal(res.status, 202);
  assert.equal(jobs[0]?.status, "queued");
});

test("import validates media ownership, purpose, kind and upload state", async () => {
  const run = async (media: Partial<MediaRecord> | null, body: unknown = { kind: "ics", media_id: mediaId }) => post(build(scheduleImportRoutes(verify, fakeStore(media).store)), body);
  assert.equal((await run(null)).status, 404);
  assert.equal((await run({ purpose: "listing" })).status, 400);
  assert.equal((await run({ kind: "image" })).status, 400);
  assert.equal((await run({ uploaded: false })).status, 400);
  assert.equal((await run({}, { kind: "ics", media_id: "nope" })).status, 400);
});

test("toJob omits null result and error", () => {
  const base = { id: "00000000-0000-4000-a000-0000000000aa", kind: "schedule_import" as const, status: "queued" as const };
  assert.deepEqual(toJob({ ...base, result: null, error: null }), base);
  assert.deepEqual(toJob({ ...base, result: { a: 1 }, error: "x" }), { ...base, result: { a: 1 }, error: "x" });
});
