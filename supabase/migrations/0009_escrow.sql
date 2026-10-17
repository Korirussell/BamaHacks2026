-- Escrow ledger: every money movement on an order (hold when the buyer pays, release to the
-- seller on a confirmed handoff/receipt, refund to the buyer on cancel/no-show/dispute).
-- `orders.payment_status` / `orders.payout_status` stay the summary the API returns; this table
-- is the audit trail and what a real provider (Stripe, later) reconciles against.
-- Server-only: RLS on, no policies; the API writes it with the service role.

create table public.escrow_entries (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools (id),
  order_id      uuid not null references public.orders (id) on delete cascade,
  kind          text not null check (kind in ('hold', 'release', 'refund')),
  amount_cents  int not null check (amount_cents >= 0),
  provider      text not null check (provider in ('demo', 'stripe')),
  provider_ref  text,                                     -- demo id now; PaymentIntent / Transfer / Refund id later
  reason        text,                                     -- e.g. handoff_confirmed, no_show:seller, dispute_refund
  created_at    timestamptz not null default now(),
  unique (order_id, kind)                                 -- each movement happens at most once per order
);
create index escrow_entries_order_idx on public.escrow_entries (order_id);

alter table public.escrow_entries enable row level security;
-- (intentionally no policies)
