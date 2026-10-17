import { createHmac, timingSafeEqual } from "node:crypto";
import type { LatLng } from "../schemas/common.js";
import { ApiError } from "../lib/errors.js";
import { distanceM, withinRadius } from "./geo.js";

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

// ---------------------------------------------------------------- live meetup safety (pure logic)

export const MAX_ACCURACY_M = 100; // worse fixes update last-seen only
export const TAP_WINDOW_MS = 60_000; // both "Confirm trade" taps must land within this
export const TAP_MAX_SEPARATION_M = 50; // + min(accuracies, 50)
export const SHARING_MARGIN_MS = 30 * 60_000; // location is visible from 30 min before start to 30 min after end
export const NO_SHOW_GRACE_MS = 15 * 60_000;
export const OVERDUE_MS = 60 * 60_000; // after agreed_end, the sweep steps in

export type Party = "giver" | "receiver";
export interface Zone { location: LatLng; radiusM: number }
export interface Fix { location: LatLng; accuracyM: number }

export const accuracyOk = (accuracyM: number) => accuracyM <= MAX_ACCURACY_M;
/** Nearest 10 m. */
export const roundDistance = (m: number) => Math.round(m / 10) * 10;

export interface ZoneReading {
  accuracyOk: boolean;
  /** Inside the zone with a trustworthy fix. */
  inside: boolean;
  /** Metres to the zone's edge, rounded to 10 m; 0 only when inside. Null when the fix is too inaccurate. */
  distanceToZoneM: number | null;
}

export function readZone(fix: Fix, zone: Zone): ZoneReading {
  if (!accuracyOk(fix.accuracyM)) return { accuracyOk: false, inside: false, distanceToZoneM: null };
  const inside = withinRadius(fix.location, zone.location, zone.radiusM, fix.accuracyM);
  if (inside) return { accuracyOk: true, inside: true, distanceToZoneM: 0 };
  const edge = Math.max(0, distanceM(fix.location, zone.location) - zone.radiusM);
  return { accuracyOk: true, inside: false, distanceToZoneM: Math.max(10, roundDistance(edge)) };
}

export function sharingWindow(agreedStart: number, agreedEnd: number) {
  return { startsAt: agreedStart - SHARING_MARGIN_MS, endsAt: agreedEnd + SHARING_MARGIN_MS };
}

/** Whether the other party may see this person's distance (arrival is always visible). */
export function mayShareDistance(p: {
  status: HandoffStatus; now: number; agreedStart: number | null; agreedEnd: number | null; sharerSetting: "off" | "during_handoffs";
}): boolean {
  if (p.status !== "agreed" && p.status !== "arriving") return false;
  if (p.sharerSetting !== "during_handoffs" || p.agreedStart === null || p.agreedEnd === null) return false;
  const w = sharingWindow(p.agreedStart, p.agreedEnd);
  return p.now >= w.startsAt && p.now <= w.endsAt;
}

/** What a location ping changes: the nearby flag only moves on a trustworthy fix. */
export function presenceAfterPing(previousNearby: boolean, reading: ZoneReading): boolean {
  return reading.accuracyOk ? reading.inside : previousNearby;
}

export interface TapPoint { at: number; location: LatLng; accuracyM: number }
export type TapDecision = { outcome: "paired" } | { outcome: "waiting"; reason: "no_other_tap" | "expired" | "far_apart" | "outside_zone" };

/** `mine` is the tap that just landed; `theirs` the other party's stored tap, if any. */
export function decideTap(mine: TapPoint, theirs: TapPoint | null, zone: Zone): TapDecision {
  if (!theirs) return { outcome: "waiting", reason: "no_other_tap" };
  if (Math.abs(mine.at - theirs.at) > TAP_WINDOW_MS) return { outcome: "waiting", reason: "expired" };
  for (const t of [mine, theirs]) {
    if (!accuracyOk(t.accuracyM) || !withinRadius(t.location, zone.location, zone.radiusM, t.accuracyM)) {
      return { outcome: "waiting", reason: "outside_zone" };
    }
  }
  const slack = TAP_MAX_SEPARATION_M + Math.min(mine.accuracyM, theirs.accuracyM, 50);
  if (distanceM(mine.location, theirs.location) > slack) return { outcome: "waiting", reason: "far_apart" };
  return { outcome: "paired" };
}

export const tapExpiresAt = (tapAt: number) => tapAt + TAP_WINDOW_MS;
export const tapStillValid = (tapAt: number | null, now: number) => tapAt !== null && now - tapAt <= TAP_WINDOW_MS;

export type NoShowCheck = { ok: true } | { ok: false; reason: "wrong_state" | "too_early" | "bad_accuracy" | "not_in_zone" | "other_arrived" };

export function checkNoShow(p: {
  status: HandoffStatus; now: number; agreedStart: number | null; reporter: Fix; zone: Zone; otherNearby: boolean; otherTapped: boolean;
}): NoShowCheck {
  if ((p.status !== "agreed" && p.status !== "arriving") || p.agreedStart === null) return { ok: false, reason: "wrong_state" };
  if (p.now < p.agreedStart + NO_SHOW_GRACE_MS) return { ok: false, reason: "too_early" };
  if (!accuracyOk(p.reporter.accuracyM)) return { ok: false, reason: "bad_accuracy" };
  if (!withinRadius(p.reporter.location, p.zone.location, p.zone.radiusM, p.reporter.accuracyM)) return { ok: false, reason: "not_in_zone" };
  if (p.otherNearby || p.otherTapped) return { ok: false, reason: "other_arrived" };
  return { ok: true };
}

export type OverdueDecision =
  | { action: "wait" }
  | { action: "no_show"; absent: Party }
  | { action: "reschedule" }
  | { action: "notify_both" };

/** For a handoff still agreed/arriving an hour after it should have ended. */
export function decideOverdue(p: { now: number; agreedEnd: number; giverArrived: boolean; receiverArrived: boolean }): OverdueDecision {
  if (p.now <= p.agreedEnd + OVERDUE_MS) return { action: "wait" };
  if (p.giverArrived && p.receiverArrived) return { action: "notify_both" };
  if (p.giverArrived) return { action: "no_show", absent: "receiver" };
  if (p.receiverArrived) return { action: "no_show", absent: "giver" };
  return { action: "reschedule" };
}
