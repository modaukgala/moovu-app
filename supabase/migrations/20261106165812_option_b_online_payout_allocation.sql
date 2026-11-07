-- Dormant Option B metadata and safety guards. No activation, backfill, or payout posting.
-- Compatible with the currently deployed payout readers and legacy batch rows.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.online_payout_policy
  add column option_b_effective_at timestamptz,
  add column option_b_approval_reference text,
  add column option_b_approved_by uuid references auth.users(id) on delete restrict,
  add column option_b_recorded_at timestamptz,
  add constraint option_b_activation_complete check (
    (option_b_effective_at is null and option_b_approval_reference is null and
      option_b_approved_by is null and option_b_recorded_at is null)
    or (option_b_effective_at is not null and option_b_approval_reference is not null and
      length(trim(option_b_approval_reference)) between 3 and 200 and
      option_b_approved_by is not null and option_b_recorded_at is not null));

create function public.release4_guard_option_b_activation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.option_b_effective_at is not null and (
    new.option_b_effective_at is distinct from old.option_b_effective_at or
    new.option_b_approval_reference is distinct from old.option_b_approval_reference or
    new.option_b_approved_by is distinct from old.option_b_approved_by or
    new.option_b_recorded_at is distinct from old.option_b_recorded_at)
  then raise exception 'Option B activation is immutable'; end if;
  if old.option_b_effective_at is null and new.option_b_effective_at is not null and
    (new.option_b_effective_at < statement_timestamp() or
      old.effective_at is null or new.option_b_effective_at <= old.effective_at)
  then raise exception 'Option B requires a future forward-only cutoff'; end if;
  return new;
end $$;
create trigger release4_guard_option_b_activation_trigger
  before update on public.online_payout_policy
  for each row execute function public.release4_guard_option_b_activation();

alter table public.online_payout_fee_evidence
  add column percentage_fee_cents bigint,
  add column fixed_fee_cents bigint,
  add constraint option_b_fee_components_reconcile check (
    (percentage_fee_cents is null and fixed_fee_cents is null) or
    (percentage_fee_cents is not null and fixed_fee_cents is not null and
      percentage_fee_cents >= 0 and fixed_fee_cents >= 0 and
      percentage_fee_cents + fixed_fee_cents = actual_fee_cents));

alter table public.online_payout_items
  add column policy_version text,
  add column driver_booking_share_cents bigint not null default 0,
  add column percentage_fee_cents bigint not null default 0,
  add column fixed_fee_cents bigint not null default 0,
  add column driver_percentage_fee_cents bigint not null default 0,
  add column moovu_percentage_fee_cents bigint not null default 0,
  add constraint option_b_item_allocation check (
    (policy_version is null and driver_booking_share_cents=0 and
      percentage_fee_cents=0 and fixed_fee_cents=0 and
      driver_percentage_fee_cents=0 and moovu_percentage_fee_cents=0)
    or (policy_version='online-driver-payout-option-b-v1' and
      driver_booking_share_cents=100 and percentage_fee_cents>=0 and fixed_fee_cents>=0 and
      driver_percentage_fee_cents>=0 and moovu_percentage_fee_cents>=0 and
      driver_percentage_fee_cents+moovu_percentage_fee_cents=percentage_fee_cents and
      driver_provider_fee_cents=driver_percentage_fee_cents+fixed_fee_cents and
      actual_provider_fee_cents=percentage_fee_cents+fixed_fee_cents));

alter table public.online_payout_batches
  add column policy_version text,
  add column driver_booking_share_cents bigint not null default 0,
  add constraint option_b_batch_policy check (
    (policy_version is null and driver_booking_share_cents=0) or
    (policy_version='online-driver-payout-option-b-v1' and driver_booking_share_cents>=100));
alter table public.online_payout_batches drop constraint online_payout_batches_check1;
alter table public.online_payout_batches add constraint online_payout_batches_check1
  check (net_payout_cents+driver_provider_fee_cents+prior_debt_recovery_cents=
    driver_earnings_cents+driver_booking_share_cents);

-- Keep the existing transition restrictions while reconciling the added
-- booking share against immutable items. Legacy rows still have a zero share.
create or replace function public.release4_guard_unapproved_payout_state()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_fare bigint; v_commission bigint; v_earnings bigint; v_fee bigint; v_booking bigint;
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
      coalesce(sum(driver_earnings_cents),0),coalesce(sum(actual_provider_fee_cents),0),
      coalesce(sum(driver_booking_share_cents),0)
    into v_fare,v_commission,v_earnings,v_fee,v_booking
    from public.online_payout_items where batch_id=new.id;
    if new.fare_cents<>v_fare or new.current_commission_cents<>v_commission
      or new.driver_earnings_cents<>v_earnings or new.actual_provider_fee_cents<>v_fee
      or new.driver_booking_share_cents<>v_booking
      then raise exception 'Payout totals must equal immutable items'; end if;
  end if;
  if new.net_payout_cents + new.driver_provider_fee_cents + new.prior_debt_recovery_cents
      <> new.driver_earnings_cents + new.driver_booking_share_cents
    then raise exception 'Payout arithmetic does not reconcile'; end if;
  return new;
end $$;

create function public.release4_guard_option_b_item()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_trip public.trips; v_attempt public.online_payment_attempts;
  v_fee public.online_payout_fee_evidence; v_cutoff timestamptz;
begin
  if new.policy_version is distinct from 'online-driver-payout-option-b-v1' then return new; end if;
  select option_b_effective_at into v_cutoff from public.online_payout_policy
    where policy_key='manual-online-payouts';
  select t.* into v_trip from public.online_driver_payables p
    join public.trips t on t.id=p.trip_id where p.id=new.payable_id;
  select a.* into v_attempt from public.online_driver_payables p
    join public.online_payment_attempts a on a.id=p.payment_attempt_id where p.id=new.payable_id;
  select * into v_fee from public.online_payout_fee_evidence where id=new.fee_evidence_id;
  if v_cutoff is null or v_trip.id is null or v_attempt.id is null or v_fee.id is null or
    v_trip.completed_at<v_cutoff or
    v_trip.status is distinct from 'completed' or v_trip.phase5_policy_version is null or
    v_trip.phase5_service_fee_cents is distinct from
      (case v_trip.ride_option when 'go' then 300 when 'group' then 500 else -1 end) or
    v_trip.phase5_membership_waiver_cents is distinct from 0 or
    v_trip.phase5_credit_cents is distinct from 0 or
    v_trip.phase5_driver_fare_basis_cents is distinct from new.locked_fare_cents or
    v_trip.phase5_customer_total_cents is distinct from v_attempt.amount_cents or
    v_attempt.state is distinct from 'SUCCEEDED' or
    v_attempt.reconciliation_state is distinct from 'MATCHED' or
    v_attempt.verified_at is null or v_attempt.payment_ledger_transaction_id is null or
    v_fee.payment_attempt_id is distinct from v_attempt.id or
    v_fee.percentage_fee_cents is null or v_fee.fixed_fee_cents is null or
    v_fee.percentage_fee_cents is distinct from (v_attempt.amount_cents*35+500)/1000 or
    v_fee.fixed_fee_cents is distinct from 200 or
    new.percentage_fee_cents is distinct from v_fee.percentage_fee_cents or
    new.fixed_fee_cents is distinct from v_fee.fixed_fee_cents or
    new.driver_percentage_fee_cents is distinct from (v_fee.percentage_fee_cents+1)/2 or
    new.moovu_percentage_fee_cents is distinct from
      v_fee.percentage_fee_cents-new.driver_percentage_fee_cents or
    exists(select 1 from public.online_payment_refunds r
      where r.payment_attempt_id=v_attempt.id and r.state<>'REFUND_FAILED')
  then raise exception 'Option B item requires verified, matching fee components and locked trip terms'; end if;
  return new;
end $$;
create trigger release4_guard_option_b_item_trigger
  before insert on public.online_payout_items
  for each row execute function public.release4_guard_option_b_item();

create or replace function public.release4_create_payout_draft(
  p_driver_id uuid,p_period_start timestamptz,p_period_end timestamptz,
  p_payable_ids uuid[],p_actor_id uuid
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch uuid; v_row record; v_count integer:=0; v_fare bigint:=0;
  v_commission bigint:=0; v_earnings bigint:=0; v_fee bigint:=0;
  v_booking bigint:=0; v_item_policy text; v_batch_policy text;
  v_option_b_at timestamptz; v_driver_percentage bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('owner','admin'))
    then raise exception 'Financial Admin required'; end if;
  if p_period_start is null or p_period_end is null or p_period_start>=p_period_end
    or p_period_end-p_period_start>interval '8 days' then raise exception 'Valid weekly period required'; end if;
  if coalesce(array_length(p_payable_ids,1),0) not between 1 and 100
    or (select count(distinct id) from unnest(p_payable_ids) id)<>array_length(p_payable_ids,1)
    then raise exception 'Unique, bounded payable selection required'; end if;
  select option_b_effective_at into v_option_b_at from public.online_payout_policy
    where policy_key='manual-online-payouts';
  perform pg_advisory_xact_lock(hashtextextended('online-payout:'||p_driver_id::text,0));
  insert into public.online_payout_batches(driver_id,period_start,period_end,created_by)
    values(p_driver_id,p_period_start,p_period_end,p_actor_id) returning id into v_batch;
  for v_row in
    select p.id,p.trip_id,p.driver_id,p.payment_attempt_id,p.fare_cents,
      p.commission_cents,p.payable_cents,p.earned_at,p.state,p.ledger_transaction_id,
      a.state payment_state,a.reconciliation_state,a.verified_at,a.payment_ledger_transaction_id,
      a.amount_cents payment_total_cents,
      e.id fee_evidence_id,e.actual_fee_cents,e.percentage_fee_cents,e.fixed_fee_cents,
      t.status trip_status,t.completed_at,t.ride_option,t.phase5_policy_version,
      t.phase5_driver_fare_basis_cents,t.phase5_customer_total_cents,
      t.phase5_service_fee_cents,t.phase5_membership_waiver_cents,t.phase5_credit_cents
    from public.online_driver_payables p
    join public.online_payment_attempts a on a.id=p.payment_attempt_id
    join public.online_payout_fee_evidence e on e.payment_attempt_id=a.id
    join public.trips t on t.id=p.trip_id
    where p.id=any(p_payable_ids) order by p.id for update of p
  loop
    if v_row.driver_id<>p_driver_id or v_row.state not in ('EARNED','PAYABLE')
      or v_row.earned_at<p_period_start or v_row.earned_at>=p_period_end
      or v_row.ledger_transaction_id is null
      or v_row.payment_state<>'SUCCEEDED' or v_row.reconciliation_state<>'MATCHED'
      or v_row.verified_at is null or v_row.payment_ledger_transaction_id is null
      or v_row.trip_status<>'completed' or v_row.completed_at is distinct from v_row.earned_at
      or exists(select 1 from public.online_payment_refunds r
        where r.payment_attempt_id=v_row.payment_attempt_id and r.state<>'REFUND_FAILED')
      or not exists(select 1 from public.financial_transactions ft
        where ft.id=v_row.ledger_transaction_id and ft.transaction_state='POSTED')
      then raise exception 'Payable requires completed, unreversed, reconciled payment and posted ledger'; end if;
    v_item_policy:=case when v_option_b_at is not null and v_row.completed_at>=v_option_b_at
      then 'online-driver-payout-option-b-v1' else null end;
    if v_count>0 and v_item_policy is distinct from v_batch_policy
      then raise exception 'A payout batch cannot mix financial policy versions'; end if;
    v_batch_policy:=v_item_policy;
    if v_item_policy is not null then
      if v_row.phase5_policy_version is null or
        v_row.phase5_driver_fare_basis_cents is distinct from v_row.fare_cents or
        v_row.phase5_service_fee_cents is distinct from
          (case v_row.ride_option when 'go' then 300 when 'group' then 500 else -1 end) or
        v_row.phase5_membership_waiver_cents is distinct from 0 or
        v_row.phase5_credit_cents is distinct from 0 or
        v_row.phase5_customer_total_cents is distinct from v_row.payment_total_cents or
        v_row.payment_total_cents is distinct from v_row.fare_cents+v_row.phase5_service_fee_cents or
        v_row.percentage_fee_cents is null or v_row.fixed_fee_cents is null or
        v_row.percentage_fee_cents is distinct from (v_row.payment_total_cents*35+500)/1000 or
        v_row.fixed_fee_cents is distinct from 200
      then raise exception 'Option B requires locked R3 or R5 booking terms and matching verified fee components'; end if;
      v_driver_percentage:=(v_row.percentage_fee_cents+1)/2;
      insert into public.online_payout_items(batch_id,payable_id,fee_evidence_id,
        locked_fare_cents,current_commission_cents,driver_earnings_cents,
        actual_provider_fee_cents,driver_provider_fee_cents,policy_version,
        driver_booking_share_cents,percentage_fee_cents,fixed_fee_cents,
        driver_percentage_fee_cents,moovu_percentage_fee_cents)
      values(v_batch,v_row.id,v_row.fee_evidence_id,v_row.fare_cents,
        v_row.commission_cents,v_row.payable_cents,v_row.actual_fee_cents,
        v_driver_percentage+v_row.fixed_fee_cents,v_item_policy,100,
        v_row.percentage_fee_cents,v_row.fixed_fee_cents,v_driver_percentage,
        v_row.percentage_fee_cents-v_driver_percentage);
      v_booking:=v_booking+100;
    else
      insert into public.online_payout_items(batch_id,payable_id,fee_evidence_id,
        locked_fare_cents,current_commission_cents,driver_earnings_cents,
        actual_provider_fee_cents,driver_provider_fee_cents)
      values(v_batch,v_row.id,v_row.fee_evidence_id,v_row.fare_cents,
        v_row.commission_cents,v_row.payable_cents,v_row.actual_fee_cents,0);
    end if;
    v_count:=v_count+1; v_fare:=v_fare+v_row.fare_cents;
    v_commission:=v_commission+v_row.commission_cents;
    v_earnings:=v_earnings+v_row.payable_cents;
    v_fee:=v_fee+v_row.actual_fee_cents;
  end loop;
  if v_count<>array_length(p_payable_ids,1) then
    raise exception 'Selected payables unavailable or missing fee evidence'; end if;
  update public.online_payout_batches set fare_cents=v_fare,current_commission_cents=v_commission,
    driver_earnings_cents=v_earnings,actual_provider_fee_cents=v_fee,
    driver_booking_share_cents=v_booking,policy_version=v_batch_policy,
    net_payout_cents=v_earnings+v_booking,updated_at=now() where id=v_batch;
  insert into public.online_payout_audit_events(batch_id,event_type,actor_id,event_data)
    values(v_batch,'DRAFT_CREATED',p_actor_id,
      jsonb_build_object('item_count',v_count,'policy_version',v_batch_policy));
  return v_batch;
end $$;

-- A legacy app version cannot approve a new-policy batch with its old 50/50 total-fee split.
create function public.release4_guard_option_b_batch()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_booking bigint; v_driver_fee bigint; v_count integer;
begin
  if tg_op='UPDATE' and old.approved_snapshot is not null and (
    new.policy_version is distinct from old.policy_version or
    new.driver_booking_share_cents is distinct from old.driver_booking_share_cents)
  then raise exception 'Approved Option B allocation is immutable'; end if;
  if new.policy_version='online-driver-payout-option-b-v1' and
    new.status in ('APPROVED','PAYMENT_RECORDED','PAID') then
    select coalesce(sum(driver_booking_share_cents),0),
      coalesce(sum(driver_percentage_fee_cents+fixed_fee_cents),0),count(*)
      into v_booking,v_driver_fee,v_count from public.online_payout_items where batch_id=new.id;
    if v_count=0 or new.driver_booking_share_cents<>v_booking or
      new.driver_provider_fee_cents<>v_driver_fee or
      new.approved_snapshot->>'version' is distinct from 'option-b-v1' then
      raise exception 'Option B batch requires reviewed item allocation'; end if;
  end if;
  return new;
end $$;
create trigger release4_guard_option_b_batch_trigger
  before insert or update on public.online_payout_batches
  for each row execute function public.release4_guard_option_b_batch();

create or replace function public.release4_approve_payout(p_batch_id uuid,p_actor_id uuid,p_operation_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.online_payout_batches; v_policy public.online_payout_policy;
  v_beneficiary public.online_payout_beneficiaries; v_item record;
  v_driver_fee bigint; v_debt bigint; v_remaining bigint; v_alloc bigint;
  v_source record; v_net bigint; v_snapshot jsonb; v_count integer:=0;
  v_option_b_driver_fee bigint:=0; v_option_b_booking bigint:=0;
  v_option_b_percentage bigint:=0; v_option_b_fixed bigint:=0;
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
      e.actual_fee_cents,e.percentage_fee_cents evidence_percentage_fee_cents,
      e.fixed_fee_cents evidence_fixed_fee_cents,
      e.verified_at fee_verified_at,a.amount_cents payment_total_cents,
      t.completed_at,t.phase5_customer_total_cents,t.status trip_status,t.ride_option,
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
      or v_item.policy_version is distinct from v_batch.policy_version
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
    if v_batch.policy_version='online-driver-payout-option-b-v1' then
      if v_policy.option_b_effective_at is null or
        v_item.completed_at<v_policy.option_b_effective_at or
        v_item.phase5_service_fee_cents is distinct from
          (case v_item.ride_option when 'go' then 300 when 'group' then 500 else -1 end) or
        v_item.phase5_membership_waiver_cents is distinct from 0 or
        v_item.phase5_credit_cents is distinct from 0 or
        v_item.phase5_customer_total_cents is distinct from v_item.payment_total_cents or
        v_item.payment_total_cents is distinct from v_item.fare_cents+v_item.phase5_service_fee_cents or
        v_item.percentage_fee_cents is null or v_item.fixed_fee_cents is null or
        v_item.percentage_fee_cents is distinct from v_item.evidence_percentage_fee_cents or
        v_item.fixed_fee_cents is distinct from v_item.evidence_fixed_fee_cents or
        v_item.percentage_fee_cents is distinct from (v_item.payment_total_cents*35+500)/1000 or
        v_item.fixed_fee_cents is distinct from 200 or
        v_item.driver_booking_share_cents is distinct from 100 or
        v_item.driver_percentage_fee_cents is distinct from (v_item.percentage_fee_cents+1)/2 or
        v_item.moovu_percentage_fee_cents is distinct from
          v_item.percentage_fee_cents-v_item.driver_percentage_fee_cents or
        v_item.driver_provider_fee_cents is distinct from
          v_item.driver_percentage_fee_cents+v_item.fixed_fee_cents
      then raise exception 'Option B item requires fee and booking reconciliation'; end if;
      v_option_b_driver_fee:=v_option_b_driver_fee+v_item.driver_provider_fee_cents;
      v_option_b_booking:=v_option_b_booking+v_item.driver_booking_share_cents;
      v_option_b_percentage:=v_option_b_percentage+v_item.percentage_fee_cents;
      v_option_b_fixed:=v_option_b_fixed+v_item.fixed_fee_cents;
    end if;
  end loop;
  if v_count=0 then raise exception 'Empty payout batch'; end if;
  if v_batch.policy_version='online-driver-payout-option-b-v1' then
    if v_batch.driver_booking_share_cents<>v_option_b_booking or
      v_batch.actual_provider_fee_cents<>v_option_b_percentage+v_option_b_fixed
    then raise exception 'Option B batch does not match immutable items'; end if;
    v_driver_fee:=v_option_b_driver_fee;
  else
    v_driver_fee:=(v_batch.actual_provider_fee_cents*5000+5000)/10000;
  end if;
  v_remaining:=v_batch.driver_earnings_cents+v_batch.driver_booking_share_cents-v_driver_fee;
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
  v_net:=v_batch.driver_earnings_cents+v_batch.driver_booking_share_cents-v_driver_fee-v_debt;
  v_snapshot:=jsonb_build_object('version',case when v_batch.policy_version is null
      then to_jsonb(1) else to_jsonb('option-b-v1'::text) end,'driver_id',v_batch.driver_id,
    'fare_cents',v_batch.fare_cents,'current_commission_cents',v_batch.current_commission_cents,
    'driver_earnings_cents',v_batch.driver_earnings_cents,
    'driver_booking_share_cents',v_batch.driver_booking_share_cents,
    'verified_percentage_fee_cents',case when v_batch.policy_version is null
      then null else v_option_b_percentage end,
    'verified_fixed_fee_cents',case when v_batch.policy_version is null
      then null else v_option_b_fixed end,
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


create or replace function public.release4_verify_and_settle_payout(
  p_batch_id uuid,p_evidence_id uuid,p_reviewer uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.online_payout_batches; v_evidence public.online_payout_bank_evidence;
  v_debt_account public.financial_accounts; v_payable public.financial_accounts;
  v_clearing public.financial_accounts; v_yoco_expense public.financial_accounts;
  v_bank_expense public.financial_accounts; v_booking_revenue public.financial_accounts;
  v_entries jsonb:='[]'::jsonb;
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
    'account_id',v_payable.id,'entry_side','DEBIT',
    'amount_cents',v_batch.driver_earnings_cents+v_batch.driver_booking_share_cents));
  if v_batch.policy_version='online-driver-payout-option-b-v1' then
    v_booking_revenue:=public.phase1_ensure_financial_account(
      coalesce((select account_code from public.financial_accounts where owner_type='PLATFORM'
        and owner_id is null and account_category='BOOKING_FEE_REVENUE' and currency='ZAR'),
        'PHASE5:SERVICE_FEE:REVENUE'),
      'BOOKING_FEE_REVENUE','PLATFORM',null,'CREDIT','ZAR');
    v_entries:=v_entries||jsonb_build_array(
      jsonb_build_object('account_id',v_booking_revenue.id,'entry_side','DEBIT',
        'amount_cents',v_batch.driver_booking_share_cents),
      jsonb_build_object('account_id',v_payable.id,'entry_side','CREDIT',
        'amount_cents',v_batch.driver_booking_share_cents));
  end if;
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


create or replace function public.release4_verify_manual_payment(p_payment_id uuid,p_reviewer uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_payment public.online_payout_manual_payments; v_evidence public.online_payout_manual_bank_evidence;
  v_batch public.online_payout_batches; v_payable public.financial_accounts;
  v_clearing public.financial_accounts; v_bank_expense public.financial_accounts;
  v_debt_account public.financial_accounts; v_yoco_expense public.financial_accounts;
  v_booking_revenue public.financial_accounts;
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
    if v_batch.policy_version='online-driver-payout-option-b-v1' then
      v_booking_revenue:=public.phase1_ensure_financial_account(
        coalesce((select account_code from public.financial_accounts where owner_type='PLATFORM'
          and owner_id is null and account_category='BOOKING_FEE_REVENUE' and currency='ZAR'),
          'PHASE5:SERVICE_FEE:REVENUE'),
        'BOOKING_FEE_REVENUE','PLATFORM',null,'CREDIT','ZAR');
      v_entries:=v_entries||jsonb_build_array(
        jsonb_build_object('account_id',v_booking_revenue.id,'entry_side','DEBIT',
          'amount_cents',v_batch.driver_booking_share_cents),
        jsonb_build_object('account_id',v_payable.id,'entry_side','CREDIT',
          'amount_cents',v_batch.driver_booking_share_cents));
    end if;
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


revoke all on function public.release4_guard_option_b_activation(),
  public.release4_guard_option_b_batch(),public.release4_guard_option_b_item()
  from public,anon,authenticated;
commit;
