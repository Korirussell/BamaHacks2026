import { z } from "zod";

export const MediaPurpose = z.enum([
  "listing_photo",
  "avatar",
  "handoff_proof",
  "transcript",
  "syllabus",
  "schedule",
]);
export const MediaBucket = z.enum(["public-media", "private-docs"]);
export const MediaKind = z.enum(["image", "pdf", "ics"]);

export const CreateUploadUrlReq = z.object({
  purpose: MediaPurpose,
  content_type: z.enum(["image/jpeg", "image/png", "image/heic", "image/webp", "application/pdf", "text/calendar"]),
  byte_size: z.number().int().positive().max(10 * 1024 * 1024),
}).strict();

export const MediaRow = z.object({
  id: z.uuid(),
  owner_id: z.uuid().nullable(),
  bucket: MediaBucket,
  path: z.string().min(1),
  kind: MediaKind,
  content_type: z.string(),
  bytes: z.number().int().positive(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});

export const Media = z.object({
  id: z.uuid(),
  url: z.string(),
  kind: MediaKind,
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});

export type CreateUploadUrlReq = z.infer<typeof CreateUploadUrlReq>;
export type MediaBucket = z.infer<typeof MediaBucket>;
export type MediaKind = z.infer<typeof MediaKind>;
export type MediaRow = z.infer<typeof MediaRow>;

export function mediaBucketFor(purpose: CreateUploadUrlReq["purpose"]): MediaBucket {
  return purpose === "transcript" || purpose === "syllabus" || purpose === "schedule" ? "private-docs" : "public-media";
}

export function mediaKindFor(contentType: CreateUploadUrlReq["content_type"]): MediaKind {
  if (contentType === "application/pdf") return "pdf";
  if (contentType === "text/calendar") return "ics";
  return "image";
}

export function mediaExtensionFor(contentType: CreateUploadUrlReq["content_type"]): string {
  return ({
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "text/calendar": "ics",
  } as const)[contentType];
}

export const mediaPathFor = (userId: string, mediaId: string, contentType: CreateUploadUrlReq["content_type"]) =>
  `${userId}/${mediaId}.${mediaExtensionFor(contentType)}`;
