import { z } from "zod";
import type { TaggedMedia } from "../services/instagram.js";

// Instagram API with Instagram Login (graph.instagram.com), for our own business/creator account.
// Reads posts that tag us (GET /{ig-id}/tags) and replies to caption @mentions
// (POST /{ig-id}/mentions). Needs instagram_business_basic + instagram_business_manage_comments.
// Stories mode: the seller account reads its own stories (GET /{ig-id}/stories), and our account
// reads its DM conversations and sends DMs (instagram_business_manage_messages).

const MEDIA_FIELDS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username,children{media_type,media_url}";

const Child = z.object({ media_type: z.string().optional(), media_url: z.string().optional() });
const Media = z.object({
  id: z.string(), caption: z.string().optional(), media_type: z.string().optional(), media_url: z.string().optional(),
  thumbnail_url: z.string().optional(), permalink: z.string().optional(), timestamp: z.string().optional(), username: z.string().optional(),
  children: z.object({ data: z.array(Child) }).optional(),
});
const STORY_FIELDS = "id,media_type,media_url,thumbnail_url,permalink,timestamp";
const GraphTime = z.union([z.string(), z.number()]);
const Party = z.object({ id: z.string(), username: z.string().optional() });
const GraphError = z.object({ error: z.object({ message: z.string(), code: z.number().optional() }) });

/** A failed Graph call; `code` is Meta's error code when the body had one. */
export class GraphApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: number | null) {
    super(message);
  }
}

export interface InstagramGraph {
  /** Our account: { id, username }. */
  me(): Promise<{ id: string; username: string }>;
  /** Latest posts that tag our account (one page, newest first). */
  tagged(): Promise<TaggedMedia[]>;
  /** Public reply on a post whose caption @mentions us. */
  replyToMention(mediaId: string, message: string): Promise<{ id: string }>;
  /** Our account's own live stories (the last 24 h). `username` fills in the fallback permalink. */
  stories(username: string): Promise<TaggedMedia[]>;
  /** Our DM conversations, optionally only the one with `userId` (an IGSID). */
  conversations(userId?: string): Promise<{ id: string }[]>;
  /** A conversation's latest messages (Instagram gives details for the 20 most recent). */
  messages(conversationId: string): Promise<{ id: string; created_time: string | null }[]>;
  /** Who sent one message, to whom, and when. */
  message(messageId: string): Promise<DmMessage>;
  /** A DM to someone who wrote to us in the last 24 h. */
  sendMessage(recipientId: string, text: string): Promise<{ message_id: string }>;
}

export interface DmMessage {
  id: string;
  created_time: string | null;
  from: { id: string; username?: string | undefined };
  to: { id: string; username?: string | undefined }[];
}

/** Graph times come as ISO ("2026-10-17T15:00:00+0000") or unix seconds; both become ISO. */
export function graphTime(v: string | number | undefined): string | null {
  if (v === undefined) return null;
  const ms = typeof v === "number" || /^\d+$/.test(v) ? Number(v) * 1000 : Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The photos to save for a post: every image in a carousel, else the image (or a video's cover). */
export function imageUrlsOf(m: z.infer<typeof Media>): string[] {
  const kids = m.children?.data.filter((c) => c.media_type !== "VIDEO").flatMap((c) => (c.media_url ? [c.media_url] : [])) ?? [];
  if (kids.length) return kids;
  const single = m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url;
  return single ? [single] : [];
}

export function parseTagged(body: unknown): TaggedMedia[] {
  const page = z.object({ data: z.array(Media) }).parse(body);
  return page.data.flatMap((m) => m.permalink && m.username ? [{
    id: m.id, caption: m.caption ?? "", permalink: m.permalink, username: m.username,
    timestamp: m.timestamp ?? new Date().toISOString(), imageUrls: imageUrlsOf(m),
  }] : []);
}

/**
 * Our own live stories. Stories have no caption (the text is baked into the image), and the
 * permalink may be missing, so the fallback URL keeps dedupe stable on the story id.
 */
export function parseStories(body: unknown, username: string): TaggedMedia[] {
  const page = z.object({ data: z.array(Media) }).parse(body);
  return page.data.map((m) => ({
    id: m.id, caption: m.caption ?? "", permalink: m.permalink ?? `https://www.instagram.com/stories/${username}/${m.id}/`, username,
    timestamp: m.timestamp ?? new Date().toISOString(), imageUrls: imageUrlsOf(m),
  }));
}

export function instagramGraph(opts: { token: string; userId?: string | undefined; host?: string; fetch?: typeof fetch }): InstagramGraph {
  const host = (opts.host ?? "https://graph.instagram.com/v23.0").replace(/\/$/, "");
  const doFetch = opts.fetch ?? fetch;
  let userId = opts.userId;

  // `json` sends a JSON body with the token as a Bearer header (the messaging API's documented shape).
  async function call(method: "GET" | "POST", path: string, params: Record<string, string>, json?: unknown) {
    const qs = new URLSearchParams({ ...params, access_token: opts.token });
    const res = await doFetch(`${host}${path}${method === "GET" ? `?${qs}` : ""}`, {
      method,
      signal: AbortSignal.timeout(10_000),
      ...(json !== undefined
        ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.token}` } }
        : method === "POST" ? { body: qs, headers: { "Content-Type": "application/x-www-form-urlencoded" } } : {}),
    });
    const body: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = GraphError.safeParse(body);
      const message = `Instagram ${method} ${path} failed (${res.status}): ${err.success ? err.data.error.message : "no details"}`;
      throw new GraphApiError(message, res.status, err.success ? err.data.error.code ?? null : null);
    }
    return body;
  }

  const me = async () => {
    const body = z.object({ user_id: z.union([z.string(), z.number()]).optional(), id: z.string(), username: z.string() })
      .parse(await call("GET", "/me", { fields: "user_id,username" }));
    userId ??= String(body.user_id ?? body.id);
    return { id: userId, username: body.username };
  };
  const ownId = async () => userId ?? (await me()).id;

  return {
    me,
    tagged: async () => parseTagged(await call("GET", `/${await ownId()}/tags`, { fields: MEDIA_FIELDS, limit: "25" })),
    replyToMention: async (mediaId, message) =>
      z.object({ id: z.string() }).parse(await call("POST", `/${await ownId()}/mentions`, { media_id: mediaId, message })),
    stories: async (username) => parseStories(await call("GET", `/${await ownId()}/stories`, { fields: STORY_FIELDS }), username),
    conversations: async (userId) => z.object({ data: z.array(z.object({ id: z.string() })) })
      .parse(await call("GET", `/${await ownId()}/conversations`, { platform: "instagram", ...(userId ? { user_id: userId } : {}) })).data,
    messages: async (conversationId) => {
      const body = z.object({ messages: z.object({ data: z.array(z.object({ id: z.string(), created_time: GraphTime.optional() })) }).optional() })
        .parse(await call("GET", `/${conversationId}`, { fields: "messages" }));
      return (body.messages?.data ?? []).map((m) => ({ id: m.id, created_time: graphTime(m.created_time) }));
    },
    message: async (messageId) => {
      const m = z.object({ id: z.string(), created_time: GraphTime.optional(), from: Party, to: z.object({ data: z.array(Party) }).optional() })
        .parse(await call("GET", `/${messageId}`, { fields: "id,created_time,from,to" }));
      return { id: m.id, created_time: graphTime(m.created_time), from: m.from, to: m.to?.data ?? [] };
    },
    sendMessage: async (recipientId, text) => z.object({ message_id: z.string() })
      .parse(await call("POST", `/${await ownId()}/messages`, {}, { recipient: { id: recipientId }, message: { text } })),
  };
}
