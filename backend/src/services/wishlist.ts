// Wishlist matching and the trade suggester. Pure: callers load rows, this decides.

export type WishKind = "isbn" | "course_materials" | "keyword" | "category";

export interface WishItem {
  id: string;
  userId: string;
  kind: WishKind;
  isbn: string | null;
  courseId: string | null;
  keyword: string | null;
  category: string | null;
  maxPriceCents: number | null;
}

/** The parts of a listing matching looks at. */
export interface Candidate {
  id: string;
  sellerId: string | null;
  status: string;
  category: string;
  isbn: string | null;
  priceCents: number;
  courseIds: string[];
  /** Searchable text: title, description, textbook title, ISBN. */
  text: string;
}

export interface WishMatch {
  itemId: string;
  userId: string;
  listingId: string;
}

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * In-memory stand-in for the listings full-text search: every keyword word must start some word
 * of the listing (so "calc" finds "calculus"). Used where a per-item DB search would be one query per item.
 */
export function keywordMatches(keyword: string, text: string): boolean {
  const want = words(keyword);
  if (!want.length) return false;
  const have = words(text);
  return want.every((w) => have.some((h) => h.startsWith(w)));
}

/**
 * Whether an active listing satisfies a wishlist item. `keywordHit` overrides the in-memory keyword
 * check with the database's full-text answer when the caller has it.
 */
export function itemMatches(item: WishItem, c: Candidate, keywordHit?: boolean): boolean {
  if (c.status !== "active" || c.sellerId === item.userId) return false;
  if (item.maxPriceCents !== null && c.priceCents > item.maxPriceCents) return false;
  switch (item.kind) {
    case "isbn":
      return item.isbn !== null && c.isbn === item.isbn;
    case "course_materials":
      return item.courseId !== null && c.courseIds.includes(item.courseId);
    case "category":
      return item.category !== null && c.category === item.category;
    case "keyword":
      return keywordHit ?? (item.keyword !== null && keywordMatches(item.keyword, c.text));
  }
}

/** Every (item, listing) pair that matches, in candidate order. `keywordHits` maps item id → listing ids from full-text search. */
export function wishlistMatches(items: WishItem[], candidates: Candidate[], keywordHits?: Map<string, Set<string>>): WishMatch[] {
  return candidates.flatMap((c) => items.flatMap((item) => {
    const hits = item.kind === "keyword" ? keywordHits?.get(item.id) : undefined;
    return itemMatches(item, c, hits ? hits.has(c.id) : undefined) ? [{ itemId: item.id, userId: item.userId, listingId: c.id }] : [];
  }));
}

/** One alert per person per listing: their first matching item wins. */
export function matchesToAlert(items: WishItem[], listing: Candidate): WishMatch[] {
  const byUser = new Map<string, WishMatch>();
  for (const m of wishlistMatches(items, [listing])) if (!byUser.has(m.userId)) byUser.set(m.userId, m);
  return [...byUser.values()];
}

export interface TradeSuggestion {
  myListingIds: string[];
  cashDeltaCents: number;
  score: number;
}

const MAX_SUGGESTIONS = 5;

/**
 * Trades for `theirListing`: each of my active listings that its seller has wishlisted. Scores reward
 * a mutual match (their listing is on my wishlist too) and a price close to theirs. `cashDeltaCents`
 * is the cash I'd add on top of the trade (never negative).
 */
export function suggestTrades(input: {
  viewerId: string;
  theirListing: Candidate;
  myListings: Candidate[];
  theirWishlist: WishItem[];
  myWishlist: WishItem[];
}): TradeSuggestion[] {
  const their = input.theirListing;
  if (!their.sellerId || their.sellerId === input.viewerId || their.status !== "active") return [];
  const mutual = input.myWishlist.some((item) => itemMatches(item, their));
  const wanted = input.myListings.filter((mine) =>
    mine.sellerId === input.viewerId && input.theirWishlist.some((item) => item.userId === their.sellerId && itemMatches(item, mine)));
  return wanted
    .map((mine) => {
      const priceFit = 1 - Math.abs(their.priceCents - mine.priceCents) / Math.max(their.priceCents, mine.priceCents, 1);
      return {
        myListingIds: [mine.id],
        cashDeltaCents: Math.max(0, their.priceCents - mine.priceCents),
        score: Math.round(((mutual ? 0.5 : 0) + 0.5 * priceFit) * 100) / 100,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS);
}

// ---------------------------------------------------------------- semantic (JEV) matching

/** A keyword match JEV should also count: "mini fridge" ~ "Galanz compact refrigerator". */
export const SEMANTIC_MIN_SCORE = 3.5;
const MAX_SEMANTIC_ITEMS = 12;

/**
 * Keyword wishes the exact matcher missed but that are otherwise eligible (active, not the seller's
 * own, under their max price), for one person each. These are the ones worth asking JEV about.
 */
export function semanticCandidates(items: WishItem[], listing: Candidate, alreadyMatchedUsers: Set<string>): WishItem[] {
  const seen = new Set(alreadyMatchedUsers);
  const out: WishItem[] = [];
  for (const item of items) {
    if (out.length >= MAX_SEMANTIC_ITEMS) break;
    if (item.kind !== "keyword" || !item.keyword || seen.has(item.userId)) continue;
    if (listing.status !== "active" || listing.sellerId === item.userId) continue;
    if (item.maxPriceCents !== null && listing.priceCents > item.maxPriceCents) continue;
    seen.add(item.userId);
    out.push(item);
  }
  return out;
}

export const semanticState = (listing: Candidate) => `A listing on a campus marketplace: ${listing.text.slice(0, 1500)}`;

export const semanticQuestion = (item: WishItem, i: number) => ({
  key: `wish_${i}`,
  kind: "score" as const,
  question: `A student is looking for "${item.keyword}". How well does this listing satisfy that (0 = unrelated, 5 = exactly it)?`,
});
