# MOOVU Store Testing Checklist

Run these checks before Play Store or App Store submission.

## Customer App

- Create/sign in to a customer account with email or cellphone login.
- Confirm privacy and terms links are reachable:
  - `https://moovurides.co.za/privacy-policy`
  - `https://moovurides.co.za/terms`
  - `https://moovurides.co.za/contact`
- Use current location for pickup on Android and iOS.
- Search a pickup and destination, including local places with weak stand-number coverage.
- Book MOOVU Go and MOOVU Go XL.
- Book with no stops, 1 stop, and 2 stops.
- Confirm fare displays and server booking still succeeds.
- Confirm ride status shows “Looking for nearby MOOVU drivers...” before acceptance.
- Confirm driver details remain hidden until acceptance.
- After driver acceptance, confirm verified-driver badge, vehicle, plate, phone/contact, rating or “New Driver”, completed trips, and driver level.
- Confirm Share trip uses Web Share API where supported and clipboard fallback where not.
- Complete trip and submit customer-to-driver rating.
- Report a trip issue from support page.

## Driver App

- Open driver app directly at `https://driver.moovurides.co.za`.
- Log in as linked driver.
- Enable notifications and confirm status feedback.
- Confirm dashboard shows online/offline control, subscription reminder, earnings snapshot, amount owed to MOOVU, and driver level.
- Go online with an active subscription and commission balance below the limit.
- Receive trip offer and accept/decline.
- Confirm accepted trip shows one primary navigation action, then Google Maps/Waze chooser.
- Arrive, start with OTP, complete with end OTP where required.
- Confirm completed trip appears in history.
- Submit driver-to-customer rating after the ratings migration is applied.
- Confirm subscriptions and commission payments remain separate.

## Admin Portal

- Log in as admin.
- Confirm dashboard, drivers, applications, trips, dispatch, subscriptions, commission payments, reports, receipts, and notifications load.
- Confirm scheduled rides are visible where relevant.
- Confirm driver profiles show verification/subscription/document information where available.
- Confirm support issues and low-rated driver signals appear once supporting tables contain data.
- Confirm admin actions never expose raw Supabase/Postgres errors to users.

## Notifications

- Customer token saves with role `customer`.
- Driver token saves with role `driver`.
- Admin token saves with role `admin`.
- Test `/api/push/test-self` for each role.
- Trigger new trip offer, accepted, arrived, started, completed, chat, payment submitted, payment approved/rejected.
- Verify in-app notification bars while app is foregrounded.
- Verify system notifications while app is backgrounded.
- Verify closed-app notifications on real Android package.
- Verify iOS closed-app notifications only after APNs key/capability/Firebase iOS setup is complete.

## Native Packaging

- Android customer package ID is correct in Play Console.
- Android driver package ID is correct in Play Console.
- Customer and driver AABs are signed with the expected upload certificates.
- iOS customer bundle ID matches Firebase and Apple Developer configuration.
- iOS driver bundle ID matches Firebase and Apple Developer configuration.
- App icons, splash assets, location permission text, notification permission text, and camera/photo permission text are configured.

## Data Safety / Policies

- Privacy policy URL is live.
- Terms URL is live.
- Contact/support URL is live.
- Data deletion request instructions are visible on support/contact or privacy page.
- No demo-only text appears on production screens.
