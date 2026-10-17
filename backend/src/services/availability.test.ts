import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAvailability, expandMeetings, mergeIntervals, subtractIntervals, type Interval } from "./availability.js";
import type { Day } from "../schemas/academics.js";

const TZ = "America/Chicago";
const t = (s: string) => Date.parse(s);
const iv = (a: string, b: string): Interval => ({ start: t(a), end: t(b) });
const asIso = (list: Interval[]) => list.map((i) => [new Date(i.start).toISOString(), new Date(i.end).toISOString()]);
const meeting = (days: Day[], start: string, end: string) => ({ days, start, end });

test("mergeIntervals sorts, merges overlapping and touching, drops empty", () => {
  const input = [
    { start: 50, end: 60 },
    { start: 10, end: 20 },
    { start: 15, end: 30 },
    { start: 30, end: 40 },
    { start: 70, end: 70 },
    { start: 90, end: 80 },
  ];
  const copy = structuredClone(input);
  assert.deepEqual(mergeIntervals(input), [
    { start: 10, end: 40 },
    { start: 50, end: 60 },
  ]);
  assert.deepEqual(input, copy, "input not mutated");
  assert.deepEqual(mergeIntervals([]), []);
  assert.deepEqual(mergeIntervals([{ start: 0, end: 100 }, { start: 10, end: 20 }]), [{ start: 0, end: 100 }]);
});

test("subtractIntervals", () => {
  assert.deepEqual(subtractIntervals([{ start: 0, end: 100 }], [{ start: 20, end: 30 }, { start: 50, end: 60 }]), [
    { start: 0, end: 20 },
    { start: 30, end: 50 },
    { start: 60, end: 100 },
  ]);
  // Cuts overhanging both edges
  assert.deepEqual(subtractIntervals([{ start: 10, end: 20 }], [{ start: 0, end: 12 }, { start: 18, end: 99 }]), [{ start: 12, end: 18 }]);
  // Fully covered → nothing
  assert.deepEqual(subtractIntervals([{ start: 10, end: 20 }], [{ start: 0, end: 30 }]), []);
  // No overlap → unchanged
  assert.deepEqual(subtractIntervals([{ start: 10, end: 20 }], [{ start: 20, end: 30 }]), [{ start: 10, end: 20 }]);
  // Multiple bases, unsorted subtrahends
  assert.deepEqual(
    subtractIntervals([{ start: 0, end: 10 }, { start: 20, end: 30 }], [{ start: 25, end: 27 }, { start: 5, end: 22 }]),
    [{ start: 0, end: 5 }, { start: 22, end: 25 }, { start: 27, end: 30 }],
  );
  assert.deepEqual(subtractIntervals([], [{ start: 0, end: 1 }]), []);
});

test("expandMeetings: MWF class over one week", () => {
  // Mon Oct 19 00:00 CDT → Mon Oct 26 00:00 CDT
  const out = expandMeetings([meeting(["mon", "wed", "fri"], "09:00", "09:50")], new Date("2026-10-19T05:00:00Z"), new Date("2026-10-26T05:00:00Z"), TZ);
  assert.deepEqual(asIso(out), [
    ["2026-10-19T14:00:00.000Z", "2026-10-19T14:50:00.000Z"],
    ["2026-10-21T14:00:00.000Z", "2026-10-21T14:50:00.000Z"],
    ["2026-10-23T14:00:00.000Z", "2026-10-23T14:50:00.000Z"],
  ]);
});

test("expandMeetings keeps local wall-clock across DST end", () => {
  const out = expandMeetings([meeting(["fri", "mon"], "09:00", "10:15")], new Date("2026-10-30T05:00:00Z"), new Date("2026-11-03T06:00:00Z"), TZ);
  assert.deepEqual(asIso(out), [
    ["2026-10-30T14:00:00.000Z", "2026-10-30T15:15:00.000Z"], // CDT
    ["2026-11-02T15:00:00.000Z", "2026-11-02T16:15:00.000Z"], // CST
  ]);
});

test("expandMeetings clips to [from, to) and merges back-to-back classes", () => {
  const out = expandMeetings(
    [meeting(["mon"], "09:00", "10:00"), meeting(["mon"], "10:00", "11:00")],
    new Date("2026-10-19T14:30:00Z"),
    new Date("2026-10-19T15:30:00Z"),
    TZ,
  );
  assert.deepEqual(asIso(out), [["2026-10-19T14:30:00.000Z", "2026-10-19T15:30:00.000Z"]]);
  // Range entirely outside meeting times → empty
  assert.deepEqual(expandMeetings([meeting(["tue"], "09:00", "10:00")], new Date("2026-10-19T05:00:00Z"), new Date("2026-10-20T05:00:00Z"), TZ), []);
});

test("computeAvailability: one day with class, overlapping busy, and late busy", () => {
  const blocks = computeAvailability({
    from: new Date("2026-10-19T05:00:00Z"), // Mon 00:00 CDT
    to: new Date("2026-10-20T05:00:00Z"), // Tue 00:00 CDT
    meetings: [meeting(["mon", "wed"], "09:00", "09:50")],
    busy: [
      iv("2026-10-19T14:30:00Z", "2026-10-19T16:00:00Z"), // 09:30–11:00, overlaps class
      iv("2026-10-20T04:00:00Z", "2026-10-20T04:30:00Z"), // 23:00–23:30, outside free window
    ],
    tz: TZ,
  });
  assert.deepEqual(blocks, [
    { start: "2026-10-19T13:00:00.000Z", end: "2026-10-19T14:00:00.000Z", kind: "free" },
    { start: "2026-10-19T14:00:00.000Z", end: "2026-10-19T14:50:00.000Z", kind: "class" },
    { start: "2026-10-19T14:50:00.000Z", end: "2026-10-19T16:00:00.000Z", kind: "busy" },
    { start: "2026-10-19T16:00:00.000Z", end: "2026-10-20T03:00:00.000Z", kind: "free" },
    { start: "2026-10-20T04:00:00.000Z", end: "2026-10-20T04:30:00.000Z", kind: "busy" },
  ]);
});

test("computeAvailability: busy fully inside a class disappears; blocks don't overlap", () => {
  const blocks = computeAvailability({
    from: new Date("2026-10-19T13:00:00Z"),
    to: new Date("2026-10-19T17:00:00Z"),
    meetings: [meeting(["mon"], "09:00", "11:00")],
    busy: [iv("2026-10-19T14:30:00Z", "2026-10-19T15:00:00Z"), iv("2026-10-19T15:30:00Z", "2026-10-19T16:00:00Z")],
    tz: TZ,
  });
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["free", "class", "free"],
  );
  for (let i = 1; i < blocks.length; i++) assert.ok(blocks[i - 1]!.end <= blocks[i]!.start);
});

test("computeAvailability clips everything to [from, to)", () => {
  const blocks = computeAvailability({
    from: new Date("2026-10-19T14:30:00Z"), // mid-class 09:30
    to: new Date("2026-10-19T18:00:00Z"), // 13:00
    meetings: [meeting(["mon"], "09:00", "10:00")],
    busy: [iv("2026-10-19T17:00:00Z", "2026-10-19T20:00:00Z"), iv("2026-10-18T00:00:00Z", "2026-10-18T01:00:00Z")],
    tz: TZ,
  });
  assert.deepEqual(blocks, [
    { start: "2026-10-19T14:30:00.000Z", end: "2026-10-19T15:00:00.000Z", kind: "class" },
    { start: "2026-10-19T15:00:00.000Z", end: "2026-10-19T17:00:00.000Z", kind: "free" },
    { start: "2026-10-19T17:00:00.000Z", end: "2026-10-19T18:00:00.000Z", kind: "busy" },
  ]);
});

test("computeAvailability: free window follows local time on DST-end day (Nov 1 2026)", () => {
  const blocks = computeAvailability({
    from: new Date("2026-11-01T05:00:00Z"), // Sun 00:00 CDT
    to: new Date("2026-11-02T06:00:00Z"), // Mon 00:00 CST
    meetings: [],
    busy: [],
    tz: TZ,
  });
  assert.deepEqual(blocks, [{ start: "2026-11-01T14:00:00.000Z", end: "2026-11-02T04:00:00.000Z", kind: "free" }]);
});

test("computeAvailability: free window on DST-start day (Mar 8 2026) and custom dayWindow", () => {
  const blocks = computeAvailability({
    from: new Date("2026-03-08T06:00:00Z"), // Sun 00:00 CST
    to: new Date("2026-03-09T05:00:00Z"), // Mon 00:00 CDT
    meetings: [],
    busy: [],
    tz: TZ,
    dayWindow: { start: "10:00", end: "12:00" },
  });
  assert.deepEqual(blocks, [{ start: "2026-03-08T15:00:00.000Z", end: "2026-03-08T17:00:00.000Z", kind: "free" }]);
});

test("computeAvailability over multiple days yields one free window per day", () => {
  const blocks = computeAvailability({
    from: new Date("2026-10-19T05:00:00Z"),
    to: new Date("2026-10-22T05:00:00Z"),
    meetings: [],
    busy: [],
    tz: TZ,
  });
  assert.equal(blocks.length, 3);
  assert.ok(blocks.every((b) => b.kind === "free"));
  assert.deepEqual(blocks[2], { start: "2026-10-21T13:00:00.000Z", end: "2026-10-22T03:00:00.000Z", kind: "free" });
});
