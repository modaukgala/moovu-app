-- Candidate only: do not apply to production. Requires Phase 5 policy approval,
-- historical ledger reconciliation, and a separate migration review.
-- Cash/Transfer fees remain a Driver receivable; verified online fees release
-- customer funds held by MOOVU. No new Customer charge or Driver debt is created.
begin;

create or replace function public.phase5_post_service_fee(p_trip_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare t public.trips; v_fee bigint; v_credit_to_fee bigint; v_collected bigint;
  v_source public.financial_accounts; v_revenue public.financial_accounts;
  v_post jsonb; v_payload text; v_online boolean; v_attempt public.online_payment_attempts;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted server role required'; end if;
  select * into t from public.trips where id=p_trip_id for update;
  if not found or t.status<>'completed' or t.phase5_policy_version is null or t.driver_id is null then
    raise exception 'Completed Phase 5 trip required';
  end if;
  v_fee:=greatest(0,t.phase5_service_fee_cents-t.phase5_membership_waiver_cents);
  v_credit_to_fee:=least(v_fee,t.phase5_credit_cents);
  v_collected:=v_fee-v_credit_to_fee;
  if v_collected=0 then
    return jsonb_build_object('trip_id',t.id,'amount_cents',0,'replayed',true);
  end if;
  v_online:=lower(coalesce(t.payment_method,'cash'))='online';
  if v_online then
    select * into v_attempt from public.online_payment_attempts p
    where p.trip_id=t.id and p.state='SUCCEEDED' and p.verified_at is not null
      and p.currency='ZAR' and p.amount_cents=t.phase5_customer_total_cents
      and exists(select 1 from public.financial_transactions ft
        where ft.id=p.payment_ledger_transaction_id and ft.transaction_type='ONLINE_PAYMENT'
          and ft.transaction_state='POSTED' and ft.source_type='TRIP' and ft.source_id=t.id)
    order by p.created_at desc limit 1 for update;
    if not found then raise exception 'Verified online payment is required for booking fee'; end if;
    v_source:=public.phase1_ensure_financial_account(
      'PLATFORM:CUSTOMER_FUNDS_LIABILITY:ZAR','UNAPPLIED_FUNDS','PLATFORM',null,'CREDIT','ZAR');
  else
    v_source:=public.phase1_ensure_financial_account(
      coalesce((select account_code from public.financial_accounts
        where owner_type='DRIVER' and owner_id=t.driver_id
          and account_category='COMMISSION_RECEIVABLE' and currency='ZAR'),
        'PHASE5:DRIVER:'||upper(t.driver_id::text)||':SERVICE_FEE'),
      'COMMISSION_RECEIVABLE','DRIVER',t.driver_id,'DEBIT','ZAR');
  end if;
  v_revenue:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts where owner_type='PLATFORM'
      and owner_id is null and account_category='BOOKING_FEE_REVENUE' and currency='ZAR'),
      'PHASE5:SERVICE_FEE:REVENUE'),
    'BOOKING_FEE_REVENUE','PLATFORM',null,'CREDIT','ZAR');
  v_payload:=t.id||':'||v_collected||':'||t.driver_id||':'||t.phase5_policy_version;
  v_post:=public.phase1_post_financial_transaction('phase5:service-fee:'||t.id,
    encode(digest(convert_to(v_payload,'UTF8'),'sha256'),'hex'),'BOOKING_FEE','ADJUSTMENT',t.id,
    'ZAR','SYSTEM',p_actor_id,now(),
    jsonb_build_array(
      jsonb_build_object('account_id',v_source.id,'entry_side','DEBIT','amount_cents',v_collected),
      jsonb_build_object('account_id',v_revenue.id,'entry_side','CREDIT','amount_cents',v_collected)),
    jsonb_build_object('trip_id',t.id,'driver_id',t.driver_id,'policy_version',t.phase5_policy_version,
      'cash_received_by_moovu',v_online,'payment_attempt_id',case when v_online then v_attempt.id else null end,
      'gross_service_fee_cents',v_fee,'credit_applied_to_service_fee_cents',v_credit_to_fee));
  insert into public.phase5_audit_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
  values('service-fee-posted:'||t.id,'SERVICE_FEE_POSTED','TRIP',t.id,p_actor_id,
    jsonb_build_object('amount_cents',v_collected,'financial_transaction_id',v_post->>'transaction_id',
      'cash_received_by_moovu',v_online))
  on conflict(event_key) do nothing;
  return jsonb_build_object('trip_id',t.id,'amount_cents',v_collected,
    'financial_transaction_id',v_post->>'transaction_id','replayed',v_post->'replayed');
end $$;

revoke all on function public.phase5_post_service_fee(uuid,uuid) from public,anon,authenticated;
grant execute on function public.phase5_post_service_fee(uuid,uuid) to service_role;
commit;
