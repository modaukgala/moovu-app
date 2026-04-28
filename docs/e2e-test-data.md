# MOOVU E2E Test Data Guide

Use this guide to prepare a local or staging database for real operational testing.

## Current Local Data Snapshot

At the time of this pass, the connected Supabase project contained:

- `trips`: 3 rows, all `completed`
- `drivers`: 2 rows
- `driver_accounts`: 2 rows
- `driver_payment_requests`: 0 rows
- `driver_wallets`: 2 rows
- `driver_settlements`: 0 rows
- `push_subscriptions`: 0 rows

That means the full live ride lifecycle cannot be honestly tested until a requested/offered/assigned trip and pending payment requests exist.

## Safe Seed Options

Preferred approach:

1. Create a test customer through the app or Supabase Auth.
2. Create a test driver through the app or Supabase Auth.
3. Copy both auth user IDs.
4. Open `docs/dev-seed-data.sql`.
5. Replace:
   - `__CUSTOMER_AUTH_USER_ID__`
   - `__DRIVER_AUTH_USER_ID__`
6. Run the SQL only in local/staging Supabase.

The SQL creates:

- One active test customer profile
- One approved, online, active-subscription driver
- One driver account link
- One requested trip with OTP values:
  - start OTP: `1234`
  - end OTP: `5678`
- One wallet with R50 commission owed
- One pending subscription payment request
- One pending commission payment request

## E2E Ride Lifecycle

After seeding:

1. Open `/admin/trips`.
2. Open the seeded trip or dispatch it from `/admin/dispatch`.
3. Trigger offer-next-driver if the trip is still `requested`.
4. Log in as the linked test driver.
5. Open `/driver`.
6. Confirm the offer appears.
7. Accept the offer.
8. Confirm the trip status becomes `assigned`.
9. Use the driver dashboard to mark arrived.
10. Enter start OTP `1234`.
11. Start the trip.
12. Enter end OTP `5678`.
13. Complete the trip.
14. Confirm `/driver/earnings` shows updated commission and net earnings.
15. Confirm `/ride/[tripId]/receipt` opens.
16. Confirm `/admin/trips` shows the completed trip.

## Payment Review Flow

After seeding:

1. Open `/admin/payment-reviews`.
2. Filter by `Pending review`.
3. Confirm both subscription and commission payment requests are visible.
4. Approve the subscription request.
5. Confirm the driver subscription is active on `/admin/subscriptions`.
6. Approve the commission request.
7. Confirm commission owed reduces to R0.00 if the seeded wallet balance was R50.
8. Reject flow can be tested by reseeding or creating a fresh payment request from `/driver/earnings`.

## Notes

- Do not run seed SQL against production.
- Do not use real customer phone numbers or driver documents in seed data.
- Push notification testing requires valid VAPID keys and real browser subscriptions.
