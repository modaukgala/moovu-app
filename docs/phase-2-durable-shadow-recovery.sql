-- MOOVU Phase 2 durable SHADOW recovery.
-- Installs a service-role-only bounded work queue and atomically enqueues future
-- completed post-cutoff trips. Phase 2 remains SHADOW; no historical trip is backfilled.
begin;

create table if not exists public.phase2_shadow_recovery_jobs (
  id uuid primary key default gen_random_uuid(),
  operation_key text not null unique,
  trip_id uuid not null unique references public.trips(id) on delete restrict,
  business_event_id uuid not null unique references public.moovu_business_events(id) on delete restrict,
  actor_id uuid null,
  status text not null default 'pending' check(status in ('pending','processing','retryable_failure','succeeded','terminal_failure')),
  attempts integer not null default 0 check(attempts between 0 and 8),
  locked_at timestamptz null,
  last_attempt_at timestamptz null,
  next_attempt_at timestamptz not null default now(),
  succeeded_at timestamptz null,
  last_error_code text null,
  last_error_message text null,
  financial_transaction_id uuid null references public.financial_transactions(id) on delete restrict,
  reconciliation_id uuid null references public.phase2_shadow_reconciliations(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists phase2_shadow_recovery_due_idx
  on public.phase2_shadow_recovery_jobs(status,next_attempt_at,created_at)
  where status in ('pending','processing','retryable_failure');
alter table public.phase2_shadow_recovery_jobs enable row level security;
revoke all on public.phase2_shadow_recovery_jobs from public,anon,authenticated,service_role;
grant select on public.phase2_shadow_recovery_jobs to service_role;

create or replace function public.phase2_enqueue_shadow_trip_recovery(
  p_trip_id uuid,p_actor_id uuid,p_business_event_id uuid
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_policy public.phase2_finance_policy; v_trip public.trips; v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into strict v_policy from public.phase2_finance_policy where policy_key='phase2-driver-finance';
  select * into strict v_trip from public.trips where id=p_trip_id;
  if v_policy.mode<>'SHADOW' or v_policy.effective_from is null or v_trip.created_at<v_policy.effective_from then return null; end if;
  if v_trip.status<>'completed' or v_trip.driver_id is null then raise exception 'Completed assigned trip required'; end if;
  if not exists(select 1 from public.moovu_business_events where id=p_business_event_id and aggregate_id=p_trip_id
    and event_key='trip-complete:'||p_trip_id::text and event_type='trip_completed') then
    raise exception 'Authoritative completion event required'; end if;
  insert into public.phase2_shadow_recovery_jobs(operation_key,trip_id,business_event_id,actor_id)
  values('trip_commission:'||p_trip_id::text,p_trip_id,p_business_event_id,p_actor_id)
  on conflict(operation_key) do update set actor_id=coalesce(public.phase2_shadow_recovery_jobs.actor_id,excluded.actor_id),updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.phase2_claim_shadow_recovery_job(p_operation_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.phase2_shadow_recovery_jobs;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into v_job from public.phase2_shadow_recovery_jobs where operation_key=p_operation_key for update skip locked;
  if not found or v_job.status in ('succeeded','terminal_failure') or v_job.attempts>=8
    or (v_job.status='processing' and v_job.locked_at>now()-interval '5 minutes')
    or (v_job.status='retryable_failure' and v_job.next_attempt_at>now()) then
    return jsonb_build_object('contract_version',public.phase2_contract_version(),'claimed',false);
  end if;
  update public.phase2_shadow_recovery_jobs set status='processing',attempts=attempts+1,locked_at=now(),last_attempt_at=now(),updated_at=now()
    where id=v_job.id returning * into v_job;
  return jsonb_build_object('contract_version',public.phase2_contract_version(),'claimed',true,'job',to_jsonb(v_job));
end $$;

create or replace function public.phase2_claim_shadow_recovery_jobs(p_limit integer default 20)
returns setof public.phase2_shadow_recovery_jobs language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  return query with due as (
    select id from public.phase2_shadow_recovery_jobs
    where attempts<8 and (
      (status='pending' and next_attempt_at<=now()) or
      (status='retryable_failure' and next_attempt_at<=now()) or
      (status='processing' and locked_at<=now()-interval '5 minutes')
    ) order by next_attempt_at,created_at for update skip locked limit greatest(1,least(100,p_limit))
  ) update public.phase2_shadow_recovery_jobs j
    set status='processing',attempts=attempts+1,locked_at=now(),last_attempt_at=now(),updated_at=now()
    from due where j.id=due.id returning j.*;
end $$;

create or replace function public.phase2_finish_shadow_recovery_job(
  p_job_id uuid,p_succeeded boolean,p_retryable boolean,p_error_code text default null,p_error_message text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.phase2_shadow_recovery_jobs; v_tx uuid; v_rec uuid; v_status text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into strict v_job from public.phase2_shadow_recovery_jobs where id=p_job_id for update;
  if v_job.status='succeeded' then return jsonb_build_object('contract_version',public.phase2_contract_version(),'status','succeeded','replayed',true); end if;
  if v_job.status<>'processing' then raise exception 'Claimed recovery job required'; end if;
  if p_succeeded then
    select id into v_tx from public.financial_transactions where idempotency_key=v_job.operation_key and transaction_state='POSTED';
    select id into v_rec from public.phase2_shadow_reconciliations where operation_key=v_job.operation_key;
    if v_tx is null or v_rec is null then raise exception 'Completed recovery evidence is incomplete'; end if;
    update public.phase2_shadow_recovery_jobs set status='succeeded',locked_at=null,succeeded_at=now(),last_error_code=null,
      last_error_message=null,financial_transaction_id=v_tx,reconciliation_id=v_rec,updated_at=now() where id=v_job.id;
    return jsonb_build_object('contract_version',public.phase2_contract_version(),'status','succeeded','replayed',false,
      'financial_transaction_id',v_tx,'reconciliation_id',v_rec);
  end if;
  v_status:=case when p_retryable and v_job.attempts<8 then 'retryable_failure' else 'terminal_failure' end;
  update public.phase2_shadow_recovery_jobs set status=v_status,locked_at=null,last_error_code=left(coalesce(p_error_code,'unknown'),100),
    last_error_message=left(coalesce(p_error_message,'Phase 2 SHADOW recovery failed.'),500),
    next_attempt_at=case when v_status='retryable_failure' then now()+make_interval(secs=>least(3600,30*(2^greatest(0,attempts-1))::integer)) else next_attempt_at end,
    updated_at=now() where id=v_job.id;
  return jsonb_build_object('contract_version',public.phase2_contract_version(),'status',v_status,'replayed',false);
end $$;

create or replace function public.phase05b_complete_trip(
  p_trip_id uuid,p_actor_id uuid,p_expected_driver_id uuid,p_mode text,p_otp text,p_reason text,p_note text,
  p_expected_financial_version bigint,p_expected_fare numeric,p_distance_audit text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare t public.trips%rowtype; v_role text; v_started timestamptz; v_min integer; v_elapsed integer;
        v_fare numeric(12,2); v_pct numeric(7,3); v_comm numeric(12,2); v_net numeric(12,2);
        v_wallet uuid; v_event uuid; v_replayed boolean:=false;
begin
  if p_mode not in ('otp','bypass','admin') then raise exception 'Invalid completion mode' using errcode='P0001'; end if;
  select * into t from public.trips where id=p_trip_id for update;
  if not found then raise exception 'Trip not found' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||coalesce(t.driver_id::text,''),0));
  if t.status='completed' then
    if exists(select 1 from public.moovu_business_events where event_key='trip-complete:'||t.id::text) then v_replayed:=true;
    else raise exception 'Completed trip has no authoritative completion event' using errcode='P0001'; end if;
  elsif t.status<>'ongoing' then raise exception 'Trip is not ongoing' using errcode='P0001'; end if;
  if t.driver_id is null or (p_expected_driver_id is not null and t.driver_id<>p_expected_driver_id) then
    raise exception 'Trip driver ownership changed' using errcode='P0001'; end if;
  select role into v_role from public.profiles where id=p_actor_id;
  if p_mode='admin' then
    if v_role not in ('owner','admin','dispatcher','support') then raise exception 'Admin completion not authorized' using errcode='P0001'; end if;
    if length(trim(coalesce(p_note,'')))<3 then raise exception 'Admin completion note required' using errcode='P0001'; end if;
  else
    if not exists(select 1 from public.driver_accounts where user_id=p_actor_id and driver_id=t.driver_id) then
      raise exception 'Driver completion not authorized' using errcode='P0001'; end if;
  end if;
  if v_replayed then
    select id into v_event from public.moovu_business_events where event_key='trip-complete:'||t.id::text;
    perform public.phase2_enqueue_shadow_trip_recovery(t.id,p_actor_id,v_event);
    return jsonb_build_object('contract_version',public.phase05b_contract_version(),'trip_id',t.id,'driver_id',t.driver_id,
      'fare_amount',t.fare_amount,'commission_pct',t.commission_pct,'commission_amount',t.commission_amount,
      'driver_net',t.driver_net_earnings,'replayed',true);
  end if;
  if not coalesce(t.start_otp_verified,false) then raise exception 'Start OTP was not verified' using errcode='P0001'; end if;
  if p_mode='otp' and (t.end_otp is null or trim(coalesce(p_otp,''))<>t.end_otp) then raise exception 'Incorrect End OTP' using errcode='P0001'; end if;
  if p_mode='bypass' and coalesce(p_reason,'') not in ('Customer phone unavailable/dead','Customer unable to access OTP','Connectivity issue','Customer left vehicle','Other') then
    raise exception 'Valid End OTP bypass reason required' using errcode='P0001'; end if;
  if p_mode='bypass' and p_reason='Other' and length(trim(coalesce(p_note,'')))<3 then raise exception 'Bypass note required' using errcode='P0001'; end if;
  v_started:=coalesce(t.trip_started_at,(select max(created_at) from public.trip_events where trip_id=t.id and event_type='trip_started'));
  if v_started is null then raise exception 'Trip start record missing' using errcode='P0001'; end if;
  v_elapsed:=floor(extract(epoch from(now()-v_started))); v_min:=least(600,greatest(120,round(coalesce(t.duration_min,0)*12)::integer));
  if v_elapsed<v_min then raise exception 'Minimum trip duration has not elapsed' using errcode='P0001'; end if;
  if t.financial_version<>p_expected_financial_version then raise exception 'Trip fare changed during completion' using errcode='P0001'; end if;
  v_fare:=case when t.phase5_policy_version is not null then t.phase5_driver_fare_basis_cents::numeric/100 else round(coalesce(t.final_fare,t.fare_amount,t.estimated_fare,t.original_fare),2) end;
  if v_fare<=0 or abs(v_fare-p_expected_fare)>0.009 then raise exception 'Authoritative fare mismatch' using errcode='P0001'; end if;
  v_pct:=case when lower(coalesce(t.ride_option,'')) in ('group','xl','moovu_go_xl') then 12
              when lower(coalesce(t.ride_option,'')) in ('go','standard','moovu_go') then 10 else 9.5 end;
  v_comm:=round(v_fare*v_pct/100,2); v_net:=round(v_fare-v_comm,2);
  insert into public.driver_wallets(driver_id,balance_due,total_commission,total_driver_net,total_trips_completed,account_status,updated_at)
    values(t.driver_id,0,0,0,0,'settled',now()) on conflict(driver_id) do nothing;
  select id into v_wallet from public.driver_wallets where driver_id=t.driver_id for update;
  insert into public.driver_wallet_transactions(driver_id,wallet_id,trip_id,tx_type,amount,direction,description,meta,created_by)
    values(t.driver_id,v_wallet,t.id,'commission',v_comm,'debit',v_pct||'% MOOVU commission charged on trip '||t.id,
      jsonb_build_object('fare_amount',t.fare_amount,'driver_fare_basis',v_fare,'commission_pct',v_pct,'driver_net',v_net,'contract_version',public.phase05b_contract_version()),p_actor_id);
  update public.trips set status='completed',completed_at=now(),fare_amount=case when phase5_policy_version is null then v_fare else fare_amount end,final_fare=case when phase5_policy_version is null then v_fare else final_fare end,
    commission_pct=v_pct,commission_amount=v_comm,driver_net_earnings=v_net,end_otp_verified=(p_mode='otp'),
    completed_without_end_otp=(p_mode='bypass'),end_otp_bypass_reason=case when p_mode='bypass' then p_reason else null end,
    end_otp_bypass_note=case when p_mode='bypass' then nullif(trim(p_note),'') else null end,
    end_otp_bypassed_by=case when p_mode='bypass' then p_actor_id else null end,
    end_otp_bypassed_at=case when p_mode='bypass' then now() else null end,
    completed_by=case when p_mode='admin' then 'admin' else 'driver' end,
    admin_completion_reason=case when p_mode='admin' then p_note else null end,
    admin_completion_note=case when p_mode='admin' then p_note else null end,
    fare_finalized_at=now(),fare_adjustment_reason=case when coalesce(fare_adjustment_amount,0)>0 then 'active_stop_added' else 'finalized_without_adjustment' end
    where id=t.id;
  if t.phase5_policy_version is not null then
    perform public.phase5_post_service_fee(t.id,p_actor_id);
    perform public.phase5_qualify_referral(t.id,p_actor_id);
  end if;
  update public.drivers set busy=false where id=t.driver_id;
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status,created_by)
    values(t.id,'trip_completed',coalesce(p_distance_audit,'Trip completed.')||' Mode: '||p_mode,'ongoing','completed',p_actor_id);
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
    values('trip-complete:'||t.id::text,'trip_completed','trip',t.id,p_actor_id,
      jsonb_build_object('driver_id',t.driver_id,'fare_amount',t.fare_amount,'driver_fare_basis',v_fare,'commission_pct',v_pct,'commission_amount',v_comm,'mode',p_mode))
    returning id into v_event;
  perform public.phase2_enqueue_shadow_trip_recovery(t.id,p_actor_id,v_event);
  insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
    values(v_event,'trip_completed',jsonb_build_object('trip_id',t.id,'driver_id',t.driver_id,'fare_amount',t.fare_amount,'driver_fare_basis',v_fare));
  perform public.phase05b_refresh_driver_wallet(t.driver_id);
  return jsonb_build_object('contract_version',public.phase05b_contract_version(),'trip_id',t.id,'driver_id',t.driver_id,
    'fare_amount',t.fare_amount,'driver_fare_basis',v_fare,'commission_pct',v_pct,'commission_amount',v_comm,'driver_net',v_net,'replayed',false);
end $$;

revoke all on function public.phase2_enqueue_shadow_trip_recovery(uuid,uuid,uuid),
  public.phase2_claim_shadow_recovery_job(text),public.phase2_claim_shadow_recovery_jobs(integer),
  public.phase2_finish_shadow_recovery_job(uuid,boolean,boolean,text,text) from public,anon,authenticated;
grant execute on function public.phase2_enqueue_shadow_trip_recovery(uuid,uuid,uuid),
  public.phase2_claim_shadow_recovery_job(text),public.phase2_claim_shadow_recovery_jobs(integer),
  public.phase2_finish_shadow_recovery_job(uuid,boolean,boolean,text,text) to service_role;

commit;
