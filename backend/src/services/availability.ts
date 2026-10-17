import type { ClassMeetingRow } from "../db/store.js";
import type { TimeBlock } from "../schemas/academics.js";
import { localDatesBetween, toMinutes, zonedToUtc } from "../lib/time.js";

// Slot-finder core (module 9): class meetings + Google busy → class/busy/free TimeBlocks.

export type Interval = { start: number; end: number }; // epoch ms

export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

export function subtractIntervals(from: Interval[], minus: Interval[]): Interval[] {
  const cut = mergeIntervals(minus);
  const out: Interval[] = [];
  for (const base of mergeIntervals(from)) {
    let cursor = base.start;
    for (const m of cut) {
      if (m.end <= cursor || m.start >= base.end) continue;
      if (m.start > cursor) out.push({ start: cursor, end: m.start });
      cursor = Math.max(cursor, m.end);
    }
    if (cursor < base.end) out.push({ start: cursor, end: base.end });
  }
  return out;
}

const clip = (i: Interval, lo: number, hi: number): Interval => ({ start: Math.max(i.start, lo), end: Math.min(i.end, hi) });

/** Expand weekly class meetings into concrete UTC intervals inside [from, to). */
export function expandMeetings(meetings: Pick<ClassMeetingRow, "days" | "start" | "end">[], from: Date, to: Date, tz: string) {
  const out: Interval[] = [];
  for (const d of localDatesBetween(from, to, tz)) {
    for (const m of meetings) {
      if (!m.days.includes(d.weekday)) continue;
      const start = zonedToUtc(d.year, d.month, d.day, toMinutes(m.start), tz).getTime();
      const end = zonedToUtc(d.year, d.month, d.day, toMinutes(m.end), tz).getTime();
      out.push(clip({ start, end }, from.getTime(), to.getTime()));
    }
  }
  return mergeIntervals(out);
}

export type AvailabilityInput = {
  from: Date;
  to: Date;
  meetings: Pick<ClassMeetingRow, "days" | "start" | "end">[];
  busy: Interval[];
  tz: string;
  /** Only hours inside this local window are offered as `free` (nobody wants a 3am meetup). */
  dayWindow?: { start: string; end: string };
};

export function computeAvailability({ from, to, meetings, busy, tz, dayWindow = { start: "08:00", end: "22:00" } }: AvailabilityInput): TimeBlock[] {
  const lo = from.getTime();
  const hi = to.getTime();
  const classes = expandMeetings(meetings, from, to, tz);
  // Class time wins over an overlapping calendar event so it isn't reported twice.
  const busyOnly = subtractIntervals(busy.map((b) => clip(b, lo, hi)), classes);

  const awake = localDatesBetween(from, to, tz).map((d) =>
    clip(
      {
        start: zonedToUtc(d.year, d.month, d.day, toMinutes(dayWindow.start), tz).getTime(),
        end: zonedToUtc(d.year, d.month, d.day, toMinutes(dayWindow.end), tz).getTime(),
      },
      lo,
      hi,
    ),
  );
  const free = subtractIntervals(awake, [...classes, ...busyOnly]);

  const blocks = [
    ...classes.map((i) => ({ ...i, kind: "class" as const })),
    ...busyOnly.map((i) => ({ ...i, kind: "busy" as const })),
    ...free.map((i) => ({ ...i, kind: "free" as const })),
  ].filter((b) => b.end > b.start);
  blocks.sort((a, b) => a.start - b.start);
  return blocks.map((b) => ({ start: new Date(b.start).toISOString(), end: new Date(b.end).toISOString(), kind: b.kind }));
}
