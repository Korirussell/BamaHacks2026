-- Misc: reports (module 13), push subscriptions (12), auto-bargain sessions (10), tutoring requests (17),
-- and Google Calendar push-channel bookkeeping. All writes go through the API (service role).

-- ---------------------------------------------------------------- reports

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('user', 'listing', 'offer')),
  target_id   uuid not null,
  reason      text not null check (reason in ('scam', 'unsafe', 'spam', 'other')),
  details     text not null default '' check (char_length(details) <= 2000),
  status      text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at  timestamptz not null default now()
);
-- Duplicate check: same reporter + target within 24 h (enforced in the API).
create index reports_dedupe_idx on public.reports (reporter_id, target_type, target_id, created_at desc);
create index reports_school_idx on public.reports (school_id, status, created_at desc);

-- ---------------------------------------------------------------- push subscriptions

create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools (id),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  platform     text not null check (platform in ('web', 'ios', 'android')),
  -- Web Push endpoint URL, or the APNs / FCM device token. A device signing in as someone else moves the row.
  endpoint     text not null unique,
  subscription jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
create trigger push_subscriptions_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- auto-bargain

create table public.bargain_sessions (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools (id),
  listing_id      uuid not null references public.listings (id) on delete cascade,
  buyer_id        uuid not null references public.profiles (id) on delete cascade,
  max_price_cents int not null check (max_price_cents > 0),
  style           text not null check (style in ('quick', 'balanced', 'patient')),
  status          text not null default 'negotiating' check (status in ('negotiating', 'deal_found', 'no_deal')),
  rounds          jsonb not null default '[]' check (jsonb_typeof(rounds) = 'array'), -- [{ by, amount_cents, at }]
  offer_id        uuid references public.offers (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index bargain_sessions_buyer_idx on public.bargain_sessions (buyer_id, created_at desc);
create trigger bargain_sessions_updated_at before update on public.bargain_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- tutoring requests

create table public.tutoring_requests (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools (id),
  student_id          uuid not null references public.profiles (id) on delete cascade,
  course_id           uuid not null references public.courses (id) on delete cascade,
  windows             jsonb not null check (jsonb_typeof(windows) = 'array'), -- [TimeBlock]
  max_rate_cents      int not null check (max_rate_cents >= 0),
  notes               text,
  matched_tutor_ids   uuid[] not null default '{}',
  status              text not null default 'open' check (status in ('open', 'fulfilled', 'cancelled')),
  created_at          timestamptz not null default now()
);
create index tutoring_requests_student_idx on public.tutoring_requests (student_id, created_at desc);
create index tutoring_requests_course_idx on public.tutoring_requests (school_id, course_id) where status = 'open';

-- ---------------------------------------------------------------- Google Calendar push channels

-- Filled when the API registers an events.watch channel; the webhook matches X-Goog-Channel-ID and
-- checks X-Goog-Channel-Token. needs_refresh marks a changed calendar until free/busy is re-read.
alter table public.calendar_connections
  add column watch_channel_id    text unique,
  add column watch_channel_token text,
  add column watch_resource_id   text,
  add column watch_expires_at    timestamptz,
  add column needs_refresh       boolean not null default false,
  add column last_notified_at    timestamptz,
  add column last_synced_at      timestamptz;

-- ---------------------------------------------------------------- RLS

alter table public.reports            enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.bargain_sessions   enable row level security;
alter table public.tutoring_requests  enable row level security;

create policy reports_own on public.reports for select to authenticated
  using (reporter_id = auth.uid());
create policy push_subscriptions_own on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy bargain_sessions_buyer on public.bargain_sessions for select to authenticated
  using (buyer_id = auth.uid());
create policy tutoring_requests_student on public.tutoring_requests for select to authenticated
  using (student_id = auth.uid() and school_id = public.current_school_id());
