-- MOOVU multi-driver staged offer cycle migration
-- Review before running. This supports nearest-driver first, escalation after 6 seconds,
-- 15 second accept windows, explicit reject exclusion, and first-valid-accept wins.

create table if not exists public.driver_trip_offers (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'shown', 'accepted', 'declined', 'expired', 'cancelled')),
  offered_at timestamptz not null default now(),
  visible_until timestamptz null,
  escalates_at timestamptz not null,
  accept_deadline_at timestamptz not null,
  responded_at timestamptz null,
  distance_km numeric(10,3) null,
  dispatch_score numeric(12,3) null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists driver_trip_offers_one_active_per_driver_trip
  on public.driver_trip_offers(trip_id, driver_id)
  where status in ('pending', 'shown');

create index if not exists driver_trip_offers_trip_status_idx
  on public.driver_trip_offers(trip_id, status);

create index if not exists driver_trip_offers_driver_status_idx
  on public.driver_trip_offers(driver_id, status);

create index if not exists driver_trip_offers_accept_deadline_idx
  on public.driver_trip_offers(accept_deadline_at)
  where status in ('pending', 'shown');

-- Recommended transactional accept pattern for API implementation after migration:
-- 1. update driver_trip_offers set status = 'accepted', responded_at = now()
--    where id = :offer_id and driver_id = :driver_id and status in ('pending','shown')
--      and accept_deadline_at > now()
--    returning trip_id;
-- 2. update trips set status='assigned', driver_id=:driver_id, offer_status='accepted'
--    where id=:trip_id and status in ('requested','offered') and driver_id is null;
-- 3. cancel all other active driver_trip_offers for the trip.
