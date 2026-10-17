import { z } from "zod";
import { notify } from "../lib/notify.js";
import { adminClient } from "../lib/supabase.js";
import { SuggestedTrade, WishlistItem } from "../schemas/wishlist.js";
import {
  matchesToAlert, suggestTrades, wishlistMatches, type Candidate, type WishItem, type WishMatch,
} from "../services/wishlist.js";
import { CourseRow, toCourse } from "./academics.js";
import { LISTING_SELECT, ListingRow, listingsOut, type Viewer } from "./market.js";

const MATCH_WINDOW = 100;

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

export const WishlistRow = z.object({
  id: z.guid(), school_id: z.guid(), user_id: z.guid(), kind: z.enum(["isbn", "course_materials", "keyword", "category"]),
  isbn: z.string().nullable(), course_id: z.guid().nullable(), keyword: z.string().nullable(),
  category: z.enum(["textbook", "lab_supplies", "dorm", "ticket", "other"]).nullable(),
  max_price_cents: z.number().int().nullable(), alert: z.boolean(), course: CourseRow.nullable(),
});
export type WishlistRow = z.infer<typeof WishlistRow>;

export const WISHLIST_SELECT = "*, course:courses(*)";

export const toWishItem = (r: WishlistRow): WishItem => ({
  id: r.id, userId: r.user_id, kind: r.kind, isbn: r.isbn, courseId: r.course_id, keyword: r.keyword, category: r.category, maxPriceCents: r.max_price_cents,
});

export const toCandidate = (r: ListingRow): Candidate => ({
  id: r.id, sellerId: r.seller_id, status: r.status, category: r.category, isbn: r.isbn, priceCents: r.price_cents,
  courseIds: r.listing_courses.map((lc) => lc.course.id),
  text: [r.title, r.description, r.textbook_title ?? "", r.isbn ?? ""].join(" "),
});

export const toWishlistItem = (r: WishlistRow, matchCount: number) => WishlistItem.parse({
  id: r.id, kind: r.kind, isbn: r.isbn, course: r.course ? toCourse(r.course) : null, keyword: r.keyword, category: r.category,
  max_price_cents: r.max_price_cents, alert: r.alert, match_count: matchCount,
});

export async function loadWishlist(userId: string, schoolId: string): Promise<WishlistRow[]> {
  const data = check(
    await adminClient().from("wishlist_items").select(WISHLIST_SELECT).eq("school_id", schoolId).eq("user_id", userId).order("created_at", { ascending: false }),
  );
  return z.array(WishlistRow).parse(data);
}

const activeListings = (schoolId: string) =>
  adminClient().from("listings").select(LISTING_SELECT).eq("school_id", schoolId).eq("status", "active").order("created_at", { ascending: false }).limit(MATCH_WINDOW);

/** Active listings matching any of the items: by ISBN, course, category, or full-text keyword search. */
export async function findMatches(items: WishlistRow[], schoolId: string): Promise<{ matches: WishMatch[]; listings: Map<string, ListingRow> }> {
  const isbns = [...new Set(items.flatMap((i) => (i.isbn ? [i.isbn] : [])))];
  const courseIds = [...new Set(items.flatMap((i) => (i.course_id ? [i.course_id] : [])))];
  const categories = [...new Set(items.flatMap((i) => (i.category ? [i.category] : [])))];
  const keywordItems = items.filter((i) => i.keyword);

  const courseListingIds = courseIds.length
    ? z.array(z.object({ listing_id: z.guid() })).parse(check(await adminClient().from("listing_courses").select("listing_id").in("course_id", courseIds))).map((r) => r.listing_id)
    : [];
  const [byIsbn, byCourse, byCategory, ...byKeyword] = await Promise.all([
    isbns.length ? activeListings(schoolId).in("isbn", isbns) : null,
    courseListingIds.length ? activeListings(schoolId).in("id", [...new Set(courseListingIds)]) : null,
    categories.length ? activeListings(schoolId).in("category", categories) : null,
    ...keywordItems.map((i) => activeListings(schoolId).textSearch("search", i.keyword ?? "", { type: "websearch", config: "english" })),
  ]);
  const parse = (r: typeof byIsbn) => (r ? z.array(ListingRow).parse(check(r)) : []);

  const listings = new Map<string, ListingRow>();
  for (const row of [byIsbn, byCourse, byCategory, ...byKeyword].flatMap(parse)) listings.set(row.id, row);
  const keywordHits = new Map(keywordItems.map((item, i) => [item.id, new Set(parse(byKeyword[i] ?? null).map((r) => r.id))]));
  const candidates = [...listings.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(toCandidate);
  return { matches: wishlistMatches(items.map(toWishItem), candidates, keywordHits), listings };
}

export function matchCounts(matches: WishMatch[]) {
  const counts = new Map<string, number>();
  for (const m of matches) counts.set(m.itemId, (counts.get(m.itemId) ?? 0) + 1);
  return counts;
}

/** Ids of the feed rows that match the viewer's wishlist (keywords matched in memory). */
export async function wishedListingIds(userId: string, schoolId: string, rows: ListingRow[]): Promise<Set<string>> {
  const items = await loadWishlist(userId, schoolId);
  if (!items.length) return new Set();
  return new Set(wishlistMatches(items.map(toWishItem), rows.map(toCandidate)).map((m) => m.listingId));
}

const Prefs = z.object({ id: z.guid(), notification_prefs: z.object({ wishlist_alerts: z.boolean().default(true) }) });

/** wishlist.match for everyone whose alerting wishlist item matches a listing that just went active. Returns how many were told. */
export async function notifyWishlistMatch(row: ListingRow, from: string): Promise<number> {
  if (row.status !== "active") return 0;
  const db = adminClient();
  const courseIds = row.listing_courses.map((lc) => lc.course.id);
  const targets = [
    "kind.eq.keyword",
    `category.eq.${row.category}`,
    ...(row.isbn ? [`isbn.eq.${row.isbn}`] : []),
    ...(courseIds.length ? [`course_id.in.(${courseIds.join(",")})`] : []),
  ];
  let query = db.from("wishlist_items").select(WISHLIST_SELECT).eq("school_id", row.school_id).eq("alert", true).or(targets.join(","));
  if (row.seller_id) query = query.neq("user_id", row.seller_id);
  const items = z.array(WishlistRow).parse(check(await query.limit(1000)));
  const matches = matchesToAlert(items.map(toWishItem), toCandidate(row));
  if (!matches.length) return 0;

  const prefs = z.array(Prefs).parse(check(await db.from("profiles").select("id, notification_prefs").in("id", matches.map((m) => m.userId))));
  const wantsAlerts = new Set(prefs.filter((p) => p.notification_prefs.wishlist_alerts).map((p) => p.id));
  const told = matches.filter((m) => wantsAlerts.has(m.userId));
  const price = `$${(row.price_cents / 100).toFixed(2).replace(/\.00$/, "")}`;
  await Promise.all(told.map((m) => notify({
    schoolId: row.school_id, userId: m.userId, type: "wishlist.match",
    title: "Something on your wishlist is for sale",
    body: `${row.textbook_title ?? row.title} · ${price} from ${from}`,
    deepLink: `/listings/${row.id}`,
    data: { wishlist_item_id: m.itemId, listing_id: row.id },
  })));
  return told.length;
}

/** SuggestedTrade objects for the viewer looking at `row` (empty for their own or unclaimed listings). */
export async function suggestedTradesFor(row: ListingRow, viewer: Viewer, schoolId: string): Promise<SuggestedTrade[]> {
  if (!row.seller_id || row.seller_id === viewer.id || row.status !== "active") return [];
  const [theirWishlist, myWishlist, mine] = await Promise.all([
    loadWishlist(row.seller_id, schoolId),
    loadWishlist(viewer.id, schoolId),
    adminClient().from("listings").select(LISTING_SELECT).eq("school_id", schoolId).eq("seller_id", viewer.id).eq("status", "active").limit(50),
  ]);
  if (!theirWishlist.length) return [];
  const myRows = z.array(ListingRow).parse(check(mine));
  const suggestions = suggestTrades({
    viewerId: viewer.id, theirListing: toCandidate(row), myListings: myRows.map(toCandidate),
    theirWishlist: theirWishlist.map(toWishItem), myWishlist: myWishlist.map(toWishItem),
  });
  if (!suggestions.length) return [];
  const rows = [row, ...myRows];
  const out = await listingsOut(rows, schoolId, viewer);
  const byId = new Map(rows.map((r, i) => [r.id, out[i]]));
  return suggestions.map((s) => SuggestedTrade.parse({
    their_listing: byId.get(row.id),
    my_listings: s.myListingIds.map((id) => byId.get(id)),
    cash_delta_cents: s.cashDeltaCents,
    score: s.score,
  }));
}
