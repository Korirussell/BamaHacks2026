import type { FreeRoomSlot, LibraryRoom } from "../adapters/ports.js";

/**
 * The first room free for the whole of [start, end) (UTC ms). A room's consecutive free slots are merged, so a
 * 90-minute session fits two back-to-back 1-hour slots; any taken part in between means it isn't covered.
 * Rooms are tried smallest first (then by name) so a pair of people doesn't take the biggest room.
 */
export function freeRoomFor(free: FreeRoomSlot[], start: number, end: number): LibraryRoom | null {
  const byRoom = new Map<string, FreeRoomSlot[]>();
  for (const slot of free) byRoom.set(slot.room_id, [...(byRoom.get(slot.room_id) ?? []), slot]);
  const rooms = [...byRoom.values()].sort((a, b) => a[0]!.capacity - b[0]!.capacity || a[0]!.name.localeCompare(b[0]!.name));
  for (const slots of rooms) {
    const sorted = slots.map((s) => ({ start: Date.parse(s.start), end: Date.parse(s.end) })).sort((a, b) => a.start - b.start);
    let runStart = -Infinity;
    let runEnd = -Infinity;
    for (const s of sorted) {
      if (s.start > runEnd) runStart = s.start; // gap: start a new free run
      runEnd = Math.max(runEnd, s.end);
      if (runStart <= start && runEnd >= end) {
        const { room_id, name, capacity, book_url } = slots[0]!;
        return { room_id, name, capacity, book_url };
      }
    }
  }
  return null;
}
