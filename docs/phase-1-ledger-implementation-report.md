# MOOVU Phase 1 Stage A Implementation Report

## Production installation

Under explicit owner approval, the exact reviewed migration with SHA-256 `49C09292064FA473B77BD62E01AEAE26865BDB61253AB0192A41C7528871573D` was applied successfully to production ref `mvazbszenqahgqpznhhq`. Post-migration checks confirmed the expected tables, constraints, indexes, triggers, functions, RLS and server-only access. All three ledger tables contain zero rows, existing Phase 0 counts/totals are unchanged, and both application ledger flags remain off.

Execution evidence is recorded in `docs/phase-1-production-migration-execution-report.md`. No application deployment, backfill, ledger posting, commit, push, Phase 2 work or Yoco integration occurred.

## Production migration review

The final read-only production compatibility review passed against production ref `mvazbszenqahgqpznhhq`. All required Phase 0 source tables and types are compatible, no Phase 1 object collision exists, production anomaly preflight returned zero constraint-breaking rows, the migration is atomic and additive, explicit revokes override the database's broad default privileges, and application ledger flags remain hard-disabled. The exact findings and controlled execution plan are in `docs/phase-1-production-migration-review.md`.

This is readiness for separate owner approval only. No Phase 1 SQL was applied to production, and no deployment or ledger activation occurred.

## Disposable concurrency closure

All five independent-session races passed after adding the canonical trip terminal-outcome guard to `docs/phase-1-ledger-migration.sql`. The corrected package clean-installed on disposable ref `tangtlmdpnvmoviwrgvd`; global ledger invariants returned zero failures. Production remains unchanged and ledger read/write flags remain OFF.

## Scope

Baseline commit: `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4` on `main`.

This stage prepares a disabled financial ledger foundation locally. It does not change a live route, calculate a new customer charge, alter pricing or commission, execute SQL, apply a migration, change Supabase, deploy, commit, or push.

## Application code

- `src/lib/finance/money.ts`: deterministic decimal-rand to integer-cent conversion and formatting.
- `src/lib/finance/ledgerFoundation.ts`: balanced-entry, payload-hash and idempotency helpers. Read and write flags are hard-disabled.

No existing application route imports these files. Phase 0 remains authoritative.

## Database package

- `docs/phase-1-ledger-migration.sql`: server-only immutable accounts, transaction headers and double-entry lines; deferred balance enforcement; deterministic posting and reversal RPCs; restrictive RLS/grants.
- `docs/phase-1-ledger-reconciliation.sql`: read-only parity and anomaly queries.
- `docs/phase-1-ledger-validation.sql`: disposable-only validation fixture ending in rollback.

None of these SQL files was executed in Stage A.

## Source and accounting decisions

Canonical source precedence is: completed `trips` snapshots for fare/commission/net, `driver_settlements` for collected settlement money, approved `driver_subscription_payments` for subscription receipts, and `trip_cancellation_fees` for assessments. `driver_payment_requests` is workflow evidence. Cached wallet balances are projections. Neither is posted as independent money.

Entries use positive `BIGINT` ZAR cents and explicit debit/credit sides. Historical commission snapshots are not recomputed. Idempotency uses a stable key plus payload hash; conflicting replay is rejected. Corrections create linked reversing transactions instead of editing history.

## Security

The migration enables RLS and revokes table/RPC access from `PUBLIC`, `anon`, and `authenticated`. Trusted server execution is required. The package stores actor/source identifiers needed for audit but prohibits unnecessary personal or credential data in metadata.

## Unresolved policy decisions

- A distinct authoritative booking-fee amount and inclusion rule is not currently proven.
- Driver-collected Cash/Transfer gross presentation needs owner/accounting approval.
- Cancellation/no-show collection and revenue-recognition states need policy approval.
- Driver compensation classification and subscription recognition timing need approval.
- External statutory/general-ledger and tax mappings need qualified review.

These gaps block their legacy postings; the package does not invent values.

## Disposable validation update

The reviewed migration was applied only to disposable project `tangtlmdpnvmoviwrgvd`. Real PostgreSQL tests covered integer-cent storage, balanced posting, rejected malformed/unbalanced writes, idempotent replay, conflicting replay, service-only authorization, immutability, reversal, settlement overpayment, cancellation/no-show representations and independent-session concurrency. Evidence and limitations are recorded in `docs/phase-1-disposable-validation-report.md`.

## Independent Session Concurrency Validation

Duplicate commission, duplicate settlement and duplicate reversal races passed: each produced one logical transaction and one replay response. Cancellation versus completion failed because both incompatible transactions posted. No-show versus cancellation failed because both transaction types posted against the same cancellation-fee source. Every resulting transaction remained internally balanced, with no orphan or partial rows, but the required one-terminal-economic-outcome-per-trip invariant is not implemented.

The defect is in `phase1_post_financial_transaction` and its supporting uniqueness contract: source existence, idempotency and same-type source uniqueness do not serialize or exclude different terminal transaction types for one canonical trip. Because ledger flags remain OFF, current production behavior is unchanged. Before migration review, the database contract needs an approved canonical-trip terminal-outcome guard, followed by a clean disposable install and rerun of all five races and global invariants.

Disposable validation found and corrected a read-only reconciliation typo: the installed column is `financial_accounts.account_category`, not `financial_accounts.category`. The migration itself did not require a database patch.

Local validation passed 15 focused ledger/finance tests and all 137 offline tests. `npx tsc --noEmit`, `npm run lint`, `npm run build` (171 routes), `git diff --check` and the repository credential scan also passed.

## Validation boundary and next stage

Local static and TypeScript tests can prove helper behavior and fixture contracts only. They cannot prove PostgreSQL transactions, concurrency, RLS, grants, rollback or production compatibility.

The disposable environment is proven and the requested race matrix is complete, but two required races failed. Production migration review remains blocked until the terminal-outcome guard is reviewed, implemented in the migration package and revalidated on a clean disposable install. Production activation remains a later separately approved stage.

Before any shadow posting, rollback is to leave the migration unapplied. After empty disposable schema creation, only empty Phase 1 objects may be removed. Once postings exist, disable flags and use forward correction/reversals; never delete ledger history.
