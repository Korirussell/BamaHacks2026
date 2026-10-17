import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { graphTime, instagramGraph, parseStories } from "../adapters/instagram.js";
import { DmWindowClosedError, sellerDms } from "./instagram-dm.js";
import { asDm, dmWindow, listedReply, offerReply, unseenMedia } from "./instagram.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-17T18:00:00Z");

interface Call { url: string; method: string; body: string; headers: Record<string, string> }

/** A fake graph.instagram.com: `routes` maps a path (no query) to a reply. */
function fakeGraph(routes: Record<string, unknown | ((url: URL) => Response)>) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? String(init.body) : "", headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    const route = routes[url.pathname.replace(/^\/v23\.0/, "")];
    if (route === undefined) return json({ error: { message: `no route ${url.pathname}` } }, 404);
    return typeof route === "function" ? (route as (u: URL) => Response)(url) : json(route);
  };
  return { calls, fetch };
}

const platformMe = { id: "app-scoped", user_id: "100", username: "bamahacks" };

describe("instagram stories", () => {
  it("parses stories: video covers, no caption, and a stable URL when there's no permalink", () => {
    const stories = parseStories({ data: [
      { id: "s1", media_type: "IMAGE", media_url: "https://cdn/s1", timestamp: "2026-10-17T15:00:00+0000" },
      { id: "s2", media_type: "VIDEO", media_url: "https://cdn/v2", thumbnail_url: "https://cdn/t2", permalink: "https://www.instagram.com/stories/bamahacks2/s2/" },
    ] }, "bamahacks2");
    assert.deepEqual(stories.map((s) => s.permalink), ["https://www.instagram.com/stories/bamahacks2/s1/", "https://www.instagram.com/stories/bamahacks2/s2/"]);
    assert.deepEqual(stories.map((s) => s.imageUrls), [["https://cdn/s1"], ["https://cdn/t2"]]);
    assert.equal(stories[0]!.caption, "");
    assert.equal(stories[0]!.username, "bamahacks2");
  });

  it("dedupes stories on that URL, so a re-poll ingests nothing new", () => {
    const stories = parseStories({ data: [{ id: "s1", media_url: "https://cdn/s1" }, { id: "s2", media_url: "https://cdn/s2" }] }, "bamahacks2");
    const fresh = unseenMedia(stories, new Set(["https://www.instagram.com/stories/bamahacks2/s1/"]));
    assert.deepEqual(fresh.map((s) => s.id), ["s2"]);
  });

  it("reads the seller's own stories with the seller's token", async () => {
    const g = fakeGraph({ "/me": { user_id: 200, id: "x", username: "bamahacks2" }, "/200/stories": { data: [] } });
    const seller = instagramGraph({ token: "seller-tok", host: "https://graph.test/v23.0", fetch: g.fetch });
    assert.deepEqual(await seller.stories("bamahacks2"), []);
    const url = new URL(g.calls[1]!.url);
    assert.equal(url.pathname, "/v23.0/200/stories");
    assert.equal(url.searchParams.get("fields"), "id,media_type,media_url,thumbnail_url,permalink,timestamp");
    assert.equal(url.searchParams.get("access_token"), "seller-tok");
  });
});

describe("instagram conversations and messages", () => {
  it("lists conversations with platform=instagram and an optional user_id, then reads messages", async () => {
    const g = fakeGraph({
      "/100/conversations": { data: [{ id: "c1" }] },
      "/c1": { id: "c1", messages: { data: [{ id: "m1", created_time: 1792245600 }] } },
      "/m1": { id: "m1", created_time: "2026-10-17T15:00:00+0000", from: { id: "igsid-2", username: "bamahacks2" }, to: { data: [{ id: "100", username: "bamahacks" }] } },
    });
    const platform = instagramGraph({ token: "tok", userId: "100", host: "https://graph.test/v23.0", fetch: g.fetch });
    assert.deepEqual(await platform.conversations("igsid-2"), [{ id: "c1" }]);
    assert.deepEqual(await platform.messages("c1"), [{ id: "m1", created_time: new Date(1792245600 * 1000).toISOString() }]);
    const m = await platform.message("m1");
    assert.equal(m.created_time, "2026-10-17T15:00:00.000Z");
    assert.equal(m.from.id, "igsid-2");
    assert.deepEqual(m.to.map((t) => t.username), ["bamahacks"]);

    const conv = new URL(g.calls[0]!.url);
    assert.equal(conv.pathname, "/v23.0/100/conversations");
    assert.equal(conv.searchParams.get("platform"), "instagram");
    assert.equal(conv.searchParams.get("user_id"), "igsid-2");
    assert.equal(new URL(g.calls[1]!.url).searchParams.get("fields"), "messages");
    assert.equal(new URL(g.calls[2]!.url).searchParams.get("fields"), "id,created_time,from,to");
  });

  it("sends a DM as JSON to /{our-id}/messages with a Bearer token", async () => {
    const g = fakeGraph({ "/100/messages": { recipient_id: "igsid-2", message_id: "mid.1" } });
    const platform = instagramGraph({ token: "tok", userId: "100", host: "https://graph.test/v23.0", fetch: g.fetch });
    assert.deepEqual(await platform.sendMessage("igsid-2", "hi there"), { message_id: "mid.1" });
    const call = g.calls[0]!;
    assert.equal(call.url, "https://graph.test/v23.0/100/messages");
    assert.equal(call.method, "POST");
    assert.equal(call.headers["authorization"], "Bearer tok");
    assert.equal(call.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(call.body), { recipient: { id: "igsid-2" }, message: { text: "hi there" } });
  });

  it("reads Graph times in either format", () => {
    assert.equal(graphTime("2026-10-17T15:00:00+0000"), "2026-10-17T15:00:00.000Z");
    assert.equal(graphTime(0), "1970-01-01T00:00:00.000Z");
    assert.equal(graphTime("1792245600"), new Date(1792245600 * 1000).toISOString());
    assert.equal(graphTime(undefined), null);
  });
});

describe("DM window", () => {
  it("is open for 24 h after the seller's last message", () => {
    const last = new Date(NOW - 23 * HOUR).toISOString();
    assert.deepEqual(dmWindow(last, NOW), { open: true, last_inbound_at: last, expires_at: new Date(NOW + HOUR).toISOString() });
    assert.equal(dmWindow(new Date(NOW - 24 * HOUR).toISOString(), NOW).open, false);
    assert.deepEqual(dmWindow(null, NOW), { open: false, last_inbound_at: null, expires_at: null });
  });

  it("DM text drops the leading @handle", () => {
    assert.equal(asDm(offerReply({ handle: "bamahacks2", offerCents: 5500, courseCode: "CH 101", url: "http://x/claim/abc" })),
      "A CH 101 student offered $55! Claim your listing with your UA email to accept and get paid: http://x/claim/abc");
    assert.match(asDm(listedReply({ handle: "bamahacks2", title: "Chem", priceCents: 6000, courseCodes: [], notified: 0, appName: "Bama" })), /^We listed your Chem/);
  });

  /** Our conversation list: the seller's (newest message ours, then theirs) and someone else's. */
  const inbox = (sellerAt: string) => ({
    "/me": platformMe,
    "/100/conversations": (url: URL) => json({ data: url.searchParams.get("user_id") === "igsid-2" ? [{ id: "c-seller" }] : [{ id: "c-other" }, { id: "c-seller" }] }),
    "/c-other": { messages: { data: [{ id: "o1", created_time: "2026-10-17T17:00:00+0000" }] } },
    "/o1": { id: "o1", created_time: "2026-10-17T17:00:00+0000", from: { id: "igsid-9", username: "stranger" }, to: { data: [{ id: "100", username: "bamahacks" }] } },
    "/c-seller": { messages: { data: [{ id: "s2", created_time: "2026-10-17T17:30:00+0000" }, { id: "s1", created_time: sellerAt }] } },
    "/s2": { id: "s2", created_time: "2026-10-17T17:30:00+0000", from: { id: "100", username: "bamahacks" }, to: { data: [{ id: "igsid-2", username: "bamahacks2" }] } },
    "/s1": { id: "s1", created_time: sellerAt, from: { id: "igsid-2", username: "bamahacks2" }, to: { data: [{ id: "100", username: "bamahacks" }] } },
    "/100/messages": { recipient_id: "igsid-2", message_id: "mid.1" },
  });

  it("finds the seller's IGSID and their last message, then sends while it's open", async () => {
    const g = fakeGraph(inbox("2026-10-17T10:00:00+0000"));
    const dms = sellerDms({ platform: instagramGraph({ token: "tok", host: "https://graph.test/v23.0", fetch: g.fetch }), sellerUsername: async () => "bamahacks2", now: () => NOW });
    const w = await dms.refresh();
    assert.equal(w.open, true);
    assert.equal(w.seller_igsid, "igsid-2");
    assert.equal(w.last_inbound_at, "2026-10-17T10:00:00.000Z"); // our own later message doesn't count
    assert.equal(w.expires_at, "2026-10-18T10:00:00.000Z");
    assert.deepEqual(await dms.send("hello"), { message_id: "mid.1" });
    const sent = g.calls.at(-1)!;
    assert.deepEqual(JSON.parse(sent.body), { recipient: { id: "igsid-2" }, message: { text: "hello" } });
  });

  it("refuses to send when the window is closed, and says to ask the seller to DM first", async () => {
    const g = fakeGraph(inbox("2026-10-16T17:00:00+0000")); // 25 h ago
    const dms = sellerDms({ platform: instagramGraph({ token: "tok", host: "https://graph.test/v23.0", fetch: g.fetch }), sellerUsername: async () => "bamahacks2", sellerIgsid: "igsid-2", now: () => NOW });
    await assert.rejects(dms.send("hello"), (err: unknown) => err instanceof DmWindowClosedError && /Ask @bamahacks2 to DM us first/.test(err.message));
    assert.ok(!g.calls.some((c) => c.method === "POST"), "never tries to send");
    assert.equal(new URL(g.calls.find((c) => c.url.includes("/conversations"))!.url).searchParams.get("user_id"), "igsid-2");
    assert.equal(dms.window().seller_igsid, "igsid-2");
  });

  it("with no conversation at all, the window is closed and nothing is sent", async () => {
    const g = fakeGraph({ "/me": platformMe, "/100/conversations": { data: [] } });
    const dms = sellerDms({ platform: instagramGraph({ token: "tok", host: "https://graph.test/v23.0", fetch: g.fetch }), sellerUsername: async () => "bamahacks2", now: () => NOW });
    await assert.rejects(dms.send("hello"), /No DM conversation with @bamahacks2 yet/);
    assert.deepEqual({ open: dms.window().open, seller_igsid: dms.window().seller_igsid }, { open: false, seller_igsid: null });
  });

  it("closes once 24 h pass, without another lookup", async () => {
    let now = NOW;
    const g = fakeGraph(inbox("2026-10-17T10:00:00+0000"));
    const dms = sellerDms({ platform: instagramGraph({ token: "tok", host: "https://graph.test/v23.0", fetch: g.fetch }), sellerUsername: async () => "bamahacks2", now: () => now });
    await dms.refresh();
    now = Date.parse("2026-10-18T10:00:01Z");
    const calls = g.calls.length;
    assert.equal(dms.window().open, false);
    assert.equal(g.calls.length, calls);
  });

  it("an Instagram window error on send counts as closed", async () => {
    const g = fakeGraph({ ...inbox("2026-10-17T10:00:00+0000"), "/100/messages": () => json({ error: { message: "outside of allowed window", code: 10 } }, 400) });
    const dms = sellerDms({ platform: instagramGraph({ token: "tok", host: "https://graph.test/v23.0", fetch: g.fetch }), sellerUsername: async () => "bamahacks2", now: () => NOW });
    await assert.rejects(dms.send("hello"), DmWindowClosedError);
    assert.equal(dms.window().open, false);
  });

  it("a failed lookup is reported, not thrown", async () => {
    const g = fakeGraph({ "/me": () => json({ error: { message: "Invalid OAuth access token", code: 190 } }, 400) });
    const dms = sellerDms({ platform: instagramGraph({ token: "tok", host: "https://graph.test/v23.0", fetch: g.fetch }), sellerUsername: async () => "bamahacks2", now: () => NOW });
    const w = await dms.refresh();
    assert.equal(w.open, false);
    assert.match(w.last_error ?? "", /Invalid OAuth access token/);
  });
});
