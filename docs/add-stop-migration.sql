-- MOOVU Add Stop migration
-- Review on staging before production. This is additive and keeps existing trips working.

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

create index if not exists trips_stops_gin_idx
  on public.trips using gin (stops);

create index if not exists trips_final_add_stop_increase_idx
  on public.trips(final_add_stop_increase)
  where final_add_stop_increase is not null and final_add_stop_increase > 0;

comment on column public.trips.stops is
  'Ordered customer route stops between pickup and final destination. Maximum 2 stops. Shape: [{address, placeId, lat, lng}].';

comment on column public.trips.original_fare is
  'Fare for the original pickup-to-final-destination route before add-stop increase.';

comment on column public.trips.final_add_stop_increase is
  'Discounted add-stop increase after applying the 40 percent add-stop discount.';

comment on column public.trips.stop_waiting_fee is
  'Separate stop waiting fees. First 3 minutes per stop are free; max 10 minutes per stop and 15 total.';

comment on column public.trips.final_fare is
  'Final customer fare including original fare, discounted add-stop increase, and stop waiting fee where applicable.';
