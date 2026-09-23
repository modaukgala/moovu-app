# Phase 2 shadow payment correction validation report

Date: 2026-09-11  
Status: **DISPOSABLE VALIDATION PASSED**

## Root cause and correction

The installed payment shadow RPC used the legacy allocation split without checking the Phase 2 cutoff or current posted Phase 2 debt. A historical approval could therefore create debt credit or unapplied credit in an empty Phase 2 ledger.

The additive correction is `docs/phase-2-shadow-payment-cutoff-correction.sql` (SHA-256 `46d4e019e336da5a7064f8aa7a1dd20f9ce1d2eacddf8b0379e20c209e3be0b0`).

- `driver_payment_requests.reviewed_at` is the authoritative economic timestamp. Legacy approval sets it once; approval replay does not rewrite it.
- `phase2_finance_policy.effective_from` is the server-controlled cutoff. Missing cutoff fails closed; once non-null it is immutable.
- Pre-cutoff payments create no financial transaction, debt reduction, cash entry, or unapplied credit. A non-financial reconciliation decision makes every replay a resolved deterministic skip.
- Post-cutoff allocation is `min(verified commission value, posted Phase 2 commission debt)`. Legitimate remaining value becomes Driver unapplied credit.
- Existing posted allocations are returned before balance recalculation, preserving second and third retry idempotency.
- The Driver advisory lock serializes distinct payments. An AFTER posting trigger rejects any transaction that would leave a Driver commission debt account negative.
- The RPC remains service-role-only and also requires a database-resolved Owner/Admin actor. Trigger functions have no client or service-role execute grant.
- The route treats a historical skip as resolved and retains legacy replay recovery. Notification delivery remains gated by `result.replayed` and the existing outbox contract.

Historical debt remains reserved for the separately approved cutoff/opening-balance/exception-register process. Historical payment replay does not create an opening balance.

## Local validation

| Gate | Result |
|---|---|
| Focused Phase 2 tests | PASS — 22/22 |
| Full direct Node suite | PASS — 170/170 |
| TypeScript `npx tsc --noEmit` | PASS |
| ESLint `npx eslint .` | PASS — 0 errors, 3 unrelated existing warnings |
| Production build `npm run build` | PASS |
| `git diff --check` | PASS (line-ending notices only) |
| Scoped credential scan | PASS — no matches |

Focused local contracts cover the R104.60 zero-debt historical shape, post-cutoff R40/R60 and R59/R10 allocation, zero-debt post-cutoff credit semantics, persisted skip decisions, replay ordering, debt-floor enforcement, fixed search paths, grants/revokes, and route skip handling. The corresponding database concurrency, authorization, failure-injection, and invariant checks passed in the disposable database as recorded below.

## Disposable validation

The dashboard visibly verified `tangtlmdpnvmoviwrgvd` as `moovu-phase-05g-disposable`. SQL was read directly from disk into the browser runtime. Editor selection/copy produced 12,356 CRLF bytes; normalized to repository LF it exactly matched 12,168 bytes and SHA-256 `46d4e019e336da5a7064f8aa7a1dd20f9ce1d2eacddf8b0379e20c209e3be0b0`. Initial installation and idempotent reinstall both succeeded.

- Financial suite: **44/44 PASS**, including R40/R60, R59/R10, injected rollback, recovery, replay, balance, and completion checks.
- Correction suite: **9/9 PASS**, including the neutral historical R104.60 replay, persisted skip, zero-debt R60 credit, debt floor, replay, and cutoff immutability.
- Security matrix: **10/10 PASS** with zero mutation for rejected actors and client roles.
- Invariants: **11 checks, zero violations**.
- True overlapping R40/R40 sessions against R50 debt applied R40 then R10, left debt R0, created R30 unapplied credit, and finalized exactly two distinct source transactions.
- Disposable was restored to `OFF`. The retained test cutoff is `2026-09-11 09:52:38.194934+00` and synthetic concurrency evidence remains for audit.

A final read-only installed-state query confirmed mode `OFF`, all three corrected functions, all three correction triggers, and the two expected distinct concurrency transactions. The concurrency fixture remained at zero commission debt and R30 unapplied credit.

## Production safety

No production SQL, deployment, commit, push, activation, opening balance, or historical-data change was performed. A final dashboard-only inspection confirmed production project `mvazbszenqahgqpznhhq` is Healthy and still lists `phase1_financial_ledger_foundation` as its latest recorded migration, proving the corrective migration was not installed there. The last SQL-verified production finance state remains Phase 2 OFF, SHADOW OFF, AUTHORITATIVE OFF, ledger 0/0/0, and shadow rows 0.
