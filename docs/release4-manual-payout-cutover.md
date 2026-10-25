# Release 4 manual Driver payouts: controlled cutover

This candidate is **not deployed**. It does not initiate bank transfers. Both
`MOOVU_MANUAL_PAYOUTS_ENABLED` and `MOOVU_UNIVERSAL_FARE_23_ENABLED` default to off.
The old `MOOVU_ONLINE_PAYOUTS_ENABLED` does not expose the new payout pages.

## Tested local behavior

- An authorized financial Admin selects unbatched, completed online-trip payables with verified actual Yoco fee evidence and creates a bounded weekly draft. The database function rechecks payment, refund, ledger, ownership, dates and duplicate selection.
- Reconciliation and approval snapshot the 15% commission, approved 50/50 actual provider-fee split, eligible debt recovery and nonnegative Driver amount due. Missing actual fee evidence blocks the draft; no fee is invented.
- “Mark as Paid” records an Admin assertion with amount, date, EFT/PayShap, bank reference and optional proof **reference**. It posts no payout ledger transaction and leaves the Driver's amount unsettled.
- Multiple recorded payments cannot exceed the approved amount. A failed bank transfer can be replaced. Recorded and verified amounts are shown separately to Admin and Driver.
- A separate financial operator must import independent bank-statement evidence matching the amount, beneficiary fingerprint and recorded transfer reference. A different reviewer confirms it. Only then is a cash movement posted; the final verified part posts approved fee/debt deductions once and marks the batch paid.
- Direct authenticated table access and payout RPC execution remain denied. Driver API reads are scoped through the authenticated account-to-Driver link. Synthetic local tests cover partials, retries, failed evidence, reference mismatch, overpayment, independent review, ledger balance and two simultaneous full-amount recording attempts (one accepted).

The UI records a proof reference, **not a file upload**. An operator must retain any proof in an approved restricted document system and paste only its reference. Bank-statement import is deliberately not exposed as an ordinary Admin page action. Real bank statement intake, beneficiary matching and three-person separation require operational verification before activation.

## Dependency and release order

1. Complete the approved dispatch compatibility Stage 1 runbook in `docs/moovu-release4-final-execution.md`. Do not deploy this branch against the currently claimless worker or use that old worker as a rollback target after ownership enforcement.
2. Keep both Release 4 flags off. Verify a current recoverable production database point, migration history, post-snapshot write preservation, Yoco webhook monitoring, active trip/payment state and a compatible application rollback deployment.
3. Rehearse the exact production schema and managed-role permissions for these **additive** payout SQL candidates in order: `docs/release4-online-payable-total-separation.sql`, `docs/release4-phase5-booking-fee-allocation.sql`, `docs/release4-online-payout-control-plane.sql`, `docs/release4-online-payout-financial-engine.sql`, then `docs/release4-manual-partial-payments.sql`. Recheck the dependency of each candidate and apply only a separately reviewed, hash-pinned migration bundle. No repository-wide migration push.
4. Build and stage this exact reviewed source with Production configuration and both flags off. Verify Customer, Driver, Admin, booking, signed Yoco webhook and cron health without real charges or bank transfers. Promote only after its own staged and financial gates pass. This candidate has not completed hosted or managed Supabase testing.
5. After an explicit payout activation decision, set `MOOVU_MANUAL_PAYOUTS_ENABLED=true` only when migrations, approved policy row, actual Yoco fee intake, three distinct financial operators, bank evidence intake and authenticated UI checks are complete. Keep `MOOVU_ONLINE_PAYOUTS_ENABLED=false`; the legacy single-transfer RPC grant is revoked by the manual-payment candidate.
6. Activate `MOOVU_UNIVERSAL_FARE_23_ENABLED=true` only in a separate pricing decision. The existing quote and booking path uses a server-authoritative versioned fare: R40→R40.92, R76→R77.75, R100→R102.30. A stale old quote is rejected and must be shown again before confirmation. Existing locked bookings are unchanged. No payment-method surcharge is applied.

## Recovery

Application rollback retains additive schema and all posted financial entries. Never restore an older snapshot over newer trips or payments. If a manual payment was recorded but not bank verified, reconcile it from independent evidence; do not turn the assertion into settlement. If an incorrect verified posting occurred, use an approved compensating ledger transaction and audit trail, not deletion or direct status rewrites. A deployed application must remain compatible with the payout schema before any new migration is applied.

## Unverified release gates

- Production managed-role and complete-schema rehearsal of the new manual-payment candidate.
- Authenticated Admin/Driver hosted screens, real bank-statement intake and physical bank evidence.
- Source-to-live compatibility release and Stage 1 dispatch cutover, followed by Stage 2 staged application comparison.
- Production feature-flag and scheduled-worker effective-state checks. No activation or deployment occurred in this worktree.
