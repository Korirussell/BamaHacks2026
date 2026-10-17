import { z } from "zod";
import { OfferRow, OrderRow } from "../db/market.js";
import { ApiError } from "../lib/errors.js";
import { notify as realNotify, type NotificationInput } from "../lib/notify.js";
import { adminClient } from "../lib/supabase.js";
import { settleOrder } from "../services/escrow.js";
import { dueMailItems, dueUnpaidOrders, expiredOffers, unpaidCutoff } from "../services/order-timers.js";
import { nextOrderStatus } from "../services/orders.js";

// Background timers (contract → Timers): unpaid orders cancel after 30 min, campus-mail orders
// auto-complete once the shipment's auto_complete_at passes, offers expire after 48 h.
// Every item is handled on its own so one bad row never stops the tick, and transitionOrder's
// optimistic concurrency means "someone else got there first" is skipped quietly.

const LIMIT = 100;

type OrderRowT = z.infer<typeof OrderRow>;
type OfferRowT = z.infer<typeof OfferRow>;

export interface MailDue { order: OrderRowT; shipment: { id: string; status: string; auto_complete_at: string | null } }

/** Data access, injectable so the tick can be tested without Supabase. */
export interface TimerStore {
  unpaidOrders(cutoffIso: string, limit: number): Promise<OrderRowT[]>;
  dueMailOrders(nowIso: string, limit: number): Promise<MailDue[]>;
  sellerPayoutsEnabled(sellerId: string): Promise<boolean>;
  markShipmentReceived(shipmentId: string, nowIso: string): Promise<void>;
  pendingOffersPast(nowIso: string, limit: number): Promise<OfferRowT[]>;
  /** False when the offer changed since it was read. */
  expireOffer(offer: OfferRowT): Promise<boolean>;
}

export interface ExtraTask { name: string; run(now: number): Promise<unknown> }

export interface OrderTimerDeps {
  store?: TimerStore;
  settle?: typeof settleOrder;
  notify?: (n: NotificationInput) => Promise<void>;
  extraTasks?: ExtraTask[];
  intervalMs: number;
  now?: () => number;
}

export interface TickResult {
  cancelled: number;
  completed: number;
  offersExpired: number;
  extra: Record<string, "ok" | "failed">;
  errors: number;
}

export interface OrderTimers {
  start(): void;
  stop(): void;
  tickOnce(now?: number): Promise<TickResult>;
}

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

export const supabaseStore: TimerStore = {
  async unpaidOrders(cutoffIso, limit) {
    const data = check(await adminClient().from("orders").select("*").eq("status", "awaiting_payment").lte("created_at", cutoffIso).order("created_at").limit(limit));
    return z.array(OrderRow).parse(data);
  },
  async dueMailOrders(nowIso, limit) {
    const shipments = z.array(z.object({ id: z.guid(), order_id: z.guid(), status: z.string(), auto_complete_at: z.string().nullable() })).parse(
      check(await adminClient().from("shipments").select("id, order_id, status, auto_complete_at").eq("status", "dropped_off").lte("auto_complete_at", nowIso).order("auto_complete_at").limit(limit)),
    );
    if (!shipments.length) return [];
    const orders = z.array(OrderRow).parse(
      check(await adminClient().from("orders").select("*").in("id", shipments.map((s) => s.order_id)).eq("status", "in_transit")),
    );
    const byId = new Map(orders.map((o) => [o.id, o]));
    return shipments.flatMap((s) => {
      const order = byId.get(s.order_id);
      return order ? [{ order, shipment: { id: s.id, status: s.status, auto_complete_at: s.auto_complete_at } }] : [];
    });
  },
  async sellerPayoutsEnabled(sellerId) {
    const data = check(await adminClient().from("profiles").select("payouts_enabled").eq("id", sellerId).maybeSingle());
    return z.object({ payouts_enabled: z.boolean() }).nullable().parse(data)?.payouts_enabled ?? false;
  },
  async markShipmentReceived(shipmentId, nowIso) {
    check(await adminClient().from("shipments").update({ status: "received", received_at: nowIso }).eq("id", shipmentId));
  },
  async pendingOffersPast(nowIso, limit) {
    const data = check(await adminClient().from("offers").select("*").eq("status", "pending").lte("expires_at", nowIso).order("expires_at").limit(limit));
    return z.array(OfferRow).parse(data);
  },
  async expireOffer(offer) {
    const data = check(
      await adminClient().from("offers").update({ status: "expired", waiting_on: null }).eq("id", offer.id).eq("status", "pending").eq("updated_at", offer.updated_at).select("id").maybeSingle(),
    );
    return !!data;
  },
};

const isConflict = (err: unknown) => err instanceof ApiError && err.code === "INVALID_STATE";

export function orderTimers(deps: OrderTimerDeps): OrderTimers {
  const store = deps.store ?? supabaseStore;
  const settle = deps.settle ?? settleOrder;
  const notify = deps.notify ?? realNotify;
  const clock = deps.now ?? Date.now;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<TickResult> | null = null;

  const orderNotice = (order: OrderRowT, userId: string, title: string, body: string): Promise<void> =>
    notify({ schoolId: order.school_id, userId, type: "order.updated", title, body, deepLink: `/orders/${order.id}`, data: { order_id: order.id } })
      .catch((err) => console.error("order-timers notify failed", err instanceof Error ? err.message : err));

  /** Runs one item; a lost race is skipped, any other failure is logged. */
  async function guarded(what: string, id: string, fn: () => Promise<boolean>, result: TickResult): Promise<boolean> {
    try {
      return await fn();
    } catch (err) {
      if (isConflict(err)) return false;
      result.errors += 1;
      console.error(`order-timers: ${what} ${id} failed`, err instanceof Error ? err.message : err);
      return false;
    }
  }

  async function runTick(now: number): Promise<TickResult> {
    const result: TickResult = { cancelled: 0, completed: 0, offersExpired: 0, extra: {}, errors: 0 };
    const nowIso = new Date(now).toISOString();

    const unpaid = dueUnpaidOrders(await store.unpaidOrders(unpaidCutoff(now), LIMIT).catch((e) => fail<OrderRowT>("unpaid query", e, result)), now);
    for (const order of unpaid) {
      const ok = await guarded("cancel", order.id, async () => {
        const status = nextOrderStatus(order.status, "cancel");
        if (status !== "cancelled") return false;
        await settle(order, status, { reason: "unpaid_timeout" });
        await Promise.all([
          orderNotice(order, order.buyer_id, "Order cancelled", "You didn't pay within 30 minutes, so the order was cancelled."),
          orderNotice(order, order.seller_id, "Order cancelled", "The buyer didn't pay in time. Your item is listed again."),
        ]);
        return true;
      }, result);
      if (ok) result.cancelled += 1;
    }

    const mail = dueMailItems(await store.dueMailOrders(nowIso, LIMIT).catch((e) => fail<MailDue>("mail query", e, result)), now);
    for (const { order, shipment } of mail) {
      const ok = await guarded("auto-complete", order.id, async () => {
        const status = nextOrderStatus(order.status, "auto_complete");
        if (status !== "completed") return false;
        const sellerPayoutsEnabled = await store.sellerPayoutsEnabled(order.seller_id);
        await settle(order, status, { reason: "campus_mail_auto_complete", sellerPayoutsEnabled });
        await store.markShipmentReceived(shipment.id, nowIso);
        await Promise.all([
          orderNotice(order, order.buyer_id, "Order complete", "Your campus-mail item was marked received automatically."),
          orderNotice(order, order.seller_id, "Order complete", "The campus-mail delivery was confirmed automatically."),
        ]);
        return true;
      }, result);
      if (ok) result.completed += 1;
    }

    const offers = expiredOffers(await store.pendingOffersPast(nowIso, LIMIT).catch((e) => fail<OfferRowT>("offer query", e, result)), now);
    for (const offer of offers) {
      const ok = await guarded("expire offer", offer.id, async () => {
        if (!(await store.expireOffer(offer))) return false;
        await notify({
          schoolId: offer.school_id, userId: offer.buyer_id, type: "offer.updated", title: "Offer expired",
          body: "Your offer went unanswered for 48 hours and expired.", deepLink: `/listings/${offer.listing_id}`, data: { listing_id: offer.listing_id, offer_id: offer.id },
        }).catch((err) => console.error("order-timers notify failed", err instanceof Error ? err.message : err));
        return true;
      }, result);
      if (ok) result.offersExpired += 1;
    }

    for (const task of deps.extraTasks ?? []) {
      try {
        await task.run(now);
        result.extra[task.name] = "ok";
      } catch (err) {
        result.extra[task.name] = "failed";
        result.errors += 1;
        console.error(`order-timers: task ${task.name} failed`, err instanceof Error ? err.message : err);
      }
    }
    return result;
  }

  function fail<T>(what: string, err: unknown, result: TickResult): T[] {
    result.errors += 1;
    console.error(`order-timers: ${what} failed`, err instanceof Error ? err.message : err);
    return [];
  }

  // Overlapping ticks share the running one.
  const tickOnce = (now?: number) => {
    running ??= runTick(now ?? clock()).finally(() => { running = null; });
    return running;
  };

  return {
    start() {
      if (timer) return;
      const tick = () => {
        void tickOnce().then((r) => {
          if (r.cancelled || r.completed || r.offersExpired) console.log(`order-timers: cancelled ${r.cancelled}, auto-completed ${r.completed}, offers expired ${r.offersExpired}`);
        });
      };
      tick();
      timer = setInterval(tick, deps.intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    tickOnce,
  };
}
