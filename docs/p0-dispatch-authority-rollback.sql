-- Approval required: restoring this function reinstates the subscription outage.
begin;
do $guard$
begin
  if md5(replace(pg_get_functiondef('public.reserve_trip_offer(uuid,uuid,integer,integer,numeric,integer,numeric,jsonb,integer,integer,numeric)'::regprocedure),chr(13),''))<>'ee6b010e2923ba3d39d2c90eb76ab337' then
    raise exception 'P0 rollback: expected repaired function required';
  end if;
end $guard$;
CREATE OR REPLACE FUNCTION public.reserve_trip_offer(p_trip_id uuid, p_driver_id uuid, p_dispatch_cycle integer, p_sequence_number integer, p_distance_km numeric, p_road_eta_seconds integer, p_dispatch_score numeric, p_score_breakdown jsonb, p_escalation_seconds integer DEFAULT 10, p_accept_window_seconds integer DEFAULT 30, p_search_radius_km numeric DEFAULT 8)
 RETURNS TABLE(offer_id uuid, driver_id uuid, accept_deadline_at timestamp with time zone, escalates_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$

;
commit;
