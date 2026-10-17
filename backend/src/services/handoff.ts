import { createHmac, timingSafeEqual } from "node:crypto";
import type { LatLng } from "../schemas/common.js";
import { ApiError } from "../lib/errors.js";
import { withinRadius } from "./geo.js";

// Sync-confirm rule from the contract: the giver's code rotates every 60 s; the receiver
// must present a current code AND be inside the agreed safe zone.
const ROTATE_MS = 60_000;

function digest(secret: string, handoffId: string, window: number): Buffer {
  return createHmac("sha256", secret).update(`${handoffId}:${window}`).digest();
}

export function handoffCode(secret: string, handoffId: string, now: number) {
  const window = Math.floor(now / ROTATE_MS);
  const d = digest(secret, handoffId, window);
  return {
    qr_token: d.subarray(0, 18).toString("base64url"),
    short_code: String(d.readUInt32BE(0) % 1_000_000).padStart(6, "0"),
    expires_at: new Date((window + 1) * ROTATE_MS).toISOString(),
  };
}

/** Accepts the current and the previous window, so a code scanned at second 59 still works. */
export function verifyHandoffCode(
  secret: string,
  handoffId: string,
  now: number,
  given: { qr_token?: string | undefined; short_code?: string | undefined },
): boolean {
  for (const offset of [0, -1]) {
    const expected = handoffCode(secret, handoffId, now + offset * ROTATE_MS);
    if (given.qr_token && safeEqual(given.qr_token, expected.qr_token)) return true;
    if (given.short_code && safeEqual(given.short_code, expected.short_code)) return true;
  }
  return false;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type HandoffStatus = "proposing" | "agreed" | "arriving" | "completed" | "no_show" | "cancelled" | "expired";

export interface ConfirmInput {
  status: HandoffStatus;
  zone: { location: LatLng; radiusM: number };
  receiverAt: LatLng;
  accuracyM: number;
  code: { qr_token?: string | undefined; short_code?: string | undefined };
  itemOk: boolean;
}

export interface ProposalState {
  status: HandoffStatus;
  proposedBy: string | null;
  proposedStart: string | null;
  proposedZoneId: string | null;
}

export function handoffSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.HANDOFF_SECRET;
  if (!secret || secret.length < 32) throw new ApiError(500, "INTERNAL", "Handoff service is not configured");
  return secret;
}

/** Ensures that only the other party can accept the exact proposal on a handoff. */
export function agreeToProposal(proposal: ProposalState, actorId: string, input: { start: string; safeZoneId: string }): void {
  if (proposal.status !== "proposing") throw new ApiError(409, "INVALID_STATE", `Handoff is ${proposal.status}`);
  if (!proposal.proposedBy || !proposal.proposedStart || !proposal.proposedZoneId) {
    throw new ApiError(409, "INVALID_STATE", "Handoff has no proposal to accept");
  }
  if (proposal.proposedBy === actorId) throw new ApiError(409, "INVALID_STATE", "The other party must accept this proposal");
  // Compare instants, not strings: Postgres hands back "+00:00" where the client sent "Z".
  if (Date.parse(proposal.proposedStart) !== Date.parse(input.start) || proposal.proposedZoneId !== input.safeZoneId) {
    throw new ApiError(409, "INVALID_STATE", "Agreement must match the current proposal");
  }
}

/**
 * Decide what a receiver's confirm does. `completed` releases the payout; `item_ok: false`
 * means the meetup happened but the buyer rejects the item, so the order goes to dispute.
 */
export function confirmHandoff(secret: string, handoffId: string, now: number, input: ConfirmInput) {
  if (input.status !== "agreed" && input.status !== "arriving") {
    throw new ApiError(409, "INVALID_STATE", `Handoff is ${input.status}`);
  }
  if (!withinRadius(input.receiverAt, input.zone.location, input.zone.radiusM, input.accuracyM)) {
    throw new ApiError(403, "NOT_NEARBY", "You need to be at the meetup spot to confirm");
  }
  if (!verifyHandoffCode(secret, handoffId, now, input.code)) {
    throw new ApiError(400, "VALIDATION", "That code is wrong or expired", { qr_token: "Ask for a fresh code" });
  }
  return { handoff: "completed" as const, order: input.itemOk ? ("completed" as const) : ("disputed" as const) };
}
