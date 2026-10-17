import { z } from "zod";
import { Uuid } from "./common.js";

export const Job = z.object({ id: Uuid, kind: z.enum(["transcript_parse", "syllabus_parse", "schedule_import", "screenshot_to_listing", "textbook_identify", "ingest_classify"]), status: z.enum(["queued", "running", "succeeded", "failed"]), result: z.object({}).passthrough().nullable(), error: z.string().nullable() });
export type Job = z.infer<typeof Job>;
