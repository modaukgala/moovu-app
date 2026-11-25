-- Run only on a verified disposable database, using the database owner.
-- Supply -v actor_id=... -v trip_id=... for a synthetic, post-cutoff eligible
-- trip with independently reviewed Yoco fee from commission_first_fixture.sql.
-- The fixture must be the driver's earliest eligible unallocated trip.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('fin04.test.actor', :'actor_id', true);
select set_config('fin04.test.trip', :'trip_id', true);

-- A disabled policy and missing independent evidence must fail before posting.
do $$
declare t uuid := current_setting('fin04.test.trip')::uuid;
        actor uuid := current_setting('fin04.test.actor')::uuid;
begin
  begin
    delete from public.commission_first_policy where version = 'commission-first-v1';
    perform public.commission_first_allocate(actor, t, gen_random_uuid());
    raise exception 'Disabled policy allowed allocation';
  exception when raise_exception then
    if sqlerrm <> 'Trip outside active payout policy' then raise; end if;
  end;
  begin
    delete from public.commission_first_provider_fee_reviews r using public.commission_first_provider_fee_evidence e,
      public.online_payment_attempts p
    where r.evidence_id = e.id and e.payment_attempt_id = p.id and p.trip_id = t;
    if not found then raise exception 'Fee review fixture is missing'; end if;
    perform public.commission_first_allocate(actor, t, gen_random_uuid());
    raise exception 'Missing review allowed allocation';
  exception when no_data_found then null;
  end;
end $$;

-- This fixture must require a nonzero ledger adjustment or commission recovery.
create function pg_temp.reject_posting() returns trigger language plpgsql as $$
begin
  if new.idempotency_key like 'commission-first-v1:%' then
    raise exception using errcode = 'ZX002', message = 'Synthetic ledger posting failure';
  end if;
  return new;
end $$;
create trigger fin04_test_reject_posting before insert on public.financial_transactions
  for each row execute function pg_temp.reject_posting();
do $$
declare t uuid := current_setting('fin04.test.trip')::uuid;
        actor uuid := current_setting('fin04.test.actor')::uuid;
        driver uuid;
        debt jsonb;
begin
  select driver_id into strict driver from public.trips where id = t;
  debt := public.phase05b_driver_debt(driver);
  begin
    perform public.commission_first_allocate(actor, t, gen_random_uuid());
    raise exception 'Expected posting failure';
  exception when sqlstate 'ZX002' then null;
  end;
  if exists(select 1 from public.commission_first_payout_allocations where trip_id = t)
    or exists(select 1 from public.financial_transactions where idempotency_key = 'commission-first-v1:' || t::text)
    or public.phase05b_driver_debt(driver) is distinct from debt then
    raise exception 'Posting failure did not roll back';
  end if;
  begin
    perform public.commission_first_allocate(gen_random_uuid(), t, gen_random_uuid());
    raise exception 'Expected actor rejection';
  exception when insufficient_privilege then null;
  end;
  if has_function_privilege('authenticated','public.commission_first_allocate(uuid,uuid,uuid)','execute') then
    raise exception 'Direct authenticated execution granted';
  end if;
end $$;
drop trigger fin04_test_reject_posting on public.financial_transactions;

-- Inject a failure after the ledger post. The surrounding subtransaction must
-- roll back the post and leave the legacy payable and debt untouched.
create function pg_temp.reject_snapshot() returns trigger language plpgsql as $$
begin
  raise exception using errcode = 'ZX001', message = 'Synthetic allocation persistence failure';
end $$;
create trigger fin04_test_reject_snapshot before insert on public.commission_first_payout_allocations
  for each row execute function pg_temp.reject_snapshot();
do $$
declare t uuid := current_setting('fin04.test.trip')::uuid;
        actor uuid := current_setting('fin04.test.actor')::uuid;
        driver uuid;
        debt jsonb;
begin
  select driver_id into strict driver from public.trips where id = t;
  debt := public.phase05b_driver_debt(driver);
  begin
    perform public.commission_first_allocate(actor, t, gen_random_uuid());
    raise exception 'Expected persistence failure';
  exception when sqlstate 'ZX001' then null;
  end;
  if exists(select 1 from public.financial_transactions where idempotency_key = 'commission-first-v1:' || t::text)
    or exists(select 1 from public.commission_first_payout_allocations where trip_id = t)
    or exists(select 1 from public.online_driver_payables where trip_id = t)
    or public.phase05b_driver_debt(driver) is distinct from debt then
    raise exception 'Allocation persistence failure did not roll back';
  end if;
end $$;
drop trigger fin04_test_reject_snapshot on public.commission_first_payout_allocations;

do $$
declare t uuid := current_setting('fin04.test.trip')::uuid;
        actor uuid := current_setting('fin04.test.actor')::uuid;
        op uuid := gen_random_uuid();
        a public.commission_first_payout_allocations;
        replay public.commission_first_payout_allocations;
        p public.online_driver_payables;
        fee bigint;
begin
  if exists(select 1 from public.online_driver_payables where trip_id = t) then
    raise exception 'Expected a newly eligible trip without a payable';
  end if;
  a := public.commission_first_allocate(actor, t, op);
  select * into strict p from public.online_driver_payables where trip_id = t;
  if a.gross_cents <> 4414 or a.recovered_cents <> 690 or a.net_cents <> 3724 or a.debt_remaining_cents <> 0 then
    raise exception 'Approved Go fixture mismatch';
  end if;
  replay := public.commission_first_allocate(actor, t, op);
  if a is distinct from replay then raise exception 'Same-key replay changed allocation'; end if;
  replay := public.commission_first_allocate(actor, t, gen_random_uuid());
  if a is distinct from replay then raise exception 'Trip-identity replay changed allocation'; end if;
  select percentage_cents into strict fee from public.commission_first_provider_fee_evidence where id = a.fee_evidence_id;
  if a.gross_cents <> a.ride_fare_cents + 100 - round(fee::numeric / 2) - 200
     or a.recovered_cents <> least(a.gross_cents, a.debt_before_cents)
     or a.net_cents <> a.gross_cents - a.recovered_cents
     or (public.phase05b_driver_debt(a.driver_id)->>'balance_due')::numeric * 100 <> a.debt_before_cents - a.recovered_cents
     or (select count(*) from public.commission_first_effective_payables
          where trip_id = t and payable_id = p.id and effective_payable_cents = a.net_cents) <> 1
     or (select q from public.online_driver_payables q where q.id = p.id) is distinct from p then
    raise exception 'Arithmetic, debt, original payable or effective obligation mismatch';
  end if;
end $$;
rollback;
