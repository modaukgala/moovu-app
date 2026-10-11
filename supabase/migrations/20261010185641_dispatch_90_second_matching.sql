-- Additive, opt-in matching authority. Existing trips without a window keep the
-- established 30-minute dispatch behavior.
create table public.dispatch_matching_windows (
  trip_id uuid primary key references public.trips(id) on delete restrict,
  payment_attempt_id uuid references public.online_payment_attempts(id) on delete restrict,
  started_at timestamptz not null,
  deadline_at timestamptz not null,
  state text not null default 'SEARCHING' check (state in ('SEARCHING','UNMATCHED')),
  reconciliation_item_id uuid unique references public.online_payment_reconciliation_items(id) on delete restrict,
  completed_at timestamptz,
  check (deadline_at = started_at + interval '90 seconds'),
  check ((state='SEARCHING' and completed_at is null) or (state='UNMATCHED' and completed_at is not null))
);
create index dispatch_matching_windows_due_idx on public.dispatch_matching_windows(deadline_at)
  where state='SEARCHING';
alter table public.dispatch_matching_windows enable row level security;
revoke all on public.dispatch_matching_windows from public, anon, authenticated;
grant select, insert, update on public.dispatch_matching_windows to service_role;

-- A provider payment can require one and only one no-driver resolution.
create unique index online_payment_no_driver_reconciliation_uidx
  on public.online_payment_reconciliation_items(payment_attempt_id)
  where issue_type='NO_DRIVER_MATCHING_TIMEOUT';

alter table public.driver_trip_offers add column matching_step smallint;
create unique index driver_trip_offers_matching_step_uidx
  on public.driver_trip_offers(trip_id,matching_step) where matching_step is not null;

create function public.start_dispatch_matching_window(p_trip_id uuid)
returns public.dispatch_matching_windows
language plpgsql security definer set search_path = ''
as $$
declare
  v_trip public.trips%rowtype;
  v_attempt public.online_payment_attempts%rowtype;
  v_window public.dispatch_matching_windows%rowtype;
  v_now timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted server role required';
  end if;
  select * into v_trip from public.trips where id=p_trip_id for update;
  if not found or v_trip.status not in ('requested','offered') or v_trip.driver_id is not null then
    raise exception 'Trip is not dispatchable';
  end if;
  select * into v_window from public.dispatch_matching_windows where trip_id=p_trip_id;
  if found then return v_window; end if;
  if lower(coalesce(v_trip.payment_method,''))='online' then
    select * into v_attempt from public.online_payment_attempts
    where trip_id=p_trip_id and state='SUCCEEDED' and verified_at is not null
    order by verified_at desc limit 1;
    if not found then raise exception 'Verified online payment required'; end if;
  elsif lower(coalesce(v_trip.payment_method,'')) not in ('cash','transfer','bank_transfer') then
    raise exception 'Unsupported dispatch payment method';
  end if;
  v_now := clock_timestamp();
  insert into public.dispatch_matching_windows(trip_id,payment_attempt_id,started_at,deadline_at)
  values(p_trip_id,v_attempt.id,v_now,v_now+interval '90 seconds')
  returning * into v_window;
  update public.trips set dispatch_started_at=coalesce(dispatch_started_at,v_now)
  where id=p_trip_id;
  return v_window;
end;
$$;
revoke all on function public.start_dispatch_matching_window(uuid) from public, anon, authenticated;
grant execute on function public.start_dispatch_matching_window(uuid) to service_role;

-- The established reservation RPC locks the trip before inserting an offer.
-- This trigger enforces the deadline under that same transaction/lock and
-- limits concurrent workers to one new offer per 10-second step.
create function public.guard_dispatch_matching_offer()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_window public.dispatch_matching_windows%rowtype;
  v_now timestamptz;
begin
  select * into v_window from public.dispatch_matching_windows where trip_id=new.trip_id;
  if not found then return new; end if;
  v_now := clock_timestamp();
  if v_window.state<>'SEARCHING' or v_now>=v_window.deadline_at then
    raise exception 'Matching window has ended' using errcode='P0001';
  end if;
  new.matching_step := floor(extract(epoch from (v_now-v_window.started_at))/10)::smallint;
  if new.matching_step not between 0 and 8 then
    raise exception 'Matching step is outside the offer window' using errcode='P0001';
  end if;
  return new;
end;
$$;
create trigger guard_dispatch_matching_offer before insert on public.driver_trip_offers
for each row execute function public.guard_dispatch_matching_offer();

create function public.finish_dispatch_matching_window(p_trip_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_trip public.trips%rowtype;
  v_window public.dispatch_matching_windows%rowtype;
  v_item uuid;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted server role required';
  end if;
  select * into v_trip from public.trips where id=p_trip_id for update;
  select * into v_window from public.dispatch_matching_windows where trip_id=p_trip_id for update;
  if not found then raise exception 'Matching window not found'; end if;
  if v_window.state='UNMATCHED' then
    return jsonb_build_object('changed',false,'replayed',true,'reconciliation_item_id',v_window.reconciliation_item_id);
  end if;
  if v_now<v_window.deadline_at then raise exception 'Matching deadline not reached'; end if;
  if v_trip.status not in ('requested','offered') or v_trip.driver_id is not null then
    return jsonb_build_object('changed',false,'replayed',false,'reason','Trip no longer awaits a Driver');
  end if;
  if exists(select 1 from public.driver_trip_offers where trip_id=p_trip_id
    and status in ('pending','shown') and accept_deadline_at>v_now) then
    return jsonb_build_object('changed',false,'replayed',false,'reason','Offer remains actionable');
  end if;
  if v_window.payment_attempt_id is not null then
    insert into public.online_payment_reconciliation_items
      (payment_attempt_id,issue_type,expected_amount_cents,currency,state,metadata)
    select a.id,'NO_DRIVER_MATCHING_TIMEOUT',a.amount_cents,a.currency,'OPEN',
      jsonb_build_object('trip_id',p_trip_id,'matching_deadline_at',v_window.deadline_at,
        'provider_checkout_id',a.provider_checkout_id,'resolution','REFUND_OR_RECONCILIATION_REQUIRED')
    from public.online_payment_attempts a
    where a.id=v_window.payment_attempt_id and a.state='SUCCEEDED' and a.verified_at is not null
    on conflict (payment_attempt_id) where issue_type='NO_DRIVER_MATCHING_TIMEOUT' do nothing
    returning id into v_item;
    if v_item is null then
      select id into v_item from public.online_payment_reconciliation_items
      where payment_attempt_id=v_window.payment_attempt_id and issue_type='NO_DRIVER_MATCHING_TIMEOUT';
    end if;
    if v_item is null then raise exception 'Verified payment reconciliation could not be recorded'; end if;
  end if;
  update public.trips set status='cancelled',cancel_reason='No Driver accepted within the matching window.',
    cancellation_reason='No Driver accepted within the matching window.',
    cancellation_reason_details='90-second dispatch matching exhausted',cancelled_by='system',
    cancelled_at=v_now,cancellation_type='dispatch_expiry',cancellation_fee_amount=0,
    cancellation_driver_amount=0,cancellation_moovu_amount=0,
    offer_status='cancelled',offer_expires_at=null where id=p_trip_id;
  update public.driver_trip_offers set status='expired',expired_at=coalesce(expired_at,v_now),
    responded_at=coalesce(responded_at,v_now),updated_at=v_now
    where trip_id=p_trip_id and status in ('pending','shown');
  update public.dispatch_jobs set status='cancelled',completed_at=coalesce(completed_at,v_now),updated_at=v_now
    where trip_id=p_trip_id and status in ('pending','processing');
  update public.dispatch_matching_windows set state='UNMATCHED',completed_at=v_now,
    reconciliation_item_id=v_item where trip_id=p_trip_id;
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status)
  values(p_trip_id,'dispatch_auto_cancelled','No Driver accepted within 90-second matching window.',v_trip.status,'cancelled');
  return jsonb_build_object('changed',true,'replayed',false,'reconciliation_item_id',v_item);
end;
$$;
revoke all on function public.finish_dispatch_matching_window(uuid) from public, anon, authenticated;
grant execute on function public.finish_dispatch_matching_window(uuid) to service_role;
