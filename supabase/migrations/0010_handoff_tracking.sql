-- In-person meetup safety: latest position per party (wiped when the handoff ends), the
-- two-party "Confirm trade" tap state, and who failed to show.
-- Server-only data: the API writes it with the service role and never returns raw coordinates
-- of the other party (only a rounded distance and an "arrived" flag).

alter table public.handoffs
  add column giver_lat               double precision,
  add column giver_lng               double precision,
  add column giver_accuracy_m        double precision,
  add column giver_seen_at           timestamptz,
  add column receiver_lat            double precision,
  add column receiver_lng            double precision,
  add column receiver_accuracy_m     double precision,
  add column receiver_seen_at        timestamptz,
  add column giver_arrived_at        timestamptz,        -- first good-accuracy ping inside the zone (survives leaving it)
  add column receiver_arrived_at     timestamptz,
  add column giver_tap_at            timestamptz,        -- "Confirm trade" taps; both must land within 60 s
  add column giver_tap_lat           double precision,
  add column giver_tap_lng           double precision,
  add column giver_tap_accuracy_m    double precision,
  add column receiver_tap_at         timestamptz,
  add column receiver_tap_lat        double precision,
  add column receiver_tap_lng        double precision,
  add column receiver_tap_accuracy_m double precision,
  add column receiver_tap_item_ok    boolean,
  add column no_show_party           text check (no_show_party in ('giver', 'receiver')),
  add column overdue_notified_at     timestamptz,        -- sweep told both parties once that nobody confirmed
  add check (giver_lat is null or (giver_lat between -90 and 90 and giver_lng between -180 and 180)),
  add check (receiver_lat is null or (receiver_lat between -90 and 90 and receiver_lng between -180 and 180)),
  add check (status <> 'no_show' or no_show_party is not null);
