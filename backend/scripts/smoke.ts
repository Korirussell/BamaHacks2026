// Exercises every endpoint added in the social, wishlist, rides, tickets, study-group, syllabus and misc
// modules against the live Supabase project, in-process, as the two demo users from `pnpm seed:demo`.
//
//   pnpm smoke
//
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (and the two demo personas). PAYMENTS stays demo.
// Responses are checked against the zod shapes in src/schemas. Everything the run creates is deleted at
// the end (rows created after the run started by the two demo users, plus the events and posts it seeds),
// and the demo users' reliability counters are restored. Keys and tokens are never printed.

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createApp } from "../src/app.js";
import { adminClient } from "../src/lib/supabase.js";
import { Listing } from "../src/schemas/listings.js";
import { Offer } from "../src/schemas/offers.js";
import { Order } from "../src/schemas/orders.js";
import { Review } from "../src/schemas/reviews.js";
import { Ride, RideRequest } from "../src/schemas/rides.js";
import { UserPublic } from "../src/schemas/me.js";
import { IncomingFriendRequest, SuggestedFriend } from "../src/schemas/social.js";
import { SuggestedTrade, WishlistItem } from "../src/schemas/wishlist.js";
import { Event } from "../src/schemas/listings.js";

for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[name]) { console.error(`${name} is not set. Fill in backend/.env first.`); process.exit(1); }
}
process.env["PAYMENTS"] = "demo";

const db = adminClient();
const app = createApp({ log: false });
const api = "/api/v1";
const SCHOOL = "00000000-0000-4000-a000-000000000001";
const CH101 = "00000000-0000-4000-e000-000000000001";
const message = (err: unknown) => (err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : String(err));

let failures = 0;
const report = (status: "PASS" | "FAIL" | "SKIP", name: string, detail = "") => {
  if (status === "FAIL") failures++;
  console.log(`${status.padEnd(4)}  ${name}${detail ? ` - ${detail}` : ""}`);
};

// ---------------------------------------------------------------- users

const PERSONAS = { s: "bamahacks.student@crimson.ua.edu", a: "bamahacks.ava@crimson.ua.edu" } as const;
type Who = keyof typeof PERSONAS;
const ids = {} as Record<Who, string>;
const tokens = {} as Record<Who, string>;

async function mint(email: string): Promise<{ id: string; token: string }> {
  const link = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw new Error(`generateLink: ${link.error.message}`);
  const key = process.env["SUPABASE_ANON_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  const client = createClient(process.env["SUPABASE_URL"]!, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const verified = await client.auth.verifyOtp({ email, token: link.data.properties.email_otp, type: "email" });
  if (verified.error || !verified.data.session) throw new Error(`verifyOtp: ${verified.error?.message ?? "no session"}`);
  return { id: verified.data.user!.id, token: verified.data.session.access_token };
}

// ---------------------------------------------------------------- http

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Reply = { status: number; data: any; next_cursor?: string; error?: { code: string; message: string; field_errors?: unknown } };
let keySeq = 0;
async function call(who: Who, method: string, path: string, body?: unknown, idem = false): Promise<Reply> {
  const res = await app.request(`${api}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${tokens[who]}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(idem ? { "idempotency-key": `smoke-${Date.now()}-${keySeq++}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => null)) as { data?: unknown; next_cursor?: string; error?: Reply["error"] } | null;
  return { status: res.status, data: json?.data, ...(json?.next_cursor ? { next_cursor: json.next_cursor } : {}), ...(json?.error ? { error: json.error } : {}) };
}

/** A step: `fn` throws on failure; its return value is the PASS detail. */
async function step(name: string, fn: () => Promise<string | void>) {
  try { report("PASS", name, (await fn()) ?? ""); } catch (err) { report("FAIL", name, message(err)); }
}
const expectOk = (r: Reply, status: number, what = "") => {
  if (r.status !== status) throw new Error(`${what}status ${r.status} (want ${status})${r.error ? ` ${r.error.code}: ${r.error.message} ${JSON.stringify(r.error.field_errors ?? "")}` : ""}`);
  return r.data;
};
const shape = <T extends z.ZodType>(schema: T, data: unknown): z.output<T> => {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error(`contract shape: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data;
};
const shapeList = <T extends z.ZodType>(schema: T, data: unknown) => shape(z.array(schema), data);
const j = (v: unknown) => JSON.stringify(v);

// ---------------------------------------------------------------- fixtures created through the db

const t0 = new Date().toISOString();
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const created = { eventIds: [] as string[], postIds: [] as string[], storage: [] as { bucket: string; path: string }[], mediaIds: [] as string[], driverBefore: new Map<Who, boolean>() };
const counters = new Map<Who, { completed_count: number; no_show_count: number }>();

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
  "4 0 obj<</Length 130>>stream\nBT /F1 12 Tf 72 700 Td (Midterm Exam: October 28, 2026) Tj 0 -20 Td (Final Project due December 4, 2026) Tj ET\nendstream\nendobj\n" +
  "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF\n",
);

async function jobResult(who: Who, jobId: string) {
  for (let i = 0; i < 20; i++) {
    const job = expectOk(await call(who, "GET", `/jobs/${jobId}`), 200);
    if (job.status === "succeeded" || job.status === "failed") return job as { status: string; error?: string; result?: Record<string, unknown> };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("job didn't finish in 10 s");
}

async function upload(who: Who, purpose: string, contentType: string, bytes: Buffer, ext: string): Promise<string> {
  const r = await call(who, "POST", "/media/upload-url", { purpose, content_type: contentType, bytes: bytes.length });
  const d = expectOk(r, 201, "upload-url ");
  const bucket = purpose === "listing" || purpose === "avatar" ? "public-media" : "private-docs";
  const path = `${ids[who]}/${d.media_id}.${ext}`;
  created.mediaIds.push(d.media_id);
  created.storage.push({ bucket, path });
  const up = await db.storage.from(bucket).uploadToSignedUrl(path, d.token, new Blob([new Uint8Array(bytes)], { type: contentType }), { contentType });
  if (up.error) throw new Error(`signed upload: ${up.error.message}`);
  expectOk(await call(who, "POST", `/media/${d.media_id}/complete`), 200, "complete ");
  return d.media_id;
}

// ---------------------------------------------------------------- cleanup

async function purge() {
  const users = [ids.s, ids.a];
  const note = (what: string, error: { message: string } | null) => { if (error) { console.log(`cleanup ${what}: ${error.message}`); failures++; } };
  const del = async (table: string, col: string, values: string[], extra?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!values.length) return;
    let q = db.from(table).delete().in(col, values);
    if (extra) q = extra(q);
    note(`${table}.${col}`, (await q).error);
  };
  const pick = async (table: string, col: string, values: string[], since = true): Promise<string[]> => {
    let q = db.from(table).select("id").in(col, values);
    if (since) q = q.gte("created_at", t0);
    const { data, error } = await q;
    if (error) { console.log(`cleanup read ${table}: ${error.message}`); failures++; return []; }
    return (data ?? []).map((r: { id: string }) => r.id);
  };

  const listings = await pick("listings", "seller_id", users);
  const orders = [...new Set([...(await pick("orders", "buyer_id", users)), ...(await pick("orders", "seller_id", users))])];
  const offers = [...new Set([...(await pick("offers", "buyer_id", users)), ...(await pick("offers", "seller_id", users))])];
  const rides = await pick("rides", "driver_id", users);
  const requests = await pick("ride_requests", "rider_id", users);
  const groups = await pick("study_groups", "host_id", users);
  const syllabi = await pick("syllabi", "user_id", users);

  const { data: handoffRows } = orders.length ? await db.from("handoffs").select("id").in("context_id", orders) : { data: [] };
  await del("escrow_entries", "order_id", orders);
  await del("shipments", "order_id", orders);
  await del("reviews", "from_id", users, (q) => q.gte("created_at", t0));
  await del("orders", "id", orders);
  await del("handoffs", "id", (handoffRows ?? []).map((h: { id: string }) => h.id));
  await del("offers", "id", offers);
  await del("bargain_sessions", "buyer_id", users, (q) => q.gte("created_at", t0));
  await del("ride_bookings", "ride_id", rides);
  await del("ride_bookings", "rider_id", users, (q) => q.gte("created_at", t0));
  await del("ride_requests", "id", requests);
  await del("rides", "id", rides);
  if (created.driverBefore.get("s") === false) await del("drivers", "user_id", [ids.s]);
  if (created.driverBefore.get("a") === false) await del("drivers", "user_id", [ids.a]);
  await del("study_group_members", "group_id", groups);
  await del("study_groups", "id", groups);
  await del("study_group_members", "user_id", users, (q) => q.gte("joined_at", t0));
  const { data: ev } = syllabi.length ? await db.from("course_events").select("id").in("syllabus_id", syllabi) : { data: [] };
  await del("course_event_confirmations", "event_id", (ev ?? []).map((e: { id: string }) => e.id));
  await del("course_events", "id", (ev ?? []).map((e: { id: string }) => e.id));
  await del("syllabi", "id", syllabi);
  await del("wishlist_items", "user_id", users, (q) => q.gte("created_at", t0));
  await del("reports", "reporter_id", users, (q) => q.gte("created_at", t0));
  await del("push_subscriptions", "user_id", users, (q) => q.gte("created_at", t0));
  await del("tutoring_requests", "student_id", users, (q) => q.gte("created_at", t0));
  await del("friend_requests", "from_id", users, (q) => q.gte("created_at", t0));
  await del("friend_requests", "to_id", users, (q) => q.gte("created_at", t0));
  await del("friendships", "user_a", users, (q) => q.gte("created_at", t0));
  await del("friendships", "user_b", users, (q) => q.gte("created_at", t0));
  await del("notifications", "user_id", users, (q) => q.gte("created_at", t0));
  await del("listing_courses", "listing_id", listings);
  await del("listing_media", "listing_id", listings);
  await del("listings", "id", listings);
  await del("ingested_posts", "id", created.postIds);
  await del("events", "id", created.eventIds);
  await del("jobs", "user_id", users, (q) => q.gte("created_at", t0));
  await del("idempotency_keys", "user_id", users, (q) => q.gte("created_at", t0));
  for (const f of created.storage) note(`storage ${f.bucket}`, (await db.storage.from(f.bucket).remove([f.path])).error);
  await del("media", "id", created.mediaIds);
  for (const [who, c] of counters) note(`profile counters ${who}`, (await db.from("profiles").update(c).eq("id", ids[who])).error);
}

// ---------------------------------------------------------------- the run

try {
  for (const who of ["s", "a"] as const) {
    const m = await mint(PERSONAS[who]);
    ids[who] = m.id; tokens[who] = m.token;
    const { data } = await db.from("profiles").select("completed_count, no_show_count").eq("id", m.id).single();
    counters.set(who, data as { completed_count: number; no_show_count: number });
    const drv = await db.from("drivers").select("user_id").eq("user_id", m.id).maybeSingle();
    created.driverBefore.set(who, !!drv.data);
  }

  // ------------------------------------------------------------ users
  await step("GET /users/search", async () => {
    const d = shapeList(UserPublic, expectOk(await call("s", "GET", "/users/search?q=Ava"), 200));
    if (!d.some((u) => u.id === ids.a)) throw new Error("Ava not found by name");
    return `${d.length} result(s)`;
  });
  await step("GET /users/search?course_id", async () => `${shapeList(UserPublic, expectOk(await call("s", "GET", `/users/search?q=a&course_id=${CH101}`), 200)).length} result(s)`);
  await step("GET /users/{id}", async () => { const d = expectOk(await call("s", "GET", `/users/${ids.a}`), 200); const u = shape(UserPublic, d.user); shapeList(UserPublic, d.mutual_friends); shapeList(Listing, d.active_listings); return `${u.display_name}, friend=${u.is_friend}, ${d.active_listings.length} listing(s)`; });
  await step("GET /users/{id}/reviews", async () => `${shapeList(Review, expectOk(await call("s", "GET", `/users/${ids.a}/reviews`), 200)).length} review(s)`);

  // ------------------------------------------------------------ social
  let reqId = "";
  await step("POST /friend-requests", async () => { const d = expectOk(await call("s", "POST", "/friend-requests", { user_id: ids.a }), 201); reqId = d.id; return d.status; });
  await step("POST /friend-requests again returns the same open request", async () => { const d = expectOk(await call("s", "POST", "/friend-requests", { user_id: ids.a }), 200); if (d.id !== reqId) throw new Error("different id"); });
  await step("GET /me/friend-requests (as Ava)", async () => {
    const d = shapeList(IncomingFriendRequest, expectOk(await call("a", "GET", "/me/friend-requests"), 200));
    if (!d.some((r) => r.id === reqId)) throw new Error("request missing");
    return `${d.length}`;
  });
  await step("POST /friend-requests/{id}/decline", async () => { expectOk(await call("a", "POST", `/friend-requests/${reqId}/decline`), 204); });
  await step("POST /friend-requests again + /accept", async () => {
    const d = expectOk(await call("s", "POST", "/friend-requests", { user_id: ids.a }), 201);
    const u = shape(UserPublic, expectOk(await call("a", "POST", `/friend-requests/${d.id}/accept`), 200));
    if (u.id !== ids.s) throw new Error("accept should return the requester");
  });
  await step("GET /me/friends", async () => { const d = shapeList(UserPublic, expectOk(await call("s", "GET", "/me/friends"), 200)); if (!d.some((u) => u.id === ids.a)) throw new Error("Ava not in friends"); return `${d.length}`; });
  await step("GET /users/{id}/mutuals", async () => `${shapeList(UserPublic, expectOk(await call("s", "GET", `/users/${ids.a}/mutuals`), 200)).length}`);
  await step("GET /me/suggested-friends", async () => `${shapeList(SuggestedFriend, expectOk(await call("s", "GET", "/me/suggested-friends"), 200)).length}`);
  // kept as friends for the rest of the run (feed reason "friend"); removed at the end

  // ------------------------------------------------------------ wishlist + listings
  const photo = await upload("s", "listing", "image/png", PNG, "png");
  const unique = `smokewidget${Date.now() % 100000}`;
  let wish: z.infer<typeof WishlistItem> | undefined;
  await step("POST /me/wishlist (keyword)", async () => {
    wish = shape(WishlistItem, expectOk(await call("a", "POST", "/me/wishlist", { kind: "keyword", keyword: unique, max_price_cents: 5000, alert: true }), 201));
  });
  await step("POST /me/wishlist (isbn, course_materials, category)", async () => {
    shape(WishlistItem, expectOk(await call("a", "POST", "/me/wishlist", { kind: "isbn", isbn: "9780134092669", alert: false }), 201));
    shape(WishlistItem, expectOk(await call("a", "POST", "/me/wishlist", { kind: "course_materials", course_id: CH101 }), 201));
    shape(WishlistItem, expectOk(await call("a", "POST", "/me/wishlist", { kind: "category", category: "dorm", max_price_cents: 3000 }), 201));
  });
  await step("GET /me/wishlist", async () => `${shapeList(WishlistItem, expectOk(await call("a", "GET", "/me/wishlist"), 200)).length} item(s)`);

  let listingId = "";
  await step("POST /listings (publish) + wishlist alert", async () => {
    const l = shape(Listing, expectOk(await call("s", "POST", "/listings", {
      category: "dorm", title: `Desk lamp ${unique}`, description: "smoke test listing", price_cents: 2500, negotiable: true, floor_price_cents: 2000,
      condition: "good", media_ids: [photo], course_ids: [], fulfillment: ["in_person"], publish: true,
    }), 201));
    listingId = l.id;
    if (l.status !== "active") throw new Error(`status ${l.status}`);
    const n = expectOk(await call("a", "GET", "/me/notifications"), 200) as { type: string; data?: { listing_id?: string } }[];
    const alert = n.find((x) => x.type.includes("wishlist"));
    if (!alert) throw new Error(`no wishlist notification for Ava (types: ${n.map((x) => x.type).join(",")})`);
  });
  await step("GET /me/wishlist/matches", async () => {
    const d = shapeList(z.object({ wishlist_item_id: z.string(), listing: Listing }), expectOk(await call("a", "GET", "/me/wishlist/matches"), 200));
    if (!d.some((m) => m.listing.id === listingId)) throw new Error("new listing isn't a match");
    return `${d.length} match(es)`;
  });
  await step("GET /listings/{id}/suggested-trades", async () => `${shapeList(SuggestedTrade, expectOk(await call("a", "GET", `/listings/${listingId}/suggested-trades`), 200)).length}`);
  await step("GET /listings/{id}", async () => { const d = expectOk(await call("a", "GET", `/listings/${listingId}`), 200); shape(Listing, d.listing); shapeList(SuggestedTrade, d.suggested_trades); });
  await step("PATCH /listings/{id}", async () => {
    const l = shape(Listing, expectOk(await call("s", "PATCH", `/listings/${listingId}`, { price_cents: 2400, description: "patched" }), 200));
    if (l.price_cents !== 2400) throw new Error("price not updated");
  });
  await step("PATCH /listings/{id} by a non-owner is refused", async () => { const r = await call("a", "PATCH", `/listings/${listingId}`, { price_cents: 1 }); if (r.status !== 403 && r.status !== 404) throw new Error(`status ${r.status}`); return String(r.status); });
  await step("GET /feed", async () => {
    const r = await call("a", "GET", "/feed");
    const d = expectOk(r, 200) as { type: string; item: { id: string }; reason: string }[];
    shapeList(Listing, d.map((x) => x.item));
    const mine = d.find((x) => x.item.id === listingId);
    if (!mine) throw new Error("new listing missing from Ava's feed");
    if (mine.reason !== "wishlist_match") throw new Error(`reason ${mine.reason}, want wishlist_match`);
    const first = expectOk(await call("a", "GET", "/feed?limit=1"), 200);
    return `${d.length} item(s); page of 1 -> ${first.length}`;
  });
  await step("GET /explore/listings (+filters)", async () => {
    const all = shapeList(Listing, expectOk(await call("a", "GET", "/explore/listings"), 200));
    const q = shapeList(Listing, expectOk(await call("a", "GET", `/explore/listings?q=${unique}&sort=price_asc&category=dorm&max_cents=5000`), 200));
    if (!q.some((l) => l.id === listingId)) throw new Error("search didn't find the listing");
    shapeList(Listing, expectOk(await call("a", "GET", "/explore/listings?category=ticket"), 200));
    for (const qs of [`course_id=${CH101}`, "isbn=9780134092669", "min_cents=100&condition=good&fulfillment=in_person&source=native", "within_budget=true", "sort=price_desc&limit=2"]) {
      shapeList(Listing, expectOk(await call("a", "GET", `/explore/listings?${qs}`), 200, `${qs}: `));
    }
    return `${all.length} total`;
  });
  await step("GET /me/listings", async () => `${shapeList(Listing, expectOk(await call("s", "GET", "/me/listings"), 200)).length}`);

  // auto-bargain
  await step("POST /listings/{id}/auto-bargain + GET /auto-bargain/{id}", async () => {
    const d = expectOk(await call("a", "POST", `/listings/${listingId}/auto-bargain`, { max_price_cents: 2300, style: "balanced" }), 201);
    const g = expectOk(await call("a", "GET", `/auto-bargain/${d.session_id}`), 200);
    if (!Array.isArray(g.rounds)) throw new Error("rounds missing");
    return `${d.status}, ${g.rounds.length} round(s)${g.proposed_offer ? shape(Offer, g.proposed_offer) && ", proposed offer" : ""}`;
  });

  // reports, push, tutoring request
  await step("POST /reports", async () => { expectOk(await call("a", "POST", "/reports", { target: { type: "listing", id: listingId }, reason: "spam", details: "smoke test" }), 204); });
  await step("POST /me/push-subscriptions (web, ios)", async () => {
    expectOk(await call("a", "POST", "/me/push-subscriptions", { platform: "web", subscription: { endpoint: "https://push.example.com/smoke", keys: { p256dh: "abc", auth: "def" } } }), 204);
    expectOk(await call("a", "POST", "/me/push-subscriptions", { platform: "ios", subscription: { token: "smoke-device-token" } }), 204);
  });
  await step("POST /tutoring/requests", async () => {
    const d = expectOk(await call("s", "POST", "/tutoring/requests", { course_id: CH101, windows: [{ start: days(2), end: days(2.1), kind: "free" }], max_rate_cents: 3000, notes: "smoke" }), 201);
    return `${d.matched_tutor_count} matched`;
  });

  // ingested post
  await step("GET /ingested-posts/{id}", async () => {
    const ins = await db.from("ingested_posts").insert({ school_id: SCHOOL, channel: "instagram", external_url: `https://instagram.com/p/smoke${Date.now()}`, author_handle: "smoke_seller", caption: "smoke post", posted_at: new Date().toISOString() }).select("id").single();
    if (ins.error) throw new Error(`fixture insert: ${ins.error.message}`);
    created.postIds.push(ins.data.id);
    const d = expectOk(await call("s", "GET", `/ingested-posts/${ins.data.id}`), 200);
    if (d.raw_text !== "smoke post") throw new Error("raw_text mismatch");
  });

  // AI endpoints through the caption fallback (no model configured)
  await step("POST /listings/from-screenshot + /jobs", async () => {
    const d = expectOk(await call("s", "POST", "/listings/from-screenshot", { media_ids: [photo] }), 202);
    const job = await jobResult("s", d.job_id);
    if (job.status === "succeeded" && !(job.result && "draft" in job.result)) throw new Error(`result has no draft: ${Object.keys(job.result ?? {})}`);
    return `job ${job.status}${job.error ? `: ${job.error}` : ""}`;
  });
  await step("POST /listings/identify-textbook + /jobs", async () => {
    const d = expectOk(await call("s", "POST", "/listings/identify-textbook", { media_id: photo }), 202);
    const job = await jobResult("s", d.job_id);
    return `job ${job.status}${job.error ? `: ${job.error}` : ""}`;
  });

  // ------------------------------------------------------------ tickets
  let eventId = "";
  await step("fixture: insert event (service role)", async () => {
    const r = await db.from("events").insert({ school_id: SCHOOL, name: "Smoke Bowl", kind: "athletics", starts_at: days(10), venue: "Bryant-Denny" }).select("id").single();
    if (r.error) throw new Error(r.error.message);
    eventId = r.data.id; created.eventIds.push(eventId);
  });
  await step("GET /events", async () => { const d = shapeList(Event, expectOk(await call("a", "GET", "/events"), 200)); if (!d.some((e) => e.id === eventId)) throw new Error("event missing"); shapeList(Event, expectOk(await call("a", "GET", `/events?kind=athletics&from=${encodeURIComponent(days(1))}`), 200)); return `${d.length}`; });
  let ticketId = "";
  await step("POST /listings (ticket)", async () => {
    const l = shape(Listing, expectOk(await call("s", "POST", "/listings", {
      category: "ticket", title: "Smoke Bowl ticket", description: "smoke", price_cents: 4000, negotiable: false, condition: "new", media_ids: [], course_ids: [],
      ticket: { event_id: eventId, section: "KK", row: "12", seat: "7", transfer: "app_transfer" }, fulfillment: ["digital_transfer"], publish: true,
    }), 201));
    if (!l.ticket || l.ticket.event.id !== eventId) throw new Error("ticket block missing");
    ticketId = l.id;
  });
  await step("GET /events/{id}/tickets", async () => { const d = shapeList(Listing, expectOk(await call("a", "GET", `/events/${eventId}/tickets`), 200)); if (!d.some((l) => l.id === ticketId)) throw new Error("ticket missing"); });
  await step("PATCH /listings/{id} (ticket fields)", async () => {
    const l = shape(Listing, expectOk(await call("s", "PATCH", `/listings/${ticketId}`, { ticket: { event_id: eventId, section: "KK", row: "13", seat: "8", transfer: "app_transfer" } }), 200));
    if (l.ticket?.row !== "13") throw new Error("row not updated");
  });
  await step("GET /feed and /explore/listings with a ticket listing present", async () => {
    const f = expectOk(await call("a", "GET", "/feed"), 200) as { type: string }[];
    shapeList(Listing, expectOk(await call("a", "GET", "/explore/listings?category=ticket"), 200));
    return `feed types ${[...new Set(f.map((x) => x.type))].join(",")}`;
  });
  let orderId = "";
  await step("POST /listings/{id}/offers (ticket) -> order", async () => {
    const d = expectOk(await call("a", "POST", `/listings/${ticketId}/offers`, { kind: "cash", amount_cents: 4000, trade_listing_ids: [], fulfillment: "digital_transfer" }, true), 201);
    shape(Offer, d.offer);
    if (d.order) { shape(Order, d.order); orderId = d.order.id; return "auto-accepted"; }
    const acc = expectOk(await call("s", "POST", `/offers/${d.offer.id}/accept`, undefined, true), 200);
    shape(Order, acc.order); orderId = acc.order.id;
    return "accepted by seller";
  });
  await step("POST /orders/{id}/pay (demo)", async () => { const d = expectOk(await call("a", "POST", `/orders/${orderId}/pay`, undefined, true), 200); if (d.order) shape(Order, d.order); return `demo=${d.demo}`; });
  await step("POST /orders/{id}/ticket-sent", async () => { const o = shape(Order, expectOk(await call("s", "POST", `/orders/${orderId}/ticket-sent`, {}, true), 200)); return o.status; });
  await step("POST /orders/{id}/ticket-received", async () => { const o = shape(Order, expectOk(await call("a", "POST", `/orders/${orderId}/ticket-received`, undefined, true), 200)); return o.status; });

  // ------------------------------------------------------------ rides
  const campus = { label: "Ferguson Center", location: { lat: 33.2115, lng: -87.5461 } };
  const mall = { label: "University Mall", location: { lat: 33.2153, lng: -87.5124 } };
  await step("PUT /me/driver", async () => {
    const d = expectOk(await call("s", "PUT", "/me/driver", { vehicle: { make: "Toyota", model: "Camry", color: "Crimson", plate: "ROLL1TD" }, accepts_terms: true }), 200);
    return d.status;
  });
  let rideId = "";
  await step("POST /rides", async () => { const r = shape(Ride, expectOk(await call("s", "POST", "/rides", { origin: campus, destination: mall, depart_at: days(1), seats: 3, price_per_seat_cents: 300 }), 201)); rideId = r.id; });
  await step("GET /rides (+near, to_near, date)", async () => {
    const all = shapeList(Ride, expectOk(await call("a", "GET", "/rides"), 200));
    if (!all.some((r) => r.id === rideId)) throw new Error("ride missing from list");
    shapeList(Ride, expectOk(await call("a", "GET", "/rides?near=33.2115,-87.5461&to_near=33.2153,-87.5124"), 200));
    shapeList(Ride, expectOk(await call("a", "GET", `/rides?date=${days(1).slice(0, 10)}`), 200));
    return `${all.length}`;
  });
  await step("GET /rides/{id}", async () => { shape(Ride, expectOk(await call("a", "GET", `/rides/${rideId}`), 200)); });
  let bookingId = "";
  await step("POST /rides/{id}/book (demo)", async () => {
    const d = expectOk(await call("a", "POST", `/rides/${rideId}/book`, { seats: 1, pickup: campus }, true), 200);
    bookingId = d.booking_id; shape(Ride, d.ride);
    if (d.ride.seats_left !== 2) throw new Error(`seats_left ${d.ride.seats_left}`);
    return `demo=${d.demo}`;
  });
  const rideStatus = async (status: string) => shape(Ride, expectOk(await call("s", "POST", `/rides/${rideId}/status`, { status }, true), 200, `${status}: `));
  await step("POST /rides/{id}/status en_route", async () => { await rideStatus("en_route"); });
  await step("POST /rides/{id}/location", async () => { expectOk(await call("s", "POST", `/rides/${rideId}/location`, { location: campus.location }), 204); });
  await step("GET /rides/{id} shows driver_location to a rider", async () => {
    const r = shape(Ride, expectOk(await call("a", "GET", `/rides/${rideId}`), 200));
    if (!r.driver_location) throw new Error("driver_location is null after a ping");
    return `riders=${r.riders.length}`;
  });
  await step("POST /rides/{id}/status picked_up -> completed", async () => { await rideStatus("picked_up"); await rideStatus("completed"); });
  let rrId = "";
  await step("POST /ride-requests", async () => { const r = shape(RideRequest, expectOk(await call("a", "POST", "/ride-requests", { pickup: campus, dropoff: mall, depart_at: "now", seats: 1, max_price_cents: 500 }), 201)); rrId = r.id; });
  await step("GET /ride-requests/open (as driver)", async () => { const d = shapeList(RideRequest, expectOk(await call("s", "GET", "/ride-requests/open"), 200)); if (!d.some((r) => r.id === rrId)) throw new Error("request missing"); return `${d.length}`; });
  await step("POST /ride-requests/{id}/accept", async () => { const r = shape(Ride, expectOk(await call("s", "POST", `/ride-requests/${rrId}/accept`, {}, true), 200)); return `ride ${r.status}, ${r.riders.length} rider(s)`; });
  void bookingId;

  // ------------------------------------------------------------ study groups + syllabi
  let eventRow: string | undefined;
  await step("POST /syllabi (pdf) + /confirm + GET /courses/{id}/events", async () => {
    const media = await upload("s", "syllabus", "application/pdf", PDF, "pdf");
    const d = expectOk(await call("s", "POST", "/syllabi", { course_id: CH101, term: "Fall 2026", media_id: media }), 202);
    const events = [{ kind: "exam", title: "Smoke midterm", due_at: days(12) }, { kind: "assignment", title: "Smoke homework", due_at: days(5) }];
    const out = expectOk(await call("s", "POST", `/syllabi/${d.syllabus_id}/confirm`, { events }), 200) as { id: string; title: string }[];
    if (out.length !== 2) throw new Error(`confirm returned ${out.length}`);
    eventRow = out.find((e) => e.title === "Smoke midterm")?.id;
    const list = expectOk(await call("a", "GET", `/courses/${CH101}/events?term=${encodeURIComponent("Fall 2026")}`), 200) as { title: string }[];
    if (!list.some((e) => e.title === "Smoke midterm")) throw new Error("confirmed event not listed");
    return `job ${d.job_id.slice(0, 8)}`;
  });
  let groupId = "";
  await step("POST /study-groups", async () => {
    const g = expectOk(await call("s", "POST", "/study-groups", {
      course_id: CH101, title: "Smoke study", ...(eventRow ? { target_event_id: eventRow } : {}), mode: "in_person",
      place: { label: "Gorgas Library", location: { lat: 33.2111, lng: -87.5456 } }, start: days(3), end: days(3.1), capacity: 4, cross_campus: false,
    }), 201);
    groupId = g.id;
    if (!g.members?.length) throw new Error("host should be a member");
  });
  await step("GET /study-groups (campus, all_schools)", async () => {
    const d = expectOk(await call("a", "GET", `/study-groups?course_id=${CH101}`), 200) as { id: string }[];
    if (!d.some((g) => g.id === groupId)) throw new Error("group missing");
    expectOk(await call("a", "GET", "/study-groups?scope=all_schools"), 200);
    return `${d.length}`;
  });
  await step("GET /study-groups/suggested-times", async () => `${(expectOk(await call("a", "GET", `/study-groups/suggested-times?course_id=${CH101}${eventRow ? `&before_event_id=${eventRow}` : ""}`), 200) as unknown[]).length} slot(s)`);
  await step("POST /study-groups/{id}/join + leave", async () => {
    const g = expectOk(await call("a", "POST", `/study-groups/${groupId}/join`), 200);
    if (g.members.length !== 2) throw new Error(`members ${g.members.length}`);
    expectOk(await call("a", "POST", `/study-groups/${groupId}/leave`), 204);
  });

  // ------------------------------------------------------------ cleanup of friendship + done
  await step("DELETE /friends/{id}", async () => { expectOk(await call("s", "DELETE", `/friends/${ids.a}`), 204); });
} catch (err) {
  report("FAIL", "smoke run aborted", message(err));
} finally {
  try {
    await purge();
    const left: string[] = [];
    for (const [table, col] of [["listings", "seller_id"], ["offers", "buyer_id"], ["orders", "buyer_id"], ["rides", "driver_id"], ["ride_requests", "rider_id"], ["study_groups", "host_id"], ["syllabi", "user_id"], ["wishlist_items", "user_id"], ["reports", "reporter_id"], ["push_subscriptions", "user_id"], ["tutoring_requests", "student_id"], ["friend_requests", "from_id"], ["notifications", "user_id"], ["jobs", "user_id"], ["media", "owner_id"], ["bargain_sessions", "buyer_id"]] as const) {
      const r = await db.from(table).select("id", { count: "exact", head: true }).in(col, [ids.s, ids.a]).gte("created_at", t0);
      if (r.error) left.push(`${table}: ${r.error.message}`); else if (r.count) left.push(`${table}: ${r.count}`);
    }
    for (const [table, col] of [["events", "id"], ["ingested_posts", "id"]] as const) {
      const r = await db.from(table).select("id", { count: "exact", head: true }).in(col, [...created.eventIds, ...created.postIds, "00000000-0000-4000-0000-000000000000"]);
      if (r.count) left.push(`${table}: ${r.count}`);
    }
    if (left.length) { console.log(`cleanup left rows behind: ${left.join(", ")}`); failures++; } else console.log("cleanup done, no rows left behind");
  } catch (err) { console.log(`cleanup failed: ${message(err)}`); failures++; }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
