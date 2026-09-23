-- Disposable project tangtlmdpnvmoviwrgvd only. Committed isolated race fixture.
begin;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into auth.users(id) values
  ('4c400000-0000-4000-8000-000000000001'),
  ('4c400000-0000-4000-8000-000000000002');
insert into public.profiles(id,role) values
  ('4c400000-0000-4000-8000-000000000001','customer'),
  ('4c400000-0000-4000-8000-000000000002','driver');
insert into public.customers(id,auth_user_id) values
  ('4c400000-0000-4000-8000-000000000011','4c400000-0000-4000-8000-000000000001');
insert into public.drivers(id,busy) values('4c400000-0000-4000-8000-000000000012',true);
insert into public.driver_accounts(user_id,driver_id) values
  ('4c400000-0000-4000-8000-000000000002','4c400000-0000-4000-8000-000000000012');
insert into public.trips(id,customer_id,driver_id,status,ride_option,created_at) values
  ('4c400000-0000-4000-8000-000000000021','4c400000-0000-4000-8000-000000000011',
    '4c400000-0000-4000-8000-000000000012','assigned','go',clock_timestamp()-interval '5 minutes');
do $$
declare q jsonb;
begin
  q:=public.phase4b_quote_customer_cancellation(
    '4c400000-0000-4000-8000-000000000021',
    '4c400000-0000-4000-8000-000000000011',
    '4c400000-0000-4000-8000-000000000001');
  perform public.phase4b_cancel_customer_trip(
    '4c400000-0000-4000-8000-000000000021',
    '4c400000-0000-4000-8000-000000000011',
    '4c400000-0000-4000-8000-000000000001',
    (q->>'quote_id')::uuid,'Disposable concurrency fixture',null);
end $$;
insert into public.trips(id,customer_id,status,ride_option,created_at) values
  ('4c400000-0000-4000-8000-000000000022','4c400000-0000-4000-8000-000000000011',
    'requested','go',clock_timestamp()),
  ('4c400000-0000-4000-8000-000000000023','4c400000-0000-4000-8000-000000000011',
    'requested','go',clock_timestamp());
update public.trips set status='completed',completed_at=clock_timestamp()
  where id='4c400000-0000-4000-8000-000000000022';
commit;
