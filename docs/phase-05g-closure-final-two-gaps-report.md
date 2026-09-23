# MOOVU Phase 0.5G closure: final two proof gaps

Status: closure evidence recorded on 2026-09-02. Production remained read-only. No commit, push, deployment, or production mutation occurred.

## A. Production RLS Matrix

Read-only metadata was captured from production ref `mvazbszenqahgqpznhhq` for all 18 Phase 0 baseline tables. The previous disposable fixture was missing production's RLS enablement on 16 tables, production ownership policies for Driver accounts/applications/profiles/offers, staff policies for profiles/drivers/trips/trip events/wallets, Customer and Driver cancellation-fee reads, notification read/update policies, and the production `is_staff()` SECURITY DEFINER/search-path contract.

Production data rows, secrets and credentials were not selected.

## B. Disposable Baseline Correction

Fixture-only changes in `docs/phase-05e-disposable-baseline.sql`:

- enabled RLS on all 18 production baseline tables;
- reproduced the production-existing policy names, commands, roles, USING clauses and WITH CHECK clauses relevant to Phase 0;
- reproduced `is_staff()` as STABLE SECURITY DEFINER with `search_path=public,auth`;
- clearly labelled the section as a production-existing, disposable-only RLS test fixture.

The hardened migrations remain separately identifiable. The only migration correction made after real JWT testing was the direct trip/audit mutation revocation described below.

## C. Final RLS Migration Result

The corrected baseline plus migrations 001 through 004 applied cleanly from a reset disposable `public` schema.

Real JWT testing initially proved that production's existing `staff manage trips` policy and broad table grants allowed Dispatcher and Support to mutate trip fare/status directly. This violated the server-only financial/trip-state contract.

`docs/phase-05d-004-retention-security.sql` now revokes INSERT, UPDATE, DELETE and TRUNCATE on `trips` and `trip_events` from `anon` and `authenticated`, while retaining existing SELECT policies and service-role access. The clean baseline and all four migrations were reapplied after this correction.

Final checks:

- every disposable public table has RLS enabled;
- Customer notification read remains available;
- direct notification mutation is blocked;
- Driver self reads remain available;
- Owner/Admin legitimate reads remain available;
- Dispatcher/Support wallet, settlement and trip mutations are blocked;
- direct applicant account-link mutation is blocked;
- service-role database privileges remain available to the authoritative server contract.

## D. Real JWT Regression

Six real GoTrue sessions were issued and used through PostgREST.

- Customer: own notification read allowed; notification insert/update and account-link insert denied.
- Driver: own driver/profile/offer reads allowed; wallet mutation denied.
- Owner: staff trip read allowed.
- Admin: staff wallet read allowed.
- Dispatcher: wallet and trip mutation denied.
- Support: settlement and trip mutation denied.

Result: 14 passed, 0 failed.

## E. Genuine Service-Role Verification

Not completed. The available Supabase connector exposes disposable publishable/anon keys but does not expose a service-role/secret key. The local repository's existing service-role JWT was decoded only far enough to verify its role/ref and belongs to production `mvazbszenqahgqpznhhq`; it was not printed, copied, or used.

No normal JWT was substituted for service role, no RLS was weakened, and no production credential was used.

## F. Real HTTP + Supabase Integration

Real disposable Auth and PostgREST role/ownership requests passed as listed above. Successful MOOVU HTTP route -> disposable service-role client -> protected RPC execution could not be run because a genuine disposable server credential was unavailable.

Therefore Applicant, Admin, Owner, Driver and Customer successful trusted-server HTTP paths remain unproved in this closure.

## G. Server-Only Security

The production service-role key remained confined to the existing local environment and was not used. No service-role secret appeared in tracked source, reports, HTTP responses, public variables, client bundles, notification payloads or test output.

## H. Fail-Closed Result

Preserved local tests prove hardened RPC failure produces controlled failure without sequential write fallback. The representative HTTP/outbox suite passed again. A genuine disposable service-role HTTP success/failure pair could not be exercised for the reason in section E.

## I. Remaining Gaps

Staging-only:

- deployed scheduler and outbox cutover;
- worker crash injection;
- FCM/Web Push/native push and deep-link delivery.

Production-smoke-only:

- post-approval role/device smoke checks after a separately approved migration.

Genuine blocker:

- successful MOOVU HTTP -> genuine disposable service-role -> protected RPC execution remains unproved.

The complete production-compatible RLS proof gap is closed.

## J. Validation

- Clean disposable baseline plus migrations: passed after final rebuild.
- Real JWT/PostgREST RLS regression: 14 passed, 0 failed.
- Targeted local HTTP/outbox/contract tests: 20 passed, 0 failed.
- Complete offline suite: 122 passed, 0 failed.
- TypeScript: passed.
- Lint: passed with 0 errors and 3 pre-existing warnings.
- Production build: passed; 171 routes/pages generated.
- `git diff --check`: passed; line-ending warnings only.

The local commands were run from a temporary exact validation copy because the current sandbox could read individual D: files but could not set D: as its process working directory. No source changes were made in the temporary copy.

## K. Repository Safety

Before and after:

- branch: `main`;
- HEAD: `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`;
- all pre-existing modified and untracked Phase 0 work was preserved;
- nothing was reset, restored, cleaned, stashed, staged, committed, pushed or deployed.

Closure changes:

- `docs/phase-05e-disposable-baseline.sql`;
- `docs/phase-05d-004-retention-security.sql`;
- `src/lib/reliability/phase05bContracts.test.ts`;
- this report.

## L. Disposable Project Cleanup

Project: `moovu-phase-05g-disposable`

Ref: `tangtlmdpnvmoviwrgvd`

Automatic project deletion is unavailable through the authorized connector. The project was paused after evidence capture. Manual deletion remains required.

## M. Final Phase 0.5 Verdict

# NOT READY FOR PRODUCTION MIGRATION REVIEW

The RLS proof gap is closed. The genuine disposable service-role HTTP execution gap remains unresolved due to connector credential limitations. Phase 0.5 is not declared complete, Phase 1 has not begun, and no production migration was applied.
