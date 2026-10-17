import { Hono } from "hono";
import { z } from "zod";
import { toCourse } from "../db/academics.js";
import {
  LISTING_SELECT, ListingRow, OfferRow, courseMatch, listingsOut, loadListingRow, loadViewer, offersOut, type Viewer,
} from "../db/market.js";
import { ApiError } from "../lib/errors.js";
import { one, page } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { CreateListingReq, ExploreQuery } from "../schemas/listings.js";
import { normalizeIsbn } from "../services/materials.js";
import { notifyMaterialMatch } from "../workers/ingest.js";

const FEED_WINDOW = 100;
const PageQuery = z.object({ cursor: z.string().regex(/^\d+$/).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

const parseId = (raw: string) => {
  const id = z.guid().safeParse(raw);
  if (!id.success) throw new ApiError(404, "NOT_FOUND", "Listing not found");
  return id.data;
};

/** Offset pagination: the cursor is the index of the next item. */
function slice<T>(items: T[], cursor: string | undefined, limit: number) {
  const start = cursor ? Number(cursor) : 0;
  const end = start + limit;
  return { items: items.slice(start, end), next: end < items.length ? String(end) : undefined };
}

/** Listings the viewer may see: public ones in their school, plus their own in any status. */
function visible(row: ListingRow, viewerId: string) {
  return row.seller_id === viewerId || row.status === "active" || row.status === "pending" || row.status === "sold";
}

async function listingIdsForCourse(courseId: string) {
  const data = check(await adminClient().from("listing_courses").select("listing_id").eq("course_id", courseId));
  return z.array(z.object({ listing_id: z.guid() })).parse(data).map((r) => r.listing_id);
}

async function budgetOf(userId: string) {
  const data = check(await adminClient().from("profiles").select("budget_cents").eq("id", userId).single());
  return z.object({ budget_cents: z.number().int().nullable() }).parse(data).budget_cents;
}

/** Media the seller uploaded to the public bucket; anything else in `media_ids` is a validation error. */
async function ownListingPhotos(userId: string, mediaIds: string[]) {
  if (!mediaIds.length) return;
  const data = check(
    await adminClient().from("media").select("id").eq("owner_id", userId).eq("bucket", "public-media").eq("uploaded", true).in("id", mediaIds),
  );
  const found = new Set(z.array(z.object({ id: z.guid() })).parse(data).map((m) => m.id));
  const bad = mediaIds.findIndex((id) => !found.has(id));
  if (bad >= 0) throw new ApiError(400, "VALIDATION", "Invalid request", { [`media_ids.${bad}`]: "Upload a listing photo and complete it first" });
}

async function coursesForIsbn(schoolId: string, isbn: string) {
  const data = check(await adminClient().from("course_materials").select("course_id").eq("school_id", schoolId).eq("isbn", isbn));
  return [...new Set(z.array(z.object({ course_id: z.guid() })).parse(data).map((r) => r.course_id))];
}

async function myOpenOffer(listingId: string, buyerId: string, schoolId: string) {
  const data = check(
    await adminClient().from("offers").select("*").eq("listing_id", listingId).eq("buyer_id", buyerId).eq("status", "pending")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  );
  if (!data) return null;
  const [offer] = await offersOut([OfferRow.parse(data)], schoolId);
  return offer ?? null;
}

function feedItems(rows: ListingRow[], listings: Awaited<ReturnType<typeof listingsOut>>, viewer: Viewer) {
  const items = rows.map((row, i) => {
    const match = courseMatch(row, viewer);
    return { type: "listing" as const, item: listings[i], reason: match ? ("your_class" as const) : ("new" as const), reason_course: match ? toCourse(match) : null };
  });
  // Stable: "your class" first, newest first inside each group (rows come newest first).
  return [...items.filter((i) => i.reason === "your_class"), ...items.filter((i) => i.reason !== "your_class")];
}

export const listingsRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .use("/feed", requireUser(verify))
  .use("/explore/*", requireUser(verify))
  .use("/listings/*", requireUser(verify))
  .use("/me/listings/*", requireUser(verify))

  .get("/feed", async (c) => {
    const { cursor, limit } = parseQuery(c, PageQuery);
    const { id, schoolId } = c.var.user;
    const [viewer, data] = await Promise.all([
      loadViewer(id, schoolId),
      adminClient().from("listings").select(LISTING_SELECT).eq("school_id", schoolId).eq("status", "active")
        .or(`seller_id.is.null,seller_id.neq.${id}`).order("created_at", { ascending: false }).limit(FEED_WINDOW),
    ]);
    const rows = z.array(ListingRow).parse(check(data));
    const all = feedItems(rows, await listingsOut(rows, schoolId, viewer), viewer);
    const { items, next } = slice(all, cursor, limit);
    return c.json(page(items, next));
  })

  .get("/explore/listings", async (c) => {
    const q = parseQuery(c, ExploreQuery.extend(PageQuery.shape));
    const { id, schoolId } = c.var.user;
    let query = adminClient().from("listings").select(LISTING_SELECT).eq("school_id", schoolId).eq("status", "active");
    if (q.q) query = query.textSearch("search", q.q, { type: "websearch", config: "english" });
    if (q.category) query = query.eq("category", q.category);
    if (q.isbn) query = query.eq("isbn", normalizeIsbn(q.isbn) ?? q.isbn);
    if (q.min_cents !== undefined) query = query.gte("price_cents", q.min_cents);
    if (q.max_cents !== undefined) query = query.lte("price_cents", q.max_cents);
    if (q.condition) query = query.eq("condition", q.condition);
    if (q.fulfillment) query = query.contains("fulfillment", [q.fulfillment]);
    if (q.source) query = query.eq("source_channel", q.source);
    if (q.course_id) query = query.in("id", await listingIdsForCourse(q.course_id));
    if (q.within_budget) {
      const budget = await budgetOf(id);
      if (budget !== null) query = query.lte("price_cents", budget);
    }
    const sort = q.sort ?? (q.q ? "relevance" : "newest");
    if (sort === "price_asc") query = query.order("price_cents", { ascending: true });
    else if (sort === "price_desc") query = query.order("price_cents", { ascending: false });
    else query = query.order("created_at", { ascending: false }); // relevance: Postgres returns text-search matches; newest breaks ties
    const rows = z.array(ListingRow).parse(check(await query.limit(FEED_WINDOW)));
    const { items, next } = slice(rows, q.cursor, q.limit);
    return c.json(page(await listingsOut(items, schoolId, await loadViewer(id, schoolId)), next));
  })

  .get("/me/listings", async (c) => {
    const { status } = parseQuery(c, z.object({ status: ListingRow.shape.status.optional() }));
    const { id, schoolId } = c.var.user;
    let query = adminClient().from("listings").select(LISTING_SELECT).eq("school_id", schoolId).eq("seller_id", id);
    query = status ? query.eq("status", status) : query.neq("status", "removed");
    const rows = z.array(ListingRow).parse(check(await query.order("created_at", { ascending: false })));
    return c.json(page(await listingsOut(rows, schoolId, { id, courses: new Map() })));
  })

  .post("/listings", async (c) => {
    const body = await parseBody(c, CreateListingReq);
    const { id, schoolId } = c.var.user;
    const isbn = body.isbn ? normalizeIsbn(body.isbn) : null;
    if (body.isbn && !isbn) throw new ApiError(400, "VALIDATION", "Invalid request", { isbn: "Not a valid ISBN-10 or ISBN-13" });
    if (body.category === "textbook" && body.publish && !isbn) throw new ApiError(400, "VALIDATION", "Invalid request", { isbn: "Textbooks need an ISBN to publish" });
    if (body.floor_price_cents !== undefined && body.floor_price_cents > body.price_cents) {
      throw new ApiError(400, "VALIDATION", "Invalid request", { floor_price_cents: "Can't be above the price" });
    }
    if (!body.fulfillment.length) throw new ApiError(400, "VALIDATION", "Invalid request", { fulfillment: "Pick at least one" });
    if (body.category === "ticket") throw new ApiError(400, "VALIDATION", "Invalid request", { category: "Tickets aren't supported yet" });
    await ownListingPhotos(id, body.media_ids);
    const courseIds = body.course_ids.length ? [...new Set(body.course_ids)] : isbn ? await coursesForIsbn(schoolId, isbn) : [];

    const db = adminClient();
    const inserted = check(
      await db.from("listings").insert({
        school_id: schoolId, seller_id: id, category: body.category, title: body.title, description: body.description,
        price_cents: body.price_cents, negotiable: body.negotiable, floor_price_cents: body.floor_price_cents ?? null,
        condition: body.condition, isbn, textbook_title: isbn ? body.title : null, fulfillment: [...new Set(body.fulfillment)],
        status: body.publish ? "active" : "draft", source_channel: "native",
      }).select("id").single(),
    ) as { id: string };
    const children = await Promise.all([
      courseIds.length ? db.from("listing_courses").insert(courseIds.map((course_id) => ({ listing_id: inserted.id, course_id }))) : null,
      body.media_ids.length ? db.from("listing_media").insert(body.media_ids.map((media_id, position) => ({ listing_id: inserted.id, media_id, position }))) : null,
    ]);
    for (const r of children) {
      // A bad course id is the client's mistake (FK violation), not ours.
      if (r?.error?.code === "23503") throw new ApiError(400, "VALIDATION", "Invalid request", { course_ids: "Unknown course" });
      if (r?.error) throw r.error;
    }

    const row = await loadListingRow(inserted.id, schoolId);
    if (row.status === "active" && courseIds.length) {
      const me = check(await db.from("profiles").select("display_name").eq("id", id).single()) as { display_name: string };
      await notifyMaterialMatch({ schoolId, listingId: row.id, courseIds, title: row.title, priceCents: row.price_cents, sellerId: id, from: me.display_name });
    }
    const [listing] = await listingsOut([row], schoolId, { id, courses: new Map() });
    return c.json(one(listing), 201);
  })

  .get("/listings/:id", async (c) => {
    const { id: userId, schoolId } = c.var.user;
    const row = await loadListingRow(parseId(c.req.param("id")), schoolId);
    if (!visible(row, userId)) throw new ApiError(404, "NOT_FOUND", "Listing not found");
    const [viewer, myOffer] = await Promise.all([loadViewer(userId, schoolId), myOpenOffer(row.id, userId, schoolId)]);
    const [listing] = await listingsOut([row], schoolId, viewer);
    return c.json(one({ listing, is_mine: row.seller_id === userId, my_open_offer: myOffer, suggested_trades: [] }));
  })

  .delete("/listings/:id", async (c) => {
    const { id: userId, schoolId } = c.var.user;
    const row = await loadListingRow(parseId(c.req.param("id")), schoolId);
    if (row.seller_id !== userId) throw new ApiError(404, "NOT_FOUND", "Listing not found");
    if (row.status === "pending" || row.status === "sold") throw new ApiError(409, "INVALID_STATE", "This listing has an order; cancel the order first");
    const updated = await adminClient().from("listings").update({ status: "removed" }).eq("id", row.id);
    if (updated.error) throw updated.error;
    // Nobody can buy it any more, so open offers end too.
    const ended = await adminClient().from("offers").update({ status: "declined", waiting_on: null }).eq("listing_id", row.id).eq("status", "pending");
    if (ended.error) throw ended.error;
    return c.body(null, 204);
  });
