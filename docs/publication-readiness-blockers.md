# MOOVU Publication Readiness Blockers

This checklist records the final manual items that must be completed before Google Play or App Store publication. Do not mark the apps store-ready until these have been verified on real devices.

## Current Automated Checks

- `npm run lint`: required before release.
- `npx tsc --noEmit`: required before release.
- `npm run build`: required before release.
- `npm run ios:customer:doctor`: confirms the customer iOS target folder exists.
- `npm run ios:driver:doctor`: confirms the driver iOS target folder exists.

## iOS APNs and Firebase

Native iOS closed-app push uses APNs device tokens from Capacitor Push Notifications. Configure Vercel with:

- `APNS_TEAM_ID`
- `APNS_KEY_ID`
- `APNS_AUTH_KEY`
- `APNS_ENV=production`
- `APNS_CUSTOMER_BUNDLE_ID=com.moovu.customer`
- `APNS_DRIVER_BUNDLE_ID=com.moovu.driver`

Enable the Push Notifications capability on both Xcode targets, then test foreground, background, and closed-app delivery on real iPhones.

Firebase plist files are only required if MOOVU later adds native Firebase Messaging token bridging:

- Customer app: `ios-customer/App/App/GoogleService-Info.plist`
- Driver app: `ios-driver/App/App/GoogleService-Info.plist`

These files must be downloaded from Firebase for the exact bundle IDs:

- Customer: `com.moovu.customer`
- Driver: `com.moovu.driver`

Do not claim iOS notification readiness from browser/PWA tests only.

## Apple Account Deletion

Run and verify `docs/account-deletion-migration.sql` before submitting an Apple build for review. Apple reviewers must be able to open:

- Customer: Account > Request account deletion
- Driver: Driver Account > Request driver account deletion

The feature intentionally creates a deletion request rather than immediately deleting rows because MOOVU may need to retain trip, receipt, payment, tax, fraud-prevention, dispute, support, safety, and legal records.

## Android Packaging

This repo contains the main Android Capacitor project with:

- `android/app/google-services.json`
- `POST_NOTIFICATIONS`
- fine/coarse location permissions
- camera permission
- vibration permission
- MOOVU notification sound resources

The split customer/driver Android APK/AAB output has previously been handled in the separate Android workspace:

`D:\Users\KN Mudau\Desktop\Websites\ANDROID APPS\MOOVU-ANDROID`

Before Play Store submission, rebuild the customer and driver Android artifacts from the correct Android packaging workspace and confirm each app opens to the correct portal.

## Supabase Readiness

The current app expects these objects to exist:

- `fcm_tokens`
- `app_notifications`
- `trip_messages`
- `driver_trip_offers`
- `trip_cancellation_fees`
- `app_pricing_settings`
- private `driver-docs` bucket
- private `payment-proofs` bucket

Driver payment proof uploads use `driver_payment_requests.pop_file_path` and signed URLs for admin review. Do not make payment proof storage public.

## Notification Manual Test Matrix

Run on real supported devices:

- Customer enables notifications, receives test-self notification.
- Driver enables notifications, receives test-self notification.
- Admin enables notifications, receives test-self notification.
- Driver receives new trip offer notification.
- Customer receives driver accepted notification.
- Customer receives driver arrived notification.
- Customer and driver receive trip started/update notifications where supported.
- Customer and driver receive trip completed notification.
- Customer/driver chat message notification reaches the other participant.
- Admin receives subscription payment submitted notification.
- Admin receives commission payment submitted notification.
- Driver receives payment approved/rejected/waiting notification.
- Invalid or expired FCM token cleanup does not crash the related flow.

## Full E2E Release Checklist

Use safe local or staging data only. Do not seed production blindly.

1. Customer signs up or logs in.
2. Customer accepts Terms and Privacy.
3. Customer books MOOVU Go.
4. Customer books MOOVU Go XL.
5. Manual surge defaults to Normal and applies only when admin changes it.
6. Customer sees Searching for driver until a driver accepts.
7. Driver receives offer and can accept or decline.
8. Driver details and chat appear only after acceptance.
9. Driver arrives.
10. Start OTP verifies and starts trip.
11. End OTP verifies and completes trip.
12. Customer receipt opens.
13. Driver earnings update.
14. Normal commission remains correct for the completed trip.
15. Chat works both directions.
16. Customer cancellation inside free window records correctly.
17. Late cancellation records fee and split correctly.
18. Driver no-show records fee and split correctly.
19. Driver submits subscription payment proof.
20. Admin approves/rejects subscription payment.
21. Driver submits commission payment proof.
22. Admin approves/rejects commission payment.
23. Admin receipts, reports, payments, trips, dispatch, and notifications pages load without protected-table errors.
