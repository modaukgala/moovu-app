-- Release 4 candidate only. Requires separate managed-schema and accounting review. Never apply automatically.
-- Reclassifies only the locked trip fare; any distinct payment remainder needs its own approved accounting policy.
-- Phase 3 online completion payable seam. Disposable validation only until
-- separately reviewed and approved for production. Foundation is unchanged.
begin;

do $$ begin
  if not exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='trips'
      and column_name='phase5_driver_fare_basis_cents') then
    raise exception 'Locked fare basis column is required';
  end if;
end $$;

create or replace function public.phase3_post_completed_online_driver_payable(p_trip_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_trip public.trips;
  v_attempt public.online_payment_attempts;
  v_existing public.online_driver_payables;
  v_fare_cents bigint;
  v_payment_total_cents bigint;
  v_commission_cents bigint;
  v_driver_net_cents bigint;
  v_funds public.financial_accounts;
  v_driver_payable public.financial_accounts;
  v_debt public.financial_accounts;
  v_post jsonb;
  v_entries jsonb;
  v_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted server role required';
  end if;
  select * into v_trip from public.trips where id=p_trip_id for update;
  if not found then raise exception 'Trip not found'; end if;
  if lower(coalesce(v_trip.payment_method,'cash'))<>'online' then
    return jsonb_build_object('result','NOT_ONLINE');
  end if;
  if v_trip.status<>'completed' or v_trip.completed_at is null or v_trip.driver_id is null
    or not exists(select 1 from public.moovu_business_events
      where event_key='trip-complete:'||v_trip.id::text and event_type='trip_completed')
  then raise exception 'Authoritative trip completion is required'; end if;

  select * into v_attempt from public.online_payment_attempts
  where trip_id=p_trip_id and state='SUCCEEDED' and verified_at is not null
    and payment_ledger_transaction_id is not null and currency='ZAR'
  order by created_at desc limit 1 for update;
  if not found then raise exception 'Verified online payment is required'; end if;

  v_payment_total_cents:=round(coalesce(v_trip.final_fare,v_trip.fare_amount)*100)::bigint;
  v_fare_cents:=case when v_trip.phase5_policy_version is not null
    then v_trip.phase5_driver_fare_basis_cents else v_payment_total_cents end;
  v_commission_cents:=round(v_trip.commission_amount*100)::bigint;
  v_driver_net_cents:=round(v_trip.driver_net_earnings*100)::bigint;
  if v_fare_cents is null or v_fare_cents<=0 or v_payment_total_cents<v_fare_cents
    or v_attempt.amount_cents<>v_payment_total_cents
    or (v_trip.phase5_policy_version is not null and
      v_trip.phase5_customer_total_cents is distinct from v_payment_total_cents)
    or not exists(select 1 from public.financial_transactions ft
      where ft.id=v_attempt.payment_ledger_transaction_id and ft.transaction_type='ONLINE_PAYMENT'
        and ft.transaction_state='POSTED' and ft.source_type='TRIP' and ft.source_id=p_trip_id)
    or v_commission_cents is null or v_commission_cents<0 or v_commission_cents>=v_fare_cents
    or v_driver_net_cents is null or v_driver_net_cents<>v_fare_cents-v_commission_cents
    or not exists(select 1 from public.financial_transactions ft
      join public.financial_ledger_entries e on e.transaction_id=ft.id
      join public.financial_accounts a on a.id=e.account_id
      where ft.idempotency_key='trip_commission:'||p_trip_id::text
        and ft.transaction_type='TRIP_FINANCIAL_COMPLETION'
        and ft.transaction_state='POSTED' and ft.source_type='TRIP' and ft.source_id=p_trip_id
        and a.account_category='DRIVER_COMMISSION_DEBT'
        and a.owner_type='DRIVER' and a.owner_id=v_trip.driver_id
        and e.entry_side='DEBIT' and e.amount_cents=v_commission_cents)
  then raise exception 'Online fare or authoritative legacy commission requires reconciliation'; end if;

  select * into v_existing from public.online_driver_payables where trip_id=p_trip_id for update;
  if found then
    if v_existing.payment_attempt_id<>v_attempt.id or v_existing.driver_id<>v_trip.driver_id
      or v_existing.fare_cents<>v_fare_cents or v_existing.commission_cents<>v_commission_cents
      or v_existing.idempotency_key<>'online_driver_payable:'||p_trip_id::text
    then raise exception 'Conflicting online Driver payable replay'; end if;
  end if;

  -- Phase 2 already recognized the trip commission as revenue and debited
  -- Driver commission debt. Online collection clears that current-trip debt
  -- rather than recognizing the same commission a second time.
  v_funds:=public.phase1_ensure_financial_account(
    'PLATFORM:CUSTOMER_FUNDS_LIABILITY:ZAR','UNAPPLIED_FUNDS','PLATFORM',null,'CREDIT','ZAR');
  v_driver_payable:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts
      where owner_type='DRIVER' and owner_id=v_trip.driver_id
        and account_category='DRIVER_EARNINGS_PAYABLE' and currency='ZAR'),
      'DRIVER:'||upper(v_trip.driver_id::text)||':EARNINGS_PAYABLE:ZAR'),
    'DRIVER_EARNINGS_PAYABLE','DRIVER',v_trip.driver_id,'CREDIT','ZAR');
  v_debt:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts
      where owner_type='PLATFORM' and owner_id is null
        and account_category='DRIVER_COMMISSION_DEBT' and currency='ZAR'),
      'DRIVER:'||upper(v_trip.driver_id::text)||':COMMISSION_DEBT:ZAR'),
    'DRIVER_COMMISSION_DEBT','DRIVER',v_trip.driver_id,'DEBIT','ZAR');
  v_entries:=jsonb_build_array(
    jsonb_build_object('account_id',v_funds.id,'entry_side','DEBIT','amount_cents',v_fare_cents),
    jsonb_build_object('account_id',v_driver_payable.id,'entry_side','CREDIT','amount_cents',v_driver_net_cents),
    jsonb_build_object('account_id',v_debt.id,'entry_side','CREDIT','amount_cents',v_commission_cents));
  v_hash:=encode(extensions.digest(v_trip.id::text||':'||v_attempt.id::text||':'||
    v_fare_cents::text||':'||v_commission_cents::text||':'||v_driver_net_cents::text,'sha256'),'hex');
  v_post:=public.phase1_post_financial_transaction(
    'online_service_completion:'||v_trip.id::text,v_hash,
    'ADJUSTMENT','ADJUSTMENT',v_attempt.id,'ZAR','SYSTEM',null,v_trip.completed_at,
    v_entries,jsonb_build_object('kind','ONLINE_SERVICE_COMPLETION_RECLASS',
      'trip_id',v_trip.id,'payment_attempt_id',v_attempt.id,
      'economic_basis','LEGACY_AUTHORITATIVE'),null);

  if v_existing.id is not null then
    if v_existing.ledger_transaction_id is not null
      and v_existing.ledger_transaction_id<>(v_post->>'transaction_id')::uuid then
      raise exception 'Conflicting online Driver payable ledger replay'; end if;
    if v_existing.ledger_transaction_id is null then
      update public.online_driver_payables set ledger_transaction_id=(v_post->>'transaction_id')::uuid
      where id=v_existing.id;
    end if;
    return jsonb_build_object('result','REPLAYED','payable_id',v_existing.id,
      'payable_cents',v_existing.payable_cents,'ledger_transaction_id',v_post->>'transaction_id');
  end if;

  insert into public.online_driver_payables(
    trip_id,payment_attempt_id,driver_id,fare_cents,commission_cents,currency,
    state,idempotency_key,earned_at,ledger_transaction_id
  ) values (
    p_trip_id,v_attempt.id,v_trip.driver_id,v_fare_cents,v_commission_cents,'ZAR',
    'EARNED','online_driver_payable:'||p_trip_id::text,v_trip.completed_at,
    (v_post->>'transaction_id')::uuid
  ) returning * into v_existing;
  return jsonb_build_object('result','CREATED','payable_id',v_existing.id,
    'payable_cents',v_existing.payable_cents,'ledger_transaction_id',v_post->>'transaction_id');
end $$;

revoke all on function public.phase3_post_completed_online_driver_payable(uuid) from public,anon,authenticated;
grant execute on function public.phase3_post_completed_online_driver_payable(uuid) to service_role;

create or replace function public.phase3_validate_online_driver_payable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if not exists(
    select 1 from public.online_payment_attempts p join public.trips t on t.id=p.trip_id
    where p.id=new.payment_attempt_id and p.trip_id=new.trip_id
      and p.state='SUCCEEDED' and p.verified_at is not null
      and p.amount_cents=round(coalesce(t.final_fare,t.fare_amount)*100)::bigint
      and new.fare_cents=case when t.phase5_policy_version is not null
        then t.phase5_driver_fare_basis_cents
        else round(coalesce(t.final_fare,t.fare_amount)*100)::bigint end
      and (t.phase5_policy_version is null or
        t.phase5_customer_total_cents=p.amount_cents)
      and p.amount_cents>=new.fare_cents and p.currency=new.currency
      and t.driver_id=new.driver_id and t.status='completed' and t.completed_at is not null
  ) then raise exception 'Driver payable requires verified payment, locked fare basis and completed trip'; end if;
  return new;
end $$;
revoke all on function public.phase3_validate_online_driver_payable() from public,anon,authenticated;

commit;
