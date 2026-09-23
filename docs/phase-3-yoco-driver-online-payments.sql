-- Additive Phase 3 customer recovery + Driver commission online payments.
-- Install only after the provider-independent foundation and Phase 2 authority.
begin;

alter table public.online_payment_attempts
  add column if not exists provider_redirect_url text null,
  add column if not exists dispatch_state text not null default 'PENDING'
    check(dispatch_state in ('PENDING','DISPATCHED','DEFERRED','NOT_REQUIRED','FAILED')),
  add column if not exists dispatch_attempts integer not null default 0 check(dispatch_attempts>=0),
  add column if not exists dispatch_last_error text null,
  add column if not exists dispatched_at timestamptz null;

create table public.driver_online_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete restrict,
  provider text not null check(provider in ('YOCO','FAKE_TEST')),
  provider_checkout_id text null,
  provider_payment_id text null,
  provider_redirect_url text null,
  obligation_type text not null check(obligation_type='COMMISSION_DEBT'),
  obligation_version text not null check(obligation_version ~ '^[a-f0-9]{64}$'),
  obligation_snapshot jsonb not null check(jsonb_typeof(obligation_snapshot)='object'),
  amount_cents bigint not null check(amount_cents>0),
  currency text not null default 'ZAR' check(currency='ZAR'),
  state text not null default 'CREATED' check(state in
    ('CREATED','PENDING','SUCCEEDED','FAILED','CANCELLED','EXPIRED','RECONCILIATION_REQUIRED')),
  raw_provider_state text null,
  idempotency_key text not null unique check(length(idempotency_key) between 3 and 200),
  payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz null,
  payment_ledger_transaction_id uuid null unique references public.financial_transactions(id) on delete restrict,
  reconciliation_state text not null default 'PENDING' check(reconciliation_state in
    ('PENDING','MATCHED','RECONCILIATION_REQUIRED','RESOLVED')),
  reconciliation_metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(reconciliation_metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((state='SUCCEEDED' and verified_at is not null) or state<>'SUCCEEDED')
);
create unique index driver_online_payment_attempts_checkout_uidx
  on public.driver_online_payment_attempts(provider,provider_checkout_id)
  where provider_checkout_id is not null;
create unique index driver_online_payment_attempts_payment_uidx
  on public.driver_online_payment_attempts(provider,provider_payment_id)
  where provider_payment_id is not null;
create unique index driver_online_payment_attempts_active_uidx
  on public.driver_online_payment_attempts(driver_id,obligation_type)
  where state in ('CREATED','PENDING','SUCCEEDED','RECONCILIATION_REQUIRED');
create index driver_online_payment_attempts_driver_created_idx
  on public.driver_online_payment_attempts(driver_id,created_at desc);

alter table public.online_provider_events
  add column if not exists driver_payment_attempt_id uuid null
  references public.driver_online_payment_attempts(id) on delete restrict;
alter table public.online_payment_reconciliation_items
  add column if not exists driver_payment_attempt_id uuid null
  references public.driver_online_payment_attempts(id) on delete restrict;
create index online_provider_events_driver_attempt_idx
  on public.online_provider_events(driver_payment_attempt_id) where driver_payment_attempt_id is not null;
create index online_reconciliation_driver_attempt_idx
  on public.online_payment_reconciliation_items(driver_payment_attempt_id) where driver_payment_attempt_id is not null;

alter table public.financial_transactions drop constraint financial_transactions_source_type_check;
alter table public.financial_transactions add constraint financial_transactions_source_type_check
  check(source_type in ('TRIP','DRIVER_SETTLEMENT','DRIVER_PAYMENT_REQUEST','DRIVER_ONLINE_PAYMENT_ATTEMPT',
    'DRIVER_SUBSCRIPTION_PAYMENT','TRIP_CANCELLATION_FEE','PHASE4_ASSESSMENT','FINANCIAL_TRANSACTION','ADJUSTMENT'));

alter table public.driver_online_payment_attempts enable row level security;
revoke all on public.driver_online_payment_attempts from public,anon,authenticated,service_role;
grant select,insert,update on public.driver_online_payment_attempts to service_role;
grant select on public.driver_online_payment_attempts to authenticated;
create policy driver_online_payment_attempts_driver_read
on public.driver_online_payment_attempts for select to authenticated
using(exists(select 1 from public.driver_accounts a
  where a.driver_id=driver_online_payment_attempts.driver_id and a.user_id=auth.uid()));

create or replace function public.phase3_validate_driver_online_payment_attempt()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'Driver online payment evidence cannot be deleted'; end if;
  if tg_op='UPDATE' then
    if new.driver_id is distinct from old.driver_id or new.provider is distinct from old.provider
      or (old.provider_checkout_id is not null and new.provider_checkout_id is distinct from old.provider_checkout_id)
      or (old.provider_payment_id is not null and new.provider_payment_id is distinct from old.provider_payment_id)
      or new.obligation_type is distinct from old.obligation_type
      or new.obligation_version is distinct from old.obligation_version
      or new.obligation_snapshot is distinct from old.obligation_snapshot
      or new.amount_cents is distinct from old.amount_cents or new.currency is distinct from old.currency
      or new.idempotency_key is distinct from old.idempotency_key or new.payload_hash is distinct from old.payload_hash
      or (old.verified_at is not null and new.verified_at is distinct from old.verified_at)
      or (old.payment_ledger_transaction_id is not null and new.payment_ledger_transaction_id is distinct from old.payment_ledger_transaction_id)
    then raise exception 'Driver online payment authority fields are immutable'; end if;
    if new.state is distinct from old.state and not(
      (old.state='CREATED' and new.state in ('PENDING','FAILED','CANCELLED','EXPIRED','RECONCILIATION_REQUIRED')) or
      (old.state='PENDING' and new.state in ('SUCCEEDED','FAILED','CANCELLED','EXPIRED','RECONCILIATION_REQUIRED')) or
      (old.state='RECONCILIATION_REQUIRED' and new.state in ('PENDING','SUCCEEDED','FAILED'))
    ) then raise exception 'Invalid Driver online payment transition: % -> %',old.state,new.state; end if;
  end if;
  return new;
end $$;
create trigger phase3_validate_driver_online_payment_attempt_trigger
before update or delete on public.driver_online_payment_attempts
for each row execute function public.phase3_validate_driver_online_payment_attempt();

create or replace function public.phase3_validate_provider_event_attempt()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.payment_attempt_id is not null and new.driver_payment_attempt_id is not null then
    raise exception 'Provider event can reference only one payment domain';
  end if;
  if new.payment_attempt_id is not null and not exists(
    select 1 from public.online_payment_attempts p where p.id=new.payment_attempt_id and p.provider=new.provider
  ) then raise exception 'Provider event must match the Customer payment provider'; end if;
  if new.driver_payment_attempt_id is not null and not exists(
    select 1 from public.driver_online_payment_attempts p where p.id=new.driver_payment_attempt_id and p.provider=new.provider
  ) then raise exception 'Provider event must match the Driver payment provider'; end if;
  return new;
end $$;

create or replace function public.phase3_guard_online_financial_immutability()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'Phase 3 financial evidence cannot be deleted'; end if;
  if tg_table_name='online_provider_events' then
    if new.provider is distinct from old.provider or new.provider_event_id is distinct from old.provider_event_id
      or new.payment_attempt_id is distinct from old.payment_attempt_id
      or new.driver_payment_attempt_id is distinct from old.driver_payment_attempt_id
      or new.raw_event_type is distinct from old.raw_event_type
      or new.raw_provider_status is distinct from old.raw_provider_status
      or new.body_sha256 is distinct from old.body_sha256 or new.received_at is distinct from old.received_at
      or (old.verified_at is not null and new.verified_at is distinct from old.verified_at)
      or (old.processed_at is not null and new.processed_at is distinct from old.processed_at)
    then raise exception 'Provider event evidence is immutable'; end if;
  elsif tg_table_name='online_payment_attempts' then
    if new.customer_id is distinct from old.customer_id or new.trip_id is distinct from old.trip_id
      or new.provider is distinct from old.provider
      or (old.provider_checkout_id is not null and new.provider_checkout_id is distinct from old.provider_checkout_id)
      or (old.provider_payment_id is not null and new.provider_payment_id is distinct from old.provider_payment_id)
      or new.amount_cents is distinct from old.amount_cents or new.currency is distinct from old.currency
      or new.fare_version is distinct from old.fare_version or new.locked_fare_snapshot is distinct from old.locked_fare_snapshot
      or new.idempotency_key is distinct from old.idempotency_key or new.payload_hash is distinct from old.payload_hash
      or (old.verified_at is not null and new.verified_at is distinct from old.verified_at)
      or (old.payment_ledger_transaction_id is not null and new.payment_ledger_transaction_id is distinct from old.payment_ledger_transaction_id)
    then raise exception 'Online payment authority fields are immutable'; end if;
  elsif tg_table_name='online_payment_refunds' then
    if new.payment_attempt_id is distinct from old.payment_attempt_id or new.provider is distinct from old.provider
      or (old.provider_refund_id is not null and new.provider_refund_id is distinct from old.provider_refund_id)
      or new.amount_cents is distinct from old.amount_cents or new.currency is distinct from old.currency
      or new.idempotency_key is distinct from old.idempotency_key or new.reason is distinct from old.reason
      or new.requested_by is distinct from old.requested_by or new.requested_at is distinct from old.requested_at
      or (old.ledger_transaction_id is not null and new.ledger_transaction_id is distinct from old.ledger_transaction_id)
      or (old.completed_at is not null and new.completed_at is distinct from old.completed_at)
    then raise exception 'Online refund authority fields are immutable'; end if;
  elsif tg_table_name='online_driver_payables' then
    if new.trip_id is distinct from old.trip_id or new.payment_attempt_id is distinct from old.payment_attempt_id
      or new.driver_id is distinct from old.driver_id or new.fare_cents is distinct from old.fare_cents
      or new.commission_cents is distinct from old.commission_cents or new.currency is distinct from old.currency
      or new.idempotency_key is distinct from old.idempotency_key or new.earned_at is distinct from old.earned_at
      or new.created_at is distinct from old.created_at
      or (old.ledger_transaction_id is not null and new.ledger_transaction_id is distinct from old.ledger_transaction_id)
    then raise exception 'Online Driver payable authority fields are immutable'; end if;
  elsif tg_table_name='online_payment_reconciliation_items' then
    if new.payment_attempt_id is distinct from old.payment_attempt_id
      or new.driver_payment_attempt_id is distinct from old.driver_payment_attempt_id
      or new.refund_id is distinct from old.refund_id
      or new.provider_settlement_reference is distinct from old.provider_settlement_reference
      or new.issue_type is distinct from old.issue_type
      or new.expected_amount_cents is distinct from old.expected_amount_cents
      or new.actual_amount_cents is distinct from old.actual_amount_cents
      or new.currency is distinct from old.currency or new.metadata is distinct from old.metadata
      or new.created_at is distinct from old.created_at
      or (old.resolved_at is not null and new.resolved_at is distinct from old.resolved_at)
      or (old.resolved_by is not null and new.resolved_by is distinct from old.resolved_by)
      or (old.resolution_reason is not null and new.resolution_reason is distinct from old.resolution_reason)
    then raise exception 'Online reconciliation evidence is immutable'; end if;
  end if;
  return new;
end $$;

create or replace function public.phase1_validate_financial_source(p_source_type text,p_source_id uuid)
returns void language plpgsql stable set search_path=public,pg_temp as $$
begin
  if p_source_type='PHASE4_ASSESSMENT' and not exists(select 1 from public.phase4_fee_assessments where id=p_source_id) then raise exception 'Financial source Phase 4 assessment does not exist';
  elsif p_source_type='TRIP' and not exists(select 1 from public.trips where id=p_source_id) then raise exception 'Financial source trip does not exist';
  elsif p_source_type='DRIVER_SETTLEMENT' and not exists(select 1 from public.driver_settlements where id=p_source_id) then raise exception 'Financial source settlement does not exist';
  elsif p_source_type='DRIVER_PAYMENT_REQUEST' and not exists(select 1 from public.driver_payment_requests where id=p_source_id) then raise exception 'Financial source payment request does not exist';
  elsif p_source_type='DRIVER_ONLINE_PAYMENT_ATTEMPT' and not exists(select 1 from public.driver_online_payment_attempts where id=p_source_id) then raise exception 'Financial source Driver online payment does not exist';
  elsif p_source_type='DRIVER_SUBSCRIPTION_PAYMENT' and not exists(select 1 from public.driver_subscription_payments where id=p_source_id) then raise exception 'Financial source subscription payment does not exist';
  elsif p_source_type='TRIP_CANCELLATION_FEE' and not exists(select 1 from public.trip_cancellation_fees where id=p_source_id) then raise exception 'Financial source cancellation fee does not exist';
  elsif p_source_type='FINANCIAL_TRANSACTION' and not exists(select 1 from public.financial_transactions where id=p_source_id) then raise exception 'Financial source transaction does not exist';
  elsif p_source_type='ADJUSTMENT' and p_source_id is null then raise exception 'Adjustment source ID is required';
  end if;
end $$;

create or replace function public.phase3_process_trusted_driver_payment_event(
  p_provider text,p_event_id text,p_event_type text,p_raw_status text,p_body_sha256 text,
  p_checkout_id text,p_payment_id text,p_amount_cents bigint,p_currency text,p_outcome text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_event public.online_provider_events; v_attempt public.driver_online_payment_attempts;
  v_position jsonb; v_current_net bigint; v_reason text; v_clearing public.financial_accounts;
  v_debt public.financial_accounts; v_entries jsonb; v_payload jsonb; v_post jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if p_provider not in ('YOCO','FAKE_TEST') or length(trim(coalesce(p_event_id,'')))<3
    or p_body_sha256 !~ '^[a-f0-9]{64}$' or p_outcome not in ('SUCCEEDED','FAILED')
    or length(trim(coalesce(p_payment_id,'')))<3 then raise exception 'Invalid normalized provider event'; end if;
  select * into v_attempt from public.driver_online_payment_attempts
    where provider=p_provider and provider_checkout_id=p_checkout_id;
  insert into public.online_provider_events(provider,provider_event_id,driver_payment_attempt_id,
    raw_event_type,raw_provider_status,body_sha256,trust_state,processing_state,verified_at)
  values(p_provider,p_event_id,v_attempt.id,p_event_type,p_raw_status,p_body_sha256,'VERIFIED','RECEIVED',now())
  on conflict(provider,provider_event_id) do nothing;
  select * into strict v_event from public.online_provider_events
    where provider=p_provider and provider_event_id=p_event_id for update;
  if v_event.body_sha256<>p_body_sha256 then raise exception 'Conflicting provider event replay'; end if;
  if v_event.processing_state='PROCESSED' then return jsonb_build_object('result','REPLAYED','driver_payment_attempt_id',v_event.driver_payment_attempt_id); end if;
  if v_event.processing_state='RECONCILIATION_REQUIRED' then return jsonb_build_object('result','RECONCILIATION_REQUIRED','replayed',true); end if;
  select * into v_attempt from public.driver_online_payment_attempts
    where provider=p_provider and provider_checkout_id=p_checkout_id for update;
  if not found then
    update public.online_provider_events set processing_state='RECONCILIATION_REQUIRED',processing_attempts=processing_attempts+1,last_error='ORPHAN_DRIVER_PAYMENT' where id=v_event.id;
    insert into public.online_payment_reconciliation_items(provider_settlement_reference,issue_type,metadata)
    values(p_event_id,'ORPHAN_DRIVER_PAYMENT',jsonb_build_object('provider',p_provider,'checkout_id',p_checkout_id,'payment_id',p_payment_id));
    return jsonb_build_object('result','RECONCILIATION_REQUIRED','reason','ORPHAN_DRIVER_PAYMENT');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||v_attempt.driver_id::text,0));
  if v_attempt.state='SUCCEEDED' and v_attempt.provider_payment_id=p_payment_id then
    update public.online_provider_events set driver_payment_attempt_id=v_attempt.id,processing_state='PROCESSED',processed_at=now(),processing_attempts=processing_attempts+1 where id=v_event.id;
    return jsonb_build_object('result','REPLAYED','driver_payment_attempt_id',v_attempt.id,'ledger_transaction_id',v_attempt.payment_ledger_transaction_id);
  end if;
  if v_attempt.provider_payment_id is not null and v_attempt.provider_payment_id<>p_payment_id then v_reason:='PROVIDER_PAYMENT_REFERENCE_MISMATCH';
  elsif v_attempt.amount_cents<>p_amount_cents then v_reason:='AMOUNT_MISMATCH';
  elsif v_attempt.currency<>p_currency then v_reason:='CURRENCY_MISMATCH';
  elsif v_attempt.state not in ('CREATED','PENDING') then v_reason:='INVALID_PAYMENT_STATE';
  end if;
  if v_reason is null and p_outcome='SUCCEEDED' then
    v_position:=public.phase2_driver_finance_position(v_attempt.driver_id);
    v_current_net:=coalesce((v_position->>'net_owed_cents')::bigint,0);
    if v_position->>'mode'<>'AUTHORITATIVE' then v_reason:='DRIVER_FINANCE_NOT_AUTHORITATIVE';
    elsif v_current_net<>v_attempt.amount_cents then v_reason:='OBLIGATION_CHANGED'; end if;
  end if;
  if v_reason is not null then
    insert into public.online_payment_reconciliation_items(driver_payment_attempt_id,provider_settlement_reference,issue_type,expected_amount_cents,actual_amount_cents,metadata)
    values(v_attempt.id,p_event_id,v_reason,v_attempt.amount_cents,case when p_amount_cents>=0 then p_amount_cents else null end,
      jsonb_build_object('provider',p_provider,'checkout_id',p_checkout_id,'payment_id',p_payment_id));
    update public.online_provider_events set driver_payment_attempt_id=v_attempt.id,processing_state='RECONCILIATION_REQUIRED',processing_attempts=processing_attempts+1,last_error=v_reason where id=v_event.id;
    update public.driver_online_payment_attempts set state='RECONCILIATION_REQUIRED',reconciliation_state='RECONCILIATION_REQUIRED',updated_at=now() where id=v_attempt.id and state in ('CREATED','PENDING');
    return jsonb_build_object('result','RECONCILIATION_REQUIRED','reason',v_reason,'driver_payment_attempt_id',v_attempt.id);
  end if;
  if p_outcome='FAILED' then
    update public.driver_online_payment_attempts set state='FAILED',raw_provider_state=p_raw_status,updated_at=now() where id=v_attempt.id;
  else
    v_clearing:=public.phase1_ensure_financial_account(
      coalesce((select account_code from public.financial_accounts where owner_type='PLATFORM' and owner_id is null and account_category='PAYMENT_CLEARING' and currency='ZAR'),
        'PLATFORM:PAYMENT_CLEARING:ZAR'),
      'PAYMENT_CLEARING','PLATFORM',null,'DEBIT','ZAR');
    v_debt:=public.phase1_ensure_financial_account(
      coalesce((select account_code from public.financial_accounts where owner_type='DRIVER' and owner_id=v_attempt.driver_id and account_category='DRIVER_COMMISSION_DEBT' and currency='ZAR'),
        'DRIVER:'||upper(v_attempt.driver_id::text)||':COMMISSION_DEBT:ZAR'),
      'DRIVER_COMMISSION_DEBT','DRIVER',v_attempt.driver_id,'DEBIT','ZAR');
    v_entries:=jsonb_build_array(
      jsonb_build_object('account_id',v_clearing.id,'entry_side','DEBIT','amount_cents',v_attempt.amount_cents),
      jsonb_build_object('account_id',v_debt.id,'entry_side','CREDIT','amount_cents',v_attempt.amount_cents));
    v_payload:=jsonb_build_object('driver_payment_attempt_id',v_attempt.id,'driver_id',v_attempt.driver_id,
      'obligation_type',v_attempt.obligation_type,'obligation_version',v_attempt.obligation_version,'amount_cents',v_attempt.amount_cents,'provider',p_provider);
    v_post:=public.phase1_post_financial_transaction('driver_online_payment:'||v_attempt.id::text,
      encode(extensions.digest(v_payload::text,'sha256'),'hex'),'DRIVER_PAYMENT','DRIVER_ONLINE_PAYMENT_ATTEMPT',v_attempt.id,
      'ZAR','SYSTEM',null,now(),v_entries,v_payload,null);
    update public.driver_online_payment_attempts set state='SUCCEEDED',verified_at=now(),provider_payment_id=p_payment_id,
      raw_provider_state=p_raw_status,payment_ledger_transaction_id=(v_post->>'transaction_id')::uuid,
      reconciliation_state='MATCHED',updated_at=now() where id=v_attempt.id;
  end if;
  update public.online_provider_events set driver_payment_attempt_id=v_attempt.id,processing_state='PROCESSED',processed_at=now(),processing_attempts=processing_attempts+1 where id=v_event.id;
  return jsonb_build_object('result',p_outcome,'driver_payment_attempt_id',v_attempt.id,'ledger_transaction_id',v_post->>'transaction_id');
end $$;

revoke all on function public.phase3_validate_driver_online_payment_attempt() from public,anon,authenticated,service_role;
revoke all on function public.phase3_process_trusted_driver_payment_event(text,text,text,text,text,text,text,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.phase3_process_trusted_driver_payment_event(text,text,text,text,text,text,text,bigint,text,text) to service_role;

commit;
