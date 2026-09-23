-- Disposable only: production already has drivers.created_at.
-- Fixture dates must be set explicitly by the Phase 6 E2E, never treated as historical proof.
alter table public.drivers add column if not exists created_at timestamptz;
create table if not exists public.driver_profile_corrections (
 id uuid primary key default gen_random_uuid(), driver_id uuid not null,
 application_id uuid, table_name text not null, field_name text not null,
 old_value text, new_value text, correction_reason text not null,
 corrected_by uuid not null, corrected_at timestamptz not null default now()
);
alter table public.driver_profile_corrections enable row level security;
create table if not exists public.driver_documents (
 id uuid primary key default gen_random_uuid(),driver_id uuid not null,
 doc_type text not null,document_type text not null,file_path text not null,file_url text,
 mime_type text,original_name text,file_size_bytes bigint,status text default 'uploaded',
 review_status text default 'pending',is_required boolean default false,
 expires_at date,expires_on date,expiry_status text,reviewed_at timestamptz,reviewed_by uuid,
 rejection_reason text,uploaded_at timestamptz default now(),created_at timestamptz default now(),updated_at timestamptz default now()
);
alter table public.driver_documents enable row level security;
