-- DISPOSABLE ONLY: tangtlmdpnvmoviwrgvd. Requires verified targeting and security PASS.
-- Commits synthetic fixtures for independent-session concurrency checks.
-- Preserve the resulting financial evidence; restore policy OFF after verification.
begin;
create temporary table phase2_concurrency_fixture(actor_id uuid,driver_id uuid,request_id uuid,legacy_result jsonb);
do $$
declare actor uuid:=gen_random_uuid(); driver uuid:=gen_random_uuid(); request uuid:=gen_random_uuid(); wallet uuid:=gen_random_uuid();
  debt public.financial_accounts; clearing public.financial_accounts; legacy jsonb;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  insert into auth.users(id) values(actor);
  insert into public.profiles(id,role) values(actor,'owner');
  insert into public.drivers(id,first_name,status,subscription_status,subscription_expires_at)
    values(driver,'PHASE2 DISPOSABLE CONCURRENCY','approved','active',now()+interval '1 day');
  insert into public.driver_wallets(id,driver_id,balance_due) values(wallet,driver,40);
  insert into public.driver_wallet_transactions(driver_id,wallet_id,tx_type,amount,direction,description)
    values(driver,wallet,'commission',40,'debit','Phase 2 disposable concurrency opening');
  debt:=public.phase1_ensure_financial_account('DRIVER:'||upper(driver::text)||':COMMISSION_DEBT:ZAR',
    'DRIVER_COMMISSION_DEBT','DRIVER',driver,'DEBIT','ZAR');
  clearing:=public.phase1_ensure_financial_account('PLATFORM:ADJUSTMENT_CLEARING:ZAR',
    'ADJUSTMENT_CLEARING','PLATFORM',null,'CREDIT','ZAR');
  perform public.phase1_post_financial_transaction('phase2-opening:'||driver,repeat('a',64),
    'ADJUSTMENT','ADJUSTMENT',driver,'ZAR','OWNER',actor,now(),jsonb_build_array(
      jsonb_build_object('account_id',debt.id,'entry_side','DEBIT','amount_cents',4000),
      jsonb_build_object('account_id',clearing.id,'entry_side','CREDIT','amount_cents',4000)),
    jsonb_build_object('event','opening_balance','driver_id',driver,'cutoff_at',now(),'fixture',true),null);
  insert into public.driver_payment_requests(id,driver_id,payment_type,amount_submitted,status,note)
    values(request,driver,'commission',60,'pending_payment_review','Phase 2 disposable concurrency');
  update public.phase2_finance_policy set mode='SHADOW',effective_from=now()-interval '1 minute'
    where policy_key='phase2-driver-finance';
  legacy:=public.phase05b_review_driver_payment(request,'approve',null,actor);
  -- Deliberately leave no shadow posting: reproduces process loss after legacy commit.
  if exists(select 1 from public.financial_transactions where source_type='DRIVER_PAYMENT_REQUEST' and source_id=request)
    then raise exception 'Unexpected shadow effect before concurrency test'; end if;
  insert into phase2_concurrency_fixture values(actor,driver,request,legacy);
end $$;
select * from phase2_concurrency_fixture;
commit;
