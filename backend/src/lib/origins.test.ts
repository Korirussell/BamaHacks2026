import assert from "node:assert/strict";
import { test } from "node:test";
import { allowOrigin, parseOrigins, primaryOrigin } from "./origins.js";

test("parses a comma list and picks the first as the app URL", () => {
  assert.deepEqual(parseOrigins(" https://a.app/ , http://localhost:3000 "), ["https://a.app", "http://localhost:3000"]);
  assert.equal(primaryOrigin("https://a.app,http://localhost:3000"), "https://a.app");
  assert.equal(primaryOrigin(undefined), "http://localhost:3000");
});

test("allows listed origins and one-label wildcards only", () => {
  const allow = allowOrigin("http://localhost:3000,https://*.vercel.app");
  assert.equal(allow("http://localhost:3000"), "http://localhost:3000");
  assert.equal(allow("https://web-abc-team.vercel.app"), "https://web-abc-team.vercel.app");
  assert.equal(allow("https://evil.com"), null);
  assert.equal(allow("https://a.b.vercel.app"), null);
  assert.equal(allow("http://web.vercel.app"), null);
  assert.equal(allow("https://vercel.app"), null);
});
