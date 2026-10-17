import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import { broadcast } from "../lib/realtime.js";
import { LocationReq, NoShowReq, TapReq } from "../schemas/handoffs.js";
import type { TokenVerifier } from "../middleware/auth.js";

const ID = "11111111-1111-4111-8111-111111111111";

test("tap, no-show and location require a token", async () => {
  const verify: TokenVerifier = async () => null;
  const app = createApp({ verify, log: false });
  for (const path of ["tap", "no-show", "location"]) {
    const res = await app.request(`/api/v1/handoffs/${ID}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 401, path);
  }
});

test("request schemas validate ranges", () => {
  const ok = { location: { lat: 33.2, lng: -87.5 }, accuracy_m: 13 };
  assert.equal(LocationReq.safeParse(ok).success, true);
  assert.equal(TapReq.safeParse({ ...ok, item_ok: true }).success, true);
  assert.equal(TapReq.safeParse(ok).success, true); // item_ok is enforced per role in the route
  assert.equal(NoShowReq.safeParse(ok).success, true);
  assert.equal(LocationReq.safeParse({ ...ok, accuracy_m: -1 }).success, false);
  assert.equal(LocationReq.safeParse({ ...ok, accuracy_m: 5001 }).success, false);
  assert.equal(LocationReq.safeParse({ ...ok, location: { lat: 91, lng: 0 } }).success, false);
  assert.equal(LocationReq.safeParse({ ...ok, location: { lat: 0, lng: 181 } }).success, false);
});

test("broadcast is a silent no-op without Supabase env and never throws", async () => {
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    await broadcast("handoff:x", "handoff.updated", {});
    process.env.SUPABASE_URL = "http://127.0.0.1:1"; // unreachable: must log, not throw
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    await broadcast("handoff:x", "handoff.updated", {});
  } finally {
    if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  }
});
