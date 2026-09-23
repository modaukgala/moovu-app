-- ONLY for the fixed Phase 3 connected fixture on tangtlmdpnvmoviwrgvd.
-- Database-owner execution after the private test runner, including failures.
-- Never run against production. Auth users are deleted separately via Auth Admin.
begin;
set local session_replication_role='replica';

delete from public.financial_ledger_entries where transaction_id in (
  select id from public.financial_transactions
  where (source_type='TRIP' and source_id in (
    '97100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000002'))
    or idempotency_key in (
      'online_service_completion:97100000-0000-4000-8000-000000000001',
      'online_service_completion:97100000-0000-4000-8000-000000000002'));
delete from public.online_driver_payables where trip_id in (
  '97100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000002');
delete from public.online_payment_reconciliation_items where payment_attempt_id in (
  select id from public.online_payment_attempts where trip_id in (
    '97100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000002'));
delete from public.online_payment_refunds where payment_attempt_id in (
  select id from public.online_payment_attempts where trip_id in (
    '97100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000002'));
delete from public.online_provider_events where payment_attempt_id in (
  select id from public.online_payment_attempts where trip_id in (
    '97100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000002'));
delete from public.online_payment_attempts where trip_id in (
  '97100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000002');
delete from public.financial_transactions where source_type='TRIP' and source_id in (
  '97100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000002');
delete from public.financial_transactions where idempotency_key in (
  'online_service_completion:97100000-0000-4000-8000-000000000001',
  'online_service_completion:97100000-0000-4000-8000-000000000002');
delete from public.moovu_notification_outbox where business_event_id in (
  select id from public.moovu_business_events where aggregate_type='trip' and aggregate_id in (
    '97100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000002'));
delete from public.moovu_business_events where aggregate_type='trip' and aggregate_id in (
  '97100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000002');

do $$ declare v record; begin
  for v in select c.table_name from information_schema.columns c
    where c.table_schema='public' and c.column_name='trip_id' and c.data_type='uuid'
      and c.table_name not in ('online_driver_payables','online_payment_attempts')
  loop
    execute format('delete from public.%I where trip_id in ($1,$2)',v.table_name)
      using '97100000-0000-4000-8000-000000000001'::uuid,
            '97100000-0000-4000-8000-000000000002'::uuid;
  end loop;
end $$;

delete from public.trips where id in (
  '97100000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000002');
delete from public.financial_accounts where owner_type='DRIVER'
  and owner_id in ('97200000-0000-4000-8000-000000000001','97200000-0000-4000-8000-000000000002');
delete from public.driver_offer_stats where driver_id in ('97200000-0000-4000-8000-000000000001','97200000-0000-4000-8000-000000000002');
delete from public.driver_accounts where driver_id in ('97200000-0000-4000-8000-000000000001','97200000-0000-4000-8000-000000000002');
delete from public.driver_wallets where driver_id in ('97200000-0000-4000-8000-000000000001','97200000-0000-4000-8000-000000000002');
delete from public.drivers where id in ('97200000-0000-4000-8000-000000000001','97200000-0000-4000-8000-000000000002');
delete from public.customers where id in (
  '97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000002');
delete from public.profiles where id in (select id from auth.users where email in (
  'phase3-e2e-customer-20260912@example.invalid',
  'phase3-e2e-other-20260912@example.invalid',
  'phase3-e2e-driver-20260912@example.invalid',
  'phase3-e2e-wrong-driver-20260912@example.invalid'));
commit;
