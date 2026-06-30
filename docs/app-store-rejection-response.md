# MOOVU App Store Review Response Guide

Last updated: 2026-06-23

This guide supports the customer app (`za.co.moovu.customer`) and driver app (`za.co.moovu.driver`) after the Apple review feedback around privacy, account deletion, age rating, and iOS notifications.

## 1. Apple 5.1.2(i) Tracking

Current source audit findings:

- No App Tracking Transparency framework usage was found.
- No `NSUserTrackingUsageDescription` key is present or required.
- No IDFA/advertising identifier access was found.
- No advertising SDK, ad attribution SDK, Facebook SDK, AdMob SDK, Segment, Mixpanel, Amplitude, or similar cross-app tracking SDK was found.
- Firebase is used for operational push notifications, not advertising tracking.
- Google Maps is used for maps, geocoding, routing, and place search.

App Store Connect privacy answer:

- **Data Used to Track You:** No
- **Tracking permission prompt:** Not required because MOOVU does not track users across third-party apps/websites.
- Do not add ATT unless MOOVU later adds tracking as Apple defines it.

Suggested review note:

> MOOVU does not use IDFA, ATT, ad networks, or cross-app tracking. Location, trip, account, payment, chat, device token, and diagnostic data are used only to operate MOOVU ride-hailing, safety, support, notifications, and platform workflows. We have updated the privacy policy to state that MOOVU does not sell personal information or use advertising identifiers/cross-app tracking.

## 2. Apple 5.1.1(v) Account Deletion

Implemented source changes:

- Customer app has a visible Account area at `/account`.
- Driver app has a visible Driver Account area at `/driver/account`.
- Both pages include a "Delete Account" action.
- Server routes validate the logged-in user, require password verification, require exact `DELETE` confirmation, and block deletion while active trips are in progress.
- Deletion is initiated directly in-app. Profile, device, preferences, documents, and removable messages are deleted or anonymized immediately; legally required ride, receipt, payment, tax, fraud-prevention, dispute, safety, and legal records may be retained in anonymized or restricted form.

Manual database step required before production:

- No new SQL is required for the direct in-app deletion flow. The older `docs/account-deletion-migration.sql` file is retained only as legacy review material for the previous request-table workflow.

Suggested review note:

> Account deletion is available in-app. In the Customer app, open Account > Delete Account. In the Driver app, open Driver Account > Delete Account. The user verifies their password, types DELETE, and the app deletes the login account immediately while deleting or anonymizing profile data. Legally required trip, receipt, payment, safety, tax, fraud-prevention, and dispute records may be retained in anonymized or restricted form.

## 3. Apple 2.3.6 Age Rating Answers

Use these answers if they match the final App Store Connect form wording:

- Does the app contain unrestricted web access? **No**
- Does the app include gambling or contests? **No**
- Does the app include loot boxes or paid random items? **No**
- Does the app include user-generated content? **Yes, limited** if Apple classifies trip chat/support text as user-generated content. It is limited to operational trip/support communication.
- Does the app provide parental controls? **No**
- Does the app include age assurance? **No**
- Does the app include in-app controls for parents/guardians? **No**
- Does the app include messaging/chat? **Yes, limited to assigned trip participants and support context.**
- Does the app request location? **Yes, while using the app for ride pickup, dispatch, navigation, and trip operations.**

Suggested age rating note:

> MOOVU is a local ride-hailing app. Chat is limited to trip/support communication between assigned participants and administrators. The app does not provide parental controls, age assurance, gambling, contests, unrestricted web access, or advertising tracking.

## 4. Customer App Privacy Answers

Data collected and linked to user:

- Contact info: name, cellphone number, email address.
- Location: pickup, destination, route, and trip-related location information.
- User content: trip chat/support messages where used.
- Identifiers: Supabase auth user ID, customer ID, push token/device token.
- Purchases/financial info: fares, receipts, payment method context where used.
- Diagnostics: app/platform/token delivery and technical error context.

Purposes:

- App functionality
- Customer support
- Safety
- Fraud prevention
- Legal/compliance
- Notifications

Tracking:

- **No**

## 5. Driver App Privacy Answers

Data collected and linked to user:

- Contact info: name, cellphone number, email address.
- Sensitive/user-provided documents: driver application documents, vehicle documents, payment proof uploads.
- Location: online driver location and active-trip location.
- User content: trip chat/support messages.
- Identifiers: Supabase auth user ID, driver ID, push token/device token.
- Financial info: earnings, commissions, subscriptions, payment reviews, receipts.
- Diagnostics: app/platform/token delivery and technical error context.

Purposes:

- App functionality
- Driver onboarding
- Customer support
- Safety
- Fraud prevention
- Legal/compliance
- Notifications

Tracking:

- **No**

## 6. iOS Push Notification Blockers

The code supports Android/Web through FCM/Web Push and native iOS through Firebase FCM registration tokens with APNs alert payloads. Closed-app iOS push cannot be claimed as verified until these manual items are complete:

- Enable Push Notifications capability in both Xcode targets.
- Create/download an Apple APNs auth key and configure Vercel with `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_AUTH_KEY`, `APNS_ENV=production`, `APNS_CUSTOMER_BUNDLE_ID=za.co.moovu.customer`, and `APNS_DRIVER_BUNDLE_ID=za.co.moovu.driver` only if the temporary legacy APNs fallback is enabled.
- Confirm each app registers a native token and stores it in `fcm_tokens` as `ios_customer` or `ios_driver`.
- Test foreground, background, and closed-app notifications on real iPhones.
- Add `ios-customer/App/App/GoogleService-Info.plist` and `ios-driver/App/App/GoogleService-Info.plist` only if MOOVU later adds native Firebase Messaging token bridging.

## 7. Mac Rebuild and Upload Commands

Customer:

```bash
npm run ios:customer
npm run ios:customer:open
```

In Xcode:

1. Select the MOOVU customer scheme.
2. Confirm bundle ID `za.co.moovu.customer`.
3. Confirm signing team.
4. Product > Archive.
5. Distribute App > App Store Connect.

Driver:

```bash
npm run ios:driver
npm run ios:driver:open
```

In Xcode:

1. Select the MOOVU Driver scheme.
2. Confirm bundle ID `za.co.moovu.driver`.
3. Confirm signing team.
4. Product > Archive.
5. Distribute App > App Store Connect.
