import assert from "node:assert/strict";
import test from "node:test";
import { SYNTHETIC_ROWS } from "../test/transcript-fixture.js";
import { UnrecognizedTranscriptError, parseBannerTranscript, toContractParsed } from "./transcript.js";

const parsed = parseBannerTranscript(SYNTHETIC_ROWS);
const term = (label: string, section: string) => parsed.terms.find((t) => t.term === label && t.section === section);
const codes = (label: string, section: string) => term(label, section)?.classes.map((c) => c.course_code);

test("reads name and cumulative institution GPA", () => {
  assert.equal(parsed.student_name, "Jordan Sample");
  assert.equal(parsed.gpa, 3.9);
});

test("labels terms and sections", () => {
  assert.deepEqual(parsed.terms.map((t) => [t.term, t.section]), [
    ["Transfer: Advanced Placement", "transfer"],
    ["Spring 2025", "transfer"],
    ["Summer 2025", "transfer"],
    ["Fall 2024", "institution"],
    ["Spring 2025", "institution"],
    ["Fall 2025", "in_progress"],
  ]);
  assert.deepEqual(codes("Transfer: Advanced Placement", "transfer"), ["EN 101", "MATH 125"]);
  assert.deepEqual(codes("Summer 2025", "transfer"), ["AY 101"]);
});

test("drops NG companions and repeat-excluded rows, keeps W", () => {
  assert.deepEqual(codes("Fall 2024", "institution"), ["CS 100", "MATH 125"]);
  assert.equal(term("Fall 2024", "institution")?.classes[0]?.grade, "A+");
  assert.deepEqual(codes("Spring 2025", "institution"), ["ECE 380", "PY 101"]);
  assert.equal(term("Spring 2025", "institution")?.classes[1]?.grade, "W");
});

test("keeps titles intact, credits numeric, and in-progress grades null", () => {
  assert.equal(term("Spring 2025", "institution")?.classes[0]?.title, "Digital Logic & Design 2");
  assert.equal(term("Spring 2025", "institution")?.classes[0]?.credits, 4);
  assert.deepEqual(term("Fall 2025", "in_progress")?.classes, [{ course_code: "MIS 505", title: "Enterprise Network & Security", credits: 3, grade: null, matched_course_id: null }]);
});

test("page chrome never leaks into results", () => {
  const all = JSON.stringify(parsed);
  assert.ok(!/Ellucian|rights reserved|https?:|©/.test(all));
});

test("non-transcripts are rejected", () => {
  assert.throws(() => parseBannerTranscript([["Grocery list"], ["Milk", "2"]]), UnrecognizedTranscriptError);
  assert.throws(() => parseBannerTranscript([]), UnrecognizedTranscriptError);
});

test("toContractParsed drops section", () => {
  const out = toContractParsed(parsed);
  assert.ok(out.terms.every((t) => !("section" in t)));
  assert.equal(out.terms.length, parsed.terms.length);
  assert.equal(out.student_name, "Jordan Sample");
});
