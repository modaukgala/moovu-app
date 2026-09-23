# MOOVU Phase 2 Authoritative Completion Report

Cutover date: 15 September 2026  
Production Supabase: `mvazbszenqahgqpznhhq` (`ACTIVE_HEALTHY`)  
Production deployment: `dpl_DXSpah8kBx3VSjep1o9mMneq1ZC1` (`READY`)  
Production domain: `https://moovurides.co.za` (HTTP 200)  
Immutable boundary: `2026-09-15T19:04:38Z`

## 1. Verdict

Phase 2 is AUTHORITATIVE in production. Go and Go XL commission is 15%, the new-work restriction boundary is R50, Driver subscription is no longer a financial eligibility requirement, durable recovery is active, and Phase 4 and Phase 5 remain active.

## 2. Authority and cutover

The final additive contract is `docs/phase-2-authoritative-cutover.sql`, SHA-256 `b669c131099ce939731a14ccfa09e0fa3f98b1f06a05edfd10e6c04187983431`. It adds a separate immutable `authoritative_effective_from` and retains the SHADOW `effective_from`. The transition accepts the SHADOW application only while the AUTHORITATIVE cutoff is in the future, then requires AUTHORITATIVE.

Trips created before the boundary retain legacy completion economics. Trips created at or after it use the locked 15% Phase 2 snapshot. Active trips can finish; the R50 gate applies only to new work.

## 3. Completion and double commission

OTP, controlled bypass and authorized Admin completion use one locked transaction. An AUTHORITATIVE trip records the 15% display snapshot, creates no legacy wallet commission debit, commits its completion event and recovery identity atomically, then posts exactly one `trip_commission:<tripId>` transaction. Replay and overlapping posting converge on that key.

Phase 5 uses `phase5_driver_fare_basis_cents`. The disposable R100 ride-fare case produced R15 commission while excluding the separate R3 service fee. Phase 4 cancellation/no-show compensation does not use the completed-trip commission source.

## 4. Payment and unlock

`phase2_review_driver_payment` locks the request and Driver finance identity, requires owner/admin authorization, allocates verified funds against current Phase 2 net debt, caps application at debt, preserves excess as unapplied credit, and posts within the same transaction. Replay creates no second transaction. Ledger eligibility immediately unlocks new work below R50.

## 5. New-work gates

Online activation, nearby discovery, offer polling/current offer, rollover, dispatch, preferred-driver selection, Admin dispatch, payment submission and offer acceptance use the shared server finance authority. A database offer trigger closes the acceptance race. Approval, verification, profile, vehicle, GPS, online, busy, active-trip, declined-offer and authorization checks remain. OFF/SHADOW retain legacy subscription and wallet authority.

## 6. Recovery

The protected queue supports SHADOW and eligible AUTHORITATIVE completion. Completion and queue identity are atomic. Row locking, stale-claim recovery, bounded backoff and stable transaction identity preserve exactly-once economics after timeout, 502, lost response or duplicate worker.

## 7. Disposable proof

Project `tangtlmdpnvmoviwrgvd` ran real AUTHORITATIVE validation. Three Phase 5 trips covered OTP, bypass and Admin completion. Each produced one balanced R15 liability, zero legacy commission rows, one completion event and one reconciliation. A transient failure recovered after backoff. Two overlapping sessions produced one claim and one economic posting.

Payment validation proved debt-first clearing, R20 overpayment credit, duplicate replay, zero-debt credit, automatic unlock, and eligibility with an inactive/expired historical subscription. Pure/database contracts cover R49.99/R50/R50.01, partial payment, non-negative debt, Go/Go XL 15%, and authorization failures.

## 8. Regression validation

- `npm test`: PASS, 204/204.
- `npx tsc --noEmit`: PASS.
- `npm run lint`: PASS with zero errors and three pre-existing warnings.
- `npm run build`: PASS, 181 routes/pages.
- `git diff --check`: PASS; line-ending notices only.
- Scoped credential scan: PASS; release changes contain no credential values and local env files were excluded.

## 9. Installation and deployment

The database package was installed while production was effectively SHADOW. The runtime was built from an isolated directory excluding environment files, `.git`, dependencies, build output and logs. SHADOW release `dpl_Gpef6nPn5iinGbPQbE5YC2Egq5Jp` was READY before scheduling. The application mode was then set to AUTHORITATIVE and the same runtime deployed as `dpl_DXSpah8kBx3VSjep1o9mMneq1ZC1` before the fixed boundary.

## 10. Immediate production verification

At `2026-09-15T19:05:09Z`, configured/effective mode was AUTHORITATIVE, both rates were 1500 basis points, limit was 5000 cents, and `subscription_required=false`. Active trips: 0. Unresolved/terminal recovery: 0/0. Imbalanced posted transactions: 0. Negative Driver commission debt accounts: 0. Phase 4 `phase4-2026-09-owner-v1` and Phase 5 `phase5-2026-09-owner-v1` remain active.

Four preserved SHADOW comparisons intentionally show legacy 10%/12% versus observational 15%; all have posting and reconciliation identity and none is a missing recovery gap.

## 11. Natural event

**PENDING — NO NATURAL AUTHORITATIVE COMPLETION YET**

No production trip or payment was manufactured. This is not a blocker after deterministic, disposable, concurrency, deployment, policy and invariant gates passed.

## 12. Final state

- Phase 2: AUTHORITATIVE
- Go / Go XL: 15% / 15%
- New-work restriction: debt >= R50
- Subscription required: NO
- Durable recovery: ACTIVE
- Phase 4 / Phase 5: ACTIVE / ACTIVE
- Ledger imbalance: 0
- Recovery unresolved / terminal: 0 / 0
- Phase 6: not started

PHASE 2 COMPLETE — AUTHORITATIVE LIVE IN PRODUCTION
