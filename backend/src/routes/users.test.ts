import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import type { TokenVerifier } from "../middleware/auth.js";
import { ilikeContains, reviewSummary } from "./users.js";

process.env["SUPABASE_URL"] ??= "https://example.supabase.co";

const signedIn: TokenVerifier = async () => ({ sub: "00000000-0000-4000-a000-000000000005", email: "s@crimson.ua.edu", schoolId: "00000000-0000-4000-a000-000000000001" });
const auth = { headers: { Authorization: "Bearer test", "Content-Type": "application/json" } };
const app = createApp({ verify: signedIn, log: false });

test("user search treats % and _ in the query as literal characters", () => {
  assert.equal(ilikeContains("ann"), "%ann%");
  assert.equal(ilikeContains("50%_off\\"), "%50\\%\\_off\\\\%");
});

test("reviewSummary averages to one decimal and is zero without reviews", () => {
  assert.deepEqual(reviewSummary([]), { avg_stars: 0, count: 0 });
  assert.deepEqual(reviewSummary([5, 4, 4]), { avg_stars: 4.3, count: 3 });
});

test("user routes need a sign-in, a query for search, and a real id", async () => {
  const anon = createApp({ verify: async () => null, log: false });
  assert.equal((await anon.request("/api/v1/users/search?q=a")).status, 401);
  assert.equal((await app.request("/api/v1/users/search", auth)).status, 400);
  assert.equal((await app.request("/api/v1/users/search?q=%20%20", auth)).status, 400);
  assert.equal((await app.request("/api/v1/users/not-a-uuid", auth)).status, 404);
  assert.equal((await app.request("/api/v1/users/not-a-uuid/reviews", auth)).status, 404);
});

test("screenshot and identify jobs validate their media before touching the database", async () => {
  const post = (path: string, body: unknown) => app.request(`/api/v1${path}`, { method: "POST", body: JSON.stringify(body), ...auth });
  assert.equal((await post("/listings/from-screenshot", { media_ids: [] })).status, 400);
  assert.equal((await post("/listings/from-screenshot", { media_ids: Array(5).fill("00000000-0000-4000-b000-000000000001") })).status, 400);
  assert.equal((await post("/listings/identify-textbook", { media_id: "nope" })).status, 400);
});

test("PATCH /listings checks the body and the id", async () => {
  const patch = (id: string, body: unknown) => app.request(`/api/v1/listings/${id}`, { method: "PATCH", body: JSON.stringify(body), ...auth });
  assert.equal((await patch("not-a-uuid", { title: "x" })).status, 404);
  assert.equal((await patch("00000000-0000-4000-b000-000000000001", { price_cents: -1 })).status, 400);
});
