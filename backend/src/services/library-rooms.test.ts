import assert from "node:assert/strict";
import test from "node:test";
import type { FreeRoomSlot } from "../adapters/ports.js";
import { freeRoomFor } from "./library-rooms.js";

const at = (hhmm: string) => Date.parse(`2026-10-19T${hhmm}:00.000Z`);
const slot = (room_id: string, start: string, end: string, capacity = 4): FreeRoomSlot => ({
  room_id, name: `Room ${room_id}`, capacity, start: `2026-10-19T${start}:00.000Z`, end: `2026-10-19T${end}:00.000Z`,
  book_url: `https://ua.libcal.com/space/${room_id}`,
});

test("freeRoomFor merges consecutive free slots of one room", () => {
  const free = [slot("1315", "15:30", "16:30"), slot("1315", "14:30", "15:30")];
  assert.deepEqual(freeRoomFor(free, at("14:30"), at("16:00")), {
    room_id: "1315", name: "Room 1315", capacity: 4, book_url: "https://ua.libcal.com/space/1315",
  });
});

test("freeRoomFor needs every part of the slot free", () => {
  const free = [slot("1315", "14:30", "15:30"), slot("1315", "16:30", "17:30"), slot("1316", "15:00", "16:00")];
  assert.equal(freeRoomFor(free, at("15:00"), at("17:00")), null, "gap in 1315 at 15:30-16:30; 1316 too short");
  assert.equal(freeRoomFor(free, at("15:00"), at("16:00"))?.room_id, "1316");
  assert.equal(freeRoomFor([], at("15:00"), at("16:00")), null);
});

test("freeRoomFor prefers the smallest room that fits", () => {
  const free = [slot("49270", "14:00", "18:00", 5), slot("1320", "14:00", "18:00", 4)];
  assert.equal(freeRoomFor(free, at("15:00"), at("16:00"))?.room_id, "1320");
});
