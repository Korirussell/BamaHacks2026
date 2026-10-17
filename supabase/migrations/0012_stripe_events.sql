-- Stripe webhook dedupe: every event id we receive is inserted here first, so a redelivery
-- (Stripe retries until it gets a 2xx) is acknowledged without being processed twice.
-- Server-only: RLS on, no policies; the API writes it with the service role.

create table public.stripe_events (
  id            text primary key,                         -- Stripe event id (evt_...)
  type          text not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz                               -- null while handling (or if handling crashed)
);

alter table public.stripe_events enable row level security;
-- (intentionally no policies)
