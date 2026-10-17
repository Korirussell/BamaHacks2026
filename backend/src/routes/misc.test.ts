import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import type { TokenVerifier } from "../middleware/auth.js";
import { PushSubscriptionReq, subscriptionKey } from "./push.js";
import { GroupMeMessage, groupmeSkipReason } from "./webhooks.js";

process.env["SUPABASE_URL"] ??= "https://example.supabase.co";

const signedIn: TokenVerifier = async () => ({ sub: "00000000-0000-4000-a000-000000000005", email: "s@crimson.ua.edu", schoolId: "00000000-0000-4000-a000-000000000001" });
const auth = { headers: { Authorization: "Bearer test", "Content-Type": "application/json" } };
const app = createApp({ verify: signedIn, log: false });
const anon = createApp({ verify: async () => null, log: false });
const ID = "00000000-0000-4000-b000-000000000001";
const post = (a: typeof app, path: string, body: unknown, init: RequestInit = auth) =>
  a.request(`/api/v1${path}`, { method: "POST", body: JSON.stringify(body), ...init });

test("misc user routes need a sign-in", async () => {
  assert.equal((await post(anon, "/reports", {})).status, 401);
  assert.equal((await post(anon, "/me/push-subscriptions", {})).status, 401);
  assert.equal((await post(anon, `/listings/${ID}/auto-bargain`, {})).status, 401);
  assert.equal((await anon.request(`/api/v1/auto-bargain/${ID}`)).status, 401);
  assert.equal((await post(anon, "/tutoring/requests", {})).status, 401);
  assert.equal((await anon.request(`/api/v1/ingested-posts/${ID}`)).status, 401);
});

test("POST /reports validates the target, reason and details", async () => {
  assert.equal((await post(app, "/reports", { target: { type: "message", id: ID }, reason: "spam", details: "" })).status, 400);
  assert.equal((await post(app, "/reports", { target: { type: "user", id: ID }, reason: "rude", details: "" })).status, 400);
  assert.equal((await post(app, "/reports", { target: { type: "user", id: "nope" }, reason: "spam", details: "" })).status, 400);
  assert.equal((await post(app, "/reports", { target: { type: "user", id: ID }, reason: "spam", details: "x".repeat(2001) })).status, 400);
  const self = await post(app, "/reports", { target: { type: "user", id: "00000000-0000-4000-a000-000000000005" }, reason: "spam", details: "" });
  assert.equal(self.status, 400);
});

test("push subscriptions: web needs endpoint + keys, devices need a token", async () => {
  assert.equal((await post(app, "/me/push-subscriptions", { platform: "web", subscription: { endpoint: "https://push.example/abc" } })).status, 400);
  assert.equal((await post(app, "/me/push-subscriptions", { platform: "web", subscription: { endpoint: "http://insecure", keys: { p256dh: "a", auth: "b" } } })).status, 400);
  assert.equal((await post(app, "/me/push-subscriptions", { platform: "ios", subscription: {} })).status, 400);
  assert.equal((await post(app, "/me/push-subscriptions", { platform: "fax", subscription: { token: "abcdefgh" } })).status, 400);
  const web = PushSubscriptionReq.parse({ platform: "web", subscription: { endpoint: "https://push.example/abc", keys: { p256dh: "a", auth: "b" } } });
  assert.equal(subscriptionKey(web), "https://push.example/abc");
  assert.equal(subscriptionKey(PushSubscriptionReq.parse({ platform: "ios", subscription: { token: "deadbeef00" } })), "ios:deadbeef00");
});

test("auto-bargain validates the max, style and ids", async () => {
  assert.equal((await post(app, `/listings/${ID}/auto-bargain`, { max_price_cents: 0, style: "quick" })).status, 400);
  assert.equal((await post(app, `/listings/${ID}/auto-bargain`, { max_price_cents: 1000, style: "greedy" })).status, 400);
  assert.equal((await post(app, "/listings/not-a-uuid/auto-bargain", { max_price_cents: 1000, style: "quick" })).status, 404);
  assert.equal((await app.request("/api/v1/auto-bargain/not-a-uuid", auth)).status, 404);
});

test("tutoring requests validate the course, windows and rate", async () => {
  const future = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const ok = { course_id: ID, windows: [{ start: future(24), end: future(26), kind: "free" }], max_rate_cents: 2500 };
  assert.equal((await post(app, "/tutoring/requests", { ...ok, course_id: "nope" })).status, 400);
  assert.equal((await post(app, "/tutoring/requests", { ...ok, windows: [] })).status, 400);
  assert.equal((await post(app, "/tutoring/requests", { ...ok, windows: [{ start: future(26), end: future(24), kind: "free" }] })).status, 400);
  assert.equal((await post(app, "/tutoring/requests", { ...ok, max_rate_cents: -1 })).status, 400);
  assert.equal((await post(app, "/tutoring/requests", { ...ok, windows: [{ start: future(-26), end: future(-24), kind: "free" }] })).status, 400);
});

test("GET /ingested-posts/{id} needs a real id", async () => {
  assert.equal((await app.request("/api/v1/ingested-posts/not-a-uuid", auth)).status, 404);
});

const message = { id: "1", group_id: "42", name: "Ann", sender_type: "user", text: "Selling CH 101 book $40", created_at: 1_760_000_000, attachments: [] };
const json = { headers: { "Content-Type": "application/json" } };

test("GroupMe webhook rejects missing or wrong secrets, and everything when unset", async () => {
  const hooked = createApp({ verify: signedIn, log: false, groupme: { secret: "s3cret-token", schoolId: ID } });
  assert.equal((await post(hooked, "/webhooks/groupme", message, json)).status, 401);
  assert.equal((await post(hooked, "/webhooks/groupme?token=wrong", message, json)).status, 403);
  assert.equal((await post(app, "/webhooks/groupme?token=anything", message, json)).status, 403);
  assert.equal((await post(hooked, "/webhooks/groupme?token=s3cret-token", { nope: true }, json)).status, 400);
});

test("GroupMe webhook ignores bot, system and empty messages without a bearer token", async () => {
  const hooked = createApp({ verify: async () => null, log: false, groupme: { secret: "s3cret-token", schoolId: ID } });
  const res = await post(hooked, "/webhooks/groupme?token=s3cret-token", { ...message, sender_type: "bot" }, json);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { data: { ingested: false, reason: "bot" } });
  assert.equal(groupmeSkipReason(GroupMeMessage.parse({ ...message, sender_type: "system", system: true })), "system");
  assert.equal(groupmeSkipReason(GroupMeMessage.parse({ ...message, text: "  " })), "empty");
  assert.equal(groupmeSkipReason(GroupMeMessage.parse(message)), null);
});

test("Google Calendar webhook needs the channel headers", async () => {
  assert.equal((await anon.request("/api/v1/webhooks/google-calendar", { method: "POST" })).status, 400);
  assert.equal((await anon.request("/api/v1/webhooks/google-calendar", { method: "POST", headers: { "X-Goog-Channel-ID": "c1" } })).status, 400);
});
