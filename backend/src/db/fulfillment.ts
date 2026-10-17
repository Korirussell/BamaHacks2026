import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { adminClient } from "../lib/supabase.js";
import { Handoff, MeetupSuggestion, SafeZone } from "../schemas/handoffs.js";
import { DropOffPoint, Shipment } from "../schemas/orders.js";
import { OpeningHoursRow } from "./academics.js";
import type { UserPublicOut } from "./users.js";

// Postgres returns "+00:00" offsets; the contract's Timestamp wants "Z".
const ts = z.string().transform((v) => new Date(v).toISOString());
const tsNull = ts.nullable();

export const SafeZoneRow = z.object({
  id: z.guid(), school_id: z.guid(), name: z.string(), kind: z.enum(["police", "student_center", "library", "other"]),
  lat: z.number(), lng: z.number(), radius_m: z.number().int(), hours: z.array(OpeningHoursRow), hours_note: z.string().nullable(),
  active: z.boolean(),
});
export type SafeZoneRow = z.infer<typeof SafeZoneRow>;

export const DropOffPointRow = z.object({
  id: z.guid(), school_id: z.guid(), name: z.string(), lat: z.number(), lng: z.number(), radius_m: z.number().int(),
  hours: z.array(OpeningHoursRow), instructions: z.string(), active: z.boolean(),
});
export type DropOffPointRow = z.infer<typeof DropOffPointRow>;

export const HandoffRow = z.object({
  id: z.guid(), school_id: z.guid(), context_type: z.enum(["order", "tutoring_session"]), context_id: z.guid(),
  giver_id: z.guid(), receiver_id: z.guid(), suggestions: z.array(MeetupSuggestion).catch([]),
  proposed_by: z.guid().nullable(), proposed_start: tsNull, proposed_zone_id: z.guid().nullable(),
  agreed_start: tsNull, agreed_end: tsNull, safe_zone_id: z.guid().nullable(),
  status: z.enum(["proposing", "agreed", "arriving", "completed", "no_show", "cancelled", "expired"]),
  giver_nearby: z.boolean(), receiver_nearby: z.boolean(), giver_at: tsNull, receiver_at: tsNull, item_ok: z.boolean().nullable(),
  updated_at: z.string(), safe_zone: SafeZoneRow.nullable(),
});
export type HandoffRow = z.infer<typeof HandoffRow>;

export const ShipmentRow = z.object({
  id: z.guid(), school_id: z.guid(), order_id: z.guid(), label_code: z.string(), label_media_id: z.guid().nullable(),
  to_name: z.string(), to_mail_stop_code: z.string(), drop_off_point_id: z.guid(),
  status: z.enum(["label_created", "dropped_off", "received"]), dropped_off_at: tsNull, drop_off_proof_media_id: z.guid().nullable(),
  received_at: tsNull, auto_complete_at: tsNull, drop_off: DropOffPointRow,
});
export type ShipmentRow = z.infer<typeof ShipmentRow>;

export const HANDOFF_SELECT = "*, safe_zone:safe_zones!handoffs_safe_zone_id_fkey(*)";
export const SHIPMENT_SELECT = "*, drop_off:drop_off_points(*)";

export const toSafeZone = (row: SafeZoneRow) => SafeZone.parse({
  id: row.id, name: row.name, kind: row.kind, location: { lat: row.lat, lng: row.lng },
  radius_m: row.radius_m, hours: row.hours, hours_note: row.hours_note,
});

export const toDropOffPoint = (row: DropOffPointRow) => DropOffPoint.parse({
  id: row.id, name: row.name, location: { lat: row.lat, lng: row.lng },
  radius_m: row.radius_m, hours: row.hours, instructions: row.instructions,
});

export function toHandoff(row: HandoffRow, users: Map<string, UserPublicOut>) {
  const giver = users.get(row.giver_id);
  const receiver = users.get(row.receiver_id);
  if (!giver || !receiver) throw new Error(`Handoff ${row.id} references missing users`);
  const agreed = row.safe_zone && row.agreed_start && row.agreed_end
    ? { start: row.agreed_start, end: row.agreed_end, safe_zone: toSafeZone(row.safe_zone) }
    : null;
  return Handoff.parse({
    id: row.id,
    context: { type: row.context_type, id: row.context_id },
    parties: { giver, receiver },
    suggestions: row.suggestions,
    agreed,
    status: row.status,
    presence: { giver_nearby: row.giver_nearby, receiver_nearby: row.receiver_nearby },
    confirmations: { giver_at: row.giver_at, receiver_at: row.receiver_at, item_ok: row.item_ok },
  });
}

export const toShipment = (row: ShipmentRow) => Shipment.parse({
  id: row.id, order_id: row.order_id, label_pdf_url: `about:blank#label-${row.label_code}`, label_code: row.label_code,
  to: { name: row.to_name, mail_stop_code: row.to_mail_stop_code }, drop_off: toDropOffPoint(row.drop_off),
  status: row.status, dropped_off_at: row.dropped_off_at, drop_off_proof_media_id: row.drop_off_proof_media_id,
  received_at: row.received_at, auto_complete_at: row.auto_complete_at,
});

/** A handoff the user is a party to (giver or receiver), else 404. */
export async function loadHandoffRow(id: string, userId: string, schoolId: string): Promise<HandoffRow> {
  const { data, error } = await adminClient().from("handoffs").select(HANDOFF_SELECT)
    .eq("school_id", schoolId).eq("id", id).maybeSingle();
  if (error) throw error;
  const row = data ? HandoffRow.parse(data) : null;
  if (!row || (row.giver_id !== userId && row.receiver_id !== userId)) throw new ApiError(404, "NOT_FOUND", "Handoff not found");
  return row;
}
