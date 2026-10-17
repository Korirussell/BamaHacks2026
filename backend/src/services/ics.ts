import type { Interval } from "./availability.js";
import { addDays, localDate, localTime, weekdayOf, zonedToUtc, type Weekday } from "./time.js";

// Minimal iCalendar (.ics) reader: enough for exports from Google Calendar, Outlook, Apple
// Calendar and school registration systems. Pure; no I/O.

export interface IcsEvent {
  summary?: string;
  location?: string;
  status: "confirmed" | "cancelled";
  /** `RRULE:...` entries (at most one, from the RRULE property). */
  recurrence?: string[];
  /** DTSTART / DTEND as UTC epoch ms. Timed events only; all-day events are dropped. */
  start: number;
  end: number;
  /** IANA zone the event's wall-clock times belong to (TZID, else calendar zone, else fallback). */
  timezone: string;
  transparent: boolean;
  /** EXDATE occurrences as UTC epoch ms. */
  exdates?: number[];
}

const isValidTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const unescapeText = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): Prop | null {
  // NAME;PARAM=a;PARAM2="b:c":value — the first colon outside quotes ends the params.
  let inQuotes = false;
  let split = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuotes = !inQuotes;
    else if (line[i] === ":" && !inQuotes) {
      split = i;
      break;
    }
  }
  if (split === -1) return null;
  const [name = "", ...rawParams] = line.slice(0, split).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(split + 1) };
}

/** ICS date/date-time → epoch ms, or null for all-day (VALUE=DATE) values. */
function parseDateTime(value: string, params: Record<string, string>, fallbackTz: string): number | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m || params["VALUE"] === "DATE" || m[4] === undefined) return null;
  const [, y, mo, d, h, mi, s, z] = m as unknown as [string, string, string, string, string, string, string, string | undefined];
  if (z) return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const tzid = params["TZID"];
  const tz = tzid && isValidTz(tzid) ? tzid : fallbackTz;
  return zonedToUtc(`${y}-${mo}-${d}`, `${h}:${mi}`, tz) + +s * 1000;
}

function parseDuration(value: string): number | null {
  const m = value.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const [, sign, w = "0", d = "0", h = "0", mi = "0", s = "0"] = m;
  const ms = ((+w * 7 + +d) * 86400 + +h * 3600 + +mi * 60 + +s) * 1000;
  return sign === "-" ? -ms : ms;
}

export function parseIcs(text: string, fallbackTz: string): { events: IcsEvent[]; timezone: string | null } {
  // Unfold continuation lines (RFC 5545 §3.1).
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  let calendarTz: string | null = null;
  const events: IcsEvent[] = [];
  let cur: Prop[] | null = null;
  let depth = 0; // skip nested components such as VALARM

  // First TZID carried by any DTSTART: the calendar zone when X-WR-TIMEZONE is absent.
  const tzidMatch = text.match(/DTSTART;[^:\n]*TZID=("?)([^";:\n]+)\1/)?.[2];
  const firstTzid = tzidMatch && isValidTz(tzidMatch) ? tzidMatch : null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line === "BEGIN:VEVENT") {
      cur = [];
      depth = 0;
      continue;
    }
    if (cur && line.startsWith("BEGIN:")) depth++;
    else if (cur && line.startsWith("END:") && line !== "END:VEVENT") depth--;
    else if (line === "END:VEVENT" && cur) {
      const ev = toEvent(cur, calendarTz ?? fallbackTz, calendarTz ?? firstTzid ?? fallbackTz);
      if (ev) events.push(ev);
      cur = null;
    } else {
      const prop = parseLine(line);
      if (!prop) continue;
      if (cur && depth === 0) cur.push(prop);
      else if (!cur && prop.name === "X-WR-TIMEZONE" && isValidTz(prop.value)) calendarTz = prop.value;
    }
  }

  return { events, timezone: calendarTz ?? firstTzid };
}

function toEvent(props: Prop[], floatingTz: string, defaultTz: string): IcsEvent | null {
  const get = (n: string) => props.find((p) => p.name === n);
  const dtstart = get("DTSTART");
  if (!dtstart) return null;
  const start = parseDateTime(dtstart.value, dtstart.params, floatingTz);
  if (start === null) return null; // all-day events don't block time

  const dtend = get("DTEND");
  const duration = get("DURATION");
  const end = dtend
    ? parseDateTime(dtend.value, dtend.params, floatingTz)
    : duration
      ? start + (parseDuration(duration.value) ?? 0)
      : start;
  if (end === null || end <= start) return null;

  const exdates = props
    .filter((p) => p.name === "EXDATE")
    .flatMap((p) => p.value.split(",").map((v) => parseDateTime(v, p.params, floatingTz)))
    .filter((v): v is number => v !== null);
  const rrule = get("RRULE");
  const summary = get("SUMMARY");
  const location = get("LOCATION");
  const tzid = dtstart.params["TZID"];
  const timezone = tzid && isValidTz(tzid) ? tzid : defaultTz;

  return {
    ...(summary ? { summary: unescapeText(summary.value) } : {}),
    ...(location ? { location: unescapeText(location.value) } : {}),
    status: get("STATUS")?.value.toUpperCase() === "CANCELLED" ? "cancelled" : "confirmed",
    ...(rrule ? { recurrence: [`RRULE:${rrule.value}`] } : {}),
    start,
    end,
    timezone,
    transparent: get("TRANSP")?.value.toUpperCase() === "TRANSPARENT",
    ...(exdates.length ? { exdates } : {}),
  };
}

const BYDAY: Record<string, Weekday> = { MO: "mon", TU: "tue", WE: "wed", TH: "thu", FR: "fri", SA: "sat", SU: "sun" };

/** Parses `RRULE:A=b;C=d` into a map (keys upper-cased). */
export function parseRrule(rule: string): Record<string, string> {
  return Object.fromEntries(
    rule
      .replace(/^RRULE:/i, "")
      .split(";")
      .map((kv) => kv.split("=") as [string, string])
      .filter(([k, v]) => k && v !== undefined)
      .map(([k, v]) => [k.toUpperCase(), v]),
  );
}

/** Weekdays from an RRULE BYDAY value ("MO,WE", "1MO"), ignoring ordinals. */
export function rruleDays(byday: string): Weekday[] {
  return byday.split(",").flatMap((d) => {
    const day = BYDAY[d.trim().toUpperCase().replace(/^[+-]?\d+/, "")];
    return day ? [day] : [];
  });
}

/** UNTIL (20261211 or 20261211T055959Z) → UTC epoch ms; date-only means end of that day. */
export function parseUntil(until: string): number | null {
  const m = until.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h = "23", mi = "59", s = "59"] = m;
  return Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s);
}

const toMs = (d: Date) => d.getTime();

/** Busy intervals inside [from, to) from parsed events, expanding DAILY/WEEKLY repeats. */
export function busyFromEvents(events: IcsEvent[], from: Date, to: Date, tz: string): Interval[] {
  const lo = toMs(from);
  const hi = toMs(to);
  const out: Interval[] = [];

  for (const ev of events) {
    if (ev.status === "cancelled" || ev.transparent) continue;
    const start = ev.start;
    const dur = ev.end - start;
    const rule = ev.recurrence?.find((r) => r.startsWith("RRULE:"));
    const push = (s: number) => {
      if (s + dur > lo && s < hi && !ev.exdates?.includes(s)) out.push({ start: Math.max(s, lo), end: Math.min(s + dur, hi) });
    };
    if (!rule) {
      push(start);
      continue;
    }

    const parts = parseRrule(rule);
    if (parts["FREQ"] !== "WEEKLY" && parts["FREQ"] !== "DAILY") continue; // monthly/yearly: not worth it for a schedule
    const until = (parts["UNTIL"] ? parseUntil(parts["UNTIL"]) : null) ?? Infinity;
    const startDate = localDate(start, tz);
    const startTime = localTime(start, tz);
    const days = parts["FREQ"] === "DAILY" ? null : new Set<Weekday>(parts["BYDAY"] ? rruleDays(parts["BYDAY"]) : [weekdayOf(startDate)]);
    let count = parts["COUNT"] ? Number(parts["COUNT"]) : Infinity;

    // With COUNT, walk from the series start so earlier occurrences are counted; otherwise
    // start just before the window so old series don't cost years of iterations.
    const walkFrom = parts["COUNT"] ? start : Math.max(start, lo - dur - 86_400_000);
    const walkTo = Math.min(hi, until);
    if (walkTo <= walkFrom) continue;
    const last = localDate(walkTo - 1, tz);
    for (let d = localDate(walkFrom, tz); d <= last; d = addDays(d, 1)) {
      if (count <= 0) break;
      if (days && !days.has(weekdayOf(d))) continue;
      const s = zonedToUtc(d, startTime, tz);
      if (s < start || s > until) continue;
      count--;
      push(s);
    }
  }
  return out;
}
