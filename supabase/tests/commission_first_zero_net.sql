-- Run after commission_first_fixture.sql in the same psql session.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare
  f fin04_fixture%rowtype;
  a public.commission_first_payout_allocations;
  extra bigint;
  cutoff timestamptz;
begin
  select * into strict f from fin04_fixture;
  select eligible_from into strict cutoff from public.commission_first_policy;
  foreach extra in array array[3724,4000] loop
    begin
      perform pg_temp.fin04_trip(gen_random_uuid(),'go',cutoff-interval '1 day',extra);
      a := public.commission_first_allocate(f.actor_id,f.trip_id,gen_random_uuid());
      if a.gross_cents <> 4414 or a.recovered_cents <> 4414 or a.net_cents <> 0
        or a.debt_remaining_cents <> extra-3724
        or (public.phase05b_driver_debt(f.driver_id)->>'balance_due')::numeric*100 <> extra-3724
        or (public.commission_first_allocate(f.actor_id,f.trip_id,gen_random_uuid())).id <> a.id
        or (select count(*) from public.commission_first_effective_payables where allocation_id=a.id and effective_payable_cents=0) <> 1
      then raise exception 'Zero-net payout invariant failed'; end if;
      begin
        perform public.commission_first_record_manual_payment(f.actor_id,a.id,gen_random_uuid(),1,
          (now() at time zone 'Africa/Johannesburg')::date,'forbidden-zero-net','synthetic');
        raise exception 'Zero-net payment accepted';
      exception when sqlstate '22023' then null;
      end;
      raise exception using errcode='ZX003', message='Roll back this iteration';
    exception when sqlstate 'ZX003' then null;
    end;
  end loop;
end $$;
rollback;
