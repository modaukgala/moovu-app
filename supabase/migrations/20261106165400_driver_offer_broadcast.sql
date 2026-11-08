begin;

-- Default off. Existing trips retain their original dispatch policy.
create table public.driver_broadcast_control (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 effective_from timestamptz
);
insert into public.driver_broadcast_control values(true,false,null);
create table public.driver_offer_presence (
 driver_id uuid primary key references public.drivers(id),
 present_at timestamptz not null,
 location_at timestamptz
);
create table public.driver_broadcast_requests (
 trip_id uuid primary key references public.trips(id),
 state text not null check(state in('PENDING','WAITING_PAYMENT','ACTIVE','FINISHED','FAILED')),
 cycle integer not null default 0,
 next_run_at timestamptz not null default now(),
 deadline_at timestamptz not null,
 lease_token uuid, lease_until timestamptz,
 claim_count integer not null default 0,
 failure_count integer not null default 0,
 last_error_code text,
 created_at timestamptz not null default now()
);
create index driver_broadcast_requests_due on public.driver_broadcast_requests(next_run_at)
 where state in('PENDING','ACTIVE');
create table public.driver_broadcast_rounds (
 id uuid primary key default gen_random_uuid(),
 trip_id uuid not null references public.driver_broadcast_requests(trip_id),
 cycle integer not null,
 snapshot_at timestamptz not null,
 expires_at timestamptz not null,
 radius_km numeric not null,
 admin_requested boolean not null default false,
 manual_driver_id uuid references public.drivers(id),
 expected_count integer not null default 0,
 persisted_count integer not null default 0,
 complete boolean not null default false,
 completed_at timestamptz,
 unique(trip_id,cycle),
 check(not complete or expected_count=persisted_count)
);
create table public.driver_broadcast_recipients (
 round_id uuid not null references public.driver_broadcast_rounds(id),
 driver_id uuid not null references public.drivers(id),
 reason_code text not null,
 offer_id uuid,
 primary key(round_id,driver_id)
);
alter table public.driver_trip_offers add column broadcast_round_id uuid references public.driver_broadcast_rounds(id);
alter table public.driver_broadcast_recipients add foreign key(offer_id) references public.driver_trip_offers(id);
create unique index driver_broadcast_offer_identity on public.driver_trip_offers(broadcast_round_id,driver_id)
 where broadcast_round_id is not null;
-- Preserve the old restriction for old-policy reservations, not new broadcast offers.
drop index public.driver_trip_offers_active_driver_reservation_uidx;
create unique index driver_trip_offers_active_driver_reservation_uidx on public.driver_trip_offers(driver_id)
 where status in('pending','shown') and broadcast_round_id is null;

create table public.driver_offer_device_jobs (
 id uuid primary key default gen_random_uuid(),
 offer_id uuid not null references public.driver_trip_offers(id),
 user_id uuid not null references auth.users(id),
 transport text not null check(transport in('fcm','web')),
 device_ref uuid not null,
 state text not null default 'PENDING' check(state in('PENDING','SENDING','ACCEPTED','INVALID','UNAVAILABLE','EXPIRED','CANCELLED','FAILED')),
 attempts integer not null default 0 check(attempts between 0 and 5),
 next_run_at timestamptz not null default now(),
 expires_at timestamptz not null,
 lease_token uuid, lease_until timestamptz,
 error_code text,
 provider_accepted_at timestamptz,
 unique(offer_id,transport,device_ref)
);
create index driver_offer_device_jobs_due on public.driver_offer_device_jobs(next_run_at)
 where state in('PENDING','SENDING');
create table public.driver_offer_receipts (
 offer_id uuid not null references public.driver_trip_offers(id),
 user_id uuid not null references auth.users(id),
 receipt_type text not null check(receipt_type in('FETCHED','DISPLAYED')),
 created_at timestamptz not null default now(),
 primary key(offer_id,receipt_type)
);

do $$ declare name text; begin
 foreach name in array array['driver_broadcast_control','driver_offer_presence','driver_broadcast_requests',
 'driver_broadcast_rounds','driver_broadcast_recipients','driver_offer_device_jobs','driver_offer_receipts'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated',name);
  execute format('grant select on public.%I to service_role',name);
 end loop;
end $$;

create function public.broadcast_trusted() returns void language plpgsql set search_path=public,pg_temp as $$
begin if coalesce(auth.role(),'')<>'service_role' then raise exception 'Trusted server role required' using errcode='42501';end if;end $$;

create function public.broadcast_capture_request() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if coalesce(new.ride_type,'now')='now' and new.status in('requested','offered') and new.driver_id is null
  and exists(select 1 from driver_broadcast_control where singleton and enabled and effective_from is not null and new.created_at>=effective_from) then
  insert into driver_broadcast_requests(trip_id,state,deadline_at)
   values(new.id,case when lower(coalesce(new.payment_method,'cash'))='online' then 'WAITING_PAYMENT' else 'PENDING' end,new.created_at+interval '30 minutes');
 end if;return new;
end $$;
create trigger zz_broadcast_capture after insert on public.trips for each row execute function public.broadcast_capture_request();

create function public.broadcast_capture_location() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.online and new.lat is not null and new.lng is not null and new.last_seen is distinct from old.last_seen then
  insert into driver_offer_presence(driver_id,present_at,location_at) values(new.id,clock_timestamp(),new.last_seen)
   on conflict(driver_id) do update set present_at=excluded.present_at,location_at=excluded.location_at;
 end if;return new;
end $$;
create trigger zz_broadcast_location after update of lat,lng,last_seen on public.drivers for each row execute function public.broadcast_capture_location();

create function public.refresh_driver_offer_presence(p_driver uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform broadcast_trusted();
 if not exists(select 1 from drivers where id=p_driver and online and not coalesce(is_deleted,false)) then return false;end if;
 insert into driver_offer_presence(driver_id,present_at) values(p_driver,clock_timestamp())
  on conflict(driver_id) do update set present_at=excluded.present_at
   where driver_offer_presence.present_at < excluded.present_at-interval '20 seconds';
 return true;
end $$;

create function public.broadcast_driver_reason(p_trip public.trips,p_driver public.drivers,p_at timestamptz,p_radius numeric)
returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
declare presence driver_offer_presence%rowtype; distance numeric;
begin
 if not coalesce(p_driver.online,false) then return 'OFFLINE';end if;
 if coalesce(p_driver.is_deleted,false) or coalesce(p_driver.status,'') not in('approved','active') then return 'NOT_APPROVED';end if;
 if p_driver.verification_status is not null and p_driver.verification_status<>'approved' then return 'NOT_VERIFIED';end if;
 if p_driver.profile_completed is false then return 'PROFILE_INCOMPLETE';end if;
 if not exists(select 1 from driver_accounts a join auth.users u on u.id=a.user_id join profiles pr on pr.id=a.user_id
  where a.driver_id=p_driver.id and u.deleted_at is null and pr.role='driver'
   and not exists(select 1 from customers c where c.auth_user_id=a.user_id)) then return 'NOT_LINKED';end if;
 if p_driver.busy or exists(select 1 from trips where driver_id=p_driver.id and status in('assigned','arrived','ongoing')) then return 'BUSY';end if;
 select * into presence from driver_offer_presence where driver_id=p_driver.id;
 if coalesce(presence.present_at,p_driver.last_seen,'-infinity')<p_at-interval '8 hours' then return 'PRESENCE_STALE';end if;
 if p_driver.lat is null or p_driver.lng is null or coalesce(presence.location_at,p_driver.last_seen,'-infinity')<p_at-interval '8 hours' then return 'LOCATION_STALE';end if;
 if not coalesce(p_driver.lat between -90 and 90,false) or not coalesce(p_driver.lng between -180 and 180,false) then return 'LOCATION_INVALID';end if;
 distance:=6371*2*asin(least(1,sqrt(power(sin(radians(p_driver.lat-p_trip.pickup_lat)/2),2)+cos(radians(p_trip.pickup_lat))*cos(radians(p_driver.lat))*power(sin(radians(p_driver.lng-p_trip.pickup_lng)/2),2))));
 if distance>p_radius then return 'OUTSIDE_RADIUS';end if;
 if lower(coalesce(p_trip.ride_option,'go')) in('group','xl','go_xl') then
  if coalesce(p_driver.seating_capacity,0)<>7 then return 'VEHICLE_INCOMPATIBLE';end if;
 elsif coalesce(p_driver.seating_capacity,0)<3 then return 'VEHICLE_INCOMPATIBLE';end if;
 if not coalesce(public.phase6_new_work_eligible(p_driver.id),false) then return 'ONBOARDING';end if;
 if not coalesce((public.phase2_finance_eligibility(p_driver.id)->>'authoritative_eligible')::boolean,false) then return 'FINANCE';end if;
 if exists(select 1 from driver_trip_offers where trip_id=p_trip.id and driver_id=p_driver.id and status='declined') then return 'DECLINED';end if;
 return 'ELIGIBLE';
end $$;

create function public.broadcast_guard_offer() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if exists(select 1 from driver_broadcast_requests where trip_id=new.trip_id) then
  if new.broadcast_round_id is null or not exists(select 1 from driver_broadcast_rounds r where r.id=new.broadcast_round_id and r.trip_id=new.trip_id and not r.complete)
   then raise exception 'Broadcast trip requires its authoritative round' using errcode='P0001';end if;
 end if;return new;
end $$;
create trigger aa_broadcast_offer_guard before insert on public.driver_trip_offers for each row execute function public.broadcast_guard_offer();
create function public.broadcast_guard_window() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin if exists(select 1 from driver_broadcast_requests where trip_id=new.trip_id) then raise exception 'Broadcast policy cannot enter sequential matching';end if;return new;end $$;
create trigger aa_broadcast_window_guard before insert on public.dispatch_matching_windows for each row execute function public.broadcast_guard_window();

create function public.run_driver_broadcast(p_trip uuid,p_payment_attempt uuid default null,p_payment_claim uuid default null,p_worker_claim uuid default null,
 p_admin_restart boolean default false,p_manual_driver uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t trips%rowtype; req driver_broadcast_requests%rowtype; pay online_payment_attempts%rowtype;
 r driver_broadcast_rounds%rowtype; at_time timestamptz:=clock_timestamp(); expected integer; persisted integer; radius numeric;
begin
 perform broadcast_trusted();
 -- Trip-first locking also matches the existing paid reservation fence.
 select * into strict t from trips where id=p_trip for update;
 select * into req from driver_broadcast_requests where trip_id=p_trip for update;
 if not found then return jsonb_build_object('handled',false);end if;
 if t.pickup_lat is null or t.pickup_lng is null or not(t.pickup_lat between -90 and 90 and t.pickup_lng between -180 and 180) then
  raise exception 'Valid pickup coordinates required';end if;
 if t.status not in('requested','offered') or t.driver_id is not null then
  update driver_broadcast_requests set state='FINISHED',lease_token=null,lease_until=null where trip_id=p_trip;
  return jsonb_build_object('handled',true,'terminal',true,'offer_count',0);
 end if;
 if p_worker_claim is distinct from req.lease_token and req.lease_until>at_time then
  return jsonb_build_object('handled',true,'deferred',true,'offer_count',0);
 end if;
 if at_time>=req.deadline_at then return jsonb_build_object('handled',true,'deadline',true,'offer_count',0);end if;
 if req.cycle>0 and req.next_run_at>at_time then
  return jsonb_build_object('handled',true,'replayed',true,'offer_count',(select persisted_count from driver_broadcast_rounds where trip_id=p_trip and cycle=req.cycle));
 end if;
 if req.cycle>=3 and not p_admin_restart then
  update driver_broadcast_requests set next_run_at=deadline_at,lease_token=null,lease_until=null where trip_id=p_trip;
  return jsonb_build_object('handled',true,'deferred',true,'offer_count',0);
 end if;
 perform public.phase3_assert_trip_dispatchable(p_trip);
 if lower(coalesce(t.payment_method,'cash'))='online' and req.cycle=0 then
  select * into pay from online_payment_attempts where id=p_payment_attempt and trip_id=p_trip for update;
  if not found or pay.state<>'SUCCEEDED' or pay.dispatch_claim_token is distinct from p_payment_claim
   or pay.dispatch_claim_until<=at_time or pay.dispatch_round_id is null or pay.dispatch_state='DISPATCHED'
   or (pay.dispatch_round_started_by is not null and pay.dispatch_round_started_by is distinct from p_payment_claim) then
   raise exception 'Payment dispatch ownership required' using errcode='P0D01';end if;
  perform set_config('moovu.payment_dispatch_claim_token',p_payment_claim::text,true);
 end if;
 update driver_trip_offers set status='expired',expired_at=at_time,updated_at=at_time
  where trip_id=p_trip and status in('pending','shown') and accept_deadline_at<=at_time;
 if exists(select 1 from driver_trip_offers where trip_id=p_trip and status in('pending','shown') and accept_deadline_at>at_time) then
  return jsonb_build_object('handled',true,'deferred',true,'offer_count',0);
 end if;
 radius:=case req.cycle when 0 then 8 when 1 then 14 else 20 end;
 insert into driver_broadcast_rounds(trip_id,cycle,snapshot_at,expires_at,radius_km,admin_requested,manual_driver_id)
  values(p_trip,req.cycle+1,at_time,least(at_time+interval '25 seconds',req.deadline_at),radius,p_admin_restart,
   case when req.cycle>0 and p_admin_restart then p_manual_driver else null end) returning * into r;
 -- One statement snapshot: no push-token/device filter is allowed in eligibility.
 insert into driver_broadcast_recipients(round_id,driver_id,reason_code)
  select r.id,d.id,case when r.manual_driver_id is not null and d.id<>r.manual_driver_id then 'MANUAL_NOT_TARGETED'
   else public.broadcast_driver_reason(t,d,at_time,radius) end from drivers d where d.online order by d.id;
 select count(*) into expected from driver_broadcast_recipients where round_id=r.id and reason_code='ELIGIBLE';
 insert into driver_trip_offers(trip_id,driver_id,status,offered_at,visible_until,escalates_at,accept_deadline_at,
  dispatch_cycle,sequence_number,search_radius_km,broadcast_round_id,payment_dispatch_round_id)
  select p_trip,x.driver_id,'shown',at_time,r.expires_at,r.expires_at,r.expires_at,r.cycle,
   row_number() over(order by x.driver_id),radius,r.id,pay.dispatch_round_id
  from driver_broadcast_recipients x where x.round_id=r.id and x.reason_code='ELIGIBLE';
 get diagnostics persisted=row_count;
 if expected<>persisted then raise exception 'Broadcast recipient reconciliation failed';end if;
 update driver_broadcast_recipients x set offer_id=o.id from driver_trip_offers o
  where x.round_id=r.id and o.broadcast_round_id=r.id and o.driver_id=x.driver_id;
 insert into driver_offer_device_jobs(offer_id,user_id,transport,device_ref,expires_at)
  select o.id,a.user_id,'fcm',f.id,o.accept_deadline_at from driver_trip_offers o join driver_accounts a on a.driver_id=o.driver_id
   join (select distinct on(user_id,role,app_type,coalesce(nullif(device_id,''),id::text)) * from fcm_tokens
    where role='driver' and enabled order by user_id,role,app_type,coalesce(nullif(device_id,''),id::text),updated_at desc nulls last,id) f on f.user_id=a.user_id
  where o.broadcast_round_id=r.id and (f.app_type is null or f.app_type in('android_driver','ios_driver','web_driver'))
  on conflict(offer_id,transport,device_ref) do nothing;
 insert into driver_offer_device_jobs(offer_id,user_id,transport,device_ref,expires_at)
  select o.id,a.user_id,'web',s.id,o.accept_deadline_at from driver_trip_offers o join driver_accounts a on a.driver_id=o.driver_id
   join push_subscriptions s on s.user_id=a.user_id and s.role='driver'
  where o.broadcast_round_id=r.id on conflict(offer_id,transport,device_ref) do nothing;
 update driver_broadcast_rounds set expected_count=expected,persisted_count=persisted,complete=true,completed_at=clock_timestamp() where id=r.id;
 update driver_broadcast_requests set state='ACTIVE',cycle=r.cycle,next_run_at=case when r.cycle>3 then deadline_at else r.expires_at end,
  lease_token=null,lease_until=null,failure_count=0,last_error_code=null where trip_id=p_trip;
 if expected>0 then update trips set status='offered',offer_status='pending',offer_expires_at=r.expires_at,
  dispatch_started_at=coalesce(dispatch_started_at,at_time),dispatch_cycle=r.cycle,dispatch_state='searching',dispatch_updated_at=at_time where id=p_trip;end if;
 if pay.id is not null then update online_payment_attempts set dispatch_round_started_by=coalesce(dispatch_round_started_by,p_payment_claim),
  dispatch_claim_until=clock_timestamp()+interval '120 seconds' where id=pay.id;end if;
 return jsonb_build_object('handled',true,'round_id',r.id,'offer_count',persisted,'expected_count',expected,'expires_at',r.expires_at);
end $$;

create function public.claim_driver_broadcasts(p_limit integer default 20) returns setof public.driver_broadcast_requests
language plpgsql security definer set search_path=public,pg_temp as $$
begin perform broadcast_trusted();return query
 with due as(select q.trip_id from driver_broadcast_requests q where q.state in('PENDING','ACTIVE') and q.next_run_at<=clock_timestamp()
  and (q.lease_until is null or q.lease_until<clock_timestamp()) and q.claim_count<100
  order by q.next_run_at,q.trip_id limit greatest(1,least(p_limit,50)) for update skip locked)
 update driver_broadcast_requests q set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '30 seconds',claim_count=claim_count+1
  from due where q.trip_id=due.trip_id returning q.*;
end $$;

create function public.fail_driver_broadcast(p_trip uuid,p_claim uuid,p_code text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin perform broadcast_trusted();update driver_broadcast_requests set failure_count=failure_count+1,
 state=case when failure_count>=4 then 'FAILED' else state end,next_run_at=clock_timestamp()+make_interval(secs=>least(120,10*(2^least(failure_count,4))::integer)),
 lease_token=null,lease_until=null,last_error_code=left(p_code,80) where trip_id=p_trip and lease_token=p_claim;end $$;

create function public.claim_driver_offer_devices(p_limit integer default 100) returns setof public.driver_offer_device_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform broadcast_trusted();
 update driver_offer_device_jobs set state='EXPIRED',lease_token=null,lease_until=null
  where state in('PENDING','SENDING') and expires_at<=clock_timestamp();
 return query with due as(select j.id from driver_offer_device_jobs j join driver_trip_offers o on o.id=j.offer_id
  join trips t on t.id=o.trip_id join drivers d on d.id=o.driver_id
  where ((j.state='PENDING' and j.next_run_at<=clock_timestamp()) or (j.state='SENDING' and j.lease_until<clock_timestamp()))
   and j.attempts<5 and j.expires_at>clock_timestamp() and o.status in('pending','shown') and d.online and not coalesce(d.busy,false)
   and t.status in('requested','offered') and t.driver_id is null
  order by j.next_run_at,j.id limit greatest(1,least(p_limit,200)) for update of j skip locked)
 update driver_offer_device_jobs j set state='SENDING',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '10 seconds'
  from due where j.id=due.id returning j.*;
end $$;

create function public.finish_driver_offer_device(p_job uuid,p_claim uuid,p_state text,p_code text default null,p_retry_seconds integer default 10)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform broadcast_trusted();
 if p_state not in('ACCEPTED','INVALID','UNAVAILABLE','PENDING','FAILED','CANCELLED') then raise exception 'Invalid device result';end if;
 update driver_offer_device_jobs set state=case when expires_at<=clock_timestamp() then 'EXPIRED'
  when p_state='PENDING' and attempts>=5 then 'FAILED' else p_state end,
  next_run_at=clock_timestamp()+make_interval(secs=>greatest(10,least(p_retry_seconds,3600))),error_code=left(p_code,80),
  provider_accepted_at=case when p_state='ACCEPTED' then clock_timestamp() else provider_accepted_at end,lease_token=null,lease_until=null
  where id=p_job and lease_token=p_claim and state='SENDING';
 return found;
end $$;

create function public.broadcast_terminal_cleanup() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.driver_id is not null or new.status not in('requested','offered') then
  update driver_broadcast_requests set state='FINISHED',lease_token=null,lease_until=null where trip_id=new.id;
  update driver_offer_device_jobs j set state='CANCELLED',lease_token=null,lease_until=null
   from driver_trip_offers o where o.trip_id=new.id and j.offer_id=o.id and j.state in('PENDING','SENDING');
 end if;return new;
end $$;
create trigger zz_broadcast_terminal after update of status,driver_id on public.trips for each row execute function public.broadcast_terminal_cleanup();

create function public.broadcast_accept_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare t trips%rowtype; d drivers%rowtype; radius numeric; reason text;
begin
 if new.broadcast_round_id is not null and new.status='accepted' and old.status is distinct from new.status then
  select * into strict t from trips where id=new.trip_id;
  select * into strict d from drivers where id=new.driver_id;
  select radius_km into strict radius from driver_broadcast_rounds where id=new.broadcast_round_id;
  reason:=broadcast_driver_reason(t,d,clock_timestamp(),radius);
  if reason<>'ELIGIBLE' then raise exception 'Driver eligibility changed: %',reason using errcode='P0001';end if;
 end if;return new;
end $$;
create trigger aa_broadcast_accept before update of status on public.driver_trip_offers for each row execute function public.broadcast_accept_guard();

create function public.record_driver_offer_receipt(p_offer uuid,p_user uuid,p_type text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin perform broadcast_trusted();
 if p_type not in('FETCHED','DISPLAYED') then raise exception 'Invalid receipt';end if;
 insert into driver_offer_receipts(offer_id,user_id,receipt_type)
 select o.id,p_user,p_type from driver_trip_offers o join driver_accounts a on a.driver_id=o.driver_id
  where o.id=p_offer and a.user_id=p_user and o.broadcast_round_id is not null
 on conflict do nothing;
end $$;

-- Do not retain the transaction-start timestamp when acceptance waited on a lock.
do $$ declare body text; begin
 if md5(pg_get_functiondef('public.accept_trip_offer(uuid,uuid,text)'::regprocedure))<>'1c097974aee6a56bf0a06d5134b65c9b' then
  raise exception 'Acceptance differs from reviewed production definition';end if;
 body:=pg_get_functiondef('public.accept_trip_offer(uuid,uuid,text)'::regprocedure);
 execute replace(body,'v_offer.accept_deadline_at <= now()','v_offer.accept_deadline_at <= clock_timestamp()');
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like 'broadcast_%' or p.proname in('run_driver_broadcast','refresh_driver_offer_presence',
  'claim_driver_broadcasts','fail_driver_broadcast','claim_driver_offer_devices','finish_driver_offer_device','record_driver_offer_receipt')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('run_driver_broadcast','refresh_driver_offer_presence','claim_driver_broadcasts','fail_driver_broadcast',
   'claim_driver_offer_devices','finish_driver_offer_device','record_driver_offer_receipt') then
   execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
commit;
