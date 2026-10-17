import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import { ClassMeetingRow, toClassMeeting, toMeetingInput } from "../db/academics.js";
import type { TokenVerifier } from "../middleware/auth.js";
import { PutClassScheduleReq } from "../schemas/schedule.js";
import { filterText } from "./academics.js";
import { scheduleReferenceErrors } from "./schedule.js";

const schoolId = "00000000-0000-4000-a000-000000000001";
const courseId = "00000000-0000-4000-a000-000000000002";
const buildingId = "00000000-0000-4000-a000-000000000003";
const meetingId = "00000000-0000-4000-a000-000000000004";
const userId = "00000000-0000-4000-a000-000000000005";

const meeting = ClassMeetingRow.parse({ id: meetingId, school_id: schoolId, user_id: userId, course_id: courseId, section: "001", days: ["mon", "wed"], start_time: "09:30:00", end_time: "10:45:00", timezone: "America/Chicago", term: "Fall 2026", term_start: "2026-08-19", term_end: "2026-12-11", building_id: buildingId, room: "101", source: "manual", course: { id: courseId, school_id: schoolId, code: "CH 101", title: "General Chemistry", department: "CH" }, building: { id: buildingId, school_id: schoolId, name: "Shelby Hall", code: "SH", lat: 33.2149, lng: -87.5398 } });

test("academic mappers produce ClassMeeting and MeetingInput", () => {
  assert.deepEqual(toClassMeeting(meeting), { id: meetingId, course: { id: courseId, code: "CH 101", title: "General Chemistry", department: "CH" }, section: "001", days: ["mon", "wed"], start: "09:30", end: "10:45", timezone: "America/Chicago", term: "Fall 2026", term_start: "2026-08-19", term_end: "2026-12-11", building: { id: buildingId, school_id: schoolId, name: "Shelby Hall", code: "SH", location: { lat: 33.2149, lng: -87.5398 } }, room: "101", source: "manual" });
  assert.deepEqual(toMeetingInput(meeting), { courseCode: "CH 101", days: ["mon", "wed"], start: "09:30", end: "10:45", timezone: "America/Chicago", termStart: "2026-08-19", termEnd: "2026-12-11", buildingName: "Shelby Hall", buildingLocation: { lat: 33.2149, lng: -87.5398 } });
});

test("schedule PUT validates foreign-school course and building references", () => {
  const request = PutClassScheduleReq.parse({ meetings: [{ course_id: courseId, building_id: buildingId, days: ["mon"], start: "09:00", end: "10:00", term: "Fall 2026", term_start: "2026-08-19", term_end: "2026-12-11", source: "manual" }] });
  assert.deepEqual(scheduleReferenceErrors(request.meetings, new Set(), new Set()), { "meetings.0.course_id": "Course must belong to your school", "meetings.0.building_id": "Building must belong to your school" });
  assert.deepEqual(scheduleReferenceErrors(request.meetings, new Set([courseId]), new Set([buildingId])), {});
});

test("new authenticated routes reject missing tokens", async () => {
  const fake: TokenVerifier = async () => null;
  const app = createApp({ verify: fake, log: false });
  for (const path of ["/courses", "/courses/00000000-0000-4000-a000-000000000010/materials", "/buildings", "/safe-zones", "/mail/drop-off-points", "/me/classes", "/me/class-schedule", "/me/availability?from=2026-10-17T00:00:00.000Z&to=2026-10-18T00:00:00.000Z"]) {
    const response = await app.request(`/api/v1${path}`);
    assert.equal(response.status, 401, path);
  }
  assert.equal((await app.request("/api/v1/me/classes", { method: "POST" })).status, 401);
  assert.equal((await app.request("/api/v1/me/class-schedule", { method: "PUT" })).status, 401);
  assert.equal((await app.request("/api/v1/me/classes/00000000-0000-4000-a000-000000000010", { method: "DELETE" })).status, 401);
});

test("tutoring routes reject missing tokens", async () => {
  const app = createApp({ verify: async () => null, log: false });
  const id = "00000000-0000-4000-a000-000000000010";
  for (const path of ["/me/tutor-eligibility", "/me/tutor-profile", `/tutors?course_id=${id}`, "/tutoring/sessions", `/tutoring/sessions/${id}`]) {
    assert.equal((await app.request(`/api/v1${path}`)).status, 401, path);
  }
  for (const path of ["/tutoring/sessions", `/tutoring/sessions/${id}/accept`, `/tutoring/sessions/${id}/counter`]) {
    assert.equal((await app.request(`/api/v1${path}`, { method: "POST" })).status, 401, path);
  }
  assert.equal((await app.request("/api/v1/me/tutor-profile", { method: "PUT" })).status, 401);
});

test("routers mounted at / keep unknown routes 404 instead of 401", async () => {
  const app = createApp({ verify: async () => null, log: false });
  assert.equal((await app.request("/api/v1/nope")).status, 404);
  assert.equal((await app.request("/api/v1/nope/abc")).status, 404);
});

test("filterText strips PostgREST filter syntax", () => {
  assert.equal(filterText("CH 101"), "CH 101");
  assert.equal(filterText("a,code.eq.x)"), "a code.eq.x");
  assert.equal(filterText('Fall "2026"%*'), "Fall  2026");
});
