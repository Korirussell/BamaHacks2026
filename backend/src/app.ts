import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ApiError, errorResponse } from "./lib/errors.js";
import { supabaseVerifier, type TokenVerifier } from "./middleware/auth.js";
import { integrationsRoutes } from "./routes/integrations.js";
import { jobsRoutes } from "./routes/jobs.js";
import { scheduleImportRoutes } from "./routes/schedule-import.js";
import { authRoutes, supabaseSchoolLookup, type SchoolLookup } from "./routes/auth.js";
import { academicsRoutes } from "./routes/academics.js";
import { mediaRoutes } from "./routes/media.js";
import { meRoutes } from "./routes/me.js";
import { scheduleRoutes } from "./routes/schedule.js";
import { tutoringRoutes } from "./routes/tutoring.js";
import { adminRoutes } from "./routes/admin.js";
import { claimsRoutes } from "./routes/claims.js";
import { listingsRoutes } from "./routes/listings.js";
import { notificationsRoutes } from "./routes/notifications.js";
import { offersRoutes } from "./routes/offers.js";
import { ordersRoutes, type PaymentsMode } from "./routes/orders.js";
import type { RoomBooker, TextbookIdentifier } from "./adapters/ports.js";
import { captionTextbookIdentifier, manualRoomBooker } from "./adapters/stubs.js";
import type { MarketConfig } from "./db/market-actions.js";
import { supabaseIdempotencyStore, type IdempotencyStore } from "./middleware/idempotency.js";

export interface AppDeps {
  verify: TokenVerifier;
  findSchool: SchoolLookup;
  rooms: RoomBooker;
  identifier: TextbookIdentifier;
  idempotency: IdempotencyStore;
  payments: PaymentsMode;
  feeBps: number;
  appName: string;
  webOrigin: string;
  log: boolean;
}

/** Builds the app. Tests pass fakes; index.ts passes the real Supabase pieces. */
export function createApp(deps: Partial<AppDeps> = {}) {
  const {
    verify = supabaseVerifier,
    findSchool = supabaseSchoolLookup,
    rooms = manualRoomBooker("https://www.lib.ua.edu/"),
    identifier = captionTextbookIdentifier,
    idempotency = supabaseIdempotencyStore(),
    payments = "demo",
    feeBps = 500,
    appName = "Campus Marketplace",
    webOrigin = "http://localhost:3000",
    log = true,
  } = deps;

  const market: MarketConfig = { feeBps, appUrl: webOrigin, appName };

  const api = new Hono()
    .get("/health", (c) => c.json({ data: { ok: true } }))
    .route("/auth", authRoutes(findSchool))
    .route("/me", meRoutes(verify))
    .route("/integrations/google", integrationsRoutes(verify))
    .route("/", academicsRoutes(verify))
    .route("/", mediaRoutes(verify))
    .route("/", scheduleRoutes(verify))
    .route("/", scheduleImportRoutes(verify))
    .route("/", jobsRoutes(verify))
    .route("/", tutoringRoutes(verify, rooms))
    .route("/admin", adminRoutes(verify, identifier))
    .route("/claims", claimsRoutes(verify))
    .route("/", listingsRoutes(verify))
    .route("/", offersRoutes(verify, market))
    .route("/", ordersRoutes(verify, idempotency, payments))
    .route("/", notificationsRoutes(verify));

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
