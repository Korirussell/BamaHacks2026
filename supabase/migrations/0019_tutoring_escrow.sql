-- Tutoring escrow: the student's payment is held on the platform from POST /tutoring/sessions/{id}/pay
-- until the session's handoff is confirmed (or the student completes a virtual session), then
-- transferred to the tutor; cancel / no-show refunds the student. Same ledger as orders.

alter table public.escrow_entries
  alter column order_id drop not null,
  add column tutoring_session_id uuid references public.tutoring_sessions (id) on delete cascade,
  add constraint escrow_entries_one_subject check (num_nonnulls(order_id, tutoring_session_id) = 1),
  add constraint escrow_entries_session_kind_key unique (tutoring_session_id, kind);
create index escrow_entries_session_idx on public.escrow_entries (tutoring_session_id) where tutoring_session_id is not null;

-- payment_intent_id already exists (0003). Money summary, mirroring orders.payment_status / payout_status.
alter table public.tutoring_sessions
  add column payment_status     text not null default 'none'
                                check (payment_status in ('none', 'requires_payment', 'succeeded', 'failed', 'refunded')),
  add column payout_status      text check (payout_status in ('held', 'awaiting_onboarding', 'released', 'reversed')),
  add column fee_cents          int check (fee_cents >= 0),
  add column tutor_payout_cents int check (tutor_payout_cents >= 0),
  add column paid_at            timestamptz,
  add column released_at        timestamptz;
create index tutoring_sessions_awaiting_payout_idx on public.tutoring_sessions (tutor_id)
  where payout_status = 'awaiting_onboarding';
