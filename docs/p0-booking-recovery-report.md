# P0 booking recovery report

P0 BOOKING RECOVERY STATUS: **NOT_READY**

Repository: `D:\Users\KN Mudau\Desktop\Websites\moovu-kasi-rides-redesign`.

Scope: local P0 repair, disposable PostgreSQL validation, and production read-only inspection. Production project `mvazbszenqahgqpznhhq` was not mutated. Disposable project: `tangtlmdpnvmoviwrgvd`. No commit, push, deployment, production customer backfill, or production migration was performed.

## Release blocker

Concurrent work introduced Phase 6 onboarding checks in dispatch candidates and offer acceptance. `src/lib/drivers/phase6NewWork.ts` calls `phase6_new_work_eligible` and fails closed if unavailable. Production read-only inspection returned NULL for both `to_regprocedure('public.phase6_new_work_eligible(uuid)')` and `to_regclass('public.phase6_policy')`. The disposable RPC became available during validation and returned true with its policy inactive.

This is material source/database drift. The current dirty working tree must not be deployed as a P0 recovery. Onboarding production installation is outside this contract. Those changes were preserved; no eligibility bypass was introduced. Isolate an approved P0 candidate without reverting the user's working tree, or separately approve and validate the onboarding rollout. Then rerun the complete connected suite and final production preflight.

## 1. Booking RPC root cause and fix

`phase5_create_trip` inserted a complete JSON-derived composite row. Omitted properties became explicit NULL, preventing database defaults. The forward repair inserts only provided, catalog-validated columns using quoted identifiers and bound JSON values. Omitted fields retain their defaults; the required legacy attempt array is initialized safely. Signature, grants, security mode, protected search path, pricing and financial authority are preserved. No NOT NULL constraint was removed.

## 2. Customer identity root cause and fix

`trips.created_by` references `profiles.id`, which is canonical Auth UUID. Auth-backed customers without a profile could not book. The guarded repair derives missing customer profiles from existing Auth-backed customer records, uses the real Auth UUID and explicit least-privileged `customer` role, and never overwrites an existing profile. It expands the exact role constraint without changing its existing default or staff roles. Auth users are not recreated and replacement UUIDs are not generated.

## 3. Identity reconciliation counts

Production read-only snapshot at 2026-09-16 19:08:47 UTC: 1,214 customers, 1,214 active, 1,214 missing profiles, zero orphan Auth mappings and zero duplicate Auth mappings. The earlier 1,213 count changed naturally during live use. Separate inspection found zero ambiguous collisions and one unambiguous customer/driver Auth link; existing driver identity remains unchanged. Counts must be refreshed before any approved production repair. Latest disposable assertion: zero missing customer profiles.

## 4. Future signup prevention

An atomic AFTER INSERT / UPDATE OF auth_user_id customer trigger creates the canonical profile with conflict-safe insertion. New signup, legacy repair, repeat repair, concurrent customer upserts and existing-profile preservation were tested. The private SECURITY DEFINER trigger function has an empty search path, fully qualified tables and no public/client execute grant. No unfinished OAuth path was activated.

## 5. Dispatch subscription root cause and fix

`reserve_trip_offer` still independently required a subscription and checked obsolete legacy wallet rules. The guarded replacement reuses `phase2_finance_eligibility` instead. The heartbeat's independent subscription gate was also removed only for effective AUTHORITATIVE policy; OFF/SHADOW behavior remains. Stale/missing GPS, approval, online, class, atomic reservation and other eligibility guards remain. XL requires the existing seven-total-seat class for six passengers; five/six-seat review cases remain Go-only.

## 6. Eligibility matrix

| Case | Connected result |
| --- | --- |
| Approved, online, correct class, no subscription, R0 debt | Eligible |
| Same, R49.99 debt | Eligible |
| Same, R50 debt | Blocked from new work |
| Same, R100 debt | Blocked from new work |
| Suspended/rejected, R0 debt | Blocked |
| Offline, R0 debt | Blocked |
| Wrong class, R0 debt | Blocked |

These matrix checks passed in the latest full run. They do not override the unresolved final dispatch-suite/schema parity gate.

## 7. Attempt tracking root cause and fix

The legacy array remained empty while the canonical offer history recorded attempts. Application selection and Admin attempt counts now read canonical history, including paginated records beyond the first 1,000. Untried eligible drivers are prioritized before expired attempts from explicitly earlier cycles. Declined, accepted, cancelled, active or unknown-cycle attempts are excluded. Read failures fail closed. Reservation also rejects an already attempted driver in the same/newer cycle. No unsafe dual write was added.

## 8. Authoritative attempt source

Canonical offer records, not `trips.offer_attempted_driver_ids`, are authoritative. The legacy column remains present with a non-null empty-array default for schema compatibility. Admin counts distinct attempted drivers rather than the legacy array length. The existing timers are preserved.

## 9. Authenticated booking E2E

Real HTTP customer signup/login and Cash/Transfer Go and XL booking passed against disposable Supabase in the latest full run. No direct SQL trip insert substituted for this flow. `created_by` is canonical, all actual NOT NULL trip columns passed assertions, fares were server-calculated and booking replay reused the stored OTPs and trip. Three concurrent booking replays also passed in the latest extended run.

## 10. Dispatch E2E

Subscription-free dispatch succeeded for the representative Go and XL rides. However, the latest full suite failed `Connected candidate cap remains 25`, `Expiry advances to untried candidate rather than repeating previous batch`, and `All connected sections reached`. Concurrent Phase 6 source/database installation made its new required RPC unavailable during those tests. The earlier full run passed 81 checks, but is historical evidence only and is not proof of the final candidate.

## 11. Acceptance and lifecycle E2E

Go and XL passed real Driver acceptance, heartbeat, arrival, Start OTP, minimum-duration protection and End OTP/completion. GPS coordinates were test inputs to the real heartbeat path; physical-device GPS was not tested. Actual required minimum elapsed time was observed, not backdated in SQL. Extended tests proved concurrent acceptance gives one winner, cancels the other offer and creates no premature commission.

## 12. Commission verification

Current authoritative commission is 15% for Go and XL, unchanged by this repair. Go trip `836a0dc8-8590-4da2-abdb-b2bfbd798297`: customer fare R55, existing commission basis R52, commission R7.80, Driver net R44.20. XL trip `73e9d210-58e8-4328-b863-979754957a84`: fare R79, basis R74, commission R11.10, Driver net R62.90. Existing R3/R5 service fees remain outside the commission basis. No commission occurred merely at booking, offer, acceptance or start. Completion created one existing-policy obligation; replay created no extra transaction.

## 13. R50 verification

R49.99 was eligible; R50 and above were blocked from new work. A Driver whose debt reached R50 after starting XL still completed the active ride correctly. Heartbeat does not become an additional new-work reservation gate. No commission percentage, debt threshold or subscription policy was changed.

## 14. Ledger verification

Latest disposable SQL assertions: zero unbalanced POSTED transactions and zero duplicate trip commission source keys. Both representative completed trips have commission_pct=15. Source keys remain `trip_commission:${tripId}`. No new finance posting system, debt duplication or financial data reversal was introduced.

## 15. Security and RLS

Latest extended run passed unauthenticated booking denial, customer profile RLS, inability to promote a customer to staff, and denial of trusted booking/reservation/acceptance/expiry RPCs to anonymous/customer clients. Existing service-role-only grants and protected function paths were inspected. Customers cannot create trips under another customer's identity. Reservation and acceptance race checks use real PostgreSQL and authenticated HTTP, not mocks.

## 16. Customer-safe errors

Signup, profile persistence and booking dispatch failures retain generic customer-safe responses with detailed diagnostics server-side. An invalid scheduled-status failure produced a safe HTTP 500 while SQLSTATE 23514 remained server-side. Raw PostgreSQL/function/constraint messages are not returned by the repaired paths. No partial fallback was introduced to bypass hardened operations.

## 17. Automated tests

Latest full automated suite: 223 passed, zero failed, zero skipped. P0 additions include attempt-history fairness/pagination/error tests and recovery contract tests. Concurrent onboarding work also added tests; the total is not solely attributable to P0. Passing offline tests do not resolve connected failures.

## 18. Connected test counts

| Evidence artifact | Run | Passed | Failed | Interpretation |
| --- | --- | --- | --- | --- |
| p0-booking-recovery-previous-connected-evidence.json | aa5404e9 | 81 | 0 | Earlier candidate, historical only |
| p0-booking-recovery-connected-evidence.json | 76c60e7c | 74 | 3 | Latest full run; NOT_READY |
| p0-booking-recovery-extended-evidence.json | 8ad1f109 | 24 | 0 | Latest extended security/race/class tests |

Extended success must not be used to silently mark the three full-suite failures passed. Test Drivers were left offline and the isolated test server was stopped.

## 19. TypeScript

`npx tsc --noEmit`: passed after the final build and after the disposable test server stopped. Earlier transient generated-development-types errors during concurrent server writes were not treated as source proof; the final command completed successfully.

## 20. Lint

`npm run lint`: zero errors, four warnings in the latest check. Warnings concern the product-spec template, Admin layout and concurrently added onboarding page. Lint is not entirely warning-free.

## 21. Production build

`npm run build`: passed, 186 generated pages in the latest working tree. `git diff --check`: passed; Git emitted line-ending conversion notices. Build success is not production source/schema parity evidence.

## 22. SQL artifacts and SHA-256

`p0-recovery-artifact-manifest.json` records exact SHA-256 hashes of eight review artifacts and the production read-only snapshot. `p0-production-recovery.sql` is an atomic identity + booking + dispatch bundle, not a production instruction to execute now. Forward component files and rollback files are separately included. Existing applied migration files were not rewritten.

Disposable-only artifacts: `p0-disposable-identity-parity.sql`, `p0-disposable-rollback-validation.sql`, and `p0-disposable-identity-first-install-validation.sql`. Exact final repairs, repeat application, fresh identity installation and rollback/reapply validation passed on disposable. Historical NOT VALID constraints enforce new rows while retaining disposable history. Deletion-FK differences were left untouched and are outside P0.

Function definition guards normalize CRLF before MD5 comparison. Booking baseline/repaired hashes: `34d6dd39fac1d8cb1575a14b95eb3f74` / `8e48e78ccab84188e8e20f4f1febf1bb`. Reservation baseline/final repaired hashes: `052109bd24d19fe0bb46aa67c73366a6` / `ee6b010e2923ba3d39d2c90eb76ab337`.

## 23. Application files changed by P0

- src/lib/dispatch/attemptHistory.ts
- src/lib/dispatch/attemptHistory.test.ts
- src/lib/dispatch/dispatchCandidates.ts
- src/lib/dispatch/dispatchTrip.ts
- src/app/api/admin/dispatch/board/route.ts
- src/lib/customer/server.ts
- src/app/api/customer/register/route.ts
- src/app/api/customer/book-trip/route.ts
- src/app/api/driver/heartbeat/route.ts
- src/lib/reliability/p0BookingRecovery.test.ts
- scripts/p0-booking-recovery-e2e.mjs

Review artifacts are listed in sections 18 and 22, plus this report and final DB evidence. The tree already contains extensive unrelated modifications. Concurrent Phase 6 edits in shared files were preserved. Do not bulk-stage or deploy the entire tree from this file list.

## 24. Production read-only preflight

The read-only baseline snapshot matched vulnerable booking/reservation definitions, expected defaults, canonical FK, offer-history columns, effective AUTHORITATIVE 1,500 basis points for each class, R50 (5,000 cents) limit and subscription_required=false. Lifecycle/expiry/finance authority definitions matched inspected disposable versions. No production changes were made.

This snapshot is not a final release preflight: the latest full suite failed and new Phase 6 dependencies are absent from production. The provided preflight artifact checks the P0 baseline, not every concurrently introduced dependency. A fresh candidate-specific dependency check and full preflight are required after source isolation. Any unexpected schema/function change is a stop condition, not permission to modify the guard.

## 25. Production recovery sequence: BLOCKED

There is no authorized executable production recovery sequence at this status. The following is a review-only dependency order for a later approval package:

| Gate | Artifact/action | Expected evidence | Stop / recovery action |
| --- | --- | --- | --- |
| Candidate isolation | Freeze reviewed P0 source without reverting concurrent work | No new uninstalled onboarding dependency; exact source hashes | Stop if isolation changes existing approved behavior |
| Disposable final suite | Run full and extended p0-booking-recovery-e2e.mjs plus tests/tsc/lint/build | Entire final candidate passes, no skipped connected gate | Fix locally and repeat; no production action |
| Fresh read-only preflight | p0-production-readonly-preflight.sql plus complete candidate dependency catalog | Expected baseline hashes, zero collisions, current repair count, policy unchanged | Stop on any drift; re-audit package |
| Explicit approval | Present frozen source and hashed SQL to Owner | Production SQL and release specifically approved | No mutation without approval |
| Atomic SQL recovery | p0-production-recovery.sql, only after approval | COMMIT of all three guarded repairs | Guard/error rolls back transaction; diagnose, do not bypass |
| SQL postflight | Queries below | Missing profiles=0; final RPC hashes; policy unchanged | Halt application release if any mismatch |
| Scoped application release | Approved candidate to Vercel moovu-app only | Exact approved source deployed, no unrelated rollout | Use approved previous release only if compatible with repaired DB; prefer roll-forward |
| Controlled pilot | Approved real customer + Driver ride with Go/XL and financial checks | Booking, dispatch, OTP, completion, exactly-once 15% posting | Halt pilot/new release on lifecycle, identity or ledger failure |

Review-only postflight queries:

```sql
select count(*) as missing_profiles
from public.customers c
join auth.users u on u.id=c.auth_user_id
left join public.profiles p on p.id=c.auth_user_id
where p.id is null;

select p.proname,
       md5(replace(pg_get_functiondef(p.oid),chr(13),'')) as normalized_hash
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('phase5_create_trip','reserve_trip_offer');

select to_regprocedure('public.phase6_new_work_eligible(uuid)') as onboarding_rpc,
       to_regclass('public.phase6_policy') as onboarding_policy;
```

Refresh the full finance-policy and grant assertions from the read-only preflight; do not infer policy from these three queries alone. Native push delivery and physical GPS require their separate device gates.

## 26. Rollback plan

Final rollback/reapply and first-install checks passed in disposable transactions, with existing profile/trip/financial-record checksums unchanged. Function guards must still match at execution time. Recovery SQL failures before COMMIT roll back atomically.

After an approved production COMMIT, rollback is not routine: booking-default and dispatch rollback artifacts deliberately restore known outage behavior. Prefer a guarded roll-forward correction. If a separately approved emergency rollback is necessary, restore reservation and booking definitions with their exact artifacts and remove only the identity creation trigger via its rollback artifact. Retain repaired customer profiles, the customer role allowance and private function so already-created trips remain FK-valid. Do not delete Auth users, profiles, trips, commission entries or reverse money as a schema rollback. No rollback artifact was executed on production.

## 27. Remaining risks and next gate

Primary blocker: Phase 6 fail-closed dispatch dependency is absent from production and the latest complete dispatch test suite failed. Secondary risks: mixed/uncommitted source makes release attribution unsafe; active production data can change preflight counts; disposable retains historical constraint/FK differences outside this incident. Notification credentials were intentionally blanked in the harness to prevent production outbound sends. Actual phone notification delivery, native app packaging and physical GPS were not proven here. This is not an App Store / Play Store readiness report.

Next gate: approve isolation of the P0 candidate from concurrent onboarding work, preserve the user's original tree, then rerun the complete frozen-candidate validation. Do not run production SQL, push or deploy this package yet.
