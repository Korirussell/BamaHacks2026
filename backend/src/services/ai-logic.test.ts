import assert from "node:assert/strict";
import test from "node:test";
import { jevDecider, type AiQueue } from "../adapters/local-ai.js";
import type { TextbookGuess } from "../adapters/ports.js";
import { toDecisions, toWire } from "./decisions.js";
import { haggleQuestions, parseAmountCents, planHaggle, readTriage, ruleIntent, ruleScamFlags } from "./haggle.js";
import { gateQuestions, gateVerdict } from "./listing-gate.js";
import { draftFromScreenshot, pickPrice } from "./listing-draft.js";
import { semanticCandidates, type Candidate, type WishItem } from "./wishlist.js";

const fakeQueue = (answer: (payload: Record<string, unknown>) => unknown): AiQueue => ({
  run: async (_kind, payload) => answer(payload),
  status: async () => ({ online: true, kinds: ["jev_decide"], models: {}, last_seen_at: null }),
});

test("noul and score questions get JEV's fixed options; choice keeps its own", () => {
  assert.deepEqual(toWire({ key: "a", kind: "noul", question: "?" }).options, ["false", "true"]);
  assert.equal(toWire({ key: "b", kind: "score", question: "?" }).options.length, 6);
  assert.throws(() => toWire({ key: "c", kind: "choice", question: "?", options: ["only"] }));
});

test("raw probabilities become picks: noul value is P(true), score value is the expected level", () => {
  const wire = [toWire({ key: "scam", kind: "noul", question: "?" }), toWire({ key: "s", kind: "score", question: "?" }), toWire({ key: "c", kind: "choice", question: "?", options: ["x", "y"] })];
  const d = toDecisions(wire, { scam: [0.2, 0.8], s: [0, 0, 0, 0, 1, 0], c: [0.3, 0.7], junk: [1] });
  assert.equal(d.scam!.pick, "true");
  assert.equal(d.scam!.value, 0.8);
  assert.equal(d.s!.value, 4);
  assert.equal(d.c!.pick, "y");
});

test("a malformed answer drops just that question", () => {
  const wire = [toWire({ key: "a", kind: "noul", question: "?" })];
  assert.deepEqual(toDecisions(wire, { a: [0.5] }), {});
});

test("jevDecider sends wire questions and returns null when the worker doesn't answer", async () => {
  let sent: Record<string, unknown> | null = null;
  const d = await jevDecider(fakeQueue((p) => { sent = p; return { answers: { off: [0.1, 0.9] } }; })).decide("state", [{ key: "off", kind: "noul", question: "?" }]);
  assert.equal(d!.off!.value, 0.9);
  assert.deepEqual((sent!.questions as { options: string[] }[])[0]!.options, ["false", "true"]);
  assert.equal(await jevDecider(fakeQueue(() => null)).decide("s", [{ key: "x", kind: "noul", question: "?" }]), null);
});

test("prices are pulled out of chat messages", () => {
  assert.equal(parseAmountCents("would u do $40 if i grab it today"), 4000);
  assert.equal(parseAmountCents("can you take 35?"), 3500);
  assert.equal(parseAmountCents("25 bucks"), 2500);
  assert.equal(parseAmountCents("is it still available"), null);
});

const base = { askCents: 6000, floorCents: 4000, negotiable: true, lastCounterCents: null, seriousness: 3, lowball: false, scamFlags: [] as string[] };

test("an offer at or above the standing price is accepted at the standing price", () => {
  const p = planHaggle({ ...base, intent: "offer", amountCents: 7000 });
  assert.equal(p.action, "accept");
  assert.equal(p.priceCents, 6000);
});

test("a serious offer above the floor is accepted", () => {
  const p = planHaggle({ ...base, intent: "offer", amountCents: 4500 });
  assert.equal(p.action, "accept");
  assert.equal(p.priceCents, 4500);
});

test("a lowball gets a counter that never goes under the floor or reveals it", () => {
  const p = planHaggle({ ...base, intent: "offer", amountCents: 1000, lowball: true, seriousness: 1 });
  assert.equal(p.action, "counter");
  assert.ok(p.priceCents! >= 4000 && p.priceCents! < 6000);
  assert.notEqual(p.priceCents, 4000);
});

test("counters never go back up past the last one", () => {
  const p = planHaggle({ ...base, lastCounterCents: 5000, intent: "offer", amountCents: 3000, seriousness: 1 });
  assert.ok(p.priceCents! <= 5000);
});

test("a firm price holds", () => {
  const p = planHaggle({ ...base, negotiable: false, intent: "offer", amountCents: 5000, seriousness: 5 });
  assert.equal(p.action, "hold_firm");
  assert.equal(p.priceCents, 6000);
});

test("scam signals beat everything else", () => {
  const p = planHaggle({ ...base, intent: "offer", amountCents: 6000, scamFlags: ["off_platform_payment"] });
  assert.equal(p.action, "warn");
  assert.equal(p.priceCents, null);
});

test("without JEV the keyword rules answer the same questions", () => {
  assert.equal(ruleIntent("ok deal", null), "accept");
  assert.equal(ruleIntent("do 30?", 3000), "offer");
  assert.equal(ruleIntent("where can we meet", null), "logistics");
  assert.deepEqual(ruleScamFlags("pay me on zelle asap"), ["off_platform_payment", "urgency_pressure"]);
  const t = readTriage(null, "pay me on zelle", null);
  assert.deepEqual(t.scamFlags, ["off_platform_payment"]);
});

test("JEV's intent pick maps back to an intent", () => {
  const wire = haggleQuestions().map(toWire);
  const answers = Object.fromEntries(wire.map((q) => [q.key, q.options.map((_, i) => (i === 0 ? 0.9 : 0.1 / (q.options.length - 1)))]));
  const t = readTriage(toDecisions(wire, answers), "whatever", 3000);
  assert.equal(t.intent, "offer");
  assert.deepEqual(t.scamFlags, []); // option 0 of a noul is "false"
});

test("the listing gate blocks prohibited items and warns on price and category", () => {
  const wire = gateQuestions().map(toWire);
  const d = toDecisions(wire, {
    prohibited: [0.05, 0.95], price_unreasonable: [0.2, 0.8], misleading: [0.9, 0.1], category: [0.05, 0.05, 0.8, 0.05, 0.05],
  });
  const v = gateVerdict(d, { title: "x", description: "", category: "other", priceCents: 50000, medianCents: 8000 });
  assert.equal(v.allowed, false);
  assert.equal(v.suggested_category, "dorm");
  assert.equal(v.warnings.length, 2);
  assert.equal(gateVerdict(null, { title: "x", description: "", category: "other", priceCents: 1, medianCents: null }).allowed, true);
});

const guess: TextbookGuess = { isbn: null, title: "TI-84 Plus", authors: [], edition: null, priceCents: null, condition: "good", confidence: 0.8, category: "lab_supplies", estimatedPriceCents: 5550, priceReason: "Used TI-84s go for $50–60" };

test("auto-pricing: screenshot price, then similar listings, then Gemma's estimate", () => {
  assert.deepEqual(pickPrice({ ...guess, priceCents: 4000 }, [7000]), { cents: 4000, source: "screenshot" });
  assert.deepEqual(pickPrice(guess, [7000, 5000, 6000]), { cents: 6000, source: "comparable_listings" });
  assert.deepEqual(pickPrice(guess, []), { cents: 5600, source: "ai_estimate" });
  const draft = draftFromScreenshot(guess, [], []);
  assert.equal(draft.draft.category, "lab_supplies");
  assert.equal(draft.price_source, "ai_estimate");
  assert.equal(draft.price_reason, "Used TI-84s go for $50–60");
});

test("semantic wishlist candidates are keyword wishes the exact matcher missed, one per person", () => {
  const wish = (id: string, userId: string, extra: Partial<WishItem> = {}): WishItem => ({ id, userId, kind: "keyword", isbn: null, courseId: null, keyword: "mini fridge", category: null, maxPriceCents: null, ...extra });
  const listing: Candidate = { id: "l", sellerId: "seller", status: "active", category: "dorm", isbn: null, priceCents: 8000, courseIds: [], text: "Galanz compact refrigerator" };
  const out = semanticCandidates([wish("1", "a"), wish("2", "a"), wish("3", "b", { maxPriceCents: 5000 }), wish("4", "seller"), wish("5", "c")], listing, new Set(["c"]));
  assert.deepEqual(out.map((w) => w.id), ["1"]);
});
