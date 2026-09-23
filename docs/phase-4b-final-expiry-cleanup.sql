-- Disposable tangtlmdpnvmoviwrgvd only. Exact 4b300000 fixtures.
begin;
alter table public.phase4_policies disable trigger user;
delete from public.moovu_notification_outbox where business_event_id in
  (select id from public.moovu_business_events where aggregate_id::text like '4b300000-0000-4000-8000-00000000002_');
delete from public.moovu_business_events where aggregate_id::text like '4b300000-0000-4000-8000-00000000002_';
delete from public.phase4b_cancellation_quotes where trip_id::text like '4b300000-0000-4000-8000-00000000002_';
delete from public.trip_events where trip_id::text like '4b300000-0000-4000-8000-00000000002_';
delete from public.trips where id::text like '4b300000-0000-4000-8000-00000000002_';
delete from public.phase4_policies where version='phase4b-final-expiry-races';
delete from public.customers where id='4b300000-0000-4000-8000-000000000011';
delete from public.profiles where id='4b300000-0000-4000-8000-000000000001';
delete from auth.users where id='4b300000-0000-4000-8000-000000000001';
alter table public.phase4_policies enable trigger user;
commit;
