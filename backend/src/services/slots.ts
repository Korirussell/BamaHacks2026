import type { LatLng } from "../schemas/common.js";
import { intersect, type FreeBlock, type Interval } from "./availability.js";
import { walkMinutes } from "./geo.js";
import { MINUTE, ceilTo, localTime, weekdayOf, localDate, zonedToUtc, type Weekday } from "./time.js";

export interface Party {
  free: FreeBlock[];
  /** Where we assume they are when no class is next to the block. */
  fallback: LatLng;
}

export interface OpeningHours {
  days: Weekday[];
  open: string;
  close: string;
}

export interface MutualSlot extends Interval {
  walk: { a: number; b: number };
  context: {
    a: { before?: string | undefined; after?: string | undefined };
    b: { before?: string | undefined; after?: string | undefined };
  };
}

/**
 * Walk-time rule from the contract: each person walks from the class before the block
 * to `place`, and must make it from `place` to the class after the block.
 * Returns every slot of `durationMin` (on a 5-minute grid) both people can make, at most one per mutual window.
 */
export function mutualSlots(
  a: Party,
  b: Party,
  place: LatLng | null,
  durationMin: number,
  opts: { notBefore?: number; hours?: OpeningHours[]; tz?: string } = {},
): MutualSlot[] {
  const out: MutualSlot[] = [];
  const duration = durationMin * MINUTE;
  for (const w of intersect(a.free, b.free)) {
    const walk = {
      a: legs(w.a, place, a.fallback),
      b: legs(w.b, place, b.fallback),
    };
    let start = Math.max(
      w.start,
      w.a.start + walk.a.in * MINUTE,
      w.b.start + walk.b.in * MINUTE,
      opts.notBefore ?? -Infinity,
    );
    let end = Math.min(w.end, w.a.end - walk.a.out * MINUTE, w.b.end - walk.b.out * MINUTE);
    if (opts.hours && opts.tz) {
      const open = openWindow(start, opts.hours, opts.tz);
      if (!open) continue;
      start = Math.max(start, open.start);
      end = Math.min(end, open.end);
    }
    start = ceilTo(start, 5 * MINUTE);
    if (start + duration > end) continue;
    out.push({
      start,
      end: start + duration,
      walk: { a: Math.max(walk.a.in, walk.a.out), b: Math.max(walk.b.in, walk.b.out) },
      context: {
        a: { before: w.a.before?.label, after: w.a.after?.label },
        b: { before: w.b.before?.label, after: w.b.after?.label },
      },
    });
  }
  return out;
}

function legs(block: FreeBlock, place: LatLng | null, fallback: LatLng) {
  if (!place) return { in: 0, out: 0 };
  return {
    in: walkMinutes(block.before?.location ?? fallback, place),
    out: walkMinutes(place, block.after?.location ?? fallback),
  };
}

/** The opening window (UTC ms) on the local day of `at`, if the place is open that day. */
function openWindow(at: number, hours: OpeningHours[], tz: string): Interval | null {
  const date = localDate(at, tz);
  const day = weekdayOf(date);
  const h = hours.find((x) => x.days.includes(day));
  if (!h) return null;
  return { start: zonedToUtc(date, h.open, tz), end: zonedToUtc(date, h.close, tz) };
}

export const describeTime = (ms: number, tz: string) => `${weekdayOf(localDate(ms, tz))} ${localTime(ms, tz)}`;
