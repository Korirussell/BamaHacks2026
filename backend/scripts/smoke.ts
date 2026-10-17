// End-to-end HTTP smoke test for the API (docs/API_CONTRACT.md → identity, profile, academics, schedule).
// Usage: start the server (`pnpm dev`), then `pnpm smoke`. Override the target with BASE=...
// Dev-mode auth only (no SUPABASE_JWT_SECRET): `Bearer dev` = demo user, `Bearer dev:<uuid>` = any user.

const BASE = (process.env.BASE ?? "http://localhost:8787/api/v1").replace(/\/$/, "");
const DEMO = "Bearer dev";
const OTHER = "Bearer dev:00000000-0000-4000-8000-00000000c002";

const cid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CS101 = cid(102);
const MATH125 = cid(106);
const MATH126 = cid(107);
const MATH227 = cid(108);
const CH101 = cid(111);
const UNKNOWN = "00000000-0000-4000-8000-0000deadbeef";

type Json = any;
type Res = { status: number; body: Json; text: string; headers: Headers };

let passed = 0;
let failed = 0;

async function req(method: string, path: string, opts: { auth?: string | null; body?: unknown; redirect?: RequestRedirect } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  const auth = opts.auth === undefined ? DEMO : opts.auth;
  if (auth) headers.Authorization = auth;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(BASE + path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
    redirect: opts.redirect ?? "follow",
  });
  const text = await r.text();
  let body: Json = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: r.status, body, text, headers: r.headers };
}

/** Runs one check; `fn` returns null on success or a failure reason. */
async function check(name: string, fn: () => Promise<string | null | undefined | void>) {
  try {
    const why = await fn();
    if (why) {
      failed++;
      console.log(`FAIL  ${name}\n      ${why}`);
    } else {
      passed++;
      console.log(`PASS  ${name}`);
    }
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const show = (r: Res) => `status=${r.status} body=${r.text.slice(0, 600)}`;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

function expectStatus(r: Res, status: number): string | null {
  return r.status === status ? null : `expected ${status}, got ${show(r)}`;
}

function expectError(r: Res, status: number, code: string, needFieldErrors = false): string | null {
  if (r.status !== status) return `expected ${status} ${code}, got ${show(r)}`;
  const e = r.body?.error;
  if (!isObj(e) || e.code !== code || typeof e.message !== "string") return `bad error envelope (want code ${code}): ${show(r)}`;
  if (needFieldErrors && (!isObj(e.field_errors) || Object.keys(e.field_errors).length === 0)) return `missing field_errors: ${show(r)}`;
  if (e.field_errors !== undefined && !isObj(e.field_errors)) return `field_errors must be an object: ${show(r)}`;
  return null;
}

function expectOne(r: Res, status = 200): string | null {
  if (r.status !== status) return `expected ${status}, got ${show(r)}`;
  if (!isObj(r.body) || !("data" in r.body)) return `expected {data: T}: ${show(r)}`;
  return null;
}

function expectList(r: Res): string | null {
  if (r.status !== 200) return `expected 200, got ${show(r)}`;
  if (!isObj(r.body) || !Array.isArray(r.body.data)) return `expected {data: [...]}: ${show(r)}`;
  if (!("next_cursor" in r.body) || !(r.body.next_cursor === null || typeof r.body.next_cursor === "string")) {
    return `expected next_cursor string|null: ${show(r)}`;
  }
  return null;
}

function courseShapeError(c: unknown): string | null {
  if (!isObj(c)) return `course not an object: ${JSON.stringify(c)}`;
  for (const k of ["code", "title", "department"]) if (typeof c[k] !== "string") return `course.${k} not a string: ${JSON.stringify(c)}`;
  if (!isUuid(c.id)) return `course.id not a uuid: ${JSON.stringify(c)}`;
  return null;
}

function classRecordShapeError(rec: unknown): string | null {
  if (!isObj(rec)) return `ClassRecord not an object: ${JSON.stringify(rec)}`;
  if (!isUuid(rec.id)) return `id not a uuid: ${JSON.stringify(rec)}`;
  const ce = courseShapeError(rec.course);
  if (ce) return ce;
  if (typeof rec.term !== "string") return `term not a string: ${JSON.stringify(rec)}`;
  if (!["current", "past", "planned"].includes(rec.status as string)) return `bad status: ${JSON.stringify(rec)}`;
  if (!(rec.grade === null || rec.grade === undefined || typeof rec.grade === "string")) return `bad grade: ${JSON.stringify(rec)}`;
  if (!["transcript", "self_reported"].includes(rec.grade_source as string)) return `bad grade_source: ${JSON.stringify(rec)}`;
  if (typeof rec.grade_verified !== "boolean") return `grade_verified not bool: ${JSON.stringify(rec)}`;
  return null;
}

function meetingShapeError(m: unknown): string | null {
  if (!isObj(m)) return `meeting not an object: ${JSON.stringify(m)}`;
  if (!isUuid(m.course_id)) return `meeting.course_id not uuid: ${JSON.stringify(m)}`;
  if (!Array.isArray(m.days) || !m.days.every((d) => ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(d))) return `bad days: ${JSON.stringify(m)}`;
  if (typeof m.start !== "string" || !/^\d{2}:\d{2}$/.test(m.start)) return `bad start: ${JSON.stringify(m)}`;
  if (typeof m.end !== "string" || !/^\d{2}:\d{2}$/.test(m.end)) return `bad end: ${JSON.stringify(m)}`;
  if (m.place !== null && m.place !== undefined) {
    const p = m.place as Json;
    if (!isObj(p) || typeof p.label !== "string" || !isObj(p.location) || typeof p.location.lat !== "number" || typeof p.location.lng !== "number") {
      return `bad place: ${JSON.stringify(m)}`;
    }
  }
  return null;
}

const SMOKE_CLASSES: [string, string][] = [
  [CS101, "Fall 2026"],
  [MATH125, "Fall 2025"],
  [CH101, "Spring 2027"],
];

/** Removes anything a previous run left on the demo user so the script is re-runnable against one server. */
async function cleanup() {
  const r = await req("GET", "/me/classes");
  if (r.status === 200 && Array.isArray(r.body?.data)) {
    for (const rec of r.body.data as Json[]) {
      if (SMOKE_CLASSES.some(([c, t]) => rec?.course?.id === c && rec?.term === t)) await req("DELETE", `/me/classes/${rec.id}`);
    }
  }
  await req("PUT", "/me/class-schedule", { body: { meetings: [] } });
  await req("DELETE", "/me/calendar/ics");
}

const ICS = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:Fall 2026",
  "X-WR-TIMEZONE:America/Chicago",
  "BEGIN:VEVENT",
  "DTSTART;TZID=America/Chicago:20260819T090000",
  "DTEND;TZID=America/Chicago:20260819T095000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261207T235959Z",
  "DTSTAMP:20260801T000000Z",
  "UID:cs101@smoke",
  "LOCATION:Shelby Hall 1093\\, Tuscaloosa\\, AL",
  "SEQUENCE:0",
  "STATUS:CONFIRMED",
  "SUMMARY:CS 101 - Intro to CS",
  "TRANSP:OPAQUE",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=America/Chicago:20260818T110000",
  "DTEND;TZID=America/Chicago:20260818T121500",
  "RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261207T235959Z",
  "DTSTAMP:20260801T000000Z",
  "UID:math125@smoke",
  "LOCATION:Gordon Palmer 250",
  "SEQUENCE:0",
  "STATUS:CONFIRMED",
  "SUMMARY:MATH125 Lecture",
  "TRANSP:OPAQUE",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "DESCRIPTION:This is an event reminder",
  "TRIGGER:-P0DT0H10M0S",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=America/Chicago:20260817T160000",
  "DTEND;TZID=America/Chicago:20260817T180000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261207T235959Z",
  "DTSTAMP:20260801T000000Z",
  "UID:work@smoke",
  "SEQUENCE:0",
  "STATUS:CONFIRMED",
  "SUMMARY:Work shift",
  "TRANSP:OPAQUE",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=America/Chicago:20260818T140000",
  "DTEND;TZID=America/Chicago:20260818T150000",
  "RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261207T235959Z",
  "DTSTAMP:20260801T000000Z",
  "UID:art@smoke",
  "SEQUENCE:0",
  "STATUS:CONFIRMED",
  "SUMMARY:ART 999 Studio",
  "TRANSP:OPAQUE",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

async function main() {
  console.log(`Smoke testing ${BASE}\n`);
  try {
    await fetch(BASE + "/health");
  } catch (err) {
    console.log(`FAIL  server reachable at ${BASE}\n      ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  await cleanup();

  // ── Auth ──────────────────────────────────────────────────────────────────
  await check("GET /me/classes without token → 401 UNAUTHENTICATED", async () =>
    expectError(await req("GET", "/me/classes", { auth: null }), 401, "UNAUTHENTICATED"),
  );

  // ── Courses ───────────────────────────────────────────────────────────────
  await check("GET /courses?q=cs → list of CS courses", async () => {
    const r = await req("GET", "/courses?q=cs");
    const e = expectList(r);
    if (e) return e;
    const data = r.body.data as Json[];
    if (data.length === 0) return `empty list: ${show(r)}`;
    for (const c of data) {
      const ce = courseShapeError(c);
      if (ce) return ce;
    }
    if (!data.some((c) => c.id === CS101 && c.code === "CS 101")) return `CS 101 missing: ${show(r)}`;
    return null;
  });

  await check("GET /courses?q=calc → MATH 125/126/227", async () => {
    const r = await req("GET", "/courses?q=calc");
    const e = expectList(r);
    if (e) return e;
    const ids = new Set((r.body.data as Json[]).map((c) => c.id));
    for (const id of [MATH125, MATH126, MATH227]) if (!ids.has(id)) return `missing ${id}: ${show(r)}`;
    return null;
  });

  await check("GET /courses?q=cs&limit=2 → next_cursor, following page differs", async () => {
    const r1 = await req("GET", "/courses?q=cs&limit=2");
    const e1 = expectList(r1);
    if (e1) return e1;
    if (r1.body.data.length !== 2) return `expected 2 items: ${show(r1)}`;
    if (typeof r1.body.next_cursor !== "string" || !r1.body.next_cursor) return `expected next_cursor: ${show(r1)}`;
    const r2 = await req("GET", `/courses?q=cs&limit=2&cursor=${encodeURIComponent(r1.body.next_cursor)}`);
    const e2 = expectList(r2);
    if (e2) return e2;
    if (r2.body.data.length === 0) return `second page empty: ${show(r2)}`;
    const first = new Set((r1.body.data as Json[]).map((c) => c.id));
    if ((r2.body.data as Json[]).some((c) => first.has(c.id))) return `second page repeats first page: ${show(r2)}`;
    return null;
  });

  // ── My classes ────────────────────────────────────────────────────────────
  let currentId = "";
  let pastId = "";
  let plannedId = "";

  await check("POST /me/classes current CS 101 Fall 2026 → 201 ClassRecord", async () => {
    const r = await req("POST", "/me/classes", { body: { course_id: CS101, term: "Fall 2026", status: "current" } });
    const e = expectOne(r, 201);
    if (e) return e;
    const rec = r.body.data;
    const se = classRecordShapeError(rec);
    if (se) return se;
    if (rec.course.id !== CS101 || rec.course.code !== "CS 101") return `wrong course: ${show(r)}`;
    if (rec.term !== "Fall 2026" || rec.status !== "current") return `wrong term/status: ${show(r)}`;
    if (rec.grade_source !== "self_reported" || rec.grade_verified !== false) return `expected self_reported/unverified: ${show(r)}`;
    currentId = rec.id;
    return null;
  });

  await check('POST /me/classes past MATH 125 grade "a-" → stored "A-"', async () => {
    const r = await req("POST", "/me/classes", { body: { course_id: MATH125, term: "Fall 2025", status: "past", grade: "a-" } });
    const e = expectOne(r, 201);
    if (e) return e;
    const se = classRecordShapeError(r.body.data);
    if (se) return se;
    if (r.body.data.grade !== "A-") return `expected grade "A-": ${show(r)}`;
    if (r.body.data.grade_verified !== false) return `self-reported grade must be unverified: ${show(r)}`;
    pastId = r.body.data.id;
    return null;
  });

  await check("POST /me/classes planned CH 101 Spring 2027 → 201", async () => {
    const r = await req("POST", "/me/classes", { body: { course_id: CH101, term: "Spring 2027", status: "planned" } });
    const e = expectOne(r, 201);
    if (e) return e;
    const se = classRecordShapeError(r.body.data);
    if (se) return se;
    if (r.body.data.status !== "planned") return `wrong status: ${show(r)}`;
    plannedId = r.body.data.id;
    return null;
  });

  await check("POST /me/classes duplicate → 409 VALIDATION", async () =>
    expectError(await req("POST", "/me/classes", { body: { course_id: CS101, term: "Fall 2026", status: "current" } }), 409, "VALIDATION"),
  );

  await check("POST /me/classes unknown course → 404 NOT_FOUND", async () =>
    expectError(await req("POST", "/me/classes", { body: { course_id: UNKNOWN, term: "Fall 2026", status: "current" } }), 404, "NOT_FOUND"),
  );

  await check("POST /me/classes bad body → 400 VALIDATION with field_errors", async () =>
    expectError(await req("POST", "/me/classes", { body: { course_id: "nope", status: "someday", grade: "Z+" } }), 400, "VALIDATION", true),
  );

  await check("POST /me/classes non-JSON body → 400 VALIDATION", async () =>
    expectError(await req("POST", "/me/classes", { body: "{not json" }), 400, "VALIDATION"),
  );

  await check("GET /me/classes → list contains all three", async () => {
    const r = await req("GET", "/me/classes");
    const e = expectList(r);
    if (e) return e;
    for (const rec of r.body.data as Json[]) {
      const se = classRecordShapeError(rec);
      if (se) return se;
    }
    const ids = new Set((r.body.data as Json[]).map((x) => x.id));
    for (const id of [currentId, pastId, plannedId]) if (!ids.has(id)) return `missing ${id}: ${show(r)}`;
    return null;
  });

  await check("GET /me/classes?status=past → only the past one", async () => {
    const r = await req("GET", "/me/classes?status=past");
    const e = expectList(r);
    if (e) return e;
    const data = r.body.data as Json[];
    if (!data.every((x) => x.status === "past")) return `non-past record returned: ${show(r)}`;
    if (!data.some((x) => x.id === pastId)) return `past record missing: ${show(r)}`;
    if (data.some((x) => x.id === currentId || x.id === plannedId)) return `current/planned leaked: ${show(r)}`;
    return null;
  });

  await check("GET /me/classes?status=bogus → 400 VALIDATION", async () =>
    expectError(await req("GET", "/me/classes?status=bogus"), 400, "VALIDATION"),
  );

  await check("second user GET /me/classes → empty (isolation)", async () => {
    const r = await req("GET", "/me/classes", { auth: OTHER });
    const e = expectList(r);
    if (e) return e;
    if (r.body.data.length !== 0) return `expected no classes: ${show(r)}`;
    return null;
  });

  await check("second user DELETE demo user's class → 404", async () =>
    expectError(await req("DELETE", `/me/classes/${currentId}`, { auth: OTHER }), 404, "NOT_FOUND"),
  );

  // ── Materials ─────────────────────────────────────────────────────────────
  await check("GET /courses/{MATH125}/materials → material items", async () => {
    const r = await req("GET", `/courses/${MATH125}/materials`);
    const e = expectList(r);
    if (e) return e;
    const data = r.body.data as Json[];
    if (data.length === 0) return `expected at least one material: ${show(r)}`;
    for (const m of data) {
      if (typeof m.isbn !== "string" || typeof m.title !== "string" || typeof m.required !== "boolean") return `bad item: ${JSON.stringify(m)}`;
      if (!Number.isInteger(m.active_listings)) return `active_listings not int: ${JSON.stringify(m)}`;
      if (!(m.lowest_price_cents === null || m.lowest_price_cents === undefined || Number.isInteger(m.lowest_price_cents))) {
        return `lowest_price_cents not int|null: ${JSON.stringify(m)}`;
      }
    }
    return null;
  });

  await check("GET /courses/{unknown}/materials → 404 NOT_FOUND", async () =>
    expectError(await req("GET", `/courses/${UNKNOWN}/materials`), 404, "NOT_FOUND"),
  );

  await check("GET /me/upcoming-materials?term=Spring 2027 → CH 101 textbook", async () => {
    const r = await req("GET", "/me/upcoming-materials?term=Spring%202027");
    const e = expectList(r);
    if (e) return e;
    const data = r.body.data as Json[];
    const ch = data.find((x) => x?.course?.id === CH101);
    if (!ch) return `CH 101 item missing: ${show(r)}`;
    const ce = courseShapeError(ch.course);
    if (ce) return ce;
    if (typeof ch.isbn !== "string" || typeof ch.title !== "string") return `bad isbn/title: ${JSON.stringify(ch)}`;
    if (typeof ch.on_wishlist !== "boolean") return `on_wishlist not bool: ${JSON.stringify(ch)}`;
    if (!("best_listing" in ch)) return `best_listing missing: ${JSON.stringify(ch)}`;
    if (data.some((x) => x?.course?.id === CS101 || x?.course?.id === MATH125)) return `other-term course leaked: ${show(r)}`;
    return null;
  });

  await check("GET /me/upcoming-materials without term → 400 VALIDATION", async () =>
    expectError(await req("GET", "/me/upcoming-materials"), 400, "VALIDATION"),
  );

  // ── Delete class ──────────────────────────────────────────────────────────
  await check("DELETE /me/classes/{id} → 204", async () => {
    const r = await req("DELETE", `/me/classes/${plannedId}`);
    if (r.status !== 204) return `expected 204, got ${show(r)}`;
    if (r.text !== "") return `expected empty body: ${show(r)}`;
    return null;
  });

  await check("DELETE /me/classes/{id} again → 404 NOT_FOUND", async () =>
    expectError(await req("DELETE", `/me/classes/${plannedId}`), 404, "NOT_FOUND"),
  );

  // ── Class schedule ────────────────────────────────────────────────────────
  await check("GET /me/class-schedule → {data:{meetings:[]}} initially", async () => {
    const r = await req("GET", "/me/class-schedule");
    const e = expectOne(r);
    if (e) return e;
    if (!Array.isArray(r.body.data?.meetings)) return `expected data.meetings array: ${show(r)}`;
    if (r.body.data.meetings.length !== 0) return `expected empty meetings: ${show(r)}`;
    return null;
  });

  const meeting = {
    course_id: CS101,
    days: ["mon", "wed", "fri"],
    start: "09:00",
    end: "09:50",
    place: { label: "Shelby Hall 1093", location: { lat: 33.2148, lng: -87.5432 } },
  };

  await check("PUT /me/class-schedule → 200 echoes meetings", async () => {
    const r = await req("PUT", "/me/class-schedule", { body: { meetings: [meeting] } });
    const e = expectOne(r);
    if (e) return e;
    const ms = r.body.data?.meetings;
    if (!Array.isArray(ms) || ms.length !== 1) return `expected 1 meeting: ${show(r)}`;
    const me = meetingShapeError(ms[0]);
    if (me) return me;
    if (JSON.stringify(ms[0]) !== JSON.stringify(meeting)) return `echo differs: ${JSON.stringify(ms[0])}`;
    return null;
  });

  await check("GET /me/class-schedule → returns saved meeting", async () => {
    const r = await req("GET", "/me/class-schedule");
    const e = expectOne(r);
    if (e) return e;
    const ms = r.body.data?.meetings;
    if (!Array.isArray(ms) || ms.length !== 1 || JSON.stringify(ms[0]) !== JSON.stringify(meeting)) return `unexpected meetings: ${show(r)}`;
    return null;
  });

  await check("second user GET /me/class-schedule → empty (isolation)", async () => {
    const r = await req("GET", "/me/class-schedule", { auth: OTHER });
    const e = expectOne(r);
    if (e) return e;
    if (!Array.isArray(r.body.data?.meetings) || r.body.data.meetings.length !== 0) return `expected empty: ${show(r)}`;
    return null;
  });

  await check("PUT /me/class-schedule end before start → 400 VALIDATION", async () =>
    expectError(await req("PUT", "/me/class-schedule", { body: { meetings: [{ ...meeting, start: "10:00", end: "09:00" }] } }), 400, "VALIDATION"),
  );

  await check('PUT /me/class-schedule day "funday" → 400 VALIDATION', async () =>
    expectError(await req("PUT", "/me/class-schedule", { body: { meetings: [{ ...meeting, days: ["funday"] }] } }), 400, "VALIDATION", true),
  );

  await check("PUT /me/class-schedule unknown course_id → 400 VALIDATION", async () =>
    expectError(await req("PUT", "/me/class-schedule", { body: { meetings: [{ ...meeting, course_id: UNKNOWN }] } }), 400, "VALIDATION", true),
  );

  await check("rejected PUTs left the saved schedule unchanged", async () => {
    const r = await req("GET", "/me/class-schedule");
    const ms = r.body?.data?.meetings;
    if (!Array.isArray(ms) || ms.length !== 1 || JSON.stringify(ms[0]) !== JSON.stringify(meeting)) return `schedule changed: ${show(r)}`;
    return null;
  });

  // ── Availability ──────────────────────────────────────────────────────────
  // Monday 2026-10-19 in America/Chicago (CDT, UTC-5).
  await check("GET /me/availability Mon Oct 19 → class 14:00–14:50Z, free 13:00Z…03:00Z", async () => {
    const r = await req("GET", "/me/availability?from=2026-10-19T05:00:00Z&to=2026-10-20T05:00:00Z");
    const e = expectOne(r);
    if (e) return e;
    const blocks = r.body.data?.blocks as Json[];
    if (!Array.isArray(blocks) || blocks.length === 0) return `expected blocks: ${show(r)}`;
    for (const b of blocks) {
      if (!["free", "busy", "class"].includes(b.kind)) return `bad kind: ${JSON.stringify(b)}`;
      if (Number.isNaN(Date.parse(b.start)) || Number.isNaN(Date.parse(b.end))) return `bad ts: ${JSON.stringify(b)}`;
      if (Date.parse(b.end) <= Date.parse(b.start)) return `empty/negative block: ${JSON.stringify(b)}`;
    }
    for (let i = 1; i < blocks.length; i++) {
      if (Date.parse(blocks[i].start) < Date.parse(blocks[i - 1].end)) return `blocks unsorted or overlapping at ${i}: ${JSON.stringify(blocks)}`;
    }
    const cls = blocks.filter((b) => b.kind === "class");
    if (cls.length !== 1 || cls[0].start !== "2026-10-19T14:00:00.000Z" || cls[0].end !== "2026-10-19T14:50:00.000Z") {
      return `expected one class block 14:00–14:50Z: ${JSON.stringify(blocks)}`;
    }
    const free = blocks.filter((b) => b.kind === "free");
    if (free.length === 0) return `no free blocks: ${JSON.stringify(blocks)}`;
    if (Date.parse(free[0].start) !== Date.parse("2026-10-19T13:00:00Z")) return `first free should start 13:00Z: ${JSON.stringify(blocks)}`;
    if (Date.parse(free[free.length - 1].end) !== Date.parse("2026-10-20T03:00:00Z")) return `last free should end 03:00Z: ${JSON.stringify(blocks)}`;
    const freeOverlapsClass = free.some((f) => Date.parse(f.start) < Date.parse(cls[0].end) && Date.parse(f.end) > Date.parse(cls[0].start));
    if (freeOverlapsClass) return `free block overlaps class: ${JSON.stringify(blocks)}`;
    return null;
  });

  await check("GET /me/availability missing from → 400 VALIDATION", async () =>
    expectError(await req("GET", "/me/availability?to=2026-10-20T05:00:00Z"), 400, "VALIDATION"),
  );

  await check("GET /me/availability to before from → 400 VALIDATION", async () =>
    expectError(await req("GET", "/me/availability?from=2026-10-20T05:00:00Z&to=2026-10-19T05:00:00Z"), 400, "VALIDATION"),
  );

  await check("GET /me/availability range > 31 days → 400 VALIDATION", async () =>
    expectError(await req("GET", "/me/availability?from=2026-10-01T00:00:00Z&to=2026-11-15T00:00:00Z"), 400, "VALIDATION"),
  );

  // ── Google integration ────────────────────────────────────────────────────
  await check("GET /me/class-schedule/suggested without Google → 409 INVALID_STATE", async () =>
    expectError(await req("GET", "/me/class-schedule/suggested"), 409, "INVALID_STATE"),
  );

  await check("POST /integrations/google/connect → 200 auth_url or 503 INTERNAL (unconfigured)", async () => {
    const r = await req("POST", "/integrations/google/connect");
    if (r.status === 503) return expectError(r, 503, "INTERNAL");
    const e = expectOne(r);
    if (e) return `expected 200 or 503: ${show(r)}`;
    const url = r.body.data?.auth_url;
    if (typeof url !== "string" || !url.startsWith("https://accounts.google.com")) return `bad auth_url: ${show(r)}`;
    return null;
  });

  await check("POST /integrations/google/connect without token → 401", async () =>
    expectError(await req("POST", "/integrations/google/connect", { auth: null }), 401, "UNAUTHENTICATED"),
  );

  await check("GET /integrations/google/callback bad state → 302 to /settings", async () => {
    const r = await req("GET", "/integrations/google/callback?state=garbage&code=x", { auth: null, redirect: "manual" });
    if (r.status !== 302) return `expected 302, got ${show(r)}`;
    const loc = r.headers.get("location") ?? "";
    if (!loc.includes("/settings")) return `Location should contain /settings, got "${loc}"`;
    return null;
  });

  await check("DELETE /integrations/google → 204", async () => {
    const r = await req("DELETE", "/integrations/google");
    return expectStatus(r, 204);
  });

  // ── .ics upload ───────────────────────────────────────────────────────────
  const AVAIL = "/me/availability?from=2026-10-19T05:00:00Z&to=2026-10-20T05:00:00Z";
  let suggestedMeetings: Json[] = [];

  const icsMeetingsError = (ms: unknown): string | null => {
    if (!Array.isArray(ms) || ms.length !== 2) return `expected 2 meetings: ${JSON.stringify(ms)}`;
    for (const m of ms) {
      const me = meetingShapeError(m);
      if (me) return me;
    }
    const cs = ms.find((m: Json) => m.course_id === CS101);
    const ma = ms.find((m: Json) => m.course_id === MATH125);
    if (!cs || JSON.stringify(cs.days) !== JSON.stringify(["mon", "wed", "fri"]) || cs.start !== "09:00" || cs.end !== "09:50") return `bad CS 101 meeting: ${JSON.stringify(cs)}`;
    if (cs.place?.label !== "Shelby Hall 1093, Tuscaloosa, AL") return `bad CS 101 place label: ${JSON.stringify(cs.place)}`;
    if (!ma || JSON.stringify(ma.days) !== JSON.stringify(["tue", "thu"]) || ma.start !== "11:00" || ma.end !== "12:15") return `bad MATH 125 meeting: ${JSON.stringify(ma)}`;
    return null;
  };

  await req("PUT", "/me/class-schedule", { body: { meetings: [] } });

  await check("GET /me/class-schedule/suggested before upload → 409 INVALID_STATE", async () =>
    expectError(await req("GET", "/me/class-schedule/suggested"), 409, "INVALID_STATE"),
  );

  await check("POST /me/calendar/ics non-ics string → 400 VALIDATION on ics", async () => {
    const r = await req("POST", "/me/calendar/ics", { body: { ics: "hello, I am not a calendar" } });
    const e = expectError(r, 400, "VALIDATION", true);
    if (e) return e;
    if (!r.body.error.field_errors.ics) return `missing field_errors.ics: ${show(r)}`;
    return null;
  });

  await check("POST /me/calendar/ics Google export → 201 with 2 meetings + ART 999 unmatched", async () => {
    const r = await req("POST", "/me/calendar/ics", { body: { ics: ICS } });
    const e = expectOne(r, 201);
    if (e) return e;
    const d = r.body.data;
    if (d.events_imported !== 4) return `expected events_imported 4: ${show(r)}`;
    if (d.timezone !== "America/Chicago") return `expected timezone America/Chicago: ${show(r)}`;
    const me = icsMeetingsError(d.meetings);
    if (me) return me;
    if (!Array.isArray(d.unmatched) || !d.unmatched.some((u: Json) => typeof u?.title === "string" && u.title.includes("ART 999"))) return `ART 999 not in unmatched: ${show(r)}`;
    return null;
  });

  await check("GET /me/class-schedule/suggested after upload → 200 same meetings", async () => {
    const r = await req("GET", "/me/class-schedule/suggested");
    const e = expectOne(r);
    if (e) return e;
    const me = icsMeetingsError(r.body.data?.meetings);
    if (me) return me;
    suggestedMeetings = r.body.data.meetings;
    return null;
  });

  await check("GET /me/availability Mon Oct 19 (.ics only) → busy 14:00–14:50Z + 21:00–23:00Z, free 13:00Z…03:00Z", async () => {
    const r = await req("GET", AVAIL);
    const e = expectOne(r);
    if (e) return e;
    const blocks = r.body.data?.blocks as Json[];
    if (!Array.isArray(blocks)) return `expected blocks: ${show(r)}`;
    const busy = blocks.filter((b) => b.kind === "busy").map((b) => `${b.start}/${b.end}`);
    const want = ["2026-10-19T14:00:00.000Z/2026-10-19T14:50:00.000Z", "2026-10-19T21:00:00.000Z/2026-10-19T23:00:00.000Z"];
    if (JSON.stringify(busy) !== JSON.stringify(want)) return `busy blocks ${JSON.stringify(busy)}, want ${JSON.stringify(want)}: ${JSON.stringify(blocks)}`;
    if (blocks.some((b) => b.kind === "class")) return `unexpected class block: ${JSON.stringify(blocks)}`;
    const free = blocks.filter((b) => b.kind === "free");
    if (free.length === 0) return `no free blocks: ${JSON.stringify(blocks)}`;
    if (Date.parse(free[0].start) !== Date.parse("2026-10-19T13:00:00Z")) return `first free should start 13:00Z: ${JSON.stringify(blocks)}`;
    if (Date.parse(free[free.length - 1].end) !== Date.parse("2026-10-20T03:00:00Z")) return `last free should end 03:00Z: ${JSON.stringify(blocks)}`;
    for (const f of free) {
      for (const w of want) {
        const [ws, we] = w.split("/").map(Date.parse);
        if (Date.parse(f.start) < we && Date.parse(f.end) > ws) return `free overlaps busy: ${JSON.stringify(blocks)}`;
      }
    }
    return null;
  });

  await check("PUT suggested meetings, then availability → 14:00Z is class, work shift still busy", async () => {
    const put = await req("PUT", "/me/class-schedule", { body: { meetings: suggestedMeetings } });
    const pe = expectOne(put);
    if (pe) return pe;
    const r = await req("GET", AVAIL);
    const e = expectOne(r);
    if (e) return e;
    const blocks = r.body.data?.blocks as Json[];
    const cls = blocks.filter((b) => b.kind === "class").map((b) => `${b.start}/${b.end}`);
    if (JSON.stringify(cls) !== JSON.stringify(["2026-10-19T14:00:00.000Z/2026-10-19T14:50:00.000Z"])) return `class blocks ${JSON.stringify(cls)}: ${JSON.stringify(blocks)}`;
    const busy = blocks.filter((b) => b.kind === "busy").map((b) => `${b.start}/${b.end}`);
    if (JSON.stringify(busy) !== JSON.stringify(["2026-10-19T21:00:00.000Z/2026-10-19T23:00:00.000Z"])) return `busy blocks ${JSON.stringify(busy)}: ${JSON.stringify(blocks)}`;
    return null;
  });

  await check("DELETE /me/calendar/ics → 204", async () => expectStatus(await req("DELETE", "/me/calendar/ics"), 204));

  await check("GET /me/class-schedule/suggested after delete → 409 INVALID_STATE", async () =>
    expectError(await req("GET", "/me/class-schedule/suggested"), 409, "INVALID_STATE"),
  );

  // Leave the demo user as we found it.
  await req("DELETE", `/me/classes/${currentId}`);
  await req("DELETE", `/me/classes/${pastId}`);
  await req("PUT", "/me/class-schedule", { body: { meetings: [] } });
  await req("DELETE", "/me/calendar/ics");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
