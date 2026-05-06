-- MOOVU optional legal acceptance columns
-- Review before running. Run only on local/staging first, then production after approval.
-- The current app stores legal acceptance in Supabase Auth user metadata.
-- These columns are optional if you want to mirror acceptance on the customers table.

alter table public.customers
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists privacy_accepted_at timestamptz,
  add column if not exists terms_version text,
  add column if not exists privacy_version text,
  add column if not exists legal_acceptance_source text;

create index if not exists customers_terms_version_idx
  on public.customers (terms_version);

create index if not exists customers_privacy_version_idx
  on public.customers (privacy_version);
