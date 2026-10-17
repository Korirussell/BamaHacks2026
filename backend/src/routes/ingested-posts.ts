import { Hono } from "hono";
import { z } from "zod";
import { LISTING_SELECT, ListingRow, listingsOut, loadViewer } from "../db/market.js";
import { ApiError } from "../lib/errors.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";

// GET /ingested-posts/{id} (module 16): the external post behind a listing. ride_request stays null
// until rides (module 15) classify posts into ride requests.

const PostRow = z.object({
  id: z.guid(), channel: z.string(), caption: z.string(), author_handle: z.string(), posted_at: z.string(),
});

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

export const ingestedPostsRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .use("/ingested-posts/*", requireUser(verify))

  .get("/ingested-posts/:id", async (c) => {
    const { id: userId, schoolId } = c.var.user;
    const id = z.guid().safeParse(c.req.param("id"));
    if (!id.success) throw new ApiError(404, "NOT_FOUND", "Post not found");
    const db = adminClient();
    const data = check(await db.from("ingested_posts").select("id, channel, caption, author_handle, posted_at").eq("id", id.data).eq("school_id", schoolId).maybeSingle());
    if (!data) throw new ApiError(404, "NOT_FOUND", "Post not found");
    const post = PostRow.parse(data);

    const listingData = check(await db.from("listings").select(LISTING_SELECT).eq("school_id", schoolId).eq("ingested_post_id", post.id)
      .in("status", ["active", "pending", "sold"]).order("created_at", { ascending: false }).limit(1));
    const rows = z.array(ListingRow).parse(listingData);
    const [listing] = rows.length ? await listingsOut(rows, schoolId, await loadViewer(userId, schoolId)) : [];
    return c.json(one({
      id: post.id, channel: post.channel, raw_text: post.caption, author_handle: post.author_handle || null,
      posted_at: new Date(post.posted_at).toISOString(), listing: listing ?? null, ride_request: null,
    }));
  });
