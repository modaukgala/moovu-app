-- DISPOSABLE ONLY: tangtlmdpnvmoviwrgvd. Never production.
-- Run only after verified targeting, clean installation and security gate.
-- All fixtures and mode changes in this file roll back.
begin;
create temporary table phase2_financial_results(check_name text, result text);
create function pg_temp.p2_assert(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Phase 2 acceptance failed: %',label; end if;
  insert into phase2_financial_results values(label,'PASS');
end $$;

create function pg_temp.p2_inject_failure() returns trigger language plpgsql as $$
begin
  if current_setting('phase2.validation.fail_after_first_entry',true)='on' and new.sequence_number=2 then
    raise exception 'Injected shadow write failure';
  end if;
  return new;
end $$;
create trigger p2_validation_failure before insert on public.financial_ledger_entries
for each row execute function pg_temp.p2_inject_failure();
create function pg_temp.p2_opening(d uuid, cents bigint, actor uuid) returns jsonb language plpgsql as $$
declare debt public.financial_accounts; clearing public.financial_accounts; result jsonb;
begin
  debt:=public.phase1_ensure_financial_account('DRIVER:'||upper(d::text)||':COMMISSION_DEBT:ZAR',
    'DRIVER_COMMISSION_DEBT','DRIVER',d,'DEBIT','ZAR');
  clearing:=public.phase1_ensure_financial_account('PLATFORM:ADJUSTMENT_CLEARING:ZAR',
    'ADJUSTMENT_CLEARING','PLATFORM',null,'CREDIT','ZAR');
  result:=public.phase1_post_financial_transaction('phase2-opening:'||d,repeat('a',64),
    'ADJUSTMENT','ADJUSTMENT',d,'ZAR','OWNER',actor,now(),jsonb_build_array(
      jsonb_build_object('account_id',debt.id,'entry_side','DEBIT','amount_cents',cents),
      jsonb_build_object('account_id',clearing.id,'entry_side','CREDIT','amount_cents',cents)),
    jsonb_build_object('event','opening_balance','driver_id',d,'cutoff_at',now(),'fixture',true),null);
  return result;
end $$;

do $$
declare owner_id uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); d uuid:=gen_random_uuid();
  historical uuid:=gen_random_uuid(); go_trip uuid:=gen_random_uuid(); xl_trip uuid:=gen_random_uuid();
  request_id uuid; payment_driver uuid; wallet uuid; before_count bigint; before_entries bigint; result jsonb; again jsonb;
  position jsonb; opening jsonb; reversal jsonb; denied boolean; debt_rand integer; payment_rand integer;
  policy_id uuid; snap jsonb; completed uuid:=gen_random_uuid(); driver_user uuid:=gen_random_uuid(); boundary integer;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  insert into auth.users(id) values(owner_id),(admin_id),(driver_user);
  insert into public.profiles(id,role) values(owner_id,'owner'),(admin_id,'admin'),(driver_user,'driver');
  insert into public.drivers(id,status,subscription_status,subscription_expires_at)
    values(d,'approved','active',now()+interval '1 day');
  insert into public.driver_accounts(user_id,driver_id) values(driver_user,d);
  insert into public.trips(id,driver_id,status,created_at,fare_amount,commission_pct,commission_amount,driver_net_earnings)
    values(historical,d,'completed',now()-interval '30 days',100,10,10,90);
  perform pg_temp.p2_assert((select commission_locked_at is null and commission_pct=10 from public.trips where id=historical),
    'OFF insertion preserves legacy snapshot');
  before_count:=(select count(*) from public.financial_transactions);
  denied:=false;
  begin perform public.phase2_post_trip_commission(historical,owner_id);
    exception when raise_exception then denied:=sqlerrm='Phase 2 is OFF'; end;
  perform pg_temp.p2_assert(denied and before_count=(select count(*) from public.financial_transactions),'OFF denies posting without mutation');

  update public.phase2_finance_policy set mode='SHADOW',effective_from=now()-interval '1 minute'
    where policy_key='phase2-driver-finance' returning id into policy_id;
  insert into public.trips(id,driver_id,status,ride_option,fare_amount,final_fare,commission_amount)
    values(go_trip,d,'completed','go',100,100,15),(xl_trip,d,'completed','go_xl',1.04,1.04,0.16);
  perform pg_temp.p2_assert((select commission_basis_points=1500 and commission_policy_id=policy_id from public.trips where id=go_trip),'Go snapshot 15 percent');
  perform pg_temp.p2_assert((select commission_basis_points=1500 from public.trips where id=xl_trip),'Go XL snapshot 15 percent');
  snap:=(select jsonb_build_array(commission_policy_id,commission_basis_points,commission_rounding_version,commission_locked_at) from public.trips where id=go_trip);
  denied:=false;
  begin update public.trips set commission_basis_points=1000 where id=go_trip;
    exception when raise_exception then denied:=true; end;
  perform pg_temp.p2_assert(denied and snap=(select jsonb_build_array(commission_policy_id,commission_basis_points,commission_rounding_version,commission_locked_at) from public.trips where id=go_trip),'Snapshot immutable after insert');
  denied:=false;
  begin perform public.phase2_lock_trip_commission_snapshot(historical);
    exception when raise_exception then denied:=sqlerrm='Trip predates Phase 2 policy'; end;
  perform pg_temp.p2_assert(denied and (select commission_locked_at is null and commission_amount=10 from public.trips where id=historical),'Historical snapshot not backfilled or repriced');
  result:=public.phase2_post_trip_commission(go_trip,owner_id);
  again:=public.phase2_post_trip_commission(go_trip,owner_id);
  perform pg_temp.p2_assert(result->>'commission_cents'='1500' and again->>'replayed'='true' and result->>'transaction_id'=again->>'transaction_id','Go posting exact replay');
  result:=public.phase2_post_trip_commission(xl_trip,owner_id);
  perform pg_temp.p2_assert(result->>'commission_cents'='16','Go XL integer-cent half-up rounding');
  perform pg_temp.p2_assert(not exists(select 1 from public.financial_ledger_entries e join public.financial_accounts a on a.id=e.account_id
    join public.financial_transactions t on t.id=e.transaction_id where t.source_id in(go_trip,xl_trip) and a.account_category='PAYMENT_CLEARING'),
    'Cash or direct transfer fare never posted as platform cash');
  perform pg_temp.p2_assert((select count(*)=2 and bool_and(parity) from public.phase2_shadow_reconciliations where source_id in(go_trip,xl_trip)),
    'Matching shadow sources reconcile with exact parity');

  -- Existing trip completion can cross R50. Legacy remains authoritative in SHADOW.
  perform pg_temp.p2_opening(d,3400,owner_id);
  perform pg_temp.p2_assert((public.phase2_driver_finance_position(d)->>'commission_debt_cents')::bigint=4916,'Debt below R50 before legitimate completion');
  insert into public.trips(id,driver_id,status,ride_option,fare_amount,final_fare,start_otp_verified,end_otp,trip_started_at,duration_min)
    values(completed,d,'ongoing','go',100,100,true,'1234',now()-interval '1 hour',10);
  result:=public.phase05b_complete_trip(completed,driver_user,d,'otp','1234',null,null,0,100,'disposable validation');
  perform public.phase2_post_trip_commission(completed,owner_id);
  position:=public.phase2_driver_finance_position(d);
  perform pg_temp.p2_assert((select status='completed' from public.trips where id=completed) and position->>'commission_debt_cents'='6416'
    and position->>'financially_eligible'='false','Completion succeeds while crossing R50');
  perform pg_temp.p2_assert((select not parity and legacy_amount_cents=1000 and ledger_amount_cents=1500 from public.phase2_shadow_reconciliations where source_id=completed),
    'Legacy 10 percent versus proposed 15 percent discrepancy is explicit');
  perform pg_temp.p2_assert((public.phase2_finance_eligibility(d)->>'subscription_required')::boolean,'SHADOW retains subscription requirement');

  foreach boundary in array array[4999,5000,5001] loop
    payment_driver:=gen_random_uuid();
    insert into public.drivers(id,status,subscription_status,subscription_expires_at)
      values(payment_driver,'approved','active',now()+interval '1 day');
    perform pg_temp.p2_opening(payment_driver,boundary,owner_id);
    position:=public.phase2_finance_eligibility(payment_driver);
    perform pg_temp.p2_assert((position->>'phase2_eligible')::boolean=(boundary<5000),'Exact finance boundary '||boundary||' cents');
    perform pg_temp.p2_assert(position->>'authoritative_eligible'='true','SHADOW leaves legacy eligibility authoritative '||boundary||' cents');
    update public.drivers set subscription_expires_at=now()-interval '1 day' where id=payment_driver;
    perform pg_temp.p2_assert((public.phase2_finance_eligibility(payment_driver)->>'authoritative_eligible')='false','Expired subscription still blocks SHADOW eligibility '||boundary||' cents');
  end loop;

  foreach debt_rand in array array[40,59] loop
    payment_rand:=case when debt_rand=40 then 60 else 10 end;
    payment_driver:=gen_random_uuid(); request_id:=gen_random_uuid(); wallet:=gen_random_uuid();
    insert into public.drivers(id,status,subscription_status,subscription_expires_at)
      values(payment_driver,'approved','active',now()+interval '1 day');
    insert into public.driver_wallets(id,driver_id,balance_due) values(wallet,payment_driver,debt_rand);
    insert into public.driver_wallet_transactions(driver_id,wallet_id,tx_type,amount,direction,description)
      values(payment_driver,wallet,'commission',debt_rand,'debit','Disposable opening evidence');
    opening:=pg_temp.p2_opening(payment_driver,debt_rand*100,owner_id);
    again:=pg_temp.p2_opening(payment_driver,debt_rand*100,owner_id);
    perform pg_temp.p2_assert(again->>'replayed'='true' and again->>'transaction_id'=opening->>'transaction_id','Opening balance replay R'||debt_rand);
    insert into public.phase2_historical_finance_exceptions(exception_key,driver_id,source_type,cutoff_at,legacy_calculated_cents,reconciled_opening_cents,reason)
      values('fixture:'||payment_driver,payment_driver,'ADJUSTMENT',now(),debt_rand*100,debt_rand*100,'Disposable reconciled opening');
    insert into public.driver_payment_requests(id,driver_id,payment_type,amount_submitted,status)
      values(request_id,payment_driver,'commission',payment_rand,'pending_payment_review');
    result:=public.phase05b_review_driver_payment(request_id,'approve',null,owner_id);
    perform pg_temp.p2_assert(result->>'replayed'='false','Legacy approval first effect R'||payment_rand);
    -- Fail after the first entry insert to prove transaction rollback, not merely early rejection.
    before_count:=(select count(*) from public.financial_transactions);
    before_entries:=(select count(*) from public.financial_ledger_entries);
    perform set_config('phase2.validation.fail_after_first_entry','on',true);
    denied:=false;
    begin perform public.phase2_post_verified_driver_payment(request_id,owner_id);
      exception when raise_exception then denied:=sqlerrm='Injected shadow write failure'; end;
    perform set_config('phase2.validation.fail_after_first_entry','off',true);
    perform pg_temp.p2_assert(denied and before_count=(select count(*) from public.financial_transactions)
      and before_entries=(select count(*) from public.financial_ledger_entries),'Legacy succeeds shadow failure has zero ledger effect R'||payment_rand);
    again:=public.phase05b_review_driver_payment(request_id,'approve',null,admin_id);
    perform pg_temp.p2_assert(again->>'replayed'='true','Legacy replay accepted for recovery R'||payment_rand);
    result:=public.phase2_post_verified_driver_payment(request_id,admin_id);
    again:=public.phase2_post_verified_driver_payment(request_id,owner_id);
    perform pg_temp.p2_assert(result->>'transaction_id'=again->>'transaction_id' and again->>'replayed'='true','Owner and Admin recovery share one financial source R'||payment_rand);
    position:=public.phase2_driver_finance_position(payment_driver);
    perform pg_temp.p2_assert((position->>'commission_debt_cents')::bigint=greatest(0,debt_rand-payment_rand)*100
      and (position->>'unapplied_credit_cents')::bigint=greatest(0,payment_rand-debt_rand)*100,'Debt and unapplied credit exact after recovery R'||payment_rand);
    perform pg_temp.p2_assert(position->>'financially_eligible'='true','Financial restriction clears below R50 R'||payment_rand);
    perform pg_temp.p2_assert((select count(*)=1 from public.driver_settlements where payment_request_id=request_id)
      and (select count(*)=1 from public.financial_transactions where source_type='DRIVER_PAYMENT_REQUEST' and source_id=request_id)
      and (select count(*)=1 from public.moovu_business_events where event_key='payment-review:'||request_id||':approved')
      and (select count(*)=1 from public.moovu_notification_outbox o join public.moovu_business_events b on b.id=o.business_event_id
        where b.event_key='payment-review:'||request_id||':approved'),'One settlement ledger payment and notification logical event R'||payment_rand);
    if debt_rand=59 then
      reversal:=public.phase1_reverse_financial_transaction((result->>'transaction_id')::uuid,'fixture-reversal:'||request_id,repeat('b',64),owner_id,'Disposable reversal');
      again:=public.phase1_reverse_financial_transaction((result->>'transaction_id')::uuid,'fixture-reversal:'||request_id,repeat('b',64),owner_id,'Disposable reversal');
      perform pg_temp.p2_assert(reversal->>'transaction_id'=again->>'transaction_id' and again->>'replayed'='true','Reversal replay is idempotent');
      perform pg_temp.p2_assert((public.phase2_driver_finance_position(payment_driver)->>'commission_debt_cents')='5900','Payment reversal restores debt');
      denied:=false;
      begin perform public.phase1_reverse_financial_transaction((result->>'transaction_id')::uuid,'fixture-reversal-second:'||request_id,repeat('c',64),owner_id,'Disposable duplicate reversal');
        exception when raise_exception or unique_violation then denied:=true; end;
      perform pg_temp.p2_assert(denied,'Second reversal under different key denied');
    end if;
  end loop;
  perform pg_temp.p2_assert(not exists(select 1 from public.financial_transactions t left join public.financial_ledger_entries e on e.transaction_id=t.id
    where t.transaction_state='POSTED' group by t.id having count(e.id)<2 or coalesce(sum(case e.entry_side when 'DEBIT' then e.amount_cents else -e.amount_cents end),0)<>0),
    'All posted transactions balanced and complete');
  perform pg_temp.p2_assert(not exists(select 1 from public.financial_transactions where transaction_state='PENDING'),'No pending partial financial transactions');
end $$;
set constraints all immediate;
select * from phase2_financial_results order by check_name;
rollback;
