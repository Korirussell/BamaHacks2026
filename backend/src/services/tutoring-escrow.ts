import { z } from "zod";
import { SESSION_SELECT, SessionRow } from "../db/tutoring.js";
import { ApiError } from "../lib/errors.js";
import { notify } from "../lib/notify.js";
import { adminClient } from "../lib/supabase.js";
import { paymentProvider, type EscrowKind, type Payable } from "./escrow.js";
import { splitAmount } from "./orders.js";

// Tutoring escrow, same model as orders (services/escrow.ts): the student's payment is held on the
// platform from pay until the session happened (handoff confirmed, or the student completes a
// virtual session), then the tutor is paid; cancel / no-show refunds the student. Every database
// touch goes through SessionEscrowStore so tests run with fakes.

export const EscrowSession = SessionRow.extend({ updated_at: z.string() });
export type EscrowSession = z.infer<typeof EscrowSession>;

export interface SessionEscrowStore {
  /** Writes only if nobody changed the session since it was read (409 otherwise). */
  update(row: EscrowSession, patch: Record<string, unknown>): Promise<EscrowSession>;
  /** Ledger row in escrow_entries; a repeat of the same kind is ignored. */
  record(row: EscrowSession, kind: EscrowKind, amountCents: number, ref: string, reason: string): Promise<void>;
  payoutsEnabled(tutorId: string, schoolId: string): Promise<boolean>;
  /** In-person sessions: the handoff (tutor gives, student receives), already agreed at the session's time and place. */
  openHandoff(row: EscrowSession): Promise<EscrowSession>;
  /** Cancels the session's handoff if it is still open. */
  cancelHandoff(row: EscrowSession): Promise<void>;
}

export interface SessionEscrowDeps {
  store: SessionEscrowStore;
  notify: typeof notify;
}

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

export const supabaseSessionEscrowStore: SessionEscrowStore = {
  async update(row, patch) {
    const data = check(
      await adminClient().from("tutoring_sessions").update(patch).eq("id", row.id).eq("updated_at", row.updated_at)
        .select(`${SESSION_SELECT}, updated_at`).maybeSingle(),
    );
    if (!data) throw new ApiError(409, "INVALID_STATE", "The session changed; reload and try again");
    return EscrowSession.parse(data);
  },
  async record(row, kind, amountCents, ref, reason) {
    const { error } = await adminClient().from("escrow_entries").insert({
      school_id: row.school_id, tutoring_session_id: row.id, kind, amount_cents: amountCents,
      provider: paymentProvider().name, provider_ref: ref, reason,
    });
    if (error && error.code !== "23505") throw error; // already recorded by a retry
  },
  async payoutsEnabled(tutorId, schoolId) {
    const data = check(await adminClient().from("profiles").select("payouts_enabled").eq("id", tutorId).eq("school_id", schoolId).maybeSingle());
    return z.object({ payouts_enabled: z.boolean() }).nullable().parse(data)?.payouts_enabled ?? false;
  },
  async openHandoff(row) {
    const db = adminClient();
    // Without a meeting spot the two pick one through /handoffs/{id}/suggest → propose → agree.
    const agreed = row.safe_zone_id
      ? { status: "agreed", agreed_start: row.start_at, agreed_end: row.end_at, safe_zone_id: row.safe_zone_id }
      : {};
    const created = check(await db.from("handoffs").upsert(
      { school_id: row.school_id, context_type: "tutoring_session", context_id: row.id, giver_id: row.tutor_id, receiver_id: row.student_id, ...agreed },
      { onConflict: "context_type,context_id", ignoreDuplicates: false },
    ).select("id").single<{ id: string }>());
    if (row.handoff_id === created.id) return row;
    const linked = check(await db.from("tutoring_sessions").update({ handoff_id: created.id }).eq("id", row.id).select(`${SESSION_SELECT}, updated_at`).single());
    return EscrowSession.parse(linked);
  },
  async cancelHandoff(row) {
    if (!row.handoff_id) return;
    const { error } = await adminClient().from("handoffs").update({ status: "cancelled" })
      .eq("id", row.handoff_id).not("status", "in", "(completed,cancelled,no_show)");
    if (error) throw error;
  },
};

export const defaultSessionEscrowDeps = (): SessionEscrowDeps => ({ store: supabaseSessionEscrowStore, notify });

/** The session as the payment provider sees it: student pays, tutor is paid. */
export const sessionPayable = (row: SessionRow): Payable => ({
  kind: "tutoring_session", id: row.id, school_id: row.school_id, buyer_id: row.student_id, seller_id: row.tutor_id,
  amount_cents: row.price_cents, payment_intent_id: row.payment_intent_id,
});

const isPaid = (row: SessionRow) => row.payment_status === "succeeded";

/**
 * Student taps pay on an accepted session. Demo: held at once (session comes back paid).
 * Stripe: the PaymentIntent is created and stored; the session stays accepted until
 * markSessionPaid runs from the payment_intent.succeeded webhook. Retries return the same payment.
 */
export async function beginSessionPayment(
  row: EscrowSession,
  opts: { idempotencyKey: string; feeBps: number },
  deps: SessionEscrowDeps = defaultSessionEscrowDeps(),
): Promise<{ session: EscrowSession; clientSecret: string | null }> {
  if (row.status !== "accepted" || isPaid(row)) {
    throw new ApiError(409, "INVALID_STATE", row.status === "paid" ? "This session is already paid" : `Can't pay for a ${row.status} session`);
  }
  if (row.price_cents <= 0) throw new ApiError(409, "INVALID_STATE", "This session is free; there's nothing to pay");

  const started = await paymentProvider().startPayment(sessionPayable(row), { idempotencyKey: opts.idempotencyKey });
  // The fee is fixed when the student pays, so a later fee change doesn't move a held payment.
  const { fee_cents, seller_payout_cents } = splitAmount(row.price_cents, opts.feeBps);
  const pending = row.payment_intent_id === started.ref && row.fee_cents !== null
    ? row
    : await deps.store.update(row, {
      payment_intent_id: started.ref, payment_status: "requires_payment", fee_cents, tutor_payout_cents: seller_payout_cents,
    });
  if (started.settled) return { session: await markSessionPaid(pending, started.ref, deps), clientSecret: null };
  return { session: pending, clientSecret: started.clientSecret };
}

/**
 * The student's money is held: session → paid, ledger "hold", in-person sessions get their handoff,
 * the tutor is told. Safe to call twice (webhook retries, or the pay route seeing it first).
 */
export async function markSessionPaid(row: EscrowSession, ref: string, deps: SessionEscrowDeps = defaultSessionEscrowDeps()): Promise<EscrowSession> {
  if (row.status !== "accepted" || isPaid(row)) return row;
  const tutorCents = row.tutor_payout_cents ?? row.price_cents;
  let paid = await deps.store.update(row, {
    status: "paid", payment_status: "succeeded", payment_intent_id: ref, paid_at: new Date().toISOString(), payout_status: "held",
    tutor_payout_cents: tutorCents, fee_cents: row.fee_cents ?? row.price_cents - tutorCents,
  });
  await deps.store.record(paid, "hold", paid.price_cents, ref, "student_paid");
  if (paid.location_kind !== "virtual") paid = await deps.store.openHandoff(paid);
  await deps.notify({
    schoolId: paid.school_id, userId: paid.tutor_id, type: "tutoring.updated", title: "Session paid",
    body: `${paid.course.code}: the student paid. You're paid out once the session is confirmed.`,
    deepLink: `/tutoring/sessions/${paid.id}`, data: { session_id: paid.id, status: paid.status },
  });
  return paid;
}

export type SessionOutcome = "completed" | "cancelled" | "no_show";

/**
 * Move a session to a final state and settle the money:
 * - completed → pay the tutor (or awaiting_onboarding until their Stripe account can be paid)
 * - cancelled / no_show → refund the student if they paid, or abandon an unfinished payment
 * State-machine checks (who, when, from which status) are the caller's job.
 */
export async function settleSession(
  row: EscrowSession,
  outcome: SessionOutcome,
  opts: { reason: string; patch?: Record<string, unknown> },
  deps: SessionEscrowDeps = defaultSessionEscrowDeps(),
): Promise<EscrowSession> {
  const provider = paymentProvider();
  const now = new Date().toISOString();
  const base = { ...opts.patch, status: outcome, waiting_on: null };

  if (outcome === "completed") {
    if (!isPaid(row)) return deps.store.update(row, base); // unpaid sessions (no card step) just finish
    const payable = await deps.store.payoutsEnabled(row.tutor_id, row.school_id);
    const amount = row.tutor_payout_cents ?? row.price_cents;
    const moved = await deps.store.update(row, {
      ...base, payout_status: payable ? "released" : "awaiting_onboarding", ...(payable ? { released_at: now } : {}),
    });
    if (payable) {
      const { ref } = await provider.release(sessionPayable(moved), amount);
      await deps.store.record(moved, "release", amount, ref, opts.reason);
    }
    return moved;
  }

  if (!isPaid(row)) {
    if (row.payment_intent_id) await provider.cancelPayment(sessionPayable(row));
    const moved = await deps.store.update(row, base);
    await deps.store.cancelHandoff(moved);
    return moved;
  }
  const moved = await deps.store.update(row, { ...base, payment_status: "refunded", payout_status: "reversed" });
  const { ref } = await provider.refund(sessionPayable(moved), moved.price_cents);
  await deps.store.record(moved, "refund", moved.price_cents, ref, opts.reason);
  await deps.store.cancelHandoff(moved);
  return moved;
}

/** Tutor finished payout onboarding: pay out a session completed while they couldn't be paid. */
export async function releaseAwaitingSessionPayout(row: EscrowSession, deps: SessionEscrowDeps = defaultSessionEscrowDeps()): Promise<EscrowSession> {
  if (row.status !== "completed" || row.payout_status !== "awaiting_onboarding") return row;
  const amount = row.tutor_payout_cents ?? row.price_cents;
  const moved = await deps.store.update(row, { payout_status: "released", released_at: new Date().toISOString() });
  const { ref } = await paymentProvider().release(sessionPayable(moved), amount);
  await deps.store.record(moved, "release", amount, ref, "tutor_onboarded");
  return moved;
}

/** Loads a session for the webhook / handoff side (no viewer check). */
export async function loadEscrowSession(column: "id" | "payment_intent_id", value: string): Promise<EscrowSession | null> {
  const data = check(await adminClient().from("tutoring_sessions").select(`${SESSION_SELECT}, updated_at`).eq(column, value).maybeSingle());
  return data ? EscrowSession.parse(data) : null;
}
