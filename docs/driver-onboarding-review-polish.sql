-- MOOVU Driver Onboarding Review Polish
-- Review-only SQL. Do not run in production until reviewed on staging.
-- Purpose:
-- - Support admin document-assisted checks without auto-approving documents.
-- - Store admin review notes separately from driver-visible corrections.
-- - Snapshot readiness results for audit/history.
-- This script is additive and does not drop or rename existing data.

create table if not exists public.driver_document_checks (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  document_id uuid null references public.driver_documents(id) on delete set null,
  document_type text not null,
  field_name text not null,
  manual_value text null,
  extracted_value text null,
  match_status text not null default 'needs_review',
  confidence numeric null,
  reviewed_by uuid null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_document_checks_match_status_check
    check (match_status in ('matched', 'mismatch', 'not_found', 'needs_review'))
);

create index if not exists driver_document_checks_driver_idx
  on public.driver_document_checks(driver_id, created_at desc);

create index if not exists driver_document_checks_document_idx
  on public.driver_document_checks(document_id);

create unique index if not exists driver_document_checks_unique_field_idx
  on public.driver_document_checks(driver_id, document_type, field_name);

create table if not exists public.driver_review_notes (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  admin_id uuid null,
  note text not null,
  note_type text not null default 'internal',
  created_at timestamptz not null default now(),
  constraint driver_review_notes_type_check
    check (note_type in ('internal', 'driver_visible', 'document_request', 'approval_warning'))
);

create index if not exists driver_review_notes_driver_idx
  on public.driver_review_notes(driver_id, created_at desc);

create table if not exists public.driver_readiness_snapshots (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  readiness_percent integer not null default 0,
  status text not null default 'needs_required_items',
  missing_required jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint driver_readiness_percent_check
    check (readiness_percent >= 0 and readiness_percent <= 100)
);

create index if not exists driver_readiness_snapshots_driver_idx
  on public.driver_readiness_snapshots(driver_id, created_at desc);

alter table public.driver_document_checks enable row level security;
alter table public.driver_review_notes enable row level security;
alter table public.driver_readiness_snapshots enable row level security;

-- Admin access should continue to use server-side service-role routes.
-- If direct RLS policies are required later, add least-privilege policies that
-- rely on a non-recursive staff/admin check function.
