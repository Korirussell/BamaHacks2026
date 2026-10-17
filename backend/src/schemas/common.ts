import { z } from "zod";

// Shared primitives from docs/API_CONTRACT.md → Shared objects.
// Any 8-4-4-4-12 hex id: Postgres accepts it, and the seed uses non-RFC ids like ...-e000-... .
export const Uuid = z.guid({ error: "Invalid UUID" });
export const Timestamp = z.iso.datetime();
export const Cents = z.number().int().nonnegative();

export const LatLng = z.object({ lat: z.number(), lng: z.number() });
export const Place = z.object({ label: z.string(), location: LatLng });

export const School = z.object({
  id: Uuid,
  name: z.string(),
  domain: z.string(),
  center: LatLng,
  timezone: z.string(),
  campus_mail_supported: z.boolean(),
  tutor_min_grade: z.string(),
});

export const PageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type LatLng = z.infer<typeof LatLng>;
export type Place = z.infer<typeof Place>;
export type School = z.infer<typeof School>;
