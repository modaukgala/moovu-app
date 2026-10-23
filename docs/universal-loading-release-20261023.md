# Universal MOOVU Loading Release

## Authorized Scope

The owner requested the approved loading design across Customer, Driver and Admin,
followed by a live deployment. Work is isolated on
`codex/customer-premium-loading-20261023`, based on production commit
`606c8106c074866c3380348d520e5c2aaf5b0aa0`.

Production baseline verified through Vercel on 23 October 2026:
`dpl_Ei4EnnbPGGgaWdKAojC9NJjydFg7`, project `moovu-app`,
`prj_up795H2nXqHcwVNc0rbgwDaslLKf`.

## Integration

- One implementation under `src/components/ui/MoovuLoadingScreen.tsx`, with shared
  SVG scene and CSS module. Existing Customer imports remain compatible via re-export.
- Root, Customer booking/account, Driver and Admin route loading boundaries.
- Driver startup and Admin session-check gates retain exactly their existing conditions.
- Existing shared `LoadingState` consumers in Driver/Admin show the same contained scene.
- Admin dashboard, earnings, trip detail and secure document loading use the shared scene.
- Customer/Driver/Admin sign-in submissions, Driver account totals and Admin receipt
  refreshes use compact indicators without hiding active content.
- No mandatory splash duration, additional bootstrap request, readiness timer or delay.
- No API, SQL, dispatch, payment, notification, finance or eligibility changes.
- Existing production telemetry disabled guards remain unchanged.

## Validation Before Staging

- Full automated suite: 347 passed.
- Production build: passed (localhost-only placeholder Supabase configuration).
- ESLint: zero errors, five pre-existing warnings.
- Diff whitespace: passed.
- Customer artwork and narrow-screen browser evidence is recorded in
  `customer-premium-loading-20261023.md` and `loading-evidence/`.
- New source-contract tests cover all portal boundaries and unchanged startup gates.
- Fresh local production-server smoke attempt was blocked by execution policy; no
  workaround was attempted. Staged production artifact checks remain required.

Source contracts are not authenticated workflow tests. No synthetic production rides,
payments or notifications are permitted for this visual release.

## Release Procedure

1. Commit only this isolated loading candidate and documentation.
2. Build on Vercel using existing production environment, staging with `--skip-domain`.
   Never deploy the locally built placeholder-configured `.next` with `--prebuilt`.
3. Check the staged artifact and portal routes, then promote the same production build.
4. Verify all three domains and disabled telemetry. Record final IDs separately.

No production environment or schema modifications are required. Existing scheduled
jobs remain at their production baseline configuration; no new job is introduced.

Rollback: restore `dpl_Ei4EnnbPGGgaWdKAojC9NJjydFg7` if loading, authentication,
booking, Driver startup or Admin operations regress. No database rollback is involved.

## Verification Boundaries

Authenticated Customer/Driver/Admin actions and physical-device launch transitions
remain owner checks. Existing Capacitor apps load the hosted UI from their configured
server URLs and should receive these web loading changes, but static native launch
assets are not changed by a Vercel deployment. No new AAB/IPA is built or uploaded.

Do not describe public route checks as authenticated acceptance or native certification.
Post-release classification must remain DEPLOYED - MONITORING REQUIRED until those
checks are actually completed.
