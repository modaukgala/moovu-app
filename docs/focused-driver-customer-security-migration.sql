-- REVIEW ONLY. Apply in Supabase SQL Editor after backup and staging review.
-- Adds customer security audit records without changing existing customer or trip data.

begin;

create table if not exists public.customer_security_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid null references public.customers(id) on delete set null,
  event_type text not null,
  event_metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid null,
  actor_role text null,
  created_at timestamptz not null default now()
);

create index if not exists customer_security_events_customer_created_idx
  on public.customer_security_events(customer_id, created_at desc);

create table if not exists public.customer_contact_change_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  contact_type text not null check (contact_type in ('email', 'phone')),
  requested_value text not null,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'expired', 'cancelled', 'rejected')),
  verification_expires_at timestamptz null,
  verified_at timestamptz null,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_contact_change_requests_pending_value_uidx
    unique (customer_id, contact_type, requested_value)
);

create index if not exists customer_contact_change_requests_customer_status_idx
  on public.customer_contact_change_requests(customer_id, status, requested_at desc);

alter table public.customer_security_events enable row level security;
alter table public.customer_contact_change_requests enable row level security;

-- These records contain security-sensitive audit data. Server service-role operations bypass RLS.
-- Admin read access is provided only to users carrying the existing admin role metadata.
drop policy if exists "Admins can read customer security events" on public.customer_security_events;
create policy "Admins can read customer security events"
  on public.customer_security_events
  for select
  to authenticated
  using (
    coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'admin'
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
  );

drop policy if exists "Admins can read customer contact changes" on public.customer_contact_change_requests;
create policy "Admins can read customer contact changes"
  on public.customer_contact_change_requests
  for select
  to authenticated
  using (
    coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') = 'admin'
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
  );

commit;

-- Verify:
-- select to_regclass('public.customer_security_events');
-- select to_regclass('public.customer_contact_change_requests');
