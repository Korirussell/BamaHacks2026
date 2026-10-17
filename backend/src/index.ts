import { serve } from "@hono/node-server";
import { claudeTextbookIdentifier } from "./adapters/claude-vision.js";
import { instagramGraph } from "./adapters/instagram.js";
import { captionTextbookIdentifier, demoRoomBooker, manualRoomBooker } from "./adapters/stubs.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { instagramPoller } from "./workers/instagram-poller.js";

const config = loadConfig();
const rooms = config.ROOM_BOOKER === "demo" ? demoRoomBooker("Gorgas Library") : manualRoomBooker(config.ROOM_BOOKING_URL);

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

const app = createApp({
  webOrigin: config.WEB_ORIGIN,
  rooms,
  identifier,
  instagram,
  payments: config.PAYMENTS,
  feeBps: config.PLATFORM_FEE_BPS,
  appName: config.APP_NAME,
});

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port}/api/v1 (rooms: ${config.ROOM_BOOKER}, payments: ${config.PAYMENTS}, identifier: ${useClaude ? "claude" : "caption"}, instagram: ${config.INSTAGRAM})`);
  instagram?.start();
});
