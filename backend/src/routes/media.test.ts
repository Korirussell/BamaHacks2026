import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import { CreateUploadUrlReq, contentTypeAllowed, mediaBucketFor, mediaPathFor } from "../db/media.js";

const userId = "00000000-0000-4000-a000-000000000005";
const mediaId = "00000000-0000-4000-a000-000000000006";

test("media upload validation follows the contract's purposes and size cap", () => {
  const listing = CreateUploadUrlReq.parse({ purpose: "listing", content_type: "image/webp", bytes: 10 * 1024 * 1024 });
  const transcript = CreateUploadUrlReq.parse({ purpose: "transcript", content_type: "application/pdf", bytes: 1 });
  assert.equal(mediaBucketFor(listing.purpose), "public-media");
  assert.equal(mediaBucketFor(transcript.purpose), "private-docs");
  assert.equal(mediaBucketFor("handoff_proof"), "private-docs");
  assert.equal(CreateUploadUrlReq.safeParse({ purpose: "listing_photo", content_type: "image/jpeg", bytes: 1 }).success, false);
  assert.equal(CreateUploadUrlReq.safeParse({ purpose: "avatar", content_type: "image/gif", bytes: 1 }).success, false);
  assert.equal(CreateUploadUrlReq.safeParse({ purpose: "avatar", content_type: "image/jpeg", bytes: 10 * 1024 * 1024 + 1 }).success, false);
  assert.equal(contentTypeAllowed("schedule", "text/calendar"), true);
  assert.equal(contentTypeAllowed("avatar", "application/pdf"), false);
});

test("media object paths are owned and extension-specific", () => {
  assert.equal(mediaPathFor(userId, mediaId, "image/jpeg"), `${userId}/${mediaId}.jpg`);
  assert.equal(mediaPathFor(userId, mediaId, "text/calendar"), `${userId}/${mediaId}.ics`);
});

test("media endpoints reject requests without a bearer token", async () => {
  const app = createApp({ verify: async () => null, log: false });
  assert.equal((await app.request("/api/v1/media/upload-url", { method: "POST" })).status, 401);
  assert.equal((await app.request(`/api/v1/media/${mediaId}/complete`, { method: "POST" })).status, 401);
  assert.equal((await app.request(`/api/v1/media/${mediaId}`)).status, 401);
});
