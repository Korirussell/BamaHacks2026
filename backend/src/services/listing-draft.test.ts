import assert from "node:assert/strict";
import test from "node:test";
import type { TextbookGuess } from "../adapters/ports.js";
import { draftFromScreenshot, suggestedPrice } from "./listing-draft.js";

const ch101 = "00000000-0000-4000-e000-000000000001";
const photo = "00000000-0000-4000-b000-000000000001";
const guess: TextbookGuess = {
  isbn: "978-0134414232", title: "Chemistry The Central Science", authors: ["Brown"], edition: "14th",
  priceCents: 6000, condition: "like_new", confidence: 0.9, source: "vision", evidence: "Cover and ISBN on the back",
};

test("a recognised book becomes an unpublished textbook draft with the bookstore's title and its classes", () => {
  const out = draftFromScreenshot(guess, [{ courseId: ch101, title: "Chemistry: The Central Science", authors: ["Theodore L. Brown"], edition: "14th" }], [photo]);
  assert.equal(out.draft.category, "textbook");
  assert.equal(out.draft.isbn, "9780134414232");
  assert.equal(out.draft.title, "Chemistry: The Central Science (14th ed.)");
  assert.equal(out.draft.price_cents, 6000);
  assert.equal(out.draft.condition, "like_new");
  assert.deepEqual(out.draft.course_ids, [ch101]);
  assert.deepEqual(out.draft.media_ids, [photo]);
  assert.equal(out.draft.publish, false);
  assert.deepEqual(out.missing_fields, []);
  assert.equal(out.confidence, 0.9);
});

test("a screenshot with no ISBN, price or condition says what the seller still has to fill", () => {
  const out = draftFromScreenshot({ ...guess, isbn: null, priceCents: null, condition: null, title: "Mini fridge" }, [], [photo]);
  assert.equal(out.draft.category, "other");
  assert.equal("isbn" in out.draft, false);
  assert.equal(out.draft.title, "Mini fridge");
  assert.deepEqual(out.missing_fields, ["price_cents", "condition"]);
});

test("an unreadable ISBN is flagged rather than kept", () => {
  const out = draftFromScreenshot({ ...guess, isbn: "12345" }, [], [photo]);
  assert.equal(out.draft.category, "other");
  assert.deepEqual(out.missing_fields, ["isbn"]);
});

test("suggestedPrice is the median rounded to whole dollars, null without prices", () => {
  assert.equal(suggestedPrice([]), null);
  assert.equal(suggestedPrice([4500]), 4500);
  assert.equal(suggestedPrice([4000, 9000, 5050]), 5100);
  assert.equal(suggestedPrice([4000, 5000]), 4500);
  assert.equal(suggestedPrice([0, -5]), null);
});
