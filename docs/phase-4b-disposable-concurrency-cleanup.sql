-- Disposable-only cleanup of the exact isolated 4b000000 fixture. Never use on production.
begin;
alter table public.financial_ledger_entries disable trigger user;
alter table public.financial_transactions disable trigger user;
alter table public.phase4_fee_assessments disable trigger user;
alter table public.phase4_policies disable trigger user;
delete from public.moovu_notification_outbox where business_event_id in
  (select id from public.moovu_business_events where aggregate_id::text like '4b000000-0000-4000-8000-00000000002_');
delete from public.moovu_business_events where aggregate_id::text like '4b000000-0000-4000-8000-00000000002_';
delete from public.financial_ledger_entries where transaction_id in
  (select id from public.financial_transactions where economic_trip_id::text like '4b000000-0000-4000-8000-00000000002_');
delete from public.financial_transactions where economic_trip_id::text like '4b000000-0000-4000-8000-00000000002_';
delete from public.financial_accounts where owner_id in
  ('4b000000-0000-4000-8000-000000000011'::uuid,'4b000000-0000-4000-8000-000000000012'::uuid);
delete from public.phase4_customer_grace_cycles where customer_id='4b000000-0000-4000-8000-000000000011';
delete from public.phase4_customer_liabilities where customer_id='4b000000-0000-4000-8000-000000000011';
delete from public.phase4_driver_compensations where driver_id='4b000000-0000-4000-8000-000000000012';
delete from public.phase4_fee_assessments where trip_id::text like '4b000000-0000-4000-8000-00000000002_';
delete from public.phase4b_cancellation_quotes where trip_id::text like '4b000000-0000-4000-8000-00000000002_';
delete from public.trip_events where trip_id::text like '4b000000-0000-4000-8000-00000000002_';
delete from public.driver_trip_offers where trip_id::text like '4b000000-0000-4000-8000-00000000002_';
delete from public.trips where id::text like '4b000000-0000-4000-8000-00000000002_';
delete from public.phase4_policies where version='phase4b-concurrency-fixture';
delete from public.driver_accounts where user_id='4b000000-0000-4000-8000-000000000002';
delete from public.customers where id='4b000000-0000-4000-8000-000000000011';
delete from public.drivers where id='4b000000-0000-4000-8000-000000000012';
delete from public.profiles where id in
  ('4b000000-0000-4000-8000-000000000001','4b000000-0000-4000-8000-000000000002');
delete from auth.users where id in
  ('4b000000-0000-4000-8000-000000000001','4b000000-0000-4000-8000-000000000002');
alter table public.phase4_policies enable trigger user;
alter table public.phase4_fee_assessments enable trigger user;
alter table public.financial_transactions enable trigger user;
alter table public.financial_ledger_entries enable trigger user;
commit;
