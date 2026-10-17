import { decrypt } from "../lib/crypto.js";
import { ApiError } from "../lib/errors.js";
import { adminClient } from "../lib/supabase.js";

// Google OAuth + Calendar free/busy over plain fetch. The frontend never talks to Google directly.

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL_API = "https://www.googleapis.com/calendar/v3";

interface GoogleEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Google OAuth settings, or null when any of them is missing. */
export function googleEnv(): GoogleEnv | null {
  const clientId = process.env["GOOGLE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const redirectUri = process.env["GOOGLE_REDIRECT_URI"];
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

export function requireGoogleConfigured(): GoogleEnv {
  const env = googleEnv();
  if (!env) throw new ApiError(503, "INTERNAL", "Google Calendar is not configured");
  return env;
}

/** Refresh token was revoked or expired; the connection must be redone. */
export class GoogleAuthRevoked extends Error {}

export function buildAuthUrl(state: string): string {
  const env = requireGoogleConfigured();
  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    prompt: "consent", // always return a refresh token, even on reconnect
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string) {
  const env = requireGoogleConfigured();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      redirect_uri: env.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json()) as { refresh_token?: string; access_token?: string; scope?: string; error?: string };
  if (!res.ok || !json.refresh_token) throw new Error(`Google token exchange failed: ${json.error ?? res.status}`);
  return { refreshToken: json.refresh_token, accessToken: json.access_token, scope: json.scope ?? GOOGLE_SCOPE };
}

/** The timezone set on the user's primary calendar, or null if Google doesn't say. */
export async function primaryTimezone(accessToken: string | undefined): Promise<string | null> {
  if (!accessToken) return null;
  const res = await fetch(`${CAL_API}/calendars/primary`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  return ((await res.json()) as { timeZone?: string }).timeZone ?? null;
}

async function revoke(refreshToken: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" }).catch(() => {});
}

// --- Supabase reads/writes (service role; always scoped by user_id) ---

export interface ConnectionInput {
  userId: string;
  schoolId: string;
  refreshTokenEnc: string;
  scope: string;
  timezone: string | null;
}

export async function saveConnection(input: ConnectionInput): Promise<void> {
  const db = adminClient();
  const saved = await db.from("calendar_connections").upsert({
    user_id: input.userId,
    school_id: input.schoolId,
    provider: "google",
    refresh_token_enc: input.refreshTokenEnc,
    scope: input.scope,
    timezone: input.timezone,
    connected_at: new Date().toISOString(),
  });
  if (saved.error) throw saved.error;
  await setGoogleConnected(input.userId, true);
  forget(input.userId);
}

export async function getRefreshTokenEnc(userId: string): Promise<string | null> {
  const result = await adminClient().from("calendar_connections").select("refresh_token_enc").eq("user_id", userId).maybeSingle();
  if (result.error) throw result.error;
  return (result.data as { refresh_token_enc: string } | null)?.refresh_token_enc ?? null;
}

async function deleteConnection(userId: string) {
  const deleted = await adminClient().from("calendar_connections").delete().eq("user_id", userId);
  if (deleted.error) throw deleted.error;
}

async function setGoogleConnected(userId: string, connected: boolean) {
  const updated = await adminClient().from("profiles").update({ google_connected: connected }).eq("id", userId);
  if (updated.error) throw updated.error;
}

// --- Token + free/busy caches (per process) ---

const accessTokens = new Map<string, { token: string; expiresAt: number }>();
const BUSY_TTL_MS = 2 * 60_000;
const busyCache = new Map<string, { key: string; at: number; busy: GoogleBusy[] }>();

export interface GoogleBusy {
  start: number; // epoch ms
  end: number;
}

function forget(userId: string) {
  accessTokens.delete(userId);
  busyCache.delete(userId);
}

/** Drops the connection row and flag without telling Google (used when Google already revoked it). */
async function disconnectLocally(userId: string) {
  forget(userId);
  await deleteConnection(userId);
  await setGoogleConnected(userId, false);
}

async function accessToken(userId: string): Promise<string> {
  const cached = accessTokens.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const sealed = await getRefreshTokenEnc(userId);
  if (!sealed) throw new GoogleAuthRevoked("Not connected");
  const env = requireGoogleConfigured();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: decrypt(sealed),
      client_id: env.clientId,
      client_secret: env.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (json.error === "invalid_grant") {
    await disconnectLocally(userId);
    throw new GoogleAuthRevoked("Refresh token revoked");
  }
  if (!res.ok || !json.access_token) throw new Error(`Google token refresh failed: ${json.error ?? res.status}`);
  accessTokens.set(userId, { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 });
  return json.access_token;
}

export function parseFreeBusy(json: { calendars?: Record<string, { busy?: { start: string; end: string }[] }> }): GoogleBusy[] {
  return (json.calendars?.["primary"]?.busy ?? [])
    .map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start);
}

/** Busy intervals on the user's primary calendar. Empty when not connected or access was revoked. */
export async function freeBusy(userId: string, from: number, to: number): Promise<GoogleBusy[]> {
  if (!googleEnv()) return [];
  const key = `${from}|${to}`;
  const hit = busyCache.get(userId);
  if (hit && hit.key === key && Date.now() - hit.at < BUSY_TTL_MS) return hit.busy;

  try {
    const token = await accessToken(userId);
    const res = await fetch(`${CAL_API}/freeBusy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: [{ id: "primary" }] }),
    });
    if (res.status === 401) {
      accessTokens.delete(userId);
      throw new GoogleAuthRevoked("Access token rejected");
    }
    if (!res.ok) throw new Error(`Google freeBusy failed: ${res.status} ${await res.text()}`);
    const busy = parseFreeBusy((await res.json()) as Parameters<typeof parseFreeBusy>[0]);
    busyCache.set(userId, { key, at: Date.now(), busy });
    return busy;
  } catch (err) {
    if (err instanceof GoogleAuthRevoked) return [];
    throw err;
  }
}

/** Best-effort revoke at Google, then delete the row and clear profiles.google_connected. */
export async function disconnect(userId: string): Promise<void> {
  const sealed = await getRefreshTokenEnc(userId);
  if (sealed) {
    try {
      await revoke(decrypt(sealed));
    } catch (err) {
      console.error("Google revoke skipped", err);
    }
  }
  await disconnectLocally(userId);
}
