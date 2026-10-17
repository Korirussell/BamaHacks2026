import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dueMailItems, dueUnpaidOrders, expiredOffers, isMailDue, isOfferExpired, isUnpaidExpired, unpaidCutoff, UNPAID_ORDER_TTL_MS } from "./order-timers.js";

const NOW = Date.parse("2026-03-10T15:00:00Z");
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe("unpaid order timer", () => {
  it("expires at exactly 30 minutes, not before", () => {
    assert.equal(isUnpaidExpired({ status: "awaiting_payment", created_at: ago(30) }, NOW), true);
    assert.equal(isUnpaidExpired({ status: "awaiting_payment", created_at: ago(29.99) }, NOW), false);
    assert.equal(isUnpaidExpired({ status: "awaiting_payment", created_at: ago(31) }, NOW), true);
  });
  it("ignores orders that aren't awaiting payment", () => {
    assert.equal(isUnpaidExpired({ status: "paid", created_at: ago(500) }, NOW), false);
  });
  it("compares instants, whatever offset the timestamp carries", () => {
    assert.equal(isUnpaidExpired({ status: "awaiting_payment", created_at: "2026-03-10T08:30:00-06:00" }, NOW), true);
    assert.equal(isUnpaidExpired({ status: "awaiting_payment", created_at: "2026-03-10T14:30:00.000+00:00" }, NOW), true);
    assert.equal(isUnpaidExpired({ status: "awaiting_payment", created_at: "2026-03-10T08:31:00-06:00" }, NOW), false);
  });
  it("cutoff is now minus 30 minutes", () => {
    assert.equal(Date.parse(unpaidCutoff(NOW)), NOW - UNPAID_ORDER_TTL_MS);
    assert.equal(dueUnpaidOrders([{ status: "awaiting_payment", created_at: ago(40) }, { status: "awaiting_payment", created_at: ago(5) }], NOW).length, 1);
  });
});

describe("campus mail auto-complete", () => {
  const order = { status: "in_transit", fulfillment: "campus_mail" };
  it("is due once auto_complete_at has passed (inclusive)", () => {
    assert.equal(isMailDue(order, { status: "dropped_off", auto_complete_at: ago(0) }, NOW), true);
    assert.equal(isMailDue(order, { status: "dropped_off", auto_complete_at: ago(60) }, NOW), true);
  });
  it("is not due before the deadline, without one, or in the wrong state", () => {
    assert.equal(isMailDue(order, { status: "dropped_off", auto_complete_at: new Date(NOW + 1000).toISOString() }, NOW), false);
    assert.equal(isMailDue(order, { status: "dropped_off", auto_complete_at: null }, NOW), false);
    assert.equal(isMailDue(order, { status: "label_created", auto_complete_at: ago(60) }, NOW), false);
    assert.equal(isMailDue({ status: "disputed" }, { status: "dropped_off", auto_complete_at: ago(60) }, NOW), false);
    assert.equal(isMailDue({ status: "in_transit", fulfillment: "in_person" }, { status: "dropped_off", auto_complete_at: ago(60) }, NOW), false);
  });
  it("handles offset timestamps", () => {
    assert.equal(isMailDue(order, { status: "dropped_off", auto_complete_at: "2026-03-10T09:00:00-06:00" }, NOW), true);
    assert.equal(dueMailItems([{ order, shipment: { status: "dropped_off", auto_complete_at: "2026-03-10T09:01:00-06:00" } }], NOW).length, 0);
  });
});

describe("offer expiry", () => {
  it("expires pending offers at expires_at", () => {
    assert.equal(isOfferExpired({ status: "pending", expires_at: ago(0) }, NOW), true);
    assert.equal(isOfferExpired({ status: "pending", expires_at: new Date(NOW + 1).toISOString() }, NOW), false);
  });
  it("leaves answered offers alone", () => {
    for (const status of ["accepted", "declined", "withdrawn", "expired", "countered"]) assert.equal(isOfferExpired({ status, expires_at: ago(99) }, NOW), false);
    assert.equal(expiredOffers([{ status: "pending", expires_at: ago(1) }, { status: "accepted", expires_at: ago(1) }], NOW).length, 1);
  });
});
