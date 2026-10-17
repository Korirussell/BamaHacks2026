import { claudeTextbookIdentifier } from "./adapters/claude-vision.js";
import { instagramGraph } from "./adapters/instagram.js";
import { libcalAvailability } from "./adapters/libcal.js";
import { libcalPlaywrightBooker } from "./adapters/libcal-booker.js";
import { captionTextbookIdentifier, demoRoomBooker, manualRoomBooker, noRoomAvailability } from "./adapters/stubs.js";
import { createApp } from "./app.js";
import { assertPaymentsConfig, loadConfig, type Config } from "./config.js";
import { sweepOverdueHandoffs } from "./db/handoff-actions.js";
import { stripeClient } from "./lib/stripe.js";
import { setPaymentProvider } from "./services/escrow.js";
import { stripeProvider } from "./services/stripe-provider.js";
import { orderTimers } from "./workers/order-timers.js";
import { instagramPoller } from "./workers/instagram-poller.js";
import { instagramStoriesPoller } from "./workers/instagram-stories.js";

// Builds the API from env config. index.ts serves it locally (and starts the pollers/timers);
// api/index.js runs it as a Vercel function, where nothing long-running can live.
export function buildServer(config: Config = loadConfig()) {
  assertPaymentsConfig(config);
  if (config.PAYMENTS === "stripe") setPaymentProvider(stripeProvider(stripeClient()));
  const manualRooms = manualRoomBooker(config.ROOM_BOOKING_URL);
  const rooms = config.ROOM_BOOKER === "demo"
    ? demoRoomBooker("Gorgas Library")
    : config.ROOM_BOOKER === "playwright"
      ? libcalPlaywrightBooker({ profileDir: config.LIBCAL_PROFILE_DIR, cdpUrl: config.LIBCAL_CDP_URL || undefined, headless: config.LIBCAL_HEADLESS === "on", fallback: manualRooms })
      : manualRooms;

  const useClaude = config.IDENTIFIER === "claude" || (config.IDENTIFIER === "auto" && !!config.ANTHROPIC_API_KEY);
  if (useClaude && !config.ANTHROPIC_API_KEY) throw new Error("IDENTIFIER=claude needs ANTHROPIC_API_KEY");
  const identifier = useClaude && config.ANTHROPIC_API_KEY
    ? claudeTextbookIdentifier({ apiKey: config.ANTHROPIC_API_KEY, model: config.CLAUDE_VISION_MODEL, fallback: captionTextbookIdentifier })
    : captionTextbookIdentifier;

  if (config.INSTAGRAM === "graph" && !config.INSTAGRAM_ACCESS_TOKEN) throw new Error("INSTAGRAM=graph needs INSTAGRAM_ACCESS_TOKEN");
  const instagram = config.INSTAGRAM === "graph" && config.INSTAGRAM_ACCESS_TOKEN
    ? instagramPoller({
      graph: instagramGraph({ token: config.INSTAGRAM_ACCESS_TOKEN, userId: config.INSTAGRAM_USER_ID, host: config.INSTAGRAM_GRAPH_URL }),
      identifier,
      schoolId: config.INSTAGRAM_SCHOOL_ID,
      appName: config.APP_NAME,
      autoReply: config.INSTAGRAM_AUTO_REPLY === "on",
      intervalMs: config.INSTAGRAM_POLL_SECONDS * 1000,
    })
    : null;

  const timers = config.ORDER_TIMERS === "on" ? orderTimers({
    intervalMs: config.ORDER_TIMERS_INTERVAL_MS,
    // Meetups past their time: one side never showed → no-show + refund; nobody showed → reschedule.
    extraTasks: [{ name: "handoffs", run: (now) => sweepOverdueHandoffs(now) }],
  }) : null;
  if (config.INSTAGRAM === "stories" && (!config.INSTAGRAM_ACCESS_TOKEN || !config.INSTAGRAM_SELLER_TOKEN)) {
    throw new Error("INSTAGRAM=stories needs INSTAGRAM_ACCESS_TOKEN (our account) and INSTAGRAM_SELLER_TOKEN (the seller account)");
  }
  const stories = config.INSTAGRAM === "stories" && config.INSTAGRAM_ACCESS_TOKEN && config.INSTAGRAM_SELLER_TOKEN
    ? instagramStoriesPoller({
      platform: instagramGraph({ token: config.INSTAGRAM_ACCESS_TOKEN, userId: config.INSTAGRAM_USER_ID, host: config.INSTAGRAM_GRAPH_URL }),
      seller: instagramGraph({ token: config.INSTAGRAM_SELLER_TOKEN, host: config.INSTAGRAM_GRAPH_URL }),
      sellerUsername: config.INSTAGRAM_SELLER_USERNAME,
      sellerIgsid: config.INSTAGRAM_SELLER_IGSID,
      identifier,
      schoolId: config.INSTAGRAM_SCHOOL_ID,
      appName: config.APP_NAME,
      autoDm: config.INSTAGRAM_AUTO_REPLY === "on",
      intervalMs: config.INSTAGRAM_POLL_SECONDS * 1000,
    })
    : null;

  const app = createApp({
    webOrigin: config.WEB_ORIGIN,
    rooms,
    roomAvailability: config.LIBCAL === "on" ? libcalAvailability() : noRoomAvailability,
    identifier,
    instagram: instagram ?? stories,
    payments: config.PAYMENTS,
    feeBps: config.PLATFORM_FEE_BPS,
    appName: config.APP_NAME,
    groupme: { secret: config.GROUPME_WEBHOOK_SECRET || null, schoolId: config.GROUPME_SCHOOL_ID },
    instagramWebhookToken: config.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || null,
  });

  const startWorkers = () => {
    (instagram ?? stories)?.start();
    timers?.start();
  };
  const summary = `rooms: ${config.ROOM_BOOKER}, libcal: ${config.LIBCAL}, payments: ${config.PAYMENTS}, identifier: ${useClaude ? "claude" : "caption"}, instagram: ${config.INSTAGRAM}, timers: ${config.ORDER_TIMERS}`;
  return { app, config, startWorkers, summary };
}
