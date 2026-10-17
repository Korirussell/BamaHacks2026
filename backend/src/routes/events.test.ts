import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import { ApiError } from "../lib/errors.js";
import type { TokenVerifier } from "../middleware/auth.js";
import type { IdempotencyStore } from "../middleware/idempotency.js";
import { TicketInput } from "../schemas/listings.js";
import { nextOrderStatus } from "../services/orders.js";
import { assertAppTransfer, assertUpcoming, ticketColumns, ticketFulfillment, ticketInputOf } from "../services/tickets.js";

process.env["SUPABASE_URL"] ??= "https://example.supabase.co";

const signedIn: TokenVerifier = async () => ({ sub: "00000000-0000-4000-a000-000000000005", email: "s@crimson.ua.edu", schoolId: "00000000-0000-4000-a000-000000000001" });
const freeKeys: IdempotencyStore = { begin: async () => null, complete: async () => {}, abandon: async () => {} };
const auth = { headers: { Authorization: "Bearer test", "Content-Type": "application/json" } };
const app = createApp({ verify: signedIn, idempotency: freeKeys, log: false });
const EVENT = "00000000-0000-4000-7000-000000000001";
const ticket = { event_id: EVENT, section: "N4", row: "22", seat: "7", transfer: "app_transfer" as const };

const isCode = (status: number, code: string) => (err: unknown) => err instanceof ApiError && err.status === status && err.code === code;

test("ticket transfer decides the listing's fulfillment", () => {
  assert.equal(ticketFulfillment("app_transfer"), "digital_transfer");
  assert.equal(ticketFulfillment("in_person"), "in_person");
});

test("ticketColumns maps a ticket and clears them for other categories", () => {
  assert.deepEqual(ticketColumns("ticket", { ...ticket, row: undefined, seat: null }), {
    event_id: EVENT, ticket_section: "N4", ticket_row: null, ticket_seat: null, ticket_transfer: "app_transfer",
  });
  assert.deepEqual(ticketColumns("dorm", undefined), { event_id: null, ticket_section: null, ticket_row: null, ticket_seat: null, ticket_transfer: null });
  assert.throws(() => ticketColumns("ticket", undefined), isCode(400, "VALIDATION"));
  assert.throws(() => ticketColumns("textbook", ticket), isCode(400, "VALIDATION"));
});

test("ticketInputOf round-trips a stored ticket and skips incomplete rows", () => {
  const stored = ticketColumns("ticket", ticket);
  assert.deepEqual(ticketInputOf(stored), ticket);
  assert.equal(ticketInputOf({ event_id: EVENT, ticket_section: null, ticket_transfer: "in_person" }), undefined);
});

test("tickets can only be listed for events that haven't started", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  assert.doesNotThrow(() => assertUpcoming("2026-11-28T20:30:00Z", now));
  assert.throws(() => assertUpcoming("2026-10-17T12:00:00Z", now), isCode(400, "VALIDATION"));
});

test("only app-transfer ticket orders use ticket-sent / ticket-received", () => {
  assert.doesNotThrow(() => assertAppTransfer({ category: "ticket", ticket_transfer: "app_transfer" }));
  assert.throws(() => assertAppTransfer({ category: "ticket", ticket_transfer: "in_person" }), isCode(409, "INVALID_STATE"));
  assert.throws(() => assertAppTransfer({ category: "textbook", ticket_transfer: null }), isCode(409, "INVALID_STATE"));
});

test("ticket orders run paid -> in_transit -> completed", () => {
  assert.equal(nextOrderStatus("paid", "ticket_sent"), "in_transit");
  assert.equal(nextOrderStatus("in_transit", "received"), "completed");
  assert.throws(() => nextOrderStatus("awaiting_payment", "ticket_sent"), isCode(409, "INVALID_STATE"));
  assert.throws(() => nextOrderStatus("in_transit", "ticket_sent"), isCode(409, "INVALID_STATE"));
});

test("TicketInput needs an event, a section and a known transfer", () => {
  assert.equal(TicketInput.safeParse(ticket).success, true);
  assert.equal(TicketInput.safeParse({ event_id: EVENT, section: "N4", transfer: "in_person" }).success, true);
  assert.equal(TicketInput.safeParse({ ...ticket, section: "  " }).success, false);
  assert.equal(TicketInput.safeParse({ ...ticket, transfer: "email" }).success, false);
  assert.equal(TicketInput.safeParse({ ...ticket, event_id: "nope" }).success, false);
});

test("event routes need a sign-in and validate the query and id", async () => {
  const anon = createApp({ verify: async () => null, log: false });
  assert.equal((await anon.request("/api/v1/events")).status, 401);
  assert.equal((await app.request("/api/v1/events?kind=rodeo", auth)).status, 400);
  assert.equal((await app.request("/api/v1/events?from=tomorrow", auth)).status, 400);
  assert.equal((await app.request("/api/v1/events/not-a-uuid/tickets", auth)).status, 404);
});

test("ticket-sent / ticket-received need a key, a valid body and a real id", async () => {
  const post = (path: string, body: unknown, key = true) => app.request(`/api/v1${path}`, {
    method: "POST", body: JSON.stringify(body), headers: { ...auth.headers, ...(key ? { "Idempotency-Key": "k1" } : {}) },
  });
  assert.equal((await post("/orders/not-a-uuid/ticket-sent", {}, false)).status, 400);
  assert.equal((await post("/orders/not-a-uuid/ticket-sent", { proof_media_id: "nope" })).status, 400);
  assert.equal((await post("/orders/not-a-uuid/ticket-sent", {})).status, 404);
  assert.equal((await post("/orders/not-a-uuid/ticket-received", {})).status, 404);
});

test("POST /listings checks ticket details before touching the database", async () => {
  const base = {
    category: "ticket", title: "Iron Bowl student ticket", description: "", price_cents: 9000, negotiable: true, condition: "new",
    media_ids: [], course_ids: [], fulfillment: ["digital_transfer"], publish: true,
  };
  const post = (body: unknown) => app.request("/api/v1/listings", { method: "POST", body: JSON.stringify(body), ...auth });
  const missing = await post(base);
  assert.equal(missing.status, 400);
  assert.deepEqual(Object.keys((await missing.json() as { error: { field_errors: Record<string, string> } }).error.field_errors), ["ticket"]);
  assert.equal((await post({ ...base, ticket: { ...ticket, transfer: "fax" } })).status, 400);
  assert.equal((await post({ ...base, category: "dorm", ticket })).status, 400);
});
