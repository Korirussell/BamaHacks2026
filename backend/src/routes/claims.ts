import { Hono } from "hono";
import { z } from "zod";
import { LISTING_SELECT, ListingRow, OfferRow, listingsOut, offersOut } from "../db/market.js";
import { accountForHandle, demoSession } from "../lib/demo-auth.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { afterClaim } from "../services/offers.js";
import { assertClaimUsable, hashClaimToken } from "../services/claims.js";

// The link we DM to an Instagram seller. Holding the token is the proof they own the handle,
// so the preview needs no login, and claiming needs only a .edu sign-in (no Stripe yet), or none with DEMO_AUTH=on.

const InviteRow = z.object({
  id: z.guid(), school_id: z.guid(), channel: z.enum(["instagram", "groupme", "facebook", "snapchat"]), handle: z.string(),
  profile_url: z.string().nullable(), status: z.string(), expires_at: z.string(),
});
type InviteRow = z.infer<typeof InviteRow>;

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

async function inviteFor(token: string) {
  if (!TOKEN.test(token)) assertClaimUsable(null, Date.now());
  const data = check(await adminClient().from("seller_invites").select("id, school_id, channel, handle, profile_url, status, expires_at")
    .eq("token_hash", hashClaimToken(token)).maybeSingle());
  const invite = data ? InviteRow.parse(data) : null;
  assertClaimUsable(invite ? { status: invite.status, expiresAt: invite.expires_at } : null, Date.now());
  return invite as InviteRow;
}

/** Listings this handle posted that nobody has claimed yet. */
async function unclaimedListings(invite: InviteRow) {
  const data = check(
    await adminClient().from("listings").select(LISTING_SELECT).eq("school_id", invite.school_id)
      .eq("external_channel", invite.channel).eq("external_handle", invite.handle).is("seller_id", null)
      .in("status", ["active", "pending"]).order("created_at", { ascending: false }),
  );
  return z.array(ListingRow).parse(data);
}

async function offersOn(listingIds: string[], extra: (q: ReturnType<typeof offersQuery>) => ReturnType<typeof offersQuery>) {
  if (!listingIds.length) return [];
  return z.array(OfferRow).parse(check(await extra(offersQuery(listingIds)).order("created_at", { ascending: false })));
}
const offersQuery = (listingIds: string[]) => adminClient().from("offers").select("*").in("listing_id", listingIds);

/** Hands the invite's unclaimed listings, and the offers waiting on them, to `userId`. Single use. */
async function claimInvite(invite: InviteRow, userId: string, schoolId: string) {
  const db = adminClient();
  const now = new Date().toISOString();

  // Single use: only one request can flip it to claimed.
  const claimed = check(
    await db.from("seller_invites").update({ status: "claimed", claimed_by: userId, claimed_at: now })
      .eq("id", invite.id).in("status", ["queued", "sent"]).gt("expires_at", now).select("id").maybeSingle(),
  );
  if (!claimed) assertClaimUsable(null, Date.now());

  const listings = await unclaimedListings(invite);
  const ids = listings.map((l) => l.id);
  if (ids.length) {
    // You can't have an offer on your own listing; any the claimer made end here.
    const own = await db.from("offers").update({ status: "withdrawn", waiting_on: null }).in("listing_id", ids).eq("buyer_id", userId).eq("status", "pending");
    if (own.error) throw own.error;
    const linked = await db.from("listings").update({ seller_id: userId }).in("id", ids).is("seller_id", null);
    if (linked.error) throw linked.error;
    const waiting = await db.from("offers")
      .update({ seller_id: userId, waiting_on: afterClaim("seller_claim"), seller_notified_at: now })
      .in("listing_id", ids).eq("status", "pending").eq("waiting_on", "seller_claim").neq("buyer_id", userId);
    if (waiting.error) throw waiting.error;
    const rest = await db.from("offers").update({ seller_id: userId }).in("listing_id", ids).is("seller_id", null).neq("buyer_id", userId);
    if (rest.error) throw rest.error;
  }

  const [rows, pending] = await Promise.all([
    ids.length ? db.from("listings").select(LISTING_SELECT).in("id", ids) : Promise.resolve({ data: [], error: null }),
    offersOn(ids, (q) => q.eq("status", "pending").eq("seller_id", userId)),
  ]);
  const mine = z.array(ListingRow).parse(check(rows));
  await Promise.all(pending.map((o) => notify({
    schoolId, userId: o.buyer_id, type: "offer.updated",
    title: "The seller joined", body: `@${invite.handle} can now accept your offer.`,
    deepLink: `/listings/${o.listing_id}`, data: { offer_id: o.id, listing_id: o.listing_id },
  })));
  return {
    listings: await listingsOut(mine, schoolId, { id: userId, courses: new Map() }),
    pending_offers: await offersOut(pending, schoolId),
  };
}

export const claimsRoutes = (verify: TokenVerifier, demoAuth = false) => new Hono<AuthEnv>()
  .get("/:token", async (c) => {
    const invite = await inviteFor(c.req.param("token"));
    const listings = await unclaimedListings(invite);
    const offers = await offersOn(listings.map((l) => l.id), (q) => q.eq("status", "pending").eq("waiting_on", "seller_claim"));
    return c.json(one({
      external_seller: { channel: invite.channel, handle: invite.handle, profile_url: invite.profile_url },
      listings: await listingsOut(listings, invite.school_id, null),
      pending_offers: await offersOut(offers, invite.school_id),
      expires_at: new Date(invite.expires_at).toISOString(),
    }));
  })

  // DEMO_AUTH=on: claim with no sign-in. The link went only to the handle's DMs, so holding it is the
  // proof; the handle gets its own account and comes back signed in, ready to accept the offer.
  .post("/:token/demo", async (c) => {
    if (!demoAuth) throw new ApiError(404, "NOT_FOUND", "Route not found");
    const invite = await inviteFor(c.req.param("token"));
    const account = await accountForHandle(invite.school_id, invite.channel, invite.handle);
    const claimed = await claimInvite(invite, account.id, invite.school_id);
    return c.json(one({ session: { ...(await demoSession(account.email)), email: account.email }, ...claimed }));
  })

  .post("/:token", requireUser(verify), async (c) => {
    const { id: userId, schoolId } = c.var.user;
    const invite = await inviteFor(c.req.param("token"));
    if (invite.school_id !== schoolId) throw new ApiError(403, "FORBIDDEN", "This link is for a different school");
    return c.json(one(await claimInvite(invite, userId, schoolId)));
  });
