-- MOOVU driver settlement: payouts, bank details, netting and the R100 commission lock.
--
-- Rules (owner-approved 2026-11-25):
--   * Commission is 15% on every ride option.
--   * Cash trip  -> driver keeps the fare, owes MOOVU 15% (DRIVER_COMMISSION_DEBT).
--   * Card trip  -> MOOVU holds the fare, owes the driver 85% (DRIVER_EARNINGS_PAYABLE).
--   * One balance per driver:
--       net = card earnings payable - payouts already paid + unapplied credit - commission debt
--     net > 0  -> payout due to the driver (outstanding commission is already deducted)
--     net < 0  -> driver owes MOOVU
--   * A driver who owes R100 or more cannot go online or receive trips.
--   * Only the new ledger is used. The old subscription wallet (driver_wallets) is ignored,
--     so it can no longer lock drivers out.
--
-- Apply this migration on its own (not with other pending files), first on a
-- disposable/staging copy, then production.

-- 1. Policy: 15% commission and R100 lock --------------------------------------
update public.phase2_finance_policy
   set go_basis_points = 1500,
       go_xl_basis_points = 1500,
       warning_cents = 7000,
       debt_limit_cents = 10000,
       updated_at = now()
 where policy_key = 'phase2-driver-finance';

-- 1b. Owner/test accounts exempt from the lock and from payouts ------------------
create table if not exists public.driver_finance_exemptions (
  driver_id uuid primary key references public.drivers(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.driver_finance_exemptions enable row level security;
revoke all on public.driver_finance_exemptions from anon, authenticated;
insert into public.driver_finance_exemptions(driver_id, reason)
  select id, 'Owner test account (Kgalaletso Modau)' from public.drivers
   where id = '6fe679ab-8065-48cc-84b0-5ddd56e300b6'
on conflict (driver_id) do nothing;

-- 2. Driver bank details -------------------------------------------------------
create table if not exists public.driver_payout_accounts (
  driver_id uuid primary key references public.drivers(id) on delete cascade,
  account_holder text not null check (length(trim(account_holder)) between 2 and 120),
  bank_name text not null check (length(trim(bank_name)) between 2 and 80),
  account_number text not null check (account_number ~ '^[0-9]{6,16}$'),
  branch_code text not null check (branch_code ~ '^[0-9]{6}$'),
  account_type text not null default 'cheque' check (account_type in ('cheque','savings','transmission')),
  verified_by_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.driver_payout_accounts enable row level security;
-- All reads/writes go through server API routes with the service role.
revoke all on public.driver_payout_accounts from anon, authenticated;

-- 3. Payouts ---------------------------------------------------------------------
create table if not exists public.driver_payouts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id),
  amount_cents bigint not null check (amount_cents > 0),
  reference text,
  bank_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'paid' check (status in ('paid','reversed')),
  paid_at timestamptz not null default now(),
  recorded_by uuid,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists driver_payouts_driver_idx on public.driver_payouts(driver_id, paid_at desc);
alter table public.driver_payouts enable row level security;
revoke all on public.driver_payouts from anon, authenticated;

-- 4. Netted finance position + lock --------------------------------------------
create or replace function public.phase2_driver_finance_position(p_driver_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_debt bigint := 0; v_credit bigint := 0; v_payable bigint := 0; v_paid bigint := 0;
  v_net bigint; v_owed bigint; v_due bigint; v_exempt boolean;
  v_policy public.phase2_finance_policy;
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

  select coalesce(sum(case e.entry_side when 'CREDIT' then e.amount_cents else -e.amount_cents end),0)
    into v_payable from public.financial_ledger_entries e
    join public.financial_transactions t on t.id=e.transaction_id and t.transaction_state='POSTED'
    join public.financial_accounts a on a.id=e.account_id
   where a.owner_type='DRIVER' and a.owner_id=p_driver_id and a.account_category='DRIVER_EARNINGS_PAYABLE';

  select coalesce(sum(amount_cents),0) into v_paid
    from public.driver_payouts where driver_id=p_driver_id and status='paid';

  v_exempt := exists(select 1 from public.driver_finance_exemptions where driver_id=p_driver_id);
  v_debt := greatest(v_debt,0); v_credit := greatest(v_credit,0); v_payable := greatest(v_payable,0);
  v_net  := (v_payable - v_paid) + v_credit - v_debt;
  v_owed := greatest(-v_net,0);
  v_due  := greatest(v_net,0);

  return jsonb_build_object(
    'contract_version',public.phase2_contract_version(),'mode',v_policy.mode,'driver_id',p_driver_id,
    'commission_debt_cents',v_debt,'unapplied_credit_cents',v_credit,
    'card_earnings_cents',v_payable,'paid_out_cents',v_paid,
    'net_owed_cents',v_owed,'payout_due_cents',v_due,
    'debt_limit_cents',v_policy.debt_limit_cents,
    'financially_eligible',v_exempt or v_owed < v_policy.debt_limit_cents,
    'finance_exempt',v_exempt,
    'commission_lock_enforced',true,
    'paid_up',v_owed = 0,
    'subscription_required',v_policy.subscription_required);
end $function$;

-- 5. Admin manual assignment: commission lock instead of subscription ------------
create or replace function public.phase05b_assign_driver(p_trip_id uuid, p_driver_id uuid, p_actor_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare t public.trips%rowtype; d public.drivers%rowtype; v_role text; v_event uuid; v_pos jsonb;
begin
  select role into v_role from public.profiles where id=p_actor_id;
  if v_role not in ('owner','admin','dispatcher','support') then raise exception 'Manual assignment not authorized' using errcode='P0001'; end if;
  select * into t from public.trips where id=p_trip_id for update;
  if not found or t.status not in ('requested','offered') or t.driver_id is not null then raise exception 'Trip is not assignable' using errcode='P0001'; end if;
  select * into d from public.drivers where id=p_driver_id for update;
  if not found or coalesce(d.is_deleted,false) or coalesce(d.busy,false) or not coalesce(d.online,false)
     or d.status not in ('approved','active') or coalesce(d.verification_status,'')<>'approved'
     or not coalesce(d.profile_completed,false) then raise exception 'Driver is not hard-eligible' using errcode='P0001'; end if;
  v_pos := public.phase2_driver_finance_position(d.id);
  if not (v_pos->>'financially_eligible')::boolean then
    raise exception 'Driver owes R% commission and is locked until paid', round((v_pos->>'net_owed_cents')::numeric/100,2)
      using errcode='P0001'; end if;
  if exists(select 1 from public.trips where driver_id=d.id and status in ('assigned','arrived','ongoing') and id<>t.id) then
    raise exception 'Driver already has an active trip' using errcode='P0001'; end if;
  update public.trips set driver_id=d.id,status='assigned',offer_status='accepted' where id=t.id;
  update public.drivers set busy=true where id=d.id;
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status,created_by)
    values(t.id,'assignment','Manually assigned eligible driver '||d.id,t.status,'assigned',p_actor_id);
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
    values('trip-assigned:'||t.id::text,'trip_assigned','trip',t.id,p_actor_id,jsonb_build_object('driver_id',d.id,'source','admin_manual'))
    returning id into v_event;
  insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
    values(v_event,'trip_assigned',jsonb_build_object('trip_id',t.id,'driver_id',d.id));
  return jsonb_build_object('contract_version',public.phase05b_contract_version(),'trip_id',t.id,'driver_id',d.id,'replayed',false);
end $function$;

-- 6. Record a payout (admin, server role only). Never pays more than is due. ------
create or replace function public.moovu_record_driver_payout(
  p_driver_id uuid, p_amount_cents bigint, p_reference text, p_actor_id uuid, p_note text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_role text; v_pos jsonb; v_bank jsonb; v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select role into v_role from public.profiles where id=p_actor_id;
  if v_role not in ('owner','admin') then raise exception 'Only owner/admin can record payouts' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('driver-payout:'||p_driver_id::text,0));
  v_pos := public.phase2_driver_finance_position(p_driver_id);
  if exists(select 1 from public.driver_finance_exemptions where driver_id=p_driver_id) then
    raise exception 'This account is exempt from payouts' using errcode='P0001'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Amount must be positive' using errcode='P0001'; end if;
  if p_amount_cents > (v_pos->>'payout_due_cents')::bigint then
    raise exception 'Amount exceeds payout due (R%)', round((v_pos->>'payout_due_cents')::numeric/100,2) using errcode='P0001'; end if;
  select to_jsonb(b) - 'created_at' - 'updated_at' into v_bank from public.driver_payout_accounts b where driver_id=p_driver_id;
  if v_bank is null then raise exception 'Driver has no bank details on file' using errcode='P0001'; end if;
  insert into public.driver_payouts(driver_id,amount_cents,reference,bank_snapshot,recorded_by,note)
    values(p_driver_id,p_amount_cents,nullif(trim(p_reference),''),v_bank,p_actor_id,p_note)
    returning id into v_id;
  return jsonb_build_object('ok',true,'payout_id',v_id,'position',public.phase2_driver_finance_position(p_driver_id));
end $function$;

revoke execute on function public.moovu_record_driver_payout(uuid,bigint,text,uuid,text) from public, anon, authenticated;
grant execute on function public.moovu_record_driver_payout(uuid,bigint,text,uuid,text) to service_role;

revoke execute on function public.phase2_driver_finance_position(uuid) from public, anon, authenticated;
grant execute on function public.phase2_driver_finance_position(uuid) to service_role;
