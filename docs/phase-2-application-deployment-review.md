# Phase 2 application deployment review

Review date: 11 September 2026  
Repository: `D:\Users\KN Mudau\Desktop\Websites\moovu-kasi-rides-redesign`  
Production Supabase: `mvazbszenqahgqpznhhq`  
Review mode: read-only; no deployment or activation

## Decision

The application is safe to deploy against the installed Phase 2 schema while
both the application and database policy remain OFF. The release must use the
exact reviewed application build and must explicitly retain OFF configuration.
AUTHORITATIVE remains intentionally unavailable in the application and is not
ready for activation. SHADOW requires a later, separate activation review.

## Repository state

- Branch: `main`
- HEAD: `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`
- Upstream: `origin/main`
- Tracked runtime files modified: 32
- Tracked SQL file modified: 1
- Runtime source/test files untracked: 29
- Numerous review, migration, validation, and report artifacts are untracked
- `git diff --check`: PASS; Windows line-ending warnings only
- Existing work was preserved; no reset, clean, stash, revert, commit, or push
  occurred.

The current production Vercel deployment is
`moovu-hz8nbcfjd-kgalaletsos-projects.vercel.app`, deployment
`dpl_D4p7gQM7RqqTVtPMqPaw7wf8Rbyc`, created 2 September 2026. Vercel reports it
as Production / Ready. It predates the local Phase 2 application work.

## Deployment scope classification

### A. Required Phase 2 application files

Direct Phase 2 runtime:

- `src/lib/finance/phase2Policy.ts`
- `src/lib/server/phase2Rpc.ts`
- `src/lib/trips/completeTripServer.ts`
- `src/app/api/admin/payment-reviews/route.ts`
- `src/app/api/driver/trips/complete/route.ts`
- `src/lib/auth/admin.ts`

Required runtime prerequisites used by those files:

- `src/lib/server/hardenedRpc.ts`
- `src/lib/notifications/outboxDelivery.ts`

The two principal integration files, `completeTripServer.ts` and
`payment-reviews/route.ts`, also contain the reviewed Phase 0.5 conversion from
sequential server writes to installed hardened RPCs. Those changes are
inseparable at file level from the Phase 2 hooks and are part of the tested
application package.

Existing callers that must remain compatible, although the Admin caller has no
local diff:

- `src/app/api/admin/trips/complete/route.ts`
- `src/app/api/driver/trips/complete/route.ts`

### Tests only

- `src/lib/auth/adminRoles.test.ts`
- `src/lib/finance/commissionSnapshot.test.ts`
- `src/lib/finance/ledgerFoundation.test.ts`
- `src/lib/finance/ledgerMigrationContract.test.ts`
- `src/lib/finance/money.test.ts`
- `src/lib/finance/phase2Ledger.test.ts`
- `src/lib/finance/phase2Policy.test.ts`
- `src/lib/notifications/outboxDelivery.test.ts`
- `src/lib/reliability/phase05Guards.test.ts`
- `src/lib/reliability/phase05bContracts.test.ts`
- `src/lib/reliability/phase05fHttpOutbox.test.ts`
- `src/lib/reliability/phase05hProductionDefects.test.ts`
- `src/lib/reliability/phase2FinanceContracts.test.ts`
- `src/lib/reliability/phase2PaymentRecovery.test.ts`
- `src/lib/reliability/phase2TripRecovery.test.ts`
- `src/lib/server/hardenedRpc.test.ts`
- `src/lib/server/phase2Rpc.test.ts`

`src/lib/finance/phase2Ledger.ts`, `ledgerFoundation.ts`, `money.ts`, and
`commissionSnapshot.ts` are tested finance/domain helpers but are not imported
by a production Phase 2 route in the reviewed build. They are design and test
support, not required runtime files for an OFF deployment.

### Documentation and migration only

All `docs/phase-2-*` SQL, audit, plan, validation, review, and execution files
are evidence or database artifacts. The production migration is already
installed. Vercel must not execute any SQL artifact during application release.

### D. Pre-existing related and unrelated application changes

The following dirty runtime changes belong to earlier Phase 0/0.5 reliability,
actor, notification, dispatch, and application-flow work. They are not new
Phase 2 finance authority, but they are present in the build that passed all
current validation:

- `src/app/admin/(protected)/drivers/[id]/page.tsx`
- `src/app/admin/(protected)/settlements/page.tsx`
- `src/app/admin/(protected)/subscriptions/page.tsx`
- `src/app/api/admin/applications/action/route.ts`
- `src/app/api/admin/applications/create-driver/route.ts`
- `src/app/api/admin/driver-subscription-activate/route.ts`
- `src/app/api/admin/driver-subscription-payments/route.ts`
- `src/app/api/admin/drivers/link-account/route.ts`
- `src/app/api/admin/drivers/remove/route.ts`
- `src/app/api/admin/settlements/record/route.ts`
- `src/app/api/admin/subscriptions/update/route.ts`
- `src/app/api/admin/trips/cancel/route.ts`
- `src/app/api/admin/trips/create/route.ts`
- `src/app/api/customer/book-trip/route.ts`
- `src/app/api/customer/cancel-trip/route.ts`
- `src/app/api/customer/trip-location/route.ts`
- `src/app/api/driver/apply/route.ts`
- `src/app/api/driver/trip-status/route.ts`
- `src/app/api/driver/trips/arrive/route.ts`
- `src/app/api/driver/trips/cancel/route.ts`
- `src/app/api/driver/trips/no-show/route.ts`
- `src/app/driver/apply/page.tsx`
- `src/app/driver/page.tsx`
- `src/components/InAppNotificationBar.tsx`
- `src/components/driver/home/types.ts`
- `src/lib/finance/applyTripCommissionServer.ts`
- `src/lib/finance/driverWalletLedger.ts`
- `src/lib/push-server.ts`
- `src/lib/drivers/applicantSession.ts`
- `src/lib/drivers/applicationIdentity.ts`
- `src/app/api/jobs/outbox/route.ts`

These changes must be preserved. A release must not be created by copying only
the six direct Phase 2 files over the old production source. The safe package is
a clean, reviewable release commit containing the full validated prerequisite
runtime set plus the Phase 2 integration files. Logs, disposable SQL runners,
reset scripts, and local-only artifacts must not be used as deployment inputs.

### C. Files and actions excluded from deployment execution

- `.codex-local-dev.err.log`
- `.codex-local-dev.out.log`
- disposable reset, fixture, concurrency, and validation SQL
- production migration SQL execution
- historical backfill or opening-balance SQL
- generated local `.next` output as a source artifact
- any unreviewed environment-value change

Documentation and tests may be committed for traceability, but they do not form
part of the runtime bundle and no SQL file is to be executed by Vercel.

## Runtime modes

Only `MOOVU_PHASE2_FINANCE_MODE` controls application Phase 2 mode.

| Value | Effective behavior |
|---|---|
| Missing, blank, or invalid | Resolves to `OFF` |
| `OFF` | Hardened legacy behavior remains authoritative; no Phase 2 RPC call |
| `SHADOW` | Hardened legacy transaction commits first; Phase 2 posting and reconciliation follow |
| `AUTHORITATIVE` | Completion and payment review return HTTP 503 before mutation because cutover orchestration is intentionally unavailable |

The production Vercel environment does not currently list
`MOOVU_PHASE2_FINANCE_MODE`; this resolves safely to OFF. A production-safe
release should either keep it absent or set it explicitly to `OFF`. Explicit
`OFF` is preferable for operational clarity, but adding or changing the Vercel
variable is a separate approved release action.

Related dormant reliability configuration:

| Variable | Current production listing | Default / invalid behavior |
|---|---|---|
| `PHASE05_OUTBOX_ENABLED` | absent | disabled unless exactly `true` |
| `OUTBOX_JOB_SECRET` | absent | worker rejects all requests |

Existing Supabase service and public variables are present in Vercel and remain
encrypted. No secret value was printed or changed.

## Commission and new-trip behavior

While database mode is OFF, the Phase 2 insert trigger returns the new trip
unchanged. The application does not call Phase 2 posting in OFF mode. Existing
legacy production economics therefore continue: Go uses 10% and Go XL uses
12%, including the existing fallback path. The reviewed application still
labels these legacy rates in Admin reporting.

The dormant database policy contains 1,500 basis points for Go and Go XL. When
a separately approved database activation supplies an effective date, only new
eligible trips receive a 15% snapshot. The snapshot fields are database-owned
and immutable after locking. Existing trips remain without a Phase 2 snapshot
and are not repriced from the current policy. The posting RPC requires the
locked snapshot and never looks up a current rate to reprice historical work.

## Trip completion path

Both Driver and Admin completion call `completeTripServer`. In OFF mode the
service calls the installed `phase05b_complete_trip` hardened RPC. That RPC is
the sole authoritative completion/wallet mutation and preserves the legacy
rate contract. The Phase 2 posting RPC is not called.

In SHADOW, completion still commits through the legacy hardened RPC first.
`phase2_post_trip_commission` then uses `trip_commission:<trip UUID>` as the
stable source. A completed-trip retry first obtains an authorized replay from
the legacy RPC; only a confirmed replay may retry the missing shadow effect.
Database source uniqueness and Phase 1 idempotency guarantee one financial
effect under concurrent retries.

Direct notifications run only when `replayed=false` and the outbox switch is
disabled. If outbox delivery is later enabled, the database business event and
per-user event key provide the deduplication boundary. A crash or timeout after
legacy completion may leave shadow work temporarily absent, but retry repairs
it without repeating the legacy financial result or direct notification.

## Payment-review path

The route requires a valid authenticated admin profile and separately restricts
financial POST actions to `owner` or `admin`. Dispatcher and Support receive
403 before the RPC. Request ID and action are validated; review notes are
bounded to 500 characters.

In OFF, `phase05b_review_driver_payment` remains the only authority. In SHADOW,
an approved result with commission allocation or excess invokes
`phase2_post_verified_driver_payment` using the same payment request UUID.
Replayed legacy approval still retries missing shadow posting. SQL derives the
stable source `driver_payment:<request UUID>`, applies verified funds to debt
first, and posts excess to Driver unapplied credit. Idempotency and row/advisory
locks prevent duplicate effects.

Missing actor identity, missing profile, malformed/unauthorized roles, non-
approved requests, and OFF mode fail closed in the database. Route notifications
are skipped on legacy replay. A transport or Phase 2 RPC failure is logged as
unresolved but does not invalidate the already successful legacy approval;
subsequent replay can heal the shadow side.

## R50 eligibility and subscription transition

The helper boundary is exact: debt below 5,000 cents is financially eligible;
debt at or above 5,000 cents is restricted. The database position RPC derives
debt from posted ledger entries and the eligibility RPC preserves legacy wallet
and subscription authority outside AUTHORITATIVE.

No production route currently calls Phase 2 eligibility as an authority.
AUTHORITATIVE completion/payment review is also deliberately blocked. This
central fail-closed boundary prevents R50 from affecting OFF deployment. The
future dispatch/acceptance cutover still requires one atomic database authority
path before AUTHORITATIVE can be approved. Active legitimate trips must remain
completable even after debt crosses R50; that behavior was validated in the
disposable suite but is not activated here.

`subscription_required` remains true in the database, and the application
helper retains subscriptions in OFF and SHADOW. Subscription history, tables,
payments, reporting, and existing eligibility are untouched. Removal is limited
to a future AUTHORITATIVE cutover and requires separate approval.

## Driver and Admin UI

The reviewed Phase 2 change does not expose a live ledger balance, R50 status,
unapplied credit, or 15% commission panel to Drivers while OFF. Existing Driver
commission, payment, subscription, and earnings screens continue to use legacy
records, so the dormant empty ledger is not presented as an authoritative zero.

Admin pages continue to inspect legacy wallets, settlements, subscriptions,
and payment requests. The new financial route mutation gate permits only Owner
and Admin. Dispatcher and Support retain non-financial admin access but cannot
approve/reject/wait a payment review. Merely installing the Phase 2 database
objects exposes no new browser mutation path.

## Database contract compatibility

Local code and the installed production migration agree on:

- contract version `phase-2-v1`;
- application RPC names and signatures;
- four nullable trip snapshot columns;
- `OFF`, `SHADOW`, and `AUTHORITATIVE` mode values;
- 1,500 basis points, 5,000-cent limit, and 4,000-cent warning;
- `DRIVER_COMMISSION_DEBT`, `DRIVER_UNAPPLIED_CREDIT`,
  `COMMISSION_REVENUE`, and `PAYMENT_CLEARING` account categories;
- `TRIP_FINANCIAL_COMPLETION` and `DRIVER_PAYMENT` transaction types;
- `TRIP` and `DRIVER_PAYMENT_REQUEST` source types;
- `trip_commission:<trip UUID>` and `driver_payment:<request UUID>` identities.

Production SELECT-only recheck at 2026-09-11 05:05:27 UTC confirmed policy
OFF, effective date NULL, subscription required, ledger 0/0/0, and zero shadow
rows. The installed migration was already verified as nine Phase 2 functions
and four trip columns.

## Failure modes and security

- Missing/unavailable/incompatible Phase 2 RPC: typed 503 result; no fallback
  mutation.
- Business rejection or duplicate conflict: typed 409 result.
- Unexpected RPC/Supabase failure: sanitized 500 result and server log.
- Legacy replay: stable Phase 2 identity is retried; direct notification is
  suppressed.
- Crash after legacy commit: SHADOW may be temporarily missing, then recoverable
  through authorized replay.
- Concurrent retry: protected legacy RPC plus unique idempotency/source keys
  produce one financial effect.
- Missing or malformed actor: rejected before Phase 2 financial work.
- Notification failure: post-commit and non-authoritative; retry/deduplication
  boundaries prevent duplicate financial mutation.
- AUTHORITATIVE value set prematurely: completion and payment review fail before
  mutation with 503.

Phase 2 helpers contain no client directive and are imported only by server
routes/services and tests. The privileged Supabase client is created server-side
from `SUPABASE_SERVICE_ROLE_KEY`. No service key is returned to a browser or
stored in a `NEXT_PUBLIC_*` variable. The local credential scan found no
high-confidence candidate secret.

## Current validation

| Check | Result |
|---|---|
| Full direct Node suite | PASS, 36 files / 165 tests |
| Focused Phase 2 recovery/security | PASS, 18/18 |
| TypeScript `npx tsc --noEmit` | PASS |
| ESLint `npm run lint` | PASS, 0 errors / 0 warnings printed |
| Production build | PASS, 171/171 pages |
| `git diff --check` | PASS, line-ending warnings only |
| Credential scan | PASS, 122 changed/untracked files, 0 candidates |

Node emitted existing module-type performance warnings during direct tests.
They do not change test results. `package.json` still has no literal `test`
script, so the suite was invoked directly.

## Required deployment configuration

- Supabase URL, anon key, and service-role key must remain the existing
  production values.
- `MOOVU_PHASE2_FINANCE_MODE` must resolve to `OFF`.
- `PHASE05_OUTBOX_ENABLED` must remain absent/false unless the outbox worker,
  secret, and scheduled invocation receive their own reviewed activation.
- No database migration or seed command is part of the application deployment.
- No 15%, R50, subscription-removal, opening-balance, SHADOW, or AUTHORITATIVE
  action is part of the deployment.

## Recommended production deployment sequence

1. Produce and review one clean release diff containing the validated runtime
   prerequisites and Phase 2 integration files, while preserving unrelated work.
2. Re-run the migration hash, production object check, policy OFF check, ledger
   0/0/0 check, quota/project-health check, tests, TypeScript, lint, build,
   credential scan, and `git diff --check`.
3. Confirm the Vercel Production environment resolves
   `MOOVU_PHASE2_FINANCE_MODE` to OFF and outbox activation remains disabled.
4. Obtain owner approval for that exact release diff and OFF configuration.
5. Deploy the exact reviewed build and wait for Vercel Ready.
6. Verify Customer, Driver, and Admin public routes plus safe unauthenticated API
   responses.
7. Use existing owner-controlled accounts for authenticated Customer, Driver,
   Owner, Admin, Dispatcher, and Support smoke checks; do not manufacture
   financial records.
8. Verify normal legacy completion/payment/notification behavior, no Phase 2
   posting, policy OFF, empty ledger, and unchanged historical totals.
9. Keep Phase 2 OFF and prepare a separate SHADOW activation review.

This sequence was not executed.

## Application rollback plan

If the OFF-mode application release regresses, use Vercel's production rollback
or redeploy the last known Ready deployment
`dpl_D4p7gQM7RqqTVtPMqPaw7wf8Rbyc`. Confirm aliases return to the selected Ready
deployment, then repeat public and authenticated smoke checks.

The additive Phase 2 database schema can remain installed with policy OFF.
Application rollback does not require dropping tables, functions, columns, or
historical evidence. Do not run the disposable reset SQL in production. Recheck
policy OFF and ledger state after rollback.

## Blockers and recommendation

No code, database-contract, security, test, or build blocker prevents deploying
the reviewed application with Phase 2 OFF.

The working tree is broad and uncommitted. Deployment approval must therefore
name the exact release diff and include its Phase 0/0.5 prerequisites; it must
not mean “deploy every local file without review.” This is a packaging gate for
the release step, not a defect in the reviewed OFF-mode application behavior.

AUTHORITATIVE is not ready: its application orchestration intentionally returns
503, and dispatch/acceptance authority is not wired to the R50 ledger rule.
SHADOW also remains inactive pending a separate activation review and monitored
observation plan.

Recommendation: approve only an exact, reviewable application release with
`MOOVU_PHASE2_FINANCE_MODE=OFF`. Keep database policy OFF and ledger dormant.

## Final production confirmation

- Application deployment: not performed
- Production SQL mutation: not performed
- Database policy: OFF
- Application mode: OFF by absent production variable
- SHADOW: OFF
- AUTHORITATIVE: OFF
- Ledger: 0 accounts / 0 transactions / 0 entries
- Shadow reconciliation rows: 0
- 15% commission: not active
- R50 restriction: not active
- Subscription requirement: unchanged and true
- Yoco: not started
- Phase 3: not started
- Commit and push: not performed

## Final verdict

PHASE 2 APPLICATION DEPLOYMENT REVIEW PASSED

READY FOR OWNER APPROVAL TO DEPLOY PHASE 2 APPLICATION WITH PHASE 2 OFF
