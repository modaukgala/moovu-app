-- MOOVU Phase 2 shadow payment cutoff and debt-floor correction.
-- ADDITIVE REVIEW ARTIFACT. DO NOT APPLY TO PRODUCTION WITHOUT SEPARATE APPROVAL.

begin;

do $$ begin
  if to_regclass('public.phase2_finance_policy') is null
    or to_regclass('public.phase2_shadow_reconciliations') is null
    or to_regclass('public.financial_accounts') is null
    or to_regclass('public.financial_transactions') is null
    or to_regclass('public.financial_ledger_entries') is null
    or to_regclass('public.driver_payment_requests') is null
  then raise exception 'Installed Phase 1 and Phase 2 prerequisites are required'; end if;
end $$;

-- A cutoff may be set once when Phase 2 is activated. Keeping it immutable makes
-- every payment decision stable across OFF/SHADOW/AUTHORITATIVE mode changes.
create or replace function public.phase2_guard_finance_policy_cutoff()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.effective_from is not null and new.effective_from is distinct from old.effective_from then
    raise exception 'Phase 2 effective cutoff is immutable';
  end if;
  return new;
end $$;

drop trigger if exists phase2_guard_finance_policy_cutoff_trigger on public.phase2_finance_policy;
create trigger phase2_guard_finance_policy_cutoff_trigger
before update of effective_from on public.phase2_finance_policy
for each row execute function public.phase2_guard_finance_policy_cutoff();

-- This ledger-level invariant applies to every posting path. A transaction that
-- would make a Driver commission debt account negative is rolled back atomically.
create or replace function public.phase2_assert_driver_commission_debt_floor()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_account_id uuid; v_balance_cents bigint;
begin
  if new.transaction_state <> 'POSTED' then return new; end if;
  for v_account_id in
    select distinct e.account_id
    from public.financial_ledger_entries e
    join public.financial_accounts a on a.id=e.account_id
    where e.transaction_id=new.id
      and a.owner_type='DRIVER'
      and a.account_category='DRIVER_COMMISSION_DEBT'
  loop
    select coalesce(sum(case e.entry_side when 'DEBIT' then e.amount_cents else -e.amount_cents end),0)
      into v_balance_cents
    from public.financial_ledger_entries e
    join public.financial_transactions t on t.id=e.transaction_id and t.transaction_state='POSTED'
    where e.account_id=v_account_id;
    if v_balance_cents < 0 then
      raise exception 'Driver commission debt cannot be negative';
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists phase2_assert_driver_commission_debt_floor_insert_trigger on public.financial_transactions;
create trigger phase2_assert_driver_commission_debt_floor_insert_trigger
after insert on public.financial_transactions
for each row execute function public.phase2_assert_driver_commission_debt_floor();
drop trigger if exists phase2_assert_driver_commission_debt_floor_update_trigger on public.financial_transactions;
create trigger phase2_assert_driver_commission_debt_floor_update_trigger
after update of transaction_state on public.financial_transactions
for each row execute function public.phase2_assert_driver_commission_debt_floor();

create or replace function public.phase2_post_verified_driver_payment(p_request_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_request public.driver_payment_requests; v_debt public.financial_accounts;
        v_credit public.financial_accounts; v_clearing public.financial_accounts;
        v_existing_tx public.financial_transactions; v_decision public.phase2_shadow_reconciliations;
        v_debt_cents bigint:=0; v_applied bigint; v_unapplied bigint; v_total bigint;
        v_entries jsonb; v_payload jsonb; v_hash text; v_result jsonb;
        v_role text; v_policy public.phase2_finance_policy; v_operation_key text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if p_actor_id is null then raise exception 'Owner or Admin actor identity required'; end if;
  select role into v_role from public.profiles where id=p_actor_id;
  if v_role is null or v_role not in ('owner','admin') then raise exception 'Owner or Admin actor required'; end if;

  select * into strict v_policy from public.phase2_finance_policy where policy_key='phase2-driver-finance';
  if v_policy.mode='OFF' then raise exception 'Phase 2 is OFF'; end if;
  if v_policy.effective_from is null then raise exception 'Phase 2 effective cutoff is required'; end if;

  select * into strict v_request from public.driver_payment_requests where id=p_request_id for update;
  if v_request.status<>'approved' then raise exception 'Approved payment required'; end if;
  if v_request.reviewed_at is null then raise exception 'Approved payment review timestamp is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||v_request.driver_id::text,0));
  v_operation_key:='driver_payment:'||v_request.id::text;
  v_total:=round((coalesce(v_request.commission_amount_applied,0)+coalesce(v_request.unapplied_excess,0))*100)::bigint;
  if v_total<=0 then raise exception 'No commission payment value to post'; end if;

  -- Return a previously posted allocation before looking at today's balance.
  select * into v_existing_tx from public.financial_transactions where idempotency_key=v_operation_key;
  if found then
    if v_existing_tx.transaction_type<>'DRIVER_PAYMENT'
      or v_existing_tx.source_type<>'DRIVER_PAYMENT_REQUEST'
      or v_existing_tx.source_id<>v_request.id then
      raise exception 'Conflicting payment shadow operation';
    end if;
    return jsonb_build_object('contract_version',public.phase2_contract_version(),
      'request_id',v_request.id,'driver_id',v_request.driver_id,'posting_outcome','POSTED',
      'posted',true,'replayed',true,'payment_effective_at',v_request.reviewed_at,
      'policy_effective_from',v_policy.effective_from,
      'applied_cents',coalesce((v_existing_tx.metadata->>'applied_cents')::bigint,0),
      'unapplied_cents',coalesce((v_existing_tx.metadata->>'unapplied_cents')::bigint,0),
      'transaction_id',v_existing_tx.id,'state',v_existing_tx.transaction_state);
  end if;

  -- A persisted skip remains a skip even if this request is replayed later.
  select * into v_decision from public.phase2_shadow_reconciliations where operation_key=v_operation_key;
  if found and v_decision.details->>'posting_outcome'='PRE_CUTOFF_SKIPPED' then
    return jsonb_build_object('contract_version',public.phase2_contract_version(),
      'request_id',v_request.id,'driver_id',v_request.driver_id,'posting_outcome','PRE_CUTOFF_SKIPPED',
      'posted',false,'replayed',true,'payment_effective_at',v_request.reviewed_at,
      'policy_effective_from',v_decision.details->>'policy_effective_from',
      'applied_cents',0,'unapplied_cents',0);
  end if;

  if v_request.reviewed_at < v_policy.effective_from then
    v_payload:=jsonb_build_object('posting_outcome','PRE_CUTOFF_SKIPPED',
      'request_id',v_request.id,'driver_id',v_request.driver_id,
      'payment_effective_at',v_request.reviewed_at,'policy_id',v_policy.id,
      'policy_effective_from',v_policy.effective_from,'verified_commission_cents',v_total);
    insert into public.phase2_shadow_reconciliations(operation_key,source_type,source_id,driver_id,
      legacy_amount_cents,ledger_amount_cents,parity,details)
    values(v_operation_key,'DRIVER_PAYMENT_REQUEST',v_request.id,v_request.driver_id,v_total,0,true,v_payload)
    on conflict(operation_key) do nothing;
    return jsonb_build_object('contract_version',public.phase2_contract_version(),
      'request_id',v_request.id,'driver_id',v_request.driver_id,'posting_outcome','PRE_CUTOFF_SKIPPED',
      'posted',false,'replayed',false,'payment_effective_at',v_request.reviewed_at,
      'policy_effective_from',v_policy.effective_from,'applied_cents',0,'unapplied_cents',0);
  end if;

  select coalesce(sum(case e.entry_side when 'DEBIT' then e.amount_cents else -e.amount_cents end),0)
    into v_debt_cents
  from public.financial_ledger_entries e
  join public.financial_transactions t on t.id=e.transaction_id and t.transaction_state='POSTED'
  join public.financial_accounts a on a.id=e.account_id
  where a.owner_type='DRIVER' and a.owner_id=v_request.driver_id
    and a.account_category='DRIVER_COMMISSION_DEBT' and a.currency='ZAR';
  v_debt_cents:=greatest(v_debt_cents,0);
  v_applied:=least(v_total,v_debt_cents);
  v_unapplied:=v_total-v_applied;

  v_clearing:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts where owner_type='PLATFORM' and owner_id is null
      and account_category='PAYMENT_CLEARING' and currency='ZAR'),'PLATFORM:PAYMENT_CLEARING:ZAR'),
    'PAYMENT_CLEARING','PLATFORM',null,'DEBIT','ZAR');
  v_debt:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts where owner_type='DRIVER' and owner_id=v_request.driver_id
      and account_category='DRIVER_COMMISSION_DEBT' and currency='ZAR'),
      'DRIVER:'||upper(v_request.driver_id::text)||':COMMISSION_DEBT:ZAR'),
    'DRIVER_COMMISSION_DEBT','DRIVER',v_request.driver_id,'DEBIT','ZAR');
  v_credit:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts where owner_type='DRIVER' and owner_id=v_request.driver_id
      and account_category='DRIVER_UNAPPLIED_CREDIT' and currency='ZAR'),
      'DRIVER:'||upper(v_request.driver_id::text)||':UNAPPLIED_CREDIT:ZAR'),
    'DRIVER_UNAPPLIED_CREDIT','DRIVER',v_request.driver_id,'CREDIT','ZAR');

  v_entries:=jsonb_build_array(jsonb_build_object('account_id',v_clearing.id,'entry_side','DEBIT','amount_cents',v_total));
  if v_applied>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('account_id',v_debt.id,'entry_side','CREDIT','amount_cents',v_applied)); end if;
  if v_unapplied>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('account_id',v_credit.id,'entry_side','CREDIT','amount_cents',v_unapplied)); end if;
  v_payload:=jsonb_build_object('posting_outcome','POSTED','request_id',v_request.id,'driver_id',v_request.driver_id,
    'payment_effective_at',v_request.reviewed_at,'policy_id',v_policy.id,'policy_effective_from',v_policy.effective_from,
    'verified_commission_cents',v_total,'debt_before_cents',v_debt_cents,
    'applied_cents',v_applied,'unapplied_cents',v_unapplied);
  v_hash:=encode(pg_catalog.sha256(convert_to(v_payload::text,'UTF8')),'hex');
  v_result:=public.phase1_post_financial_transaction(v_operation_key,v_hash,'DRIVER_PAYMENT',
    'DRIVER_PAYMENT_REQUEST',v_request.id,'ZAR','ADMIN',p_actor_id,v_request.reviewed_at,v_entries,v_payload,null);
  insert into public.phase2_shadow_reconciliations(operation_key,source_type,source_id,driver_id,
    legacy_amount_cents,ledger_amount_cents,parity,details)
  values(v_operation_key,'DRIVER_PAYMENT_REQUEST',v_request.id,v_request.driver_id,v_total,v_total,true,v_payload)
  on conflict(operation_key) do update set legacy_amount_cents=excluded.legacy_amount_cents,
    ledger_amount_cents=excluded.ledger_amount_cents,parity=excluded.parity,details=excluded.details;
  return v_result||jsonb_build_object('contract_version',public.phase2_contract_version(),
    'request_id',v_request.id,'driver_id',v_request.driver_id,'posting_outcome','POSTED',
    'posted',true,'payment_effective_at',v_request.reviewed_at,'policy_effective_from',v_policy.effective_from,
    'applied_cents',v_applied,'unapplied_cents',v_unapplied);
end $$;

revoke all on function public.phase2_guard_finance_policy_cutoff() from public,anon,authenticated,service_role;
revoke all on function public.phase2_assert_driver_commission_debt_floor() from public,anon,authenticated,service_role;
revoke all on function public.phase2_post_verified_driver_payment(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.phase2_post_verified_driver_payment(uuid,uuid) to service_role;

commit;
