import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { broadcast } from "../lib/realtime.js";
import { adminClient } from "../lib/supabase.js";
import { Ride, RideRequest } from "../schemas/rides.js";
import { loadUsersPublic, type UserPublicOut } from "./users.js";

export const DriverRow = z.object({ user_id: z.guid(), school_id: z.guid(), status: z.enum(["pending", "verified", "rejected"]) });

export const RideRow = z.object({
  id: z.guid(), school_id: z.guid(), driver_id: z.guid(),
  origin_label: z.string(), origin_lat: z.number(), origin_lng: z.number(),
  destination_label: z.string(), destination_lat: z.number(), destination_lng: z.number(),
  depart_at: z.string(), seats_total: z.number().int(), seats_left: z.number().int(), price_per_seat_cents: z.number().int(),
  status: z.enum(["open", "full", "en_route", "completed", "cancelled"]),
  driver_lat: z.number().nullable(), driver_lng: z.number().nullable(),
});
export type RideRow = z.infer<typeof RideRow>;

export const RideRequestRow = z.object({
  id: z.guid(), school_id: z.guid(), rider_id: z.guid(),
  pickup_label: z.string(), pickup_lat: z.number(), pickup_lng: z.number(),
  dropoff_label: z.string(), dropoff_lat: z.number(), dropoff_lng: z.number(),
  depart_at: z.string(), seats: z.number().int(), max_price_cents: z.number().int().nullable(),
  status: z.enum(["open", "matched", "cancelled"]), ride_id: z.guid().nullable(),
});
export type RideRequestRow = z.infer<typeof RideRequestRow>;

export const BookingRow = z.object({
  id: z.guid(), ride_id: z.guid(), rider_id: z.guid(), seats: z.number().int(),
  status: z.enum(["booked", "picked_up", "completed", "cancelled"]),
  payment_status: z.enum(["requires_payment", "succeeded", "refunded"]),
});
export type BookingRow = z.infer<typeof BookingRow>;

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

const iso = (ts: string) => new Date(ts).toISOString();

export async function loadDriver(userId: string, schoolId: string) {
  const data = check(await adminClient().from("drivers").select("user_id, school_id, status").eq("user_id", userId).eq("school_id", schoolId).maybeSingle());
  return data ? DriverRow.parse(data) : null;
}

export async function requireVerifiedDriver(userId: string, schoolId: string) {
  const driver = await loadDriver(userId, schoolId);
  if (driver?.status !== "verified") throw new ApiError(403, "FORBIDDEN", "Only verified drivers can do this; sign up with PUT /me/driver");
  return driver;
}

export async function loadRideRow(id: string, schoolId: string) {
  const data = check(await adminClient().from("rides").select("*").eq("id", id).eq("school_id", schoolId).maybeSingle());
  if (!data) throw new ApiError(404, "NOT_FOUND", "Ride not found");
  return RideRow.parse(data);
}

/** Live (not cancelled) bookings per ride. */
export async function loadBookings(rideIds: string[], schoolId: string) {
  const out = new Map<string, BookingRow[]>();
  if (!rideIds.length) return out;
  const data = check(await adminClient().from("ride_bookings").select("id, ride_id, rider_id, seats, status, payment_status")
    .eq("school_id", schoolId).in("ride_id", rideIds).neq("status", "cancelled").order("created_at"));
  for (const b of z.array(BookingRow).parse(data)) out.set(b.ride_id, [...(out.get(b.ride_id) ?? []), b]);
  return out;
}

export const isParty = (ride: RideRow, bookings: BookingRow[], userId: string) =>
  ride.driver_id === userId || bookings.some((b) => b.rider_id === userId);

const asDriver = (u: UserPublicOut): UserPublicOut => ({ ...u, is_verified_driver: true });

/**
 * Ride for `viewerId`: riders and the driver's live location are only shown to the ride's
 * driver and riders. `viewerId: null` is the neutral copy broadcast on `ride:{id}` (no location).
 */
export async function ridesOut(rows: RideRow[], schoolId: string, viewerId: string | null): Promise<Ride[]> {
  const bookings = await loadBookings(rows.map((r) => r.id), schoolId);
  const users = await loadUsersPublic(rows.flatMap((r) => [r.driver_id, ...(bookings.get(r.id) ?? []).map((b) => b.rider_id)]), schoolId);
  return rows.flatMap((r) => {
    const driver = users.get(r.driver_id);
    if (!driver) return [];
    const rideBookings = bookings.get(r.id) ?? [];
    const party = viewerId === null || isParty(r, rideBookings, viewerId);
    const showLocation = viewerId !== null && party && r.status === "en_route" && r.driver_lat !== null && r.driver_lng !== null;
    return [Ride.parse({
      id: r.id, driver: asDriver(driver),
      origin: { label: r.origin_label, location: { lat: r.origin_lat, lng: r.origin_lng } },
      destination: { label: r.destination_label, location: { lat: r.destination_lat, lng: r.destination_lng } },
      depart_at: iso(r.depart_at), seats_total: r.seats_total, seats_left: r.seats_left, price_per_seat_cents: r.price_per_seat_cents,
      riders: party ? rideBookings.flatMap((b) => users.get(b.rider_id) ?? []) : [],
      status: r.status,
      driver_location: showLocation ? { lat: r.driver_lat, lng: r.driver_lng } : null,
    })];
  });
}

export async function rideOut(row: RideRow, viewerId: string | null): Promise<Ride> {
  const [ride] = await ridesOut([row], row.school_id, viewerId);
  if (!ride) throw new ApiError(404, "NOT_FOUND", "Ride not found");
  return ride;
}

export async function rideRequestsOut(rows: RideRequestRow[], schoolId: string): Promise<RideRequest[]> {
  const users = await loadUsersPublic(rows.map((r) => r.rider_id), schoolId);
  return rows.flatMap((r) => {
    const rider = users.get(r.rider_id);
    if (!rider) return [];
    return [RideRequest.parse({
      id: r.id, rider,
      pickup: { label: r.pickup_label, location: { lat: r.pickup_lat, lng: r.pickup_lng } },
      dropoff: { label: r.dropoff_label, location: { lat: r.dropoff_lat, lng: r.dropoff_lng } },
      depart_at: iso(r.depart_at), seats: r.seats, max_price_cents: r.max_price_cents, status: r.status, ride_id: r.ride_id,
    })];
  });
}

export const announceRide = (rideId: string, event: "ride.location" | "ride.updated", payload: object) => broadcast(`ride:${rideId}`, event, payload);
