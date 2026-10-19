# MOOVU Customer — Premium visual polish Pass 2.1

## Source and scope

- Approved Pass 2 base: `22c245e748678dca9e05f82c92d0548427139b31`.
- Branch: `codex/customer-uiux-pass2-1`.
- Isolated worktree: `D:\Users\KN Mudau\Desktop\Websites\moovu-customer-uiux-pass2-1`.
- The notification reliability commit `f49bd02d21fae653fca3157b74f22af8f9dd427b` is in the ancestry.
- Customer presentation and the local synthetic screenshot harness only. No backend, schema, payment, dispatch, Driver or Admin changes.

## Design decisions and before/after review

The existing sans-serif stack is retained; no font download or dependency was added. The Customer surfaces now use a restrained type hierarchy: 21–24px primary headings, 14–15px controls, 11–12px supporting copy, and a 22–26px fare. Mobile primary actions use a 52px minimum height and 16px radius. Cards use 16px corners and lighter shadows. The Customer bottom navigation retains four 52px touch targets, 22px icons and a quieter selected state. These changes are scoped to Customer selectors, leaving Driver and Admin styling alone.

| Area | Pass 2 finding | Pass 2.1 result |
| --- | --- | --- |
| Payment at 360 × 740 | Fare bar visually cut into the payment card and hid the Pay Online note. | Taller bounded sheet, reserved scroll space and explicit reachability checks show both 44px choices and the full note above the bar. |
| Confirm Ride at 360 × 740 | Fixed action footer covered part of the fee notice at the captured position. | Compact information spacing and side-by-side Back/Confirm actions reveal the full notice while keeping both controls at least 50px tall. |
| Fare, ride cards and buttons | Heavy weights and mixed radii competed for attention. | Consistent Customer type weights, 16px card corners, prominent fare and a single primary action. |
| Active trip | Status and Driver details looked heavy on a narrow screen. | More compact Customer heading, Driver name and bottom-sheet styling; existing map, OTP, chat, safety, support and cancellation controls remain. |
| Screenshot artifacts | Local Next.js development badge appeared in captures. | Harness hides only the development badge in synthetic screenshots; application production behavior is unchanged. |

## Screenshots

These are 42 real local Next.js renders in Edge mobile emulation with synthetic Customer, Driver, trip and quote data. The harness blocks external hosts and service workers. Previous Pass 2 screenshots remain unchanged in `docs/customer-uiux-pass2-screenshots/`; the new set is in `docs/customer-uiux-pass2-1-screenshots/` and packaged at `D:\Users\KN Mudau\Desktop\MOOVU-Customer-Pass-2.1-Screenshots.zip`. The "iPhone" viewport is browser emulation, not iOS Safari or a physical iPhone.

| Screen | 360 × 740 | 412 × 915 | 390 × 844 |
| --- | --- | --- | --- |
| Home | [Before](customer-uiux-pass2-screenshots/01-home-android-small.png) · [After](customer-uiux-pass2-1-screenshots/01-home-android-small.png) | [After](customer-uiux-pass2-1-screenshots/01-home-android-standard.png) | [After](customer-uiux-pass2-1-screenshots/01-home-iphone.png) |
| Pickup and destination | [After](customer-uiux-pass2-1-screenshots/02-pickup-destination-android-small.png) | [After](customer-uiux-pass2-1-screenshots/02-pickup-destination-android-standard.png) | [After](customer-uiux-pass2-1-screenshots/02-pickup-destination-iphone.png) |
| Go and Go XL | [After](customer-uiux-pass2-1-screenshots/03-go-and-go-xl-android-small.png) | [After](customer-uiux-pass2-1-screenshots/03-go-and-go-xl-android-standard.png) | [After](customer-uiux-pass2-1-screenshots/03-go-and-go-xl-iphone.png) |
| Payment | [Before](customer-uiux-pass2-screenshots/04-payment-android-small.png) · [After](customer-uiux-pass2-1-screenshots/04-payment-android-small.png) | [After](customer-uiux-pass2-1-screenshots/04-payment-android-standard.png) | [After](customer-uiux-pass2-1-screenshots/04-payment-iphone.png) |
| Confirm Ride | [Before](customer-uiux-pass2-screenshots/05-confirm-ride-android-small.png) · [After](customer-uiux-pass2-1-screenshots/05-confirm-ride-android-small.png) | [After](customer-uiux-pass2-1-screenshots/05-confirm-ride-android-standard.png) | [After](customer-uiux-pass2-1-screenshots/05-confirm-ride-iphone.png) |
| Finding Driver | [After](customer-uiux-pass2-1-screenshots/06-finding-driver-android-small.png) | [After](customer-uiux-pass2-1-screenshots/06-finding-driver-android-standard.png) | [After](customer-uiux-pass2-1-screenshots/06-finding-driver-iphone.png) |
| Driver assigned | [Before](customer-uiux-pass2-screenshots/07-driver-assigned-android-small.png) · [After](customer-uiux-pass2-1-screenshots/07-driver-assigned-android-small.png) | [After](customer-uiux-pass2-1-screenshots/07-driver-assigned-android-standard.png) | [After](customer-uiux-pass2-1-screenshots/07-driver-assigned-iphone.png) |
| Driver arrived | [After](customer-uiux-pass2-1-screenshots/08-driver-arrived-android-small.png) | [After](customer-uiux-pass2-1-screenshots/08-driver-arrived-android-standard.png) | [After](customer-uiux-pass2-1-screenshots/08-driver-arrived-iphone.png) |
| Trip in progress | [After](customer-uiux-pass2-1-screenshots/09-trip-in-progress-android-small.png) | [After](customer-uiux-pass2-1-screenshots/09-trip-in-progress-android-standard.png) | [After](customer-uiux-pass2-1-screenshots/09-trip-in-progress-iphone.png) |
| Trip completed | [After](customer-uiux-pass2-1-screenshots/10-trip-completed-android-small.png) | [After](customer-uiux-pass2-1-screenshots/10-trip-completed-android-standard.png) | [After](customer-uiux-pass2-1-screenshots/10-trip-completed-iphone.png) |
| My Trips | [After](customer-uiux-pass2-1-screenshots/11-my-trips-android-small.png) | [After](customer-uiux-pass2-1-screenshots/11-my-trips-android-standard.png) | [After](customer-uiux-pass2-1-screenshots/11-my-trips-iphone.png) |
| Account | [After](customer-uiux-pass2-1-screenshots/12-account-android-small.png) | [After](customer-uiux-pass2-1-screenshots/12-account-android-standard.png) | [After](customer-uiux-pass2-1-screenshots/12-account-iphone.png) |
| Help | [After](customer-uiux-pass2-1-screenshots/13-help-android-small.png) | [After](customer-uiux-pass2-1-screenshots/13-help-android-standard.png) | [After](customer-uiux-pass2-1-screenshots/13-help-iphone.png) |

Compact-height focused-destination captures: [360px](customer-uiux-pass2-1-screenshots/14-keyboard-compact-android-small.png), [412px](customer-uiux-pass2-1-screenshots/14-keyboard-compact-android-standard.png), [390px](customer-uiux-pass2-1-screenshots/14-keyboard-compact-iphone.png). This reduces viewport height in the browser; it is not a real mobile keyboard.

## Verification and limits

- Automated tests: 339/339 passed.
- TypeScript: passed.
- ESLint: passed with five pre-existing warnings outside Customer files.
- Optimized production build: passed; 212/212 static pages generated with process-only nonfunctional Supabase values.
- Browser assertions: no document horizontal overflow, relevant navigation visible, Home controls clear of its booking sheet, both payment choices at least 44px and above the fixed bar, online guidance visible, confirmation notice scroll-reachable and Confirm Ride fully in view.
- Physical Android/iOS safe areas, real keyboard behavior, Google Maps, connected booking, Yoco, dispatch, OTP and notification delivery remain outside this synthetic visual test. No production changes or deployment.

Changed files: `src/app/globals.css`, `scripts/customer-visual-preview.cjs`, this report and the new screenshot set. The final commit SHA is reported in the delivery message; a commit cannot include its own hash.
