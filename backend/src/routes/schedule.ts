import { Hono } from "hono";
import { z } from "zod";
import { BuildingRow, ClassMeetingRow, CourseRow, toClassMeeting, toMeetingInput } from "../db/academics.js";
import { ApiError } from "../lib/errors.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { PutClassScheduleReq } from "../schemas/schedule.js";
import { composeAvailability, expandMeetings } from "../services/availability.js";
import { freeBusy } from "../services/google.js";

const ScheduleQuery = z.object({ term: z.string().optional() });
const AvailabilityQuery = z.object({ from: z.iso.datetime(), to: z.iso.datetime() }).superRefine((value, ctx) => {
  const duration = Date.parse(value.to) - Date.parse(value.from);
  if (duration <= 0) ctx.addIssue({ code: "custom", path: ["to"], message: "Must be after from" });
  if (duration > 14 * 24 * 60 * 60 * 1000) ctx.addIssue({ code: "custom", path: ["to"], message: "Maximum range is 14 days" });
});

async function loadMeetings(userId: string, schoolId: string, term?: string) {
  let query = adminClient().from("class_meetings").select("*, course:courses(*), building:buildings(*)").eq("user_id", userId).eq("school_id", schoolId);
  if (term) query = query.eq("term", term);
  const result = await query.order("term").order("start_time");
  if (result.error) throw result.error;
  return z.array(ClassMeetingRow).parse(result.data);
}

async function schoolTimezone(schoolId: string) {
  const result = await adminClient().from("schools").select("timezone").eq("id", schoolId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ApiError(404, "NOT_FOUND", "School not found");
  return z.object({ timezone: z.string() }).parse(result.data).timezone;
}

export function scheduleReferenceErrors(
  meetings: z.output<typeof PutClassScheduleReq>["meetings"],
  courseIds: Set<string>,
  buildingIds: Set<string>,
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  meetings.forEach((meeting, index) => {
    if (!courseIds.has(meeting.course_id)) fieldErrors[`meetings.${index}.course_id`] = "Course must belong to your school";
    if (meeting.building_id && !buildingIds.has(meeting.building_id)) fieldErrors[`meetings.${index}.building_id`] = "Building must belong to your school";
  });
  return fieldErrors;
}

export const scheduleRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .use("/me/class-schedule/*", requireUser(verify))
  .use("/me/availability/*", requireUser(verify))
  .get("/me/class-schedule", async (c) => c.json(one((await loadMeetings(c.var.user.id, c.var.user.schoolId, parseQuery(c, ScheduleQuery).term)).map(toClassMeeting))))
  .put("/me/class-schedule", async (c) => {
    const input = await parseBody(c, PutClassScheduleReq);
    const db = adminClient();
    const timezone = await schoolTimezone(c.var.user.schoolId);
    const courseIds = [...new Set(input.meetings.map((meeting) => meeting.course_id))];
    const buildingIds = [...new Set(input.meetings.flatMap((meeting) => meeting.building_id ? [meeting.building_id] : []))];
    const [courses, buildings] = await Promise.all([
      courseIds.length ? db.from("courses").select("id").eq("school_id", c.var.user.schoolId).in("id", courseIds) : Promise.resolve({ data: [], error: null }),
      buildingIds.length ? db.from("buildings").select("id").eq("school_id", c.var.user.schoolId).in("id", buildingIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (courses.error) throw courses.error;
    if (buildings.error) throw buildings.error;
    const courseSet = new Set(z.array(CourseRow.pick({ id: true })).parse(courses.data).map((course) => course.id));
    const buildingSet = new Set(z.array(BuildingRow.pick({ id: true })).parse(buildings.data).map((building) => building.id));
    const fieldErrors = scheduleReferenceErrors(input.meetings, courseSet, buildingSet);
    if (Object.keys(fieldErrors).length) throw new ApiError(400, "VALIDATION", "Invalid request", fieldErrors);
    const terms = [...new Set(input.meetings.map((meeting) => meeting.term))];
    if (terms.length) {
      const deleted = await db.from("class_meetings").delete().eq("user_id", c.var.user.id).eq("school_id", c.var.user.schoolId).in("term", terms);
      if (deleted.error) throw deleted.error;
    }
    if (input.meetings.length) {
      const inserted = await db.from("class_meetings").insert(input.meetings.map((meeting) => ({ school_id: c.var.user.schoolId, user_id: c.var.user.id, course_id: meeting.course_id, section: meeting.section ?? null, days: meeting.days, start_time: meeting.start, end_time: meeting.end, timezone: meeting.timezone ?? timezone, term: meeting.term, term_start: meeting.term_start, term_end: meeting.term_end, building_id: meeting.building_id ?? null, room: meeting.room ?? null, source: meeting.source })));
      if (inserted.error) throw inserted.error;
    }
    const result = await Promise.all(terms.map((term) => loadMeetings(c.var.user.id, c.var.user.schoolId, term)));
    return c.json(one(result.flat().map(toClassMeeting)));
  })
  .get("/me/availability", async (c) => {
    const { from, to } = parseQuery(c, AvailabilityQuery);
    const rows = await loadMeetings(c.var.user.id, c.var.user.schoolId);
    const tz = await schoolTimezone(c.var.user.schoolId);
    const start = Date.parse(from);
    const end = Date.parse(to);
    const classes = expandMeetings(rows.map(toMeetingInput), start, end);
    const googleBusy = await freeBusy(c.var.user.id, start, end);
    return c.json(one({ blocks: composeAvailability(classes, googleBusy, start, end, tz) }));
  });
