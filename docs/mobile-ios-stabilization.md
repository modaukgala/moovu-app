# MOOVU iOS Mobile Stabilization Notes

These notes cover the native iOS items that cannot be fully verified from the Windows repo alone.

## Current Repo State

- Android native files are present under `android/`.
- Split Capacitor iOS projects are managed as `ios-customer/` and `ios-driver/`.
- Shared Capacitor/web code has been hardened for iOS-safe location, offline fallback, chat resilience, and notification metadata.

## iOS App Icon

For the split apps, replace or verify the MOOVU icon in:

```text
ios-customer/App/App/Assets.xcassets/AppIcon.appiconset/
ios-driver/App/App/Assets.xcassets/AppIcon.appiconset/
```

Use the MOOVU source icon from:

```text
public/icon.png
public/icon-512.png
public/apple-icon.png
```

The split app commands are:

```bash
npm run ios:customer
npm run ios:driver
```

Then open Xcode and confirm the AppIcon slot is populated with the MOOVU icon.

## iOS Location Permission

Add or confirm these keys in Xcode under each app `Info.plist`:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>MOOVU uses your location to set pickup points, help drivers navigate, and keep trips accurate.</string>
```

Do not add background location keys unless MOOVU intentionally supports background tracking:

```text
NSLocationAlwaysAndWhenInUseUsageDescription
NSLocationAlwaysUsageDescription
```

The app now requests location through Capacitor Geolocation on native devices and falls back to browser geolocation on web.

## iOS Push Notifications

For closed-app iOS push to work reliably:

1. Add the iOS app in Firebase with the exact Xcode Bundle ID.
2. Add the matching `GoogleService-Info.plist` to each generated app folder:
   - Customer: `ios-customer/App/App/GoogleService-Info.plist`
   - Driver: `ios-driver/App/App/GoogleService-Info.plist`
3. Enable Push Notifications capability in Xcode.
4. Upload the APNs Auth Key or certificate in Firebase Console.
5. Confirm `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` are set server-side in Vercel.
6. Confirm `NEXT_PUBLIC_FIREBASE_*` variables are set for web/PWA token registration.
7. Apply `docs/fcm-notifications-migration.sql` so `ios_customer`, `ios_driver`, and `ios_admin` app types are accepted.

Important: the standard `@capacitor/push-notifications` plugin returns native iOS/APNs registration data. If the Xcode app needs pure FCM iOS tokens, add a native Firebase Messaging bridge in the Xcode project or migrate the native push layer carefully. Do not install a second push plugin without testing because native push plugins can conflict.

## Offline Screen

The service workers now cache and serve:

```text
public/offline.html
```

For native WebView initial-load failures before the service worker is available, configure an Xcode WebView error fallback or ensure the app has loaded once online so the offline fallback is cached.
