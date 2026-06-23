-- MOOVU driver admin correction audit trail
-- Review-only migration. Run in Supabase SQL Editor after staging review.
-- This table records every admin correction to driver/application/profile data.

create table if not exists public.driver_profile_corrections (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  application_id uuid null references public.driver_applications(id) on delete set null,
  table_name text not null check (table_name in ('drivers', 'driver_profiles', 'driver_applications')),
  field_name text not null,
  old_value text null,
  new_value text null,
  correction_reason text not null,
  corrected_by uuid not null references auth.users(id) on delete restrict,
  corrected_at timestamptz not null default now()
);

create index if not exists driver_profile_corrections_driver_idx
  on public.driver_profile_corrections(driver_id, corrected_at desc);

create index if not exists driver_profile_corrections_application_idx
  on public.driver_profile_corrections(application_id, corrected_at desc)
  where application_id is not null;

create index if not exists driver_profile_corrections_admin_idx
  on public.driver_profile_corrections(corrected_by, corrected_at desc);

alter table public.driver_profile_corrections enable row level security;

-- Admin/support access should normally go through service-role API routes.
-- If your existing public.is_staff() SECURITY DEFINER helper has been applied,
-- these policies allow staff reads without making correction history public.
drop policy if exists "Staff can read driver correction audit" on public.driver_profile_corrections;
create policy "Staff can read driver correction audit"
  on public.driver_profile_corrections
  for select
  using (public.is_staff());

-- Direct browser inserts/updates are intentionally not granted. Corrections are
-- created by /api/admin/driver-corrections after server-side admin verification.

comment on table public.driver_profile_corrections is
  'Audit trail for admin corrections to driver profile, application, and vehicle fields.';

comment on column public.driver_profile_corrections.correction_reason is
  'Required admin reason explaining why this field was corrected.';
