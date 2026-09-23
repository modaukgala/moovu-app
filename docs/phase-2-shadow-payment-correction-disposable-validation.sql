-- DISPOSABLE ONLY: tangtlmdpnvmoviwrgvd. All fixtures roll back.
begin;
create temporary table phase2_correction_results(check_name text,result text);
create function pg_temp.ok(v boolean,n text) returns void language plpgsql as $$ begin
  if v is distinct from true then raise exception 'Correction check failed: %',n; end if;
  insert into phase2_correction_results values(n,'PASS');
end $$;
do $$
declare actor uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); historical uuid:=gen_random_uuid(); future uuid:=gen_random_uuid();
  cutoff timestamptz:=date_trunc('second',now()); r jsonb; again jsonb; before_tx bigint; before_entries bigint; denied boolean:=false;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  insert into auth.users(id) values(actor);
  insert into public.profiles(id,role) values(actor,'owner');
  insert into public.drivers(id,status,subscription_status,subscription_expires_at) values(d,'approved','active',now()+interval '1 day');
  update public.phase2_finance_policy set mode='SHADOW',effective_from=cutoff where policy_key='phase2-driver-finance';
  insert into public.driver_payment_requests(id,driver_id,payment_type,amount_submitted,status,reviewed_at,reviewed_by,commission_amount_applied,unapplied_excess)
  values(historical,d,'commission',104.60,'approved',cutoff-interval '1 day',actor,104.60,0);
  before_tx:=(select count(*) from public.financial_transactions); before_entries:=(select count(*) from public.financial_ledger_entries);
  r:=public.phase2_post_verified_driver_payment(historical,actor);
  again:=public.phase2_post_verified_driver_payment(historical,actor);
  perform pg_temp.ok(r->>'posting_outcome'='PRE_CUTOFF_SKIPPED' and r->>'posted'='false' and again->>'replayed'='true','Historical R104.60 deterministically skipped');
  perform pg_temp.ok(before_tx=(select count(*) from public.financial_transactions) and before_entries=(select count(*) from public.financial_ledger_entries),'Historical replay financially neutral');
  perform pg_temp.ok(not exists(select 1 from public.financial_transactions where source_id=historical),'No historical payment transaction');
  perform pg_temp.ok((select ledger_amount_cents=0 from public.phase2_shadow_reconciliations where operation_key='driver_payment:'||historical),'Historical skip persisted');
  insert into public.driver_payment_requests(id,driver_id,payment_type,amount_submitted,status,reviewed_at,reviewed_by,commission_amount_applied,unapplied_excess)
  values(future,d,'commission',60,'approved',cutoff,actor,0,60);
  r:=public.phase2_post_verified_driver_payment(future,actor); again:=public.phase2_post_verified_driver_payment(future,actor);
  perform pg_temp.ok(r->>'applied_cents'='0' and r->>'unapplied_cents'='6000','Post-cutoff zero-debt payment becomes unapplied credit');
  perform pg_temp.ok(r->>'transaction_id'=again->>'transaction_id' and again->>'replayed'='true','Third retry remains one financial effect');
  perform pg_temp.ok((public.phase2_driver_finance_position(d)->>'commission_debt_cents')='0','Commission debt floor preserved');
  perform pg_temp.ok((public.phase2_driver_finance_position(d)->>'unapplied_credit_cents')='6000','Unapplied credit exact once');
  begin update public.phase2_finance_policy set effective_from=cutoff+interval '1 second' where policy_key='phase2-driver-finance'; exception when raise_exception then denied:=true; end;
  perform pg_temp.ok(denied,'Non-null cutoff immutable');
end $$;
set constraints all immediate;
select * from phase2_correction_results order by check_name;
rollback;
