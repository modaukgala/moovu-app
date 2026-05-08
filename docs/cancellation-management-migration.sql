-- MOOVU cancellation and no-show management migration
-- Review before running. Do not run on production without a backup and staging test.

alter table public.trips
  add column if not exists cancel_reason text,
  add column if not exists cancellation_type text,
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_by text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_fee_amount numeric(10,2) default 0,
  add column if not exists cancellation_driver_amount numeric(10,2) default 0,
  add column if not exists cancellation_moovu_amount numeric(10,2) default 0,
  add column if not exists cancellation_policy_code text,
  add column if not exists free_cancellation_until timestamptz,
  add column if not exists driver_arrived_at timestamptz,
  add column if not exists no_show_eligible_at timestamptz,
  add column if not exists customer_reliability_impact numeric(5,2) default 0,
  add column if not exists driver_reliability_impact numeric(5,2) default 0;

comment on column public.trips.cancel_reason is
  'Legacy cancellation reason field kept for backward compatibility with existing MOOVU UI.';
comment on column public.trips.cancellation_reason is
  'Normalized cancellation reason for reporting and future app versions.';
comment on column public.trips.cancellation_type is
  'Cancellation fee category: free_cancel, late_cancel, no_show, or future reviewed values.';

create table if not exists public.trip_cancellation_fees (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  customer_id uuid null references public.customers(id) on delete set null,
  driver_id uuid null references public.drivers(id) on delete set null,
  fee_type text not null check (fee_type in ('free_cancel', 'late_cancel', 'no_show')),
  fee_amount numeric(10,2) not null default 0,
  driver_amount numeric(10,2) not null default 0,
  moovu_amount numeric(10,2) not null default 0,
  reason text null,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null
);

create index if not exists trip_cancellation_fees_trip_id_idx
  on public.trip_cancellation_fees(trip_id);

create index if not exists trip_cancellation_fees_driver_id_idx
  on public.trip_cancellation_fees(driver_id);

create index if not exists trip_cancellation_fees_fee_type_idx
  on public.trip_cancellation_fees(fee_type);

create index if not exists trip_cancellation_fees_created_at_idx
  on public.trip_cancellation_fees(created_at);

create index if not exists trips_free_cancellation_until_idx
  on public.trips(free_cancellation_until);

create index if not exists trips_no_show_eligible_at_idx
  on public.trips(no_show_eligible_at);

-- Optional uniqueness if one fee record per trip is desired:
-- create unique index concurrently if not exists trip_cancellation_fees_one_fee_per_trip
--   on public.trip_cancellation_fees(trip_id)
--   where fee_type in ('late_cancel', 'no_show');

-- Customer profile email alignment. This keeps phone-based auth compatibility while
-- allowing real customer email login and reporting.
alter table public.customers
  add column if not exists email text;

create unique index if not exists customers_email_lower_unique
  on public.customers (lower(email))
  where email is not null;
