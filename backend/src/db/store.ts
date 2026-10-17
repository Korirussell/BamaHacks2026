import { randomUUID } from "node:crypto";
import type { ClassMeeting, ClassStatus, Day } from "../schemas/academics.js";
import type { Place } from "../schemas/common.js";
import type { IcsEvent } from "../services/ics.js";
import { SEED_COURSES, SEED_MATERIALS } from "./seed.js";

// In-memory stand-in for the Supabase tables owned by modules 8 + 9 (contract Part 2).
// Every function is async and takes school/user ids explicitly so swapping in Supabase
// queries is a drop-in change. Data resets on restart.

export type CourseRow = { id: string; school_id: string; code: string; title: string; department: string };
export type ClassRecordRow = {
  id: string;
  user_id: string;
  course_id: string;
  term: string;
  status: ClassStatus;
  grade: string | null;
  grade_source: "transcript" | "self_reported";
  grade_verified: boolean;
  created_at: string;
};
export type ClassMeetingRow = {
  user_id: string;
  course_id: string;
  days: Day[];
  start: string;
  end: string;
  place: Place | null;
};
export type CalendarConnectionRow = {
  user_id: string;
  refresh_token_enc: string;
  scope: string;
  /** IANA timezone of the user's primary Google Calendar, e.g. America/Chicago. */
  timezone: string | null;
  connected_at: string;
};
export type IcsCalendarRow = { user_id: string; events: IcsEvent[]; timezone: string | null; imported_at: string };
export type CourseMaterialRow = { course_id: string; term: string | null; isbn: string; title: string; required: boolean };

const tables = {
  courses: [...SEED_COURSES] as CourseRow[],
  class_records: [] as ClassRecordRow[],
  class_meetings: [] as ClassMeetingRow[],
  calendar_connections: new Map<string, CalendarConnectionRow>(),
  ics_calendars: new Map<string, IcsCalendarRow>(),
  course_materials: [...SEED_MATERIALS] as CourseMaterialRow[],
};

const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const courses = {
  async search(schoolId: string, q: string) {
    const needle = q.trim().toLowerCase();
    const code = normalizeCode(q);
    return tables.courses
      .filter((c) => c.school_id === schoolId)
      .filter(
        (c) =>
          !needle ||
          (code && normalizeCode(c.code).includes(code)) ||
          c.title.toLowerCase().includes(needle) ||
          c.department.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  },
  async get(schoolId: string, id: string) {
    return tables.courses.find((c) => c.school_id === schoolId && c.id === id) ?? null;
  },
  async getMany(schoolId: string, ids: string[]) {
    return tables.courses.filter((c) => c.school_id === schoolId && ids.includes(c.id));
  },
  async findByCode(schoolId: string, code: string) {
    const n = normalizeCode(code);
    return tables.courses.find((c) => c.school_id === schoolId && normalizeCode(c.code) === n) ?? null;
  },
  async all(schoolId: string) {
    return tables.courses.filter((c) => c.school_id === schoolId);
  },
};

export const classRecords = {
  async list(userId: string, status?: ClassStatus) {
    return tables.class_records
      .filter((r) => r.user_id === userId && (!status || r.status === status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async find(userId: string, courseId: string, term: string) {
    return (
      tables.class_records.find(
        (r) => r.user_id === userId && r.course_id === courseId && r.term.toLowerCase() === term.toLowerCase(),
      ) ?? null
    );
  },
  async insert(row: Omit<ClassRecordRow, "id" | "created_at">) {
    const rec = { ...row, id: randomUUID(), created_at: new Date().toISOString() };
    tables.class_records.push(rec);
    return rec;
  },
  async delete(userId: string, id: string) {
    const i = tables.class_records.findIndex((r) => r.user_id === userId && r.id === id);
    if (i === -1) return false;
    tables.class_records.splice(i, 1);
    return true;
  },
};

export const classMeetings = {
  async list(userId: string): Promise<ClassMeetingRow[]> {
    return tables.class_meetings.filter((m) => m.user_id === userId);
  },
  /** PUT semantics: the user's whole weekly schedule is replaced. */
  async replace(userId: string, meetings: ClassMeeting[]) {
    tables.class_meetings = tables.class_meetings.filter((m) => m.user_id !== userId);
    const rows = meetings.map((m) => ({
      user_id: userId,
      course_id: m.course_id,
      days: m.days,
      start: m.start,
      end: m.end,
      place: m.place ?? null,
    }));
    tables.class_meetings.push(...rows);
    return rows;
  },
};

export const calendarConnections = {
  async get(userId: string) {
    return tables.calendar_connections.get(userId) ?? null;
  },
  async upsert(row: CalendarConnectionRow) {
    tables.calendar_connections.set(row.user_id, row);
  },
  async delete(userId: string) {
    return tables.calendar_connections.delete(userId);
  },
};

// Uploaded .ics snapshot per user (the no-Google-Cloud path). Re-upload replaces it.
export const icsCalendars = {
  async get(userId: string) {
    return tables.ics_calendars.get(userId) ?? null;
  },
  async upsert(row: IcsCalendarRow) {
    tables.ics_calendars.set(row.user_id, row);
  },
  async delete(userId: string) {
    return tables.ics_calendars.delete(userId);
  },
};

export const courseMaterials = {
  async forCourse(courseId: string, term?: string) {
    return tables.course_materials.filter(
      (m) => m.course_id === courseId && (m.term === null || !term || m.term.toLowerCase() === term.toLowerCase()),
    );
  },
};

// Lookups into tables owned by other modules (4 Listings, 11 Wishlist). Those modules aren't
// built yet, so these return "nothing found"; replace with real queries when they land.
export const marketplace = {
  async listingStats(_schoolId: string, _isbn: string): Promise<{ active: number; lowest_price_cents: number | null }> {
    return { active: 0, lowest_price_cents: null };
  },
  async bestListing(_schoolId: string, _isbn: string): Promise<unknown | null> {
    return null;
  },
  async onWishlist(_userId: string, _isbn: string, _courseId: string): Promise<boolean> {
    return false;
  },
};
