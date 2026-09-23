-- DISPOSABLE ONLY: tangtlmdpnvmoviwrgvd. Never apply this parity scaffold to production.
-- New-row checks match production; NOT VALID avoids rewriting incompatible historical test fixtures.
-- Matches booking/dispatch dependencies; does not alter any deletion FK.
begin;
alter table public.trips add column "rider_name" text;
alter table public.trips add column "rider_phone" text;
alter table public.trips add column "scheduled_for" timestamp with time zone;
alter table public.trips alter column "fare_amount" type numeric(10,2);
alter table public.trips alter column "status" set default 'requested'::text;
alter table public.trips alter column "distance_km" type numeric(10,2);
alter table public.trips alter column "duration_min" type numeric(10,2);
alter table public.trips add column "offer_attempted_driver_ids" uuid[] default '{}'::uuid[] not null;
alter table public.trips alter column "commission_pct" type numeric(5,2);
alter table public.trips alter column "commission_pct" set default 5.00;
alter table public.trips alter column "commission_amount" type numeric(10,2);
alter table public.trips alter column "driver_net_earnings" type numeric(10,2);
alter table public.trips add column "customer_auth_user_id" uuid;
alter table public.trips add column "issue_reported" boolean default false not null;
alter table public.trips add column "issue_report_note" text;
alter table public.trips alter column "cancellation_fee_amount" type numeric(12,2);
alter table public.trips alter column "cancellation_fee_amount" set default 0;
alter table public.trips add column "ride_type" text default 'now'::text not null;
alter table public.trips add column "schedule_status" text default 'none'::text not null;
alter table public.trips add column "scheduled_release_at" timestamp with time zone;
alter table public.trips add column "released_at" timestamp with time zone;
alter table public.trips add column "dispatch_priority_score" numeric(10,2) default 0 not null;
alter table public.trips alter column "cancellation_driver_amount" type numeric(10,2);
alter table public.trips alter column "cancellation_driver_amount" set default 0;
alter table public.trips alter column "cancellation_moovu_amount" type numeric(10,2);
alter table public.trips alter column "cancellation_moovu_amount" set default 0;
alter table public.trips add column "fare_breakdown" jsonb;
alter table public.trips add column "surge_label" text;
alter table public.trips add column "surge_multiplier" numeric(6,2);
alter table public.trips add column "remote_pickup_fee" numeric(12,2);
alter table public.trips add column "waiting_fee_amount" numeric(12,2);
alter table public.trips add column "chargeable_waiting_minutes" numeric(12,2);
alter table public.trips add column "long_distance_uplift_pct" numeric(6,2);
alter table public.trips add column "long_distance_uplift_amount" numeric(12,2);
alter table public.trips add column "customer_reliability_impact" numeric(5,2) default 0;
alter table public.trips add column "driver_reliability_impact" numeric(5,2) default 0;
alter table public.trips add column "stops" jsonb;
alter table public.trips add column "original_distance_km" numeric(10,2);
alter table public.trips add column "original_duration_min" numeric(10,2);
alter table public.trips alter column "original_fare" type numeric(12,2);
alter table public.trips alter column "route_distance_km" type numeric(10,2);
alter table public.trips alter column "route_duration_min" type numeric(10,2);
alter table public.trips add column "extra_stop_distance_km" numeric(10,2);
alter table public.trips add column "extra_stop_duration_min" numeric(10,2);
alter table public.trips add column "raw_add_stop_increase" numeric(12,2);
alter table public.trips add column "add_stop_discount_percent" numeric(5,2);
alter table public.trips alter column "final_add_stop_increase" type numeric(12,2);
alter table public.trips alter column "stop_waiting_fee" type numeric(12,2);
alter table public.trips alter column "final_fare" type numeric(12,2);
alter table public.trips alter column "estimated_fare" type numeric(12,2);
alter table public.trips alter column "fare_adjustment_amount" type numeric(12,2);
alter table public.trips alter column "fare_adjustment_amount" drop default;
alter table public.trips alter column "actual_distance_km" type numeric(10,2);
alter table public.trips alter column "actual_duration_min" type numeric(10,2);
alter table public.trips add column "actual_route_source" text;
alter table public.trips add column "active_stop_added_at" timestamp with time zone;
alter table public.trips add column "active_stop_added_by" uuid;
alter table public.trips add column "active_stop_note" text;
alter table public.trips add column "current_fare" numeric(12,2);
alter table public.trips add column "actual_fare_breakdown" jsonb;
alter table public.trips add column "fare_last_recalculated_at" timestamp with time zone;
alter table public.trips add column "auto_cancel_at" timestamp with time zone;
-- Legacy disposable fixtures contain nulls impossible under production constraints.
-- Normalize only these inert/default values before installing matching NOT NULL constraints.
update public.trips set pickup_address=coalesce(pickup_address,'Disposable parity legacy pickup'),dropoff_address=coalesce(dropoff_address,'Disposable parity legacy dropoff'),cancellation_fee_amount=coalesce(cancellation_fee_amount,0),completed_without_end_otp=coalesce(completed_without_end_otp,false) where pickup_address is null or dropoff_address is null or cancellation_fee_amount is null or completed_without_end_otp is null;
alter table public.trips alter column "pickup_address" set not null;
alter table public.trips alter column "dropoff_address" set not null;
alter table public.trips alter column "created_at" set not null;
alter table public.trips alter column "cancellation_fee_amount" set not null;
alter table public.trips alter column "completed_without_end_otp" set not null;
alter table public.trips add constraint disposable_booking_parity_1 CHECK (((actual_route_source IS NULL) OR (actual_route_source = ANY (ARRAY['route_estimate'::text, 'gps_audit'::text, 'admin_override'::text])))) NOT VALID;
alter table public.trips add constraint disposable_booking_parity_2 CHECK (((completed_by IS NULL) OR (completed_by = ANY (ARRAY['driver'::text, 'admin'::text])))) NOT VALID;
alter table public.trips add constraint disposable_booking_parity_3 CHECK (((end_otp_bypass_reason IS NULL) OR (end_otp_bypass_reason = ANY (ARRAY['Customer phone unavailable/dead'::text, 'Customer unable to access OTP'::text, 'Connectivity issue'::text, 'Customer left vehicle'::text, 'Other'::text])))) NOT VALID;
alter table public.trips add constraint disposable_booking_parity_4 CHECK (((ride_option IS NULL) OR (ride_option = ANY (ARRAY['go'::text, 'group'::text])))) NOT VALID;
alter table public.trips add constraint disposable_booking_parity_5 CHECK ((status = ANY (ARRAY['requested'::text, 'offered'::text, 'assigned'::text, 'arrived'::text, 'ongoing'::text, 'completed'::text, 'cancelled'::text]))) NOT VALID;
alter table public.trips add constraint disposable_booking_parity_6 CHECK (((stops IS NULL) OR (jsonb_typeof(stops) = 'array'::text))) NOT VALID;
alter table public.trips add constraint disposable_booking_parity_7 CHECK (((stops IS NULL) OR (jsonb_array_length(stops) <= 2))) NOT VALID;
alter table public.trips add constraint disposable_booking_parity_8 CHECK (((surge_label IS NULL) OR (surge_label = ANY (ARRAY['normal'::text, 'busy'::text, 'heavy_demand'::text, 'rain_event'::text])))) NOT VALID;
alter table public.trips add constraint disposable_booking_parity_9 CHECK (((surge_multiplier IS NULL) OR ((surge_multiplier >= (1)::numeric) AND (surge_multiplier <= 1.4)))) NOT VALID;
CREATE OR REPLACE FUNCTION public.set_dispatch_deadline()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.dispatch_started_at is not null then
    new.auto_cancel_at := coalesce(new.auto_cancel_at, new.dispatch_started_at + interval '5 minutes');
  end if;
  return new;
end;
$function$
;
CREATE TRIGGER set_dispatch_deadline_trigger BEFORE INSERT OR UPDATE OF dispatch_started_at ON public.trips FOR EACH ROW EXECUTE FUNCTION set_dispatch_deadline();
CREATE OR REPLACE FUNCTION public.set_trip_completed_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end;
$function$
;
CREATE TRIGGER set_trip_completed_at_trigger BEFORE UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION set_trip_completed_at();
CREATE OR REPLACE FUNCTION public.reserve_trip_offer(p_trip_id uuid, p_driver_id uuid, p_dispatch_cycle integer, p_sequence_number integer, p_distance_km numeric, p_road_eta_seconds integer, p_dispatch_score numeric, p_score_breakdown jsonb, p_escalation_seconds integer DEFAULT 10, p_accept_window_seconds integer DEFAULT 30, p_search_radius_km numeric DEFAULT 8)
 RETURNS TABLE(offer_id uuid, driver_id uuid, accept_deadline_at timestamp with time zone, escalates_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_trip public.trips%rowtype;
  v_driver public.drivers%rowtype;
  v_offer_id uuid;
  v_deadline timestamptz := now() + make_interval(secs => greatest(1, p_accept_window_seconds));
  v_escalates timestamptz := now() + make_interval(secs => greatest(1, p_escalation_seconds));
  v_balance numeric := 0;
  v_required_seats integer := 3;
begin
  select * into v_trip from public.trips t where t.id = p_trip_id for update;
  if not found then raise exception 'Trip not found' using errcode = 'P0002'; end if;
  if v_trip.status not in ('requested','offered') or (v_trip.driver_id is not null and v_trip.status <> 'offered') then
    raise exception 'Trip is no longer dispatchable' using errcode = 'P0001';
  end if;

  select * into v_driver from public.drivers d where d.id = p_driver_id for update;
  if not found then raise exception 'Driver not found' using errcode = 'P0002'; end if;
  if coalesce(v_driver.is_deleted, false)
     or v_driver.status not in ('approved','active')
     or (v_driver.verification_status is not null and v_driver.verification_status <> 'approved')
     or coalesce(v_driver.profile_completed, true) = false
     or not coalesce(v_driver.online, false)
     or v_driver.lat is null or v_driver.lng is null
     or v_driver.last_seen < now() - interval '8 hours'
     or v_driver.subscription_status not in ('active','grace')
     or v_driver.subscription_expires_at is null
     or v_driver.subscription_expires_at <= now() then
    raise exception 'Driver is not eligible' using errcode = 'P0001';
  end if;

  v_required_seats := case
    when lower(coalesce(v_trip.ride_option, 'go')) in ('group','xl','go_xl') then 6
    else 3
  end;
  if coalesce(v_driver.seating_capacity, 0) < v_required_seats then
    raise exception 'Driver vehicle is incompatible' using errcode = 'P0001';
  end if;

  select coalesce(w.balance_due, 0) into v_balance
  from public.driver_wallets w
  where w.driver_id = p_driver_id;
  if coalesce(v_balance, 0) >= 100 then
    raise exception 'Driver commission balance is locked' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.trips t
    where t.driver_id = p_driver_id
      and t.status in ('assigned','arrived','ongoing')
      and t.id <> p_trip_id
  ) then
    raise exception 'Driver already has an active trip' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.driver_trip_offers o
    where o.trip_id = p_trip_id
      and o.driver_id = p_driver_id
      and o.status = 'declined'
  ) then
    raise exception 'Driver already declined this trip' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.driver_trip_offers o
    where o.driver_id = p_driver_id
      and o.status in ('pending','shown')
      and o.accept_deadline_at > now()
  ) then
    raise exception 'Driver has another active reservation' using errcode = 'P0001';
  end if;

  insert into public.driver_trip_offers(
    trip_id, driver_id, dispatch_cycle, sequence_number, status, offered_at,
    visible_until, escalates_at, accept_deadline_at, distance_km, road_eta_seconds,
    dispatch_score, dispatch_score_breakdown, search_radius_km
  ) values (
    p_trip_id, p_driver_id, greatest(1,p_dispatch_cycle), greatest(1,p_sequence_number), 'shown', now(),
    v_escalates, v_escalates, v_deadline, p_distance_km, p_road_eta_seconds,
    p_dispatch_score, coalesce(p_score_breakdown,'{}'::jsonb), p_search_radius_km
  ) returning id into v_offer_id;

  update public.trips t set
    status = 'offered',
    offer_status = 'pending',
    offer_expires_at = greatest(coalesce(t.offer_expires_at, v_deadline), v_deadline),
    dispatch_started_at = coalesce(t.dispatch_started_at, now()),
    dispatch_cycle = greatest(1,p_dispatch_cycle),
    dispatch_sequence = greatest(1,p_sequence_number),
    dispatch_state = 'searching',
    dispatch_search_radius_km = p_search_radius_km,
    dispatch_failure_reason = null,
    dispatch_updated_at = now()
  where t.id = p_trip_id;

  insert into public.trip_events(trip_id,event_type,message,old_status,new_status)
  values (p_trip_id,'offer_created',format('Cycle %s sequence %s reserved driver %s',p_dispatch_cycle,p_sequence_number,p_driver_id),v_trip.status,'offered');

  return query select v_offer_id as offer_id, p_driver_id as driver_id, v_deadline as accept_deadline_at, v_escalates as escalates_at;
end;
$function$
;
notify pgrst,'reload schema';
commit;
