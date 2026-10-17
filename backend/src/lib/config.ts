// Env access in one place so missing keys fail loudly where they're used.
const env = (key: string) => {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
};

export const config = {
  supabaseJwtSecret: env("SUPABASE_JWT_SECRET"),
  google: {
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
    redirectUri: env("GOOGLE_REDIRECT_URI") ?? "http://localhost:8787/api/v1/integrations/google/callback",
  },
  // Dev fallback so the server runs without keys; set a real 32+ char secret in .env.
  tokenEncryptionKey: env("TOKEN_ENCRYPTION_KEY") ?? "dev-only-insecure-token-encryption-key",
  webOrigin: env("WEB_ORIGIN") ?? "http://localhost:3000",
  // Fallback when a user hasn't connected Google (their calendar's timezone wins).
  // Defaults to the server machine's own timezone; set SCHOOL_TIMEZONE on a UTC host.
  defaultTimezone: env("SCHOOL_TIMEZONE") ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
};

export const googleConfigured = () => Boolean(config.google.clientId && config.google.clientSecret);
