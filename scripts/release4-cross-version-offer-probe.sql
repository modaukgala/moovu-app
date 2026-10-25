-- Local disposable PostgreSQL only; verifies the unchanged shared offer contract.
\set ON_ERROR_STOP on
begin;
set local request.jwt.claims='{"role":"service_role"}';
set local statement_timeout='10s';
-- Production Phase 6 remains OFF; keep this disposable fixture aligned for the probe.
insert into public.phase6_policy(singleton,active) values(true,false)
on conflict(singleton) do update set active=false;
update public.drivers set online=true,last_seen=now(),lat=-26,lng=28,
  status='approved',verification_status='approved',profile_completed=true,
  seating_capacity=4;
do $$
declare v_trip uuid; v_first uuid; v_second uuid; v_offer_count integer; v_rejected boolean:=false;
begin
  select id into strict v_first from public.drivers order by id limit 1;
  select id into strict v_second from public.drivers where id<>v_first limit 1;
  insert into public.trips(pickup_address,dropoff_address,payment_method,status,
    customer_id,ride_type,ride_option,pickup_lat,pickup_lng,fare_amount)
  select 'Synthetic pickup','Synthetic destination','online','requested',customer_id,
    'now','go',-26,28,100 from public.trips where customer_id is not null limit 1
  returning id into v_trip;
  insert into public.online_payment_attempts(customer_id,trip_id,provider,amount_cents,
    currency,fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash,verified_at)
  select customer_id,v_trip,'FAKE_TEST',10000,'ZAR',repeat('a',64),'{}'::jsonb,
    'SUCCEEDED','cross-version-probe:'||v_trip::text,repeat('b',64),now()
    from public.trips where id=v_trip;
  perform * from public.reserve_trip_offer(v_trip,v_first,1,1,1,60,1,'{}',25,25,8);
  -- A worker can stop here before acknowledging the payment attempt. A retry
  -- reuses the same shared function with the still-pending attempt.
  begin
    perform * from public.reserve_trip_offer(v_trip,v_first,1,1,1,60,1,'{}',25,25,8);
  exception when sqlstate 'P0001' then
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Expected same-Driver reservation rejection'; end if;
  perform * from public.reserve_trip_offer(v_trip,v_second,1,2,2,60,1,'{}',25,25,8);
  select count(*) into v_offer_count from public.driver_trip_offers where trip_id=v_trip;
  if v_offer_count<>2 then raise exception 'Expected two distinct Driver offers'; end if;
  if (select dispatch_state from public.online_payment_attempts where trip_id=v_trip)<>'PENDING' then
    raise exception 'Expected unacknowledged payment dispatch';
  end if;
  raise notice 'SAME_DRIVER_DEDUPED_BUT_SECOND_DRIVER_OFFERED_BEFORE_ACK';
end $$;
rollback;
