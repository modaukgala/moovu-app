-- Run in the same psql process immediately after commission_first_fixture.sql.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare
  f fin04_fixture%rowtype;
  a public.commission_first_payout_allocations;
  cutoff timestamptz;
  tail timestamptz;
  historical uuid := gen_random_uuid();
  settled uuid := gen_random_uuid();
  first_xl uuid := '00000000-0000-4000-8000-000000000001';
  second_xl uuid := '00000000-0000-4000-8000-000000000002';
  last_trip uuid := gen_random_uuid();
  journal uuid;
  old_entries jsonb;
  original_debt jsonb;
begin
  select * into strict f from fin04_fixture;
  select eligible_from into strict cutoff from public.commission_first_policy;
  select completed_at into strict tail from public.trips where id=f.trip_id;
  perform pg_temp.fin04_trip(historical,'go',cutoff-interval '1 day',690);
  perform pg_temp.fin04_trip(settled,'go',cutoff-interval '1 hour',690);
  perform public.phase3_post_completed_online_driver_payable(settled);
  update public.online_driver_payables set state='PAID' where trip_id=settled returning ledger_transaction_id into journal;
  select jsonb_agg(to_jsonb(e) order by e.sequence_number) into old_entries
    from public.financial_ledger_entries e where transaction_id=journal;
  original_debt := public.phase05b_driver_debt(f.driver_id);
  begin
    perform public.commission_first_allocate(f.actor_id,historical,gen_random_uuid());
    raise exception 'Historical trip was allocated';
  exception when raise_exception then
    if sqlerrm <> 'Trip outside active payout policy' then raise; end if;
  end;
  begin
    perform public.commission_first_allocate(f.actor_id,settled,gen_random_uuid());
    raise exception 'Settled historical trip was allocated';
  exception when raise_exception then
    if sqlerrm <> 'Trip outside active payout policy' then raise; end if;
  end;
  if exists(select 1 from public.online_driver_payables where trip_id=historical)
    or (select state from public.online_driver_payables where trip_id=settled) is distinct from 'PAID'
    or (select jsonb_agg(to_jsonb(e) order by e.sequence_number) from public.financial_ledger_entries e where transaction_id=journal) is distinct from old_entries
    or public.phase05b_driver_debt(f.driver_id) is distinct from original_debt then
    raise exception 'Historical record changed';
  end if;

  perform pg_temp.fin04_trip(second_xl,'group',tail+interval '1 microsecond',690);
  perform pg_temp.fin04_trip(first_xl,'group',tail+interval '1 microsecond',690);
  perform pg_temp.fin04_trip(last_trip,'go',tail+interval '2 microseconds',690);
  begin
    perform public.commission_first_allocate(f.actor_id,first_xl,gen_random_uuid());
    raise exception 'Earlier timestamp was skipped';
  exception when raise_exception then
    if sqlerrm <> 'Earlier online trip requires allocation or reconciliation' then raise; end if;
  end;
  a := public.commission_first_allocate(f.actor_id,f.trip_id,gen_random_uuid());
  if a.recovered_cents <> 4140 or a.net_cents <> 274 then raise exception 'First trip economics mismatch'; end if;
  begin
    perform public.commission_first_allocate(f.actor_id,second_xl,gen_random_uuid());
    raise exception 'Stable UUID tie-breaker was skipped';
  exception when raise_exception then
    if sqlerrm <> 'Earlier online trip requires allocation or reconciliation' then raise; end if;
  end;
  begin
    perform public.phase3_post_completed_online_driver_payable(first_xl);
    update public.online_driver_payables set state='PAID' where trip_id=first_xl returning ledger_transaction_id into journal;
    select jsonb_agg(to_jsonb(e) order by e.sequence_number) into old_entries
      from public.financial_ledger_entries e where transaction_id=journal;
    original_debt := public.phase05b_driver_debt(f.driver_id);
    begin
      perform public.commission_first_allocate(f.actor_id,first_xl,gen_random_uuid());
      raise exception 'Eligible settled payable was reopened';
    exception when raise_exception then
      if sqlerrm <> 'Existing payable requires financial reconciliation' then raise; end if;
    end;
    if (select count(*) from public.online_driver_payables where trip_id=first_xl and state='PAID') <> 1
       or exists(select 1 from public.commission_first_payout_allocations where trip_id=first_xl)
       or public.phase05b_driver_debt(f.driver_id) is distinct from original_debt
       or (select jsonb_agg(to_jsonb(e) order by e.sequence_number)
           from public.financial_ledger_entries e where transaction_id=journal) is distinct from old_entries
    then raise exception 'Settled payable or its ledger changed'; end if;
    raise exception using errcode='ZX004', message='Discard test-only settled state';
  exception when sqlstate 'ZX004' then null;
  end;
  a := public.commission_first_allocate(f.actor_id,first_xl,gen_random_uuid());
  if row(a.ride_fare_cents,a.driver_booking_cents,a.platform_booking_cents,a.percentage_deduction_cents,
     a.fixed_deduction_cents,a.gross_cents,a.recovered_cents,a.net_cents,a.debt_remaining_cents)
     is distinct from row(4600,100,400,86,200,4414,0,4414,0) then
    raise exception 'Go XL calculator parity mismatch';
  end if;
  perform public.commission_first_allocate(f.actor_id,second_xl,gen_random_uuid());
  perform public.commission_first_allocate(f.actor_id,last_trip,gen_random_uuid());
  if (select count(*) from public.commission_first_effective_payables
      where trip_id in (f.trip_id,first_xl,second_xl,last_trip) and allocation_id is not null) <> 4
     or (public.phase05b_driver_debt(f.driver_id)->>'balance_due')::numeric <> 0 then
    raise exception 'Final debt or effective payable count mismatch';
  end if;
end $$;
rollback;
