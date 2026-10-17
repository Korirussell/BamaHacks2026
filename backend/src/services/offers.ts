import { ApiError } from "../lib/errors.js";

export const OFFER_TTL_MS = 48 * 60 * 60 * 1000;

export type OfferStatus = "pending" | "countered" | "accepted" | "declined" | "withdrawn" | "expired";
export type WaitingOn = "buyer" | "seller" | "seller_claim" | null;

export interface OfferListing {
  status: "draft" | "active" | "pending" | "sold" | "removed";
  priceCents: number;
  claimed: boolean;
  sellerId: string | null;
}

/** Validate a new offer and decide its initial state (contract: auto-accept rule). */
export function openOffer(input: {
  listing: OfferListing;
  buyerId: string;
  kind: "cash" | "trade" | "cash_plus_trade";
  amountCents: number;
  now: number;
}): { status: "pending" | "accepted"; waitingOn: WaitingOn; queueSellerInvite: boolean; expiresAt: string } {
  const { listing } = input;
  if (listing.status !== "active") throw new ApiError(409, "INVALID_STATE", "Listing isn't available");
  if (listing.sellerId === input.buyerId) throw new ApiError(403, "FORBIDDEN", "You can't make an offer on your own listing");
  if (input.amountCents <= 0 && input.kind === "cash") throw new ApiError(400, "VALIDATION", "Offer must be above $0");
  const expiresAt = new Date(input.now + OFFER_TTL_MS).toISOString();
  if (!listing.claimed) return { status: "pending", waitingOn: "seller_claim", queueSellerInvite: true, expiresAt };
  if (input.kind === "cash" && input.amountCents >= listing.priceCents) {
    return { status: "accepted", waitingOn: null, queueSellerInvite: false, expiresAt };
  }
  return { status: "pending", waitingOn: "seller", queueSellerInvite: false, expiresAt };
}

/** Who may act on a pending offer, and what each action does. */
export function actOnOffer(
  offer: { status: OfferStatus; waitingOn: WaitingOn; expiresAt: string },
  actor: "buyer" | "seller",
  action: "accept" | "decline" | "counter" | "withdraw",
  now: number,
): OfferStatus {
  if (offer.status !== "pending") throw new ApiError(409, "INVALID_STATE", `Offer is ${offer.status}`);
  if (Date.parse(offer.expiresAt) <= now) throw new ApiError(409, "INVALID_STATE", "Offer expired");
  if (action === "withdraw") {
    if (actor !== "buyer") throw new ApiError(403, "FORBIDDEN", "Only the buyer can withdraw");
    return "withdrawn";
  }
  if (offer.waitingOn === "seller_claim") throw new ApiError(409, "INVALID_STATE", "Seller hasn't claimed this listing yet");
  if (offer.waitingOn !== actor) throw new ApiError(409, "INVALID_STATE", "It's the other person's turn");
  return { accept: "accepted", decline: "declined", counter: "countered" }[action] as OfferStatus;
}

/** After a claim, offers that were waiting on the claim now wait on the seller. */
export const afterClaim = (w: WaitingOn): WaitingOn => (w === "seller_claim" ? "seller" : w);
