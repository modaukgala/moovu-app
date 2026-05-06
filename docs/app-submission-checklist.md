# MOOVU Submission Checklist

Last updated: 2026-05-06

## Checklist Status

- Booking works end-to-end: requires final staging E2E verification with safe test data.
- Notifications working: push APIs, role checks, test-self flow, core trip/payment/chat event wiring, and expired-subscription cleanup exist; requires real device/browser permission test on local/staging.
- Location working properly: booking and driver GPS/manual location exist; requires Android/iPhone manual QA.
- No crashes: TypeScript, production build, and full lint pass locally.
- Privacy policy live and visible in app: /privacy-policy added.
- Terms of Service live: /terms added.
- Clean UI: legal pages and public links added using MOOVU styling.
- No dead buttons: legal/contact links added to public entry points and smoke checks should verify.
- Real data, not demo: do not seed production; use local/staging E2E data only.
- Email support added: admin@moovurides.co.za.
- Data safety form support added: docs/app-store-data-safety.md.
- App matches description: ride-hailing app with customer booking, driver portal, admin operations, receipts, notifications, OTP, payments, commissions, and subscriptions.
- Customer-driver chat: available after driver acceptance once `docs/trip-chat-migration.sql` has been reviewed and applied to local/staging/production.

## Manual Tests Required

1. Open /privacy-policy, /terms, and /contact.
2. Confirm all legal links from /, /customer/auth?next=/book, /book, /driver/login, /driver/apply, and /admin/login work.
3. Try customer signup without accepting Terms/Privacy; the create account action must stay disabled.
4. Accept Terms/Privacy and create a customer account.
5. Login as an existing customer with no legal acceptance metadata and confirm /book shows the one-time acceptance prompt.
6. Accept the prompt and confirm booking can continue.
7. Book MOOVU Go and MOOVU Group on a safe local/staging environment.
8. Confirm notifications, location, receipt, driver, and admin payment workflows with real staging data.

## Notification QA Checklist

Use a local or staging Supabase project with VAPID keys configured. Do not test with production customer/driver data.

1. Log in as a customer and enable notifications from the customer booking/home context.
2. Confirm the customer receives the self-test notification and it opens `/book`.
3. Log in as a driver and enable notifications from the driver portal.
4. Confirm the driver receives the self-test notification and it opens `/driver`.
5. Log in as an admin and enable notifications from the admin control center.
6. Confirm the admin receives the self-test notification and it opens `/admin`.
7. Create or seed a requested trip and confirm the selected driver receives `New trip offer`.
8. Accept the offer and confirm the customer receives `Driver on the way`.
9. Mark arrived and confirm the customer receives `Driver has arrived`.
10. Start the trip after OTP and confirm the customer receives `Trip started`.
11. Complete the trip and confirm the customer receives `Trip completed`.
12. Submit a commission payment and confirm admins receive `Commission payment submitted`.
13. Submit a subscription payment and confirm admins receive `Subscription payment submitted`.
14. Approve/reject payment reviews and confirm the driver receives payment review notifications.
15. Verify notification clicks open the correct route:
    - customer trip updates: `/ride/[tripId]`
    - driver offers: `/driver`
    - admin payment queue: `/admin/payment-reviews`
16. After a driver accepts a trip, confirm the customer can send a chat message and the driver receives the chat notification.
17. Confirm the driver can reply and the customer receives the chat notification.
18. Confirm chat is hidden before driver acceptance and read-only after completed/cancelled trip states.

## Known Blockers

- Full lint is clean locally after the deployment-readiness pass.
- The external Windows scheduled task `CampusRide Auto Assign` still needs elevated PowerShell to disable if it continues to post to localhost.
- Full live ride lifecycle E2E must not be marked complete until safe local/staging Supabase test data exists.
- Trip chat requires the `trip_messages` migration before runtime chat testing.

## App Store / Google Play Notes

- Legal pages must be deployed publicly and linked in app store console.
- Google Maps API key should be restricted.
- Supabase service role key must remain server-only.
- VAPID keys must be configured for push notifications.
- Storage buckets should include private driver-docs and private payment-proofs with signed URL access for admins.
- Final privacy/legal wording should be reviewed before public submission.
