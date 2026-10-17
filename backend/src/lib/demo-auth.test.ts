import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import { handleEmail } from "./demo-auth.js";

process.env["SUPABASE_URL"] ??= "https://example.supabase.co";

test("a social handle signs in with a made-up address on the school's domain", () => {
  assert.equal(handleEmail("instagram", "darealkorirussell", "crimson.ua.edu"), "instagram.darealkorirussell@crimson.ua.edu");
  assert.equal(handleEmail("instagram", "Bama_Books.", "crimson.ua.edu"), "instagram.bama.books@crimson.ua.edu");
  assert.equal(handleEmail("snapchat", "__", "crimson.ua.edu"), "snapchat.seller@crimson.ua.edu");
});

test("demo sign-in and no-login claims don't exist unless DEMO_AUTH is on", async () => {
  const app = createApp({ verify: async () => null, log: false });
  const login = await app.request("/api/v1/demo/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a@crimson.ua.edu" }) });
  assert.equal(login.status, 404);
  assert.equal((await app.request("/api/v1/claims/abcdefghijklmnopqrstuvwx/demo", { method: "POST" })).status, 404);
});

test("with DEMO_AUTH on, a bad claim link is still refused before anything is created", async () => {
  const app = createApp({ verify: async () => null, demoAuth: true, log: false });
  const res = await app.request("/api/v1/claims/short/demo", { method: "POST" });
  assert.equal(res.status, 410);
  const login = await app.request("/api/v1/demo/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nope" }) });
  assert.equal(login.status, 400);
});
