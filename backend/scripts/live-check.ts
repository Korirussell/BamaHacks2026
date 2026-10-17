// Verifies the backend's connection to the live Supabase project.
//
//   pnpm live-check
//
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (SUPABASE_ANON_KEY is used for the demo sign-in if set).
// Read-only except check (e), which cleans up what it creates. It never applies migrations,
// creates users or sets passwords. Prints one PASS/FAIL/SKIP line per check and exits 1 on any FAIL.
// Keys and tokens are never printed.

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createApp } from "../src/app.js";
import { BuildingRow, CourseRow, DropOffPointRow, SafeZoneRow } from "../src/db/academics.js";
import { SchoolRow } from "../src/db/rows.js";
import { adminClient } from "../src/lib/supabase.js";

type Status = "PASS" | "FAIL" | "SKIP";
let failures = 0;
function report(status: Status, name: string, detail = "") {
  if (status === "FAIL") failures++;
  console.log(`${status.padEnd(4)}  ${name}${detail ? ` - ${detail}` : ""}`);
}
const message = (err: unknown) => (err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : String(err));

/** Run a check; a thrown error is a FAIL. The body returns a detail string, or { skip } to skip. */
async function check(name: string, body: () => Promise<string | { skip: string } | void>) {
  try {
    const out = await body();
    if (out && typeof out === "object") report("SKIP", name, out.skip);
    else report("PASS", name, out ?? "");
  } catch (err) {
    report("FAIL", name, message(err));
  }
}

for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[name]) {
    console.error(`${name} is not set. Fill in backend/.env first (see backend/.env.example).`);
    process.exit(1);
  }
}

const SCHOOL = "00000000-0000-4000-a000-000000000001";
const db = adminClient();

// ---------------------------------------------------------------- a. tables and columns

interface TableSpec { table: string; migration: string; columns: string[]; optional?: boolean }
const TABLES: TableSpec[] = [
  { table: "schools", migration: "0001_core.sql", columns: ["id", "name", "domain", "email_domains", "center_lat", "center_lng", "timezone", "campus_mail_supported", "tutor_min_grade"] },
  { table: "profiles", migration: "0001_core.sql", columns: ["id", "school_id", "email", "display_name", "avatar_media_id", "major", "grad_year", "phone", "budget_cents", "mail_stop_code", "tutor_opt_in", "location_sharing", "notification_prefs", "is_admin", "stripe_account_id", "stripe_status", "payouts_enabled", "google_connected", "completed_count", "no_show_count"] },
  { table: "buildings", migration: "0001_core.sql", columns: ["id", "school_id", "name", "code", "lat", "lng"] },
  { table: "safe_zones", migration: "0001_core.sql", columns: ["id", "school_id", "name", "kind", "lat", "lng", "radius_m", "hours", "hours_note", "active"] },
  { table: "drop_off_points", migration: "0001_core.sql", columns: ["id", "school_id", "name", "lat", "lng", "radius_m", "hours", "instructions", "active"] },
  { table: "courses", migration: "0001_core.sql", columns: ["id", "school_id", "code", "title", "department"] },
  { table: "course_materials", migration: "0001_core.sql", columns: ["id", "school_id", "course_id", "isbn", "title", "authors", "edition", "required", "term"] },
  { table: "class_records", migration: "0001_core.sql", columns: ["id", "school_id", "user_id", "course_id", "term", "status", "grade", "grade_source", "grade_verified", "created_at"] },
  { table: "class_meetings", migration: "0001_core.sql", columns: ["id", "school_id", "user_id", "course_id", "section", "days", "start_time", "end_time", "timezone", "term", "term_start", "term_end", "building_id", "room", "source"] },
  { table: "media", migration: "0001_core.sql", columns: ["id", "school_id", "owner_id", "purpose", "bucket", "path", "kind", "content_type", "bytes", "width", "height", "uploaded"] },
  { table: "jobs", migration: "0001_core.sql", columns: ["id", "school_id", "user_id", "kind", "status", "payload", "result", "error", "attempts", "run_after", "locked_at", "created_at", "updated_at"] },
  { table: "idempotency_keys", migration: "0001_core.sql", columns: ["user_id", "key", "request_hash", "response_status", "response_body", "created_at"] },
  { table: "ingested_posts", migration: "0002_market.sql", columns: ["id", "school_id", "channel", "external_url", "author_handle", "caption", "media_ids", "posted_at", "status", "job_id"] },
  { table: "listings", migration: "0002_market.sql", columns: ["id", "school_id", "seller_id", "external_channel", "external_handle", "external_profile_url", "category", "title", "description", "price_cents", "negotiable", "floor_price_cents", "condition", "isbn", "textbook_title", "authors", "edition", "ticket", "fulfillment", "status", "source_channel", "external_url", "ingested_post_id", "claimed", "created_at", "updated_at"] },
  { table: "listing_courses", migration: "0002_market.sql", columns: ["listing_id", "course_id"] },
  { table: "listing_media", migration: "0002_market.sql", columns: ["listing_id", "media_id", "position"] },
  { table: "seller_invites", migration: "0002_market.sql", columns: ["id", "school_id", "channel", "handle", "profile_url", "listing_ids", "token_hash", "message_text", "status", "trigger", "sent_at", "claimed_at", "claimed_by", "expires_at", "created_at"] },
  { table: "offers", migration: "0002_market.sql", columns: ["id", "school_id", "listing_id", "buyer_id", "seller_id", "kind", "amount_cents", "trade_listing_ids", "fulfillment", "message", "counter_of", "auto_generated", "made_by", "status", "waiting_on", "seller_notified_at", "expires_at", "created_at", "updated_at"] },
  { table: "orders", migration: "0002_market.sql", columns: ["id", "school_id", "listing_id", "buyer_id", "seller_id", "offer_id", "amount_cents", "fee_cents", "seller_payout_cents", "fulfillment", "status", "payment_status", "payment_intent_id", "paid_at", "payout_status", "stripe_transfer_id", "released_at", "handoff_id", "cancel_reason", "dispute_reason", "created_at", "updated_at"] },
  { table: "handoffs", migration: "0002_market.sql", columns: ["id", "school_id", "context_type", "context_id", "giver_id", "receiver_id", "suggestions", "proposed_by", "proposed_start", "proposed_zone_id", "agreed_start", "agreed_end", "safe_zone_id", "status", "giver_nearby", "receiver_nearby", "giver_at", "receiver_at", "item_ok"] },
  { table: "shipments", migration: "0002_market.sql", columns: ["id", "school_id", "order_id", "label_code", "label_media_id", "to_name", "to_mail_stop_code", "drop_off_point_id", "status", "dropped_off_at", "drop_off_proof_media_id", "drop_off_lat", "drop_off_lng", "received_at", "auto_complete_at"] },
  { table: "notifications", migration: "0002_market.sql", columns: ["id", "school_id", "user_id", "type", "title", "body", "deep_link", "data", "read_at", "created_at"] },
  { table: "tutor_profiles", migration: "0003_tutoring.sql", columns: ["user_id", "school_id", "enabled", "hourly_rate_cents", "bio", "modes", "open_to_requests", "availability"] },
  { table: "tutor_courses", migration: "0003_tutoring.sql", columns: ["user_id", "course_id"] },
  { table: "tutoring_sessions", migration: "0003_tutoring.sql", columns: ["id", "school_id", "tutor_id", "student_id", "course_id", "start_at", "end_at", "price_cents", "location_kind", "location_name", "safe_zone_id", "meeting_url", "room_booking_status", "room", "booking_url", "status", "waiting_on", "history", "notes", "handoff_id", "payment_intent_id", "cancel_reason", "updated_at"] },
  { table: "tutor_stats", migration: "0003_tutoring.sql (view)", columns: ["user_id", "rating", "review_count", "sessions_completed"] },
  { table: "reviews", migration: "0003_tutoring.sql", columns: ["id", "school_id", "from_id", "to_id", "context_type", "context_id", "stars"] },
  { table: "calendar_connections", migration: "0005_calendar.sql", columns: ["user_id", "school_id", "provider", "refresh_token_enc", "scope", "timezone", "connected_at"] },
  // Added by a separate open branch (0007); not a failure until that merges and is applied.
  { table: "transcripts", migration: "0007 (open branch)", columns: ["id"], optional: true },
];

const isMissingTable = (err: { code?: string; message: string }) =>
  err.code === "42P01" || err.code === "PGRST205" || (/does not exist|schema cache|Could not find the table/i.test(err.message) && !/column/i.test(err.message));

for (const spec of TABLES) {
  const name = `table ${spec.table}`;
  const { error } = await db.from(spec.table).select(spec.columns.join(", ")).limit(1);
  if (!error) { report("PASS", name, `${spec.columns.length} columns`); continue; }
  if (isMissingTable(error)) {
    if (spec.optional) report("SKIP", name, `not created yet (${spec.migration})`);
    else report("FAIL", name, `table missing; apply ${spec.migration}`);
  } else if (error.code === "42703" || /column/i.test(error.message)) {
    report("FAIL", name, `${error.message}; expected from ${spec.migration}`);
  } else {
    report("FAIL", name, `${error.code ?? ""} ${error.message}`.trim());
  }
}

await check("relation profiles.avatar (profiles_avatar_media_fk)", async () => {
  const { error } = await db.from("profiles").select("*, school:schools(*), avatar:media!profiles_avatar_media_fk(bucket, path)").limit(1);
  if (error) throw new Error(`${error.message}; expected from 0001_core.sql`);
});
await check("relation listings embeds (listing_courses, listing_media)", async () => {
  const { error } = await db.from("listings").select("*, listing_courses(course:courses(*)), listing_media(position, media:media(id, bucket, path, kind, width, height, uploaded))").limit(1);
  if (error) throw new Error(`${error.message}; expected from 0002_market.sql`);
});

// ---------------------------------------------------------------- b. storage buckets

await check("storage buckets public-media, private-docs", async () => {
  const { data, error } = await db.storage.listBuckets();
  if (error) throw error;
  const want = { "public-media": true, "private-docs": false } as const;
  const problems: string[] = [];
  for (const [id, isPublic] of Object.entries(want)) {
    const bucket = data.find((b) => b.id === id);
    if (!bucket) problems.push(`${id} missing`);
    else if (bucket.public !== isPublic) problems.push(`${id} should be ${isPublic ? "public" : "private"}`);
    else if (bucket.file_size_limit !== 10485760) problems.push(`${id} size limit is ${bucket.file_size_limit}, expected 10485760`);
    else if (id === "private-docs" && !bucket.allowed_mime_types?.includes("text/calendar")) problems.push("private-docs does not allow text/calendar");
  }
  if (problems.length) throw new Error(`${problems.join("; ")}; apply 0006_storage.sql`);
  return "both exist with the expected visibility and limits";
});

// ---------------------------------------------------------------- c. seed data through the code's row schemas

async function seedRows(table: string, schema: z.ZodType, filter: Record<string, unknown> = {}) {
  let q = db.from(table).select("*").eq("school_id", SCHOOL);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v as never);
  const { data, error } = await q;
  if (error) throw error;
  if (!data?.length) throw new Error("no rows for the UA school; load supabase/seed.sql");
  return z.array(schema).parse(data);
}

await check("seed: UA school", async () => {
  const { data, error } = await db.from("schools").select("*").eq("id", SCHOOL).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("UA school row missing; load supabase/seed.sql");
  const school = SchoolRow.parse(data);
  return `${school.timezone}, tutor_min_grade ${school.tutor_min_grade}`;
});
await check("seed: buildings", async () => `${(await seedRows("buildings", BuildingRow)).length} rows parse`);
await check("seed: courses", async () => `${(await seedRows("courses", CourseRow)).length} rows parse`);
await check("seed: safe zones", async () => `${(await seedRows("safe_zones", SafeZoneRow, { active: true })).length} active rows parse`);
await check("seed: drop-off points", async () => `${(await seedRows("drop_off_points", DropOffPointRow, { active: true })).length} active rows parse`);

// ---------------------------------------------------------------- d. /auth/check-email in-process

const app = createApp({ log: false });
const api = "/api/v1";

await check("POST /auth/check-email (ua.edu)", async () => {
  const res = await app.request(`${api}/auth/check-email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "someone@crimson.ua.edu" }) });
  const body = (await res.json()) as { data?: { allowed: boolean; reason: string | null } };
  if (res.status !== 200 || body.data?.allowed !== true) throw new Error(`status ${res.status}, allowed=${body.data?.allowed}, reason=${body.data?.reason}`);
});

// ---------------------------------------------------------------- e. authenticated flow as a demo persona

const PERSONAS = ["bamahacks.student@crimson.ua.edu", "bamahacks.ava@crimson.ua.edu"];

async function findPersona(): Promise<{ id: string; email: string } | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const email of PERSONAS) {
      const u = data.users.find((x) => x.email?.toLowerCase() === email);
      if (u) return { id: u.id, email };
    }
    if (data.users.length < 200) break;
  }
  return null;
}

/** Same approach as `pnpm seed:demo otp`: admin magic-link code, exchanged for a session. No password involved. */
async function mintToken(email: string): Promise<string> {
  const link = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw new Error(`generateLink: ${link.error.message}`);
  const key = process.env["SUPABASE_ANON_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  const client = createClient(process.env["SUPABASE_URL"]!, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const verified = await client.auth.verifyOtp({ email, token: link.data.properties.email_otp, type: "email" });
  if (verified.error || !verified.data.session) throw new Error(`verifyOtp: ${verified.error?.message ?? "no session"}`);
  return verified.data.session.access_token;
}

let persona: { id: string; email: string } | null = null;
try {
  persona = await findPersona();
} catch (err) {
  report("FAIL", "demo persona lookup (admin API)", message(err));
}

if (!persona) {
  if (failures === 0) report("SKIP", "authenticated flow", "no demo persona users exist (run `pnpm seed:demo` to create them)");
} else {
  const personaId = persona.id;
  let token = "";
  await check("mint session for demo persona", async () => { token = await mintToken(persona!.email); return "session minted"; });
  if (token) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Reply = { status: number; data: any; error?: { code: string; message: string } };
    const call = async (method: string, path: string, body?: unknown): Promise<Reply> => {
      const res = await app.request(`${api}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const json = (await res.json().catch(() => null)) as { data?: unknown; error?: { code: string; message: string } } | null;
      return { status: res.status, data: json?.data, ...(json?.error ? { error: json.error } : {}) };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = (method: string, path: string, expect: number, detail: (data: any) => string) =>
      check(`${method} ${path.split("?")[0]}`, async () => {
        const r = await call(method, path);
        if (r.status !== expect) throw new Error(`status ${r.status} ${r.error ? `${r.error.code}: ${r.error.message}` : ""}`.trim());
        return detail(r.data);
      });

    await ok("GET", "/me", 200, (d) => `profile for ${d.user.display_name}`);
    await ok("GET", "/courses?q=cs", 200, (d) => `${d.length} courses`);
    await ok("GET", "/buildings", 200, (d) => `${d.length} buildings`);
    await ok("GET", "/me/classes", 200, (d) => `${d.length} class records`);
    await ok("GET", "/me/class-schedule", 200, (d) => `${d.length} meetings`);
    const from = new Date();
    const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    await ok("GET", `/me/availability?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, 200, (d) => `${d.blocks.length} blocks`);

    // Media upload + schedule import. Everything created here is deleted afterwards.
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//live-check//EN", "BEGIN:VEVENT", "UID:live-check-1@example.com",
      "DTSTAMP:20260101T000000Z", "DTSTART;TZID=America/Chicago:20260824T090000", "DTEND;TZID=America/Chicago:20260824T095000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261211T000000Z", "SUMMARY:CH 101", "LOCATION:Shelby Hall 1093", "END:VEVENT", "END:VCALENDAR", "",
    ].join("\r\n");
    const created = { mediaId: "", path: "", jobId: "" };

    await check("POST /media/upload-url + signed upload", async () => {
      const r = await call("POST", "/media/upload-url", { purpose: "schedule", content_type: "text/calendar", bytes: Buffer.byteLength(ics) });
      if (r.status !== 201) throw new Error(`status ${r.status} ${r.error?.message ?? ""}`);
      created.mediaId = r.data.media_id;
      created.path = `${personaId}/${created.mediaId}.ics`;
      const up = await db.storage.from("private-docs").uploadToSignedUrl(created.path, r.data.token, new Blob([ics], { type: "text/calendar" }), { contentType: "text/calendar" });
      if (up.error) throw new Error(`signed upload failed: ${up.error.message}`);
      return "row created, file uploaded to signed URL";
    });
    if (created.mediaId) {
      await ok("POST", `/media/${created.mediaId}/complete`, 200, (d) => `kind ${d.kind}`);
      await check("POST /me/class-schedule/import + GET /jobs/{id}", async () => {
        const r = await call("POST", "/me/class-schedule/import", { kind: "ics", media_id: created.mediaId });
        if (r.status !== 202) throw new Error(`import status ${r.status} ${r.error?.message ?? ""}`);
        created.jobId = r.data.job_id;
        const j = await call("GET", `/jobs/${created.jobId}`);
        if (j.status !== 200) throw new Error(`job status ${j.status}`);
        if (j.data.status !== "succeeded") throw new Error(`job ${j.data.status}: ${j.data.error ?? "no error text"}`);
        return `job succeeded (result keys: ${Object.keys(j.data.result ?? {}).join(", ")})`;
      });
    }

    await check("cleanup of temporary rows", async () => {
      if (created.jobId) { const r = await db.from("jobs").delete().eq("id", created.jobId); if (r.error) throw r.error; }
      if (created.path) { const r = await db.storage.from("private-docs").remove([created.path]); if (r.error) throw r.error; }
      if (created.mediaId) { const r = await db.from("media").delete().eq("id", created.mediaId); if (r.error) throw r.error; }
      return "removed temporary job, media row and file";
    });
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed or skipped");
process.exit(failures ? 1 : 0);
