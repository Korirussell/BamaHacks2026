import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import { toUserPublic } from "../db/mappers.js";
import { ProfileRow, SchoolRow } from "../db/rows.js";
import type { TokenVerifier } from "../middleware/auth.js";
import { UserPublic } from "../schemas/me.js";
import { friendPair, friendStats, friendsOf, mutualIds, rankSuggestions, requestOutcome } from "../services/social.js";

process.env["SUPABASE_URL"] ??= "https://example.supabase.co";

const ME = "00000000-0000-4000-a000-000000000005";
const u = (n: number) => `00000000-0000-4000-b000-${String(n).padStart(12, "0")}`;
const signedIn: TokenVerifier = async () => ({ sub: ME, email: "s@crimson.ua.edu", schoolId: "00000000-0000-4000-a000-000000000001" });
const auth = { headers: { Authorization: "Bearer test", "Content-Type": "application/json" } };
const app = createApp({ verify: signedIn, log: false });

test("friendPair orders and lower-cases ids so both directions share one row", () => {
  const a = u(1);
  const b = u(2).toUpperCase();
  assert.deepEqual(friendPair(a, b), { user_a: a, user_b: u(2) });
  assert.deepEqual(friendPair(b, a), friendPair(a, b));
});

test("friend stats: is_friend, mutual counts, and nothing for the viewer themself", () => {
  // me–1, me–2, 3–1, 3–2, 3–4
  const pairs = [friendPair(ME, u(1)), friendPair(ME, u(2)), friendPair(u(3), u(1)), friendPair(u(3), u(2)), friendPair(u(3), u(4))];
  const stats = friendStats(ME, [u(1), u(3), u(4), ME, u(9)], pairs);
  assert.deepEqual(stats.get(u(1)), { is_friend: true, mutual_friend_count: 0 });
  assert.deepEqual(stats.get(u(3)), { is_friend: false, mutual_friend_count: 2 });
  assert.deepEqual(stats.get(u(4)), { is_friend: false, mutual_friend_count: 0 });
  assert.deepEqual(stats.get(ME), { is_friend: false, mutual_friend_count: 0 });
  assert.deepEqual(stats.get(u(9)), { is_friend: false, mutual_friend_count: 0 });
  assert.deepEqual(mutualIds(ME, u(3), pairs).sort(), [u(1), u(2)]);
  assert.deepEqual(mutualIds(ME, ME, pairs), []);
  assert.deepEqual(friendsOf(ME, pairs).sort(), [u(1), u(2)]);
});

test("suggestions rank shared classes first, then mutuals, and skip friends, pending and me", () => {
  const ranked = rankSuggestions({
    me: ME,
    friendIds: [u(1)],
    pendingIds: [u(6)],
    sharedCourses: new Map([
      [u(2), ["c1"]],
      [u(3), ["c1", "c2", "c2"]], // duplicate rows (two terms) count once
      [u(1), ["c1", "c2", "c3"]], // already a friend
      [u(6), ["c1", "c2", "c3"]], // open request
      [u(5), ["c1"]],
    ]),
    // friend 1 knows 4 and 5 and me; 4 has no shared class
    friendPairs: [friendPair(u(1), u(4)), friendPair(u(1), u(5)), friendPair(u(1), ME)],
  });
  assert.deepEqual(ranked.map((s) => s.userId), [u(3), u(5), u(2), u(4)]);
  assert.deepEqual(ranked[0], { userId: u(3), courseIds: ["c1", "c2"], mutuals: 0 });
  assert.deepEqual(ranked[1], { userId: u(5), courseIds: ["c1"], mutuals: 1 });
  assert.deepEqual(ranked[3], { userId: u(4), courseIds: [], mutuals: 1 });
  assert.equal(rankSuggestions({ me: ME, friendIds: [], pendingIds: [], sharedCourses: new Map([[u(2), ["c"]], [u(3), ["c"]]]), friendPairs: [] }, 1).length, 1);
});

test("requestOutcome: friends, my open request (idempotent), their open request, or create", () => {
  assert.deepEqual(requestOutcome(ME, true, []), { kind: "friends" });
  assert.deepEqual(requestOutcome(ME, false, [{ id: u(7), from_id: ME }]), { kind: "existing", id: u(7) });
  assert.deepEqual(requestOutcome(ME, false, [{ id: u(8), from_id: u(2) }]), { kind: "incoming", id: u(8) });
  assert.deepEqual(requestOutcome(ME, false, []), { kind: "create" });
});

test("toUserPublic defaults friend fields without a viewer and uses them with one", () => {
  const school = SchoolRow.parse({ id: u(100), name: "UA", domain: "ua.edu", center_lat: 33.2, center_lng: -87.5, timezone: "America/Chicago", campus_mail_supported: true, tutor_min_grade: "A-" });
  const profile = ProfileRow.parse({
    id: u(1), school_id: u(100), email: "a@crimson.ua.edu", display_name: "Ann", major: null, grad_year: null, phone: null, budget_cents: null,
    mail_stop_code: null, tutor_opt_in: false, location_sharing: "off", notification_prefs: { push: true, email: true, wishlist_alerts: true, tutor_requests: true },
    stripe_status: "none", payouts_enabled: false, google_connected: false, completed_count: 0, no_show_count: 0,
  });
  const plain = UserPublic.parse(toUserPublic(profile, school, null));
  assert.equal(plain.is_friend, false);
  assert.equal(plain.mutual_friend_count, 0);
  const viewed = UserPublic.parse(toUserPublic(profile, school, null, { is_friend: true, mutual_friend_count: 3 }));
  assert.equal(viewed.is_friend, true);
  assert.equal(viewed.mutual_friend_count, 3);
});

test("social routes need a sign-in", async () => {
  const anon = createApp({ verify: async () => null, log: false });
  for (const [method, path] of [
    ["GET", "/me/friends"], ["GET", "/me/friend-requests"], ["GET", "/me/suggested-friends"], ["GET", `/users/${u(1)}/mutuals`],
    ["POST", "/friend-requests"], ["POST", `/friend-requests/${u(1)}/accept`], ["POST", `/friend-requests/${u(1)}/decline`], ["DELETE", `/friends/${u(1)}`],
  ] as const) {
    assert.equal((await anon.request(`/api/v1${path}`, { method })).status, 401, `${method} ${path}`);
  }
});

test("social routes validate the body and ids before touching the database", async () => {
  const post = (path: string, body?: unknown) => app.request(`/api/v1${path}`, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...auth });
  const bad = await post("/friend-requests", { user_id: "nope" });
  assert.equal(bad.status, 400);
  const body = (await bad.json()) as { error: { code: string; field_errors?: Record<string, string> } };
  assert.equal(body.error.code, "VALIDATION");
  assert.ok(body.error.field_errors?.user_id);
  assert.equal((await post("/friend-requests", {})).status, 400);
  const self = await post("/friend-requests", { user_id: ME.toUpperCase() });
  assert.equal(self.status, 400, "can't friend yourself");
  assert.equal((await post("/friend-requests/not-a-uuid/accept")).status, 404);
  assert.equal((await post("/friend-requests/not-a-uuid/decline")).status, 404);
  assert.equal((await app.request("/api/v1/friends/not-a-uuid", { method: "DELETE", ...auth })).status, 404);
  assert.equal((await app.request("/api/v1/users/not-a-uuid/mutuals", auth)).status, 404);
});
