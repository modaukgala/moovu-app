-- PHASE 4B FINANCIAL CUTOVER ONLY. DO NOT APPLY TO PRODUCTION WITHOUT SEPARATE APPROVAL.

-- Requires the dormant Phase 4B schema package. Replaces existing Phase 1 functions.

-- Activate only with coordinated server-route and policy cutover after production review.

begin;

create or replace function public.phase1_validate_financial_source(p_source_type text,p_source_id uuid)
returns void language plpgsql stable set search_path=public,pg_temp as $$
begin
  if p_source_type='PHASE4_ASSESSMENT' and not exists(select 1 from public.phase4_fee_assessments where id=p_source_id) then
    raise exception 'Financial source Phase 4 assessment does not exist';
  elsif p_source_type='TRIP' and not exists(select 1 from public.trips where id=p_source_id) then raise exception 'Financial source trip does not exist';
  elsif p_source_type='DRIVER_SETTLEMENT' and not exists(select 1 from public.driver_settlements where id=p_source_id) then raise exception 'Financial source settlement does not exist';
  elsif p_source_type='DRIVER_PAYMENT_REQUEST' and not exists(select 1 from public.driver_payment_requests where id=p_source_id) then raise exception 'Financial source payment request does not exist';
  elsif p_source_type='DRIVER_SUBSCRIPTION_PAYMENT' and not exists(select 1 from public.driver_subscription_payments where id=p_source_id) then raise exception 'Financial source subscription payment does not exist';
  elsif p_source_type='TRIP_CANCELLATION_FEE' and not exists(select 1 from public.trip_cancellation_fees where id=p_source_id) then raise exception 'Financial source cancellation fee does not exist';
  elsif p_source_type='FINANCIAL_TRANSACTION' and not exists(select 1 from public.financial_transactions where id=p_source_id) then raise exception 'Financial source transaction does not exist';
  elsif p_source_type='ADJUSTMENT' and p_source_id is null then raise exception 'Adjustment source ID is required';
  end if;
end $$;

create or replace function public.phase1_post_financial_transaction(
  p_idempotency_key text,p_payload_hash text,p_transaction_type text,p_source_type text,p_source_id uuid,
  p_currency text,p_actor_type text,p_actor_id uuid,p_effective_at timestamptz,p_entries jsonb,
  p_metadata jsonb default '{}'::jsonb,p_reversal_of_transaction_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_transaction public.financial_transactions;v_count integer;v_debits bigint;v_credits bigint;
  v_currency_count integer;v_inserted_id uuid;v_economic_trip_id uuid;v_trip_status text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required';end if;
  if p_currency<>'ZAR' or p_payload_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_entries)<>'array' then raise exception 'Invalid posting contract';end if;
  perform public.phase1_validate_financial_source(p_source_type,p_source_id);
  select * into v_transaction from public.financial_transactions where idempotency_key=p_idempotency_key;
  if found then
    if v_transaction.payload_hash<>p_payload_hash then raise exception 'Conflicting idempotency replay';end if;
    return jsonb_build_object('transaction_id',v_transaction.id,'state',v_transaction.transaction_state,'replayed',true);
  end if;
  if p_transaction_type='TRIP_FINANCIAL_COMPLETION' then
    if p_source_type<>'TRIP' then raise exception 'Trip completion requires a trip source';end if;
    v_economic_trip_id:=p_source_id;
  elsif p_transaction_type in ('CANCELLATION_FEE','NO_SHOW_FEE') then
    if p_source_type='PHASE4_ASSESSMENT' then
      select trip_id into strict v_economic_trip_id from public.phase4_fee_assessments where id=p_source_id
        and fee_type=case when p_transaction_type='NO_SHOW_FEE' then 'NO_SHOW' else 'LATE_CANCELLATION' end;
    elsif p_source_type='TRIP_CANCELLATION_FEE' then
      select trip_id into strict v_economic_trip_id from public.trip_cancellation_fees where id=p_source_id;
    else raise exception 'Cancellation outcome requires a fee assessment source';end if;
  end if;
  if v_economic_trip_id is not null then
    select status into v_trip_status from public.trips where id=v_economic_trip_id for update;
    if (p_transaction_type='TRIP_FINANCIAL_COMPLETION' and v_trip_status is distinct from 'completed')
      or (p_transaction_type in ('CANCELLATION_FEE','NO_SHOW_FEE') and v_trip_status is distinct from 'cancelled') then
      raise exception 'Financial outcome disagrees with terminal trip state';end if;
    if p_source_type='PHASE4_ASSESSMENT' and not exists
      (select 1 from public.phase4_fee_assessments a join public.trips t on t.id=a.trip_id
        where a.id=p_source_id and a.trip_id=v_economic_trip_id and
        ((a.fee_type='NO_SHOW' and t.cancellation_type='no_show') or
         (a.fee_type='LATE_CANCELLATION' and t.cancellation_type='late_cancel'))) then
      raise exception 'Assessment does not match terminal outcome';end if;
    if exists(select 1 from public.financial_transactions where economic_trip_id=v_economic_trip_id
      and transaction_type in ('TRIP_FINANCIAL_COMPLETION','CANCELLATION_FEE','NO_SHOW_FEE')
      and transaction_state in ('PENDING','POSTED','REVERSED')) then
      raise exception 'Incompatible terminal financial outcome already exists for trip';end if;
  end if;
  perform 1 from public.financial_accounts where id in
    (select (item->>'account_id')::uuid from jsonb_array_elements(p_entries) item) order by id for update;
  select count(*),coalesce(sum((item->>'amount_cents')::bigint) filter(where item->>'entry_side'='DEBIT'),0),
    coalesce(sum((item->>'amount_cents')::bigint) filter(where item->>'entry_side'='CREDIT'),0),count(distinct a.currency)
  into v_count,v_debits,v_credits,v_currency_count from jsonb_array_elements(p_entries) item
  join public.financial_accounts a on a.id=(item->>'account_id')::uuid
  where item->>'entry_side' in ('DEBIT','CREDIT') and (item->>'amount_cents')::bigint>0 and a.account_status='ACTIVE';
  if v_count<>jsonb_array_length(p_entries) or v_count<2 or v_debits<=0 or v_debits<>v_credits or v_currency_count<>1
    or exists(select 1 from jsonb_array_elements(p_entries) item join public.financial_accounts a
      on a.id=(item->>'account_id')::uuid where a.currency<>p_currency)
    then raise exception 'Entries must be valid, active, single-currency, positive and balanced';end if;
  insert into public.financial_transactions(idempotency_key,payload_hash,transaction_type,transaction_state,
    source_type,source_id,economic_trip_id,currency,actor_type,actor_id,effective_at,reversal_of_transaction_id,metadata)
  values(p_idempotency_key,p_payload_hash,p_transaction_type,'PENDING',p_source_type,p_source_id,v_economic_trip_id,
    p_currency,p_actor_type,p_actor_id,p_effective_at,p_reversal_of_transaction_id,coalesce(p_metadata,'{}'::jsonb))
  on conflict do nothing returning id into v_inserted_id;
  if v_inserted_id is null then
    select * into v_transaction from public.financial_transactions where idempotency_key=p_idempotency_key;
    if not found then raise exception 'Financial source already posted under another operation';end if;
    if v_transaction.payload_hash<>p_payload_hash then raise exception 'Conflicting idempotency replay';end if;
    return jsonb_build_object('transaction_id',v_transaction.id,'state',v_transaction.transaction_state,'replayed',true);
  end if;
  insert into public.financial_ledger_entries(transaction_id,account_id,sequence_number,entry_side,amount_cents)
    select v_inserted_id,(item->>'account_id')::uuid,ordinality::integer,item->>'entry_side',(item->>'amount_cents')::bigint
    from jsonb_array_elements(p_entries) with ordinality as entry(item,ordinality);
  update public.financial_transactions set transaction_state='POSTED',posted_at=now() where id=v_inserted_id returning * into v_transaction;
  return jsonb_build_object('transaction_id',v_transaction.id,'state',v_transaction.transaction_state,'replayed',false,
    'debit_cents',v_debits,'credit_cents',v_credits);
end $$;

commit;
