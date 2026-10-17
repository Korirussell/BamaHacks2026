import { z } from "zod";

// Row shapes as Supabase returns them (snake_case, flat). Parsing keeps `any` from the untyped
// client out of the routes. Replace with `supabase gen types` output once the project exists.

export const SchoolRow = z.object({
  id: z.guid(),
  name: z.string(),
  domain: z.string(),
  center_lat: z.number(),
  center_lng: z.number(),
  timezone: z.string(),
  campus_mail_supported: z.boolean(),
  tutor_min_grade: z.string(),
});
export type SchoolRow = z.infer<typeof SchoolRow>;

export const ProfileRow = z.object({
  id: z.guid(),
  school_id: z.guid(),
  email: z.string(),
  display_name: z.string(),
  major: z.string().nullable(),
  grad_year: z.number().int().nullable(),
  phone: z.string().nullable(),
  budget_cents: z.number().int().nullable(),
  mail_stop_code: z.string().nullable(),
  mail_name: z.string().nullish(),
  tutor_opt_in: z.boolean(),
  location_sharing: z.enum(["off", "during_handoffs"]),
  notification_prefs: z.object({
    push: z.boolean(),
    email: z.boolean(),
    wishlist_alerts: z.boolean(),
    tutor_requests: z.boolean(),
  }),
  stripe_status: z.enum(["none", "pending", "ready"]),
  payouts_enabled: z.boolean(),
  google_connected: z.boolean(),
  completed_count: z.number().int(),
  no_show_count: z.number().int(),
});
export type ProfileRow = z.infer<typeof ProfileRow>;

export const MediaRef = z.object({ bucket: z.string(), path: z.string() });
