# Commission operational lock retirement

## Scope

Commission remains a payable ledger obligation, not an access condition.
The authoritative 15% calculation, payment processors, account uniqueness,
cash/online dispatch guards, OTP and subscription requirements are unchanged.

Baseline: fbdb60d6b3fe93c09fb9f2549fd3827b9aecea21.
Upstream Yoco recovery 1b52e4b was preserved before release validation.

## Enforcement audit

- Driver Home and Earnings displayed a legacy R100 limit with approaching-limit warnings.
- Driver/Admin commission pages displayed limit progress and operational restriction wording.
- Phase 2 authoritative finance eligibility enforced R50 (5000 cents).
- OFF/SHADOW eligibility enforced R100 as well as subscription requirements.
- Admin manual assignment independently rejected legacy debt of R100 or more.
- Shared finance eligibility is used by online toggles, dispatch candidates,
  offer APIs and database new-work guards.
- No separate commission-lock notification sender was found. Payment/receipt notifications remain.
- No driver commission-lock flag was found in the production drivers schema.
  Wallet account_status represents due/settled, not an operational suspension.
- Historical threshold policy/snapshot fields remain for compatibility; they are not enforced.
- Legacy financial constants/balances outside this enforcement scope were not recalculated.

## Migration

Apply only `20260929150106_retire_commission_operational_lock.sql`, not all pending migrations.
It replaces three functions with existing signatures/security/grants:

- phase2_driver_finance_position: eligible regardless of payable debt.
- phase2_finance_eligibility: retains existing subscription conditions outside AUTHORITATIVE mode.
- phase05b_assign_driver: removes only the legacy debt lookup/condition.

No table data, balances, payment attempts, policies, constraints or grants are changed.
Rollback requires restoring the prior three function definitions and reverting the scoped
application commit. This reinstates the old debt lock and must be separately approved.

## Validation evidence

- All local unit/contract tests passed (273 after incorporating upstream recovery).
- Disposable matrix: R0, R85.80, R100, R150 and R500 debts remain exactly unchanged
  after real reservation, acceptance and Admin assignment RPCs.
- Inactive account and inactive subscription manual-assignment guards still reject.
- Authenticated disposable HTTP online/offline toggle passed at R500; inactive account rejected.
- Phase 2 commission completion/recovery and payment settlement regressions passed.
- Fifteen stale-offer/dispatch checks passed, including unpaid online dispatch blocking
  and paid-online dispatch eligibility. These are disposable contract checks, not live charges.
- Production build and TypeScript passed; lint has zero errors and three pre-existing warnings.
- No real-money payment, production test trip, native release or wallet transformation performed.

## Remaining device verification

An authenticated real-device Driver/Admin UI smoke remains necessary to confirm the
commission summary presentation and existing Pay Commission action. No live Yoco charge
was attempted. Database/HTTP assertions do not constitute physical push-delivery proof.

## Production financial invariant gate

Record all driver balances and the complete ledger hash immediately before/after migration.
Require equal balances, ledger hash, transaction count, debit/credit totals, and canonical
financial-account helper hash. Record deployment ID separately after release succeeds.
