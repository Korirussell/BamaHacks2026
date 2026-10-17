-- Tutoring: tutor profiles, sessions (propose/counter/accept + room booking), reviews.

create table public.tutor_profiles (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  school_id         uuid not null references public.schools (id),
  enabled           boolean not null default false,
  hourly_rate_cents int not null default 0 check (hourly_rate_cents >= 0),
  bio               text,
  modes             text[] not null default '{in_person}'
                    check (cardinality(modes) > 0 and modes <@ array['in_person', 'virtual']::text[]),
  open_to_requests  boolean not null default true,
  -- PUT /me/tutor-availability: { recurring: [{days, start, end}], one_off: [TimeBlock] }.
  -- Empty = derive from the class schedule only.
  availability      jsonb not null default '{"recurring": [], "one_off": []}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index tutor_profiles_school_idx on public.tutor_profiles (school_id) where enabled;
create trigger tutor_profiles_updated_at before update on public.tutor_profiles
  for each row execute function public.set_updated_at();

-- Courses a tutor offers. Eligibility (grade >= school.tutor_min_grade) is enforced by the API
-- on PUT /me/tutor-profile and again on GET /tutors, because the threshold is per school.
create table public.tutor_courses (
  user_id   uuid not null references public.tutor_profiles (user_id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  primary key (user_id, course_id)
);
create index tutor_courses_course_idx on public.tutor_courses (course_id);

create table public.tutoring_sessions (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools (id),
  tutor_id            uuid not null references public.profiles (id),
  student_id          uuid not null references public.profiles (id),
  course_id           uuid not null references public.courses (id),
  start_at            timestamptz not null,
  end_at              timestamptz not null,
  price_cents         int not null check (price_cents >= 0),  -- services/tutoring.ts priceFor
  location_kind       text not null check (location_kind in ('library_room', 'safe_zone', 'virtual')),
  location_name       text,
  safe_zone_id        uuid references public.safe_zones (id),
  meeting_url         text,
  room_booking_status text not null default 'not_needed'
                      check (room_booking_status in ('not_needed', 'pending', 'booked', 'manual_required')),
  room                text,
  booking_url         text,
  status              text not null default 'requested'
                      check (status in ('requested', 'accepted', 'paid', 'completed', 'cancelled', 'no_show')),
  waiting_on          text check (waiting_on in ('tutor', 'student')),
  -- [{ by: tutor|student, action: propose|counter|accept|decline, start, end, at }]
  history             jsonb not null default '[]',
  notes               text,
  handoff_id          uuid references public.handoffs (id) on delete set null,
  payment_intent_id   text unique,
  cancel_reason       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (tutor_id <> student_id),
  check (end_at > start_at),
  check ((status = 'requested') = (waiting_on is not null))
);
create index tutoring_sessions_tutor_idx on public.tutoring_sessions (tutor_id, start_at);
create index tutoring_sessions_student_idx on public.tutoring_sessions (student_id, start_at);
create trigger tutoring_sessions_updated_at before update on public.tutoring_sessions
  for each row execute function public.set_updated_at();

create table public.reviews (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools (id),
  from_id      uuid not null references public.profiles (id) on delete cascade,
  to_id        uuid not null references public.profiles (id) on delete cascade,
  context_type text not null check (context_type in ('order', 'tutoring_session', 'ride')),
  context_id   uuid not null,
  stars        int not null check (stars between 1 and 5),
  on_time      boolean not null default true,
  as_described boolean not null default true,
  comment      text,
  created_at   timestamptz not null default now(),
  unique (from_id, context_type, context_id),
  check (from_id <> to_id)
);
create index reviews_to_idx on public.reviews (to_id, context_type);

-- Rating + counts used by GET /tutors and TutorProfile.
create view public.tutor_stats with (security_invoker = true) as
select
  tp.user_id,
  coalesce(round(avg(r.stars)::numeric, 2), 0)::double precision as rating,
  count(r.id)::int as review_count,
  (select count(*)::int from public.tutoring_sessions s
    where s.tutor_id = tp.user_id and s.status = 'completed') as sessions_completed
from public.tutor_profiles tp
left join public.reviews r on r.to_id = tp.user_id and r.context_type = 'tutoring_session'
group by tp.user_id;

-- ---------------------------------------------------------------- RLS

alter table public.tutor_profiles    enable row level security;
alter table public.tutor_courses     enable row level security;
alter table public.tutoring_sessions enable row level security;
alter table public.reviews           enable row level security;

create policy tutor_profiles_read on public.tutor_profiles for select to authenticated
  using (school_id = public.current_school_id());
create policy tutor_courses_read on public.tutor_courses for select to authenticated
  using (exists (select 1 from public.tutor_profiles tp where tp.user_id = tutor_courses.user_id));
create policy tutoring_sessions_parties on public.tutoring_sessions for select to authenticated
  using (auth.uid() in (tutor_id, student_id));
create policy reviews_read on public.reviews for select to authenticated
  using (school_id = public.current_school_id());
