import { z } from "zod";
import { Cents, LatLng, Timestamp, Uuid } from "./common.js";
import { GeoPoint } from "./handoffs.js";
import { UserPublic } from "./me.js";

const MAX_SEATS = 8;
const MAX_PRICE_CENTS = 50_000;

const Text = (max: number) => z.string().trim().min(1).max(max);
const Seats = z.number().int().min(1).max(MAX_SEATS);
const Price = Cents.max(MAX_PRICE_CENTS);

export const PlaceIn = z.object({ label: Text(200), location: GeoPoint });

export const DriverReq = z.object({
  vehicle: z.object({ make: Text(50), model: Text(50), color: Text(30), plate: Text(15) }),
  accepts_terms: z.literal(true, { error: "You must accept the driver terms" }),
});
export const DriverRes = z.object({ status: z.enum(["pending", "verified", "rejected"]) });

export const CreateRideReq = z.object({
  origin: PlaceIn, destination: PlaceIn, depart_at: Timestamp, seats: Seats, price_per_seat_cents: Price,
});
export const CreateRideRequestReq = z.object({
  pickup: PlaceIn, dropoff: PlaceIn, depart_at: z.union([z.literal("now"), Timestamp]), seats: Seats, max_price_cents: Price.nullish(),
});
export const RidesQuery = z.object({
  near: z.string().optional(), to_near: z.string().optional(), date: z.iso.date().optional(),
});
export const BookReq = z.object({ seats: Seats, pickup: PlaceIn.nullish() });
// Not in the contract (it has no body): lets the driver name a price at or under the rider's max.
export const AcceptReq = z.object({ price_per_seat_cents: Price.optional() });
export const RideStatusReq = z.object({ status: z.enum(["en_route", "picked_up", "completed", "cancelled"]) });
export const RideLocationReq = z.object({ location: GeoPoint });

export const Place = z.object({ label: z.string(), location: LatLng });
export const Ride = z.object({
  id: Uuid, driver: UserPublic, origin: Place, destination: Place, depart_at: Timestamp,
  seats_total: z.number().int(), seats_left: z.number().int(), price_per_seat_cents: Cents, riders: z.array(UserPublic),
  status: z.enum(["open", "full", "en_route", "completed", "cancelled"]), driver_location: LatLng.nullable(),
});
export const RideRequest = z.object({
  id: Uuid, rider: UserPublic, pickup: Place, dropoff: Place, depart_at: Timestamp, seats: z.number().int(),
  max_price_cents: Cents.nullable(), status: z.enum(["open", "matched", "cancelled"]), ride_id: Uuid.nullable(),
});
export const BookRes = z.object({ booking_id: Uuid, client_secret: z.string().nullable(), demo: z.boolean(), ride: Ride });

export type Ride = z.infer<typeof Ride>;
export type RideRequest = z.infer<typeof RideRequest>;
