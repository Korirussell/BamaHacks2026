import { Hono } from "hono";
import { z } from "zod";
import { toUserPublic } from "../db/mappers.js";
import { MediaRef, ProfileRow, SchoolRow } from "../db/rows.js";
import { ApiError } from "../lib/errors.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";
import { normalizeMsc } from "../services/shipping.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";

const MeRow = ProfileRow.extend({ school: SchoolRow, avatar: MediaRef.nullable() });

async function loadMe(userId: string) {
  const db = adminClient();
  const [profile, transcripts, meetings] = await Promise.all([
    db.from("profiles")
      .select("*, school:schools(*), avatar:media!profiles_avatar_media_fk(bucket, path)")
      .eq("id", userId).maybeSingle(),
    db.from("class_records").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("grade_source", "transcript"),
    db.from("class_meetings").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  for (const r of [profile, transcripts, meetings]) if (r.error) throw r.error;
  if (!profile.data) throw new ApiError(404, "NOT_FOUND", "Profile not set up yet");
  const p = MeRow.parse(profile.data);
  return {
    user: toUserPublic(p, p.school, p.avatar),
    email: p.email,
    phone: p.phone,
    budget_cents: p.budget_cents,
    mail_stop_code: p.mail_stop_code,
    mail_name: p.mail_name ?? null,
    tutor_opt_in: p.tutor_opt_in,
    location_sharing: p.location_sharing,
    notification_prefs: p.notification_prefs,
    connections: { google_calendar: p.google_connected, stripe: p.stripe_status },
    onboarding: {
      profile: p.display_name.trim() !== "",
      transcript: (transcripts.count ?? 0) > 0,
      calendar: p.google_connected || (meetings.count ?? 0) > 0,
      payments: p.stripe_status === "ready",
    },
  };
}

export type Me = Awaited<ReturnType<typeof loadMe>>;

// Kept here until the shared request schemas land in schemas/me.ts.
const PatchMeReq = z.object({
  display_name: z.string().trim().min(1).max(80),
  major: z.string().max(80).nullable(),
  grad_year: z.number().int().min(1990).max(2100).nullable(),
  phone: z.string().max(32).nullable(),
  budget_cents: z.number().int().min(0).nullable(),
  // UA mailstop code: 6 digits (myBama → Campus Mail Student Portal). "MSC 123456" is accepted.
  mail_stop_code: z.string().max(32).nullable().transform((v, ctx) => {
    if (v === null || v.trim() === "") return null;
    const msc = normalizeMsc(v);
    if (!msc) ctx.addIssue({ code: "custom", message: "Your MSC is 6 digits; find it in myBama → Campus Mail Student Portal" });
    return msc;
  }),
  // First and last name as on the UA record; Campus Mail matches packages by name + MSC.
  mail_name: z.string().trim().max(80).nullable().refine((v) => v === null || /\S+\s+\S+/.test(v), "Use your first and last name as on your UA record"),
  tutor_opt_in: z.boolean(),
  location_sharing: z.enum(["off", "during_handoffs"]),
}).partial().strict();

export const meRoutes = (verify: TokenVerifier) =>
  new Hono<AuthEnv>()
    .use(requireUser(verify))
    .get("/", async (c) => c.json(one(await loadMe(c.var.user.id))))
    .patch("/", async (c) => {
      const patch = await parseBody(c, PatchMeReq);
      if (Object.keys(patch).length > 0) {
        const { error } = await adminClient().from("profiles").update(patch).eq("id", c.var.user.id);
        if (error) throw error;
      }
      return c.json(one(await loadMe(c.var.user.id)));
    });
