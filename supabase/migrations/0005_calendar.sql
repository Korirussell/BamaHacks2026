-- Google Calendar connection: one row per user holding the encrypted OAuth refresh token.
--
-- Server-only: RLS is on with NO policies, so `authenticated`/`anon` clients can never read or
-- write this table. Only the API (service role, which bypasses RLS) touches it. Tokens are
-- AES-256-GCM encrypted by the API (TOKEN_ENCRYPTION_KEY) before they get here.
-- profiles.google_connected is the client-visible flag; the API keeps it in sync.

create table public.calendar_connections (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  school_id         uuid not null references public.schools (id),
  provider          text not null default 'google' check (provider = 'google'),
  refresh_token_enc text not null,
  scope             text,
  timezone          text,
  connected_at      timestamptz not null default now()
);

alter table public.calendar_connections enable row level security;
-- (intentionally no policies)
