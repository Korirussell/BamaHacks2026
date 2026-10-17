import assert from "node:assert/strict";
import test from "node:test";
import { ClassMeetingInput, ScheduleImportResult } from "../schemas/schedule.js";
import { parseIcs } from "./ics.js";
import { extractCourseCode, icsToDrafts, termLabel, type ImportContext } from "./schedule-import.js";

const TZ = "America/Chicago";
const CS101 = "00000000-0000-4000-8000-000000000006";
const CH101 = "00000000-0000-4000-8000-000000000001";
const SHELBY = "00000000-0000-4000-9000-000000000003";
const NERC = "00000000-0000-4000-9000-000000000001";

const ctx: ImportContext = {
  courses: [
    { id: CS101, code: "CS 101" },
    { id: CH101, code: "CH 101" },
  ],
  buildings: [
    { id: SHELBY, code: "SH", name: "Shelby Hall" },
    { id: NERC, code: "NERC", name: "North Engineering Research Center" },
  ],
  schoolTimezone: TZ,
  now: new Date("2026-10-17T12:00:00Z"),
};

const vevent = (props: string[]) => ["BEGIN:VEVENT", ...props, "END:VEVENT"];
const cal = (events: string[][], head: string[] = ["X-WR-TIMEZONE:America/Chicago"]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...head, ...events.flatMap(vevent), "END:VCALENDAR", ""].join("\r\n");
const run = (events: string[][], over: Partial<ImportContext> = {}) => icsToDrafts(parseIcs(cal(events), TZ).events, { ...ctx, ...over });
const weekly = (summary: string, byday: string, start: string, end: string, extra: string[] = [], date = "20260819") => [
  `DTSTART;TZID=America/Chicago:${date}T${start}00`,
  `DTEND;TZID=America/Chicago:${date}T${end}00`,
  `RRULE:FREQ=WEEKLY;BYDAY=${byday}${extra.includes("noUntil") ? "" : ";UNTIL=20261211T055959Z"}`,
  `SUMMARY:${summary}`,
  ...extra.filter((e) => e !== "noUntil"),
];

test("extractCourseCode / termLabel", () => {
  assert.equal(extractCourseCode("cs101 Lecture"), "CS 101");
  assert.equal(extractCourseCode("CS-101 - Intro"), "CS 101");
  assert.equal(extractCourseCode("Work shift"), null);
  assert.equal(termLabel("2026-01-12"), "Spring 2026");
  assert.equal(termLabel("2026-06-01"), "Summer 2026");
  assert.equal(termLabel("2026-08-19"), "Fall 2026");
});

test("Google export sample: building by name, building by code, skip, course_not_found", () => {
  const result = run([
    weekly("CS 101 - Intro", "MO,WE,FR", "0900", "0950", ["LOCATION:Shelby Hall 1093\\, Tuscaloosa\\, AL"], "20260819"),
    weekly("CH101 Lecture", "TU,TH", "1100", "1215", ["LOCATION:SH 2020"], "20260820"),
    weekly("Work shift", "MO,TU,WE", "1500", "2000"),
    weekly("ART 999 Studio", "MO", "1300", "1500", ["LOCATION:Moody Hall"]),
  ]);
  assert.deepEqual(result.drafts, [
    { course_id: CS101, section: null, days: ["mon", "wed", "fri"], start: "09:00", end: "09:50", timezone: TZ, term: "Fall 2026", term_start: "2026-08-19", term_end: "2026-12-10", building_id: SHELBY, room: "1093", source: "ics" },
    { course_id: CH101, section: null, days: ["tue", "thu"], start: "11:00", end: "12:15", timezone: TZ, term: "Fall 2026", term_start: "2026-08-20", term_end: "2026-12-10", building_id: SHELBY, room: "2020", source: "ics" },
  ]);
  assert.deepEqual(result.unmatched, [{ raw_text: "ART 999 Studio @ Moody Hall", reason: "course_not_found" }]);
  assert.equal(result.confidence, 0.67); // 2 good of 2 drafts + 1 course miss
  ScheduleImportResult.parse(result);
  result.drafts.forEach((d) => ClassMeetingInput.parse(d));
});

test("building matching: name prefix, code word, long name, unmatched", () => {
  const loc = (l: string) => run([weekly("CS 101", "MO", "0900", "0950", [`LOCATION:${l}`])]);
  assert.deepEqual([loc("Shelby 1093").drafts[0]?.building_id, loc("Shelby 1093").drafts[0]?.room], [SHELBY, "1093"]);
  assert.deepEqual([loc("NERC 2020").drafts[0]?.building_id, loc("NERC 2020").drafts[0]?.room], [NERC, "2020"]);
  assert.equal(loc("north engineering research center 100").drafts[0]?.building_id, NERC);
  assert.equal(loc("Shelby Hall").drafts[0]?.room, null);
  assert.equal(loc("SHELF 12").drafts[0]?.building_id, null); // SH is a whole-word match only

  const miss = loc("Mystery Building 5");
  assert.equal(miss.drafts[0]?.building_id, null);
  assert.equal(miss.drafts[0]?.room, "Mystery Building 5");
  assert.deepEqual(miss.unmatched, [{ raw_text: "CS 101 @ Mystery Building 5", reason: "building_not_found" }]);
  assert.equal(miss.confidence, 0);
});

test("empty location: no building, no room, no unmatched, full confidence", () => {
  const r = run([weekly("CS 101", "MO", "0900", "0950")]);
  assert.equal(r.drafts[0]?.building_id, null);
  assert.equal(r.drafts[0]?.room, null);
  assert.deepEqual(r.unmatched, []);
  assert.equal(r.confidence, 1);
});

test("per-day split events merge into one draft", () => {
  const r = run([
    weekly("CS 101", "FR", "0900", "0950", [], "20260821"),
    weekly("CS 101", "MO", "0900", "0950", ["LOCATION:SH 1093"], "20260819"),
    weekly("CS 101", "WE", "0900", "0950", ["LOCATION:SH 1093"], "20260819"),
  ]);
  assert.equal(r.drafts.length, 1);
  assert.deepEqual(r.drafts[0]?.days, ["mon", "wed", "fri"]);
  assert.equal(r.drafts[0]?.term_start, "2026-08-19");
  assert.equal(r.drafts[0]?.building_id, SHELBY);
});

test("ended series, one-off events, cancelled events and non-weekly rules are ignored", () => {
  const r = run([
    ["DTSTART;TZID=America/Chicago:20260119T090000", "DTEND;TZID=America/Chicago:20260119T095000", "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260501T000000Z", "SUMMARY:CS 101"],
    ["DTSTART;TZID=America/Chicago:20261020T090000", "DTEND;TZID=America/Chicago:20261020T095000", "SUMMARY:CS 101 exam"],
    ["DTSTART;TZID=America/Chicago:20260819T090000", "DTEND;TZID=America/Chicago:20260819T095000", "RRULE:FREQ=WEEKLY;BYDAY=MO", "SUMMARY:CS 101", "STATUS:CANCELLED"],
    ["DTSTART;TZID=America/Chicago:20260819T090000", "DTEND;TZID=America/Chicago:20260819T095000", "RRULE:FREQ=DAILY", "SUMMARY:CS 101"],
    ["DTSTART;VALUE=DATE:20260819", "RRULE:FREQ=WEEKLY", "SUMMARY:CS 101"],
  ]);
  assert.deepEqual(r, { drafts: [], unmatched: [], confidence: 0 });
});

test("no UNTIL: term_end is 16 weeks after the first meeting; weekday from DTSTART when no BYDAY", () => {
  const r = icsToDrafts(
    parseIcs(cal([["DTSTART;TZID=America/Chicago:20260819T090000", "DTEND;TZID=America/Chicago:20260819T095000", "RRULE:FREQ=WEEKLY", "SUMMARY:cs101"]]), TZ).events,
    ctx,
  );
  assert.equal(r.drafts[0]?.term_end, "2026-12-09");
  assert.deepEqual(r.drafts[0]?.days, ["wed"]);
});

test("timezone: TZID wins, then calendar zone, then school zone", () => {
  const utcEvent = ["DTSTART:20260819T140000Z", "DTEND:20260819T145000Z", "RRULE:FREQ=WEEKLY;BYDAY=WE", "SUMMARY:CS 101"];
  const noCal = icsToDrafts(parseIcs(cal([utcEvent], []), TZ).events, ctx);
  assert.equal(noCal.drafts[0]?.timezone, TZ);
  assert.equal(noCal.drafts[0]?.start, "09:00");
  const ny = icsToDrafts(parseIcs(cal([utcEvent], ["X-WR-TIMEZONE:America/New_York"]), TZ).events, ctx);
  assert.equal(ny.drafts[0]?.timezone, "America/New_York");
  assert.equal(ny.drafts[0]?.start, "10:00");
});
