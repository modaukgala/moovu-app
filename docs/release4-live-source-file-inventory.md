# Release 4 live-source file inventory

Live source: `7caa67a91a17f5e0fd1536f2863445299de5818e`.
Stage 1: `codex/release4-live-stage1` at `eea0139ff89a4c2cca9e6f627ec14686369b81ba`.
Stage 2: `codex/release4-live-stage2`; use `git rev-parse HEAD` for its final commit.

Source proof: all 1,400 tracked files included in the READY live deployment matched this Git tree by raw SHA-1. Eight omitted `.gitignore` files and five extra build/untracked documentation artifacts are excluded from that statement.

## Stage 1 versus live

```text
A	.gitattributes
M	src/app/api/payments/yoco/webhook/route.ts
M	src/lib/dispatch/dispatchTrip.ts
M	src/lib/payments/yoco/dispatch.ts
A	supabase/migrations/20261022120000_online_payment_dispatch_terminal_guard.sql
A	supabase/migrations/20261022123000_online_payment_dispatch_ownership.sql
A	supabase/migrations/20261022182716_online_payment_dispatch_cutover_control.sql
```

## Stage 2 versus Stage 1

```text
M	.env.example
M	.gitattributes
A	docs/moovu-dispatch-concurrency-resolution.md
A	docs/moovu-durable-dispatch-ownership.md
A	docs/moovu-payment-dispatch-cutover-rehearsal.md
A	docs/moovu-payment-dispatch-state-safety-fix.md
A	docs/moovu-release4-final-execution.md
A	docs/moovu-release4-payouts-and-commission-recovery.md
A	docs/release4-cron-safe-cutover.md
A	docs/release4-financial-certification.md
A	docs/release4-live-baseline-integration.md
A	docs/release4-local-supabase-certification.md
A	docs/release4-manual-partial-payments.sql
A	docs/release4-manual-payout-cutover.md
A	docs/release4-online-payable-total-separation.sql
A	docs/release4-online-payout-control-plane.sql
A	docs/release4-online-payout-financial-engine.sql
A	docs/release4-payout-controlled-release-runbook.md
A	docs/release4-phase5-booking-fee-allocation.sql
A	docs/release4-production-compatibility-preflight.md
A	scripts/rehearse-payment-dispatch-cutover.mjs
A	scripts/release4-booking-fee-correction-test.sql
A	scripts/release4-booking-fee-repro.sql
A	scripts/release4-connected-finance.sql
A	scripts/release4-cron-cutover-probe.sql
A	scripts/release4-cross-version-offer-probe.sql
A	scripts/release4-manual-payment-connected-test.mjs
A	scripts/release4-online-payout-approval-connected-test.sql
A	scripts/release4-online-payout-concurrency-fixture.sql
A	scripts/release4-online-payout-concurrent-approval-fixture.sql
A	scripts/release4-online-payout-debt-offset-connected-test.sql
A	scripts/release4-online-payout-draft-connected-test.sql
A	scripts/release4-online-payout-review-connected-test.sql
A	scripts/release4-online-payout-rounding-connected-test.sql
A	scripts/test-payment-dispatch-claim-race.ps1
A	scripts/test-payment-dispatch-ownership.sql
A	scripts/test-payment-dispatch-state-guard.ps1
A	src/app/admin/(protected)/online-payouts/page.tsx
M	src/app/admin/(protected)/trips/new/page.tsx
A	src/app/api/admin/online-payouts/route.ts
M	src/app/api/admin/trips/create/route.ts
M	src/app/api/customer/book-trip/route.ts
M	src/app/api/customer/phase5-quote/route.ts
A	src/app/api/driver/online-payouts/route.ts
M	src/app/book/page.tsx
M	src/app/driver/earnings/page.tsx
A	src/components/finance/OnlinePayoutsPanel.tsx
M	src/lib/admin/navigation.test.ts
M	src/lib/admin/navigation.ts
M	src/lib/finance/commissionPresentation.test.ts
M	src/lib/finance/commissionPresentation.ts
A	src/lib/finance/onlinePayoutAvailability.ts
A	src/lib/finance/onlinePayoutLifecycle.test.ts
A	src/lib/finance/onlinePayoutLifecycle.ts
A	src/lib/finance/onlinePayoutPreview.test.ts
A	src/lib/finance/onlinePayoutPreview.ts
M	src/lib/finance/phase2Policy.test.ts
M	src/lib/finance/phase2Policy.ts
M	src/lib/finance/phase2ShadowRecovery.ts
A	src/lib/pricing/universalFare.test.ts
A	src/lib/pricing/universalFare.ts
M	src/lib/reliability/phase2DurableRecovery.test.ts
M	src/lib/trips/adminTripPaymentMethod.test.ts
A	docs/release4-live-source-file-inventory.md ```  The loading scene, screen, CSS and sedan asset Git blobs match the live source at both stages. No existing Customer, Driver, Admin, authentication, notification or financial source file changes in Stage 1 beyond the three named payment-dispatch files. Stage 2 changes are those listed above; the payout and fare flags remain default-off.
