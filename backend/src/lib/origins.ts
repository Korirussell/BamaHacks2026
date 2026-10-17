// WEB_ORIGIN can list several comma-separated origins (local dev, the Vercel production URL,
// preview deployments). "https://*.vercel.app"-style entries match any one subdomain label.
// The first entry is the app's own URL for links we send out (claim links, Stripe return URLs).

export const parseOrigins = (raw: string | undefined): string[] =>
  (raw ?? "").split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);

export const primaryOrigin = (raw: string | undefined, fallback = "http://localhost:3000"): string => parseOrigins(raw)[0] ?? fallback;

const matches = (pattern: string, origin: string) => {
  if (!pattern.includes("*")) return pattern === origin;
  const [scheme, host] = pattern.split("://");
  const suffix = host?.replace(/^\*\./, ".");
  if (!scheme || !suffix) return false;
  if (!origin.startsWith(`${scheme}://`)) return false;
  const originHost = origin.slice(scheme.length + 3);
  return originHost.endsWith(suffix) && !originHost.slice(0, -suffix.length).includes(".") && originHost.length > suffix.length;
};

/** CORS origin callback: echo the request origin when it is allowed, else nothing. */
export const allowOrigin = (raw: string | undefined) => {
  const allowed = parseOrigins(raw);
  return (origin: string) => (allowed.some((p) => matches(p, origin)) ? origin : null);
};
