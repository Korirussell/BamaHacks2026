import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const app = createApp({ webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000" });

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}/api/v1`);
});
