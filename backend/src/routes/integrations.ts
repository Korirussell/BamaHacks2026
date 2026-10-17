import { Hono } from "hono";
import { calendarConnections } from "../db/store.js";
import { requireAuth, type AuthEnv } from "../lib/auth.js";
import { config } from "../lib/config.js";
import { decrypt, encrypt, signState, verifyState } from "../lib/crypto.js";
import { one } from "../lib/respond.js";
import { buildAuthUrl, disconnectLocally, exchangeCode, primaryTimezone, revoke } from "../services/google.js";

// Module 9 — /integrations/google: OAuth connect, callback, disconnect.

const settingsUrl = (status: "connected" | "error") => `${config.webOrigin}/settings?google=${status}`;

export const google = new Hono<AuthEnv>()
  .post("/connect", requireAuth, (c) => {
    const state = signState({ uid: c.get("user").id });
    return c.json(one({ auth_url: buildAuthUrl(state) }));
  })

  // Google redirects the browser here (no bearer token); the signed state identifies the user.
  .get("/callback", async (c) => {
    const { code, state, error } = c.req.query();
    const payload = state ? verifyState<{ uid: string }>(state) : null;
    if (error || !code || !payload) return c.redirect(settingsUrl("error"));
    try {
      const { refreshToken, accessToken, scope } = await exchangeCode(code);
      await calendarConnections.upsert({
        user_id: payload.uid,
        refresh_token_enc: encrypt(refreshToken),
        scope,
        timezone: await primaryTimezone(accessToken),
        connected_at: new Date().toISOString(),
      });
      return c.redirect(settingsUrl("connected"));
    } catch (err) {
      console.error(err);
      return c.redirect(settingsUrl("error"));
    }
  })

  .delete("/", requireAuth, async (c) => {
    const userId = c.get("user").id;
    const conn = await calendarConnections.get(userId);
    if (conn) await revoke(decrypt(conn.refresh_token_enc));
    await disconnectLocally(userId);
    return c.body(null, 204);
  });
