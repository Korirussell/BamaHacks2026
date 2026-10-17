import { z } from "zod";
import { Timestamp, Uuid } from "./common.js";
import { ExternalSeller, Listing } from "./listings.js";
import { Offer } from "./offers.js";

export const ClaimPreviewRes = z.object({ external_seller: ExternalSeller, listings: z.array(Listing), pending_offers: z.array(Offer), expires_at: Timestamp });
export const ClaimRes = z.object({ listings: z.array(Listing), pending_offers: z.array(Offer) });
export const SellerInvite = z.object({ id: Uuid, external_seller: ExternalSeller, listing_ids: z.array(Uuid), claim_url: z.string(), message_text: z.string(), status: z.enum(["queued", "sent", "claimed", "expired"]), trigger: z.enum(["first_offer", "manual"]), sent_at: Timestamp.nullable(), claimed_at: Timestamp.nullable(), expires_at: Timestamp });
export const AdminIngestPostReq = z.object({ channel: z.enum(["instagram", "groupme", "facebook", "snapchat"]), external_url: z.string(), author_handle: z.string(), caption: z.string(), media_ids: z.array(Uuid), posted_at: Timestamp });
export const AdminIngestPostRes = z.object({ job_id: Uuid, ingested_post_id: Uuid });

export type ClaimPreviewRes = z.infer<typeof ClaimPreviewRes>;
export type ClaimRes = z.infer<typeof ClaimRes>;
export type SellerInvite = z.infer<typeof SellerInvite>;
export type AdminIngestPostReq = z.infer<typeof AdminIngestPostReq>;
export type AdminIngestPostRes = z.infer<typeof AdminIngestPostRes>;
