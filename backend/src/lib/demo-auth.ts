import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "./errors.js";
import { adminClient } from "./supabase.js";

// DEMO_AUTH=on only. Hands out real Supabase sessions without an email round-trip, so the demo
// runs before sign-in is wired up. Never turn it on anywhere real: anyone can be anyone.

export interface DemoSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id: string;
}

const serverAuth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

/** Signs in as `email` (the account must exist): a magic-link OTP generated and redeemed server side. */
export async function demoSession(email: string): Promise<DemoSession> {
  const link = await adminClient().auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw new ApiError(404, "NOT_FOUND", `No account for ${email}`);
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_ANON_KEY"];
  if (!url || !key) throw new Error("DEMO_AUTH needs SUPABASE_URL and SUPABASE_ANON_KEY");
  const verified = await createClient(url, key, { auth: serverAuth }).auth.verifyOtp({ email, token: link.data.properties.email_otp, type: "email" });
  const session = verified.data.session;
  if (verified.error || !session) throw new Error(`demo sign-in failed: ${verified.error?.message ?? "no session"}`);
  return { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at ?? 0, user_id: session.user.id };
}

/** The made-up address a claimed social handle signs in with, on the school's own domain. */
export function handleEmail(channel: string, handle: string, domain: string) {
  const local = handle.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || "seller";
  return `${channel}.${local}@${domain}`;
}

const School = z.object({ email_domains: z.array(z.string()) });

/** Finds or creates the account behind a social handle, and returns its id and email. */
export async function accountForHandle(schoolId: string, channel: string, handle: string): Promise<{ id: string; email: string }> {
  const db = adminClient();
  const school = await db.from("schools").select("email_domains").eq("id", schoolId).single();
  if (school.error) throw school.error;
  const domain = School.parse(school.data).email_domains[0];
  if (!domain) throw new Error(`school ${schoolId} has no email domain`);
  const email = handleEmail(channel, handle, domain);

  const found = await db.from("profiles").select("id").eq("email", email).maybeSingle<{ id: string }>();
  if (found.error) throw found.error;
  if (found.data) return { id: found.data.id, email };
  const created = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { display_name: `@${handle}` } });
  if (created.error || !created.data.user) throw new Error(`couldn't create the seller account: ${created.error?.message ?? "no user"}`);
  return { id: created.data.user.id, email };
}
