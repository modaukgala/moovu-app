-- Restores the trusted handoff from Phase 5 trip creation to Phase 3 online payment.
-- Phase 5 creates trips as cash so they remain dispatchable by default. This RPC
-- may change only an owned, undispatched trip before a checkout attempt exists.
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
  set payment_method='online', updated_at=now()
  where id=p_trip_id;

  return jsonb_build_object('trip_id',p_trip_id,'payment_method','online');
end $$;

revoke all on function public.phase3_mark_trip_online_before_dispatch(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.phase3_mark_trip_online_before_dispatch(uuid,uuid)
  to service_role;

commit;
