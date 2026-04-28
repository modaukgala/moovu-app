-- MOOVU dev/e2e seed data
--
-- REVIEW BEFORE RUNNING.
-- This script is opt-in and intended for a local/staging Supabase project only.
-- Do not run against production.
--
-- Before running:
-- 1. Create or identify two Supabase Auth users:
--    - one customer user
--    - one driver user
-- 2. Replace these placeholders everywhere:
--    - __CUSTOMER_AUTH_USER_ID__
--    - __DRIVER_AUTH_USER_ID__
-- 3. Confirm these fixed test UUIDs do not collide with real rows.
--
-- This script uses upserts and clearly marked dev records. It does not delete data.

begin;

-- Stable test IDs for repeatable local E2E testing.
-- Replace only if these IDs already exist for real data in your database.
with ids as (
  select
    '11111111-1111-4111-8111-111111111111'::uuid as customer_id,
    '22222222-2222-4222-8222-222222222222'::uuid as driver_id,
    '33333333-3333-4333-8333-333333333333'::uuid as requested_trip_id,
    '44444444-4444-4444-8444-444444444444'::uuid as wallet_id,
    '55555555-5555-4555-8555-555555555555'::uuid as subscription_payment_request_id,
    '66666666-6666-4666-8666-666666666666'::uuid as commission_payment_request_id
)
insert into public.profiles (id, role)
values
  ('__CUSTOMER_AUTH_USER_ID__'::uuid, 'customer'),
  ('__DRIVER_AUTH_USER_ID__'::uuid, 'driver')
on conflict (id) do update
set role = excluded.role;

with ids as (
  select '11111111-1111-4111-8111-111111111111'::uuid as customer_id
)
insert into public.customers (
  id,
  auth_user_id,
  first_name,
  last_name,
  phone,
  normalized_phone,
  status
)
select
  ids.customer_id,
  '__CUSTOMER_AUTH_USER_ID__'::uuid,
  'MOOVU',
  'Test Customer',
  '0790000001',
  '0790000001',
  'active'
from ids
on conflict (id) do update
set
  auth_user_id = excluded.auth_user_id,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  phone = excluded.phone,
  normalized_phone = excluded.normalized_phone,
  status = excluded.status;

with ids as (
  select '22222222-2222-4222-8222-222222222222'::uuid as driver_id
)
insert into public.drivers (
  id,
  first_name,
  last_name,
  phone,
  email,
  status,
  verification_status,
  online,
  busy,
  lat,
  lng,
  last_seen,
  vehicle_make,
  vehicle_model,
  vehicle_color,
  vehicle_registration,
  seating_capacity,
  subscription_status,
  subscription_plan,
  subscription_expires_at,
  subscription_amount_due,
  updated_at
)
select
  ids.driver_id,
  'MOOVU',
  'Test Driver',
  '0790000002',
  'moovu.test.driver@example.com',
  'approved',
  'approved',
  true,
  false,
  -25.1136,
  29.0445,
  now(),
  'Toyota',
  'Avanza',
  'White',
  'TEST123MP',
  6,
  'active',
  'month',
  now() + interval '30 days',
  0,
  now()
from ids
on conflict (id) do update
set
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  phone = excluded.phone,
  email = excluded.email,
  status = excluded.status,
  verification_status = excluded.verification_status,
  online = excluded.online,
  busy = excluded.busy,
  lat = excluded.lat,
  lng = excluded.lng,
  last_seen = excluded.last_seen,
  vehicle_make = excluded.vehicle_make,
  vehicle_model = excluded.vehicle_model,
  vehicle_color = excluded.vehicle_color,
  vehicle_registration = excluded.vehicle_registration,
  seating_capacity = excluded.seating_capacity,
  subscription_status = excluded.subscription_status,
  subscription_plan = excluded.subscription_plan,
  subscription_expires_at = excluded.subscription_expires_at,
  subscription_amount_due = excluded.subscription_amount_due,
  updated_at = excluded.updated_at;

insert into public.driver_accounts (user_id, driver_id)
values ('__DRIVER_AUTH_USER_ID__'::uuid, '22222222-2222-4222-8222-222222222222'::uuid)
on conflict (user_id) do update
set driver_id = excluded.driver_id;

insert into public.driver_wallets (
  id,
  driver_id,
  balance_due,
  total_commission,
  total_driver_net,
  total_trips_completed,
  total_paid,
  account_status,
  updated_at
)
values (
  '44444444-4444-4444-8444-444444444444'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid,
  50,
  50,
  950,
  1,
  0,
  'due',
  now()
)
on conflict (driver_id) do update
set
  balance_due = excluded.balance_due,
  total_commission = excluded.total_commission,
  total_driver_net = excluded.total_driver_net,
  total_trips_completed = excluded.total_trips_completed,
  total_paid = excluded.total_paid,
  account_status = excluded.account_status,
  updated_at = excluded.updated_at;

-- Requested trip that can be offered to the active test driver by the dispatch logic.
insert into public.trips (
  id,
  customer_id,
  customer_auth_user_id,
  rider_name,
  rider_phone,
  pickup_address,
  dropoff_address,
  pickup_lat,
  pickup_lng,
  dropoff_lat,
  dropoff_lng,
  payment_method,
  distance_km,
  duration_min,
  fare_amount,
  status,
  ride_type,
  schedule_status,
  offer_status,
  driver_id,
  start_otp,
  end_otp,
  start_otp_verified,
  end_otp_verified,
  otp_verified,
  created_at
)
values (
  '33333333-3333-4333-8333-333333333333'::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid,
  '__CUSTOMER_AUTH_USER_ID__'::uuid,
  'MOOVU Test Customer',
  '0790000001',
  'Siyabuswa Mall, Siyabuswa',
  'KwaMhlanga Crossing, KwaMhlanga',
  -25.1136,
  29.0445,
  -25.4260,
  28.7099,
  'cash',
  42.5,
  48,
  395,
  'requested',
  'now',
  'none',
  null,
  null,
  '1234',
  '5678',
  false,
  false,
  false,
  now()
)
on conflict (id) do update
set
  customer_id = excluded.customer_id,
  customer_auth_user_id = excluded.customer_auth_user_id,
  rider_name = excluded.rider_name,
  rider_phone = excluded.rider_phone,
  pickup_address = excluded.pickup_address,
  dropoff_address = excluded.dropoff_address,
  pickup_lat = excluded.pickup_lat,
  pickup_lng = excluded.pickup_lng,
  dropoff_lat = excluded.dropoff_lat,
  dropoff_lng = excluded.dropoff_lng,
  payment_method = excluded.payment_method,
  distance_km = excluded.distance_km,
  duration_min = excluded.duration_min,
  fare_amount = excluded.fare_amount,
  status = excluded.status,
  ride_type = excluded.ride_type,
  schedule_status = excluded.schedule_status,
  offer_status = excluded.offer_status,
  driver_id = excluded.driver_id,
  start_otp = excluded.start_otp,
  end_otp = excluded.end_otp,
  start_otp_verified = excluded.start_otp_verified,
  end_otp_verified = excluded.end_otp_verified,
  otp_verified = excluded.otp_verified;

insert into public.trip_events (trip_id, event_type, message, old_status, new_status)
values (
  '33333333-3333-4333-8333-333333333333'::uuid,
  'dev_seed_trip_created',
  'Dev seed requested trip for E2E testing.',
  null,
  'requested'
);

-- Pending subscription payment review.
insert into public.driver_payment_requests (
  id,
  driver_id,
  payment_type,
  subscription_plan,
  amount_expected,
  amount_submitted,
  payment_reference,
  note,
  pop_file_path,
  pop_file_url,
  status,
  submitted_at
)
values (
  '55555555-5555-4555-8555-555555555555'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid,
  'subscription',
  'month',
  250,
  250,
  'DEV-SUB-MONTH',
  'DEV ONLY: subscription proof placeholder.',
  null,
  null,
  'pending_payment_review',
  now()
)
on conflict (id) do update
set
  amount_expected = excluded.amount_expected,
  amount_submitted = excluded.amount_submitted,
  status = excluded.status,
  submitted_at = excluded.submitted_at;

-- Pending commission payment review.
insert into public.driver_payment_requests (
  id,
  driver_id,
  payment_type,
  subscription_plan,
  amount_expected,
  amount_submitted,
  payment_reference,
  note,
  pop_file_path,
  pop_file_url,
  status,
  submitted_at
)
values (
  '66666666-6666-4666-8666-666666666666'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid,
  'commission',
  null,
  50,
  50,
  'DEV-COMM-50',
  'DEV ONLY: commission proof placeholder.',
  null,
  null,
  'pending_payment_review',
  now()
)
on conflict (id) do update
set
  amount_expected = excluded.amount_expected,
  amount_submitted = excluded.amount_submitted,
  status = excluded.status,
  submitted_at = excluded.submitted_at;

commit;
