# MOOVU Phase 1 Disposable Ledger Validation

## Verdict

`PHASE 1 LEDGER FOUNDATION DISPOSABLE VALIDATION PASSED`

The five requested independent-session races were rerun after the smallest database-level remediation. All five now serialize correctly. The package is ready for production migration review; production remains unchanged and both ledger flags remain OFF.

## Corrected concurrency rerun

- Duplicate commission: PASS. Transaction `c9496f5e-9be7-4d94-ba4e-eae1c5b6ad32`; one post and one replay; one balanced R10.00 effect.
- Duplicate settlement: PASS. Transaction `3a7ea03c-7dc8-4551-881b-1988858c03d2`; one post and one replay; R100.00 applied once plus R30.00 unapplied credit once.
- Cancellation versus completion: PASS. Cancellation `62fa8ad3-b1ab-4e34-9954-2706a436c605` won; completion failed with the controlled incompatible-terminal-outcome error.
- No-show versus cancellation: PASS. No-show `21708d8b-d349-42fe-a8dd-efeeba900495` won; cancellation failed with the controlled incompatible-terminal-outcome error.
- Duplicate reversal: PASS. Reversal `84f0743c-1d78-4329-bb06-21483df015f3`; one post and one replay.
- Global invariants: zero unbalanced transactions, orphan entries, partial transactions, duplicate sources, duplicate terminal outcomes and invalid reversals.

The remediation adds canonical `economic_trip_id`, serializes on the trip inside the authoritative posting RPC, rejects incompatible terminal outcomes, and adds a partial unique index. The corrected migration was clean-installed only on disposable ref `tangtlmdpnvmoviwrgvd`; production ref `mvazbszenqahgqpznhhq` was not accessed.

## Environment and boundary

- Disposable project: `moovu-phase-05g-disposable`
- Disposable ref: `tangtlmdpnvmoviwrgvd`
- Production ref excluded from all writes: `mvazbszenqahgqpznhhq`
- Ledger read flag: OFF
- Ledger write flag: OFF
- Deployment, production SQL, Phase 2 and Yoco: not performed

## Migration and schema evidence

The Phase 1 migration completed successfully on the disposable project. Catalog verification returned three ledger tables, 15 indexes, 30 constraints, three ledger triggers, seven Phase 1 functions and three security-definer functions. RLS is enabled on every ledger table. Client table-mutation grants and client privileged-RPC grants are both zero; `service_role` has the three intended privileged RPC grants. All Phase 1 functions have fixed search paths.

## Real disposable database tests

A transaction-scoped harness created anonymized fixtures and exercised the installed functions. It ended with an explicit rollback and verified zero account, transaction and entry rows remained.

- Integer cents: accepted exact positive amounts `1`, `100`, `4000`, `10000` and `13000`; rejected zero, negative and fractional text input.
- Double entry: accepted balanced postings; rejected debit-only and unequal postings.
- Atomic failure: invalid source, invalid amount, malformed amount and unbalanced entries left no transaction header or ledger entry.
- Idempotency: same key and payload hash returned the original transaction ID with `replayed=true`; a different hash for the same key was rejected.
- Cash/transfer commission example: R100.00 fare retained as driver-collected context; only the R10.00 stored commission snapshot posted as commission debt/revenue. No R100.00 MOOVU cash receipt was posted.
- Settlement overpayment: R130.00 receipt posted as R100.00 debt application plus R30.00 driver unapplied credit.
- Cancellation and no-show fixtures: each posted a balanced R20.00 assessment split into R10.00 platform control and R10.00 driver compensation control without changing pricing.
- Immutability and reversal: posted headers and entries rejected mutation; one equal-and-opposite reversal succeeded; a second reversal was rejected.
- Final invariant: every posted test transaction balanced before rollback.

## Authorization evidence

- A real `SET LOCAL ROLE anon` INSERT attempt failed with PostgreSQL `42501 permission denied for table financial_accounts`.
- A real `SET LOCAL ROLE authenticated` privileged posting call failed with `42501 permission denied for function phase1_post_financial_transaction`.
- Catalog grants prove `PUBLIC`, `anon` and `authenticated` have no mutation or privileged RPC execution. Owner, Admin, Customer, Driver, Dispatcher and Support application identities all use the `authenticated` database role and therefore receive no direct ledger mutation capability.
- The trusted `service_role` execution path successfully created accounts, posted transactions and performed the authorized Admin reversal in the rollback harness.

## Independent Session Concurrency Validation

All races used genuinely independent Supabase SQL Editor sessions against disposable ref `tangtlmdpnvmoviwrgvd`, with a two-second synchronization delay before each competing RPC call.

### 1. Duplicate commission - PASS

- Fixture: completed trip `93000000-0000-0000-0000-000000000001`, R10.00 stored commission.
- Both sessions used idempotency key `race:commission:001` and the same source/payload.
- Session A posted transaction `7c05f677-15c2-4a3c-9a3e-96cfbaa8015e`; Session B returned the same ID with `replayed=true`.
- Final state: one `DRIVER_COMMISSION` transaction, two balanced R10.00 entries, no duplicate debt/revenue effect, zero-cent imbalance.

### 2. Duplicate settlement - PASS

- Fixture: settlement `94000000-0000-0000-0000-000000000001`; R100.00 debt and R130.00 payment.
- Both sessions used idempotency key `race:settlement:001` and the same source/payload.
- Session A posted transaction `360d2e74-daf6-4146-b04e-3fca2ed7c5fb`; Session B returned the same ID with `replayed=true`.
- Final state: one settlement transaction; R100.00 applied once and R30.00 unapplied once; balanced R130.00 debit and credits.

### 3. Cancellation versus completion - FAIL

- Fixture: trip `93000000-0000-0000-0000-000000000002` and cancellation-fee row `95000000-0000-0000-0000-000000000001`.
- Completion posted transaction `7b5d011a-410d-456e-bdd8-8a5579aa9e68` for R10.00 debit/credit.
- Cancellation concurrently posted transaction `b8f28d94-015a-4d97-b716-ae26c541290b` for a balanced R20.00 assessment.
- Final state: two incompatible finalized economics for one trip. Each transaction is internally balanced, but the required one-winner business invariant is absent.

### 4. No-show versus cancellation - FAIL

- Fixture: arrived trip `93000000-0000-0000-0000-000000000003` and fee row `95000000-0000-0000-0000-000000000002`.
- No-show posted transaction `87c6fea7-e23c-4c17-9a3b-fe294f069487` for R20.00.
- Cancellation concurrently posted transaction `515b73e4-b285-495e-8030-a7bfe438ac7d` for another R20.00 against the same fee source.
- Final state: two full assessments, duplicating customer liability, platform control and driver compensation. The corrected reconciliation query identifies the fee row with `outcome_count=2`.

### 5. Duplicate reversal - PASS

- Fixture: original commission transaction `7c05f677-15c2-4a3c-9a3e-96cfbaa8015e`, authorized disposable Admin actor.
- Both sessions used idempotency key `race:reverse:001`.
- Session A posted reversal `e9889161-bc50-4360-88a9-b142c7f05c67`; Session B returned the same ID with `replayed=true`.
- Final state: one reversal, two equal-and-opposite R10.00 entries, immutable original retained, zero-cent net effect and no double reversal.

### Post-race invariants

Queries returned zero unbalanced posted transactions, zero duplicates under the existing `(transaction_type, source_type, source_id)` uniqueness contract, zero orphan entries, zero orphan posted sources, zero invalid reversal relationships and zero pending/empty transactions. The one failed corrected reconciliation row is intentional evidence of the no-show/cancellation defect: fee `95000000-0000-0000-0000-000000000002` has two mutually exclusive posted outcomes.

### Root cause and remediation boundary

`phase1_post_financial_transaction` validates only that a supplied source exists, then deduplicates by idempotency key and the existing transaction-type/source identity. It does not resolve a canonical trip identity, lock that trip, or reject an already-posted incompatible terminal economic outcome. The unique index cannot protect cancellation versus completion because their transaction types, source types and source IDs differ; it also cannot protect no-show versus cancellation because their transaction types differ.

Production is not affected by this dormant ledger defect today: both Phase 1 feature flags remain OFF and Phase 0 remains authoritative. It blocks migration review and any ledger activation. The smallest safe remediation is a reviewed database-level terminal-outcome guard inside the authoritative posting path: resolve the canonical trip ID, serialize on that trip, and reject incompatible `TRIP_FINANCIAL_COMPLETION`, `CANCELLATION_FEE` and `NO_SHOW_FEE` postings. The exact coexistence/reversal policy must be approved before changing the migration; no blind patch was applied.

## Reconciliation

Disposable probing exposed one local fixture defect: `phase-1-ledger-reconciliation.sql` referenced nonexistent `financial_accounts.category`. PostgreSQL returned `42703`. The read-only file was corrected to use the installed `account_category` column. No migration or database object required correction.

The corrected disposable reconciliation invariant query returned zero unbalanced transactions, zero duplicate business sources and zero orphan sources.

Historical production rows were not copied or mutated. Production aggregate comparison was not repeated because this continuation had no separately approved production-query step.

## Migration rerun and feature flags

The migration is intentionally non-repeatable: it uses guarded preflight checks followed by plain `CREATE TABLE` statements. A second application is expected to fail on existing objects inside its transaction rather than silently alter an installed ledger. It was not rerun.

Repository search confirms `PHASE1_LEDGER_READ_ENABLED` and `PHASE1_LEDGER_WRITE_ENABLED` remain hard-disabled and no Customer, Driver or Admin route imports the ledger foundation.

## Accounting decision review

### A - must decide before production

- Final presentation for driver-collected Cash/Transfer gross activity.
- Driver commission receivable versus driver payable netting rules.
- Treatment and release/refund rules for unapplied driver credits.
- Cancellation/no-show collection timing and revenue recognition.
- Customer arrears collection and write-off policy.
- VAT, tax and external general-ledger mapping assumptions.

### B - can defer

- Future driver payout liability and processor settlement model.
- Future online-payment and refund liability flows.
- Subscription revenue recognition beyond confirmed receipt/deferred revenue.

### C - design only

- Dormant future transaction types and account categories while no application route or feature flag activates them.

## Defects fixed

- Corrected two read-only reconciliation references from `financial_accounts.category` to `financial_accounts.account_category`.
- No production schema, pricing, commission, subscription or application runtime behavior changed.

## Remaining validation

Local automated validation passed: 15 focused finance/ledger tests, all 137 offline tests, TypeScript, ESLint, the 171-route production build and `git diff --check`. The repository secret scan found no disposable test credential. Node emitted existing typeless-package warnings only.

Authenticated HTTP routes are not ledger-enabled in this phase, so no application route can yet provide an end-to-end ledger posting proof. The two failed cross-outcome races must be corrected and all five races plus global invariants rerun before production migration review.

## Cleanup

No disposable credential was present in the process environment or repository scan. Supabase accepted the pause request for `tangtlmdpnvmoviwrgvd` and reported `PAUSING PROJECT`; the project was not deleted.
