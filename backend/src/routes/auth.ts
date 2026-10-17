import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { toSchool } from "../db/mappers.js";
import { SchoolRow } from "../db/rows.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { ApiError } from "../lib/errors.js";
import { parseBody } from "../lib/validate.js";

const CheckEmailReq = z.object({ email: z.email() });
const DemoLoginReq = z.object({ email: z.email() });

/** Finds the school whose `email_domains` include this (lowercased) domain. */
export type SchoolLookup = (domain: string) => Promise<SchoolRow | null>;
export type DemoLoginSession = { access_token: string; refresh_token: string; expires_at: number; user_id: string };
export type DemoLogin = (email: string) => Promise<DemoLoginSession>;

export const supabaseSchoolLookup: SchoolLookup = async (domain) => {
  const { data, error } = await adminClient().from("schools").select("*").contains("email_domains", [domain]).limit(1).maybeSingle();
  if (error) throw error;
  return data ? SchoolRow.parse(data) : null;
};

/** Mints a real, short-lived session for a seeded user. Only mounted with DEMO_LOGIN=on. */
export const supabaseDemoLogin: DemoLogin = async (email) => {
  const link = await adminClient().auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw new Error(`generateLink: ${link.error.message}`);
  const url = process.env["SUPABASE_URL"];
  const anonKey = process.env["SUPABASE_ANON_KEY"];
  if (!url || !anonKey) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required for demo login");
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const verified = await anon.auth.verifyOtp({ email, token: link.data.properties.email_otp, type: "email" });
  if (verified.error || !verified.data.session || !verified.data.user) throw new Error(`verifyOtp: ${verified.error?.message ?? "no session"}`);
  const { session, user } = verified.data;
  return { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at ?? 0, user_id: user.id };
};

export const devLoginRoutes = (login: DemoLogin) => new Hono().post("/login", async (c) => {
  const { email } = await parseBody(c, DemoLoginReq);
  const normalized = email.toLowerCase();
  if (!normalized.endsWith("@crimson.ua.edu")) throw new ApiError(403, "NOT_EDU_EMAIL", "Demo login requires a @crimson.ua.edu email");
  return c.json(one(await login(normalized)));
});

// POST /auth/check-email: UX-only pre-check. The before-user-created hook (0004_auth.sql) enforces it for real.
export const authRoutes = (findSchool: SchoolLookup) =>
  new Hono().post("/check-email", async (c) => {
    const { email } = await parseBody(c, CheckEmailReq);
    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    if (!domain.endsWith(".edu")) {
      return c.json(one({ allowed: false, school: null, reason: "NOT_EDU_EMAIL" }));
    }
    const school = await findSchool(domain);
    if (!school) return c.json(one({ allowed: false, school: null, reason: "SCHOOL_NOT_SUPPORTED" }));
    return c.json(one({ allowed: true, school: toSchool(school), reason: null }));
  });
