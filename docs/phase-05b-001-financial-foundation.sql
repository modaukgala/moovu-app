-- MOOVU Phase 0.5B - financial foundation and atomic payment review
-- REVIEW ONLY / NOT APPLIED / DO NOT EXECUTE WITHOUT APPROVED PREFLIGHT.
-- Existing rows are never rewritten or deleted by this migration.
-- Requires pgcrypto/gen_random_uuid(), the existing finance tables, profiles,
-- drivers, and the columns inspected by docs/phase-05-preflight.sql.

begin;

do $$
declare v_name text;
begin
  foreach v_name in array array[
    'profiles','drivers','driver_payment_requests','driver_wallets',
    'driver_settlements','driver_subscription_payments',
    'driver_wallet_transactions','trips'
  ] loop
    if to_regclass('public.' || v_name) is null then
      raise exception 'Phase 0.5B prerequisite missing: public.%', v_name;
    end if;
  end loop;
end $$;

alter table public.driver_payment_requests
  add column if not exists operation_key text,
  add column if not exists subscription_amount_applied numeric(12,2) not null default 0,
  add column if not exists commission_amount_applied numeric(12,2) not null default 0,
  add column if not exists unapplied_excess numeric(12,2) not null default 0,
  add column if not exists contract_version text;

alter table public.driver_settlements
  add column if not exists payment_request_id uuid,
  add column if not exists operation_key text;

alter table public.driver_subscription_payments
  add column if not exists payment_request_id uuid,
  add column if not exists operation_key text;

-- Cached wallets are projections. Abort unless production history reconciles
-- under the currently approved Phase 0 formula; never establish an opening
-- balance from the cache alone.
do $$ begin
  if exists (
    select 1 from public.driver_wallets w
    left join lateral (select coalesce(sum(t.commission_amount),0) gross from public.trips t
      where t.driver_id=w.driver_id and t.status='completed') c on true
    left join lateral (select coalesce(sum(s.amount_paid),0) paid from public.driver_settlements s
      where s.driver_id=w.driver_id) s on true
    left join lateral (select coalesce(sum(x.amount),0) credits from public.driver_wallet_transactions x
      where x.driver_id=w.driver_id and x.tx_type='cancellation_credit' and x.direction='credit') x on true
    where abs(coalesce(w.balance_due,0)-greatest(0,c.gross-s.paid-x.credits)) > 0.005
  ) then raise exception 'Driver wallet projection reconciliation required before Phase 0.5B'; end if;
end $$;

-- Abort instead of silently merging historical duplicates.
do $$ begin
  if exists (select 1 from public.driver_payment_requests where operation_key is not null group by operation_key having count(*) > 1) then
    raise exception 'Duplicate driver_payment_requests.operation_key values require reconciliation';
  end if;
  if exists (select 1 from public.driver_settlements where payment_request_id is not null group by payment_request_id having count(*) > 1) then
    raise exception 'Duplicate payment-linked settlements require reconciliation';
  end if;
  if exists (select 1 from public.driver_subscription_payments where payment_request_id is not null group by payment_request_id having count(*) > 1) then
    raise exception 'Duplicate payment-linked subscriptions require reconciliation';
  end if;
end $$;

create unique index if not exists driver_payment_requests_operation_uidx
  on public.driver_payment_requests(operation_key) where operation_key is not null;
create unique index if not exists driver_settlements_payment_request_uidx
  on public.driver_settlements(payment_request_id) where payment_request_id is not null;
create unique index if not exists driver_subscription_payments_request_uidx
  on public.driver_subscription_payments(payment_request_id) where payment_request_id is not null;
create unique index if not exists driver_settlements_operation_uidx
  on public.driver_settlements(operation_key) where operation_key is not null;
create unique index if not exists driver_subscription_payments_operation_uidx
  on public.driver_subscription_payments(operation_key) where operation_key is not null;

create table if not exists public.moovu_business_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  actor_id uuid null references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.moovu_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  business_event_id uuid not null unique references public.moovu_business_events(id) on delete restrict,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','delivered','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  locked_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists moovu_notification_outbox_due_idx
  on public.moovu_notification_outbox(status,next_attempt_at,created_at);

-- A business event may fan out to multiple users. The per-user event key makes
-- visible notification history idempotent when a worker retries after a crash.
alter table public.app_notifications
  add column if not exists event_key text;
create unique index if not exists app_notifications_user_event_key_uidx
  on public.app_notifications(user_id,event_key);

-- Notification delivery is a trusted-server mutation. Authenticated users may
-- read only their own history; anon has no direct access.
alter table public.app_notifications enable row level security;
revoke all on public.app_notifications from public,anon,authenticated;
grant select on public.app_notifications to authenticated;
grant select,insert,update,delete on public.app_notifications to service_role;
drop policy if exists app_notifications_select_own on public.app_notifications;
create policy app_notifications_select_own on public.app_notifications
  for select to authenticated using (user_id = (select auth.uid()));

alter table public.moovu_business_events enable row level security;
alter table public.moovu_notification_outbox enable row level security;
revoke all on public.moovu_business_events from public, anon, authenticated;
revoke all on public.moovu_notification_outbox from public, anon, authenticated;
grant select,insert,update on public.moovu_business_events to service_role;
grant select,insert,update on public.moovu_notification_outbox to service_role;

create or replace function public.phase05b_contract_version()
returns text language sql immutable set search_path = public, pg_temp
as $$ select 'phase-05b-v1'::text $$;

-- Complete dataset calculation; no PostgREST row-return dependency.
create or replace function public.phase05b_driver_debt(p_driver_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_commission numeric(14,2); v_net numeric(14,2); v_trips bigint;
        v_settled numeric(14,2); v_credits numeric(14,2); v_unapplied numeric(14,2); v_due numeric(14,2);
begin
  select coalesce(sum(commission_amount),0),
         coalesce(sum(coalesce(driver_net_earnings, fare_amount - coalesce(commission_amount,0))),0), count(*)
    into v_commission,v_net,v_trips from public.trips
    where driver_id=p_driver_id and status='completed';
  select coalesce(sum(amount_paid),0) into v_settled from public.driver_settlements where driver_id=p_driver_id;
  select coalesce(sum(amount),0) into v_credits from public.driver_wallet_transactions
    where driver_id=p_driver_id and tx_type='cancellation_credit' and direction='credit';
  select coalesce(sum(unapplied_excess),0) into v_unapplied from public.driver_payment_requests
    where driver_id=p_driver_id and status='approved';
  v_due := greatest(0, round(v_commission-v_settled-v_credits,2));
  return jsonb_build_object('contract_version',public.phase05b_contract_version(),
    'driver_id',p_driver_id,'total_commission',round(v_commission,2),
    'total_driver_net',round(v_net+v_credits,2),'total_trips_completed',v_trips,
    'total_settled',round(v_settled,2),'cancellation_credits',round(v_credits,2),
    'unapplied_credit',round(v_unapplied,2),'balance_due',v_due);
end $$;

-- Existing client callers use the service-role API path. Remove direct mutation
-- and unsafe function execution while retaining RLS-governed reads.
revoke insert,update,delete,truncate on public.driver_wallets,public.driver_wallet_transactions,
  public.driver_settlements,public.driver_subscription_payments from anon,authenticated;
revoke execute on function public.refresh_driver_subscription(uuid) from public,anon,authenticated;
revoke execute on function public.increment_driver_offer_received(uuid) from public,anon,authenticated;
grant execute on function public.refresh_driver_subscription(uuid) to service_role;
grant execute on function public.increment_driver_offer_received(uuid) to service_role;
alter function public.is_staff() set search_path = public, pg_temp;
alter function public.refresh_driver_subscription(uuid) set search_path = public, pg_temp;
alter function public.increment_driver_offer_received(uuid) set search_path = public, pg_temp;

create or replace function public.phase05b_refresh_driver_wallet(p_driver_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||p_driver_id::text,0));
  v_result := public.phase05b_driver_debt(p_driver_id);
  insert into public.driver_wallets(driver_id,balance_due,total_commission,total_driver_net,total_trips_completed,account_status,updated_at)
  values(p_driver_id,(v_result->>'balance_due')::numeric,(v_result->>'total_commission')::numeric,
    (v_result->>'total_driver_net')::numeric,(v_result->>'total_trips_completed')::bigint,
    case when (v_result->>'balance_due')::numeric>0 then 'due' else 'settled' end,now())
  on conflict(driver_id) do update set balance_due=excluded.balance_due,total_commission=excluded.total_commission,
    total_driver_net=excluded.total_driver_net,total_trips_completed=excluded.total_trips_completed,
    account_status=excluded.account_status,updated_at=now();
  return v_result;
end $$;

create or replace function public.phase05b_review_driver_payment(
  p_request_id uuid, p_action text, p_review_note text, p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.driver_payment_requests%rowtype; d public.drivers%rowtype; w public.driver_wallets%rowtype;
        v_role text; v_sub numeric(12,2):=0; v_comm numeric(12,2):=0; v_excess numeric(12,2):=0;
        v_amount numeric(12,2); v_plan_amount numeric(12,2):=0; v_expiry timestamptz; v_event uuid;
begin
  if p_action not in ('approve','reject','waiting') then raise exception 'Invalid payment action' using errcode='P0001'; end if;
  select role into v_role from public.profiles where id=p_actor_id;
  -- CURRENT permissions only; final least-privilege matrix requires owner approval.
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Financial review is not authorized' using errcode='P0001';
  end if;
  select * into r from public.driver_payment_requests where id=p_request_id for update;
  if not found then raise exception 'Payment request not found' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||r.driver_id::text,0));
  select * into d from public.drivers where id=r.driver_id for update;
  if not found then raise exception 'Driver not found' using errcode='P0001'; end if;
  select * into w from public.driver_wallets where driver_id=r.driver_id for update;

  if r.status='approved' then
    if p_action<>'approve' then raise exception 'Approved payment cannot change state' using errcode='P0001'; end if;
    return jsonb_build_object('contract_version',public.phase05b_contract_version(),'request_id',r.id,'driver_id',r.driver_id,
      'status',r.status,'payment_type',r.payment_type,'subscription_applied',r.subscription_amount_applied,
      'commission_applied',r.commission_amount_applied,'unapplied_excess',r.unapplied_excess,'replayed',true);
  end if;
  if r.status='rejected' then
    if p_action<>'reject' then raise exception 'Rejected payment requires a new request' using errcode='P0001'; end if;
    return jsonb_build_object('contract_version',public.phase05b_contract_version(),'request_id',r.id,'driver_id',r.driver_id,
      'status',r.status,'payment_type',r.payment_type,'subscription_applied',0,'commission_applied',0,
      'unapplied_excess',coalesce(r.unapplied_excess,0),'replayed',true);
  end if;
  if r.status not in ('pending','pending_payment_review','waiting_confirmation') then
    raise exception 'Unsupported payment state: %',r.status using errcode='P0001';
  end if;

  if p_action in ('reject','waiting') then
    update public.driver_payment_requests set status=case when p_action='reject' then 'rejected' else 'waiting_confirmation' end,
      review_note=nullif(trim(p_review_note),''),reviewed_at=now(),reviewed_by=p_actor_id,
      operation_key='payment-review:'||r.id::text||':'||p_action,contract_version=public.phase05b_contract_version()
      where id=r.id returning * into r;
  else
    v_amount:=round(coalesce(r.amount_submitted,0),2);
    if v_amount<=0 then raise exception 'Submitted amount must be greater than zero' using errcode='P0001'; end if;
    if r.payment_type not in ('subscription','commission','combined') then raise exception 'Invalid payment type' using errcode='P0001'; end if;
    if r.payment_type in ('subscription','combined') then
      v_plan_amount:=case r.subscription_plan when 'day' then 45 when 'week' then 100 when 'month' then 250 else null end;
      if v_plan_amount is null then raise exception 'Valid subscription plan required' using errcode='P0001'; end if;
      if v_amount+0.009<v_plan_amount then raise exception 'Submitted amount is below subscription amount' using errcode='P0001'; end if;
      v_sub:=v_plan_amount;
    end if;
    if r.payment_type in ('commission','combined') then
      v_comm:=least(coalesce(w.balance_due,0),greatest(0,v_amount-v_sub));
      if r.payment_type='commission' and v_comm<=0 then raise exception 'No commission is currently owed' using errcode='P0001'; end if;
    end if;
    v_excess:=greatest(0,round(v_amount-v_sub-v_comm,2));
    if v_sub>0 then
      v_expiry:=greatest(coalesce(d.subscription_expires_at,now()),now()) +
        case r.subscription_plan when 'day' then interval '1 day' when 'week' then interval '7 days' else interval '30 days' end;
      insert into public.driver_subscription_payments(driver_id,amount_paid,payment_method,reference,note,received_by,payment_request_id,operation_key)
      values(r.driver_id,v_sub,'eft',nullif(r.payment_reference,''),nullif(r.note,''),p_actor_id,r.id,'payment:'||r.id::text||':subscription');
      update public.drivers set subscription_status='active',subscription_plan=r.subscription_plan,
        subscription_expires_at=v_expiry,subscription_amount_due=0,subscription_last_paid_at=now(),
        subscription_last_payment_amount=v_sub,updated_at=now() where id=r.driver_id;
    end if;
    if v_comm>0 then
      insert into public.driver_wallets(driver_id,balance_due,total_commission,total_driver_net,total_trips_completed,account_status,updated_at)
        values(r.driver_id,0,0,0,0,'settled',now()) on conflict(driver_id) do nothing;
      select * into w from public.driver_wallets where driver_id=r.driver_id for update;
      insert into public.driver_settlements(driver_id,wallet_id,amount_paid,payment_method,reference,note,received_by,payment_request_id,operation_key)
      values(r.driver_id,w.id,v_comm,'eft',nullif(r.payment_reference,''),nullif(r.note,''),p_actor_id,r.id,'payment:'||r.id::text||':commission');
    end if;
    update public.driver_payment_requests set status='approved',review_note=nullif(trim(p_review_note),''),reviewed_at=now(),reviewed_by=p_actor_id,
      operation_key='payment-review:'||r.id::text||':approve',subscription_amount_applied=v_sub,
      commission_amount_applied=v_comm,unapplied_excess=v_excess,contract_version=public.phase05b_contract_version()
      where id=r.id returning * into r;
    perform public.phase05b_refresh_driver_wallet(r.driver_id);
  end if;

  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
  values('payment-review:'||r.id::text||':'||r.status,'payment_reviewed','driver_payment_request',r.id,p_actor_id,
    jsonb_build_object('driver_id',r.driver_id,'status',r.status,'payment_type',r.payment_type,
      'subscription_applied',coalesce(r.subscription_amount_applied,0),'commission_applied',coalesce(r.commission_amount_applied,0),
      'unapplied_excess',coalesce(r.unapplied_excess,0)))
  on conflict(event_key) do update set event_key=excluded.event_key returning id into v_event;
  insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
    values(v_event,'payment_reviewed',jsonb_build_object('request_id',r.id,'driver_id',r.driver_id,'status',r.status))
    on conflict(business_event_id) do nothing;
  return jsonb_build_object('contract_version',public.phase05b_contract_version(),'request_id',r.id,'driver_id',r.driver_id,
    'status',r.status,'payment_type',r.payment_type,'subscription_applied',coalesce(r.subscription_amount_applied,0),
    'commission_applied',coalesce(r.commission_amount_applied,0),'unapplied_excess',coalesce(r.unapplied_excess,0),'replayed',false);
end $$;

create or replace function public.phase05b_record_settlement(
 p_operation_key text,p_driver_id uuid,p_amount numeric,p_method text,p_reference text,p_note text,p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_role text;v_due numeric;v_wallet uuid;v_event uuid;v_existing public.moovu_business_events%rowtype;
begin
 select * into v_existing from public.moovu_business_events where event_key=p_operation_key;
 if found then return v_existing.payload||jsonb_build_object('contract_version',public.phase05b_contract_version(),'replayed',true);end if;
 select role into v_role from public.profiles where id=p_actor_id;
 if v_role not in ('owner','admin') then raise exception 'Settlement not authorized' using errcode='P0001';end if;
 if p_operation_key is null or length(trim(p_operation_key))<8 or p_amount<=0 then raise exception 'Invalid settlement operation' using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||p_driver_id::text,0));
 if not exists(select 1 from public.drivers where id=p_driver_id for update) then raise exception 'Driver not found' using errcode='P0001';end if;
 v_due:=(public.phase05b_driver_debt(p_driver_id)->>'balance_due')::numeric;
 if v_due<=0 or p_amount>v_due+0.009 then raise exception 'Settlement exceeds current commission due' using errcode='P0001';end if;
 insert into public.driver_wallets(driver_id,balance_due,total_commission,total_driver_net,total_trips_completed,account_status,updated_at)
   values(p_driver_id,0,0,0,0,'settled',now()) on conflict(driver_id) do nothing;
 select id into v_wallet from public.driver_wallets where driver_id=p_driver_id for update;
 insert into public.driver_settlements(driver_id,wallet_id,amount_paid,payment_method,reference,note,received_by,operation_key)
 values(p_driver_id,v_wallet,round(p_amount,2),nullif(trim(p_method),''),nullif(trim(p_reference),''),nullif(trim(p_note),''),p_actor_id,p_operation_key);
 perform public.phase05b_refresh_driver_wallet(p_driver_id);
 insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
 values(p_operation_key,'driver_settlement_recorded','driver',p_driver_id,p_actor_id,
   jsonb_build_object('driver_id',p_driver_id,'amount_applied',round(p_amount,2),
     'balance_due',(public.phase05b_driver_debt(p_driver_id)->>'balance_due')::numeric)) returning id into v_event;
 insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
 values(v_event,'driver_settlement_recorded',jsonb_build_object('driver_id',p_driver_id,'amount',round(p_amount,2)));
 return jsonb_build_object('contract_version',public.phase05b_contract_version(),'driver_id',p_driver_id,
   'amount_applied',round(p_amount,2),'balance_due',(public.phase05b_driver_debt(p_driver_id)->>'balance_due')::numeric,'replayed',false);
end $$;

create or replace function public.phase05b_activate_subscription(
 p_operation_key text,p_driver_id uuid,p_plan text,p_amount numeric,p_method text,p_reference text,p_note text,p_request_id uuid,p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare d public.drivers%rowtype;v_role text;v_days integer;v_required numeric;v_expiry timestamptz;v_event uuid;v_existing public.moovu_business_events%rowtype;
begin
 select * into v_existing from public.moovu_business_events where event_key=p_operation_key;
 if found then return v_existing.payload||jsonb_build_object('contract_version',public.phase05b_contract_version(),'replayed',true);end if;
 select role into v_role from public.profiles where id=p_actor_id;
 if v_role not in ('owner','admin') then raise exception 'Subscription activation not authorized' using errcode='P0001';end if;
 v_days:=case p_plan when 'day' then 1 when 'week' then 7 when 'month' then 30 else null end;
 v_required:=case p_plan when 'day' then 45 when 'week' then 100 when 'month' then 250 else null end;
 if v_days is null or p_amount+0.009<v_required then raise exception 'Invalid subscription plan or amount' using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||p_driver_id::text,0));
 select * into d from public.drivers where id=p_driver_id for update;
 if not found then raise exception 'Driver not found' using errcode='P0001';end if;
 if p_request_id is not null then
   if not exists(select 1 from public.driver_subscription_requests where id=p_request_id and driver_id=p_driver_id and status<>'confirmed' for update) then
     raise exception 'Subscription request unavailable or already confirmed' using errcode='P0001';end if;
 end if;
 v_expiry:=greatest(coalesce(d.subscription_expires_at,now()),now())+make_interval(days=>v_days);
 insert into public.driver_subscription_payments(driver_id,amount_paid,payment_method,reference,note,received_by,operation_key)
 values(p_driver_id,v_required,nullif(trim(p_method),''),nullif(trim(p_reference),''),nullif(trim(p_note),''),p_actor_id,p_operation_key);
 update public.drivers set subscription_status='active',subscription_plan=p_plan,subscription_expires_at=v_expiry,
   subscription_amount_due=0,subscription_last_paid_at=now(),subscription_last_payment_amount=v_required,updated_at=now() where id=p_driver_id;
 if p_request_id is not null then update public.driver_subscription_requests set status='confirmed',confirmed_at=now() where id=p_request_id;end if;
 insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
 values(p_operation_key,'driver_subscription_activated','driver',p_driver_id,p_actor_id,
   jsonb_build_object('driver_id',p_driver_id,'plan',p_plan,'amount_applied',v_required,'unapplied_excess',greatest(0,p_amount-v_required),'expires_at',v_expiry))
 returning id into v_event;
 insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
 values(v_event,'driver_subscription_activated',jsonb_build_object('driver_id',p_driver_id,'plan',p_plan,'expires_at',v_expiry));
 return jsonb_build_object('contract_version',public.phase05b_contract_version(),'driver_id',p_driver_id,'plan',p_plan,
   'amount_applied',v_required,'unapplied_excess',greatest(0,p_amount-v_required),'expires_at',v_expiry,'replayed',false);
end $$;

create or replace function public.phase05b_record_subscription_payment(
 p_operation_key text,p_driver_id uuid,p_amount numeric,p_method text,p_reference text,p_note text,p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare d public.drivers%rowtype;v_role text;v_due numeric;v_event uuid;v_existing public.moovu_business_events%rowtype;
begin
 select * into v_existing from public.moovu_business_events where event_key=p_operation_key;
 if found then return v_existing.payload||jsonb_build_object('contract_version',public.phase05b_contract_version(),'replayed',true);end if;
 select role into v_role from public.profiles where id=p_actor_id;
 if v_role not in ('owner','admin') then raise exception 'Subscription payment not authorized' using errcode='P0001';end if;
 if p_operation_key is null or length(trim(p_operation_key))<8 or p_amount<=0 then raise exception 'Invalid subscription payment' using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||p_driver_id::text,0));
 select * into d from public.drivers where id=p_driver_id for update;
 if not found then raise exception 'Driver not found' using errcode='P0001';end if;
 v_due:=greatest(0,coalesce(d.subscription_amount_due,0));
 if v_due<=0 or p_amount>v_due+0.009 then raise exception 'Payment exceeds current subscription due' using errcode='P0001';end if;
 insert into public.driver_subscription_payments(driver_id,amount_paid,payment_method,reference,note,received_by,operation_key)
 values(p_driver_id,round(p_amount,2),nullif(trim(p_method),''),nullif(trim(p_reference),''),nullif(trim(p_note),''),p_actor_id,p_operation_key);
 v_due:=greatest(0,v_due-round(p_amount,2));
 update public.drivers set subscription_amount_due=v_due,subscription_last_paid_at=now(),
   subscription_last_payment_amount=round(p_amount,2),updated_at=now() where id=p_driver_id;
 insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
 values(p_operation_key,'driver_subscription_payment_recorded','driver',p_driver_id,p_actor_id,
   jsonb_build_object('driver_id',p_driver_id,'amount_applied',round(p_amount,2),'subscription_amount_due',v_due)) returning id into v_event;
 insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
 values(v_event,'driver_subscription_payment_recorded',jsonb_build_object('driver_id',p_driver_id,'amount',round(p_amount,2)));
 return jsonb_build_object('contract_version',public.phase05b_contract_version(),'driver_id',p_driver_id,
   'amount_applied',round(p_amount,2),'subscription_amount_due',v_due,'replayed',false);
end $$;

create or replace function public.phase05b_update_subscription(
 p_operation_key text,p_driver_id uuid,p_action text,p_days integer,p_note text,p_plan text,p_expiry timestamptz,p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare d public.drivers%rowtype;v_role text;v_status text;v_plan text;v_expiry timestamptz;v_event uuid;v_existing public.moovu_business_events%rowtype;
begin
 select * into v_existing from public.moovu_business_events where event_key=p_operation_key;
 if found then return v_existing.payload||jsonb_build_object('contract_version',public.phase05b_contract_version(),'replayed',true);end if;
 select role into v_role from public.profiles where id=p_actor_id;
 if v_role not in ('owner','admin') then raise exception 'Subscription update not authorized' using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||p_driver_id::text,0));
 select * into d from public.drivers where id=p_driver_id for update;
 if not found then raise exception 'Driver not found' using errcode='P0001';end if;
 v_status:=coalesce(d.subscription_status,'inactive');v_plan:=coalesce(nullif(p_plan,''),d.subscription_plan);v_expiry:=d.subscription_expires_at;
 if v_plan is not null and v_plan not in ('day','week','month') then raise exception 'Invalid subscription plan' using errcode='P0001';end if;
 case p_action
  when 'activate' then v_status:='active';v_expiry:=greatest(coalesce(v_expiry,now()),now())+make_interval(days=>case v_plan when 'day' then 1 when 'week' then 7 else 30 end);
  when 'suspend' then v_status:='suspended';
  when 'inactive' then v_status:='inactive';
  when 'grace' then v_status:='grace';
  when 'extend' then if coalesce(p_days,0)<=0 then raise exception 'Extension days must be positive' using errcode='P0001';end if;v_status:='active';v_expiry:=greatest(coalesce(v_expiry,now()),now())+make_interval(days=>p_days);
  when 'set_expiry' then if p_expiry is null then raise exception 'Expiry is required' using errcode='P0001';end if;v_expiry:=p_expiry;
  else raise exception 'Invalid subscription action' using errcode='P0001';
 end case;
 update public.drivers set subscription_status=v_status,subscription_plan=v_plan,subscription_expires_at=v_expiry,updated_at=now() where id=p_driver_id;
 insert into public.driver_subscription_events(driver_id,actor,action,old_status,new_status,old_expires_at,new_expires_at,note)
 values(p_driver_id,'admin',p_action,d.subscription_status,v_status,d.subscription_expires_at,v_expiry,p_note);
 insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
 values(p_operation_key,'driver_subscription_updated','driver',p_driver_id,p_actor_id,
   jsonb_build_object('driver_id',p_driver_id,'action',p_action,'status',v_status,'expires_at',v_expiry)) returning id into v_event;
 insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
 values(v_event,'driver_subscription_updated',jsonb_build_object('driver_id',p_driver_id,'status',v_status,'expires_at',v_expiry));
 return jsonb_build_object('contract_version',public.phase05b_contract_version(),'driver_id',p_driver_id,'status',v_status,'expires_at',v_expiry,'replayed',false);
end $$;

revoke all on function public.phase05b_contract_version() from public,anon,authenticated;
revoke all on function public.phase05b_driver_debt(uuid) from public,anon,authenticated;
revoke all on function public.phase05b_refresh_driver_wallet(uuid) from public,anon,authenticated;
revoke all on function public.phase05b_review_driver_payment(uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.phase05b_record_settlement(text,uuid,numeric,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.phase05b_activate_subscription(text,uuid,text,numeric,text,text,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.phase05b_record_subscription_payment(text,uuid,numeric,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.phase05b_update_subscription(text,uuid,text,integer,text,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.phase05b_contract_version() to service_role;
grant execute on function public.phase05b_driver_debt(uuid) to service_role;
grant execute on function public.phase05b_refresh_driver_wallet(uuid) to service_role;
grant execute on function public.phase05b_review_driver_payment(uuid,text,text,uuid) to service_role;
grant execute on function public.phase05b_record_settlement(text,uuid,numeric,text,text,text,uuid) to service_role;
grant execute on function public.phase05b_activate_subscription(text,uuid,text,numeric,text,text,text,uuid,uuid) to service_role;
grant execute on function public.phase05b_record_subscription_payment(text,uuid,numeric,text,text,text,uuid) to service_role;
grant execute on function public.phase05b_update_subscription(text,uuid,text,integer,text,text,timestamptz,uuid) to service_role;

commit;

-- Activation: only after phase-05b-preflight.sql returns no blockers.
-- Rollback limitation: do not drop audit/payment columns after they contain data.
-- Function replacement can be rolled back to a reviewed prior definition;
-- financial events and applied effects require reconciliation, never deletion.
