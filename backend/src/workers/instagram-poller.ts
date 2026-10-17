import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { InstagramGraph } from "../adapters/instagram.js";
import type { SellerOutreach, TextbookIdentifier } from "../adapters/ports.js";
import { adminClient } from "../lib/supabase.js";
import { listedReply, offerReply, pipelineEvent, toExternalPost, unseenMedia, type PipelineEvent, type TaggedMedia } from "../services/instagram.js";
import { runIngest, type IngestResult } from "./ingest.js";

// INSTAGRAM=graph: every few seconds, read the posts that tag our account, save their photos,
// run them through ingest (Claude vision → listing → students notified), and reply on the post.
// The same pipeline as POST /admin/ingested-posts; this is just the automatic front door.

const UNIQUE_VIOLATION = "23505";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface PollerStatus {
  mode: "graph" | "off";
  account: string | null;
  polling_every_s: number;
  last_poll_at: string | null;
  next_poll_at: string | null;
  last_error: string | null;
  polls: number;
  ingested: number;
}

export interface InstagramPoller {
  start(): void;
  stop(): void;
  pollNow(): Promise<{ found: number; ingested: number }>;
  status(): PollerStatus;
  /** Replies on the seller's post with the claim link when the first offer comes in. */
  outreach: SellerOutreach;
}

const check = <T>(r: { data: T | null; error: { code?: string } | null }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

/** Instagram's photo URLs expire, so copy them into our public bucket as listing photos. */
async function savePhotos(schoolId: string, media: TaggedMedia, doFetch: typeof fetch): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, url] of media.imageUrls.slice(0, 4).entries()) {
    try {
      const id = await savePhoto(schoolId, media.id, i, url, doFetch);
      if (id) ids.push(id);
    } catch (err) {
      console.error("couldn't save an Instagram photo; listing without it", err instanceof Error ? err.message : err);
    }
  }
  return ids;
}

async function savePhoto(schoolId: string, mediaId: string, i: number, url: string, doFetch: typeof fetch): Promise<string | null> {
  const db = adminClient();
  const res = await doFetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const contentType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim();
  if (!contentType.startsWith("image/")) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
  const id = randomUUID();
  const path = `ingested/instagram/${mediaId}/${i}-${id}.${contentType === "image/png" ? "png" : "jpg"}`;
  const up = await db.storage.from("public-media").upload(path, bytes, { contentType, upsert: true });
  if (up.error) throw up.error;
  check(await db.from("media").insert({
    id, school_id: schoolId, owner_id: null, purpose: "ingested", bucket: "public-media", path,
    kind: "image", content_type: contentType, bytes: bytes.length, uploaded: true,
  }));
  return id;
}

async function appendEvents(jobId: string, result: IngestResult, extra: PipelineEvent[]) {
  const done = await adminClient().from("jobs").update({ status: "succeeded", result: { ...result, events: [...result.events, ...extra] } }).eq("id", jobId);
  if (done.error) throw done.error;
}

export function instagramPoller(deps: {
  graph: InstagramGraph;
  identifier: TextbookIdentifier;
  schoolId: string;
  appName: string;
  autoReply: boolean;
  intervalMs: number;
  fetch?: typeof fetch;
}): InstagramPoller {
  const doFetch = deps.fetch ?? fetch;
  const state: PollerStatus = {
    mode: "graph", account: null, polling_every_s: Math.round(deps.intervalMs / 1000),
    last_poll_at: null, next_poll_at: null, last_error: null, polls: 0, ingested: 0,
  };
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<{ found: number; ingested: number }> | null = null;

  async function ingestOne(m: TaggedMedia): Promise<boolean> {
    const db = adminClient();
    const post = toExternalPost(m);
    const detected = pipelineEvent("detected", `@${m.username} tagged us on Instagram`, new Date(post.postedAt));
    const mediaIds = await savePhotos(deps.schoolId, m, doFetch);
    const saved = pipelineEvent("photos_saved", `Saved ${mediaIds.length} photo${mediaIds.length === 1 ? "" : "s"}`);

    const inserted = await db.from("ingested_posts").insert({
      school_id: deps.schoolId, channel: "instagram", external_url: post.externalUrl, author_handle: post.authorHandle,
      caption: post.caption, media_ids: mediaIds, posted_at: post.postedAt,
    }).select("id").single<{ id: string }>();
    if (inserted.error?.code === UNIQUE_VIOLATION) return false; // another poll got it first
    const postId = check(inserted).id;
    const job = check(await db.from("jobs").insert({
      school_id: deps.schoolId, user_id: null, kind: "ingest_classify", status: "running",
      payload: { ingested_post_id: postId, ig_media_id: m.id, source: "instagram_tags" },
    }).select("id").single<{ id: string }>());
    check(await db.from("ingested_posts").update({ job_id: job.id }).eq("id", postId));

    try {
      const result = await runIngest(postId, deps.identifier);
      result.events.unshift(detected, saved);
      const replies: PipelineEvent[] = [];
      if (deps.autoReply && result.status === "active") {
        try {
          await deps.graph.replyToMention(m.id, listedReply({
            handle: m.username, title: result.title, priceCents: result.price_cents, courseCodes: result.course_codes, notified: result.notified, appName: deps.appName,
          }));
          replies.push(pipelineEvent("replied", `Replied on @${m.username}'s post`));
        } catch (err) {
          replies.push(pipelineEvent("reply_failed", `Couldn't reply on the post: ${err instanceof Error ? err.message : "unknown error"}`));
        }
      }
      await appendEvents(job.id, result, replies);
    } catch (err) {
      console.error("instagram ingest failed", m.permalink, err);
      await db.from("jobs").update({ status: "failed", error: "Couldn't turn this post into a listing", result: { events: [detected, saved, pipelineEvent("failed", "Couldn't turn this post into a listing")] } }).eq("id", job.id);
      await db.from("ingested_posts").update({ status: "failed" }).eq("id", postId);
    }
    return true;
  }

  async function poll() {
    state.polls += 1;
    state.last_poll_at = new Date().toISOString();
    try {
      if (!state.account) state.account = (await deps.graph.me()).username;
      const tagged = await deps.graph.tagged();
      const urls = tagged.map((m) => m.permalink);
      const seen = urls.length
        ? z.array(z.object({ external_url: z.string() })).parse(check(await adminClient().from("ingested_posts").select("external_url").eq("channel", "instagram").in("external_url", urls)))
        : [];
      const fresh = unseenMedia(tagged, new Set(seen.map((s) => s.external_url)));
      let ingested = 0;
      for (const m of fresh) if (await ingestOne(m)) ingested += 1;
      state.ingested += ingested;
      state.last_error = null;
      return { found: fresh.length, ingested };
    } catch (err) {
      state.last_error = err instanceof Error ? err.message : String(err);
      console.error("instagram poll failed:", state.last_error);
      return { found: 0, ingested: 0 };
    }
  }

  const pollNow = () => {
    running ??= poll().finally(() => { running = null; });
    return running;
  };

  const outreach: SellerOutreach = {
    async send(input) {
      if (input.channel !== "instagram" || !deps.autoReply) return { sent: false };
      const db = adminClient();
      const listing = await db.from("listings").select("ingested_post_id").eq("id", input.listingId).maybeSingle<{ ingested_post_id: string | null }>();
      if (listing.error || !listing.data?.ingested_post_id) return { sent: false };
      const job = await db.from("jobs").select("id, payload, result").eq("kind", "ingest_classify")
        .eq("payload->>ingested_post_id", listing.data.ingested_post_id).maybeSingle<{ id: string; payload: { ig_media_id?: string }; result: IngestResult | null }>();
      const mediaId = job.data?.payload.ig_media_id;
      if (job.error || !mediaId) return { sent: false }; // fed in by hand, so there's no post to reply on
      try {
        await deps.graph.replyToMention(mediaId, offerReply({ handle: input.handle, offerCents: input.offerCents, courseCode: input.courseCode, url: input.claimUrl }));
        if (job.data?.result) await appendEvents(job.data.id, job.data.result, [pipelineEvent("replied", "First offer in: replied with the claim link")]);
        return { sent: true };
      } catch (err) {
        console.error("instagram offer reply failed", err instanceof Error ? err.message : err);
        return { sent: false };
      }
    },
  };

  return {
    start() {
      if (timer) return;
      const tick = () => {
        state.next_poll_at = new Date(Date.now() + deps.intervalMs).toISOString();
        void pollNow();
      };
      tick();
      timer = setInterval(tick, deps.intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      state.next_poll_at = null;
    },
    pollNow,
    status: () => ({ ...state }),
    outreach,
  };
}
