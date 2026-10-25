-- Release 4 additive candidate; apply only after release4-online-payout-control-plane.sql.
-- Local disposable rehearsal only. Production activation and external transfers are separate.
begin;

alter table public.online_payout_batches add column approval_operation_key text unique;
alter table public.online_payout_batches add column beneficiary_fingerprint text;
alter table public.online_payout_batches add column transfer_recorded_at timestamptz;
alter table public.online_payout_batches add column bank_evidence_id uuid;
alter table public.online_payout_batches add column settlement_transaction_id uuid unique
  references public.financial_transactions(id) on delete restrict;
alter table public.online_payout_batches drop constraint online_payout_batches_payout_method_check;
alter table public.online_payout_batches add constraint online_payout_batches_payout_method_check
  check (payout_method in ('PAYSHAP','EFT','DEBT_OFFSET'));
alter table public.online_payout_batches add constraint release4_approval_operation_key_check
  check (approval_operation_key is null or length(approval_operation_key) between 8 and 160);

create table public.online_payout_beneficiaries (
  driver_id uuid primary key references public.drivers(id) on delete restrict,
  account_fingerprint text not null check (length(account_fingerprint) between 16 and 128),
  verification_reference text not null check (length(verification_reference) between 3 and 200),
  consent_reference text not null check (length(consent_reference) between 3 and 200),
  verified_by uuid not null references auth.users(id) on delete restrict,
  verified_at timestamptz not null,
  active boolean not null default false
);

create table public.online_payout_bank_evidence (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null unique references public.online_payout_batches(id) on delete restrict,
  bank_transaction_reference text not null unique check (length(bank_transaction_reference) between 8 and 200),
  transfer_reference text not null check (length(transfer_reference) between 3 and 200),
  amount_cents bigint not null check (amount_cents >= 0),
  actual_bank_fee_cents bigint not null check (actual_bank_fee_cents >= 0),
  destination_fingerprint text not null check (length(destination_fingerprint) between 16 and 128),
  source_type text not null check (source_type in ('INDEPENDENT_BANK_STATEMENT','LOCAL_SYNTHETIC')),
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  bank_state text not null check (bank_state in ('SETTLED','FAILED')),
  imported_by uuid not null references auth.users(id) on delete restrict,
  imported_at timestamptz not null default now(),
  verified_by uuid references auth.users(id) on delete restrict,
  verified_at timestamptz,
  check ((verified_by is null)=(verified_at is null))
);
alter table public.online_payout_batches add constraint release4_bank_evidence_fk
  foreign key (bank_evidence_id) references public.online_payout_bank_evidence(id) on delete restrict;

-- A failed or cancelled batch retains immutable history, while its payable can
-- enter a replacement draft. Draft assembly already locks the payable row.
alter table public.online_payout_items drop constraint online_payout_items_payable_id_key;
create index online_payout_items_payable_idx on public.online_payout_items(payable_id);
create or replace function public.release4_guard_payout_item_insert()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_batch public.online_payout_batches;
begin
  select * into v_batch from public.online_payout_batches where id=new.batch_id for update;
  if not found or v_batch.status<>'DRAFT' or v_batch.driver_earnings_cents<>0
    or v_batch.net_payout_cents<>0 then
    raise exception 'Items may only be assembled into a new draft'; end if;
  if exists(select 1 from public.online_payout_items i
    join public.online_payout_batches b on b.id=i.batch_id
    where i.payable_id=new.payable_id and b.status not in ('CANCELLED','FAILED')) then
    raise exception 'Payable already belongs to an active payout' using errcode='23505';
  end if;
  return new;
end $$;
alter table public.online_payout_debt_allocations
  drop constraint online_payout_debt_allocations_ledger_transaction_id_key;
create index online_payout_debt_allocations_ledger_idx
  on public.online_payout_debt_allocations(ledger_transaction_id);

create table public.online_payout_exceptions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.online_payout_batches(id) on delete restrict,
  exception_type text not null check (exception_type in
    ('REFUND_BEFORE_APPROVAL','REFUND_AFTER_APPROVAL','REFUND_AFTER_PAYMENT',
     'CHARGEBACK','DEBT_CHANGED','BANK_FAILURE')),
  source_reference text not null check (length(source_reference) between 3 and 200),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique(batch_id,exception_type,source_reference)
);

-- Expense categories are additive; existing account rows and financial entries remain untouched.
alter table public.financial_accounts drop constraint financial_accounts_account_category_check;
alter table public.financial_accounts add constraint financial_accounts_account_category_check
  check (account_category in (
    'COMMISSION_RECEIVABLE','COMMISSION_REVENUE','BOOKING_FEE_REVENUE',
    'SUBSCRIPTION_PAYMENT_CLEARING','SUBSCRIPTION_REVENUE','DEFERRED_SUBSCRIPTION_REVENUE',
    'CANCELLATION_NO_SHOW_RECEIVABLE','CANCELLATION_NO_SHOW_REVENUE','PAYMENT_CLEARING',
    'UNAPPLIED_FUNDS','PAYOUT_CLEARING','ADJUSTMENT_CLEARING','DRIVER_EARNINGS_CONTROL',
    'DRIVER_EARNINGS_PAYABLE','DRIVER_COMMISSION_DEBT','DRIVER_UNAPPLIED_CREDIT',
    'DRIVER_COMPENSATION_PAYABLE','DRIVER_FUTURE_PAYOUT','CUSTOMER_OUTSTANDING_LIABILITY',
    'CUSTOMER_BALANCE','CUSTOMER_PROMOTIONAL_CREDIT','CUSTOMER_REFERRAL_CREDIT',
    'ONLINE_PROCESSING_FEE_EXPENSE','BANK_PAYOUT_FEE_EXPENSE'));

-- Direct service-role mutations cannot mint approval, bank evidence, or PAID.
create or replace function public.release4_guard_unapproved_payout_state()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_fare bigint; v_commission bigint; v_earnings bigint; v_fee bigint;
begin
  if new.status not in ('DRAFT','RECONCILED','HELD','APPROVED','PAYMENT_RECORDED','PAID','FAILED','CANCELLED')
    or (new.status in ('APPROVED','PAYMENT_RECORDED','PAID','FAILED') and
      current_setting('release4.financial_transition',true) is distinct from new.id::text)
    or (new.status in ('DRAFT','RECONCILED','HELD','CANCELLED') and
      (new.approved_snapshot is not null or new.approval_actor is not null) and
      current_setting('release4.financial_transition',true) is distinct from new.id::text)
    then raise exception 'Payout financial transition requires authorized RPC'; end if;
  if tg_op='UPDATE' then
    if new.driver_id is distinct from old.driver_id or new.period_start is distinct from old.period_start
      or new.period_end is distinct from old.period_end or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      then raise exception 'Payout identity is immutable'; end if;
    if new.status is distinct from old.status and
      current_setting('release4.review_transition',true) is distinct from new.id::text and
      current_setting('release4.financial_transition',true) is distinct from new.id::text
      then raise exception 'Payout transition requires authorized RPC'; end if;
    if new.hold_reason is distinct from old.hold_reason and
      current_setting('release4.review_transition',true) is distinct from new.id::text and
      current_setting('release4.financial_transition',true) is distinct from new.id::text
      then raise exception 'Hold reason requires authorized RPC'; end if;
    if old.status='CANCELLED' and new.status<>'CANCELLED' then raise exception 'Cancelled payout is terminal'; end if;
    if old.status='PAID' and new.status<>'PAID' then raise exception 'Paid payout is terminal'; end if;
    select coalesce(sum(locked_fare_cents),0),coalesce(sum(current_commission_cents),0),
      coalesce(sum(driver_earnings_cents),0),coalesce(sum(actual_provider_fee_cents),0)
    into v_fare,v_commission,v_earnings,v_fee
    from public.online_payout_items where batch_id=new.id;
    if new.fare_cents<>v_fare or new.current_commission_cents<>v_commission
      or new.driver_earnings_cents<>v_earnings or new.actual_provider_fee_cents<>v_fee
      then raise exception 'Payout totals must equal immutable items'; end if;
  end if;
  if new.net_payout_cents + new.driver_provider_fee_cents + new.prior_debt_recovery_cents
      <> new.driver_earnings_cents then raise exception 'Payout arithmetic does not reconcile'; end if;
  return new;
end $$;

create function public.release4_guard_bank_evidence()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'Bank evidence is retained'; end if;
  if new.batch_id is distinct from old.batch_id or
    new.bank_transaction_reference is distinct from old.bank_transaction_reference or
    new.transfer_reference is distinct from old.transfer_reference or
    new.amount_cents is distinct from old.amount_cents or
    new.actual_bank_fee_cents is distinct from old.actual_bank_fee_cents or
    new.destination_fingerprint is distinct from old.destination_fingerprint or
    new.source_type is distinct from old.source_type or
    new.source_digest is distinct from old.source_digest or
    new.bank_state is distinct from old.bank_state or
    new.imported_by is distinct from old.imported_by or
    new.imported_at is distinct from old.imported_at or old.verified_at is not null or
    current_setting('release4.bank_verification',true) is distinct from old.id::text
    then raise exception 'Bank evidence is immutable except independent verification'; end if;
  return new;
end $$;
create trigger release4_guard_bank_evidence_trigger before update or delete
  on public.online_payout_bank_evidence for each row execute function public.release4_guard_bank_evidence();

create function public.release4_guard_beneficiary()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'Beneficiary evidence is retained'; end if;
  if old.active and (new.account_fingerprint is distinct from old.account_fingerprint or
    new.verification_reference is distinct from old.verification_reference or
    new.consent_reference is distinct from old.consent_reference or
    new.verified_by is distinct from old.verified_by or
    new.verified_at is distinct from old.verified_at) then
    raise exception 'Active beneficiary evidence cannot be rewritten'; end if;
  return new;
end $$;
create trigger release4_guard_beneficiary_trigger before update or delete
  on public.online_payout_beneficiaries for each row execute function public.release4_guard_beneficiary();

alter table public.online_payout_beneficiaries enable row level security;
alter table public.online_payout_bank_evidence enable row level security;
alter table public.online_payout_exceptions enable row level security;
revoke all on public.online_payout_beneficiaries,public.online_payout_bank_evidence,
  public.online_payout_exceptions from public,anon,authenticated,service_role;
grant select on public.online_payout_beneficiaries,public.online_payout_bank_evidence,
  public.online_payout_exceptions to service_role;

-- The liability account row is the serialization point shared with Phase 1
-- ledger posting. Reservations are excluded from the posted debt balance.
create function public.release4_available_prior_debt(p_driver_id uuid,p_exclude_batch uuid default null)
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare v_debt_account uuid; v_posted bigint; v_reserved bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select id into v_debt_account from public.financial_accounts
    where owner_type='DRIVER' and owner_id=p_driver_id and
      account_category='DRIVER_COMMISSION_DEBT' and currency='ZAR' for update;
  if v_debt_account is null then return 0; end if;
  select coalesce(sum(case e.entry_side when 'DEBIT' then e.amount_cents else -e.amount_cents end),0)
    into v_posted from public.financial_ledger_entries e
    join public.financial_transactions t on t.id=e.transaction_id and t.transaction_state='POSTED'
    where e.account_id=v_debt_account;
  select coalesce(sum(prior_debt_recovery_cents),0) into v_reserved
    from public.online_payout_batches where driver_id=p_driver_id
    and approved_snapshot is not null and status in ('APPROVED','PAYMENT_RECORDED','HELD')
    and (p_exclude_batch is null or id<>p_exclude_batch);
  return greatest(0,v_posted-v_reserved);
end $$;

-- A manual settlement posts through Phase 1 and locks the same debt account.
-- Reject a posting that would consume funds already reserved for an approval.
create function public.release4_assert_reserved_debt_floor()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_account record; v_balance bigint; v_reserved bigint;
begin
  if new.transaction_state<>'POSTED' or old.transaction_state='POSTED' then return new; end if;
  for v_account in select distinct a.id,a.owner_id from public.financial_ledger_entries e
    join public.financial_accounts a on a.id=e.account_id
    where e.transaction_id=new.id and a.account_category='DRIVER_COMMISSION_DEBT'
  loop
    select coalesce(sum(case e.entry_side when 'DEBIT' then e.amount_cents else -e.amount_cents end),0)
      into v_balance from public.financial_ledger_entries e
      join public.financial_transactions t on t.id=e.transaction_id and t.transaction_state='POSTED'
      where e.account_id=v_account.id;
    select coalesce(sum(prior_debt_recovery_cents),0) into v_reserved
      from public.online_payout_batches where driver_id=v_account.owner_id
      and approved_snapshot is not null and status in ('APPROVED','PAYMENT_RECORDED','HELD');
    if v_balance<v_reserved then raise exception 'Commission debt is reserved by an approved payout'; end if;
  end loop;
  return new;
end $$;
create trigger release4_assert_reserved_debt_floor_trigger
  after update of transaction_state on public.financial_transactions
  for each row execute function public.release4_assert_reserved_debt_floor();

create function public.release4_approve_payout(p_batch_id uuid,p_actor_id uuid,p_operation_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.online_payout_batches; v_policy public.online_payout_policy;
  v_beneficiary public.online_payout_beneficiaries; v_item record;
  v_driver_fee bigint; v_debt bigint; v_remaining bigint; v_alloc bigint;
  v_source record; v_net bigint; v_snapshot jsonb; v_count integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('owner','admin'))
    then raise exception 'Financial Admin required'; end if;
  if length(trim(coalesce(p_operation_key,''))) not between 8 and 160
    then raise exception 'Stable approval operation key required'; end if;
  select * into v_batch from public.online_payout_batches where id=p_batch_id for update;
  if not found then raise exception 'Payout batch unavailable'; end if;
  if v_batch.status='APPROVED' and v_batch.approval_operation_key=p_operation_key then
    return jsonb_build_object('status','APPROVED','batch_id',p_batch_id,'replayed',true); end if;
  if v_batch.status<>'RECONCILED' then raise exception 'Reconciled payout required'; end if;
  if exists(select 1 from public.online_payout_exceptions
    where batch_id=p_batch_id and resolved_at is null) then raise exception 'Open payout exception'; end if;
  select * into v_policy from public.online_payout_policy
    where policy_key='manual-online-payouts' for share;
  if not found or not v_policy.enabled or v_policy.approved_driver_fee_share_bps<>5000
    or v_policy.approval_reference is null or v_policy.approved_at is null
    then raise exception 'Approved 50/50 provider-fee policy is not activated'; end if;
  select * into v_beneficiary from public.online_payout_beneficiaries
    where driver_id=v_batch.driver_id and active for share;
  if not found then raise exception 'Verified beneficiary and Driver consent required'; end if;
  if (v_batch.period_start at time zone 'Africa/Johannesburg')::date <>
       date_trunc('week',v_batch.period_start at time zone 'Africa/Johannesburg')::date
    or (v_batch.period_end at time zone 'Africa/Johannesburg')::date <>
       (v_batch.period_start at time zone 'Africa/Johannesburg')::date+7
    then raise exception 'Johannesburg weekly period required'; end if;
  -- Lock existing payable rows so concurrent refund processing cannot approve
  -- the same items while their payment authority changes.
  for v_item in select i.*,p.state payable_state,p.payment_attempt_id,p.ledger_transaction_id,
      p.payable_cents,p.fare_cents,p.commission_cents,p.trip_id,
      a.state payment_state,a.reconciliation_state,a.verified_at,a.payment_ledger_transaction_id,
      e.actual_fee_cents,e.verified_at fee_verified_at,t.status trip_status,
      t.phase5_policy_version,t.phase5_driver_fare_basis_cents,
      t.phase5_service_fee_cents,t.phase5_membership_waiver_cents,t.phase5_credit_cents,
      t.final_fare,t.fare_amount
    from public.online_payout_items i
    join public.online_driver_payables p on p.id=i.payable_id
    join public.online_payment_attempts a on a.id=p.payment_attempt_id
    join public.online_payout_fee_evidence e on e.id=i.fee_evidence_id
    join public.trips t on t.id=p.trip_id
    where i.batch_id=p_batch_id order by p.id for update of p
  loop
    v_count:=v_count+1;
    if v_item.payable_state not in ('EARNED','PAYABLE')
      or v_item.payment_state<>'SUCCEEDED' or v_item.reconciliation_state<>'MATCHED'
      or v_item.verified_at is null or v_item.payment_ledger_transaction_id is null
      or v_item.fee_verified_at is null or v_item.trip_status<>'completed'
      or v_item.fare_cents<>v_item.locked_fare_cents
      or v_item.commission_cents<>v_item.current_commission_cents
      or v_item.payable_cents<>v_item.driver_earnings_cents
      or v_item.actual_fee_cents<>v_item.actual_provider_fee_cents
      or v_item.fare_cents<>(case when v_item.phase5_policy_version is not null
        then v_item.phase5_driver_fare_basis_cents
        else round(coalesce(v_item.final_fare,v_item.fare_amount)*100)::bigint end)
      or (v_item.phase5_policy_version is not null
        and greatest(0,v_item.phase5_service_fee_cents-
          v_item.phase5_membership_waiver_cents-v_item.phase5_credit_cents)>0
        and not exists(select 1 from public.financial_transactions f
          join public.financial_ledger_entries debit on debit.transaction_id=f.id
            and debit.entry_side='DEBIT'
          join public.financial_accounts source_account on source_account.id=debit.account_id
            and source_account.account_category='UNAPPLIED_FUNDS'
          join public.financial_ledger_entries credit on credit.transaction_id=f.id
            and credit.entry_side='CREDIT' and credit.amount_cents=debit.amount_cents
          join public.financial_accounts revenue_account on revenue_account.id=credit.account_id
            and revenue_account.account_category='BOOKING_FEE_REVENUE'
          where f.idempotency_key='phase5:service-fee:'||v_item.trip_id::text
            and f.transaction_state='POSTED' and f.metadata->>'cash_received_by_moovu'='true'
            and debit.amount_cents=greatest(0,v_item.phase5_service_fee_cents-
              v_item.phase5_membership_waiver_cents-v_item.phase5_credit_cents)))
      or exists(select 1 from public.online_payment_refunds r
        where r.payment_attempt_id=v_item.payment_attempt_id and r.state<>'REFUND_FAILED')
      or not exists(select 1 from public.financial_transactions f
        where f.id=v_item.ledger_transaction_id and f.transaction_state='POSTED')
      or not exists(select 1 from public.financial_transactions f
        where f.id=v_item.payment_ledger_transaction_id and f.transaction_state='POSTED')
      then raise exception 'Payout item requires financial reconciliation'; end if;
  end loop;
  if v_count=0 then raise exception 'Empty payout batch'; end if;
  v_driver_fee:=(v_batch.actual_provider_fee_cents*5000+5000)/10000;
  v_remaining:=v_batch.driver_earnings_cents-v_driver_fee;
  if v_remaining<0 then raise exception 'Verified fee exceeds eligible Driver earnings'; end if;
  v_debt:=least(v_remaining,public.release4_available_prior_debt(v_batch.driver_id));
  v_remaining:=v_debt;
  for v_source in select f.id,
      coalesce(sum(e.amount_cents),0) source_cents,
      coalesce((select sum(a.allocated_cents) from public.online_payout_debt_allocations a
        join public.online_payout_batches b on b.id=a.batch_id
        where a.source_commission_transaction_id=f.id
          and b.status not in ('FAILED','CANCELLED')),0) allocated_cents
    from public.financial_transactions f
    join public.trips t on t.id=f.source_id and f.source_type='TRIP'
    join public.financial_ledger_entries e on e.transaction_id=f.id and e.entry_side='DEBIT'
    join public.financial_accounts a on a.id=e.account_id and a.owner_type='DRIVER'
      and a.owner_id=v_batch.driver_id and a.account_category='DRIVER_COMMISSION_DEBT'
    where f.transaction_type='TRIP_FINANCIAL_COMPLETION' and f.transaction_state='POSTED'
      and lower(coalesce(t.payment_method,'cash')) in ('cash','transfer')
    group by f.id,f.effective_at order by f.effective_at,f.id
  loop
    exit when v_remaining=0;
    v_alloc:=least(v_remaining,greatest(0,v_source.source_cents-v_source.allocated_cents));
    if v_alloc>0 then
      insert into public.online_payout_debt_allocations(batch_id,source_commission_transaction_id,allocated_cents)
        values(p_batch_id,v_source.id,v_alloc);
      v_remaining:=v_remaining-v_alloc;
    end if;
  end loop;
  v_debt:=v_debt-v_remaining;
  v_net:=v_batch.driver_earnings_cents-v_driver_fee-v_debt;
  v_snapshot:=jsonb_build_object('version',1,'driver_id',v_batch.driver_id,
    'fare_cents',v_batch.fare_cents,'current_commission_cents',v_batch.current_commission_cents,
    'driver_earnings_cents',v_batch.driver_earnings_cents,
    'verified_yoco_fee_cents',v_batch.actual_provider_fee_cents,
    'driver_yoco_fee_cents',v_driver_fee,
    'moovu_yoco_fee_cents',v_batch.actual_provider_fee_cents-v_driver_fee,
    'prior_debt_reserved_cents',v_debt,'net_payout_cents',v_net,
    'beneficiary_fingerprint',v_beneficiary.account_fingerprint,
    'fee_policy_reference',v_policy.approval_reference,
    'driver_consent_reference',v_beneficiary.consent_reference);
  perform set_config('release4.financial_transition',p_batch_id::text,true);
  update public.online_payout_batches set status='APPROVED',
    fee_share_basis_points=5000,driver_provider_fee_cents=v_driver_fee,
    prior_debt_recovery_cents=v_debt,net_payout_cents=v_net,
    beneficiary_fingerprint=v_beneficiary.account_fingerprint,
    approved_snapshot=v_snapshot,approval_actor=p_actor_id,approved_at=now(),
    approval_operation_key=p_operation_key,updated_at=now()
    where id=p_batch_id;
  insert into public.online_payout_audit_events(batch_id,event_type,actor_id,event_data)
    values(p_batch_id,'APPROVED',p_actor_id,jsonb_build_object('operation_key',p_operation_key,
      'driver_fee_cents',v_driver_fee,'prior_debt_reserved_cents',v_debt,'net_cents',v_net));
  perform set_config('release4.financial_transition','',true);
  return jsonb_build_object('status','APPROVED','batch_id',p_batch_id,'replayed',false,
    'net_payout_cents',v_net,'prior_debt_reserved_cents',v_debt);
end $$;

revoke all on function public.release4_available_prior_debt(uuid,uuid),
  public.release4_assert_reserved_debt_floor(),
  public.release4_approve_payout(uuid,uuid,text),
  public.release4_guard_bank_evidence(),public.release4_guard_beneficiary()
  from public,anon,authenticated;
grant execute on function public.release4_approve_payout(uuid,uuid,text) to service_role;
grant execute on function public.release4_available_prior_debt(uuid,uuid) to service_role;

create function public.release4_record_transfer(
  p_batch_id uuid,p_actor_id uuid,p_method text,p_transfer_reference text,
  p_evidence_reference text,p_transfer_at timestamptz
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.online_payout_batches;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('owner','admin'))
    then raise exception 'Financial Admin required'; end if;
  if p_method not in ('PAYSHAP','EFT') or
    length(trim(coalesce(p_transfer_reference,''))) not between 3 and 200 or
    length(trim(coalesce(p_evidence_reference,''))) not between 3 and 200 or
    p_transfer_at is null or p_transfer_at>now()+interval '5 minutes'
    then raise exception 'Transfer recording details are incomplete'; end if;
  select * into v_batch from public.online_payout_batches where id=p_batch_id for update;
  if not found then raise exception 'Payout batch unavailable'; end if;
  if v_batch.status='PAYMENT_RECORDED' and v_batch.payout_method=p_method
    and v_batch.transfer_reference=trim(p_transfer_reference)
    and v_batch.transfer_evidence_reference=trim(p_evidence_reference)
    then return 'PAYMENT_RECORDED'; end if;
  if v_batch.status<>'APPROVED' or v_batch.approved_snapshot is null
    or v_batch.net_payout_cents=0
    or exists(select 1 from public.online_payout_exceptions
      where batch_id=p_batch_id and resolved_at is null)
    then raise exception 'Approved payout without open exception required'; end if;
  perform set_config('release4.financial_transition',p_batch_id::text,true);
  update public.online_payout_batches set status='PAYMENT_RECORDED',
    payout_method=p_method,transfer_reference=trim(p_transfer_reference),
    transfer_evidence_reference=trim(p_evidence_reference),
    payment_actor=p_actor_id,transfer_recorded_at=p_transfer_at,updated_at=now()
    where id=p_batch_id;
  insert into public.online_payout_audit_events(batch_id,event_type,actor_id,evidence_reference)
    values(p_batch_id,'TRANSFER_RECORDED',p_actor_id,trim(p_evidence_reference));
  perform set_config('release4.financial_transition','',true);
  return 'PAYMENT_RECORDED';
end $$;

-- This is an import boundary for independently obtained bank data. There is
-- deliberately no Admin HTTP route to create bank evidence from an assertion.
create function public.release4_import_bank_evidence(
  p_batch_id uuid,p_importer uuid,p_bank_transaction_reference text,
  p_transfer_reference text,p_amount_cents bigint,p_actual_bank_fee_cents bigint,
  p_destination_fingerprint text,p_source_type text,p_source_digest text,p_bank_state text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.online_payout_batches; v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if not exists(select 1 from public.profiles where id=p_importer and role in ('owner','admin'))
    then raise exception 'Financial Admin required'; end if;
  if p_source_type='LOCAL_SYNTHETIC' and current_database()<>'release4_final_cert_20261021'
    then raise exception 'Synthetic bank evidence is local-test only'; end if;
  if p_source_type not in ('INDEPENDENT_BANK_STATEMENT','LOCAL_SYNTHETIC')
    or p_bank_state not in ('SETTLED','FAILED') or p_source_digest !~ '^[a-f0-9]{64}$'
    then raise exception 'Independent bank evidence required'; end if;
  select * into v_batch from public.online_payout_batches where id=p_batch_id for update;
  if not found or v_batch.status<>'PAYMENT_RECORDED' then
    raise exception 'Recorded transfer required'; end if;
  if p_importer=v_batch.payment_actor or p_importer=v_batch.approval_actor
    then raise exception 'Independent bank importer required'; end if;
  if p_amount_cents<>v_batch.net_payout_cents or p_destination_fingerprint<>v_batch.beneficiary_fingerprint
    or p_transfer_reference<>v_batch.transfer_reference or p_actual_bank_fee_cents<0
    or length(trim(coalesce(p_bank_transaction_reference,'')))<8
    then raise exception 'Bank evidence does not match approved transfer'; end if;
  insert into public.online_payout_bank_evidence(batch_id,bank_transaction_reference,
    transfer_reference,amount_cents,actual_bank_fee_cents,destination_fingerprint,
    source_type,source_digest,bank_state,imported_by)
  values(p_batch_id,trim(p_bank_transaction_reference),trim(p_transfer_reference),
    p_amount_cents,p_actual_bank_fee_cents,p_destination_fingerprint,
    p_source_type,p_source_digest,p_bank_state,p_importer)
  returning id into v_id;
  insert into public.online_payout_audit_events(batch_id,event_type,actor_id,evidence_reference)
    values(p_batch_id,'BANK_EVIDENCE_IMPORTED',p_importer,p_bank_transaction_reference);
  return v_id;
end $$;

create function public.release4_verify_and_settle_payout(
  p_batch_id uuid,p_evidence_id uuid,p_reviewer uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.online_payout_batches; v_evidence public.online_payout_bank_evidence;
  v_debt_account public.financial_accounts; v_payable public.financial_accounts;
  v_clearing public.financial_accounts; v_yoco_expense public.financial_accounts;
  v_bank_expense public.financial_accounts; v_entries jsonb:='[]'::jsonb;
  v_moovu_fee bigint; v_clearing_credit bigint; v_post jsonb; v_payload jsonb;
  v_debt_only boolean:=false;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if not exists(select 1 from public.profiles where id=p_reviewer and role in ('owner','admin'))
    then raise exception 'Financial Admin required'; end if;
  select * into v_batch from public.online_payout_batches where id=p_batch_id for update;
  if not found then raise exception 'Payout batch unavailable'; end if;
  if v_batch.status='PAID' and v_batch.bank_evidence_id is not distinct from p_evidence_id
    and v_batch.settlement_transaction_id is not null then
    return jsonb_build_object('status','PAID','replayed',true,
      'transaction_id',v_batch.settlement_transaction_id); end if;
  v_debt_only:=v_batch.status='APPROVED' and v_batch.net_payout_cents=0
    and p_evidence_id is null and p_reviewer<>v_batch.approval_actor;
  if (not v_debt_only and v_batch.status<>'PAYMENT_RECORDED') or v_batch.approved_snapshot is null
    or exists(select 1 from public.online_payout_exceptions
      where batch_id=p_batch_id and resolved_at is null)
    then raise exception 'Recorded payout or approved debt-only offset required'; end if;
  if not v_debt_only then
    select * into v_evidence from public.online_payout_bank_evidence
      where id=p_evidence_id and batch_id=p_batch_id for update;
    if not found or v_evidence.bank_state<>'SETTLED'
      or v_evidence.amount_cents<>v_batch.net_payout_cents
      or v_evidence.transfer_reference<>v_batch.transfer_reference
      or v_evidence.destination_fingerprint<>v_batch.beneficiary_fingerprint
      or p_reviewer in (v_batch.payment_actor,v_evidence.imported_by)
      then raise exception 'Independent settled bank evidence and second reviewer required'; end if;
  end if;
  if exists(select 1 from public.online_payout_items i
    join public.online_driver_payables p on p.id=i.payable_id
    join public.online_payment_refunds r on r.payment_attempt_id=p.payment_attempt_id
      and r.state<>'REFUND_FAILED' where i.batch_id=p_batch_id)
    then raise exception 'Refund-affected payout requires exception review'; end if;
  if public.release4_available_prior_debt(v_batch.driver_id,p_batch_id)
       <v_batch.prior_debt_recovery_cents then
    raise exception 'Reserved commission debt changed before settlement'; end if;
  v_debt_account:=public.phase1_ensure_financial_account(
    'DRIVER:'||upper(v_batch.driver_id::text)||':COMMISSION_DEBT:ZAR',
    'DRIVER_COMMISSION_DEBT','DRIVER',v_batch.driver_id,'DEBIT','ZAR');
  v_payable:=public.phase1_ensure_financial_account(
    'DRIVER:'||upper(v_batch.driver_id::text)||':EARNINGS_PAYABLE:ZAR',
    'DRIVER_EARNINGS_PAYABLE','DRIVER',v_batch.driver_id,'CREDIT','ZAR');
  v_clearing:=public.phase1_ensure_financial_account('PLATFORM:PAYMENT_CLEARING:ZAR',
    'PAYMENT_CLEARING','PLATFORM',null,'DEBIT','ZAR');
  v_yoco_expense:=public.phase1_ensure_financial_account('PLATFORM:ONLINE_PROCESSING_FEE_EXPENSE:ZAR',
    'ONLINE_PROCESSING_FEE_EXPENSE','PLATFORM',null,'DEBIT','ZAR');
  v_bank_expense:=public.phase1_ensure_financial_account('PLATFORM:BANK_PAYOUT_FEE_EXPENSE:ZAR',
    'BANK_PAYOUT_FEE_EXPENSE','PLATFORM',null,'DEBIT','ZAR');
  v_moovu_fee:=v_batch.actual_provider_fee_cents-v_batch.driver_provider_fee_cents;
  v_clearing_credit:=v_batch.net_payout_cents+v_batch.actual_provider_fee_cents+
    coalesce(v_evidence.actual_bank_fee_cents,0);
  v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
    'account_id',v_payable.id,'entry_side','DEBIT','amount_cents',v_batch.driver_earnings_cents));
  if v_moovu_fee>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
    'account_id',v_yoco_expense.id,'entry_side','DEBIT','amount_cents',v_moovu_fee)); end if;
  if coalesce(v_evidence.actual_bank_fee_cents,0)>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
    'account_id',v_bank_expense.id,'entry_side','DEBIT','amount_cents',v_evidence.actual_bank_fee_cents)); end if;
  if v_batch.prior_debt_recovery_cents>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
    'account_id',v_debt_account.id,'entry_side','CREDIT','amount_cents',v_batch.prior_debt_recovery_cents)); end if;
  if v_clearing_credit>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
    'account_id',v_clearing.id,'entry_side','CREDIT','amount_cents',v_clearing_credit)); end if;
  v_payload:=jsonb_build_object('batch_id',p_batch_id,'snapshot',v_batch.approved_snapshot,
    'bank_reference',case when v_debt_only then 'DEBT_OFFSET' else v_evidence.bank_transaction_reference end,
    'bank_fee_cents',coalesce(v_evidence.actual_bank_fee_cents,0),
    'entries',v_entries);
  if not v_debt_only then
    perform set_config('release4.bank_verification',p_evidence_id::text,true);
    update public.online_payout_bank_evidence set verified_by=p_reviewer,verified_at=now()
      where id=p_evidence_id;
    perform set_config('release4.bank_verification','',true);
  end if;
  perform set_config('release4.financial_transition',p_batch_id::text,true);
  update public.online_payout_batches set status='PAID',bank_evidence_id=p_evidence_id,
    payout_method=case when v_debt_only then 'DEBT_OFFSET' else payout_method end,
    transfer_reference=case when v_debt_only then 'DEBT_OFFSET:'||p_batch_id::text else transfer_reference end,
    transfer_evidence_reference=case when v_debt_only then 'NO_EXTERNAL_TRANSFER' else transfer_evidence_reference end,
    payment_actor=case when v_debt_only then p_reviewer else payment_actor end,
    paid_at=now(),updated_at=now() where id=p_batch_id;
  v_post:=public.phase1_post_financial_transaction('online_payout:'||p_batch_id::text,
    encode(extensions.digest(v_payload::text,'sha256'),'hex'),'DRIVER_PAYOUT','ADJUSTMENT',
    p_batch_id,'ZAR','ADMIN',p_reviewer,now(),v_entries,
    jsonb_build_object('batch_id',p_batch_id,'bank_evidence_id',p_evidence_id,
      'debt_only_offset',v_debt_only));
  if v_post->>'state'<>'POSTED' then raise exception 'Payout ledger posting failed'; end if;
  update public.online_payout_batches set settlement_transaction_id=(v_post->>'transaction_id')::uuid
    where id=p_batch_id;
  update public.online_payout_debt_allocations set ledger_transaction_id=(v_post->>'transaction_id')::uuid
    where batch_id=p_batch_id;
  update public.online_driver_payables set state='PAID' where id in
    (select payable_id from public.online_payout_items where batch_id=p_batch_id);
  insert into public.online_payout_audit_events(batch_id,event_type,actor_id,evidence_reference,
    event_data) values(p_batch_id,'PAID',p_reviewer,
      case when v_debt_only then 'DEBT_OFFSET' else v_evidence.bank_transaction_reference end,
    jsonb_build_object('ledger_transaction_id',v_post->>'transaction_id',
      'bank_fee_cents',coalesce(v_evidence.actual_bank_fee_cents,0),'debt_only_offset',v_debt_only));
  perform set_config('release4.financial_transition','',true);
  return jsonb_build_object('status','PAID','replayed',false,
    'transaction_id',v_post->>'transaction_id');
end $$;

create function public.release4_close_unpaid_payout(
  p_batch_id uuid,p_actor_id uuid,p_action text,p_reason text,p_evidence_id uuid default null
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.online_payout_batches; v_evidence public.online_payout_bank_evidence;
  v_target text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('owner','admin'))
    then raise exception 'Financial Admin required'; end if;
  if p_action not in ('CANCEL','FAILED') or length(trim(coalesce(p_reason,'')))<3
    then raise exception 'Documented payout closure required'; end if;
  v_target:=case p_action when 'CANCEL' then 'CANCELLED' else 'FAILED' end;
  select * into v_batch from public.online_payout_batches where id=p_batch_id for update;
  if not found then raise exception 'Payout batch unavailable'; end if;
  if v_batch.status=v_target then return v_target; end if;
  if p_action='CANCEL' and v_batch.status<>'APPROVED' then
    raise exception 'Only an unrecorded approved payout can be cancelled'; end if;
  if p_action='FAILED' then
    if v_batch.status<>'PAYMENT_RECORDED' then raise exception 'Recorded transfer required'; end if;
    select * into v_evidence from public.online_payout_bank_evidence
      where id=p_evidence_id and batch_id=p_batch_id for update;
    if not found or v_evidence.bank_state<>'FAILED' or
      p_actor_id in (v_batch.payment_actor,v_evidence.imported_by) then
      raise exception 'Independent failed-bank evidence required'; end if;
  end if;
  perform set_config('release4.financial_transition',p_batch_id::text,true);
  update public.online_payout_batches set status=v_target,hold_reason=trim(p_reason),
    bank_evidence_id=case when p_action='FAILED' then p_evidence_id else bank_evidence_id end,
    updated_at=now() where id=p_batch_id;
  insert into public.online_payout_audit_events(batch_id,event_type,actor_id,reason,evidence_reference)
    values(p_batch_id,v_target,p_actor_id,trim(p_reason),
      case when p_action='FAILED' then v_evidence.bank_transaction_reference else null end);
  perform set_config('release4.financial_transition','',true);
  return v_target;
end $$;

-- Incoming refunds remain allowed. They place unpaid payouts on hold and put
-- already-paid payouts into an exception queue; history is never rewritten.
create function public.release4_watch_payout_refund()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch record; v_kind text;
begin
  if new.state='REFUND_FAILED' then return new; end if;
  for v_batch in select b.id,b.status,b.approved_snapshot from public.online_payout_batches b
    join public.online_payout_items i on i.batch_id=b.id
    join public.online_driver_payables p on p.id=i.payable_id
    where p.payment_attempt_id=new.payment_attempt_id
      and b.status not in ('CANCELLED','FAILED')
    order by b.id for update of b
  loop
    v_kind:=case when v_batch.status='PAID' then 'REFUND_AFTER_PAYMENT'
      when v_batch.approved_snapshot is null then 'REFUND_BEFORE_APPROVAL'
      else 'REFUND_AFTER_APPROVAL' end;
    insert into public.online_payout_exceptions(batch_id,exception_type,source_reference,details)
      values(v_batch.id,v_kind,new.id::text,jsonb_build_object(
        'refund_state',new.state,'refund_amount_cents',new.amount_cents))
      on conflict(batch_id,exception_type,source_reference) do nothing;
    if v_batch.status<>'PAID' and v_batch.status<>'HELD' then
      perform set_config('release4.financial_transition',v_batch.id::text,true);
      update public.online_payout_batches set status='HELD',
        hold_reason='Refund requires reconciliation',updated_at=now() where id=v_batch.id;
      perform set_config('release4.financial_transition','',true);
    end if;
    insert into public.online_payout_audit_events(batch_id,event_type,actor_id,evidence_reference)
      values(v_batch.id,'REFUND_EXCEPTION',new.requested_by,new.id::text);
  end loop;
  return new;
end $$;
create trigger release4_watch_payout_refund_insert_trigger
  before insert on public.online_payment_refunds
  for each row execute function public.release4_watch_payout_refund();
create trigger release4_watch_payout_refund_update_trigger
  before update of state on public.online_payment_refunds
  for each row when (new.state is distinct from old.state)
  execute function public.release4_watch_payout_refund();

revoke all on function public.release4_record_transfer(uuid,uuid,text,text,text,timestamptz),
  public.release4_import_bank_evidence(uuid,uuid,text,text,bigint,bigint,text,text,text,text),
  public.release4_verify_and_settle_payout(uuid,uuid,uuid),
  public.release4_close_unpaid_payout(uuid,uuid,text,text,uuid),
  public.release4_watch_payout_refund()
  from public,anon,authenticated;
grant execute on function public.release4_record_transfer(uuid,uuid,text,text,text,timestamptz),
  public.release4_import_bank_evidence(uuid,uuid,text,text,bigint,bigint,text,text,text,text),
  public.release4_verify_and_settle_payout(uuid,uuid,uuid),
  public.release4_close_unpaid_payout(uuid,uuid,text,text,uuid) to service_role;

commit;
