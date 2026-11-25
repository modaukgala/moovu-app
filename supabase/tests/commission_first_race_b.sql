\set ON_ERROR_STOP on
begin;
set local statement_timeout='35s';
select set_config('request.jwt.claim.role','service_role',true);
select set_config('fin04.test.actor', :'actor_id', false);
select set_config('fin04.test.customer_actor', :'customer_actor', false);
select set_config('fin04.test.customer', :'customer_id', false);
select set_config('fin04.test.trip', :'trip_id', false);
select set_config('fin04.test.driver', :'driver_id', false);
select set_config('fin04.test.competitor', :'competitor_id', false);
select set_config('fin04.test.competitor_driver', :'competitor_driver', false);
select set_config('fin04.test.scenario', :'scenario', false);
select set_config('fin04.test.commission_pct', :'commission_pct', false);

create function pg_temp.fin04_compete() returns void language plpgsql as $$
declare actor uuid := current_setting('fin04.test.actor')::uuid;
        driver uuid := current_setting('fin04.test.driver')::uuid;
        contender uuid := current_setting('fin04.test.competitor')::uuid;
begin
  case current_setting('fin04.test.scenario')
  when 'same-driver', 'different-driver' then
    perform public.commission_first_allocate(actor,contender,gen_random_uuid());
  when 'combined' then
    perform public.phase05b_review_driver_payment(contender,'approve','FIN04 race',actor);
  when 'accrual' then
    perform public.phase05b_complete_trip(contender,actor,driver,'admin',null,null,'FIN04 synthetic',
      (select financial_version from public.trips where id=contender),100,'FIN04 synthetic distance');
  when 'cancellation' then
    perform public.phase05b_cancel_trip(contender,current_setting('fin04.test.customer')::uuid,
      current_setting('fin04.test.customer_actor')::uuid,'Other','FIN04 synthetic');
  end case;
end $$;

set local lock_timeout='2s';
do $$
begin
  if current_setting('fin04.test.scenario')='different-driver' then
    perform pg_temp.fin04_compete();
    if exists(select 1 from public.commission_first_payout_allocations where trip_id=current_setting('fin04.test.trip')::uuid) then
      raise exception 'Allocation A committed before independent B completed';
    end if;
  else
    begin
      perform pg_temp.fin04_compete();
      raise exception 'Expected overlapping transaction to block on A';
    exception when lock_not_available then null;
    end;
  end if;
end $$;
set local lock_timeout='30s';
do $$
declare scenario text := current_setting('fin04.test.scenario');
begin
  if scenario <> 'different-driver' then
    perform pg_temp.fin04_compete();
    perform pg_temp.fin04_compete();
  end if;
end $$;
commit;
\if :independent
-- Wait on A's transaction before checking its committed snapshot.
begin;
select id from public.trips where id=:'trip_id' for update;
commit;
\endif
select set_config('request.jwt.claim.role','service_role',false);
do $$
declare
  scenario text := current_setting('fin04.test.scenario');
  contender uuid := current_setting('fin04.test.competitor')::uuid;
  a public.commission_first_payout_allocations;
  b public.commission_first_payout_allocations;
  expected_recovery bigint := case when scenario='same-driver' then 1380 else 690 end;
  expected_debt bigint := case when scenario='accrual' then current_setting('fin04.test.commission_pct')::numeric*100 else 0 end;
  r public.driver_payment_requests;
begin
  select * into strict a from public.commission_first_payout_allocations where trip_id=current_setting('fin04.test.trip')::uuid;
  if a.recovered_cents <> expected_recovery or a.debt_before_cents <> expected_recovery
    or a.net_cents <> 4414-expected_recovery or a.debt_remaining_cents <> 0
    or (public.phase05b_driver_debt(a.driver_id)->>'balance_due')::numeric*100 <> expected_debt
  then raise exception 'Unexpected allocation A or final debt'; end if;
  if scenario in ('same-driver','different-driver') then
    select * into strict b from public.commission_first_payout_allocations where trip_id=contender;
    if b.driver_id <> current_setting('fin04.test.competitor_driver')::uuid
      or b.recovered_cents <> case when scenario='same-driver' then 0 else 690 end
      or b.net_cents <> 4414-b.recovered_cents
      or (public.phase05b_driver_debt(b.driver_id)->>'balance_due')::numeric <> 0 then
      raise exception 'Unexpected allocation B or cross-driver recovery';
    end if;
  elsif scenario='combined' then
    select * into strict r from public.driver_payment_requests where id=contender;
    if row(r.status,r.subscription_amount_applied,r.commission_amount_applied,r.unapplied_excess)
      is distinct from row('approved',45,0,10)
      or (select count(*) from public.driver_subscription_payments where payment_request_id=contender and amount_paid=45) <> 1
      or exists(select 1 from public.driver_settlements where payment_request_id=contender)
    then raise exception 'Combined proof applied incorrect settlement'; end if;
  elsif scenario='accrual' then
    if (select commission_amount from public.trips where id=contender) is distinct from expected_debt::numeric/100
      or (select count(*) from public.driver_wallet_transactions where trip_id=contender and tx_type='commission') <> 1
    then raise exception 'Accrual amount or uniqueness mismatch'; end if;
  elsif scenario='cancellation' then
    if (select count(*) from public.driver_wallet_transactions where trip_id=contender and tx_type='cancellation_credit' and amount=13) <> 1
    then raise exception 'Cancellation credit amount or uniqueness mismatch'; end if;
  end if;
  if exists(
    select 1 from public.commission_first_payout_allocations p
    left join public.commission_first_effective_payables e on e.allocation_id=p.id
    left join public.financial_transactions j on j.id=p.ledger_transaction_id
    where p.id in (a.id,b.id) and (e.effective_payable_cents is distinct from p.net_cents
      or (p.ledger_transaction_id is not null and (j.transaction_state is distinct from 'POSTED' or
        (select sum(case l.entry_side when 'DEBIT' then l.amount_cents else -l.amount_cents end)
         from public.financial_ledger_entries l where transaction_id=j.id) is distinct from 0)))
  ) then raise exception 'Journal balance or effective payable mismatch'; end if;
end $$;
