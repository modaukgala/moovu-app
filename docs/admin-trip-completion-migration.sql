-- REVIEW ONLY. Do not run until reviewed and backed up.
-- Completes the shared MOOVU trip-completion audit contract without modifying
-- existing trip statuses, OTP values, fares, relationships, or completed trips.

begin;

alter table public.trips
  add column if not exists completed_at timestamptz null,
  add column if not exists completed_by text null,
  add column if not exists trip_started_at timestamptz null,
  add column if not exists admin_completion_reason text null,
  add column if not exists admin_completion_note text null,
  add column if not exists completed_without_end_otp boolean not null default false,
  add column if not exists end_otp_bypass_reason text null,
  add column if not exists end_otp_bypass_note text null,
  add column if not exists end_otp_bypassed_by uuid null,
  add column if not exists end_otp_bypassed_at timestamptz null,
  add column if not exists final_fare numeric(12,2) null,
  add column if not exists estimated_fare numeric(12,2) null,
  add column if not exists fare_adjustment_amount numeric(12,2) null,
  add column if not exists fare_adjustment_reason text null,
  add column if not exists fare_finalized_at timestamptz null,
  add column if not exists actual_distance_km numeric(10,2) null,
  add column if not exists actual_duration_min numeric(10,2) null,
  add column if not exists actual_route_source text null;

do $$
begin
  -- Older deployments used a narrower check that rejected the shared
  -- completion engine's route-source values during admin completion.
  alter table public.trips
    drop constraint if exists trips_actual_route_source_check;
  alter table public.trips
    add constraint trips_actual_route_source_check
    check (
      actual_route_source is null
      or actual_route_source in ('route_estimate', 'gps_audit', 'admin_override')
    ) not valid;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.trips'::regclass
      and conname = 'trips_completed_by_check'
  ) then
    alter table public.trips
      add constraint trips_completed_by_check
      check (completed_by is null or completed_by in ('driver', 'admin')) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.trips'::regclass
      and conname = 'trips_end_otp_bypass_reason_check'
  ) then
    alter table public.trips
      add constraint trips_end_otp_bypass_reason_check
      check (
        end_otp_bypass_reason is null
        or end_otp_bypass_reason in (
          'Customer phone unavailable/dead',
          'Customer unable to access OTP',
          'Connectivity issue',
          'Customer left vehicle',
          'Other'
        )
      ) not valid;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from public.driver_wallet_transactions
    where trip_id is not null
      and tx_type = 'commission'
    group by trip_id
    having count(*) > 1
  ) then
    raise exception
      'Duplicate trip commission rows exist. Review them before applying the completion uniqueness guard.';
  end if;
end $$;

create unique index if not exists driver_wallet_transactions_one_trip_commission_uidx
  on public.driver_wallet_transactions (trip_id)
  where trip_id is not null and tx_type = 'commission';

create index if not exists trips_completion_audit_idx
  on public.trips (completed_at desc)
  where status = 'completed';

comment on column public.trips.completed_by is
  'Actor type that completed the trip: driver or admin.';
comment on column public.trips.admin_completion_reason is
  'Admin override category recorded when MOOVU completes an active trip.';
comment on column public.trips.admin_completion_note is
  'Required operator note explaining an admin trip completion.';
comment on column public.trips.completed_without_end_otp is
  'True only when the assigned driver used the audited End OTP bypass flow.';

commit;

-- Read-only verification. The existing trips_status_check must continue to
-- allow the statuses used by the current app, including ongoing and completed.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.trips'::regclass
  and conname in (
    'trips_status_check',
    'trips_actual_route_source_check',
    'trips_completed_by_check',
    'trips_end_otp_bypass_reason_check'
  )
order by conname;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'trips'
  and column_name in (
    'completed_at',
    'completed_by',
    'trip_started_at',
    'admin_completion_reason',
    'admin_completion_note',
    'completed_without_end_otp',
    'end_otp_bypass_reason',
    'end_otp_bypass_note',
    'end_otp_bypassed_by',
    'end_otp_bypassed_at',
    'final_fare',
    'estimated_fare',
    'fare_adjustment_amount',
    'fare_adjustment_reason',
    'fare_finalized_at',
    'actual_distance_km',
    'actual_duration_min',
    'actual_route_source'
  )
order by column_name;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname = 'driver_wallet_transactions_one_trip_commission_uidx';
