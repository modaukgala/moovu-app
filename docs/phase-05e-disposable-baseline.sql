-- DISPOSABLE DATABASE TEST FIXTURE ONLY. NEVER APPLY TO PRODUCTION.
-- Minimal anonymized production-compatible schema for Phase 0.5E validation.
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,role text not null);
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path=public,auth as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role in ('owner','admin','dispatcher','support'))
$$;
create table public.drivers(id uuid primary key default gen_random_uuid(),first_name text,last_name text,phone text,email text,status text,online boolean default false,busy boolean default false,subscription_status text,subscription_expires_at timestamptz,subscription_plan text,subscription_amount_due numeric default 0,subscription_last_paid_at timestamptz,subscription_last_payment_amount numeric,verification_status text,profile_completed boolean default false,is_deleted boolean default false,vehicle_make text,vehicle_model text,vehicle_year text,vehicle_color text,vehicle_registration text,vehicle_vin text,vehicle_engine_number text,seating_capacity integer,lat numeric,lng numeric,last_seen timestamptz,updated_at timestamptz default now());
create table public.driver_accounts(user_id uuid primary key references auth.users(id) on delete cascade,driver_id uuid unique references public.drivers(id) on delete cascade,created_at timestamptz default now());
create table public.driver_profiles(id uuid primary key default gen_random_uuid(),driver_id uuid not null unique references public.drivers(id) on delete cascade,first_name text,last_name text,phone text,id_number text,home_address text,area_name text,emergency_contact_name text,emergency_contact_phone text,verification_status text,updated_at timestamptz default now());
create table public.driver_applications(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,full_name text,phone text,email text,notes text,status text not null default 'pending',created_at timestamptz default now());
create table public.customers(id uuid primary key default gen_random_uuid(),auth_user_id uuid not null references auth.users(id) on delete cascade);
create table public.driver_wallets(id uuid primary key default gen_random_uuid(),driver_id uuid not null unique references public.drivers(id) on delete cascade,balance_due numeric default 0,total_commission numeric default 0,total_driver_net numeric default 0,total_trips_completed integer default 0,account_status text,updated_at timestamptz default now(),created_at timestamptz default now());
create table public.trips(id uuid primary key default gen_random_uuid(),created_by uuid,customer_id uuid references public.customers(id),driver_id uuid references public.drivers(id),status text not null,created_at timestamptz default now(),fare_amount numeric,final_fare numeric,estimated_fare numeric,original_fare numeric,commission_pct numeric,commission_amount numeric,driver_net_earnings numeric,start_otp text,end_otp text,start_otp_verified boolean default false,end_otp_verified boolean default false,trip_started_at timestamptz,duration_min numeric,ride_option text,completed_at timestamptz,completed_without_end_otp boolean default false,end_otp_bypass_reason text,end_otp_bypass_note text,end_otp_bypassed_by uuid,end_otp_bypassed_at timestamptz,completed_by text,admin_completion_reason text,admin_completion_note text,fare_finalized_at timestamptz,fare_adjustment_amount numeric default 0,fare_adjustment_reason text,pickup_lat numeric,pickup_lng numeric,driver_arrived_at timestamptz,no_show_eligible_at timestamptz,free_cancellation_until timestamptz,cancellation_fee_amount numeric,cancellation_driver_amount numeric,cancellation_moovu_amount numeric,cancellation_policy_code text,cancellation_reason text,cancellation_type text,cancel_reason text,cancelled_by text,cancelled_at timestamptz,offer_status text,offer_expires_at timestamptz);
create table public.driver_wallet_transactions(id uuid primary key default gen_random_uuid(),driver_id uuid not null references public.drivers(id) on delete cascade,wallet_id uuid not null references public.driver_wallets(id) on delete cascade,trip_id uuid references public.trips(id) on delete set null,tx_type text check(tx_type in ('commission','payment','adjustment')),amount numeric,direction text,description text,meta jsonb default '{}'::jsonb,created_by uuid references public.profiles(id),created_at timestamptz default now());
create table public.driver_settlements(id uuid primary key default gen_random_uuid(),driver_id uuid not null references public.drivers(id) on delete cascade,wallet_id uuid references public.driver_wallets(id) on delete set null,amount_paid numeric,payment_method text,reference text,note text,received_by uuid references public.profiles(id) on delete set null,created_at timestamptz default now());
create table public.driver_payment_requests(id uuid primary key default gen_random_uuid(),driver_id uuid not null references public.drivers(id) on delete cascade,payment_type text,subscription_plan text,amount_expected numeric default 0,amount_submitted numeric default 0,payment_reference text,note text,status text,review_note text,submitted_at timestamptz default now(),reviewed_at timestamptz,reviewed_by uuid);
create table public.driver_subscription_payments(id uuid primary key default gen_random_uuid(),driver_id uuid not null references public.drivers(id) on delete cascade,amount_paid numeric,payment_method text,reference text,note text,received_by uuid,created_at timestamptz default now());
create table public.driver_subscription_events(id uuid primary key default gen_random_uuid(),driver_id uuid not null references public.drivers(id) on delete cascade,actor text,action text,old_status text,new_status text,old_expires_at timestamptz,new_expires_at timestamptz,note text,created_at timestamptz default now());
create table public.trip_events(id uuid primary key default gen_random_uuid(),trip_id uuid not null references public.trips(id) on delete cascade,event_type text,message text,old_status text,new_status text,created_by uuid references public.profiles(id),created_at timestamptz default now());
create table public.trip_cancellation_fees(id uuid primary key default gen_random_uuid(),trip_id uuid not null unique references public.trips(id) on delete cascade,customer_id uuid references public.customers(id) on delete set null,driver_id uuid references public.drivers(id) on delete set null,fee_type text,fee_amount numeric,driver_amount numeric,moovu_amount numeric,reason text,created_by uuid,created_at timestamptz default now());
create table public.driver_trip_offers(id uuid primary key default gen_random_uuid(),trip_id uuid not null references public.trips(id) on delete cascade,driver_id uuid not null references public.drivers(id) on delete cascade,status text check(status in ('pending','shown','accepted','declined','expired','cancelled')),offered_at timestamptz default now(),responded_at timestamptz,cancelled_at timestamptz,updated_at timestamptz default now());
create table public.app_notifications(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,role text,title text,body text,url text,data jsonb default '{}'::jsonb,delivery_status text default 'queued',error_message text,read_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.driver_offer_stats(driver_id uuid primary key references public.drivers(id) on delete cascade,offers_received integer default 0,last_offer_at timestamptz,updated_at timestamptz default now());
create or replace function public.refresh_driver_subscription(did uuid) returns void language plpgsql as $$ begin update public.drivers set subscription_status=case when subscription_expires_at<now() then 'inactive' else subscription_status end where id=did; end $$;
create or replace function public.increment_driver_offer_received(p_driver_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin insert into public.driver_offer_stats(driver_id,offers_received,last_offer_at) values(p_driver_id,1,now()) on conflict(driver_id) do update set offers_received=driver_offer_stats.offers_received+1,last_offer_at=now(); end $$;

-- PRODUCTION-EXISTING RLS TEST FIXTURE (read-only metadata snapshot, 2026-09-01).
-- These policies reproduce the pre-Phase-0 production permission landscape.
-- They are not Phase 0 migration-introduced policies and must never be applied
-- automatically or directly to production.
alter table public.profiles enable row level security;
alter table public.drivers enable row level security;
alter table public.driver_accounts enable row level security;
alter table public.driver_profiles enable row level security;
alter table public.driver_applications enable row level security;
alter table public.customers enable row level security;
alter table public.driver_wallets enable row level security;
alter table public.trips enable row level security;
alter table public.driver_wallet_transactions enable row level security;
alter table public.driver_settlements enable row level security;
alter table public.driver_payment_requests enable row level security;
alter table public.driver_subscription_payments enable row level security;
alter table public.driver_subscription_events enable row level security;
alter table public.trip_events enable row level security;
alter table public.trip_cancellation_fees enable row level security;
alter table public.driver_trip_offers enable row level security;
alter table public.app_notifications enable row level security;
alter table public.driver_offer_stats enable row level security;

create policy "staff access profiles" on public.profiles
  for select using ((id = auth.uid()) or public.is_staff());

create policy drivers_select_own on public.drivers
  for select to authenticated
  using (id = (select driver_id from public.driver_accounts where user_id = auth.uid()));
create policy drivers_select_own_linked on public.drivers
  for select to authenticated
  using (exists (select 1 from public.driver_accounts da where da.user_id=auth.uid() and da.driver_id=drivers.id));
create policy drivers_update_own_linked on public.drivers
  for update to authenticated
  using (exists (select 1 from public.driver_accounts da where da.user_id=auth.uid() and da.driver_id=drivers.id))
  with check (exists (select 1 from public.driver_accounts da where da.user_id=auth.uid() and da.driver_id=drivers.id));
create policy drivers_update_own_location on public.drivers
  for update to authenticated
  using (id = (select driver_id from public.driver_accounts where user_id = auth.uid()))
  with check (id = (select driver_id from public.driver_accounts where user_id = auth.uid()));
create policy "staff manage drivers" on public.drivers
  for all using (public.is_staff()) with check (public.is_staff());

create policy driver_accounts_select_own on public.driver_accounts for select to authenticated using(user_id=auth.uid());
create policy driver_accounts_insert_own on public.driver_accounts for insert to authenticated with check(user_id=auth.uid());

create policy driver_applications_select_own on public.driver_applications
  for select to authenticated using (user_id=auth.uid());
create policy driver_applications_insert_own on public.driver_applications
  for insert to authenticated with check (user_id=auth.uid());

create policy driver_profiles_select_own on public.driver_profiles
  for select to authenticated
  using (exists (select 1 from public.driver_accounts da where da.user_id=auth.uid() and da.driver_id=driver_profiles.driver_id));
create policy driver_profiles_insert_own on public.driver_profiles
  for insert to authenticated
  with check (exists (select 1 from public.driver_accounts da where da.user_id=auth.uid() and da.driver_id=driver_profiles.driver_id));
create policy driver_profiles_update_own on public.driver_profiles
  for update to authenticated
  using (exists (select 1 from public.driver_accounts da where da.user_id=auth.uid() and da.driver_id=driver_profiles.driver_id))
  with check (exists (select 1 from public.driver_accounts da where da.user_id=auth.uid() and da.driver_id=driver_profiles.driver_id));

create policy "staff manage driver_wallets" on public.driver_wallets
  for all using (public.is_staff()) with check (public.is_staff());
create policy "staff manage driver_wallet_transactions" on public.driver_wallet_transactions
  for all using (public.is_staff()) with check (public.is_staff());

create policy "staff manage trips" on public.trips
  for all using (public.is_staff()) with check (public.is_staff());
create policy trips_select_own_driver on public.trips
  for select to authenticated
  using (driver_id = (select driver_id from public.driver_accounts where user_id=auth.uid()));
create policy "staff manage trip events" on public.trip_events
  for all using (public.is_staff()) with check (public.is_staff());

create policy "Customers can read own cancellation fees" on public.trip_cancellation_fees
  for select using (exists (select 1 from public.customers c where c.id=trip_cancellation_fees.customer_id and c.auth_user_id=auth.uid()));
create policy "Drivers can read own cancellation fees" on public.trip_cancellation_fees
  for select using (exists (select 1 from public.driver_accounts da where da.driver_id=trip_cancellation_fees.driver_id and da.user_id=auth.uid()));

create policy "Drivers can read own trip offers" on public.driver_trip_offers
  for select using (exists (select 1 from public.driver_accounts da where da.driver_id=driver_trip_offers.driver_id and da.user_id=auth.uid()));
create policy "Service role can manage driver trip offers" on public.driver_trip_offers
  for all using (auth.role()='service_role') with check (auth.role()='service_role');

create policy "Users can read own app notifications" on public.app_notifications
  for select using (auth.uid()=user_id);
create policy "Users can update own app notifications" on public.app_notifications
  for update using (auth.uid()=user_id) with check (auth.uid()=user_id);

grant all on all tables in schema public to anon,authenticated,service_role;
grant execute on function public.refresh_driver_subscription(uuid),public.increment_driver_offer_received(uuid) to anon,authenticated,service_role;
