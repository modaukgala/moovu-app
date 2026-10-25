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
  if not exists(select 1 from public.online_payout_batches where id=v_batch and status='DRAFT'
    and fare_cents=10000 and current_commission_cents=1500
    and driver_earnings_cents=8500 and actual_provider_fee_cents=350
    and driver_provider_fee_cents=0 and prior_debt_recovery_cents=0 and net_payout_cents=8500)
  then raise exception 'Draft totals do not reconcile'; end if;
  if (select count(*) from public.online_payout_items where batch_id=v_batch)<>1
  then raise exception 'Draft item missing'; end if;
  begin
    update public.online_payout_batches set status='RECONCILED' where id=v_batch;
    raise exception 'Direct review update was accepted';
  exception when others then
    if sqlerrm<>'Payout transition requires authorized RPC' then raise; end if;
  end;
  if public.release4_review_payout(v_batch,'RECONCILE',v_actor,null)<>'RECONCILED'
    or public.release4_review_payout(v_batch,'RECONCILE',v_actor,null)<>'RECONCILED'
    then raise exception 'Reconciliation or idempotent replay failed'; end if;
  if public.release4_review_payout(v_batch,'HOLD',v_actor,'External review pending')<>'HELD'
    then raise exception 'Hold failed'; end if;
  begin
    insert into public.online_payment_refunds(payment_attempt_id,provider,amount_cents,
      idempotency_key,reason,requested_by)
    values(v_attempt,'FAKE_TEST',100,'release4:review:refund-pending',
      'Synthetic partial refund',v_actor);
    begin
      perform public.release4_review_payout(v_batch,'RECONCILE',v_actor,null);
      raise exception 'Refund-affected payout was reconciled';
    exception when others then
      if sqlerrm<>'Payout item no longer reconciles' then raise; end if;
    end;
    raise exception 'ROLLBACK_SYNTHETIC_REFUND';
  exception when others then
    if sqlerrm<>'ROLLBACK_SYNTHETIC_REFUND' then raise; end if;
  end;
  if public.release4_review_payout(v_batch,'RECONCILE',v_actor,null)<>'RECONCILED'
    then raise exception 'Held reconciliation failed'; end if;
  if (select count(*) from public.online_payout_audit_events where batch_id=v_batch
      and event_type='REVIEW_RECONCILED')<>2
    or (select count(*) from public.online_payout_audit_events where batch_id=v_batch
      and event_type='REVIEW_HELD')<>1
    then raise exception 'Review audit replay mismatch'; end if;
  begin
    update public.online_payout_batches set status='PAID',approved_snapshot='{}'::jsonb,
      approval_actor=v_actor,approved_at=now(),payment_actor=v_actor,paid_at=now(),
      payout_method='EFT',transfer_reference='synthetic-transfer',
      transfer_evidence_reference='synthetic-evidence' where id=v_batch;
  exception when others then
    if sqlerrm='Payout financial transition requires authorized RPC' then v_paid_blocked:=true; else raise; end if;
  end;
  if not v_paid_blocked then raise exception 'Direct PAID mutation was accepted'; end if;
  begin
    update public.online_payout_fee_evidence set actual_fee_cents=1
      where payment_attempt_id=v_attempt;
  exception when others then
    if sqlerrm='Verified provider-fee evidence is immutable'
      then v_evidence_immutable:=true; else raise; end if;
  end;
  if not v_evidence_immutable then raise exception 'Fee evidence update was accepted'; end if;
  begin
    perform public.release4_create_payout_draft(v_driver,now()-interval '1 day',
      now()+interval '1 day',array[v_payable],v_actor);
  exception when unique_violation then v_replay_failed:=true;
  end;
  if not v_replay_failed then raise exception 'Duplicate payout item was accepted'; end if;
  if (select count(*) from public.online_payout_batches)<>1
    or (select count(*) from public.online_payout_items)<>1 then
    raise exception 'Duplicate failure left partial records'; end if;
  if (select count(*) from public.financial_transactions where idempotency_key like 'release4:payout:batch:%')<>0
  then raise exception 'Draft unexpectedly posted financial entries'; end if;
  if has_table_privilege('authenticated','public.online_payout_batches','SELECT')
    or has_table_privilege('authenticated','public.online_payout_batches','INSERT')
    or has_function_privilege('authenticated',
      'public.release4_create_payout_draft(uuid,timestamptz,timestamptz,uuid[],uuid)','EXECUTE')
    or has_function_privilege('authenticated',
      'public.release4_review_payout(uuid,text,uuid,text)','EXECUTE')
  then raise exception 'Authenticated role has direct payout authority'; end if;
  update public.online_payout_policy set enabled=true,approved_driver_fee_share_bps=5000,
    approval_reference='synthetic-owner-policy',approved_by=v_actor,approved_at=now()
    where policy_key='manual-online-payouts';
  insert into public.online_payout_beneficiaries(driver_id,account_fingerprint,
    verification_reference,consent_reference,verified_by,verified_at,active)
    values(v_driver,repeat('a',64),'synthetic-bank-account-check',
      'synthetic-driver-consent',v_actor,now(),true);
  if (public.release4_approve_payout(v_batch,v_actor,'synthetic-approval-operation-001')->>'status')<>'APPROVED'
    or (public.release4_approve_payout(v_batch,v_actor,'synthetic-approval-operation-001')->>'replayed')<>'true'
    then raise exception 'Approval or idempotent replay failed'; end if;
  if not exists(select 1 from public.online_payout_batches where id=v_batch
      and status='APPROVED' and fee_share_basis_points=5000
      and driver_provider_fee_cents=175 and prior_debt_recovery_cents>=0
      and net_payout_cents+prior_debt_recovery_cents=8325
      and approved_snapshot is not null)
    then raise exception 'Approved 50/50 fee snapshot failed'; end if;
  if (select count(*) from public.online_payout_audit_events where batch_id=v_batch
      and event_type='APPROVED')<>1
    then raise exception 'Approval audit replay mismatch'; end if;
  if (select prior_debt_recovery_cents from public.online_payout_batches where id=v_batch)>0 then
    begin
      perform public.phase1_post_financial_transaction('synthetic-manual-debt-clash',repeat('f',64),
        'DRIVER_PAYMENT','ADJUSTMENT',gen_random_uuid(),'ZAR','SYSTEM',null,now(),
        jsonb_build_array(
          jsonb_build_object('account_id',v_clearing.id,'entry_side','DEBIT',
            'amount_cents',(select prior_debt_recovery_cents from public.online_payout_batches where id=v_batch)),
          jsonb_build_object('account_id',v_debt.id,'entry_side','CREDIT',
            'amount_cents',(select prior_debt_recovery_cents from public.online_payout_batches where id=v_batch))),
        jsonb_build_object('synthetic',true));
      raise exception 'Manual settlement consumed reserved commission debt';
    exception when others then
      if sqlerrm<>'Commission debt is reserved by an approved payout' then raise; end if;
    end;
  end if;
  begin
    perform public.release4_review_payout(v_batch,'RECONCILE',v_actor,null);
    raise exception 'Approved batch was reopened';
  exception when others then
    if sqlerrm<>'Payout review transition unavailable' then raise; end if;
  end;
  insert into auth.users(id) values(v_importer),(v_reviewer);
  insert into public.profiles(id,role) values(v_importer,'admin'),(v_reviewer,'owner')
    on conflict(id) do update set role=excluded.role;
  if public.release4_record_transfer(v_batch,v_actor,'PAYSHAP',
    'synthetic-transfer-001','synthetic-proof-reference',now())<>'PAYMENT_RECORDED'
    or public.release4_record_transfer(v_batch,v_actor,'PAYSHAP',
      'synthetic-transfer-001','synthetic-proof-reference',now())<>'PAYMENT_RECORDED'
    then raise exception 'Transfer recording replay failed'; end if;
  begin
    perform public.release4_verify_and_settle_payout(v_batch,gen_random_uuid(),v_reviewer);
    raise exception 'Bankless payout was settled';
  exception when others then
    if sqlerrm<>'Independent settled bank evidence and second reviewer required' then raise; end if;
  end;
  begin
    v_evidence:=public.release4_import_bank_evidence(v_batch,v_importer,
      'synthetic-failed-bank-001','synthetic-transfer-001',
      (select net_payout_cents from public.online_payout_batches where id=v_batch),
      0,repeat('a',64),'LOCAL_SYNTHETIC',repeat('d',64),'FAILED');
    perform public.release4_close_unpaid_payout(v_batch,v_reviewer,'FAILED',
      'Synthetic failed transfer',v_evidence);
    if (select status from public.online_payout_batches where id=v_batch)<>'FAILED'
      then raise exception 'Verified failed transfer did not release payout'; end if;
    raise exception 'ROLLBACK_SYNTHETIC_BANK_FAILURE';
  exception when others then
    if sqlerrm<>'ROLLBACK_SYNTHETIC_BANK_FAILURE' then raise; end if;
  end;
  v_evidence:=public.release4_import_bank_evidence(v_batch,v_importer,
    'synthetic-bank-transaction-001','synthetic-transfer-001',
    (select net_payout_cents from public.online_payout_batches where id=v_batch),
    200,repeat('a',64),'LOCAL_SYNTHETIC',repeat('e',64),'SETTLED');
  begin
    perform public.release4_verify_and_settle_payout(v_batch,v_evidence,v_actor);
    raise exception 'Recording Admin verified their own transfer';
  exception when others then
    if sqlerrm<>'Independent settled bank evidence and second reviewer required' then raise; end if;
  end;
  v_settlement:=public.release4_verify_and_settle_payout(v_batch,v_evidence,v_reviewer);
  if v_settlement->>'status'<>'PAID' or v_settlement->>'replayed'<>'false'
    or (public.release4_verify_and_settle_payout(v_batch,v_evidence,v_reviewer)->>'replayed')<>'true'
    then raise exception 'Settlement idempotency failed'; end if;
  if (select count(*) from public.financial_transactions
      where idempotency_key='online_payout:'||v_batch::text and transaction_state='POSTED')<>1
    or (select coalesce(sum(case when e.entry_side='DEBIT' then e.amount_cents
       else -e.amount_cents end),0) from public.financial_ledger_entries e
       join public.financial_transactions f on f.id=e.transaction_id
       where f.idempotency_key='online_payout:'||v_batch::text)<>0
    or (select status from public.online_payout_batches where id=v_batch)<>'PAID'
    then raise exception 'Paid payout ledger or status failed'; end if;
  insert into public.online_payment_refunds(payment_attempt_id,provider,amount_cents,
    idempotency_key,reason,requested_by)
  values(v_attempt,'FAKE_TEST',100,'release4:payout:after-paid-refund',
    'Synthetic post-payout partial refund',v_actor);
  if (select status from public.online_payout_batches where id=v_batch)<>'PAID'
    or not exists(select 1 from public.online_payout_exceptions where batch_id=v_batch
      and exception_type='REFUND_AFTER_PAYMENT' and resolved_at is null)
    then raise exception 'Post-payment refund exception missing'; end if;
end $$;
\echo CONNECTED_SYNTHETIC_PAYOUT_APPROVAL_BANK_AND_LEDGER_PASS
rollback;
