import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { adminClient } from "../lib/supabase.js";
import { Handoff, MeetupSuggestion, SafeZone } from "../schemas/handoffs.js";
import { DropOffPoint, Shipment } from "../schemas/orders.js";
import { OpeningHoursRow } from "./academics.js";
import type { UserPublicOut } from "./users.js";
import { campusAddressLines, dropOffSteps } from "../services/shipping.js";
import { mayShareDistance, readZone, tapStillValid, type Party } from "../services/handoff.js";

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
  // Live tracking (0010). Defaults keep rows from before the migration parseable.
  giver_lat: z.number().nullable().default(null), giver_lng: z.number().nullable().default(null),
  giver_accuracy_m: z.number().nullable().default(null), giver_seen_at: tsNull.default(null),
  receiver_lat: z.number().nullable().default(null), receiver_lng: z.number().nullable().default(null),
  receiver_accuracy_m: z.number().nullable().default(null), receiver_seen_at: tsNull.default(null),
  giver_arrived_at: tsNull.default(null), receiver_arrived_at: tsNull.default(null),
  giver_tap_at: tsNull.default(null), giver_tap_lat: z.number().nullable().default(null), giver_tap_lng: z.number().nullable().default(null),
  giver_tap_accuracy_m: z.number().nullable().default(null),
  receiver_tap_at: tsNull.default(null), receiver_tap_lat: z.number().nullable().default(null), receiver_tap_lng: z.number().nullable().default(null),
  receiver_tap_accuracy_m: z.number().nullable().default(null), receiver_tap_item_ok: z.boolean().nullable().default(null),
  no_show_party: z.enum(["giver", "receiver"]).nullable().default(null), overdue_notified_at: tsNull.default(null),
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

/** Columns nulled when a handoff ends (completed / no_show / cancelled / expired): no positions are kept. */
export const WIPE_POSITIONS = {
  giver_lat: null, giver_lng: null, giver_accuracy_m: null, receiver_lat: null, receiver_lng: null, receiver_accuracy_m: null,
  giver_tap_lat: null, giver_tap_lng: null, giver_tap_accuracy_m: null,
  receiver_tap_lat: null, receiver_tap_lng: null, receiver_tap_accuracy_m: null,
} as const;

/** Everything cleared when a handoff goes back to `proposing` for a new time. */
export const RESET_FOR_RESCHEDULE = {
  ...WIPE_POSITIONS, status: "proposing", proposed_by: null, proposed_start: null, proposed_zone_id: null,
  agreed_start: null, agreed_end: null, safe_zone_id: null, giver_nearby: false, receiver_nearby: false,
  giver_seen_at: null, receiver_seen_at: null, giver_arrived_at: null, receiver_arrived_at: null, giver_at: null, receiver_at: null,
  giver_tap_at: null, receiver_tap_at: null, receiver_tap_item_ok: null, overdue_notified_at: null,
} as const;

export type LocationSharing = "off" | "during_handoffs";
export interface Viewer { id: string; now: number; sharing: Map<string, LocationSharing> }

const ms = (v: string | null) => (v === null ? null : Date.parse(v));

/** Viewer-relative tracking: own distance/inside, and only distance + arrived for the other party. */
export function trackingFor(row: HandoffRow, viewer: Viewer | null) {
  const mine: Party = viewer?.id === row.giver_id ? "giver" : "receiver";
  const theirs: Party = mine === "giver" ? "receiver" : "giver";
  const live = row.status === "agreed" || row.status === "arriving";
  const zone = row.safe_zone ? { location: { lat: row.safe_zone.lat, lng: row.safe_zone.lng }, radiusM: row.safe_zone.radius_m } : null;
  const pos = (who: Party) => {
    const lat = who === "giver" ? row.giver_lat : row.receiver_lat;
    const lng = who === "giver" ? row.giver_lng : row.receiver_lng;
    const acc = who === "giver" ? row.giver_accuracy_m : row.receiver_accuracy_m;
    return lat === null || lng === null || acc === null ? null : { location: { lat, lng }, accuracyM: acc };
  };
  const otherNearby = theirs === "giver" ? row.giver_nearby : row.receiver_nearby;
  if (!viewer) return { me: null, other: { arrived: otherNearby, distance_m: null, last_seen_at: null } };

  const myFix = pos(mine);
  const me = live && zone && myFix
    ? (() => { const r = readZone(myFix, zone); return { inside_zone: r.inside, distance_to_zone_m: r.distanceToZoneM, accuracy_ok: r.accuracyOk }; })()
    : null;
  const theirFix = pos(theirs);
  const shared = live && mayShareDistance({
    status: row.status, now: viewer.now, agreedStart: ms(row.agreed_start), agreedEnd: ms(row.agreed_end),
    sharerSetting: viewer.sharing.get(theirs === "giver" ? row.giver_id : row.receiver_id) ?? "off",
  });
  const reading = shared && zone && theirFix ? readZone(theirFix, zone) : null;
  const seen = theirs === "giver" ? row.giver_seen_at : row.receiver_seen_at;
  return { me, other: { arrived: otherNearby, distance_m: reading?.distanceToZoneM ?? null, last_seen_at: shared ? seen : null } };
}

export function toHandoff(row: HandoffRow, users: Map<string, UserPublicOut>, viewer: Viewer | null = null) {
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
    tracking: trackingFor(row, viewer),
    taps: {
      giver_at: tapStillValid(ms(row.giver_tap_at), viewer?.now ?? Date.now()) || row.status === "completed" ? row.giver_tap_at : null,
      receiver_at: tapStillValid(ms(row.receiver_tap_at), viewer?.now ?? Date.now()) || row.status === "completed" ? row.receiver_tap_at : null,
    },
  });
}

export const toShipment = (row: ShipmentRow) => Shipment.parse({
  id: row.id, order_id: row.order_id, label_pdf_url: `about:blank#label-${row.label_code}`, label_code: row.label_code,
  to: { name: row.to_name, mail_stop_code: row.to_mail_stop_code, address_lines: campusAddressLines(row.to_name, row.to_mail_stop_code) },
  steps: dropOffSteps({ labelCode: row.label_code, dropOffName: row.drop_off.name, hours: row.drop_off.hours }),
  drop_off: toDropOffPoint(row.drop_off),
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

/** Writes a handoff change only if nobody else changed it since we read it. */
export async function saveHandoff(handoff: HandoffRow, patch: Record<string, unknown>) {
  const { data, error } = await adminClient().from("handoffs").update(patch)
    .eq("id", handoff.id).eq("school_id", handoff.school_id).eq("updated_at", handoff.updated_at)
    .select(HANDOFF_SELECT).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(409, "INVALID_STATE", "This handoff just changed; reload it");
  return HandoffRow.parse(data);
}

/** Each party's profile location-sharing setting. */
export async function loadSharing(ids: string[], schoolId: string): Promise<Map<string, LocationSharing>> {
  const { data, error } = await adminClient().from("profiles").select("id, location_sharing").eq("school_id", schoolId).in("id", ids);
  if (error) throw error;
  const rows = z.array(z.object({ id: z.guid(), location_sharing: z.enum(["off", "during_handoffs"]) })).parse(data);
  return new Map(rows.map((r) => [r.id, r.location_sharing]));
}
