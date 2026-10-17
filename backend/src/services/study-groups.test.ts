import assert from "node:assert/strict";
import test from "node:test";
import { suggestStudyTimes } from "./study-groups.js";
import { HOUR, MINUTE } from "./time.js";

const T0 = Date.UTC(2026, 9, 19, 14); // a Monday, 9:00 CDT
const at = (h: number, m = 0) => T0 + h * HOUR + m * MINUTE;

test("suggested times rank slots by classmates free, never overlap, and come back in time order", () => {
  const me = [{ start: at(0), end: at(4) }];
  const classmates = [
    [{ start: at(2), end: at(4) }],
    [{ start: at(2), end: at(3) }],
    [{ start: at(0), end: at(1) }],
  ];
  const slots = suggestStudyTimes(me, classmates, { from: at(0), to: at(4), limit: 2 });
  assert.deepEqual(slots.map((s) => [(s.start - T0) / MINUTE, s.classmates_free]), [[0, 1], [120, 2]]);
});

test("slots need the requester free for the whole hour and stay inside the window", () => {
  const me = [{ start: at(0, 10), end: at(1, 40) }, { start: at(5), end: at(9) }];
  const slots = suggestStudyTimes(me, [], { from: at(0), to: at(6) });
  assert.deepEqual(slots.map((s) => [(s.start - T0) / MINUTE, (s.end - T0) / MINUTE]), [[30, 90], [300, 360]]);
});

test("no requester free time means no suggestions", () => {
  assert.deepEqual(suggestStudyTimes([], [[{ start: at(0), end: at(5) }]], { from: at(0), to: at(5) }), []);
});
