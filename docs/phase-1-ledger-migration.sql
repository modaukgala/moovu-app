-- PHASE 1 STAGE A / REVIEW ONLY / NOT FOR AUTOMATIC EXECUTION.
-- DO NOT APPLY TO PRODUCTION, STAGING, OR DISPOSABLE SUPABASE WITHOUT SEPARATE APPROVAL.
begin;

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  account_code text not null unique check (account_code = upper(account_code) and length(account_code) between 3 and 120),
  account_category text not null check (account_category in (
    'COMMISSION_RECEIVABLE','COMMISSION_REVENUE','BOOKING_FEE_REVENUE',
    'SUBSCRIPTION_PAYMENT_CLEARING','SUBSCRIPTION_REVENUE','DEFERRED_SUBSCRIPTION_REVENUE',
    'CANCELLATION_NO_SHOW_RECEIVABLE','CANCELLATION_NO_SHOW_REVENUE','PAYMENT_CLEARING',
    'UNAPPLIED_FUNDS','PAYOUT_CLEARING','ADJUSTMENT_CLEARING','DRIVER_EARNINGS_CONTROL',
    'DRIVER_EARNINGS_PAYABLE','DRIVER_COMMISSION_DEBT','DRIVER_UNAPPLIED_CREDIT',
    'DRIVER_COMPENSATION_PAYABLE','DRIVER_FUTURE_PAYOUT','CUSTOMER_OUTSTANDING_LIABILITY',
    'CUSTOMER_BALANCE','CUSTOMER_PROMOTIONAL_CREDIT','CUSTOMER_REFERRAL_CREDIT'
  )),
  owner_type text not null check (owner_type in ('PLATFORM','DRIVER','CUSTOMER')),
  owner_id uuid null,
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  normal_balance_side text not null check (normal_balance_side in ('DEBIT','CREDIT')),
  account_status text not null default 'ACTIVE' check (account_status in ('ACTIVE','SUSPENDED','CLOSED')),
  created_at timestamptz not null default now(),
  check ((owner_type='PLATFORM' and owner_id is null) or (owner_type in ('DRIVER','CUSTOMER') and owner_id is not null))
);

create unique index financial_accounts_owner_category_uidx
  on public.financial_accounts(owner_type,owner_id,account_category,currency) nulls not distinct;
create index financial_accounts_owner_idx on public.financial_accounts(owner_type,owner_id);

create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(idempotency_key) between 3 and 200),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  transaction_type text not null check (transaction_type in (
    'TRIP_FINANCIAL_COMPLETION','DRIVER_COMMISSION','BOOKING_FEE','DRIVER_SETTLEMENT',
    'DRIVER_PAYMENT','DRIVER_SUBSCRIPTION_PAYMENT','DRIVER_SUBSCRIPTION_ACTIVATION',
    'CANCELLATION_FEE','NO_SHOW_FEE','DRIVER_CANCELLATION_COMPENSATION',
    'ADJUSTMENT','REVERSAL','UNAPPLIED_CREDIT','CUSTOMER_PAYMENT','ONLINE_PAYMENT',
    'DRIVER_PAYOUT','REFUND','MEMBERSHIP_PAYMENT','REFERRAL_CREDIT'
  )),
  transaction_state text not null default 'PENDING' check (transaction_state in ('PENDING','POSTED','REVERSED','FAILED')),
  source_type text not null check (source_type in (
    'TRIP','DRIVER_SETTLEMENT','DRIVER_PAYMENT_REQUEST','DRIVER_SUBSCRIPTION_PAYMENT',
    'TRIP_CANCELLATION_FEE','FINANCIAL_TRANSACTION','ADJUSTMENT'
  )),
  source_id uuid not null,
  economic_trip_id uuid null references public.trips(id) on delete restrict,
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  actor_type text not null check (actor_type in ('SYSTEM','OWNER','ADMIN','DRIVER','CUSTOMER')),
  actor_id uuid null,
  effective_at timestamptz not null,
  posted_at timestamptz null,
  reversal_of_transaction_id uuid null references public.financial_transactions(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  schema_version integer not null default 1 check (schema_version=1),
  created_at timestamptz not null default now(),
  check ((transaction_state='POSTED' and posted_at is not null) or transaction_state<>'POSTED'),
  check (
    (transaction_type in ('TRIP_FINANCIAL_COMPLETION','CANCELLATION_FEE','NO_SHOW_FEE') and economic_trip_id is not null)
    or (transaction_type not in ('TRIP_FINANCIAL_COMPLETION','CANCELLATION_FEE','NO_SHOW_FEE') and economic_trip_id is null)
  )
);

create unique index financial_transactions_source_type_uidx
  on public.financial_transactions(transaction_type,source_type,source_id)
  where transaction_state in ('POSTED','REVERSED');
create unique index financial_transactions_one_reversal_uidx
  on public.financial_transactions(reversal_of_transaction_id)
  where reversal_of_transaction_id is not null and transaction_state in ('POSTED','REVERSED');
create unique index financial_transactions_one_terminal_trip_outcome_uidx
  on public.financial_transactions(economic_trip_id)
  where economic_trip_id is not null
    and transaction_type in ('TRIP_FINANCIAL_COMPLETION','CANCELLATION_FEE','NO_SHOW_FEE')
    and transaction_state in ('PENDING','POSTED','REVERSED');
create index financial_transactions_source_idx on public.financial_transactions(source_type,source_id);
create index financial_transactions_effective_idx on public.financial_transactions(effective_at,id);
create index financial_transactions_type_state_idx on public.financial_transactions(transaction_type,transaction_state);

create table public.financial_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  account_id uuid not null references public.financial_accounts(id) on delete restrict,
  sequence_number integer not null check (sequence_number > 0),
  entry_side text not null check (entry_side in ('DEBIT','CREDIT')),
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique(transaction_id,sequence_number)
);

create index financial_ledger_entries_account_idx on public.financial_ledger_entries(account_id,created_at,id);
create index financial_ledger_entries_transaction_idx on public.financial_ledger_entries(transaction_id);

alter table public.financial_accounts enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.financial_ledger_entries enable row level security;
revoke all on public.financial_accounts,public.financial_transactions,public.financial_ledger_entries
  from public,anon,authenticated;
revoke all on public.financial_accounts,public.financial_transactions,public.financial_ledger_entries
  from service_role;
grant select on public.financial_accounts,public.financial_transactions,public.financial_ledger_entries
  to service_role;

create or replace function public.phase1_guard_financial_transaction_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then
    if old.transaction_state in ('POSTED','REVERSED') then raise exception 'Posted financial transactions are immutable'; end if;
    return old;
  end if;
  if old.transaction_state in ('POSTED','REVERSED') then raise exception 'Posted financial transactions are immutable'; end if;
  if new.transaction_state='POSTED' and old.transaction_state<>'PENDING' then raise exception 'Only pending transactions may be posted'; end if;
  return new;
end $$;

create trigger phase1_guard_financial_transaction_mutation_trigger
before update or delete on public.financial_transactions
for each row execute function public.phase1_guard_financial_transaction_mutation();

create or replace function public.phase1_guard_financial_entry_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_state text;
begin
  if tg_op in ('UPDATE','DELETE') then raise exception 'Financial ledger entries are immutable'; end if;
  select transaction_state into v_state from public.financial_transactions where id=new.transaction_id;
  if v_state is distinct from 'PENDING' then raise exception 'Entries may only be added to a pending transaction'; end if;
  return new;
end $$;

create trigger phase1_guard_financial_entry_mutation_trigger
before insert or update or delete on public.financial_ledger_entries
for each row execute function public.phase1_guard_financial_entry_mutation();

create or replace function public.phase1_assert_financial_transaction_balanced()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_debits bigint; v_credits bigint; v_count integer; v_currency_count integer;
begin
  if new.transaction_state <> 'POSTED' then return new; end if;
  select count(*),coalesce(sum(e.amount_cents) filter(where e.entry_side='DEBIT'),0),
    coalesce(sum(e.amount_cents) filter(where e.entry_side='CREDIT'),0),count(distinct a.currency)
  into v_count,v_debits,v_credits,v_currency_count
  from public.financial_ledger_entries e join public.financial_accounts a on a.id=e.account_id
  where e.transaction_id=new.id;
  if v_count<2 or v_debits<=0 or v_debits<>v_credits or v_currency_count<>1 then
    raise exception 'Posted transaction must contain balanced, single-currency entries';
  end if;
  if exists(select 1 from public.financial_ledger_entries e join public.financial_accounts a on a.id=e.account_id
    where e.transaction_id=new.id and a.currency<>new.currency) then
    raise exception 'Entry account currency does not match transaction currency';
  end if;
  return new;
end $$;

create constraint trigger phase1_assert_financial_transaction_balanced_trigger
after insert or update on public.financial_transactions deferrable initially deferred
for each row execute function public.phase1_assert_financial_transaction_balanced();

create or replace function public.phase1_validate_financial_source(p_source_type text,p_source_id uuid)
returns void language plpgsql stable set search_path=public,pg_temp as $$
begin
  if p_source_type='TRIP' and not exists(select 1 from public.trips where id=p_source_id) then raise exception 'Financial source trip does not exist';
  elsif p_source_type='DRIVER_SETTLEMENT' and not exists(select 1 from public.driver_settlements where id=p_source_id) then raise exception 'Financial source settlement does not exist';
  elsif p_source_type='DRIVER_PAYMENT_REQUEST' and not exists(select 1 from public.driver_payment_requests where id=p_source_id) then raise exception 'Financial source payment request does not exist';
  elsif p_source_type='DRIVER_SUBSCRIPTION_PAYMENT' and not exists(select 1 from public.driver_subscription_payments where id=p_source_id) then raise exception 'Financial source subscription payment does not exist';
  elsif p_source_type='TRIP_CANCELLATION_FEE' and not exists(select 1 from public.trip_cancellation_fees where id=p_source_id) then raise exception 'Financial source cancellation fee does not exist';
  elsif p_source_type='FINANCIAL_TRANSACTION' and not exists(select 1 from public.financial_transactions where id=p_source_id) then raise exception 'Financial source transaction does not exist';
  elsif p_source_type='ADJUSTMENT' and p_source_id is null then raise exception 'Adjustment source ID is required';
  end if;
end $$;

create or replace function public.phase1_ensure_financial_account(
  p_account_code text,p_account_category text,p_owner_type text,p_owner_id uuid,
  p_normal_balance_side text,p_currency text default 'ZAR'
) returns public.financial_accounts language plpgsql security definer set search_path=public,pg_temp as $$
declare v_account public.financial_accounts;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if p_owner_type='DRIVER' and not exists(select 1 from public.drivers where id=p_owner_id) then raise exception 'Driver owner does not exist'; end if;
  if p_owner_type='CUSTOMER' and not exists(select 1 from public.customers where id=p_owner_id) then raise exception 'Customer owner does not exist'; end if;
  insert into public.financial_accounts(account_code,account_category,owner_type,owner_id,normal_balance_side,currency)
  values(upper(trim(p_account_code)),p_account_category,p_owner_type,p_owner_id,p_normal_balance_side,p_currency)
  on conflict(account_code) do nothing;
  select * into strict v_account from public.financial_accounts where account_code=upper(trim(p_account_code));
  if v_account.account_category<>p_account_category or v_account.owner_type<>p_owner_type
    or v_account.owner_id is distinct from p_owner_id or v_account.normal_balance_side<>p_normal_balance_side
    or v_account.currency<>p_currency then raise exception 'Account code already exists with a conflicting contract'; end if;
  return v_account;
end $$;

create or replace function public.phase1_post_financial_transaction(
  p_idempotency_key text,p_payload_hash text,p_transaction_type text,p_source_type text,p_source_id uuid,
  p_currency text,p_actor_type text,p_actor_id uuid,p_effective_at timestamptz,p_entries jsonb,
  p_metadata jsonb default '{}'::jsonb,p_reversal_of_transaction_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_transaction public.financial_transactions; v_count integer; v_debits bigint; v_credits bigint;
declare v_currency_count integer; v_inserted_id uuid; v_economic_trip_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if p_currency<>'ZAR' or p_payload_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_entries)<>'array' then raise exception 'Invalid posting contract'; end if;
  perform public.phase1_validate_financial_source(p_source_type,p_source_id);
  select * into v_transaction from public.financial_transactions where idempotency_key=p_idempotency_key;
  if found then
    if v_transaction.payload_hash<>p_payload_hash then raise exception 'Conflicting idempotency replay'; end if;
    return jsonb_build_object('transaction_id',v_transaction.id,'state',v_transaction.transaction_state,'replayed',true);
  end if;

  if p_transaction_type='TRIP_FINANCIAL_COMPLETION' then
    if p_source_type<>'TRIP' then raise exception 'Trip completion requires a trip source'; end if;
    v_economic_trip_id:=p_source_id;
  elsif p_transaction_type in ('CANCELLATION_FEE','NO_SHOW_FEE') then
    if p_source_type<>'TRIP_CANCELLATION_FEE' then raise exception 'Cancellation outcome requires a cancellation-fee source'; end if;
    select trip_id into strict v_economic_trip_id
    from public.trip_cancellation_fees where id=p_source_id;
  end if;

  if v_economic_trip_id is not null then
    perform 1 from public.trips where id=v_economic_trip_id for update;
    if exists(
      select 1 from public.financial_transactions
      where economic_trip_id=v_economic_trip_id
        and transaction_type in ('TRIP_FINANCIAL_COMPLETION','CANCELLATION_FEE','NO_SHOW_FEE')
        and transaction_state in ('PENDING','POSTED','REVERSED')
    ) then
      raise exception 'Incompatible terminal financial outcome already exists for trip';
    end if;
  end if;

  perform 1 from public.financial_accounts where id in (
    select (item->>'account_id')::uuid from jsonb_array_elements(p_entries) item
  ) order by id for update;
  select count(*),coalesce(sum((item->>'amount_cents')::bigint) filter(where item->>'entry_side'='DEBIT'),0),
    coalesce(sum((item->>'amount_cents')::bigint) filter(where item->>'entry_side'='CREDIT'),0),
    count(distinct a.currency)
  into v_count,v_debits,v_credits,v_currency_count
  from jsonb_array_elements(p_entries) item
  join public.financial_accounts a on a.id=(item->>'account_id')::uuid
  where item->>'entry_side' in ('DEBIT','CREDIT') and (item->>'amount_cents')::bigint>0 and a.account_status='ACTIVE';
  if v_count<>jsonb_array_length(p_entries) or v_count<2 or v_debits<=0 or v_debits<>v_credits or v_currency_count<>1
    or exists(select 1 from jsonb_array_elements(p_entries) item join public.financial_accounts a on a.id=(item->>'account_id')::uuid where a.currency<>p_currency)
  then raise exception 'Entries must be valid, active, single-currency, positive and balanced'; end if;

  insert into public.financial_transactions(idempotency_key,payload_hash,transaction_type,transaction_state,
    source_type,source_id,economic_trip_id,currency,actor_type,actor_id,effective_at,reversal_of_transaction_id,metadata)
  values(p_idempotency_key,p_payload_hash,p_transaction_type,'PENDING',p_source_type,p_source_id,v_economic_trip_id,
    p_currency,p_actor_type,p_actor_id,p_effective_at,p_reversal_of_transaction_id,coalesce(p_metadata,'{}'::jsonb))
  on conflict do nothing returning id into v_inserted_id;
  if v_inserted_id is null then
    select * into v_transaction from public.financial_transactions where idempotency_key=p_idempotency_key;
    if not found then raise exception 'Financial source already posted under another operation'; end if;
    if v_transaction.payload_hash<>p_payload_hash then raise exception 'Conflicting idempotency replay'; end if;
    return jsonb_build_object('transaction_id',v_transaction.id,'state',v_transaction.transaction_state,'replayed',true);
  end if;

  insert into public.financial_ledger_entries(transaction_id,account_id,sequence_number,entry_side,amount_cents)
  select v_inserted_id,(item->>'account_id')::uuid,ordinality::integer,item->>'entry_side',(item->>'amount_cents')::bigint
  from jsonb_array_elements(p_entries) with ordinality as entry(item,ordinality);
  update public.financial_transactions set transaction_state='POSTED',posted_at=now() where id=v_inserted_id returning * into v_transaction;
  return jsonb_build_object('transaction_id',v_transaction.id,'state',v_transaction.transaction_state,'replayed',false,
    'debit_cents',v_debits,'credit_cents',v_credits);
end $$;

create or replace function public.phase1_reverse_financial_transaction(
  p_original_transaction_id uuid,p_idempotency_key text,p_payload_hash text,p_actor_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_original public.financial_transactions; v_entries jsonb; v_role text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select role into v_role from public.profiles where id=p_actor_id;
  if v_role not in ('owner','admin') then raise exception 'Owner or Admin actor required'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Reversal reason required'; end if;
  select * into v_original from public.financial_transactions where id=p_original_transaction_id for update;
  if not found or v_original.transaction_state<>'POSTED' then raise exception 'Only posted transactions may be reversed'; end if;
  select jsonb_agg(jsonb_build_object('account_id',account_id,'entry_side',case entry_side when 'DEBIT' then 'CREDIT' else 'DEBIT' end,'amount_cents',amount_cents) order by sequence_number)
  into v_entries from public.financial_ledger_entries where transaction_id=v_original.id;
  return public.phase1_post_financial_transaction(p_idempotency_key,p_payload_hash,'REVERSAL','FINANCIAL_TRANSACTION',
    v_original.id,v_original.currency,'ADMIN',p_actor_id,now(),v_entries,
    jsonb_build_object('reason',trim(p_reason),'original_transaction_id',v_original.id),v_original.id);
end $$;

revoke all on function public.phase1_guard_financial_transaction_mutation() from public,anon,authenticated;
revoke all on function public.phase1_guard_financial_entry_mutation() from public,anon,authenticated;
revoke all on function public.phase1_assert_financial_transaction_balanced() from public,anon,authenticated;
revoke all on function public.phase1_validate_financial_source(text,uuid) from public,anon,authenticated;
revoke all on function public.phase1_ensure_financial_account(text,text,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.phase1_post_financial_transaction(text,text,text,text,uuid,text,text,uuid,timestamptz,jsonb,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.phase1_reverse_financial_transaction(uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.phase1_ensure_financial_account(text,text,text,uuid,text,text) to service_role;
grant execute on function public.phase1_post_financial_transaction(text,text,text,text,uuid,text,text,uuid,timestamptz,jsonb,jsonb,uuid) to service_role;
grant execute on function public.phase1_reverse_financial_transaction(uuid,text,text,uuid,text) to service_role;

commit;
