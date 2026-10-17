import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { CreateUploadUrlReq, Media, MediaRow, contentTypeAllowed, mediaBucketFor, mediaKindFor, mediaPathFor, type MediaRow as MediaRowT } from "../db/media.js";
import { ApiError } from "../lib/errors.js";
import { one } from "../lib/respond.js";
import { adminClient, publicMediaUrl } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";

// Supabase signed upload URLs are valid for 2 hours.
const UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;
const SELECT = "id, owner_id, purpose, bucket, path, kind, content_type, bytes, width, height, uploaded";

async function ownMedia(id: string, userId: string) {
  const result = await adminClient().from("media").select(SELECT).eq("id", id).eq("owner_id", userId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new ApiError(404, "NOT_FOUND", "Media not found");
  return MediaRow.parse(result.data);
}

async function toMedia(media: MediaRowT) {
  let url: string;
  if (media.bucket === "public-media") {
    url = publicMediaUrl(media.bucket, media.path);
  } else {
    const signed = await adminClient().storage.from(media.bucket).createSignedUrl(media.path, 600);
    if (signed.error) throw signed.error;
    url = signed.data.signedUrl;
  }
  return Media.parse({ id: media.id, url, kind: media.kind, width: media.width, height: media.height });
}

/**
 * Upload flow: POST /media/upload-url → client PUTs the file to `upload_url` → POST /media/{id}/complete.
 * Other endpoints only accept media once it's complete (`uploaded = true`).
 */
export const mediaRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .use("/media/*", requireUser(verify))
  .post("/media/upload-url", async (c) => {
    const input = await parseBody(c, CreateUploadUrlReq);
    if (!contentTypeAllowed(input.purpose, input.content_type)) {
      throw new ApiError(400, "VALIDATION", "Invalid request", { content_type: `Not accepted for ${input.purpose}` });
    }
    const mediaId = randomUUID();
    const bucket = mediaBucketFor(input.purpose);
    const path = mediaPathFor(c.var.user.id, mediaId, input.content_type);
    const db = adminClient();
    const inserted = await db.from("media").insert({
      id: mediaId, school_id: c.var.user.schoolId, owner_id: c.var.user.id, purpose: input.purpose, bucket, path,
      kind: mediaKindFor(input.content_type), content_type: input.content_type, bytes: input.bytes,
    });
    if (inserted.error) throw inserted.error;

    const signed = await db.storage.from(bucket).createSignedUploadUrl(path);
    if (signed.error) throw signed.error;
    return c.json(one({ media_id: mediaId, upload_url: signed.data.signedUrl, token: signed.data.token, expires_at: new Date(Date.now() + UPLOAD_TTL_MS).toISOString() }), 201);
  })
  .post("/media/:id/complete", async (c) => {
    const media = await ownMedia(c.req.param("id"), c.var.user.id);
    if (!media.uploaded) {
      const info = await adminClient().storage.from(media.bucket).info(media.path);
      if (info.error || !info.data) throw new ApiError(409, "INVALID_STATE", "The file hasn't been uploaded yet");
      const size = info.data.size ?? media.bytes;
      const updated = await adminClient().from("media").update({ uploaded: true, bytes: size }).eq("id", media.id);
      if (updated.error) throw updated.error;
      media.uploaded = true;
    }
    return c.json(one(await toMedia(media)));
  })
  .get("/media/:id", async (c) => {
    const media = await ownMedia(c.req.param("id"), c.var.user.id);
    if (!media.uploaded) throw new ApiError(409, "INVALID_STATE", "Upload hasn't finished");
    return c.json(one(await toMedia(media)));
  });
