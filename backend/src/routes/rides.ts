import { Hono } from "hono";
import { z } from "zod";
import {
  BookingRow, RideRequestRow, RideRow, announceRide, isParty, loadBookings, loadDriver, loadRideRow, requireVerifiedDriver,
  rideOut, rideRequestsOut, ridesOut,
} from "../db/rides.js";
import { loadSchool } from "../db/tutoring.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { one, page } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { idempotent, type IdempotencyStore } from "../middleware/idempotency.js";
import {
  AcceptReq, BookReq, CreateRideReq, CreateRideRequestReq, DriverReq, DriverRes, RideLocationReq, RideStatusReq, RidesQuery,
} from "../schemas/rides.js";
import { distanceM } from "../services/geo.js";
import {
  BOOKING_GRACE_MS, NEAR_RADIUS_M, REQUEST_GRACE_MS, acceptedPrice, checkBooking, driverStatusAfterUpdate, localDayBounds,
  nextRideStatus, parseLatLng,
} from "../services/rides.js";
import { DAY, MINUTE } from "../services/time.js";
import type { PaymentsMode } from "./orders.js";

// Rides (module 18). Bookings carry their own payment: PAYMENTS=demo marks them paid on the
// spot (like POST /orders/{id}/pay); real card payments aren't built yet.

const MAX_AHEAD_MS = 90 * DAY;
const PAST_SLACK_MS = 5 * MINUTE;
const LIST_LIMIT = 50;
const RAISED = "P0001";
const UNIQUE_VIOLATION = "23505";

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

const parseId = (raw: string, what: string) => {
  const id = z.guid().safeParse(raw);
  if (!id.success) throw new ApiError(404, "NOT_FOUND", `${what} not found`);
  return id.data;
};

const dbCode = (e: unknown) => (typeof e === "object" && e !== null && "code" in e ? String(e.code) : null);

function checkDeparture(ms: number, now: number) {
  if (ms < now - PAST_SLACK_MS) throw new ApiError(400, "VALIDATION", "Invalid request", { depart_at: "Must be in the future" });
  if (ms > now + MAX_AHEAD_MS) throw new ApiError(400, "VALIDATION", "Invalid request", { depart_at: "At most 90 days ahead" });
}

function nearQuery(raw: string | undefined, field: string) {
  if (raw === undefined) return null;
  const at = parseLatLng(raw);
  if (!at) throw new ApiError(400, "VALIDATION", "Invalid request", { [field]: "Use lat,lng" });
  return at;
}

function requirePayments(payments: PaymentsMode) {
  if (payments !== "demo") throw new ApiError(503, "INTERNAL", "Card payments aren't set up yet");
}

/** Loads a ride the caller may see: open rides for anyone at the school, the rest for its driver and riders. */
async function visibleRide(id: string, userId: string, schoolId: string) {
  const ride = await loadRideRow(id, schoolId);
  const bookings = (await loadBookings([ride.id], schoolId)).get(ride.id) ?? [];
  if (ride.status !== "open" && !isParty(ride, bookings, userId)) throw new ApiError(404, "NOT_FOUND", "Ride not found");
  return { ride, bookings };
}

async function notifyRiders(ride: RideRow, bookings: BookingRow[], title: string, body: string) {
  await Promise.all(bookings.map((b) => notify({
    schoolId: ride.school_id, userId: b.rider_id, type: "ride.updated", title, body, deepLink: `/rides/${ride.id}`, data: { ride_id: ride.id },
  })));
}

const STATUS_COPY = {
  en_route: ["Driver is on the way", "Your driver has started the trip."],
  picked_up: ["Picked up", "Enjoy the ride."],
  completed: ["Ride complete", "Thanks for riding. You can now leave a review."],
  cancelled: ["Ride cancelled", "The driver cancelled this ride. You've been refunded."],
} as const;

export const ridesRoutes = (verify: TokenVerifier, idempotency: IdempotencyStore, payments: PaymentsMode) => new Hono<AuthEnv>()
  .use("/me/driver", requireUser(verify))
  .use("/rides", requireUser(verify))
  .use("/rides/*", requireUser(verify))
  .use("/ride-requests", requireUser(verify))
  .use("/ride-requests/*", requireUser(verify))

  .put("/me/driver", async (c) => {
    const { vehicle } = await parseBody(c, DriverReq);
    const { id: userId, schoolId } = c.var.user;
    const previous = await loadDriver(userId, schoolId);
    const status = driverStatusAfterUpdate(previous?.status ?? null, payments === "demo");
    check(await adminClient().from("drivers").upsert({
      user_id: userId, school_id: schoolId, vehicle_make: vehicle.make, vehicle_model: vehicle.model, vehicle_color: vehicle.color,
      vehicle_plate: vehicle.plate.toUpperCase(), terms_accepted_at: new Date().toISOString(), status,
    }, { onConflict: "user_id" }));
    return c.json(one(DriverRes.parse({ status })));
  })

  .post("/rides", async (c) => {
    const input = await parseBody(c, CreateRideReq);
    const { id: userId, schoolId } = c.var.user;
    const departMs = Date.parse(input.depart_at);
    checkDeparture(departMs, Date.now());
    await requireVerifiedDriver(userId, schoolId);
    const data = check(await adminClient().from("rides").insert({
      school_id: schoolId, driver_id: userId,
      origin_label: input.origin.label, origin_lat: input.origin.location.lat, origin_lng: input.origin.location.lng,
      destination_label: input.destination.label, destination_lat: input.destination.location.lat, destination_lng: input.destination.location.lng,
      depart_at: new Date(departMs).toISOString(), seats_total: input.seats, seats_left: input.seats, price_per_seat_cents: input.price_per_seat_cents,
    }).select("*").single());
    return c.json(one(await rideOut(RideRow.parse(data), userId)), 201);
  })

  .get("/rides", async (c) => {
    const q = parseQuery(c, RidesQuery);
    const near = nearQuery(q.near, "near");
    const toNear = nearQuery(q.to_near, "to_near");
    const { id: userId, schoolId } = c.var.user;
    const now = Date.now();
    let query = adminClient().from("rides").select("*").eq("school_id", schoolId).eq("status", "open")
      .gte("depart_at", new Date(now - BOOKING_GRACE_MS).toISOString());
    if (q.date) {
      const { start, end } = localDayBounds(q.date, (await loadSchool(schoolId)).timezone);
      query = query.gte("depart_at", new Date(start).toISOString()).lt("depart_at", new Date(end).toISOString());
    }
    const rows = z.array(RideRow).parse(check(await query.order("depart_at").limit(200))).filter((r) =>
      (!near || distanceM(near, { lat: r.origin_lat, lng: r.origin_lng }) <= NEAR_RADIUS_M)
      && (!toNear || distanceM(toNear, { lat: r.destination_lat, lng: r.destination_lng }) <= NEAR_RADIUS_M));
    return c.json(page(await ridesOut(rows.slice(0, LIST_LIMIT), schoolId, userId)));
  })

  .get("/rides/:id", async (c) => {
    const { id: userId, schoolId } = c.var.user;
    const { ride } = await visibleRide(parseId(c.req.param("id"), "Ride"), userId, schoolId);
    return c.json(one(await rideOut(ride, userId)));
  })

  .post("/rides/:id/book", idempotent(idempotency), async (c) => {
    const input = await parseBody(c, BookReq);
    const { id: userId, schoolId } = c.var.user;
    const ride = await loadRideRow(parseId(c.req.param("id"), "Ride"), schoolId);
    checkBooking(ride, userId, input.seats, Date.now());
    requirePayments(payments);

    const booked = await adminClient().rpc("book_ride", {
      p_school_id: schoolId, p_ride_id: ride.id, p_rider_id: userId, p_seats: input.seats,
      p_pickup_label: input.pickup?.label ?? null, p_pickup_lat: input.pickup?.location.lat ?? null, p_pickup_lng: input.pickup?.location.lng ?? null,
      p_paid: true,
    });
    if (dbCode(booked.error) === UNIQUE_VIOLATION) throw new ApiError(409, "INVALID_STATE", "You already booked this ride");
    if (dbCode(booked.error) === RAISED) throw new ApiError(409, "INVALID_STATE", "Those seats were just taken; reload the ride");
    const booking = BookingRow.parse(check(booked));

    const updated = await loadRideRow(ride.id, schoolId);
    await notify({
      schoolId, userId: ride.driver_id, type: "ride.updated", title: "New rider",
      body: `${input.seats} seat${input.seats === 1 ? "" : "s"} booked on your ride to ${ride.destination_label}.`,
      deepLink: `/rides/${ride.id}`, data: { ride_id: ride.id, booking_id: booking.id },
    });
    await announceRide(ride.id, "ride.updated", await rideOut(updated, null));
    return c.json(one({ booking_id: booking.id, client_secret: null, demo: true, ride: await rideOut(updated, userId) }));
  })

  .post("/rides/:id/location", async (c) => {
    const { location } = await parseBody(c, RideLocationReq);
    const { id: userId, schoolId } = c.var.user;
    const ride = await loadRideRow(parseId(c.req.param("id"), "Ride"), schoolId);
    if (ride.driver_id !== userId) throw new ApiError(403, "FORBIDDEN", "Only the driver shares their location");
    if (ride.status !== "en_route") throw new ApiError(409, "INVALID_STATE", "Location is only shared while the ride is in progress");
    // Latest position only, like handoff pings; the status guard stops a late ping reviving a finished ride's location.
    const data = check(await adminClient().from("rides").update({ driver_lat: location.lat, driver_lng: location.lng, driver_seen_at: new Date().toISOString() })
      .eq("id", ride.id).eq("school_id", schoolId).eq("status", "en_route").select("id").maybeSingle());
    if (!data) throw new ApiError(409, "INVALID_STATE", "This ride just changed; reload it");
    await announceRide(ride.id, "ride.location", { location });
    return c.body(null, 204);
  })

  .post("/rides/:id/status", idempotent(idempotency), async (c) => {
    const { status: action } = await parseBody(c, RideStatusReq);
    const { id: userId, schoolId } = c.var.user;
    const { ride, bookings } = await visibleRide(parseId(c.req.param("id"), "Ride"), userId, schoolId);
    if (ride.driver_id !== userId) throw new ApiError(403, "FORBIDDEN", "Only the driver updates the ride");
    const next = nextRideStatus(ride.status, action, ride.seats_total - ride.seats_left);
    const db = adminClient();

    const ended = next === "completed" || next === "cancelled";
    const data = check(await db.from("rides").update({
      status: next, ...(ended ? { driver_lat: null, driver_lng: null, driver_seen_at: null } : {}),
    }).eq("id", ride.id).eq("school_id", schoolId).eq("status", ride.status).select("*").maybeSingle());
    if (!data) throw new ApiError(409, "INVALID_STATE", "This ride just changed; reload it");
    const updated = RideRow.parse(data);

    if (action === "picked_up") check(await db.from("ride_bookings").update({ status: "picked_up" }).eq("ride_id", ride.id).eq("status", "booked"));
    if (action === "completed") check(await db.from("ride_bookings").update({ status: "completed" }).eq("ride_id", ride.id).in("status", ["booked", "picked_up"]));
    if (action === "cancelled") {
      check(await db.from("ride_bookings").update({ status: "cancelled" }).eq("ride_id", ride.id).neq("status", "cancelled"));
      check(await db.from("ride_bookings").update({ payment_status: "refunded" }).eq("ride_id", ride.id).eq("payment_status", "succeeded"));
      // A request this ride was matched to goes back on the board for other drivers.
      check(await db.from("ride_requests").update({ status: "open", ride_id: null }).eq("ride_id", ride.id).eq("status", "matched"));
    }

    const [title, body] = STATUS_COPY[action];
    await notifyRiders(ride, bookings, title, body);
    await announceRide(ride.id, "ride.updated", await rideOut(updated, null));
    return c.json(one(await rideOut(updated, userId)));
  })

  .post("/ride-requests", async (c) => {
    const input = await parseBody(c, CreateRideRequestReq);
    const { id: userId, schoolId } = c.var.user;
    const now = Date.now();
    const departMs = input.depart_at === "now" ? now : Date.parse(input.depart_at);
    checkDeparture(departMs, now);
    const data = check(await adminClient().from("ride_requests").insert({
      school_id: schoolId, rider_id: userId,
      pickup_label: input.pickup.label, pickup_lat: input.pickup.location.lat, pickup_lng: input.pickup.location.lng,
      dropoff_label: input.dropoff.label, dropoff_lat: input.dropoff.location.lat, dropoff_lng: input.dropoff.location.lng,
      depart_at: new Date(departMs).toISOString(), seats: input.seats, max_price_cents: input.max_price_cents ?? null,
    }).select("*").single());
    const [out] = await rideRequestsOut([RideRequestRow.parse(data)], schoolId);
    if (!out) throw new ApiError(404, "NOT_FOUND", "Profile not found");
    return c.json(one(out), 201);
  })

  .get("/ride-requests/open", async (c) => {
    const { id: userId, schoolId } = c.var.user;
    await requireVerifiedDriver(userId, schoolId);
    const rows = z.array(RideRequestRow).parse(check(await adminClient().from("ride_requests").select("*")
      .eq("school_id", schoolId).eq("status", "open").neq("rider_id", userId)
      .gte("depart_at", new Date(Date.now() - REQUEST_GRACE_MS).toISOString()).order("depart_at").limit(LIST_LIMIT)));
    return c.json(page(await rideRequestsOut(rows, schoolId)));
  })

  .post("/ride-requests/:id/accept", idempotent(idempotency), async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const input = AcceptReq.safeParse(body ?? {});
    if (!input.success) throw new ApiError(400, "VALIDATION", "Invalid request", { price_per_seat_cents: "Must be whole cents, at most 50000" });
    const { id: userId, schoolId } = c.var.user;
    const requestId = parseId(c.req.param("id"), "Ride request");
    await requireVerifiedDriver(userId, schoolId);

    const data = check(await adminClient().from("ride_requests").select("*").eq("id", requestId).eq("school_id", schoolId).maybeSingle());
    if (!data) throw new ApiError(404, "NOT_FOUND", "Ride request not found");
    const request = RideRequestRow.parse(data);
    if (request.rider_id === userId) throw new ApiError(403, "FORBIDDEN", "You can't accept your own request");
    if (request.status !== "open") throw new ApiError(409, "INVALID_STATE", `This request is ${request.status}`);
    if (Date.parse(request.depart_at) + REQUEST_GRACE_MS < Date.now()) throw new ApiError(409, "INVALID_STATE", "This request has expired");
    const price = acceptedPrice(request.max_price_cents, input.data.price_per_seat_cents);
    requirePayments(payments);

    const accepted = await adminClient().rpc("accept_ride_request", {
      p_school_id: schoolId, p_request_id: request.id, p_driver_id: userId, p_price_per_seat_cents: price, p_paid: true,
    });
    if (dbCode(accepted.error) === RAISED) throw new ApiError(409, "INVALID_STATE", "Another driver just took this request");
    const ride = RideRow.parse(check(accepted));

    await notify({
      schoolId, userId: request.rider_id, type: "ride.updated", title: "Driver found",
      body: `A driver accepted your ride to ${request.dropoff_label}.`, deepLink: `/rides/${ride.id}`, data: { ride_id: ride.id, request_id: request.id },
    });
    return c.json(one(await rideOut(ride, userId)));
  });
