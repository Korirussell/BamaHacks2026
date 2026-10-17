import { Hono } from "hono";
import { z } from "zod";
import { loadSchool } from "../db/tutoring.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { Cents, Uuid } from "../schemas/common.js";
import { TimeBlock } from "../schemas/tutoring.js";
import { findTutorMatches } from "../services/tutoring.js";
import { tutorCandidates, tutorIdsForCourse, tutorPool } from "./tutoring.js";

// POST /tutoring/requests (module 17): "find me a tutor" broadcast. Same eligibility as GET /tutors
// (verified grade at the school's threshold, open to requests, within the rate); every match is notified.

export const TutoringRequestReq = z.object({
  course_id: Uuid,
  windows: z.array(TimeBlock.refine((b) => Date.parse(b.end) > Date.parse(b.start), { path: ["end"], message: "Must be after start" })).min(1).max(20),
  max_rate_cents: Cents,
  notes: z.string().trim().max(1000).optional(),
});

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

export const tutoringRequestRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .use("/tutoring/requests", requireUser(verify))

  .post("/tutoring/requests", async (c) => {
    const body = await parseBody(c, TutoringRequestReq);
    const { id: studentId, schoolId } = c.var.user;
    if (body.windows.every((w) => Date.parse(w.end) <= Date.now())) {
      throw new ApiError(400, "VALIDATION", "Invalid request", { windows: "At least one window must be in the future" });
    }
    const [school, tutorIds] = await Promise.all([loadSchool(schoolId), tutorIdsForCourse(body.course_id, schoolId, studentId)]);
    const pool = await tutorPool(tutorIds, schoolId, school.tutor_min_grade);
    const fallback = { lat: school.center_lat, lng: school.center_lng };
    const matches = findTutorMatches({
      courseId: body.course_id, student: { userId: studentId, free: [], fallback },
      candidates: tutorCandidates(pool, body.course_id, schoolId, () => ({ free: [], fallback })),
      minGrade: school.tutor_min_grade, meetingPlace: null, durationMin: 60, now: Date.now(), maxRateCents: body.max_rate_cents,
    });
    const matchedIds = matches.map((m) => m.user_id);

    const course = z.object({ code: z.string() }).parse(check(await adminClient().from("courses").select("code").eq("id", body.course_id).single()));
    const request = z.object({ id: z.guid() }).parse(check(await adminClient().from("tutoring_requests").insert({
      school_id: schoolId, student_id: studentId, course_id: body.course_id, windows: body.windows,
      max_rate_cents: body.max_rate_cents, notes: body.notes ?? null, matched_tutor_ids: matchedIds,
    }).select("id").single()));

    // Respect notification_prefs.tutor_requests = false (they still count as matched).
    const prefs = matchedIds.length
      ? z.array(z.object({ id: z.guid(), notification_prefs: z.object({ tutor_requests: z.boolean().optional() }).loose() }))
        .parse(check(await adminClient().from("profiles").select("id, notification_prefs").in("id", matchedIds)))
      : [];
    const muted = new Set(prefs.filter((p) => p.notification_prefs.tutor_requests === false).map((p) => p.id));
    await Promise.all(matchedIds.filter((t) => !muted.has(t)).map((tutorId) => notify({
      schoolId, userId: tutorId, type: "tutoring.request",
      title: `Tutoring request: ${course.code}`,
      body: `A student wants help (up to $${(body.max_rate_cents / 100).toFixed(2).replace(/\.00$/, "")}/hr)${body.notes ? `: ${body.notes.slice(0, 120)}` : "."}`,
      deepLink: `/tutoring/requests/${request.id}`, data: { request_id: request.id, course_id: body.course_id, windows: body.windows },
    })));
    return c.json(one({ request_id: request.id, matched_tutor_count: matchedIds.length }), 201);
  });
