import { test } from "node:test";
import assert from "node:assert/strict";
import { busyFromEvents, parseIcs, type IcsEvent } from "./ics.js";
import { suggestMeetings } from "./schedule-import.js";
import { SEED_COURSES, UA_BUILDINGS } from "../db/seed.js";

const TZ = "America/Chicago";
const t = (s: string) => Date.parse(s);
const iso = (list: { start: number; end: number }[]) => list.map((i) => [new Date(i.start).toISOString(), new Date(i.end).toISOString()]);
const courseId = (code: string) => SEED_COURSES.find((c) => c.code === code)!.id;
const building = (name: string) => UA_BUILDINGS.find((b) => b.name === name)!.location;

/** Wrap VEVENT body lines in a calendar; `head` adds calendar-level props. */
const cal = (events: string[][], head: string[] = [], eol = "\n") =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...head, ...events.flatMap((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"]), "END:VCALENDAR", ""].join(eol);

const one = (props: string[], head: string[] = [], fallback = TZ) => {
  const r = parseIcs(cal([props], head), fallback);
  return { ...r, ev: r.events[0] };
};

test("parseIcs: TZID local, UTC and floating DTSTART", () => {
  // Aug 24 2026 is CDT (UTC-5)
  const local = one(["DTSTART;TZID=America/Chicago:20260824T090000", "DTEND;TZID=America/Chicago:20260824T095000", "SUMMARY:Local"]);
  assert.equal(local.ev?.start?.dateTime, "2026-08-24T14:00:00.000Z");
  assert.equal(local.ev?.end?.dateTime, "2026-08-24T14:50:00.000Z");
  assert.equal(local.ev?.status, "confirmed");
  assert.equal(local.ev?.transparent, false);

  const utc = one(["DTSTART:20260824T140000Z", "DTEND:20260824T145000Z"]);
  assert.equal(utc.ev?.start?.dateTime, "2026-08-24T14:00:00.000Z");
  assert.equal(utc.ev?.summary, undefined);

  // floating uses the fallback tz when the calendar declares none
  const floating = one(["DTSTART:20260824T090000", "DTEND:20260824T095000"], [], "America/New_York");
  assert.equal(floating.ev?.start?.dateTime, "2026-08-24T13:00:00.000Z");
  assert.equal(floating.timezone, null);
});

test("parseIcs: floating events use X-WR-TIMEZONE over the fallback", () => {
  const r = one(["DTSTART:20260824T090000", "DTEND:20260824T095000"], ["X-WR-TIMEZONE:America/Los_Angeles"]);
  assert.equal(r.timezone, "America/Los_Angeles");
  assert.equal(r.ev?.start?.dateTime, "2026-08-24T16:00:00.000Z");
});

test("parseIcs: invalid X-WR-TIMEZONE is ignored", () => {
  const r = one(["DTSTART:20260824T090000", "DTEND:20260824T095000"], ["X-WR-TIMEZONE:Not/AZone"]);
  assert.equal(r.timezone, null);
  assert.equal(r.ev?.start?.dateTime, "2026-08-24T14:00:00.000Z");
});

test("parseIcs: without X-WR-TIMEZONE the first DTSTART TZID becomes the timezone", () => {
  const r = one(["DTSTART;TZID=America/New_York:20260824T090000", "DTEND;TZID=America/New_York:20260824T095000"]);
  assert.equal(r.timezone, "America/New_York");
  assert.equal(r.ev?.start?.dateTime, "2026-08-24T13:00:00.000Z");
});

test("parseIcs: quoted TZID param (with other params) is understood", () => {
  const r = one(['DTSTART;TZID="America/Chicago":20260824T090000', 'DTEND;TZID="America/Chicago":20260824T095000']);
  assert.equal(r.timezone, "America/Chicago");
  assert.equal(r.ev?.start?.dateTime, "2026-08-24T14:00:00.000Z");
  // a colon inside a quoted param doesn't end the params early
  const colon = one(['DTSTART;X-FOO="a:b";TZID=America/Chicago:20260824T090000', "DTEND;TZID=America/Chicago:20260824T095000"]);
  assert.equal(colon.ev?.start?.dateTime, "2026-08-24T14:00:00.000Z");
});

test("parseIcs: unknown TZID (Outlook style) falls back without throwing", () => {
  const r = one(
    ["DTSTART;TZID=Central Standard Time:20260824T090000", "DTEND;TZID=Central Standard Time:20260824T095000"],
    [],
    "America/Chicago",
  );
  assert.equal(r.timezone, null);
  assert.equal(r.ev?.start?.dateTime, "2026-08-24T14:00:00.000Z");
  assert.equal(r.ev?.end?.dateTime, "2026-08-24T14:50:00.000Z");
});

test("parseIcs: VALUE=DATE all-day events are dropped, others kept", () => {
  const r = parseIcs(
    cal([
      ["DTSTART;VALUE=DATE:20260824", "DTEND;VALUE=DATE:20260825", "SUMMARY:Holiday"],
      ["DTSTART:20260824T140000Z", "DTEND:20260824T150000Z", "SUMMARY:Class"],
    ]),
    TZ,
  );
  assert.deepEqual(r.events.map((e) => e.summary), ["Class"]);
});

test("parseIcs: DURATION replaces DTEND", () => {
  const r = one(["DTSTART:20260824T140000Z", "DURATION:PT1H15M"]);
  assert.equal(r.ev?.end?.dateTime, "2026-08-24T15:15:00.000Z");
  const days = one(["DTSTART:20260824T140000Z", "DURATION:P1DT30M"]);
  assert.equal(days.ev?.end?.dateTime, "2026-08-25T14:30:00.000Z");
});

test("parseIcs: missing end, end <= start, or no DTSTART are dropped", () => {
  assert.equal(one(["DTSTART:20260824T140000Z"]).ev, undefined);
  assert.equal(one(["DTSTART:20260824T140000Z", "DTEND:20260824T140000Z"]).ev, undefined);
  assert.equal(one(["DTSTART:20260824T140000Z", "DTEND:20260824T130000Z"]).ev, undefined);
  assert.equal(one(["DTSTART:20260824T140000Z", "DURATION:garbage"]).ev, undefined);
  assert.equal(one(["SUMMARY:No start", "DTEND:20260824T140000Z"]).ev, undefined);
});

test("parseIcs: STATUS:CANCELLED and TRANSP:TRANSPARENT", () => {
  const base = ["DTSTART:20260824T140000Z", "DTEND:20260824T150000Z"];
  assert.equal(one([...base, "STATUS:CANCELLED"]).ev?.status, "cancelled");
  assert.equal(one([...base, "STATUS:cancelled"]).ev?.status, "cancelled");
  assert.equal(one([...base, "STATUS:TENTATIVE"]).ev?.status, "confirmed");
  assert.equal(one([...base, "TRANSP:TRANSPARENT"]).ev?.transparent, true);
  assert.equal(one([...base, "TRANSP:OPAQUE"]).ev?.transparent, false);
});

test("parseIcs: RRULE becomes a recurrence entry", () => {
  const r = one(["DTSTART:20260824T140000Z", "DTEND:20260824T150000Z", "RRULE:FREQ=WEEKLY;BYDAY=MO"]);
  assert.deepEqual(r.ev?.recurrence, ["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
  assert.equal("exdates" in (r.ev ?? {}), false);
});

test("parseIcs: EXDATE single, comma list, and multiple lines", () => {
  const base = ["DTSTART;TZID=America/Chicago:20260824T090000", "DTEND;TZID=America/Chicago:20260824T095000"];
  const single = one([...base, "EXDATE;TZID=America/Chicago:20260831T090000"]);
  assert.deepEqual(single.ev?.exdates, [t("2026-08-31T14:00:00Z")]);

  const list = one([...base, "EXDATE;TZID=America/Chicago:20260831T090000,20260907T090000"]);
  assert.deepEqual(list.ev?.exdates, [t("2026-08-31T14:00:00Z"), t("2026-09-07T14:00:00Z")]);

  const multi = one([...base, "EXDATE:20260914T140000Z", "EXDATE;TZID=America/Chicago:20260921T090000"]);
  assert.deepEqual(multi.ev?.exdates, [t("2026-09-14T14:00:00Z"), t("2026-09-21T14:00:00Z")]);
});

test("parseIcs: unfolds continuation lines (space and tab) and handles CRLF", () => {
  const text = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "DTSTART:20260824T140000Z",
    "DTEND:20260824T150000Z",
    "SUMMARY:CS 101 - Intro to Comp",
    " uter Science",
    "LOCATION:Shelby",
    "\t Hall 1093",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const { events } = parseIcs(text, TZ);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.summary, "CS 101 - Intro to Computer Science");
  assert.equal(events[0]?.location, "Shelby Hall 1093");
  // lone CR line endings (old Mac) also work
  assert.equal(parseIcs(text.replace(/\r\n/g, "\r"), TZ).events.length, 1);
});

test("parseIcs: unescapes text in SUMMARY and LOCATION", () => {
  const r = one([
    "DTSTART:20260824T140000Z",
    "DTEND:20260824T150000Z",
    String.raw`SUMMARY:Lab\, section A\; bring laptop\nSecond line`,
    String.raw`LOCATION:Shelby Hall 1093\, Tuscaloosa \\ back`,
  ]);
  assert.equal(r.ev?.summary, "Lab, section A; bring laptop\nSecond line");
  assert.equal(r.ev?.location, "Shelby Hall 1093, Tuscaloosa \\ back");
});

test("parseIcs: nested VALARM props don't leak or break parsing", () => {
  const text = cal([
    [
      "DTSTART:20260824T140000Z",
      "DTEND:20260824T150000Z",
      "SUMMARY:Real summary",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-PT10M",
      "SUMMARY:Alarm summary",
      "DTSTART:20200101T000000Z",
      "STATUS:CANCELLED",
      "TRANSP:TRANSPARENT",
      "DESCRIPTION:Reminder",
      "END:VALARM",
      "LOCATION:After alarm",
    ],
    ["DTSTART:20260825T140000Z", "DTEND:20260825T150000Z", "SUMMARY:Second"],
  ]);
  const { events } = parseIcs(text, TZ);
  assert.equal(events.length, 2);
  assert.equal(events[0]?.summary, "Real summary");
  assert.equal(events[0]?.start?.dateTime, "2026-08-24T14:00:00.000Z");
  assert.equal(events[0]?.status, "confirmed");
  assert.equal(events[0]?.transparent, false);
  assert.equal(events[0]?.location, "After alarm"); // props after END:VALARM still count
  assert.equal(events[1]?.summary, "Second");
});

test("parseIcs: ignores garbage and non-event input", () => {
  assert.deepEqual(parseIcs("", TZ), { events: [], timezone: null });
  assert.deepEqual(parseIcs("hello\nworld", TZ), { events: [], timezone: null });
});

// --- busyFromEvents ---

const ev = (over: Partial<IcsEvent> = {}): IcsEvent => ({
  status: "confirmed",
  start: { dateTime: "2026-10-26T14:00:00Z" }, // Mon 09:00 CDT
  end: { dateTime: "2026-10-26T14:50:00Z" },
  ...over,
});
const win = (a: string, b: string) => [new Date(a), new Date(b)] as const;

test("busyFromEvents: single event is clipped to the window", () => {
  const e = ev();
  const [a, b] = win("2026-10-26T14:30:00Z", "2026-10-26T20:00:00Z");
  assert.deepEqual(iso(busyFromEvents([e], a, b, TZ)), [["2026-10-26T14:30:00.000Z", "2026-10-26T14:50:00.000Z"]]);
  const [c, d] = win("2026-10-26T12:00:00Z", "2026-10-26T14:20:00Z");
  assert.deepEqual(iso(busyFromEvents([e], c, d, TZ)), [["2026-10-26T14:00:00.000Z", "2026-10-26T14:20:00.000Z"]]);
  // outside the window / touching the edge
  const [f, g] = win("2026-10-26T14:50:00Z", "2026-10-26T18:00:00Z");
  assert.deepEqual(busyFromEvents([e], f, g, TZ), []);
  const [h, i] = win("2026-10-26T10:00:00Z", "2026-10-26T14:00:00Z");
  assert.deepEqual(busyFromEvents([e], h, i, TZ), []);
});

test("busyFromEvents: WEEKLY BYDAY keeps local time across the Nov 1 2026 DST change", () => {
  const e = ev({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"] });
  const [a, b] = win("2026-10-25T05:00:00Z", "2026-11-08T06:00:00Z");
  assert.deepEqual(iso(busyFromEvents([e], a, b, TZ)), [
    ["2026-10-26T14:00:00.000Z", "2026-10-26T14:50:00.000Z"], // Mon CDT
    ["2026-10-28T14:00:00.000Z", "2026-10-28T14:50:00.000Z"], // Wed CDT
    ["2026-10-30T14:00:00.000Z", "2026-10-30T14:50:00.000Z"], // Fri CDT
    ["2026-11-02T15:00:00.000Z", "2026-11-02T15:50:00.000Z"], // Mon CST
    ["2026-11-04T15:00:00.000Z", "2026-11-04T15:50:00.000Z"], // Wed CST
    ["2026-11-06T15:00:00.000Z", "2026-11-06T15:50:00.000Z"], // Fri CST
  ]);
});

test("busyFromEvents: weekly without BYDAY uses the start's local weekday", () => {
  const e = ev({ recurrence: ["RRULE:FREQ=WEEKLY"] });
  const [a, b] = win("2026-11-01T06:00:00Z", "2026-11-15T06:00:00Z");
  assert.deepEqual(iso(busyFromEvents([e], a, b, TZ)).map((x) => x[0]), ["2026-11-02T15:00:00.000Z", "2026-11-09T15:00:00.000Z"]);
});

test("busyFromEvents: UNTIL stops expansion (date and date-time forms)", () => {
  const [a, b] = win("2026-10-25T05:00:00Z", "2026-11-15T06:00:00Z");
  const dateTime = ev({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261102T145959Z"] });
  assert.deepEqual(iso(busyFromEvents([dateTime], a, b, TZ)).map((x) => x[0]), ["2026-10-26T14:00:00.000Z"]);
  const dateOnly = ev({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261102"] }); // inclusive of that day
  assert.deepEqual(iso(busyFromEvents([dateOnly], a, b, TZ)).map((x) => x[0]), ["2026-10-26T14:00:00.000Z", "2026-11-02T15:00:00.000Z"]);
});

test("busyFromEvents: COUNT counts occurrences before the window", () => {
  // Series began Mon Sep 14 2026: COUNT=3 → Sep 14, 21, 28 only
  const e = ev({
    start: { dateTime: "2026-09-14T14:00:00Z" },
    end: { dateTime: "2026-09-14T14:50:00Z" },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3"],
  });
  const [a, b] = win("2026-10-12T05:00:00Z", "2026-10-26T05:00:00Z");
  assert.deepEqual(busyFromEvents([e], a, b, TZ), []);
  const [c, d] = win("2026-09-20T05:00:00Z", "2026-10-26T05:00:00Z");
  assert.deepEqual(iso(busyFromEvents([e], c, d, TZ)).map((x) => x[0]), ["2026-09-21T14:00:00.000Z", "2026-09-28T14:00:00.000Z"]);
  // COUNT with multiple BYDAY: first week Mon/Wed/Fri then stop at 4 → next Monday only
  const multi = ev({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=4"] });
  const [f, g] = win("2026-10-25T05:00:00Z", "2026-11-15T06:00:00Z");
  assert.deepEqual(iso(busyFromEvents([multi], f, g, TZ)).map((x) => x[0]), [
    "2026-10-26T14:00:00.000Z",
    "2026-10-28T14:00:00.000Z",
    "2026-10-30T14:00:00.000Z",
    "2026-11-02T15:00:00.000Z",
  ]);
});

test("busyFromEvents: DAILY", () => {
  const e = ev({ recurrence: ["RRULE:FREQ=DAILY"] });
  const [a, b] = win("2026-10-27T05:00:00Z", "2026-10-30T05:00:00Z");
  assert.deepEqual(iso(busyFromEvents([e], a, b, TZ)).map((x) => x[0]), [
    "2026-10-27T14:00:00.000Z",
    "2026-10-28T14:00:00.000Z",
    "2026-10-29T14:00:00.000Z",
  ]);
});

test("busyFromEvents: EXDATE removes that occurrence", () => {
  const e = ev({
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"],
    exdates: [t("2026-10-28T14:00:00Z")],
  });
  const [a, b] = win("2026-10-25T05:00:00Z", "2026-11-01T05:00:00Z");
  assert.deepEqual(iso(busyFromEvents([e], a, b, TZ)).map((x) => x[0]), ["2026-10-26T14:00:00.000Z"]);
  // also applies to non-recurring events
  const single = ev({ exdates: [t("2026-10-26T14:00:00Z")] });
  assert.deepEqual(busyFromEvents([single], a, b, TZ), []);
});

test("busyFromEvents: cancelled, transparent, and unsupported frequencies are ignored", () => {
  const [a, b] = win("2026-10-25T05:00:00Z", "2026-11-30T06:00:00Z");
  assert.deepEqual(busyFromEvents([ev({ status: "cancelled" })], a, b, TZ), []);
  assert.deepEqual(busyFromEvents([ev({ transparent: true })], a, b, TZ), []);
  assert.deepEqual(busyFromEvents([ev({ recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=1MO"] })], a, b, TZ), []);
  assert.deepEqual(busyFromEvents([ev({ recurrence: ["RRULE:FREQ=YEARLY"] })], a, b, TZ), []);
  assert.deepEqual(busyFromEvents([{ status: "confirmed", start: { date: "2026-10-26" }, end: { date: "2026-10-27" } }], a, b, TZ), []);
});

test("busyFromEvents: a series from 2015 yields the right 2026 occurrences, quickly", () => {
  // Mon Jan 5 2015 09:00 CST
  const e = ev({
    start: { dateTime: "2015-01-05T15:00:00Z" },
    end: { dateTime: "2015-01-05T15:50:00Z" },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"],
  });
  const [a, b] = win("2026-10-25T05:00:00Z", "2026-11-04T20:00:00Z");
  const t0 = performance.now();
  const out = busyFromEvents([e], a, b, TZ);
  assert.ok(performance.now() - t0 < 1000, "should not walk 11 years of days");
  assert.deepEqual(iso(out).map((x) => x[0]), [
    "2026-10-26T14:00:00.000Z",
    "2026-10-28T14:00:00.000Z",
    "2026-11-02T15:00:00.000Z",
    "2026-11-04T15:00:00.000Z",
  ]);
});

test("parseIcs + busyFromEvents end to end with EXDATE and weekly rule", () => {
  const text = cal([
    [
      "DTSTART;TZID=America/Chicago:20260824T090000",
      "DTEND;TZID=America/Chicago:20260824T095000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE;TZID=America/Chicago:20260907T090000",
    ],
  ]);
  const { events } = parseIcs(text, TZ);
  const [a, b] = win("2026-09-01T05:00:00Z", "2026-09-15T05:00:00Z");
  assert.deepEqual(iso(busyFromEvents(events, a, b, TZ)).map((x) => x[0]), ["2026-09-14T14:00:00.000Z"]);
});

// --- integration with schedule-import ---

test("Google Calendar export → suggestMeetings", () => {
  const text = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Fall 2026",
    "X-WR-TIMEZONE:America/Chicago",
    "BEGIN:VEVENT",
    "DTSTART;TZID=America/Chicago:20260824T090000",
    "DTEND;TZID=America/Chicago:20260824T095000",
    "RRULE:FREQ=WEEKLY;WKST=SU;UNTIL=20261211T055959Z;BYDAY=MO,WE,FR",
    "DTSTAMP:20261017T120000Z",
    "UID:abc123@google.com",
    "CREATED:20260801T120000Z",
    "LOCATION:Shelby Hall 1093\\, Tuscaloosa",
    "SEQUENCE:0",
    "STATUS:CONFIRMED",
    "SUMMARY:CS 101 - Intro",
    "TRANSP:OPAQUE",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:This is an event reminder",
    "TRIGGER:-P0DT0H10M0S",
    "END:VALARM",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;TZID=America/Chicago:20260825T110000",
    "DTEND;TZID=America/Chicago:20260825T122000",
    "RRULE:FREQ=WEEKLY;WKST=SU;UNTIL=20261211T055959Z;BYDAY=TU,TH",
    "DTSTAMP:20261017T120000Z",
    "UID:def456@google.com",
    "LOCATION:Gordon Palmer Hall 101",
    "STATUS:CONFIRMED",
    "SUMMARY:MATH125 Lecture",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

  const { events, timezone } = parseIcs(text, "UTC");
  assert.equal(timezone, "America/Chicago");
  assert.equal(events.length, 2);

  const { meetings, unmatched } = suggestMeetings(events, SEED_COURSES, timezone ?? TZ, new Date("2026-10-17T12:00:00Z"));
  assert.deepEqual(unmatched, []);
  assert.deepEqual(meetings, [
    {
      course_id: courseId("CS 101"),
      days: ["mon", "wed", "fri"],
      start: "09:00",
      end: "09:50",
      place: { label: "Shelby Hall 1093, Tuscaloosa", location: building("Shelby Hall") },
    },
    {
      course_id: courseId("MATH 125"),
      days: ["tue", "thu"],
      start: "11:00",
      end: "12:20",
      place: { label: "Gordon Palmer Hall 101", location: building("Gordon Palmer Hall") },
    },
  ]);
});
