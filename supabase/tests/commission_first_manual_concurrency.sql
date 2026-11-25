-- Verified disposable database only. Run twice with the fixture actor/trip.
-- A: -v first_session=true. Start B during A's sleep with first_session=false.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('fin04.test.actor', :'actor_id', true);
select set_config('fin04.test.trip', :'trip_id', true);
select set_config('fin04.test.allocation', (public.commission_first_allocate(:'actor_id', :'trip_id', gen_random_uuid())).id::text, false);
commit;
begin;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('fin04.test.actor', :'actor_id', true);
\if :first_session
do $$
declare a public.commission_first_payout_allocations;
        actor uuid := current_setting('fin04.test.actor')::uuid;
begin
  select * into strict a from public.commission_first_payout_allocations where id=current_setting('fin04.test.allocation')::uuid;
  perform public.commission_first_record_manual_payment(actor,a.id,gen_random_uuid(),a.net_cents,
    (now() at time zone 'Africa/Johannesburg')::date,'FIN04-RACE:'||a.id,'synthetic race receipt');
end $$;
\echo FIN04_A_READY
select pg_sleep(15);
commit;
\else
set local lock_timeout = '2s';
do $$
begin
  perform public.commission_first_record_manual_payment(current_setting('fin04.test.actor')::uuid,
    current_setting('fin04.test.allocation')::uuid,gen_random_uuid(),1,
    (now() at time zone 'Africa/Johannesburg')::date,'FIN04-EXCESS:'||current_setting('fin04.test.allocation'),
    'synthetic excess receipt');
  raise exception 'Start session B while session A holds the lock';
exception when lock_not_available then null;
end $$;
set local lock_timeout = '25s';
do $$
declare a public.commission_first_payout_allocations;
        actor uuid := current_setting('fin04.test.actor')::uuid;
begin
  select * into strict a from public.commission_first_payout_allocations where id=current_setting('fin04.test.allocation')::uuid;
  begin
    perform public.commission_first_record_manual_payment(actor,a.id,gen_random_uuid(),1,
      (now() at time zone 'Africa/Johannesburg')::date,'FIN04-EXCESS:'||a.id,'synthetic excess receipt');
    raise exception 'Concurrent overpayment accepted';
  exception when sqlstate '22023' then null;
  end;
  if (select sum(amount_cents) from public.commission_first_manual_payments where allocation_id=a.id) <> a.net_cents then
    raise exception 'Unexpected final payment balance';
  end if;
end $$;
rollback;
\endif
