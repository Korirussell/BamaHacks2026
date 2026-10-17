import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../app.js";

test("POST /dev/login is local-demo-only and permits Crimson users", async () => {
  const mint = async (email: string) => ({ access_token: `access-${email}`, refresh_token: "refresh", expires_at: 123, user_id: "user-1" });
  const enabled = createApp({ demoLogin: true, mintDemoLogin: mint, log: false });
  const request = (email: string) => enabled.request("/api/v1/dev/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  const allowed = await request("Bamahacks.Student@crimson.ua.edu");
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { data: { access_token: "access-bamahacks.student@crimson.ua.edu", refresh_token: "refresh", expires_at: 123, user_id: "user-1" } });
  assert.equal((await request("student@ua.edu")).status, 403);
  const disabled = createApp({ log: false });
  assert.equal((await disabled.request("/api/v1/dev/login", { method: "POST" })).status, 404);
});
