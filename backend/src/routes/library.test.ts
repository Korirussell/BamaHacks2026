import assert from "node:assert/strict";
import test from "node:test";
import { demoRoomBooker, manualRoomBooker, staticRoomAvailability } from "../adapters/stubs.js";
import { createApp } from "../app.js";
import { toRoomBooking } from "../db/tutoring.js";
import type { TokenVerifier } from "../middleware/auth.js";
import { FreeRoomSlot } from "../schemas/tutoring.js";

const signedIn: TokenVerifier = async () => ({ sub: "00000000-0000-4000-a000-000000000005", email: "s@crimson.ua.edu", schoolId: "00000000-0000-4000-a000-000000000001" });
const room = { room_id: "1315", name: "Gorgas Team Workroom 2016", capacity: 4, book_url: "https://ua.libcal.com/space/1315" };
const slot = { ...room, start: "2026-10-19T14:30:00.000Z", end: "2026-10-19T15:30:00.000Z" };
const auth = { headers: { Authorization: "Bearer test" } };

test("GET /library/rooms returns free rooms for a valid date", async () => {
  const app = createApp({ verify: signedIn, roomAvailability: staticRoomAvailability([slot]), log: false });
  const res = await app.request("/api/v1/library/rooms?date=2026-10-19", auth);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: unknown[] };
  assert.deepEqual(body.data.map((x) => FreeRoomSlot.parse(x)), [slot]);
});

test("GET /library/rooms validates the date and needs a token", async () => {
  const app = createApp({ verify: signedIn, log: false });
  for (const query of ["", "?date=tomorrow", "?date=2026-13-01"]) {
    const res = await app.request(`/api/v1/library/rooms${query}`, auth);
    assert.equal(res.status, 400, query);
    const body = (await res.json()) as { error: { code: string; field_errors?: Record<string, string> } };
    assert.equal(body.error.code, "VALIDATION");
    assert.ok(body.error.field_errors?.date);
  }
  const empty = await app.request("/api/v1/library/rooms?date=2026-10-19", auth);
  assert.deepEqual(await empty.json(), { data: [] }, "stub availability by default");
  const anon = createApp({ verify: async () => null, log: false });
  assert.equal((await anon.request("/api/v1/library/rooms?date=2026-10-19")).status, 401);
});

test("room bookers link to the picked LibCal room and RoomBooking reads it back", async () => {
  const input = { schoolId: "s", start: slot.start, end: slot.end, partySize: 2 };
  const manual = await manualRoomBooker("https://www.lib.ua.edu/").book({ ...input, room });
  assert.deepEqual(manual, { status: "manual_required", room: { id: "1315", name: room.name }, bookingUrl: room.book_url });
  assert.deepEqual(await manualRoomBooker("https://www.lib.ua.edu/").book({ ...input, room: null }), {
    status: "manual_required", room: null, bookingUrl: "https://www.lib.ua.edu/",
  });
  const demo = await demoRoomBooker("Gorgas Library").book({ ...input, room });
  assert.equal(demo.status, "booked");
  assert.match(demo.room?.name ?? "", /\(demo\)$/);

  assert.deepEqual(toRoomBooking({ room_booking_status: "manual_required", room: manual.room!.name, booking_url: manual.bookingUrl }), {
    status: "manual_required", room: { id: "1315", name: room.name }, booking_url: room.book_url,
  });
  assert.deepEqual(toRoomBooking({ room_booking_status: "pending", room: null, booking_url: null }), { status: "pending", room: null, booking_url: null });
});
