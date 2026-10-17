import { z } from "zod";
import { Building, ClassMeeting, Course } from "../schemas/schedule.js";
import type { MeetingInput } from "../services/availability.js";

export const CourseRow = z.object({ id: z.guid(), school_id: z.guid(), code: z.string(), title: z.string(), department: z.string() });
export const BuildingRow = z.object({ id: z.guid(), school_id: z.guid(), name: z.string(), code: z.string(), lat: z.number(), lng: z.number() });
export const OpeningHoursRow = z.object({ days: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])), open: z.string(), close: z.string() });
export const SafeZoneRow = z.object({ id: z.guid(), school_id: z.guid(), name: z.string(), kind: z.enum(["police", "student_center", "library", "other"]), lat: z.number(), lng: z.number(), radius_m: z.number().int(), hours: z.array(OpeningHoursRow), hours_note: z.string().nullable() });
export const DropOffPointRow = z.object({ id: z.guid(), school_id: z.guid(), name: z.string(), lat: z.number(), lng: z.number(), radius_m: z.number().int(), hours: z.array(OpeningHoursRow), instructions: z.string() });
export const ClassRecordRow = z.object({ id: z.guid(), school_id: z.guid(), user_id: z.guid(), course_id: z.guid(), term: z.string(), status: z.enum(["current", "past", "planned"]), grade: z.string().nullable(), grade_source: z.enum(["transcript", "self_reported"]), grade_verified: z.boolean(), course: CourseRow });
export const ClassMeetingRow = z.object({ id: z.guid(), school_id: z.guid(), user_id: z.guid(), course_id: z.guid(), section: z.string().nullable(), days: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])), start_time: z.string(), end_time: z.string(), timezone: z.string(), term: z.string(), term_start: z.string(), term_end: z.string(), building_id: z.guid().nullable(), room: z.string().nullable(), source: z.enum(["manual", "ics", "screenshot", "google"]), course: CourseRow, building: BuildingRow.nullable() });

export type CourseRow = z.infer<typeof CourseRow>;
export type BuildingRow = z.infer<typeof BuildingRow>;
export type ClassMeetingRow = z.infer<typeof ClassMeetingRow>;

const wallTime = (value: string) => value.slice(0, 5);
export const toCourse = (row: CourseRow) => Course.parse({ id: row.id, code: row.code, title: row.title, department: row.department });
export const toBuilding = (row: BuildingRow) => Building.parse({ id: row.id, school_id: row.school_id, name: row.name, code: row.code, location: { lat: row.lat, lng: row.lng } });
export const toClassRecord = (row: z.infer<typeof ClassRecordRow>) => ({ id: row.id, course: toCourse(row.course), term: row.term, status: row.status, grade: row.grade, grade_source: row.grade_source, grade_verified: row.grade_verified });
export const toClassMeeting = (row: ClassMeetingRow) => ClassMeeting.parse({ id: row.id, course: toCourse(row.course), section: row.section, days: row.days, start: wallTime(row.start_time), end: wallTime(row.end_time), timezone: row.timezone, term: row.term, term_start: row.term_start, term_end: row.term_end, building: row.building ? toBuilding(row.building) : null, room: row.room, source: row.source });
export const toMeetingInput = (row: ClassMeetingRow): MeetingInput => ({ courseCode: row.course.code, days: row.days, start: wallTime(row.start_time), end: wallTime(row.end_time), timezone: row.timezone, termStart: row.term_start, termEnd: row.term_end, buildingName: row.building?.name ?? null, buildingLocation: row.building ? { lat: row.building.lat, lng: row.building.lng } : null });
