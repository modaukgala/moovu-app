-- Disposable only. Every fixture and posting rolls back.
begin;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare cu uuid:=gen_random_uuid(); du uuid:=gen_random_uuid(); au uuid:=gen_random_uuid();
  c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); t uuid:=gen_random_uuid();
  q uuid; v jsonb; a uuid; cycle uuid; n integer; test_trip uuid; blocked boolean;
begin
  insert into auth.users(id) values(cu),(du),(au);
  insert into public.profiles(id,role) values(cu,'customer'),(du,'driver'),(au,'admin');
  insert into public.customers(id,auth_user_id) values(c,cu);
  insert into public.drivers(id,busy) values(d,true);
  insert into public.driver_accounts(user_id,driver_id) values(du,d);
  insert into public.phase4_policies(version,effective_from,free_seconds,no_show_seconds,
    go_late_cents,go_late_driver_cents,go_late_moovu_cents,
    xl_late_cents,xl_late_driver_cents,xl_late_moovu_cents,
    go_no_show_cents,go_no_show_driver_cents,go_no_show_moovu_cents,
    xl_no_show_cents,xl_no_show_driver_cents,xl_no_show_moovu_cents)
  values('phase4c-policy-1',clock_timestamp()-interval '1 day',180,300,
    2000,1300,700,3000,2000,1000,3000,2200,800,4000,3000,1000);
  insert into public.trips(id,customer_id,driver_id,status,ride_option,created_at)
  values(t,c,d,'assigned','go',clock_timestamp()-interval '5 minutes');
  v:=public.phase4b_quote_customer_cancellation(t,c,cu);q:=(v->>'quote_id')::uuid;
  insert into public.phase4_policies(version,effective_from,free_seconds,no_show_seconds,
    go_late_cents,go_late_driver_cents,go_late_moovu_cents,
    xl_late_cents,xl_late_driver_cents,xl_late_moovu_cents,
    go_no_show_cents,go_no_show_driver_cents,go_no_show_moovu_cents,
    xl_no_show_cents,xl_no_show_driver_cents,xl_no_show_moovu_cents)
  values('phase4c-policy-2',clock_timestamp()-interval '1 second',180,300,
    2000,1300,700,3000,2000,1000,3000,2200,800,4000,3000,1000);
  v:=public.phase4b_cancel_customer_trip(t,c,cu,q,'Testing reconfirmation',null);
  if coalesce((v->>'requires_reconfirmation')::boolean,false) is not true
    or (select status from public.trips where id=t)<>'assigned' then
    raise exception 'Multi-policy consent regression: %',v; end if;
  v:=public.phase4b_quote_customer_cancellation(t,c,cu);q:=(v->>'quote_id')::uuid;
  v:=public.phase4b_cancel_customer_trip(t,c,cu,q,'Testing reconfirmation',null);
  a:=(v->>'assessment_id')::uuid;
  if a is null or (v->>'fee_cents')::bigint<>2000 then raise exception 'Assessment missing: %',v; end if;
  select id into cycle from public.phase4_customer_grace_cycles where customer_id=c and resolved_at is null;
  if cycle is null then raise exception 'Grace cycle missing'; end if;
  for n in 1..2 loop
    test_trip:=gen_random_uuid();
    insert into public.trips(id,customer_id,status,ride_option,created_at)
      values(test_trip,c,'requested','go',clock_timestamp());
    update public.trips set status='completed',completed_at=clock_timestamp() where id=test_trip;
    if (select count(*) from public.phase4_grace_ride_consumptions where cycle_id=cycle)<>n then
      raise exception 'Grace completion % not consumed exactly once',n; end if;
    update public.trips set status='completed' where id=test_trip;
  end loop;
  blocked:=false;
  begin
    insert into public.trips(id,customer_id,status,ride_option) values(gen_random_uuid(),c,'requested','go');
  exception when others then
    if SQLERRM like 'PHASE4_BOOKING_BLOCKED:%' then blocked:=true; else raise; end if;
  end;
  if not blocked then raise exception 'Third booking was not blocked'; end if;
  perform public.phase4_admin_liability_action(a,au,'DISPUTE_OPENED','Customer disputes fee');
  if (public.phase4_customer_debt_state(c)->>'booking_blocked')::boolean then
    raise exception 'Dispute failed to pause block'; end if;
  test_trip:=gen_random_uuid();
  insert into public.trips(id,customer_id,status,ride_option) values(test_trip,c,'requested','go');
  update public.trips set status='completed',completed_at=clock_timestamp() where id=test_trip;
  if (select count(*) from public.phase4_grace_ride_consumptions where cycle_id=cycle)<>2 then
    raise exception 'Disputed ride consumed grace'; end if;
  perform public.phase4_admin_liability_action(a,au,'DISPUTE_RESOLVED','Evidence confirms fee');
  if not (public.phase4_customer_debt_state(c)->>'booking_blocked')::boolean then
    raise exception 'Resolved dispute did not restore block'; end if;
  perform public.phase4_admin_liability_action(a,au,'WAIVER','Goodwill waiver');
  if (public.phase4_customer_debt_state(c)->>'booking_blocked')::boolean
    or (select resolved_at from public.phase4_customer_grace_cycles where id=cycle) is null then
    raise exception 'Waiver did not resolve grace'; end if;
  if not exists(select 1 from public.financial_transactions
    where source_type='PHASE4_ASSESSMENT' and source_id=a and transaction_type='ADJUSTMENT'
      and transaction_state='POSTED') then raise exception 'Waiver journal missing'; end if;
  insert into public.trips(id,customer_id,status,ride_option) values(gen_random_uuid(),c,'requested','go');
end $$;
select 'phase4c_transactional_matrix_passed' as result;
rollback;
