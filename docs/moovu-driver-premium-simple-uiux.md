# MOOVU Driver premium simplicity review

## Candidate and scope

- Source baseline: `76fa08f4192a250649b0c79cef0606dfc56ae14e`, the approved Customer UI Pass 2.1 production source. The notification-enrollment reliability commit `f49bd02d21fae653fca3157b74f22af8f9dd427b` is an ancestor.
- Branch: `codex/driver-uiux-premium-simple`.
- Isolated worktree: `D:\Users\KN Mudau\Desktop\Websites\moovu-driver-uiux`.
- Final review commit: record the SHA from `git rev-parse HEAD` in the handoff message. A commit cannot contain its own SHA.
- Production deployment and data: unchanged.

## Existing Driver workflow preserved

The Driver signs in, sees the map and availability control, and receives the current offer from the existing offers endpoint. Accept and decline still call the existing response handler. The active trip progresses through assigned, arrived, and ongoing using the existing navigation, arrival, Start OTP, End OTP, cancellation, no-show, chat, and completion handlers. Earnings, history, account, documents, notification enrollment, and support remain on their existing routes. No dispatch timing, acceptance, GPS publication, OTP, finance, or notification behavior was changed.

## Presentation changes

- Home now states “You're offline” or “You're online” above the same availability handler, with a separate plain-language action.
- Incoming offers use a compact bottom sheet with prominent fare, countdown, full wrapping addresses, and reachable Accept and Decline buttons.
- An existing active trip opens its sheet when first loaded. Navigation and then the current trip-stage action appear before secondary details; the map retains more room on mobile. The sheet can still be collapsed.
- The duplicate commission-due card on Earnings was removed. The same balance and link to the existing commission page remain in the wallet summary.
- Driver secondary pages receive consistent heading sizes, card radii, focus treatment, and mobile touch targets without changing their data or controls.

Files changed: `src/components/driver/home/DriverMapSurface.tsx`, `src/components/driver/home/TripOfferPanel.tsx`, `src/components/driver/home/NavigationChooser.tsx`, `src/app/driver/page.tsx`, `src/app/driver/earnings/page.tsx`, and Driver-scoped rules in `src/app/globals.css`. `scripts/driver-visual-preview.cjs` is local-only visual tooling. No dependencies, environment settings, API routes, migrations, or native app files changed.

## Visual evidence

`docs/driver-premium-simple-screenshots/` contains 48 browser-emulated images: 16 states at each of 360×740, 412×915, and 390×844. States are offline, online, incoming offer, countdown, expired offer, accepted trip, navigation chooser, arrived, Start OTP, trip in progress, End OTP, completed-trip history, Earnings, Trip history, Account, and Support. These are screenshots of the running local application with synthetic Driver, offer, trip, and finance fixtures. The harness blocks external hosts, intercepts local APIs, and does not persist records. It grants synthetic geolocation and mocks only a local heartbeat reply.

The isolated preview intentionally has no Google Maps key, so the Home images show the application's map-error state. They do not certify live map appearance, routing, real GPS, connected backend behavior, or physical devices. The countdown and trip stages are synthetic visual fixtures; offer timing and trip transitions were not executed in this review.

## Validation and remaining acceptance

- TypeScript: PASS (`npx tsc --noEmit`).
- ESLint: PASS (`npm run lint -- --quiet`).
- Automated suite: PASS (339/339).
- Production build: PASS (212/212 static pages) with build-only local Supabase values. No production secrets were used.
- Browser emulation: 48 screenshots captured; no horizontal overflow at the three target sizes.
- Diff: limited to Driver presentation, local visual harness, this report, and screenshots. No protected Customer, Admin, backend, migration, dispatch, payment, or notification logic changed.

Before any release, verify on a controlled authenticated Driver account and actual Android/iPhone devices: map controls with a real Maps key, location permissions and GPS, offer appearance and countdown, Accept/Decline, active-trip action reachability with keyboard open, Start/End OTP, chat, earnings, history, account, notification enrollment, and safe-area behavior. Do not activate the dormant 90-second dispatch engine for this UI review.
