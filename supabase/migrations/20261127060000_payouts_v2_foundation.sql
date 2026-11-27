-- Payouts v2 foundation (27 Nov 2026).
-- Additive and gated: nothing changes for live users until phase5_policies.payout_v2_from
-- and phase5_policies.service_fee_tier_bps are set on the active policy row.

alter table public.phase5_policies
  add column if not exists service_fee_tier_bps integer
    check (service_fee_tier_bps is null or (service_fee_tier_bps between 1 and 2000)),
  add column if not exists payout_v2_from timestamptz;

-- Tiered booking fee: when service_fee_tier_bps is set, the fee becomes
-- max(flat fee, ceil(ride fare * bps / 10000) rounded up to the next whole rand).
do $mig$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.phase5_create_trip(uuid,uuid,text,jsonb,bigint,text,bigint)'::regprocedure);
  v_old := 'fee:=case when p_ride_option=''go'' then pol.go_service_fee_cents else pol.go_xl_service_fee_cents end;';
  v_new := v_old || E'\n  if pol.service_fee_tier_bps is not null then\n    fee:=greatest(fee,(ceil(p_ride_fare_cents::numeric*pol.service_fee_tier_bps/1000000.0)*100)::bigint);\n  end if;';
  if position(v_old in v_def) = 0 then raise exception 'phase5_create_trip fee line not found'; end if;
  if position('service_fee_tier_bps' in v_def) = 0 then
    execute replace(v_def, v_old, v_new);
  end if;
end $mig$;

-- Driver debt: from payout_v2_from onward, cash trips also owe the booking fee to MOOVU,
-- and card trips no longer add commission to debt (it is netted inside the payout instead).
create or replace function public.phase05b_driver_debt(p_driver_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_from timestamptz;
  v_commission numeric(14,2); v_net numeric(14,2); v_trips bigint; v_fees numeric(14,2);
  v_settled numeric(14,2); v_credits numeric(14,2); v_adjustments numeric(14,2);
  v_unapplied numeric(14,2); v_due numeric(14,2);
begin
  select p.payout_v2_from into v_from from public.phase5_policy_at(now()) p;

  select
    coalesce(sum(case when v_from is not null and t.completed_at >= v_from and t.payment_method = 'online'
                      then 0 else coalesce(t.commission_amount,0) end),0),
    coalesce(sum(case when v_from is not null and t.completed_at >= v_from and t.payment_method = 'cash'
                      then greatest(0, coalesce(t.phase5_service_fee_cents,0) - coalesce(t.phase5_membership_waiver_cents,0)
                                       - coalesce(t.phase5_credit_cents,0))::numeric / 100
                      else 0 end),0),
    coalesce(sum(case when v_from is not null and t.completed_at >= v_from and t.phase5_ride_fare_cents is not null
                      then t.phase5_ride_fare_cents::numeric/100 - coalesce(t.commission_amount,0)
                      else coalesce(t.driver_net_earnings, t.fare_amount - coalesce(t.commission_amount,0)) end),0),
    count(*)
  into v_commission, v_fees, v_net, v_trips
  from public.trips t where t.driver_id = p_driver_id and t.status = 'completed';

  select coalesce(sum(amount_paid),0) into v_settled from public.driver_settlements where driver_id = p_driver_id;
  select coalesce(sum(amount),0) into v_credits from public.driver_wallet_transactions
    where driver_id = p_driver_id and tx_type = 'cancellation_credit' and direction = 'credit';
  select coalesce(sum(amount),0) into v_adjustments from public.driver_wallet_transactions
    where driver_id = p_driver_id and tx_type = 'adjustment' and direction = 'credit';
  select coalesce(sum(unapplied_excess),0) into v_unapplied from public.driver_payment_requests
    where driver_id = p_driver_id and status = 'approved';

  v_due := greatest(0, round(v_commission + v_fees - v_settled - v_credits - v_adjustments, 2));

  return jsonb_build_object(
    'contract_version', public.phase05b_contract_version(),
    'driver_id', p_driver_id,
    'total_commission', round(v_commission,2),
    'booking_fees_owed', round(v_fees,2),
    'total_driver_net', round(v_net + v_credits,2),
    'total_trips_completed', v_trips,
    'total_settled', round(v_settled,2),
    'cancellation_credits', round(v_credits,2),
    'adjustment_credits', round(v_adjustments,2),
    'unapplied_credit', round(v_unapplied,2),
    'balance_due', v_due);
end $function$;

-- Payout details the driver gives us (PayShap ShapID or bank account).
alter table public.driver_payout_accounts add column if not exists payshap_id text;

-- Driver payout requests (manual PayShap payouts).
create table if not exists public.driver_payout_requests (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete restrict,
  status text not null default 'REQUESTED' check (status in ('REQUESTED','PAID','CANCELLED')),
  card_earnings_cents bigint not null check (card_earnings_cents >= 0),
  debt_recovered_cents bigint not null check (debt_recovered_cents >= 0),
  net_cents bigint not null check (net_cents > 0),
  payable_ids uuid[] not null,
  payout_details jsonb not null default '{}'::jsonb,
  method text not null default 'PAYSHAP',
  reference text,
  note text,
  requested_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancel_reason text,
  check (card_earnings_cents = debt_recovered_cents + net_cents)
);
create unique index if not exists driver_payout_requests_one_open
  on public.driver_payout_requests(driver_id) where status = 'REQUESTED';
create index if not exists driver_payout_requests_status_idx on public.driver_payout_requests(status, requested_at desc);
alter table public.driver_payout_requests enable row level security;

-- Balance a driver can request now. Card earnings count from payout_v2_from, skip refunded
-- payments and anything already in an open/paid request. Debt (cash commission + booking fees) comes off first.
create or replace function public.moovu_driver_payout_balance(p_driver_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $function$
declare v_from timestamptz; v_earn bigint; v_ids uuid[]; v_debt bigint; v_open jsonb;
begin
  select p.payout_v2_from into v_from from public.phase5_policy_at(now()) p;
  if v_from is null then return jsonb_build_object('active', false); end if;

  select coalesce(sum(p.payable_cents),0), coalesce(array_agg(p.id order by p.earned_at), '{}')
    into v_earn, v_ids
  from public.online_driver_payables p
  join public.online_payment_attempts a on a.id = p.payment_attempt_id
  where p.driver_id = p_driver_id and p.state in ('EARNED','PAYABLE') and p.earned_at >= v_from
    and a.state = 'SUCCEEDED'
    and not exists (select 1 from public.online_payout_items i where i.payable_id = p.id)
    and not exists (select 1 from public.driver_payout_requests r
                    where r.status in ('REQUESTED','PAID') and p.id = any(r.payable_ids));

  select round(coalesce((public.phase05b_driver_debt(p_driver_id)->>'balance_due')::numeric,0)*100)::bigint into v_debt;

  select to_jsonb(r) into v_open from public.driver_payout_requests r
    where r.driver_id = p_driver_id and r.status = 'REQUESTED' limit 1;

  return jsonb_build_object(
    'active', true, 'from', v_from, 'minimum_cents', 5000,
    'card_earnings_cents', v_earn, 'owed_cents', v_debt,
    'debt_recovered_cents', least(v_earn, v_debt),
    'net_cents', greatest(0, v_earn - v_debt),
    'payable_ids', to_jsonb(v_ids),
    'open_request', v_open);
end $function$;

create or replace function public.moovu_request_driver_payout(p_driver_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_bal jsonb; v_acct public.driver_payout_accounts; v_row public.driver_payout_requests;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if p_driver_id = '6fe679ab-8065-48cc-84b0-5ddd56e300b6'::uuid then raise exception 'PAYOUT_NOT_ELIGIBLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||p_driver_id::text,0));
  v_bal := public.moovu_driver_payout_balance(p_driver_id);
  if not coalesce((v_bal->>'active')::boolean,false) then raise exception 'PAYOUTS_NOT_ACTIVE'; end if;
  if v_bal->'open_request' is not null and v_bal->'open_request' <> 'null'::jsonb then raise exception 'PAYOUT_ALREADY_REQUESTED'; end if;
  if (v_bal->>'net_cents')::bigint < 5000 then raise exception 'PAYOUT_BELOW_MINIMUM'; end if;
  select * into v_acct from public.driver_payout_accounts where driver_id = p_driver_id;
  if v_acct.driver_id is null or (coalesce(v_acct.payshap_id,'') = '' and coalesce(v_acct.account_number,'') = '') then
    raise exception 'PAYOUT_DETAILS_MISSING';
  end if;
  insert into public.driver_payout_requests(driver_id, card_earnings_cents, debt_recovered_cents, net_cents, payable_ids, payout_details)
  values (p_driver_id, (v_bal->>'card_earnings_cents')::bigint, (v_bal->>'debt_recovered_cents')::bigint,
          (v_bal->>'net_cents')::bigint,
          array(select jsonb_array_elements_text(v_bal->'payable_ids')::uuid),
          jsonb_build_object('payshap_id', v_acct.payshap_id, 'bank_name', v_acct.bank_name,
            'account_holder', v_acct.account_holder, 'account_number', v_acct.account_number,
            'branch_code', v_acct.branch_code, 'account_type', v_acct.account_type))
  returning * into v_row;
  return to_jsonb(v_row);
end $function$;

create or replace function public.moovu_mark_driver_payout_paid(p_request_id uuid, p_admin_id uuid, p_reference text, p_paid_at timestamptz)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_row public.driver_payout_requests; v_wallet uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if length(trim(coalesce(p_reference,''))) < 3 then raise exception 'PAYOUT_REFERENCE_REQUIRED'; end if;
  select * into v_row from public.driver_payout_requests where id = p_request_id for update;
  if v_row.id is null then raise exception 'PAYOUT_NOT_FOUND'; end if;
  if v_row.status = 'PAID' then return to_jsonb(v_row); end if;
  if v_row.status <> 'REQUESTED' then raise exception 'PAYOUT_NOT_OPEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('driver-finance:'||v_row.driver_id::text,0));
  if v_row.debt_recovered_cents > 0 then
    select id into v_wallet from public.driver_wallets where driver_id = v_row.driver_id;
    insert into public.driver_settlements(driver_id, wallet_id, amount_paid, payment_method, reference, note, received_by, operation_key)
    values (v_row.driver_id, v_wallet, v_row.debt_recovered_cents::numeric/100, 'payout_offset', trim(p_reference),
            'Taken from card earnings in payout '||v_row.id, p_admin_id, 'payout-offset:'||v_row.id)
    on conflict do nothing;
  end if;
  update public.driver_payout_requests set status = 'PAID', paid_at = coalesce(p_paid_at, now()),
    paid_by = p_admin_id, reference = trim(p_reference) where id = v_row.id returning * into v_row;
  perform public.phase05b_refresh_driver_wallet(v_row.driver_id);
  return to_jsonb(v_row);
end $function$;

create or replace function public.moovu_cancel_driver_payout(p_request_id uuid, p_admin_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_row public.driver_payout_requests;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  update public.driver_payout_requests set status = 'CANCELLED', cancelled_at = now(), cancelled_by = p_admin_id,
    cancel_reason = nullif(trim(coalesce(p_reason,'')),'')
  where id = p_request_id and status = 'REQUESTED' returning * into v_row;
  if v_row.id is null then raise exception 'PAYOUT_NOT_OPEN'; end if;
  return to_jsonb(v_row);
end $function$;

-- Customer refund requests (manual refunds over WhatsApp/bank).
create table if not exists public.customer_refund_requests (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  customer_id uuid not null,
  payment_attempt_id uuid not null references public.online_payment_attempts(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null check (reason in ('NO_DRIVER','DRIVER_CANCELLED','OTHER')),
  note text check (note is null or length(note) <= 500),
  status text not null default 'REQUESTED' check (status in ('REQUESTED','REFUNDED','DECLINED')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  reference text,
  decline_reason text,
  online_refund_id uuid references public.online_payment_refunds(id)
);
create unique index if not exists customer_refund_requests_one_per_trip
  on public.customer_refund_requests(trip_id) where status in ('REQUESTED','REFUNDED');
create index if not exists customer_refund_requests_status_idx on public.customer_refund_requests(status, requested_at desc);
alter table public.customer_refund_requests enable row level security;

create or replace function public.moovu_request_customer_refund(p_trip_id uuid, p_customer_id uuid, p_reason text, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_trip public.trips; v_pay public.online_payment_attempts; v_row public.customer_refund_requests;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into v_trip from public.trips where id = p_trip_id for update;
  if v_trip.id is null or v_trip.customer_id <> p_customer_id then raise exception 'REFUND_TRIP_NOT_FOUND'; end if;
  if v_trip.status <> 'cancelled' then raise exception 'REFUND_TRIP_NOT_CANCELLED'; end if;
  select * into v_pay from public.online_payment_attempts where trip_id = p_trip_id and state = 'SUCCEEDED'
    order by created_at desc limit 1;
  if v_pay.id is null then raise exception 'REFUND_NO_CARD_PAYMENT'; end if;
  select * into v_row from public.customer_refund_requests where trip_id = p_trip_id and status in ('REQUESTED','REFUNDED');
  if v_row.id is not null then return to_jsonb(v_row) || jsonb_build_object('replayed', true); end if;
  insert into public.customer_refund_requests(trip_id, customer_id, payment_attempt_id, amount_cents, reason, note)
  values (p_trip_id, p_customer_id, v_pay.id, v_pay.amount_cents, p_reason, nullif(trim(coalesce(p_note,'')),''))
  returning * into v_row;
  return to_jsonb(v_row);
end $function$;

create or replace function public.moovu_resolve_customer_refund(p_request_id uuid, p_admin_id uuid, p_refunded boolean, p_reference text, p_decline_reason text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_row public.customer_refund_requests; v_refund uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select * into v_row from public.customer_refund_requests where id = p_request_id for update;
  if v_row.id is null then raise exception 'REFUND_NOT_FOUND'; end if;
  if v_row.status <> 'REQUESTED' then return to_jsonb(v_row); end if;
  if p_refunded then
    if length(trim(coalesce(p_reference,''))) < 3 then raise exception 'REFUND_REFERENCE_REQUIRED'; end if;
    insert into public.online_payment_refunds(payment_attempt_id, provider, amount_cents, state, idempotency_key, reason,
      requested_by, provider_state, requested_at, completed_at)
    select a.id, a.provider, v_row.amount_cents, 'REFUNDED', 'manual-refund-request-'||v_row.id,
      'Refunded manually by admin, ref '||trim(p_reference), p_admin_id, 'manual_bank_transfer', v_row.requested_at, now()
    from public.online_payment_attempts a where a.id = v_row.payment_attempt_id
    returning id into v_refund;
    update public.online_payment_attempts set state = 'REFUND_PENDING', updated_at = now()
      where id = v_row.payment_attempt_id and state = 'SUCCEEDED';
    update public.online_payment_attempts set state = 'REFUNDED', updated_at = now()
      where id = v_row.payment_attempt_id and state = 'REFUND_PENDING';
    update public.customer_refund_requests set status = 'REFUNDED', resolved_at = now(), resolved_by = p_admin_id,
      reference = trim(p_reference), online_refund_id = v_refund where id = v_row.id returning * into v_row;
  else
    update public.customer_refund_requests set status = 'DECLINED', resolved_at = now(), resolved_by = p_admin_id,
      decline_reason = nullif(trim(coalesce(p_decline_reason,'')),'') where id = v_row.id returning * into v_row;
  end if;
  return to_jsonb(v_row);
end $function$;

revoke all on function public.moovu_driver_payout_balance(uuid) from public, anon, authenticated;
revoke all on function public.moovu_request_driver_payout(uuid) from public, anon, authenticated;
revoke all on function public.moovu_mark_driver_payout_paid(uuid,uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.moovu_cancel_driver_payout(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.moovu_request_customer_refund(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.moovu_resolve_customer_refund(uuid,uuid,boolean,text,text) from public, anon, authenticated;
