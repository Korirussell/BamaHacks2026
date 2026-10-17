import { z } from "zod";
import { Cents, LatLng, Timestamp, Uuid } from "./common.js";
import { Listing } from "./listings.js";
import { UserPublic } from "./me.js";
import { WallTime, Weekday } from "./schedule.js";

export const OpeningHours = z.object({ days: z.array(Weekday).min(1), open: WallTime, close: WallTime });
export const DropOffPoint = z.object({ id: Uuid, name: z.string(), location: LatLng, radius_m: z.number().int(), hours: z.array(OpeningHours), instructions: z.string() });
export const Shipment = z.object({
  id: Uuid, order_id: Uuid, label_pdf_url: z.string(), label_code: z.string(), to: z.object({ name: z.string(), mail_stop_code: z.string(), address_lines: z.array(z.string()) }), steps: z.array(z.string()),
  drop_off: DropOffPoint, status: z.enum(["label_created", "dropped_off", "received"]), dropped_off_at: Timestamp.nullable(),
  drop_off_proof_media_id: Uuid.nullable(), received_at: Timestamp.nullable(), auto_complete_at: Timestamp.nullable(),
});
export const Order = z.object({
  id: Uuid, listing: Listing, buyer: UserPublic, seller: UserPublic, offer_id: Uuid.nullable(), amount_cents: Cents, fee_cents: Cents, seller_payout_cents: Cents,
  fulfillment: z.enum(["in_person", "campus_mail", "digital_transfer"]), status: z.enum(["awaiting_payment", "paid", "scheduled", "handing_off", "in_transit", "completed", "cancelled", "disputed", "refunded"]),
  payment: z.object({ status: z.enum(["requires_payment", "succeeded", "failed", "refunded"]), paid_at: Timestamp.nullable() }),
  payout: z.object({ status: z.enum(["held", "awaiting_onboarding", "released", "reversed"]), released_at: Timestamp.nullable() }),
  handoff_id: Uuid.nullable(), shipment: Shipment.nullable(), created_at: Timestamp,
});
export const CreateShipmentReq = z.object({ drop_off_point_id: Uuid.optional() });
export const DroppedOffReq = z.object({ location: LatLng, accuracy_m: z.number().int(), photo_media_id: Uuid });
export const ReceivedReq = z.object({ label_code: z.string(), item_ok: z.boolean() });
export const DisputeReq = z.object({
  reason: z.enum(["not_as_described", "no_show", "never_received", "other"]),
  details: z.string().trim().min(1).max(1000),
  media_ids: z.array(Uuid).max(10).default([]),
});
// The body is optional: no body means no proof screenshot.
export const TicketSentReq = z.object({ proof_media_id: Uuid.optional() }).nullable().transform((v) => ({ proof_media_id: v?.proof_media_id }));
export const ResolveReq = z.object({ outcome: z.enum(["complete", "refund"]), note: z.string().trim().min(1).max(1000) });
export const EscrowEntry = z.object({
  kind: z.enum(["hold", "release", "refund"]), amount_cents: Cents, provider: z.enum(["demo", "stripe"]), created_at: Timestamp, reason: z.string().nullable(),
});
export const EscrowRes = z.object({ entries: z.array(EscrowEntry), held_cents: Cents });
export const ReceivedRes = z.object({ shipment: Shipment, order: Order });

export type OpeningHours = z.infer<typeof OpeningHours>;
export type DropOffPoint = z.infer<typeof DropOffPoint>;
export type Shipment = z.infer<typeof Shipment>;
export type Order = z.infer<typeof Order>;
export type CreateShipmentReq = z.infer<typeof CreateShipmentReq>;
export type DroppedOffReq = z.infer<typeof DroppedOffReq>;
export type ReceivedReq = z.infer<typeof ReceivedReq>;
export type ReceivedRes = z.infer<typeof ReceivedRes>;
export type DisputeReq = z.infer<typeof DisputeReq>;
export type ResolveReq = z.infer<typeof ResolveReq>;
export type EscrowEntry = z.infer<typeof EscrowEntry>;
export type EscrowRes = z.infer<typeof EscrowRes>;
