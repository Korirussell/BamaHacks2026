import { Hono } from "hono";
import { z } from "zod";
import { classRecords, courseMaterials, courses, marketplace, type ClassRecordRow, type CourseRow } from "../db/store.js";
import { requireAuth, type AuthEnv } from "../lib/auth.js";
import { ApiError } from "../lib/errors.js";
import { one, page, paginate } from "../lib/respond.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { ClassStatus, type ClassRecord, type Course } from "../schemas/academics.js";
import { PageQuery, Uuid } from "../schemas/common.js";

// Module 8 — Academics: /me/classes, /courses, /me/upcoming-materials.

export const toCourse = (c: CourseRow): Course => ({ id: c.id, code: c.code, title: c.title, department: c.department });

const toClassRecord = (r: ClassRecordRow, course: CourseRow): ClassRecord => ({
  id: r.id,
  course: toCourse(course),
  term: r.term,
  status: r.status,
  grade: r.grade,
  grade_source: r.grade_source,
  grade_verified: r.grade_verified,
});

async function withCourses(schoolId: string, rows: ClassRecordRow[]) {
  const cs = await courses.getMany(schoolId, [...new Set(rows.map((r) => r.course_id))]);
  const byId = new Map(cs.map((c) => [c.id, c]));
  return rows.flatMap((r) => {
    const c = byId.get(r.course_id);
    return c ? [toClassRecord(r, c)] : [];
  });
}

const Term = z.string().trim().min(1).max(40);
const Grade = z.string().trim().toUpperCase().regex(/^([A-D][+-]?|F|P|NP|W|I)$/, "Must be a letter grade like A, B+, C-, F, P, W");

const AddClassReq = z.object({
  course_id: Uuid,
  term: Term,
  status: ClassStatus,
  grade: Grade.nullable().optional(),
});

export const academics = new Hono<AuthEnv>()
  .use("/me/*", requireAuth)
  .use("/courses", requireAuth)
  .use("/courses/*", requireAuth)

  // GET /me/classes?status= — current (now), past (grades → tutoring), planned (next semester).
  .get("/me/classes", async (c) => {
    const { status } = parseQuery(c, z.object({ status: ClassStatus.optional() }));
    const user = c.get("user");
    const rows = await classRecords.list(user.id, status);
    return c.json(page(await withCourses(user.schoolId, rows)));
  })

  // POST /me/classes — manual add; grades entered here are self-reported and unverified.
  .post("/me/classes", async (c) => {
    const body = await parseBody(c, AddClassReq);
    const user = c.get("user");
    const course = await courses.get(user.schoolId, body.course_id);
    if (!course) throw new ApiError(404, "NOT_FOUND", "Course not found", { course_id: "No such course at your school" });
    if (await classRecords.find(user.id, body.course_id, body.term)) {
      throw new ApiError(409, "VALIDATION", "Class already added for this term", { course_id: "Already on your classes for this term" });
    }
    const row = await classRecords.insert({
      user_id: user.id,
      course_id: course.id,
      term: body.term,
      status: body.status,
      grade: body.grade ?? null,
      grade_source: "self_reported",
      grade_verified: false,
    });
    return c.json(one(toClassRecord(row, course)), 201);
  })

  .delete("/me/classes/:id", async (c) => {
    const id = Uuid.safeParse(c.req.param("id"));
    if (!id.success || !(await classRecords.delete(c.get("user").id, id.data))) {
      throw new ApiError(404, "NOT_FOUND", "Class not found");
    }
    return c.body(null, 204);
  })

  // GET /me/upcoming-materials?term= — textbooks for the classes you have in that term.
  .get("/me/upcoming-materials", async (c) => {
    const { term } = parseQuery(c, z.object({ term: Term }));
    const user = c.get("user");
    const rows = (await classRecords.list(user.id)).filter(
      (r) => r.term.toLowerCase() === term.toLowerCase() && r.status !== "past",
    );
    const records = await withCourses(user.schoolId, rows);
    const out = [];
    for (const rec of records) {
      for (const m of await courseMaterials.forCourse(rec.course.id, term)) {
        out.push({
          course: rec.course,
          isbn: m.isbn,
          title: m.title,
          on_wishlist: await marketplace.onWishlist(user.id, m.isbn, rec.course.id),
          best_listing: await marketplace.bestListing(user.schoolId, m.isbn),
        });
      }
    }
    return c.json(page(out));
  })

  // GET /courses?q= — search the user's school catalog by code, title or department.
  .get("/courses", async (c) => {
    const q = parseQuery(c, PageQuery.extend({ q: z.string().default("") }));
    const list = await courses.search(c.get("user").schoolId, q.q);
    return c.json(paginate(list.map(toCourse), q.cursor, q.limit));
  })

  .get("/courses/:id/materials", async (c) => {
    const { term } = parseQuery(c, z.object({ term: Term.optional() }));
    const user = c.get("user");
    const id = Uuid.safeParse(c.req.param("id"));
    const course = id.success ? await courses.get(user.schoolId, id.data) : null;
    if (!course) throw new ApiError(404, "NOT_FOUND", "Course not found");
    const out = [];
    for (const m of await courseMaterials.forCourse(course.id, term)) {
      const stats = await marketplace.listingStats(user.schoolId, m.isbn);
      out.push({
        isbn: m.isbn,
        title: m.title,
        required: m.required,
        active_listings: stats.active,
        lowest_price_cents: stats.lowest_price_cents,
      });
    }
    return c.json(page(out));
  });
