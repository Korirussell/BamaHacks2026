import type { LatLng } from "../schemas/common.js";
import { HOUR, MINUTE, localDatesBetween, weekdayOf, zonedToUtc, type Weekday } from "./time.js";

/** What the slot-finder needs from a ClassMeeting row. */
export interface MeetingInput {
  courseCode: string;
  days: Weekday[];
  start: string; // HH:MM local
  end: string;
  timezone: string;
  termStart: string; // YYYY-MM-DD
  termEnd: string;
  buildingName?: string | null;
  buildingLocation?: LatLng | null;
}

export interface Interval {
  start: number; // epoch ms
  end: number;
}

export interface BusyInterval extends Interval {
  kind: "class" | "busy";
  label?: string;
  location?: LatLng | null;
}

export interface FreeBlock extends Interval {
  /** Class that ends right before this block (where the person walks from). */
  before?: BusyInterval;
  /** Class that starts right after this block (where they walk to next). */
  after?: BusyInterval;
}

export interface DayWindow {
  /** Earliest local time we'll suggest anything, e.g. "08:00". */
  open: string;
  /** Latest local end time, e.g. "21:00". */
  close: string;
}

export const DEFAULT_DAY_WINDOW: DayWindow = { open: "08:00", close: "21:00" };

/** Expand weekly class meetings into concrete busy intervals inside [from, to). */
export function expandMeetings(meetings: MeetingInput[], from: number, to: number): BusyInterval[] {
  const out: BusyInterval[] = [];
  for (const m of meetings) {
    for (const date of localDatesBetween(from, to, m.timezone)) {
      if (date < m.termStart || date > m.termEnd) continue;
      if (!m.days.includes(weekdayOf(date))) continue;
      const start = zonedToUtc(date, m.start, m.timezone);
      const end = zonedToUtc(date, m.end, m.timezone);
      if (end <= from || start >= to) continue;
      out.push({
        start,
        end,
        kind: "class",
        label: m.buildingName ? `${m.courseCode} in ${m.buildingName}` : m.courseCode,
        location: m.buildingLocation ?? null,
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Free blocks for one person inside [from, to), limited to each local day's window.
 * `extraBusy` is anything else that blocks time (Google free/busy, booked sessions).
 * Each block remembers the class right before/after it within 15 minutes, for walk time.
 */
export function freeBlocks(
  busy: BusyInterval[],
  from: number,
  to: number,
  tz: string,
  window: DayWindow = DEFAULT_DAY_WINDOW,
): FreeBlock[] {
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  const out: FreeBlock[] = [];
  for (const date of localDatesBetween(from, to, tz)) {
    const dayStart = Math.max(zonedToUtc(date, window.open, tz), from);
    const dayEnd = Math.min(zonedToUtc(date, window.close, tz), to);
    if (dayEnd <= dayStart) continue;
    let cursor = dayStart;
    let prev: BusyInterval | undefined;
    for (const b of sorted) {
      if (b.end <= dayStart - NEIGHBOUR_GAP) continue;
      if (b.start >= dayEnd) {
        if (cursor < dayEnd) out.push(withNeighbours({ start: cursor, end: dayEnd }, prev, b));
        cursor = dayEnd;
        break;
      }
      if (b.start > cursor) out.push(withNeighbours({ start: cursor, end: b.start }, prev, b));
      if (!prev || b.end >= prev.end) prev = b;
      cursor = Math.max(cursor, b.end);
    }
    if (cursor < dayEnd) out.push(withNeighbours({ start: cursor, end: dayEnd }, prev));
  }
  return out;
}

const NEIGHBOUR_GAP = 15 * MINUTE;

function withNeighbours(block: Interval, before?: BusyInterval, after?: BusyInterval): FreeBlock {
  const out: FreeBlock = { ...block };
  if (before && block.start - before.end <= NEIGHBOUR_GAP && before.kind === "class") out.before = before;
  if (after && after.start - block.end <= NEIGHBOUR_GAP && after.kind === "class") out.after = after;
  return out;
}

/** Pairwise overlap of two sorted block lists. Keeps a reference to each side's block. */
export function intersect<A extends Interval, B extends Interval>(
  a: A[],
  b: B[],
): Array<Interval & { a: A; b: B }> {
  const out: Array<Interval & { a: A; b: B }> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i]!;
    const y = b[j]!;
    const start = Math.max(x.start, y.start);
    const end = Math.min(x.end, y.end);
    if (start < end) out.push({ start, end, a: x, b: y });
    if (x.end < y.end) i++;
    else j++;
  }
  return out;
}

export const totalMinutes = (blocks: Interval[]) =>
  Math.round(blocks.reduce((sum, b) => sum + (b.end - b.start), 0) / MINUTE);

export const hours = (n: number) => n * HOUR;
