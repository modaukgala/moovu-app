-- Runs only inside the disposable Docker recovery cluster. Everything rolls back.
begin;
set local request.jwt.claim.role = 'service_role';
set local session_replication_role = replica;
insert into auth.users(id) values
  ('90000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000002'),
  ('90000000-0000-4000-8000-000000000017'),
  ('90000000-0000-4000-8000-000000000018');
insert into public.profiles(id,role) values
  ('90000000-0000-4000-8000-000000000001','owner'),
  ('90000000-0000-4000-8000-000000000017','admin'),
  ('90000000-0000-4000-8000-000000000018','owner');
insert into public.drivers(id,first_name,last_name,phone,status,verification_status)
  values('90000000-0000-4000-8000-000000000003','Fixture','Driver','0000000000','active','approved');
insert into public.customers(id,auth_user_id,first_name,last_name,phone,normalized_phone)
  values('90000000-0000-4000-8000-000000000004',
    '90000000-0000-4000-8000-000000000002','Fixture','Customer','0000000001','0000000001');
insert into public.phase5_policies(version,effective_from,currency,membership_price_cents,
  membership_days,go_service_fee_cents,go_xl_service_fee_cents,member_waiver_bps,
  referrer_reward_cents,referee_reward_cents,credit_expiry_days,automatic_renewal,
  referral_qualification)
  values('synthetic-option-b-v1',now(),'ZAR',9900,30,300,500,10000,2000,1000,90,false,
    'FIRST_ELIGIBLE_COMPLETED_RIDE');
set local session_replication_role = origin;

update public.online_payout_policy set enabled=true,approved_driver_fee_share_bps=5000,
  approval_reference='synthetic-policy',approved_by='90000000-0000-4000-8000-000000000001',
  approved_at=now(),effective_at=now()+interval '1 hour',
  activation_reference='synthetic-forward',
  activation_approved_by='90000000-0000-4000-8000-000000000001',activation_recorded_at=now()
  where policy_key='manual-online-payouts';
update public.online_payout_policy set
  option_b_effective_at=now()+interval '2 hours',
  option_b_approval_reference='synthetic-option-b',
  option_b_approved_by='90000000-0000-4000-8000-000000000001',
  option_b_recorded_at=now()
where policy_key='manual-online-payouts';

set local session_replication_role = replica;
insert into public.trips(id,customer_id,driver_id,pickup_address,dropoff_address,
  status,completed_at,payment_method,fare_amount,final_fare,original_fare,ride_option,
  commission_amount,driver_net_earnings,phase5_policy_version,phase5_policy_effective_from,
  phase5_ride_fare_cents,phase5_service_fee_cents,phase5_membership_waiver_cents,
  phase5_credit_cents,phase5_customer_total_cents,phase5_driver_fare_basis_cents)
values('90000000-0000-4000-8000-000000000005',
  '90000000-0000-4000-8000-000000000004',
  '90000000-0000-4000-8000-000000000003','Synthetic pickup','Synthetic destination',
  'completed',now()+interval '3 hours','online',49,49,49,'go',6.90,39.10,
  'synthetic-option-b-v1',now(),4600,300,0,0,4900,4600);
insert into public.financial_transactions(id,idempotency_key,payload_hash,transaction_type,
  transaction_state,source_type,source_id,actor_type,effective_at,posted_at,metadata)
values('90000000-0000-4000-8000-000000000006','synthetic:payment:one',repeat('a',64),
  'ONLINE_PAYMENT','POSTED','TRIP','90000000-0000-4000-8000-000000000005',
  'SYSTEM',now(),now(),'{}'),
  ('90000000-0000-4000-8000-000000000007','synthetic:payable:one',repeat('b',64),
  'DRIVER_PAYOUT','POSTED','TRIP','90000000-0000-4000-8000-000000000005',
  'SYSTEM',now(),now(),'{}'),
  ('90000000-0000-4000-8000-000000000010',
  'phase5:service-fee:90000000-0000-4000-8000-000000000005',repeat('e',64),
  'BOOKING_FEE','POSTED','TRIP','90000000-0000-4000-8000-000000000005',
  'SYSTEM',now(),now(),'{"cash_received_by_moovu":true}'),
  ('90000000-0000-4000-8000-000000000015','synthetic:commission:one',repeat('f',64),
  'DRIVER_COMMISSION','POSTED','TRIP','90000000-0000-4000-8000-000000000005',
  'SYSTEM',now(),now(),'{}');
insert into public.financial_accounts(id,account_code,account_category,owner_type,
  owner_id,normal_balance_side)
values('90000000-0000-4000-8000-000000000011','PLATFORM:PAYMENT_CLEARING:ZAR',
  'PAYMENT_CLEARING','PLATFORM',null,'DEBIT'),
  ('90000000-0000-4000-8000-000000000012','PLATFORM:CUSTOMER_FUNDS_LIABILITY:ZAR',
  'UNAPPLIED_FUNDS','PLATFORM',null,'CREDIT'),
  ('90000000-0000-4000-8000-000000000013',
  'DRIVER:90000000-0000-4000-8000-000000000003:EARNINGS_PAYABLE:ZAR',
  'DRIVER_EARNINGS_PAYABLE','DRIVER','90000000-0000-4000-8000-000000000003','CREDIT'),
  ('90000000-0000-4000-8000-000000000014','PHASE5:SERVICE_FEE:REVENUE',
  'BOOKING_FEE_REVENUE','PLATFORM',null,'CREDIT'),
  ('90000000-0000-4000-8000-000000000016','PLATFORM:COMMISSION_REVENUE:ZAR',
  'COMMISSION_REVENUE','PLATFORM',null,'CREDIT');
insert into public.financial_ledger_entries(transaction_id,account_id,sequence_number,
  entry_side,amount_cents)
values('90000000-0000-4000-8000-000000000006',
  '90000000-0000-4000-8000-000000000011',1,'DEBIT',4900),
  ('90000000-0000-4000-8000-000000000006',
  '90000000-0000-4000-8000-000000000012',2,'CREDIT',4900),
  ('90000000-0000-4000-8000-000000000007',
  '90000000-0000-4000-8000-000000000012',1,'DEBIT',3910),
  ('90000000-0000-4000-8000-000000000007',
  '90000000-0000-4000-8000-000000000013',2,'CREDIT',3910),
  ('90000000-0000-4000-8000-000000000010',
  '90000000-0000-4000-8000-000000000012',1,'DEBIT',300),
  ('90000000-0000-4000-8000-000000000010',
  '90000000-0000-4000-8000-000000000014',2,'CREDIT',300),
  ('90000000-0000-4000-8000-000000000015',
  '90000000-0000-4000-8000-000000000012',1,'DEBIT',690),
  ('90000000-0000-4000-8000-000000000015',
  '90000000-0000-4000-8000-000000000016',2,'CREDIT',690);
insert into public.online_payment_attempts(id,customer_id,trip_id,provider,amount_cents,
  fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash,verified_at,
  payment_ledger_transaction_id,reconciliation_state)
values('90000000-0000-4000-8000-000000000008',
  '90000000-0000-4000-8000-000000000004',
  '90000000-0000-4000-8000-000000000005','FAKE_TEST',4900,repeat('c',64),'{}',
  'SUCCEEDED','synthetic:attempt:one',repeat('d',64),now(),
  '90000000-0000-4000-8000-000000000006','MATCHED');
insert into public.online_driver_payables(id,trip_id,payment_attempt_id,driver_id,
  fare_cents,commission_cents,idempotency_key,ledger_transaction_id,earned_at)
values('90000000-0000-4000-8000-000000000009',
  '90000000-0000-4000-8000-000000000005',
  '90000000-0000-4000-8000-000000000008',
  '90000000-0000-4000-8000-000000000003',4600,690,'synthetic:payable:one',
  '90000000-0000-4000-8000-000000000007',now()+interval '3 hours');
set local session_replication_role = origin;
insert into public.online_payout_fee_evidence(payment_attempt_id,actual_fee_cents,
  percentage_fee_cents,fixed_fee_cents,source_type,source_reference,vat_treatment,verified_by)
values('90000000-0000-4000-8000-000000000008',372,172,200,
  'PROVIDER_EXPORT','synthetic-option-b-evidence','TOTAL_INCLUDES_VAT',
  '90000000-0000-4000-8000-000000000001');

insert into public.online_payout_beneficiaries(driver_id,account_fingerprint,
  verification_reference,consent_reference,verified_by,verified_at,active)
values('90000000-0000-4000-8000-000000000003',repeat('a',64),
  'synthetic-bank-verification','synthetic-driver-consent',
  '90000000-0000-4000-8000-000000000001',now(),true);

do $$ declare v_batch uuid; v_approval jsonb; v_evidence uuid; v_settlement jsonb;
  v_first uuid; v_second uuid; v_payment_at timestamptz:=now();
begin
  v_batch:=public.release4_create_payout_draft(
    '90000000-0000-4000-8000-000000000003',
    date_trunc('week',now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg',
    (date_trunc('week',now() at time zone 'Africa/Johannesburg')+interval '7 days') at time zone 'Africa/Johannesburg',
    array['90000000-0000-4000-8000-000000000009'::uuid],
    '90000000-0000-4000-8000-000000000001');
  if not exists(select 1 from public.online_payout_batches where id=v_batch
    and policy_version='online-driver-payout-option-b-v1' and fare_cents=4600
    and current_commission_cents=690 and driver_earnings_cents=3910
    and driver_booking_share_cents=100 and actual_provider_fee_cents=372
    and net_payout_cents=4010) then raise exception 'Option B draft totals mismatch'; end if;
  if not exists(select 1 from public.online_payout_items where batch_id=v_batch
    and percentage_fee_cents=172 and fixed_fee_cents=200
    and driver_percentage_fee_cents=86 and moovu_percentage_fee_cents=86
    and driver_provider_fee_cents=286 and driver_booking_share_cents=100)
    then raise exception 'Option B item allocation mismatch'; end if;
  begin
    perform public.release4_create_payout_draft(
      '90000000-0000-4000-8000-000000000003',
      date_trunc('week',now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg',
      (date_trunc('week',now() at time zone 'Africa/Johannesburg')+interval '7 days') at time zone 'Africa/Johannesburg',
      array['90000000-0000-4000-8000-000000000009'::uuid],
      '90000000-0000-4000-8000-000000000001');
    raise exception 'Duplicate draft accepted';
  exception when unique_violation then null; end;
  if public.release4_review_payout(v_batch,'RECONCILE',
      '90000000-0000-4000-8000-000000000001',null)<>'RECONCILED'
    then raise exception 'Option B reconciliation failed'; end if;
  v_approval:=public.release4_approve_payout(v_batch,
    '90000000-0000-4000-8000-000000000001','synthetic-option-b-approval-001');
  if v_approval->>'status'<>'APPROVED' or
    (select net_payout_cents from public.online_payout_batches where id=v_batch)<>3724 or
    (select approved_snapshot->>'version' from public.online_payout_batches where id=v_batch)<>'option-b-v1'
    then raise exception 'Option B approval amount or snapshot failed'; end if;
  if (public.release4_approve_payout(v_batch,
      '90000000-0000-4000-8000-000000000001','synthetic-option-b-approval-001')->>'replayed')<>'true'
    then raise exception 'Option B approval replay failed'; end if;
  begin
  if public.release4_record_transfer(v_batch,
      '90000000-0000-4000-8000-000000000001','PAYSHAP',
      'synthetic-option-b-transfer','synthetic-proof',now())<>'PAYMENT_RECORDED'
    then raise exception 'Option B transfer recording failed'; end if;
  begin
    perform public.release4_import_bank_evidence(v_batch,
      '90000000-0000-4000-8000-000000000017','synthetic-bank-reference-001',
      'synthetic-option-b-transfer',3724,0,repeat('a',64),'LOCAL_SYNTHETIC',
      repeat('d',64),'SETTLED');
    raise exception 'Synthetic import unexpectedly accepted in a non-certified fixture';
  exception when raise_exception then
    if sqlerrm<>'Synthetic bank evidence is local-test only' then raise; end if;
  end;
  -- This disposable fixture inserts clearly labeled synthetic evidence directly.
  -- The real import RPC's dedicated-database guard remains untouched.
  insert into public.online_payout_bank_evidence(batch_id,bank_transaction_reference,
    transfer_reference,amount_cents,actual_bank_fee_cents,destination_fingerprint,
    source_type,source_digest,bank_state,imported_by)
  values(v_batch,'synthetic-bank-reference-001','synthetic-option-b-transfer',
    3724,0,repeat('a',64),'LOCAL_SYNTHETIC',repeat('d',64),'SETTLED',
    '90000000-0000-4000-8000-000000000017') returning id into v_evidence;
  v_settlement:=public.release4_verify_and_settle_payout(v_batch,v_evidence,
    '90000000-0000-4000-8000-000000000018');
  if v_settlement->>'status'<>'PAID' or
    (public.release4_verify_and_settle_payout(v_batch,v_evidence,
      '90000000-0000-4000-8000-000000000018')->>'replayed')<>'true' or
    (select coalesce(sum(case when entry_side='CREDIT' then amount_cents else -amount_cents end),0)
      from public.financial_ledger_entries where account_id='90000000-0000-4000-8000-000000000014')<>200 or
    (select coalesce(sum(case when entry_side='CREDIT' then amount_cents else -amount_cents end),0)
      from public.financial_ledger_entries where account_id='90000000-0000-4000-8000-000000000013')<>0
    then raise exception 'Option B settlement or R1 booking reclassification failed'; end if;
  raise exception 'ROLLBACK_DIRECT_SETTLEMENT';
  exception when raise_exception then
    if sqlerrm<>'ROLLBACK_DIRECT_SETTLEMENT' then raise; end if;
  end;
  v_first:=public.release4_record_manual_payment(v_batch,
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000021',2000,v_payment_at,
    'EFT','synthetic-partial-one',null);
  if public.release4_record_manual_payment(v_batch,
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000021',2000,v_payment_at,
    'EFT','synthetic-partial-one',null) is distinct from v_first
    then raise exception 'Manual payment replay failed'; end if;
  begin
    perform public.release4_record_manual_payment(v_batch,
      '90000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000022',1725,v_payment_at,
      'PAYSHAP','synthetic-overpay',null);
    raise exception 'Manual overpayment accepted';
  exception when raise_exception then
    if sqlerrm<>'Manual payment would exceed remaining payout' then raise; end if;
  end;
  v_second:=public.release4_record_manual_payment(v_batch,
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000023',1724,v_payment_at,
    'PAYSHAP','synthetic-partial-two',null);
  if (select status from public.online_payout_batches where id=v_batch)<>'PAYMENT_RECORDED'
    then raise exception 'Manual assertion incorrectly settled payout'; end if;
  insert into public.online_payout_manual_bank_evidence(payment_id,
    bank_transaction_reference,transfer_reference,amount_cents,destination_fingerprint,
    actual_bank_fee_cents,source_type,source_digest,bank_state,imported_by)
  values(v_first,'synthetic-bank-partial-one','synthetic-partial-one',2000,
    repeat('a',64),0,'LOCAL_SYNTHETIC',repeat('b',64),'SETTLED',
    '90000000-0000-4000-8000-000000000017'),
    (v_second,'synthetic-bank-partial-two','synthetic-partial-two',1724,
    repeat('a',64),0,'LOCAL_SYNTHETIC',repeat('c',64),'SETTLED',
    '90000000-0000-4000-8000-000000000017');
  if public.release4_verify_manual_payment(v_first,
    '90000000-0000-4000-8000-000000000018')->>'status'<>'VERIFIED' or
    (select status from public.online_payout_batches where id=v_batch)<>'PAYMENT_RECORDED'
    then raise exception 'First partial payment verification failed'; end if;
  v_settlement:=public.release4_verify_manual_payment(v_second,
    '90000000-0000-4000-8000-000000000018');
  if v_settlement->>'status'<>'VERIFIED' then raise exception 'Final manual payment verification failed'; end if;
  if (select status from public.online_payout_batches where id=v_batch)<>'PAID'
    then raise exception 'Final manual payment did not close batch'; end if;
  if (select coalesce(sum(case when entry_side='CREDIT' then amount_cents else -amount_cents end),0)
      from public.financial_ledger_entries where account_id='90000000-0000-4000-8000-000000000014')<>200
    then raise exception 'Final manual payment did not reclassify booking share'; end if;
  if (select coalesce(sum(case when entry_side='CREDIT' then amount_cents else -amount_cents end),0)
      from public.financial_ledger_entries where account_id='90000000-0000-4000-8000-000000000013')<>0
    then raise exception 'Final manual payment did not clear payable'; end if;
  if exists(select 1 from public.financial_ledger_entries group by transaction_id
    having sum(case when entry_side='DEBIT' then amount_cents else -amount_cents end)<>0)
    then raise exception 'Synthetic ledger unbalanced'; end if;
end $$;
rollback;
