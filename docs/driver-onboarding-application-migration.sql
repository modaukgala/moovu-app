-- MOOVU Driver onboarding and document review migration
-- Review-only SQL. Run manually in Supabase SQL Editor after staging review.
-- This migration is additive and does not drop, rename, or overwrite existing data.

create extension if not exists pgcrypto;

alter table public.driver_applications
  add column if not exists current_step integer default 1,
  add column if not exists application_data jsonb default '{}'::jsonb,
  add column if not exists pdp_status text default 'not_available_yet',
  add column if not exists readiness_score integer default 0,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists admin_notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'driver_applications_pdp_status_check'
  ) then
    alter table public.driver_applications
      add constraint driver_applications_pdp_status_check
      check (
        pdp_status in (
          'uploaded',
          'not_available_yet',
          'applying',
          'requested',
          'verified',
          'rejected'
        )
      ) not valid;
  end if;
end $$;

alter table public.driver_profiles
  add column if not exists date_of_birth date,
  add column if not exists profile_photo_path text,
  add column if not exists pdp_status text default 'not_available_yet',
  add column if not exists vehicle_ownership_type text,
  add column if not exists vehicle_category text,
  add column if not exists onboarding_training_status text default 'not_started',
  add column if not exists admin_feedback text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'driver_profiles_pdp_status_check'
  ) then
    alter table public.driver_profiles
      add constraint driver_profiles_pdp_status_check
      check (
        pdp_status in (
          'uploaded',
          'not_available_yet',
          'applying',
          'requested',
          'verified',
          'rejected'
        )
      ) not valid;
  end if;
end $$;

create table if not exists public.driver_documents (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  application_id uuid null references public.driver_applications(id) on delete set null,
  document_type text not null,
  file_path text,
  status text not null default 'pending',
  review_status text not null default 'pending',
  rejection_reason text,
  expires_on date,
  uploaded_at timestamptz default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.driver_documents
  add column if not exists application_id uuid null references public.driver_applications(id) on delete set null,
  add column if not exists document_type text,
  add column if not exists rejection_reason text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'driver_documents_status_check'
  ) then
    alter table public.driver_documents
      add constraint driver_documents_status_check
      check (status in ('pending', 'uploaded', 'verified', 'rejected', 'requested', 'not_available', 'needs_reupload')) not valid;
  end if;
end $$;

create table if not exists public.driver_vehicle_photos (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  application_id uuid null references public.driver_applications(id) on delete set null,
  photo_type text not null,
  file_path text not null,
  status text not null default 'uploaded',
  rejection_reason text,
  uploaded_at timestamptz default now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);

create table if not exists public.driver_review_notes (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  application_id uuid null references public.driver_applications(id) on delete set null,
  note text not null,
  action text,
  created_by uuid,
  created_at timestamptz default now()
);

create table if not exists public.driver_onboarding_checklist (
  driver_id uuid primary key references public.drivers(id) on delete cascade,
  account_complete boolean default false,
  eligibility_complete boolean default false,
  personal_details_complete boolean default false,
  required_documents_uploaded boolean default false,
  pdp_status text default 'not_available_yet',
  vehicle_details_complete boolean default false,
  vehicle_documents_uploaded boolean default false,
  vehicle_photos_uploaded boolean default false,
  admin_document_review_complete boolean default false,
  subscription_ready boolean default false,
  onboarding_training_completed boolean default false,
  notifications_gps_tested boolean default false,
  updated_at timestamptz default now()
);

create index if not exists driver_applications_status_idx
  on public.driver_applications(status, created_at desc);

create index if not exists driver_applications_user_idx
  on public.driver_applications(user_id);

create index if not exists driver_documents_driver_type_idx
  on public.driver_documents(driver_id, document_type);

create index if not exists driver_documents_review_idx
  on public.driver_documents(review_status, uploaded_at desc);

create index if not exists driver_vehicle_photos_driver_type_idx
  on public.driver_vehicle_photos(driver_id, photo_type);

create index if not exists driver_review_notes_driver_idx
  on public.driver_review_notes(driver_id, created_at desc);

-- Private storage buckets. These inserts are safe if the buckets already exist.
insert into storage.buckets (id, name, public)
values
  ('driver-documents', 'driver-documents', false),
  ('driver-vehicle-documents', 'driver-vehicle-documents', false),
  ('driver-vehicle-photos', 'driver-vehicle-photos', false),
  ('driver-profile-photos', 'driver-profile-photos', false)
on conflict (id) do update set public = false;

-- Recommended object paths:
-- drivers/{driverId}/personal/id-document
-- drivers/{driverId}/personal/licence
-- drivers/{driverId}/personal/pdp
-- drivers/{driverId}/vehicle/registration
-- drivers/{driverId}/vehicle/licence-disc
-- drivers/{driverId}/vehicle/roadworthy
-- drivers/{driverId}/vehicle/photos/front

alter table public.driver_documents enable row level security;
alter table public.driver_vehicle_photos enable row level security;
alter table public.driver_review_notes enable row level security;
alter table public.driver_onboarding_checklist enable row level security;

-- Keep writes mediated by server routes/service role.
-- Add project-specific authenticated read policies only after verifying the existing
-- driver account mapping policies in staging. Do not make private documents public.
