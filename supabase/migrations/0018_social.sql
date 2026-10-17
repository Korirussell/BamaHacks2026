-- Social graph (module 14): friend requests and friendships.
-- Writes go through the API (service role); clients can only read rows they are part of.

create table public.friend_requests (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools (id),
  from_id      uuid not null references public.profiles (id) on delete cascade,
  to_id        uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  responded_at timestamptz,
  created_at   timestamptz not null default now(),
  check (from_id <> to_id),
  check ((status = 'pending') = (responded_at is null))
);
-- At most one open request per pair, in either direction (A→B blocks a second A→B and B→A).
create unique index friend_requests_open_pair_idx on public.friend_requests
  (least(from_id, to_id), greatest(from_id, to_id)) where status = 'pending';
create index friend_requests_to_idx on public.friend_requests (to_id, created_at desc) where status = 'pending';

-- One row per friendship, stored with user_a < user_b so (A, B) and (B, A) can't both exist.
create table public.friendships (
  school_id  uuid not null references public.schools (id),
  user_a     uuid not null references public.profiles (id) on delete cascade,
  user_b     uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index friendships_user_b_idx on public.friendships (user_b);

-- ---------------------------------------------------------------- RLS

alter table public.friend_requests enable row level security;
alter table public.friendships     enable row level security;

create policy friend_requests_parties on public.friend_requests for select to authenticated
  using (school_id = public.current_school_id() and auth.uid() in (from_id, to_id));
create policy friendships_members on public.friendships for select to authenticated
  using (school_id = public.current_school_id() and auth.uid() in (user_a, user_b));
