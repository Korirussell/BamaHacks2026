import { z } from "zod";

// Shared primitives from docs/API_CONTRACT.md → Shared objects.
export const Uuid = z.uuid();
export const Timestamp = z.iso.datetime();
export const Cents = z.number().int().nonnegative();

export const LatLng = z.object({ lat: z.number(), lng: z.number() });
export const Place = z.object({ label: z.string(), location: LatLng });

export const School = z.object({
  id: Uuid,
  name: z.string(),
  domain: z.string(),
  center: LatLng,
  campus_mail_supported: z.boolean(),
});

export const PageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type LatLng = z.infer<typeof LatLng>;
export type Place = z.infer<typeof Place>;
export type School = z.infer<typeof School>;
