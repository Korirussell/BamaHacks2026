import { Hono } from "hono";
import { z } from "zod";
import { BuildingRow, CourseRow } from "../db/academics.js";
import { ApiError } from "../lib/errors.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { ImportClassScheduleReq, type ScheduleImportResult } from "../schemas/schedule.js";
import { parseIcs } from "../services/ics.js";
import { icsToDrafts, type ImportBuilding, type ImportCourse } from "../services/schedule-import.js";

export interface MediaRecord {
  id: string;
  bucket: string;
  path: string;
  kind: string;
  purpose: string;
  uploaded: boolean;
}

/** DB + storage I/O for schedule import, injectable so the flow is testable without Supabase. */
export interface ScheduleImportStore {
  findMedia(mediaId: string, userId: string, schoolId: string): Promise<MediaRecord | null>;
  createJob(input: { userId: string; schoolId: string; status: "queued" | "running"; payload: { kind: "ics" | "screenshot"; media_id: string } }): Promise<string>;
  finishJob(jobId: string, outcome: { status: "succeeded"; result: ScheduleImportResult } | { status: "failed"; error: string }): Promise<void>;
  downloadText(media: MediaRecord): Promise<string>;
  loadSchool(schoolId: string): Promise<{ timezone: string; courses: ImportCourse[]; buildings: ImportBuilding[] }>;
}

const MediaRow = z.object({ id: z.uuid(), bucket: z.string(), path: z.string(), kind: z.string(), purpose: z.string(), uploaded: z.boolean() });

export const supabaseScheduleImportStore: ScheduleImportStore = {
  async findMedia(mediaId, userId, schoolId) {
    const result = await adminClient().from("media").select("id, bucket, path, kind, purpose, uploaded").eq("id", mediaId).eq("owner_id", userId).eq("school_id", schoolId).maybeSingle();
    if (result.error) throw result.error;
    return result.data ? MediaRow.parse(result.data) : null;
  },
  async createJob({ userId, schoolId, status, payload }) {
    const result = await adminClient().from("jobs").insert({ kind: "schedule_import", status, payload, user_id: userId, school_id: schoolId }).select("id").single();
    if (result.error) throw result.error;
    return z.object({ id: z.uuid() }).parse(result.data).id;
  },
  async finishJob(jobId, outcome) {
    const update = outcome.status === "succeeded" ? { status: "succeeded", result: outcome.result, error: null } : { status: "failed", error: outcome.error };
    const result = await adminClient().from("jobs").update(update).eq("id", jobId);
    if (result.error) throw result.error;
  },
  async downloadText(media) {
    const result = await adminClient().storage.from(media.bucket).download(media.path);
    if (result.error) throw result.error;
    return result.data.text();
  },
  async loadSchool(schoolId) {
    const db = adminClient();
    const [school, courses, buildings] = await Promise.all([
      db.from("schools").select("timezone").eq("id", schoolId).maybeSingle(),
      db.from("courses").select("*").eq("school_id", schoolId),
      db.from("buildings").select("*").eq("school_id", schoolId),
    ]);
    if (school.error) throw school.error;
    if (courses.error) throw courses.error;
    if (buildings.error) throw buildings.error;
    if (!school.data) throw new ApiError(404, "NOT_FOUND", "School not found");
    return {
      timezone: z.object({ timezone: z.string() }).parse(school.data).timezone,
      courses: z.array(CourseRow).parse(courses.data).map(({ id, code }) => ({ id, code })),
      buildings: z.array(BuildingRow).parse(buildings.data).map(({ id, code, name }) => ({ id, code, name })),
    };
  },
};

const IMPORT_FAILED = "Couldn't read that calendar file";

// Path-scoped so routers mounted at "/" never put sign-in in front of public or unknown routes.
export const scheduleImportRoutes = (verify: TokenVerifier, store: ScheduleImportStore = supabaseScheduleImportStore) => new Hono<AuthEnv>()
  .use("/me/class-schedule/import", requireUser(verify))
  .post("/me/class-schedule/import", async (c) => {
    const { kind, media_id } = await parseBody(c, ImportClassScheduleReq);
    const { id: userId, schoolId } = c.var.user;
    const media = await store.findMedia(media_id, userId, schoolId);
    if (!media) throw new ApiError(404, "NOT_FOUND", "Media not found");
    if (media.purpose !== "schedule") throw new ApiError(400, "VALIDATION", "Invalid request", { media_id: "Media must be uploaded with purpose schedule" });
    if (kind === "ics" && media.kind !== "ics") throw new ApiError(400, "VALIDATION", "Invalid request", { media_id: "Media must be an .ics file" });
    if (!media.uploaded) throw new ApiError(400, "VALIDATION", "Invalid request", { media_id: "Upload hasn't finished" });

    const payload = { kind, media_id };
    if (kind === "screenshot") {
      // The AI worker that reads screenshots isn't built yet; leave the job queued for it.
      const jobId = await store.createJob({ userId, schoolId, status: "queued", payload });
      return c.json({ data: { job_id: jobId } }, 202);
    }

    const jobId = await store.createJob({ userId, schoolId, status: "running", payload });
    try {
      const school = await store.loadSchool(schoolId);
      const text = await store.downloadText(media);
      const { events } = parseIcs(text, school.timezone);
      const result = icsToDrafts(events, { courses: school.courses, buildings: school.buildings, schoolTimezone: school.timezone, now: new Date() });
      await store.finishJob(jobId, { status: "succeeded", result });
    } catch (err) {
      console.error("schedule import failed", err);
      await store.finishJob(jobId, { status: "failed", error: IMPORT_FAILED });
    }
    return c.json({ data: { job_id: jobId } }, 202);
  });
