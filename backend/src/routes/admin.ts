import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { TextbookIdentifier } from "../adapters/ports.js";
import { OrderRow, loadViewer, orderOut, sellerPayoutsEnabled } from "../db/market.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { one, page } from "../lib/respond.js";
import { adminClient, publicMediaUrl } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { AdminIngestPostReq, SellerInvite } from "../schemas/claims.js";
import { ResolveReq } from "../schemas/orders.js";
import { claimUrlIn } from "../services/claims.js";
import { settleOrder } from "../services/escrow.js";
import { nextOrderStatus } from "../services/orders.js";
import { pipelineEvent } from "../services/instagram.js";
import { runIngest } from "../workers/ingest.js";
import type { InstagramPoller } from "../workers/instagram-poller.js";

const UNIQUE_VIOLATION = "23505";

const InviteRow = z.object({
  id: z.guid(), channel: z.enum(["instagram", "groupme", "facebook", "snapchat"]), handle: z.string(), profile_url: z.string().nullable(),
  listing_ids: z.array(z.guid()), message_text: z.string(), status: z.enum(["queued", "sent", "claimed", "expired"]),
  trigger: z.enum(["first_offer", "manual"]), sent_at: z.string().nullable(), claimed_at: z.string().nullable(), expires_at: z.string(),
});
const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);

const toInvite = (r: z.infer<typeof InviteRow>) => SellerInvite.parse({
  id: r.id,
  external_seller: { channel: r.channel, handle: r.handle, profile_url: r.profile_url },
  listing_ids: r.listing_ids,
  claim_url: claimUrlIn(r.message_text) ?? "",
  message_text: r.message_text,
  status: Date.parse(r.expires_at) <= Date.now() && (r.status === "queued" || r.status === "sent") ? "expired" : r.status,
  trigger: r.trigger,
  sent_at: iso(r.sent_at),
  claimed_at: iso(r.claimed_at),
  expires_at: new Date(r.expires_at).toISOString(),
});

const FeedRow = z.object({
  id: z.guid(), channel: z.string(), external_url: z.string(), author_handle: z.string(), caption: z.string(), media_ids: z.array(z.guid()),
  posted_at: z.string(), status: z.string(), created_at: z.string(),
  job: z.object({ status: z.string(), result: z.record(z.string(), z.unknown()).nullable(), error: z.string().nullable() }).nullable(),
});
const FeedResult = z.object({
  listing_id: z.guid().optional(), status: z.string().optional(), title: z.string().optional(), price_cents: z.number().optional(),
  isbn: z.string().nullable().optional(), course_codes: z.array(z.string()).optional(), notified: z.number().optional(),
  identified_by: z.string().optional(), confidence: z.number().optional(),
  events: z.array(z.object({ at: z.string(), step: z.string(), text: z.string() })).optional(),
});

/** Recent posts and every pipeline step, newest first: the admin "live sources" screen. */
async function ingestionFeed(schoolId: string) {
  const db = adminClient();
  const posts = await db.from("ingested_posts").select("id, channel, external_url, author_handle, caption, media_ids, posted_at, status, created_at, job:jobs(status, result, error)")
    .eq("school_id", schoolId).order("created_at", { ascending: false }).limit(30);
  if (posts.error) throw posts.error;
  const rows = z.array(FeedRow).parse(posts.data);
  const firstPhotos = rows.flatMap((r) => r.media_ids.slice(0, 1));
  const media = firstPhotos.length ? await db.from("media").select("id, bucket, path").in("id", firstPhotos).eq("bucket", "public-media") : { data: [], error: null };
  if (media.error) throw media.error;
  const photo = new Map(z.array(z.object({ id: z.guid(), bucket: z.string(), path: z.string() })).parse(media.data).map((m) => [m.id, publicMediaUrl(m.bucket, m.path)]));
  return rows.map((r) => {
    const result = FeedResult.safeParse(r.job?.result ?? {});
    const res = result.success ? result.data : {};
    return {
      id: r.id, channel: r.channel, external_url: r.external_url, author_handle: r.author_handle, caption: r.caption,
      posted_at: new Date(r.posted_at).toISOString(), received_at: new Date(r.created_at).toISOString(),
      photo_url: r.media_ids[0] ? photo.get(r.media_ids[0]) ?? null : null,
      status: r.job?.status === "running" ? "processing" : r.status,
      listing: res.listing_id ? { id: res.listing_id, title: res.title ?? "", price_cents: res.price_cents ?? 0, status: res.status ?? "draft", isbn: res.isbn ?? null } : null,
      course_codes: res.course_codes ?? [], notified: res.notified ?? 0,
      identified_by: res.identified_by ?? null, confidence: res.confidence ?? null,
      events: res.events ?? [], error: r.job?.error ?? null,
    };
  });
}

/** Team accounts only (profiles.is_admin, set by the seed). Mount after requireUser. */
const requireAdmin: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const { data, error } = await adminClient().from("profiles").select("is_admin").eq("id", c.var.user.id).maybeSingle<{ is_admin: boolean }>();
  if (error) throw error;
  if (!data?.is_admin) throw new ApiError(403, "FORBIDDEN", "Admins only");
  await next();
};

/** Owned by the admin who sent the post, so they can poll it with GET /jobs/{id}. */
async function createJob(schoolId: string, userId: string, postId: string) {
  const { data, error } = await adminClient().from("jobs")
    .insert({ school_id: schoolId, user_id: userId, kind: "ingest_classify", status: "running", payload: { ingested_post_id: postId } })
    .select("id").single<{ id: string }>();
  if (error) throw error;
  return data.id;
}

/** Existing post for a re-sent URL: posting the same URL twice is a no-op. */
async function existingPost(channel: string, url: string) {
  const { data, error } = await adminClient().from("ingested_posts").select("id, job_id").eq("channel", channel).eq("external_url", url)
    .single<{ id: string; job_id: string | null }>();
  if (error) throw error;
  return data;
}

export const adminRoutes = (verify: TokenVerifier, identifier: TextbookIdentifier, instagram: InstagramPoller | null = null) => new Hono<AuthEnv>()
  .use("/*", requireUser(verify), requireAdmin)

  .get("/ingestion/feed", async (c) => c.json(page(await ingestionFeed(c.var.user.schoolId))))

  .get("/instagram/status", (c) => c.json(one(instagram?.status() ?? {
    mode: "off", account: null, polling_every_s: 0, last_poll_at: null, next_poll_at: null, last_error: null, polls: 0, ingested: 0,
  })))

  .post("/instagram/poll", async (c) => {
    if (!instagram) throw new ApiError(409, "INVALID_STATE", "Instagram polling is off (set INSTAGRAM=graph)");
    return c.json(one({ ...(await instagram.pollNow()), status: instagram.status() }));
  })

  .post("/ingested-posts", async (c) => {
    const body = await parseBody(c, AdminIngestPostReq);
    const { schoolId } = c.var.user;
    const db = adminClient();
    const inserted = await db.from("ingested_posts").insert({
      school_id: schoolId, channel: body.channel, external_url: body.external_url, author_handle: body.author_handle,
      caption: body.caption, media_ids: body.media_ids, posted_at: body.posted_at,
    }).select("id").single<{ id: string }>();
    if (inserted.error?.code === UNIQUE_VIOLATION) {
      const post = await existingPost(body.channel, body.external_url);
      return c.json(one({ job_id: post.job_id, ingested_post_id: post.id }), 202);
    }
    if (inserted.error) throw inserted.error;
    const postId = inserted.data.id;
    const jobId = await createJob(schoolId, c.var.user.id, postId);
    const linked = await db.from("ingested_posts").update({ job_id: jobId }).eq("id", postId);
    if (linked.error) throw linked.error;

    // Inline for now (a few hundred ms with the caption identifier); the job row is what clients poll.
    try {
      const result = await runIngest(postId, identifier);
      const events = [pipelineEvent("detected", `Post from @${body.author_handle.replace(/^@+/, "")} sent in by the team`), ...result.events];
      const done = await db.from("jobs").update({ status: "succeeded", result: { ...result, events } }).eq("id", jobId);
      if (done.error) throw done.error;
    } catch (err) {
      console.error("ingest_classify failed", postId, err);
      await db.from("jobs").update({ status: "failed", error: "Couldn't turn this post into a listing" }).eq("id", jobId);
      await db.from("ingested_posts").update({ status: "failed" }).eq("id", postId);
    }
    return c.json(one({ job_id: jobId, ingested_post_id: postId }), 202);
  })

  .get("/seller-invites", async (c) => {
    const { status } = parseQuery(c, z.object({ status: z.enum(["queued", "sent", "claimed", "expired"]).optional() }));
    let q = adminClient().from("seller_invites").select("*").eq("school_id", c.var.user.schoolId).order("created_at", { ascending: false }).limit(100);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw error;
    return c.json(page(z.array(InviteRow).parse(data).map(toInvite)));
  })

  .post("/seller-invites/:id/sent", async (c) => {
    const id = z.guid().safeParse(c.req.param("id"));
    if (!id.success) throw new ApiError(404, "NOT_FOUND", "Invite not found");
    const db = adminClient();
    const found = await db.from("seller_invites").select("*").eq("id", id.data).eq("school_id", c.var.user.schoolId).maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) throw new ApiError(404, "NOT_FOUND", "Invite not found");
    const invite = InviteRow.parse(found.data);
    if (invite.status !== "queued" && invite.status !== "sent") throw new ApiError(409, "INVALID_STATE", `Invite is ${invite.status}`);
    const updated = await db.from("seller_invites").update({ status: "sent", sent_at: invite.sent_at ?? new Date().toISOString() })
      .eq("id", invite.id).select("*").single();
    if (updated.error) throw updated.error;
    return c.json(one(toInvite(InviteRow.parse(updated.data))));
  })

  // Team decision on a disputed order: pay the seller out, or give the buyer their money back.
  .post("/orders/:id/resolve", async (c) => {
    const { outcome, note } = await parseBody(c, ResolveReq);
    const { id: adminId, schoolId } = c.var.user;
    const id = z.guid().safeParse(c.req.param("id"));
    if (!id.success) throw new ApiError(404, "NOT_FOUND", "Order not found");
    const found = await adminClient().from("orders").select("*").eq("id", id.data).eq("school_id", schoolId).maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) throw new ApiError(404, "NOT_FOUND", "Order not found");
    const row = OrderRow.parse(found.data);

    const status = nextOrderStatus(row.status, outcome === "complete" ? "resolve_complete" : "resolve_refund");
    const resolved = await settleOrder(row, status === "completed" ? "completed" : "refunded", {
      reason: `dispute_resolved:${outcome}`, sellerPayoutsEnabled: outcome === "complete" ? await sellerPayoutsEnabled(row.seller_id, schoolId) : false,
    });
    const body = outcome === "complete" ? `The team released the payment to the seller. ${note}` : `The team refunded the buyer. ${note}`;
    for (const userId of [row.buyer_id, row.seller_id]) {
      await notify({ schoolId, userId, type: "order.updated", title: "Dispute resolved", body, deepLink: `/orders/${row.id}`, data: { order_id: row.id, status: resolved.status } });
    }
    return c.json(one(await orderOut(resolved, await loadViewer(adminId, schoolId))));
  });
