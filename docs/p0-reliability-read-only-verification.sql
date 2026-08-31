-- READ ONLY. Run in Supabase SQL Editor and share these results before migration approval.
-- No customer/trip rows, secrets or notification tokens are selected.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'dispatch_jobs'
order by ordinal_position;

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid = to_regclass('public.dispatch_jobs');

select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename in ('dispatch_jobs', 'driver_trip_offers');

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer, p.proconfig, p.proacl,
  pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in
  ('claim_due_dispatch_jobs', 'guard_dispatch_job_retry', 'reserve_trip_offer',
   'accept_trip_offer', 'expire_due_trip_offers');

select tgname, pg_get_triggerdef(oid) as definition from pg_trigger
where tgrelid = to_regclass('public.dispatch_jobs') and not tgisinternal;

select status, attempts, count(*) as job_count, min(run_at) as oldest_run_at
from public.dispatch_jobs group by status, attempts order by status, attempts;
