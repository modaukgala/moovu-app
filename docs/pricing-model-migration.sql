-- MOOVU launch pricing model support (review-only)
-- Do not run on production until reviewed and tested on staging.
--
-- Code now calculates fares centrally in src/lib/domain/fare.ts.
-- This migration adds optional storage columns for internal fare audit details.
-- Existing completed trips are not recalculated by this migration.

begin;

alter table public.trips
  add column if not exists ride_option text,
  add column if not exists fare_breakdown jsonb,
  add column if not exists surge_label text,
  add column if not exists surge_multiplier numeric(6,2),
  add column if not exists remote_pickup_fee numeric(12,2),
  add column if not exists waiting_fee_amount numeric(12,2),
  add column if not exists chargeable_waiting_minutes numeric(12,2),
  add column if not exists long_distance_uplift_pct numeric(6,2),
  add column if not exists long_distance_uplift_amount numeric(12,2);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trips_ride_option_check'
      and conrelid = 'public.trips'::regclass
  ) then
    alter table public.trips
      add constraint trips_ride_option_check
      check (ride_option is null or ride_option in ('go', 'group'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'trips_surge_label_check'
      and conrelid = 'public.trips'::regclass
  ) then
    alter table public.trips
      add constraint trips_surge_label_check
      check (surge_label is null or surge_label in ('normal', 'busy', 'heavy_demand', 'rain_event'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'trips_surge_multiplier_check'
      and conrelid = 'public.trips'::regclass
  ) then
    alter table public.trips
      add constraint trips_surge_multiplier_check
      check (surge_multiplier is null or (surge_multiplier >= 1 and surge_multiplier <= 1.4));
  end if;
end $$;

create index if not exists trips_ride_option_idx
  on public.trips (ride_option);

create index if not exists trips_surge_label_idx
  on public.trips (surge_label);

comment on column public.trips.ride_option is
  'MOOVU service option. go = MOOVU Go, group = MOOVU Go XL for backward compatibility.';
comment on column public.trips.fare_breakdown is
  'Internal fare calculation audit JSON from the central MOOVU fare engine.';
comment on column public.trips.surge_multiplier is
  'Surge multiplier capped at 1.4. Defaults to 1.0 in application code.';
comment on column public.trips.remote_pickup_fee is
  'Optional remote pickup fee. Keep zero/null until remote pickup detection is reliable.';
comment on column public.trips.waiting_fee_amount is
  'Waiting fee amount after free waiting minutes. Not billed until arrival/completion flow is wired.';
comment on column public.trips.long_distance_uplift_pct is
  'Distance uplift percentage applied by the fare engine.';

commit;
