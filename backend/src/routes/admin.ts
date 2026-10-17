import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { TextbookIdentifier } from "../adapters/ports.js";
import { ApiError } from "../lib/errors.js";
import { one, page } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { AdminIngestPostReq, SellerInvite } from "../schemas/claims.js";
import { claimUrlIn } from "../services/claims.js";
import { runIngest } from "../workers/ingest.js";

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

/** Team accounts only (profiles.is_admin, set by the seed). Mount after requireUser. */
const requireAdmin: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const { data, error } = await adminClient().from("profiles").select("is_admin").eq("id", c.var.user.id).maybeSingle<{ is_admin: boolean }>();
  if (error) throw error;
  if (!data?.is_admin) throw new ApiError(403, "FORBIDDEN", "Admins only");
  await next();
};

async function createJob(schoolId: string, postId: string) {
  const { data, error } = await adminClient().from("jobs")
    .insert({ school_id: schoolId, user_id: null, kind: "ingest_classify", status: "running", payload: { ingested_post_id: postId } })
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

export const adminRoutes = (verify: TokenVerifier, identifier: TextbookIdentifier) => new Hono<AuthEnv>()
  .use("/*", requireUser(verify), requireAdmin)

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
    const jobId = await createJob(schoolId, postId);
    const linked = await db.from("ingested_posts").update({ job_id: jobId }).eq("id", postId);
    if (linked.error) throw linked.error;

    // Inline for now (a few hundred ms with the caption identifier); the job row is what clients poll.
    try {
      const result = await runIngest(postId, identifier);
      const done = await db.from("jobs").update({ status: "succeeded", result }).eq("id", jobId);
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
  });
