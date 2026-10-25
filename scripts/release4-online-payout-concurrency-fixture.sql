\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database()<>'release4_payout_race_20261021' then
    raise exception 'Dedicated local payout race database required';
  end if;
end $$;
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare v_actor uuid; v_trip uuid:='a4500000-0000-4000-8000-000000000001';
  v_driver uuid:='a4200000-0000-4000-8000-000000000001';
  v_customer uuid:='a4100000-0000-4000-8000-000000000001';
  v_clearing public.financial_accounts; v_funds public.financial_accounts;
  v_debt public.financial_accounts; v_revenue public.financial_accounts;
  v_payment jsonb; v_attempt uuid;
begin
  select id into strict v_actor from public.profiles where role='customer' limit 1;
  update public.profiles set role='owner' where id=v_actor;
  insert into public.trips(id,customer_id,driver_id,pickup_address,dropoff_address,status,
    completed_at,payment_method,fare_amount,final_fare,original_fare,ride_option,
    commission_amount,driver_net_earnings)
  values(v_trip,v_customer,v_driver,'Synthetic pickup','Synthetic destination',
    'completed',now(),'online',100,100,100,'go',15,85);
  v_clearing:=public.phase1_ensure_financial_account('PLATFORM:PAYMENT_CLEARING:ZAR',
    'PAYMENT_CLEARING','PLATFORM',null,'DEBIT','ZAR');
  v_funds:=public.phase1_ensure_financial_account('PLATFORM:CUSTOMER_FUNDS_LIABILITY:ZAR',
    'UNAPPLIED_FUNDS','PLATFORM',null,'CREDIT','ZAR');
  v_debt:=public.phase1_ensure_financial_account('DRIVER:'||upper(v_driver::text)||':COMMISSION_DEBT:ZAR',
    'DRIVER_COMMISSION_DEBT','DRIVER',v_driver,'DEBIT','ZAR');
  v_revenue:=public.phase1_ensure_financial_account('PLATFORM:COMMISSION_REVENUE:ZAR',
    'COMMISSION_REVENUE','PLATFORM',null,'CREDIT','ZAR');
  v_payment:=public.phase1_post_financial_transaction('release4:payout:race:payment',repeat('a',64),
    'ONLINE_PAYMENT','TRIP',v_trip,'ZAR','SYSTEM',null,now(),jsonb_build_array(
      jsonb_build_object('account_id',v_clearing.id,'entry_side','DEBIT','amount_cents',10000),
      jsonb_build_object('account_id',v_funds.id,'entry_side','CREDIT','amount_cents',10000)),
    jsonb_build_object('synthetic',true));
  perform public.phase1_post_financial_transaction('trip_commission:'||v_trip::text,
    repeat('b',64),'TRIP_FINANCIAL_COMPLETION','TRIP',v_trip,'ZAR','SYSTEM',null,now(),
    jsonb_build_array(
      jsonb_build_object('account_id',v_debt.id,'entry_side','DEBIT','amount_cents',1500),
      jsonb_build_object('account_id',v_revenue.id,'entry_side','CREDIT','amount_cents',1500)),
    jsonb_build_object('synthetic',true));
  insert into public.online_payment_attempts(customer_id,trip_id,provider,amount_cents,
    fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash,verified_at,
    payment_ledger_transaction_id,reconciliation_state)
  values(v_customer,v_trip,'FAKE_TEST',10000,repeat('c',64),'{}','SUCCEEDED',
    'release4:payout:race:attempt',repeat('d',64),now(),
    (v_payment->>'transaction_id')::uuid,'MATCHED') returning id into v_attempt;
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,
    actor_id,payload) values('trip-complete:'||v_trip::text,'trip_completed','trip',v_trip,
    v_actor,jsonb_build_object('synthetic',true));
  perform public.phase3_post_completed_online_driver_payable(v_trip);
  insert into public.online_payout_fee_evidence(payment_attempt_id,actual_fee_cents,
    source_type,source_reference,vat_treatment,verified_by)
  values(v_attempt,350,'PROVIDER_EXPORT','synthetic-race-export-001',
    'TOTAL_INCLUDES_VAT',v_actor);
end $$;
commit;
