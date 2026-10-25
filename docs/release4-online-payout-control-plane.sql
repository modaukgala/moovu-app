-- Release 4 candidate. Local disposable rehearsal only; no production execution.
-- Records and read boundaries are additive. No payout or fee deduction is activated.
begin;

create table public.online_payout_fee_evidence (
  id uuid primary key default gen_random_uuid(),
  payment_attempt_id uuid not null unique references public.online_payment_attempts(id) on delete restrict,
  actual_fee_cents bigint not null check (actual_fee_cents >= 0),
  source_type text not null check (source_type in ('PROVIDER_SETTLEMENT','PROVIDER_EXPORT')),
  source_reference text not null check (length(trim(source_reference)) between 3 and 200),
  vat_treatment text not null check (vat_treatment in ('TOTAL_INCLUDES_VAT','NO_VAT_CHARGED')),
  verified_by uuid not null references auth.users(id) on delete restrict,
  verified_at timestamptz not null default now(),
  unique (source_type,source_reference)
);

create table public.online_payout_batches (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete restrict,
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'DRAFT' check (status in
    ('DRAFT','RECONCILED','HELD','APPROVED','PAYMENT_RECORDED','PAID','FAILED','CANCELLED')),
  hold_reason text null,
  fee_share_basis_points integer null check (fee_share_basis_points between 0 and 10000),
  fare_cents bigint not null default 0 check (fare_cents >= 0),
  current_commission_cents bigint not null default 0 check (current_commission_cents >= 0),
  driver_earnings_cents bigint not null default 0 check (driver_earnings_cents >= 0),
  actual_provider_fee_cents bigint not null default 0 check (actual_provider_fee_cents >= 0),
  driver_provider_fee_cents bigint not null default 0 check (driver_provider_fee_cents >= 0),
  prior_debt_recovery_cents bigint not null default 0 check (prior_debt_recovery_cents >= 0),
  net_payout_cents bigint not null default 0 check (net_payout_cents >= 0),
  approved_snapshot jsonb null check (approved_snapshot is null or jsonb_typeof(approved_snapshot)='object'),
  payout_method text null check (payout_method in ('PAYSHAP','EFT')),
  transfer_reference text null,
  transfer_evidence_reference text null,
  approval_actor uuid null references auth.users(id) on delete restrict,
  payment_actor uuid null references auth.users(id) on delete restrict,
  approved_at timestamptz null,
  paid_at timestamptz null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_start < period_end),
  check (net_payout_cents + driver_provider_fee_cents + prior_debt_recovery_cents = driver_earnings_cents),
  check (driver_provider_fee_cents <= actual_provider_fee_cents),
  check (status not in ('APPROVED','PAYMENT_RECORDED','PAID') or
    (approved_snapshot is not null and approval_actor is not null and approved_at is not null)),
  check (status <> 'PAID' or
    (payout_method is not null and transfer_reference is not null and
     transfer_evidence_reference is not null and payment_actor is not null and paid_at is not null))
);
create index online_payout_batches_driver_period_idx
  on public.online_payout_batches(driver_id,period_end desc,id);
create index online_payout_batches_status_idx
  on public.online_payout_batches(status,created_at,id);

create table public.online_payout_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.online_payout_batches(id) on delete restrict,
  payable_id uuid not null unique references public.online_driver_payables(id) on delete restrict,
  fee_evidence_id uuid not null references public.online_payout_fee_evidence(id) on delete restrict,
  locked_fare_cents bigint not null check (locked_fare_cents > 0),
  current_commission_cents bigint not null check (current_commission_cents >= 0),
  driver_earnings_cents bigint not null check (driver_earnings_cents > 0),
  actual_provider_fee_cents bigint not null check (actual_provider_fee_cents >= 0),
  driver_provider_fee_cents bigint not null check (driver_provider_fee_cents >= 0),
  created_at timestamptz not null default now(),
  check (locked_fare_cents-current_commission_cents=driver_earnings_cents),
  check (driver_provider_fee_cents<=actual_provider_fee_cents)
);
create index online_payout_items_batch_idx on public.online_payout_items(batch_id,id);

create table public.online_payout_debt_allocations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.online_payout_batches(id) on delete restrict,
  source_commission_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  allocated_cents bigint not null check (allocated_cents > 0),
  ledger_transaction_id uuid null unique references public.financial_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(batch_id,source_commission_transaction_id)
);

create table public.online_payout_audit_events (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.online_payout_batches(id) on delete restrict,
  event_type text not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text null,
  evidence_reference text null,
  event_data jsonb not null default '{}'::jsonb check (jsonb_typeof(event_data)='object'),
  created_at timestamptz not null default now()
);
create index online_payout_audit_batch_idx on public.online_payout_audit_events(batch_id,created_at,id);

create table public.online_payout_policy (
  policy_key text primary key check (policy_key='manual-online-payouts'),
  enabled boolean not null default false,
  approved_driver_fee_share_bps integer null check (approved_driver_fee_share_bps between 0 and 10000),
  approval_reference text null,
  approved_by uuid null references auth.users(id) on delete restrict,
  approved_at timestamptz null,
  check (not enabled or (approved_driver_fee_share_bps is not null and
    approval_reference is not null and approved_by is not null and approved_at is not null))
);
insert into public.online_payout_policy(policy_key) values('manual-online-payouts');

-- Draft assembly is atomic and creates no financial posting, debt settlement,
-- approval or external transfer. One payable can appear in only one batch.
create function public.release4_create_payout_draft(
  p_driver_id uuid,p_period_start timestamptz,p_period_end timestamptz,
  p_payable_ids uuid[],p_actor_id uuid
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch uuid; v_row record; v_count integer:=0; v_fare bigint:=0;
        v_commission bigint:=0; v_earnings bigint:=0; v_fee bigint:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('owner','admin'))
    then raise exception 'Financial Admin required'; end if;
  if p_period_start is null or p_period_end is null or p_period_start>=p_period_end
    or p_period_end-p_period_start>interval '8 days' then raise exception 'Valid weekly period required'; end if;
  if coalesce(array_length(p_payable_ids,1),0) not between 1 and 100
    or (select count(distinct id) from unnest(p_payable_ids) id)<>array_length(p_payable_ids,1)
    then raise exception 'Unique, bounded payable selection required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('online-payout:'||p_driver_id::text,0));
  insert into public.online_payout_batches(driver_id,period_start,period_end,created_by)
  values(p_driver_id,p_period_start,p_period_end,p_actor_id) returning id into v_batch;
  for v_row in
    select p.id,p.trip_id,p.driver_id,p.payment_attempt_id,p.fare_cents,
      p.commission_cents,p.payable_cents,p.earned_at,p.state,p.ledger_transaction_id,
      a.state payment_state,a.reconciliation_state,a.verified_at,a.payment_ledger_transaction_id,
      e.id fee_evidence_id,e.actual_fee_cents
    from public.online_driver_payables p
    join public.online_payment_attempts a on a.id=p.payment_attempt_id
    join public.online_payout_fee_evidence e on e.payment_attempt_id=a.id
    where p.id=any(p_payable_ids) order by p.id for update of p
  loop
    if v_row.driver_id<>p_driver_id or v_row.state not in ('EARNED','PAYABLE')
      or v_row.earned_at<p_period_start or v_row.earned_at>=p_period_end
      or v_row.ledger_transaction_id is null
      or v_row.payment_state<>'SUCCEEDED' or v_row.reconciliation_state<>'MATCHED'
      or v_row.verified_at is null or v_row.payment_ledger_transaction_id is null
      or exists(select 1 from public.online_payment_refunds r
        where r.payment_attempt_id=v_row.payment_attempt_id
          and r.state<>'REFUND_FAILED')
      or not exists(select 1 from public.financial_transactions ft
        where ft.id=v_row.ledger_transaction_id and ft.transaction_state='POSTED')
      then raise exception 'Payable requires completed, unreversed, reconciled payment and posted ledger'; end if;
    insert into public.online_payout_items(batch_id,payable_id,fee_evidence_id,
      locked_fare_cents,current_commission_cents,driver_earnings_cents,
      actual_provider_fee_cents,driver_provider_fee_cents)
    values(v_batch,v_row.id,v_row.fee_evidence_id,v_row.fare_cents,
      v_row.commission_cents,v_row.payable_cents,v_row.actual_fee_cents,0);
    v_count:=v_count+1; v_fare:=v_fare+v_row.fare_cents;
    v_commission:=v_commission+v_row.commission_cents;
    v_earnings:=v_earnings+v_row.payable_cents;
    v_fee:=v_fee+v_row.actual_fee_cents;
  end loop;
  if v_count<>array_length(p_payable_ids,1) then raise exception 'Selected payables unavailable or missing fee evidence'; end if;
  update public.online_payout_batches set fare_cents=v_fare,current_commission_cents=v_commission,
    driver_earnings_cents=v_earnings,actual_provider_fee_cents=v_fee,
    net_payout_cents=v_earnings,updated_at=now() where id=v_batch;
  insert into public.online_payout_audit_events(batch_id,event_type,actor_id,event_data)
    values(v_batch,'DRAFT_CREATED',p_actor_id,jsonb_build_object('item_count',v_count));
  return v_batch;
end $$;

create function public.release4_guard_payout_audit_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'Payout audit events are append-only';
end $$;
create trigger release4_guard_payout_audit_immutable_trigger
  before update or delete on public.online_payout_audit_events
  for each row execute function public.release4_guard_payout_audit_immutable();

create function public.release4_guard_payout_evidence_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'Verified provider-fee evidence is immutable';
end $$;
create trigger release4_guard_payout_evidence_immutable_trigger
  before update or delete on public.online_payout_fee_evidence
  for each row execute function public.release4_guard_payout_evidence_immutable();

create function public.release4_guard_payout_item_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'Payout item snapshots are append-only';
end $$;
create trigger release4_guard_payout_item_immutable_trigger
  before update or delete on public.online_payout_items
  for each row execute function public.release4_guard_payout_item_immutable();

create function public.release4_guard_payout_item_insert()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_batch public.online_payout_batches;
begin
  select * into v_batch from public.online_payout_batches where id=new.batch_id for update;
  if not found or v_batch.status<>'DRAFT' or v_batch.driver_earnings_cents<>0
    or v_batch.net_payout_cents<>0 then
    raise exception 'Items may only be assembled into a new draft';
  end if;
  return new;
end $$;
create trigger release4_guard_payout_item_insert_trigger
  before insert on public.online_payout_items
  for each row execute function public.release4_guard_payout_item_insert();

create function public.release4_guard_approved_snapshot()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.approved_snapshot is not null and (
    new.approved_snapshot is distinct from old.approved_snapshot or
    new.driver_id is distinct from old.driver_id or
    new.period_start is distinct from old.period_start or
    new.period_end is distinct from old.period_end or
    new.fee_share_basis_points is distinct from old.fee_share_basis_points or
    new.fare_cents is distinct from old.fare_cents or
    new.current_commission_cents is distinct from old.current_commission_cents or
    new.driver_earnings_cents is distinct from old.driver_earnings_cents or
    new.actual_provider_fee_cents is distinct from old.actual_provider_fee_cents or
    new.driver_provider_fee_cents is distinct from old.driver_provider_fee_cents or
    new.prior_debt_recovery_cents is distinct from old.prior_debt_recovery_cents or
    new.net_payout_cents is distinct from old.net_payout_cents or
    new.approval_actor is distinct from old.approval_actor or
    new.approved_at is distinct from old.approved_at
  ) then raise exception 'Approved payout snapshot is immutable'; end if;
  return new;
end $$;
create trigger release4_guard_approved_snapshot_trigger
  before update on public.online_payout_batches
  for each row execute function public.release4_guard_approved_snapshot();

-- Non-monetary review transitions are serialized and audited below. Approval,
-- deductions and payment remain blocked until separate ledger-backed functions exist.
create function public.release4_guard_unapproved_payout_state()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_fare bigint; v_commission bigint; v_earnings bigint; v_fee bigint;
begin
  if new.status not in ('DRAFT','RECONCILED','HELD','CANCELLED') or new.approved_snapshot is not null
    or new.approved_at is not null or new.paid_at is not null
    or new.approval_actor is not null or new.payment_actor is not null
    or new.transfer_reference is not null or new.transfer_evidence_reference is not null
    or new.fee_share_basis_points is not null
    or new.driver_provider_fee_cents<>0 or new.prior_debt_recovery_cents<>0
  then raise exception 'Payout money actions are not activated'; end if;
  if tg_op='UPDATE' and (
    old.status not in ('DRAFT','RECONCILED','HELD') or new.driver_id is distinct from old.driver_id
    or new.period_start is distinct from old.period_start
    or new.period_end is distinct from old.period_end
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then raise exception 'Draft identity is immutable'; end if;
  if tg_op='UPDATE' then
    if new.status is distinct from old.status and
      (current_setting('release4.review_transition',true) is distinct from new.id::text
       or (old.status='DRAFT' and new.status not in ('RECONCILED','HELD','CANCELLED'))
       or (old.status='RECONCILED' and new.status not in ('HELD','CANCELLED'))
       or (old.status='HELD' and new.status not in ('RECONCILED','CANCELLED')))
      then raise exception 'Payout review transition requires authorized RPC'; end if;
    if new.hold_reason is distinct from old.hold_reason and
      current_setting('release4.review_transition',true) is distinct from new.id::text
      then raise exception 'Hold reason requires authorized RPC'; end if;
    select coalesce(sum(locked_fare_cents),0),coalesce(sum(current_commission_cents),0),
      coalesce(sum(driver_earnings_cents),0),coalesce(sum(actual_provider_fee_cents),0)
    into v_fare,v_commission,v_earnings,v_fee
    from public.online_payout_items where batch_id=new.id;
    if new.fare_cents<>v_fare or new.current_commission_cents<>v_commission
      or new.driver_earnings_cents<>v_earnings or new.actual_provider_fee_cents<>v_fee
      or new.net_payout_cents<>v_earnings then
      raise exception 'Draft totals must equal immutable item snapshots';
    end if;
  end if;
  return new;
end $$;
create trigger release4_guard_unapproved_payout_state_trigger
  before insert or update on public.online_payout_batches
  for each row execute function public.release4_guard_unapproved_payout_state();

-- Service-role caller must supply an existing financial Admin. This function
-- cannot approve, reserve debt, record a transfer or produce a payout posting.
create function public.release4_review_payout(
  p_batch_id uuid,p_action text,p_actor_id uuid,p_reason text default null
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.online_payout_batches; v_item record; v_target text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('owner','admin'))
    then raise exception 'Financial Admin required'; end if;
  if p_action not in ('RECONCILE','HOLD','CANCEL') then raise exception 'Unsupported review action'; end if;
  select * into v_batch from public.online_payout_batches where id=p_batch_id for update;
  if not found then raise exception 'Payout batch unavailable'; end if;
  v_target:=case p_action when 'RECONCILE' then 'RECONCILED'
    when 'HOLD' then 'HELD' else 'CANCELLED' end;
  if v_batch.status=v_target then return v_target; end if;
  if v_batch.status not in ('DRAFT','RECONCILED','HELD')
    or (v_target='RECONCILED' and v_batch.status not in ('DRAFT','HELD'))
    then raise exception 'Payout review transition unavailable'; end if;
  if p_action in ('HOLD','CANCEL') and length(trim(coalesce(p_reason,'')))<3
    then raise exception 'Documented reason required'; end if;
  if p_action='RECONCILE' then
    if not exists(select 1 from public.online_payout_items where batch_id=p_batch_id)
      then raise exception 'Payout has no items'; end if;
    for v_item in select p.id,p.state,p.ledger_transaction_id,p.payment_attempt_id,
        p.payable_cents,i.driver_earnings_cents item_earnings_cents,
        i.actual_provider_fee_cents item_fee_cents,
        a.state payment_state,a.reconciliation_state,a.verified_at,a.payment_ledger_transaction_id,
        e.id evidence_id,e.actual_fee_cents
      from public.online_payout_items i
      join public.online_driver_payables p on p.id=i.payable_id
      join public.online_payment_attempts a on a.id=p.payment_attempt_id
      join public.online_payout_fee_evidence e on e.id=i.fee_evidence_id
      where i.batch_id=p_batch_id for update of p
    loop
      if v_item.state not in ('EARNED','PAYABLE') or v_item.ledger_transaction_id is null
        or v_item.payable_cents<>v_item.item_earnings_cents
        or v_item.actual_fee_cents<>v_item.item_fee_cents
        or v_item.payment_state<>'SUCCEEDED' or v_item.reconciliation_state<>'MATCHED'
        or v_item.verified_at is null or v_item.payment_ledger_transaction_id is null
        or exists(select 1 from public.online_payment_refunds r
          where r.payment_attempt_id=v_item.payment_attempt_id and r.state<>'REFUND_FAILED')
        or not exists(select 1 from public.financial_transactions t
          where t.id=v_item.ledger_transaction_id and t.transaction_state='POSTED')
        or not exists(select 1 from public.financial_transactions t
          where t.id=v_item.payment_ledger_transaction_id and t.transaction_state='POSTED')
        then raise exception 'Payout item no longer reconciles'; end if;
    end loop;
  end if;
  perform set_config('release4.review_transition',p_batch_id::text,true);
  update public.online_payout_batches set status=v_target,
    hold_reason=case when v_target='HELD' then trim(p_reason) else null end,
    updated_at=now() where id=p_batch_id;
  insert into public.online_payout_audit_events(batch_id,event_type,actor_id,reason)
    values(p_batch_id,'REVIEW_'||v_target,p_actor_id,nullif(trim(coalesce(p_reason,'')),''));
  perform set_config('release4.review_transition','',true);
  return v_target;
end $$;

alter table public.online_payout_fee_evidence enable row level security;
alter table public.online_payout_batches enable row level security;
alter table public.online_payout_items enable row level security;
alter table public.online_payout_debt_allocations enable row level security;
alter table public.online_payout_audit_events enable row level security;
alter table public.online_payout_policy enable row level security;
revoke all on public.online_payout_fee_evidence,public.online_payout_batches,
  public.online_payout_items,public.online_payout_debt_allocations,
  public.online_payout_audit_events,public.online_payout_policy from public,anon,authenticated,service_role;
grant select,insert,update on public.online_payout_batches to service_role;
grant select,insert on public.online_payout_items to service_role;
grant select on public.online_payout_debt_allocations to service_role;
grant select,insert on public.online_payout_fee_evidence,public.online_payout_audit_events to service_role;
grant select on public.online_payout_policy to service_role;
revoke all on function public.release4_create_payout_draft(uuid,timestamptz,timestamptz,uuid[],uuid)
  from public,anon,authenticated;
grant execute on function public.release4_create_payout_draft(uuid,timestamptz,timestamptz,uuid[],uuid)
  to service_role;
revoke all on function public.release4_review_payout(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.release4_review_payout(uuid,text,uuid,text) to service_role;
revoke all on function public.release4_guard_payout_audit_immutable(),
  public.release4_guard_payout_evidence_immutable(),
  public.release4_guard_payout_item_immutable(),
  public.release4_guard_payout_item_insert(),
  public.release4_guard_approved_snapshot(),
  public.release4_guard_unapproved_payout_state() from public,anon,authenticated;

commit;
