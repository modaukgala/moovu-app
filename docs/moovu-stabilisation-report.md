# MOOVU P0 Stabilisation Report

Date: 2026-09-23
Scope: release baseline, Phase 6 compatibility, immediate booking, scheduled safety, schema preflight, canonical trip/offer contracts, concurrency, and completion/finance regression.
Production mutation: **none**.

## 1. Starting Git state

- Repository: `D:/Users/KN Mudau/Desktop/Websites/moovu-kasi-rides-redesign`.
- Branch: `main`.
- Initial inspected HEAD: `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`.
- During the session the branch advanced externally to `61cb00ed054b53038d273905fa86b9076aa267ad` (`origin/main`); Codex did not commit, push, reset, clean, stash, or rewrite history.
- The stabilization overlay remains intentionally uncommitted. Existing work was preserved.

## 2. Release-baseline findings

The active production deployment is Vercel deployment `dpl_12NaVfBEisT9kqBf8fSdTSxJ3qAv`, project `moovu-app`, target `production`, status `Ready`, serving `moovurides.co.za` and the Customer, Driver and Admin aliases. It was created on 2026-09-22 and was inspected read-only.

The exact implementation baseline is now defined by:

1. Git HEAD `61cb00ed054b53038d273905fa86b9076aa267ad`;
2. the runtime and validation overlay SHA-256 values in `docs/moovu-release-baseline-manifest.json`;
3. the `baseline` schema profile in `scripts/release-schema-preflight.mjs`;
4. `NEXT_PUBLIC_MOOVU_PHASE6_NEW_WORK_ELIGIBILITY` absent/disabled;
5. scheduled rides disabled;
6. production schema evidence in `docs/moovu-master-transformation-audit.md`.

A future release must reproduce all six inputs. The dirty working tree itself is not release authority.

## 3. Changes implemented

- Added shared current trip and offer contracts.
- Added explicit dormant release flags for scheduled rides and Phase 6 new-work eligibility.
- Decoupled current Driver work eligibility from the absent Phase 6 RPC while the flag is disabled.
- Kept enabled Phase 6 eligibility fail-closed when its RPC is missing or invalid.
- Reused canonical active-state lists in dispatch candidate, dispatch, and offer-expiry queries.
- Rejected scheduled booking at the API boundary with `409/SCHEDULED_RIDES_DISABLED` before any database write and disabled its UI control.
- Added a read-only database capability preflight with baseline, Phase 6, and payment profiles.
- Added stabilization regression tests and hardened the connected disposable harness for current constraints and expiring signed route quotes.

## 4. Phase 6 compatibility solution

Option A was implemented. Existing production eligibility remains authoritative while `NEXT_PUBLIC_MOOVU_PHASE6_NEW_WORK_ELIGIBILITY` is absent or disabled. The same switch hides the Driver Phase 6 notice while dormant. In that state no call is made to `phase6_new_work_eligible`, so production behavior does not depend on an RPC that production lacks.

When the flag is explicitly enabled, the RPC is mandatory and any missing/error/non-boolean response fails closed. This prevents a silent eligibility fallback at the activation boundary. Phase 6 remains present locally and dormant; no Driver cohort was migrated.

## 5. Schema preflight design

`scripts/release-schema-preflight.mjs` reads Supabase's REST OpenAPI document with GET only. It verifies required tables, critical columns, and RPC paths. It never prints credentials, refuses the production project unless the caller explicitly supplies `--allow-production-readonly`, and makes no mutation request.

Disposable results for `tangtlmdpnvmoviwrgvd`:

- `baseline`: PASS.
- `payments`: PASS.
- `phase6`: expected BLOCK — missing `phase6_policy`, `phase6_applications`, and `phase6_new_work_eligible`.

The blocked Phase 6 profile proves that the new application gate is required and prevents accidental activation against an incompatible schema.

## 6. Immediate booking validation

The connected disposable run `501e614b` passed **94/94** checks. It used real authenticated HTTP routes and existing database RPCs for:

Customer signup -> server route/fare -> booking -> dispatch -> offer -> acceptance -> heartbeat -> arrival -> start OTP -> completion OTP -> financial posting.

Both Go and Go XL completed. Customer-supplied actor and fare fields were ignored in favor of authenticated identity and server-owned fare. Booking replay preserved the original trip, offer, and persisted OTPs. Wrong OTP, ownership impersonation, untrusted financial/dispatch RPC calls, and minimum-duration bypass were rejected.

## 7. Scheduled-trip resolution

Scheduled creation is temporarily disabled. The API returns `409` with `SCHEDULED_RIDES_DISABLED` before the incompatible `scheduled` trip status can reach the database. The Customer UI disables the schedule action. Historical rows are untouched.

Future work must define a production-compatible schedule state machine and migration before this flag can change.

## 8. Canonical trip contract

The current contract contains only production-compatible states:

`requested -> offered -> assigned -> arrived -> ongoing -> completed/cancelled`.

Allowed transitions are centralized in `src/lib/trips/tripContract.ts`. `scheduled` is deliberately excluded. Type aliases distinguish future communication, financial, and audit events from trip state so later transformation work does not overload `trips.status`.

## 9. Canonical offer contract

The current schema/code values are centralized as:

`pending`, `shown`, `accepted`, `declined`, `expired`, `cancelled`.

`pending` and `shown` are the only active offer states. Existing server/RPC authority for reservation, acceptance, decline, expiry, and losing-offer cancellation is preserved. Unsupported speculative values were not introduced.

## 10. Concurrency protection

Disposable PostgreSQL/API evidence proved:

- two simultaneous reservations for one Driver across two trips produce exactly one successful reservation;
- two authenticated Drivers racing to accept one trip produce one `200` winner and one deterministic `409` loser;
- exactly one offer becomes accepted and the losing offer becomes cancelled;
- no commission is created by the acceptance race;
- concurrent replay of the same booking key returns one trip identity and the same OTPs;
- trip-scoped expiry does not modify unrelated offers;
- untrusted clients cannot reserve, accept, or expire offers.

Assignment authority remains in locked server-side database functions; client-side checks are not relied upon.

## 11. Financial idempotency validation

Each completed Go/Go XL trip produced exactly one POSTED `trip_commission:<tripId>` transaction with equal debit and credit totals at the authoritative 15% rate. No legacy wallet commission duplicate was created. Repeating completion returned the safe conflict outcome and left one obligation. Concurrent Phase 2 recovery/idempotency tests also passed in the 248-test suite.

The connected matrix confirmed R0 and R49.99 can receive work, R50 and R100 cannot, subscriptions are not required, and an already active trip can continue/complete after crossing R50. No production financial record was changed.

## 12. Phase 3 regression status

Phase 3 remains preserved and inactive for this sprint. Tests passed for browser-return authority, paid-only dispatch, Yoco signature verification, TEST/LIVE isolation, exact Driver obligation settlement, checkout amount authority, subscription pricing, server-only processors, payment idempotency, reconciliation contracts, and manual-write fail-closed behavior.

No Pay Online feature was activated, no provider transaction was created, and the separate Phase 3 UX correction migration was not applied.

## 13. Phase 6 preservation status

All existing Phase 6 migrations, routes, evidence workflows, retention work, and security tests remain present. The stabilization work did not delete, bulk migrate, or activate them. Current eligibility continues under legacy production authority until schema installation, cohort validation, and a separate flag change are approved.

## 14. Tests executed/results

| Check | Result |
|---|---|
| Stabilization contract tests | PASS, 6/6 |
| Full repository suite | PASS, 248/248 |
| Connected disposable lifecycle/concurrency | PASS, 94/94 |
| Extended disposable race/scheduled run | PASS, 23/23 |
| Baseline schema preflight | PASS |
| Payments schema preflight | PASS |
| Phase 6 schema preflight | EXPECTED BLOCK, exact missing objects reported |
| TypeScript `npx tsc --noEmit` | PASS |
| Full ESLint | PASS, 0 errors; 3 pre-existing warnings |
| Production build | PASS, 205 static pages generated |
| Credential scan of changed/untracked files | PASS |
| `git diff --check` | PASS |
| Vercel deployment inspection | PASS, read-only, current production Ready |

The connected tests mutated only disposable project `tangtlmdpnvmoviwrgvd`. Evidence records state `production_mutated: false`.

## 15. Files changed

Runtime:

- `src/app/api/customer/book-trip/route.ts`
- `src/app/book/page.tsx`
- `src/app/driver/page.tsx`
- `src/lib/dispatch/dispatchCandidates.ts`
- `src/lib/dispatch/dispatchTrip.ts`
- `src/lib/dispatch/expireTripOffers.ts`
- `src/lib/dispatch/offerContract.ts`
- `src/lib/drivers/phase6NewWork.ts`
- `src/lib/release/releaseFlags.ts`
- `src/lib/trips/tripContract.ts`

Validation/evidence:

- `scripts/release-schema-preflight.mjs`
- `scripts/p0-booking-recovery-e2e.mjs`
- `src/lib/drivers/stabilisationContracts.test.ts`
- `src/lib/payments/paymentUxCorrection.test.ts`
- `src/lib/trips/adminTripPaymentMethod.test.ts`
- `docs/p0-booking-recovery-connected-evidence.json`
- `docs/p0-booking-recovery-extended-evidence.json`
- `docs/moovu-release-baseline-manifest.json`
- `docs/moovu-stabilisation-report.md`

## 16. Migrations prepared

No new stabilization migration was required. Dormant, unapplied Phase 6 migrations remain listed in the release manifest. The separate `docs/phase-3-payment-ux-subscription-yoco-correction.sql` and concurrently added `supabase/migrations/20260923103000_phase3_online_trip_method_repair.sql` remain prepared, unapplied, and outside this stabilization release. The concurrent checkout-navigation correction was preserved. The final combined tree passed focused Phase 3 tests, TypeScript, ESLint, and a fresh production build.

## 17. Production actions still required

Before any future deployment:

1. freeze a clean commit from the exact manifest overlay;
2. run the `baseline` preflight read-only against production;
3. verify effective production finance mode and feature flags;
4. deploy only the frozen candidate after separate authorization;
5. keep the Phase 6 flag disabled until its additive migrations and cohort checks pass;
6. keep scheduled rides disabled until their state machine is implemented and migrated.

Phase 6 migration/activation and Phase 3 payment activation remain separate approval gates.

## 18. Remaining blockers

No P0 blocker remains for using this exact source/schema contract as the implementation baseline. The repository is not ready for production deployment from the dirty tree.

The following activation/product gates remain outside this sprint:

- Phase 6 schema is absent and its profile correctly fails preflight;
- scheduled rides are intentionally unavailable;
- production runtime finance-mode agreement must be re-proved for a release;
- Phase 3 general activation still needs its separate controlled provider/owner gate;
- Phase 6 cohort/legal/Storage decisions remain open;
- the overlay must be committed/frozen before release.

## 19. Master Transformation readiness

**YES — implementation baseline only.** The codebase is safe to use for the single coordinated MOOVU Master Transformation implementation when the next work starts from Git HEAD `61cb00ed054b53038d273905fa86b9076aa267ad` plus the exact SHA-256 overlay in `docs/moovu-release-baseline-manifest.json`.

This verdict does not authorize deployment, production SQL, feature activation, E1-E5 implementation, Pay Online activation, MOOVU+, payouts, or Phase 6 Driver migration.
