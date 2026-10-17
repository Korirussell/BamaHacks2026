import { Hono } from "hono";
import { z } from "zod";
import { CourseRow, toCourse } from "../db/academics.js";
import { friendIdsOf, mutualFriendIds, pairsTouching } from "../db/social.js";
import { loadUsersPublic, type UserPublicOut } from "../db/users.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { one, page } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { CreateFriendRequestReq, FriendRequestCreated, IncomingFriendRequest, SuggestedFriend } from "../schemas/social.js";
import { friendPair, friendsOf, rankSuggestions, requestOutcome } from "../services/social.js";

// Social graph (module 14): friend requests, friends, mutuals and suggestions. Everything is scoped to the viewer's school.

const SUGGESTION_LIMIT = 20;
const REQUEST_SELECT = "id, from_id, to_id, status, created_at";
const RequestRow = z.object({ id: z.guid(), from_id: z.guid(), to_id: z.guid(), status: z.enum(["pending", "accepted", "declined"]), created_at: z.string() });
type RequestRow = z.infer<typeof RequestRow>;

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

const parseId = (raw: string, what: string) => {
  const id = z.guid().safeParse(raw);
  if (!id.success) throw new ApiError(404, "NOT_FOUND", `${what} not found`);
  return id.data.toLowerCase();
};

const byName = (users: UserPublicOut[]) => users.sort((a, b) => a.display_name.localeCompare(b.display_name));

/** A pending request sent to me; 404 if it isn't mine to answer, 409 if it was already answered. */
async function incomingRequest(id: string, me: string, schoolId: string): Promise<RequestRow> {
  const data = check(await adminClient().from("friend_requests").select(REQUEST_SELECT).eq("id", id).eq("school_id", schoolId).eq("to_id", me).maybeSingle());
  if (!data) throw new ApiError(404, "NOT_FOUND", "Friend request not found");
  const row = RequestRow.parse(data);
  if (row.status !== "pending") throw new ApiError(409, "INVALID_STATE", `Friend request was already ${row.status}`);
  return row;
}

/** Marks a pending request answered; 409 if someone else answered it first. */
async function answer(id: string, status: "accepted" | "declined"): Promise<RequestRow> {
  const data = check(await adminClient().from("friend_requests").update({ status, responded_at: new Date().toISOString() })
    .eq("id", id).eq("status", "pending").select(REQUEST_SELECT).maybeSingle());
  if (!data) throw new ApiError(409, "INVALID_STATE", "Friend request was already answered");
  return RequestRow.parse(data);
}

async function suggestions(me: string, schoolId: string) {
  const db = adminClient();
  const [mineData, friendPairsOfMe, pendingData] = await Promise.all([
    db.from("class_records").select("course_id, course:courses(id, school_id, code, title, department)")
      .eq("school_id", schoolId).eq("user_id", me).in("status", ["current", "past"]),
    pairsTouching([me], schoolId),
    db.from("friend_requests").select("from_id, to_id").eq("school_id", schoolId).eq("status", "pending").or(`from_id.eq.${me},to_id.eq.${me}`),
  ]);
  const myCourses = new Map(z.array(z.object({ course: CourseRow })).parse(check(mineData)).map((r) => [r.course.id, r.course]));
  const friendIds = friendsOf(me, friendPairsOfMe);
  const pendingIds = z.array(z.object({ from_id: z.guid(), to_id: z.guid() })).parse(check(pendingData))
    .map((r) => (r.from_id === me ? r.to_id : r.from_id));

  const [classmatesData, friendPairs] = await Promise.all([
    myCourses.size
      ? db.from("class_records").select("user_id, course_id").eq("school_id", schoolId).in("course_id", [...myCourses.keys()])
        .in("status", ["current", "past"]).neq("user_id", me).limit(5000)
      : Promise.resolve({ data: [], error: null }),
    pairsTouching(friendIds, schoolId),
  ]);
  const sharedCourses = new Map<string, string[]>();
  for (const r of z.array(z.object({ user_id: z.guid(), course_id: z.guid() })).parse(check(classmatesData))) {
    sharedCourses.set(r.user_id, [...(sharedCourses.get(r.user_id) ?? []), r.course_id]);
  }

  const ranked = rankSuggestions({ me, friendIds, pendingIds, sharedCourses, friendPairs }, SUGGESTION_LIMIT);
  const users = await loadUsersPublic(ranked.map((s) => s.userId), schoolId, me);
  return ranked.flatMap((s) => {
    const user = users.get(s.userId);
    if (!user) return [];
    const courses = s.courseIds.flatMap((id) => myCourses.get(id) ?? []).sort((a, b) => a.code.localeCompare(b.code));
    return [SuggestedFriend.parse({ user, shared_courses: courses.map(toCourse) })];
  });
}

export const socialRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .use("/friend-requests/*", requireUser(verify))
  .use("/friends/*", requireUser(verify))
  .use("/me/friends/*", requireUser(verify))
  .use("/me/friend-requests/*", requireUser(verify))
  .use("/me/suggested-friends/*", requireUser(verify))
  .use("/users/:id/mutuals", requireUser(verify))

  .post("/friend-requests", async (c) => {
    const input = await parseBody(c, CreateFriendRequestReq);
    const { id: me, schoolId } = c.var.user;
    const to = input.user_id.toLowerCase();
    if (to === me) throw new ApiError(400, "VALIDATION", "Invalid request", { user_id: "You can't friend yourself" });
    const db = adminClient();
    const [profilesData, friendshipData, openData] = await Promise.all([
      db.from("profiles").select("id, display_name").eq("school_id", schoolId).in("id", [me, to]),
      db.from("friendships").select("user_a").eq("school_id", schoolId).match(friendPair(me, to)).maybeSingle(),
      db.from("friend_requests").select("id, from_id").eq("school_id", schoolId).eq("status", "pending")
        .or(`and(from_id.eq.${me},to_id.eq.${to}),and(from_id.eq.${to},to_id.eq.${me})`),
    ]);
    const profiles = z.array(z.object({ id: z.guid(), display_name: z.string() })).parse(check(profilesData));
    if (!profiles.some((p) => p.id === to)) throw new ApiError(404, "NOT_FOUND", "User not found");
    const open = z.array(z.object({ id: z.guid(), from_id: z.guid() })).parse(check(openData));
    const outcome = requestOutcome(me, Boolean(check(friendshipData)), open);
    if (outcome.kind === "friends") throw new ApiError(409, "INVALID_STATE", "You're already friends");
    if (outcome.kind === "incoming") throw new ApiError(409, "INVALID_STATE", "They already sent you a friend request; accept it instead");
    if (outcome.kind === "existing") return c.json(one(FriendRequestCreated.parse({ id: outcome.id, status: "pending" })));

    const inserted = await db.from("friend_requests").insert({ school_id: schoolId, from_id: me, to_id: to }).select("id").single();
    // The open-pair unique index catches a double-submit (either direction) that slips past the checks above.
    if (inserted.error?.code === "23505") throw new ApiError(409, "INVALID_STATE", "A friend request between you is already pending");
    const { id } = z.object({ id: z.guid() }).parse(check(inserted));
    const fromName = profiles.find((p) => p.id === me)?.display_name || "Someone";
    await notify({
      schoolId, userId: to, type: "friend_request.created", title: "New friend request",
      body: `${fromName} sent you a friend request`, deepLink: "/me/friend-requests", data: { friend_request_id: id, from_user_id: me },
    });
    return c.json(one(FriendRequestCreated.parse({ id, status: "pending" })), 201);
  })

  .post("/friend-requests/:id/accept", async (c) => {
    const { id: me, schoolId } = c.var.user;
    const request = await incomingRequest(parseId(c.req.param("id"), "Friend request"), me, schoolId);
    await answer(request.id, "accepted");
    check(await adminClient().from("friendships")
      .upsert({ school_id: schoolId, ...friendPair(request.from_id, me) }, { onConflict: "user_a,user_b", ignoreDuplicates: true }));
    const users = await loadUsersPublic([request.from_id, me], schoolId, me);
    const sender = users.get(request.from_id);
    if (!sender) throw new ApiError(404, "NOT_FOUND", "User not found");
    await notify({
      schoolId, userId: request.from_id, type: "friend_request.accepted", title: "Friend request accepted",
      body: `${users.get(me)?.display_name || "Someone"} accepted your friend request`, deepLink: `/users/${me}`,
      data: { friend_request_id: request.id, user_id: me },
    });
    return c.json(one(sender));
  })

  .post("/friend-requests/:id/decline", async (c) => {
    const { id: me, schoolId } = c.var.user;
    const request = await incomingRequest(parseId(c.req.param("id"), "Friend request"), me, schoolId);
    await answer(request.id, "declined");
    return c.body(null, 204);
  })

  .delete("/friends/:id", async (c) => {
    const { id: me, schoolId } = c.var.user;
    const other = parseId(c.req.param("id"), "Friend");
    const deleted = check(await adminClient().from("friendships").delete().eq("school_id", schoolId).match(friendPair(me, other)).select("user_a"));
    if (!z.array(z.object({ user_a: z.guid() })).parse(deleted).length) throw new ApiError(404, "NOT_FOUND", "Friend not found");
    return c.body(null, 204);
  })

  .get("/me/friends", async (c) => {
    const { id: me, schoolId } = c.var.user;
    const users = await loadUsersPublic(await friendIdsOf(me, schoolId), schoolId, me);
    return c.json(page(byName([...users.values()])));
  })

  .get("/me/friend-requests", async (c) => {
    const { id: me, schoolId } = c.var.user;
    const data = check(await adminClient().from("friend_requests").select(REQUEST_SELECT).eq("school_id", schoolId).eq("to_id", me)
      .eq("status", "pending").order("created_at", { ascending: false }).limit(100));
    const rows = z.array(RequestRow).parse(data);
    const senders = await loadUsersPublic(rows.map((r) => r.from_id), schoolId, me);
    return c.json(page(rows.flatMap((r) => {
      const from = senders.get(r.from_id);
      return from ? [IncomingFriendRequest.parse({ id: r.id, from, created_at: new Date(r.created_at).toISOString() })] : [];
    })));
  })

  .get("/me/suggested-friends", async (c) => {
    const { id: me, schoolId } = c.var.user;
    return c.json(page(await suggestions(me, schoolId)));
  })

  .get("/users/:id/mutuals", async (c) => {
    const { id: me, schoolId } = c.var.user;
    const userId = parseId(c.req.param("id"), "User");
    if (!(await loadUsersPublic([userId], schoolId)).has(userId)) throw new ApiError(404, "NOT_FOUND", "User not found");
    const users = await loadUsersPublic(await mutualFriendIds(me, userId, schoolId), schoolId, me);
    return c.json(page(byName([...users.values()])));
  });
