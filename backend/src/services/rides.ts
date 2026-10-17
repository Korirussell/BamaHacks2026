import { ApiError } from "../lib/errors.js";
import type { LatLng } from "../schemas/common.js";
import { addDays, MINUTE, zonedToUtc } from "./time.js";

export type RideStatus = "open" | "full" | "en_route" | "completed" | "cancelled";
export type RideAction = "en_route" | "picked_up" | "completed" | "cancelled";
export type DriverStatus = "pending" | "verified" | "rejected";

/** Riders can still book a ride this long after its departure time (drivers run late). */
export const BOOKING_GRACE_MS = 15 * MINUTE;
/** Drivers can still take a request this long after its departure time ("now" requests age fast). */
export const REQUEST_GRACE_MS = 60 * MINUTE;
/** GET /rides `near` / `to_near` radius. */
export const NEAR_RADIUS_M = 3000;

// picked_up keeps the ride en_route and moves its bookings along.
const TRANSITIONS: Record<RideStatus, Partial<Record<RideAction, RideStatus>>> = {
  open: { en_route: "en_route", cancelled: "cancelled" },
  full: { en_route: "en_route", cancelled: "cancelled" },
  en_route: { picked_up: "en_route", completed: "completed", cancelled: "cancelled" },
  completed: {},
  cancelled: {},
};

export function nextRideStatus(current: RideStatus, action: RideAction, bookedSeats: number): RideStatus {
  const next = TRANSITIONS[current][action];
  if (!next) throw new ApiError(409, "INVALID_STATE", `Can't mark a ${current} ride ${action}`);
  if (action === "en_route" && bookedSeats === 0) throw new ApiError(409, "INVALID_STATE", "Nobody has booked this ride yet");
  return next;
}

/** Seats and status after `seats` are booked; the DB repeats this atomically in book_ride. */
export function seatsAfterBooking(seatsLeft: number, seats: number): { seats_left: number; status: "open" | "full" } {
  if (!Number.isInteger(seats) || seats < 1) throw new ApiError(400, "VALIDATION", "Invalid request", { seats: "Book at least one seat" });
  const left = seatsLeft - seats;
  if (left < 0) throw new ApiError(409, "INVALID_STATE", seatsLeft ? `Only ${seatsLeft} seat${seatsLeft === 1 ? "" : "s"} left` : "This ride is full");
  return { seats_left: left, status: left === 0 ? "full" : "open" };
}

export interface BookableRide { driver_id: string; status: RideStatus; seats_left: number; depart_at: string }

/** Everything POST /rides/{id}/book checks before taking seats. */
export function checkBooking(ride: BookableRide, riderId: string, seats: number, now: number) {
  if (ride.driver_id === riderId) throw new ApiError(403, "FORBIDDEN", "You can't book your own ride");
  if (ride.status !== "open") throw new ApiError(409, "INVALID_STATE", ride.status === "full" ? "This ride is full" : `This ride is ${ride.status}`);
  if (Date.parse(ride.depart_at) + BOOKING_GRACE_MS < now) throw new ApiError(409, "INVALID_STATE", "This ride already left");
  return seatsAfterBooking(ride.seats_left, seats);
}

/** Per-seat price when a driver takes a request: their price (capped by the rider's max) or the rider's max, else free. */
export function acceptedPrice(maxPriceCents: number | null, offeredCents: number | undefined): number {
  if (offeredCents === undefined) return maxPriceCents ?? 0;
  if (maxPriceCents !== null && offeredCents > maxPriceCents) {
    throw new ApiError(400, "VALIDATION", "Invalid request", { price_per_seat_cents: `The rider pays at most ${maxPriceCents} cents per seat` });
  }
  return offeredCents;
}

/** Rejected drivers stay rejected; otherwise demo mode verifies on sign-up and real mode waits for review. */
export function driverStatusAfterUpdate(previous: DriverStatus | null, autoVerify: boolean): DriverStatus {
  if (previous === "rejected") return "rejected";
  return autoVerify ? "verified" : "pending";
}

/** "lat,lng" query value → LatLng, or null when it's malformed or out of range. */
export function parseLatLng(raw: string): LatLng | null {
  const parts = raw.split(",");
  if (parts.length !== 2) return null;
  const [lat, lng] = parts.map((p) => (p.trim() === "" ? NaN : Number(p))) as [number, number];
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** [start, end) in UTC ms of a local calendar day in `tz`. */
export function localDayBounds(date: string, tz: string): { start: number; end: number } {
  return { start: zonedToUtc(date, "00:00", tz), end: zonedToUtc(addDays(date, 1), "00:00", tz) };
}
