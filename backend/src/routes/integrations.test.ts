import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { ApiError, errorResponse } from "../lib/errors.js";
import type { TokenVerifier } from "../middleware/auth.js";
import { integrationsRoutes } from "./integrations.js";

process.env["TOKEN_ENCRYPTION_KEY"] = "test-key-test-key-test-key-test-key-1234";
process.env["WEB_ORIGIN"] = "http://localhost:3000";

const verify: TokenVerifier = async () => null;
const app = new Hono()
  .route("/integrations/google", integrationsRoutes(verify))
  .onError((err, c) => (err instanceof ApiError ? errorResponse(c, err) : c.json({ error: "internal" }, 500)));

test("connect and disconnect require a bearer token", async () => {
  assert.equal((await app.request("/integrations/google/connect", { method: "POST" })).status, 401);
  assert.equal((await app.request("/integrations/google", { method: "DELETE" })).status, 401);
});

test("callback with bad state redirects to the error page", async () => {
  for (const qs of ["?code=abc&state=garbage", "?error=access_denied", ""]) {
    const res = await app.request(`/integrations/google/callback${qs}`);
    assert.equal(res.status, 302, qs);
    assert.match(res.headers.get("location") ?? "", /\/settings\?google=error$/);
  }
});
