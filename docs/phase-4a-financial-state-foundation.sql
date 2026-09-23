-- PHASE 4A REVIEW PACKAGE ONLY. DO NOT APPLY WITHOUT SEPARATE APPROVAL.
-- No existing rows, RPCs, booking routes, Phase 1 tables, or Phase 2 policy are modified.
-- The active policy effective date and any posting/booking integration belong to later gates.
begin;

create table public.phase4_policies (
  version text primary key,
  effective_from timestamptz not null unique,
  currency text not null default 'ZAR' check (currency='ZAR'),
  free_seconds integer not null check (free_seconds>0),
  no_show_seconds integer not null check (no_show_seconds>0),
  go_late_cents bigint not null check (go_late_cents>0),
  go_late_driver_cents bigint not null check (go_late_driver_cents>0),
  go_late_moovu_cents bigint not null check (go_late_moovu_cents>=0),
  xl_late_cents bigint not null check (xl_late_cents>0),
  xl_late_driver_cents bigint not null check (xl_late_driver_cents>0),
  xl_late_moovu_cents bigint not null check (xl_late_moovu_cents>=0),
  go_no_show_cents bigint not null check (go_no_show_cents>0),
  go_no_show_driver_cents bigint not null check (go_no_show_driver_cents>0),
  go_no_show_moovu_cents bigint not null check (go_no_show_moovu_cents>=0),
  xl_no_show_cents bigint not null check (xl_no_show_cents>0),
  xl_no_show_driver_cents bigint not null check (xl_no_show_driver_cents>0),
  xl_no_show_moovu_cents bigint not null check (xl_no_show_moovu_cents>=0),
  created_at timestamptz not null default now(),
  unique(version,effective_from),
  check (go_late_cents=go_late_driver_cents+go_late_moovu_cents),
  check (xl_late_cents=xl_late_driver_cents+xl_late_moovu_cents),
  check (go_no_show_cents=go_no_show_driver_cents+go_no_show_moovu_cents),
  check (xl_no_show_cents=xl_no_show_driver_cents+xl_no_show_moovu_cents)
);

create table public.phase4_fee_assessments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.trips(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  driver_id uuid not null references public.drivers(id) on delete restrict,
  fee_type text not null check (fee_type in ('LATE_CANCELLATION','NO_SHOW')),
  service_type text not null check (service_type in ('GO','GO_XL')),
  policy_version text not null,
  policy_effective_from timestamptz not null,
  assessed_at timestamptz not null,
  clock_basis text not null check (clock_basis in ('TRIP_CREATED_AT','SERVER_ARRIVED_AT')),
  locked_trip_state text not null check (locked_trip_state in ('assigned','arrived')),
  assigned_driver_id uuid not null references public.drivers(id) on delete restrict,
  fee_cents bigint not null check (fee_cents>0),
  driver_cents bigint not null check (driver_cents>0),
  moovu_cents bigint not null check (moovu_cents>=0),
  currency text not null default 'ZAR' check (currency='ZAR'),
  arrival_evidence_version text,
  source_event_key text not null unique,
  idempotency_key text not null unique,
  assessment_status text not null default 'ASSESSED' check (assessment_status='ASSESSED'),
  created_at timestamptz not null default now(),
  check (fee_cents=driver_cents+moovu_cents),
  check ((fee_type='NO_SHOW' and clock_basis='SERVER_ARRIVED_AT' and arrival_evidence_version is not null)
    or (fee_type='LATE_CANCELLATION' and clock_basis='TRIP_CREATED_AT')),
  foreign key (policy_version,policy_effective_from)
    references public.phase4_policies(version,effective_from) on delete restrict
);
create index phase4_assessments_customer_idx on public.phase4_fee_assessments(customer_id,assessed_at);
create index phase4_assessments_driver_idx on public.phase4_fee_assessments(driver_id,assessed_at);

create table public.phase4_customer_liabilities (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null unique references public.phase4_fee_assessments(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  original_cents bigint not null check (original_cents>0),
  open_cents bigint not null check (open_cents>=0),
  collected_cents bigint not null default 0 check (collected_cents>=0),
  waived_cents bigint not null default 0 check (waived_cents>=0),
  reversed_cents bigint not null default 0 check (reversed_cents>=0),
  written_off_cents bigint not null default 0 check (written_off_cents>=0),
  currency text not null default 'ZAR' check (currency='ZAR'),
  status text not null default 'ASSESSED' check (status in
    ('ASSESSED','OPEN','DISPUTED','RESOLVED','WAIVED','REVERSED','WRITTEN_OFF')),
  finalized_at timestamptz,
  disputed_at timestamptz,
  resolution_at timestamptz,
  resolution_actor_id uuid,
  resolution_reason text,
  source_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (original_cents=open_cents+collected_cents+waived_cents+reversed_cents+written_off_cents),
  check (status='ASSESSED' or finalized_at is not null),
  check (status<>'DISPUTED' or disputed_at is not null),
  check (status not in ('RESOLVED','WAIVED','REVERSED','WRITTEN_OFF')
    or (open_cents=0 and resolution_at is not null and resolution_actor_id is not null
      and nullif(trim(resolution_reason),'') is not null))
);
create index phase4_liabilities_customer_open_idx on public.phase4_customer_liabilities(customer_id,finalized_at)
  where status='OPEN' and open_cents>0;

create table public.phase4_driver_compensations (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null unique references public.phase4_fee_assessments(id) on delete restrict,
  driver_id uuid not null references public.drivers(id) on delete restrict,
  earned_cents bigint not null check (earned_cents>0),
  settled_cents bigint not null default 0 check (settled_cents>=0 and settled_cents<=earned_cents),
  currency text not null default 'ZAR' check (currency='ZAR'),
  status text not null default 'EARNED' check (status in ('EARNED','PAYABLE','CREDITED','SETTLED','REVERSED')),
  earned_at timestamptz not null,
  settlement_source_id uuid,
  source_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status<>'SETTLED' or settled_cents=earned_cents),
  check (status not in ('CREDITED','SETTLED') or settlement_source_id is not null)
);

-- One cycle begins with the first finalized, undisputed, unpaid debt. Additional
-- debt joins the existing cycle; it cannot create another two rides.
create table public.phase4_customer_grace_cycles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  started_at timestamptz not null,
  resolved_at timestamptz,
  source_liability_id uuid not null references public.phase4_customer_liabilities(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (resolved_at is null or resolved_at>=started_at)
);
create unique index phase4_one_active_grace_cycle_per_customer
  on public.phase4_customer_grace_cycles(customer_id) where resolved_at is null;

-- A future completion handler may insert only a legitimately completed trip while
-- qualifying debt is finalized, undisputed, and open. Disputed periods consume none.
create table public.phase4_grace_ride_consumptions (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.phase4_customer_grace_cycles(id) on delete restrict,
  completed_trip_id uuid not null unique references public.trips(id) on delete restrict,
  completed_at timestamptz not null,
  trip_status_at_consumption text not null check (trip_status_at_consumption='completed'),
  source_key text not null unique,
  created_at timestamptz not null default now()
);
create index phase4_grace_consumptions_cycle_idx on public.phase4_grace_ride_consumptions(cycle_id,completed_at);

create table public.phase4_financial_actions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.phase4_fee_assessments(id) on delete restrict,
  action_type text not null check (action_type in
    ('COLLECTION','DISPUTE_OPENED','DISPUTE_RESOLVED','WAIVER','REVERSAL','WRITE_OFF','COMPENSATION_SETTLEMENT')),
  amount_cents bigint not null check (amount_cents>=0),
  currency text not null default 'ZAR' check (currency='ZAR'),
  source_key text not null unique,
  actor_id uuid not null,
  reason text not null check (length(trim(reason))>0),
  original_action_id uuid references public.phase4_financial_actions(id) on delete restrict,
  financial_transaction_id uuid unique references public.financial_transactions(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index phase4_actions_assessment_idx on public.phase4_financial_actions(assessment_id,created_at);

-- Snapshots and action history may be corrected only through linked compensating
-- actions, never through UPDATE or DELETE. State projections update separately.
create function public.phase4_reject_update_delete() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'Phase 4 source history is append-only';
end $$;
create trigger phase4_policies_immutable before update or delete on public.phase4_policies
  for each row execute function public.phase4_reject_update_delete();
create trigger phase4_assessments_immutable before update or delete on public.phase4_fee_assessments
  for each row execute function public.phase4_reject_update_delete();
create trigger phase4_actions_immutable before update or delete on public.phase4_financial_actions
  for each row execute function public.phase4_reject_update_delete();
create trigger phase4_grace_consumptions_immutable before update or delete on public.phase4_grace_ride_consumptions
  for each row execute function public.phase4_reject_update_delete();

-- Liability/compensation/cycle rows are state projections, so controlled writers
-- may update state and allocations, but never rewrite their original identity.
create function public.phase4_guard_projection_identity() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_table_name='phase4_customer_liabilities' then
    if row(new.assessment_id,new.customer_id,new.original_cents,new.currency,new.source_key,new.created_at)
      is distinct from row(old.assessment_id,old.customer_id,old.original_cents,old.currency,old.source_key,old.created_at)
    then raise exception 'Phase 4 liability origin is immutable'; end if;
  elsif tg_table_name='phase4_driver_compensations' then
    if row(new.assessment_id,new.driver_id,new.earned_cents,new.currency,new.earned_at,new.source_key,new.created_at)
      is distinct from row(old.assessment_id,old.driver_id,old.earned_cents,old.currency,old.earned_at,old.source_key,old.created_at)
    then raise exception 'Phase 4 compensation origin is immutable'; end if;
  elsif tg_table_name='phase4_customer_grace_cycles' then
    if row(new.customer_id,new.started_at,new.source_liability_id,new.created_at)
      is distinct from row(old.customer_id,old.started_at,old.source_liability_id,old.created_at)
    then raise exception 'Phase 4 grace-cycle origin is immutable'; end if;
  else
    raise exception 'Phase 4 projection trigger attached to unexpected table';
  end if;
  return new;
end $$;
create trigger phase4_liability_origin_immutable before update on public.phase4_customer_liabilities
  for each row execute function public.phase4_guard_projection_identity();
create trigger phase4_compensation_origin_immutable before update on public.phase4_driver_compensations
  for each row execute function public.phase4_guard_projection_identity();
create trigger phase4_grace_cycle_origin_immutable before update on public.phase4_customer_grace_cycles
  for each row execute function public.phase4_guard_projection_identity();

alter table public.phase4_policies enable row level security;
alter table public.phase4_fee_assessments enable row level security;
alter table public.phase4_customer_liabilities enable row level security;
alter table public.phase4_driver_compensations enable row level security;
alter table public.phase4_customer_grace_cycles enable row level security;
alter table public.phase4_grace_ride_consumptions enable row level security;
alter table public.phase4_financial_actions enable row level security;
revoke all on public.phase4_policies,public.phase4_fee_assessments,public.phase4_customer_liabilities,
  public.phase4_driver_compensations,public.phase4_customer_grace_cycles,
  public.phase4_grace_ride_consumptions,public.phase4_financial_actions from public,anon,authenticated,service_role;
grant select on public.phase4_policies,public.phase4_fee_assessments,public.phase4_customer_liabilities,
  public.phase4_driver_compensations,public.phase4_customer_grace_cycles,
  public.phase4_grace_ride_consumptions,public.phase4_financial_actions to service_role;
revoke all on function public.phase4_reject_update_delete() from public,anon,authenticated,service_role;
revoke all on function public.phase4_guard_projection_identity() from public,anon,authenticated,service_role;
commit;

-- No INSERT/UPDATE/DELETE against pre-existing tables and no policy data INSERT.
-- Do not execute this package during 4A. Before a later approved installation:
-- inspect grants/FKs against the target, back up schema, apply to disposable, then
-- review exact hash and separate production authorization. Existing fee rows are
-- not backfilled. If installation fails, transaction rollback leaves no objects.
-- After installation, rollback requires a separate reviewed dependency-aware DROP
-- of these new empty objects; never drop populated history without reconciliation.
