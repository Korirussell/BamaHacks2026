import assert from "node:assert/strict";
import test from "node:test";
import { captionTextbookIdentifier } from "../adapters/stubs.js";
import { createApp } from "../app.js";
import { ListingRow, courseMatch, toListing } from "../db/market.js";
import { claimUrl, claimUrlIn, sellerInviteMessage } from "../services/claims.js";
import { draftFromPost, normalizeHandle } from "../services/ingest.js";

process.env["SUPABASE_URL"] ??= "https://example.supabase.co";

const school = "00000000-0000-4000-a000-000000000001";
const ch101 = { id: "00000000-0000-4000-e000-000000000001", school_id: school, code: "CH 101", title: "General Chemistry I", department: "Chemistry" };
const ch102 = { ...ch101, id: "00000000-0000-4000-e000-000000000002", code: "CH 102", title: "General Chemistry II" };
const chemBook = { title: "Chemistry: The Central Science", authors: ["Theodore L. Brown"], edition: "14th" };
const caption = "Chemistry: The Central Science 14th ed\nISBN 978-0134414232, barely used. $60 obo, DM me";

test("an ingested caption with a known ISBN and a price becomes an active textbook listing for both classes", async () => {
  const guess = await captionTextbookIdentifier.identify({ imageUrls: [], caption });
  const draft = draftFromPost({ channel: "instagram", authorHandle: "@Bama_Books", caption }, guess, (isbn) =>
    isbn === "9780134414232" ? [{ courseId: ch101.id, ...chemBook }, { courseId: ch102.id, ...chemBook }] : []);
  assert.equal(draft.status, "active");
  assert.equal(draft.category, "textbook");
  assert.equal(draft.isbn, "9780134414232");
  assert.equal(draft.priceCents, 6000);
  assert.equal(draft.title, "Chemistry: The Central Science (14th ed.)");
  assert.deepEqual(draft.courseIds, [ch101.id, ch102.id]);
  assert.equal(draft.externalHandle, "bama_books");
  assert.equal(draft.externalProfileUrl, "https://www.instagram.com/bama_books/");
  assert.deepEqual(draft.missing, []);
});

test("a post without an ISBN or price stays a draft and says what's missing", async () => {
  const guess = await captionTextbookIdentifier.identify({ imageUrls: [], caption: "mini fridge, works great" });
  const draft = draftFromPost({ channel: "groupme", authorHandle: "someone", caption: "mini fridge, works great" }, guess, () => []);
  assert.equal(draft.status, "draft");
  assert.equal(draft.category, "other");
  assert.deepEqual(draft.missing, ["isbn", "price"]);
  assert.equal(draft.externalProfileUrl, null);
});

test("handles are stored lower-case without the @", () => {
  assert.equal(normalizeHandle("  @@Bama_Books "), "bama_books");
});

test("the claim link can be read back out of the stored DM", () => {
  const url = claimUrl("http://localhost:3000/", "abcDEF123_-xyz7890000");
  const message = sellerInviteMessage({ handle: "bama_books", itemTitle: "Chem", offerCents: 5500, courseCode: "CH 101", appName: "Campus Marketplace", url });
  assert.equal(url, "http://localhost:3000/claim/abcDEF123_-xyz7890000");
  assert.equal(claimUrlIn(message), url);
  assert.match(message, /offered \$55\.00/);
});

const row = ListingRow.parse({
  id: "00000000-0000-4000-c000-000000000001", school_id: school, seller_id: null,
  external_channel: "instagram", external_handle: "bama_books", external_profile_url: null,
  category: "textbook", title: "Chem (14th ed.)", description: "", price_cents: 6000, negotiable: true, floor_price_cents: 4000,
  condition: "good", isbn: "9780134414232", textbook_title: "Chemistry: The Central Science", authors: [], edition: "14th",
  fulfillment: ["in_person", "campus_mail"], status: "active", source_channel: "instagram", external_url: "https://instagram.com/p/x",
  ingested_post_id: null, claimed: false, created_at: "2026-10-17 15:00:00+00",
  listing_courses: [{ course: ch102 }, { course: ch101 }],
  listing_media: [{ position: 0, media: { id: "00000000-0000-4000-c000-000000000002", bucket: "private-docs", path: "x.png", kind: "image", width: null, height: null, uploaded: true } }],
});

test("listings show the viewer's matching class, hide the floor and private media", () => {
  const viewer = { id: "buyer", courses: new Map([[ch101.id, ch101]]) };
  assert.equal(courseMatch(row, viewer)?.code, "CH 101");
  const listing = toListing(row, new Map(), viewer);
  assert.equal(listing.course_match?.code, "CH 101");
  assert.equal(listing.floor_price_cents, null);
  assert.deepEqual(listing.media, []);
  assert.deepEqual(listing.textbook?.courses.map((c) => c.code), ["CH 101", "CH 102"]);
  assert.deepEqual(listing.source, { channel: "instagram", external_url: "https://instagram.com/p/x", claimed: false });
  assert.equal(listing.created_at, "2026-10-17T15:00:00.000Z");
  assert.equal(courseMatch(row, { id: "other", courses: new Map() }), null);
});

test("marketplace routes reject missing tokens; a malformed claim link is CLAIM_INVALID without one", async () => {
  const app = createApp({ verify: async () => null, log: false });
  const id = "00000000-0000-4000-a000-000000000010";
  for (const path of ["/feed", "/explore/listings", `/listings/${id}`, "/me/listings", "/me/offers", "/me/orders", `/orders/${id}`, "/admin/seller-invites", "/me/notifications"]) {
    assert.equal((await app.request(`/api/v1${path}`)).status, 401, path);
  }
  for (const path of ["/listings", `/listings/${id}/offers`, `/offers/${id}/accept`, `/orders/${id}/pay`, `/orders/${id}/cancel`, "/admin/ingested-posts", "/claims/abcdefghijklmnopqrstuvwx", "/me/notifications/read"]) {
    assert.equal((await app.request(`/api/v1${path}`, { method: "POST" })).status, 401, path);
  }
  const bad = await app.request("/api/v1/claims/short");
  assert.equal(bad.status, 410);
  assert.equal(((await bad.json()) as { error: { code: string } }).error.code, "CLAIM_INVALID");
});
