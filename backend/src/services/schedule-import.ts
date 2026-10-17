import type { ClassMeetingInput, ScheduleImportResult } from "../schemas/schedule.js";
import { parseRrule, parseUntil, rruleDays, type IcsEvent } from "./ics.js";
import { addDays, localDate, localTime, weekdayOf, type Weekday } from "./time.js";

// Turns parsed .ics events into suggested class meetings ("CS 101 – Shelby Hall 1093", MWF
// 09:00–09:50). Pure: nothing is saved; the user reviews drafts and confirms via
// PUT /me/class-schedule.

export interface ImportCourse {
  id: string;
  code: string;
}
export interface ImportBuilding {
  id: string;
  code: string;
  name: string;
}
export interface ImportContext {
  courses: ImportCourse[];
  buildings: ImportBuilding[];
  schoolTimezone: string;
  now: Date;
}

/** When a series has no UNTIL we assume one semester: 16 weeks after the first meeting. */
export const DEFAULT_TERM_WEEKS = 16;

const CODE_RE = /\b([A-Z]{2,4})\s*-?\s*(\d{3}[A-Z]?)\b/;
const DAY_ORDER: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const sortDays = (days: Weekday[]) => [...new Set(days)].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "cs101", "CS-101", "cs 101" → "CS 101"; null when the text has no course code. */
export function extractCourseCode(text: string): string | null {
  const m = text.toUpperCase().match(CODE_RE);
  return m ? `${m[1]} ${m[2]}` : null;
}

export function termLabel(termStart: string): string {
  const year = termStart.slice(0, 4);
  const month = Number(termStart.slice(5, 7));
  const season = month <= 5 ? "Spring" : month <= 7 ? "Summer" : "Fall";
  return `${season} ${year}`;
}

const GENERIC_NAME_TAIL = /\s+(hall|building|bldg|center|centre|library|complex)$/i;
const NOISE_PARTS = /^(tuscaloosa|al|alabama|usa|us|united states|\d{5}(-\d{4})?)$/i;

function matchBuilding(location: string, buildings: ImportBuilding[]): { building: ImportBuilding; matched: string } | null {
  const hits: { building: ImportBuilding; matched: string }[] = [];
  for (const building of buildings) {
    // Longest name first so "Shelby Hall" is removed whole rather than leaving "Hall".
    const names = [building.name, building.name.replace(GENERIC_NAME_TAIL, "")].filter((n) => n.trim());
    const candidates = [...names, building.code].filter((n) => n.trim());
    for (const candidate of candidates.sort((a, b) => b.length - a.length)) {
      const m = new RegExp(`(?<![\\w])${escapeRe(candidate.trim())}(?![\\w])`, "i").exec(location);
      if (m) {
        hits.push({ building, matched: m[0] });
        break;
      }
    }
  }
  // Prefer the longest matched text ("Gordon Palmer Hall" beats a short code inside it).
  return hits.sort((a, b) => b.matched.length - a.matched.length)[0] ?? null;
}

/** Room text left after removing the building text, commas and city/state noise. */
function roomFrom(location: string, matched: string): string | null {
  const rest = location.replace(matched, " ");
  const parts = rest
    .split(",")
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p && !NOISE_PARTS.test(p));
  const room = (parts[0] ?? "").replace(/^(room|rm\.?)\s+/i, "").trim();
  return room || null;
}

interface Weekly {
  days: Weekday[];
  until: number | null;
}

function weeklyInfo(event: IcsEvent, tz: string): Weekly | null {
  const rule = event.recurrence?.find((r) => r.startsWith("RRULE:"));
  if (!rule) return null;
  const parts = parseRrule(rule);
  if (parts["FREQ"] !== "WEEKLY") return null;
  const until = parts["UNTIL"] ? parseUntil(parts["UNTIL"]) : null;
  const days = parts["BYDAY"] ? rruleDays(parts["BYDAY"]) : [weekdayOf(localDate(event.start, tz))];
  return days.length ? { days: sortDays(days), until } : null;
}

interface Pending {
  draft: ClassMeetingInput;
  hadLocation: boolean;
}

export function icsToDrafts(events: IcsEvent[], ctx: ImportContext): ScheduleImportResult {
  const byCode = new Map(ctx.courses.map((c) => [extractCourseCode(c.code) ?? c.code.toUpperCase(), c]));
  const merged = new Map<string, Pending>();
  const unmatched: ScheduleImportResult["unmatched"] = [];
  let courseMisses = 0;

  for (const ev of events) {
    if (ev.status === "cancelled" || !ev.summary) continue;
    const tz = ev.timezone || ctx.schoolTimezone;
    const weekly = weeklyInfo(ev, tz);
    if (!weekly) continue; // one-off events aren't classes
    // A series that already ended isn't a current class.
    if (weekly.until !== null && weekly.until < ctx.now.getTime()) continue;

    const start = localTime(ev.start, tz);
    const end = localTime(ev.end, tz);
    if (end <= start) continue; // crosses midnight; not a class

    const code = extractCourseCode(ev.summary);
    if (!code) continue; // weekly but not a class (gym, work shift, ...)
    const location = ev.location?.trim() ?? "";
    const rawText = location ? `${ev.summary} @ ${location}` : ev.summary;
    const course = byCode.get(code);
    if (!course) {
      courseMisses++;
      unmatched.push({ raw_text: rawText, reason: "course_not_found" });
      continue;
    }

    const termStart = localDate(ev.start, tz);
    const termEnd = weekly.until !== null ? localDate(weekly.until, tz) : addDays(termStart, DEFAULT_TERM_WEEKS * 7);
    const term = termLabel(termStart);

    let buildingId: string | null = null;
    let room: string | null = null;
    if (location) {
      const hit = matchBuilding(location, ctx.buildings);
      if (hit) {
        buildingId = hit.building.id;
        room = roomFrom(location, hit.matched);
      } else {
        room = location;
        unmatched.push({ raw_text: rawText, reason: "building_not_found" });
      }
    }

    // Same course + same time on separate per-day events → one meeting with merged days.
    const key = [course.id, start, end, term, tz].join("|");
    const existing = merged.get(key);
    if (existing) {
      const d = existing.draft;
      d.days = sortDays([...d.days, ...weekly.days]);
      if (termStart < d.term_start) d.term_start = termStart;
      if (termEnd > d.term_end) d.term_end = termEnd;
      if (!d.building_id && buildingId) {
        d.building_id = buildingId;
        d.room = room;
      }
      existing.hadLocation ||= Boolean(location);
    } else {
      merged.set(key, {
        hadLocation: Boolean(location),
        draft: {
          course_id: course.id,
          section: null,
          days: weekly.days,
          start,
          end,
          timezone: tz,
          term,
          term_start: termStart,
          term_end: termEnd,
          building_id: buildingId,
          room,
          source: "ics",
        },
      });
    }
  }

  const pending = [...merged.values()];
  const good = pending.filter((p) => p.draft.building_id || !p.hadLocation).length;
  const total = pending.length + courseMisses;
  return {
    drafts: pending.map((p) => p.draft),
    unmatched,
    confidence: total === 0 ? 0 : Math.round((good / total) * 100) / 100,
  };
}
