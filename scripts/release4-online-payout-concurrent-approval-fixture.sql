\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database()<>'release4_final_cert_20261021' then
    raise exception 'Dedicated local payout database required';
  end if;
end $$;
select set_config('request.jwt.claim.role','service_role',true);

do $$ declare v_actor uuid; v_importer uuid:='a4500000-0000-4000-8000-000000000001';
  v_reviewer uuid:='a4500000-0000-4000-8000-000000000002';
  v_evidence uuid; v_settlement jsonb;
  v_trip uuid:='a4400000-0000-4000-8000-000000000001';
  v_driver uuid:='a4200000-0000-4000-8000-000000000001';
  v_customer uuid:='a4100000-0000-4000-8000-000000000001';
  v_clearing public.financial_accounts; v_funds public.financial_accounts;
  v_debt public.financial_accounts; v_revenue public.financial_accounts;
  v_payment jsonb; v_commission jsonb; v_attempt uuid; v_payable uuid;
  v_batch uuid; v_replay_failed boolean:=false;
  v_paid_blocked boolean:=false; v_evidence_immutable boolean:=false;
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
  v_payment:=public.phase1_post_financial_transaction('release4:payout:test:payment',repeat('a',64),
    'ONLINE_PAYMENT','TRIP',v_trip,'ZAR','SYSTEM',null,now(),jsonb_build_array(
      jsonb_build_object('account_id',v_clearing.id,'entry_side','DEBIT','amount_cents',10000),
      jsonb_build_object('account_id',v_funds.id,'entry_side','CREDIT','amount_cents',10000)),
    jsonb_build_object('synthetic',true));
  v_commission:=public.phase1_post_financial_transaction('trip_commission:'||v_trip::text,
    repeat('b',64),'TRIP_FINANCIAL_COMPLETION','TRIP',v_trip,'ZAR','SYSTEM',null,now(),
    jsonb_build_array(
      jsonb_build_object('account_id',v_debt.id,'entry_side','DEBIT','amount_cents',1500),
      jsonb_build_object('account_id',v_revenue.id,'entry_side','CREDIT','amount_cents',1500)),
    jsonb_build_object('synthetic',true));
  insert into public.online_payment_attempts(customer_id,trip_id,provider,amount_cents,
    fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash,verified_at,
    payment_ledger_transaction_id,reconciliation_state)
  values(v_customer,v_trip,'FAKE_TEST',10000,repeat('c',64),'{}','SUCCEEDED',
    'release4:payout:test:attempt',repeat('d',64),now(),
    (v_payment->>'transaction_id')::uuid,'MATCHED') returning id into v_attempt;
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,
    actor_id,payload) values('trip-complete:'||v_trip::text,'trip_completed','trip',v_trip,
    v_actor,jsonb_build_object('synthetic',true));
  select (public.phase3_post_completed_online_driver_payable(v_trip)->>'payable_id')::uuid into v_payable;
  if (select coalesce(sum(case e.entry_side when 'CREDIT' then e.amount_cents else -e.amount_cents end),0)
      from public.financial_ledger_entries e join public.financial_transactions ft on ft.id=e.transaction_id
      join public.financial_accounts a on a.id=e.account_id
      where a.account_category='COMMISSION_REVENUE' and ft.idempotency_key in
        ('trip_commission:'||v_trip::text,'online_service_completion:'||v_trip::text)
        and ft.transaction_state='POSTED')<>1500
    or (select coalesce(sum(case e.entry_side when 'DEBIT' then e.amount_cents else -e.amount_cents end),0)
      from public.financial_ledger_entries e join public.financial_transactions ft on ft.id=e.transaction_id
      join public.financial_accounts a on a.id=e.account_id
      where a.account_category='DRIVER_COMMISSION_DEBT' and a.owner_id=v_driver
        and ft.idempotency_key in
          ('trip_commission:'||v_trip::text,'online_service_completion:'||v_trip::text)
        and ft.transaction_state='POSTED')<>0
  then raise exception 'Online trip commission was duplicated or debt remained'; end if;
  insert into public.online_payout_fee_evidence(payment_attempt_id,actual_fee_cents,
    source_type,source_reference,vat_treatment,verified_by)
  values(v_attempt,350,'PROVIDER_EXPORT','synthetic-yoco-export-001',
    'TOTAL_INCLUDES_VAT',v_actor);
  v_batch:=public.release4_create_payout_draft(v_driver,
    date_trunc('week',now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg',
    (date_trunc('week',now() at time zone 'Africa/Johannesburg')+interval '7 days') at time zone 'Africa/Johannesburg',
    array[v_payable],v_actor);
  perform public.release4_review_payout(v_batch,'RECONCILE',v_actor,null);
  update public.online_payout_policy set enabled=true,approved_driver_fee_share_bps=5000,
    approval_reference='synthetic-concurrency-policy',approved_by=v_actor,approved_at=now()
    where policy_key='manual-online-payouts';
  insert into public.online_payout_beneficiaries(driver_id,account_fingerprint,
    verification_reference,consent_reference,verified_by,verified_at,active)
  values(v_driver,repeat('a',64),'synthetic-concurrency-bank-check',
    'synthetic-concurrency-consent',v_actor,now(),true);
end $$;
\echo CONNECTED_SYNTHETIC_APPROVAL_RACE_FIXTURE_READY
commit;