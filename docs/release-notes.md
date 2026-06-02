# MOOVU Release Notes Draft

## MOOVU Customer

- Improved ride-status clarity while the platform is looking for nearby drivers.
- Added verified-driver presentation with vehicle details, plate number, completed trips, rating status, and driver level.
- Added customer safety prompts, trip sharing access, and clearer support/rating actions after completed trips.
- Added scheduled-ride support, add-stop fare handling, and manual surge display where enabled.
- Added friendlier user-facing error messages for trip loading and stop updates.

## MOOVU Driver

- Improved dashboard trust messaging, subscription reminder, earnings snapshot, and driver level badge.
- Added driver-to-customer rating flow for completed trips once the ratings migration is applied.
- Kept subscription and commission payment flows separated.
- Kept existing OTP start/end-trip security and driver trip action flow.

## MOOVU Admin

- Admin analytics includes scheduled rides, support issue counts, low-rated driver visibility, cancellations, and top driver quality metrics where data exists.
- Driver quality metrics continue to support ratings, completed trips, support issues, and dispatch scoring.
- New migration file documents ratings, referrals, support reports, document expiry tracking, and notification reliability fields.

## Notification Notes

- Web/FCM token registration remains server-side and role-verified.
- Closed-app Android/iOS notification delivery must be tested on real devices with Firebase/APNs configuration applied.
- Invalid-token cleanup and failure logging depend on the current push-server flow plus the optional reliability fields in the migration.

## Known Release Caveats

- Referral rewards are intentionally “coming soon” and do not create money/credit automatically.
- SOS is a UI placeholder only and is not connected to emergency services.
- Driver-to-customer ratings require `docs/moovu-growth-features-migration.sql` before saving.
- Store submissions still require Google Play/App Store metadata, screenshots, privacy questionnaire, and real-device notification/location testing.
