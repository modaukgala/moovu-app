-- Verified disposable database only. Use identities from commission_first_fixture.sql.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('fin04.test.actor', :'actor_id', true);
select set_config('fin04.test.reviewer', :'reviewer_id', true);
select set_config('fin04.test.trip', :'trip_id', true);
do $$
declare
  actor uuid := current_setting('fin04.test.actor')::uuid;
  reviewer uuid := current_setting('fin04.test.reviewer')::uuid;
  trip uuid := current_setting('fin04.test.trip')::uuid;
  a public.commission_first_payout_allocations;
  first_payment uuid;
  second_payment uuid;
  payment_day date := (now() at time zone 'Africa/Johannesburg')::date;
  prefix text := 'fin04-manual:' || trip::text;
begin
  a := public.commission_first_allocate(actor,trip,gen_random_uuid());
  first_payment := public.commission_first_record_manual_payment(actor,a.id,gen_random_uuid(),100,payment_day,prefix||':1','receipt one');
  second_payment := public.commission_first_record_manual_payment(actor,a.id,gen_random_uuid(),100,payment_day,prefix||':2','receipt two');
  begin
    perform public.commission_first_record_manual_payment(actor,a.id,gen_random_uuid(),100,payment_day,prefix||':1','duplicate');
    raise exception 'Duplicate bank reference accepted';
  exception when unique_violation then null;
  end;
  begin
    perform public.commission_first_verify_manual_payment(actor,first_payment,gen_random_uuid(),100,payment_day,prefix||':1','independent one');
    raise exception 'Self-verification accepted';
  exception when insufficient_privilege then null;
  end;
  perform public.commission_first_verify_manual_payment(reviewer,first_payment,gen_random_uuid(),100,payment_day,prefix||':1','independent one');
  begin
    perform public.commission_first_verify_manual_payment(reviewer,second_payment,gen_random_uuid(),100,payment_day,prefix||':2','independent one');
    raise exception 'Independent evidence reused';
  exception when unique_violation then null;
  end;
  perform public.commission_first_record_manual_payment(actor,a.id,gen_random_uuid(),a.net_cents-200,payment_day,prefix||':3','final receipt');
  begin
    perform public.commission_first_record_manual_payment(actor,a.id,gen_random_uuid(),1,payment_day,prefix||':4','overpayment');
    raise exception 'Overpayment accepted';
  exception when sqlstate '22023' then null;
  end;
  if (select sum(amount_cents) from public.commission_first_manual_payments where allocation_id=a.id) <> a.net_cents
    or (select x from public.commission_first_payout_allocations x where id=a.id) is distinct from a
    or (public.phase05b_driver_debt(a.driver_id)->>'balance_due')::numeric*100 <> a.debt_remaining_cents then
    raise exception 'Manual payment changed allocation or debt';
  end if;
end $$;
rollback;
