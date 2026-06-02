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
- `app_pricing_settings`: Server-managed platform pricing settings. The `manual_surge` key stores the active manual surge mode, label, multiplier, and customer message. Add with `docs/manual-surge-migration.sql`; admin APIs use service-role access and customers receive only read-only display data.
- `trip_cancellation_fees`: Review-only migration-backed ledger for free cancellations, late cancellation fees, and no-show fees. MOOVU Go late cancellation is R20 split R13 driver / R7 MOOVU, and no-show is R30 split R22 driver / R8 MOOVU. MOOVU Go XL late cancellation is R30 split R20 driver / R10 MOOVU, and no-show is R40 split R30 driver / R10 MOOVU. These are fixed fee splits and must not be treated as normal trip commission.
- `trip_messages`: Optional live chat messages between the customer and assigned driver for a specific accepted trip. Add with `docs/trip-chat-migration.sql`; do not run against production without approval.
- `trip_ratings`: Role-aware customer-to-driver and driver-to-customer ratings. Add/align with `docs/moovu-growth-features-migration.sql`; ratings must be unique per trip and reviewer role.
- `support_reports`: Optional unified customer/driver/admin support and incident report queue linked to trips. Existing `trip_issues` remains supported for customer trip issue reports.
- `referral_relationships`: Basic referral relationship tracking for customer and driver referral codes. Rewards are documented as coming soon and are not automatically financial.
- `driver_trip_offers`: Review-only migration-backed offer queue for staged dispatch. The current app still keeps `trips.driver_id`, `trips.offer_status`, and `trips.offer_expires_at` populated for compatibility, while writing offer queue rows when the migration exists.
- `driver_offer_stats`: Optional stats for received, accepted, rejected, and missed trip offers.
- `driver_wallets`: Driver commission balance, total commission, net earnings, completed trip count, and payment status.
- `driver_wallet_transactions`: Commission debit records per completed trip.
- `driver_settlements`: Commission payments received from drivers.
- `driver_payment_requests`: Driver proof-of-payment submissions for subscription, commission, or combined payments.
- `driver_subscription_payments`: Approved subscription payment records.
- `driver_subscription_events`: Admin subscription status/history records.
- `receipts`: Optional receipt records if enabled; receipt pages can also derive data from trips.
- `push_subscriptions`: Web push subscriptions keyed by endpoint with `user_id`, validated `role`, and serialized subscription payload.
- `fcm_tokens`: Firebase Cloud Messaging token storage keyed by `user_id`, `role`, `platform`, and `app_type` such as `android_customer`, `android_driver`, or `web_admin`. Writes should go through the server API because role ownership is verified server-side.

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
- Customer real email is stored in Supabase Auth metadata as `customer_email`. The optional `customers.email` column is documented in `docs/cancellation-management-migration.sql`; the app falls back to phone-compatible customer writes until that migration is applied.
- Commission is applied through `src/lib/finance/applyTripCommissionServer.ts`.
  New commission calculations use the shared service-type fare rules in `src/lib/domain/fare.ts`: MOOVU Go uses 10% and MOOVU Go XL uses 12%. The legacy `MOOVU_COMMISSION_PCT` constant remains for backward-compatible rows without a ride option.
  Drivers are blocked from going online when `driver_wallets.balance_due` is R100 or more, while still being allowed to log in and submit commission payments.
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

Persistent ride option reporting uses the nullable `ride_option` column on `trips` rather than overloading `ride_type`. The internal `group` value is displayed to customers as MOOVU Go XL for backward compatibility.

```sql
alter table public.trips
add column if not exists ride_option text;
```

Trip chat requires the non-destructive migration in `docs/trip-chat-migration.sql`.

If push subscriptions are currently public-writeable, tighten policies so authenticated users can only manage their own rows and role assignment remains server-validated.

## Add Stops And Final Fare

Pre-booking and active-trip stops use nullable `trips.stops` JSON plus route/fare audit columns so old trips without stops still display normally. Customers may add up to 2 stops. The server recalculates the route as pickup -> stop 1 -> stop 2 -> final destination and applies the approved 40% add-stop discount.

Active stops and end-OTP finalization require the review-only migration in `docs/final-fare-active-stop-migration.sql`. The app expects these additive fields when active stops are enabled:

- `estimated_fare`
- `fare_adjustment_amount`
- `fare_adjustment_reason`
- `fare_finalized_at`
- `actual_distance_km`
- `actual_duration_min`
- `actual_route_source`
- `active_stop_added_at`
- `active_stop_added_by`
- `active_stop_note`

The driver completion API finalizes `fare_amount`/`final_fare` before commission is applied, so receipts, driver earnings, and wallet commission use the same final customer fare.
