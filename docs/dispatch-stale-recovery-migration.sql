-- MOOVU stale dispatch recovery migration (REVIEW ONLY)
-- Purpose:
--   Recover already-stuck live dispatch rows without deleting trip, offer, or event history.
--   Run on staging first and review affected row counts before production.

-- 1. Expire overdue active offer rows.
with expired_offers as (
  update public.driver_trip_offers
  set
    status = 'expired',
    expired_at = coalesce(expired_at, now()),
    responded_at = coalesce(responded_at, now()),
    updated_at = now()
  where status in ('pending', 'shown')
    and accept_deadline_at <= now()
  returning id, trip_id, driver_id
)
insert into public.trip_events(trip_id, event_type, message, old_status, new_status)
select
  trip_id,
  'offer_expired',
  'Stale dispatch recovery expired overdue offer for driver ' || driver_id::text,
  'offered',
  'offered'
from expired_offers;

-- 2. Reset trips that are still offered, have no active accepted driver, and have
-- no live offer windows left. This lets the protected dispatch worker retry them.
with recoverable_trips as (
  select t.id
  from public.trips t
  where t.status = 'offered'
    and t.offer_status = 'pending'
    and (t.offer_expires_at is null or t.offer_expires_at <= now())
    and not exists (
      select 1
      from public.driver_trip_offers o
      where o.trip_id = t.id
        and o.status in ('pending', 'shown')
        and o.accept_deadline_at > now()
    )
    and not exists (
      select 1
      from public.trips active
      where active.id = t.id
        and active.driver_id is not null
        and active.status in ('assigned', 'arrived', 'ongoing')
    )
), updated_trips as (
  update public.trips t
  set
    status = 'requested',
    driver_id = null,
    offer_status = null,
    offer_expires_at = null,
    dispatch_state = 'recoverable',
    dispatch_failure_reason = 'Recovered from stale offered state',
    dispatch_updated_at = now()
  from recoverable_trips r
  where t.id = r.id
  returning t.id
)
insert into public.trip_events(trip_id, event_type, message, old_status, new_status)
select
  id,
  'dispatch_recovered',
  'Stale dispatch recovery reset trip to requested for retry.',
  'offered',
  'requested'
from updated_trips;

-- 3. Requeue overdue dispatch jobs that were left processing.
update public.dispatch_jobs
set
  status = 'pending',
  locked_at = null,
  last_error = coalesce(last_error, 'Recovered stale processing job'),
  run_at = now(),
  updated_at = now()
where status = 'processing'
  and locked_at <= now() - interval '2 minutes';

-- 4. Cancel pending jobs for trips that already reached terminal states.
update public.dispatch_jobs j
set
  status = 'cancelled',
  updated_at = now()
from public.trips t
where j.trip_id = t.id
  and j.status in ('pending', 'processing')
  and t.status in ('assigned', 'arrived', 'ongoing', 'completed', 'cancelled');
