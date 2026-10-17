import { z } from "zod";
import type { SellerOutreach } from "../adapters/ports.js";
import { ApiError } from "../lib/errors.js";
import { adminClient } from "../lib/supabase.js";
import { claimUrl, newClaimToken, sellerInviteMessage } from "../services/claims.js";
import { splitAmount } from "../services/orders.js";
import { OrderRow, type ListingRow, type OfferRow } from "./market.js";

export interface MarketConfig {
  /** Platform fee in basis points (PLATFORM_FEE_BPS). */
  feeBps: number;
  /** Where claim links point (the web app). */
  appUrl: string;
  appName: string;
  /** Sends the claim link automatically (Instagram: a reply on the post). Unset = queued for a human. */
  outreach?: SellerOutreach;
}

const UNIQUE_VIOLATION = "23505";

const InviteRow = z.object({ id: z.guid(), listing_ids: z.array(z.guid()), expires_at: z.string() });

/**
 * Makes sure the external seller behind an unclaimed listing has an open claim invite that
 * includes it (contract: one invite per handle; the first offer triggers it).
 */
export async function ensureSellerInvite(listing: ListingRow, offerCents: number | null, cfg: MarketConfig, now: number) {
  if (listing.seller_id || !listing.external_channel || !listing.external_handle) return;
  const db = adminClient();
  const open = await db.from("seller_invites").select("id, listing_ids, expires_at")
    .eq("channel", listing.external_channel).eq("handle", listing.external_handle).in("status", ["queued", "sent"]).maybeSingle();
  if (open.error) throw open.error;
  const existing = open.data ? InviteRow.parse(open.data) : null;

  if (existing && Date.parse(existing.expires_at) > now) {
    if (existing.listing_ids.includes(listing.id)) return;
    const updated = await db.from("seller_invites").update({ listing_ids: [...existing.listing_ids, listing.id] }).eq("id", existing.id);
    if (updated.error) throw updated.error;
    return;
  }
  if (existing) {
    const expired = await db.from("seller_invites").update({ status: "expired" }).eq("id", existing.id);
    if (expired.error) throw expired.error;
  }

  const { token, tokenHash, expiresAt } = newClaimToken(now);
  const url = claimUrl(cfg.appUrl, token);
  const course = [...listing.listing_courses].map((lc) => lc.course).sort((a, b) => a.code.localeCompare(b.code))[0];
  const message = sellerInviteMessage({
    handle: listing.external_handle,
    itemTitle: listing.textbook_title ?? listing.title,
    offerCents,
    courseCode: course?.code ?? null,
    appName: cfg.appName,
    url,
  });
  const inserted = await db.from("seller_invites").insert({
    school_id: listing.school_id,
    channel: listing.external_channel,
    handle: listing.external_handle,
    profile_url: listing.external_profile_url,
    listing_ids: [listing.id],
    token_hash: tokenHash,
    message_text: message,
    trigger: "first_offer",
    expires_at: expiresAt,
  }).select("id").single<{ id: string }>();
  // Another offer raced us to it; theirs is the open invite now.
  if (inserted.error?.code === UNIQUE_VIOLATION) return;
  if (inserted.error) throw inserted.error;
  if (!cfg.outreach) return;
  try {
    const { sent } = await cfg.outreach.send({
      channel: listing.external_channel, handle: listing.external_handle, message, listingId: listing.id,
      offerCents, courseCode: course?.code ?? null, claimUrl: url,
    });
    if (sent) await db.from("seller_invites").update({ status: "sent", sent_at: new Date(now).toISOString() }).eq("id", inserted.data.id);
  } catch (err) {
    console.error("seller outreach failed; the invite stays queued", err);
  }
}

/** Turns an accepted offer into an order and takes the listing off the market. */
export async function createOrder(offer: OfferRow, listing: ListingRow, cfg: MarketConfig): Promise<OrderRow> {
  if (!listing.seller_id) throw new ApiError(409, "INVALID_STATE", "Seller hasn't claimed this listing yet");
  const db = adminClient();
  const split = splitAmount(offer.amount_cents, cfg.feeBps);
  const inserted = await db.from("orders").insert({
    school_id: offer.school_id, listing_id: listing.id, buyer_id: offer.buyer_id, seller_id: listing.seller_id, offer_id: offer.id,
    ...split, fulfillment: offer.fulfillment,
  }).select("*").single();
  if (inserted.error) throw inserted.error;
  const reserved = await db.from("listings").update({ status: "pending" }).eq("id", listing.id).eq("status", "active");
  if (reserved.error) throw reserved.error;
  return OrderRow.parse(inserted.data);
}
