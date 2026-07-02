-- MOOVU dispatch RPC hotfix (REVIEW ONLY)
-- Purpose: fixes Postgres error `column reference "driver_id" is ambiguous`
-- in the atomic dispatch functions by qualifying all internal table columns.
--
-- Run this in Supabase SQL Editor after reviewing. It is non-destructive:
-- it only replaces dispatch RPC function bodies and grants service_role execute.
-- Re-run this updated version to allow drivers who deliberately remain online
-- to receive background offers for up to 8 hours after their last heartbeat.

create or replace function public.reserve_trip_offer(
  p_trip_id uuid,
  p_driver_id uuid,
  p_dispatch_cycle integer,
  p_sequence_number integer,
  p_distance_km numeric,
  p_road_eta_seconds integer,
  p_dispatch_score numeric,
  p_score_breakdown jsonb,
  p_escalation_seconds integer default 10,
  p_accept_window_seconds integer default 30,
  p_search_radius_km numeric default 8
)
returns table(offer_id uuid, driver_id uuid, accept_deadline_at timestamptz, escalates_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.trips%rowtype;
  v_driver public.drivers%rowtype;
  v_offer_id uuid;
  v_deadline timestamptz := now() + make_interval(secs => greatest(1, p_accept_window_seconds));
  v_escalates timestamptz := now() + make_interval(secs => greatest(1, p_escalation_seconds));
  v_balance numeric := 0;
  v_required_seats integer := 3;
begin
  select * into v_trip from public.trips t where t.id = p_trip_id for update;
  if not found then raise exception 'Trip not found' using errcode = 'P0002'; end if;
  if v_trip.status not in ('requested','offered') or (v_trip.driver_id is not null and v_trip.status <> 'offered') then
    raise exception 'Trip is no longer dispatchable' using errcode = 'P0001';
  end if;

  update public.driver_trip_offers o
  set status = 'expired', expired_at = coalesce(o.expired_at, now()), updated_at = now()
  where o.status in ('pending','shown')
    and (o.accept_deadline_at is null or o.accept_deadline_at <= now());

  select * into v_driver from public.drivers d where d.id = p_driver_id for update;
  if not found then raise exception 'Driver not found' using errcode = 'P0002'; end if;
  if coalesce(v_driver.is_deleted, false)
     or v_driver.status not in ('approved','active')
     or (v_driver.verification_status is not null and v_driver.verification_status <> 'approved')
     or coalesce(v_driver.profile_completed, true) = false
     or not coalesce(v_driver.online, false)
     or v_driver.lat is null or v_driver.lng is null
     or v_driver.last_seen < now() - interval '8 hours'
     or v_driver.subscription_status not in ('active','grace')
     or v_driver.subscription_expires_at is null
     or v_driver.subscription_expires_at <= now() then
    raise exception 'Driver is not eligible' using errcode = 'P0001';
  end if;

  v_required_seats := case
    when lower(coalesce(v_trip.ride_option, 'go')) in ('group','xl','go_xl') then 6
    else 3
  end;
  if coalesce(v_driver.seating_capacity, 0) < v_required_seats then
    raise exception 'Driver vehicle is incompatible' using errcode = 'P0001';
  end if;

  select coalesce(w.balance_due, 0) into v_balance
  from public.driver_wallets w
  where w.driver_id = p_driver_id;
  if coalesce(v_balance, 0) >= 100 then
    raise exception 'Driver commission balance is locked' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.trips t
    where t.driver_id = p_driver_id
      and t.status in ('assigned','arrived','ongoing')
      and t.id <> p_trip_id
  ) then
    raise exception 'Driver already has an active trip' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.driver_trip_offers o
    where o.trip_id = p_trip_id
      and o.driver_id = p_driver_id
      and o.status = 'declined'
  ) then
    raise exception 'Driver already declined this trip' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.driver_trip_offers o
    where o.driver_id = p_driver_id
      and o.status in ('pending','shown')
      and o.accept_deadline_at > now()
  ) then
    raise exception 'Driver has another active reservation' using errcode = 'P0001';
  end if;

  insert into public.driver_trip_offers(
    trip_id, driver_id, dispatch_cycle, sequence_number, status, offered_at,
    visible_until, escalates_at, accept_deadline_at, distance_km, road_eta_seconds,
    dispatch_score, dispatch_score_breakdown, search_radius_km
  ) values (
    p_trip_id, p_driver_id, greatest(1,p_dispatch_cycle), greatest(1,p_sequence_number), 'shown', now(),
    v_escalates, v_escalates, v_deadline, p_distance_km, p_road_eta_seconds,
    p_dispatch_score, coalesce(p_score_breakdown,'{}'::jsonb), p_search_radius_km
  ) returning id into v_offer_id;

  update public.trips t set
    status = 'offered',
    offer_status = 'pending',
    offer_expires_at = greatest(coalesce(t.offer_expires_at, v_deadline), v_deadline),
    dispatch_started_at = coalesce(t.dispatch_started_at, now()),
    dispatch_cycle = greatest(1,p_dispatch_cycle),
    dispatch_sequence = greatest(1,p_sequence_number),
    dispatch_state = 'searching',
    dispatch_search_radius_km = p_search_radius_km,
    dispatch_failure_reason = null,
    dispatch_updated_at = now()
  where t.id = p_trip_id;

  insert into public.trip_events(trip_id,event_type,message,old_status,new_status)
  values (p_trip_id,'offer_created',format('Cycle %s sequence %s reserved driver %s',p_dispatch_cycle,p_sequence_number,p_driver_id),v_trip.status,'offered');

  return query select v_offer_id as offer_id, p_driver_id as driver_id, v_deadline as accept_deadline_at, v_escalates as escalates_at;
end;
$$;

create or replace function public.accept_trip_offer(p_trip_id uuid, p_driver_id uuid, p_source text default 'driver_app')
returns table(ok boolean, trip_id uuid, driver_id uuid, status text, dispatch_cycle integer,
              sequence_number integer, cancelled_driver_ids uuid[], error_code text, error_message text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.trips%rowtype;
  v_driver public.drivers%rowtype;
  v_offer public.driver_trip_offers%rowtype;
  v_cancelled uuid[] := '{}';
begin
  select * into v_driver from public.drivers d where d.id = p_driver_id for update;
  select * into v_trip from public.trips t where t.id = p_trip_id for update;
  select * into v_offer from public.driver_trip_offers o
  where o.trip_id = p_trip_id
    and o.driver_id = p_driver_id
    and o.status in ('pending','shown')
  order by o.offered_at desc
  limit 1
  for update;

  if v_offer.id is null or v_offer.accept_deadline_at <= now() then
    return query select false,p_trip_id,p_driver_id,'expired',0,0,'{}'::uuid[],'OFFER_CONFLICT','Offer expired or unavailable';
    return;
  end if;
  if v_trip.driver_id is not null or v_trip.status not in ('requested','offered') then
    return query select false,p_trip_id,p_driver_id,v_trip.status,v_offer.dispatch_cycle,v_offer.sequence_number,'{}'::uuid[],'OFFER_CONFLICT','Another driver already accepted';
    return;
  end if;
  if not coalesce(v_driver.online,false) or v_driver.status not in ('approved','active') then
    return query select false,p_trip_id,p_driver_id,'ineligible',v_offer.dispatch_cycle,v_offer.sequence_number,'{}'::uuid[],'DRIVER_CONFLICT','Driver is no longer eligible';
    return;
  end if;
  if exists(
    select 1 from public.trips t
    where t.driver_id = p_driver_id
      and t.status in ('assigned','arrived','ongoing')
      and t.id <> p_trip_id
  ) then
    return query select false,p_trip_id,p_driver_id,'busy',v_offer.dispatch_cycle,v_offer.sequence_number,'{}'::uuid[],'DRIVER_CONFLICT','Driver already has an active trip';
    return;
  end if;

  select coalesce(array_agg(o.driver_id),'{}'::uuid[]) into v_cancelled
  from public.driver_trip_offers o
  where o.trip_id = p_trip_id
    and o.driver_id <> p_driver_id
    and o.status in ('pending','shown');

  update public.driver_trip_offers o
  set status='accepted',responded_at=now(),response_source=p_source,updated_at=now()
  where o.id = v_offer.id;

  update public.driver_trip_offers o
  set status='cancelled',cancelled_at=now(),responded_at=now(),updated_at=now()
  where o.trip_id = p_trip_id
    and o.driver_id <> p_driver_id
    and o.status in ('pending','shown');

  update public.trips t
  set driver_id=p_driver_id,status='assigned',offer_status='accepted',offer_expires_at=null,
      dispatch_state='accepted',dispatch_updated_at=now()
  where t.id = p_trip_id;

  update public.drivers d set busy=true where d.id = p_driver_id;
  update public.dispatch_jobs j set status='cancelled',updated_at=now()
  where j.trip_id = p_trip_id and j.status in ('pending','processing');

  insert into public.trip_events(trip_id,event_type,message,old_status,new_status)
  values(p_trip_id,'offer_accepted',format('Driver %s accepted via %s',p_driver_id,p_source),v_trip.status,'assigned');

  return query select true,p_trip_id,p_driver_id,'assigned',v_offer.dispatch_cycle,v_offer.sequence_number,v_cancelled,null::text,null::text;
end;
$$;

create or replace function public.decline_trip_offer(p_trip_id uuid, p_driver_id uuid, p_source text default 'driver_app')
returns table(ok boolean, trip_id uuid, driver_id uuid, status text, dispatch_cycle integer,
              sequence_number integer, cancelled_driver_ids uuid[], error_code text, error_message text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer public.driver_trip_offers%rowtype;
begin
  select * into v_offer from public.driver_trip_offers o
  where o.trip_id = p_trip_id
    and o.driver_id = p_driver_id
    and o.status in ('pending','shown')
  order by o.offered_at desc
  limit 1
  for update;

  if v_offer.id is null then
    return query select false,p_trip_id,p_driver_id,'unavailable',0,0,'{}'::uuid[],'OFFER_CONFLICT','Offer no longer available';
    return;
  end if;

  update public.driver_trip_offers o
  set status='declined',
      responded_at=now(),
      decline_reason='driver_declined',
      response_source=p_source,
      updated_at=now()
  where o.id = v_offer.id;

  insert into public.trip_events(trip_id,event_type,message,old_status,new_status)
  values(p_trip_id,'offer_declined',format('Driver %s declined via %s',p_driver_id,p_source),'offered','offered');

  return query select true,p_trip_id,p_driver_id,'declined',v_offer.dispatch_cycle,v_offer.sequence_number,'{}'::uuid[],null::text,null::text;
end;
$$;

create or replace function public.expire_due_trip_offers(p_trip_id uuid default null)
returns table(expired_offer_id uuid, trip_id uuid, driver_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select o.id
    from public.driver_trip_offers o
    where o.status in ('pending','shown')
      and o.accept_deadline_at <= now()
      and (p_trip_id is null or o.trip_id = p_trip_id)
    for update skip locked
  ), changed as (
    update public.driver_trip_offers o
    set status='expired',expired_at=now(),responded_at=now(),updated_at=now()
    from due
    where o.id = due.id
    returning o.id,o.trip_id,o.driver_id
  )
  select changed.id as expired_offer_id, changed.trip_id, changed.driver_id
  from changed;
end;
$$;

revoke all on function public.reserve_trip_offer(uuid,uuid,integer,integer,numeric,integer,numeric,jsonb,integer,integer,numeric) from public, anon, authenticated;
revoke all on function public.accept_trip_offer(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.decline_trip_offer(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.expire_due_trip_offers(uuid) from public, anon, authenticated;

grant execute on function public.reserve_trip_offer(uuid,uuid,integer,integer,numeric,integer,numeric,jsonb,integer,integer,numeric) to service_role;
grant execute on function public.accept_trip_offer(uuid,uuid,text) to service_role;
grant execute on function public.decline_trip_offer(uuid,uuid,text) to service_role;
grant execute on function public.expire_due_trip_offers(uuid) to service_role;
