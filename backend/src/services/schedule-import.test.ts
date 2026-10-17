import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCourseCode, placeFromLocation, suggestMeetings, weeklyDays, type GoogleEvent } from "./schedule-import.js";
import { SEED_COURSES, UA_BUILDINGS, UA_CENTER } from "../db/seed.js";

const TZ = "America/Chicago";
const NOW = new Date("2026-10-17T12:00:00Z");
const courseId = (code: string) => SEED_COURSES.find((c) => c.code === code)!.id;
const building = (name: string) => UA_BUILDINGS.find((b) => b.name === name)!.location;

// Aug 24 2026 is a Monday; Aug 26 Wednesday.
const ev = (over: Partial<GoogleEvent> = {}): GoogleEvent => ({
  id: "e1",
  status: "confirmed",
  summary: "CS 101",
  start: { dateTime: "2026-08-24T09:00:00-05:00" },
  end: { dateTime: "2026-08-24T09:50:00-05:00" },
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261211T055959Z"],
  ...over,
});

test("extractCourseCode", () => {
  assert.equal(extractCourseCode("cs101 lab"), "CS 101");
  assert.equal(extractCourseCode("CS 101"), "CS 101");
  assert.equal(extractCourseCode("MATH-125 Calculus I"), "MATH 125");
  assert.equal(extractCourseCode("Lecture: bsc 114"), "BSC 114");
  assert.equal(extractCourseCode("CS 101L"), "CS 101L");
  assert.equal(extractCourseCode("Gym"), null);
  assert.equal(extractCourseCode("Lunch 123"), null); // 5-letter word isn't a subject prefix
  assert.equal(extractCourseCode(""), null);
});

test("placeFromLocation", () => {
  assert.deepEqual(placeFromLocation("Shelby Hall 1093"), { label: "Shelby Hall 1093", location: building("Shelby Hall") });
  assert.deepEqual(placeFromLocation("  SEC 1001 "), { label: "SEC 1001", location: building("Science and Engineering Complex") });
  assert.deepEqual(placeFromLocation("H.M. Comer 112"), { label: "H.M. Comer 112", location: building("H.M. Comer Hall") });
  assert.deepEqual(placeFromLocation("Gordon Palmer Hall 101"), { label: "Gordon Palmer Hall 101", location: building("Gordon Palmer Hall") });
  assert.deepEqual(placeFromLocation("Some Annex 5"), { label: "Some Annex 5", location: UA_CENTER });
  // alias must be a whole word: "section" shouldn't match "sec"
  assert.deepEqual(placeFromLocation("Section B"), { label: "Section B", location: UA_CENTER });
  assert.equal(placeFromLocation(""), null);
  assert.equal(placeFromLocation("   "), null);
  assert.equal(placeFromLocation(undefined), null);
});

test("weeklyDays parses BYDAY and sorts Mon-first", () => {
  assert.deepEqual(weeklyDays(ev(), TZ, NOW), ["mon", "wed", "fri"]);
  assert.deepEqual(weeklyDays(ev({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=SU,FR,TU"] }), TZ, NOW), ["tue", "fri", "sun"]);
  assert.deepEqual(weeklyDays(ev({ recurrence: ["EXDATE:20260907T090000", "RRULE:FREQ=WEEKLY;WKST=SU;BYDAY=TU,TH"] }), TZ, NOW), ["tue", "thu"]);
});

test("weeklyDays without BYDAY uses the start's local weekday", () => {
  // 2026-08-25T03:00Z is Monday 22:00 in Chicago (Tuesday in UTC)
  const e = ev({ start: { dateTime: "2026-08-25T03:00:00Z" }, recurrence: ["RRULE:FREQ=WEEKLY"] });
  assert.deepEqual(weeklyDays(e, TZ, NOW), ["mon"]);
});

test("weeklyDays UNTIL handling", () => {
  assert.equal(weeklyDays(ev({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260501T045959Z"] }), TZ, NOW), null);
  assert.equal(weeklyDays(ev({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261016"] }), TZ, NOW), null);
  assert.deepEqual(weeklyDays(ev({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261017"] }), TZ, NOW), ["mon"]); // ends end of today
  assert.deepEqual(weeklyDays(ev({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=30"] }), TZ, NOW), ["mon"]);
});

test("weeklyDays rejects non-weekly or non-recurring or all-day", () => {
  assert.equal(weeklyDays(ev({ recurrence: ["RRULE:FREQ=DAILY"] }), TZ, NOW), null);
  assert.equal(weeklyDays(ev({ recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=1MO"] }), TZ, NOW), null);
  const { recurrence: _r, ...single } = ev();
  assert.equal(weeklyDays(single, TZ, NOW), null);
  assert.equal(weeklyDays(ev({ start: { date: "2026-08-24" }, end: { date: "2026-08-25" } }), TZ, NOW), null);
});

test("suggestMeetings: matches catalog, merges per-day events, reports unmatched, ignores noise", () => {
  const events: GoogleEvent[] = [
    // CS 101 as two separate single-day series at the same time → one MW meeting
    ev({ id: "a", summary: "cs101 lecture", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"], start: { dateTime: "2026-08-26T09:00:00-05:00" }, end: { dateTime: "2026-08-26T09:50:00-05:00" } }),
    ev({ id: "b", summary: "CS 101", location: "Shelby Hall 1093", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"] }),
    // Same course at a different time → separate meeting (lab)
    ev({ id: "c", summary: "CS 101 Lab", location: "Mystery Building", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"], start: { dateTime: "2026-08-27T14:00:00-05:00" }, end: { dateTime: "2026-08-27T15:15:00-05:00" } }),
    ev({ id: "d", summary: "MATH 125 - Calculus I", location: "Gordon Palmer 250", start: { dateTime: "2026-08-24T11:00:00-05:00" }, end: { dateTime: "2026-08-24T11:50:00-05:00" } }),
    // Code-like but not in catalog
    ev({ id: "e", summary: "XYZ 999 Seminar", location: "  Lloyd 38 ", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU,TH"], start: { dateTime: "2026-08-25T13:00:00-05:00" }, end: { dateTime: "2026-08-25T14:15:00-05:00" } }),
    // Noise
    ev({ id: "f", summary: "Gym", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU,TH"] }),
    ev({ id: "g", summary: "CH 101", status: "cancelled" }),
    ev({ id: "h", summary: "EN 101", start: { date: "2026-08-24" }, end: { date: "2026-08-25" } }),
    ev({ id: "i", summary: "ST 260 exam", recurrence: [] }),
    ev({ id: "j", summary: "PH 105", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260301"] }),
    ev({ id: "k", summary: "" }),
  ];
  const { meetings, unmatched } = suggestMeetings(events, SEED_COURSES, TZ, NOW);

  assert.deepEqual(meetings, [
    {
      course_id: courseId("CS 101"),
      days: ["mon", "wed"],
      start: "09:00",
      end: "09:50",
      place: { label: "Shelby Hall 1093", location: building("Shelby Hall") },
    },
    {
      course_id: courseId("CS 101"),
      days: ["thu"],
      start: "14:00",
      end: "15:15",
      place: { label: "Mystery Building", location: UA_CENTER },
    },
    {
      course_id: courseId("MATH 125"),
      days: ["mon", "wed", "fri"],
      start: "11:00",
      end: "11:50",
      place: { label: "Gordon Palmer 250", location: building("Gordon Palmer Hall") },
    },
  ]);
  assert.deepEqual(unmatched, [{ title: "XYZ 999 Seminar", days: ["tue", "thu"], start: "13:00", end: "14:15", location_label: "Lloyd 38" }]);
});

test("suggestMeetings reports times in local tz and skips end <= start", () => {
  const { meetings } = suggestMeetings(
    [
      // UTC input, after DST ends: 15:00Z = 09:00 CST
      ev({ summary: "EC 110", start: { dateTime: "2026-11-02T15:00:00Z" }, end: { dateTime: "2026-11-02T16:15:00Z" }, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"] }),
      // crosses midnight → end < start in HH:MM terms
      ev({ summary: "CS 300", start: { dateTime: "2026-08-24T23:00:00-05:00" }, end: { dateTime: "2026-08-25T00:30:00-05:00" } }),
    ],
    SEED_COURSES,
    TZ,
    NOW,
  );
  assert.equal(meetings.length, 1);
  assert.equal(meetings[0]!.course_id, courseId("EC 110"));
  assert.equal(meetings[0]!.start, "09:00");
  assert.equal(meetings[0]!.end, "10:15");
  assert.equal(meetings[0]!.place, null);
});
