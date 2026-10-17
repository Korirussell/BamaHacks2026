import { Hono } from "hono";
import { z } from "zod";
import { BuildingRow, ClassRecordRow, CourseRow, DropOffPointRow, SafeZoneRow, toBuilding, toClassRecord, toCourse } from "../db/academics.js";
import { ApiError } from "../lib/errors.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";

const CoursesQuery = z.object({ q: z.string().default("") });
const ClassesQuery = z.object({ status: z.enum(["current", "past", "planned"]).optional() });
const UpcomingQuery = z.object({ term: z.string().trim().min(1) });
const CreateClassReq = z.object({ course_id: z.guid(), term: z.string().min(1), status: z.enum(["current", "past", "planned"]), grade: z.string().nullable().optional() });

// Free text goes inside PostgREST `.or()` filter strings, where , ( ) " and \ are syntax and % * are wildcards.
export const filterText = (value: string) => value.replace(/[,()"\\%*]/g, " ").trim();

const listClassRecords = async (userId: string, schoolId: string, status?: "current" | "past" | "planned") => {
  let query = adminClient().from("class_records").select("*, course:courses(*)").eq("user_id", userId).eq("school_id", schoolId);
  if (status) query = query.eq("status", status);
  const result = await query.order("created_at", { ascending: false });
  if (result.error) throw result.error;
  return z.array(ClassRecordRow).parse(result.data).map(toClassRecord);
};

// Path-scoped so routers mounted at "/" never put sign-in in front of public or unknown routes.
export const academicsRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .use("/courses/*", requireUser(verify))
  .use("/buildings/*", requireUser(verify))
  .use("/safe-zones/*", requireUser(verify))
  .use("/mail/*", requireUser(verify))
  .use("/me/classes/*", requireUser(verify))
  .use("/me/upcoming-materials/*", requireUser(verify))
  .get("/courses", async (c) => {
    const { q } = parseQuery(c, CoursesQuery);
    const pattern = `%${filterText(q)}%`;
    const result = await adminClient().from("courses").select("*").eq("school_id", c.var.user.schoolId).or(`code.ilike.${pattern},title.ilike.${pattern}`).limit(20);
    if (result.error) throw result.error;
    return c.json(one(z.array(CourseRow).parse(result.data).map(toCourse)));
  })
  .get("/courses/:id/materials", async (c) => {
    const db = adminClient();
    const course = await db.from("courses").select("id").eq("id", c.req.param("id")).eq("school_id", c.var.user.schoolId).maybeSingle();
    if (course.error) throw course.error;
    if (!course.data) throw new ApiError(404, "NOT_FOUND", "Course not found");
    let materials = db.from("course_materials").select("isbn, title, required, term").eq("course_id", c.req.param("id")).eq("school_id", c.var.user.schoolId);
    const term = c.req.query("term");
    if (term) materials = materials.or(`term.is.null,term.eq."${filterText(term)}"`);
    const materialResult = await materials;
    if (materialResult.error) throw materialResult.error;
    const rows = await Promise.all((materialResult.data ?? []).map(async (material) => {
      const listings = await db.from("listings").select("price_cents").eq("school_id", c.var.user.schoolId).eq("status", "active").eq("isbn", material.isbn);
      if (listings.error) throw listings.error;
      const prices = listings.data.map((listing) => listing.price_cents);
      return { isbn: material.isbn, title: material.title, required: material.required, active_listings: prices.length, lowest_price_cents: prices.length ? Math.min(...prices) : null };
    }));
    return c.json(one(rows));
  })
  .get("/buildings", async (c) => {
    const q = filterText(c.req.query("q") ?? "");
    const result = await adminClient().from("buildings").select("*").eq("school_id", c.var.user.schoolId).or(`code.ilike.%${q}%,name.ilike.%${q}%`).limit(20);
    if (result.error) throw result.error;
    return c.json(one(z.array(BuildingRow).parse(result.data).map(toBuilding)));
  })
  .get("/safe-zones", async (c) => {
    const result = await adminClient().from("safe_zones").select("*").eq("school_id", c.var.user.schoolId).eq("active", true);
    if (result.error) throw result.error;
    return c.json(one(z.array(SafeZoneRow).parse(result.data).map((row) => ({ id: row.id, name: row.name, kind: row.kind, location: { lat: row.lat, lng: row.lng }, radius_m: row.radius_m, hours: row.hours, hours_note: row.hours_note }))));
  })
  .get("/mail/drop-off-points", async (c) => {
    const result = await adminClient().from("drop_off_points").select("*").eq("school_id", c.var.user.schoolId).eq("active", true);
    if (result.error) throw result.error;
    return c.json(one(z.array(DropOffPointRow).parse(result.data).map((row) => ({ id: row.id, name: row.name, location: { lat: row.lat, lng: row.lng }, radius_m: row.radius_m, hours: row.hours, instructions: row.instructions }))));
  })
  .get("/me/classes", async (c) => c.json(one(await listClassRecords(c.var.user.id, c.var.user.schoolId, parseQuery(c, ClassesQuery).status))))
  .post("/me/classes", async (c) => {
    const input = await parseBody(c, CreateClassReq);
    const db = adminClient();
    const course = await db.from("courses").select("id").eq("id", input.course_id).eq("school_id", c.var.user.schoolId).maybeSingle();
    if (course.error) throw course.error;
    if (!course.data) throw new ApiError(400, "VALIDATION", "Invalid request", { course_id: "Course must belong to your school" });
    const inserted = await db.from("class_records").insert({ school_id: c.var.user.schoolId, user_id: c.var.user.id, course_id: input.course_id, term: input.term, status: input.status, grade: input.grade ?? null, grade_source: "self_reported", grade_verified: false }).select("*, course:courses(*)").single();
    if (inserted.error) throw inserted.error;
    return c.json(one(toClassRecord(ClassRecordRow.parse(inserted.data))));
  })
  // Textbooks for the classes you're taking (or planning) in `term`, so you know what to buy.
  // on_wishlist / best_listing stay false / null until the wishlist and listings modules land.
  .get("/me/upcoming-materials", async (c) => {
    const { term } = parseQuery(c, UpcomingQuery);
    const records = (await listClassRecords(c.var.user.id, c.var.user.schoolId)).filter((r) => r.status !== "past" && r.term.toLowerCase() === term.toLowerCase());
    if (!records.length) return c.json(one([]));
    const materials = await adminClient().from("course_materials").select("course_id, isbn, title, term").eq("school_id", c.var.user.schoolId).in("course_id", records.map((r) => r.course.id)).or(`term.is.null,term.eq."${filterText(term)}"`);
    if (materials.error) throw materials.error;
    const byCourse = new Map(records.map((r) => [r.course.id, r.course]));
    return c.json(one(materials.data.flatMap((m) => {
      const course = byCourse.get(m.course_id);
      return course ? [{ course, isbn: m.isbn, title: m.title, on_wishlist: false, best_listing: null }] : [];
    })));
  })
  .delete("/me/classes/:id", async (c) => {
    const result = await adminClient().from("class_records").delete().eq("id", c.req.param("id")).eq("user_id", c.var.user.id).eq("school_id", c.var.user.schoolId);
    if (result.error) throw result.error;
    return c.body(null, 204);
  });
