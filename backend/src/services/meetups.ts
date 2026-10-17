import type { LatLng } from "../schemas/common.js";
import { mutualSlots, type OpeningHours, type Party } from "./slots.js";
import { MINUTE, iso } from "./time.js";

export interface SafeZoneInput {
  id: string;
  name: string;
  kind: "police" | "student_center" | "library" | "other";
  location: LatLng;
  hours: OpeningHours[]; // empty = always open
}

export interface MeetupSuggestionOut {
  start: string;
  end: string;
  safe_zone_id: string;
  walk_minutes: { me: number; them: number };
  context: {
    me: { before?: string | undefined; after?: string | undefined };
    them: { before?: string | undefined; after?: string | undefined };
  };
  reason: string;
  score: number;
}

const KIND_BONUS: Record<SafeZoneInput["kind"], number> = { police: 3, student_center: 2, library: 2, other: 0 };

/**
 * Suggest handoff slots: both people free, short walks from/to their neighbouring classes,
 * inside a safe zone's hours, at least `leadMin` from now. Returns the best `limit`, spread over different days.
 */
export function suggestMeetups(input: {
  me: Party;
  them: Party;
  zones: SafeZoneInput[];
  tz: string;
  now: number;
  durationMin?: number;
  leadMin?: number;
  limit?: number;
}): MeetupSuggestionOut[] {
  const duration = input.durationMin ?? 10;
  const notBefore = input.now + (input.leadMin ?? 30) * MINUTE;
  const all: MeetupSuggestionOut[] = [];
  for (const zone of input.zones) {
    const slots = mutualSlots(input.me, input.them, zone.location, duration, {
      notBefore,
      tz: input.tz,
      ...(zone.hours.length ? { hours: zone.hours } : {}),
    });
    for (const s of slots) {
      const walk = s.walk.a + s.walk.b;
      const hoursOut = (s.start - input.now) / (60 * MINUTE);
      const score = 100 - walk * 3 - Math.min(hoursOut, 72) * 0.5 + KIND_BONUS[zone.kind];
      all.push({
        start: iso(s.start),
        end: iso(s.end),
        safe_zone_id: zone.id,
        walk_minutes: { me: s.walk.a, them: s.walk.b },
        context: { me: s.context.a, them: s.context.b },
        reason: reasonText(zone.name, s.context.a, s.context.b, s.walk),
        score: Math.round(score * 10) / 10,
      });
    }
  }
  all.sort((x, y) => y.score - x.score);
  const picked: MeetupSuggestionOut[] = [];
  const days = new Set<string>();
  for (const s of all) {
    const day = s.start.slice(0, 10);
    if (days.has(day) && picked.length < (input.limit ?? 3) - 1) continue;
    picked.push(s);
    days.add(day);
    if (picked.length === (input.limit ?? 3)) break;
  }
  return picked;
}

function reasonText(
  zone: string,
  me: { before?: string | undefined; after?: string | undefined },
  them: { before?: string | undefined; after?: string | undefined },
  walk: { a: number; b: number },
): string {
  const mine = me.before ? `after your ${me.before}` : me.after ? `before your ${me.after}` : "while you're free";
  const theirs = them.before ? `after their ${them.before}` : them.after ? `before their ${them.after}` : "while they're free";
  return `${zone}: ${mine} (${walk.a} min walk), ${theirs} (${walk.b} min walk)`;
}
