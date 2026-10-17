import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { CreateUploadUrlReq, Media, MediaRow, mediaBucketFor, mediaKindFor, mediaPathFor } from "../db/media.js";
import { ApiError } from "../lib/errors.js";
import { one } from "../lib/respond.js";
import { adminClient, publicMediaUrl } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";

export const mediaRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .use("/media/*", requireUser(verify))
  .post("/media/upload-url", async (c) => {
    const input = await parseBody(c, CreateUploadUrlReq);
    const mediaId = randomUUID();
    const bucket = mediaBucketFor(input.purpose);
    const path = mediaPathFor(c.var.user.id, mediaId, input.content_type);
    const db = adminClient();
    const inserted = await db.from("media").insert({
      id: mediaId,
      school_id: c.var.user.schoolId,
      owner_id: c.var.user.id,
      purpose: input.purpose,
      bucket,
      path,
      kind: mediaKindFor(input.content_type),
      content_type: input.content_type,
      bytes: input.byte_size,
    }).select("id").single();
    if (inserted.error) throw inserted.error;

    const signed = await db.storage.from(bucket).createSignedUploadUrl(path);
    if (signed.error) throw signed.error;
    return c.json(one({ media_id: mediaId, upload_url: signed.data.signedUrl, token: signed.data.token, path }));
  })
  .get("/media/:id", async (c) => {
    const result = await adminClient().from("media").select("id, owner_id, bucket, path, kind, content_type, bytes, width, height")
      .eq("id", c.req.param("id")).eq("owner_id", c.var.user.id).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new ApiError(404, "NOT_FOUND", "Media not found");
    const media = MediaRow.parse(result.data);
    let url: string;
    if (media.bucket === "public-media") {
      url = publicMediaUrl(media.bucket, media.path);
    } else {
      const signed = await adminClient().storage.from(media.bucket).createSignedUrl(media.path, 600);
      if (signed.error) throw signed.error;
      url = signed.data.signedUrl;
    }
    return c.json(one(Media.parse({ id: media.id, url, kind: media.kind, width: media.width, height: media.height })));
  });
