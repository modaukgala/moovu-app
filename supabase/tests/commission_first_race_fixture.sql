-- Run after the synthetic fixture in the same session, on a disposable target.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('fin04.test.scenario', :'scenario', true);
alter table fin04_fixture add column competitor_id uuid, add column competitor_driver uuid;
do $$
declare f fin04_fixture%rowtype;
        competitor uuid := gen_random_uuid();
        other_driver uuid := gen_random_uuid();
        scenario text := current_setting('fin04.test.scenario');
        completed timestamptz;
begin
  select * into strict f from fin04_fixture;
  select completed_at into strict completed from public.trips where id=f.trip_id;
  if scenario='same-driver' then
    perform pg_temp.fin04_trip(competitor,'go',completed+interval '1 microsecond',690);
  elsif scenario='different-driver' then
    insert into public.drivers(id,first_name,status) values(other_driver,'FIN04 Synthetic B','approved');
    insert into public.driver_wallets(driver_id,balance_due) values(other_driver,6.90);
    update fin04_fixture set driver_id=other_driver;
    perform pg_temp.fin04_trip(competitor,'go',clock_timestamp(),690);
    update fin04_fixture set driver_id=f.driver_id;
  elsif scenario='combined' then
    insert into public.driver_payment_requests(id,driver_id,payment_type,subscription_plan,amount_submitted,status,note)
      values(competitor,f.driver_id,'combined','day',55,'pending_payment_review','FIN04 synthetic combined proof');
  elsif scenario in ('accrual','cancellation') then
    insert into public.trips(id,customer_id,driver_id,ride_option,status,payment_method,
      fare_amount,original_fare,final_fare,created_at,start_otp_verified,trip_started_at)
    values(competitor,f.customer_id,f.driver_id,'go',case when scenario='accrual' then 'ongoing' else 'assigned' end,
      'cash',100,100,100,now()-interval '1 hour',true,now()-interval '30 minutes');
  else
    raise exception 'Unknown FIN04 race scenario %',scenario;
  end if;
  update fin04_fixture set competitor_id=competitor,
    competitor_driver=case when scenario='different-driver' then other_driver else f.driver_id end;
end $$;
commit;
select actor_id, support_id, customer_id, driver_id, trip_id, competitor_id, competitor_driver from fin04_fixture;
