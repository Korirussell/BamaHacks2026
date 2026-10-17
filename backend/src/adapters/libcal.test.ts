import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { libcalAvailability, libcalSpaceId, libcalTimeToUtc, parseGrid, parseSpacesPage, type Fetch } from "./libcal.js";

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
const gridJson = fixture("libcal-grid-2026-10-19.json");
const spacesHtml = fixture("libcal-spaces-lid214.html");

/** Serves the fixtures and records every call. */
function fakeLibcal(opts: { fail?: boolean } = {}) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init });
    if (opts.fail) throw new Error("network down");
    if (url.includes("/spaces/availability/grid")) return new Response(gridJson, { headers: { "Content-Type": "application/json" } });
    if (url.includes("/spaces?lid=214")) return new Response(spacesHtml, { headers: { "Content-Type": "text/html" } });
    return new Response("not found", { status: 404 });
  };
  return { fetch, calls };
}

test("parseSpacesPage reads every Gorgas Team Workroom name and capacity", () => {
  const rooms = parseSpacesPage(spacesHtml);
  assert.equal(rooms.size, 8);
  assert.deepEqual(rooms.get(1315), { name: "Gorgas Team Workroom 2016", capacity: 4 });
  assert.deepEqual(rooms.get(49270), { name: "Gorgas Team Work Space 1", capacity: 5 });
  assert.equal(parseSpacesPage("<html>maintenance</html>").size, 0);
});

test("libcalTimeToUtc converts America/Chicago wall time across DST", () => {
  assert.equal(new Date(libcalTimeToUtc("2026-10-19 09:30:00")!).toISOString(), "2026-10-19T14:30:00.000Z"); // CDT, UTC-5
  assert.equal(new Date(libcalTimeToUtc("2026-11-02 09:30:00")!).toISOString(), "2026-11-02T15:30:00.000Z"); // CST, UTC-6
  assert.equal(new Date(libcalTimeToUtc("2026-03-09 09:30:00")!).toISOString(), "2026-03-09T14:30:00.000Z"); // day after spring forward
  assert.equal(new Date(libcalTimeToUtc("2026-10-20 00:00:00")!).toISOString(), "2026-10-20T05:00:00.000Z"); // midnight end of day
  assert.equal(libcalTimeToUtc("tomorrow"), null);
});

test("parseGrid keeps only slots without a className", () => {
  const grid = JSON.parse(gridJson) as { slots: Array<{ className?: string }> };
  const taken = grid.slots.filter((s) => s.className).length;
  assert.ok(taken > 0, "fixture has taken slots");
  const free = parseGrid(JSON.parse(gridJson), parseSpacesPage(spacesHtml));
  assert.equal(free.length, grid.slots.length - taken);
  // 1315 is checked out 11:30-14:30 local on 2026-10-19 (16:30-19:30Z).
  const room1315 = free.filter((s) => s.room_id === "1315").map((s) => s.start);
  assert.ok(room1315.includes("2026-10-19T14:30:00.000Z"));
  assert.ok(!room1315.includes("2026-10-19T16:30:00.000Z"));
  assert.deepEqual(free.find((s) => s.room_id === "1315" && s.start === "2026-10-19T14:30:00.000Z"), {
    room_id: "1315", name: "Gorgas Team Workroom 2016", capacity: 4,
    start: "2026-10-19T14:30:00.000Z", end: "2026-10-19T15:30:00.000Z", book_url: "https://ua.libcal.com/space/1315",
  });
  const synthetic = parseGrid({ slots: [
    { start: "2026-10-19 10:00:00", end: "2026-10-19 11:00:00", itemId: 1316, className: "s-lc-eq-r-unavailable" },
    { start: "2026-10-19 10:00:00", end: "2026-10-19 11:00:00", itemId: 1317, className: "label-eq-unavailable" },
    { start: "2026-10-19 10:00:00", end: "2026-10-19 11:00:00", itemId: 1318 },
  ] }, new Map());
  assert.deepEqual(synthetic.map((s) => [s.room_id, s.name, s.capacity]), [["1318", "Gorgas Team Workroom", 4]]);
});

test("libcalAvailability posts the grid request politely and caches each day for 60 s", async () => {
  const { fetch, calls } = fakeLibcal();
  let now = Date.parse("2026-10-18T12:00:00Z");
  const availability = libcalAvailability({ fetch, now: () => now, log: () => {} });

  const first = await availability.freeRooms("2026-10-19");
  assert.ok(first.length > 0);
  assert.equal(first[0]!.name.startsWith("Gorgas Team Work"), true);
  const grid = calls.find((c) => c.url.endsWith("/spaces/availability/grid"))!;
  assert.equal(grid.init?.method, "POST");
  const headers = grid.init?.headers as Record<string, string>;
  assert.match(headers["User-Agent"] ?? "", /BamaHacks2026/);
  assert.equal(headers["X-Requested-With"], "XMLHttpRequest");
  assert.equal(headers.Referer, "https://ua.libcal.com/spaces?lid=214");
  const body = new URLSearchParams(String(grid.init?.body));
  assert.deepEqual([body.get("lid"), body.get("gid"), body.get("start"), body.get("end")], ["214", "436", "2026-10-19", "2026-10-20"]);
  assert.ok(grid.init?.signal instanceof AbortSignal);

  const callsAfterFirst = calls.length;
  now += 30_000;
  assert.deepEqual(await availability.freeRooms("2026-10-19"), first);
  assert.equal(calls.length, callsAfterFirst, "cache hit makes no request");

  now += 31_000;
  await availability.freeRooms("2026-10-19");
  assert.equal(calls.filter((c) => c.url.endsWith("/grid")).length, 2, "refetches after 60 s");
  assert.equal(calls.filter((c) => c.url.includes("/spaces?lid=214")).length, 1, "room names stay cached");
});

test("libcalAvailability returns [] and logs once when LibCal fails", async () => {
  const { fetch } = fakeLibcal({ fail: true });
  const logs: string[] = [];
  let now = 0;
  const availability = libcalAvailability({ fetch, now: () => now, log: (m) => logs.push(m) });
  assert.deepEqual(await availability.freeRooms("2026-10-19"), []);
  now += 61_000;
  assert.deepEqual(await availability.freeRooms("2026-10-19"), []);
  assert.deepEqual(await availability.freeRooms("2026-10-20"), []);
  assert.equal(logs.filter((m) => m.includes("availability")).length, 1);
  assert.deepEqual(await availability.freeRooms("not-a-day"), []);
});

test("libcalAvailability returns [] on an HTTP error or an unexpected body", async () => {
  for (const response of [new Response("busy", { status: 503 }), new Response("<html>login</html>")]) {
    const availability = libcalAvailability({
      fetch: async (url) => (url.includes("/grid") ? response.clone() : new Response(spacesHtml)),
      log: () => {},
    });
    assert.deepEqual(await availability.freeRooms("2026-10-19"), []);
  }
});

test("libcalSpaceId reads the room id back from a booking URL", () => {
  assert.equal(libcalSpaceId("https://ua.libcal.com/space/49270"), "49270");
  assert.equal(libcalSpaceId("https://www.lib.ua.edu/"), null);
  assert.equal(libcalSpaceId(null), null);
});
