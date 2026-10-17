import { Hono } from "hono";
import { primaryOrigin } from "../lib/origins.js";
import { encrypt, signState, verifyState } from "../lib/crypto.js";
import { one } from "../lib/respond.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { buildAuthUrl, disconnect, exchangeCode, primaryTimezone, requireGoogleConfigured, saveConnection } from "../services/google.js";

const settingsUrl = (status: "connected" | "error") => `${primaryOrigin(process.env["WEB_ORIGIN"])}/settings?google=${status}`;

interface OAuthState {
  uid: string;
  sid: string;
}

const isState = (value: OAuthState | null): value is OAuthState => !!value && typeof value.uid === "string" && typeof value.sid === "string";

/** Mount at /integrations/google. Only the callback is unauthenticated (Google redirects the browser to it). */
export const integrationsRoutes = (verify: TokenVerifier) => new Hono<AuthEnv>()
  .post("/connect", requireUser(verify), (c) => {
    requireGoogleConfigured();
    const state = signState({ uid: c.var.user.id, sid: c.var.user.schoolId });
    return c.json(one({ auth_url: buildAuthUrl(state) }));
  })
  .get("/callback", async (c) => {
    try {
      const { code, state, error } = c.req.query();
      if (error || !code || !state) {
        if (error) console.error("Google OAuth denied:", error);
        return c.redirect(settingsUrl("error"));
      }
      const payload = verifyState<OAuthState>(state);
      if (!isState(payload)) return c.redirect(settingsUrl("error"));
      const { refreshToken, accessToken, scope } = await exchangeCode(code);
      await saveConnection({
        userId: payload.uid,
        schoolId: payload.sid,
        refreshTokenEnc: encrypt(refreshToken),
        scope,
        timezone: await primaryTimezone(accessToken),
      });
      return c.redirect(settingsUrl("connected"));
    } catch (err) {
      console.error("Google OAuth callback failed", err);
      return c.redirect(settingsUrl("error"));
    }
  })
  .delete("/", requireUser(verify), async (c) => {
    await disconnect(c.var.user.id);
    return c.body(null, 204);
  });
