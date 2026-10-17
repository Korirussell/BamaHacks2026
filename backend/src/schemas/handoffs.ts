import { z } from "zod";
import { LatLng, Timestamp, Uuid } from "./common.js";
import { UserPublic } from "./me.js";
import { OpeningHours } from "./orders.js";

export const SafeZone = z.object({ id: Uuid, name: z.string(), kind: z.enum(["police", "student_center", "library", "other"]), location: LatLng, radius_m: z.number().int(), hours: z.array(OpeningHours), hours_note: z.string().nullable() });
export const MeetupSuggestion = z.object({
  start: Timestamp, end: Timestamp, safe_zone: SafeZone, walk_minutes: z.object({ me: z.number().int(), them: z.number().int() }),
  context: z.object({ me: z.object({ before: z.string().nullable(), after: z.string().nullable() }), them: z.object({ before: z.string().nullable(), after: z.string().nullable() }) }), reason: z.string(), score: z.number(),
});
export const Handoff = z.object({
  id: Uuid, context: z.object({ type: z.enum(["order", "tutoring_session"]), id: Uuid }), parties: z.object({ giver: UserPublic, receiver: UserPublic }), suggestions: z.array(MeetupSuggestion),
  agreed: z.object({ start: Timestamp, end: Timestamp, safe_zone: SafeZone }).nullable(), status: z.enum(["proposing", "agreed", "arriving", "completed", "no_show", "cancelled", "expired"]),
  presence: z.object({ giver_nearby: z.boolean(), receiver_nearby: z.boolean() }), confirmations: z.object({ giver_at: Timestamp.nullable(), receiver_at: Timestamp.nullable(), item_ok: z.boolean().nullable() }),
});
export const ProposeReq = z.object({ start: Timestamp, safe_zone_id: Uuid });
export const AgreeReq = ProposeReq;
export const LocationReq = z.object({ location: LatLng, accuracy_m: z.number().int() });
export const CodeReq = LocationReq;
export const CodeRes = z.object({ qr_token: z.string(), short_code: z.string(), expires_at: Timestamp });
export const ConfirmReq = z.object({ qr_token: z.string().optional(), short_code: z.string().optional(), location: LatLng, accuracy_m: z.number().int(), item_ok: z.boolean() });

export type SafeZone = z.infer<typeof SafeZone>;
export type MeetupSuggestion = z.infer<typeof MeetupSuggestion>;
export type Handoff = z.infer<typeof Handoff>;
export type ProposeReq = z.infer<typeof ProposeReq>;
export type AgreeReq = z.infer<typeof AgreeReq>;
export type LocationReq = z.infer<typeof LocationReq>;
export type CodeReq = z.infer<typeof CodeReq>;
export type CodeRes = z.infer<typeof CodeRes>;
export type ConfirmReq = z.infer<typeof ConfirmReq>;
