-- MOOVU growth/safety feature migration
-- Review on staging before running in production.
-- This migration is intentionally additive and does not delete existing data.

-- 1. Role-aware trip ratings.
create table if not exists public.trip_ratings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  customer_id uuid null,
  driver_id uuid null,
  rating integer not null check (rating between 1 and 5),
  comment text null,
  created_at timestamptz not null default now()
);

alter table public.trip_ratings
  add column if not exists reviewer_id uuid null,
  add column if not exists reviewer_role text null,
  add column if not exists reviewee_id uuid null,
  add column if not exists reviewee_role text null,
  add column if not exists updated_at timestamptz not null default now();

update public.trip_ratings
set
  reviewer_id = coalesce(reviewer_id, customer_id),
  reviewer_role = coalesce(reviewer_role, 'customer'),
  reviewee_id = coalesce(reviewee_id, driver_id),
  reviewee_role = coalesce(reviewee_role, 'driver')
where reviewer_role is null;

alter table public.trip_ratings
  drop constraint if exists trip_ratings_reviewer_role_check,
  add constraint trip_ratings_reviewer_role_check
    check (reviewer_role in ('customer', 'driver'));

alter table public.trip_ratings
  drop constraint if exists trip_ratings_reviewee_role_check,
  add constraint trip_ratings_reviewee_role_check
    check (reviewee_role in ('customer', 'driver'));

create unique index if not exists trip_ratings_trip_reviewer_role_uidx
  on public.trip_ratings(trip_id, reviewer_role);

create index if not exists trip_ratings_driver_idx
  on public.trip_ratings(driver_id)
  where driver_id is not null;

create index if not exists trip_ratings_customer_idx
  on public.trip_ratings(customer_id)
  where customer_id is not null;

alter table public.trip_ratings enable row level security;

-- 2. Referral scaffolding. Rewards are intentionally not automated yet.
alter table public.customers
  add column if not exists referral_code text null,
  add column if not exists referred_by_code text null;

alter table public.drivers
  add column if not exists referral_code text null,
  add column if not exists referred_by_code text null;

create unique index if not exists customers_referral_code_uidx
  on public.customers(lower(referral_code))
  where referral_code is not null;

create unique index if not exists drivers_referral_code_uidx
  on public.drivers(lower(referral_code))
  where referral_code is not null;

create table if not exists public.referral_relationships (
  id uuid primary key default gen_random_uuid(),
  referrer_role text not null check (referrer_role in ('customer', 'driver')),
  referrer_id uuid not null,
  referred_role text not null check (referred_role in ('customer', 'driver')),
  referred_id uuid not null,
  referral_code text not null,
  reward_status text not null default 'coming_soon'
    check (reward_status in ('coming_soon', 'pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  unique (referred_role, referred_id)
);

create index if not exists referral_relationships_referrer_idx
  on public.referral_relationships(referrer_role, referrer_id);

alter table public.referral_relationships enable row level security;

-- 3. Support/incident reports linked to trips.
create table if not exists public.support_reports (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid null references public.trips(id) on delete set null,
  reporter_role text not null check (reporter_role in ('customer', 'driver', 'admin')),
  reporter_id uuid null,
  customer_id uuid null,
  driver_id uuid null,
  category text not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'in_review', 'resolved')),
  admin_note text null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_reports_status_idx
  on public.support_reports(status, created_at desc);

create index if not exists support_reports_trip_idx
  on public.support_reports(trip_id)
  where trip_id is not null;

alter table public.support_reports enable row level security;

-- Keep older trip_issues available and aligned for existing customer support route.
create table if not exists public.trip_issues (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  customer_id uuid null,
  driver_id uuid null,
  issue_type text not null,
  description text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

-- 4. Driver document expiry tracking.
alter table public.driver_profiles
  add column if not exists vehicle_license_expiry date null,
  add column if not exists insurance_expiry date null;

alter table public.driver_documents
  add column if not exists expires_at date null,
  add column if not exists expiry_status text null
    check (expiry_status is null or expiry_status in ('valid', 'expiring_soon', 'expired'));

create index if not exists driver_documents_expiry_idx
  on public.driver_documents(driver_id, expires_at)
  where expires_at is not null;

-- 5. Notification reliability fields.
alter table public.fcm_tokens
  add column if not exists last_error text null,
  add column if not exists last_error_at timestamptz null,
  add column if not exists invalidated_at timestamptz null;

create index if not exists fcm_tokens_active_last_seen_idx
  on public.fcm_tokens(is_active, last_seen_at desc);

-- RLS should remain enabled where already used. Keep writes for these operational
-- tables through server routes that verify customer, driver, or admin ownership.
