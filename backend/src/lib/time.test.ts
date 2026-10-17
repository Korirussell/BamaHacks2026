import { test } from "node:test";
import assert from "node:assert/strict";
import { localDatesBetween, toHHMM, toMinutes, zonedParts, zonedToUtc } from "./time.js";

const TZ = "America/Chicago";
const iso = (d: Date) => d.toISOString();

test("zonedParts reads wall-clock fields in tz", () => {
  // 2026-10-19 14:05Z = Mon 09:05 CDT
  const p = zonedParts(new Date("2026-10-19T14:05:00Z"), TZ);
  assert.deepEqual(p, { year: 2026, month: 10, day: 19, hour: 9, minute: 5, weekday: "mon" });
  // Late UTC evening is still the previous local day
  const q = zonedParts(new Date("2026-10-20T03:30:00Z"), TZ);
  assert.equal(q.day, 19);
  assert.equal(q.hour, 22);
  assert.equal(q.weekday, "mon");
  // Midnight renders as 00 (h23), not 24
  assert.equal(zonedParts(new Date("2026-10-20T05:00:00Z"), TZ).hour, 0);
});

test("zonedParts across fall-back: 01:30 occurs twice on Nov 1 2026", () => {
  const cdt = zonedParts(new Date("2026-11-01T06:30:00Z"), TZ);
  const cst = zonedParts(new Date("2026-11-01T07:30:00Z"), TZ);
  assert.equal(cdt.hour, 1);
  assert.equal(cst.hour, 1);
  assert.equal(cdt.minute, 30);
  assert.equal(cst.weekday, "sun");
});

test("zonedToUtc in CDT and CST", () => {
  assert.equal(iso(zonedToUtc(2026, 10, 19, 9 * 60, TZ)), "2026-10-19T14:00:00.000Z");
  assert.equal(iso(zonedToUtc(2026, 1, 15, 9 * 60, TZ)), "2026-01-15T15:00:00.000Z");
  assert.equal(iso(zonedToUtc(2026, 10, 19, 0, TZ)), "2026-10-19T05:00:00.000Z");
  assert.equal(iso(zonedToUtc(2026, 10, 19, 23 * 60 + 59, TZ)), "2026-10-20T04:59:00.000Z");
});

test("zonedToUtc on DST-end day (Nov 1 2026)", () => {
  assert.equal(iso(zonedToUtc(2026, 11, 1, 30, TZ)), "2026-11-01T05:30:00.000Z"); // 00:30 CDT
  assert.equal(iso(zonedToUtc(2026, 11, 1, 3 * 60, TZ)), "2026-11-01T09:00:00.000Z"); // 03:00 CST
  assert.equal(iso(zonedToUtc(2026, 11, 1, 8 * 60, TZ)), "2026-11-01T14:00:00.000Z");
  assert.equal(iso(zonedToUtc(2026, 11, 1, 22 * 60, TZ)), "2026-11-02T04:00:00.000Z");
  // Ambiguous 01:30 resolves to one of the two valid instants
  const amb = iso(zonedToUtc(2026, 11, 1, 90, TZ));
  assert.ok(amb === "2026-11-01T06:30:00.000Z" || amb === "2026-11-01T07:30:00.000Z", amb);
});

test("zonedToUtc on DST-start day (Mar 8 2026)", () => {
  assert.equal(iso(zonedToUtc(2026, 3, 8, 60, TZ)), "2026-03-08T07:00:00.000Z"); // 01:00 CST
  assert.equal(iso(zonedToUtc(2026, 3, 8, 3 * 60, TZ)), "2026-03-08T08:00:00.000Z"); // 03:00 CDT
  assert.equal(iso(zonedToUtc(2026, 3, 8, 12 * 60, TZ)), "2026-03-08T17:00:00.000Z");
  assert.equal(iso(zonedToUtc(2026, 3, 7, 12 * 60, TZ)), "2026-03-07T18:00:00.000Z");
});

test("zonedToUtc round-trips through zonedParts", () => {
  for (const [y, m, d] of [[2026, 3, 8], [2026, 7, 4], [2026, 11, 1], [2026, 12, 31]] as const) {
    for (const minutes of [0, 8 * 60, 13 * 60 + 15, 23 * 60 + 45]) {
      const p = zonedParts(zonedToUtc(y, m, d, minutes, TZ), TZ);
      assert.deepEqual([p.year, p.month, p.day, p.hour * 60 + p.minute], [y, m, d, minutes]);
    }
  }
});

test("localDatesBetween lists each local date touched", () => {
  const days = localDatesBetween(new Date("2026-10-19T05:00:00Z"), new Date("2026-10-20T04:59:00Z"), TZ);
  assert.deepEqual(
    days.map((d) => [d.month, d.day, d.weekday]),
    [[10, 19, "mon"]],
  );
  // UTC instants on different UTC dates but same local evening
  const span = localDatesBetween(new Date("2026-10-17T23:00:00Z"), new Date("2026-10-20T02:00:00Z"), TZ);
  assert.deepEqual(
    span.map((d) => `${d.month}/${d.day} ${d.weekday}`),
    ["10/17 sat", "10/18 sun", "10/19 mon"],
  );
});

test("localDatesBetween across DST end and month boundary", () => {
  const days = localDatesBetween(new Date("2026-10-31T05:00:00Z"), new Date("2026-11-02T18:00:00Z"), TZ);
  assert.deepEqual(
    days.map((d) => `${d.month}/${d.day} ${d.weekday}`),
    ["10/31 sat", "11/1 sun", "11/2 mon"],
  );
});

test("toMinutes / toHHMM", () => {
  assert.equal(toMinutes("00:00"), 0);
  assert.equal(toMinutes("09:50"), 590);
  assert.equal(toMinutes("22:00"), 1320);
  assert.equal(toHHMM(0), "00:00");
  assert.equal(toHHMM(590), "09:50");
  assert.equal(toHHMM(1439), "23:59");
  for (const s of ["08:00", "12:34", "23:59"]) assert.equal(toHHMM(toMinutes(s)), s);
});
