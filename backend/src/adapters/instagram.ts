import { z } from "zod";
import type { TaggedMedia } from "../services/instagram.js";

// Instagram API with Instagram Login (graph.instagram.com), for our own business/creator account.
// Reads posts that tag us (GET /{ig-id}/tags) and replies to caption @mentions
// (POST /{ig-id}/mentions). Needs instagram_business_basic + instagram_business_manage_comments.

const MEDIA_FIELDS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username,children{media_type,media_url}";

const Child = z.object({ media_type: z.string().optional(), media_url: z.string().optional() });
const Media = z.object({
  id: z.string(), caption: z.string().optional(), media_type: z.string().optional(), media_url: z.string().optional(),
  thumbnail_url: z.string().optional(), permalink: z.string().optional(), timestamp: z.string().optional(), username: z.string().optional(),
  children: z.object({ data: z.array(Child) }).optional(),
});
const GraphError = z.object({ error: z.object({ message: z.string(), code: z.number().optional() }) });

export interface InstagramGraph {
  /** Our account: { id, username }. */
  me(): Promise<{ id: string; username: string }>;
  /** Latest posts that tag our account (one page, newest first). */
  tagged(): Promise<TaggedMedia[]>;
  /** Public reply on a post whose caption @mentions us. */
  replyToMention(mediaId: string, message: string): Promise<{ id: string }>;
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

export function instagramGraph(opts: { token: string; userId?: string | undefined; host?: string; fetch?: typeof fetch }): InstagramGraph {
  const host = (opts.host ?? "https://graph.instagram.com/v23.0").replace(/\/$/, "");
  const doFetch = opts.fetch ?? fetch;
  let userId = opts.userId;

  async function call(method: "GET" | "POST", path: string, params: Record<string, string>) {
    const qs = new URLSearchParams({ ...params, access_token: opts.token });
    const res = await doFetch(`${host}${path}${method === "GET" ? `?${qs}` : ""}`, {
      method,
      signal: AbortSignal.timeout(10_000),
      ...(method === "POST" ? { body: qs, headers: { "Content-Type": "application/x-www-form-urlencoded" } } : {}),
    });
    const body: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = GraphError.safeParse(body);
      throw new Error(`Instagram ${method} ${path} failed (${res.status}): ${err.success ? err.data.error.message : "no details"}`);
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
  };
}
