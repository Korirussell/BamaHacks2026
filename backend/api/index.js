// Vercel function: every request is rewritten here (vercel.json) and handled by the compiled
// Hono app. Timers and pollers don't run here; keep ORDER_TIMERS=off and INSTAGRAM=off on Vercel.
import { handle } from "hono/vercel";
import { buildServer } from "../dist/server.js";

const handler = handle(buildServer().app);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
