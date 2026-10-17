import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import { CreateUploadUrlReq, mediaBucketFor, mediaPathFor } from "../db/media.js";

const userId = "00000000-0000-4000-a000-000000000005";
const mediaId = "00000000-0000-4000-a000-000000000006";

test("media upload validation accepts supported type, size, and purpose combinations", () => {
  const publicUpload = CreateUploadUrlReq.parse({ purpose: "listing_photo", content_type: "image/webp", byte_size: 10 * 1024 * 1024 });
  const privateUpload = CreateUploadUrlReq.parse({ purpose: "transcript", content_type: "application/pdf", byte_size: 1 });
  assert.equal(mediaBucketFor(publicUpload.purpose), "public-media");
  assert.equal(mediaBucketFor(privateUpload.purpose), "private-docs");
  assert.equal(CreateUploadUrlReq.safeParse({ purpose: "listing", content_type: "image/jpeg", byte_size: 1 }).success, false);
  assert.equal(CreateUploadUrlReq.safeParse({ purpose: "avatar", content_type: "image/gif", byte_size: 1 }).success, false);
  assert.equal(CreateUploadUrlReq.safeParse({ purpose: "avatar", content_type: "image/jpeg", byte_size: 10 * 1024 * 1024 + 1 }).success, false);
});

test("media object paths are owned and extension-specific", () => {
  assert.equal(mediaPathFor(userId, mediaId, "image/jpeg"), `${userId}/${mediaId}.jpg`);
  assert.equal(mediaPathFor(userId, mediaId, "text/calendar"), `${userId}/${mediaId}.ics`);
});

test("media endpoints reject requests without a bearer token", async () => {
  const app = createApp({ verify: async () => null, log: false });
  assert.equal((await app.request("/api/v1/media/upload-url", { method: "POST" })).status, 401);
  assert.equal((await app.request(`/api/v1/media/${mediaId}`)).status, 401);
});
