-- MOOVU Phase 5 customer monetisation foundation.
-- Install dormant. Activation requires one immutable active policy row after the matching app is deployed.
begin;

create table if not exists public.phase5_policies (
  version text primary key,
  effective_from timestamptz not null,
  currency text not null check (currency='ZAR'),
  membership_price_cents bigint not null check (membership_price_cents=9900),
  membership_days integer not null check (membership_days=30),
  go_service_fee_cents bigint not null check (go_service_fee_cents=300),
  go_xl_service_fee_cents bigint not null check (go_xl_service_fee_cents=500),
  member_waiver_bps integer not null check (member_waiver_bps=10000),
  referrer_reward_cents bigint not null check (referrer_reward_cents=2000),
  referee_reward_cents bigint not null check (referee_reward_cents=1000),
  credit_expiry_days integer not null check (credit_expiry_days=90),
  automatic_renewal boolean not null check (automatic_renewal=false),
  referral_qualification text not null check (referral_qualification='FIRST_ELIGIBLE_COMPLETED_RIDE'),
  active boolean not null default false,
  created_at timestamptz not null default now()
);
do $$ declare v_name text; begin
  for v_name in select conname from pg_constraint
    where conrelid='public.phase5_policies'::regclass and contype='c'
      and pg_get_constraintdef(oid) ilike '%effective_from%' and pg_get_constraintdef(oid) ilike '%active%'
  loop execute format('alter table public.phase5_policies drop constraint %I',v_name); end loop;
end $$;
create unique index if not exists phase5_one_active_policy_uidx on public.phase5_policies(active) where active;

create or replace function public.phase5_immutable_policy() returns trigger
language plpgsql set search_path=public,pg_temp as $$ begin
  raise exception 'Phase 5 policy history is immutable';
end $$;
drop trigger if exists phase5_immutable_policy_trigger on public.phase5_policies;
create trigger phase5_immutable_policy_trigger before update or delete on public.phase5_policies
for each row execute function public.phase5_immutable_policy();

alter table public.customers add column if not exists referral_code text;
create unique index if not exists customers_referral_code_uidx on public.customers(upper(referral_code)) where referral_code is not null;
alter table public.trips
  add column if not exists phase5_policy_version text references public.phase5_policies(version) on delete restrict,
  add column if not exists phase5_policy_effective_from timestamptz,
  add column if not exists phase5_ride_fare_cents bigint check (phase5_ride_fare_cents>0),
  add column if not exists phase5_service_fee_cents bigint check (phase5_service_fee_cents>=0),
  add column if not exists phase5_membership_waiver_cents bigint check (phase5_membership_waiver_cents>=0),
  add column if not exists phase5_credit_cents bigint check (phase5_credit_cents>=0),
  add column if not exists phase5_customer_total_cents bigint check (phase5_customer_total_cents>=0),
  add column if not exists phase5_driver_fare_basis_cents bigint check (phase5_driver_fare_basis_cents>0),
  add column if not exists phase5_membership_id uuid,
  add column if not exists phase5_booking_key text;
create unique index if not exists trips_phase5_booking_key_uidx on public.trips(phase5_booking_key) where phase5_booking_key is not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.trips'::regclass and conname='trips_phase5_snapshot_complete_check') then
    alter table public.trips add constraint trips_phase5_snapshot_complete_check check (
      phase5_policy_version is null or (
        phase5_policy_effective_from is not null and phase5_ride_fare_cents is not null and phase5_service_fee_cents is not null and
        phase5_membership_waiver_cents is not null and phase5_credit_cents is not null and phase5_customer_total_cents is not null and
        phase5_driver_fare_basis_cents=phase5_ride_fare_cents and
        phase5_customer_total_cents=phase5_ride_fare_cents+phase5_service_fee_cents-phase5_membership_waiver_cents-phase5_credit_cents
      )
    ) not valid;
  end if;
end $$;

create table if not exists public.phase5_membership_payments (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id) on delete restrict,
  amount_cents bigint not null check (amount_cents=9900), currency text not null default 'ZAR' check(currency='ZAR'),
  method text not null check(method='TRANSFER_EFT'), reference text not null check(length(trim(reference)) between 3 and 120),
  proof_path text, status text not null default 'SUBMITTED' check(status in ('SUBMITTED','APPROVED','REJECTED','REVERSED')),
  submission_key text not null unique, submitted_at timestamptz not null default now(), reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id), review_reason text, financial_transaction_id uuid references public.financial_transactions(id)
);
create table if not exists public.phase5_memberships (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id) on delete restrict,
  payment_id uuid not null unique references public.phase5_membership_payments(id) on delete restrict,
  policy_version text not null references public.phase5_policies(version) on delete restrict,
  starts_at timestamptz not null, expires_at timestamptz not null, status text not null check(status in ('ACTIVE','REVERSED')),
  activated_by uuid not null references public.profiles(id), activated_at timestamptz not null default now(),
  reversal_reason text, reversed_at timestamptz, check(expires_at=starts_at+interval '30 days')
);
create index if not exists phase5_memberships_customer_time_idx on public.phase5_memberships(customer_id,expires_at desc);

create table if not exists public.phase5_credit_issuances (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id) on delete restrict,
  amount_cents bigint not null check(amount_cents>0), source_type text not null check(source_type in ('REFERRER_REWARD','REFEREE_REWARD','ADMIN_ADJUSTMENT')),
  source_id uuid not null, policy_version text not null references public.phase5_policies(version) on delete restrict,
  idempotency_key text not null unique, issued_at timestamptz not null default now(), expires_at timestamptz not null,
  status text not null default 'ACTIVE' check(status in ('ACTIVE','REVERSED')), issued_by uuid references public.profiles(id),
  reason text not null, reversal_of uuid references public.phase5_credit_issuances(id), financial_transaction_id uuid references public.financial_transactions(id),
  check(expires_at=issued_at+interval '90 days')
);
create index if not exists phase5_credit_customer_expiry_idx on public.phase5_credit_issuances(customer_id,expires_at,id) where status='ACTIVE';
create table if not exists public.phase5_credit_redemptions (
  id uuid primary key default gen_random_uuid(), issuance_id uuid not null references public.phase5_credit_issuances(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict, trip_id uuid not null references public.trips(id) on delete restrict,
  amount_cents bigint not null check(amount_cents>0), idempotency_key text not null unique, created_at timestamptz not null default now(),
  unique(issuance_id,trip_id)
);
create index if not exists phase5_credit_redemptions_issuance_idx on public.phase5_credit_redemptions(issuance_id);

create table if not exists public.phase5_referral_relationships (
  id uuid primary key default gen_random_uuid(), referrer_customer_id uuid not null references public.customers(id) on delete restrict,
  referee_customer_id uuid not null unique references public.customers(id) on delete restrict,
  referral_code text not null, status text not null default 'PENDING' check(status in ('PENDING','QUALIFIED','REVERSED')),
  created_at timestamptz not null default now(), qualified_at timestamptz, qualifying_trip_id uuid unique references public.trips(id) on delete restrict,
  policy_version text references public.phase5_policies(version) on delete restrict,
  check(referrer_customer_id<>referee_customer_id)
);
create index if not exists phase5_referral_relationships_referrer_idx on public.phase5_referral_relationships(referrer_customer_id,status);

create table if not exists public.phase5_audit_events (
  id uuid primary key default gen_random_uuid(), event_key text not null unique, event_type text not null,
  aggregate_type text not null, aggregate_id uuid not null, actor_id uuid, payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.phase5_policies enable row level security;
alter table public.phase5_membership_payments enable row level security;
alter table public.phase5_memberships enable row level security;
alter table public.phase5_credit_issuances enable row level security;
alter table public.phase5_credit_redemptions enable row level security;
alter table public.phase5_referral_relationships enable row level security;
alter table public.phase5_audit_events enable row level security;
revoke all on public.phase5_policies,public.phase5_membership_payments,public.phase5_memberships,
  public.phase5_credit_issuances,public.phase5_credit_redemptions,public.phase5_referral_relationships,public.phase5_audit_events
  from public,anon,authenticated;
grant select on public.phase5_policies,public.phase5_membership_payments,public.phase5_memberships,
  public.phase5_credit_issuances,public.phase5_credit_redemptions,public.phase5_referral_relationships,public.phase5_audit_events to service_role;

create or replace function public.phase5_policy_at(p_at timestamptz default now()) returns public.phase5_policies
language sql stable security definer set search_path=public,pg_temp as $$
  select p from public.phase5_policies p where p.active and p.effective_from<=p_at order by p.effective_from desc limit 1
$$;
create or replace function public.phase5_customer_state(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare m public.phase5_memberships; v_credit bigint;
begin
  if auth.role()<>'service_role' and not exists(select 1 from public.customers where id=p_customer_id and auth_user_id=auth.uid()) then
    raise exception 'Customer state not authorized'; end if;
  select * into m from public.phase5_memberships where customer_id=p_customer_id and status='ACTIVE' and starts_at<=now() and expires_at>now()
    order by expires_at desc limit 1;
  select coalesce(sum(i.amount_cents-coalesce(r.used,0)),0) into v_credit from public.phase5_credit_issuances i
  left join (select issuance_id,sum(amount_cents) used from public.phase5_credit_redemptions group by issuance_id) r on r.issuance_id=i.id
  where i.customer_id=p_customer_id and i.status='ACTIVE' and i.expires_at>now();
  return jsonb_build_object('membership_active',m.id is not null,'membership_id',m.id,'membership_expires_at',m.expires_at,
    'available_credit_cents',v_credit,'referral_code',(select referral_code from public.customers where id=p_customer_id));
end $$;

create or replace function public.phase5_ensure_referral_code(p_customer_id uuid) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_code text; v_owner uuid;
begin
  select auth_user_id,referral_code into v_owner,v_code from public.customers where id=p_customer_id for update;
  if not found or (auth.role()<>'service_role' and v_owner<>auth.uid()) then raise exception 'Customer not authorized'; end if;
  if v_code is null then
    loop v_code:='MV'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
      begin update public.customers set referral_code=v_code where id=p_customer_id; exit;
      exception when unique_violation then null; end;
    end loop;
  end if; return v_code;
end $$;

create or replace function public.phase5_accept_referral(p_referee_customer_id uuid,p_code text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_referrer uuid; v_owner uuid; v_rel uuid;
begin
  select auth_user_id into v_owner from public.customers where id=p_referee_customer_id for update;
  if not found or (auth.role()<>'service_role' and v_owner<>auth.uid()) then raise exception 'Customer not authorized'; end if;
  if exists(select 1 from public.trips where customer_id=p_referee_customer_id and status='completed') then raise exception 'Referral is only available before the first completed ride'; end if;
  select id into v_referrer from public.customers where upper(referral_code)=upper(trim(p_code));
  if v_referrer is null then raise exception 'Referral code not found'; end if;
  if v_referrer=p_referee_customer_id then raise exception 'Self-referral is not allowed'; end if;
  insert into public.phase5_referral_relationships(referrer_customer_id,referee_customer_id,referral_code)
  values(v_referrer,p_referee_customer_id,upper(trim(p_code))) returning id into v_rel;
  insert into public.phase5_audit_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
  values('referral-accepted:'||v_rel,'REFERRAL_ACCEPTED','REFERRAL',v_rel,v_owner,jsonb_build_object('referee_customer_id',p_referee_customer_id));
  return jsonb_build_object('relationship_id',v_rel,'status','PENDING');
end $$;

create or replace function public.phase5_submit_membership_payment(
  p_customer_id uuid,p_reference text,p_proof_path text,p_submission_key text
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_owner uuid; v_payment public.phase5_membership_payments; v_policy public.phase5_policies;
begin
  select auth_user_id into v_owner from public.customers where id=p_customer_id;
  if not found or (auth.role()<>'service_role' and v_owner<>auth.uid()) then raise exception 'Customer not authorized'; end if;
  if length(trim(coalesce(p_reference,''))) not between 3 and 120 or length(trim(coalesce(p_submission_key,'')))<8 then
    raise exception 'Valid payment reference and submission key are required'; end if;
  select * into v_policy from public.phase5_policy_at(now());
  if v_policy.version is null then raise exception 'Phase 5 membership is not active'; end if;
  select * into v_payment from public.phase5_membership_payments where submission_key=p_submission_key;
  if found then
    if v_payment.customer_id<>p_customer_id or v_payment.reference<>trim(p_reference) then raise exception 'Conflicting payment submission replay'; end if;
    return jsonb_build_object('payment_id',v_payment.id,'status',v_payment.status,'replayed',true);
  end if;
  insert into public.phase5_membership_payments(customer_id,amount_cents,method,reference,proof_path,submission_key)
  values(p_customer_id,v_policy.membership_price_cents,'TRANSFER_EFT',trim(p_reference),nullif(trim(p_proof_path),''),p_submission_key)
  returning * into v_payment;
  insert into public.phase5_audit_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
  values('membership-submitted:'||v_payment.id,'MEMBERSHIP_PAYMENT_SUBMITTED','MEMBERSHIP_PAYMENT',v_payment.id,v_owner,
    jsonb_build_object('customer_id',p_customer_id,'amount_cents',v_payment.amount_cents,'method',v_payment.method));
  return jsonb_build_object('payment_id',v_payment.id,'status',v_payment.status,'replayed',false);
end $$;

create or replace function public.phase5_approve_membership_payment(
  p_payment_id uuid,p_actor_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare p public.phase5_membership_payments; pol public.phase5_policies; m public.phase5_memberships;
  v_start timestamptz; v_clearing public.financial_accounts; v_deferred public.financial_accounts; v_post jsonb; v_payload text;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted server role required'; end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('owner','admin')) then raise exception 'Owner or Admin required'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Approval reason required'; end if;
  select * into p from public.phase5_membership_payments where id=p_payment_id for update;
  if not found then raise exception 'Membership payment not found'; end if;
  if p.status='APPROVED' then
    select * into m from public.phase5_memberships where payment_id=p.id;
    return jsonb_build_object('payment_id',p.id,'membership_id',m.id,'starts_at',m.starts_at,'expires_at',m.expires_at,'replayed',true);
  end if;
  if p.status<>'SUBMITTED' then raise exception 'Only submitted payments may be approved'; end if;
  select * into pol from public.phase5_policy_at(now());
  if pol.version is null then raise exception 'Phase 5 membership is not active'; end if;
  perform pg_advisory_xact_lock(hashtextextended('phase5-membership:'||p.customer_id::text,0));
  select greatest(now(),coalesce(max(expires_at),now())) into v_start from public.phase5_memberships
    where customer_id=p.customer_id and status='ACTIVE';
  select * into v_clearing from public.phase1_ensure_financial_account(coalesce((select account_code from public.financial_accounts where owner_type='PLATFORM' and owner_id is null and account_category='SUBSCRIPTION_PAYMENT_CLEARING' and currency='ZAR'),'PHASE5:MEMBERSHIP:CLEARING'),'SUBSCRIPTION_PAYMENT_CLEARING','PLATFORM',null,'DEBIT','ZAR');
  select * into v_deferred from public.phase1_ensure_financial_account(coalesce((select account_code from public.financial_accounts where owner_type='PLATFORM' and owner_id is null and account_category='DEFERRED_SUBSCRIPTION_REVENUE' and currency='ZAR'),'PHASE5:MEMBERSHIP:DEFERRED'),'DEFERRED_SUBSCRIPTION_REVENUE','PLATFORM',null,'CREDIT','ZAR');
  v_payload:=p.id||':'||p.amount_cents||':'||pol.version;
  v_post:=public.phase1_post_financial_transaction('phase5:membership:'||p.id,
    encode(digest(convert_to(v_payload,'UTF8'),'sha256'),'hex'),'MEMBERSHIP_PAYMENT','ADJUSTMENT',p.id,'ZAR','ADMIN',p_actor_id,now(),
    jsonb_build_array(jsonb_build_object('account_id',v_clearing.id,'entry_side','DEBIT','amount_cents',p.amount_cents),
      jsonb_build_object('account_id',v_deferred.id,'entry_side','CREDIT','amount_cents',p.amount_cents)),
    jsonb_build_object('verified_collection',true,'payment_method','TRANSFER_EFT','policy_version',pol.version));
  insert into public.phase5_memberships(customer_id,payment_id,policy_version,starts_at,expires_at,status,activated_by)
  values(p.customer_id,p.id,pol.version,v_start,v_start+interval '30 days','ACTIVE',p_actor_id) returning * into m;
  update public.phase5_membership_payments set status='APPROVED',reviewed_at=now(),reviewed_by=p_actor_id,
    review_reason=trim(p_reason),financial_transaction_id=(v_post->>'transaction_id')::uuid where id=p.id;
  insert into public.phase5_audit_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
  values('membership-approved:'||p.id,'MEMBERSHIP_APPROVED','MEMBERSHIP',m.id,p_actor_id,
    jsonb_build_object('customer_id',p.customer_id,'starts_at',m.starts_at,'expires_at',m.expires_at,'financial_transaction_id',v_post->>'transaction_id'));
  return jsonb_build_object('payment_id',p.id,'membership_id',m.id,'starts_at',m.starts_at,'expires_at',m.expires_at,'replayed',false);
end $$;

create or replace function public.phase5_reject_membership_payment(p_payment_id uuid,p_actor_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.phase5_membership_payments;
begin
  if auth.role()<>'service_role' or not exists(select 1 from public.profiles where id=p_actor_id and role in ('owner','admin')) then raise exception 'Owner or Admin required'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Rejection reason required'; end if;
  select * into p from public.phase5_membership_payments where id=p_payment_id for update;
  if not found then raise exception 'Membership payment not found'; end if;
  if p.status='REJECTED' then return jsonb_build_object('payment_id',p.id,'status',p.status,'replayed',true); end if;
  if p.status<>'SUBMITTED' then raise exception 'Only submitted payments may be rejected'; end if;
  update public.phase5_membership_payments set status='REJECTED',reviewed_at=now(),reviewed_by=p_actor_id,review_reason=trim(p_reason) where id=p.id;
  insert into public.phase5_audit_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
  values('membership-rejected:'||p.id,'MEMBERSHIP_PAYMENT_REJECTED','MEMBERSHIP_PAYMENT',p.id,p_actor_id,jsonb_build_object('reason',trim(p_reason)));
  return jsonb_build_object('payment_id',p.id,'status','REJECTED','replayed',false);
end $$;

revoke all on function public.phase5_policy_at(timestamptz),public.phase5_customer_state(uuid),
  public.phase5_ensure_referral_code(uuid),public.phase5_accept_referral(uuid,text),
  public.phase5_submit_membership_payment(uuid,text,text,text),public.phase5_approve_membership_payment(uuid,uuid,text)
  ,public.phase5_reject_membership_payment(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.phase5_customer_state(uuid),public.phase5_ensure_referral_code(uuid),public.phase5_accept_referral(uuid,text) to service_role;
grant execute on function public.phase5_policy_at(timestamptz) to service_role;
grant execute on function public.phase5_submit_membership_payment(uuid,text,text,text) to service_role;
grant execute on function public.phase5_approve_membership_payment(uuid,uuid,text) to service_role;
grant execute on function public.phase5_reject_membership_payment(uuid,uuid,text) to service_role;

commit;
