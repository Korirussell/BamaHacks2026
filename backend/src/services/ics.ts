import { localDatesBetween, zonedParts, zonedToUtc } from "../lib/time.js";
import type { Interval } from "./availability.js";
import type { GoogleEvent } from "./schedule-import.js";

// Minimal iCalendar (.ics) reader: enough for exports from Google Calendar, Outlook, Apple
// Calendar and school registration systems. Events come out in the same shape as Google's API
// so schedule-import.ts works on both.

export type IcsEvent = GoogleEvent & { transparent?: boolean; exdates?: number[] };

const isValidTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const unescapeText = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

type Prop = { name: string; params: Record<string, string>; value: string };

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
  if (!m || params.VALUE === "DATE" || m[4] === undefined) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) return Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!);
  const tz = params.TZID && isValidTz(params.TZID) ? params.TZID : fallbackTz;
  return zonedToUtc(+y!, +mo!, +d!, +h! * 60 + +mi!, tz).getTime() + +s! * 1000;
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
      const ev = toEvent(cur, calendarTz ?? fallbackTz);
      if (ev) events.push(ev);
      cur = null;
    } else {
      const prop = parseLine(line);
      if (!prop) continue;
      if (cur && depth === 0) cur.push(prop);
      else if (!cur && prop.name === "X-WR-TIMEZONE" && isValidTz(prop.value)) calendarTz = prop.value;
    }
  }

  // No calendar-level timezone → use the first TZID the events carry.
  if (!calendarTz) {
    const tzid = text.match(/DTSTART;[^:\n]*TZID=("?)([^";:\n]+)\1/)?.[2];
    if (tzid && isValidTz(tzid)) calendarTz = tzid;
  }
  return { events, timezone: calendarTz };
}

function toEvent(props: Prop[], tz: string): IcsEvent | null {
  const get = (n: string) => props.find((p) => p.name === n);
  const dtstart = get("DTSTART");
  if (!dtstart) return null;
  const start = parseDateTime(dtstart.value, dtstart.params, tz);
  if (start === null) return null; // all-day events don't block time

  const dtend = get("DTEND");
  const duration = get("DURATION");
  const end = dtend
    ? parseDateTime(dtend.value, dtend.params, tz)
    : duration
      ? start + (parseDuration(duration.value) ?? 0)
      : start;
  if (end === null || end <= start) return null;

  const exdates = props
    .filter((p) => p.name === "EXDATE")
    .flatMap((p) => p.value.split(",").map((v) => parseDateTime(v, p.params, tz)))
    .filter((v): v is number => v !== null);
  const rrule = get("RRULE");
  const summary = get("SUMMARY");
  const location = get("LOCATION");

  return {
    ...(summary ? { summary: unescapeText(summary.value) } : {}),
    ...(location ? { location: unescapeText(location.value) } : {}),
    status: get("STATUS")?.value.toUpperCase() === "CANCELLED" ? "cancelled" : "confirmed",
    ...(rrule ? { recurrence: [`RRULE:${rrule.value}`] } : {}),
    start: { dateTime: new Date(start).toISOString() },
    end: { dateTime: new Date(end).toISOString() },
    transparent: get("TRANSP")?.value.toUpperCase() === "TRANSPARENT",
    ...(exdates.length ? { exdates } : {}),
  };
}

const BYDAY: Record<string, string> = { MO: "mon", TU: "tue", WE: "wed", TH: "thu", FR: "fri", SA: "sat", SU: "sun" };

/** Busy intervals inside [from, to) from parsed events, expanding DAILY/WEEKLY repeats. */
export function busyFromEvents(events: IcsEvent[], from: Date, to: Date, tz: string): Interval[] {
  const lo = from.getTime();
  const hi = to.getTime();
  const out: Interval[] = [];

  for (const ev of events) {
    if (ev.status === "cancelled" || ev.transparent || !ev.start?.dateTime || !ev.end?.dateTime) continue;
    const start = Date.parse(ev.start.dateTime);
    const dur = Date.parse(ev.end.dateTime) - start;
    const rule = ev.recurrence?.find((r) => r.startsWith("RRULE:"));
    const push = (s: number) => {
      if (s + dur > lo && s < hi && !ev.exdates?.includes(s)) out.push({ start: Math.max(s, lo), end: Math.min(s + dur, hi) });
    };
    if (!rule) {
      push(start);
      continue;
    }

    const parts = Object.fromEntries(rule.slice(6).split(";").map((kv) => kv.split("=") as [string, string]));
    if (parts.FREQ !== "WEEKLY" && parts.FREQ !== "DAILY") continue; // monthly/yearly: not worth it for a schedule
    const untilM = parts.UNTIL?.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
    const until = untilM
      ? Date.parse(`${untilM[1]}-${untilM[2]}-${untilM[3]}T${untilM[4] ?? "23"}:${untilM[5] ?? "59"}:${untilM[6] ?? "59"}Z`)
      : Infinity;
    const local = zonedParts(new Date(start), tz);
    const days =
      parts.FREQ === "DAILY"
        ? null
        : new Set(parts.BYDAY ? parts.BYDAY.split(",").map((d) => BYDAY[d.replace(/^[+-]?\d+/, "")]) : [local.weekday]);
    let count = parts.COUNT ? Number(parts.COUNT) : Infinity;

    // With COUNT, walk from the series start so earlier occurrences are counted; otherwise
    // start just before the window so old series don't cost years of iterations.
    const walkFrom = parts.COUNT ? start : Math.max(start, lo - dur - 86_400_000);
    for (const d of localDatesBetween(new Date(walkFrom), new Date(Math.min(hi, until)), tz)) {
      if (count <= 0) break;
      if (days && !days.has(d.weekday)) continue;
      const s = zonedToUtc(d.year, d.month, d.day, local.hour * 60 + local.minute, tz).getTime();
      if (s < start || s > until) continue;
      count--;
      push(s);
    }
  }
  return out;
}
