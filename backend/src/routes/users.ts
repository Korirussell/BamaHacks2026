import { Hono } from "hono";
import { z } from "zod";
import { LISTING_SELECT, ListingRow, listingsOut, loadViewer } from "../db/market.js";
import { mutualFriendIds } from "../db/social.js";
import { loadUsersPublic } from "../db/users.js";
import { ApiError } from "../lib/errors.js";
import { one, page } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseQuery } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { REVIEW_SELECT, ReviewRow, toReview } from "./reviews.js";
import { tutorProfileFor } from "./tutoring.js";

// Other students' public profiles (module 2). Everything is scoped to the viewer's school.

const SEARCH_LIMIT = 20;
const SearchQuery = z.object({ q: z.string().trim().min(1).max(100), course_id: z.guid().optional() });

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

const parseId = (raw: string) => {
  const id = z.guid().safeParse(raw);
  if (!id.success) throw new ApiError(404, "NOT_FOUND", "User not found");
  return id.data;
};

/** `q` as a literal ILIKE substring: % and _ in a name are characters, not wildcards. */
export const ilikeContains = (q: string) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

/** { avg_stars, count } from the user's received reviews; avg is rounded to one decimal, 0 with none. */
export function reviewSummary(stars: number[]) {
  if (!stars.length) return { avg_stars: 0, count: 0 };
  return { avg_stars: Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 10) / 10, count: stars.length };
}

async function userIdsInCourse(schoolId: string, courseId: string) {
  const data = check(await adminClient().from("class_records").select("user_id").eq("school_id", schoolId).eq("course_id", courseId));
  return [...new Set(z.array(z.object({ user_id: z.guid() })).parse(data).map((r) => r.user_id))];
}

async function receivedReviews(userId: string, schoolId: string) {
  const data = check(await adminClient().from("reviews").select(REVIEW_SELECT).eq("school_id", schoolId).eq("to_id", userId).order("created_at", { ascending: false }).limit(100));
  return z.array(ReviewRow).parse(data);
}

export const usersRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .use("/users/*", requireUser(verify))

  .get("/users/search", async (c) => {
    const { q, course_id } = parseQuery(c, SearchQuery);
    const { id: me, schoolId } = c.var.user;
    let query = adminClient().from("profiles").select("id").eq("school_id", schoolId).neq("id", me).ilike("display_name", ilikeContains(q));
    if (course_id) {
      const ids = await userIdsInCourse(schoolId, course_id);
      if (!ids.length) return c.json(page([]));
      query = query.in("id", ids);
    }
    const ids = z.array(z.object({ id: z.guid() })).parse(check(await query.order("display_name").limit(SEARCH_LIMIT))).map((r) => r.id);
    const users = await loadUsersPublic(ids, schoolId, me);
    return c.json(page(ids.flatMap((id) => users.get(id) ?? [])));
  })

  .get("/users/:id", async (c) => {
    const { id: me, schoolId } = c.var.user;
    const userId = parseId(c.req.param("id"));
    const user = (await loadUsersPublic([userId], schoolId, me)).get(userId);
    if (!user) throw new ApiError(404, "NOT_FOUND", "User not found");
    const [listingData, reviews, tutor, viewer, mutualIds] = await Promise.all([
      adminClient().from("listings").select(LISTING_SELECT).eq("school_id", schoolId).eq("seller_id", userId).eq("status", "active")
        .order("created_at", { ascending: false }).limit(50),
      receivedReviews(userId, schoolId),
      tutorProfileFor(userId, schoolId),
      loadViewer(me, schoolId),
      mutualFriendIds(me, userId, schoolId),
    ]);
    const mutuals = await loadUsersPublic(mutualIds, schoolId, me);
    const rows = z.array(ListingRow).parse(check(listingData));
    return c.json(one({
      user,
      mutual_friends: [...mutuals.values()].sort((a, b) => a.display_name.localeCompare(b.display_name)),
      active_listings: await listingsOut(rows, schoolId, viewer),
      tutor_profile: tutor?.enabled ? tutor : null,
      review_summary: reviewSummary(reviews.map((r) => r.stars)),
    }));
  })

  .get("/users/:id/reviews", async (c) => {
    const { schoolId } = c.var.user;
    const userId = parseId(c.req.param("id"));
    if (!(await loadUsersPublic([userId], schoolId)).has(userId)) throw new ApiError(404, "NOT_FOUND", "User not found");
    const rows = await receivedReviews(userId, schoolId);
    const authors = await loadUsersPublic(rows.map((r) => r.from_id), schoolId);
    return c.json(page(rows.flatMap((r) => {
      const from = authors.get(r.from_id);
      return from ? [toReview(r, from)] : [];
    })));
  });
