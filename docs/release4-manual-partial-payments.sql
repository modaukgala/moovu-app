-- Candidate after release4-online-payout-financial-engine.sql. Never run in production without approval.
-- Admin assertions are separate from independent bank evidence and ledger settlement.
begin;

create table public.online_payout_manual_payments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.online_payout_batches(id) on delete restrict,
  operation_key uuid not null unique,
  amount_cents bigint not null check (amount_cents > 0),
  payment_at timestamptz not null,
  method text not null check (method in ('EFT','PAYSHAP')),
  bank_reference text not null unique check (length(trim(bank_reference)) between 3 and 200),
  proof_reference text null check (proof_reference is null or length(trim(proof_reference)) between 3 and 200),
  state text not null default 'RECORDED' check (state in ('RECORDED','VERIFIED','FAILED')),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  verified_by uuid null references auth.users(id) on delete restrict,
  verified_at timestamptz null,
  ledger_transaction_id uuid null unique references public.financial_transactions(id) on delete restrict,
  check ((state = 'VERIFIED') = (verified_at is not null and ledger_transaction_id is not null))
);
create index online_payout_manual_payments_batch_idx
  on public.online_payout_manual_payments(batch_id,recorded_at,id);
create unique index online_payout_manual_payments_reference_ci
  on public.online_payout_manual_payments(lower(bank_reference));

create table public.online_payout_manual_bank_evidence (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.online_payout_manual_payments(id) on delete restrict,
  bank_transaction_reference text not null unique check (length(trim(bank_transaction_reference)) between 8 and 200),
  transfer_reference text not null check (length(trim(transfer_reference)) between 3 and 200),
  amount_cents bigint not null check (amount_cents > 0),
  destination_fingerprint text not null check (length(destination_fingerprint) between 16 and 128),
  actual_bank_fee_cents bigint not null check (actual_bank_fee_cents >= 0),
  source_type text not null check (source_type in ('INDEPENDENT_BANK_STATEMENT','LOCAL_SYNTHETIC')),
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  bank_state text not null check (bank_state in ('SETTLED','FAILED')),
  imported_by uuid not null references auth.users(id) on delete restrict,
  imported_at timestamptz not null default now(),
  reviewed_by uuid null references auth.users(id) on delete restrict,
  reviewed_at timestamptz null,
  unique(source_type,source_digest,bank_transaction_reference)
);
create unique index online_payout_manual_bank_transaction_ci
  on public.online_payout_manual_bank_evidence(lower(bank_transaction_reference));

create function public.release4_guard_manual_payment()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'Manual payment history is retained'; end if;
  if new.id is distinct from old.id or new.batch_id is distinct from old.batch_id
    or new.operation_key is distinct from old.operation_key
    or new.amount_cents is distinct from old.amount_cents
    or new.payment_at is distinct from old.payment_at or new.method is distinct from old.method
    or new.bank_reference is distinct from old.bank_reference
    or new.proof_reference is distinct from old.proof_reference
    or new.recorded_by is distinct from old.recorded_by
    or new.recorded_at is distinct from old.recorded_at
    or old.state <> 'RECORDED'
    or current_setting('release4.manual_payment_transition',true) is distinct from old.id::text
    then raise exception 'Manual payment is immutable outside verification'; end if;
  return new;
end $$;
create trigger release4_guard_manual_payment_trigger before update or delete
  on public.online_payout_manual_payments for each row execute function public.release4_guard_manual_payment();

create function public.release4_guard_manual_bank_evidence()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'Bank evidence is retained'; end if;
  if new.id is distinct from old.id or new.payment_id is distinct from old.payment_id
    or new.bank_transaction_reference is distinct from old.bank_transaction_reference
    or new.transfer_reference is distinct from old.transfer_reference
    or new.amount_cents is distinct from old.amount_cents
    or new.destination_fingerprint is distinct from old.destination_fingerprint
    or new.actual_bank_fee_cents is distinct from old.actual_bank_fee_cents
    or new.source_type is distinct from old.source_type
    or new.source_digest is distinct from old.source_digest
    or new.bank_state is distinct from old.bank_state
    or new.imported_by is distinct from old.imported_by
    or new.imported_at is distinct from old.imported_at
    or old.reviewed_at is not null
    or current_setting('release4.manual_bank_verification',true) is distinct from old.id::text
    then raise exception 'Bank evidence is immutable outside independent review'; end if;
  return new;
end $$;
create trigger release4_guard_manual_bank_evidence_trigger before update or delete
  on public.online_payout_manual_bank_evidence for each row execute function public.release4_guard_manual_bank_evidence();

create function public.release4_record_manual_payment(
  p_batch_id uuid,p_actor_id uuid,p_operation_key uuid,p_amount_cents bigint,
  p_payment_at timestamptz,p_method text,p_bank_reference text,p_proof_reference text default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.online_payout_batches; v_existing public.online_payout_manual_payments;
  v_total bigint; v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('owner','admin'))
    then raise exception 'Financial Admin required'; end if;
  if p_operation_key is null or p_amount_cents is null or p_amount_cents<=0
    or p_method not in ('EFT','PAYSHAP')
    or length(trim(coalesce(p_bank_reference,''))) not between 3 and 200
    or (p_proof_reference is not null and length(trim(p_proof_reference)) not between 3 and 200)
    or p_payment_at is null or p_payment_at>now()+interval '5 minutes'
    then raise exception 'Manual payment details are incomplete'; end if;
  select * into v_batch from public.online_payout_batches where id=p_batch_id for update;
  if not found then raise exception 'Payout batch unavailable'; end if;
  select * into v_existing from public.online_payout_manual_payments
    where operation_key=p_operation_key;
  if found then
    if v_existing.batch_id=p_batch_id and v_existing.amount_cents=p_amount_cents
      and v_existing.method=p_method and v_existing.bank_reference=trim(p_bank_reference)
      and v_existing.payment_at=p_payment_at
      and v_existing.proof_reference is not distinct from nullif(trim(coalesce(p_proof_reference,'')),'')
      then return v_existing.id; end if;
    raise exception 'Operation key belongs to a different payment';
  end if;
  if v_batch.status not in ('APPROVED','PAYMENT_RECORDED')
    or v_batch.approved_snapshot is null or v_batch.net_payout_cents<=0
    or exists(select 1 from public.online_payout_exceptions
      where batch_id=p_batch_id and resolved_at is null)
    then raise exception 'Approved payout without open exception required'; end if;
  select coalesce(sum(amount_cents),0) into v_total
    from public.online_payout_manual_payments
    where batch_id=p_batch_id and state<>'FAILED';
  if p_amount_cents>v_batch.net_payout_cents-v_total
    then raise exception 'Manual payment would exceed remaining payout'; end if;
  insert into public.online_payout_manual_payments(batch_id,operation_key,amount_cents,
    payment_at,method,bank_reference,proof_reference,recorded_by)
  values(p_batch_id,p_operation_key,p_amount_cents,p_payment_at,p_method,
    trim(p_bank_reference),nullif(trim(coalesce(p_proof_reference,'')),''),p_actor_id)
  returning id into v_id;
  if v_batch.status='APPROVED' then
    perform set_config('release4.financial_transition',p_batch_id::text,true);
    update public.online_payout_batches set status='PAYMENT_RECORDED',updated_at=now()
      where id=p_batch_id;
    perform set_config('release4.financial_transition','',true);
  end if;
  insert into public.online_payout_audit_events(batch_id,event_type,actor_id,evidence_reference,event_data)
    values(p_batch_id,'MANUAL_PAYMENT_RECORDED',p_actor_id,trim(p_bank_reference),
      jsonb_build_object('payment_id',v_id,'amount_cents',p_amount_cents));
  return v_id;
end $$;

-- No HTTP route calls this function. A separate bank-statement operator imports evidence.
create function public.release4_import_manual_bank_evidence(
  p_payment_id uuid,p_importer uuid,p_bank_transaction_reference text,
  p_transfer_reference text,p_amount_cents bigint,p_destination_fingerprint text,p_actual_bank_fee_cents bigint,
  p_source_type text,p_source_digest text,p_bank_state text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_payment public.online_payout_manual_payments; v_batch public.online_payout_batches;
  v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if not exists(select 1 from public.profiles where id=p_importer and role in ('owner','admin'))
    then raise exception 'Financial Admin required'; end if;
  if p_source_type='LOCAL_SYNTHETIC' and current_database() not in
    ('release4_final_cert_20261021','release4_manual_cert_20261023')
    then raise exception 'Synthetic evidence is local-test only'; end if;
  if p_source_type not in ('INDEPENDENT_BANK_STATEMENT','LOCAL_SYNTHETIC')
    or p_bank_state not in ('SETTLED','FAILED') or p_source_digest !~ '^[a-f0-9]{64}$'
    or length(trim(coalesce(p_bank_transaction_reference,''))) not between 8 and 200
    or p_actual_bank_fee_cents is null or p_actual_bank_fee_cents<0
    then raise exception 'Independent bank evidence required'; end if;
  select * into v_payment from public.online_payout_manual_payments where id=p_payment_id for update;
  if not found or v_payment.state<>'RECORDED' then raise exception 'Recorded payment required'; end if;
  select * into v_batch from public.online_payout_batches where id=v_payment.batch_id;
  if p_importer in (v_payment.recorded_by,v_batch.approval_actor)
    or p_amount_cents<>v_payment.amount_cents
    or trim(coalesce(p_transfer_reference,''))<>v_payment.bank_reference
    or p_destination_fingerprint<>v_batch.beneficiary_fingerprint
    then raise exception 'Bank evidence does not match recorded payment'; end if;
  insert into public.online_payout_manual_bank_evidence(payment_id,bank_transaction_reference,transfer_reference,
    amount_cents,destination_fingerprint,actual_bank_fee_cents,source_type,source_digest,
    bank_state,imported_by)
  values(p_payment_id,trim(p_bank_transaction_reference),trim(p_transfer_reference),p_amount_cents,
    p_destination_fingerprint,p_actual_bank_fee_cents,p_source_type,p_source_digest,
    p_bank_state,p_importer) returning id into v_id;
  insert into public.online_payout_audit_events(batch_id,event_type,actor_id,evidence_reference)
    values(v_payment.batch_id,'MANUAL_BANK_EVIDENCE_IMPORTED',p_importer,
      trim(p_bank_transaction_reference));
  return v_id;
end $$;

-- Partial bank-confirmed transfers post only their cash movement. Fee and debt
-- deductions post once, in the transaction that verifies the final payment.
create function public.release4_verify_manual_payment(p_payment_id uuid,p_reviewer uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_payment public.online_payout_manual_payments; v_evidence public.online_payout_manual_bank_evidence;
  v_batch public.online_payout_batches; v_payable public.financial_accounts;
  v_clearing public.financial_accounts; v_bank_expense public.financial_accounts;
  v_debt_account public.financial_accounts; v_yoco_expense public.financial_accounts;
  v_entries jsonb; v_post jsonb; v_close jsonb; v_verified bigint;
  v_fee bigint; v_payload jsonb; v_final_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if not exists(select 1 from public.profiles where id=p_reviewer and role in ('owner','admin'))
    then raise exception 'Financial Admin required'; end if;
  select * into v_payment from public.online_payout_manual_payments where id=p_payment_id;
  if not found then raise exception 'Manual payment unavailable'; end if;
  select * into v_batch from public.online_payout_batches where id=v_payment.batch_id for update;
  select * into v_payment from public.online_payout_manual_payments where id=p_payment_id for update;
  if v_payment.state='VERIFIED' then
    return jsonb_build_object('status','VERIFIED','replayed',true,'payment_id',p_payment_id); end if;
  if v_payment.state='FAILED' then
    return jsonb_build_object('status','FAILED','replayed',true,'payment_id',p_payment_id); end if;
  if v_batch.status not in ('PAYMENT_RECORDED','HELD') or v_batch.approved_snapshot is null
    then raise exception 'Recorded payout required'; end if;
  select * into v_evidence from public.online_payout_manual_bank_evidence
    where payment_id=p_payment_id for update;
  if not found or v_evidence.amount_cents<>v_payment.amount_cents
    or v_evidence.transfer_reference<>v_payment.bank_reference
    or v_evidence.destination_fingerprint<>v_batch.beneficiary_fingerprint
    or p_reviewer in (v_payment.recorded_by,v_evidence.imported_by,v_batch.approval_actor)
    then raise exception 'Independent bank evidence and reviewer required'; end if;
  perform set_config('release4.manual_bank_verification',v_evidence.id::text,true);
  update public.online_payout_manual_bank_evidence set reviewed_by=p_reviewer,reviewed_at=now()
    where id=v_evidence.id;
  perform set_config('release4.manual_bank_verification','',true);
  if v_evidence.bank_state='FAILED' then
    perform set_config('release4.manual_payment_transition',p_payment_id::text,true);
    update public.online_payout_manual_payments set state='FAILED',verified_by=p_reviewer
      where id=p_payment_id;
    perform set_config('release4.manual_payment_transition','',true);
    insert into public.online_payout_audit_events(batch_id,event_type,actor_id,evidence_reference)
      values(v_batch.id,'MANUAL_PAYMENT_FAILED',p_reviewer,v_evidence.bank_transaction_reference);
    return jsonb_build_object('status','FAILED','replayed',false,'payment_id',p_payment_id);
  end if;
  v_payable:=public.phase1_ensure_financial_account(
    'DRIVER:'||upper(v_batch.driver_id::text)||':EARNINGS_PAYABLE:ZAR',
    'DRIVER_EARNINGS_PAYABLE','DRIVER',v_batch.driver_id,'CREDIT','ZAR');
  v_clearing:=public.phase1_ensure_financial_account('PLATFORM:PAYMENT_CLEARING:ZAR',
    'PAYMENT_CLEARING','PLATFORM',null,'DEBIT','ZAR');
  v_bank_expense:=public.phase1_ensure_financial_account('PLATFORM:BANK_PAYOUT_FEE_EXPENSE:ZAR',
    'BANK_PAYOUT_FEE_EXPENSE','PLATFORM',null,'DEBIT','ZAR');
  v_entries:=jsonb_build_array(jsonb_build_object('account_id',v_payable.id,
    'entry_side','DEBIT','amount_cents',v_payment.amount_cents));
  if v_evidence.actual_bank_fee_cents>0 then
    v_entries:=v_entries||jsonb_build_array(jsonb_build_object('account_id',v_bank_expense.id,
      'entry_side','DEBIT','amount_cents',v_evidence.actual_bank_fee_cents));
  end if;
  v_entries:=v_entries||jsonb_build_array(jsonb_build_object('account_id',v_clearing.id,
    'entry_side','CREDIT','amount_cents',v_payment.amount_cents+v_evidence.actual_bank_fee_cents));
  v_payload:=jsonb_build_object('payment_id',p_payment_id,'bank_evidence_id',v_evidence.id,
    'amount_cents',v_payment.amount_cents,'entries',v_entries);
  v_post:=public.phase1_post_financial_transaction('online_payout_manual:'||p_payment_id::text,
    encode(extensions.digest(v_payload::text,'sha256'),'hex'),'DRIVER_PAYOUT','ADJUSTMENT',
    p_payment_id,'ZAR','ADMIN',p_reviewer,now(),v_entries,
    jsonb_build_object('batch_id',v_batch.id,'payment_id',p_payment_id,
      'bank_evidence_id',v_evidence.id));
  if v_post->>'state'<>'POSTED' then raise exception 'Manual payout ledger posting failed'; end if;
  perform set_config('release4.manual_payment_transition',p_payment_id::text,true);
  update public.online_payout_manual_payments set state='VERIFIED',verified_by=p_reviewer,
    verified_at=now(),ledger_transaction_id=(v_post->>'transaction_id')::uuid
    where id=p_payment_id;
  perform set_config('release4.manual_payment_transition','',true);
  select coalesce(sum(amount_cents),0) into v_verified
    from public.online_payout_manual_payments where batch_id=v_batch.id and state='VERIFIED';
  if v_verified=v_batch.net_payout_cents and v_batch.status='PAYMENT_RECORDED' then
    if exists(select 1 from public.online_payout_exceptions
      where batch_id=v_batch.id and resolved_at is null)
      or exists(select 1 from public.online_payout_items i
        join public.online_driver_payables p on p.id=i.payable_id
        join public.online_payment_refunds r on r.payment_attempt_id=p.payment_attempt_id
          and r.state<>'REFUND_FAILED' where i.batch_id=v_batch.id)
      or public.release4_available_prior_debt(v_batch.driver_id,v_batch.id)
        <v_batch.prior_debt_recovery_cents
      then raise exception 'Final payout requires financial exception review'; end if;
    v_fee:=v_batch.actual_provider_fee_cents-v_batch.driver_provider_fee_cents;
    v_entries:='[]'::jsonb;
    if v_batch.driver_provider_fee_cents+v_batch.prior_debt_recovery_cents>0 then
      v_entries:=v_entries||jsonb_build_array(jsonb_build_object('account_id',v_payable.id,
        'entry_side','DEBIT','amount_cents',v_batch.driver_provider_fee_cents+
          v_batch.prior_debt_recovery_cents)); end if;
    if v_fee>0 then
      v_yoco_expense:=public.phase1_ensure_financial_account(
        'PLATFORM:ONLINE_PROCESSING_FEE_EXPENSE:ZAR',
        'ONLINE_PROCESSING_FEE_EXPENSE','PLATFORM',null,'DEBIT','ZAR');
      v_entries:=v_entries||jsonb_build_array(jsonb_build_object('account_id',v_yoco_expense.id,
        'entry_side','DEBIT','amount_cents',v_fee)); end if;
    if v_batch.prior_debt_recovery_cents>0 then
      v_debt_account:=public.phase1_ensure_financial_account(
        'DRIVER:'||upper(v_batch.driver_id::text)||':COMMISSION_DEBT:ZAR',
        'DRIVER_COMMISSION_DEBT','DRIVER',v_batch.driver_id,'DEBIT','ZAR');
      v_entries:=v_entries||jsonb_build_array(jsonb_build_object('account_id',v_debt_account.id,
        'entry_side','CREDIT','amount_cents',v_batch.prior_debt_recovery_cents)); end if;
    if v_batch.actual_provider_fee_cents>0 then
      v_entries:=v_entries||jsonb_build_array(jsonb_build_object('account_id',v_clearing.id,
        'entry_side','CREDIT','amount_cents',v_batch.actual_provider_fee_cents)); end if;
    v_final_id:=(v_post->>'transaction_id')::uuid;
    if jsonb_array_length(v_entries)>0 then
      v_payload:=jsonb_build_object('batch_id',v_batch.id,'snapshot',v_batch.approved_snapshot,
        'entries',v_entries);
      v_close:=public.phase1_post_financial_transaction('online_payout_final:'||v_batch.id::text,
        encode(extensions.digest(v_payload::text,'sha256'),'hex'),'DRIVER_PAYOUT',
        'ADJUSTMENT',v_batch.id,'ZAR','ADMIN',p_reviewer,now(),v_entries,
        jsonb_build_object('batch_id',v_batch.id,'final_deductions',true));
      if v_close->>'state'<>'POSTED' then raise exception 'Final payout ledger posting failed'; end if;
      v_final_id:=(v_close->>'transaction_id')::uuid;
    end if;
    perform set_config('release4.financial_transition',v_batch.id::text,true);
    update public.online_payout_batches set status='PAID',payout_method=v_payment.method,
      transfer_reference=v_payment.bank_reference,
      transfer_evidence_reference=coalesce(v_payment.proof_reference,'INDEPENDENT_BANK_STATEMENT'),
      payment_actor=v_payment.recorded_by,paid_at=now(),settlement_transaction_id=v_final_id,
      updated_at=now() where id=v_batch.id;
    perform set_config('release4.financial_transition','',true);
    if v_batch.prior_debt_recovery_cents>0 then
      update public.online_payout_debt_allocations set ledger_transaction_id=v_final_id
        where batch_id=v_batch.id; end if;
    update public.online_driver_payables set state='PAID' where id in
      (select payable_id from public.online_payout_items where batch_id=v_batch.id);
    insert into public.online_payout_audit_events(batch_id,event_type,actor_id,evidence_reference)
      values(v_batch.id,'PAID_VERIFIED',p_reviewer,v_evidence.bank_transaction_reference);
  end if;
  insert into public.online_payout_audit_events(batch_id,event_type,actor_id,evidence_reference,
    event_data) values(v_batch.id,'MANUAL_PAYMENT_VERIFIED',p_reviewer,
      v_evidence.bank_transaction_reference,
      jsonb_build_object('payment_id',p_payment_id,'amount_cents',v_payment.amount_cents,
        'ledger_transaction_id',v_post->>'transaction_id'));
  return jsonb_build_object('status','VERIFIED','replayed',false,'payment_id',p_payment_id,
    'batch_status',case when v_verified=v_batch.net_payout_cents and v_batch.status='PAYMENT_RECORDED'
      then 'PAID' else v_batch.status end);
end $$;

alter table public.online_payout_manual_payments enable row level security;
alter table public.online_payout_manual_bank_evidence enable row level security;
revoke all on public.online_payout_manual_payments,public.online_payout_manual_bank_evidence
  from public,anon,authenticated,service_role;
grant select on public.online_payout_manual_payments,public.online_payout_manual_bank_evidence
  to service_role;
revoke all on function public.release4_record_transfer(uuid,uuid,text,text,text,timestamptz),
  public.release4_import_bank_evidence(uuid,uuid,text,text,bigint,bigint,text,text,text,text)
  from service_role;
revoke all on function public.release4_guard_manual_payment(),
  public.release4_guard_manual_bank_evidence(),
  public.release4_record_manual_payment(uuid,uuid,uuid,bigint,timestamptz,text,text,text),
  public.release4_import_manual_bank_evidence(uuid,uuid,text,text,bigint,text,bigint,text,text,text),
  public.release4_verify_manual_payment(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.release4_record_manual_payment(uuid,uuid,uuid,bigint,timestamptz,text,text,text),
  public.release4_import_manual_bank_evidence(uuid,uuid,text,text,bigint,text,bigint,text,text,text),
  public.release4_verify_manual_payment(uuid,uuid) to service_role;

commit;
