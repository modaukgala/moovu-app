-- READ ONLY / REVIEW ONLY / NOT FOR AUTOMATIC EXECUTION.
-- NOT EXECUTED. Contains catalog queries only; no customer rows or credentials.
-- Review results before designing or approving any Phase 0.5 migration.
-- Run each SELECT separately if the SQL editor shows only the last result.

select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('drivers', 'driver_accounts', 'driver_applications',
    'driver_profiles', 'driver_wallets', 'driver_wallet_transactions',
    'driver_settlements', 'driver_subscription_payments',
    'driver_subscription_requests', 'driver_payment_requests',
    'trips', 'trip_events', 'trip_cancellation_fees', 'driver_trip_offers')
order by table_name, ordinal_position;

-- Include every relevant financial table, including names absent from local docs.
select c.relname, c.relrowsecurity, c.relforcerowsecurity,
       con.conname, con.contype, pg_get_constraintdef(con.oid) as definition
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_constraint con on con.conrelid = c.oid
where n.nspname = 'public' and c.relkind in ('r', 'p')
  and c.relname ~ '(driver|trip|payment|settlement|wallet|commission|subscription)'
order by c.relname, con.conname;

-- Inspect incoming as well as outgoing references, especially DELETE CASCADE.
select con.conrelid::regclass as source_table,
       con.confrelid::regclass as referenced_table,
       con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
where con.contype = 'f'
  and (con.conrelid::regclass::text ~ '(driver|trip|payment|settlement|wallet|commission|subscription)'
       or con.confrelid::regclass::text ~ '(driver|trip|payment|settlement|wallet|commission|subscription|auth.users)')
order by con.conrelid::regclass::text, con.conname;

select tablename, indexname, indexdef
from pg_indexes where schemaname = 'public'
  and tablename ~ '(driver|trip|payment|settlement|wallet|commission|subscription)'
order by tablename, indexname;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public'
  and tablename ~ '(driver|trip|payment|settlement|wallet|commission|subscription)'
order by tablename, policyname;

select c.relname as table_name, t.tgname, pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and n.nspname = 'public'
  and c.relname ~ '(driver|trip|payment|settlement|wallet|commission|subscription)'
order by c.relname, t.tgname;

-- Review function bodies locally before sharing: legacy bodies may contain secrets.
select p.oid::regprocedure as function_signature, p.prosecdef as security_definer,
       p.proconfig, p.proacl, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and p.proname ~ '(dispatch|offer|assign|accept|payment|settlement|commission|subscription|cancel|complete|wallet)'
order by p.proname;

-- No RPC calls, migrations, data writes, duplicate cleanup or reconciliation here.
-- Data-dependent duplicate/snapshot counts must follow verified column definitions.

-- Phase 0.5B conflict inventory. Run only after confirming these columns exist.
select 'driver_accounts_by_user' as check_name, user_id::text as conflict_key, count(*) as row_count
from public.driver_accounts group by user_id having count(*) > 1
union all
select 'driver_applications_by_user', user_id::text, count(*)
from public.driver_applications where user_id is not null group by user_id having count(*) > 1;

select 'orphan_driver_account' as check_name, da.user_id::text as record_id
from public.driver_accounts da left join public.drivers d on d.id=da.driver_id
where da.driver_id is not null and d.id is null
union all
select 'orphan_application_driver', a.id::text
from public.driver_applications a left join public.drivers d on d.id=a.driver_id
where a.driver_id is not null and d.id is null;

select trip_id, count(*) as commission_rows
from public.driver_wallet_transactions
where transaction_type='commission' and trip_id is not null
group by trip_id having count(*) > 1;

select trip_id, count(*) as fee_rows
from public.trip_cancellation_fees where trip_id is not null
group by trip_id having count(*) > 1;

select status, count(*) as row_count from public.driver_payment_requests group by status order by status;
select count(*) as completed_trip_count from public.trips where status='completed';
select count(*) as commission_row_count from public.driver_wallet_transactions where transaction_type='commission';
select count(*) as settlement_row_count from public.driver_settlements;
select count(*) as cancellation_credit_count from public.driver_wallet_transactions where transaction_type='cancellation_credit';

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name ~ '(wallet|settlement|payment|commission|subscription|business_events|outbox)'
order by table_name,grantee,privilege_type;

select p.oid::regprocedure as function_signature, p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like 'phase05b_%'
order by p.proname;

-- Phase 0.5D compatibility checks. Application ownership is authoritative
-- through driver_accounts; driver_applications.driver_id is not assumed.
select a.user_id,a.id as application_id,da.driver_id
from public.driver_applications a left join public.driver_accounts da on da.user_id=a.user_id
where da.user_id is null or da.driver_id is null;

select t.id,t.status,max(e.created_at) filter(where e.event_type in ('assignment','offer_accepted')) as assignment_or_acceptance_at
from public.trips t left join public.trip_events e on e.trip_id=t.id
where t.status in ('assigned','arrived','ongoing','completed')
group by t.id,t.status having max(e.created_at) filter(where e.event_type in ('assignment','offer_accepted')) is null;

select grantee,table_name,privilege_type from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated')
and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
and table_name in ('driver_accounts','driver_wallets','driver_wallet_transactions','driver_settlements','driver_subscription_payments')
order by table_name,grantee,privilege_type;

select p.oid::regprocedure as function_signature,p.prosecdef,p.proconfig,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('refresh_driver_subscription','increment_driver_offer_received');

-- Run phase-05d-wallet-reconciliation.sql separately. Any non-zero
-- projection_difference blocks activation; legacy-ledger differences are
-- review evidence and must not be auto-corrected.
