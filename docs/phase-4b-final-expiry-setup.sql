-- Disposable tangtlmdpnvmoviwrgvd only. Committed fixtures for expiry/cancel overlap.
begin;
insert into auth.users(id) values('4b300000-0000-4000-8000-000000000001');
insert into public.profiles(id,role) values('4b300000-0000-4000-8000-000000000001','customer');
insert into public.customers(id,auth_user_id) values('4b300000-0000-4000-8000-000000000011','4b300000-0000-4000-8000-000000000001');
insert into public.phase4_policies(version,effective_from,free_seconds,no_show_seconds,
go_late_cents,go_late_driver_cents,go_late_moovu_cents,xl_late_cents,xl_late_driver_cents,xl_late_moovu_cents,
go_no_show_cents,go_no_show_driver_cents,go_no_show_moovu_cents,xl_no_show_cents,xl_no_show_driver_cents,xl_no_show_moovu_cents)
values('phase4b-final-expiry-races',clock_timestamp()-interval '2 days',180,300,
2000,1300,700,3000,2000,1000,3000,2200,800,4000,3000,1000);
insert into public.trips(id,customer_id,status,ride_option,created_at) values
('4b300000-0000-4000-8000-000000000021','4b300000-0000-4000-8000-000000000011','offered','go',clock_timestamp()-interval '31 minutes'),
('4b300000-0000-4000-8000-000000000022','4b300000-0000-4000-8000-000000000011','offered','go',clock_timestamp()-interval '31 minutes');
commit;
