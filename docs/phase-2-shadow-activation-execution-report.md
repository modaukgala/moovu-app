# Phase 2 SHADOW activation execution report

Execution date: 11 September 2026  
Repository: `D:\Users\KN Mudau\Desktop\Websites\moovu-kasi-rides-redesign`  
Production Supabase: `moovu-kasi-rides` (`mvazbszenqahgqpznhhq`)  
Production deployment: `dpl_2tZbsRFZ3t92gzgeboXqDhYY18Ng` (READY)  
Result: activation blocked before mutation

## Exact blocker

The reviewed activation mechanism requires two coordinated production changes:

1. set the production database policy to `SHADOW` with one future immutable `effective_from`; and
2. set `MOOVU_PHASE2_FINANCE_MODE=SHADOW` in the production application and deploy the exact current source before the cutoff.

The owner instruction authorizes the database cutoff/SHADOW operation but explicitly states that application deployment and environment changes are not authorized. Production currently has no `MOOVU_PHASE2_FINANCE_MODE` variable. `phase2Mode()` therefore resolves to OFF, and both trip-completion and payment-review routes call Phase 2 posting only when that application mode equals SHADOW.

Changing only the database would not activate end-to-end SHADOW processing. It would allow post-cutoff trip snapshots in the database while the application continued skipping all secondary trip/payment posting. Because `effective_from` becomes immutable once assigned, performing that partial activation would create a permanent ambiguous observation boundary.

The final activation review explicitly requires the application mode change and production deployment. The activation prompt also says to stop if the implementation differs from the authorized mechanism. No safe interpretation permits overriding the explicit prohibition.

## Repository state

- Branch: `main`
- HEAD: `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`
- Existing modified and untracked work was preserved.
- No reset, clean, stash, revert, commit, or push occurred.
- `git diff --check` remained clean apart from line-ending notices.

## Production identity and infrastructure

- Confirmed target: `moovu-kasi-rides`, ref `mvazbszenqahgqpznhhq`
- Confirmed this is not disposable ref `tangtlmdpnvmoviwrgvd`
- Current application deployment: `dpl_2tZbsRFZ3t92gzgeboXqDhYY18Ng`, Production/READY
- Application rollback deployment: `dpl_G34Qh4vHNeECgevMM1GmA1CYCeso`
- Supabase was last freshly verified Healthy, available, and unrestricted.
- Egress was 2.003/5 GB with zero current overage; grace period ends 19 September 2026.
- Infrastructure classification remains `SAFE BUT MONITOR`; infrastructure did not cause this block.

## Pre-activation state preserved

The immediately preceding SELECT-only production gate confirmed:

- Database policy mode: OFF
- Application mode: OFF by absent-variable default
- SHADOW: OFF
- AUTHORITATIVE: OFF
- `effective_from`: NULL
- Financial accounts / transactions / entries: 0 / 0 / 0
- Shadow rows: 0
- Corrected functions / triggers: 3 / 3
- Historical R104.60 payment: unchanged, with zero Phase 2 transactions and zero shadow decisions
- Subscription requirement: true
- 15%: inactive
- R50: inactive
- Opening balances: none

No activation SQL was executed, so no cutoff was established and these states were not changed by this attempt.

## Quiet-window status

The activation stopped before a quiet-window mutation gate was needed. No legitimate work was cancelled or paused. A later activation must freshly confirm no active/ongoing trip, no trip completion in flight, and no payment-review/recovery mutation in flight immediately before the coordinated operation.

## Activation mechanism not executed

The guarded one-row database update documented in `docs/phase-2-shadow-activation-review.md` was not run. No UTC cutoff was selected or written. No environment variable was added or changed, and no deployment was started.

## Financial and operational impact

- Financial impact: none
- Production event affected: none
- Historical backfill: none
- R104.60 replay or mutation: none
- Synthetic finance: none
- Driver/customer eligibility change: none
- Notification: none
- Rollback: not required because no activation mutation occurred

Legacy remains authoritative under the unchanged OFF state.

## Smallest safe remediation

Obtain one explicit owner approval that adds these two items to the already reviewed scope:

1. create/update the Production environment variable `MOOVU_PHASE2_FINANCE_MODE` to the literal non-secret value `SHADOW`; and
2. deploy the exact current production source after the guarded database update, reaching READY before the agreed future UTC cutoff.

That approval should retain every existing prohibition: no AUTHORITATIVE mode, operational 15%, R50 enforcement, subscription removal, opening balances, backfill, manufactured events, unrelated SQL, commit, push, Yoco, or Phase 3.

After that approval, repeat health, quota, OFF-state, corrected-object, invariant, quiet-window, and deployment-scope gates; choose a new server-controlled future cutoff; execute the guarded database transaction; change only the named app mode; deploy; and complete the immediate verification checklist.

## Live observation checklist retained

After a successful future activation, compare each legitimate post-cutoff legacy event with its shadow result and track source identity, eligible event count, successful posting, pre-cutoff skips, recovery/unresolved counts, duplicates, legacy/shadow amounts, expected 10%/12% versus 15% policy variance, unexpected technical variance, debt, unapplied credit, and all ledger invariants. Do not manufacture activity.

## Final safety confirmation

- SHADOW enabled: no
- `effective_from` established: no; remains NULL
- Resulting database/application mode: OFF / OFF
- AUTHORITATIVE: OFF
- Legacy authority: unchanged
- Financial impact: none
- Production event affected: none
- Application deployment: none
- Environment change: none
- Production mutation SQL: none
- Commit/push: none
- Yoco/Phase 3: not started

## Final verdict

PHASE 2 SHADOW ACTIVATION BLOCKED

---

## Coordinated activation after revised owner approval

Execution date: 11 September 2026  
Revised approval: production `MOOVU_PHASE2_FINANCE_MODE=SHADOW`, exact reviewed application deployment, guarded database SHADOW cutoff, immediate verification, and safe OFF response if verification failed  
Result: **successful; rollback was not required**

### Activation contract and sequence

The application defaults to OFF when `MOOVU_PHASE2_FINANCE_MODE` is absent. In SHADOW it invokes the secondary trip and payment posting RPCs only after the authoritative legacy mutation. The database posting contract requires a non-null cutoff and fails closed when it is missing. The trip snapshot trigger also ignores trips created before the cutoff. Setting the cutoff does not enable the application runtime by itself, and Vercel environment changes apply only to later deployments.

The safe sequence used was:

1. revalidate the reviewed source and the unchanged OFF/null/empty production state;
2. confirm a quiet window with zero active or ongoing trips, zero competing active database sessions, and zero detected finance mutations;
3. add only the Production `MOOVU_PHASE2_FINANCE_MODE=SHADOW` configuration;
4. build deployment `dpl_6pE7H2xHQpCdNyEuiFknGrNCog3i` from the exact previously deployed isolated package, initially without customer-facing production aliases;
5. establish the database-controlled future cutoff with the reviewed advisory lock and guarded one-row update;
6. promote the already-READY deployment and assign all production aliases before the cutoff; and
7. verify the complete state before and after the database clock passed the cutoff.

This sequence prevented runtime SHADOW posting without a valid cutoff and prevented the cutoff from arriving while the production runtime remained OFF.

### Repository and source scope

- Branch: `main`
- Source HEAD: `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`
- Existing dirty work remained preserved; no reset, clean, stash, revert, commit, or push occurred.
- Deployment source: `C:\Users\kgala\AppData\Local\Temp\moovu-phase2-correction-release-20260911-125708`, the exact isolated package for the current reviewed production source.
- Worktree and deployment-package payment route SHA-256: `B67A573AE769FD29EA83ACE1C6EE30F4FCE80C00DEF57141DE96B837C6F880A8` in both locations.
- No unrelated dirty worktree runtime change was added to the package.

### Validation and infrastructure

| Check | Result |
| --- | --- |
| Correction-specific suite | PASS, 5/5 |
| Phase 2 focused suite | PASS, 28/28 |
| Full direct Node suite | PASS, 170/170 |
| TypeScript | PASS |
| ESLint | PASS, 0 errors and 3 existing warnings |
| Vercel production build | PASS, 171/171 pages |
| Credential review | PASS; three scanner matches were test-only dummy strings, with no real credential candidate |
| `git diff --check` | PASS; line-ending notices only |

Supabase project `moovu-kasi-rides` (`mvazbszenqahgqpznhhq`) was freshly `ACTIVE_HEALTHY` before and after cutover. There was no HTTP 402, pause, read-only restriction, or failed deployment condition. The latest dashboard quota evidence remains egress 2.003/5 GB with zero current overage and a grace period ending 19 September 2026. Classification remains **SAFE BUT MONITOR**.

The first local `vercel build --prod` attempt could not access Vercel-managed sensitive values and failed page-data collection with `supabaseUrl is required`. This did not affect production and occurred before the cutoff. Vercel's remote builder, which has the scoped production values, then completed the same exact package successfully. The prepared deployment stayed off the customer-facing aliases until READY.

### Environment, deployment, and cutoff

- Environment change: added only Production `MOOVU_PHASE2_FINANCE_MODE=SHADOW`; unrelated variables were not changed or printed.
- Deployment ID: `dpl_6pE7H2xHQpCdNyEuiFknGrNCog3i`
- Deployment URL: `https://moovu-3punpod6x-kgalaletsos-projects.vercel.app`
- Target/status: Production / READY
- Build result: PASS, 171/171 pages
- Database update result: exactly one guarded row returned.
- Immutable `effective_from`: **2026-09-11 18:04:00 UTC**
- Returned policy: mode SHADOW, subscription required true, Go/Go XL 1,500/1,500 basis points, debt limit 5,000 cents.
- Production aliases were moved to the READY artifact before the cutoff.
- Database time at final check: `2026-09-11 18:05:17.383237 UTC`.

### Before and after state

| Item | Before | After cutoff |
| --- | ---: | ---: |
| Application mode | OFF | SHADOW |
| Database mode | OFF | SHADOW |
| `effective_from` | NULL | 2026-09-11 18:04:00 UTC |
| Financial accounts / transactions / entries | 0 / 0 / 0 | 0 / 0 / 0 |
| Shadow reconciliation rows | 0 | 0 |
| AUTHORITATIVE | OFF | OFF |

There were zero trips and zero reviewed payments between the final quiet-window check and the cutoff. At the first post-cutoff check there were also zero post-cutoff trips, zero completed post-cutoff trips, and zero post-cutoff reviewed payments. Therefore no eligible event occurred while runtime was incapable of SHADOW posting, and activation itself generated no finance.

### Historical payment, legacy authority, and invariants

Historical request `e7e165ee-48e1-407b-afac-bf051f9cd080` remains approved for R104.60 with `reviewed_at = 2026-09-06 12:53:20.282831+00`. It still has zero Phase 2 transactions and zero shadow effects. It was not replayed, no notification was sent, and no debt or credit changed.

Legacy remains authoritative. Phase 2's 15% and R50 results are observational only, subscriptions remain required and authoritative, customer pricing and Driver dispatch/offer eligibility were not changed, no opening balance or historical backfill ran, and no artificial production trip or payment was created.

Post-cutoff invariant results were all zero: unbalanced transactions, orphan ledger entries, forbidden duplicate financial sources, invalid reversals, duplicate opening balances, partial finalized transactions, and recovered shadow events left unresolved.

### Portal and log checks

- Customer: HTTP 200
- Driver: HTTP 200
- Admin: HTTP 200
- Unauthenticated Admin payment-review API: HTTP 401
- Unauthenticated Driver API: HTTP 401
- Initial production deployment logs contained only the expected smoke traffic and no error/fatal, HTTP 402, cutoff, RPC, payment loop, trip shadow, authorization, or notification-duplication error.

### Rollback decision and monitoring

No verification failure or stop condition occurred, so rollback was not performed. The previous application deployment `dpl_2tZbsRFZ3t92gzgeboXqDhYY18Ng` remains the immediate application rollback target. Because the cutoff is now immutable, any later stop must use the reviewed SHADOW OFF procedure, preserve evidence, and must not rewrite, delete, or backdate `effective_from`.

Continue daily quota and reconciliation checks, inspect every natural post-cutoff trip during the first observation window, and retain the immediate OFF response for any duplicate, imbalance, orphan, negative debt, persistent missing effect, unexplained variance, HTTP 402/restriction, or legacy regression. No AUTHORITATIVE, Yoco, or Phase 3 action is authorized.

### Coordinated activation verdict

PHASE 2 SHADOW ACTIVATION COMPLETE

PHASE 2 SHADOW IS LIVE — LEGACY REMAINS AUTHORITATIVE

READY FOR LIVE SHADOW OBSERVATION
