import { Hono } from "hono";
import { z } from "zod";
import { calendarConnections, classMeetings, courses, icsCalendars, type ClassMeetingRow } from "../db/store.js";
import { requireAuth, type AuthEnv } from "../lib/auth.js";
import { config } from "../lib/config.js";
import { ApiError } from "../lib/errors.js";
import { one } from "../lib/respond.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { ClassMeeting } from "../schemas/academics.js";
import { Timestamp } from "../schemas/common.js";
import { computeAvailability } from "../services/availability.js";
import { GoogleAuthRevoked, freeBusy, recurringEvents } from "../services/google.js";
import { busyFromEvents, parseIcs } from "../services/ics.js";
import { suggestMeetings } from "../services/schedule-import.js";

// Module 9 — Schedule & availability: /me/class-schedule, /me/calendar/ics, /me/availability.

const MAX_RANGE_MS = 31 * 86_400_000;

const toMeeting = (m: ClassMeetingRow) => ({ course_id: m.course_id, days: m.days, start: m.start, end: m.end, place: m.place });

const PutScheduleReq = z.object({ meetings: z.array(ClassMeeting).max(50) });
const IcsUploadReq = z.object({
  ics: z.string().max(5_000_000, "Calendar file is too large (5 MB max)").refine((s) => s.includes("BEGIN:VCALENDAR"), "Not an .ics calendar file"),
});

/** Timezone for class times + availability: Google Calendar's, else the uploaded .ics file's, else the server default. */
async function userTimezone(userId: string) {
  return (
    (await calendarConnections.get(userId))?.timezone ?? (await icsCalendars.get(userId))?.timezone ?? config.defaultTimezone
  );
}

const AvailabilityQuery = z
  .object({ from: Timestamp, to: Timestamp })
  .refine((q) => Date.parse(q.to) > Date.parse(q.from), { message: "to must be after from", path: ["to"] })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= MAX_RANGE_MS, { message: "Range can be at most 31 days", path: ["to"] });

export const schedule = new Hono<AuthEnv>()
  .use("/me/*", requireAuth)

  // Weekly class schedule: when and where each current class meets (HH:MM in the user's timezone).
  .get("/me/class-schedule", async (c) => {
    const rows = await classMeetings.list(c.get("user").id);
    return c.json(one({ meetings: rows.map(toMeeting) }));
  })

  .put("/me/class-schedule", async (c) => {
    const { meetings } = await parseBody(c, PutScheduleReq);
    const user = c.get("user");
    const known = new Set((await courses.getMany(user.schoolId, meetings.map((m) => m.course_id))).map((x) => x.id));
    const fieldErrors: Record<string, string> = {};
    meetings.forEach((m, i) => {
      if (!known.has(m.course_id)) fieldErrors[`meetings.${i}.course_id`] = "No such course at your school";
    });
    if (Object.keys(fieldErrors).length) throw new ApiError(400, "VALIDATION", "Invalid request", fieldErrors);
    const rows = await classMeetings.replace(user.id, meetings);
    return c.json(one({ meetings: rows.map(toMeeting) }));
  })

  // Suggested meetings from Google Calendar (if connected) or the uploaded .ics; the user confirms with PUT above.
  .get("/me/class-schedule/suggested", async (c) => {
    const user = c.get("user");
    const tz = await userTimezone(user.id);
    const catalog = await courses.all(user.schoolId);
    if (await calendarConnections.get(user.id)) {
      try {
        return c.json(one(suggestMeetings(await recurringEvents(user.id), catalog, tz)));
      } catch (err) {
        if (!(err instanceof GoogleAuthRevoked)) throw err;
      }
    }
    const ics = await icsCalendars.get(user.id);
    if (!ics) throw new ApiError(409, "INVALID_STATE", "Connect Google Calendar or upload an .ics file first");
    return c.json(one(suggestMeetings(ics.events, catalog, tz)));
  })

  // Upload an .ics export (Google/Outlook/Apple/registrar). Replaces any earlier upload and
  // returns the same suggestions as /me/class-schedule/suggested; nothing is added to the schedule.
  .post("/me/calendar/ics", async (c) => {
    const { ics } = await parseBody(c, IcsUploadReq);
    const user = c.get("user");
    const { events, timezone } = parseIcs(ics, config.defaultTimezone);
    await icsCalendars.upsert({ user_id: user.id, events, timezone, imported_at: new Date().toISOString() });
    const suggestion = suggestMeetings(events, await courses.all(user.schoolId), await userTimezone(user.id));
    return c.json(one({ events_imported: events.length, timezone: timezone ?? config.defaultTimezone, ...suggestion }), 201);
  })

  .delete("/me/calendar/ics", async (c) => {
    await icsCalendars.delete(c.get("user").id);
    return c.body(null, 204);
  })

  // Free/busy/class blocks for meetup + tutoring suggestions.
  .get("/me/availability", async (c) => {
    const q = parseQuery(c, AvailabilityQuery);
    const user = c.get("user");
    const from = new Date(q.from);
    const to = new Date(q.to);
    const [meetings, googleBusy, ics, tz] = await Promise.all([
      classMeetings.list(user.id),
      freeBusy(user.id, from, to),
      icsCalendars.get(user.id),
      userTimezone(user.id),
    ]);
    const busy = [...googleBusy, ...(ics ? busyFromEvents(ics.events, from, to, tz) : [])];
    const blocks = computeAvailability({ from, to, meetings, busy, tz });
    return c.json(one({ blocks }));
  });
