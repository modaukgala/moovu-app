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

1. Log in as the test customer and enable customer push notifications.
2. Log in as the linked test driver and enable driver push notifications.
3. Log in as an admin and enable admin push notifications.
4. Open `/admin/trips`.
5. Open the seeded trip or dispatch it from `/admin/dispatch`.
6. Trigger offer-next-driver if the trip is still `requested`.
7. Open `/driver`.
8. Confirm the offer appears and the driver receives a new trip offer notification.
9. Accept the offer.
10. Confirm the trip status becomes `assigned` and the customer receives a driver-on-the-way notification.
11. Confirm the customer sees `Chat with driver` on `/ride/[tripId]`.
12. Confirm the driver sees `Chat with customer` on `/driver`.
13. Send a customer chat message and confirm it appears for the driver.
14. Send a driver chat reply and confirm it appears for the customer.
15. Confirm chat notifications route to `/driver` for the driver and `/ride/[tripId]` for the customer.
16. Use the driver dashboard to mark arrived.
17. Confirm the customer receives a driver-arrived notification.
18. Enter start OTP `1234`.
19. Start the trip and confirm the customer receives a trip-started notification.
20. Enter end OTP `5678`.
21. Complete the trip and confirm the customer receives a trip-completed notification.
22. Confirm chat becomes read-only after completion.
23. Confirm `/driver/earnings` shows updated commission and net earnings.
24. Confirm `/ride/[tripId]/receipt` opens.
25. Confirm `/admin/trips` shows the completed trip.

## Payment Review Flow

After seeding:

1. Open `/admin/payment-reviews`.
2. Filter by `Pending review`.
3. Confirm both subscription and commission payment requests are visible.
4. Approve the subscription request.
5. Confirm the driver receives a subscription-approved notification.
6. Confirm the driver subscription is active on `/admin/subscriptions`.
7. Approve the commission request.
8. Confirm the driver receives a payment-approved notification.
9. Confirm commission owed reduces to R0.00 if the seeded wallet balance was R50.
10. Reject flow can be tested by reseeding or creating a fresh payment request from `/driver/earnings`.

## Push Notification Readiness

Notification testing needs:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- a browser/device that supports Push API
- iOS testing from an installed Home Screen PWA, where applicable

Expected event routing:

- New trip offer: driver user, `/driver`
- Driver accepted/on the way: customer user, `/ride/[tripId]`
- Driver arrived: customer user, `/ride/[tripId]`
- Trip started: customer user, `/ride/[tripId]`
- Trip completed: customer user, `/ride/[tripId]`
- Customer chat message: driver user, `/driver`
- Driver chat message: customer user, `/ride/[tripId]`
- Driver payment submitted: admin role, `/admin/payment-reviews`
- Payment approved/rejected: driver user, `/driver/earnings`

## Notes

- Do not run seed SQL against production.
- Do not use real customer phone numbers or driver documents in seed data.
- Push notification testing requires valid VAPID keys and real browser subscriptions.
