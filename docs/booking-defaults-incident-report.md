# MOOVU urgent booking defaults incident

## Verdict
Root cause verified against production schema and deployed function. Local application fix and review-only forward migration prepared. Production is NOT fixed by these local changes; no SQL, deployment, test trip, notification or deletion was executed.

## Root cause and exact failing SQL
Customer POST /api/customer/book-trip uses phase5_create_trip when Phase 5 policy is active. The API omitted offer_attempted_driver_ids. The RPC used:

```sql
insert into public.trips
select (jsonb_populate_record(null::public.trips,p_trip_payload)).*
returning * into created;
```

jsonb_populate_record with a NULL base produces NULL for every omitted field. Expanding the entire record supplies all columns explicitly, so PostgreSQL defaults cannot run.

Production column is uuid[], NOT NULL, DEFAULT '{}'::uuid[]. The default is present and correct. No existing NULL rows were found. This is not a missing-default migration or a legitimate nullable state.

Other omitted NOT NULL fields with defaults include issue_reported, cancellation_fee_amount, dispatch_priority_score and completed_without_end_otp. A read-only SELECT reproduced NULL for issue_reported and cancellation_fee_amount even with an explicit empty attempted-driver array. Fixing only the first array error would therefore cause the next constraint violation.

## Why it started
docs/phase-5-atomic-operations.sql contains the full-row INSERT. Production migration history contains phase5_atomic_operations version 20260915091328 and phase5_owner_policy_activation version 20260915091746. The new atomic Phase 5 path made the previously unused faulty INSERT reachable. These are migration version identifiers, not independently verified incident timestamps. Phase 5 files are currently untracked locally, so a precise introducing Git commit cannot be established from local history.

## Local changes
- src/app/api/customer/book-trip/route.ts: initialize attempted-driver IDs to [], retain existing financial/dispatch flow, keep database diagnostics server-side, return safe generic failures, and map Phase 5 quote races to a safe 409 response.
- docs/phase-5-booking-defaults-fix.sql: new forward repair of only the existing RPC INSERT. It guards the exact signature and original statement, is replay-safe, uses identifiers from pg_attribute with %I escaping, binds JSON as $1, and inserts only supplied columns. Omitted fields then receive existing PostgreSQL defaults. Missing or explicit JSON-null attempted IDs normalize to [].
- src/lib/reliability/phase5BookingDefaults.test.ts: four static regression contracts.
- src/lib/finance/phase5MigrationContract.test.ts: validate the repaired insertion contract instead of enshrining the old full-row INSERT.
- docs/phase-5-booking-defaults-validation.sql: rollback-only temporary-table SQL mechanism tests for omitted/defaulted values, explicit null, explicit values and retained NOT NULL protection.

The originally applied migration is not edited. The forward file is a review artifact under docs, matching the current repository migration workflow; it has not been recorded in remote migration history.

## Validation
- npm test: 208 passed, 0 failed.
- npx tsc --noEmit: passed.
- npm run lint: 0 errors, 3 existing warnings in documentation/report-template and Admin layout.
- npm run build: passed.
- git diff --check: passed, with existing line-ending notices.
- Production read-only schema/function inspection: passed.
- Read-only jsonb_populate_record differential demonstration: confirmed adjacent omitted-column NULLs.
- Connected migration execution and temporary-table SQL tests: NOT RUN. No local PostgreSQL/psql or Docker command was available; no remote write approval was given.
- Real booking, first offer, retry/expiry, debt threshold boundaries, active-trip completion, commission/ledger and cancellation E2E: NOT RUN. Existing local tests passed but do not prove these live database paths.

## Database and dispatch impact
Only phase5_create_trip's INSERT is changed by the proposed migration. No column type/default/NOT NULL, FK, RLS, grant, row, policy, ledger, commission or payment rule is changed. CREATE OR REPLACE retains the function identity and existing permissions. The service-role guard, Customer lock, replay check, debt check, pricing/credit math, redemptions, posting and audit remain unchanged.

New trip attempted-driver IDs represent zero attempted Drivers. Existing array values and offer retry/expiry behavior are untouched. No existing NULL rows need backfill based on the inspected production count. Failed INSERTs should roll back RPC work; partial credit consumption was not inferred or repaired.

## Exact release sequence - approval required
1. Approve disposable validation of the reviewed forward SQL on the intended project. Capture its current phase5_create_trip definition and grants first.
2. Apply docs/phase-5-booking-defaults-fix.sql there and run docs/phase-5-booking-defaults-validation.sql. Run authenticated disposable booking/dispatch and financial regression tests; verify no subscription requirement or changed commission basis.
3. Review the production function definition for drift. The repair fails closed if the original INSERT no longer matches.
4. Obtain explicit approval to apply this named migration to production project mvazbszenqahgqpznhhq. Scope: one function INSERT, no existing-row backfill and no constraint change. Capture pg_get_functiondef and routine grants as the rollback baseline. Record through the project's migration tooling, not a database reset.
5. Apply only this repair; verify the function contains phase5-booking-defaults-v1, grants/service-role protection are unchanged, defaults remain intact, and no NULL rows exist.
6. Separately approve and deploy the scoped application error/payload change to the verified MOOVU Vercel project. The SQL repair is backward compatible with the existing API and is the essential outage fix.
7. Owner/authorized tester makes an ordinary real booking; verify its default fields, first eligible offer, debt restrictions, completion, commission and notifications. Do not manufacture production fixtures.
8. Monitor booking constraint failures and quote-race responses without logging full trip records or tokens.

## Rollback
The migration transaction aborts fully on preflight or CREATE OR REPLACE failure. It is re-runnable. Retain the exact pre-change function definition and grants before deployment. Reinstalling the known faulty function would reintroduce the booking outage, so prefer a scoped roll-forward if verification fails. An app-only rollback does not repair the database function. Do not reverse Phase 5 economics or weaken constraints as a workaround.

## Other supplied document
The deletion request explicitly says audit first and STOP before implementation. docs/deletion-foreign-key-audit.md contains all 117 public-schema FK relationships and conservative review classifications. No deletion behavior or FK has been changed. Its semantic retention/orphan validation is still incomplete and requires review before implementation.

## Final gate
Local preparation complete, production recovery pending. Approve disposable connected validation first, then the named one-function production migration and scoped deployment separately.

## Disposable follow-up - 16 SEP 2026 (supersedes the preceding current-status gate)
Approved disposable testing has now run. See docs/booking-defaults-release-candidate-report.md and
docs/booking-defaults-disposable-evidence.json. Default repair passes with a complete actor fixture;
HTTP harness: 25 pass, 2 fail. Full suite: 208 pass, TypeScript/build pass, lint 0 errors/3 existing warnings.
Production remained read-only. Additional blockers prevent production approval: all 1,213 active
Customer Auth IDs lack the profiles row required by trips.created_by's validated FK; the positive
disposable fixture masked that because it created a profile and disposable lacks the FK. Dispatch also
retains an unconditional subscription gate; the legacy attempted array stays empty despite canonical
offer-history tracking. The existing Phase 2 trigger correctly blocks new work at/above R50.
Final status NOT_READY. The one-function repair alone is not sufficient to restore production booking.
Do not change deletion FKs or mutate production without a reviewed, explicitly approved follow-up.
