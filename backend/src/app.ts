import { Hono } from "hono";
import { cors } from "hono/cors";
import { allowOrigin, primaryOrigin } from "./lib/origins.js";
import { logger } from "hono/logger";
import { ApiError, errorResponse } from "./lib/errors.js";
import { supabaseVerifier, type TokenVerifier } from "./middleware/auth.js";
import { integrationsRoutes } from "./routes/integrations.js";
import { jobsRoutes } from "./routes/jobs.js";
import { scheduleImportRoutes } from "./routes/schedule-import.js";
import { transcriptRoutes } from "./routes/transcripts.js";
import { authRoutes, supabaseSchoolLookup, type SchoolLookup } from "./routes/auth.js";
import { academicsRoutes } from "./routes/academics.js";
import { mediaRoutes } from "./routes/media.js";
import { meRoutes } from "./routes/me.js";
import { scheduleRoutes } from "./routes/schedule.js";
import { tutoringRoutes, type TutoringPayments } from "./routes/tutoring.js";
import { adminRoutes } from "./routes/admin.js";
import { claimsRoutes } from "./routes/claims.js";
import { demoRoutes } from "./routes/demo.js";
import { listingsRoutes } from "./routes/listings.js";
import { notificationsRoutes } from "./routes/notifications.js";
import { offersRoutes } from "./routes/offers.js";
import { ordersRoutes, type PaymentsMode } from "./routes/orders.js";
import { stripeWebhookRoutes, type StripeWebhookDeps } from "./routes/stripe-webhook.js";
import type { RoomAvailability, RoomBooker, TextbookIdentifier } from "./adapters/ports.js";
import { captionTextbookIdentifier, manualRoomBooker, noRoomAvailability } from "./adapters/stubs.js";
import { libraryRoutes } from "./routes/library.js";
import type { MarketConfig } from "./db/market-actions.js";
import { supabaseIdempotencyStore, type IdempotencyStore } from "./middleware/idempotency.js";
import { handoffRoutes } from "./routes/handoffs.js";
import { shipmentRoutes } from "./routes/shipments.js";
import { reviewsRoutes } from "./routes/reviews.js";
import { paymentsRoutes } from "./routes/payments.js";
import { socialRoutes } from "./routes/social.js";
import { usersRoutes } from "./routes/users.js";
import { wishlistRoutes } from "./routes/wishlist.js";
import { eventsRoutes } from "./routes/events.js";
import { ridesRoutes } from "./routes/rides.js";
import { syllabiRoutes } from "./routes/syllabi.js";
import { studyGroupsRoutes } from "./routes/study-groups.js";
import { bargainRoutes } from "./routes/bargain.js";
import { reportsRoutes } from "./routes/reports.js";
import { pushRoutes } from "./routes/push.js";
import { tutoringRequestRoutes } from "./routes/tutoring-requests.js";
import { ingestedPostsRoutes } from "./routes/ingested-posts.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { internalRoutes } from "./routes/internal.js";
import type { TickResult } from "./workers/order-timers.js";
import type { InstagramPoller } from "./workers/instagram-poller.js";

export interface AppDeps {
  verify: TokenVerifier;
  findSchool: SchoolLookup;
  rooms: RoomBooker;
  /** Live library study-room availability (LibCal); tests default to none. */
  roomAvailability: RoomAvailability;
  identifier: TextbookIdentifier;
  instagram: InstagramPoller | null;
  idempotency: IdempotencyStore;
  payments: PaymentsMode;
  /** Stripe webhook collaborators; tests inject fakes. */
  stripeWebhooks: Partial<StripeWebhookDeps>;
  /** Tutoring payment collaborators (session loader, escrow store); tests inject fakes. */
  tutoringPayments: Partial<Pick<TutoringPayments, "escrow" | "loadSession">>;
  feeBps: number;
  appName: string;
  webOrigin: string;
  /** GroupMe bot callback: shared secret (null rejects all) and the school its groups belong to. */
  groupme: { secret: string | null; schoolId: string };
  /** POST|GET /internal/sweep: CRON_SECRET (null rejects all) and one pass of the order timers. */
  sweep: { secret: string | null; run: () => Promise<TickResult> };
  instagramWebhookToken: string | null;
  /** DEMO_AUTH=on: /demo/login and /claims/{token}/demo hand out sessions with no sign-in. */
  demoAuth: boolean;
  log: boolean;
}

/** Builds the app. Tests pass fakes; index.ts passes the real Supabase pieces. */
export function createApp(deps: Partial<AppDeps> = {}) {
  const {
    verify = supabaseVerifier,
    findSchool = supabaseSchoolLookup,
    rooms = manualRoomBooker("https://www.lib.ua.edu/"),
    roomAvailability = noRoomAvailability,
    identifier = captionTextbookIdentifier,
    instagram = null,
    idempotency = supabaseIdempotencyStore(),
    payments = "demo",
    stripeWebhooks = {},
    tutoringPayments = {},
    feeBps = 500,
    appName = "Campus Marketplace",
    webOrigin = "http://localhost:3000",
    groupme = { secret: null, schoolId: "00000000-0000-4000-a000-000000000001" },
    sweep = { secret: null, run: async () => { throw new Error("sweep not wired"); } },
    instagramWebhookToken = null,
    demoAuth = false,
    log = true,
  } = deps;

  // WEB_ORIGIN may list several origins (comma-separated, e.g. localhost and the Vercel deploy); the first is the app URL in links.
  const market: MarketConfig = { feeBps, appUrl: primaryOrigin(webOrigin), appName, ...(instagram ? { outreach: instagram.outreach } : {}) };

  const api = new Hono()
    .get("/health", (c) => c.json({ data: { ok: true } }))
    .route("/auth", authRoutes(findSchool))
    .route("/me", meRoutes(verify))
    .route("/integrations/google", integrationsRoutes(verify))
    .route("/", academicsRoutes(verify))
    .route("/", mediaRoutes(verify))
    .route("/", scheduleRoutes(verify))
    .route("/", scheduleImportRoutes(verify))
    .route("/", transcriptRoutes(verify))
    .route("/", jobsRoutes(verify))
    .route("/", tutoringRoutes(verify, rooms, roomAvailability, { idempotency, mode: payments, feeBps, ...tutoringPayments }))
    .route("/", libraryRoutes(verify, roomAvailability))
    .route("/admin", adminRoutes(verify, identifier, instagram))
    .route("/claims", claimsRoutes(verify, demoAuth))
    .route("/", listingsRoutes(verify, identifier))
    .route("/", offersRoutes(verify, market))
    .route("/", bargainRoutes(verify, market))
    .route("/", reportsRoutes(verify))
    .route("/", pushRoutes(verify))
    .route("/", tutoringRequestRoutes(verify))
    .route("/", ingestedPostsRoutes(verify))
    .route("/internal", internalRoutes({ cronSecret: sweep.secret, sweep: sweep.run }))
    .route("/webhooks", webhookRoutes({ identifier, groupmeSecret: groupme.secret, groupmeSchoolId: groupme.schoolId, instagramVerifyToken: instagramWebhookToken }))
    .route("/", ordersRoutes(verify, idempotency, payments))
    .route("/", stripeWebhookRoutes(stripeWebhooks))
    .route("/", handoffRoutes(verify, idempotency))
    .route("/", shipmentRoutes(verify, idempotency))
    .route("/", reviewsRoutes(verify))
    .route("/", paymentsRoutes(verify))
    .route("/", usersRoutes(verify))
    .route("/", socialRoutes(verify))
    .route("/", wishlistRoutes(verify))
    .route("/", eventsRoutes(verify, idempotency))
    .route("/", ridesRoutes(verify, idempotency, payments))
    .route("/", syllabiRoutes(verify))
    .route("/", studyGroupsRoutes(verify))
    .route("/", notificationsRoutes(verify));

  if (demoAuth) api.route("/demo", demoRoutes());

  const app = new Hono();
  if (log) app.use(logger());
  app.use("/api/*", cors({ origin: allowOrigin(webOrigin) }));
  app.route("/api/v1", api);

  app.notFound((c) => errorResponse(c, new ApiError(404, "NOT_FOUND", "Route not found")));
  app.onError((err, c) => {
    if (err instanceof ApiError) return errorResponse(c, err);
    console.error(err);
    return c.json({ error: { code: "INTERNAL", message: "Internal server error" } }, 500);
  });
  return app;
}
