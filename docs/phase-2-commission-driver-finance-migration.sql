-- MOOVU Phase 2 commission and Driver finance
-- REVIEW ONLY / DISPOSABLE VALIDATION ONLY / NOT FOR PRODUCTION EXECUTION.
-- Additive package. It does not rewrite historical trips or activate Phase 2.

begin;

do $$ begin
  if to_regclass('public.trips') is null
    or to_regclass('public.drivers') is null
    or to_regclass('public.financial_accounts') is null
    or to_regclass('public.financial_transactions') is null
    or to_regclass('public.financial_ledger_entries') is null
  then raise exception 'Phase 0 and Phase 1 prerequisites are required'; end if;
end $$;

alter table public.trips
  add column if not exists commission_policy_id uuid,
  add column if not exists commission_basis_points integer,
  add column if not exists commission_rounding_version text,
  add column if not exists commission_locked_at timestamptz;

create table if not exists public.phase2_finance_policy (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null unique,
  mode text not null check (mode in ('OFF','SHADOW','AUTHORITATIVE')),
  go_basis_points integer not null check (go_basis_points between 0 and 10000),
  go_xl_basis_points integer not null check (go_xl_basis_points between 0 and 10000),
  debt_limit_cents bigint not null check (debt_limit_cents > 0),
  warning_cents bigint not null check (warning_cents >= 0 and warning_cents < debt_limit_cents),
  subscription_required boolean not null,
  effective_from timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (mode='OFF' or effective_from is not null)
);

insert into public.phase2_finance_policy(
  policy_key,mode,go_basis_points,go_xl_basis_points,debt_limit_cents,warning_cents,subscription_required,effective_from
) values ('phase2-driver-finance','OFF',1500,1500,5000,4000,true,null)
on conflict(policy_key) do nothing;

create table if not exists public.phase2_shadow_reconciliations (
  id uuid primary key default gen_random_uuid(),
  operation_key text not null unique,
  source_type text not null,
  source_id uuid not null,
  driver_id uuid references public.drivers(id) on delete restrict,
  legacy_amount_cents bigint,
  ledger_amount_cents bigint,
  parity boolean not null,
  error_code text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
  created_at timestamptz not null default now()
);

create table if not exists public.phase2_historical_finance_exceptions (
  id uuid primary key default gen_random_uuid(),
  exception_key text not null unique,
  driver_id uuid references public.drivers(id) on delete restrict,
  source_type text not null,
  source_id uuid,
  cutoff_at timestamptz not null,
  legacy_calculated_cents bigint,
  reconciled_opening_cents bigint,
  status text not null default 'OPEN' check (status in ('OPEN','REVIEWED','RESOLVED','EXCLUDED')),
  reason text not null check (length(trim(reason)) >= 3),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.phase2_finance_policy enable row level security;
alter table public.phase2_shadow_reconciliations enable row level security;
alter table public.phase2_historical_finance_exceptions enable row level security;
revoke all on public.phase2_finance_policy,public.phase2_shadow_reconciliations,
  public.phase2_historical_finance_exceptions from public,anon,authenticated;
revoke all on public.phase2_finance_policy,public.phase2_shadow_reconciliations,
  public.phase2_historical_finance_exceptions from service_role;
grant select on public.phase2_finance_policy,public.phase2_shadow_reconciliations,
  public.phase2_historical_finance_exceptions to service_role;

create or replace function public.phase2_contract_version()
returns text language sql immutable set search_path=public,pg_temp as $$ select 'phase-2-v1'::text $$;

create or replace function public.phase2_current_policy()
returns public.phase2_finance_policy language plpgsql security definer set search_path=public,pg_temp as $$
declare v_policy public.phase2_finance_policy;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into strict v_policy from public.phase2_finance_policy where policy_key='phase2-driver-finance';
  return v_policy;
end $$;

create or replace function public.phase2_lock_trip_commission_snapshot(p_trip_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_trip public.trips; v_policy public.phase2_finance_policy; v_bps integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into strict v_policy from public.phase2_finance_policy where policy_key='phase2-driver-finance';
  if v_policy.mode='OFF' then raise exception 'Phase 2 is OFF'; end if;
  select * into strict v_trip from public.trips where id=p_trip_id for update;
  if v_trip.commission_locked_at is not null then
    return jsonb_build_object('contract_version',public.phase2_contract_version(),'trip_id',v_trip.id,
      'policy_id',v_trip.commission_policy_id,'basis_points',v_trip.commission_basis_points,'replayed',true);
  end if;
  if v_policy.effective_from is null or v_trip.created_at < v_policy.effective_from then
    raise exception 'Trip predates Phase 2 policy';
  end if;
  v_bps:=case when lower(coalesce(v_trip.ride_option,'')) in ('go xl','go_xl','xl','group')
    then v_policy.go_xl_basis_points else v_policy.go_basis_points end;
  update public.trips set commission_policy_id=v_policy.id,commission_basis_points=v_bps,
    commission_rounding_version='integer-cent-half-up-v1',commission_locked_at=now()
    where id=v_trip.id;
  return jsonb_build_object('contract_version',public.phase2_contract_version(),'trip_id',v_trip.id,
    'policy_id',v_policy.id,'basis_points',v_bps,'replayed',false);
end $$;

create or replace function public.phase2_snapshot_new_trip()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_policy public.phase2_finance_policy;
begin
  select * into strict v_policy from public.phase2_finance_policy where policy_key='phase2-driver-finance';
  if v_policy.mode='OFF' or v_policy.effective_from is null or new.created_at < v_policy.effective_from then return new; end if;
  if new.commission_locked_at is not null then raise exception 'Commission snapshot is database controlled'; end if;
  new.commission_policy_id:=v_policy.id;
  new.commission_basis_points:=case when lower(coalesce(new.ride_option,'')) in ('go xl','go_xl','xl','group')
    then v_policy.go_xl_basis_points else v_policy.go_basis_points end;
  new.commission_rounding_version:='integer-cent-half-up-v1';
  new.commission_locked_at:=now();
  return new;
end $$;

drop trigger if exists phase2_snapshot_new_trip_trigger on public.trips;
create trigger phase2_snapshot_new_trip_trigger before insert on public.trips
for each row execute function public.phase2_snapshot_new_trip();

create or replace function public.phase2_guard_trip_commission_snapshot()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.commission_locked_at is not null and (
    new.commission_policy_id is distinct from old.commission_policy_id or
    new.commission_basis_points is distinct from old.commission_basis_points or
    new.commission_rounding_version is distinct from old.commission_rounding_version or
    new.commission_locked_at is distinct from old.commission_locked_at
  ) then raise exception 'Locked commission snapshot is immutable'; end if;
  return new;
end $$;

drop trigger if exists phase2_guard_trip_commission_snapshot_trigger on public.trips;
create trigger phase2_guard_trip_commission_snapshot_trigger before update on public.trips
for each row execute function public.phase2_guard_trip_commission_snapshot();

create or replace function public.phase2_driver_finance_position(p_driver_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_debt bigint:=0; v_credit bigint:=0; v_policy public.phase2_finance_policy;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into strict v_policy from public.phase2_finance_policy where policy_key='phase2-driver-finance';
  select coalesce(sum(case e.entry_side when 'DEBIT' then e.amount_cents else -e.amount_cents end),0)
    into v_debt from public.financial_ledger_entries e
    join public.financial_transactions t on t.id=e.transaction_id and t.transaction_state='POSTED'
    join public.financial_accounts a on a.id=e.account_id
    where a.owner_type='DRIVER' and a.owner_id=p_driver_id and a.account_category='DRIVER_COMMISSION_DEBT';
  select coalesce(sum(case e.entry_side when 'CREDIT' then e.amount_cents else -e.amount_cents end),0)
    into v_credit from public.financial_ledger_entries e
    join public.financial_transactions t on t.id=e.transaction_id and t.transaction_state='POSTED'
    join public.financial_accounts a on a.id=e.account_id
    where a.owner_type='DRIVER' and a.owner_id=p_driver_id and a.account_category='DRIVER_UNAPPLIED_CREDIT';
  v_debt:=greatest(v_debt,0); v_credit:=greatest(v_credit,0);
  return jsonb_build_object('contract_version',public.phase2_contract_version(),'mode',v_policy.mode,
    'driver_id',p_driver_id,'commission_debt_cents',v_debt,'unapplied_credit_cents',v_credit,
    'net_owed_cents',greatest(v_debt-v_credit,0),'debt_limit_cents',v_policy.debt_limit_cents,
    'financially_eligible',greatest(v_debt-v_credit,0)<v_policy.debt_limit_cents,
    'subscription_required',v_policy.subscription_required);
end $$;

create or replace function public.phase2_finance_eligibility(p_driver_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_policy public.phase2_finance_policy; v_position jsonb; v_driver public.drivers; v_legacy_cents bigint;
        v_phase2_eligible boolean; v_authoritative_eligible boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into strict v_policy from public.phase2_finance_policy where policy_key='phase2-driver-finance';
  select * into strict v_driver from public.drivers where id=p_driver_id;
  v_position:=public.phase2_driver_finance_position(p_driver_id);
  v_phase2_eligible:=(v_position->>'financially_eligible')::boolean;
  select greatest(round(coalesce(balance_due,0)*100),0)::bigint into v_legacy_cents
    from public.driver_wallets where driver_id=p_driver_id;
  v_legacy_cents:=coalesce(v_legacy_cents,0);
  if v_policy.mode='AUTHORITATIVE' then
    v_authoritative_eligible:=v_phase2_eligible;
  else
    v_authoritative_eligible:=v_legacy_cents<10000 and v_driver.subscription_status in ('active','grace')
      and v_driver.subscription_expires_at>now();
  end if;
  return v_position||jsonb_build_object('legacy_debt_cents',v_legacy_cents,
    'phase2_eligible',v_phase2_eligible,'authoritative_eligible',v_authoritative_eligible,
    'subscription_required',v_policy.mode<>'AUTHORITATIVE');
end $$;

create or replace function public.phase2_post_trip_commission(p_trip_id uuid,p_actor_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_policy public.phase2_finance_policy; v_trip public.trips; v_debt public.financial_accounts;
        v_revenue public.financial_accounts; v_fare_cents bigint; v_commission_cents bigint;
        v_entries jsonb; v_payload jsonb; v_hash text; v_result jsonb; v_legacy_cents bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into strict v_policy from public.phase2_finance_policy where policy_key='phase2-driver-finance';
  if v_policy.mode='OFF' then raise exception 'Phase 2 is OFF'; end if;
  select * into strict v_trip from public.trips where id=p_trip_id for update;
  if v_trip.status<>'completed' or v_trip.driver_id is null then raise exception 'Completed assigned trip required'; end if;
  if v_trip.commission_locked_at is null or v_trip.commission_policy_id<>v_policy.id
    or v_trip.commission_basis_points is null then raise exception 'Valid locked commission snapshot required'; end if;
  v_fare_cents:=round(coalesce(v_trip.final_fare,v_trip.fare_amount,0)*100)::bigint;
  if v_fare_cents<=0 then raise exception 'Positive final fare required'; end if;
  v_commission_cents:=(v_fare_cents*v_trip.commission_basis_points+5000)/10000;
  if v_commission_cents<=0 then raise exception 'Positive commission required'; end if;
  v_debt:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts where owner_type='DRIVER'
      and owner_id=v_trip.driver_id and account_category='DRIVER_COMMISSION_DEBT' and currency='ZAR'),
      'DRIVER:'||upper(v_trip.driver_id::text)||':COMMISSION_DEBT:ZAR'),'DRIVER_COMMISSION_DEBT',
    'DRIVER',v_trip.driver_id,'DEBIT','ZAR');
  v_revenue:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts where owner_type='PLATFORM'
      and owner_id is null and account_category='COMMISSION_REVENUE' and currency='ZAR'),
      'PLATFORM:COMMISSION_REVENUE:ZAR'),'COMMISSION_REVENUE','PLATFORM',null,'CREDIT','ZAR');
  v_entries:=jsonb_build_array(
    jsonb_build_object('account_id',v_debt.id,'entry_side','DEBIT','amount_cents',v_commission_cents),
    jsonb_build_object('account_id',v_revenue.id,'entry_side','CREDIT','amount_cents',v_commission_cents));
  v_payload:=jsonb_build_object('trip_id',v_trip.id,'driver_id',v_trip.driver_id,'fare_cents',v_fare_cents,
    'commission_basis_points',v_trip.commission_basis_points,'commission_cents',v_commission_cents,
    'rounding_version',v_trip.commission_rounding_version);
  v_hash:=encode(pg_catalog.sha256(convert_to(v_payload::text,'UTF8')),'hex');
  v_result:=public.phase1_post_financial_transaction('trip_commission:'||v_trip.id::text,v_hash,
    'TRIP_FINANCIAL_COMPLETION','TRIP',v_trip.id,'ZAR','SYSTEM',p_actor_id,now(),v_entries,v_payload,null);
  v_legacy_cents:=round(coalesce(v_trip.commission_amount,0)*100)::bigint;
  insert into public.phase2_shadow_reconciliations(operation_key,source_type,source_id,driver_id,
    legacy_amount_cents,ledger_amount_cents,parity,details)
  values('trip_commission:'||v_trip.id::text,'TRIP',v_trip.id,v_trip.driver_id,v_legacy_cents,
    v_commission_cents,v_legacy_cents=v_commission_cents,v_payload)
  on conflict(operation_key) do update set legacy_amount_cents=excluded.legacy_amount_cents,
    ledger_amount_cents=excluded.ledger_amount_cents,parity=excluded.parity,details=excluded.details;
  return v_result||jsonb_build_object('contract_version',public.phase2_contract_version(),
    'trip_id',v_trip.id,'commission_cents',v_commission_cents,'legacy_commission_cents',v_legacy_cents,
    'parity',v_legacy_cents=v_commission_cents);
end $$;

create or replace function public.phase2_post_verified_driver_payment(p_request_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_request public.driver_payment_requests; v_debt public.financial_accounts;
        v_credit public.financial_accounts; v_clearing public.financial_accounts;
        v_applied bigint; v_unapplied bigint; v_total bigint; v_entries jsonb; v_payload jsonb;
        v_hash text; v_result jsonb; v_role text; v_policy public.phase2_finance_policy;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if p_actor_id is null then raise exception 'Owner or Admin actor identity required'; end if;
  select role into v_role from public.profiles where id=p_actor_id;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'Owner or Admin actor required';
  end if;
  select * into strict v_policy from public.phase2_finance_policy where policy_key='phase2-driver-finance';
  if v_policy.mode='OFF' then raise exception 'Phase 2 is OFF'; end if;
  select * into strict v_request from public.driver_payment_requests where id=p_request_id for update;
  if v_request.status<>'approved' then raise exception 'Approved payment required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||v_request.driver_id::text,0));
  v_applied:=round(coalesce(v_request.commission_amount_applied,0)*100)::bigint;
  v_unapplied:=round(coalesce(v_request.unapplied_excess,0)*100)::bigint;
  v_total:=v_applied+v_unapplied;
  if v_total<=0 then raise exception 'No commission payment value to post'; end if;
  -- Preserve compatible Phase 1 accounts; the protected helper validates their full contract.
  v_clearing:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts where owner_type='PLATFORM'
      and owner_id is null and account_category='PAYMENT_CLEARING' and currency='ZAR'),
      'PLATFORM:PAYMENT_CLEARING:ZAR'),'PAYMENT_CLEARING','PLATFORM',null,'DEBIT','ZAR');
  v_debt:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts where owner_type='DRIVER'
      and owner_id=v_request.driver_id and account_category='DRIVER_COMMISSION_DEBT' and currency='ZAR'),
      'DRIVER:'||upper(v_request.driver_id::text)||':COMMISSION_DEBT:ZAR'),
    'DRIVER_COMMISSION_DEBT','DRIVER',v_request.driver_id,'DEBIT','ZAR');
  v_credit:=public.phase1_ensure_financial_account(
    coalesce((select account_code from public.financial_accounts where owner_type='DRIVER'
      and owner_id=v_request.driver_id and account_category='DRIVER_UNAPPLIED_CREDIT' and currency='ZAR'),
      'DRIVER:'||upper(v_request.driver_id::text)||':UNAPPLIED_CREDIT:ZAR'),
    'DRIVER_UNAPPLIED_CREDIT','DRIVER',v_request.driver_id,'CREDIT','ZAR');
  v_entries:=jsonb_build_array(jsonb_build_object('account_id',v_clearing.id,'entry_side','DEBIT','amount_cents',v_total));
  if v_applied>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('account_id',v_debt.id,'entry_side','CREDIT','amount_cents',v_applied)); end if;
  if v_unapplied>0 then v_entries:=v_entries||jsonb_build_array(jsonb_build_object('account_id',v_credit.id,'entry_side','CREDIT','amount_cents',v_unapplied)); end if;
  v_payload:=jsonb_build_object('request_id',v_request.id,'driver_id',v_request.driver_id,
    'applied_cents',v_applied,'unapplied_cents',v_unapplied);
  v_hash:=encode(pg_catalog.sha256(convert_to(v_payload::text,'UTF8')),'hex');
  v_result:=public.phase1_post_financial_transaction('driver_payment:'||v_request.id::text,v_hash,'DRIVER_PAYMENT',
    'DRIVER_PAYMENT_REQUEST',v_request.id,'ZAR','ADMIN',p_actor_id,now(),v_entries,v_payload,null);
  return v_result||jsonb_build_object('contract_version',public.phase2_contract_version(),
    'request_id',v_request.id,'driver_id',v_request.driver_id,'applied_cents',v_applied,'unapplied_cents',v_unapplied);
end $$;

revoke all on function public.phase2_contract_version() from public,anon,authenticated;
revoke execute on function public.phase2_snapshot_new_trip() from public,anon,authenticated;
revoke execute on function public.phase2_guard_trip_commission_snapshot() from public,anon,authenticated;
revoke all on function public.phase2_current_policy() from public,anon,authenticated;
revoke all on function public.phase2_lock_trip_commission_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.phase2_driver_finance_position(uuid) from public,anon,authenticated;
revoke all on function public.phase2_finance_eligibility(uuid) from public,anon,authenticated;
revoke all on function public.phase2_post_trip_commission(uuid,uuid) from public,anon,authenticated;
revoke all on function public.phase2_post_verified_driver_payment(uuid,uuid) from public,anon,authenticated;
grant execute on function public.phase2_contract_version() to service_role;
grant execute on function public.phase2_current_policy() to service_role;
grant execute on function public.phase2_lock_trip_commission_snapshot(uuid) to service_role;
grant execute on function public.phase2_driver_finance_position(uuid) to service_role;
grant execute on function public.phase2_finance_eligibility(uuid) to service_role;
grant execute on function public.phase2_post_trip_commission(uuid,uuid) to service_role;
grant execute on function public.phase2_post_verified_driver_payment(uuid,uuid) to service_role;

commit;
