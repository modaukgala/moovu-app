# MOOVU iOS Notification Checklist

MOOVU iOS notifications use Firebase Cloud Messaging tokens end-to-end.
The app must never save raw 64-character APNs device tokens in `fcm_tokens`.

## Native Targets

Customer:
- Bundle ID: `za.co.moovu.customer`
- Firebase plist: `ios-customer/App/App/GoogleService-Info.plist`
- Entitlements: `ios-customer/App/App/App.entitlements`

Driver:
- Bundle ID: `za.co.moovu.driver`
- Firebase plist: `ios-driver/App/App/GoogleService-Info.plist`
- Entitlements: `ios-driver/App/App/App.entitlements`

## Xcode Requirements

For both customer and driver targets:
- `GoogleService-Info.plist` must be included in **Copy Bundle Resources**.
- `FirebaseCore` and `FirebaseMessaging` must be linked through the app package.
- **Push Notifications** capability must be enabled.
- **Background Modes > Remote notifications** must be enabled.
- `aps-environment` must be present in the entitlements file.
- TestFlight/App Store builds must use a production APNs-capable provisioning profile.

## Registration Flow

1. `FirebaseApp.configure()` runs on app startup.
2. `Messaging.messaging().delegate` is assigned.
3. APNs registration returns a device token.
4. Native app sets `Messaging.messaging().apnsToken = deviceToken`.
5. Native app requests `Messaging.messaging().token`.
6. Only the Firebase FCM token is forwarded to JavaScript.
7. `/api/push/fcm/register` stores the FCM token with:
   - `platform = ios`
   - `app_type = ios_customer` or `ios_driver`
   - `is_active = true`
   - `enabled = true`

## Backend Send Flow

All normal visible notifications must go through Firebase Admin FCM.
iOS messages must include:
- top-level `notification.title`
- top-level `notification.body`
- `apns.headers.apns-priority = 10`
- `apns.headers.apns-push-type = alert`
- `apns.payload.aps.alert.title`
- `apns.payload.aps.alert.body`
- `apns.payload.aps.sound = default`

Raw APNs tokens found in `fcm_tokens` are deactivated by the sender and must be replaced by re-enabling notifications from a fresh iOS build.

## Test Endpoint

Use `POST /api/admin/test-push` with an admin session or `x-push-internal-key`.

Body:

```json
{
  "token": "firebase-fcm-token",
  "platform": "ios",
  "appType": "ios_driver",
  "role": "driver",
  "title": "MOOVU test",
  "body": "Visible iOS push test",
  "url": "/driver"
}
```

The endpoint rejects iOS 64-character APNs tokens and short iOS tokens.
