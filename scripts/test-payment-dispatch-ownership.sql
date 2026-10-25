-- Run only against a disposable local copy. All fixture rows are rolled back.
\set ON_ERROR_STOP on
begin;
set local request.jwt.claims='{"role":"service_role"}';
insert into public.phase6_policy(singleton,active) values(true,false)
  on conflict(singleton) do update set active=false;
update public.drivers set online=true,last_seen=now(),lat=-26,lng=28,
  status='approved',verification_status='approved',profile_completed=true,
  seating_capacity=4;

do $$
declare v_trip uuid; v_attempt uuid:=gen_random_uuid();
declare v_owner1 uuid:=gen_random_uuid(); v_owner2 uuid:=gen_random_uuid();
declare v_first uuid; v_second uuid; v_claim record; v_count integer;
declare v_rejected boolean:=false; v_result text;
begin
  select id into strict v_first from public.drivers order by id limit 1;
  select id into strict v_second from public.drivers where id<>v_first limit 1;
  insert into public.trips(pickup_address,dropoff_address,payment_method,status,
    customer_id,ride_type,ride_option,pickup_lat,pickup_lng,fare_amount)
  select 'Synthetic pickup','Synthetic destination','online','requested',customer_id,
    'now','go',-26,28,100 from public.trips where customer_id is not null limit 1
  returning id into v_trip;
  insert into public.online_payment_attempts(id,customer_id,trip_id,provider,amount_cents,
    currency,fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash,verified_at)
  select v_attempt,customer_id,v_trip,'FAKE_TEST',10000,'ZAR',repeat('a',64),'{}'::jsonb,
    'SUCCEEDED','ownership-probe:'||v_trip::text,repeat('b',64),now()
    from public.trips where id=v_trip;

  select * into v_claim from public.claim_online_payment_dispatch(v_attempt,v_owner1,120);
  if v_claim.outcome<>'START' then raise exception 'First owner not granted'; end if;
  select * into v_claim from public.claim_online_payment_dispatch(v_attempt,v_owner2,120);
  if v_claim.outcome<>'BUSY' then raise exception 'Second owner was not fenced'; end if;
  begin
    perform * from public.reserve_trip_offer(v_trip,v_first,1,1,1,60,1,'{}',25,25,8);
  exception when sqlstate 'P0D01' then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Claimless worker bypassed active claim'; end if;
  v_rejected:=false;

  perform * from public.reserve_paid_trip_offer(v_attempt,v_owner1,v_trip,v_first,1,1,
    1,60,1,'{}',25,25,8);
  perform * from public.reserve_paid_trip_offer(v_attempt,v_owner1,v_trip,v_second,1,2,
    2,60,1,'{}',25,25,8);
  select count(*) into v_count from public.driver_trip_offers where trip_id=v_trip;
  if v_count<>2 then raise exception 'Legitimate multi-Driver round was blocked'; end if;

  update public.online_payment_attempts set dispatch_claim_until=now()-interval '1 second'
    where id=v_attempt;
  select * into v_claim from public.claim_online_payment_dispatch(v_attempt,v_owner2,120);
  if v_claim.outcome<>'RECOVER' or v_claim.round_id is null or v_claim.offer_id is null
    or v_claim.offer_cycle<>1 then
    raise exception 'Existing offer round was not recovered';
  end if;
  begin
    perform * from public.reserve_paid_trip_offer(v_attempt,v_owner1,v_trip,v_first,1,3,
      1,60,1,'{}',25,25,8);
  exception when sqlstate 'P0D01' then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Stale owner reserved another offer'; end if;
  v_result:=public.finish_online_payment_dispatch(v_attempt,v_owner1,true);
  if v_result<>'STALE' then raise exception 'Stale owner acknowledged dispatch'; end if;
  v_result:=public.finish_online_payment_dispatch(v_attempt,v_owner2,true);
  if v_result<>'DISPATCHED' then raise exception 'Current owner could not acknowledge'; end if;
  select * into v_claim from public.claim_online_payment_dispatch(v_attempt,v_owner1,120);
  if v_claim.outcome<>'DONE' then raise exception 'Completed attempt was reclaimed'; end if;
  select count(*) into v_count from public.driver_trip_offers where trip_id=v_trip;
  if v_count<>2 then raise exception 'A competing offer was created'; end if;
  raise notice 'OWNERSHIP_BUSY_MULTI_OFFER_TAKEOVER_FENCE_AND_ACK_PASS';
end $$;

-- Free the disposable Drivers between independent scenarios.
update public.driver_trip_offers set status='expired',expired_at=now(),updated_at=now()
  where payment_dispatch_round_id is not null;

do $$
declare v_trip uuid; v_attempt uuid:=gen_random_uuid();
declare v_owner1 uuid:=gen_random_uuid(); v_owner2 uuid:=gen_random_uuid();
declare v_driver uuid; v_claim record; v_rejected boolean:=false;
begin
  select id into strict v_driver from public.drivers order by id limit 1;
  insert into public.trips(pickup_address,dropoff_address,payment_method,status,
    customer_id,ride_type,ride_option,pickup_lat,pickup_lng,fare_amount)
  select 'Synthetic pickup','Synthetic destination','online','requested',customer_id,
    'now','go',-26,28,100 from public.trips where customer_id is not null limit 1
  returning id into v_trip;
  insert into public.online_payment_attempts(id,customer_id,trip_id,provider,amount_cents,
    currency,fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash,verified_at)
  select v_attempt,customer_id,v_trip,'FAKE_TEST',10000,'ZAR',repeat('a',64),'{}'::jsonb,
    'SUCCEEDED','ownership-pre-offer:'||v_trip::text,repeat('b',64),now()
    from public.trips where id=v_trip;
  select * into v_claim from public.claim_online_payment_dispatch(v_attempt,v_owner1,120);
  if v_claim.outcome<>'START' then raise exception 'Initial claim failed'; end if;
  update public.online_payment_attempts set dispatch_claim_until=now()-interval '1 second'
    where id=v_attempt;
  select * into v_claim from public.claim_online_payment_dispatch(v_attempt,v_owner2,120);
  if v_claim.outcome<>'START' then raise exception 'Pre-offer crash did not recover'; end if;
  begin
    perform * from public.reserve_paid_trip_offer(v_attempt,v_owner1,v_trip,v_driver,1,1,
      1,60,1,'{}',25,25,8);
  exception when sqlstate 'P0D01' then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Expired owner was not fenced'; end if;
  perform * from public.reserve_paid_trip_offer(v_attempt,v_owner2,v_trip,v_driver,1,1,
    1,60,1,'{}',25,25,8);
  if (select count(*) from public.driver_trip_offers where trip_id=v_trip)<>1 then
    raise exception 'Recovered pre-offer claim made duplicate reservation';
  end if;
  raise notice 'PRE_OFFER_CRASH_TAKEOVER_PASS';
end $$;

update public.driver_trip_offers set status='expired',expired_at=now(),updated_at=now()
  where payment_dispatch_round_id is not null;

do $$
declare v_trip uuid; v_attempt uuid:=gen_random_uuid(); v_owner uuid:=gen_random_uuid();
declare v_driver uuid; v_claim record;
begin
  select id into strict v_driver from public.drivers order by id limit 1;
  insert into public.trips(pickup_address,dropoff_address,payment_method,status,
    customer_id,ride_type,ride_option,pickup_lat,pickup_lng,fare_amount)
  select 'Synthetic pickup','Synthetic destination','online','requested',customer_id,
    'now','go',-26,28,100 from public.trips where customer_id is not null limit 1
  returning id into v_trip;
  insert into public.online_payment_attempts(id,customer_id,trip_id,provider,amount_cents,
    currency,fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash,verified_at)
  select v_attempt,customer_id,v_trip,'FAKE_TEST',10000,'ZAR',repeat('a',64),'{}'::jsonb,
    'SUCCEEDED','ownership-legacy:'||v_trip::text,repeat('b',64),now()
    from public.trips where id=v_trip;
  -- The unchanged worker reached its side effect before the corrected worker
  -- acquired ownership. The corrected worker must reconcile, not add Drivers.
  perform * from public.reserve_trip_offer(v_trip,v_driver,2,1,1,60,1,'{}',25,25,8);
  select * into v_claim from public.claim_online_payment_dispatch(v_attempt,v_owner,120);
  if v_claim.outcome<>'RECOVER' or v_claim.offer_id is null or v_claim.offer_cycle<>2 then
    raise exception 'Legacy offer was not reconciled';
  end if;
  if public.finish_online_payment_dispatch(v_attempt,v_owner,true)<>'DISPATCHED' then
    raise exception 'Legacy recovery could not acknowledge';
  end if;
  if (select count(*) from public.driver_trip_offers where trip_id=v_trip)<>1 then
    raise exception 'Legacy recovery added an offer';
  end if;
  raise notice 'LEGACY_OFFER_BEFORE_CLAIM_RECOVERED_PASS';
end $$;

do $$
declare v_trip uuid; v_first uuid:=gen_random_uuid(); v_second uuid:=gen_random_uuid();
declare v_claim record;
begin
  insert into public.trips(pickup_address,dropoff_address,payment_method,status,
    customer_id,ride_type,ride_option,pickup_lat,pickup_lng,fare_amount)
  select 'Synthetic pickup','Synthetic destination','online','requested',customer_id,
    'now','go',-26,28,100 from public.trips where customer_id is not null limit 1
  returning id into v_trip;
  insert into public.online_payment_attempts(id,customer_id,trip_id,provider,amount_cents,
    currency,fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash,verified_at)
  select v_first,customer_id,v_trip,'FAKE_TEST',10000,'ZAR',repeat('a',64),'{}'::jsonb,
    'SUCCEEDED','authority-first:'||v_trip::text,repeat('b',64),now()-interval '1 minute'
    from public.trips where id=v_trip;
  insert into public.online_payment_attempts(id,customer_id,trip_id,provider,amount_cents,
    currency,fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash,verified_at)
  select v_second,customer_id,v_trip,'FAKE_TEST',10000,'ZAR',repeat('c',64),'{}'::jsonb,
    'SUCCEEDED','authority-second:'||v_trip::text,repeat('d',64),now()
    from public.trips where id=v_trip;
  select * into v_claim from public.claim_online_payment_dispatch(v_second,gen_random_uuid(),120);
  if v_claim.outcome<>'NOT_AUTHORITY' then raise exception 'Second success claimed same booking'; end if;
  select * into v_claim from public.claim_online_payment_dispatch(v_first,gen_random_uuid(),120);
  if v_claim.outcome<>'START' then raise exception 'Canonical success could not claim booking'; end if;
  raise notice 'ONE_AUTHORITY_PER_BOOKING_PASS';
end $$;
rollback;
