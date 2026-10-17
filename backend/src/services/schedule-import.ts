import { UA_BUILDINGS, UA_CENTER } from "../db/seed.js";
import type { CourseRow } from "../db/store.js";
import type { ClassMeeting, Day } from "../schemas/academics.js";
import type { Place } from "../schemas/common.js";
import { toHHMM, zonedParts } from "../lib/time.js";

// Turns recurring Google Calendar events into suggested ClassMeetings ("CS 101 – Shelby 1093",
// MWF 9:00–9:50). Nothing is saved; the user reviews and confirms via PUT /me/class-schedule.

export type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  location?: string;
  recurrence?: string[];
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

export type UnmatchedEvent = { title: string; days: Day[]; start: string; end: string; location_label: string | null };

const BYDAY: Record<string, Day> = { MO: "mon", TU: "tue", WE: "wed", TH: "thu", FR: "fri", SA: "sat", SU: "sun" };
const CODE_RE = /\b([A-Z]{2,4})\s*-?\s*(\d{3}[A-Z]?)\b/;

export function extractCourseCode(title: string): string | null {
  const m = title.toUpperCase().match(CODE_RE);
  return m ? `${m[1]} ${m[2]}` : null;
}

/** Location text → Place. Unknown buildings keep the label but fall back to campus center coords. */
export function placeFromLocation(location: string | undefined): Place | null {
  const label = location?.trim();
  if (!label) return null;
  const lower = label.toLowerCase();
  const building = UA_BUILDINGS.find((b) =>
    [b.name.toLowerCase(), ...b.aliases].some((a) => new RegExp(`\\b${a.replace(/[.]/g, "\\.")}\\b`).test(lower)),
  );
  return { label, location: building?.location ?? UA_CENTER };
}

/** Weekly days from an RRULE, or null when the event isn't a live weekly series. */
export function weeklyDays(event: GoogleEvent, tz: string, now: Date): Day[] | null {
  const rule = event.recurrence?.find((r) => r.startsWith("RRULE:"));
  if (!rule || !event.start?.dateTime) return null;
  const parts = Object.fromEntries(
    rule.slice("RRULE:".length).split(";").map((kv) => kv.split("=") as [string, string]),
  );
  if (parts.FREQ !== "WEEKLY") return null;
  // UNTIL is 20261211 or 20261211T055959Z; a series that already ended isn't a current class.
  const until = parts.UNTIL?.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (until) {
    const [, y, mo, d, h = "23", mi = "59", sec = "59"] = until;
    if (Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${sec}Z`) < now.getTime()) return null;
  }
  const days = parts.BYDAY
    ? parts.BYDAY.split(",").flatMap((d) => {
        const day = BYDAY[d.replace(/^[+-]?\d+/, "")];
        return day ? [day] : [];
      })
    : [zonedParts(new Date(event.start.dateTime), tz).weekday];
  return days.length ? sortDays(days) : null;
}

const DAY_ORDER: Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const sortDays = (days: Day[]) => [...new Set(days)].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));

export function suggestMeetings(events: GoogleEvent[], catalog: CourseRow[], tz: string, now = new Date()) {
  const byCode = new Map(catalog.map((c) => [extractCourseCode(c.code) ?? c.code, c]));
  const meetings = new Map<string, ClassMeeting & { place: Place | null }>();
  const unmatched: UnmatchedEvent[] = [];

  for (const ev of events) {
    if (ev.status === "cancelled" || !ev.summary || !ev.start?.dateTime || !ev.end?.dateTime) continue;
    const days = weeklyDays(ev, tz, now);
    if (!days) continue;
    const s = zonedParts(new Date(ev.start.dateTime), tz);
    const e = zonedParts(new Date(ev.end.dateTime), tz);
    const start = toHHMM(s.hour * 60 + s.minute);
    const end = toHHMM(e.hour * 60 + e.minute);
    if (end <= start) continue;

    const code = extractCourseCode(ev.summary);
    if (!code) continue; // weekly but not a class (gym, club meeting, ...)
    const course = byCode.get(code);
    if (!course) {
      unmatched.push({ title: ev.summary, days, start, end, location_label: ev.location?.trim() || null });
      continue;
    }
    // Same course + same time on separate per-day events → one meeting with merged days.
    const key = `${course.id}|${start}|${end}`;
    const existing = meetings.get(key);
    if (existing) {
      existing.days = sortDays([...existing.days, ...days]);
      existing.place ??= placeFromLocation(ev.location);
    } else {
      meetings.set(key, { course_id: course.id, days, start, end, place: placeFromLocation(ev.location) });
    }
  }

  return { meetings: [...meetings.values()], unmatched };
}

