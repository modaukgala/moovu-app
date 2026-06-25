-- MOOVU account deletion compliance support
-- Review-only migration. Do not run blindly in production.
-- Run on staging first, then production after confirming policies and admin workflow.

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role text not null check (role in ('customer', 'driver')),
  customer_id uuid null,
  driver_id uuid null,
  status text not null default 'pending' check (status in ('pending', 'in_review', 'completed', 'rejected', 'cancelled')),
  reason text null,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz null,
  reviewed_by uuid null,
  completed_at timestamptz null,
  review_note text null,
  retained_records_note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists account_deletion_requests_user_role_status_key
  on public.account_deletion_requests (user_id, role, status);

create index if not exists account_deletion_requests_role_status_idx
  on public.account_deletion_requests (role, status, requested_at desc);

create index if not exists account_deletion_requests_customer_idx
  on public.account_deletion_requests (customer_id)
  where customer_id is not null;

create index if not exists account_deletion_requests_driver_idx
  on public.account_deletion_requests (driver_id)
  where driver_id is not null;

alter table public.customers
  add column if not exists deletion_requested_at timestamptz null,
  add column if not exists deletion_status text not null default 'active',
  add column if not exists deleted_at timestamptz null,
  add column if not exists anonymized_at timestamptz null,
  add column if not exists deletion_reason text null,
  add column if not exists deletion_review_note text null;

alter table public.drivers
  add column if not exists deletion_requested_at timestamptz null,
  add column if not exists deletion_status text not null default 'active',
  add column if not exists deleted_at timestamptz null,
  add column if not exists anonymized_at timestamptz null,
  add column if not exists deletion_reason text null,
  add column if not exists deletion_review_note text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customers_deletion_status_check'
  ) then
    alter table public.customers
      add constraint customers_deletion_status_check
      check (deletion_status in ('active', 'pending', 'in_review', 'completed', 'rejected', 'cancelled'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'drivers_deletion_status_check'
  ) then
    alter table public.drivers
      add constraint drivers_deletion_status_check
      check (deletion_status in ('active', 'pending', 'in_review', 'completed', 'rejected', 'cancelled'));
  end if;
end $$;

alter table public.account_deletion_requests enable row level security;

-- The app performs immediate verified account deletion through server routes using service-role access.
-- Keep direct table access restricted. Add staff/admin select policies only if your existing
-- admin role helper is non-recursive in this Supabase project.

comment on table public.account_deletion_requests is
  'Legacy audit table for earlier account deletion workflow. Current app flow deletes the auth login immediately after verification and anonymizes retained legal, trip, payment, receipt, tax, fraud-prevention, and safety records.';

comment on column public.account_deletion_requests.retained_records_note is
  'Admin note explaining which records must be retained for legal, tax, payment, dispute, fraud-prevention, or safety reasons.';
