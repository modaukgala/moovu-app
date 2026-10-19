# MOOVU Customer UI/UX review

## Scope

This candidate starts at `f49bd02d21fae653fca3157b74f22af8f9dd427b` in the isolated `codex/customer-uiux-premium` branch at `D:\Users\KN Mudau\Desktop\Websites\moovu-customer-uiux`. It changes Customer-facing presentation and navigation only. Booking, dispatch, authentication, fares, payments, trip lifecycle, OTP, financial rules, and notification handlers remain on the existing paths.

## Journey

1. **Home:** a single “Continue to booking” action shows the pickup and destination choices and leads to the existing booking route. The map keeps its current-location control with a visible label. My Trips, Account, and Help stay available in the bottom navigation; the drawer retains the direct booking link.
2. **Booking:** route inputs lead to ride choices, then payment selection and a review button. The existing confirmation dialog still shows the route, ride, payment method, and fare before submission.
   Unavailable favourite-place shortcuts remain accessible in a collapsed secondary section rather than interrupting the booking path.
3. **Active trip:** the main status card uses a plain-language journey heading while retaining the authoritative status badge and existing controls for Driver details, OTP, safety, support, and receipt.
4. **My Trips:** the empty message distinguishes an account with no trips from a filter with no matches.

## Preserved controls and authority

The existing handlers for route selection, quote calculation, booking confirmation, payment selection, cancellation, trip updates, OTP display, support, notification enrollment, and receipt navigation are unchanged. No database migration or new environment variable is required. This is a source candidate only; no production deployment or activation is included.

Existing Customer components were reused; no new dependency or component was added. Changed files: `src/app/page.tsx`, `src/app/book/page.tsx`, `src/app/ride/[tripId]/page.tsx`, `src/app/ride/history/page.tsx`, `src/app/account/page.tsx`, `src/app/contact/page.tsx`, `src/app/globals.css`, `src/components/customer/CustomerMapHome.tsx`, `src/components/customer/CustomerDrawer.tsx`, and `src/components/app-shell/CustomerBottomNav.tsx`.

## Review and device checks

- At 375, 430, 768, and desktop widths, verify the booking route fields, ride cards, payment controls, review bar, and confirmation dialog are reachable without horizontal scrolling.
- Confirm keyboard and screen-reader navigation reaches the three booking steps, all inputs, ride options, payment buttons, review action, and dialog controls in reading order.
- Confirm Home, My Trips, Account, and Help navigation; booking remains reachable from Home and the drawer.
- On an existing trip, verify each journey heading, Driver details, Start and End OTP, safety/support, cancellation (when allowed), and receipt remain available.
- Use disposable accounts for any booking, trip, payment, or notification mutation tests. A production smoke check should remain non-mutating until separately authorized.

## Release boundary

Review the exact commit and perform visual acceptance before any deployment. Physical device rendering, authenticated end-to-end booking, and payment-provider behavior are separate acceptance gates.

## Local validation

- Automated tests: 339 passed.
- TypeScript: passed.
- ESLint: passed with five pre-existing warnings outside the changed Customer files.
- Production build: passed with process-only, nonfunctional local Supabase build values; 212 static pages generated.
- Git whitespace and scoped credential scan: passed.
- The local visual review below supersedes the pending screenshot note. Authenticated hosted and physical-device checks remain pending.

## Local visual acceptance (19 October 2026)

The Codex browser failed before opening the application because its local kernel assets were missing. The application server itself worked. The bundled Playwright package expected a Chromium revision absent from the local cache, so the visual harness uses the installed Edge browser with an explicit executable path. It starts from `http://localhost:3596`, intercepts all Customer and map API requests with synthetic fixture responses, blocks external hosts and service workers, and uses only nonfunctional local Supabase values. These are actual screenshots of the locally rendered application, not screenshots of hosted staging or production. The iPhone size is Chromium mobile emulation, not iOS Safari.

| Screen | Small Android 360×740 | Standard Android 412×915 | iPhone 390×844 |
| --- | --- | --- | --- |
| Customer Home | [PNG](customer-uiux-screenshots/01-home-android-small.png) | [PNG](customer-uiux-screenshots/01-home-android-standard.png) | [PNG](customer-uiux-screenshots/01-home-iphone.png) |
| Pickup and destination | [PNG](customer-uiux-screenshots/02-pickup-destination-android-small.png) | [PNG](customer-uiux-screenshots/02-pickup-destination-android-standard.png) | [PNG](customer-uiux-screenshots/02-pickup-destination-iphone.png) |
| Go and Go XL | [PNG](customer-uiux-screenshots/03-go-and-go-xl-android-small.png) | [PNG](customer-uiux-screenshots/03-go-and-go-xl-android-standard.png) | [PNG](customer-uiux-screenshots/03-go-and-go-xl-iphone.png) |
| Payment | [PNG](customer-uiux-screenshots/04-payment-android-small.png) | [PNG](customer-uiux-screenshots/04-payment-android-standard.png) | [PNG](customer-uiux-screenshots/04-payment-iphone.png) |
| Confirm Ride | [PNG](customer-uiux-screenshots/05-confirm-ride-android-small.png) | [PNG](customer-uiux-screenshots/05-confirm-ride-android-standard.png) | [PNG](customer-uiux-screenshots/05-confirm-ride-iphone.png) |
| Finding Driver | [PNG](customer-uiux-screenshots/06-finding-driver-android-small.png) | [PNG](customer-uiux-screenshots/06-finding-driver-android-standard.png) | [PNG](customer-uiux-screenshots/06-finding-driver-iphone.png) |
| Driver assigned | [PNG](customer-uiux-screenshots/07-driver-assigned-android-small.png) | [PNG](customer-uiux-screenshots/07-driver-assigned-android-standard.png) | [PNG](customer-uiux-screenshots/07-driver-assigned-iphone.png) |
| Driver arrived | [PNG](customer-uiux-screenshots/08-driver-arrived-android-small.png) | [PNG](customer-uiux-screenshots/08-driver-arrived-android-standard.png) | [PNG](customer-uiux-screenshots/08-driver-arrived-iphone.png) |
| Trip in progress | [PNG](customer-uiux-screenshots/09-trip-in-progress-android-small.png) | [PNG](customer-uiux-screenshots/09-trip-in-progress-android-standard.png) | [PNG](customer-uiux-screenshots/09-trip-in-progress-iphone.png) |
| Trip completed | [PNG](customer-uiux-screenshots/10-trip-completed-android-small.png) | [PNG](customer-uiux-screenshots/10-trip-completed-android-standard.png) | [PNG](customer-uiux-screenshots/10-trip-completed-iphone.png) |
| My Trips | [PNG](customer-uiux-screenshots/11-my-trips-android-small.png) | [PNG](customer-uiux-screenshots/11-my-trips-android-standard.png) | [PNG](customer-uiux-screenshots/11-my-trips-iphone.png) |
| Account | [PNG](customer-uiux-screenshots/12-account-android-small.png) | [PNG](customer-uiux-screenshots/12-account-android-standard.png) | [PNG](customer-uiux-screenshots/12-account-iphone.png) |
| Help | [PNG](customer-uiux-screenshots/13-help-android-small.png) | [PNG](customer-uiux-screenshots/13-help-android-standard.png) | [PNG](customer-uiux-screenshots/13-help-iphone.png) |

Visual fixes: bottom navigation remains visible across Customer pages; Home map buttons clear the booking sheet; the confirmation dialog opens at its heading and keeps Confirm Ride and Go Back visible on short screens; the active-trip map is shorter on phones so Driver details appear sooner; the trip badge uses a readable status label. Existing actions, APIs and business rules were retained. The screenshot harness asserts no document-level horizontal overflow, visible bottom navigation, no Home control/sheet overlap, and an in-viewport Confirm Ride button at least 44px tall.

After the visual changes, the 339 automated tests and TypeScript check passed. The production build passed, generating 212 static pages with nonfunctional process-only local Supabase values. ESLint was rerun after adjusting the CommonJS preview script; its final result is recorded in the delivery report. The repository diff passed `git diff --check`, and the preview script contains only synthetic fixture tokens.

The isolated preview has no Google Maps API key, so map panels show the application's missing-key state. It cannot prove real map tiles, virtual-keyboard behavior, physical safe areas, authenticated Supabase flows, live dispatch, payment, OTP completion, or device notification delivery. Those remain separate acceptance checks. No production service was contacted or changed.

Reproduce with the local non-production development server and `NODE_PATH` pointing at the bundled Playwright package: set `MOOVU_VISUAL_BROWSER` to the installed Edge executable, then run `node scripts/customer-visual-preview.cjs`. The final review commit SHA is recorded in the delivery report (`git rev-parse HEAD`); a Git commit cannot embed its own SHA in its contents.
