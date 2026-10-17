import { OFFER_TTL_MS } from "./offers.js";

// Pure decisions for the order-timers worker (contract → Timers). Times are compared as instants
// (Date.parse), so the offset or precision in a Postgres ISO string never matters.

/** Unpaid orders are cancelled 30 minutes after they were created. */
export const UNPAID_ORDER_TTL_MS = 30 * 60 * 1000;
export { OFFER_TTL_MS };

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Number.NaN);

/** Orders created at or before this instant are past the unpaid window. */
export const unpaidCutoff = (now: number): string => new Date(now - UNPAID_ORDER_TTL_MS).toISOString();

export function isUnpaidExpired(order: { status: string; created_at: string }, now: number): boolean {
  return order.status === "awaiting_payment" && ms(order.created_at) <= now - UNPAID_ORDER_TTL_MS;
}

export function isMailDue(
  order: { status: string; fulfillment?: string },
  shipment: { status: string; auto_complete_at: string | null },
  now: number,
): boolean {
  if (order.status !== "in_transit" || shipment.status !== "dropped_off") return false;
  if (order.fulfillment !== undefined && order.fulfillment !== "campus_mail") return false;
  return ms(shipment.auto_complete_at) <= now; // NaN (no deadline) is never due
}

/** Only offers still waiting for an answer expire; accepted/declined/etc. are history. */
export function isOfferExpired(offer: { status: string; expires_at: string }, now: number): boolean {
  return offer.status === "pending" && ms(offer.expires_at) <= now;
}

export const dueUnpaidOrders = <T extends { status: string; created_at: string }>(orders: T[], now: number): T[] =>
  orders.filter((o) => isUnpaidExpired(o, now));

export const dueMailItems = <T extends { order: { status: string; fulfillment?: string }; shipment: { status: string; auto_complete_at: string | null } }>(
  items: T[],
  now: number,
): T[] => items.filter((i) => isMailDue(i.order, i.shipment, now));

export const expiredOffers = <T extends { status: string; expires_at: string }>(offers: T[], now: number): T[] =>
  offers.filter((o) => isOfferExpired(o, now));
