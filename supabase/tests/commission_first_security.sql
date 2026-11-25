-- Verified disposable database only. Use support_id, driver_user_id and trip_id from the fixture.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('fin04.test.support', :'support_id', true);
select set_config('fin04.test.driver_user', :'driver_user_id', true);
select set_config('fin04.test.trip', :'trip_id', true);
do $$
declare
  fn text;
  actor uuid;
begin
  foreach fn in array array[
    'commission_first_allocate(uuid,uuid,uuid)',
    'commission_first_record_provider_fee(uuid,uuid,text,text,bigint,bigint,bigint)',
    'commission_first_review_provider_fee(uuid,uuid,text,bigint,bigint,bigint)',
    'commission_first_record_manual_payment(uuid,uuid,uuid,bigint,date,text,text)',
    'commission_first_verify_manual_payment(uuid,uuid,uuid,bigint,date,text,text)'
  ] loop
    if has_function_privilege('authenticated','public.'||fn,'EXECUTE')
      or has_function_privilege('anon','public.'||fn,'EXECUTE')
      or not has_function_privilege('service_role','public.'||fn,'EXECUTE') then
      raise exception 'Unexpected execution grants for %', fn;
    end if;
  end loop;
  if has_table_privilege('authenticated','public.commission_first_effective_payables','SELECT')
    or has_table_privilege('authenticated','public.commission_first_payout_allocations','SELECT') then
    raise exception 'Unscoped authenticated payout reads granted';
  end if;
  foreach actor in array array[current_setting('fin04.test.support')::uuid,
    current_setting('fin04.test.driver_user')::uuid,gen_random_uuid()] loop
    begin
      perform public.commission_first_allocate(actor,current_setting('fin04.test.trip')::uuid,gen_random_uuid());
      raise exception 'Nonfinancial actor allocated payout';
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;
rollback;
