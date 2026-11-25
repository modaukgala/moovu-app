-- FIN-04 transactional allocation. Policy activation requires a separate database-owner action.
begin;

create table public.commission_first_provider_fee_evidence (
  id uuid primary key default gen_random_uuid(),
  payment_attempt_id uuid not null unique references public.online_payment_attempts(id),
  external_reference text not null unique check (external_reference = btrim(external_reference) and length(external_reference) between 1 and 200),
  evidence_reference text not null unique check (evidence_reference = btrim(evidence_reference) and length(evidence_reference) between 1 and 500),
  percentage_cents bigint not null check (percentage_cents >= 0),
  fixed_cents bigint not null check (fixed_cents >= 0),
  total_cents bigint not null check (total_cents = percentage_cents + fixed_cents),
  currency text not null check (currency = 'ZAR'),
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  unique (id, payment_attempt_id)
);

create table public.commission_first_provider_fee_reviews (
  evidence_id uuid primary key references public.commission_first_provider_fee_evidence(id),
  verified_by uuid not null references public.profiles(id),
  verified_at timestamptz not null default now()
);

create table public.commission_first_policy (
  version text primary key check (version = 'commission-first-v1'),
  eligible_from timestamptz not null,
  activated_at timestamptz not null default clock_timestamp(),
  check (eligible_from >= activated_at)
);
alter table public.commission_first_policy enable row level security;
revoke all on public.commission_first_policy from public, anon, authenticated, service_role;

create table public.commission_first_payout_allocations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.trips(id),
  driver_id uuid not null references public.drivers(id),
  payment_attempt_id uuid not null unique references public.online_payment_attempts(id),
  payable_id uuid not null unique references public.online_driver_payables(id),
  original_payable_cents bigint not null check (original_payable_cents > 0),
  fee_evidence_id uuid not null unique references public.commission_first_provider_fee_reviews(evidence_id),
  completed_at timestamptz not null,
  customer_payment_cents bigint not null check (customer_payment_cents > 0),
  ride_fare_cents bigint not null check (ride_fare_cents > 0),
  driver_booking_cents bigint not null check (driver_booking_cents = 100),
  platform_booking_cents bigint not null check (platform_booking_cents in (200, 400)),
  percentage_deduction_cents bigint not null check (percentage_deduction_cents >= 0),
  fixed_deduction_cents bigint not null check (fixed_deduction_cents = 200),
  gross_cents bigint not null check (gross_cents >= 0),
  debt_before_cents bigint not null check (debt_before_cents >= 0),
  recovered_cents bigint not null,
  net_cents bigint not null check (net_cents >= 0),
  debt_remaining_cents bigint not null check (debt_remaining_cents >= 0),
  ledger_transaction_id uuid unique references public.financial_transactions(id),
  check ((ledger_transaction_id is null) = (gross_cents = original_payable_cents and recovered_cents = 0)),
  policy_version text not null check (policy_version = 'commission-first-v1'),
  operation_key uuid not null unique,
  allocated_by uuid not null references public.profiles(id),
  allocated_at timestamptz not null default now(),
  foreign key (fee_evidence_id, payment_attempt_id)
    references public.commission_first_provider_fee_evidence(id, payment_attempt_id),
  check (customer_payment_cents = ride_fare_cents + driver_booking_cents + platform_booking_cents),
  check (gross_cents = ride_fare_cents + driver_booking_cents - percentage_deduction_cents - fixed_deduction_cents),
  check (recovered_cents = least(gross_cents, debt_before_cents)),
  check (net_cents = gross_cents - recovered_cents),
  check (debt_remaining_cents = debt_before_cents - recovered_cents)
);
create index commission_first_payouts_driver_time_idx
  on public.commission_first_payout_allocations (driver_id, allocated_at desc, id);

create table public.commission_first_manual_payments (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null references public.commission_first_payout_allocations(id),
  operation_key uuid not null unique,
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null,
  bank_reference text not null unique check (bank_reference = upper(btrim(bank_reference)) and length(bank_reference) between 1 and 200),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 1 and 500),
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now()
);
create index commission_first_manual_allocation_idx on public.commission_first_manual_payments (allocation_id);

create table public.commission_first_manual_verifications (
  payment_id uuid primary key references public.commission_first_manual_payments(id),
  operation_key uuid not null unique,
  independent_evidence_reference text not null unique check (
    independent_evidence_reference = btrim(independent_evidence_reference)
    and length(independent_evidence_reference) between 1 and 500),
  verified_by uuid not null references public.profiles(id),
  verified_at timestamptz not null default now()
);

alter table public.commission_first_provider_fee_evidence enable row level security;
alter table public.commission_first_provider_fee_reviews enable row level security;
alter table public.commission_first_payout_allocations enable row level security;
alter table public.commission_first_manual_payments enable row level security;
alter table public.commission_first_manual_verifications enable row level security;

revoke all on public.commission_first_provider_fee_evidence, public.commission_first_provider_fee_reviews,
  public.commission_first_payout_allocations, public.commission_first_manual_payments,
  public.commission_first_manual_verifications from public, anon, authenticated, service_role;
grant select on public.commission_first_provider_fee_evidence, public.commission_first_provider_fee_reviews,
  public.commission_first_payout_allocations, public.commission_first_manual_payments,
  public.commission_first_manual_verifications to service_role;

create function public.commission_first_record_provider_fee(
  p_actor uuid, p_payment uuid, p_external text, p_evidence text,
  p_percentage bigint, p_fixed bigint, p_total bigint
) returns uuid language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  attempt public.online_payment_attempts%rowtype;
  existing public.commission_first_provider_fee_evidence%rowtype;
  result uuid;
begin
  if auth.role() is distinct from 'service_role'
     or (auth.uid() is not null and auth.uid() is distinct from p_actor)
     or not exists(select 1 from public.profiles where id = p_actor and role in ('owner', 'admin')) then
    raise exception 'Financial role required' using errcode = '42501';
  end if;
  select * into strict attempt from public.online_payment_attempts where id = p_payment for update;
  if attempt.provider is distinct from 'YOCO' or attempt.state is distinct from 'SUCCEEDED'
     or attempt.currency is distinct from 'ZAR' or attempt.verified_at is null
     or attempt.provider_payment_id is null or attempt.payment_ledger_transaction_id is null
     or not exists (
       select 1 from public.financial_transactions ft
       where ft.id = attempt.payment_ledger_transaction_id and ft.transaction_type = 'ONLINE_PAYMENT'
         and ft.transaction_state = 'POSTED' and ft.source_type = 'TRIP' and ft.source_id = attempt.trip_id
     )
     or not exists (
       select 1 from public.online_provider_events e
       where e.payment_attempt_id = p_payment and e.provider = 'YOCO' and e.trust_state = 'VERIFIED'
         and e.processing_state = 'PROCESSED' and e.raw_provider_status = 'succeeded'
     )
     or p_total > attempt.amount_cents then
    raise exception 'Payment or fee evidence is ineligible' using errcode = '22023';
  end if;
  select * into existing from public.commission_first_provider_fee_evidence where payment_attempt_id = p_payment;
  if found then
    if row(existing.external_reference, existing.evidence_reference, existing.percentage_cents,
           existing.fixed_cents, existing.total_cents, existing.recorded_by)
       is distinct from row(btrim(p_external), btrim(p_evidence), p_percentage, p_fixed, p_total, p_actor) then
      raise exception 'Conflicting evidence already recorded for payment' using errcode = '23505';
    end if;
    return existing.id;
  end if;
  insert into public.commission_first_provider_fee_evidence(payment_attempt_id, external_reference, evidence_reference,
    percentage_cents, fixed_cents, total_cents, currency, recorded_by)
  values (p_payment, btrim(p_external), btrim(p_evidence), p_percentage, p_fixed, p_total, 'ZAR', p_actor)
  returning id into result;
  return result;
end $$;

create function public.commission_first_review_provider_fee(
  p_actor uuid, p_evidence uuid, p_external text, p_percentage bigint, p_fixed bigint, p_total bigint
) returns uuid language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  evidence public.commission_first_provider_fee_evidence%rowtype;
  reviewer uuid;
begin
  if auth.role() is distinct from 'service_role'
     or (auth.uid() is not null and auth.uid() is distinct from p_actor)
     or not exists(select 1 from public.profiles where id = p_actor and role in ('owner', 'admin')) then
    raise exception 'Financial role required' using errcode = '42501';
  end if;
  select * into strict evidence from public.commission_first_provider_fee_evidence where id = p_evidence for update;
  if evidence.recorded_by = p_actor then raise exception 'Independent reviewer required' using errcode = '42501'; end if;
  if row(evidence.external_reference, evidence.percentage_cents, evidence.fixed_cents, evidence.total_cents)
     is distinct from row(btrim(p_external), p_percentage, p_fixed, p_total) then
    raise exception 'Independent statement components do not reconcile' using errcode = '22023';
  end if;
  select verified_by into reviewer from public.commission_first_provider_fee_reviews where evidence_id = p_evidence;
  if found then
    if reviewer <> p_actor then raise exception 'Evidence already reviewed' using errcode = '23505'; end if;
    return p_evidence;
  end if;
  insert into public.commission_first_provider_fee_reviews(evidence_id, verified_by) values (p_evidence, p_actor);
  return p_evidence;
end $$;

create function public.commission_first_record_manual_payment(
  p_actor uuid, p_allocation uuid, p_operation uuid, p_cents bigint, p_paid_on date,
  p_bank_reference text, p_evidence_reference text
) returns uuid language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  allocation public.commission_first_payout_allocations%rowtype;
  existing public.commission_first_manual_payments%rowtype;
  recorded numeric;
  result uuid;
  bank_ref text := upper(btrim(p_bank_reference));
  evidence_ref text := btrim(p_evidence_reference);
begin
  if auth.role() is distinct from 'service_role'
     or (auth.uid() is not null and auth.uid() is distinct from p_actor)
     or not exists(select 1 from public.profiles where id = p_actor and role in ('owner', 'admin')) then
    raise exception 'Financial role required' using errcode = '42501';
  end if;
  if p_operation is null or coalesce(p_cents, 0) <= 0 or p_paid_on is null
     or p_paid_on > (now() at time zone 'Africa/Johannesburg')::date
     or coalesce(length(bank_ref), 0) not between 1 and 200
     or coalesce(length(evidence_ref), 0) not between 1 and 500 then
    raise exception 'Invalid manual payment evidence' using errcode = '22023';
  end if;
  select * into strict allocation from public.commission_first_payout_allocations
    where id = p_allocation for update;
  select * into existing from public.commission_first_manual_payments where operation_key = p_operation;
  if found then
    if row(existing.allocation_id, existing.amount_cents, existing.paid_on, existing.bank_reference,
           existing.evidence_reference, existing.recorded_by)
       is distinct from row(p_allocation, p_cents, p_paid_on, bank_ref, evidence_ref, p_actor) then
      raise exception 'Manual payment operation key conflicts with recorded data' using errcode = '23505';
    end if;
    return existing.id;
  end if;
  if p_paid_on < (allocation.allocated_at at time zone 'Africa/Johannesburg')::date then
    raise exception 'Payment date precedes allocation' using errcode = '22023';
  end if;
  select coalesce(sum(amount_cents), 0) into recorded
    from public.commission_first_manual_payments where allocation_id = p_allocation;
  if p_cents > allocation.net_cents - recorded then
    raise exception 'Payment exceeds outstanding recorded balance' using errcode = '22023';
  end if;
  insert into public.commission_first_manual_payments(
    allocation_id, operation_key, amount_cents, paid_on, bank_reference, evidence_reference, recorded_by
  ) values (p_allocation, p_operation, p_cents, p_paid_on, bank_ref, evidence_ref, p_actor)
  returning id into result;
  return result;
end $$;

create function public.commission_first_verify_manual_payment(
  p_actor uuid, p_payment uuid, p_operation uuid, p_cents bigint, p_paid_on date,
  p_bank_reference text, p_independent_evidence text
) returns uuid language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  payment public.commission_first_manual_payments%rowtype;
  existing public.commission_first_manual_verifications%rowtype;
  evidence_ref text := btrim(p_independent_evidence);
begin
  if auth.role() is distinct from 'service_role'
     or (auth.uid() is not null and auth.uid() is distinct from p_actor)
     or not exists(select 1 from public.profiles where id = p_actor and role in ('owner', 'admin')) then
    raise exception 'Financial role required' using errcode = '42501';
  end if;
  select * into strict payment from public.commission_first_manual_payments where id = p_payment for update;
  if payment.recorded_by = p_actor then
    raise exception 'Independent reviewer required' using errcode = '42501';
  end if;
  if p_operation is null or coalesce(length(evidence_ref), 0) not between 1 and 500
     or evidence_ref = payment.evidence_reference
     or row(payment.amount_cents, payment.paid_on, payment.bank_reference)
        is distinct from row(p_cents, p_paid_on, upper(btrim(p_bank_reference))) then
    raise exception 'Independent evidence does not reconcile' using errcode = '22023';
  end if;
  select * into existing from public.commission_first_manual_verifications where payment_id = p_payment;
  if found then
    if row(existing.operation_key, existing.verified_by, existing.independent_evidence_reference)
       is distinct from row(p_operation, p_actor, evidence_ref) then
      raise exception 'Payment already has a different verification' using errcode = '23505';
    end if;
    return p_payment;
  end if;
  insert into public.commission_first_manual_verifications(payment_id, operation_key, independent_evidence_reference, verified_by)
    values (p_payment, p_operation, evidence_ref, p_actor);
  return p_payment;
end $$;

revoke all on function public.commission_first_record_manual_payment(uuid,uuid,uuid,bigint,date,text,text),
  public.commission_first_verify_manual_payment(uuid,uuid,uuid,bigint,date,text,text),
  public.commission_first_record_provider_fee(uuid,uuid,text,text,bigint,bigint,bigint),
  public.commission_first_review_provider_fee(uuid,uuid,text,bigint,bigint,bigint) from public, anon, authenticated;
grant execute on function public.commission_first_record_manual_payment(uuid,uuid,uuid,bigint,date,text,text),
  public.commission_first_verify_manual_payment(uuid,uuid,uuid,bigint,date,text,text),
  public.commission_first_record_provider_fee(uuid,uuid,text,text,bigint,bigint,bigint),
  public.commission_first_review_provider_fee(uuid,uuid,text,bigint,bigint,bigint) to service_role;
create or replace function public.phase05b_driver_debt(p_driver_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_commission numeric(14,2); v_net numeric(14,2); v_trips bigint;
        v_settled numeric(14,2); v_credits numeric(14,2); v_unapplied numeric(14,2); v_due numeric(14,2); v_recovered numeric(14,2);
begin
  select coalesce(sum(commission_amount),0),
         coalesce(sum(coalesce(driver_net_earnings, fare_amount - coalesce(commission_amount,0))),0), count(*)
    into v_commission,v_net,v_trips from public.trips
    where driver_id=p_driver_id and status='completed';
  select coalesce(sum(amount_paid),0) into v_settled from public.driver_settlements where driver_id=p_driver_id;
  select coalesce(sum(amount),0) into v_credits from public.driver_wallet_transactions
    where driver_id=p_driver_id and tx_type='cancellation_credit' and direction='credit';
  select coalesce(sum(unapplied_excess),0) into v_unapplied from public.driver_payment_requests
    where driver_id=p_driver_id and status='approved';
  select coalesce(sum(recovered_cents),0)/100 into v_recovered
    from public.commission_first_payout_allocations where driver_id=p_driver_id;
  v_due := greatest(0, round(v_commission-v_settled-v_credits-v_recovered,2));
  return jsonb_build_object('contract_version',public.phase05b_contract_version(),
    'driver_id',p_driver_id,'total_commission',round(v_commission,2),
    'total_driver_net',round(v_net+v_credits,2),'total_trips_completed',v_trips,
    'total_settled',round(v_settled,2),'internal_recovery',v_recovered,'cancellation_credits',round(v_credits,2),
    'unapplied_credit',round(v_unapplied,2),'balance_due',v_due);
end $$;

-- The original payable keeps its identity and immutable historical amounts.
-- Consumers of current obligations use this projection, never add both amounts.
create view public.commission_first_effective_payables with (security_invoker = true) as
select p.id as payable_id, p.trip_id, p.driver_id, p.payment_attempt_id,
       p.state, a.id as allocation_id, p.payable_cents as original_payable_cents,
       coalesce(a.net_cents, p.payable_cents) as effective_payable_cents
from public.online_driver_payables p
left join public.commission_first_payout_allocations a on a.payable_id = p.id;
revoke all on public.commission_first_effective_payables from public, anon, authenticated, service_role;
grant select on public.commission_first_effective_payables to service_role;


create or replace function public.phase3_post_completed_online_driver_payable(p_trip_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_trip public.trips;
  v_attempt public.online_payment_attempts;
  v_existing public.online_driver_payables;
  v_fare_cents bigint;
  v_commission_cents bigint;
  v_driver_net_cents bigint;
  v_funds public.financial_accounts;
  v_driver_payable public.financial_accounts;
  v_revenue public.financial_accounts;
  v_post jsonb;
  v_entries jsonb;
  v_hash text;
  v_policy_trip boolean;
  v_driver_basis bigint;
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

  select exists(select 1 from public.commission_first_policy
    where version='commission-first-v1' and v_trip.completed_at >= eligible_from) into v_policy_trip;
  if v_policy_trip then
    perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||v_trip.driver_id::text,0));
  end if;

  select * into v_attempt from public.online_payment_attempts
  where trip_id=p_trip_id and state='SUCCEEDED' and verified_at is not null
    and payment_ledger_transaction_id is not null and currency='ZAR'
  order by created_at desc limit 1 for update;
  if not found then raise exception 'Verified online payment is required'; end if;
  if v_policy_trip and (
    exists(select 1 from public.online_payment_attempts other
      where other.trip_id=v_trip.id and other.id<>v_attempt.id and other.verified_at is not null)
    or exists(select 1 from public.online_payment_refunds r where r.payment_attempt_id=v_attempt.id)
    or (select sum(le.amount_cents) from public.financial_ledger_entries le
        join public.financial_accounts a on a.id=le.account_id
        where le.transaction_id=v_attempt.payment_ledger_transaction_id and le.entry_side='CREDIT'
          and a.account_code='PLATFORM:CUSTOMER_FUNDS_LIABILITY:ZAR' and a.currency='ZAR')
       is distinct from v_attempt.amount_cents
  ) then raise exception 'Online payable requires financial review'; end if;


  v_fare_cents:=round(coalesce(v_trip.final_fare,v_trip.fare_amount)*100)::bigint;
  v_commission_cents:=round(v_trip.commission_amount*100)::bigint;
  v_driver_net_cents:=round(v_trip.driver_net_earnings*100)::bigint;
  v_driver_basis := case when v_policy_trip then v_trip.phase5_ride_fare_cents else v_fare_cents end;
  if v_policy_trip and (v_driver_basis is null or v_driver_basis <= 0
    or v_trip.phase5_customer_total_cents is distinct from v_fare_cents
    or not exists(select 1 from public.online_provider_events e
       where e.payment_attempt_id=v_attempt.id and e.provider='YOCO' and e.trust_state='VERIFIED'
         and e.processing_state='PROCESSED' and e.raw_provider_status='succeeded'))
  then raise exception 'Online payable requires financial review'; end if;
  if v_fare_cents is null or v_fare_cents<=0 or v_attempt.amount_cents<>v_fare_cents
    or not exists(select 1 from public.financial_transactions ft
      where ft.id=v_attempt.payment_ledger_transaction_id and ft.transaction_type='ONLINE_PAYMENT'
        and ft.transaction_state='POSTED' and ft.source_type='TRIP' and ft.source_id=p_trip_id)
    or v_commission_cents is null or v_commission_cents<0 or v_commission_cents>=v_fare_cents
    or v_driver_net_cents is null or v_driver_net_cents<>v_driver_basis-v_commission_cents
    or (v_policy_trip and v_commission_cents >= v_driver_basis)
    or (not exists(select 1 from public.driver_wallet_transactions
      where trip_id=p_trip_id and driver_id=v_trip.driver_id and tx_type='commission'
        and direction='debit' and round(amount*100)::bigint=v_commission_cents)
      and not (v_policy_trip and exists(select 1 from public.financial_transactions ft
        join public.financial_ledger_entries le on le.transaction_id=ft.id
        join public.financial_accounts a on a.id=le.account_id
        where ft.idempotency_key='trip_commission:'||v_trip.id::text and ft.transaction_state='POSTED'
          and a.owner_id=v_trip.driver_id and a.account_category='DRIVER_COMMISSION_DEBT'
          and le.entry_side='DEBIT' and le.amount_cents=v_commission_cents)))
  then raise exception 'Online fare or authoritative legacy commission requires reconciliation'; end if;

  select * into v_existing from public.online_driver_payables where trip_id=p_trip_id for update;
  if found then
    if v_existing.payment_attempt_id<>v_attempt.id or v_existing.driver_id<>v_trip.driver_id
      or v_existing.fare_cents<>v_fare_cents or v_existing.commission_cents<>v_commission_cents
      or v_existing.idempotency_key<>'online_driver_payable:'||p_trip_id::text
    then raise exception 'Conflicting online Driver payable replay'; end if;
  end if;

  if v_policy_trip and v_existing.id is not null then
    if v_existing.ledger_transaction_id is null then raise exception 'Existing payable requires financial review'; end if;
    return jsonb_build_object('result','REPLAYED','payable_id',v_existing.id,
      'payable_cents',v_existing.payable_cents,'ledger_transaction_id',v_existing.ledger_transaction_id);
  end if;
  if v_policy_trip then
    -- The recognised commission already belongs to completion. Keep the opening
    -- payable formula and put the residual in the existing adjustment control.
    v_driver_net_cents := v_fare_cents - v_commission_cents;
  end if;

  -- Service completion releases customer funds and recognizes only the
  -- current legacy-authoritative Driver net and MOOVU commission. Provider
  -- settlement and fee are unknown, so PAYMENT_CLEARING is not closed here.
  v_funds:=public.phase1_ensure_financial_account(
    'PLATFORM:CUSTOMER_FUNDS_LIABILITY:ZAR','UNAPPLIED_FUNDS','PLATFORM',null,'CREDIT','ZAR');
  v_driver_payable:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts
      where owner_type='DRIVER' and owner_id=v_trip.driver_id
        and account_category='DRIVER_EARNINGS_PAYABLE' and currency='ZAR'),
      'DRIVER:'||upper(v_trip.driver_id::text)||':EARNINGS_PAYABLE:ZAR'),
    'DRIVER_EARNINGS_PAYABLE','DRIVER',v_trip.driver_id,'CREDIT','ZAR');
  if v_policy_trip then
    v_revenue:=public.phase1_ensure_financial_account(
      coalesce((select account_code from public.financial_accounts
        where owner_type='PLATFORM' and owner_id is null and account_category='ADJUSTMENT_CLEARING' and currency='ZAR'),
        'PLATFORM:ADJUSTMENT_CLEARING:ZAR'),'ADJUSTMENT_CLEARING','PLATFORM',null,'CREDIT','ZAR');
  else
  v_revenue:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts
      where owner_type='PLATFORM' and owner_id is null
        and account_category='COMMISSION_REVENUE' and currency='ZAR'),
      'PLATFORM:COMMISSION_REVENUE:ZAR'),
    'COMMISSION_REVENUE','PLATFORM',null,'CREDIT','ZAR');
  end if;
  v_entries:=jsonb_build_array(
    jsonb_build_object('account_id',v_funds.id,'entry_side','DEBIT','amount_cents',v_fare_cents),
    jsonb_build_object('account_id',v_driver_payable.id,'entry_side','CREDIT','amount_cents',v_driver_net_cents));
  if v_commission_cents > 0 or not v_policy_trip then
    v_entries:=v_entries||jsonb_build_array(
      jsonb_build_object('account_id',v_revenue.id,'entry_side','CREDIT','amount_cents',v_commission_cents));
  end if;
  v_hash:=encode(extensions.digest(v_trip.id::text||':'||v_attempt.id::text||':'||
    v_fare_cents::text||':'||v_commission_cents::text||':'||v_driver_net_cents::text,'sha256'),'hex');
  v_post:=public.phase1_post_financial_transaction(
    'online_service_completion:'||v_trip.id::text,v_hash,
    'ADJUSTMENT','ADJUSTMENT',v_attempt.id,'ZAR','SYSTEM',null,v_trip.completed_at,
    v_entries,jsonb_build_object('kind','ONLINE_SERVICE_COMPLETION_RECLASS',
      'trip_id',v_trip.id,'payment_attempt_id',v_attempt.id,
      'economic_basis',case when v_policy_trip then 'COMMISSION_FIRST_OPENING' else 'LEGACY_AUTHORITATIVE' end),null);

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


create function public.commission_first_allocate(p_actor uuid, p_trip uuid, p_operation uuid)
returns public.commission_first_payout_allocations
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  t public.trips%rowtype;
  p public.online_driver_payables%rowtype;
  payment public.online_payment_attempts%rowtype;
  fee public.commission_first_provider_fee_evidence%rowtype;
  allocation public.commission_first_payout_allocations%rowtype;
  activated timestamptz;
  payable_account uuid;
  receivable_account uuid;
  receivable_category text;
  phase2_authoritative boolean;
  clearing_account uuid;
  debt bigint;
  gross bigint;
  recovery bigint;
  delta bigint;
  net bigint;
  half_fee bigint;
  entries jsonb := '[]';
  posted uuid;
begin
  if auth.role() is distinct from 'service_role'
     or (auth.uid() is not null and auth.uid() is distinct from p_actor)
     or not exists(select 1 from public.profiles where id = p_actor and role in ('owner','admin')) then
    raise exception 'Financial role required' using errcode = '42501';
  end if;
  if p_operation is null then raise exception 'Operation identity required'; end if;
  -- Match completion and cancellation: trip row, driver advisory lock, then financial rows.
  select * into strict t from public.trips where id = p_trip for update;
  if t.driver_id is null then raise exception 'Driver unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended('driver-finance:' || t.driver_id::text, 0));
  if exists(select 1 from public.commission_first_payout_allocations
            where operation_key = p_operation and trip_id <> t.id) then
    raise exception 'Operation belongs to another trip' using errcode = '23505';
  end if;
  select * into allocation from public.commission_first_payout_allocations where trip_id = t.id;
  if found then return allocation; end if;

  select eligible_from into activated from public.commission_first_policy where version = 'commission-first-v1';
  if activated is null or t.status is distinct from 'completed' or t.payment_method is distinct from 'online'
     or t.completed_at is null or t.completed_at < activated or t.completed_at > clock_timestamp() then
    raise exception 'Trip outside active payout policy';
  end if;
  if exists (
    select 1 from public.trips earlier
    where earlier.driver_id = t.driver_id and earlier.status = 'completed' and earlier.payment_method = 'online'
      and earlier.completed_at >= activated and (earlier.completed_at, earlier.id) < (t.completed_at, t.id)
      and not exists(select 1 from public.commission_first_payout_allocations a where a.trip_id = earlier.id)
  ) then raise exception 'Earlier online trip requires allocation or reconciliation'; end if;

  -- Phase 3 already owns the original payable. Fail closed if it cannot be reconciled.
  select * into p from public.online_driver_payables where trip_id = t.id;
  if not found then
    perform public.phase3_post_completed_online_driver_payable(t.id);
    select * into p from public.online_driver_payables where trip_id = t.id;
    if not found then raise exception 'Online payable requires financial review'; end if;
  end if;
  select * into strict payment from public.online_payment_attempts where id = p.payment_attempt_id for update;
  select * into strict p from public.online_driver_payables where trip_id = t.id for update;
  if p.state <> 'EARNED' or p.driver_id <> t.driver_id or p.payment_attempt_id <> payment.id
     or p.earned_at <> t.completed_at or p.idempotency_key <> 'online_driver_payable:' || t.id::text
     or payment.trip_id is distinct from t.id or payment.provider <> 'YOCO' or payment.state <> 'SUCCEEDED'
     or payment.currency <> 'ZAR' or payment.verified_at is null or payment.provider_payment_id is null
     or payment.amount_cents <> p.fare_cents
     or not exists(select 1 from public.financial_transactions f where f.id = payment.payment_ledger_transaction_id
        and f.transaction_state = 'POSTED' and f.transaction_type = 'ONLINE_PAYMENT'
        and f.source_type = 'TRIP' and f.source_id = t.id)
     or not exists(select 1 from public.online_provider_events e where e.payment_attempt_id = payment.id
        and e.provider = 'YOCO' and e.trust_state = 'VERIFIED' and e.processing_state = 'PROCESSED'
        and e.raw_provider_status = 'succeeded')
     or exists(select 1 from public.online_payment_refunds r where r.payment_attempt_id = payment.id)
     or not exists(select 1 from public.moovu_business_events e
        where e.event_key = 'trip-complete:' || t.id::text and e.event_type = 'trip_completed')
     or round(t.commission_amount * 100)::bigint is distinct from p.commission_cents
     or (
       not exists(select 1 from public.driver_wallet_transactions w where w.trip_id = t.id and w.driver_id = t.driver_id
         and w.tx_type = 'commission' and w.direction = 'debit' and round(w.amount * 100)::bigint = p.commission_cents)
       and not exists(select 1 from public.financial_transactions f
         join public.financial_ledger_entries l on l.transaction_id = f.id
         join public.financial_accounts a on a.id = l.account_id
         where f.idempotency_key = 'trip_commission:' || t.id::text and f.transaction_state = 'POSTED'
           and a.owner_id = t.driver_id and a.account_category = 'DRIVER_COMMISSION_DEBT'
           and l.entry_side = 'DEBIT' and l.amount_cents = p.commission_cents)
     )
  then raise exception 'Existing payable requires financial reconciliation'; end if;

  select l.account_id into strict payable_account
    from public.financial_transactions f
    join public.financial_ledger_entries l on l.transaction_id = f.id
    join public.financial_accounts a on a.id = l.account_id
    where f.id = p.ledger_transaction_id and f.transaction_state = 'POSTED'
      and f.idempotency_key = 'online_service_completion:' || t.id::text
      and f.transaction_type = 'ADJUSTMENT' and f.source_type = 'ADJUSTMENT' and f.source_id = payment.id
      and a.owner_type = 'DRIVER' and a.owner_id = t.driver_id and a.account_category = 'DRIVER_EARNINGS_PAYABLE'
      and l.entry_side = 'CREDIT' and l.amount_cents = p.payable_cents;

  if exists(
    select 1 from public.financial_transactions f
    join public.financial_ledger_entries l on l.transaction_id = f.id
    where f.id <> p.ledger_transaction_id and f.transaction_state in ('POSTED','REVERSED')
      and l.account_id = payable_account
      and (f.economic_trip_id = t.id or f.source_id in (p.id, t.id, payment.id)
        or f.metadata->>'trip_id' = t.id::text or f.reversal_of_transaction_id = p.ledger_transaction_id)
  ) then raise exception 'Other payable ledger activity requires reconciliation'; end if;

  select e.* into strict fee from public.commission_first_provider_fee_evidence e
    join public.commission_first_provider_fee_reviews r on r.evidence_id = e.id
    where e.payment_attempt_id = payment.id and r.verified_by <> e.recorded_by;
  if fee.fixed_cents <> 200 or fee.total_cents > payment.amount_cents
     or t.phase5_ride_fare_cents is null or t.phase5_ride_fare_cents <= 0
     or (case t.ride_option when 'go' then 300 when 'group' then 500 end)
         is distinct from t.phase5_service_fee_cents
     or t.phase5_service_fee_cents is null
     or t.phase5_customer_total_cents is distinct from payment.amount_cents
     or t.phase5_ride_fare_cents + t.phase5_service_fee_cents <> payment.amount_cents then
    raise exception 'Fee evidence or historical fare requires financial review';
  end if;
  half_fee := fee.percentage_cents / 2 + fee.percentage_cents % 2;
  gross := t.phase5_ride_fare_cents + 100 - half_fee - 200;
  if gross < 0 then raise exception 'Insufficient fee coverage'; end if;
  debt := (public.phase05b_driver_debt(t.driver_id)->>'balance_due')::numeric * 100;
  if debt is null or debt < 0 then raise exception 'Authoritative commission unavailable'; end if;
  select mode = 'AUTHORITATIVE' and coalesce(authoritative_effective_from <= now(), false)
    into strict phase2_authoritative from public.phase2_finance_policy
    where policy_key = 'phase2-driver-finance' for share;
  if phase2_authoritative and
    (public.phase2_driver_finance_position(t.driver_id)->>'net_owed_cents')::bigint is distinct from debt
  then raise exception 'Commission authorities disagree'; end if;
  recovery := least(gross, debt);
  net := gross - recovery;
  delta := gross - p.payable_cents;

  -- First rebase the original payable to policy gross through correction
  -- clearing, then offset commission against the driver's existing receivable.
  if delta <> 0 then
    select id into strict clearing_account from public.financial_accounts
      where owner_type = 'PLATFORM' and owner_id is null and account_category = 'ADJUSTMENT_CLEARING' and currency = 'ZAR';
    entries := entries || jsonb_build_array(
      jsonb_build_object('account_id', payable_account,'entry_side',case when delta > 0 then 'CREDIT' else 'DEBIT' end,'amount_cents',abs(delta)),
      jsonb_build_object('account_id', clearing_account,'entry_side',case when delta > 0 then 'DEBIT' else 'CREDIT' end,'amount_cents',abs(delta)));
  end if;
  if recovery > 0 then
    receivable_category := case when phase2_authoritative then 'DRIVER_COMMISSION_DEBT' else 'COMMISSION_RECEIVABLE' end;
    select id into strict receivable_account from public.financial_accounts
      where owner_type = 'DRIVER' and owner_id = t.driver_id and account_category = receivable_category and currency = 'ZAR';
    if not phase2_authoritative and (
      select coalesce(sum(case l.entry_side when 'DEBIT' then l.amount_cents else -l.amount_cents end), 0)
      from public.financial_ledger_entries l join public.financial_transactions f on f.id = l.transaction_id
      where l.account_id = receivable_account and f.transaction_state = 'POSTED'
    ) is distinct from debt then raise exception 'Legacy commission receivable requires reconciliation'; end if;
    entries := entries || jsonb_build_array(
      jsonb_build_object('account_id', payable_account,'entry_side','DEBIT','amount_cents',recovery),
      jsonb_build_object('account_id', receivable_account,'entry_side','CREDIT','amount_cents',recovery));
  end if;
  if jsonb_array_length(entries) > 0 then
    posted := (public.phase1_post_financial_transaction(
      'commission-first-v1:' || t.id::text,
      encode(extensions.digest(concat_ws(':', p.id, fee.id, gross, debt, recovery), 'sha256'), 'hex'),
      'ADJUSTMENT','ADJUSTMENT',p.id,'ZAR','ADMIN',p_actor,clock_timestamp(),entries,
      jsonb_build_object('kind','COMMISSION_FIRST_PAYOUT','trip_id',t.id,'original_payable_id',p.id,
        'gross_adjustment_cents',delta,'recovered_cents',recovery,'net_cents',net),null)->>'transaction_id')::uuid;
    if posted is null or (
      select sum(case when l.entry_side = 'CREDIT' then l.amount_cents else -l.amount_cents end)
      from public.financial_ledger_entries l join public.financial_transactions f on f.id = l.transaction_id
      where l.transaction_id = posted and l.account_id = payable_account and f.transaction_state = 'POSTED'
    ) is distinct from net - p.payable_cents or (recovery > 0 and (
      select sum(l.amount_cents) from public.financial_ledger_entries l
      where l.transaction_id = posted and l.account_id = receivable_account and l.entry_side = 'CREDIT'
    ) is distinct from recovery) then raise exception 'Payable posting invariant failed'; end if;
  end if;

  insert into public.commission_first_payout_allocations(
    trip_id, driver_id, payment_attempt_id, payable_id, original_payable_cents, fee_evidence_id, completed_at,
    customer_payment_cents, ride_fare_cents, driver_booking_cents, platform_booking_cents,
    percentage_deduction_cents, fixed_deduction_cents, gross_cents, debt_before_cents, recovered_cents,
    net_cents, debt_remaining_cents, ledger_transaction_id, policy_version, operation_key, allocated_by
  ) values (
    t.id,t.driver_id,payment.id,p.id,p.payable_cents,fee.id,t.completed_at,payment.amount_cents,
    t.phase5_ride_fare_cents,100,t.phase5_service_fee_cents-100,half_fee,200,gross,debt,recovery,
    net,debt-recovery,posted,'commission-first-v1',p_operation,p_actor
  ) returning * into allocation;
  if (public.phase05b_driver_debt(t.driver_id)->>'balance_due')::numeric * 100 is distinct from debt - recovery then
    raise exception 'Commission debt invariant failed';
  end if;
  if phase2_authoritative and
    (public.phase2_driver_finance_position(t.driver_id)->>'net_owed_cents')::bigint is distinct from debt - recovery
  then raise exception 'Phase 2 commission debt invariant failed'; end if;
  return allocation;
end $$;
revoke all on function public.commission_first_allocate(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.commission_first_allocate(uuid,uuid,uuid) to service_role;
commit;
