-- MOOVU active-trip add-stop and final fare migration
-- Review on staging before production. Do not run blindly on production.
-- This migration is additive only and does not modify existing trip values.

alter table public.trips
  add column if not exists estimated_fare numeric(12,2) null,
  add column if not exists fare_adjustment_amount numeric(12,2) null,
  add column if not exists fare_adjustment_reason text null,
  add column if not exists fare_finalized_at timestamptz null,
  add column if not exists actual_distance_km numeric(10,2) null,
  add column if not exists actual_duration_min numeric(10,2) null,
  add column if not exists actual_route_source text null,
  add column if not exists active_stop_added_at timestamptz null,
  add column if not exists active_stop_added_by uuid null,
  add column if not exists active_stop_note text null;

-- These columns may already exist from docs/add-stop-migration.sql.
-- They are repeated here with if not exists so this file can be reviewed as the
-- full active-stop/final-fare contract.
alter table public.trips
  add column if not exists stops jsonb null,
  add column if not exists original_distance_km numeric(10,2) null,
  add column if not exists original_duration_min numeric(10,2) null,
  add column if not exists original_fare numeric(12,2) null,
  add column if not exists route_distance_km numeric(10,2) null,
  add column if not exists route_duration_min numeric(10,2) null,
  add column if not exists extra_stop_distance_km numeric(10,2) null,
  add column if not exists extra_stop_duration_min numeric(10,2) null,
  add column if not exists raw_add_stop_increase numeric(12,2) null,
  add column if not exists add_stop_discount_percent numeric(5,2) null,
  add column if not exists final_add_stop_increase numeric(12,2) null,
  add column if not exists stop_waiting_fee numeric(12,2) null,
  add column if not exists final_fare numeric(12,2) null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trips_stops_is_array_check'
  ) then
    alter table public.trips
      add constraint trips_stops_is_array_check
      check (stops is null or jsonb_typeof(stops) = 'array') not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trips_stops_max_two_check'
  ) then
    alter table public.trips
      add constraint trips_stops_max_two_check
      check (stops is null or jsonb_array_length(stops) <= 2) not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trips_actual_route_source_check'
  ) then
    alter table public.trips
      add constraint trips_actual_route_source_check
      check (
        actual_route_source is null
        or actual_route_source in ('route_estimate', 'gps_audit', 'admin_override')
      ) not valid;
  end if;
end $$;

create index if not exists trips_stops_gin_idx
  on public.trips using gin (stops);

create index if not exists trips_final_fare_idx
  on public.trips(final_fare)
  where final_fare is not null;

create index if not exists trips_fare_finalized_at_idx
  on public.trips(fare_finalized_at)
  where fare_finalized_at is not null;

create index if not exists trips_active_stop_added_at_idx
  on public.trips(active_stop_added_at)
  where active_stop_added_at is not null;

comment on column public.trips.estimated_fare is
  'Fare shown before final end-OTP completion. Used to calculate final adjustment.';

comment on column public.trips.fare_adjustment_amount is
  'Difference between the estimated fare and the final fare after active stops or waiting fees.';

comment on column public.trips.fare_finalized_at is
  'Timestamp when driver end OTP finalized the customer fare and commission basis.';

comment on column public.trips.actual_route_source is
  'Source of actual_distance_km and actual_duration_min. Current active-stop implementation uses route_estimate.';

comment on column public.trips.active_stop_added_at is
  'Most recent timestamp when a customer added a stop after the driver accepted the trip.';
