-- MOOVU driver document upload fix
-- Review-only SQL. Run manually in Supabase SQL Editor after reviewing.
--
-- Purpose:
-- Align public.driver_documents with the current driver document upload API.
-- The upload API writes:
--   driver_id, doc_type, document_type, file_path, status, review_status, uploaded_at
-- Current fixed document_type values:
--   id_document, drivers_license, proof_of_residence, profile_photo, pdp,
--   police_clearance, transport_permit, vehicle_registration,
--   vehicle_license_disc, roadworthy_certificate, vehicle_photos,
--   insurance_document, other
--
-- This migration is non-destructive:
-- - adds missing columns only
-- - backfills empty document type fields
-- - relaxes legacy required columns that the current upload API does not fill
-- - relaxes/aligns status checks for upload/review workflow
-- - creates the private driver-docs storage bucket used by the API
-- - adds a small sync trigger so doc_type and document_type stay aligned
-- - adds a unique driver_id + document_type index so new uploads replace old metadata
-- - does not drop data

begin;

create extension if not exists pgcrypto;

create table if not exists public.driver_documents (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  doc_type text,
  document_type text,
  file_path text,
  status text default 'uploaded',
  review_status text default 'pending',
  rejection_reason text,
  expires_on date,
  expires_at date,
  expiry_status text,
  uploaded_at timestamptz default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.driver_documents
  add column if not exists doc_type text,
  add column if not exists document_type text,
  add column if not exists file_path text,
  add column if not exists status text default 'uploaded',
  add column if not exists review_status text default 'pending',
  add column if not exists rejection_reason text,
  add column if not exists expires_on date,
  add column if not exists expires_at date,
  add column if not exists expiry_status text,
  add column if not exists uploaded_at timestamptz default now(),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

-- Some older MOOVU schema variants made extra review/application fields NOT NULL.
-- The current upload API only needs these core fields:
--   driver_id, document_type/doc_type, file_path, status, review_status, uploaded_at
-- Relax any other required metadata fields so uploads are not blocked by old schema drift.
do $$
declare
  col record;
begin
  for col in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'driver_documents'
      and is_nullable = 'NO'
      and column_name not in ('id', 'driver_id', 'document_type', 'doc_type', 'file_path')
  loop
    execute format('alter table public.driver_documents alter column %I drop not null', col.column_name);
  end loop;
end $$;

-- Backfill both naming variants so old and new code can read the same document type.
update public.driver_documents
set document_type = case
  when lower(coalesce(nullif(document_type, ''), nullif(doc_type, ''), '')) in ('sa id or passport', 'id', 'passport', 'id-document') then 'id_document'
  when lower(coalesce(nullif(document_type, ''), nullif(doc_type, ''), '')) in ('driver licence', 'driver license', 'license', 'licence', 'drivers-license') then 'drivers_license'
  when lower(coalesce(nullif(document_type, ''), nullif(doc_type, ''), '')) in ('proof of residence', 'proof-of-residence') then 'proof_of_residence'
  when lower(coalesce(nullif(document_type, ''), nullif(doc_type, ''), '')) in ('profile photo', 'profile-photo') then 'profile_photo'
  when lower(coalesce(nullif(document_type, ''), nullif(doc_type, ''), '')) in ('pdp / prdp', 'pdp/prdp', 'prdp') then 'pdp'
  when lower(coalesce(nullif(document_type, ''), nullif(doc_type, ''), '')) in ('police clearance', 'police-clearance') then 'police_clearance'
  when lower(coalesce(nullif(document_type, ''), nullif(doc_type, ''), '')) in ('transport permit', 'transport-permit') then 'transport_permit'
  when lower(coalesce(nullif(document_type, ''), nullif(doc_type, ''), '')) in ('registration', 'vehicle registration', 'vehicle_reg', 'vehicle-registration') then 'vehicle_registration'
  when lower(coalesce(nullif(document_type, ''), nullif(doc_type, ''), '')) in ('licence disc', 'license disc', 'vehicle license disc', 'vehicle licence disc') then 'vehicle_license_disc'
  when lower(coalesce(nullif(document_type, ''), nullif(doc_type, ''), '')) in ('roadworthy', 'roadworthy certificate', 'roadworthy-certificate') then 'roadworthy_certificate'
  when lower(coalesce(nullif(document_type, ''), nullif(doc_type, ''), '')) like 'vehicle photo%' then 'vehicle_photos'
  when lower(coalesce(nullif(document_type, ''), nullif(doc_type, ''), '')) in ('insurance', 'insurance proof', 'insurance document') then 'insurance_document'
  else coalesce(nullif(document_type, ''), nullif(doc_type, ''), 'other')
end
where true;

update public.driver_documents
set doc_type = document_type
where doc_type is distinct from document_type;

update public.driver_documents
set status = 'uploaded'
where status is null or status = '';

update public.driver_documents
set review_status = 'pending'
where review_status is null or review_status = '';

update public.driver_documents
set uploaded_at = coalesce(uploaded_at, created_at, now())
where uploaded_at is null;

-- Keep both fields required after backfill because the app supports both schema variants.
alter table public.driver_documents
  alter column document_type set not null,
  alter column doc_type set not null,
  alter column file_path set not null,
  alter column status set default 'uploaded',
  alter column review_status set default 'pending',
  alter column uploaded_at set default now();

-- Align status constraints with current driver/admin document review workflow.
alter table public.driver_documents
  drop constraint if exists driver_documents_status_check;

alter table public.driver_documents
  add constraint driver_documents_status_check
  check (status in (
    'pending',
    'uploaded',
    'verified',
    'approved',
    'rejected',
    'requested',
    'not_available',
    'needs_reupload'
  )) not valid;

alter table public.driver_documents
  drop constraint if exists driver_documents_review_status_check;

alter table public.driver_documents
  add constraint driver_documents_review_status_check
  check (review_status in (
    'pending',
    'uploaded',
    'verified',
    'approved',
    'rejected',
    'requested',
    'not_available',
    'needs_reupload'
  )) not valid;

alter table public.driver_documents
  drop constraint if exists driver_documents_expiry_status_check;

alter table public.driver_documents
  add constraint driver_documents_expiry_status_check
  check (expiry_status is null or expiry_status in ('valid', 'expiring_soon', 'expired')) not valid;

alter table public.driver_documents
  drop constraint if exists driver_documents_document_type_check;

alter table public.driver_documents
  add constraint driver_documents_document_type_check
  check (document_type in (
    'id_document',
    'drivers_license',
    'proof_of_residence',
    'profile_photo',
    'pdp',
    'police_clearance',
    'transport_permit',
    'vehicle_registration',
    'vehicle_license_disc',
    'roadworthy_certificate',
    'vehicle_photos',
    'insurance_document',
    'other'
  )) not valid;

create index if not exists driver_documents_driver_type_idx
  on public.driver_documents(driver_id, document_type);

create index if not exists driver_documents_doc_type_idx
  on public.driver_documents(driver_id, doc_type);

create index if not exists driver_documents_review_idx
  on public.driver_documents(review_status, uploaded_at desc);

create index if not exists driver_documents_uploaded_idx
  on public.driver_documents(driver_id, uploaded_at desc);

-- If duplicates already exist, keep the newest row for each driver/document_type
-- and move older rows to "other" so the unique index can be created safely.
with ranked as (
  select
    id,
    row_number() over (
      partition by driver_id, document_type
      order by uploaded_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.driver_documents
)
update public.driver_documents d
set document_type = 'other',
    doc_type = 'other',
    updated_at = now()
from ranked r
where d.id = r.id
  and r.rn > 1;

create unique index if not exists driver_documents_driver_document_type_uidx
  on public.driver_documents(driver_id, document_type)
  where document_type <> 'other';

create or replace function public.moovu_sync_driver_document_fields()
returns trigger
language plpgsql
as $$
begin
  new.document_type := coalesce(nullif(new.document_type, ''), nullif(new.doc_type, ''), 'other');
  new.doc_type := coalesce(nullif(new.doc_type, ''), nullif(new.document_type, ''), 'other');
  new.status := coalesce(nullif(new.status, ''), 'uploaded');
  new.review_status := coalesce(nullif(new.review_status, ''), 'pending');
  new.uploaded_at := coalesce(new.uploaded_at, now());
  new.created_at := coalesce(new.created_at, now());
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists moovu_sync_driver_document_fields_trg on public.driver_documents;
create trigger moovu_sync_driver_document_fields_trg
before insert or update on public.driver_documents
for each row
execute function public.moovu_sync_driver_document_fields();

-- The current upload API writes files to the private "driver-docs" bucket.
insert into storage.buckets (id, name, public)
values ('driver-docs', 'driver-docs', false)
on conflict (id) do update set public = false;

-- Optional compatibility bucket name used by docs/future refactors.
insert into storage.buckets (id, name, public)
values ('driver-documents', 'driver-documents', false)
on conflict (id) do update set public = false;

-- Keep RLS enabled; writes are mediated by service-role API routes.
alter table public.driver_documents enable row level security;

-- Refresh PostgREST/Supabase schema cache after DDL changes.
notify pgrst, 'reload schema';

commit;

-- Optional diagnostic query to run after the migration.
-- It should return no rows with is_nullable = 'NO' except:
-- id, driver_id, document_type, doc_type, file_path.
--
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'driver_documents'
-- order by ordinal_position;
