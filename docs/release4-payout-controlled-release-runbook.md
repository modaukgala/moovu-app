# Release 4 payout controlled release runbook

Candidate source: `11326203e0cd2f0806055b35926dc7a532cb5a38` plus this readiness-only documentation commit. No production migration, deployment or activation has occurred. Live rollback reference `dpl_kK8DkpyttdFDawzSuapXDP4kEi93` was read-only inspected as `READY` on 21 October 2026.

## Decision and evidence

The Release 4 payout engine is locally implemented and tested. **Do not stage for production activation yet.** The available Phase 05g managed project `tangtlmdpnvmoviwrgvd` is shared and lacks `online_payout_batches`, `online_payout_fee_evidence`, `online_payout_beneficiaries`, `release4_draft_online_payout` and `release4_review_payout`. Its read-only catalog check proves it cannot rehearse the migration without adding the missing control plane and affecting other disposable work. The exact source commit passed 359/359 automated tests, TypeScript, ESLint with no errors, webpack production build with 215/215 static pages, and local PostgreSQL 17 synthetic payout/concurrency tests. The R3 booking-fee correction test was rerun on `release4_finance_20261020` and rolled back successfully. These are not hosted Auth, Yoco or bank tests. No authenticated payout screenshots exist.

## Ordered candidate SQL inventory

These are candidate SQL files, not approved production migration-history entries. Pin these hashes before a future managed rehearsal and again before cutover:

| Order | File | SHA-256 |
| --- | --- | --- |
| 1 | `docs/release4-online-payable-total-separation.sql` | `05B877FE906CEAF1233B46931C21D5D55430D69D935026E9A279DE738D951F7C` |
| 2 | `docs/release4-phase5-booking-fee-allocation.sql` | `AF6956B37CC1D86E42E3059590E0599524CD69FD46370FCD72C46756F4C7BBD5` |
| 3 | `docs/release4-online-payout-control-plane.sql` | `68B888DF7E3CB083BBDF2231842DC2E230BF1FE78361275C1025A1B2509C2D1C` |
| 4 | `docs/release4-online-payout-financial-engine.sql` | `5688034B9129F1D2A6CD6E1BD16A48672EAE053CC177514726239519893B157E` |

The Phase 1 ledger, Phase 2 commission position, Phase 3 verified online payment/payable, Phase 5 policy columns and their existing Auth/RLS grants must predate these candidates. Order 2 is a separate dormant R3 correction; it must not be activated without historical-impact and accounting approval. Each file has its own transaction boundary. Do not use repository-wide migration push or migration-history repair. Prepare versioned, reviewed migration files and rehearse them on a dedicated managed non-production project before production execution. Verify pre/post schema, function ownership and search paths, RLS, grants, triggers, indexes, migration history, 15% commission and ledger balancing. Use the authorized database role, `ON_ERROR_STOP`, bounded `lock_timeout` and `statement_timeout`, and stop on the first error.

## External evidence gates

**Yoco:** The checkout/webhook path establishes payment status and amount, not the actual processing fee. Yoco's official payment API documents `processing_fees`, but merchant access to that API for MOOVU Checkout payments is unverified. Yoco's payout export can match its `Online Reference` to the retained Checkout ID; the export must also independently establish the actual fee and VAT basis for the same payment. Do not import an estimate or a public list price. A restricted intake needs source-file digest, exact payment/checkout/amount match, duplicate-source protection, independent reviewer and immutable evidence. No production intake is available yet; approval must remain blocked without verified fee evidence.

**Bank:** The Admin route records a transfer assertion only. The settlement RPC requires a distinct importer with bank transaction reference, source digest, amount, beneficiary fingerprint and transfer reference, then a second Admin. The importer exists as a privileged database boundary, but no trusted bank statement feed or owner-approved operator procedure is connected. `LOCAL_SYNTHETIC` evidence is accepted only in the named local test database. A real payment must never be marked paid from proof of payment alone.

**Contract and accounting:** Owner policy approves the 50/50 split, but Driver consent/effective date, provider terms, VAT and expense treatment, beneficiary verification and after-paid refund/chargeback recovery rules still require documented review. The policy row defaults disabled. Posted money must be corrected with new compensating entries; never edit or reverse the old transaction in place.

## Controlled cutover after gates pass

1. Freeze the exact reviewed source and SQL hashes; confirm clean checkout and no unrelated files. Verify the then-current live deployment and keep its immutable ID for application rollback.
2. In a dedicated managed non-production project, apply the four candidates in the table order, run authenticated Owner/Admin/Driver tests, cross-Driver denial, unauthorized RPC denial, full synthetic payout, failed/refunded payout, and two-session approval/settlement races. Capture real desktop/mobile Admin and Driver screenshots. Do not use production identities or send money.
3. Record a current, independently restorable production backup and a write-preserving cutover boundary. Compare financial invariants and unresolved payment/refund obligations. Never use an older snapshot to overwrite later legitimate writes.
4. Keep `MOOVU_ONLINE_PAYOUTS_ENABLED=false` and `MOOVU_UNIVERSAL_FARE_23_ENABLED=false` in the production target. Preserve existing Yoco webhook ingress and payment processors. Verify flags by a supported owner-controlled effective-configuration check before build; do not infer their values from this example file.
5. Stage an unaliased Production-target build of the exact reviewed commit. Verify project, source identity, READY, routes, logs and no live aliases. Run non-mutating Customer, Driver and Admin smoke checks.
6. Only after all gates pass and separately approved: apply the exact ordered migrations using the reviewed runner and authorized role, verify history/objects/RLS/grants/ledger and confirm policy still disabled. Promote the exact staged build. Recheck booking, Driver, Admin, payment webhook, notification routes and financial invariants.
7. Activation is a later independent decision: load real actual-fee and beneficiary evidence, verify consent and independent bank intake, explicitly approve the policy row and payout flag, monitor draft/approval/transfer/settlement. Keep universal fare increase independently OFF unless separately approved.

If application smoke checks fail, restore the previously verified Vercel deployment while retaining additive schema and all current trips, payments and ledger writes. If a migration fails, stop; use forward repair only after diagnosis and review. If a payout posts incorrectly, hold later payouts and post a documented compensating transaction after independent evidence review. Do not restore a stale database snapshot over legitimate post-snapshot money activity.
