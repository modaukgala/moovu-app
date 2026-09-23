-- Disposable tangtlmdpnvmoviwrgvd only. Isolated committed fixtures for two-session races.
begin;
insert into auth.users(id) values
  ('4b100000-0000-4000-8000-000000000001'),
  ('4b100000-0000-4000-8000-000000000002'),
  ('4b100000-0000-4000-8000-000000000003');
insert into public.profiles(id,role) values
  ('4b100000-0000-4000-8000-000000000001','customer'),
  ('4b100000-0000-4000-8000-000000000002','driver'),
  ('4b100000-0000-4000-8000-000000000003','admin');
insert into public.customers(id,auth_user_id) values
  ('4b100000-0000-4000-8000-000000000011','4b100000-0000-4000-8000-000000000001');
insert into public.drivers(id,busy) values('4b100000-0000-4000-8000-000000000012',true);
insert into public.driver_accounts(user_id,driver_id) values
  ('4b100000-0000-4000-8000-000000000002','4b100000-0000-4000-8000-000000000012');
insert into public.phase4_policies(version,effective_from,free_seconds,no_show_seconds,
  go_late_cents,go_late_driver_cents,go_late_moovu_cents,xl_late_cents,xl_late_driver_cents,xl_late_moovu_cents,
  go_no_show_cents,go_no_show_driver_cents,go_no_show_moovu_cents,
  xl_no_show_cents,xl_no_show_driver_cents,xl_no_show_moovu_cents)
values('phase4b-final-races',clock_timestamp()-interval '2 days',180,300,
  2000,1300,700,3000,2000,1000,3000,2200,800,4000,3000,1000);
insert into public.trips(id,customer_id,driver_id,status,ride_option,created_at,
  driver_arrived_at,arrival_evidence_qualified,arrival_evidence_version,
  fare_amount,final_fare,estimated_fare,original_fare,duration_min)
select ('4b100000-0000-4000-8000-00000000002'||n)::uuid,
  '4b100000-0000-4000-8000-000000000011'::uuid,
  '4b100000-0000-4000-8000-000000000012'::uuid,
  case when n in (1,2) then 'arrived' else 'assigned' end,
  'go',clock_timestamp()-interval '20 minutes',
  case when n in (1,2) then clock_timestamp()-interval '7 minutes' else null end,
  case when n in (1,2) then true else null end,
  case when n in (1,2) then 'phase-05b-v1' else null end,
  100,100,100,100,0
from generate_series(1,4) n;
commit;
