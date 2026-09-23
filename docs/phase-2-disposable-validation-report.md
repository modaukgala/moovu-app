# Phase 2 Disposable Validation Report

## 2026-09-10 Final Clean Disposable Evidence

Current migration SHA-256:
`cdf1bed0e09c6b431691eed32e45d49e09351abfc464206e9a6404bc965b11be`.
All production actions remain excluded. This continuation used the project-ID
Supabase connector and, for one overlapping session, the verified browser SQL
editor at `tangtlmdpnvmoviwrgvd`. No manual paste was needed: the complete editor
text was copied back and matched to the prepared SQL after CRLF normalization.

### Clean installation and additional defects

- Project metadata verified ref `tangtlmdpnvmoviwrgvd`, name
  `moovu-phase-05g-disposable`, PostgreSQL 17.6, ACTIVE_HEALTHY; every connector
  SQL/migration call explicitly targeted that ref, never production.
- The unused-OFF reset preserved the Phase 0/1 baseline: 7 accounts, 5
  transactions, 13 entries, 3 trips. Before each full replacement, read-only
  verification showed zero Phase 2 functions, tables and snapshot columns.
- Candidate `8d0ed689...` installed cleanly and passed security, but the first
  payment probe found SQLSTATE 23505 on `financial_accounts_owner_category_uidx`.
  Existing compatible Phase 1 platform accounts had different account codes.
  Phase 2 now resolves an existing owner/category/currency account code before
  passing it to `phase1_ensure_financial_account`, which still validates the
  full account contract. No Phase 1 code or historical accounts were modified.
- Candidate `380ffaa1...` installed cleanly and passed security, but financial
  tests found SQLSTATE 42883: unqualified `digest(bytea, text)` was unavailable
  under the fixed search path because pgcrypto is in `extensions`. The final
  package uses `pg_catalog.sha256`; a live comparison confirmed identical hashes
  to `extensions.digest`. Search paths and permissions were not widened.
- The final `cdf1bed0...` candidate was installed as a complete package only
  after another guarded reset and clean-baseline verification. Migration name:
  `phase2_commission_driver_finance_builtin_hash`. No patch-over installation is
  being counted as the final clean test.

### Security gate: PASS

All nine functions passed the effective permission matrix, including no client
execution and no service-role direct execution of the two trigger functions.
Seven server RPCs retain service-role execution. Fixed search paths passed.
Actual anon/authenticated payment calls were denied. Missing actor identity,
missing profile, empty/unknown roles, Customer, Driver, Dispatcher and Support
were rejected with unchanged fingerprints across ten finance/event tables.
`profiles.role` is NOT NULL in this baseline; a missing profile exercised the
NULL resolved-role branch without weakening the schema to manufacture a row.
Owner and Admin success, including cross-actor replay, passed the financial suite.

### Financial suite: 44 live checks PASS

`docs/phase-2-disposable-financial-validation.sql` ran in one rollback transaction.
It covered OFF no-post behavior, Go/Go XL 15% snapshots, historical preservation,
immutable snapshots, integer-cent half-up rounding, cash/direct-transfer economic
accounting, exact 4999/5000/5001 boundaries, completion crossing R50, payment
allocation, restoration, overpayment, opening-balance replay, exception-register
insertion, reversal/replay/duplicate rejection, and balancing/partial-post guards.

The payment failures were injected on the second ledger-entry insert, after the
first entry had been attempted. Both R40/R60 and R59/R10 cases left no additional
header or entry after failure, while legacy approval remained successful. Legacy
replay then recovered the shadow effect exactly once, including one settlement,
one ledger payment and one notification-outbox logical event. A second reviewer
could safely recover/replay the same source.

SHADOW correctly retains legacy subscription eligibility; an expired subscription
still blocks that authoritative decision. AUTHORITATIVE was not enabled. Its
configuration/eligibility support is structurally tested, while application
orchestration deliberately fails closed pending controlled cutover.

Parity proof distinguishes matching economics from the planned policy change:
matching 15% source fixtures reconcile exactly; a real legacy completion at 10%
versus the 15% shadow charge produces an explicit R10/R15 discrepancy. This is
expected policy divergence, not evidence of current production parity.

### Independent-session recovery and concurrency: PASS

Two committed synthetic payment fixtures reproduce loss of the process after
legacy approval commits and before shadow posting. The first attempt to run
parallel connector calls used distinct PIDs but was serialized by the connector;
its non-overlapping timestamps were correctly excluded from concurrency proof.
A rollback-only dblink connection probe required credentials; no credentials
were added and no extension remained installed.

The actual overlapping test used the browser for Session A and the connector
for Session B, with a 20-second request-row lock hold in A:

| Session | Backend PID | Start UTC | Finish UTC | Shadow outcome |
| --- | ---: | --- | --- | --- |
| A | 298249 | 2026-09-10 05:26:13.207373 | 05:26:33.241737 | Created once |
| B | 298250 | 2026-09-10 05:26:23.785266 | 05:26:33.254126 | Replayed same transaction |

Both legacy approvals returned `replayed=true`. Both shadow results identified
`e96781f5-0ba5-450b-af04-16a54c939e52`. Request:
`3a9a30fa-bce8-4aa6-8269-5ae45d8b3f96`. Subsequent replay retained exactly one
settlement, one financial transaction, three ledger entries and one notification
logical event. Final debt was 0 cents and unapplied credit 2000 cents. The other
committed fixture (`6849849c-27e5-4846-8096-c9261578249b`) had the same counts.
No push/email/SMS was sent; this proves logical notification deduplication,
not external notification delivery.

### Global invariants: all zero

The full-table read-only `docs/phase-2-disposable-invariants.sql` returned:

| Check | Violations |
| --- | ---: |
| Unbalanced transactions | 0 |
| Orphan ledger entries | 0 |
| Orphan financial transactions | 0 |
| Forbidden duplicate financial sources | 0 |
| Duplicate payment allocations | 0 |
| Duplicate unapplied credits | 0 |
| Invalid reversals | 0 |
| Duplicate opening balances | 0 |
| Partial finalized transactions | 0 |
| Contradictory terminal outcomes | 0 |
| Successfully recovered shadow reconciliation rows left unresolved | 0 |

Definitions are in the SQL artifact. ADJUSTMENT sources are external evidence
identities in the Phase 1 contract, so this query cannot verify their supporting
documents. Payment recovery state is correlated operational logging rather than
a durable reconciliation queue; its resolved/unresolved transitions are exercised
by actual-route offline tests. The reconciliation-row invariant does not prove
log retention or monitoring coverage.

### Final state and local validation

- Final disposable policy: OFF, effective_from NULL, 1500/1500 basis points,
  5000-cent limit, subscription_required true. AUTHORITATIVE never enabled.
- Final disposable counts: 12 accounts, 9 transactions, 23 entries, 3 trips;
  9 Phase 2 functions. The two committed synthetic payment fixtures and their
  opening/payment evidence are intentionally preserved. No historical test data
  or production records were deleted. All other financial/security fixtures rolled back.
- 36 offline test files / 165 tests passed. The last two added regressions cover
  existing-account compatibility and fixed-search-path hashing.
- TypeScript and full lint passed for the application changes; full lint had
  the same three existing warnings. Production build passed with 171 pages;
  BUILD_ID timestamp 2026-09-09 20:30:51 SAST is later than the final application
  source edit at 20:22:32. Subsequent runtime changes were SQL only.
- Final TypeScript and focused lint passed. The credential scan covered 103
  changed/untracked source and documentation files with zero candidates, and
  the final normal `git diff --check` passed.

Authenticated deployed HTTP/device smoke tests, a production parity observation
window, and an authoritative cutover are separate review/activation gates; none
is represented as completed here. No production access, commit, push, deployment,
Yoco work, notification send or production flag change occurred.

Files changed across this resumed work: payment-review route; payment recovery
test; completion service; new trip recovery test; Phase 2 migration; Phase 2
finance contract tests; the two existing reports; and the new disposable
financial-validation, concurrency-setup, concurrency-session-a,
concurrency-session-b, and invariants SQL artifacts.

## Final Verdict

PHASE 2 IMPLEMENTATION AND DISPOSABLE VALIDATION PASSED

READY FOR PHASE 2 PRODUCTION REVIEW

## Historical evidence from the 2026-09-09 repository recovery

The sections below preserve earlier checkpoints and blocker verdicts. They are
superseded by the 2026-09-10 final clean disposable evidence and verdict above.

Recovered `main` at `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`. The extensive
modified and untracked Phase 0/1/2 work was already present and was preserved.
Initial `git diff --check` passed, with Windows line-ending warnings only.

The payment-review retry fix was already implemented before this conversation:
approved SHADOW results with commission or excess value attempt the financial
RPC even when the legacy result is replayed. Notifications retain their
`!result.replayed` guard and the existing outbox switch. The same request UUID
is passed on every retry; SQL derives `driver_payment:<request UUID>` and the
payload hash from the locked approved request, not caller-supplied allocations.
Failure and subsequent recovery use correlated `unresolved` / `resolved` logs.
These logs are operational evidence, not a durable database recovery queue.

This continuation corrected indentation in the existing route and strengthened
the existing recovery harness to cover null/undefined roles and to apply the
real R50 policy to the recovered debt. No payment algorithm was rebuilt.

Local evidence: 26 focused tests (22 payment/policy/security and four trip
recovery tests), and 163 tests across all 36 offline test files passed.
Scenarios include initial SHADOW failure, legacy replay recovery, third
retry, R40/R60 overpayment, R59/R10 restoration, concurrent route retries,
transport exceptions, and a simulated crash after legacy commit. Database
boundaries are mocked; these results do not prove PostgreSQL concurrency,
exact ledger row counts, effective grants, or real notification delivery.

The migration is unchanged in this continuation. SHA-256:
`8d0ed689c7425eb2aa3aeee19890b2e1a5f5cba04f7644026cf1f6045390d76f`.
Both trigger revokes and the early null actor/null role rejection remain in
source and their regression tests pass. Live zero-mutation denial remains
pending the clean disposable security gate.

TypeScript passed again after the trip recovery correction. Full lint passed
with three existing warnings (two in the product-spec report template and one
unused adminAccessToken in the Admin layout). The added trip files are receiving
a final focused lint pass; build is still running at this report checkpoint.
Credential-pattern scan of changed/untracked source and docs found zero
candidate files. Final normal `git diff --check` passed. No disposable or
production database mutation has occurred.

Remaining proof: clean pre-Phase-2 baseline, corrected migration installation,
effective security matrix, real financial fixtures/recovery/concurrency, and
all requested global ledger invariants. Existing historical entries below
describe earlier candidates and must not be read as current validation results.

Additional Phase 2 recovery defect found and corrected locally: trip completion
rejected already-completed trips before its RPC and gated SHADOW on non-replay.
In SHADOW mode only, the completed-trip path now requires an authorized replay
from the existing completion RPC before attempting the same commission source.
The existing HTTP 409 response is retained, with no notification sends. The
normal completion path also permits SHADOW recovery after a concurrent replay
and catches transport errors after legacy commit. Four actual-service tests
cover repeated/concurrent recovery, ownership/authorization, and OFF behavior.

Files changed in this continuation: `src/app/api/admin/payment-reviews/route.ts`,
`src/lib/reliability/phase2PaymentRecovery.test.ts`, this report, and
`docs/phase-2-commission-driver-finance-implementation-report.md`, plus
`src/lib/trips/completeTripServer.ts` and the new
`src/lib/reliability/phase2TripRecovery.test.ts`.

## 2026-09-08 Null Actor Correction and Local Validation Stop

Candidate migration SHA-256:
`8d0ed689c7425eb2aa3aeee19890b2e1a5f5cba04f7644026cf1f6045390d76f`.
Previous candidate: `db1afb0ca0497d90c921f93df0493c85cdd3f5f5d676fa0718e91663e72817e5`.
The hash changed because the payment RPC now rejects NULL p_actor_id and
NULL v_role explicitly before reading the payment or performing financial work.
Empty, unknown, Customer, Driver, Dispatcher, and Support roles do not belong
to the exact Owner/Admin allowlist. The prior trigger revokes are retained.

Trust chain reviewed: requireAdminUser validates the bearer session with
getUser, resolves profiles.role with the server client, and the POST route
requires isFinancialAdminRole. The Phase 2 RPC receives auth.user.id, never a
request-supplied role/actor. The caller chooses the payment request ID; allocation,
driver, financial source, and idempotency inputs come from the locked payment
record. Review note/action belong to the Phase 0 approval path. No API change
was made in this continuation.

Function classifications (source audit, not disposable execution):

| Functions | Class | Actor/role requirement |
| --- | --- | --- |
| phase2_contract_version | Read-only | Explicit service execution grant; no human actor |
| phase2_current_policy, phase2_driver_finance_position, phase2_finance_eligibility | Read-only | auth.role IS DISTINCT FROM service_role rejects missing/untrusted role |
| phase2_lock_trip_commission_snapshot | Internal service mutation | Same null-safe service-role gate; no human actor parameter |
| phase2_post_trip_commission | Internal service mutation | Same service-role gate; optional audit actor, existing SYSTEM posting context |
| phase2_post_verified_driver_payment | Owner/Admin financial operation | Non-null actor ID and database-resolved Owner/Admin role plus service-role gate |
| phase2_snapshot_new_trip, phase2_guard_trip_commission_snapshot | Trigger-only | No direct client execution; SECURITY INVOKER |

All nine have explicit safe search_path declarations and client execution
revokes in the candidate source; effective live privileges remain unverified
for this candidate. Six are SECURITY DEFINER. No additional human-role check
was imposed on existing internal machine operations.

Local checks: 18 targeted tests passed. The full offline suite then passed
152 tests. A subsequent recovery regression exposes an existing defect:
`Approved payment replay must allow recovery of failed shadow posting` fails.
Latest focused result: 5 pass, 1 fail. Do not report the earlier 152 as a final
all-green result for the latest test tree.

Exact blocker: payment-reviews POST invokes the shadow payment RPC only when
`!result.replayed && result.status === "approved" && financeMode === "SHADOW"`.
If legacy approval commits and shadow posting fails, a retry returns replayed
and skips shadow posting. The error is logged, but retry through this route
cannot repair the missing shadow payment. This is source/contract-test evidence,
not a simulated database outage or authenticated HTTP test.

Smallest remediation: permit the idempotent shadow posting on approved legacy
replays as well, preserve the notification replay guard, and test an initial
shadow failure followed by approval replay with exactly one ledger payment
effect. Confirm RPC idempotency under real independent sessions before relying
on this recovery behavior.

Stopped as required by section 14 (local financial/security test failure).
No disposable reset, migration, fixtures, or production mutations occurred.
The SQL editor was opened at the disposable URL only. Live zero-mutation role
tests, Owner/Admin success, clean installation, full financial/concurrency
validation, TypeScript, lint, build, and final credential scan remain pending.
No temporary credentials were created. No project pause was performed.

Files changed this continuation: migration SQL, phase2FinanceContracts.test.ts,
this report, and phase-2-commission-driver-finance-implementation-report.md.
All pre-existing modified/untracked work is preserved. No commit/push/deploy.

Current verdict: PHASE 2 IMPLEMENTATION BLOCKED.

## 2026-09-08 Local Correction and New Blocker

The local migration now explicitly revokes EXECUTE from PUBLIC, anon, and
authenticated for both zero-argument trigger functions. The original source
contained no explicit grants for these functions and omitted them from its
revocation list; the observed PUBLIC EXECUTE is consistent with PostgreSQL's
default function privileges. Live default ACL provenance was not re-inspected
in this continuation. This is a local correction, not a reapplied migration.

Corrected SHA-256:
`db1afb0ca0497d90c921f93df0493c85cdd3f5f5d676fa0718e91663e72817e5`.
The earlier hash below identifies the previously executed, defective artifact.

All nine function definitions now have explicit client execution revokes.
Seven server RPCs retain explicit service_role execution grants. The two
trigger functions remain SECURITY INVOKER with `search_path=public,pg_temp`.
Six privileged functions are SECURITY DEFINER with that same explicit path;
the contract-version function is SECURITY INVOKER. This is source inspection,
not proof of effective live grants or trigger execution after reinstall.

The broader audit found another blocker in
`phase2_post_verified_driver_payment(uuid,uuid)`:

```sql
select role into v_role from public.profiles where id=p_actor_id;
if v_role not in ('owner','admin') then raise exception 'Owner or Admin actor required'; end if;
```

A missing profile or null actor leaves v_role NULL. The IF expression then
evaluates to NULL, not TRUE, so the intended Owner/Admin rejection is skipped.
The service_role boundary still applies; this finding does not establish a
direct anonymous RPC exploit. It does establish that the trusted payment RPC
does not enforce its declared actor contract for all inputs. Later constraints
may reject some inputs, but are not a substitute for authorization.

Smallest remediation: explicitly reject a missing/null actor role before any
payment work (for example, `v_role is null or v_role not in (...)`), and add
disposable tests for null actor, nonexistent profile, null role, Dispatcher,
Support, Owner, and Admin, verifying rejected cases leave no financial effect.

Stopped under the owner's instruction to report any additional genuine blocker.
No reset, migration execution, mode change, or fixture mutation occurred in this
continuation. Clean reinstall, effective permission matrix, trigger behavior,
financial tests, concurrency, and full regression remain pending. The four
local Phase 2 contract tests passed; full suite, TypeScript, lint, and build were
not rerun after the stop. No production, commit, push, or deployment action occurred.

Files edited in this continuation: the migration, phase2FinanceContracts.test.ts,
this report, and the commission/Driver finance implementation report. All other
modified and untracked work was preserved.

## Scope

- Disposable project: `moovu-phase-05g-disposable`
- Disposable ref: `tangtlmdpnvmoviwrgvd`
- Production ref excluded from all work: `mvazbszenqahgqpznhhq`
- Migration: `docs/phase-2-commission-driver-finance-migration.sql`
- Migration SHA-256: `2d85fa2cc2bf294693260928cc8514dca1ee6115aab314de0f9c352e8e1ca5db`
- PostgreSQL: `17.6`

## Migration Execution

The migration executed successfully as one transaction in the verified disposable project. Supabase returned `Success. No rows returned`. No Phase 2 SQL was run against production.

## Installation Evidence

Read-only verification returned:

- Phase 2 policy mode: `OFF`
- Phase 2 tables: `3`
- Trip commission snapshot columns: `4`
- Phase 2 triggers: `2`
- Phase 2 functions: `9`
- SECURITY DEFINER functions with fixed search path: `6`
- Phase 2 tables with RLS enabled: `3`
- Direct `PUBLIC`/`anon`/`authenticated` table mutation grants: `0`
- Policy rows: `1`

## Blocking Finding

Server-only routine access is not fully enforced. Read-only grant inspection found two unintended grants:

- `PUBLIC EXECUTE` on `public.phase2_snapshot_new_trip()`
- `PUBLIC EXECUTE` on `public.phase2_guard_trip_commission_snapshot()`

These are trigger functions, but the Phase 2 security contract requires no broad default execution grant on Phase 2 financial routines. Validation stopped at the post-migration security gate. No deterministic finance fixtures, mode transitions, concurrency tests, failure injection, or application regression reruns were performed after this blocker was found.

## Smallest Safe Remediation

Update the local migration package to explicitly revoke execution on both trigger functions from `PUBLIC`, `anon`, and `authenticated`. Then rebuild a clean disposable baseline, execute the revised migration as a complete reviewed package, and rerun Phase 2 validation. Do not patch production and do not activate `SHADOW` or `AUTHORITATIVE` mode.

## Verdict

`PHASE 2 IMPLEMENTATION BLOCKED`
