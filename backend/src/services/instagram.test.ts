import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claudeTextbookIdentifier, visionPrompt } from "../adapters/claude-vision.js";
import { instagramGraph, parseTagged } from "../adapters/instagram.js";
import { captionTextbookIdentifier } from "../adapters/stubs.js";
import { claimUrlIn } from "./claims.js";
import { listedReply, offerReply, toExternalPost, unseenMedia, type TaggedMedia } from "./instagram.js";

const chem = { isbn: "9780134414232", title: "Chemistry: The Central Science", edition: "14th", authors: ["Theodore L. Brown"] };
const media = (id: string, timestamp: string): TaggedMedia => ({
  id, caption: "", permalink: `https://www.instagram.com/p/${id}/`, username: "bama_books", timestamp, imageUrls: [],
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("instagram pipeline", () => {
  it("only new tagged posts are ingested, oldest first", () => {
    const fresh = unseenMedia([media("b", "2026-10-17T15:00:00Z"), media("a", "2026-10-17T14:00:00Z"), media("c", "2026-10-17T16:00:00Z")],
      new Set(["https://www.instagram.com/p/c/"]));
    assert.deepEqual(fresh.map((m) => m.id), ["a", "b"]);
    assert.equal(toExternalPost(fresh[0]!).externalUrl, "https://www.instagram.com/p/a/");
  });

  it("parses carousels, video covers, and skips media without a permalink", () => {
    const posts = parseTagged({ data: [
      { id: "1", permalink: "https://instagram.com/p/1", username: "u", caption: "hi", timestamp: "2026-10-17T15:00:00+0000",
        media_type: "CAROUSEL_ALBUM", children: { data: [{ media_type: "IMAGE", media_url: "https://cdn/1a" }, { media_type: "VIDEO", media_url: "https://cdn/v" }, { media_type: "IMAGE", media_url: "https://cdn/1b" }] } },
      { id: "2", permalink: "https://instagram.com/p/2", username: "u", media_type: "VIDEO", media_url: "https://cdn/v2", thumbnail_url: "https://cdn/t2" },
      { id: "3", username: "u", media_type: "IMAGE", media_url: "https://cdn/3" },
    ] });
    assert.deepEqual(posts.map((p) => p.imageUrls), [["https://cdn/1a", "https://cdn/1b"], ["https://cdn/t2"]]);
    assert.equal(posts[0]!.caption, "hi");
  });

  it("reads tags and replies through graph.instagram.com with the looked-up account id", async () => {
    const calls: { url: string; method: string; body: string }[] = [];
    const graph = instagramGraph({
      token: "tok", host: "https://graph.test/v23.0",
      fetch: async (url, init) => {
        calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? String(init.body) : "" });
        if (String(url).includes("/me?")) return json({ id: "app-scoped", user_id: 1784, username: "bamamarket" });
        if (String(url).includes("/tags?")) return json({ data: [] });
        return json({ id: "reply1" });
      },
    });
    assert.deepEqual(await graph.tagged(), []);
    assert.equal((await graph.replyToMention("m1", "hello there")).id, "reply1");
    assert.match(calls[1]!.url, /^https:\/\/graph\.test\/v23\.0\/1784\/tags\?fields=/);
    assert.equal(calls[2]!.url, "https://graph.test/v23.0/1784/mentions");
    assert.match(calls[2]!.body, /media_id=m1&message=hello\+there&access_token=tok/);
  });

  it("a Graph error comes back as a readable message", async () => {
    const graph = instagramGraph({ token: "t", userId: "1", fetch: async () => json({ error: { message: "Invalid OAuth access token", code: 190 } }, 400) });
    await assert.rejects(graph.tagged(), /Invalid OAuth access token/);
  });

  it("the replies say what happened, and the offer reply carries a claim link", () => {
    assert.equal(
      listedReply({ handle: "bama_books", title: "Chemistry: The Central Science", priceCents: 6000, courseCodes: ["CH 101", "CH 102"], notified: 3, appName: "Bama Market" }),
      "@bama_books We listed your Chemistry: The Central Science ($60) on Bama Market. 3 students who need it for CH 101 / CH 102 just got a heads-up. We'll reply here when someone makes an offer.",
    );
    const reply = offerReply({ handle: "bama_books", offerCents: 5500, courseCode: "CH 101", url: "http://localhost:3000/claim/abcDEF123_-xyz" });
    assert.match(reply, /A CH 101 student offered \$55!/);
    assert.equal(claimUrlIn(reply), "http://localhost:3000/claim/abcDEF123_-xyz");
  });
});

describe("claude vision identifier", () => {
  const toolReply = (input: Record<string, unknown>) => json({ content: [{ type: "tool_use", name: "record_textbook", input }] });
  const answer = { is_textbook: true, known_isbn: null, isbn: null, title: "Chem book", authors: [], edition: null, price_usd: 45, condition: "good", confidence: 0.9, evidence: "Cover title" };

  it("matches a cover photo to a required book's ISBN and sends the photo by URL", async () => {
    let sent: { model: string; tool_choice: unknown; messages: { content: { type: string }[] }[] } | undefined;
    const id = claudeTextbookIdentifier({
      apiKey: "k", model: "claude-test", fallback: captionTextbookIdentifier,
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return toolReply({ ...answer, known_isbn: "978-0-13-441423-2", evidence: "Cover says Chemistry: The Central Science, 14th edition" });
      },
    });
    const g = await id.identify({ imageUrls: ["https://x/photo.jpg"], caption: "selling my chem book, $45", knownBooks: [chem] });
    assert.equal(g.isbn, "9780134414232");
    assert.equal(g.title, chem.title);
    assert.equal(g.edition, "14th");
    assert.equal(g.priceCents, 4500);
    assert.equal(g.source, "vision");
    assert.equal(sent?.model, "claude-test");
    assert.deepEqual(sent?.tool_choice, { type: "tool", name: "record_textbook" });
    assert.deepEqual(sent?.messages[0]?.content.map((c) => c.type), ["image", "text"]);
  });

  it("drops an ISBN that fails its checksum and keeps the caption's", async () => {
    const id = claudeTextbookIdentifier({ apiKey: "k", model: "m", fallback: captionTextbookIdentifier, fetch: async () => toolReply({ ...answer, isbn: "9780134414231" }) });
    assert.equal((await id.identify({ imageUrls: [], caption: "no isbn here $45" })).isbn, null);
    assert.equal((await id.identify({ imageUrls: [], caption: "ISBN 978-0134414232 $45" })).isbn, "9780134414232");
  });

  it("falls back to the caption parser when Claude is down", async () => {
    const id = claudeTextbookIdentifier({ apiKey: "k", model: "m", fallback: captionTextbookIdentifier, fetch: async () => json({ error: "overloaded" }, 529) });
    const g = await id.identify({ imageUrls: [], caption: "ISBN 978-0134414232 $60" });
    assert.equal(g.source, "caption");
    assert.equal(g.priceCents, 6000);
  });

  it("the prompt lists the known books and the caption", () => {
    const p = visionPrompt("my caption", [chem]);
    assert.match(p, /9780134414232: Chemistry: The Central Science, 14th ed\./);
    assert.match(p, /my caption/);
  });
});
