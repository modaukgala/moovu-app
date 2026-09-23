# MOOVU Phase 2 Commission and Driver Finance Implementation Report

## Latest result: 2026-09-10

The resumed Phase 2 payment recovery path is validated locally and against the
disposable database. Trip-completion shadow recovery was also corrected without
changing OFF behavior or duplicating notifications. Disposable testing then
found and corrected two SQL defects: reuse of existing Phase 1 account identities,
and SHA-256 resolution under the fixed search path. Phase 1 architecture and
historical accounts were preserved.

Final migration SHA-256:
`cdf1bed0e09c6b431691eed32e45d49e09351abfc464206e9a6404bc965b11be`.
This complete package was installed from a verified clean pre-Phase-2 baseline
in `tangtlmdpnvmoviwrgvd`, followed by a passing nine-function security gate,
44 live financial assertions, overlapping independent-session payment recovery,
and all 11 global invariants at zero violations. The two security fixes remain
intact; denied calls made zero financial mutation.

Local suite: 36 files / 165 tests passed. Application TypeScript, lint and build
passed; lint retains three existing warnings, build generated 171 pages. Final
TypeScript and focused lint passed after the SQL-only corrections. The credential
scan found zero candidates across 103 changed/untracked source and documentation
files, and `git diff --check` passed. Detailed timestamps, SQL artifacts, fixture
identities and limitations are
in `docs/phase-2-disposable-validation-report.md`.

The disposable policy is restored to OFF with no effective cutoff. Two synthetic
payment fixtures remain there as audit evidence. Production was not accessed or
changed; there was no commit, push, deployment, AUTHORITATIVE activation, Yoco
integration or external notification send. This result does not authorize a
production release or replace authenticated/device testing and cutover review.

PHASE 2 IMPLEMENTATION AND DISPOSABLE VALIDATION PASSED

READY FOR PHASE 2 PRODUCTION REVIEW

## Current continuation: 2026-09-09

Repository recovery confirmed that the payment-review SHADOW retry fix and its
runtime route tests were already present. Approved legacy replays now attempt
the same idempotent financial posting while notification deduplication remains
separate. This continuation improved the test coverage for null/missing roles
and the R50 restoration assertion, and corrected route indentation.

The same replay gap was found and corrected in trip completion: SHADOW recovery
now requires the existing authorized completion replay, preserves the completed
trip response and notification guards, and catches post-commit transport errors.
Four actual-service tests cover this additional Phase 2 correction. The full
suite and TypeScript passed again after that correction.

Current local result: 36 test files / 163 tests passed; 26 focused Phase 2 tests
passed; TypeScript passed. Full lint passed with three existing warnings;
focused lint for the added trip files, build completion and disposable evidence
are pending. Migration SHA-256 remains
`8d0ed689c7425eb2aa3aeee19890b2e1a5f5cba04f7644026cf1f6045390d76f`.
Both previous security fixes remain present. Effective PostgreSQL permissions,
zero-mutation authorization, concurrent posting and global invariants are not
proven by mocks/static tests. See the latest entry in the existing disposable
validation report for recovered state, changed files, limitations and next gate.

Production was not accessed or changed in this continuation; no commit, push,
deployment or flag activation occurred. Historical results below are retained.

Date: 2026-09-07  
Status: local preparation implemented; disposable database execution blocked by connection targeting  
Production ref: `mvazbszenqahgqpznhhq` (unchanged)  
Approved disposable ref: `tangtlmdpnvmoviwrgvd`

## Implemented locally

- One server-side Phase 2 mode contract: `OFF`, `SHADOW`, `AUTHORITATIVE`; an unset or invalid value fails safely to `OFF`.
- One approved future commission policy: Go and Go XL at 1,500 basis points (15%).
- Integer-cent, half-up commission calculation with exact R50 (5,000 cent) restriction and R40 warning boundaries.
- Subscription eligibility remains required in `OFF` and `SHADOW`; it is removed only in a separately approved `AUTHORITATIVE` cutover.
- Cash/transfer journal design posts only Driver commission debt against MOOVU commission revenue. It never represents the gross passenger fare as MOOVU cash.
- Driver payment allocation applies verified money to debt first and preserves excess as a separate unapplied Driver credit.
- A Phase 2 RPC caller fails closed for missing, failed, or incompatible database contracts and performs no sequential legacy fallback.
- Additive SQL creates an OFF policy, immutable new-trip commission snapshots, finance-position RPC, shadow reconciliation table, and historical exception register.
- New Phase 2 tables and RPCs deny `public`, `anon`, and `authenticated`; trusted server execution is granted only to `service_role`.
- Historical trips are not updated, backfilled, repriced, or deleted.

## Activation boundary

The migration defaults to `OFF`. In that state it does not snapshot trips, post ledger entries, change commission rates, change the R100 legacy restriction, or remove subscription requirements. No application route has been switched to Phase 2 authority. Completion, settlement, payment review, dispatch, online/offline, and assignment continue using the current Phase 0 contracts.

Before any production cutover, the authoritative database package still needs protected atomic orchestration RPCs for completion posting, payment allocation, assignment/acceptance finance eligibility, and compatibility projection. Those operations must be disposable-tested under concurrency and must never fall back to sequential writes.

## Local validation

- 33 test files / 147 tests: passed.
- Phase 2 policy and journal tests: 7 passed.
- Phase 2 fail-closed RPC tests: 3 passed.
- TypeScript: passed after aligning bigint syntax with the repository target.
- Production build: passed, 171 static pages generated.
- Lint: must be rerun after the final lint-only comment correction.
- `git diff --check`: passed; only pre-existing line-ending warnings were reported.

## Disposable validation blocker

The available Supabase connector resolved to production ref `mvazbszenqahgqpznhhq`, not the approved disposable ref. It was not used to execute SQL. No disposable credential was present in the process environment. Therefore the migration, RLS, grants, real PostgreSQL idempotency, concurrency, rollback, shadow parity, and authenticated HTTP integration have not been proven in this pass.

The migration must not be applied to production until it passes disposable validation and receives a separate production migration review and owner approval.

## Production confirmation

No production SQL, data mutation, feature-flag change, deployment, commit, or push was performed. Production Phase 0 finance behavior remains authoritative.
# Disposable Validation Status

Latest continuation: null actor identity and null profile role are explicitly
rejected by the local payment RPC before financial work. Candidate SHA-256:
`8d0ed689c7425eb2aa3aeee19890b2e1a5f5cba04f7644026cf1f6045390d76f`.
The trigger revocation fix remains present. Targeted tests (18) and the offline
suite (152) passed before adding a recovery regression that now fails: approved
legacy payment replays suppress shadow posting, so an initial shadow failure
cannot recover through payment-review retry. Latest focused result is 5 passed,
1 failed. Validation stopped before any disposable mutation under section 14
of the owner's instructions. See the latest disposable report entry for the
trust-chain audit, exact guard, remediation, and pending live proof. Historical
entries below are retained as evidence, not the current candidate status.

2026-09-08: The two missing trigger execution revokes are corrected locally,
and all four Phase 2 contract tests pass, including a new inventory check for
client execution revocation on every Phase 2 function. Revised migration hash:
`db1afb0ca0497d90c921f93df0493c85cdd3f5f5d676fa0718e91663e72817e5`.
The corrected migration has not been executed. The broader audit found that
`phase2_post_verified_driver_payment` does not reject a NULL/missing actor role
because its `NOT IN` check evaluates to NULL. Work stopped at that additional
authorization blocker as instructed. See the dated validation report entry for
impact, remediation, and checks still pending. The older paragraph below records
the prior disposable execution, not execution of the corrected artifact.

The Phase 2 migration executed successfully on disposable project `tangtlmdpnvmoviwrgvd`, but post-migration security verification found unintended `PUBLIC EXECUTE` grants on the two Phase 2 trigger functions. Phase 2 validation is blocked until the local migration package is corrected and reapplied to a clean disposable baseline. See `docs/phase-2-disposable-validation-report.md`.
