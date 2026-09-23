-- Disposable tangtlmdpnvmoviwrgvd only. Committed fixtures for real offer-acceptance races.
begin;
insert into auth.users(id) values ('4b200000-0000-4000-8000-000000000001'),('4b200000-0000-4000-8000-000000000002'),('4b200000-0000-4000-8000-000000000003');
insert into public.profiles(id,role) values ('4b200000-0000-4000-8000-000000000001','customer'),('4b200000-0000-4000-8000-000000000002','driver'),('4b200000-0000-4000-8000-000000000003','driver');
insert into public.customers(id,auth_user_id) values ('4b200000-0000-4000-8000-000000000011','4b200000-0000-4000-8000-000000000001');
insert into public.drivers(id,busy,online,status) values ('4b200000-0000-4000-8000-000000000012',false,true,'approved'),('4b200000-0000-4000-8000-000000000013',false,true,'approved');
insert into public.driver_accounts(user_id,driver_id) values ('4b200000-0000-4000-8000-000000000002','4b200000-0000-4000-8000-000000000012'),('4b200000-0000-4000-8000-000000000003','4b200000-0000-4000-8000-000000000013');
insert into public.phase4_policies(version,effective_from,free_seconds,no_show_seconds,go_late_cents,go_late_driver_cents,go_late_moovu_cents,xl_late_cents,xl_late_driver_cents,xl_late_moovu_cents,go_no_show_cents,go_no_show_driver_cents,go_no_show_moovu_cents,xl_no_show_cents,xl_no_show_driver_cents,xl_no_show_moovu_cents)
values('phase4b-final-assignment',clock_timestamp()-interval '2 days',180,300,2000,1300,700,3000,2000,1000,3000,2200,800,4000,3000,1000);
insert into public.trips(id,customer_id,status,ride_option,created_at)
values ('4b200000-0000-4000-8000-000000000021','4b200000-0000-4000-8000-000000000011','offered','go',clock_timestamp()-interval '5 minutes'),
('4b200000-0000-4000-8000-000000000022','4b200000-0000-4000-8000-000000000011','offered','go',clock_timestamp()-interval '5 minutes');
insert into public.driver_trip_offers(trip_id,driver_id,status,accept_deadline_at)
values ('4b200000-0000-4000-8000-000000000021','4b200000-0000-4000-8000-000000000012','pending',clock_timestamp()+interval '10 minutes'),
('4b200000-0000-4000-8000-000000000022','4b200000-0000-4000-8000-000000000013','pending',clock_timestamp()+interval '10 minutes');
commit;
