import { serve } from "@hono/node-server";
import { demoRoomBooker, manualRoomBooker } from "./adapters/stubs.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const rooms = config.ROOM_BOOKER === "demo" ? demoRoomBooker("Gorgas Library") : manualRoomBooker(config.ROOM_BOOKING_URL);
const app = createApp({
  webOrigin: config.WEB_ORIGIN,
  rooms,
  payments: config.PAYMENTS,
  feeBps: config.PLATFORM_FEE_BPS,
  appName: config.APP_NAME,
});

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port}/api/v1 (rooms: ${config.ROOM_BOOKER}, payments: ${config.PAYMENTS})`);
});
