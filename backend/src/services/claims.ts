import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "../lib/errors.js";

export const CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** New claim token. Only the sha256 hash is stored; the raw token goes in the DM link. */
export function newClaimToken(now: number) {
  const token = randomBytes(24).toString("base64url");
  return { token, tokenHash: hashClaimToken(token), expiresAt: new Date(now + CLAIM_TTL_MS).toISOString() };
}

export const hashClaimToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function assertClaimUsable(invite: { status: string; expiresAt: string } | null, now: number) {
  if (!invite || invite.status === "claimed" || invite.status === "expired" || Date.parse(invite.expiresAt) <= now) {
    throw new ApiError(410, "CLAIM_INVALID", "This claim link has expired or was already used");
  }
}

export function claimUrl(appBaseUrl: string, token: string) {
  return `${appBaseUrl.replace(/\/$/, "")}/claim/${token}`;
}

/** The DM we send (by hand for now) to the person who posted the item. */
export function sellerInviteMessage(input: {
  handle: string;
  itemTitle: string;
  offerCents: number | null;
  courseCode: string | null;
  appName: string;
  url: string;
}): string {
  const offer = input.offerCents !== null ? ` A UA student offered $${(input.offerCents / 100).toFixed(2)} for it.` : "";
  const need = input.courseCode ? ` Students in ${input.courseCode} need this book.` : "";
  return (
    `Hey @${input.handle}! Saw you're selling "${input.itemTitle}".${offer}${need} ` +
    `We put it on ${input.appName} for you. Claim it with your .edu email to accept and get paid: ${input.url} ` +
    `(Not yours or not interested? Just ignore this and it comes down in 7 days.)`
  );
}

/** The claim link inside a stored invite message (only the token's hash is stored on its own). */
export function claimUrlIn(message: string): string | null {
  return message.match(/https?:\/\/\S+\/claim\/[A-Za-z0-9_-]+/)?.[0] ?? null;
}
