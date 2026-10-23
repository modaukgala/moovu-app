# Customer Premium Loading - Local Candidate

Historical first-pass report. The owner subsequently authorized universal portal
integration and live release. See `universal-loading-release-20261023.md` for the
expanded scope, current shared-component paths and release verification boundaries.

Worktree: `D:\Users\KN Mudau\Desktop\Websites\moovu-customer-premium-loading`

Branch: `codex/customer-premium-loading-20261023`

Baseline: `606c8106c074866c3380348d520e5c2aaf5b0aa0`.

## Scope

The existing customer loader is replaced with an original vector black sedan, yellow
route, two markers, township-inspired silhouettes and the existing official logo.
The car has no roof sign or manufacturer badge. The official logo is not modified;
CSS clips its empty outer padding. This is a vector interpretation, not a pixel-perfect
reproduction of the photographic reference.

Arrival runs once, moving left to right. Wheels turn clockwise during arrival only.
After arrival, the car stays still and the route highlight moves toward the destination.
There is no alternating/reversing vehicle loop, simulated percentage, minimum splash
duration, additional fetch, or frame-by-frame React state update.

## Integration

- Existing trip restoration, trip loading, history, receipt and booking route boundaries
  inherit the shared replacement without changing their readiness conditions.
- Booking authentication initialization now uses the same scene.
- Root loading chooses the customer scene outside Driver/Admin routes.
- Account route loading uses the shared scene; existing profile loading remains local.
- Sign-in, signup, recovery submission and booking location lookup use the compact indicator.
- Live maps, search status, OTP, payments and active-trip information are not replaced.
- Full-scene motion pauses on document visibility changes; listeners are cleaned up.
- Reduced-motion CSS removes animation while retaining the branding and visible indicator.
- Customer native-shell fallback background matches white. Native launch screen assets,
  lifecycle and plugin configuration remain unchanged.

## Local Review

Changed/created files:

- `src/components/customer/MoovuLoadingScreen.tsx`
- `src/components/customer/MoovuLoadingScene.tsx`
- `src/components/customer/MoovuLoadingScreen.module.css`
- `src/components/customer/CustomerRouteLoading.tsx`
- `src/components/customer/loadingExperience.test.ts`
- `src/app/loading.tsx`
- `src/app/account/loading.tsx`
- `src/app/book/page.tsx`
- `src/app/customer/auth/page.tsx`
- `src/app/preview/loading/page.tsx`
- `capacitor-shell-customer/index.html`
- This report and the local screenshot below.

Development-only preview paths (return not-found in production):

- `/preview/loading`
- `/preview/loading?view=mobile` (390px iframe)
- `/preview/loading?view=compact`
- `/preview/loading?view=dark`

Use localhost placeholders only for visual review. They are not valid credentials and
cannot establish authenticated end-to-end behavior. Do not log in with a real account
against this placeholder configuration.

## Evidence

- Automated suite: 345 tests passed, including four new source-contract tests.
- TypeScript: passed.
- ESLint: zero errors and five existing warnings.
- Production build: passed with localhost-only Supabase placeholders.
- Git diff whitespace checks: passed.
- Browser: desktop 1265px and narrow 391px layouts inspected; 390px framed mobile
  also inspected. Narrow 391px DOM check found no horizontal overflow.
- Browser computed styles confirmed active indeterminate progress and route animation;
  vehicle arrival settled at identity transform, with no infinite vehicle animation.
- Screenshot: `loading-evidence/customer-loading-mobile.png`.

Source-contract tests are not React interaction or authenticated integration tests.
Reduced motion and background pause have source coverage but still require runtime
preference/lifecycle verification. No real-device testing was performed.

## Remaining Gates

1. Owner approves the vector artwork against the reference.
2. Real Customer account checks on safe configured staging: login, recovery, book,
   history, receipt and active-trip restoration.
3. iPhone/Android startup, foreground/background, safe areas, reduced motion and slow
   network tests. No native binary was rebuilt or synced in this task.
4. Verify static native logo-to-web transition on physical devices. There is no added
   SplashScreen plugin or explicit native hide handshake; this task cannot certify
   absence of double splash or white flash.
5. Release-baseline reconciliation and separate deployment approval.

No SQL, production configuration, service credentials, dispatch, fares, financial
rules, Phase 5A changes, commits, pushes or deployments were performed.

Deployment readiness: NEEDS CAUTION. Local visual candidate, not native-certified.
