import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import { orderTimers, type TimerStore } from "../workers/order-timers.js";

const SECRET = "test-cron-secret-0123456789";

/** A real orderTimers over a fake store that counts how often each query and task runs. */
function counted() {
  const calls: Record<string, number> = {};
  const hit = (name: string) => { calls[name] = (calls[name] ?? 0) + 1; };
  const store: TimerStore = {
    unpaidOrders: async () => { hit("unpaidOrders"); return []; },
    dueMailOrders: async () => { hit("dueMailOrders"); return []; },
    sellerPayoutsEnabled: async () => false,
    markShipmentReceived: async () => {},
    pendingOffersPast: async () => { hit("pendingOffersPast"); return []; },
    expireOffer: async () => true,
  };
  const timers = orderTimers({ store, intervalMs: 1000, notify: async () => {}, extraTasks: [{ name: "handoffs", run: async () => hit("handoffs") }] });
  const app = createApp({ log: false, sweep: { secret: SECRET, run: () => timers.tickOnce() } });
  return { app, calls };
}

const sweep = (app: ReturnType<typeof createApp>, method: string, authorization?: string) =>
  app.request("/api/v1/internal/sweep", { method, headers: authorization ? { Authorization: authorization } : {} });

test("sweep rejects calls without the right bearer and runs nothing", async () => {
  const { app, calls } = counted();
  assert.equal((await sweep(app, "POST")).status, 401);
  assert.equal((await sweep(app, "POST", "Bearer wrong")).status, 401);
  assert.equal((await sweep(app, "POST", SECRET)).status, 401);
  assert.equal((await sweep(app, "GET")).status, 401);
  assert.deepEqual(calls, {});
});

test("sweep is disabled when CRON_SECRET is unset", async () => {
  const app = createApp({ log: false });
  assert.equal((await sweep(app, "POST", "Bearer anything")).status, 403);
});

test("sweep runs each timer task once per call (POST, and GET as Vercel Cron sends it)", async () => {
  const { app, calls } = counted();
  const res = await sweep(app, "POST", `Bearer ${SECRET}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { data: { cancelled: 0, completed: 0, offersExpired: 0, extra: { handoffs: "ok" }, errors: 0 } });
  assert.deepEqual(calls, { unpaidOrders: 1, dueMailOrders: 1, pendingOffersPast: 1, handoffs: 1 });

  assert.equal((await sweep(app, "GET", `Bearer ${SECRET}`)).status, 200);
  assert.deepEqual(calls, { unpaidOrders: 2, dueMailOrders: 2, pendingOffersPast: 2, handoffs: 2 });
});
