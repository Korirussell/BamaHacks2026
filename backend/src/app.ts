import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ApiError, errorResponse } from "./lib/errors.js";
import { supabaseVerifier, type TokenVerifier } from "./middleware/auth.js";
import { auth } from "./routes/auth.js";
import { academicsRoutes } from "./routes/academics.js";
import { meRoutes } from "./routes/me.js";
import { scheduleRoutes } from "./routes/schedule.js";

export interface AppDeps {
  verify: TokenVerifier;
  webOrigin: string;
  log: boolean;
}

/** Builds the app. Tests pass fakes; index.ts passes the real Supabase pieces. */
export function createApp(deps: Partial<AppDeps> = {}) {
  const { verify = supabaseVerifier, webOrigin = "http://localhost:3000", log = true } = deps;

  const api = new Hono()
    .get("/health", (c) => c.json({ data: { ok: true } }))
    .route("/auth", auth)
    .route("/me", meRoutes(verify))
    .route("/", academicsRoutes(verify))
    .route("/", scheduleRoutes(verify));

  const app = new Hono();
  if (log) app.use(logger());
  app.use("/api/*", cors({ origin: webOrigin }));
  app.route("/api/v1", api);

  app.notFound((c) => errorResponse(c, new ApiError(404, "NOT_FOUND", "Route not found")));
  app.onError((err, c) => {
    if (err instanceof ApiError) return errorResponse(c, err);
    console.error(err);
    return c.json({ error: { code: "INTERNAL", message: "Internal server error" } }, 500);
  });
  return app;
}
