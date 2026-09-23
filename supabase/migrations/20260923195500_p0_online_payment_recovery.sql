-- P0 recovery: make Phase 5 online trip creation atomic and repair the
-- compatibility method switch for production schemas without trips.updated_at.
begin;

create or replace function public.phase3_mark_trip_online_before_dispatch(
  p_trip_id uuid,
  p_customer_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_trip public.trips;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted server role required';
  end if;

  select * into v_trip
  from public.trips
  where id=p_trip_id
  for update;

  if not found or v_trip.customer_id<>p_customer_id then
    raise exception 'Trip unavailable';
  end if;

  if v_trip.status not in ('requested','scheduled')
    or v_trip.driver_id is not null
    or coalesce(v_trip.dispatch_state,'idle')<>'idle'
    or coalesce(v_trip.dispatch_sequence,0)<>0
    or v_trip.dispatch_started_at is not null
    or v_trip.offer_status is not null
  then
    raise exception 'Trip already entered dispatch';
  end if;

  if lower(coalesce(v_trip.payment_method,'')) not in ('cash','online') then
    raise exception 'Unsupported payment method';
  end if;

  update public.trips
  set payment_method='online'
  where id=p_trip_id
  returning * into v_trip;

  return jsonb_build_object('trip_id',v_trip.id,'payment_method',v_trip.payment_method);
end $$;

revoke all on function public.phase3_mark_trip_online_before_dispatch(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.phase3_mark_trip_online_before_dispatch(uuid,uuid)
  to service_role;

create or replace function public.phase5_create_online_trip(
  p_customer_id uuid,
  p_actor_id uuid,
  p_booking_key text,
  p_trip_payload jsonb,
  p_ride_fare_cents bigint,
  p_ride_option text,
  p_expected_customer_total_cents bigint
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_result jsonb;
  v_trip public.trips;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted server role required';
  end if;

  v_result:=public.phase5_create_trip(
    p_customer_id,
    p_actor_id,
    p_booking_key,
    p_trip_payload,
    p_ride_fare_cents,
    p_ride_option,
    p_expected_customer_total_cents
  );

  select * into v_trip
  from public.trips
  where id=(v_result->'trip'->>'id')::uuid
  for update;

  if not found or v_trip.customer_id<>p_customer_id then
    raise exception 'Trip unavailable';
  end if;

  if v_trip.status not in ('requested','scheduled')
    or v_trip.driver_id is not null
    or coalesce(v_trip.dispatch_state,'idle')<>'idle'
    or coalesce(v_trip.dispatch_sequence,0)<>0
    or v_trip.dispatch_started_at is not null
    or v_trip.offer_status is not null
  then
    raise exception 'Trip already entered dispatch';
  end if;

  update public.trips
  set payment_method='online'
  where id=v_trip.id
  returning * into v_trip;

  return jsonb_set(v_result,'{trip}',to_jsonb(v_trip),true);
end $$;

revoke all on function public.phase5_create_online_trip(uuid,uuid,text,jsonb,bigint,text,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.phase5_create_online_trip(uuid,uuid,text,jsonb,bigint,text,bigint)
  to service_role;

commit;
