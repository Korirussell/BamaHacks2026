import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import { ApiError } from "../lib/errors.js";
import type { TokenVerifier } from "../middleware/auth.js";
import type { IdempotencyStore } from "../middleware/idempotency.js";
import { CreateRideRequestReq, DriverReq } from "../schemas/rides.js";
import {
  BOOKING_GRACE_MS, acceptedPrice, checkBooking, driverStatusAfterUpdate, localDayBounds, nextRideStatus, parseLatLng, seatsAfterBooking,
} from "../services/rides.js";

process.env["SUPABASE_URL"] ??= "https://example.supabase.co";

const me = "00000000-0000-4000-a000-000000000005";
const signedIn: TokenVerifier = async () => ({ sub: me, email: "s@crimson.ua.edu", schoolId: "00000000-0000-4000-a000-000000000001" });
const store: IdempotencyStore = { begin: async () => null, complete: async () => {}, abandon: async () => {} };
const app = createApp({ verify: signedIn, idempotency: store, log: false });
const headers = { Authorization: "Bearer test", "Content-Type": "application/json", "Idempotency-Key": "k" };
const send = (method: string, path: string, body?: unknown) =>
  app.request(`/api/v1${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const rideId = "11111111-1111-4111-8111-111111111111";
const place = { label: "Ferguson Center", location: { lat: 33.2148, lng: -87.5462 } };

const invalidState = (fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof ApiError && e.code === "INVALID_STATE");

test("ride status machine follows open/full → en_route → completed, with cancel until the end", () => {
  assert.equal(nextRideStatus("open", "en_route", 1), "en_route");
  assert.equal(nextRideStatus("full", "en_route", 3), "en_route");
  assert.equal(nextRideStatus("en_route", "picked_up", 3), "en_route");
  assert.equal(nextRideStatus("en_route", "completed", 3), "completed");
  assert.equal(nextRideStatus("open", "cancelled", 0), "cancelled");
  assert.equal(nextRideStatus("en_route", "cancelled", 2), "cancelled");
  invalidState(() => nextRideStatus("open", "en_route", 0));
  invalidState(() => nextRideStatus("open", "picked_up", 1));
  invalidState(() => nextRideStatus("open", "completed", 1));
  invalidState(() => nextRideStatus("completed", "cancelled", 1));
  invalidState(() => nextRideStatus("cancelled", "en_route", 1));
});

test("seat math never goes negative and fills the ride at zero", () => {
  assert.deepEqual(seatsAfterBooking(3, 1), { seats_left: 2, status: "open" });
  assert.deepEqual(seatsAfterBooking(3, 3), { seats_left: 0, status: "full" });
  invalidState(() => seatsAfterBooking(2, 3));
  invalidState(() => seatsAfterBooking(0, 1));
  assert.throws(() => seatsAfterBooking(3, 0), (e: unknown) => e instanceof ApiError && e.code === "VALIDATION");
});

test("booking checks the rider, the ride's status and its departure", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  const ride = { driver_id: "driver", status: "open" as const, seats_left: 2, depart_at: "2026-10-17T13:00:00Z" };
  assert.deepEqual(checkBooking(ride, me, 2, now), { seats_left: 0, status: "full" });
  assert.throws(() => checkBooking(ride, "driver", 1, now), (e: unknown) => e instanceof ApiError && e.code === "FORBIDDEN");
  invalidState(() => checkBooking({ ...ride, status: "full", seats_left: 0 }, me, 1, now));
  invalidState(() => checkBooking({ ...ride, status: "en_route" }, me, 1, now));
  const left = Date.parse(ride.depart_at) + BOOKING_GRACE_MS + 1;
  invalidState(() => checkBooking(ride, me, 1, left));
  assert.ok(checkBooking(ride, me, 1, left - 2));
});

test("accepted price defaults to the rider's max and can't exceed it", () => {
  assert.equal(acceptedPrice(800, undefined), 800);
  assert.equal(acceptedPrice(null, undefined), 0);
  assert.equal(acceptedPrice(800, 500), 500);
  assert.equal(acceptedPrice(null, 1200), 1200);
  assert.throws(() => acceptedPrice(800, 900), (e: unknown) => e instanceof ApiError && e.code === "VALIDATION");
});

test("driver status: demo verifies at once, real mode waits, rejected stays rejected", () => {
  assert.equal(driverStatusAfterUpdate(null, true), "verified");
  assert.equal(driverStatusAfterUpdate(null, false), "pending");
  assert.equal(driverStatusAfterUpdate("verified", false), "pending");
  assert.equal(driverStatusAfterUpdate("rejected", true), "rejected");
});

test("lat,lng query parsing and local day bounds", () => {
  assert.deepEqual(parseLatLng("33.21,-87.54"), { lat: 33.21, lng: -87.54 });
  assert.equal(parseLatLng("33.21"), null);
  assert.equal(parseLatLng("91,0"), null);
  assert.equal(parseLatLng(",5"), null);
  assert.equal(parseLatLng("a,b"), null);
  const { start, end } = localDayBounds("2026-10-17", "America/Chicago");
  assert.equal(new Date(start).toISOString(), "2026-10-17T05:00:00.000Z");
  assert.equal(new Date(end).toISOString(), "2026-10-18T05:00:00.000Z");
});

test("request schemas: terms must be accepted and depart_at takes now", () => {
  const vehicle = { make: "Honda", model: "Civic", color: "Red", plate: "ABC123" };
  assert.ok(DriverReq.safeParse({ vehicle, accepts_terms: true }).success);
  assert.ok(!DriverReq.safeParse({ vehicle, accepts_terms: false }).success);
  assert.ok(CreateRideRequestReq.safeParse({ pickup: place, dropoff: place, depart_at: "now", seats: 1 }).success);
  assert.ok(!CreateRideRequestReq.safeParse({ pickup: place, dropoff: place, depart_at: "later", seats: 1 }).success);
  assert.ok(!CreateRideRequestReq.safeParse({ pickup: place, dropoff: place, depart_at: "now", seats: 9 }).success);
});

test("ride routes need a sign-in", async () => {
  const anon = createApp({ verify: async () => null, log: false });
  assert.equal((await anon.request("/api/v1/rides")).status, 401);
  assert.equal((await anon.request("/api/v1/ride-requests/open")).status, 401);
  assert.equal((await anon.request("/api/v1/me/driver", { method: "PUT" })).status, 401);
});

test("ride routes validate bodies, queries and ids before touching the database", async () => {
  assert.equal((await send("PUT", "/me/driver", { vehicle: { make: "Honda" }, accepts_terms: true })).status, 400);
  assert.equal((await send("PUT", "/me/driver", { vehicle: { make: "H", model: "C", color: "R", plate: "X" }, accepts_terms: false })).status, 400);
  assert.equal((await send("POST", "/rides", { origin: place, destination: place, depart_at: "tomorrow", seats: 2, price_per_seat_cents: 500 })).status, 400);
  assert.equal((await send("POST", "/rides", { origin: place, destination: place, depart_at: "2020-01-01T00:00:00Z", seats: 2, price_per_seat_cents: 500 })).status, 400);
  assert.equal((await send("POST", "/rides", { origin: place, destination: place, depart_at: "2026-12-01T00:00:00Z", seats: 0, price_per_seat_cents: 500 })).status, 400);
  assert.equal((await send("POST", "/rides", { origin: { label: "x", location: { lat: 100, lng: 0 } }, destination: place, depart_at: "2026-12-01T00:00:00Z", seats: 2, price_per_seat_cents: 500 })).status, 400);
  assert.equal((await send("GET", "/rides?near=nope")).status, 400);
  assert.equal((await send("GET", "/rides?date=10/17")).status, 400);
  assert.equal((await send("POST", "/ride-requests", { pickup: place, dropoff: place, depart_at: "now", seats: 1, max_price_cents: -5 })).status, 400);
  assert.equal((await send("POST", `/rides/${rideId}/book`, { seats: 0 })).status, 400);
  assert.equal((await send("POST", `/rides/${rideId}/location`, { location: { lat: 33 } })).status, 400);
  assert.equal((await send("POST", `/rides/${rideId}/status`, { status: "open" })).status, 400);
  assert.equal((await send("POST", "/rides/not-a-uuid/book", { seats: 1 })).status, 404);
  assert.equal((await send("POST", "/rides/not-a-uuid/status", { status: "en_route" })).status, 404);
  assert.equal((await send("GET", "/rides/not-a-uuid")).status, 404);
  assert.equal((await send("POST", "/ride-requests/not-a-uuid/accept", {})).status, 404);
});

test("booking and status changes need an Idempotency-Key", async () => {
  const noKey = { Authorization: "Bearer test", "Content-Type": "application/json" };
  const res = await app.request(`/api/v1/rides/${rideId}/book`, { method: "POST", headers: noKey, body: JSON.stringify({ seats: 1 }) });
  assert.equal(res.status, 400);
});
