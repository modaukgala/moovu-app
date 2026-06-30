# MOOVU Split iOS Apps

MOOVU uses one Next.js codebase and two independent iOS Capacitor app packages for App Store submission.

## Targets

| App | Display name | Bundle ID | Start URL |
| --- | --- | --- | --- |
| Customer | MOOVU | `za.co.moovu.customer` | `https://moovurides.co.za` |
| Driver | MOOVU Driver | `za.co.moovu.driver` | `https://driver.moovurides.co.za` |

`capacitor.config.ts` is a guarded wrapper only. It refuses generic Capacitor commands unless `CAPACITOR_TARGET=customer` or `CAPACITOR_TARGET=driver` is set by the npm scripts.

## Files

- `capacitor.customer.config.ts` contains Customer iOS app identity and start URL.
- `capacitor.driver.config.ts` contains Driver iOS app identity and start URL.
- `capacitor-shell-customer/` is the Customer app fallback shell.
- `capacitor-shell-driver/` is the Driver app fallback shell.
- `scripts/capacitor-ios-target.mjs` safely creates and syncs isolated native folders:
  - `ios-customer/`
  - `ios-driver/`
- `scripts/build-target.mjs` runs target-aware web builds.
- `native-assets/ios/customer/AppIcon.appiconset/` contains Customer icon placeholder assets.
- `native-assets/ios/driver/AppIcon.appiconset/` contains Driver icon placeholder assets.
- Generated native folders currently contain MOOVU 1024px app icon placeholders in each `AppIcon.appiconset`.

## Mac Commands

Run these on a Mac with Xcode and CocoaPods/SPM support installed.

### Customer app

```bash
npm install
npm run build:customer
npm run sync:customer
npm run open:customer
```

Shortcut:

```bash
npm run ios:customer
```

This runs `build:customer` and `sync:customer`.

### Driver app

```bash
npm install
npm run build:driver
npm run sync:driver
npm run open:driver
```

Shortcut:

```bash
npm run ios:driver
```

This runs `build:driver` and `sync:driver`.

## Xcode Setup

For each generated app:

1. Open the matching Xcode workspace:
   - Customer: `ios-customer/App/App.xcworkspace`
   - Driver: `ios-driver/App/App.xcworkspace`
2. Confirm the bundle identifier:
   - Customer: `za.co.moovu.customer`
   - Driver: `za.co.moovu.driver`
3. Confirm the display name:
   - Customer: `MOOVU`
   - Driver: `MOOVU Driver`
4. Replace the default AppIcon slots with the matching assets from `native-assets/ios/...`.
5. Add the correct Firebase plist:
   - Customer Firebase iOS app: `GoogleService-Info.plist` for `za.co.moovu.customer`
   - Driver Firebase iOS app: `GoogleService-Info.plist` for `za.co.moovu.driver`
6. Enable capabilities as required:
   - Push Notifications
   - Associated Domains if deep links are configured
7. Add iOS location permission text in `Info.plist`:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>MOOVU uses your location to set pickup points, help drivers navigate, and keep trips accurate.</string>
```

Do not enable background location unless the product intentionally supports background tracking.

## Archive Commands

Customer:

```bash
npm run build:customer
npm run sync:customer
npm run archive:customer
```

Or open and archive in Xcode:

```text
npm run open:customer
Product > Scheme > App
Product > Any iOS Device
Product > Archive
Distribute App > App Store Connect
```

Driver:

```bash
npm run build:driver
npm run sync:driver
npm run archive:driver
```

Or open and archive in Xcode:

```text
npm run open:driver
Product > Scheme > App
Product > Any iOS Device
Product > Archive
Distribute App > App Store Connect
```

## Firebase And Push Notes

Create two Firebase iOS app registrations with the exact bundle IDs. The app must save push tokens with role and app type:

- Customer: `role = customer`, `app_type = ios_customer`
- Driver: `role = driver`, `app_type = ios_driver`

The backend already validates role ownership server-side and sends APNs alert options for iOS targets. Closed-app push must still be tested on real iPhones after APNs is uploaded to Firebase.

## Safety Notes

- Do not rename `ios-customer/` or `ios-driver/` while Xcode is open.
- The script refuses to overwrite an unmanaged `ios/` folder.
- Do not run generic `npx cap ...` commands directly. Use `sync:customer`, `sync:driver`, `copy:customer`, `copy:driver`, `open:customer`, `open:driver`, `archive:customer`, or `archive:driver`.
