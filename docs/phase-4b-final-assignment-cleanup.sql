-- Disposable tangtlmdpnvmoviwrgvd only. Remove exact 4b200000 race fixtures.
begin;
alter table public.financial_ledger_entries disable trigger user;
alter table public.financial_transactions disable trigger user;
alter table public.phase4_fee_assessments disable trigger user;
alter table public.phase4_policies disable trigger user;
delete from public.moovu_notification_outbox where business_event_id in
  (select id from public.moovu_business_events where aggregate_id::text like '4b200000-0000-4000-8000-00000000002_');
delete from public.moovu_business_events where aggregate_id::text like '4b200000-0000-4000-8000-00000000002_';
delete from public.financial_ledger_entries where transaction_id in
  (select id from public.financial_transactions where economic_trip_id::text like '4b200000-0000-4000-8000-00000000002_');
delete from public.financial_transactions where economic_trip_id::text like '4b200000-0000-4000-8000-00000000002_';
delete from public.financial_accounts where owner_id in
  ('4b200000-0000-4000-8000-000000000011'::uuid,'4b200000-0000-4000-8000-000000000012'::uuid,'4b200000-0000-4000-8000-000000000013'::uuid);
delete from public.phase4_customer_grace_cycles where customer_id='4b200000-0000-4000-8000-000000000011';
delete from public.phase4_customer_liabilities where customer_id='4b200000-0000-4000-8000-000000000011';
delete from public.phase4_driver_compensations where driver_id in ('4b200000-0000-4000-8000-000000000012','4b200000-0000-4000-8000-000000000013');
delete from public.trip_cancellation_fees where trip_id::text like '4b200000-0000-4000-8000-00000000002_';
delete from public.phase4_fee_assessments where trip_id::text like '4b200000-0000-4000-8000-00000000002_';
delete from public.phase4b_cancellation_quotes where trip_id::text like '4b200000-0000-4000-8000-00000000002_';
delete from public.driver_wallet_transactions where trip_id::text like '4b200000-0000-4000-8000-00000000002_';
delete from public.driver_wallets where driver_id in ('4b200000-0000-4000-8000-000000000012','4b200000-0000-4000-8000-000000000013');
delete from public.trip_events where trip_id::text like '4b200000-0000-4000-8000-00000000002_';
delete from public.driver_trip_offers where trip_id::text like '4b200000-0000-4000-8000-00000000002_';
delete from public.dispatch_jobs where trip_id::text like '4b200000-0000-4000-8000-00000000002_';
delete from public.trips where id::text like '4b200000-0000-4000-8000-00000000002_';
delete from public.phase4_policies where version='phase4b-final-assignment';
delete from public.driver_accounts where user_id in ('4b200000-0000-4000-8000-000000000002','4b200000-0000-4000-8000-000000000003');
delete from public.customers where id='4b200000-0000-4000-8000-000000000011';
delete from public.drivers where id in ('4b200000-0000-4000-8000-000000000012','4b200000-0000-4000-8000-000000000013');
delete from public.profiles where id::text like '4b200000-0000-4000-8000-00000000000_';
delete from auth.users where id::text like '4b200000-0000-4000-8000-00000000000_';
alter table public.phase4_policies enable trigger user;
alter table public.phase4_fee_assessments enable trigger user;
alter table public.financial_transactions enable trigger user;
alter table public.financial_ledger_entries enable trigger user;
commit;
