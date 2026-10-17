// Demo personas for both demo flows. Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.
//
//   pnpm seed:demo              reset demo state and (re)create the personas
//   pnpm seed:demo otp student  print a 6-digit sign-in code for a persona (no email is sent)
//
// Users are created through the admin API so the auth.users triggers (0004_auth.sql) set
// school_id and create their profiles. Re-running keeps the users (and their app sessions) and
// resets everything they did: sessions, offers, orders, handoffs, the Instagram seller's listings.

import { adminClient } from "../lib/supabase.js";

const SCHOOL = "00000000-0000-4000-a000-000000000001";
const TERM = { term: "Fall 2026", term_start: "2026-08-19", term_end: "2026-12-11" } as const;
const PAST = "Fall 2025";
const INSTAGRAM_HANDLE = "bama_books";

const course = {
  CH101: "00000000-0000-4000-e000-000000000001",
  CH102: "00000000-0000-4000-e000-000000000002",
  MATH125: "00000000-0000-4000-e000-000000000003",
  MATH126: "00000000-0000-4000-e000-000000000004",
  CS100: "00000000-0000-4000-e000-000000000005",
  CS101: "00000000-0000-4000-e000-000000000006",
  BSC114: "00000000-0000-4000-e000-000000000007",
  EC110: "00000000-0000-4000-e000-000000000008",
  PH105: "00000000-0000-4000-e000-000000000009",
  EN101: "00000000-0000-4000-e000-00000000000a",
} as const;
const building = {
  NERC: "00000000-0000-4000-b000-000000000001",
  SHELBY: "00000000-0000-4000-b000-000000000003",
  BIDGOOD: "00000000-0000-4000-b000-000000000007",
  GORDON_PALMER: "00000000-0000-4000-b000-00000000000b",
  MORGAN: "00000000-0000-4000-b000-00000000000c",
} as const;

type Day = "mon" | "tue" | "wed" | "thu" | "fri";
const MWF: Day[] = ["mon", "wed", "fri"];
const TR: Day[] = ["tue", "thu"];

interface Persona {
  id: string;
  email: string;
  display_name: string;
  major: string;
  grad_year: number;
  profile?: { mail_stop_code?: string; tutor_opt_in?: boolean; is_admin?: boolean; completed_count?: number };
  /** Past classes with transcript-verified grades (what tutoring eligibility reads). */
  transcript?: { course: string; grade: string }[];
  current?: string[];
  meetings?: { course: string; days: Day[]; start: string; end: string; building: string; room: string }[];
  tutor?: { rate_cents: number; bio: string; modes: ("in_person" | "virtual")[]; courses: string[] };
}

const personas: Record<string, Persona> = {
  // Demo 1: needs a CH 101 tutor.
  student: {
    id: "00000000-0000-4000-9000-000000000001",
    email: "bamahacks.student@crimson.ua.edu",
    display_name: "Jordan Lee",
    major: "Biology",
    grad_year: 2030,
    current: [course.CH101, course.MATH125, course.EN101, course.BSC114],
    meetings: [
      { course: course.CH101, days: MWF, start: "09:00", end: "09:50", building: building.SHELBY, room: "1093" },
      { course: course.EN101, days: MWF, start: "11:00", end: "11:50", building: building.MORGAN, room: "301" },
      { course: course.MATH125, days: TR, start: "09:30", end: "10:45", building: building.GORDON_PALMER, room: "250" },
      { course: course.BSC114, days: TR, start: "14:00", end: "15:15", building: building.SHELBY, room: "2010" },
    ],
  },
  // Best match: verified A, schedule leaves plenty of overlap with Jordan.
  tutor_ava: {
    id: "00000000-0000-4000-9000-000000000002",
    email: "bamahacks.ava@crimson.ua.edu",
    display_name: "Ava Thompson",
    major: "Chemistry",
    grad_year: 2028,
    profile: { tutor_opt_in: true, completed_count: 14 },
    transcript: [{ course: course.CH101, grade: "A" }, { course: course.MATH125, grade: "A-" }],
    current: [course.CH102, course.PH105],
    meetings: [
      { course: course.CH102, days: MWF, start: "10:00", end: "10:50", building: building.SHELBY, room: "1095" },
      { course: course.PH105, days: TR, start: "11:00", end: "12:15", building: building.GORDON_PALMER, room: "227" },
    ],
    tutor: { rate_cents: 2500, bio: "Chem major, TA'd CH 101 labs. Happy to do practice exams.", modes: ["in_person", "virtual"], courses: [course.CH101, course.MATH125] },
  },
  // Second match: cheaper, busier schedule.
  tutor_marcus: {
    id: "00000000-0000-4000-9000-000000000003",
    email: "bamahacks.marcus@crimson.ua.edu",
    display_name: "Marcus Green",
    major: "Chemical Engineering",
    grad_year: 2028,
    profile: { tutor_opt_in: true, completed_count: 4 },
    transcript: [{ course: course.CH101, grade: "A-" }, { course: course.CS100, grade: "A" }],
    current: [course.CS101, course.MATH126],
    meetings: [
      { course: course.CS101, days: MWF, start: "13:00", end: "13:50", building: building.NERC, room: "1013" },
      { course: course.MATH126, days: TR, start: "09:30", end: "10:45", building: building.GORDON_PALMER, room: "246" },
      { course: course.MATH126, days: ["wed"], start: "15:00", end: "15:50", building: building.GORDON_PALMER, room: "246" },
    ],
    tutor: { rate_cents: 1800, bio: "ChemE sophomore. I explain stoichiometry with food.", modes: ["in_person"], courses: [course.CH101, course.CS100] },
  },
  // Opted in but B+ is below UA's A- threshold: GET /tutors must leave her out.
  tutor_priya: {
    id: "00000000-0000-4000-9000-000000000004",
    email: "bamahacks.priya@crimson.ua.edu",
    display_name: "Priya Patel",
    major: "Nursing",
    grad_year: 2029,
    profile: { tutor_opt_in: true },
    transcript: [{ course: course.CH101, grade: "B+" }],
    current: [course.BSC114],
    meetings: [{ course: course.BSC114, days: TR, start: "14:00", end: "15:15", building: building.SHELBY, room: "2010" }],
    tutor: { rate_cents: 1500, bio: "Nursing student.", modes: ["in_person"], courses: [course.CH101] },
  },
  // Demo 2 buyer: in CH 101, so the ingested chem book is "for your class". Has a mail stop.
  buyer: {
    id: "00000000-0000-4000-9000-000000000005",
    email: "bamahacks.buyer@crimson.ua.edu",
    display_name: "Riley Carter",
    major: "Pre-med",
    grad_year: 2030,
    profile: { mail_stop_code: "870123" },
    current: [course.CH101, course.EC110],
    meetings: [
      { course: course.CH101, days: MWF, start: "09:00", end: "09:50", building: building.SHELBY, room: "1093" },
      { course: course.EC110, days: TR, start: "12:30", end: "13:45", building: building.BIDGOOD, room: "122" },
    ],
  },
  // Demo 2 seller: owns @bama_books on Instagram, signs in through the claim link during the demo.
  seller: {
    id: "00000000-0000-4000-9000-000000000006",
    email: "bamahacks.seller@crimson.ua.edu",
    display_name: "Sam Rivera",
    major: "Finance",
    grad_year: 2027,
    profile: { mail_stop_code: "870456", completed_count: 6 },
    transcript: [{ course: course.CH101, grade: "B" }],
    current: [course.EC110],
    meetings: [{ course: course.EC110, days: TR, start: "12:30", end: "13:45", building: building.BIDGOOD, room: "122" }],
  },
  // Team account for /admin (ingest posts, copy seller-invite DMs).
  admin: {
    id: "00000000-0000-4000-9000-000000000007",
    email: "bamahacks.admin@crimson.ua.edu",
    display_name: "BamaHacks Team",
    major: "—",
    grad_year: 2027,
    profile: { is_admin: true },
  },
};

const db = adminClient();
const ids = Object.values(personas).map((p) => p.id);

const completedTutoringSessions = [
  ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-9000-000000000002", "00000000-0000-4000-9000-000000000001", "2026-09-01T15:00:00.000Z", 5],
  ["00000000-0000-4000-8000-000000000102", "00000000-0000-4000-9000-000000000002", "00000000-0000-4000-9000-000000000005", "2026-09-03T15:00:00.000Z", 5],
  ["00000000-0000-4000-8000-000000000103", "00000000-0000-4000-9000-000000000002", "00000000-0000-4000-9000-000000000006", "2026-09-05T15:00:00.000Z", 5],
  ["00000000-0000-4000-8000-000000000104", "00000000-0000-4000-9000-000000000002", "00000000-0000-4000-9000-000000000004", "2026-09-08T15:00:00.000Z", 5],
  ["00000000-0000-4000-8000-000000000105", "00000000-0000-4000-9000-000000000002", "00000000-0000-4000-9000-000000000003", "2026-09-10T15:00:00.000Z", 5],
  ["00000000-0000-4000-8000-000000000106", "00000000-0000-4000-9000-000000000002", "00000000-0000-4000-9000-000000000007", "2026-09-12T15:00:00.000Z", 4],
  ["00000000-0000-4000-8000-000000000107", "00000000-0000-4000-9000-000000000003", "00000000-0000-4000-9000-000000000001", "2026-09-15T15:00:00.000Z", 5],
  ["00000000-0000-4000-8000-000000000108", "00000000-0000-4000-9000-000000000003", "00000000-0000-4000-9000-000000000005", "2026-09-17T15:00:00.000Z", 4],
] as const;

async function run(label: string, query: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function resetDemoState() {
  const list = `(${ids.join(",")})`;
  const sellerListings = await db.from("listings").select("id").eq("school_id", SCHOOL)
    .or(`seller_id.in.${list},external_handle.eq.${INSTAGRAM_HANDLE}`);
  if (sellerListings.error) throw sellerListings.error;
  const listingIds = sellerListings.data.map((l: { id: string }) => l.id);

  // Children before parents: orders → listings is not cascading; shipments cascade from orders.
  await run("orders", db.from("orders").delete().or(`buyer_id.in.${list},seller_id.in.${list}`));
  if (listingIds.length) await run("orders on listings", db.from("orders").delete().in("listing_id", listingIds));
  await run("handoffs", db.from("handoffs").delete().or(`giver_id.in.${list},receiver_id.in.${list}`));
  await run("offers", db.from("offers").delete().or(`buyer_id.in.${list},seller_id.in.${list}`));
  await run("seller invites", db.from("seller_invites").delete().eq("school_id", SCHOOL).eq("handle", INSTAGRAM_HANDLE));
  if (listingIds.length) await run("listings", db.from("listings").delete().in("id", listingIds));
  // So the demo post can be ingested again: re-sending a known URL is a no-op.
  await run("ingested posts", db.from("ingested_posts").delete().eq("school_id", SCHOOL).ilike("author_handle", `%${INSTAGRAM_HANDLE}`));
  await run("ingest jobs", db.from("jobs").delete().eq("kind", "ingest_classify").in("user_id", ids));
  await run("tutoring sessions", db.from("tutoring_sessions").delete().or(`tutor_id.in.${list},student_id.in.${list}`));
  await run("reviews", db.from("reviews").delete().or(`from_id.in.${list},to_id.in.${list}`));
  await run("notifications", db.from("notifications").delete().in("user_id", ids));
}

async function ensureUser(p: Persona) {
  const existing = await db.auth.admin.getUserById(p.id);
  if (existing.data.user) return;
  const { error } = await db.auth.admin.createUser({
    id: p.id,
    email: p.email,
    email_confirm: true,
    user_metadata: { display_name: p.display_name },
  });
  if (error) throw new Error(`create ${p.email}: ${error.message}`);
}

async function seedPersona(p: Persona) {
  await ensureUser(p);
  await run(`profile ${p.email}`, db.from("profiles").update({
    display_name: p.display_name,
    major: p.major,
    grad_year: p.grad_year,
    mail_stop_code: p.profile?.mail_stop_code ?? null,
    tutor_opt_in: p.profile?.tutor_opt_in ?? false,
    is_admin: p.profile?.is_admin ?? false,
    completed_count: p.profile?.completed_count ?? 0,
    no_show_count: 0,
  }).eq("id", p.id));

  await run("class records", db.from("class_records").delete().eq("user_id", p.id));
  const records = [
    ...(p.transcript ?? []).map((t) => ({ course_id: t.course, term: PAST, status: "past", grade: t.grade, grade_source: "transcript", grade_verified: true })),
    ...(p.current ?? []).map((c) => ({ course_id: c, term: TERM.term, status: "current", grade: null, grade_source: "self_reported", grade_verified: false })),
  ].map((r) => ({ ...r, school_id: SCHOOL, user_id: p.id }));
  if (records.length) await run("class records", db.from("class_records").insert(records));

  await run("meetings", db.from("class_meetings").delete().eq("user_id", p.id));
  const meetings = (p.meetings ?? []).map((m) => ({
    school_id: SCHOOL, user_id: p.id, course_id: m.course, section: "001", days: m.days,
    start_time: m.start, end_time: m.end, timezone: "America/Chicago", ...TERM,
    building_id: m.building, room: m.room, source: "manual",
  }));
  if (meetings.length) await run("meetings", db.from("class_meetings").insert(meetings));

  await run("tutor profile", db.from("tutor_profiles").delete().eq("user_id", p.id)); // cascades tutor_courses
  if (p.tutor) {
    await run("tutor profile", db.from("tutor_profiles").insert({
      user_id: p.id, school_id: SCHOOL, enabled: true, hourly_rate_cents: p.tutor.rate_cents,
      bio: p.tutor.bio, modes: p.tutor.modes, open_to_requests: true,
    }));
    await run("tutor courses", db.from("tutor_courses").insert(p.tutor.courses.map((course_id) => ({ user_id: p.id, course_id }))));
  }
}

/** Fixed historical sessions give the tutoring demo stable, visible reputation. */
async function seedTutoringReputation() {
  const sessions = completedTutoringSessions.map(([id, tutor_id, student_id, start_at]) => {
    const end_at = new Date(Date.parse(start_at) + 60 * 60 * 1000).toISOString();
    return {
      id, school_id: SCHOOL, tutor_id, student_id, course_id: course.CH101, start_at, end_at, price_cents: tutor_id === "00000000-0000-4000-9000-000000000002" ? 2500 : 1800,
      location_kind: "virtual", location_name: null, safe_zone_id: null, meeting_url: "https://example.test/tutoring", room_booking_status: "not_needed",
      status: "completed", waiting_on: null, history: [], notes: null,
    };
  });
  await run("completed tutoring sessions", db.from("tutoring_sessions").insert(sessions));
  const reviews = completedTutoringSessions.map(([context_id, to_id, from_id, , stars]) => ({
    school_id: SCHOOL, from_id, to_id, context_type: "tutoring_session", context_id, stars,
    on_time: true, as_described: true, comment: "Helpful tutoring session.",
  }));
  await run("tutoring reviews", db.from("reviews").insert(reviews));
}

async function printOtp(name: string) {
  const p = personas[name];
  if (!p) throw new Error(`Unknown persona "${name}". Pick one of: ${Object.keys(personas).join(", ")}`);
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email: p.email });
  if (error) throw new Error(`otp ${p.email}: ${error.message}`);
  console.log(`${p.display_name} <${p.email}>\ncode: ${data.properties.email_otp}\n(in the app: enter the email, then this code; it expires in about an hour)`);
}

const [command, arg] = process.argv.slice(2);
if (command === "otp") {
  await printOtp(arg ?? "");
} else {
  await resetDemoState();
  for (const p of Object.values(personas)) await seedPersona(p);
  await seedTutoringReputation();
  console.log("Demo personas ready:");
  for (const [name, p] of Object.entries(personas)) console.log(`  ${name.padEnd(13)} ${p.email}  (${p.display_name})`);
  console.log(`\nSign in as one: pnpm seed:demo otp <name>`);
}
