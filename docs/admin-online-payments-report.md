# Admin Verified Yoco Payments

Route: `/admin/online-payments`, under Payments > Online Payments.

## Authority

The report reads canonical `online_payment_attempts` (Customer Trip) and
`driver_online_payment_attempts` (Driver `COMMISSION_DEBT`). Included rows require
provider YOCO, state SUCCEEDED, non-null verified_at and provider_payment_id,
positive ZAR amount, and a linked `online_provider_events` record with VERIFIED
trust, PROCESSED state and succeeded provider status. Provider event retries are
not report rows. One provider_payment_id produces one entry across both domains.

Customer attempts link to customers and trips by customer_id/trip_id. Driver
attempts link to drivers and payment_ledger_transaction_id. The trusted Driver
processor posts directly to the ledger; this report does not invent an additional
commission settlement record. Raw provider payloads, redirect URLs and card data
are never returned.

## Timestamp Limitation

Existing records store verification time, not the provider's actual transaction
time. The UI explicitly displays Verified at in Africa/Johannesburg (SAST).
Payment and checkout IDs remain the exact merchant reconciliation identifiers.
Do not relabel verification time as the actual Yoco payment completion time.

## Read-only Database Addition

Migration: `20260926124203_admin_verified_yoco_payments_report.sql`.
Adds one STABLE SECURITY INVOKER RPC. Only service_role can execute it; HTTP
access first requires the existing authenticated owner/admin role check. No
tables, financial rows, payment processors, ledger semantics or RLS are changed.
Rollback: drop `public.admin_verified_yoco_payments_report(timestamptz,timestamptz,text,integer,integer)`.

Filters use inclusive starting dates and exclusive end timestamps. All summary
totals and paginated rows use the same database snapshot and filtered dataset.
Amounts are summed in integer cents, not frontend floating-point arithmetic.
The first version covers Customer Trip and Driver Commission only, not subscription
payments, provider fees, merchant bank settlement, pending or failed attempts.

## Validation

- `npm test`, `npm run lint`, `npm run build`, `npx tsc --noEmit`.
- Disposable-only `scripts/online-payments-report-test.sql`: rollback fixtures,
  customer/driver amounts, retry deduplication, failed/pending exclusion, totals,
  filters, pagination and denied client RPC privileges.
- `scripts/online-payments-report-http-test.mjs`: disposable auth users, actual
  HTTP role gates, then deterministic layout fixtures at 360/390/430/1280px.
  Requires PHASE3_E2E_* disposable credentials and QA_PLAYWRIGHT_PATH to an
  existing Playwright installation. No real payment is performed.
- Refocus refresh and manual refresh only; no periodic polling or webhook change.
