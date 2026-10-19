# MOOVU Customer — Hybrid simplification Pass 2

## Scope and source

Pass 2 starts from approved visual-review commit `68c8e5b042e66c6f8b4d1dd062905f19afdf1da8` on branch `codex/customer-uiux-pass2` in `D:\Users\KN Mudau\Desktop\Websites\moovu-customer-uiux`. The earlier 39-image set remains in `docs/customer-uiux-screenshots/`. This is Customer presentation work only. The production notification reliability commit `f49bd02d21fae653fca3157b74f22af8f9dd427b` is an ancestor of this branch.

## Before and after

All images are real local Next.js renders using synthetic Customer/Driver data and intercepted local API responses. Viewports: small Android **360 × 740**, standard Android **412 × 915**, and iPhone-size **390 × 844**. The iPhone-size image uses Edge mobile emulation; it is not iOS Safari or a physical device.

| Screen | Before, 360px | After, 360px | After, 412px | After, 390px |
| --- | --- | --- | --- | --- |
| Home | [Before](customer-uiux-screenshots/01-home-android-small.png) | [After](customer-uiux-pass2-screenshots/01-home-android-small.png) | [After](customer-uiux-pass2-screenshots/01-home-android-standard.png) | [After](customer-uiux-pass2-screenshots/01-home-iphone.png) |
| Pickup and destination | [Before](customer-uiux-screenshots/02-pickup-destination-android-small.png) | [After](customer-uiux-pass2-screenshots/02-pickup-destination-android-small.png) | [After](customer-uiux-pass2-screenshots/02-pickup-destination-android-standard.png) | [After](customer-uiux-pass2-screenshots/02-pickup-destination-iphone.png) |
| Go and Go XL | [Before](customer-uiux-screenshots/03-go-and-go-xl-android-small.png) | [After](customer-uiux-pass2-screenshots/03-go-and-go-xl-android-small.png) | [After](customer-uiux-pass2-screenshots/03-go-and-go-xl-android-standard.png) | [After](customer-uiux-pass2-screenshots/03-go-and-go-xl-iphone.png) |
| Payment | [Before](customer-uiux-screenshots/04-payment-android-small.png) | [After](customer-uiux-pass2-screenshots/04-payment-android-small.png) | [After](customer-uiux-pass2-screenshots/04-payment-android-standard.png) | [After](customer-uiux-pass2-screenshots/04-payment-iphone.png) |
| Confirm Ride | [Before](customer-uiux-screenshots/05-confirm-ride-android-small.png) | [After](customer-uiux-pass2-screenshots/05-confirm-ride-android-small.png) | [After](customer-uiux-pass2-screenshots/05-confirm-ride-android-standard.png) | [After](customer-uiux-pass2-screenshots/05-confirm-ride-iphone.png) |
| Finding Driver | [Before](customer-uiux-screenshots/06-finding-driver-android-small.png) | [After](customer-uiux-pass2-screenshots/06-finding-driver-android-small.png) | [After](customer-uiux-pass2-screenshots/06-finding-driver-android-standard.png) | [After](customer-uiux-pass2-screenshots/06-finding-driver-iphone.png) |
| Driver assigned | [Before](customer-uiux-screenshots/07-driver-assigned-android-small.png) | [After](customer-uiux-pass2-screenshots/07-driver-assigned-android-small.png) | [After](customer-uiux-pass2-screenshots/07-driver-assigned-android-standard.png) | [After](customer-uiux-pass2-screenshots/07-driver-assigned-iphone.png) |
| Driver arrived | [Before](customer-uiux-screenshots/08-driver-arrived-android-small.png) | [After](customer-uiux-pass2-screenshots/08-driver-arrived-android-small.png) | [After](customer-uiux-pass2-screenshots/08-driver-arrived-android-standard.png) | [After](customer-uiux-pass2-screenshots/08-driver-arrived-iphone.png) |
| Trip in progress | [Before](customer-uiux-screenshots/09-trip-in-progress-android-small.png) | [After](customer-uiux-pass2-screenshots/09-trip-in-progress-android-small.png) | [After](customer-uiux-pass2-screenshots/09-trip-in-progress-android-standard.png) | [After](customer-uiux-pass2-screenshots/09-trip-in-progress-iphone.png) |
| Trip completed | [Before](customer-uiux-screenshots/10-trip-completed-android-small.png) | [After](customer-uiux-pass2-screenshots/10-trip-completed-android-small.png) | [After](customer-uiux-pass2-screenshots/10-trip-completed-android-standard.png) | [After](customer-uiux-pass2-screenshots/10-trip-completed-iphone.png) |
| My Trips | [Before](customer-uiux-screenshots/11-my-trips-android-small.png) | [After](customer-uiux-pass2-screenshots/11-my-trips-android-small.png) | [After](customer-uiux-pass2-screenshots/11-my-trips-android-standard.png) | [After](customer-uiux-pass2-screenshots/11-my-trips-iphone.png) |
| Account | [Before](customer-uiux-screenshots/12-account-android-small.png) | [After](customer-uiux-pass2-screenshots/12-account-android-small.png) | [After](customer-uiux-pass2-screenshots/12-account-android-standard.png) | [After](customer-uiux-pass2-screenshots/12-account-iphone.png) |
| Help | [Before](customer-uiux-screenshots/13-help-android-small.png) | [After](customer-uiux-pass2-screenshots/13-help-android-small.png) | [After](customer-uiux-pass2-screenshots/13-help-android-standard.png) | [After](customer-uiux-pass2-screenshots/13-help-iphone.png) |

Additional compact-height focused-destination checks: [360px](customer-uiux-pass2-screenshots/14-keyboard-compact-android-small.png), [412px](customer-uiux-pass2-screenshots/14-keyboard-compact-android-standard.png), [390px](customer-uiux-pass2-screenshots/14-keyboard-compact-iphone.png). The simulated reduced viewport kept the input visible and had no document-level horizontal overflow. It does not certify a real operating-system keyboard.

## Changes and preserved actions

- **Home:** the destination question is now the strongest text inside the existing booking link. Pickup remains visible. The map controls, navigation, notifications and Driver-account separation retain their existing behavior.
- **Booking:** Go and Go XL cards retain the verified capacity and calculated quote while dropping repeated descriptions, duration and base-fare copy. The payment heading asks how the Customer will pay; the Cash selection is labelled Cash consistently in confirmation. The bottom action is simply “Review ride.” Optional stops, scheduled booking, map/address selection, quote calculation and the existing booking handler remain connected.
- **Confirm Ride:** the route, ride, payment, fee disclosure and quoted total remain; spacing and caution text are tighter. The fixed action area still provides Confirm Ride and Go Back. Existing busy, validation and duplicate-submission protections remain.
- **Active trip:** the primary status is in one compact heading above the map. The Driver card shows name, vehicle, plate and fare without another large status or fare panel. The existing OTP, chat, cancellation review, safety, support, route, fare and receipt controls remain available through their existing handlers.
- **My Trips and Help:** empty history no longer displays zero-count filter controls; populated history retains all filters. Help shows the real support email action before secondary policy links. Account payment copy now reflects the offered Cash and Pay Online choices.
- **Map failure:** Customer-facing map fallbacks no longer expose an API-key diagnostic. Home hides map-only buttons while the map is unavailable, then restores them when it loads. Existing address selection and validation remain authoritative; no Maps keys, geolocation logic, route calculation or request frequency changed.

## Validation and limits

The local visual harness (`scripts/customer-visual-preview.cjs`) blocks external hosts and service workers, uses synthetic local session data, and intercepts Customer/map requests. It captured 39 journey screenshots plus three compact-height checks. It asserts no horizontal overflow, visible relevant bottom navigation, non-overlapping Home controls, and a visible Confirm Ride target at least 44px high.

Automated tests: **339/339 passed**. TypeScript: **passed**. ESLint: **passed with five existing warnings outside the Customer files**. Production build: **passed with 212/212 static pages** using process-only nonfunctional Supabase values. `git diff --check` and the scoped filename-only credential scan passed. Physical Android and iPhone rendering, real keyboard/safe-area behavior, real Google Maps, authenticated connected booking, payment, dispatch, OTP and push delivery remain unverified by this local visual fixture. No production data, environment, migrations, Driver or Admin screens were changed. No deployment was made.

The exact final source SHA is in the delivery report. A commit cannot contain its own SHA because recording that SHA changes the commit.
