-- Run ONLY on Supabase disposable tangtlmdpnvmoviwrgvd. Every fixture rolls back.
begin;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare cu uuid:=gen_random_uuid();du uuid:=gen_random_uuid();c uuid:=gen_random_uuid();d uuid:=gen_random_uuid();
  t uuid;q uuid;v jsonb;v_terms jsonb;v_expected bigint;v_driver bigint;v_moovu bigint;
  v_assessment uuid;v_tx uuid;v_case integer;v_arrival timestamptz;p public.phase4_policies;trip public.trips;
begin
  insert into auth.users(id) values(cu),(du);
  insert into public.profiles(id,role) values(cu,'customer'),(du,'driver');
  insert into public.customers(id,auth_user_id) values(c,cu);
  insert into public.drivers(id,busy) values(d,true);
  insert into public.driver_accounts(user_id,driver_id) values(du,d);
  insert into public.phase4_policies(version,effective_from,free_seconds,no_show_seconds,
    go_late_cents,go_late_driver_cents,go_late_moovu_cents,xl_late_cents,xl_late_driver_cents,xl_late_moovu_cents,
    go_no_show_cents,go_no_show_driver_cents,go_no_show_moovu_cents,
    xl_no_show_cents,xl_no_show_driver_cents,xl_no_show_moovu_cents)
  values('phase4b-disposable-test',clock_timestamp()-interval '2 days',180,300,
    2000,1300,700,3000,2000,1000,3000,2200,800,4000,3000,1000);
  select * into p from public.phase4_policies where version='phase4b-disposable-test';

  -- Six cancellation outcomes: unassigned at either time, early assigned,
  -- exact boundary/late assigned, arrived Customer, and Go XL.
  for v_case in 1..7 loop
    t:=gen_random_uuid();
    insert into public.trips(id,customer_id,driver_id,status,ride_option,created_at,
      driver_arrived_at,arrival_evidence_qualified,arrival_evidence_version)
    values(t,c,case when v_case<=2 then null else d end,
      case when v_case=6 then 'arrived' else 'assigned' end,
      case when v_case=7 then 'xl' else 'go' end,
      clock_timestamp()-make_interval(secs=>case v_case when 1 then 60 when 2 then 240
        when 3 then 60 when 4 then 180 when 5 then 240 when 6 then 240 else 240 end),
      case when v_case=6 then clock_timestamp()-interval '10 seconds' else null end,
      case when v_case=6 then true else null end,
      case when v_case=6 then 'phase-05b-v1' else null end);
    v:=public.phase4b_quote_customer_cancellation(t,c,cu);q:=(v->>'quote_id')::uuid;
    v_terms:=v->'terms';
    v_expected:=case when v_case<=3 then 0 when v_case=7 then 3000 else 2000 end;
    v_driver:=case when v_expected=0 then 0 when v_case=7 then 2000 else 1300 end;
    v_moovu:=v_expected-v_driver;
    if (v_terms->>'fee_cents')::bigint<>v_expected then raise exception 'Quote case %',v_case;end if;
    if v_case=4 then
      select * into trip from public.trips where id=t;
      if (public.phase4b_cancellation_terms(trip,p,trip.created_at+interval '180 seconds')->>'fee_cents')::bigint<>2000
        or (public.phase4b_cancellation_terms(trip,p,trip.created_at+interval '180 seconds'-interval '1 microsecond')->>'fee_cents')::bigint<>0
        then raise exception 'Exact 180-second boundary';end if;
    end if;
    v:=public.phase4b_cancel_customer_trip(t,c,cu,q,'Testing',null);
    if (v->>'fee_cents')::bigint<>v_expected then raise exception 'Cancellation case %',v_case;end if;
    if (public.phase4b_cancel_customer_trip(t,c,cu,q,'Testing',null)->>'replayed')::boolean is distinct from true
      then raise exception 'Cancellation replay case %',v_case;end if;
    if (select count(*) from public.moovu_business_events where aggregate_id=t and event_key like 'phase4:%')<>1
      or (select count(*) from public.moovu_notification_outbox o join public.moovu_business_events e
        on e.id=o.business_event_id where e.aggregate_id=t and e.event_key like 'phase4:%')<>1
      then raise exception 'Outbox duplicate case %',v_case;end if;
    select id into v_assessment from public.phase4_fee_assessments where trip_id=t;
    if v_expected=0 then
      if v_assessment is not null or exists(select 1 from public.financial_transactions where economic_trip_id=t)
        then raise exception 'Free trip produced financial event case %',v_case;end if;
    else
      if v_assessment is null then raise exception 'Missing assessment case %',v_case;end if;
      select id into v_tx from public.financial_transactions where economic_trip_id=t;
      if v_tx is null or (select count(*) from public.financial_ledger_entries where transaction_id=v_tx)<>3
        or (select sum(amount_cents) from public.financial_ledger_entries where transaction_id=v_tx and entry_side='DEBIT')<>v_expected
        or (select sum(amount_cents) from public.financial_ledger_entries where transaction_id=v_tx and entry_side='CREDIT')<>v_expected
        or (select earned_cents from public.phase4_driver_compensations where assessment_id=v_assessment)<>v_driver
        or (select open_cents from public.phase4_customer_liabilities where assessment_id=v_assessment)<>v_expected
        then raise exception 'Financial invariant case %',v_case;end if;
      if (select sum(e.amount_cents) from public.financial_ledger_entries e join public.financial_accounts a
        on a.id=e.account_id where e.transaction_id=v_tx and e.entry_side='DEBIT'
          and a.account_category='CANCELLATION_NO_SHOW_RECEIVABLE')<>v_expected
        or (select sum(e.amount_cents) from public.financial_ledger_entries e join public.financial_accounts a
          on a.id=e.account_id where e.transaction_id=v_tx and e.entry_side='CREDIT'
            and a.account_category='DRIVER_COMPENSATION_PAYABLE')<>v_driver
        or (select sum(e.amount_cents) from public.financial_ledger_entries e join public.financial_accounts a
          on a.id=e.account_id where e.transaction_id=v_tx and e.entry_side='CREDIT'
            and a.account_category='ADJUSTMENT_CLEARING')<>v_moovu
        then raise exception 'Wrong journal accounts case %',v_case;end if;
      if (select phase4_assessment_id from public.trip_cancellation_fees where trip_id=t) is distinct from v_assessment
        then raise exception 'Legacy fee projection not source-linked case %',v_case;end if;
      if exists(select 1 from public.financial_ledger_entries e join public.financial_accounts a on a.id=e.account_id
        where e.transaction_id=v_tx and a.account_category in ('PAYMENT_CLEARING','CANCELLATION_NO_SHOW_REVENUE'))
        then raise exception 'Cash/revenue prematurely asserted case %',v_case;end if;
      if public.phase4b_post_assessment(v_assessment,cu)<>v_tx then raise exception 'Posting replay case %',v_case;end if;
    end if;
  end loop;
  if (select count(*) from public.phase4_customer_grace_cycles where customer_id=c and resolved_at is null)<>1
    then raise exception 'Grace cycle was reset';end if;
  if exists(select 1 from public.driver_wallet_transactions where tx_type='cancellation_credit'
    and trip_id in (select trip_id from public.phase4_fee_assessments where customer_id=c))
    then raise exception 'Double driver compensation';end if;

  -- Quote must refuse changed assignment and cannot silently turn free into charged.
  t:=gen_random_uuid();
  insert into public.trips(id,customer_id,status,ride_option,created_at)
    values(t,c,'offered','go',clock_timestamp()-interval '5 minutes');
  v:=public.phase4b_quote_customer_cancellation(t,c,cu);q:=(v->>'quote_id')::uuid;
  update public.trips set driver_id=d,status='assigned' where id=t;
  v:=public.phase4b_cancel_customer_trip(t,c,cu,q,'Testing',null);
  if coalesce((v->>'requires_reconfirmation')::boolean,false) is not true
    or (select status from public.trips where id=t)<>'assigned' then raise exception 'Quote race not guarded';end if;

  -- No-show at 299 seconds fails, at 300 succeeds, including Go XL split.
  for v_case in 1..4 loop
    t:=gen_random_uuid();
    v_arrival:=clock_timestamp()-make_interval(secs=>case v_case when 1 then 299 when 2 then 300 else 400 end);
    insert into public.trips(id,customer_id,driver_id,status,ride_option,created_at,
      driver_arrived_at,arrival_evidence_qualified,arrival_evidence_version)
    values(t,c,d,'arrived',case when v_case=3 then 'xl' else 'go' end,
      clock_timestamp()-interval '10 minutes',v_arrival,v_case<>4,'phase-05b-v1');
    if v_case=2 then
      begin
        perform public.phase4b_mark_customer_no_show(t,gen_random_uuid(),du);
        raise exception 'Wrong Driver should have failed';
      exception when others then
        if sqlerrm='Wrong Driver should have failed' then raise;end if;
      end;
      if exists(select 1 from public.phase4_fee_assessments where trip_id=t) then
        raise exception 'Wrong Driver created assessment';end if;
    end if;
    if v_case in (1,4) then
      begin
        perform public.phase4b_mark_customer_no_show(t,d,du);
        raise exception 'No-show should have failed case %',v_case;
      exception when others then
        if sqlerrm like 'No-show should have failed%' then raise;end if;
      end;
      if (select status from public.trips where id=t)<>'arrived' or exists
        (select 1 from public.phase4_fee_assessments where trip_id=t) then raise exception 'Rejected no-show mutated case %',v_case;end if;
    else
      v:=public.phase4b_mark_customer_no_show(t,d,du);
      v_expected:=case when v_case=3 then 4000 else 3000 end;
      v_driver:=case when v_case=3 then 3000 else 2200 end;
      if (v->>'fee_cents')::bigint<>v_expected or (v->>'driver_cents')::bigint<>v_driver
        or (public.phase4b_mark_customer_no_show(t,d,du)->>'replayed')::boolean is not true
        then raise exception 'No-show/replay case %',v_case;end if;
      select id into v_assessment from public.phase4_fee_assessments where trip_id=t;
      select id into v_tx from public.financial_transactions where economic_trip_id=t;
      if v_assessment is null or v_tx is null
        or (select open_cents from public.phase4_customer_liabilities where assessment_id=v_assessment)<>v_expected
        or (select earned_cents from public.phase4_driver_compensations where assessment_id=v_assessment)<>v_driver
        or (select sum(amount_cents) from public.financial_ledger_entries where transaction_id=v_tx and entry_side='DEBIT')<>v_expected
        or (select sum(amount_cents) from public.financial_ledger_entries where transaction_id=v_tx and entry_side='CREDIT')<>v_expected
        then raise exception 'No-show financial invariant case %',v_case;end if;
    end if;
  end loop;

  -- Ledger failure after terminal UPDATE must roll back assessment and trip.
  t:=gen_random_uuid();
  insert into public.trips(id,customer_id,driver_id,status,ride_option,created_at)
    values(t,c,d,'assigned','go',clock_timestamp()-interval '4 minutes');
  v:=public.phase4b_quote_customer_cancellation(t,c,cu);q:=(v->>'quote_id')::uuid;
  update public.financial_accounts set account_status='SUSPENDED'
    where owner_type='PLATFORM' and account_category='ADJUSTMENT_CLEARING';
  begin
    perform public.phase4b_cancel_customer_trip(t,c,cu,q,'Testing',null);
    raise exception 'Ledger failure should have rolled back';
  exception when others then
    if sqlerrm='Ledger failure should have rolled back' then raise;end if;
  end;
  if (select status from public.trips where id=t)<>'assigned' or exists
    (select 1 from public.phase4_fee_assessments where trip_id=t) then raise exception 'Ledger failure leaked state';end if;
  raise notice 'PHASE4B DISPOSABLE MATRIX PASS';
end $$;
rollback;
