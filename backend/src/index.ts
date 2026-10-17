import { serve } from "@hono/node-server";
import { buildServer } from "./server.js";

const { app, config, startWorkers, summary } = buildServer();

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port}/api/v1 (${summary})`);
  startWorkers();
});
