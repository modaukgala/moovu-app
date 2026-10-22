-- Initial paid-booking dispatch only. Apply after the terminal-state guard.
do $$
begin
  if not exists(select 1 from pg_trigger
    where tgrelid='public.online_payment_attempts'::regclass
      and tgname='online_payment_dispatch_terminal_guard' and not tgisinternal) then
    raise exception 'Payment dispatch terminal guard must be installed first';
  end if;
  if to_regclass('public.driver_trip_offers') is null
    or to_regprocedure('public.reserve_trip_offer(uuid,uuid,integer,integer,numeric,integer,numeric,jsonb,integer,integer,numeric)') is null then
    raise exception 'Atomic offer reservation contract is missing';
  end if;
end $$;
alter table public.online_payment_attempts
  add column dispatch_claim_token uuid,
  add column dispatch_claim_until timestamptz,
  add column dispatch_round_id uuid,
  add column dispatch_round_started_by uuid;

alter table public.driver_trip_offers
  add column payment_dispatch_round_id uuid;
create index driver_trip_offers_payment_dispatch_round_idx
  on public.driver_trip_offers(payment_dispatch_round_id)
  where payment_dispatch_round_id is not null;

create function public.claim_online_payment_dispatch(
  p_attempt_id uuid, p_token uuid, p_lease_seconds integer default 120)
returns table(outcome text, trip_id uuid, round_id uuid, offer_id uuid, accept_deadline_at timestamptz, offer_cycle integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_attempt public.online_payment_attempts%rowtype;
declare v_ride_type text;
declare v_trip_id uuid; v_authority uuid;
begin
  if p_token is null or p_lease_seconds<30 or p_lease_seconds>300 then
    raise exception 'Invalid dispatch claim' using errcode='22023';
  end if;
  select a.trip_id into v_trip_id from public.online_payment_attempts a where a.id=p_attempt_id;
  if v_trip_id is null then
    return query select 'NOT_READY'::text,null::uuid,null::uuid,null::uuid,null::timestamptz,null::integer;
    return;
  end if;
  -- Match the offer reservation's trip-before-attempt lock order and serialize
  -- distinct successful payment attempts attached to one booking.
  perform 1 from public.trips t where t.id=v_trip_id for update;
  select * into v_attempt from public.online_payment_attempts a where a.id=p_attempt_id for update;
  if not found or v_attempt.state<>'SUCCEEDED' then
    return query select 'NOT_READY'::text,null::uuid,null::uuid,null::uuid,null::timestamptz,null::integer;
    return;
  end if;
  select a.id into v_authority from public.online_payment_attempts a
    where a.trip_id=v_trip_id and a.state='SUCCEEDED'
    order by a.verified_at,a.id limit 1;
  if v_authority is distinct from p_attempt_id then
    return query select 'NOT_AUTHORITY'::text,v_trip_id,null::uuid,null::uuid,null::timestamptz,null::integer;
    return;
  end if;
  if v_attempt.dispatch_state='DISPATCHED' then
    return query select 'DONE'::text,v_attempt.trip_id,v_attempt.dispatch_round_id,null::uuid,null::timestamptz,null::integer;
    return;
  end if;
  select t.ride_type into v_ride_type from public.trips t where t.id=v_attempt.trip_id;
  if v_ride_type is distinct from 'now' then
    update public.online_payment_attempts a set dispatch_state='DEFERRED',updated_at=clock_timestamp()
      where a.id=p_attempt_id and a.dispatch_state<>'DEFERRED';
    return query select 'DEFERRED'::text,v_attempt.trip_id,null::uuid,null::uuid,null::timestamptz,null::integer;
    return;
  end if;
  if v_attempt.dispatch_claim_until>clock_timestamp() then
    return query select 'BUSY'::text,v_attempt.trip_id,v_attempt.dispatch_round_id,null::uuid,null::timestamptz,null::integer;
    return;
  end if;
  update public.online_payment_attempts a set
    dispatch_claim_token=p_token,
    dispatch_claim_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    dispatch_round_id=coalesce(a.dispatch_round_id,gen_random_uuid()),
    dispatch_attempts=a.dispatch_attempts+1,
    updated_at=clock_timestamp()
  where a.id=p_attempt_id
  returning a.dispatch_round_id into v_attempt.dispatch_round_id;
  select o.id,o.accept_deadline_at,o.dispatch_cycle into offer_id,accept_deadline_at,offer_cycle
    from public.driver_trip_offers o
    where o.trip_id=v_attempt.trip_id
      and (o.payment_dispatch_round_id=v_attempt.dispatch_round_id
        or o.payment_dispatch_round_id is null)
    order by o.accept_deadline_at desc,o.id limit 1;
  outcome:=case when offer_id is null then 'START' else 'RECOVER' end;
  trip_id:=v_attempt.trip_id;
  round_id:=v_attempt.dispatch_round_id;
  return next;
end $$;

create function public.reserve_paid_trip_offer(
  p_attempt_id uuid, p_claim_token uuid,
  p_trip_id uuid, p_driver_id uuid, p_dispatch_cycle integer, p_sequence_number integer,
  p_distance_km numeric, p_road_eta_seconds integer, p_dispatch_score numeric,
  p_score_breakdown jsonb, p_escalation_seconds integer, p_accept_window_seconds integer,
  p_search_radius_km numeric)
returns table(offer_id uuid, driver_id uuid, accept_deadline_at timestamptz, escalates_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_attempt public.online_payment_attempts%rowtype;
declare v_offer record;
begin
  -- Match reserve_trip_offer's trip-before-attempt lock order. A legacy worker
  -- may already hold the trip row while its insert trigger waits on the attempt.
  perform 1 from public.trips t where t.id=p_trip_id for update;
  select * into v_attempt from public.online_payment_attempts a where a.id=p_attempt_id for update;
  if not found or v_attempt.trip_id<>p_trip_id or v_attempt.state<>'SUCCEEDED'
    or v_attempt.dispatch_state='DISPATCHED' or v_attempt.dispatch_claim_token is distinct from p_claim_token
    or v_attempt.dispatch_claim_until<=clock_timestamp() or v_attempt.dispatch_round_id is null then
    raise exception 'Payment dispatch ownership lost' using errcode='P0D01';
  end if;
  if v_attempt.dispatch_round_started_by is not null
    and v_attempt.dispatch_round_started_by is distinct from p_claim_token then
    raise exception 'Payment dispatch round already started' using errcode='P0D01';
  end if;
  -- The first reservation starts the authorized round. Later reservations by
  -- this same owner are allowed; a takeover always reconciles, never extends it.
  perform set_config('moovu.payment_dispatch_claim_token',p_claim_token::text,true);
  for v_offer in select * from public.reserve_trip_offer(
    p_trip_id,p_driver_id,p_dispatch_cycle,p_sequence_number,p_distance_km,
    p_road_eta_seconds,p_dispatch_score,p_score_breakdown,p_escalation_seconds,
    p_accept_window_seconds,p_search_radius_km) loop
    update public.driver_trip_offers o set payment_dispatch_round_id=v_attempt.dispatch_round_id
      where o.id=v_offer.offer_id;
    update public.online_payment_attempts a set
      dispatch_claim_until=clock_timestamp()+interval '120 seconds',
      dispatch_round_started_by=coalesce(a.dispatch_round_started_by,p_claim_token)
      where a.id=p_attempt_id;
    return query select v_offer.offer_id,v_offer.driver_id,v_offer.accept_deadline_at,v_offer.escalates_at;
  end loop;
end $$;

create function public.fence_claimed_paid_offer()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid; v_until timestamptz; v_session_token uuid;
begin
  if new.dispatch_cycle<>1 then return new; end if;
  -- Lock the attempt even when no owner is visible yet. This serializes an
  -- unchanged worker's insert with an in-flight claim transaction.
  select a.dispatch_claim_token,a.dispatch_claim_until into v_owner,v_until
    from public.online_payment_attempts a
    where a.trip_id=new.trip_id and a.state='SUCCEEDED'
    order by a.verified_at desc,a.id desc limit 1 for update;
  if v_owner is null or v_until<=clock_timestamp() then return new; end if;
  v_session_token:=nullif(current_setting('moovu.payment_dispatch_claim_token',true),'')::uuid;
  if v_session_token is distinct from v_owner then
    raise exception 'Claimed paid offer requires current owner' using errcode='P0D01';
  end if;
  return new;
end $$;
create trigger fence_claimed_paid_offer
before insert on public.driver_trip_offers
for each row execute function public.fence_claimed_paid_offer();

create function public.finish_online_payment_dispatch(
  p_attempt_id uuid,p_claim_token uuid,p_success boolean,p_error text default null)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_attempt public.online_payment_attempts%rowtype;
declare v_has_offers boolean;
declare v_state text;
begin
  select * into v_attempt from public.online_payment_attempts a where a.id=p_attempt_id for update;
  if not found or v_attempt.dispatch_claim_token is distinct from p_claim_token
    or v_attempt.dispatch_claim_until<=clock_timestamp() then
    return 'STALE';
  end if;
  select exists(select 1 from public.driver_trip_offers o
    where o.payment_dispatch_round_id=v_attempt.dispatch_round_id) into v_has_offers;
  v_state:=case when p_success or v_has_offers then 'DISPATCHED' else 'FAILED' end;
  update public.online_payment_attempts a set
    dispatch_state=v_state,
    dispatch_last_error=case when v_state='FAILED' then left(coalesce(p_error,'Dispatch failed'),500) else null end,
    dispatched_at=case when v_state='DISPATCHED' then clock_timestamp() else a.dispatched_at end,
    dispatch_claim_token=null,dispatch_claim_until=null,updated_at=clock_timestamp()
  where a.id=p_attempt_id;
  return v_state;
end $$;

revoke all on function public.claim_online_payment_dispatch(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.reserve_paid_trip_offer(uuid,uuid,uuid,uuid,integer,integer,numeric,integer,numeric,jsonb,integer,integer,numeric) from public,anon,authenticated;
revoke all on function public.finish_online_payment_dispatch(uuid,uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.fence_claimed_paid_offer() from public,anon,authenticated;
grant execute on function public.claim_online_payment_dispatch(uuid,uuid,integer) to service_role;
grant execute on function public.reserve_paid_trip_offer(uuid,uuid,uuid,uuid,integer,integer,numeric,integer,numeric,jsonb,integer,integer,numeric) to service_role;
grant execute on function public.finish_online_payment_dispatch(uuid,uuid,boolean,text) to service_role;
