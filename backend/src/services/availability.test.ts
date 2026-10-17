import assert from "node:assert/strict";
import test from "node:test";
import { composeAvailability, trimBusy, type BusyInterval } from "./availability.js";
import { HOUR, zonedToUtc } from "./time.js";

const tz = "America/Chicago";
const at = (time: string) => zonedToUtc("2026-10-19", time, tz);
const cls = (s: string, e: string): BusyInterval => ({ start: at(s), end: at(e), kind: "class", label: "CH 101" });

test("trimBusy removes class overlap and drops fully covered busy", () => {
  const out = trimBusy(
    [{ start: at("09:00"), end: at("12:00") }, { start: at("13:00"), end: at("13:30") }],
    [cls("10:00", "11:00"), cls("13:00", "14:00")],
  );
  assert.deepEqual(out, [
    { start: at("09:00"), end: at("10:00"), kind: "busy" },
    { start: at("11:00"), end: at("12:00"), kind: "busy" },
  ]);
});

test("composeAvailability returns class, busy and free blocks, busy not duplicated under classes", () => {
  const from = at("08:00");
  const to = at("14:00");
  const blocks = composeAvailability([cls("09:00", "10:00")], [{ start: at("09:30"), end: at("11:00") }, { start: at("07:00"), end: at("08:30") }], from, to, tz);
  const summary = blocks.map((b) => [b.kind, Date.parse(b.start), Date.parse(b.end)]);
  assert.deepEqual(summary, [
    ["busy", from, at("08:30")],
    ["free", at("08:30"), at("09:00")],
    ["class", at("09:00"), at("10:00")],
    ["busy", at("10:00"), at("11:00")],
    ["free", at("11:00"), to],
  ].sort((a, b) => (a[1] as number) - (b[1] as number)));
  assert.ok(blocks.every((b) => Date.parse(b.end) - Date.parse(b.start) > 0 && Date.parse(b.end) - Date.parse(b.start) <= 6 * HOUR));
});
