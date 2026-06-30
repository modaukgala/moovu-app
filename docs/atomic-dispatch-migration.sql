-- MOOVU atomic dispatch migration (REVIEW ONLY)
-- Apply to staging first. Do not run in production until duplicate/active-trip checks are reviewed.
-- This migration is additive and preserves historical offers.

create extension if not exists pgcrypto;

alter table public.trips add column if not exists dispatch_started_at timestamptz;
alter table public.trips add column if not exists dispatch_cycle integer not null default 0;
alter table public.trips add column if not exists dispatch_sequence integer not null default 0;
alter table public.trips add column if not exists dispatch_state text not null default 'idle';
alter table public.trips add column if not exists dispatch_search_radius_km numeric(10,3);
alter table public.trips add column if not exists dispatch_failure_reason text;
alter table public.trips add column if not exists dispatch_updated_at timestamptz;

create table if not exists public.driver_trip_offers (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  dispatch_cycle integer not null default 1,
  sequence_number integer not null default 1,
  status text not null default 'pending',
  offered_at timestamptz not null default now(),
  visible_until timestamptz,
  escalates_at timestamptz not null,
  accept_deadline_at timestamptz not null,
  responded_at timestamptz,
  expired_at timestamptz,
  cancelled_at timestamptz,
  decline_reason text,
  response_source text,
  distance_km numeric(10,3),
  road_eta_seconds integer,
  dispatch_score numeric(12,3),
  dispatch_score_breakdown jsonb not null default '{}'::jsonb,
  reservation_token uuid not null default gen_random_uuid(),
  search_radius_km numeric(10,3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.driver_trip_offers add column if not exists dispatch_cycle integer not null default 1;
alter table public.driver_trip_offers add column if not exists sequence_number integer not null default 1;
alter table public.driver_trip_offers add column if not exists expired_at timestamptz;
alter table public.driver_trip_offers add column if not exists cancelled_at timestamptz;
alter table public.driver_trip_offers add column if not exists decline_reason text;
alter table public.driver_trip_offers add column if not exists response_source text;
alter table public.driver_trip_offers add column if not exists road_eta_seconds integer;
alter table public.driver_trip_offers add column if not exists dispatch_score_breakdown jsonb not null default '{}'::jsonb;
alter table public.driver_trip_offers add column if not exists reservation_token uuid not null default gen_random_uuid();
alter table public.driver_trip_offers add column if not exists search_radius_km numeric(10,3);
alter table public.driver_trip_offers add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.driver_trip_offers'::regclass
      and conname = 'driver_trip_offers_status_check'
  ) then
    alter table public.driver_trip_offers
      add constraint driver_trip_offers_status_check
      check (status in ('pending','shown','accepted','declined','expired','cancelled')) not valid;
  end if;
end $$;

-- Preserve the newest active row and close stale duplicates before unique indexes are added.
with ranked as (
  select id,
         row_number() over (partition by trip_id, driver_id order by offered_at desc, created_at desc) as rn
  from public.driver_trip_offers
  where status in ('pending','shown')
)
update public.driver_trip_offers o
set status = 'cancelled', cancelled_at = now(), updated_at = now()
from ranked r
where o.id = r.id and r.rn > 1;

with ranked as (
  select id,
         row_number() over (partition by driver_id order by offered_at desc, created_at desc) as rn
  from public.driver_trip_offers
  where status in ('pending','shown') and accept_deadline_at > now()
)
update public.driver_trip_offers o
set status = 'cancelled', cancelled_at = now(), updated_at = now()
from ranked r
where o.id = r.id and r.rn > 1;

create unique index if not exists driver_trip_offers_active_trip_driver_uidx
  on public.driver_trip_offers(trip_id, driver_id)
  where status in ('pending','shown');

create unique index if not exists driver_trip_offers_active_driver_reservation_uidx
  on public.driver_trip_offers(driver_id)
  where status in ('pending','shown');

create unique index if not exists driver_trip_offers_one_winner_uidx
  on public.driver_trip_offers(trip_id)
  where status = 'accepted';

create index if not exists driver_trip_offers_due_idx
  on public.driver_trip_offers(status, escalates_at, accept_deadline_at);
create index if not exists driver_trip_offers_trip_history_idx
  on public.driver_trip_offers(trip_id, dispatch_cycle, sequence_number, offered_at);
create index if not exists driver_trip_offers_driver_history_idx
  on public.driver_trip_offers(driver_id, offered_at desc);

create table if not exists public.dispatch_jobs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  offer_id uuid references public.driver_trip_offers(id) on delete cascade,
  job_type text not null check (job_type in ('escalate','expire','recover','release_scheduled')),
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','cancelled')),
  run_at timestamptz not null,
  dispatch_cycle integer not null default 1,
  sequence_number integer not null default 1,
  attempts integer not null default 0,
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, job_type, dispatch_cycle, sequence_number)
);

create index if not exists dispatch_jobs_due_idx
  on public.dispatch_jobs(status, run_at)
  where status = 'pending';

alter table public.driver_trip_offers enable row level security;
alter table public.dispatch_jobs enable row level security;
-- No browser policies are added. These tables are written by authenticated server routes/service role only.

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
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then raise exception 'Trip not found' using errcode = 'P0002'; end if;
  if v_trip.status not in ('requested','offered') or (v_trip.driver_id is not null and v_trip.status <> 'offered') then
    raise exception 'Trip is no longer dispatchable' using errcode = 'P0001';
  end if;

  select * into v_driver from public.drivers where id = p_driver_id for update;
  if not found then raise exception 'Driver not found' using errcode = 'P0002'; end if;
  if coalesce(v_driver.is_deleted, false)
     or v_driver.status not in ('approved','active')
     or (v_driver.verification_status is not null and v_driver.verification_status <> 'approved')
     or coalesce(v_driver.profile_completed, true) = false
     or not coalesce(v_driver.online, false)
     or v_driver.lat is null or v_driver.lng is null
     or v_driver.last_seen < now() - interval '90 seconds'
     or v_driver.subscription_status not in ('active','grace')
     or v_driver.subscription_expires_at is null
     or v_driver.subscription_expires_at <= now() then
    raise exception 'Driver is not eligible' using errcode = 'P0001';
  end if;

  v_required_seats := case when lower(coalesce(v_trip.ride_option, 'go')) = 'group' then 6 else 3 end;
  if coalesce(v_driver.seating_capacity, 0) < v_required_seats then
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

create or replace function public.accept_trip_offer(p_trip_id uuid, p_driver_id uuid, p_source text default 'driver_app')
returns table(ok boolean, trip_id uuid, driver_id uuid, status text, dispatch_cycle integer,
              sequence_number integer, cancelled_driver_ids uuid[], error_code text, error_message text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_trip public.trips%rowtype;
  v_driver public.drivers%rowtype;
  v_offer public.driver_trip_offers%rowtype;
  v_cancelled uuid[] := '{}';
begin
  select * into v_driver from public.drivers d where d.id=p_driver_id for update;
  select * into v_trip from public.trips t where t.id=p_trip_id for update;
  select * into v_offer from public.driver_trip_offers o
    where o.trip_id=p_trip_id and o.driver_id=p_driver_id and o.status in ('pending','shown')
    order by o.offered_at desc limit 1 for update;

  if v_offer.id is null or v_offer.accept_deadline_at <= now() then
    return query select false,p_trip_id,p_driver_id,'expired',0,0,'{}'::uuid[],'OFFER_CONFLICT','Offer expired or unavailable'; return;
  end if;
  if v_trip.driver_id is not null or v_trip.status not in ('requested','offered') then
    return query select false,p_trip_id,p_driver_id,v_trip.status,v_offer.dispatch_cycle,v_offer.sequence_number,'{}'::uuid[],'OFFER_CONFLICT','Another driver already accepted'; return;
  end if;
  if not coalesce(v_driver.online,false) or v_driver.status not in ('approved','active') then
    return query select false,p_trip_id,p_driver_id,'ineligible',v_offer.dispatch_cycle,v_offer.sequence_number,'{}'::uuid[],'DRIVER_CONFLICT','Driver is no longer eligible'; return;
  end if;
  if exists(select 1 from public.trips t where t.driver_id=p_driver_id and t.status in ('assigned','arrived','ongoing') and t.id<>p_trip_id) then
    return query select false,p_trip_id,p_driver_id,'busy',v_offer.dispatch_cycle,v_offer.sequence_number,'{}'::uuid[],'DRIVER_CONFLICT','Driver already has an active trip'; return;
  end if;

  select coalesce(array_agg(o.driver_id),'{}'::uuid[]) into v_cancelled
  from public.driver_trip_offers o where o.trip_id=p_trip_id and o.driver_id<>p_driver_id and o.status in ('pending','shown');

  update public.driver_trip_offers o set status='accepted',responded_at=now(),response_source=p_source,updated_at=now() where o.id=v_offer.id;
  update public.driver_trip_offers o set status='cancelled',cancelled_at=now(),responded_at=now(),updated_at=now()
    where o.trip_id=p_trip_id and o.driver_id<>p_driver_id and o.status in ('pending','shown');
  update public.trips t set driver_id=p_driver_id,status='assigned',offer_status='accepted',offer_expires_at=null,
    dispatch_state='accepted',dispatch_updated_at=now() where t.id=p_trip_id;
  update public.drivers d set busy=true where d.id=p_driver_id;
  update public.dispatch_jobs j set status='cancelled',updated_at=now() where j.trip_id=p_trip_id and j.status in ('pending','processing');
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status)
    values(p_trip_id,'offer_accepted',format('Driver %s accepted via %s',p_driver_id,p_source),v_trip.status,'assigned');

  return query select true as ok,p_trip_id as trip_id,p_driver_id as driver_id,'assigned'::text as status,v_offer.dispatch_cycle,v_offer.sequence_number,v_cancelled,null::text as error_code,null::text as error_message;
end;
$$;

create or replace function public.decline_trip_offer(p_trip_id uuid, p_driver_id uuid, p_source text default 'driver_app')
returns table(ok boolean, trip_id uuid, driver_id uuid, status text, dispatch_cycle integer,
              sequence_number integer, cancelled_driver_ids uuid[], error_code text, error_message text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_offer public.driver_trip_offers%rowtype;
begin
  select * into v_offer from public.driver_trip_offers o
    where o.trip_id=p_trip_id and o.driver_id=p_driver_id and o.status in ('pending','shown')
    order by o.offered_at desc limit 1 for update;
  if v_offer.id is null then
    return query select false,p_trip_id,p_driver_id,'unavailable',0,0,'{}'::uuid[],'OFFER_CONFLICT','Offer no longer available'; return;
  end if;
  update public.driver_trip_offers o set status='declined',responded_at=now(),decline_reason='driver_declined',
    response_source=p_source,updated_at=now() where o.id=v_offer.id;
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status)
    values(p_trip_id,'offer_declined',format('Driver %s declined via %s',p_driver_id,p_source),'offered','offered');
  return query select true as ok,p_trip_id as trip_id,p_driver_id as driver_id,'declined'::text as status,v_offer.dispatch_cycle,v_offer.sequence_number,'{}'::uuid[] as cancelled_driver_ids,null::text as error_code,null::text as error_message;
end;
$$;

create or replace function public.expire_due_trip_offers(p_trip_id uuid default null)
returns table(expired_offer_id uuid, trip_id uuid, driver_id uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select o.id from public.driver_trip_offers o
    where o.status in ('pending','shown') and o.accept_deadline_at <= now()
      and (p_trip_id is null or o.trip_id=p_trip_id)
    for update skip locked
  ), changed as (
    update public.driver_trip_offers o set status='expired',expired_at=now(),responded_at=now(),updated_at=now()
    from due where o.id=due.id returning o.id,o.trip_id,o.driver_id
  ) select changed.id as expired_offer_id,changed.trip_id,changed.driver_id from changed;
end;
$$;

create or replace function public.claim_due_dispatch_jobs(p_limit integer default 20)
returns setof public.dispatch_jobs
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select id from public.dispatch_jobs
    where status='pending' and run_at<=now()
    order by run_at asc limit greatest(1,least(100,p_limit)) for update skip locked
  )
  update public.dispatch_jobs j set status='processing',locked_at=now(),attempts=attempts+1,updated_at=now()
  from due where j.id=due.id returning j.*;
end;
$$;

create or replace function public.mark_dispatch_exhausted(p_trip_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.trips set status='requested',driver_id=null,offer_status=null,offer_expires_at=null,
    dispatch_state='exhausted',dispatch_failure_reason='No eligible driver accepted before dispatch limit',dispatch_updated_at=now()
  where id=p_trip_id and status in ('requested','offered');
  update public.driver_trip_offers set status='cancelled',cancelled_at=now(),updated_at=now()
  where trip_id=p_trip_id and status in ('pending','shown');
  update public.dispatch_jobs set status='cancelled',updated_at=now()
  where trip_id=p_trip_id and status in ('pending','processing');
end;
$$;

revoke all on function public.reserve_trip_offer(uuid,uuid,integer,integer,numeric,integer,numeric,jsonb,integer,integer,numeric) from public, anon, authenticated;
revoke all on function public.accept_trip_offer(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.decline_trip_offer(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.expire_due_trip_offers(uuid) from public, anon, authenticated;
revoke all on function public.claim_due_dispatch_jobs(integer) from public, anon, authenticated;
revoke all on function public.mark_dispatch_exhausted(uuid) from public, anon, authenticated;
grant execute on function public.reserve_trip_offer(uuid,uuid,integer,integer,numeric,integer,numeric,jsonb,integer,integer,numeric) to service_role;
grant execute on function public.accept_trip_offer(uuid,uuid,text) to service_role;
grant execute on function public.decline_trip_offer(uuid,uuid,text) to service_role;
grant execute on function public.expire_due_trip_offers(uuid) to service_role;
grant execute on function public.claim_due_dispatch_jobs(integer) to service_role;
grant execute on function public.mark_dispatch_exhausted(uuid) to service_role;

comment on table public.dispatch_jobs is 'Durable dispatch work queue. Requires a trusted worker/queue callback; browser polling is not authoritative.';
comment on function public.accept_trip_offer is 'Atomically assigns one driver, marks busy after acceptance, and cancels competing offers.';
