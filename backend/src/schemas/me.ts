import { z } from "zod";
import { Cents, School, Uuid } from "./common.js";

export const Reliability = z.object({
  score: z.number(),
  completed: z.number().int(),
  no_shows: z.number().int(),
  badge: z.enum(["new", "reliable", "top"]),
});

export const UserPublic = z.object({
  id: Uuid,
  display_name: z.string(),
  avatar_url: z.string().nullable(),
  major: z.string().nullable(),
  grad_year: z.number().int().nullable(),
  school: School,
  reliability: Reliability,
  is_friend: z.boolean(),
  mutual_friend_count: z.number().int(),
  can_receive_payments: z.boolean(),
  is_verified_driver: z.boolean(),
});

export const Me = z.object({
  user: UserPublic,
  email: z.email(),
  phone: z.string().nullable(),
  budget_cents: Cents.nullable(),
  mail_stop_code: z.string().nullable(),
  tutor_opt_in: z.boolean(),
  location_sharing: z.enum(["off", "during_handoffs"]),
  notification_prefs: z.object({
    push: z.boolean(),
    email: z.boolean(),
    wishlist_alerts: z.boolean(),
    tutor_requests: z.boolean(),
  }),
  connections: z.object({ google_calendar: z.boolean(), stripe: z.enum(["none", "pending", "ready"]) }),
  onboarding: z.object({
    profile: z.boolean(),
    transcript: z.boolean(),
    calendar: z.boolean(),
    payments: z.boolean(),
  }),
});

export const PatchMeReq = z.object({
  display_name: z.string().optional(),
  major: z.string().optional(),
  grad_year: z.number().int().optional(),
  avatar_media_id: Uuid.optional(),
  phone: z.string().optional(),
  budget_cents: Cents.optional(),
  mail_stop_code: z.string().optional(),
  tutor_opt_in: z.boolean().optional(),
  location_sharing: z.enum(["off", "during_handoffs"]).optional(),
  notification_prefs: z
    .object({
      push: z.boolean().optional(),
      email: z.boolean().optional(),
      wishlist_alerts: z.boolean().optional(),
      tutor_requests: z.boolean().optional(),
    })
    .optional(),
});

export const CheckEmailRes = z.object({
  allowed: z.boolean(),
  school: School.nullable(),
  reason: z.enum(["NOT_EDU_EMAIL", "SCHOOL_NOT_SUPPORTED"]).nullable(),
});

export type Reliability = z.infer<typeof Reliability>;
export type UserPublic = z.infer<typeof UserPublic>;
export type Me = z.infer<typeof Me>;
export type PatchMeReq = z.infer<typeof PatchMeReq>;
export type CheckEmailRes = z.infer<typeof CheckEmailRes>;
