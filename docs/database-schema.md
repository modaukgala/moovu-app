# MOOVU Supabase Database Notes

This document describes the Supabase objects the current MOOVU app expects. It is documentation only; no destructive schema changes are applied by the app.

## Core Tables

- `profiles`: Supabase auth profile records with `id` matching `auth.users.id` and `role` for admin access. Admin roles currently accepted by the app are `owner`, `admin`, `dispatcher`, and `support`.
- `customers`: Customer profile details linked to authenticated users where available.
- `drivers`: Driver profile, vehicle, online status, GPS heartbeat, verification, subscription status, and subscription due fields.
- `driver_accounts`: Maps Supabase auth users to `drivers.id`; required for driver ownership checks.
- `driver_applications`: Driver application data before approval.
- `driver_documents`: Driver document metadata and review status.
- `trips`: Ride lifecycle data including customer, driver, pickup/dropoff, fare, ride status, offer state, OTP fields, and commission fields.
- `trip_events`: Audit trail for trip status changes, offers, OTP verification, commission application, and admin actions.
- `trip_messages`: Optional live chat messages between the customer and assigned driver for a specific accepted trip. Add with `docs/trip-chat-migration.sql`; do not run against production without approval.
- `driver_offer_stats`: Optional stats for received, accepted, rejected, and missed trip offers.
- `driver_wallets`: Driver commission balance, total commission, net earnings, completed trip count, and payment status.
- `driver_wallet_transactions`: Commission debit records per completed trip.
- `driver_settlements`: Commission payments received from drivers.
- `driver_payment_requests`: Driver proof-of-payment submissions for subscription, commission, or combined payments.
- `driver_subscription_payments`: Approved subscription payment records.
- `driver_subscription_events`: Admin subscription status/history records.
- `receipts`: Optional receipt records if enabled; receipt pages can also derive data from trips.
- `push_subscriptions`: Web push subscriptions keyed by endpoint with `user_id`, validated `role`, and serialized subscription payload.

## Storage Buckets

- `driver-docs`: Driver identity, license, vehicle, and compliance documents.
- `payment-proofs`: Driver proof-of-payment uploads for subscriptions and commission payments. This bucket should be private; store object paths in `driver_payment_requests.pop_file_path` and expose files to admins through short-lived signed URLs.

## Important Existing Logic

- Driver subscription plans are centralized in `src/lib/finance/driverPayments.ts`:
  - `day`: R45 for 1 day
  - `week`: R100 for 7 days
  - `month`: R250 for 30 days
- Customer ride options and fare calculation should remain centralized in the fare domain files.
- Customer legal acceptance is currently stored in Supabase Auth user metadata during signup or the one-time booking prompt. Optional `customers` mirror columns are documented in `docs/legal-acceptance-migration.sql`.
- Commission is applied through `src/lib/finance/applyTripCommissionServer.ts`.
  New commission calculations use the shared `MOOVU_COMMISSION_PCT` constant in `src/lib/finance/commission.ts`, currently `7%`.
  Existing completed trips keep their stored `commission_pct`, `commission_amount`, and wallet history unless a separate approved data migration is run.
- Admin API access uses `requireAdminUser`.
- Driver API ownership is based on `driver_accounts.user_id -> driver_id`.

## RLS Guidance

Recommended RLS policies:

- Customers can read only their own customer profile, trips, trip events, and receipts.
- Drivers can read/update only their own driver profile, active offers, trip workflow actions, earnings, payment requests, and documents.
- Trip chat messages should be limited to the owning customer and the assigned driver after driver acceptance. Sending should be limited to active trip states; completed/cancelled trips can remain readable for support context.
- Admin roles can read operational tables and perform review actions through server APIs.
- `push_subscriptions` inserts should be mediated by `/api/push/subscribe`; users should not be able to claim arbitrary roles directly.
- Storage buckets should restrict reads/writes by role and ownership; admin service-role APIs can generate signed URLs where private access is required.
- `payment-proofs` should not be public in production. Driver upload APIs may use service-role writes after driver ownership is verified; admin review APIs should create signed URLs only after admin role verification.

## Non-Destructive Migration Notes

If persistent ride option reporting is required later, add a nullable `ride_option` column to `trips` rather than overloading `ride_type`.

```sql
alter table public.trips
add column if not exists ride_option text;
```

Trip chat requires the non-destructive migration in `docs/trip-chat-migration.sql`.

If push subscriptions are currently public-writeable, tighten policies so authenticated users can only manage their own rows and role assignment remains server-validated.
