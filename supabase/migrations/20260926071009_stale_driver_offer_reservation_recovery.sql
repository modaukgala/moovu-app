-- Surgical patch of the installed reservation function; no financial or timing changes.
-- Rollback: restore the captured pre-migration reserve_trip_offer definition.
begin;
set local lock_timeout='5s';
do $migration$
declare
  target regprocedure := 'public.reserve_trip_offer(uuid,uuid,integer,integer,numeric,integer,numeric,jsonb,integer,integer,numeric)'::regprocedure;
  definition text;
  anchor text := $anchor$  if exists (
    select 1 from public.driver_trip_offers o
    where o.driver_id = p_driver_id
      and o.status in ('pending','shown')
      and o.accept_deadline_at > now()
  ) then$anchor$;
  cleanup text := $cleanup$  -- p0-stale-offer-reservation-v1: reclaim only provably non-actionable rows.
  -- The driver row is already locked, serializing this with acceptance/reservation.
  update public.driver_trip_offers o
  set status = case
        when t.status not in ('requested','offered') or t.driver_id is not null then 'cancelled'
        else 'expired' end,
      expired_at = case when t.status in ('requested','offered') and t.driver_id is null
        then coalesce(o.expired_at,now()) else o.expired_at end,
      cancelled_at = case when t.status not in ('requested','offered') or t.driver_id is not null
        then coalesce(o.cancelled_at,now()) else o.cancelled_at end,
      responded_at = coalesce(o.responded_at,now()),
      updated_at = now()
  from public.trips t
  where o.driver_id=p_driver_id and t.id=o.trip_id
    and o.status in ('pending','shown')
    and (o.accept_deadline_at<=now() or t.status not in ('requested','offered') or t.driver_id is not null);

$cleanup$;
begin
  definition := replace(pg_get_functiondef(target), E'\r\n', E'\n');
  if position('p0-stale-offer-reservation-v1' in definition)>0 then return; end if;
  if position(anchor in definition)=0
     or position('from public.drivers d where d.id = p_driver_id for update' in definition)=0
     or position('Driver already has an active trip' in definition)=0
     or position('phase2_finance_eligibility' in definition)=0 then
    raise exception 'Reservation function differs from reviewed contract; refusing patch';
  end if;
  execute replace(definition,anchor,cleanup||anchor);
end $migration$;
commit;
