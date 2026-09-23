-- Disposable-only reset to installed Phase 4A baseline before exact Phase 4B replay.
-- Original Phase 1 function definitions below were read from production metadata, read-only.
begin;
do $$ begin
  if (select count(*) from public.phase4_policies)<>0 or
    (select count(*) from public.phase4_fee_assessments)<>0 or
    (select count(*) from public.phase4_customer_liabilities)<>0 or
    (select count(*) from public.phase4_driver_compensations)<>0 or
    (select count(*) from public.phase4_customer_grace_cycles)<>0 or
    (select count(*) from public.phase4_grace_ride_consumptions)<>0 or
    (select count(*) from public.phase4_financial_actions)<>0 or
    (select count(*) from public.phase4b_cancellation_quotes)<>0 or
    (select count(*) from public.financial_transactions where source_type='PHASE4_ASSESSMENT')<>0 or
    (select count(*) from public.trip_cancellation_fees where phase4_assessment_id is not null)<>0
  then raise exception 'Phase 4B reset refused: retained financial/test data'; end if;
end $$;
drop function public.phase4b_reverse_unpaid_assessment(uuid,uuid,text);
drop function public.phase4b_cancel_trip_operational(uuid,uuid,text,text);
drop function public.phase4b_expire_dispatch_trip(uuid);
drop function public.phase4b_mark_customer_no_show(uuid,uuid,uuid);
drop function public.phase4b_cancel_customer_trip(uuid,uuid,uuid,uuid,text,text);
drop function public.phase4b_record_assessment(public.trips,public.phase4_policies,uuid,text,bigint,bigint,bigint,timestamptz);
drop function public.phase4b_post_assessment(uuid,uuid);
drop function public.phase4b_quote_customer_cancellation(uuid,uuid,uuid);
drop function public.phase4b_cancellation_terms(public.trips,public.phase4_policies,timestamptz);
drop function public.phase4b_assert_owner_policy(public.phase4_policies);
drop function public.phase4b_service(text);
drop table public.phase4b_cancellation_quotes;
alter table public.trip_cancellation_fees drop column phase4_assessment_id;
alter table public.financial_transactions drop constraint financial_transactions_source_type_check;
alter table public.financial_transactions add constraint financial_transactions_source_type_check check (source_type in
  ('TRIP','DRIVER_SETTLEMENT','DRIVER_PAYMENT_REQUEST','DRIVER_SUBSCRIPTION_PAYMENT',
   'TRIP_CANCELLATION_FEE','FINANCIAL_TRANSACTION','ADJUSTMENT'));
CREATE OR REPLACE FUNCTION public.phase1_post_financial_transaction(p_idempotency_key text, p_payload_hash text, p_transaction_type text, p_source_type text, p_source_id uuid, p_currency text, p_actor_type text, p_actor_id uuid, p_effective_at timestamp with time zone, p_entries jsonb, p_metadata jsonb DEFAULT '{}'::jsonb, p_reversal_of_transaction_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$;
CREATE OR REPLACE FUNCTION public.phase1_validate_financial_source(p_source_type text, p_source_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p_source_type='TRIP' and not exists(select 1 from public.trips where id=p_source_id) then raise exception 'Financial source trip does not exist';
  elsif p_source_type='DRIVER_SETTLEMENT' and not exists(select 1 from public.driver_settlements where id=p_source_id) then raise exception 'Financial source settlement does not exist';
  elsif p_source_type='DRIVER_PAYMENT_REQUEST' and not exists(select 1 from public.driver_payment_requests where id=p_source_id) then raise exception 'Financial source payment request does not exist';
  elsif p_source_type='DRIVER_SUBSCRIPTION_PAYMENT' and not exists(select 1 from public.driver_subscription_payments where id=p_source_id) then raise exception 'Financial source subscription payment does not exist';
  elsif p_source_type='TRIP_CANCELLATION_FEE' and not exists(select 1 from public.trip_cancellation_fees where id=p_source_id) then raise exception 'Financial source cancellation fee does not exist';
  elsif p_source_type='FINANCIAL_TRANSACTION' and not exists(select 1 from public.financial_transactions where id=p_source_id) then raise exception 'Financial source transaction does not exist';
  elsif p_source_type='ADJUSTMENT' and p_source_id is null then raise exception 'Adjustment source ID is required';
  end if;
end $function$;
commit;
