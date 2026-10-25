-- Disposable local database only. All synthetic state is rolled back.
\set ON_ERROR_STOP on
begin;
set local request.jwt.claims = '{"role":"service_role"}';

do $$
declare
  v_attempt uuid;
  v_state text;
  v_trip uuid;
  v_event uuid;
  v_job uuid;
  v_claimed integer;
  v_tx_before integer;
  v_tx_after integer;
  v_result jsonb;
begin
  select id into strict v_attempt from public.online_payment_attempts limit 1;
  update public.online_payment_attempts
    set state='SUCCEEDED', dispatch_state='PENDING', dispatch_attempts=0
    where id=v_attempt;
  -- Old/new workers have both read PENDING. The first finishes successfully;
  -- the second reports a stale failure using the current route's unconditional update.
  update public.online_payment_attempts set dispatch_state='DISPATCHED', dispatch_attempts=1
    where id=v_attempt;
  update public.online_payment_attempts set dispatch_state='FAILED', dispatch_attempts=1
    where id=v_attempt;
  select dispatch_state into v_state from public.online_payment_attempts where id=v_attempt;
  if v_state <> 'FAILED' then raise exception 'Expected stale worker state regression'; end if;
  raise notice 'PAYMENT_STALE_FAILURE_OVERWRITE_REPRODUCED';

  insert into public.trips(pickup_address,dropoff_address,payment_method,status,
    driver_id,ride_type,ride_option,fare_amount,final_fare,commission_amount)
  select 'Synthetic pickup','Synthetic destination','cash','completed',d.id,
    'now','go',100,100,15
  from public.drivers d cross join public.phase2_finance_policy p
  where p.policy_key='phase2-driver-finance' limit 1 returning id into v_trip;
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id)
    values('trip-complete:'||v_trip::text,'trip_completed','TRIP',v_trip)
    returning id into v_event;
  select count(*) into v_tx_before from public.financial_transactions
    where idempotency_key='trip_commission:'||v_trip::text;
  insert into public.phase2_shadow_recovery_jobs(operation_key,trip_id,business_event_id,status)
    values('trip_commission:'||v_trip::text,v_trip,v_event,'pending') returning id into v_job;
  select count(*) into v_claimed from public.phase2_claim_shadow_recovery_jobs(20) where id=v_job;
  if v_claimed<>1 then raise exception 'First shadow claim did not select job'; end if;
  v_result:=public.phase2_post_trip_commission(v_trip,null);
  select count(*) into v_claimed from public.phase2_claim_shadow_recovery_jobs(20) where id=v_job;
  if v_claimed<>0 then raise exception 'Duplicate shadow claim selected job'; end if;
  update public.phase2_shadow_recovery_jobs set locked_at=now()-interval '6 minutes' where id=v_job;
  select count(*) into v_claimed from public.phase2_claim_shadow_recovery_jobs(20) where id=v_job;
  if v_claimed<>1 then raise exception 'Stale shadow job was not reclaimed'; end if;
  v_result:=public.phase2_post_trip_commission(v_trip,null);
  v_result:=public.phase2_finish_shadow_recovery_job(v_job,true,false,null,null);
  if (select attempts from public.phase2_shadow_recovery_jobs where id=v_job)<>2 then
    raise exception 'Shadow claim attempt bound incorrect';
  end if;
  select count(*) into v_tx_after from public.financial_transactions
    where idempotency_key='trip_commission:'||v_trip::text;
  if v_tx_before<>0 or v_tx_after<>1 then raise exception 'Commission posting duplicated'; end if;
  if (select status from public.phase2_shadow_recovery_jobs where id=v_job)<>'succeeded' then
    raise exception 'Shadow job did not complete';
  end if;
  raise notice 'SHADOW_CLAIM_DUPLICATE_STALE_AND_LEDGER_REPLAY_PASS';
end $$;
rollback;
