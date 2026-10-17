import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OfferRow, OrderRow } from "../db/market.js";
import { ApiError } from "../lib/errors.js";
import { orderTimers, type MailDue, type TimerStore } from "./order-timers.js";

const NOW = Date.parse("2026-03-10T15:00:00Z");
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();
const id = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

const order = (n: number, over: Partial<OrderRow> = {}): OrderRow => ({
  id: id(n), school_id: id(900), listing_id: id(800 + n), buyer_id: id(700), seller_id: id(701), offer_id: null,
  amount_cents: 1000, fee_cents: 50, seller_payout_cents: 950, fulfillment: "campus_mail", status: "awaiting_payment",
  payment_status: "requires_payment", payment_intent_id: null, paid_at: null, payout_status: "held", released_at: null,
  handoff_id: null, cancel_reason: null, created_at: ago(45), updated_at: ago(45), ...over,
});
const offer = (n: number): OfferRow => ({
  id: id(n), school_id: id(900), listing_id: id(800), buyer_id: id(700), seller_id: id(701), kind: "cash", amount_cents: 500, trade_listing_ids: [],
  fulfillment: "in_person", message: null, counter_of: null, auto_generated: false, made_by: "buyer", status: "pending", waiting_on: "seller",
  seller_notified_at: null, expires_at: ago(1), updated_at: ago(2000),
});

function harness(data: { unpaid?: OrderRow[]; mail?: MailDue[]; offers?: OfferRow[]; payouts?: boolean; failIds?: string[]; conflictIds?: string[] }) {
  const log = { settled: [] as { id: string; status: string; opts: Record<string, unknown> }[], received: [] as string[], expired: [] as string[], notices: [] as string[] };
  const store: TimerStore = {
    unpaidOrders: async () => data.unpaid ?? [],
    dueMailOrders: async () => data.mail ?? [],
    sellerPayoutsEnabled: async () => data.payouts ?? false,
    markShipmentReceived: async (sid) => { log.received.push(sid); },
    pendingOffersPast: async () => data.offers ?? [],
    expireOffer: async (o) => { log.expired.push(o.id); return true; },
  };
  const timers = orderTimers({
    store, intervalMs: 1000,
    settle: async (o, status, opts) => {
      if (data.failIds?.includes(o.id)) throw new Error("boom");
      if (data.conflictIds?.includes(o.id)) throw new ApiError(409, "INVALID_STATE", "changed");
      log.settled.push({ id: o.id, status, opts });
      return { ...o, status };
    },
    notify: async (n) => { log.notices.push(`${n.userId}:${n.type}`); },
  });
  return { timers, log };
}

describe("order-timers tick", () => {
  it("cancels unpaid orders and notifies buyer and seller", async () => {
    const { timers, log } = harness({ unpaid: [order(1)] });
    const r = await timers.tickOnce(NOW);
    assert.equal(r.cancelled, 1);
    assert.deepEqual(log.settled, [{ id: id(1), status: "cancelled", opts: { reason: "unpaid_timeout" } }]);
    assert.equal(log.notices.length, 2);
  });

  it("skips orders not yet past 30 minutes even if the store returns them", async () => {
    const { timers, log } = harness({ unpaid: [order(1, { created_at: ago(10) })] });
    assert.equal((await timers.tickOnce(NOW)).cancelled, 0);
    assert.equal(log.settled.length, 0);
  });

  it("auto-completes due campus mail with the seller's payout flag and marks the shipment received", async () => {
    const o = order(2, { status: "in_transit", payment_status: "succeeded" });
    const { timers, log } = harness({ mail: [{ order: o, shipment: { id: "ship1", status: "dropped_off", auto_complete_at: ago(5) } }], payouts: true });
    const r = await timers.tickOnce(NOW);
    assert.equal(r.completed, 1);
    assert.deepEqual(log.settled[0]?.opts, { reason: "campus_mail_auto_complete", sellerPayoutsEnabled: true });
    assert.deepEqual(log.received, ["ship1"]);
    assert.equal(log.notices.length, 2);
  });

  it("leaves mail alone before auto_complete_at", async () => {
    const o = order(2, { status: "in_transit" });
    const future = new Date(NOW + 60_000).toISOString();
    const { timers, log } = harness({ mail: [{ order: o, shipment: { id: "s", status: "dropped_off", auto_complete_at: future } }] });
    assert.equal((await timers.tickOnce(NOW)).completed, 0);
    assert.equal(log.settled.length, 0);
  });

  it("expires pending offers and notifies the buyer", async () => {
    const { timers, log } = harness({ offers: [offer(5)] });
    assert.equal((await timers.tickOnce(NOW)).offersExpired, 1);
    assert.deepEqual(log.expired, [id(5)]);
    assert.deepEqual(log.notices, [`${id(700)}:offer.updated`]);
  });

  it("one failure doesn't stop the rest; conflicts are skipped quietly", async () => {
    const { timers, log } = harness({ unpaid: [order(1), order(2), order(3)], failIds: [id(1)], conflictIds: [id(2)] });
    const r = await timers.tickOnce(NOW);
    assert.equal(r.cancelled, 1);
    assert.equal(r.errors, 1); // the boom, not the conflict
    assert.deepEqual(log.settled.map((s) => s.id), [id(3)]);
  });

  it("runs extra tasks, isolating their failures", async () => {
    const ran: number[] = [];
    const timers = orderTimers({
      store: { unpaidOrders: async () => [], dueMailOrders: async () => [], sellerPayoutsEnabled: async () => false, markShipmentReceived: async () => {}, pendingOffersPast: async () => [], expireOffer: async () => true },
      intervalMs: 1000,
      extraTasks: [
        { name: "bad", run: async () => { throw new Error("x"); } },
        { name: "good", run: async (now) => { ran.push(now); } },
      ],
    });
    const r = await timers.tickOnce(NOW);
    assert.deepEqual(r.extra, { bad: "failed", good: "ok" });
    assert.deepEqual(ran, [NOW]);
  });

  it("a failing query doesn't stop later steps", async () => {
    const { timers, log } = harness({ offers: [offer(5)] });
    const broken = orderTimers({
      store: { unpaidOrders: async () => { throw new Error("db down"); }, dueMailOrders: async () => [], sellerPayoutsEnabled: async () => false, markShipmentReceived: async () => {}, pendingOffersPast: async () => [offer(6)], expireOffer: async (o) => { log.expired.push(o.id); return true; } },
      intervalMs: 1000, notify: async () => {},
    });
    const r = await broken.tickOnce(NOW);
    assert.equal(r.errors, 1);
    assert.equal(r.offersExpired, 1);
    void timers;
  });

  it("overlapping ticks share one run", async () => {
    let calls = 0;
    const timers = orderTimers({
      store: { unpaidOrders: async () => { calls += 1; return []; }, dueMailOrders: async () => [], sellerPayoutsEnabled: async () => false, markShipmentReceived: async () => {}, pendingOffersPast: async () => [], expireOffer: async () => true },
      intervalMs: 1000,
    });
    await Promise.all([timers.tickOnce(NOW), timers.tickOnce(NOW)]);
    assert.equal(calls, 1);
  });
});
