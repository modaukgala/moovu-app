-- PHASE 3 PROVIDER-INDEPENDENT FOUNDATION ONLY.
-- DO NOT APPLY TO PRODUCTION OR ANY REMOTE PROJECT WITHOUT SEPARATE REVIEW AND APPROVAL.
-- This migration performs no Yoco API call and does not implement webhook verification.
begin;

create table public.online_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  trip_id uuid not null references public.trips(id) on delete restrict,
  provider text not null check (provider in ('YOCO','FAKE_TEST')),
  provider_checkout_id text null,
  provider_payment_id text null,
  payment_method text not null default 'ONLINE' check (payment_method='ONLINE'),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'ZAR' check (currency='ZAR'),
  fare_version text not null check (fare_version ~ '^[a-f0-9]{64}$'),
  locked_fare_snapshot jsonb not null check (jsonb_typeof(locked_fare_snapshot)='object'),
  state text not null default 'CREATED' check (state in (
    'CREATED','PENDING','SUCCEEDED','FAILED','CANCELLED','EXPIRED',
    'REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED','REFUND_FAILED','RECONCILIATION_REQUIRED'
  )),
  raw_provider_state text null,
  idempotency_key text not null unique check (length(idempotency_key) between 3 and 200),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz null,
  failure_code text null,
  failure_message text null,
  payment_ledger_transaction_id uuid null unique references public.financial_transactions(id) on delete restrict,
  reconciliation_state text not null default 'PENDING' check (reconciliation_state in ('PENDING','MATCHED','RECONCILIATION_REQUIRED','RESOLVED')),
  reconciliation_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(reconciliation_metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state='SUCCEEDED' and verified_at is not null) or state<>'SUCCEEDED')
);

create unique index online_payment_attempts_provider_checkout_uidx
  on public.online_payment_attempts(provider,provider_checkout_id) where provider_checkout_id is not null;
create unique index online_payment_attempts_provider_payment_uidx
  on public.online_payment_attempts(provider,provider_payment_id) where provider_payment_id is not null;
create unique index online_payment_attempts_active_fare_uidx
  on public.online_payment_attempts(trip_id,fare_version)
  where state in ('CREATED','PENDING','SUCCEEDED','REFUND_PENDING','PARTIALLY_REFUNDED');
create unique index online_payment_attempts_effective_success_uidx
  on public.online_payment_attempts(trip_id,fare_version)
  where state in ('SUCCEEDED','REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED','RECONCILIATION_REQUIRED')
    and verified_at is not null;
create index online_payment_attempts_customer_created_idx
  on public.online_payment_attempts(customer_id,created_at desc);
create index online_payment_attempts_reconciliation_idx
  on public.online_payment_attempts(reconciliation_state,updated_at);

create table public.online_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('YOCO','FAKE_TEST')),
  provider_event_id text not null,
  payment_attempt_id uuid null references public.online_payment_attempts(id) on delete restrict,
  raw_event_type text not null,
  raw_provider_status text null,
  body_sha256 text not null check (body_sha256 ~ '^[a-f0-9]{64}$'),
  trust_state text not null default 'UNVERIFIED' check (trust_state in ('UNVERIFIED','VERIFIED','REJECTED')),
  processing_state text not null default 'RECEIVED' check (processing_state in ('RECEIVED','PROCESSING','PROCESSED','FAILED','RECONCILIATION_REQUIRED')),
  received_at timestamptz not null default now(),
  verified_at timestamptz null,
  processed_at timestamptz null,
  processing_attempts integer not null default 0 check (processing_attempts >= 0),
  last_error text null,
  created_at timestamptz not null default now(),
  unique(provider,provider_event_id),
  check ((trust_state='VERIFIED' and verified_at is not null) or trust_state<>'VERIFIED'),
  check ((processing_state='PROCESSED' and processed_at is not null) or processing_state<>'PROCESSED')
);
create index online_provider_events_processing_idx
  on public.online_provider_events(processing_state,received_at);
create index online_provider_events_attempt_idx
  on public.online_provider_events(payment_attempt_id,received_at);

create table public.online_payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_attempt_id uuid not null references public.online_payment_attempts(id) on delete restrict,
  provider text not null check (provider in ('YOCO','FAKE_TEST')),
  provider_refund_id text null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'ZAR' check (currency='ZAR'),
  state text not null default 'REFUND_PENDING' check (state in ('REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED','REFUND_FAILED','RECONCILIATION_REQUIRED')),
  idempotency_key text not null unique check (length(idempotency_key) between 3 and 200),
  reason text not null check (length(trim(reason)) between 3 and 500),
  requested_by uuid not null references auth.users(id) on delete restrict,
  provider_state text null,
  ledger_transaction_id uuid null unique references public.financial_transactions(id) on delete restrict,
  requested_at timestamptz not null default now(),
  completed_at timestamptz null,
  last_error text null
);
create unique index online_payment_refunds_provider_uidx
  on public.online_payment_refunds(provider,provider_refund_id) where provider_refund_id is not null;
create index online_payment_refunds_attempt_idx
  on public.online_payment_refunds(payment_attempt_id,requested_at);

create table public.online_driver_payables (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.trips(id) on delete restrict,
  payment_attempt_id uuid not null unique references public.online_payment_attempts(id) on delete restrict,
  driver_id uuid not null references public.drivers(id) on delete restrict,
  fare_cents bigint not null check (fare_cents > 0),
  commission_cents bigint not null check (commission_cents >= 0 and commission_cents < fare_cents),
  payable_cents bigint generated always as (fare_cents-commission_cents) stored,
  currency text not null default 'ZAR' check (currency='ZAR'),
  state text not null default 'EARNED' check (state in ('EARNED','PAYABLE','PAID','REVERSED','RECONCILIATION_REQUIRED')),
  idempotency_key text not null unique check (length(idempotency_key) between 3 and 200),
  ledger_transaction_id uuid null unique references public.financial_transactions(id) on delete restrict,
  earned_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index online_driver_payables_driver_idx on public.online_driver_payables(driver_id,state,created_at);

create table public.online_payment_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  payment_attempt_id uuid null references public.online_payment_attempts(id) on delete restrict,
  refund_id uuid null references public.online_payment_refunds(id) on delete restrict,
  provider_settlement_reference text null,
  issue_type text not null,
  expected_amount_cents bigint null check (expected_amount_cents is null or expected_amount_cents >= 0),
  actual_amount_cents bigint null check (actual_amount_cents is null or actual_amount_cents >= 0),
  currency text not null default 'ZAR' check (currency='ZAR'),
  state text not null default 'OPEN' check (state in ('OPEN','RESOLVED')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by uuid null references auth.users(id) on delete restrict,
  resolution_reason text null,
  check ((state='RESOLVED' and resolved_at is not null and resolved_by is not null and length(trim(resolution_reason))>=3) or state='OPEN')
);
create index online_payment_reconciliation_open_idx
  on public.online_payment_reconciliation_items(state,created_at);

alter table public.online_payment_attempts enable row level security;
alter table public.online_provider_events enable row level security;
alter table public.online_payment_refunds enable row level security;
alter table public.online_driver_payables enable row level security;
alter table public.online_payment_reconciliation_items enable row level security;

revoke all on public.online_payment_attempts,public.online_provider_events,public.online_payment_refunds,
  public.online_driver_payables,public.online_payment_reconciliation_items from public,anon,authenticated,service_role;
grant select,insert,update on public.online_payment_attempts,public.online_provider_events,
  public.online_payment_refunds,public.online_driver_payables,public.online_payment_reconciliation_items to service_role;
grant select (id,trip_id,provider,payment_method,amount_cents,currency,fare_version,state,
  raw_provider_state,verified_at,reconciliation_state,created_at,updated_at)
  on public.online_payment_attempts to authenticated;

create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
grant usage on schema private to authenticated;

create or replace function private.phase3_customer_owns_payment(p_customer_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select (select auth.uid()) is not null and exists(
    select 1 from public.customers c where c.id=p_customer_id and c.auth_user_id=(select auth.uid())
  )
$$;
revoke all on function private.phase3_customer_owns_payment(uuid) from public,anon,authenticated;
grant execute on function private.phase3_customer_owns_payment(uuid) to authenticated;

create policy online_payment_attempts_customer_read
on public.online_payment_attempts for select to authenticated
using (private.phase3_customer_owns_payment(customer_id));

create or replace function public.phase3_guard_online_financial_immutability()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'Phase 3 financial evidence cannot be deleted'; end if;
  if tg_table_name='online_provider_events' then
    if new.provider is distinct from old.provider or new.provider_event_id is distinct from old.provider_event_id
      or new.payment_attempt_id is distinct from old.payment_attempt_id
      or new.raw_event_type is distinct from old.raw_event_type
      or new.raw_provider_status is distinct from old.raw_provider_status
      or new.body_sha256 is distinct from old.body_sha256
      or new.received_at is distinct from old.received_at
      or (old.verified_at is not null and new.verified_at is distinct from old.verified_at)
      or (old.processed_at is not null and new.processed_at is distinct from old.processed_at)
    then raise exception 'Provider event evidence is immutable'; end if;
  elsif tg_table_name='online_payment_attempts' then
    if new.customer_id is distinct from old.customer_id or new.trip_id is distinct from old.trip_id
      or new.provider is distinct from old.provider
      or (old.provider_checkout_id is not null and new.provider_checkout_id is distinct from old.provider_checkout_id)
      or (old.provider_payment_id is not null and new.provider_payment_id is distinct from old.provider_payment_id)
      or new.amount_cents is distinct from old.amount_cents or new.currency is distinct from old.currency
      or new.fare_version is distinct from old.fare_version
      or new.locked_fare_snapshot is distinct from old.locked_fare_snapshot
      or new.idempotency_key is distinct from old.idempotency_key
      or new.payload_hash is distinct from old.payload_hash
      or (old.verified_at is not null and new.verified_at is distinct from old.verified_at)
      or (old.payment_ledger_transaction_id is not null
        and new.payment_ledger_transaction_id is distinct from old.payment_ledger_transaction_id)
    then raise exception 'Online payment authority fields are immutable'; end if;
  elsif tg_table_name='online_payment_refunds' then
    if new.payment_attempt_id is distinct from old.payment_attempt_id
      or new.provider is distinct from old.provider
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
create trigger phase3_online_attempt_immutability before update or delete on public.online_payment_attempts
for each row execute function public.phase3_guard_online_financial_immutability();
create trigger phase3_provider_event_immutability before update or delete on public.online_provider_events
for each row execute function public.phase3_guard_online_financial_immutability();
create trigger phase3_online_refund_immutability before update or delete on public.online_payment_refunds
for each row execute function public.phase3_guard_online_financial_immutability();
create trigger phase3_online_driver_payable_immutability before update or delete on public.online_driver_payables
for each row execute function public.phase3_guard_online_financial_immutability();
create trigger phase3_online_reconciliation_immutability before update or delete on public.online_payment_reconciliation_items
for each row execute function public.phase3_guard_online_financial_immutability();

create or replace function public.phase3_validate_online_payment_attempt()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare trip_customer_id uuid;
begin
  select customer_id into trip_customer_id from public.trips where id=new.trip_id;
  if trip_customer_id is null or trip_customer_id<>new.customer_id then
    raise exception 'Online payment customer must own the trip';
  end if;
  if tg_op='UPDATE' and new.state is distinct from old.state and not (
    (old.state='CREATED' and new.state in ('PENDING','FAILED','CANCELLED','EXPIRED','RECONCILIATION_REQUIRED'))
    or (old.state='PENDING' and new.state in ('SUCCEEDED','FAILED','CANCELLED','EXPIRED','RECONCILIATION_REQUIRED'))
    or (old.state='SUCCEEDED' and new.state in ('REFUND_PENDING','RECONCILIATION_REQUIRED'))
    or (old.state='REFUND_PENDING' and new.state in ('PARTIALLY_REFUNDED','REFUNDED','REFUND_FAILED','RECONCILIATION_REQUIRED'))
    or (old.state='PARTIALLY_REFUNDED' and new.state in ('REFUND_PENDING','REFUNDED','RECONCILIATION_REQUIRED'))
    or (old.state='REFUND_FAILED' and new.state in ('REFUND_PENDING','RECONCILIATION_REQUIRED'))
    or (old.state='RECONCILIATION_REQUIRED' and new.state in ('PENDING','SUCCEEDED','FAILED','REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED'))
  ) then
    raise exception 'Invalid online payment transition: % -> %',old.state,new.state;
  end if;
  return new;
end $$;
create trigger phase3_validate_online_payment_attempt_trigger
before insert or update on public.online_payment_attempts
for each row execute function public.phase3_validate_online_payment_attempt();

create or replace function public.phase3_validate_provider_event_attempt()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.payment_attempt_id is not null and not exists(
    select 1 from public.online_payment_attempts p
    where p.id=new.payment_attempt_id and p.provider=new.provider
  ) then raise exception 'Provider event must match the payment attempt provider'; end if;
  return new;
end $$;
create trigger phase3_validate_provider_event_attempt_trigger
before insert or update on public.online_provider_events
for each row execute function public.phase3_validate_provider_event_attempt();

create or replace function public.phase3_validate_online_refund()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.online_payment_attempts p
    where p.id=new.payment_attempt_id and p.provider=new.provider and p.verified_at is not null
      and p.state in ('SUCCEEDED','REFUND_PENDING','PARTIALLY_REFUNDED','REFUND_FAILED','RECONCILIATION_REQUIRED'))
  then raise exception 'Refund must match a verified payment attempt and provider'; end if;
  return new;
end $$;
create trigger phase3_validate_online_refund_trigger
before insert or update on public.online_payment_refunds
for each row execute function public.phase3_validate_online_refund();

create or replace function public.phase3_validate_online_driver_payable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if not exists(
    select 1 from public.online_payment_attempts p join public.trips t on t.id=p.trip_id
    where p.id=new.payment_attempt_id and p.trip_id=new.trip_id
      and p.state='SUCCEEDED' and p.verified_at is not null
      and p.amount_cents=new.fare_cents and p.currency=new.currency
      and t.driver_id=new.driver_id and t.status='completed' and t.completed_at is not null
  ) then raise exception 'Driver payable requires a verified payment and completed matching trip'; end if;
  return new;
end $$;
create trigger phase3_validate_online_driver_payable_trigger
before insert or update on public.online_driver_payables
for each row execute function public.phase3_validate_online_driver_payable();

create or replace function public.phase3_assert_trip_dispatchable(p_trip_id uuid)
returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
declare t public.trips; ok boolean;
begin
  select * into strict t from public.trips where id=p_trip_id;
  if lower(coalesce(t.payment_method,'cash'))<>'online' then return; end if;
  select exists(select 1 from public.online_payment_attempts p
    where p.trip_id=t.id and p.state='SUCCEEDED' and p.verified_at is not null
      and p.currency='ZAR' and p.amount_cents>0) into ok;
  if not ok then raise exception 'Online payment must be verified before this trip can be dispatched' using errcode='P0001'; end if;
end $$;

create or replace function public.phase3_guard_online_dispatch()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare target_trip uuid;
begin
  if tg_table_name='driver_trip_offers' then
    target_trip:=new.trip_id;
  elsif tg_table_name='trips' then
    target_trip:=new.id;
  else
    raise exception 'Unexpected Phase 3 dispatch trigger table: %',tg_table_name;
  end if;
  perform public.phase3_assert_trip_dispatchable(target_trip);
  return new;
end $$;
create trigger phase3_guard_online_offer before insert on public.driver_trip_offers
for each row execute function public.phase3_guard_online_dispatch();
create trigger phase3_guard_online_assignment before update of driver_id,status on public.trips
for each row when (new.driver_id is not null or new.status in ('offered','assigned'))
execute function public.phase3_guard_online_dispatch();

revoke all on function public.phase3_assert_trip_dispatchable(uuid) from public,anon,authenticated;
revoke all on function public.phase3_guard_online_dispatch() from public,anon,authenticated;
revoke all on function public.phase3_guard_online_financial_immutability() from public,anon,authenticated;
revoke all on function public.phase3_validate_online_payment_attempt() from public,anon,authenticated;
revoke all on function public.phase3_validate_provider_event_attempt() from public,anon,authenticated;
revoke all on function public.phase3_validate_online_refund() from public,anon,authenticated;
revoke all on function public.phase3_validate_online_driver_payable() from public,anon,authenticated;
grant execute on function public.phase3_assert_trip_dispatchable(uuid) to service_role;

commit;
