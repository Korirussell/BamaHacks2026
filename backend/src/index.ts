import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ApiError, errorResponse } from "./lib/errors.js";
import { auth } from "./routes/auth.js";

const api = new Hono()
  .get("/health", (c) => c.json({ data: { ok: true } }))
  .route("/auth", auth);

const app = new Hono()
  .use(logger())
  .use("/api/*", cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" }))
  .route("/api/v1", api);

app.notFound((c) => errorResponse(c, new ApiError(404, "NOT_FOUND", "Route not found")));
app.onError((err, c) => {
  if (err instanceof ApiError) return errorResponse(c, err);
  console.error(err);
  return c.json({ error: { code: "INTERNAL", message: "Internal server error" } }, 500);
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}/api/v1`);
});
