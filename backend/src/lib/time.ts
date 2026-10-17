// Wall-clock ↔ UTC helpers for a named IANA timezone, without a date library.

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: Weekday };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function zonedParts(date: Date, tz: string): Parts {
  const p = Object.fromEntries(formatter(tz).formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: String(p.weekday).toLowerCase().slice(0, 3) as Weekday,
  };
}

function offsetMs(date: Date, tz: string) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, date.getUTCSeconds());
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** UTC instant for a wall-clock time (minutes since midnight) on a local calendar date in `tz`. */
export function zonedToUtc(year: number, month: number, day: number, minutes: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, 0, minutes);
  // Two passes settle DST transitions.
  const first = guess - offsetMs(new Date(guess), tz);
  return new Date(guess - offsetMs(new Date(first), tz));
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export const toHHMM = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Each local calendar date in `tz` touched by [from, to), as y/m/d + weekday. */
export function localDatesBetween(from: Date, to: Date, tz: string) {
  const out: Parts[] = [];
  const start = zonedParts(from, tz);
  let cursor = Date.UTC(start.year, start.month - 1, start.day);
  const end = zonedParts(to, tz);
  const endKey = Date.UTC(end.year, end.month - 1, end.day);
  while (cursor <= endKey) {
    const d = new Date(cursor);
    out.push({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: 0,
      minute: 0,
      weekday: WEEKDAYS[d.getUTCDay()]!,
    });
    cursor += 86_400_000;
  }
  return out;
}
