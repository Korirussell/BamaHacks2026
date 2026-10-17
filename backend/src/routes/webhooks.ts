import { Hono } from "hono";
import { z } from "zod";
import type { TextbookIdentifier } from "../adapters/ports.js";
import { safeEqual } from "../lib/crypto.js";
import { ApiError } from "../lib/errors.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { invalidateFreeBusy } from "../services/google.js";
import { ingestExternalPost } from "../workers/ingest.js";

// Inbound webhooks (server only, not behind requireUser). Mount at /webhooks. Stripe lives elsewhere.

export interface WebhookDeps {
  identifier: TextbookIdentifier;
  /** GROUPME_WEBHOOK_SECRET; null rejects every GroupMe callback. */
  groupmeSecret: string | null;
  /** The school the GroupMe bot's groups belong to (GROUPME_SCHOOL_ID). */
  groupmeSchoolId: string;
}

/** GroupMe bot callback body (https://dev.groupme.com/tutorials/bots). Unknown fields are ignored. */
export const GroupMeMessage = z.object({
  id: z.string().min(1),
  group_id: z.string().min(1),
  name: z.string().default(""),
  sender_type: z.string(),
  text: z.string().nullable().default(null),
  created_at: z.number(),
  system: z.boolean().optional(),
});
type GroupMeMessage = z.output<typeof GroupMeMessage>;

/** Why a message isn't ingested, or null when it should be. */
export function groupmeSkipReason(m: GroupMeMessage): string | null {
  if (m.sender_type === "bot") return "bot";
  if (m.system || m.sender_type === "system") return "system";
  if (!m.text?.trim()) return "empty";
  return null;
}

function checkSecret(given: string | undefined, secret: string | null) {
  if (!secret) throw new ApiError(403, "FORBIDDEN", "GroupMe webhook is not configured");
  if (!given) throw new ApiError(401, "UNAUTHENTICATED", "Missing token");
  if (!safeEqual(given, secret)) throw new ApiError(403, "FORBIDDEN", "Invalid token");
}

const CalendarConnection = z.object({ user_id: z.guid(), watch_channel_token: z.string().nullable() });

export const webhookRoutes = (deps: WebhookDeps) => new Hono()
  .post("/groupme", async (c) => {
    checkSecret(c.req.query("token"), deps.groupmeSecret);
    const parsed = GroupMeMessage.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "VALIDATION", "Not a GroupMe message");
    const m = parsed.data;
    const skipped = groupmeSkipReason(m);
    if (skipped) return c.json(one({ ingested: false, reason: skipped }));

    const { postId, duplicate } = await ingestExternalPost({
      schoolId: deps.groupmeSchoolId, userId: null, identifier: deps.identifier,
      post: {
        channel: "groupme", external_url: `https://groupme.com/groups/${m.group_id}/messages/${m.id}`, author_handle: m.name || "groupme",
        caption: m.text ?? "", media_ids: [], posted_at: new Date(m.created_at * 1000).toISOString(),
      },
      detected: `GroupMe message from ${m.name || "a group member"}`,
    });
    return c.json(one({ ingested: !duplicate, ingested_post_id: postId }), duplicate ? 200 : 202);
  })

  // Google Calendar push: headers only, empty body. Unknown channels get a 200 so Google stops retrying.
  .post("/google-calendar", async (c) => {
    const channelId = c.req.header("X-Goog-Channel-ID");
    const state = c.req.header("X-Goog-Resource-State");
    if (!channelId || !state) throw new ApiError(400, "VALIDATION", "Not a Google push notification");

    const db = adminClient();
    const found = await db.from("calendar_connections").select("user_id, watch_channel_token").eq("watch_channel_id", channelId).maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) return c.body(null, 200);
    const conn = CalendarConnection.parse(found.data);
    if (conn.watch_channel_token && !safeEqual(c.req.header("X-Goog-Channel-Token") ?? "", conn.watch_channel_token)) {
      throw new ApiError(403, "FORBIDDEN", "Invalid channel token");
    }
    if (state === "sync") return c.body(null, 200);

    invalidateFreeBusy(conn.user_id);
    const marked = await db.from("calendar_connections").update({ needs_refresh: true, last_notified_at: new Date().toISOString() }).eq("user_id", conn.user_id);
    if (marked.error) throw marked.error;
    return c.body(null, 200);
  });
