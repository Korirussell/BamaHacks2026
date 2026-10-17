-- Core: schools, profiles, academics, schedules, safe zones, media, jobs.
-- Locations are plain lat/lng columns; distance checks happen in the API (services/geo.ts).
-- The API talks to the DB with the service role (bypasses RLS); the policies below protect
-- direct client access (Realtime, Storage) and act as a second line of defence.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- helpers

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- school_id lives in app_metadata, set by the auth hook (0004). Never trust user_metadata.
create or replace function public.current_school_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'school_id', '')::uuid
$$;

create or replace function public.valid_weekdays(days text[]) returns boolean
language sql immutable as $$
  select cardinality(days) > 0
     and days <@ array['mon','tue','wed','thu','fri','sat','sun']::text[]
$$;

-- jsonb array of OpeningHours: [{ "days": [...], "open": "HH:MM", "close": "HH:MM" }]
create or replace function public.valid_opening_hours(hours jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(hours) = 'array'
     and not exists (
       select 1 from jsonb_array_elements(hours) h
       where jsonb_typeof(h -> 'days') <> 'array'
          or coalesce(h ->> 'open', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          or coalesce(h ->> 'close', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     )
$$;

-- ---------------------------------------------------------------- schools

create table public.schools (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  domain                text not null unique,             -- primary domain shown to users, e.g. ua.edu
  email_domains         text[] not null,                  -- every domain allowed to sign up, e.g. {ua.edu,crimson.ua.edu}
  center_lat            double precision not null,
  center_lng            double precision not null,
  timezone              text not null default 'America/Chicago',
  campus_mail_supported boolean not null default false,
  tutor_min_grade       text not null default 'A-',
  created_at            timestamptz not null default now(),
  check (cardinality(email_domains) > 0)
);
create index schools_email_domains_idx on public.schools using gin (email_domains);

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  school_id          uuid not null references public.schools (id),
  email              text not null,
  display_name       text not null default '',
  avatar_media_id    uuid,                                -- fk added below, after media exists
  major              text,
  grad_year          int check (grad_year between 1990 and 2100),
  phone              text,
  budget_cents       int check (budget_cents >= 0),
  mail_stop_code     text,                                -- UA campus mail box/stop; required for campus_mail buys
  tutor_opt_in       boolean not null default false,
  location_sharing   text not null default 'during_handoffs' check (location_sharing in ('off', 'during_handoffs')),
  notification_prefs jsonb not null default '{"push": true, "email": true, "wishlist_alerts": true, "tutor_requests": true}',
  is_admin           boolean not null default false,
  -- Stripe Connect Express
  stripe_account_id  text unique,
  stripe_status      text not null default 'none' check (stripe_status in ('none', 'pending', 'ready')),
  payouts_enabled    boolean not null default false,
  google_connected   boolean not null default false,
  -- reliability inputs (score/badge are computed in the API)
  completed_count    int not null default 0,
  no_show_count      int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index profiles_school_idx on public.profiles (school_id);
create index profiles_name_trgm_idx on public.profiles using gin (display_name gin_trgm_ops);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- campus places

create table public.buildings (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id) on delete cascade,
  name       text not null,
  code       text not null,                               -- short code students use, e.g. NERC
  lat        double precision not null,
  lng        double precision not null,
  unique (school_id, code)
);
create index buildings_name_trgm_idx on public.buildings using gin ((code || ' ' || name) gin_trgm_ops);

create table public.safe_zones (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id) on delete cascade,
  name       text not null,
  kind       text not null check (kind in ('police', 'student_center', 'library', 'other')),
  lat        double precision not null,
  lng        double precision not null,
  radius_m   int not null check (radius_m between 10 and 500),
  hours      jsonb not null default '[]' check (public.valid_opening_hours(hours)),
  hours_note text,
  active     boolean not null default true
);
create index safe_zones_school_idx on public.safe_zones (school_id) where active;

create table public.drop_off_points (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools (id) on delete cascade,
  name         text not null,
  lat          double precision not null,
  lng          double precision not null,
  radius_m     int not null check (radius_m between 10 and 500),
  hours        jsonb not null default '[]' check (public.valid_opening_hours(hours)),
  instructions text not null,
  active       boolean not null default true
);

-- ---------------------------------------------------------------- academics

create table public.courses (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id) on delete cascade,
  code       text not null,                               -- e.g. "CH 101"
  title      text not null,
  department text not null,
  unique (school_id, code)
);
create index courses_search_trgm_idx on public.courses using gin ((code || ' ' || title) gin_trgm_ops);

-- Required/recommended books per course. Seeded for the demo; bookstore import later.
create table public.course_materials (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id) on delete cascade,
  course_id  uuid not null references public.courses (id) on delete cascade,
  isbn       text not null check (isbn ~ '^[0-9]{13}$'),  -- always ISBN-13 (services/materials.ts normalizeIsbn)
  title      text not null,
  authors    text[] not null default '{}',
  edition    text,
  required   boolean not null default true,
  term       text,                                        -- null = every term
  unique nulls not distinct (course_id, isbn, term)
);
create index course_materials_isbn_idx on public.course_materials (school_id, isbn);

create table public.class_records (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools (id),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  course_id      uuid not null references public.courses (id),
  term           text not null,                           -- e.g. "Fall 2026"
  status         text not null check (status in ('current', 'past', 'planned')),
  grade          text,
  grade_source   text not null default 'self_reported' check (grade_source in ('transcript', 'self_reported')),
  grade_verified boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (user_id, course_id, term),
  check (not grade_verified or grade_source = 'transcript')
);
create index class_records_course_idx on public.class_records (course_id, status);

create table public.class_meetings (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  course_id  uuid not null references public.courses (id),
  section    text,
  days       text[] not null check (public.valid_weekdays(days)),
  start_time time not null,                               -- wall clock in `timezone`
  end_time   time not null,
  timezone   text not null,
  term       text not null,
  term_start date not null,
  term_end   date not null,
  building_id uuid references public.buildings (id),
  room       text,
  source     text not null default 'manual' check (source in ('manual', 'ics', 'screenshot', 'google')),
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  check (term_end >= term_start)
);
create index class_meetings_user_idx on public.class_meetings (user_id, term);

-- ---------------------------------------------------------------- media + jobs

create table public.media (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools (id),
  owner_id     uuid references public.profiles (id) on delete set null, -- null for admin/ingested uploads
  purpose      text not null check (purpose in ('listing', 'avatar', 'transcript', 'syllabus', 'schedule', 'screenshot', 'label', 'drop_off_proof', 'ingested')),
  bucket       text not null check (bucket in ('public-media', 'private-docs')),
  path         text not null,
  kind         text not null check (kind in ('image', 'pdf', 'ics')),
  content_type text not null,
  bytes        int not null check (bytes > 0),
  width        int,
  height       int,
  uploaded     boolean not null default false,            -- flipped once the object exists in Storage
  created_at   timestamptz not null default now(),
  unique (bucket, path)
);

alter table public.profiles
  add constraint profiles_avatar_media_fk foreign key (avatar_media_id) references public.media (id) on delete set null;

-- In-process job queue (BACKEND_ROADMAP step 8). Workers claim with
-- `update ... where id = (select id from jobs where status='queued' and run_after <= now()
--  order by run_after for update skip locked limit 1)`.
create table public.jobs (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id),
  user_id    uuid references public.profiles (id) on delete cascade, -- who gets job.finished; null for admin jobs
  kind       text not null check (kind in ('transcript_parse', 'syllabus_parse', 'schedule_import', 'screenshot_to_listing', 'textbook_identify', 'ingest_classify', 'offer_expiry', 'order_auto_complete')),
  status     text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  payload    jsonb not null default '{}',
  result     jsonb,
  error      text,
  attempts   int not null default 0,
  run_after  timestamptz not null default now(),
  locked_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_ready_idx on public.jobs (run_after) where status = 'queued';
create trigger jobs_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

-- Replays for `Idempotency-Key` on money/handoff calls.
create table public.idempotency_keys (
  user_id         uuid not null references public.profiles (id) on delete cascade,
  key             text not null,
  request_hash    text not null,                          -- method + path + body hash; reuse with a different body = 422
  response_status int not null,
  response_body   jsonb not null,
  created_at      timestamptz not null default now(),
  primary key (user_id, key)
);

-- ---------------------------------------------------------------- RLS

alter table public.schools          enable row level security;
alter table public.profiles         enable row level security;
alter table public.buildings        enable row level security;
alter table public.safe_zones       enable row level security;
alter table public.drop_off_points  enable row level security;
alter table public.courses          enable row level security;
alter table public.course_materials enable row level security;
alter table public.class_records    enable row level security;
alter table public.class_meetings   enable row level security;
alter table public.media            enable row level security;
alter table public.jobs             enable row level security;
alter table public.idempotency_keys enable row level security;

create policy schools_read on public.schools for select to anon, authenticated using (true);

create policy profiles_read_same_school on public.profiles for select to authenticated
  using (school_id = public.current_school_id());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and school_id = public.current_school_id());

create policy buildings_read on public.buildings for select to authenticated
  using (school_id = public.current_school_id());
create policy safe_zones_read on public.safe_zones for select to authenticated
  using (school_id = public.current_school_id());
create policy drop_off_points_read on public.drop_off_points for select to authenticated
  using (school_id = public.current_school_id());
create policy courses_read on public.courses for select to authenticated
  using (school_id = public.current_school_id());
create policy course_materials_read on public.course_materials for select to authenticated
  using (school_id = public.current_school_id());

create policy class_records_own on public.class_records for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and school_id = public.current_school_id());
create policy class_meetings_own on public.class_meetings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and school_id = public.current_school_id());

create policy media_own on public.media for select to authenticated using (owner_id = auth.uid());
create policy jobs_own on public.jobs for select to authenticated using (user_id = auth.uid());
-- idempotency_keys: service role only (no policies).
