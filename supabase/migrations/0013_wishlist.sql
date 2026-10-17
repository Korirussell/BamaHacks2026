-- Wishlist (module 11): what a student is looking for. Matches against active listings are
-- computed in the API (services/wishlist.ts), so there is no matches table.

create table public.wishlist_items (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools (id),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  kind            text not null check (kind in ('isbn', 'course_materials', 'keyword', 'category')),
  isbn            text check (isbn ~ '^[0-9]{13}$'),      -- always ISBN-13 (services/materials.ts normalizeIsbn)
  course_id       uuid references public.courses (id) on delete cascade,
  keyword         text check (char_length(keyword) between 2 and 100),
  category        text check (category in ('textbook', 'lab_supplies', 'dorm', 'ticket', 'other')),
  max_price_cents int check (max_price_cents >= 0),
  alert           boolean not null default true,
  created_at      timestamptz not null default now(),
  -- Exactly the target column for the kind is set.
  check ((kind = 'isbn') = (isbn is not null)),
  check ((kind = 'course_materials') = (course_id is not null)),
  check ((kind = 'keyword') = (keyword is not null)),
  check ((kind = 'category') = (category is not null))
);
create index wishlist_items_user_idx on public.wishlist_items (user_id, created_at desc);
create index wishlist_items_isbn_idx on public.wishlist_items (school_id, isbn) where isbn is not null;
create index wishlist_items_course_idx on public.wishlist_items (course_id) where course_id is not null;
create unique index wishlist_items_unique_idx on public.wishlist_items
  (user_id, kind, coalesce(isbn, ''), coalesce(course_id::text, ''), lower(coalesce(keyword, '')), coalesce(category, ''));

-- ---------------------------------------------------------------- RLS

alter table public.wishlist_items enable row level security;

create policy wishlist_items_own on public.wishlist_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and school_id = public.current_school_id());
