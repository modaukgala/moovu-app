-- MOOVU Phase 3 final payment UX correction.
-- Additive production migration: online booking method preservation and Yoco Driver subscriptions.
begin;

create or replace function public.phase3_mark_trip_online_before_dispatch(p_trip_id uuid,p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_trip public.trips;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into v_trip from public.trips where id=p_trip_id for update;
  if not found or v_trip.customer_id<>p_customer_id then raise exception 'Trip unavailable'; end if;
  if v_trip.status not in ('requested','scheduled') or v_trip.driver_id is not null
    or coalesce(v_trip.dispatch_state,'idle')<>'idle' or coalesce(v_trip.dispatch_sequence,0)<>0
    or v_trip.dispatch_started_at is not null or v_trip.offer_status is not null
  then raise exception 'Trip already entered dispatch'; end if;
  if lower(coalesce(v_trip.payment_method,'')) not in ('cash','online') then raise exception 'Unsupported payment method'; end if;
  update public.trips set payment_method='online',updated_at=now() where id=p_trip_id;
  return jsonb_build_object('trip_id',p_trip_id,'payment_method','online');
end $$;
revoke all on function public.phase3_mark_trip_online_before_dispatch(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.phase3_mark_trip_online_before_dispatch(uuid,uuid) to service_role;

create table public.driver_subscription_online_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete restrict,
  provider text not null check(provider in ('YOCO','FAKE_TEST')),
  provider_checkout_id text null,
  provider_payment_id text null,
  provider_redirect_url text null,
  plan text not null check(plan in ('day','week','month')),
  plan_days integer not null check(plan_days in (1,7,30)),
  authority_version text not null check(authority_version ~ '^[a-f0-9]{64}$'),
  authority_snapshot jsonb not null check(jsonb_typeof(authority_snapshot)='object'),
  amount_cents bigint not null check(amount_cents in (4500,10000,25000)),
  currency text not null default 'ZAR' check(currency='ZAR'),
  state text not null default 'CREATED' check(state in ('CREATED','PENDING','SUCCEEDED','FAILED','CANCELLED','EXPIRED','RECONCILIATION_REQUIRED')),
  raw_provider_state text null,
  idempotency_key text not null unique check(length(idempotency_key) between 3 and 200),
  payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz null,
  subscription_payment_id uuid null unique references public.driver_subscription_payments(id) on delete restrict,
  payment_ledger_transaction_id uuid null unique references public.financial_transactions(id) on delete restrict,
  reconciliation_state text not null default 'PENDING' check(reconciliation_state in ('PENDING','MATCHED','RECONCILIATION_REQUIRED','RESOLVED')),
  reconciliation_metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(reconciliation_metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((plan='day' and plan_days=1 and amount_cents=4500) or (plan='week' and plan_days=7 and amount_cents=10000) or (plan='month' and plan_days=30 and amount_cents=25000)),
  check((state='SUCCEEDED' and verified_at is not null and subscription_payment_id is not null and payment_ledger_transaction_id is not null) or state<>'SUCCEEDED')
);
create unique index driver_subscription_online_attempt_checkout_uidx on public.driver_subscription_online_payment_attempts(provider,provider_checkout_id) where provider_checkout_id is not null;
create unique index driver_subscription_online_attempt_payment_uidx on public.driver_subscription_online_payment_attempts(provider,provider_payment_id) where provider_payment_id is not null;
create unique index driver_subscription_online_attempt_active_uidx on public.driver_subscription_online_payment_attempts(driver_id,plan) where state in ('CREATED','PENDING','RECONCILIATION_REQUIRED');
create index driver_subscription_online_attempt_driver_idx on public.driver_subscription_online_payment_attempts(driver_id,created_at desc);

create table public.driver_subscription_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider in ('YOCO','FAKE_TEST')),
  provider_event_id text not null,
  payment_attempt_id uuid null references public.driver_subscription_online_payment_attempts(id) on delete restrict,
  raw_event_type text not null,
  raw_provider_status text null,
  body_sha256 text not null check(body_sha256 ~ '^[a-f0-9]{64}$'),
  trust_state text not null default 'VERIFIED' check(trust_state in ('VERIFIED','REJECTED')),
  processing_state text not null default 'RECEIVED' check(processing_state in ('RECEIVED','PROCESSED','RECONCILIATION_REQUIRED')),
  processing_attempts integer not null default 0 check(processing_attempts>=0),
  verified_at timestamptz not null default now(),
  processed_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  unique(provider,provider_event_id),
  check((processing_state='PROCESSED' and processed_at is not null) or processing_state<>'PROCESSED')
);
create index driver_subscription_provider_events_attempt_idx on public.driver_subscription_provider_events(payment_attempt_id,created_at);

alter table public.driver_subscription_online_payment_attempts enable row level security;
alter table public.driver_subscription_provider_events enable row level security;
revoke all on public.driver_subscription_online_payment_attempts,public.driver_subscription_provider_events from public,anon,authenticated,service_role;
grant select,insert,update on public.driver_subscription_online_payment_attempts,public.driver_subscription_provider_events to service_role;
grant select on public.driver_subscription_online_payment_attempts to authenticated;
create policy driver_subscription_online_attempts_driver_read on public.driver_subscription_online_payment_attempts for select to authenticated
using(exists(select 1 from public.driver_accounts a where a.driver_id=driver_subscription_online_payment_attempts.driver_id and a.user_id=auth.uid()));

create or replace function public.phase3_guard_driver_subscription_online_attempt()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'Subscription online payment evidence cannot be deleted'; end if;
  if new.driver_id is distinct from old.driver_id or new.provider is distinct from old.provider
    or (old.provider_checkout_id is not null and new.provider_checkout_id is distinct from old.provider_checkout_id)
    or (old.provider_payment_id is not null and new.provider_payment_id is distinct from old.provider_payment_id)
    or new.plan is distinct from old.plan or new.plan_days is distinct from old.plan_days
    or new.authority_version is distinct from old.authority_version or new.authority_snapshot is distinct from old.authority_snapshot
    or new.amount_cents is distinct from old.amount_cents or new.currency is distinct from old.currency
    or new.idempotency_key is distinct from old.idempotency_key or new.payload_hash is distinct from old.payload_hash
    or (old.verified_at is not null and new.verified_at is distinct from old.verified_at)
    or (old.subscription_payment_id is not null and new.subscription_payment_id is distinct from old.subscription_payment_id)
    or (old.payment_ledger_transaction_id is not null and new.payment_ledger_transaction_id is distinct from old.payment_ledger_transaction_id)
  then raise exception 'Subscription online payment authority fields are immutable'; end if;
  if new.state is distinct from old.state and not(
    (old.state='CREATED' and new.state in ('PENDING','FAILED','CANCELLED','EXPIRED','RECONCILIATION_REQUIRED')) or
    (old.state='PENDING' and new.state in ('SUCCEEDED','FAILED','CANCELLED','EXPIRED','RECONCILIATION_REQUIRED')) or
    (old.state='RECONCILIATION_REQUIRED' and new.state in ('PENDING','SUCCEEDED','FAILED'))
  ) then raise exception 'Invalid subscription payment transition: % -> %',old.state,new.state; end if;
  return new;
end $$;
create trigger phase3_guard_driver_subscription_online_attempt_trigger before update or delete on public.driver_subscription_online_payment_attempts
for each row execute function public.phase3_guard_driver_subscription_online_attempt();

create or replace function public.phase3_guard_driver_subscription_provider_event()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'Subscription provider evidence cannot be deleted'; end if;
  if new.provider is distinct from old.provider or new.provider_event_id is distinct from old.provider_event_id
    or new.payment_attempt_id is distinct from old.payment_attempt_id or new.raw_event_type is distinct from old.raw_event_type
    or new.raw_provider_status is distinct from old.raw_provider_status or new.body_sha256 is distinct from old.body_sha256
    or new.trust_state is distinct from old.trust_state or new.verified_at is distinct from old.verified_at
    or (old.processed_at is not null and new.processed_at is distinct from old.processed_at)
  then raise exception 'Subscription provider event authority is immutable'; end if;
  return new;
end $$;
create trigger phase3_guard_driver_subscription_provider_event_trigger before update or delete on public.driver_subscription_provider_events
for each row execute function public.phase3_guard_driver_subscription_provider_event();

create or replace function public.phase3_process_trusted_subscription_payment_event(
  p_provider text,p_event_id text,p_event_type text,p_raw_status text,p_body_sha256 text,
  p_checkout_id text,p_payment_id text,p_amount_cents bigint,p_currency text,p_outcome text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_event public.driver_subscription_provider_events; v_attempt public.driver_subscription_online_payment_attempts;
  v_driver public.drivers; v_payment_id uuid; v_expiry timestamptz; v_event_id uuid;
  v_clearing public.financial_accounts; v_deferred public.financial_accounts; v_entries jsonb; v_payload jsonb; v_post jsonb; v_reason text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if p_provider not in ('YOCO','FAKE_TEST') or length(trim(coalesce(p_event_id,'')))<3 or p_body_sha256 !~ '^[a-f0-9]{64}$'
    or p_outcome not in ('SUCCEEDED','FAILED') or length(trim(coalesce(p_payment_id,'')))<3 then raise exception 'Invalid normalized provider event'; end if;
  select * into v_attempt from public.driver_subscription_online_payment_attempts where provider=p_provider and provider_checkout_id=p_checkout_id;
  insert into public.driver_subscription_provider_events(provider,provider_event_id,payment_attempt_id,raw_event_type,raw_provider_status,body_sha256)
  values(p_provider,p_event_id,v_attempt.id,p_event_type,p_raw_status,p_body_sha256) on conflict(provider,provider_event_id) do nothing;
  select * into strict v_event from public.driver_subscription_provider_events where provider=p_provider and provider_event_id=p_event_id for update;
  if v_event.body_sha256<>p_body_sha256 then raise exception 'Conflicting provider event replay'; end if;
  if v_event.processing_state='PROCESSED' then return jsonb_build_object('result','REPLAYED','subscription_payment_attempt_id',v_event.payment_attempt_id); end if;
  if v_attempt.id is null then
    update public.driver_subscription_provider_events set processing_state='RECONCILIATION_REQUIRED',processing_attempts=processing_attempts+1,last_error='ORPHAN_SUBSCRIPTION_PAYMENT' where id=v_event.id;
    return jsonb_build_object('result','RECONCILIATION_REQUIRED','reason','ORPHAN_SUBSCRIPTION_PAYMENT');
  end if;
  select * into v_attempt from public.driver_subscription_online_payment_attempts where id=v_attempt.id for update;
  perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||v_attempt.driver_id::text,0));
  if v_attempt.state='SUCCEEDED' and v_attempt.provider_payment_id=p_payment_id then
    update public.driver_subscription_provider_events set processing_state='PROCESSED',processed_at=now(),processing_attempts=processing_attempts+1 where id=v_event.id;
    return jsonb_build_object('result','REPLAYED','subscription_payment_attempt_id',v_attempt.id,'ledger_transaction_id',v_attempt.payment_ledger_transaction_id);
  end if;
  if v_attempt.provider_payment_id is not null and v_attempt.provider_payment_id<>p_payment_id then v_reason:='PROVIDER_PAYMENT_REFERENCE_MISMATCH';
  elsif v_attempt.amount_cents<>p_amount_cents then v_reason:='AMOUNT_MISMATCH';
  elsif v_attempt.currency<>p_currency then v_reason:='CURRENCY_MISMATCH';
  elsif v_attempt.state not in ('CREATED','PENDING') then v_reason:='INVALID_PAYMENT_STATE'; end if;
  if v_reason is not null then
    update public.driver_subscription_online_payment_attempts set state='RECONCILIATION_REQUIRED',reconciliation_state='RECONCILIATION_REQUIRED',reconciliation_metadata=jsonb_build_object('reason',v_reason,'event_id',p_event_id),updated_at=now() where id=v_attempt.id and state in ('CREATED','PENDING');
    update public.driver_subscription_provider_events set processing_state='RECONCILIATION_REQUIRED',processing_attempts=processing_attempts+1,last_error=v_reason where id=v_event.id;
    return jsonb_build_object('result','RECONCILIATION_REQUIRED','reason',v_reason,'subscription_payment_attempt_id',v_attempt.id);
  end if;
  if p_outcome='FAILED' then
    update public.driver_subscription_online_payment_attempts set state='FAILED',raw_provider_state=p_raw_status,updated_at=now() where id=v_attempt.id;
  else
    select * into strict v_driver from public.drivers where id=v_attempt.driver_id for update;
    v_expiry:=greatest(coalesce(v_driver.subscription_expires_at,now()),now())+make_interval(days=>v_attempt.plan_days);
    insert into public.driver_subscription_payments(driver_id,amount_paid,payment_method,reference,note,operation_key)
    values(v_attempt.driver_id,v_attempt.amount_cents/100.0,'yoco_online',p_payment_id,'Verified Yoco online subscription','driver_subscription_online_payment:'||v_attempt.id)
    returning id into v_payment_id;
    update public.drivers set subscription_status='active',subscription_plan=v_attempt.plan,subscription_expires_at=v_expiry,
      subscription_amount_due=0,subscription_last_paid_at=now(),subscription_last_payment_amount=v_attempt.amount_cents/100.0,updated_at=now()
    where id=v_attempt.driver_id;
    insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,payload)
    values('driver_subscription_online_payment:'||v_attempt.id,'driver_subscription_activated','driver',v_attempt.driver_id,
      jsonb_build_object('driver_id',v_attempt.driver_id,'plan',v_attempt.plan,'amount_applied',v_attempt.amount_cents/100.0,'expires_at',v_expiry,'provider','YOCO')) returning id into v_event_id;
    insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
    values(v_event_id,'driver_subscription_activated',jsonb_build_object('driver_id',v_attempt.driver_id,'plan',v_attempt.plan,'expires_at',v_expiry));
    v_clearing:=public.phase1_ensure_financial_account('PLATFORM:SUBSCRIPTION_PAYMENT_CLEARING:ZAR','SUBSCRIPTION_PAYMENT_CLEARING','PLATFORM',null,'DEBIT','ZAR');
    v_deferred:=public.phase1_ensure_financial_account('PLATFORM:DEFERRED_SUBSCRIPTION_REVENUE:ZAR','DEFERRED_SUBSCRIPTION_REVENUE','PLATFORM',null,'CREDIT','ZAR');
    v_entries:=jsonb_build_array(jsonb_build_object('account_id',v_clearing.id,'entry_side','DEBIT','amount_cents',v_attempt.amount_cents),jsonb_build_object('account_id',v_deferred.id,'entry_side','CREDIT','amount_cents',v_attempt.amount_cents));
    v_payload:=jsonb_build_object('subscription_payment_attempt_id',v_attempt.id,'subscription_payment_id',v_payment_id,'driver_id',v_attempt.driver_id,'plan',v_attempt.plan,'amount_cents',v_attempt.amount_cents,'provider',p_provider);
    v_post:=public.phase1_post_financial_transaction('driver_subscription_online_payment:'||v_attempt.id,encode(extensions.digest(v_payload::text,'sha256'),'hex'),
      'DRIVER_SUBSCRIPTION_PAYMENT','DRIVER_SUBSCRIPTION_PAYMENT',v_payment_id,'ZAR','SYSTEM',null,now(),v_entries,v_payload,null);
    update public.driver_subscription_online_payment_attempts set state='SUCCEEDED',verified_at=now(),provider_payment_id=p_payment_id,raw_provider_state=p_raw_status,
      subscription_payment_id=v_payment_id,payment_ledger_transaction_id=(v_post->>'transaction_id')::uuid,reconciliation_state='MATCHED',reconciliation_metadata=jsonb_build_object('provider_event_id',p_event_id),updated_at=now() where id=v_attempt.id;
  end if;
  update public.driver_subscription_provider_events set processing_state='PROCESSED',processed_at=now(),processing_attempts=processing_attempts+1 where id=v_event.id;
  return jsonb_build_object('result',p_outcome,'subscription_payment_attempt_id',v_attempt.id,'subscription_payment_id',v_payment_id,'ledger_transaction_id',v_post->>'transaction_id');
end $$;

revoke all on function public.phase3_guard_driver_subscription_online_attempt(),public.phase3_guard_driver_subscription_provider_event() from public,anon,authenticated,service_role;
revoke all on function public.phase3_process_trusted_subscription_payment_event(text,text,text,text,text,text,text,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.phase3_process_trusted_subscription_payment_event(text,text,text,text,text,text,text,bigint,text,text) to service_role;

commit;
