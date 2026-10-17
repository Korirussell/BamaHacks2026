import { z } from "zod";

const optional = z.string().optional();
const Env = z.object({
  PORT: z.coerce.number().int(),
  WEB_ORIGIN: z.string().min(1),
  PLATFORM_FEE_BPS: z.coerce.number().int(),
  SUPABASE_URL: optional,
  SUPABASE_ANON_KEY: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
  SUPABASE_JWT_SECRET: optional,
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  STRIPE_PUBLISHABLE_KEY: optional,
  ANTHROPIC_API_KEY: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  GOOGLE_REDIRECT_URI: optional,
  TOKEN_ENCRYPTION_KEY: optional,
  HANDOFF_SECRET: z.string().min(32).optional(),
  APNS_KEY_ID: optional,
  APNS_TEAM_ID: optional,
  APNS_PRIVATE_KEY: optional,
  APNS_BUNDLE_ID: optional,
  VAPID_PUBLIC_KEY: optional,
  VAPID_PRIVATE_KEY: optional,
  GROUPME_BOT_TOKEN: optional,
  RESEND_API_KEY: optional,
  APP_URL_SCHEME: optional,
  // Library rooms: "manual" sends people to ROOM_BOOKING_URL; "demo" fakes a booked room for the pitch;
  // "playwright" really books the free room on LibCal through a Chrome profile signed into UA (`pnpm libcal login`).
  ROOM_BOOKER: z.enum(["manual", "demo", "playwright"]).default("manual"),
  LIBCAL_PROFILE_DIR: z.string().min(1).default(".libcal-profile"),
  LIBCAL_HEADLESS: z.enum(["on", "off"]).default("on"),
  ROOM_BOOKING_URL: z.url().default("https://www.lib.ua.edu/"),
  // Live free Gorgas study rooms from UA's LibCal (read-only). "off" → no rooms are suggested.
  LIBCAL: z.enum(["on", "off"]).default("on"),
  // Marketplace: "demo" marks orders paid without a card until Stripe (step 10) lands.
  PAYMENTS: z.enum(["demo", "stripe"]).default("demo"),
  // Instagram: "graph" polls the posts that tag our business account and lists them automatically.
  // "stories" polls the seller account's own stories (its token) and DMs the seller from ours.
  INSTAGRAM: z.enum(["off", "graph", "stories"]).default("off"),
  INSTAGRAM_ACCESS_TOKEN: optional,
  // Stories mode: the seller account's own token (it reads its own stories), and optionally its username.
  INSTAGRAM_SELLER_TOKEN: optional,
  INSTAGRAM_SELLER_USERNAME: optional,
  // The seller's Instagram-scoped id as our account sees it; looked up from our DM conversations if empty.
  INSTAGRAM_SELLER_IGSID: optional,
  INSTAGRAM_USER_ID: optional,
  INSTAGRAM_GRAPH_URL: z.url().default("https://graph.instagram.com/v23.0"),
  INSTAGRAM_POLL_SECONDS: z.coerce.number().int().min(5).default(15),
  // Public replies on the seller's post ("listed", then the claim link on the first offer); DMs in stories mode.
  INSTAGRAM_AUTO_REPLY: z.enum(["on", "off"]).default("on"),
  // Which school polled posts belong to (single-school MVP: the seeded UA school).
  INSTAGRAM_SCHOOL_ID: z.guid().default("00000000-0000-4000-a000-000000000001"),
  // Textbook identification: "claude" (vision) when ANTHROPIC_API_KEY is set, else the caption parser.
  IDENTIFIER: z.enum(["auto", "claude", "caption"]).default("auto"),
  CLAUDE_VISION_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  // Name used in the claim DM we send to Instagram sellers.
  APP_NAME: z.string().min(1).default("Campus Marketplace"),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = Env.safeParse(env);
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}
