-- Tickets (module 19): campus events, ticket details on listings, and the app-transfer step on orders.
-- Tickets reuse listings, offers and orders. An app-transfer ticket order runs
--   paid --ticket-sent (seller)--> in_transit --ticket-received (buyer)--> completed
-- so no new order status is needed; in-person tickets use the normal handoff.

create table public.events (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id),
  name       text not null,
  kind       text not null check (kind in ('athletics', 'concert', 'other')),
  starts_at  timestamptz not null,
  venue      text not null,
  created_at timestamptz not null default now()
);
create index events_school_starts_idx on public.events (school_id, starts_at);

-- 0002 left an unused `ticket jsonb` placeholder; real columns replace it so event_id is a foreign key.
alter table public.listings drop column ticket;
alter table public.listings
  add column event_id        uuid references public.events (id),
  add column ticket_section  text,
  add column ticket_row      text,
  add column ticket_seat     text,
  add column ticket_transfer text check (ticket_transfer in ('app_transfer', 'in_person')),
  add check ((category = 'ticket') = (event_id is not null)),
  add check (category <> 'ticket' or (ticket_section is not null and ticket_transfer is not null));
create index listings_event_idx on public.listings (event_id, status) where event_id is not null;

alter table public.orders
  add column ticket_sent_at        timestamptz,
  add column ticket_proof_media_id uuid references public.media (id) on delete set null;

-- ---------------------------------------------------------------- RLS

alter table public.events enable row level security;

create policy events_read on public.events for select to authenticated
  using (school_id = public.current_school_id());
-- Writes: service role only (events are seeded by the team).
