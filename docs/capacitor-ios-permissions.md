# MOOVU Capacitor iOS Permissions

MOOVU's shared permission code already calls Capacitor plugins on native platforms:

- `@capacitor/geolocation` for customer pickup GPS and driver GPS heartbeat.
- `@capacitor/camera` for proof-of-payment camera/photo access.
- `@capacitor/push-notifications` for native push notifications.

The repository uses split native iOS projects:

- Customer: `ios-customer/`, bundle ID `com.moovu.customer`
- Driver: `ios-driver/`, bundle ID `com.moovu.driver`

Add or confirm these privacy strings in each Xcode target under `App/App/Info.plist` before testing permissions.

## Required Info.plist entries

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>MOOVU uses your location to set pickup points, show trips, and help drivers update active trip GPS.</string>
<key>NSCameraUsageDescription</key>
<string>MOOVU uses the camera so drivers can capture proof of payment and required trip or account documents.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>MOOVU uses your photo library so you can upload proof of payment and required documents.</string>
<key>NSPhotoLibraryAddUsageDescription</key>
<string>MOOVU may save captured proof-of-payment or document images when you choose to keep them.</string>
```

## Required iOS capability

Enable **Push Notifications** in Xcode for the iOS app target. Native iOS push notifications also require Apple signing, APNs configuration, and the Firebase iOS app credentials for the matching bundle ID.

Before production iOS testing:

- Add two iOS apps in Firebase using the final iOS bundle IDs.
- Download each matching `GoogleService-Info.plist` and add it to the correct Xcode app target.
- Upload the APNs authentication key in Firebase project settings.
- Do not enable background location unless MOOVU intentionally supports background tracking.
- Use explicit target scripts after plugin or native config changes.

## Setup commands on Mac

```bash
npm run build:customer
npm run sync:customer
npm run open:customer

npm run build:driver
npm run sync:driver
npm run open:driver
```

After opening Xcode, add the Info.plist entries above, enable Push Notifications, configure signing, then test on a real iPhone. The iOS Home Screen web shortcut is still a PWA and cannot use Capacitor native permission plugins.
