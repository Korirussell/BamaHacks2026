import { z } from "zod";
import { toContractParsed, type ParsedTranscript } from "../services/transcript.js";

const ParsedClass = z.object({
  course_code: z.string(),
  title: z.string(),
  credits: z.number(),
  grade: z.string().nullable(),
  matched_course_id: z.guid().nullable(),
});

/** The stored `parsed` jsonb: ParsedTranscript, keeping each term's `section`. */
export const ParsedTranscriptJson = z.object({
  student_name: z.string().nullable(),
  terms: z.array(z.object({ term: z.string(), section: z.enum(["transfer", "institution", "in_progress"]), classes: z.array(ParsedClass) })),
  gpa: z.number().nullable(),
});

export const TranscriptStatus = z.enum(["parsing", "needs_review", "confirmed", "failed"]);
export type TranscriptStatus = z.infer<typeof TranscriptStatus>;

export const TranscriptRow = z.object({
  id: z.guid(),
  school_id: z.guid(),
  user_id: z.guid(),
  media_id: z.guid(),
  job_id: z.guid().nullable(),
  status: TranscriptStatus,
  parsed: ParsedTranscriptJson.nullable(),
  error: z.string().nullable(),
});
export type TranscriptRow = z.infer<typeof TranscriptRow>;

const EMPTY_PARSED = { student_name: null, terms: [], gpa: null };

/** Contract GET /transcripts/{id} shape; `parsed` is empty until the parse has produced something. */
export const toTranscript = (row: TranscriptRow) => ({
  id: row.id,
  status: row.status,
  parsed: row.parsed && (row.status === "needs_review" || row.status === "confirmed") ? toContractParsed(row.parsed satisfies ParsedTranscript) : EMPTY_PARSED,
});
