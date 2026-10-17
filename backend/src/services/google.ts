import { calendarConnections } from "../db/store.js";
import { config, googleConfigured } from "../lib/config.js";
import { decrypt } from "../lib/crypto.js";
import { ApiError } from "../lib/errors.js";
import type { Interval } from "./availability.js";
import type { GoogleEvent } from "./schedule-import.js";

// Google OAuth + Calendar over plain fetch. The frontend never talks to Google directly.

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL_API = "https://www.googleapis.com/calendar/v3";

/** Refresh token was revoked or expired; the connection must be redone. */
export class GoogleAuthRevoked extends Error {}

function requireConfigured() {
  if (!googleConfigured()) throw new ApiError(503, "INTERNAL", "Google Calendar is not configured on the server");
}

export function buildAuthUrl(state: string) {
  requireConfigured();
  const params = new URLSearchParams({
    client_id: config.google.clientId!,
    redirect_uri: config.google.redirectUri,
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
  requireConfigured();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId!,
      client_secret: config.google.clientSecret!,
      redirect_uri: config.google.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json()) as { refresh_token?: string; access_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!res.ok || !json.refresh_token) throw new Error(`Google token exchange failed: ${json.error ?? res.status}`);
  return { refreshToken: json.refresh_token, accessToken: json.access_token, scope: json.scope ?? GOOGLE_SCOPE };
}

/** The timezone set on the user's primary calendar, or null if Google doesn't say. */
export async function primaryTimezone(accessToken: string | undefined) {
  if (!accessToken) return null;
  const res = await fetch(`${CAL_API}/calendars/primary`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  return ((await res.json()) as { timeZone?: string }).timeZone ?? null;
}


export async function revoke(refreshToken: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" }).catch(() => {});
}

const accessTokens = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(userId: string) {
  const cached = accessTokens.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const conn = await calendarConnections.get(userId);
  if (!conn) throw new GoogleAuthRevoked("Not connected");
  requireConfigured();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: decrypt(conn.refresh_token_enc),
      client_id: config.google.clientId!,
      client_secret: config.google.clientSecret!,
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

async function calendarFetch<T>(userId: string, path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken(userId);
  const res = await fetch(`${CAL_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  if (res.status === 401) {
    accessTokens.delete(userId);
    throw new GoogleAuthRevoked("Access token rejected");
  }
  if (!res.ok) throw new Error(`Google Calendar ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function disconnectLocally(userId: string) {
  accessTokens.delete(userId);
  busyCache.delete(userId);
  await calendarConnections.delete(userId);
}

// Short-lived free/busy cache; the contract's /webhooks/google-calendar push would invalidate it.
const busyCache = new Map<string, { key: string; at: number; busy: Interval[] }>();
const BUSY_TTL_MS = 2 * 60_000;

/** Busy intervals across the user's primary calendar. Empty when not connected. */
export async function freeBusy(userId: string, from: Date, to: Date): Promise<Interval[]> {
  if (!(await calendarConnections.get(userId))) return [];
  const key = `${from.toISOString()}|${to.toISOString()}`;
  const hit = busyCache.get(userId);
  if (hit && hit.key === key && Date.now() - hit.at < BUSY_TTL_MS) return hit.busy;

  try {
    const json = await calendarFetch<{ calendars: Record<string, { busy?: { start: string; end: string }[] }> }>(userId, "/freeBusy", {
      method: "POST",
      body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] }),
    });
    const busy = (json.calendars.primary?.busy ?? []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
    busyCache.set(userId, { key, at: Date.now(), busy });
    return busy;
  } catch (err) {
    if (err instanceof GoogleAuthRevoked) return [];
    throw err;
  }
}

/** Recurring events from the primary calendar (series masters, not expanded instances). */
export async function recurringEvents(userId: string): Promise<GoogleEvent[]> {
  const now = Date.now();
  const params = new URLSearchParams({
    singleEvents: "false",
    timeMin: new Date(now - 7 * 86_400_000).toISOString(),
    timeMax: new Date(now + 21 * 86_400_000).toISOString(),
    maxResults: "250",
  });
  const out: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    if (pageToken) params.set("pageToken", pageToken);
    const json = await calendarFetch<{ items?: GoogleEvent[]; nextPageToken?: string }>(userId, `/calendars/primary/events?${params}`);
    out.push(...(json.items ?? []).filter((e) => e.recurrence?.length));
    pageToken = json.nextPageToken;
  } while (pageToken && out.length < 1000);
  return out;
}
