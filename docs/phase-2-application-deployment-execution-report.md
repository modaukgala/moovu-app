# Phase 2 application deployment execution report

Execution date: 11 September 2026  
Repository: `D:\Users\KN Mudau\Desktop\Websites\moovu-kasi-rides-redesign`  
Production Supabase: `mvazbszenqahgqpznhhq`  
Production Vercel project: `moovu-app`  
Required operating mode: Phase 2 OFF

## Final result

The exact reviewed Phase 2 application package was deployed successfully to
production. The deployment reached READY and all production aliases, including
`https://moovurides.co.za`, point to it. Phase 2 remains fully OFF. The
deployment did not run SQL, change environment variables, send notifications,
package mobile binaries, commit, or push.

## Repository state

- Branch: `main`
- HEAD used as the release base: `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`
- Existing modified and untracked work was preserved.
- No reset, clean, stash, revert, commit, or push was performed.
- `git diff --check`: PASS; line-ending warnings only.
- The Phase 2 migration SHA-256 remained
  `cdf1bed0e09c6b431691eed32e45d49e09351abfc464206e9a6404bc965b11be`.

## Deployed file scope

The release was assembled in an isolated temporary directory from the HEAD
archive plus the 61 changed `src/**` files reviewed in
`docs/phase-2-application-deployment-review.md` (32 tracked modifications and
29 untracked runtime/test files). Source-to-package SHA-256 comparison passed
for all 61 overlay files. The release manifest SHA-256 was
`418b5b68c41edb63112efa987b1e2de7ae302bdd7262f5b4f5ff6e330780f083`.

This included the direct Phase 2 runtime, hardened RPC and notification
prerequisites, and the previously reviewed Phase 0/0.5 runtime changes present
in the validated build. Local logs, documentation generation output,
disposable SQL, reset/fixture scripts, and local `.next` output were excluded
from the deployment package. No migration file was executed.

## Pre-deployment validation

| Check | Result |
|---|---|
| Full direct Node suite | PASS, 36 files / 165 tests |
| Focused Phase 2 recovery/security suite | PASS, 18/18 tests |
| TypeScript `npx tsc --noEmit` | PASS |
| ESLint `npm run lint` | PASS, 0 errors / 3 existing warnings |
| Local production build | PASS, 171/171 pages |
| Vercel production build | PASS, 171/171 pages |
| `git diff --check` | PASS; line-ending warnings only |
| Credential scan | PASS, 123 changed/untracked files, 0 candidate lines |

The existing ESLint warnings are one unused variable in the Admin protected
layout and two unused variables in the product-spec report generator. They did
not regress from the approved baseline.

## Supabase health and quota

Immediately before deployment, the production project reported:

- Status: Healthy
- Compute: nano
- CPU: 4%
- Disk: 4%
- RAM: 54%
- Database connections: 7/60
- Advisor: no security, performance, or health issues
- Current billing cycle: 22 August 2026 through 22 September 2026
- Current organization egress: 2.001/5 GB (40%)
- Current egress overage: 0 GB
- Database size: 0.073/0.5 GB (15%)
- Storage size: 0.677/1 GB (68%)

The organization banner still records that egress exceeded quota in the
previous billing cycle and that the grace period ends on 19 September 2026.
The organization was not over its current egress quota, the project was not
paused or read-only, and requests were not returning restriction-related HTTP
402 responses. This warning did not block this deployment.

## Production database compatibility before deployment

A SELECT-only verification at `2026-09-11 05:12:46.06867+00` confirmed:

- Phase 2 tables: 3
- Phase 2 trip columns: 4
- Phase 2 functions: 9
- Database policy mode: OFF
- Effective date: NULL
- Subscription required: true
- Financial accounts: 0
- Financial transactions: 0
- Financial ledger entries: 0
- Shadow reconciliation rows: 0

The application contract therefore matched the installed production schema.

## Production configuration

The existing encrypted Supabase, Maps, push, and Firebase variable names were
present. No value was displayed or changed.

- `MOOVU_PHASE2_FINANCE_MODE`: absent; application resolves safely to OFF
- `PHASE05_OUTBOX_ENABLED`: absent; outbox delivery remains disabled
- `OUTBOX_JOB_SECRET`: absent; the outbox worker fails closed
- SHADOW: OFF
- AUTHORITATIVE: OFF

No Vercel environment, domain, or project setting was modified.

## Deployment

- Deployment ID: `dpl_G34Qh4vHNeECgevMM1GmA1CYCeso`
- Created: 11 September 2026 at 07:16:40 SAST
- Deployment URL: `https://moovu-erzf5f3r8-kgalaletsos-projects.vercel.app`
- Primary production URL: `https://moovurides.co.za`
- Target: production
- Status: READY
- Build source: HEAD `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`
  plus the verified 61-file reviewed source overlay
- Previous rollback deployment: `dpl_D4p7gQM7RqqTVtPMqPaw7wf8Rbyc`

## Public smoke checks

| Surface | Result |
|---|---|
| Customer home | HTTP 200; rendered booking entry surface |
| Customer authentication | HTTP 200 |
| Driver portal | HTTP 200; rendered Driver sign-in surface |
| Driver login | HTTP 200 |
| Admin portal | HTTP 200; rendered Admin sign-in surface |
| Admin login | HTTP 200 |
| Public surge API | HTTP 200 |
| Customer protected API without session | Expected HTTP 401 |
| Driver protected API without session | Expected HTTP 401 |
| Admin protected API without session | Expected HTTP 401 |

No smoke request created a trip, payment, ledger entry, subscription change, or
notification.

## Authenticated smoke checks

No authenticated MOOVU session or production account credential was available
in the controlled browser session. The deployment was therefore not used to
sign in or manufacture activity. The protected surfaces were verified to route
to their sign-in pages, and protected APIs rejected unauthenticated requests.

Normal eligibility remains governed by the legacy subscription and wallet
rules because both application and database modes are OFF. The 165-test suite,
the focused OFF-mode recovery suite, the production database policy, and the
post-deployment ledger check provide non-mutating evidence for this behavior.

## Phase 2 and legacy behavior confirmation

- Phase 2 application mode: OFF by safe absent-variable default
- Phase 2 database mode: OFF
- SHADOW: OFF
- AUTHORITATIVE: OFF
- 15% commission: not active
- R50 restriction: not active
- Subscription requirement: unchanged and true
- Opening balances: not posted
- Phase 2 ledger posting: inactive
- Existing legacy Go 10% and Go XL 12% behavior remains authoritative

No live trip was created solely to test commission behavior.

## Ledger dormancy after deployment

A SELECT-only check at `2026-09-11 05:19:45.467755+00` confirmed:

- Database policy mode: OFF
- Effective date: NULL
- Subscription required: true
- Financial accounts: 0
- Financial transactions: 0
- Financial ledger entries: 0
- Shadow reconciliation rows: 0

The deployment created no Phase 2 financial activity.

## Immediate error and log review

The first 500 post-deployment Vercel log events showed:

- HTTP 5xx responses: 0
- Error or fatal log events: 0
- Phase 2/RPC/configuration error matches: 0
- Repeated retry-loop evidence: 0

The log sample contained 30 HTTP 404 events caused by repeated Admin-domain
requests for `/contact`, `/privacy-policy`, and `/terms`. These footer routes
exist on the customer domain but are not mapped on the Admin subdomain. This is
an existing routing issue outside the Phase 2 deployment path. Admin sign-in
and the protected Admin entry route both returned HTTP 200, so rollback was not
required.

## Blockers and warnings

There is no Phase 2 deployment blocker. Two follow-up items remain:

1. Monitor current-cycle Supabase egress before the 19 September grace-period
   deadline; current use is 40% with no overage.
2. Correct the Admin footer domain routing in a separately reviewed change.

Authenticated role-flow verification remains a later manual operational check
with owner-controlled accounts. It must not be performed by inventing payments
or financial activity.

## Rollback position

No rollback is required. If a later production regression is attributed to
this release, redeploy or roll back to the previous Ready deployment
`dpl_D4p7gQM7RqqTVtPMqPaw7wf8Rbyc`. The additive Phase 2 schema may remain
installed with policy OFF; no SQL rollback is needed.

## Final recommendation

Keep Phase 2 OFF and proceed only to a separate Phase 2 SHADOW activation
review. Do not enable SHADOW or AUTHORITATIVE, activate 15% or R50 rules, remove
subscription eligibility, create opening balances, start Yoco, or start Phase
3 under this deployment approval.

PHASE 2 APPLICATION DEPLOYMENT COMPLETE

READY FOR PHASE 2 SHADOW ACTIVATION REVIEW
