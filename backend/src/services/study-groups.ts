import type { Interval } from "./availability.js";
import { MINUTE, ceilTo } from "./time.js";

export interface SuggestedTime {
  start: number;
  end: number;
  classmates_free: number;
}

export interface SuggestOptions {
  from: number;
  to: number;
  durationMin?: number;
  stepMin?: number;
  limit?: number;
}

const freeFor = (blocks: Interval[], start: number, end: number) => blocks.some((b) => b.start <= start && b.end >= end);

/**
 * Study slots in [from, to) when the requester is free, ranked by how many classmates are free for the whole slot
 * (then earliest). Picks don't overlap; the result is in time order.
 */
export function suggestStudyTimes(requester: Interval[], classmates: Interval[][], opts: SuggestOptions): SuggestedTime[] {
  const duration = (opts.durationMin ?? 60) * MINUTE;
  const step = (opts.stepMin ?? 30) * MINUTE;
  const limit = opts.limit ?? 8;
  const candidates: SuggestedTime[] = [];
  for (const block of requester) {
    for (let start = ceilTo(Math.max(block.start, opts.from), step); start + duration <= Math.min(block.end, opts.to); start += step) {
      const end = start + duration;
      candidates.push({ start, end, classmates_free: classmates.filter((c) => freeFor(c, start, end)).length });
    }
  }
  candidates.sort((a, b) => b.classmates_free - a.classmates_free || a.start - b.start);
  const picked: SuggestedTime[] = [];
  for (const c of candidates) {
    if (picked.length >= limit) break;
    if (picked.some((p) => c.start < p.end && p.start < c.end)) continue;
    picked.push(c);
  }
  return picked.sort((a, b) => a.start - b.start);
}
