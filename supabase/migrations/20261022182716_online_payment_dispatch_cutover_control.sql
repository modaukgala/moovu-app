-- Payment-dispatch transition fence. Apply after terminal guard and ownership.
-- LEGACY preserves the currently serving application until an authorized
-- operator changes the mode. No production mode change is part of migration.
do $$
begin
  if to_regprocedure('public.claim_online_payment_dispatch(uuid,uuid,integer)') is null
    or to_regprocedure('public.reserve_paid_trip_offer(uuid,uuid,uuid,uuid,integer,integer,numeric,integer,numeric,jsonb,integer,integer,numeric)') is null then
    raise exception 'Payment dispatch ownership migration must be installed first';
  end if;
  if to_regclass('public.online_payment_dispatch_control') is not null then
    raise exception 'Payment dispatch control already exists';
  end if;
end $$;

create table public.online_payment_dispatch_control (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'LEGACY'
    check (mode in ('LEGACY','DRAINING','PAUSED','RUNNING')),
  generation bigint not null default 0 check (generation >= 0),
  changed_at timestamptz not null default clock_timestamp()
);
insert into public.online_payment_dispatch_control(singleton,mode) values(true,'LEGACY');
alter table public.online_payment_dispatch_control enable row level security;
revoke all on public.online_payment_dispatch_control from public,anon,authenticated,service_role;

-- PostgreSQL operator only; never exposed to the application's service role.
create function public.set_online_payment_dispatch_mode(p_expected text,p_next text)
returns bigint language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_mode text; v_generation bigint;
begin
  select mode into v_mode from public.online_payment_dispatch_control
    where singleton=true for update;
  if not found or v_mode is distinct from p_expected then
    raise exception 'Payment dispatch mode changed concurrently' using errcode='P0D06';
  end if;
  if not ((v_mode='LEGACY' and p_next='DRAINING')
    or (v_mode='DRAINING' and p_next in ('PAUSED','LEGACY'))
    or (v_mode='PAUSED' and p_next in ('RUNNING','LEGACY'))
    or (v_mode='RUNNING' and p_next='DRAINING')) then
    raise exception 'Invalid payment dispatch mode transition' using errcode='P0D06';
  end if;
  update public.online_payment_dispatch_control
    set mode=p_next,generation=generation+1,changed_at=clock_timestamp()
    where singleton=true returning generation into v_generation;
  return v_generation;
end $$;
revoke all on function public.set_online_payment_dispatch_mode(text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.set_online_payment_dispatch_mode(text,text) to postgres;

-- This is the real side-effect boundary used by the unchanged live worker.
-- Share-locking the mode row serializes activation with reservations that are
-- already inside PostgreSQL. An old HTTP invocation held before this INSERT
-- sees the new mode when it resumes, and cannot pass after RUNNING begins.
create function public.fence_online_payment_dispatch_offer()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_mode text; v_payment_method text; v_ride_type text;
  v_attempt public.online_payment_attempts%rowtype;
  v_token uuid;
begin
  if new.dispatch_cycle<>1 then return new; end if;
  select t.payment_method,t.ride_type into v_payment_method,v_ride_type
    from public.trips t where t.id=new.trip_id;
  if v_payment_method is distinct from 'online' or v_ride_type is distinct from 'now' then
    return new;
  end if;
  select mode into v_mode from public.online_payment_dispatch_control
    where singleton=true for share;
  if not found then
    raise exception 'Payment dispatch control unavailable' using errcode='P0D02';
  end if;
  if v_mode='LEGACY' then return new; end if;
  if v_mode in ('DRAINING','PAUSED') then
    raise exception 'Payment dispatch temporarily paused' using errcode='P0D02';
  end if;
  if v_mode<>'RUNNING' then
    raise exception 'Payment dispatch mode is invalid' using errcode='P0D02';
  end if;
  v_token:=nullif(current_setting('moovu.payment_dispatch_claim_token',true),'')::uuid;
  if v_token is null then
    raise exception 'Paid offer requires current dispatch owner' using errcode='P0D01';
  end if;
  select * into v_attempt from public.online_payment_attempts a
    where a.trip_id=new.trip_id and a.state='SUCCEEDED'
    order by a.verified_at,a.id limit 1 for update;
  if not found or v_attempt.dispatch_claim_token is distinct from v_token
    or v_attempt.dispatch_claim_until<=clock_timestamp()
    or v_attempt.dispatch_round_id is null
    or v_attempt.dispatch_state='DISPATCHED'
    or (v_attempt.dispatch_round_started_by is not null
      and v_attempt.dispatch_round_started_by is distinct from v_token) then
    raise exception 'Paid offer requires current dispatch owner' using errcode='P0D01';
  end if;
  return new;
end $$;
create trigger fence_online_payment_dispatch_offer
before insert on public.driver_trip_offers
for each row execute function public.fence_online_payment_dispatch_offer();
revoke all on function public.fence_online_payment_dispatch_offer()
  from public,anon,authenticated,service_role;

-- The old application acknowledges after dispatch by updating the attempt.
-- While paused, preserve confirmed payment evidence and retry budget even if
-- the old code tries to record a failed dispatch. After RUNNING, prevent an
-- old invocation from acknowledging work it did not own.
create function public.fence_online_payment_dispatch_attempt()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_mode text; v_ride_type text;
begin
  if old.state<>'SUCCEEDED' or new.state<>'SUCCEEDED' then return new; end if;
  select mode into v_mode from public.online_payment_dispatch_control
    where singleton=true for share;
  if not found then
    raise exception 'Payment dispatch control unavailable' using errcode='P0D02';
  end if;
  if v_mode='LEGACY' then return new; end if;
  if v_mode in ('DRAINING','PAUSED') then
    if new.dispatch_claim_token is distinct from old.dispatch_claim_token
      and new.dispatch_claim_token is not null then
      raise exception 'Payment dispatch claim paused' using errcode='P0D02';
    end if;
    new.dispatch_state:=old.dispatch_state;
    new.dispatch_attempts:=old.dispatch_attempts;
    new.dispatch_last_error:=old.dispatch_last_error;
    new.dispatched_at:=old.dispatched_at;
    new.dispatch_claim_token:=old.dispatch_claim_token;
    new.dispatch_claim_until:=old.dispatch_claim_until;
    new.dispatch_round_id:=old.dispatch_round_id;
    new.dispatch_round_started_by:=old.dispatch_round_started_by;
    return new;
  end if;
  if v_mode<>'RUNNING' then
    raise exception 'Payment dispatch mode is invalid' using errcode='P0D02';
  end if;
  -- The reviewed claim RPC changes token and increments attempts atomically.
  if new.dispatch_claim_token is distinct from old.dispatch_claim_token
    and new.dispatch_claim_token is not null
    and new.dispatch_claim_until>clock_timestamp()
    and new.dispatch_round_id is not null
    and new.dispatch_attempts=old.dispatch_attempts+1
    and new.dispatch_state is not distinct from old.dispatch_state then
    return new;
  end if;
  -- The reviewed finish RPC clears the exact claim after successful owner
  -- verification. The unchanged worker never supplies or clears a token.
  if old.dispatch_claim_token is not null
    and new.dispatch_claim_token is null
    and new.dispatch_claim_until is null
    and old.dispatch_claim_until>clock_timestamp()
    and new.dispatch_state in ('DISPATCHED','FAILED') then
    return new;
  end if;
  select t.ride_type into v_ride_type from public.trips t where t.id=old.trip_id;
  if new.dispatch_state='DEFERRED' and v_ride_type is distinct from 'now'
    and new.dispatch_attempts is not distinct from old.dispatch_attempts then
    return new;
  end if;
  raise exception 'Claimless payment dispatch acknowledgement rejected'
    using errcode='P0D03';
end $$;
create trigger fence_online_payment_dispatch_attempt
before update of dispatch_state,dispatch_attempts,dispatch_claim_token
on public.online_payment_attempts
for each row execute function public.fence_online_payment_dispatch_attempt();
revoke all on function public.fence_online_payment_dispatch_attempt()
  from public,anon,authenticated,service_role;
