import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import type { TokenVerifier } from "../middleware/auth.js";
import { CreateWishlistReq } from "../schemas/wishlist.js";
import {
  itemMatches, keywordMatches, matchesToAlert, suggestTrades, wishlistMatches, type Candidate, type WishItem,
} from "../services/wishlist.js";
import { wishlistTarget } from "./wishlist.js";

process.env["SUPABASE_URL"] ??= "https://example.supabase.co";

const me = "00000000-0000-4000-a000-000000000005";
const them = "00000000-0000-4000-a000-000000000006";
const course = "00000000-0000-4000-e000-000000000001";
const isbn = "9780134414232";

const signedIn: TokenVerifier = async () => ({ sub: me, email: "s@crimson.ua.edu", schoolId: "00000000-0000-4000-a000-000000000001" });
const auth = { headers: { Authorization: "Bearer test", "Content-Type": "application/json" } };
const app = createApp({ verify: signedIn, log: false });

const item = (over: Partial<WishItem>): WishItem => ({
  id: "w1", userId: me, kind: "isbn", isbn: null, courseId: null, keyword: null, category: null, maxPriceCents: null, ...over,
});
const listing = (over: Partial<Candidate>): Candidate => ({
  id: "l1", sellerId: them, status: "active", category: "textbook", isbn, priceCents: 6000, courseIds: [course],
  text: "Chemistry: The Central Science 14th edition, barely used", ...over,
});

test("items match by ISBN, course, category and keyword", () => {
  assert.ok(itemMatches(item({ kind: "isbn", isbn }), listing({})));
  assert.ok(!itemMatches(item({ kind: "isbn", isbn: "9780000000002" }), listing({})));
  assert.ok(itemMatches(item({ kind: "course_materials", courseId: course }), listing({})));
  assert.ok(!itemMatches(item({ kind: "course_materials", courseId: "00000000-0000-4000-e000-000000000009" }), listing({})));
  assert.ok(itemMatches(item({ kind: "category", category: "textbook" }), listing({})));
  assert.ok(!itemMatches(item({ kind: "category", category: "dorm" }), listing({})));
  assert.ok(itemMatches(item({ kind: "keyword", keyword: "central chem" }), listing({})));
  assert.ok(!itemMatches(item({ kind: "keyword", keyword: "physics" }), listing({})));
});

test("max price, inactive listings and my own listings never match", () => {
  const wish = item({ kind: "isbn", isbn, maxPriceCents: 5000 });
  assert.ok(!itemMatches(wish, listing({})));
  assert.ok(itemMatches(wish, listing({ priceCents: 5000 })));
  assert.ok(!itemMatches(item({ kind: "isbn", isbn }), listing({ status: "sold" })));
  assert.ok(!itemMatches(item({ kind: "isbn", isbn }), listing({ sellerId: me })));
});

test("keyword words are case-insensitive prefixes; the database's full-text answer wins when given", () => {
  assert.ok(keywordMatches("CALC", "Calculus early transcendentals"));
  assert.ok(!keywordMatches("calc fridge", "Calculus early transcendentals"));
  assert.ok(!keywordMatches("  ", "anything"));
  const kw = item({ id: "k", kind: "keyword", keyword: "zzz" });
  const hits = new Map([["k", new Set(["l1"])]]);
  assert.deepEqual(wishlistMatches([kw], [listing({}), listing({ id: "l2" })], hits), [{ itemId: "k", userId: me, listingId: "l1" }]);
});

test("one alert per person per listing", () => {
  const items = [item({ id: "a", isbn }), item({ id: "b", kind: "category", category: "textbook" }), item({ id: "c", userId: "u2", isbn })];
  assert.deepEqual(matchesToAlert(items, listing({})).map((m) => m.itemId), ["a", "c"]);
});

test("trade suggestions: my listings the other seller wants, best price fit and mutual matches first", () => {
  const theirListing = listing({ id: "theirs", sellerId: them, priceCents: 6000 });
  const myListings = [
    listing({ id: "lamp", sellerId: me, category: "dorm", isbn: null, courseIds: [], priceCents: 1000, text: "desk lamp" }),
    listing({ id: "calc", sellerId: me, isbn: "9781285741550", courseIds: [], priceCents: 5500, text: "Calculus" }),
    listing({ id: "fridge", sellerId: me, category: "dorm", isbn: null, courseIds: [], priceCents: 9000, text: "mini fridge" }),
  ];
  const theirWishlist = [item({ id: "t1", userId: them, kind: "keyword", keyword: "lamp" }), item({ id: "t2", userId: them, kind: "isbn", isbn: "9781285741550" })];
  const out = suggestTrades({ viewerId: me, theirListing, myListings, theirWishlist, myWishlist: [] });
  assert.deepEqual(out.map((s) => s.myListingIds), [["calc"], ["lamp"]]);
  assert.equal(out[0]?.cashDeltaCents, 500);
  assert.equal(out[0]?.score, 0.46);

  const mutual = suggestTrades({ viewerId: me, theirListing, myListings, theirWishlist, myWishlist: [item({ kind: "isbn", isbn })] });
  assert.equal(mutual[0]?.score, 0.96);
  assert.deepEqual(suggestTrades({ viewerId: them, theirListing, myListings, theirWishlist, myWishlist: [] }), []);
  assert.deepEqual(suggestTrades({ viewerId: me, theirListing: { ...theirListing, sellerId: null }, myListings, theirWishlist, myWishlist: [] }), []);
});

test("wishlist bodies need the target field for their kind; ISBNs are normalized", () => {
  assert.ok(!CreateWishlistReq.safeParse({ kind: "isbn" }).success);
  assert.ok(!CreateWishlistReq.safeParse({ kind: "keyword", keyword: " a " }).success);
  assert.ok(!CreateWishlistReq.safeParse({ kind: "category", category: "cars" }).success);
  const parsed = CreateWishlistReq.parse({ kind: "isbn", isbn: "978-0-13-441423-2", max_price_cents: 4000 });
  assert.equal(parsed.alert, true);
  assert.deepEqual(wishlistTarget(parsed), { isbn: "9780134414232", course_id: null, keyword: null, category: null });
  assert.throws(() => wishlistTarget(CreateWishlistReq.parse({ kind: "isbn", isbn: "123" })));
});

test("wishlist routes need a sign-in, a valid body and real ids", async () => {
  const anon = createApp({ verify: async () => null, log: false });
  assert.equal((await anon.request("/api/v1/me/wishlist")).status, 401);
  assert.equal((await anon.request("/api/v1/listings/00000000-0000-4000-b000-000000000001/suggested-trades")).status, 401);
  const post = (body: unknown) => app.request("/api/v1/me/wishlist", { method: "POST", body: JSON.stringify(body), ...auth });
  assert.equal((await post({ kind: "nope" })).status, 400);
  assert.equal((await post({ kind: "course_materials", course_id: "x" })).status, 400);
  assert.equal((await post({ kind: "isbn", isbn: "123" })).status, 400);
  assert.equal((await post({ kind: "keyword", keyword: "lamp", max_price_cents: -5 })).status, 400);
  assert.equal((await app.request("/api/v1/me/wishlist/not-a-uuid", { method: "DELETE", ...auth })).status, 404);
  assert.equal((await app.request("/api/v1/me/wishlist/matches?limit=500", auth)).status, 400);
  assert.equal((await app.request("/api/v1/listings/not-a-uuid/suggested-trades", auth)).status, 404);
});
