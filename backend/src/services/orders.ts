import { ApiError } from "../lib/errors.js";

export type OrderStatus =
  | "awaiting_payment"
  | "paid"
  | "scheduled"
  | "handing_off"
  | "in_transit"
  | "completed"
  | "cancelled"
  | "disputed"
  | "refunded";

export type OrderEvent =
  | "payment_succeeded"
  | "meetup_agreed" // in person: time + place agreed
  | "both_nearby"
  | "handoff_confirmed"
  | "label_created" // campus mail
  | "dropped_off"
  | "received"
  | "ticket_sent" // app-transfer ticket: seller sent it; the buyer's "received" completes it
  | "cancel"
  | "no_show"
  | "dispute"
  | "resolve_complete"
  | "resolve_refund"
  | "auto_complete";

// Contract → Part 2 → Order lifecycle. Anything not listed is INVALID_STATE.
const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderEvent, OrderStatus>>> = {
  awaiting_payment: { payment_succeeded: "paid", cancel: "cancelled" },
  paid: { meetup_agreed: "scheduled", label_created: "scheduled", ticket_sent: "in_transit", cancel: "refunded" },
  scheduled: { both_nearby: "handing_off", handoff_confirmed: "completed", dropped_off: "in_transit", no_show: "refunded", cancel: "refunded", dispute: "disputed" },
  handing_off: { handoff_confirmed: "completed", no_show: "refunded", dispute: "disputed" },
  in_transit: { received: "completed", auto_complete: "completed", dispute: "disputed" },
  disputed: { resolve_complete: "completed", resolve_refund: "refunded" },
  completed: {},
  cancelled: {},
  refunded: {},
};

export function nextOrderStatus(current: OrderStatus, event: OrderEvent): OrderStatus {
  const next = TRANSITIONS[current][event];
  if (!next) throw new ApiError(409, "INVALID_STATE", `Can't ${event} an order that is ${current}`);
  return next;
}

/** Platform fee in basis points (500 = 5%), deducted from the seller's side by default. */
export function splitAmount(amountCents: number, feeBps: number) {
  const fee = Math.round((amountCents * feeBps) / 10_000);
  return { amount_cents: amountCents, fee_cents: fee, seller_payout_cents: amountCents - fee };
}

export type PayoutStatus = "held" | "awaiting_onboarding" | "released" | "reversed";

/** What happens to the held money when an order reaches a final state. */
export function payoutFor(status: OrderStatus, sellerPayoutsEnabled: boolean): PayoutStatus {
  if (status === "completed") return sellerPayoutsEnabled ? "released" : "awaiting_onboarding";
  if (status === "refunded" || status === "cancelled") return "reversed";
  return "held";
}
