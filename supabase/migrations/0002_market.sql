-- Marketplace: listings (native + ingested), seller claim invites, offers, orders,
-- in-person handoffs, campus-mail shipments, notifications.

-- ---------------------------------------------------------------- ingestion

create table public.ingested_posts (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools (id),
  channel       text not null check (channel in ('instagram', 'groupme', 'facebook', 'snapchat')),
  external_url  text not null,
  author_handle text not null,
  caption       text not null default '',
  media_ids     uuid[] not null default '{}',
  posted_at     timestamptz not null,
  status        text not null default 'queued' check (status in ('queued', 'processed', 'ignored', 'failed')),
  job_id        uuid references public.jobs (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (channel, external_url)                          -- re-posting the same URL is a no-op
);

-- ---------------------------------------------------------------- listings

create table public.listings (
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid not null references public.schools (id),
  seller_id            uuid references public.profiles (id) on delete set null, -- null until an ingested listing is claimed
  -- ExternalSeller (ingested listings)
  external_channel     text check (external_channel in ('instagram', 'groupme', 'facebook', 'snapchat')),
  external_handle      text,                              -- stored lower-case, no leading @
  external_profile_url text,
  category             text not null check (category in ('textbook', 'lab_supplies', 'dorm', 'ticket', 'other')),
  title                text not null,
  description          text not null default '',
  price_cents          int not null check (price_cents >= 0),
  negotiable           boolean not null default true,
  floor_price_cents    int check (floor_price_cents >= 0 and floor_price_cents <= price_cents),
  condition            text not null default 'good' check (condition in ('new', 'like_new', 'good', 'fair', 'poor')),
  -- textbook
  isbn                 text check (isbn ~ '^[0-9]{13}$'),
  textbook_title       text,
  authors              text[] not null default '{}',
  edition              text,
  -- ticket (P2; shape lives in the API)
  ticket               jsonb,
  fulfillment          text[] not null default '{in_person}'
                       check (cardinality(fulfillment) > 0
                              and fulfillment <@ array['in_person', 'campus_mail', 'digital_transfer']::text[]),
  status               text not null default 'draft' check (status in ('draft', 'active', 'pending', 'sold', 'removed')),
  source_channel       text not null default 'native' check (source_channel in ('native', 'screenshot', 'instagram', 'groupme', 'facebook', 'snapchat')),
  external_url         text,
  ingested_post_id     uuid references public.ingested_posts (id) on delete set null,
  claimed              boolean generated always as (seller_id is not null) stored,
  search               tsvector generated always as (
                         to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' '
                                     || coalesce(textbook_title, '') || ' ' || coalesce(isbn, ''))
                       ) stored,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (seller_id is not null or (external_channel is not null and external_handle is not null)),
  check (category <> 'textbook' or isbn is not null or status = 'draft')
);
create index listings_feed_idx on public.listings (school_id, status, created_at desc);
create index listings_isbn_idx on public.listings (school_id, isbn) where isbn is not null;
create index listings_seller_idx on public.listings (seller_id);
create index listings_external_idx on public.listings (external_channel, external_handle) where seller_id is null;
create index listings_search_idx on public.listings using gin (search);
create trigger listings_updated_at before update on public.listings
  for each row execute function public.set_updated_at();

-- Courses a textbook listing is for (from course_materials at ingest time, or picked by the seller).
create table public.listing_courses (
  listing_id uuid not null references public.listings (id) on delete cascade,
  course_id  uuid not null references public.courses (id) on delete cascade,
  primary key (listing_id, course_id)
);
create index listing_courses_course_idx on public.listing_courses (course_id);

create table public.listing_media (
  listing_id uuid not null references public.listings (id) on delete cascade,
  media_id   uuid not null references public.media (id) on delete cascade,
  position   int not null default 0,
  primary key (listing_id, media_id)
);

-- ---------------------------------------------------------------- seller claim invites

-- One invite per external handle at a time; claiming links every unclaimed listing from that handle.
create table public.seller_invites (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools (id),
  channel      text not null check (channel in ('instagram', 'groupme', 'facebook', 'snapchat')),
  handle       text not null,
  profile_url  text,
  listing_ids  uuid[] not null default '{}',              -- listings shown on the claim page when created
  token_hash   text not null unique,                      -- sha256 of the token in the link (services/claims.ts)
  message_text text not null,
  status       text not null default 'queued' check (status in ('queued', 'sent', 'claimed', 'expired')),
  trigger      text not null check (trigger in ('first_offer', 'manual')),
  sent_at      timestamptz,
  claimed_at   timestamptz,
  claimed_by   uuid references public.profiles (id),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  check ((status = 'claimed') = (claimed_by is not null))
);
create unique index seller_invites_open_idx on public.seller_invites (channel, handle)
  where status in ('queued', 'sent');

-- ---------------------------------------------------------------- offers + orders

create table public.offers (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references public.schools (id),
  listing_id         uuid not null references public.listings (id) on delete cascade,
  buyer_id           uuid not null references public.profiles (id),
  seller_id          uuid references public.profiles (id), -- null while the listing is unclaimed
  kind               text not null default 'cash' check (kind in ('cash', 'trade', 'cash_plus_trade')),
  amount_cents       int not null check (amount_cents >= 0),
  trade_listing_ids  uuid[] not null default '{}',
  fulfillment        text not null check (fulfillment in ('in_person', 'campus_mail', 'digital_transfer')),
  message            text,
  counter_of         uuid references public.offers (id),
  auto_generated     boolean not null default false,
  made_by            text not null default 'buyer' check (made_by in ('buyer', 'seller')),
  status             text not null default 'pending' check (status in ('pending', 'countered', 'accepted', 'declined', 'withdrawn', 'expired')),
  waiting_on         text check (waiting_on in ('buyer', 'seller', 'seller_claim')),
  seller_notified_at timestamptz,
  expires_at         timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (buyer_id <> seller_id),
  check ((status = 'pending') = (waiting_on is not null))
);
create index offers_listing_idx on public.offers (listing_id, status);
create index offers_buyer_idx on public.offers (buyer_id, created_at desc);
create index offers_seller_idx on public.offers (seller_id, created_at desc);
create index offers_expiry_idx on public.offers (expires_at) where status = 'pending';
create trigger offers_updated_at before update on public.offers
  for each row execute function public.set_updated_at();

create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools (id),
  listing_id          uuid not null references public.listings (id),
  buyer_id            uuid not null references public.profiles (id),
  seller_id           uuid not null references public.profiles (id),
  offer_id            uuid unique references public.offers (id),
  amount_cents        int not null check (amount_cents >= 0),
  fee_cents           int not null check (fee_cents >= 0),
  seller_payout_cents int not null check (seller_payout_cents >= 0),
  fulfillment         text not null check (fulfillment in ('in_person', 'campus_mail', 'digital_transfer')),
  status              text not null default 'awaiting_payment'
                      check (status in ('awaiting_payment', 'paid', 'scheduled', 'handing_off', 'in_transit', 'completed', 'cancelled', 'disputed', 'refunded')),
  payment_status      text not null default 'requires_payment' check (payment_status in ('requires_payment', 'succeeded', 'failed', 'refunded')),
  payment_intent_id   text unique,
  paid_at             timestamptz,
  payout_status       text not null default 'held' check (payout_status in ('held', 'awaiting_onboarding', 'released', 'reversed')),
  stripe_transfer_id  text unique,
  released_at         timestamptz,
  handoff_id          uuid,                               -- fk added after handoffs
  cancel_reason       text,
  dispute_reason      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (buyer_id <> seller_id),
  check (fee_cents + seller_payout_cents = amount_cents)
);
create index orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index orders_seller_idx on public.orders (seller_id, created_at desc);
create index orders_unpaid_idx on public.orders (created_at) where status = 'awaiting_payment';
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- in-person handoff

create table public.handoffs (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools (id),
  context_type    text not null check (context_type in ('order', 'tutoring_session')),
  context_id      uuid not null,
  giver_id        uuid not null references public.profiles (id),
  receiver_id     uuid not null references public.profiles (id),
  suggestions     jsonb not null default '[]',            -- last MeetupSuggestion[] from /suggest
  proposed_by     uuid references public.profiles (id),
  proposed_start  timestamptz,
  proposed_zone_id uuid references public.safe_zones (id),
  agreed_start    timestamptz,
  agreed_end      timestamptz,
  safe_zone_id    uuid references public.safe_zones (id),
  status          text not null default 'proposing' check (status in ('proposing', 'agreed', 'arriving', 'completed', 'no_show', 'cancelled', 'expired')),
  giver_nearby    boolean not null default false,
  receiver_nearby boolean not null default false,
  giver_at        timestamptz,                            -- set by POST /code from inside the zone
  receiver_at     timestamptz,                            -- set by a valid POST /confirm
  item_ok         boolean,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (context_type, context_id),
  check (giver_id <> receiver_id),
  check (status not in ('agreed', 'arriving', 'completed') or (agreed_start is not null and safe_zone_id is not null))
);
create trigger handoffs_updated_at before update on public.handoffs
  for each row execute function public.set_updated_at();

alter table public.orders
  add constraint orders_handoff_fk foreign key (handoff_id) references public.handoffs (id) on delete set null;

-- ---------------------------------------------------------------- campus mail

create table public.shipments (
  id                      uuid primary key default gen_random_uuid(),
  school_id               uuid not null references public.schools (id),
  order_id                uuid not null unique references public.orders (id) on delete cascade,
  label_code              text not null unique,           -- services/shipping.ts newLabelCode
  label_media_id          uuid references public.media (id),
  to_name                 text not null,
  to_mail_stop_code       text not null,
  drop_off_point_id       uuid not null references public.drop_off_points (id),
  status                  text not null default 'label_created' check (status in ('label_created', 'dropped_off', 'received')),
  dropped_off_at          timestamptz,
  drop_off_proof_media_id uuid references public.media (id),
  drop_off_lat            double precision,
  drop_off_lng            double precision,
  received_at             timestamptz,
  auto_complete_at        timestamptz,
  created_at              timestamptz not null default now(),
  check (status = 'label_created' or (dropped_off_at is not null and drop_off_proof_media_id is not null))
);
create index shipments_auto_complete_idx on public.shipments (auto_complete_at) where status = 'dropped_off';

-- ---------------------------------------------------------------- notifications

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null,                               -- e.g. material.match, offer.created
  title      text not null,
  body       text not null,
  deep_link  text not null,
  data       jsonb not null default '{}',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------- RLS

alter table public.ingested_posts  enable row level security;
alter table public.listings        enable row level security;
alter table public.listing_courses enable row level security;
alter table public.listing_media   enable row level security;
alter table public.seller_invites  enable row level security;
alter table public.offers          enable row level security;
alter table public.orders          enable row level security;
alter table public.handoffs        enable row level security;
alter table public.shipments       enable row level security;
alter table public.notifications   enable row level security;

create policy listings_read on public.listings for select to authenticated
  using (school_id = public.current_school_id() and (status in ('active', 'pending', 'sold') or seller_id = auth.uid()));
create policy listing_courses_read on public.listing_courses for select to authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id));      -- inherits listings_read
create policy listing_media_read on public.listing_media for select to authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id));

create policy offers_parties on public.offers for select to authenticated
  using (auth.uid() in (buyer_id, seller_id));
create policy orders_parties on public.orders for select to authenticated
  using (auth.uid() in (buyer_id, seller_id));
create policy handoffs_parties on public.handoffs for select to authenticated
  using (auth.uid() in (giver_id, receiver_id));
create policy shipments_parties on public.shipments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));         -- inherits orders_parties
create policy notifications_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
-- ingested_posts, seller_invites: service role only (no policies).
