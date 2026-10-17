-- Rides (module 18): driver sign-up, posted trips, rider requests and seat bookings.
-- Seats are taken with one atomic update (book_ride / accept_ride_request below) and a check
-- keeps seats_left between 0 and seats_total. Payment lives on the booking: with PAYMENTS=demo
-- a booking is paid on the spot (nothing leaves the platform), like orders.
-- The API writes everything with the service role; the policies are for direct client reads
-- and the private `ride:{id}` Realtime channel.

-- ---------------------------------------------------------------- drivers

create table public.drivers (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  school_id        uuid not null references public.schools (id),
  vehicle_make     text not null,
  vehicle_model    text not null,
  vehicle_color    text not null,
  vehicle_plate    text not null,
  terms_accepted_at timestamptz not null,
  status           text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index drivers_school_idx on public.drivers (school_id) where status = 'verified';
create trigger drivers_updated_at before update on public.drivers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- rides

create table public.rides (
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid not null references public.schools (id),
  driver_id            uuid not null references public.profiles (id),
  origin_label         text not null,
  origin_lat           double precision not null check (origin_lat between -90 and 90),
  origin_lng           double precision not null check (origin_lng between -180 and 180),
  destination_label    text not null,
  destination_lat      double precision not null check (destination_lat between -90 and 90),
  destination_lng      double precision not null check (destination_lng between -180 and 180),
  depart_at            timestamptz not null,
  seats_total          int not null check (seats_total between 1 and 8),
  seats_left           int not null,
  price_per_seat_cents int not null check (price_per_seat_cents >= 0),
  status               text not null default 'open' check (status in ('open', 'full', 'en_route', 'completed', 'cancelled')),
  driver_lat           double precision,                  -- latest ping while en_route; wiped when the ride ends
  driver_lng           double precision,
  driver_seen_at       timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (seats_left between 0 and seats_total),
  check (status <> 'open' or seats_left > 0),
  check (status <> 'full' or seats_left = 0),
  check (driver_lat is null or (driver_lat between -90 and 90 and driver_lng between -180 and 180))
);
create index rides_open_idx on public.rides (school_id, depart_at) where status = 'open';
create index rides_driver_idx on public.rides (driver_id, depart_at desc);
create trigger rides_updated_at before update on public.rides
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- ride requests

create table public.ride_requests (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools (id),
  rider_id        uuid not null references public.profiles (id),
  pickup_label    text not null,
  pickup_lat      double precision not null check (pickup_lat between -90 and 90),
  pickup_lng      double precision not null check (pickup_lng between -180 and 180),
  dropoff_label   text not null,
  dropoff_lat     double precision not null check (dropoff_lat between -90 and 90),
  dropoff_lng     double precision not null check (dropoff_lng between -180 and 180),
  depart_at       timestamptz not null,
  seats           int not null check (seats between 1 and 8),
  max_price_cents int check (max_price_cents >= 0),       -- per seat
  status          text not null default 'open' check (status in ('open', 'matched', 'cancelled')),
  ride_id         uuid references public.rides (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (status <> 'matched' or ride_id is not null)
);
create index ride_requests_open_idx on public.ride_requests (school_id, depart_at) where status = 'open';
create index ride_requests_rider_idx on public.ride_requests (rider_id, created_at desc);
create trigger ride_requests_updated_at before update on public.ride_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- bookings

create table public.ride_bookings (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools (id),
  ride_id        uuid not null references public.rides (id) on delete cascade,
  driver_id      uuid not null references public.profiles (id),  -- copied from the ride so policies need no join
  rider_id       uuid not null references public.profiles (id),
  seats          int not null check (seats between 1 and 8),
  pickup_label   text,
  pickup_lat     double precision check (pickup_lat between -90 and 90),
  pickup_lng     double precision check (pickup_lng between -180 and 180),
  amount_cents   int not null check (amount_cents >= 0),
  status         text not null default 'booked' check (status in ('booked', 'picked_up', 'completed', 'cancelled')),
  payment_status text not null default 'requires_payment' check (payment_status in ('requires_payment', 'succeeded', 'refunded')),
  payment_provider text not null default 'demo' check (payment_provider in ('demo', 'stripe')),
  paid_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (driver_id <> rider_id),
  check ((pickup_label is null) = (pickup_lat is null) and (pickup_lat is null) = (pickup_lng is null))
);
create unique index ride_bookings_one_per_rider on public.ride_bookings (ride_id, rider_id) where status <> 'cancelled';
create index ride_bookings_rider_idx on public.ride_bookings (rider_id, created_at desc);
create trigger ride_bookings_updated_at before update on public.ride_bookings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- atomic seat moves

-- Takes `p_seats` from an open ride and books them in one statement + insert; raises P0001 when
-- the ride isn't open, is the rider's own, or has too few seats. A duplicate booking (23505)
-- rolls the seat change back with it.
create or replace function public.book_ride(
  p_school_id uuid, p_ride_id uuid, p_rider_id uuid, p_seats int,
  p_pickup_label text, p_pickup_lat double precision, p_pickup_lng double precision, p_paid boolean
) returns public.ride_bookings
language plpgsql as $$
declare
  r public.rides;
  b public.ride_bookings;
begin
  if p_seats is null or p_seats < 1 then
    raise exception 'invalid_seats' using errcode = 'P0001';
  end if;
  update public.rides
     set seats_left = seats_left - p_seats,
         status = case when seats_left - p_seats = 0 then 'full' else 'open' end
   where id = p_ride_id and school_id = p_school_id and status = 'open'
     and seats_left >= p_seats and driver_id <> p_rider_id
  returning * into r;
  if not found then
    raise exception 'ride_unavailable' using errcode = 'P0001';
  end if;
  insert into public.ride_bookings (school_id, ride_id, driver_id, rider_id, seats, pickup_label, pickup_lat, pickup_lng,
                                    amount_cents, payment_status, paid_at)
  values (p_school_id, r.id, r.driver_id, p_rider_id, p_seats, p_pickup_label, p_pickup_lat, p_pickup_lng,
          p_seats * r.price_per_seat_cents,
          case when p_paid then 'succeeded' else 'requires_payment' end,
          case when p_paid then now() end)
  returning * into b;
  return b;
end $$;

-- A driver takes an open request: a full ride for exactly the requested seats, the rider's
-- booking, and the request marked matched, all or nothing.
create or replace function public.accept_ride_request(
  p_school_id uuid, p_request_id uuid, p_driver_id uuid, p_price_per_seat_cents int, p_paid boolean
) returns public.rides
language plpgsql as $$
declare
  q public.ride_requests;
  r public.rides;
begin
  select * into q from public.ride_requests
   where id = p_request_id and school_id = p_school_id and status = 'open'
   for update;
  if not found or q.rider_id = p_driver_id then
    raise exception 'ride_request_unavailable' using errcode = 'P0001';
  end if;
  insert into public.rides (school_id, driver_id, origin_label, origin_lat, origin_lng,
                            destination_label, destination_lat, destination_lng, depart_at,
                            seats_total, seats_left, price_per_seat_cents, status)
  values (p_school_id, p_driver_id, q.pickup_label, q.pickup_lat, q.pickup_lng,
          q.dropoff_label, q.dropoff_lat, q.dropoff_lng, q.depart_at,
          q.seats, 0, p_price_per_seat_cents, 'full')
  returning * into r;
  insert into public.ride_bookings (school_id, ride_id, driver_id, rider_id, seats, pickup_label, pickup_lat, pickup_lng,
                                    amount_cents, payment_status, paid_at)
  values (p_school_id, r.id, p_driver_id, q.rider_id, q.seats, q.pickup_label, q.pickup_lat, q.pickup_lng,
          q.seats * p_price_per_seat_cents,
          case when p_paid then 'succeeded' else 'requires_payment' end,
          case when p_paid then now() end);
  update public.ride_requests set status = 'matched', ride_id = r.id where id = q.id;
  return r;
end $$;

revoke execute on function public.book_ride(uuid, uuid, uuid, int, text, double precision, double precision, boolean) from public, anon, authenticated;
grant execute on function public.book_ride(uuid, uuid, uuid, int, text, double precision, double precision, boolean) to service_role;
revoke execute on function public.accept_ride_request(uuid, uuid, uuid, int, boolean) from public, anon, authenticated;
grant execute on function public.accept_ride_request(uuid, uuid, uuid, int, boolean) to service_role;

-- ---------------------------------------------------------------- RLS

alter table public.drivers       enable row level security;
alter table public.rides         enable row level security;
alter table public.ride_requests enable row level security;
alter table public.ride_bookings enable row level security;

create policy drivers_own on public.drivers for select to authenticated
  using (user_id = auth.uid());
create policy ride_bookings_parties on public.ride_bookings for select to authenticated
  using (auth.uid() in (rider_id, driver_id));
create policy rides_read on public.rides for select to authenticated
  using (school_id = public.current_school_id() and (
    status = 'open' or driver_id = auth.uid()
    or exists (select 1 from public.ride_bookings b where b.ride_id = rides.id and b.rider_id = auth.uid() and b.status <> 'cancelled')
  ));
create policy ride_requests_parties on public.ride_requests for select to authenticated
  using (rider_id = auth.uid() or exists (select 1 from public.rides r where r.id = ride_requests.ride_id and r.driver_id = auth.uid()));

-- `ride:{id}` (ride.location, ride.updated): only the driver and riders with a live booking receive.
create policy ride_parties_receive on realtime.messages for select to authenticated
  using (
    realtime.topic() like 'ride:%'
    and exists (
      select 1 from public.rides r
      where 'ride:' || r.id::text = realtime.topic()
        and (r.driver_id = auth.uid()
             or exists (select 1 from public.ride_bookings b where b.ride_id = r.id and b.rider_id = auth.uid() and b.status <> 'cancelled'))
    )
  );
