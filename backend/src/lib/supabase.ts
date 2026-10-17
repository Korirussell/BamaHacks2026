import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// TODO: read these from config.ts (loadConfig) once it lands.
function env(name: "SUPABASE_URL" | "SUPABASE_ANON_KEY" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see backend/.env.example and supabase/README.md)`);
  return value;
}

const serverAuth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

let admin: SupabaseClient | undefined;

/** Service-role client: bypasses RLS. Routes must scope every query by `c.var.user` themselves. */
export function adminClient(): SupabaseClient {
  admin ??= createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: serverAuth });
  return admin;
}

/** Client acting as the signed-in user, so RLS applies. Build one per request. */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: serverAuth,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Public URL for an object in the `public-media` bucket. */
export function publicMediaUrl(bucket: string, path: string): string {
  return `${env("SUPABASE_URL")}/storage/v1/object/public/${bucket}/${path}`;
}
