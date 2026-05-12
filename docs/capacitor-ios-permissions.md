# MOOVU Capacitor iOS Permissions

MOOVU's shared permission code already calls Capacitor plugins on native platforms:

- `@capacitor/geolocation` for customer pickup GPS and driver GPS heartbeat.
- `@capacitor/camera` for proof-of-payment camera/photo access.
- `@capacitor/push-notifications` for native push notifications.

The repository does not currently contain an `ios/` Capacitor project. When the iOS project is created on a Mac, add these privacy strings in Xcode under `App/App/Info.plist` before testing permissions.

## Required Info.plist entries

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>MOOVU uses your location to set pickup points, show trips, and help drivers update active trip GPS.</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>MOOVU uses your location to support active trip and driver GPS features when allowed.</string>
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

- Add an iOS app in Firebase using the final iOS bundle ID.
- Download `GoogleService-Info.plist` and add it to the Xcode app target.
- Upload the APNs authentication key in Firebase project settings.
- Enable **Background Modes** and check **Remote notifications** in Xcode.
- Run `npx cap sync ios` after plugin or native config changes.

## Setup commands on Mac

```bash
npx cap add ios
npx cap sync ios
npx cap open ios
```

After opening Xcode, add the Info.plist entries above, enable Push Notifications, configure signing, then test on a real iPhone. The iOS Home Screen web shortcut is still a PWA and cannot use Capacitor native permission plugins.
