# MOOVU Phase 1 Ledger Architecture

## Boundary and purpose

This is an **operational product subledger that can feed external accounting**. It is not a statutory/general ledger and does not assert tax, IFRS, trust-money, revenue-recognition, or legal ownership treatment. Gross passenger activity, driver-collected cash, MOOVU receipts, driver debt, driver payables, and assessed customer liabilities remain distinct.

Phase 1 Stage A creates only reviewed local schema, contracts, helpers, tests and documentation. `PHASE1_LEDGER_WRITE_ENABLED` and `PHASE1_LEDGER_READ_ENABLED` are hard-disabled. Existing Phase 0 tables and RPCs remain the live source.

## Money contract

- Ledger amounts are positive `BIGINT` ZAR cents; side is `DEBIT` or `CREDIT`.
- One transaction contains one currency, initially `ZAR` only.
- Existing `NUMERIC` rand values convert with explicit half-up rounding: `round(value * 100)::bigint`.
- TypeScript parses decimal text into `bigint`; it never uses floating point as ledger truth.
- Rand formatting occurs only at presentation boundaries.

## Core model

`financial_accounts` contains stable codes, category, owner, currency, normal side and status. Platform accounts have no owner ID. Driver and Customer accounts require an owner ID. The same owner/category/currency combination is unique.

`financial_transactions` is the business-event posting header. A stable idempotency key and SHA-256 payload hash make retries deterministic. Source type/type/source ID uniqueness blocks duplicate money under another key. Posted corrections use a linked reversal.

`financial_ledger_entries` contains immutable, positive debit/credit lines. A deferred database constraint trigger rejects posting unless there are at least two entries, one currency, and equal debit and credit totals.

The posting RPC locks accounts, validates the source, validates the payload, inserts the header and every entry, and posts atomically. Identical retries return the original ID; conflicting retries fail. No client role receives direct mutation privileges.

## Accounts and normal sides

| Category | Normal side | Meaning |
| --- | --- | --- |
| `DRIVER_COMMISSION_DEBT` | Debit | MOOVU receivable attributable to one driver |
| `COMMISSION_REVENUE` | Credit | MOOVU commission earned under the stored trip snapshot |
| `BOOKING_FEE_REVENUE` | Credit | MOOVU booking fee, only when a distinct authoritative amount exists |
| `PAYMENT_CLEARING` | Debit | Money confirmed received or an explicitly documented operational clearing leg |
| `UNAPPLIED_FUNDS` / `DRIVER_UNAPPLIED_CREDIT` | Credit | Confirmed money not yet applied to debt or another obligation |
| `SUBSCRIPTION_PAYMENT_CLEARING` | Debit | Confirmed subscription money received |
| `DEFERRED_SUBSCRIPTION_REVENUE` | Credit | Confirmed subscription receipt not yet recognized as earned |
| `SUBSCRIPTION_REVENUE` | Credit | Subscription amount recognized under an approved policy |
| `CANCELLATION_NO_SHOW_RECEIVABLE` | Debit | Assessed but uncollected customer liability |
| `CANCELLATION_NO_SHOW_REVENUE` | Credit | Fee recognized only when approved policy permits |
| `DRIVER_EARNINGS_PAYABLE` | Credit | Amount MOOVU owes a driver; not used to imply MOOVU owes driver-collected cash |
| `DRIVER_EARNINGS_CONTROL` | Credit | Operational gross-driver-earnings control, not a MOOVU cash/revenue account |
| `DRIVER_COMPENSATION_PAYABLE` | Credit | Authorized compensation not yet paid/offset |
| `PAYOUT_CLEARING` | Debit | Future confirmed payout movement |
| `ADJUSTMENT_CLEARING` | Debit/Credit by entry | Approved correction suspense/control account |
| Customer categories | As documented at activation | Design-only; no Customer wallet is exposed in Stage A |

## Source precedence

1. Completed fare, commission rate, commission amount and driver net: the immutable completed `trips` snapshot. A wallet commission row is corroboration, not a second event.
2. Commission settlements: `driver_settlements`; linked payment-request fields provide review context only.
3. Subscription money: approved/recorded `driver_subscription_payments`; submission or proof alone is not collection.
4. Cancellation/no-show assessment: `trip_cancellation_fees`; the trip columns are corroboration. Assessment does not prove collection.
5. Cancellation credit: `driver_wallet_transactions(tx_type='cancellation_credit')`, tied to the fee/trip; do not also count the fee split as paid compensation.
6. Cached `driver_wallets` balances are projections and reconciliation targets, never migration events.
7. `driver_payment_requests` are workflow evidence. Only Phase 0 applied amounts and linked settlement/subscription records establish financial effect.

Conflicting, duplicate, missing, or orphaned sources are reported and block that source from backfill. Nothing is fabricated or silently repaired.

## Posting examples

All examples are conceptual Stage C mappings. `D` and `C` amounts are cents and balance within one transaction.

1. **Completed Cash/Transfer trip:** driver-collected gross fare is recorded in operational control legs, not MOOVU cash. `D payment clearing control / C driver earnings control` for gross, an equal reversing control pair to show direct collection, plus `D driver commission debt / C commission revenue` for the stored commission snapshot. Exact control-account activation requires owner approval of the driver-collected-cash presentation.
2. **Driver earnings and commission:** gross/net/commission come from the same `TRIP_FINANCIAL_COMPLETION`; do not post separate transactions that double-count fare. Commission: `D driver commission debt / C commission revenue`.
3. **Booking fee:** `D driver or customer receivable / C booking-fee revenue` only when a distinct stored booking-fee source and collection policy exist. Current production data does not provide a reliable distinct amount, so this is blocked from legacy posting.
4. **Driver commission settlement:** `D payment clearing / C driver commission debt` for the applied amount.
5. **Settlement overpayment:** one transaction preserves full receipt: `D payment clearing` for total, `C driver commission debt` for applied debt, `C driver unapplied credit` for excess.
6. **Subscription payment and activation:** confirmed receipt is `D subscription payment clearing / C deferred subscription revenue`; activation/earning is `D deferred subscription revenue / C subscription revenue`. Submission or waiting confirmation posts nothing.
7. **Cancellation fee assessed, uncollected:** `D cancellation/no-show receivable / C adjustment clearing assessment control`; no cash or earned revenue is asserted.
8. **Cancellation fee collected:** `D payment clearing / C cancellation/no-show receivable`; recognition is a separate balanced reclassification only when policy permits.
9. **No-show fee:** same assessed/collected separation as cancellation, using transaction type `NO_SHOW_FEE` and a unique fee source.
10. **Driver cancellation compensation:** authorization is `D adjustment clearing / C driver compensation payable`; payment/offset is a later source-backed transaction. Current cancellation credits must not be counted twice.
11. **Adjustment and reversal:** an Owner/Admin adjustment requires a source, actor and reason. Reversal creates one new transaction with every original side inverted; the original entries are never updated or deleted.
12. **Future online-paid trip:** design only: `D payment clearing / C customer or driver obligation`, followed by revenue, driver payable and fee allocations after processor settlement policy exists.
13. **Future driver payout:** design only: `D driver earnings payable / C payout clearing`, then clearing against confirmed bank/processor settlement.
14. **Future refund:** design only: reverse the source allocation and move confirmed money through payment clearing; never update the original posting.

## State, reversals and projections

Headers support `PENDING`, `POSTED`, `REVERSED`, and `FAILED`; only posted entries feed projections. Stage A uses immutable posted originals plus a posted `REVERSAL` transaction. Effective reversal status is derived from the unique linked reversal, avoiding mutation of original money.

Projection SQL sums posted entries by account and normal side. Commission owed, earnings activity, credits, compensation payable, payable-to-driver and subscription totals are always reconstructible. Existing wallet values remain operational until a later owner-approved parity cutover.

## Security

- Tables have RLS enabled and no client policies.
- `PUBLIC`, `anon`, and `authenticated` receive no table mutation or RPC execution.
- `service_role` receives read access and explicit execution only on account, posting and reversal RPCs.
- Posting validates the real source and active account currency; reversal additionally requires an Owner/Admin profile actor and reason.
- Functions use fixed `search_path` and schema-qualified objects. Metadata must exclude names, phones, IDs, payment proof URLs, tokens and other unnecessary personal data.

## Transition and rollback

Stage A stops with local files. Stage B may add a disabled shadow adapter. Stage C requires separately approved disposable Supabase execution, concurrency, RLS, rollback and reconciliation tests. Stages D-G require separate owner approvals.

Before any shadow posting, rollback is simply not applying the SQL. After schema-only disposable application, rollback may drop only empty Phase 1 objects. Once any real posting exists, never drop or rewrite ledger history; disable feature flags and use forward correction/reversals.

## Decisions required before Stage C/D

- Authoritative distinct booking-fee source and whether it is included in or added to fare.
- Accounting presentation of driver-collected Cash/Transfer gross activity.
- When cancellation/no-show assessments become collectible and when revenue is recognized.
- Whether driver compensation is payable, debt offset, or both under each policy state.
- Subscription revenue recognition timing versus deferred revenue.
- Legal/accounting review of account names and external general-ledger export mapping.

