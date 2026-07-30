-- REVIEW ONLY. Apply after docs/atomic-dispatch-migration.sql is already installed.
-- Tightens MOOVU Go Plus reservation eligibility to an approved 7-seat vehicle.

begin;

create or replace function public.reserve_trip_offer(
  p_trip_id uuid,
  p_driver_id uuid,
  p_dispatch_cycle integer,
  p_sequence_number integer,
  p_distance_km numeric,
  p_road_eta_seconds integer,
  p_dispatch_score numeric,
  p_score_breakdown jsonb,
  p_escalation_seconds integer default 25,
  p_accept_window_seconds integer default 25,
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
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then raise exception 'Trip not found' using errcode = 'P0002'; end if;
  if v_trip.status not in ('requested','offered') or (v_trip.driver_id is not null and v_trip.status <> 'offered') then
    raise exception 'Trip is no longer dispatchable' using errcode = 'P0001';
  end if;

  update public.driver_trip_offers o
  set status = 'expired', expired_at = coalesce(o.expired_at, now()), updated_at = now()
  where o.status in ('pending','shown')
    and (o.accept_deadline_at is null or o.accept_deadline_at <= now());

  select * into v_driver from public.drivers where id = p_driver_id for update;
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

  if lower(coalesce(v_trip.ride_option, 'go')) = 'group'
     and coalesce(v_driver.seating_capacity, 0) <> 7 then
    raise exception 'Driver vehicle is incompatible' using errcode = 'P0001';
  end if;

  select coalesce(w.balance_due, 0) into v_balance
  from public.driver_wallets w where w.driver_id = p_driver_id;
  if coalesce(v_balance, 0) >= 100 then
    raise exception 'Driver commission balance is locked' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.trips t
    where t.driver_id = p_driver_id and t.status in ('assigned','arrived','ongoing') and t.id <> p_trip_id
  ) then raise exception 'Driver already has an active trip' using errcode = 'P0001'; end if;

  if exists (
    select 1 from public.driver_trip_offers o
    where o.trip_id = p_trip_id and o.driver_id = p_driver_id and o.status = 'declined'
  ) then raise exception 'Driver already declined this trip' using errcode = 'P0001'; end if;

  if exists (
    select 1 from public.driver_trip_offers o
    where o.driver_id = p_driver_id and o.status in ('pending','shown') and o.accept_deadline_at > now()
  ) then raise exception 'Driver has another active reservation' using errcode = 'P0001'; end if;

  insert into public.driver_trip_offers(
    trip_id, driver_id, dispatch_cycle, sequence_number, status, offered_at,
    visible_until, escalates_at, accept_deadline_at, distance_km, road_eta_seconds,
    dispatch_score, dispatch_score_breakdown, search_radius_km
  ) values (
    p_trip_id, p_driver_id, greatest(1,p_dispatch_cycle), greatest(1,p_sequence_number), 'shown', now(),
    v_escalates, v_escalates, v_deadline, p_distance_km, p_road_eta_seconds,
    p_dispatch_score, coalesce(p_score_breakdown,'{}'::jsonb), p_search_radius_km
  ) returning id into v_offer_id;

  update public.trips set
    status = 'offered', offer_status = 'pending',
    offer_expires_at = greatest(coalesce(offer_expires_at, v_deadline), v_deadline),
    dispatch_started_at = coalesce(dispatch_started_at, now()),
    dispatch_cycle = greatest(1,p_dispatch_cycle), dispatch_sequence = greatest(1,p_sequence_number),
    dispatch_state = 'searching', dispatch_search_radius_km = p_search_radius_km,
    dispatch_failure_reason = null, dispatch_updated_at = now()
  where id = p_trip_id;

  insert into public.trip_events(trip_id,event_type,message,old_status,new_status)
  values (p_trip_id,'offer_created',format('Cycle %s sequence %s reserved driver %s',p_dispatch_cycle,p_sequence_number,p_driver_id),v_trip.status,'offered');

  return query select v_offer_id as offer_id, p_driver_id as driver_id, v_deadline as accept_deadline_at, v_escalates as escalates_at;
end;
$$;

commit;
