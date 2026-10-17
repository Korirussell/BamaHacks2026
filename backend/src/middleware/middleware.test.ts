import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { createApp } from "../app.js";
import { ApiError, errorResponse } from "../lib/errors.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "./auth.js";
import { idempotent, memoryIdempotencyStore } from "./idempotency.js";

const SCHOOL = "00000000-0000-4000-a000-000000000001";
const USER = "11111111-1111-4111-8111-111111111111";

const fakeVerify: TokenVerifier = async (token) =>
  token === "good" ? { sub: USER, email: "u@crimson.ua.edu", schoolId: SCHOOL }
  : token === "no-school" ? { sub: USER, email: "u@gmail.com", schoolId: null }
  : null;

function withErrors<E extends AuthEnv>(app: Hono<E>) {
  app.onError((err, c) => (err instanceof ApiError ? errorResponse(c, err) : c.json({ error: { code: "INTERNAL" } }, 500)));
  return app;
}

test("GET /me needs a valid token with a school", async () => {
  const app = createApp({ verify: fakeVerify, log: false });
  const codeOf = async (headers: Record<string, string>) => {
    const res = await app.request("/api/v1/me", { headers });
    return [res.status, ((await res.json()) as { error: { code: string } }).error.code];
  };
  assert.deepEqual(await codeOf({}), [401, "UNAUTHENTICATED"]);
  assert.deepEqual(await codeOf({ Authorization: "Bearer nope" }), [401, "UNAUTHENTICATED"]);
  assert.deepEqual(await codeOf({ Authorization: "Basic good" }), [401, "UNAUTHENTICATED"]);
  assert.deepEqual(await codeOf({ Authorization: "Bearer no-school" }), [403, "SCHOOL_NOT_SUPPORTED"]);
  const health = await app.request("/api/v1/health");
  assert.equal(health.status, 200, "public routes stay public");
});

test("requireUser exposes the user to handlers", async () => {
  const app = withErrors(new Hono<AuthEnv>().use(requireUser(fakeVerify)).get("/", (c) => c.json(c.var.user)));
  const res = await app.request("/", { headers: { Authorization: "Bearer good" } });
  assert.deepEqual(await res.json(), { id: USER, schoolId: SCHOOL, email: "u@crimson.ua.edu", accessToken: "good" });
});

test("idempotency: replays success, rejects reuse with another body, frees key on failure", async () => {
  let runs = 0;
  const app = withErrors(
    new Hono<AuthEnv>()
      .use(requireUser(fakeVerify))
      .use(idempotent(memoryIdempotencyStore()))
      .post("/pay", async (c) => {
        runs++;
        const body = (await c.req.json()) as { amount: number }; // body still readable after the middleware hashed it
        if (body.amount < 0) throw new ApiError(400, "VALIDATION", "negative");
        return c.json({ data: { run: runs, amount: body.amount } }, 201);
      }),
  );
  const post = (key: string | null, amount: number) =>
    app.request("/pay", {
      method: "POST",
      headers: { Authorization: "Bearer good", "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
      body: JSON.stringify({ amount }),
    });

  assert.equal((await post(null, 5)).status, 400);

  const first = await post("k1", 5);
  assert.equal(first.status, 201);
  const replay = await post("k1", 5);
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get("Idempotent-Replayed"), "true");
  assert.deepEqual(await replay.json(), { data: { run: 1, amount: 5 } });
  assert.equal(runs, 1);

  assert.equal((await post("k1", 6)).status, 422);

  assert.equal((await post("k2", -1)).status, 400);
  assert.equal((await post("k2", 7)).status, 201, "a failed request doesn't burn the key");
  assert.equal(runs, 3);
});

test("idempotency: a concurrent duplicate gets 409 while the first is running", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const app = withErrors(
    new Hono<AuthEnv>()
      .use(requireUser(fakeVerify))
      .use(idempotent(memoryIdempotencyStore()))
      .post("/slow", async (c) => {
        await gate;
        return c.json({ data: { ok: true } });
      }),
  );
  const req = () => app.request("/slow", { method: "POST", headers: { Authorization: "Bearer good", "Idempotency-Key": "same" }, body: "{}" });
  const first = req();
  const second = await req();
  assert.equal(second.status, 409);
  release();
  assert.equal((await first).status, 200);
});
