import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import { applyTutorAvailability, availabilityWindows } from "./tutoring.js";

const iso = (hour: number) => `2026-10-19T${String(hour).padStart(2, "0")}:00:00.000Z`;

test("declared tutor availability restricts free time while empty availability preserves it", () => {
  const availability = {
    recurring: [{ days: ["mon" as const], start: "09:00", end: "11:00" }],
    one_off: [{ start: iso(13), end: iso(14), kind: "free" as const }],
  };
  const free = [{ start: Date.parse(iso(8)), end: Date.parse(iso(10)) }, { start: Date.parse(iso(12)), end: Date.parse(iso(15)) }];
  const from = Date.parse(iso(0));
  const to = Date.parse("2026-10-20T00:00:00.000Z");
  assert.deepEqual(availabilityWindows(availability, from, to, "UTC"), [
    { start: Date.parse(iso(9)), end: Date.parse(iso(11)) },
    { start: Date.parse(iso(13)), end: Date.parse(iso(14)) },
  ]);
  assert.deepEqual(applyTutorAvailability(free, availability, from, to, "UTC"), [
    { start: Date.parse(iso(9)), end: Date.parse(iso(10)) },
    { start: Date.parse(iso(13)), end: Date.parse(iso(14)) },
  ]);
  assert.deepEqual(applyTutorAvailability(free, { recurring: [], one_off: [] }, from, to, "UTC"), free);
});

test("tutor availability and review routes reject missing tokens", async () => {
  const app = createApp({ verify: async () => null, log: false });
  for (const [path, method] of [
    ["/me/tutor-availability/suggested?week_of=2026-10-19T00:00:00.000Z", "GET"],
    ["/me/tutor-availability", "PUT"],
    ["/reviews", "POST"],
  ] as const) {
    assert.equal((await app.request(`/api/v1${path}`, { method })).status, 401, path);
  }
});
