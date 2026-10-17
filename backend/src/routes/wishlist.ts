import { Hono } from "hono";
import { z } from "zod";
import { loadListingRow, loadViewer, listingsOut } from "../db/market.js";
import {
  WISHLIST_SELECT, WishlistRow, findMatches, loadWishlist, matchCounts, suggestedTradesFor, toWishlistItem,
} from "../db/wishlist.js";
import { ApiError } from "../lib/errors.js";
import { one, page } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { CreateWishlistReq } from "../schemas/wishlist.js";
import { normalizeIsbn } from "../services/materials.js";

// Wishlist & matching (module 11). Matches are computed live against active listings in the school.

const MAX_ITEMS = 50;
const UNIQUE_VIOLATION = "23505";
const PageQuery = z.object({ cursor: z.string().regex(/^\d+$/).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

const parseId = (raw: string, what: string) => {
  const id = z.guid().safeParse(raw);
  if (!id.success) throw new ApiError(404, "NOT_FOUND", `${what} not found`);
  return id.data;
};

/** The one target column for the kind; everything else stays null (matches the table's checks). */
export function wishlistTarget(body: CreateWishlistReq) {
  const none = { isbn: null, course_id: null, keyword: null, category: null };
  switch (body.kind) {
    case "isbn": {
      const isbn = normalizeIsbn(body.isbn);
      if (!isbn) throw new ApiError(400, "VALIDATION", "Invalid request", { isbn: "Not a valid ISBN-10 or ISBN-13" });
      return { ...none, isbn };
    }
    case "course_materials":
      return { ...none, course_id: body.course_id };
    case "keyword":
      return { ...none, keyword: body.keyword };
    case "category":
      return { ...none, category: body.category };
  }
}

async function courseInSchool(courseId: string, schoolId: string) {
  const data = check(await adminClient().from("courses").select("id").eq("school_id", schoolId).eq("id", courseId).maybeSingle());
  return data !== null;
}

export const wishlistRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .use("/me/wishlist", requireUser(verify))
  .use("/me/wishlist/*", requireUser(verify))
  .use("/listings/:id/suggested-trades", requireUser(verify))

  .get("/me/wishlist", async (c) => {
    const { id, schoolId } = c.var.user;
    const items = await loadWishlist(id, schoolId);
    const counts = items.length ? matchCounts((await findMatches(items, schoolId)).matches) : new Map<string, number>();
    return c.json(page(items.map((r) => toWishlistItem(r, counts.get(r.id) ?? 0))));
  })

  .post("/me/wishlist", async (c) => {
    const body = await parseBody(c, CreateWishlistReq);
    const { id, schoolId } = c.var.user;
    const target = wishlistTarget(body);
    if (target.course_id && !(await courseInSchool(target.course_id, schoolId))) {
      throw new ApiError(400, "VALIDATION", "Invalid request", { course_id: "Unknown course" });
    }
    const db = adminClient();
    const { count, error } = await db.from("wishlist_items").select("id", { count: "exact", head: true }).eq("user_id", id);
    if (error) throw error;
    if ((count ?? 0) >= MAX_ITEMS) throw new ApiError(409, "INVALID_STATE", `You can have up to ${MAX_ITEMS} wishlist items`);
    const inserted = await db.from("wishlist_items").insert({
      school_id: schoolId, user_id: id, kind: body.kind, ...target, max_price_cents: body.max_price_cents ?? null, alert: body.alert,
    }).select(WISHLIST_SELECT).single();
    if (inserted.error?.code === UNIQUE_VIOLATION) throw new ApiError(409, "INVALID_STATE", "That's already on your wishlist");
    const row = WishlistRow.parse(check(inserted));
    const { matches } = await findMatches([row], schoolId);
    return c.json(one(toWishlistItem(row, matches.length)), 201);
  })

  .get("/me/wishlist/matches", async (c) => {
    const { cursor, limit } = parseQuery(c, PageQuery);
    const { id, schoolId } = c.var.user;
    const items = await loadWishlist(id, schoolId);
    if (!items.length) return c.json(page([]));
    const { matches, listings } = await findMatches(items, schoolId);
    const start = cursor ? Number(cursor) : 0;
    const slice = matches.slice(start, start + limit);
    const rows = slice.flatMap((m) => listings.get(m.listingId) ?? []);
    const out = await listingsOut(rows, schoolId, await loadViewer(id, schoolId));
    const next = start + limit < matches.length ? String(start + limit) : undefined;
    return c.json(page(slice.map((m, i) => ({ wishlist_item_id: m.itemId, listing: out[i] })), next));
  })

  .delete("/me/wishlist/:id", async (c) => {
    const { id, schoolId } = c.var.user;
    const itemId = parseId(c.req.param("id"), "Wishlist item");
    const deleted = check(await adminClient().from("wishlist_items").delete().eq("id", itemId).eq("user_id", id).eq("school_id", schoolId).select("id"));
    if (!z.array(z.object({ id: z.guid() })).parse(deleted).length) throw new ApiError(404, "NOT_FOUND", "Wishlist item not found");
    return c.body(null, 204);
  })

  .get("/listings/:id/suggested-trades", async (c) => {
    const { id, schoolId } = c.var.user;
    const row = await loadListingRow(parseId(c.req.param("id"), "Listing"), schoolId);
    if (row.seller_id !== id && !["active", "pending", "sold"].includes(row.status)) throw new ApiError(404, "NOT_FOUND", "Listing not found");
    return c.json(page(await suggestedTradesFor(row, await loadViewer(id, schoolId), schoolId)));
  });
