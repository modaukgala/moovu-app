-- REVIEW ONLY. Do not run against production until reviewed and backed up.
-- Supports audited admin completion, optional End OTP completion, five-minute
-- dispatch expiry, and idempotent cancellation credits.

begin;

alter table public.trips
  add column if not exists auto_cancelled_at timestamptz null,
  add column if not exists completed_at timestamptz null,
  add column if not exists completed_by text null,
  add column if not exists completion_note text null,
  add column if not exists completed_without_end_otp boolean not null default false,
  add column if not exists end_otp_bypass_reason text null,
  add column if not exists end_otp_bypass_note text null,
  add column if not exists end_otp_bypassed_by uuid null,
  add column if not exists end_otp_bypassed_at timestamptz null;

do $$
begin
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

create index if not exists trips_dispatch_expiry_idx
  on public.trips (created_at)
  where status in ('requested', 'offered') and driver_id is null;

create index if not exists trips_completion_audit_idx
  on public.trips (completed_at desc)
  where status = 'completed';

-- A duplicate check keeps this migration non-destructive. If historical
-- duplicates exist, the migration prints a notice instead of deleting data.
do $$
begin
  if to_regclass('public.driver_wallet_transactions') is null then
    raise notice 'driver_wallet_transactions does not exist; cancellation-credit index skipped';
  elsif exists (
    select 1
    from public.driver_wallet_transactions
    where trip_id is not null
      and tx_type in ('commission', 'cancellation_credit')
    group by trip_id, tx_type
    having count(*) > 1
  ) then
    raise notice 'Duplicate commission/cancellation-credit rows exist; review them before adding the unique index';
  else
    create unique index if not exists driver_wallet_transactions_one_trip_effect_uidx
      on public.driver_wallet_transactions (trip_id, tx_type)
      where trip_id is not null
        and tx_type in ('commission', 'cancellation_credit');
  end if;
end $$;

comment on column public.trips.completed_without_end_otp is
  'True only when the driver used the audited End OTP bypass flow.';
comment on column public.trips.auto_cancelled_at is
  'Set when dispatch expires without acceptance after the configured maximum search duration.';

commit;

-- Verification queries. These are read-only.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'trips'
  and column_name in (
    'auto_cancelled_at',
    'completed_at',
    'completed_by',
    'completion_note',
    'completed_without_end_otp',
    'end_otp_bypass_reason',
    'end_otp_bypass_note',
    'end_otp_bypassed_by',
    'end_otp_bypassed_at'
  )
order by column_name;

select trip_id, tx_type, count(*) as duplicate_count
from public.driver_wallet_transactions
where trip_id is not null
  and tx_type in ('commission', 'cancellation_credit')
group by trip_id, tx_type
having count(*) > 1;
