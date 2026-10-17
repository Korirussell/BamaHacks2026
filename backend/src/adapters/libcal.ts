import { z } from "zod";
import { addDays, iso, zonedToUtc } from "../services/time.js";
import type { FreeRoomSlot, RoomAvailability } from "./ports.js";

// UA Libraries' Springshare LibCal. Read-only: we only call the two public endpoints its booking page uses
// without signing in (the spaces page and the availability grid). Nothing here books or submits anything.

const BASE = "https://ua.libcal.com";
const LID = 214; // Gorgas Library
const GID = 436; // Team Workrooms
const TZ = "America/Chicago";
const USER_AGENT = "BamaHacks2026-demo (student hackathon project)";
const TIMEOUT_MS = 4_000;
const DAY_TTL_MS = 60_000;
const ROOMS_TTL_MS = 6 * 60 * 60_000;
const FALLBACK_NAME = "Gorgas Team Workroom";
/** Gorgas Team Workrooms (Oct 2026), used when the spaces page can't be read. */
const KNOWN_CAPACITY: Readonly<Record<number, number>> = { 1315: 4, 1316: 4, 1317: 4, 1318: 4, 1319: 4, 1320: 4, 49270: 5, 49271: 5 };

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export type RoomInfo = { name: string; capacity: number };

const GridResponse = z.object({
  slots: z.array(z.object({ start: z.string(), end: z.string(), itemId: z.number().int(), className: z.string().nullish() })),
});
export type GridResponse = z.infer<typeof GridResponse>;

export const libcalBookUrl = (eid: number | string) => `${BASE}/space/${eid}`;

/** The LibCal room id in a booking URL we built with libcalBookUrl, if it is one. */
export function libcalSpaceId(url: string | null): string | null {
  return url?.match(/^https:\/\/ua\.libcal\.com\/space\/(\d+)$/)?.[1] ?? null;
}

const jsString = String.raw`"(?:[^"\\]|\\.)*"`;
const decode = (literal: string): string | null => {
  try {
    const value: unknown = JSON.parse(literal);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
};

/** Room names and capacities from the spaces page's inline `resources.push({...})` / `resourceNameIdMap` script. */
export function parseSpacesPage(html: string): Map<number, RoomInfo> {
  const out = new Map<number, RoomInfo>();
  for (const [, body = ""] of html.matchAll(/resources\.push\(\{([\s\S]*?)\}\);/g)) {
    const eid = Number(body.match(/\beid:\s*(\d+)/)?.[1]);
    if (!Number.isInteger(eid) || eid <= 0) continue;
    const title = decode(body.match(new RegExp(String.raw`\btitle:\s*(${jsString})`))?.[1] ?? "")?.replace(/\s*\(Capacity \d+\)$/, "");
    const capacity = Number(body.match(/\bcapacity:\s*(\d+)/)?.[1] ?? KNOWN_CAPACITY[eid] ?? 0);
    out.set(eid, { name: title || FALLBACK_NAME, capacity });
  }
  for (const [, eid, literal = ""] of html.matchAll(new RegExp(String.raw`resourceNameIdMap\["eid_(\d+)"\]\s*=\s*(${jsString})`, "g"))) {
    const name = decode(literal);
    const id = Number(eid);
    if (name) out.set(id, { name, capacity: out.get(id)?.capacity ?? KNOWN_CAPACITY[id] ?? 0 });
  }
  return out;
}

/** "2026-10-19 09:30:00" (America/Chicago wall clock) → UTC epoch ms. */
export function libcalTimeToUtc(value: string): number | null {
  const m = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/);
  return m?.[1] && m[2] ? zonedToUtc(m[1], m[2], TZ) : null;
}

/** Free slots in a grid response. A slot with any className (checkout, unavailable, ...) is taken. */
export function parseGrid(grid: GridResponse, rooms: Map<number, RoomInfo>): FreeRoomSlot[] {
  const out: FreeRoomSlot[] = [];
  for (const slot of grid.slots) {
    if (slot.className) continue;
    const start = libcalTimeToUtc(slot.start);
    const end = libcalTimeToUtc(slot.end);
    if (start === null || end === null || end <= start) continue;
    const info = rooms.get(slot.itemId);
    out.push({
      room_id: String(slot.itemId),
      name: info?.name ?? FALLBACK_NAME,
      capacity: info?.capacity ?? KNOWN_CAPACITY[slot.itemId] ?? 0,
      start: iso(start),
      end: iso(end),
      book_url: libcalBookUrl(slot.itemId),
    });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
}

/**
 * Free Gorgas Team Workrooms from LibCal. Each day is cached 60 s (failures too, so an outage costs one call a
 * minute), room names 6 h. Never throws: on any failure it logs once and returns [].
 */
export function libcalAvailability(opts: { fetch?: Fetch; now?: () => number; log?: (message: string) => void } = {}): RoomAvailability {
  const doFetch: Fetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((message: string) => console.warn(message));
  const days = new Map<string, { at: number; slots: Promise<FreeRoomSlot[]> }>();
  let rooms: { at: number; ttl: number; map: Promise<Map<number, RoomInfo>> } | null = null;
  const failing = new Set<string>();

  const warnOnce = (what: string, err: unknown) => {
    if (failing.has(what)) return;
    failing.add(what);
    log(`LibCal ${what} unavailable (${err instanceof Error ? err.message : String(err)}); showing no library rooms until it recovers`);
  };

  const request = async (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const res = await doFetch(`${BASE}${path}`, {
      ...init,
      headers: { "User-Agent": USER_AGENT, ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${path.split("?")[0]}`);
    return res;
  };

  const roomInfo = () => {
    if (rooms && now() - rooms.at < rooms.ttl) return rooms.map;
    const entry: { at: number; ttl: number; map: Promise<Map<number, RoomInfo>> } = {
      at: now(),
      ttl: ROOMS_TTL_MS,
      map: request(`/spaces?lid=${LID}`).then(async (res) => {
        const map = parseSpacesPage(await res.text());
        if (!map.size) throw new Error("no rooms found on the spaces page");
        failing.delete("room list");
        return map;
      }).catch((err: unknown) => {
        warnOnce("room list", err);
        entry.ttl = DAY_TTL_MS; // retry soon; meanwhile fall back to the generic name
        return new Map<number, RoomInfo>();
      }),
    };
    rooms = entry;
    return entry.map;
  };

  const load = async (day: string): Promise<FreeRoomSlot[]> => {
    try {
      const body = new URLSearchParams({
        lid: String(LID), gid: String(GID), eid: "-1", seat: "0", seatId: "0", zone: "0",
        start: day, end: addDays(day, 1), pageIndex: "0", pageSize: "18",
      });
      const [res, info] = await Promise.all([
        request("/spaces/availability/grid", {
          method: "POST",
          headers: { Referer: `${BASE}/spaces?lid=${LID}`, "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        }),
        roomInfo(),
      ]);
      const slots = parseGrid(GridResponse.parse(await res.json()), info);
      failing.delete("availability");
      return slots;
    } catch (err) {
      warnOnce("availability", err);
      return [];
    }
  };

  return {
    freeRooms(day) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return Promise.resolve([]);
      const at = now();
      for (const [key, entry] of days) if (at - entry.at >= DAY_TTL_MS) days.delete(key);
      const hit = days.get(day);
      if (hit) return hit.slots;
      const slots = load(day);
      days.set(day, { at, slots });
      return slots;
    },
  };
}
