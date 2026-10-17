-- Study groups + syllabus parse (module 20).
-- POST /syllabi parses an uploaded syllabus into `parsed` (status needs_review); POST /syllabi/{id}/confirm
-- writes course_events and records who confirmed each one. Study groups meet before those events.
-- The `syllabus` media purpose and `syllabus_parse` job kind already exist (0001, 0006).
-- Clients read; every write goes through the API with the service role.

create table public.syllabi (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools (id),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  course_id    uuid not null references public.courses (id) on delete cascade,
  term         text not null,
  media_id     uuid not null references public.media (id),
  job_id       uuid references public.jobs (id) on delete set null,
  status       text not null default 'parsing' check (status in ('parsing', 'needs_review', 'confirmed', 'failed')),
  parsed       jsonb,                                     -- services/syllabus.ts ParsedSyllabus
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  confirmed_at timestamptz
);
create index syllabi_user_idx on public.syllabi (user_id, created_at desc);
create trigger syllabi_updated_at before update on public.syllabi
  for each row execute function public.set_updated_at();

-- One row per real-world exam/assignment; classmates confirming the same item share it.
create table public.course_events (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id),
  course_id   uuid not null references public.courses (id) on delete cascade,
  term        text not null,
  kind        text not null check (kind in ('exam', 'assignment', 'project', 'quiz')),
  title       text not null check (length(btrim(title)) between 1 and 200),
  title_key   text generated always as (lower(btrim(title))) stored,
  due_at      timestamptz not null,
  source      text not null default 'syllabus' check (source in ('syllabus', 'manual')),
  created_by  uuid references public.profiles (id) on delete set null,
  syllabus_id uuid references public.syllabi (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (course_id, term, kind, title_key, due_at)
);
create index course_events_course_idx on public.course_events (course_id, term, due_at);

create table public.course_event_confirmations (
  event_id   uuid not null references public.course_events (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  school_id  uuid not null references public.schools (id),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table public.study_groups (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools (id),
  course_id       uuid not null references public.courses (id) on delete cascade,
  host_id         uuid not null references public.profiles (id) on delete cascade,
  title           text not null check (length(btrim(title)) between 1 and 120),
  target_event_id uuid references public.course_events (id) on delete set null,
  mode            text not null check (mode in ('in_person', 'virtual')),
  place_label     text,
  place_lat       double precision,
  place_lng       double precision,
  meeting_url     text,
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  capacity        int not null check (capacity between 2 and 50),
  cross_campus    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_at > start_at),
  check ((place_label is null) = (place_lat is null) and (place_lat is null) = (place_lng is null)),
  check (mode = 'virtual' or place_label is not null)
);
create index study_groups_course_idx on public.study_groups (course_id, start_at);
create index study_groups_school_idx on public.study_groups (school_id, end_at);
create index study_groups_cross_idx on public.study_groups (end_at) where cross_campus;
create trigger study_groups_updated_at before update on public.study_groups
  for each row execute function public.set_updated_at();

-- school_id is the member's own school (cross-campus groups mix schools).
create table public.study_group_members (
  group_id  uuid not null references public.study_groups (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  school_id uuid not null references public.schools (id),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index study_group_members_user_idx on public.study_group_members (user_id);

-- Capacity: lock the group row so two concurrent joins can't both take the last seat.
create or replace function public.study_group_capacity_check() returns trigger
language plpgsql as $$
declare
  cap int;
  taken int;
begin
  select capacity into cap from public.study_groups where id = new.group_id for update;
  select count(*) into taken from public.study_group_members where group_id = new.group_id;
  if taken >= cap then
    raise exception 'study_group_full' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger study_group_members_capacity before insert on public.study_group_members
  for each row execute function public.study_group_capacity_check();

-- ---------------------------------------------------------------- RLS

alter table public.syllabi                    enable row level security;
alter table public.course_events              enable row level security;
alter table public.course_event_confirmations enable row level security;
alter table public.study_groups               enable row level security;
alter table public.study_group_members        enable row level security;

create policy syllabi_own_read on public.syllabi for select to authenticated
  using (user_id = auth.uid());
create policy course_events_read on public.course_events for select to authenticated
  using (school_id = public.current_school_id());
create policy course_event_confirmations_read on public.course_event_confirmations for select to authenticated
  using (school_id = public.current_school_id());
create policy study_groups_read on public.study_groups for select to authenticated
  using (school_id = public.current_school_id() or cross_campus);
create policy study_group_members_read on public.study_group_members for select to authenticated
  using (exists (select 1 from public.study_groups g where g.id = study_group_members.group_id));
-- No insert/update/delete policies: writes are service role only.
