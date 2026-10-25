# Release 4 local Supabase certification — 21 October 2026

**Source tested:** `7b50421f49f309c5b08b5962f55803a86f2ac940` on `codex/release4-final-payout-engine`. This is local technical evidence, not managed Supabase, Yoco, bank, hosted, or production certification. No production or Phase 05g system was changed. The production payout and universal-fare flags remain disabled.

## Environment and migration rehearsal

Docker 29.9.1 and Supabase CLI 2.121.0 (via `npx`) started a disposable local Auth/Postgres/PostgREST stack under `D:\Users\KN Mudau\Desktop\Websites\moovu-release4-local-cert-20261021`. The database began with a **schema-only copy of an existing local MOOVU fixture**, including `public` and `private`. Its missing Phase 2 policy rows were seeded synthetically. This is not a fresh production-schema export or proof of managed-service parity. All application endpoints and credentials used for connected tests were local. The application payout flag was enabled only in the isolated local Next.js test process to exercise the screens and APIs; the universal fare flag remained off there too.

The four controlled candidates matched the SHA-256 inventory in [the controlled release runbook](./release4-payout-controlled-release-runbook.md) and applied in order to the local database:

| Order | Candidate | Local result |
| --- | --- | --- |
| 1 | `release4-online-payable-total-separation.sql` | PASS |
| 2 | `release4-phase5-booking-fee-allocation.sql` | PASS |
| 3 | `release4-online-payout-control-plane.sql` | PASS |
| 4 | `release4-online-payout-financial-engine.sql` | PASS |

Catalog checks found nine payout tables, all nine with RLS enabled, eight non-internal payout triggers, no direct `authenticated` SELECT grant on payout tables, and no payout-table read policies. A deliberate reapplication of the control-plane candidate stopped on the existing fee-evidence policy; it did not silently duplicate the policy. **The sequence must not be rerun automatically**; use the runbook's migration-history preflight before any future controlled deployment. The local import required creation of `private` before finishing the `public` schema; no pinned candidate SQL was modified.

## Connected financial and authorization results

Four synthetic local Supabase Auth users were created: Owner, Driver A, Driver B, and Customer. Their profiles and Driver links used the existing MOOVU model. Tokens and passwords are omitted from this report.

| Check | Evidence and result |
| --- | --- |
| Full synthetic payout lifecycle | PASS in an isolated local database clone: completed online trip, 15% commission, 50/50 verified synthetic Yoco fee allocation, MOOVU bank-fee expense, reconciliation, authorized approval, debt reservation, transfer evidence, independent verification, one-time settlement, hold/release, refund exception, and ledger checks. `CONNECTED_SYNTHETIC_PAYOUT_APPROVAL_BANK_AND_LEDGER_PASS` |
| Rounding and debt offset | PASS: half-cent allocation and zero-net/full-debt offset. `CONNECTED_SYNTHETIC_PAYOUT_HALF_CENT_ROUNDING_PASS`; `CONNECTED_SYNTHETIC_FULL_DEBT_OFFSET_PASS` |
| R3 booking fee | PASS: synthetic verified online R3 posts to MOOVU once; synthetic Cash R3 remains a Driver receivable. The isolated test transaction rolled back. |
| Direct Auth/RLS | PASS: Owner, both Drivers, and Customer could not read the payout tables directly or invoke the privileged approval RPC with their own JWTs. |
| Authenticated application API | PASS: Owner listed two synthetic payout batches and approved one through the authorized Admin API; each Driver saw only their own distinct batch; Driver Admin requests and Customer Driver requests were denied. `LOCAL_AUTHENTICATED_ADMIN_DRIVER_PARITY_AND_ISOLATION_PASS`; `LOCAL_NON_ADMIN_APPROVAL_DENIED_PASS`; `LOCAL_OWNER_APPROVAL_PASS` |
| Existing automated suite | PASS: 359/359 tests. TypeScript PASS. ESLint PASS with zero errors and five existing warnings. Production webpack build PASS with 215/215 static pages, using local Supabase variables and both new feature flags off. |

The connected SQL tests use **synthetic payment and bank evidence**. They validate database behavior, not actual Yoco fees, actual transfers, bank statements, or customer receipts from a real provider. Existing assertions for duplicate approval/completion, direct `PAID` denial, nonnegative payout and ledger integrity passed; a live-provider replay was not attempted.

## Authenticated visual evidence

Headless Edge signed in as the synthetic local Owner and Driver A and captured payout screens at **1440×900** and **390×844**. The Admin payout list, expanded breakdown, approval controls, and transfer controls rendered. Driver payout summary and expanded history rendered with the authorized Driver's batch. The mobile screenshots show the existing fixed navigation over part of the scrollable page, but the payout details remained reachable by scrolling; no source presentation change was justified from this local capture.

Screenshots are in `D:\Users\KN Mudau\Desktop\Websites\moovu-release4-local-cert-20261021\screenshots\`:

- `admin-payout-list-{desktop,mobile}.png`
- `admin-approval-breakdown-{desktop,mobile}.png`
- `admin-transfer-controls-{desktop,mobile}.png`
- `driver-payout-summary-{desktop,mobile}.png`
- `driver-payout-history-{desktop,mobile}.png`

These are **local synthetic authenticated** screenshots, not hosted staging or production. The screenshot harness first encountered a local Phase 2 application/database mode mismatch; aligning the *local test process* to the synthetic database's `AUTHORITATIVE` mode resolved it. No business logic changed.

## Release boundary

Local engineering rehearsal: **PASS**. Controlled production activation: **NOT READY**. Before production use, the owner still needs a current managed Supabase compatibility and recovery check; approved migration execution and deployment authorization; trusted Yoco fee/settlement evidence and VAT/accounting classification; an independent bank statement and beneficiary-matching intake; and the relevant Driver consent/legal approvals. Real bank payout finalization remains blocked until independent evidence exists. Physical or hosted acceptance and live-provider behavior were not certified locally.

The next production sequence remains in [the controlled release runbook](./release4-payout-controlled-release-runbook.md). Do not enable `MOOVU_ONLINE_PAYOUTS_ENABLED` or `MOOVU_UNIVERSAL_FARE_23_ENABLED`, apply these candidates to production, or initiate a bank transfer based on this report alone. Application-only rollback must retain posted financial records; use compensating ledger entries for financial correction rather than destructive restoration.
