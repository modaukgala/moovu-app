-- Disposable correction after initial migration smoke test; the release package includes this fix inline.
begin;
create or replace function public.phase4b_post_assessment(p_assessment_id uuid,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.phase4_fee_assessments;t public.trips;v_tx uuid;v_receivable public.financial_accounts;
  v_payable public.financial_accounts;v_clearing public.financial_accounts;v_key text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required';end if;
  select * into a from public.phase4_fee_assessments where id=p_assessment_id;
  if not found then raise exception 'Assessment missing';end if;
  select * into t from public.trips where id=a.trip_id for update;
  if t.status<>'cancelled' or t.customer_id is distinct from a.customer_id or t.driver_id is distinct from a.driver_id
    or (a.fee_type='NO_SHOW' and t.cancellation_type<>'no_show')
    or (a.fee_type='LATE_CANCELLATION' and t.cancellation_type<>'late_cancel') then
    raise exception 'Terminal trip state does not match Phase 4 assessment';end if;
  v_key:='phase4:assessment:'||a.id;
  select id into v_tx from public.financial_transactions where idempotency_key=v_key;
  if found then
    if not exists(select 1 from public.financial_transactions where id=v_tx and source_type='PHASE4_ASSESSMENT'
      and source_id=a.id and transaction_state='POSTED') then raise exception 'Conflicting posting replay';end if;
    return v_tx;
  end if;
  v_receivable:=public.phase1_ensure_financial_account('PHASE4:RECEIVABLE:'||a.customer_id,
    'CANCELLATION_NO_SHOW_RECEIVABLE','CUSTOMER',a.customer_id,'DEBIT','ZAR');
  v_payable:=public.phase1_ensure_financial_account('PHASE4:PAYABLE:'||a.driver_id,
    'DRIVER_COMPENSATION_PAYABLE','DRIVER',a.driver_id,'CREDIT','ZAR');
  select * into v_clearing from public.financial_accounts
    where account_category='ADJUSTMENT_CLEARING' and owner_type='PLATFORM' and owner_id is null
      and currency='ZAR' and normal_balance_side='CREDIT' and account_status='ACTIVE' for update;
  if not found then
    v_clearing:=public.phase1_ensure_financial_account('PHASE4:ASSESSMENT:CLEARING',
      'ADJUSTMENT_CLEARING','PLATFORM',null,'CREDIT','ZAR');
  end if;
  -- Phase 1 itself owns the posting state and deferred balance check.
  -- Its source and terminal guards are extended in this migration below.
  select (public.phase1_post_financial_transaction(v_key,
    encode(sha256(convert_to(a.id::text||':'||a.fee_cents||':'||a.driver_cents||':'||a.moovu_cents,'UTF8')),'hex'),
    case when a.fee_type='NO_SHOW' then 'NO_SHOW_FEE' else 'CANCELLATION_FEE' end,
    'PHASE4_ASSESSMENT',a.id,'ZAR','SYSTEM',p_actor_id,a.assessed_at,
    jsonb_build_array(jsonb_build_object('account_id',v_receivable.id,'entry_side','DEBIT','amount_cents',a.fee_cents),
      jsonb_build_object('account_id',v_payable.id,'entry_side','CREDIT','amount_cents',a.driver_cents),
      jsonb_build_object('account_id',v_clearing.id,'entry_side','CREDIT','amount_cents',a.moovu_cents)),
    jsonb_build_object('phase4_assessment_id',a.id,'recognition','ASSESSMENT_CLEARING')) ->> 'transaction_id')::uuid into v_tx;
  return v_tx;
end $$;
commit;
