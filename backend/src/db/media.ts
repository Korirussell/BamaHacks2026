import { z } from "zod";

// Upload purposes from the contract, plus the proof photos the handoff and shipping flows take.
export const MediaPurpose = z.enum(["listing", "avatar", "transcript", "syllabus", "schedule", "screenshot", "drop_off_proof", "handoff_proof"]);
export const MediaBucket = z.enum(["public-media", "private-docs"]);
export const MediaKind = z.enum(["image", "pdf", "ics"]);
export const MediaContentType = z.enum(["image/jpeg", "image/png", "image/heic", "image/webp", "application/pdf", "text/calendar"]);
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const CreateUploadUrlReq = z.object({
  purpose: MediaPurpose,
  content_type: MediaContentType,
  bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
}).strict();

export const MediaRow = z.object({
  id: z.guid(),
  owner_id: z.guid().nullable(),
  purpose: z.string(),
  bucket: MediaBucket,
  path: z.string().min(1),
  kind: MediaKind,
  content_type: z.string(),
  bytes: z.number().int().positive(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  uploaded: z.boolean(),
});

export const Media = z.object({
  id: z.guid(),
  url: z.string(),
  kind: MediaKind,
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});

export type CreateUploadUrlReq = z.infer<typeof CreateUploadUrlReq>;
export type MediaPurpose = z.infer<typeof MediaPurpose>;
export type MediaBucket = z.infer<typeof MediaBucket>;
export type MediaKind = z.infer<typeof MediaKind>;
export type MediaContentType = z.infer<typeof MediaContentType>;
export type MediaRow = z.infer<typeof MediaRow>;

/** Which content types each purpose takes. */
const ALLOWED: Record<MediaPurpose, MediaContentType[]> = {
  listing: ["image/jpeg", "image/png", "image/heic", "image/webp"],
  avatar: ["image/jpeg", "image/png", "image/heic", "image/webp"],
  screenshot: ["image/jpeg", "image/png", "image/heic", "image/webp"],
  drop_off_proof: ["image/jpeg", "image/png", "image/heic", "image/webp"],
  handoff_proof: ["image/jpeg", "image/png", "image/heic", "image/webp"],
  transcript: ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"],
  syllabus: ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"],
  schedule: ["text/calendar", "image/jpeg", "image/png", "image/heic", "image/webp"],
};

export const contentTypeAllowed = (purpose: MediaPurpose, contentType: MediaContentType) => ALLOWED[purpose].includes(contentType);

/** Listing photos and avatars are public; documents, screenshots and proof photos stay private. */
export function mediaBucketFor(purpose: MediaPurpose): MediaBucket {
  return purpose === "listing" || purpose === "avatar" ? "public-media" : "private-docs";
}

export function mediaKindFor(contentType: MediaContentType): MediaKind {
  if (contentType === "application/pdf") return "pdf";
  if (contentType === "text/calendar") return "ics";
  return "image";
}

const EXTENSION: Record<MediaContentType, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/webp": "webp", "application/pdf": "pdf", "text/calendar": "ics",
};

export const mediaPathFor = (userId: string, mediaId: string, contentType: MediaContentType) => `${userId}/${mediaId}.${EXTENSION[contentType]}`;
