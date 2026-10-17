import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { broadcast } from "../lib/realtime.js";
import { adminClient } from "../lib/supabase.js";
import { settleOrder } from "../services/escrow.js";
import { decideOverdue, type Party } from "../services/handoff.js";
import { nextOrderStatus } from "../services/orders.js";
import { loadEscrowSession, settleSession, type EscrowSession } from "../services/tutoring-escrow.js";
import {
  HANDOFF_SELECT, HandoffRow, RESET_FOR_RESCHEDULE, WIPE_POSITIONS, loadSharing, saveHandoff, toHandoff,
} from "./fulfillment.js";
import { OrderRow } from "./market.js";
import { loadUsersPublic } from "./users.js";

/** The handoff as one party sees it (viewer-relative tracking), or neutral when `viewerId` is null. */
export async function handoffOut(handoff: HandoffRow, viewerId: string | null = null) {
  const ids = [handoff.giver_id, handoff.receiver_id];
  const [users, sharing] = await Promise.all([
    loadUsersPublic(ids, handoff.school_id),
    viewerId ? loadSharing(ids, handoff.school_id) : Promise.resolve(new Map()),
  ]);
  return toHandoff(handoff, users, viewerId ? { id: viewerId, now: Date.now(), sharing } : null);
}

/** Realtime `handoff:{id}` broadcast. Payloads are identical for both phones, so no coordinates or distances. */
export const announce = (handoffId: string, event: string, payload: object) => broadcast(`handoff:${handoffId}`, event, payload);

export const partyId = (h: HandoffRow, party: Party) => (party === "giver" ? h.giver_id : h.receiver_id);

/** The order behind an order handoff, loaded without a viewer (used by timers/sweeps). Null for tutoring. */
export async function orderOf(handoff: HandoffRow): Promise<OrderRow | null> {
  if (handoff.context_type !== "order") return null;
  const { data, error } = await adminClient().from("orders").select("*")
    .eq("school_id", handoff.school_id).eq("id", handoff.context_id).maybeSingle();
  if (error) throw error;
  return data ? OrderRow.parse(data) : null;
}

/** The paid tutoring session behind a tutoring handoff (giver = tutor, receiver = student). Null for orders. */
export async function sessionOf(handoff: HandoffRow): Promise<EscrowSession | null> {
  if (handoff.context_type !== "tutoring_session") return null;
  const row = await loadEscrowSession("id", handoff.context_id);
  return row && row.school_id === handoff.school_id ? row : null;
}

/** Checks a tutoring session can be settled by its handoff before anything is written. */
export function requirePaidSession(session: EscrowSession | null) {
  if (session && session.status !== "paid") throw new ApiError(409, "INVALID_STATE", `Session is ${session.status}`);
}

/**
 * Money move for a confirmed tutoring handoff: the student confirmed → pay the tutor. A student
 * who flags a problem (item_ok=false) leaves the money held on a still-paid session for the team.
 */
export async function settleHandoffSession(session: EscrowSession, itemOk: boolean, reason: string): Promise<EscrowSession> {
  if (!itemOk) {
    console.warn(`tutoring session ${session.id}: student flagged a problem at the handoff; payment held for review`);
    return session;
  }
  return settleSession(session, "completed", { reason });
}

export async function sellerPayoutsEnabled(sellerId: string, schoolId: string): Promise<boolean> {
  const { data, error } = await adminClient().from("profiles").select("payouts_enabled").eq("id", sellerId).eq("school_id", schoolId).single();
  if (error) throw error;
  return z.object({ payouts_enabled: z.boolean() }).parse(data).payouts_enabled;
}

async function notifyBoth(h: HandoffRow, title: (userId: string) => string, body: (userId: string) => string) {
  await Promise.all([h.giver_id, h.receiver_id].map((userId) => notify({
    schoolId: h.school_id, userId, type: "handoff.updated", title: title(userId), body: body(userId),
    deepLink: `/handoffs/${h.id}`, data: { handoff_id: h.id, status: h.status },
  })));
}

async function bumpNoShowCount(userId: string, schoolId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await adminClient().from("profiles").select("no_show_count").eq("id", userId).eq("school_id", schoolId).single();
    if (error) throw error;
    const count = z.object({ no_show_count: z.number().int() }).parse(data).no_show_count;
    const res = await adminClient().from("profiles").update({ no_show_count: count + 1 })
      .eq("id", userId).eq("school_id", schoolId).eq("no_show_count", count).select("id");
    if (res.error) throw res.error;
    if (res.data.length) return;
  }
  console.error("no_show_count bump lost a race", userId);
}

/**
 * Marks the handoff no_show against `absent`, refunds the buyer (order handoffs, via settleOrder),
 * bumps the absent party's no_show_count, wipes positions, notifies both and broadcasts.
 * Eligibility (timing, location) is the caller's job; this checks the state machine only.
 */
export async function reportNoShow(handoff: HandoffRow, reporterId: string, absent: Party, reason: "reported" | "overdue"): Promise<HandoffRow> {
  if (handoff.status !== "agreed" && handoff.status !== "arriving") throw new ApiError(409, "INVALID_STATE", `Handoff is ${handoff.status}`);
  const order = await orderOf(handoff);
  const refunded = order ? nextOrderStatus(order.status, "no_show") : null; // reject before writing anything
  const session = await sessionOf(handoff);
  requirePaidSession(session);
  const absentId = partyId(handoff, absent);

  const saved = await saveHandoff(handoff, { status: "no_show", no_show_party: absent, ...WIPE_POSITIONS });
  if (order && refunded === "refunded") {
    // Order handoff: giver = seller, receiver = buyer. The buyer is refunded either way.
    await settleOrder(order, "refunded", { reason: `no_show:${absent === "giver" ? "seller" : "buyer"}` });
  }
  if (session) {
    // Tutoring handoff: giver = tutor, receiver = student. The student is refunded either way.
    await settleSession(session, "no_show", { reason: `no_show:${absent === "giver" ? "tutor" : "student"}` });
  }
  const payer = session ? "student" : "buyer";
  await bumpNoShowCount(absentId, handoff.school_id);
  await notifyBoth(
    saved,
    (userId) => (userId === absentId ? "Missed meetup" : "Meetup no-show"),
    (userId) => (userId === absentId
      ? `You didn't make it to the meetup, so it was cancelled and the ${payer} was refunded.`
      : reason === "overdue" ? `The other person never showed up. The meetup was cancelled and the ${payer} was refunded.`
      : `No-show recorded. The ${payer} was refunded.`),
  );
  void reporterId;
  await announce(saved.id, "handoff.updated", await handoffOut(saved));
  return saved;
}

/**
 * Timer entry point. For handoffs still agreed/arriving an hour after they should have ended:
 * - exactly one party ever arrived → no-show against the other
 * - nobody arrived → back to `proposing` (order stays `scheduled`: the state machine has no
 *   scheduled→paid edge, and /agree skips the order step for an already-scheduled order)
 * - both arrived but nobody confirmed → leave it (they may still use the QR code), notify once
 */
export async function sweepOverdueHandoffs(now: number): Promise<{ noShows: number; rescheduled: number }> {
  const { data, error } = await adminClient().from("handoffs").select(HANDOFF_SELECT)
    .in("status", ["agreed", "arriving"]).lt("agreed_end", new Date(now - 60 * 60_000).toISOString()).limit(200);
  if (error) throw error;
  const out = { noShows: 0, rescheduled: 0 };
  for (const raw of data ?? []) {
    try {
      const h = HandoffRow.parse(raw);
      if (!h.agreed_end) continue;
      const decision = decideOverdue({
        now, agreedEnd: Date.parse(h.agreed_end),
        giverArrived: h.giver_arrived_at !== null || h.giver_nearby || h.giver_at !== null,
        receiverArrived: h.receiver_arrived_at !== null || h.receiver_nearby || h.receiver_at !== null,
      });
      if (decision.action === "no_show") {
        const present = decision.absent === "giver" ? h.receiver_id : h.giver_id;
        await reportNoShow(h, present, decision.absent, "overdue");
        out.noShows++;
      } else if (decision.action === "reschedule") {
        const saved = await saveHandoff(h, RESET_FOR_RESCHEDULE);
        await notifyBoth(saved, () => "Meetup didn't happen", () => "Neither of you made it. Pick a new time and place.");
        await announce(saved.id, "handoff.updated", await handoffOut(saved));
        out.rescheduled++;
      } else if (decision.action === "notify_both" && !h.overdue_notified_at) {
        const saved = await saveHandoff(h, { overdue_notified_at: new Date(now).toISOString() });
        await notifyBoth(saved, () => "Finish your handoff", () => "The meetup time has passed. Confirm with the code, or report a problem.");
      }
    } catch (e) {
      console.error("handoff sweep failed for one handoff", e instanceof Error ? e.message : e); // one bad row must not stop the rest
    }
  }
  return out;
}
