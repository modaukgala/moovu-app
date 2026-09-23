# MOOVU Phase 2 Commission and Driver Finance Audit

Date: 2026-09-07  
Scope: audit, business-rule discovery, financial architecture design, and implementation planning only  
Production Supabase ref inspected read-only: `mvazbszenqahgqpznhhq`

## Audit boundary

No production mutation, migration, ledger posting, backfill, feature-flag change, commit, push, deployment, or application-source change was performed. Aggregate queries avoided customer and driver identity data.

Evidence labels used below:

- **VERIFIED CURRENT**: confirmed in production and, where relevant, current source.
- **LOCAL ONLY**: present in the dirty working tree but not proven deployed.
- **PRODUCTION ONLY**: observed in production without proven deployed-source parity.
- **CLAIMED - NOT VERIFIED**: reported previously but not independently provable.
- **PROPOSED**: Phase 2 design only.
- **OWNER DECISION REQUIRED**: business policy that must be approved before implementation.

## Source-version matrix

| System | Version or commit | Verified? | Notes |
|---|---|---:|---|
| Local repository | `main`, `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4` | Yes | Working tree already contained extensive modified and untracked Phase 0/1 work before this audit. |
| GitHub `origin/main` | `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4` | Yes | Matches local HEAD, not the dirty working tree. |
| Vercel production | deployment `dpl_D4p7gQM7RqqTVtPMqPaw7wf8Rbyc`, Ready | Partial | Deployment metadata did not expose a source commit, so exact parity with local HEAD or dirty source cannot be proven. |
| Production Supabase | `mvazbszenqahgqpznhhq`, PostgreSQL 17.6.1.063 | Yes | Healthy in `eu-west-1`; inspected read-only. |
| Phase 0 database | migrations through `20260903035045 phase_05h_005_actor_foreign_key_alignment` | Yes | Hardened RPCs exist, are SECURITY DEFINER, use fixed `search_path`, and are not executable by `anon` or `authenticated`. |
| Phase 1 database | `20260907065058 phase1_financial_ledger_foundation` | Yes | Ledger schema exists, is empty, and direct mutation is denied. |

**Drift conclusion:** The database is ahead of the committed Git tree. The dirty local tree contains the corresponding Phase 0/1 application and documentation work, but the Vercel commit cannot be established. Application behavior described from these files is therefore **LOCAL ONLY** unless independently demonstrated by production data or database contracts.

## Phase 0 and Phase 1 baseline

### Phase 0

**VERIFIED CURRENT**

- Hardened financial/trip RPCs include `phase05b_complete_trip`, `phase05b_driver_debt`, `phase05b_refresh_driver_wallet`, `phase05b_review_driver_payment`, `phase05b_record_settlement`, `phase05b_activate_subscription`, `phase05b_update_subscription`, `phase05b_cancel_trip`, and `phase05b_mark_no_show`.
- The inspected RPCs are `SECURITY DEFINER`, set `search_path=public, pg_temp`, deny execution to `anon` and `authenticated`, and allow `service_role`.
- Current production RPCs serialize driver-finance operations with a driver-scoped advisory transaction lock and use stable business-event keys for replay protection.
- Owner/admin are the production financial reviewers. Dispatcher/support are excluded from settlement, payment-review, and subscription-finance mutation RPCs.

### Phase 1

**VERIFIED CURRENT**

- Tables: `financial_accounts`, `financial_transactions`, `financial_ledger_entries`.
- All three tables have RLS enabled and zero policies.
- `anon` and `authenticated` have no direct insert/update privileges.
- `service_role` has read access but no direct insert privilege; mutation occurs through approved Phase 1 functions.
- `phase1_post_financial_transaction`, `phase1_reverse_financial_transaction`, and `phase1_ensure_financial_account` are protected SECURITY DEFINER functions with fixed search paths.
- No Phase 1 function is executable by `anon` or `authenticated`.
- Integer `amount_cents bigint` with a positive-value check is used for ledger entries.
- Unique idempotency keys, source identities, reversal uniqueness, and terminal trip-outcome uniqueness are database-enforced.
- Deferred balancing and immutable-entry/transaction guards are installed.
- Row counts are zero for accounts, transactions, and entries.

**LOCAL ONLY**

- `src/lib/finance/ledgerFoundation.ts:6-7` hard-disables both `PHASE1_LEDGER_WRITE_ENABLED` and `PHASE1_LEDGER_READ_ENABLED`.
- No Vercel environment variable named for ledger read/write exists. Because the deployed source commit is unknown, the local constants are not direct proof of deployed code. The zero production ledger rows independently prove that no production ledger posting has occurred.

## Current finance architecture

### Actual flow

```text
TRIP BOOKED
  -> fare fields and ride option stored on trips
  -> commission not yet economically posted
TRIP ASSIGNED / ACCEPTED
  -> subscription, approval, availability and legacy wallet debt eligibility checked
TRIP COMPLETED
  -> Phase 0 RPC locks trip and driver-finance scope
  -> authoritative fare selected from stored fare fields
  -> rate selected from ride option (Go 10%, Go XL 12%, fallback 9.5%)
  -> commission and driver net snapshot written to trips
  -> one legacy commission debit written to driver_wallet_transactions
  -> driver_wallets projection recalculated
DRIVER PAYMENT / SETTLEMENT
  -> owner/admin approval through hardened RPC
  -> driver_settlements and/or driver_subscription_payments written
  -> legacy wallet projection recalculated
  -> any excess remains only on the payment request
PHASE 1 LEDGER
  -> installed but not read from or posted to
```

The completion path above is verified in the production `phase05b_complete_trip` definition. The Next.js callers in `src/lib/trips/completeTripServer.ts:234-245` and the fail-closed wrapper are **LOCAL ONLY** because deployment parity is unresolved.

## Current verified business rules

| Rule | Current verified behavior | Evidence and classification |
|---|---|---|
| Go commission | 10% | **VERIFIED CURRENT**: all 133 completed production trips are Go at 10%; production completion RPC selects 10%. Local fare rule: `src/lib/domain/fare.ts` `RIDE_OPTION_RULES.go`. |
| Go XL commission | 12% | **VERIFIED CURRENT contract**, not production usage: production completion RPC selects 12%; no completed Go XL rows exist. Local fare rule matches. |
| Legacy fallback commission | 9.5% | **VERIFIED CURRENT contract**: production completion RPC fallback. Local constant `src/lib/finance/commission.ts:3,20`. No completed production row currently uses it. |
| Commission lock time | Completion | **VERIFIED CURRENT**: production completion RPC computes and stores fare, rate, commission and net atomically. |
| Existing completed trip repricing | Not performed by completion replay | **VERIFIED CURRENT**: authoritative completion event produces replay result; uniqueness prevents a second trip commission transaction. |
| Warning threshold | 85% of R100 = R85 | **LOCAL ONLY** UI: `src/lib/finance/commission.ts:5-6`, `src/app/driver/page.tsx:1270-1278`. |
| Restriction threshold | R100 balance due | **VERIFIED CURRENT contract**: production assignment RPC rejects debt at or above R100; local dispatch checks `src/lib/dispatch/dispatchCandidates.ts:157,226`. |
| Subscription plans | Daily R45/1 day; Weekly R100/7 days; Monthly R250/30 days | **VERIFIED CURRENT contract** in production activation/payment RPCs; local `src/lib/finance/driverPayments.ts:1-16`. |
| Subscription requirement | Active, unexpired subscription required by atomic assignment; local candidate flow permits active/grace but also requires future expiry | **VERIFIED CURRENT / LOCAL ONLY divergence**: production manual assignment requires exactly active; local discovery accepts active/grace at `src/lib/dispatch/dispatchCandidates.ts:119-120`. |
| Subscription extension | Extends from later of current expiry or now | **VERIFIED CURRENT contract** and local `src/lib/finance/driverPayments.ts:39-56`. |
| Late cancellation | Go R20 (driver R13 when assigned/arrived); Go XL R30 (driver R20) | **VERIFIED CURRENT contract** in production cancellation RPC. |
| No-show | Go R30 (driver R22, MOOVU R8); Go XL R40 (driver R30, MOOVU R10) | **VERIFIED CURRENT contract** in production no-show RPC. |
| Cancellation/no-show collection | No collection state exists on `trip_cancellation_fees` | **VERIFIED CURRENT**. A fee row is assessment evidence only. |
| Driver compensation | Legacy `cancellation_credit` reduces commission owed | **VERIFIED CURRENT contract**. It is an offset, not proof cash was paid or customer money collected. |
| Payment approval | Owner/admin only; atomic request lock, allocation, records, wallet refresh and outbox | **VERIFIED CURRENT contract** in `phase05b_review_driver_payment`. |
| Overpayment | Stored as `driver_payment_requests.unapplied_excess` | **VERIFIED CURRENT**, but no reusable credit-liability account or allocation mechanism exists. |
| Automatic restoration | Assignment becomes eligible once recalculated debt is below R100 and subscription/other conditions pass | **VERIFIED CURRENT contract**; no distinct durable finance-state machine exists. |

## Source-of-truth matrix

| Value or operation | Authoritative source today | Compatibility projection | Writer | Reader | Idempotency | Production use / drift |
|---|---|---|---|---|---|---|
| Quoted/original fare | `trips.fare_amount`, `original_fare`, fare fields | Receipt/UI fields | Booking routes | Customer/Driver/Admin | Trip identity | Current; multiple fare columns require a strict precedence contract. |
| Final fare | `trips.final_fare` then completion fallback | `fare_amount` | Completion RPC | Receipts/reports | completion event | Current. Seven completed rows do not reconcile to commission/net. |
| Commission rate | `trips.commission_pct` after completion | Wallet tx `meta.commission_pct` | Completion RPC | Driver/Admin | one trip commission | Current: 133 completed at 10%. |
| Commission amount | `trips.commission_amount` and commission wallet tx | `driver_wallets.total_commission` | Completion RPC | Driver/Admin | trip commission uniqueness | Two wallet projections disagree with complete history. |
| Driver net | `trips.driver_net_earnings` | `driver_wallets.total_driver_net` | Completion RPC | Driver/Admin | completion event | Projection matches trip sums; seven trip snapshots conflict with effective fare. |
| Commission owed | `phase05b_driver_debt`: debits/credits less settlements | `driver_wallets.balance_due` | finance RPCs | eligibility/UI | serialized by driver lock | Two wallet balances disagree with recomputation. |
| Settlement | `driver_settlements` | wallet balance | settlement/payment RPC | Admin/Driver | operation key/payment request | Seven rows; no duplicate operation/request keys. |
| Unapplied credit | payment request `unapplied_excess` only | none | payment-review RPC | receipt/API | payment request | No reusable allocation ledger; current approved total is R0. |
| Subscription status/expiry | `drivers` fields | payment/event tables | subscription RPCs; local expiry helper | dispatch/UI | operation key for admin RPC | Four active drivers have expired timestamps. |
| Cancellation/no-show fee | `trip_cancellation_fees` plus trip snapshot | legacy cancellation fields | cancellation/no-show RPC | reports/UI | trip terminal event | Assessment only, not collection/revenue proof. |
| Finance eligibility | assignment RPC plus local dispatch/UI checks | UI warnings | RPC/server/UI | dispatch/Driver | transaction lock at assignment | Duplicated and active/grace behavior differs. |
| Phase 1 ledger balances | dormant tables/functions | none yet | protected Phase 1 RPC | none | strong DB constraints | Zero rows; not authoritative. |

## Commission snapshot integrity

- **VERIFIED CURRENT:** 133/133 completed trips have a commission percentage, commission amount, and driver net; all are Go at 10%.
- **VERIFIED CURRENT:** 133/133 have exactly one non-null-trip commission wallet transaction and its amount matches the trip commission.
- **VERIFIED CURRENT:** seven additional commission transactions have no trip ID. They are legacy financial events and must not be mistaken for duplicate trip postings.
- **VERIFIED CURRENT:** seven completed trip snapshots fail `effective fare = commission + driver net`. The grouped values show stale lower commission/net pairs against later higher fare values. This is historical snapshot drift, not a rounding-cent issue.
- **VERIFIED CURRENT:** no negative values and no fractions smaller than one cent were found.
- **RISK:** trip fields are mutable table columns. Phase 2 must prevent destructive mutation after posting and use reversal/adjustment transactions.
- **LOCAL ONLY:** `src/lib/finance/applyTripCommissionServer.ts:55-136` contains an older sequential helper. No call site was found. It must remain unused or be removed only during an approved implementation pass.

## Complete-dataset reconciliation

All counts are aggregate full-table queries, not default PostgREST pages.

| Check | Population examined | Mismatch / result | Economic meaning and limitation |
|---|---:|---:|---|
| Trips | 230 | 133 completed | Operational population. |
| Completed fare | 133 | R9,764 gross passenger fare | Gross passenger activity, **not MOOVU revenue**. |
| Completed commission | 133 | R951.30 assessed commission | MOOVU commission receivable/revenue basis, not necessarily cash collected. |
| Missing snapshots | 133 | 0 missing rate, commission or net | Driver economics. |
| Invalid/negative/sub-cent | 133 | 0 | Driver economics. |
| Fare = commission + net | 133 | 7 mismatches | Historical trip snapshot inconsistency. |
| Commission tx linkage | 133 | 0 missing, 0 multiple, 0 amount mismatch | One linked debit per completed trip. |
| Null-trip commission tx | 140 commission tx | 7 | Legacy adjustments/charges lack immutable trip source references. |
| Wallet projection | 51 wallets | 2 balance mismatches; 2 total-commission mismatches | Legacy compatibility projection drift. |
| Wallet total driver net/trip count | 51 wallets | 0 mismatches | Projection agrees with completed trip rows for these fields. |
| Wallet balance | 51 wallets | R317 total displayed due | Driver debt projection, not MOOVU cash. |
| Settlements | 7 | R634.30 total; 0 duplicate operation keys; 0 duplicate request links | MOOVU cash/settlement evidence. |
| Approved commission requests | 6 | 5 old approvals have no linked settlement/applied amount; one current request applied R104.60 | Historical approvals predate hardened allocation metadata; cannot infer debt reduction solely from request status. |
| Non-approved requests | 1 rejected | 0 with applied amounts | No early mutation found. |
| Subscription requests | 17 approved, 1 rejected | only 3 approved rows link to `driver_subscription_payments`; R450 applied metadata versus R2,245 submitted | Legacy approvals require evidence mapping; submitted amount is not revenue proof. |
| Subscription state | 54 drivers | 4 marked active with expired timestamps | Eligibility/status drift. |
| Cancellation/no-show fee rows | 23 | 16 free/R0; 3 late/R60; 4 no-show/R120 | R180 assessed liability only; collection not represented. |
| Broken references | relevant wallet, tx, settlement, cancellation sets | 0 | Referential integrity check passed. |
| Phase 1 ledger | all three tables | 0 / 0 / 0 rows | No unexpected posting. |

Limitations:

- No bank statement, payment-processor record, or independent proof-of-payment reconciliation was available. “Collected” cannot be inferred from a fee or submitted payment record.
- Vercel source commit was unavailable, so local route behavior is not classified as deployed.
- The audit did not expose personal identifiers or inspect uploaded proof contents.

## Legacy wallet classification

| Legacy object/type | Meaning | Direction | Future classification |
|---|---|---|---|
| `driver_wallet_transactions.commission` | Commission assessed against driver | Debit increases due | Ledger-derived; retain permanently as legacy evidence; compatibility projection after cutover. |
| `cancellation_credit` | Driver compensation offset against commission | Credit reduces due | Ledger-derived future adjustment/compensation allocation; does not prove cash paid. |
| `driver_settlements` | Accepted payment applied to commission debt | Reduces due outside wallet tx table | Temporarily authoritative cash evidence, then ledger source/compatibility record. |
| `driver_wallets.balance_due` | Recomputed legacy debt projection | Net | Compatibility projection; not a general wallet or available cash balance. |
| `total_commission` | Historical commission debit projection | Aggregate | Ledger-derived future. |
| `total_driver_net` | Sum of completed trip net snapshots | Aggregate | Reporting projection; not cash held by MOOVU. |
| `account_status` | `due` or `settled` from balance sign | Status | Replace with explicit finance-state projection after policy approval. |

Only `commission/debit` was present in the current transaction-type aggregate (140 rows, R992.50). Cancellation credits may be supported by the RPC contract but are not present in that aggregate snapshot.

## Payment, settlement, and subscription risks

1. **High:** Seven completed trips have internally inconsistent financial snapshots. Historical correction must be by approved opening-balance reconciliation and/or explicit adjustments, not silent edits.
2. **High:** Two wallet projections disagree with complete history by R5 and R36.20 respectively. Eligibility currently consumes this projection, so drift can incorrectly restrict or admit drivers.
3. **High:** Approved legacy payment requests are not uniformly linked to settlement/subscription payment records. Approval status alone is insufficient accounting evidence.
4. **High:** `unapplied_excess` records a number but does not create a reusable driver credit liability or allocation history.
5. **High:** Cancellation/no-show rows assess amounts without collection lifecycle states. Current fields cannot support earned revenue or paid compensation claims.
6. **Medium:** Four active subscription statuses have expired dates. Local expiry code writes `expired` (`src/lib/subscriptions/expireDriverSubscriptions.ts:51`) although the production constraint allows only inactive/active/grace/suspended, so the swallowed call at `src/lib/dispatch/offerNextDriver.ts:70` can fail silently.
7. **Medium:** Finance eligibility is duplicated across UI, candidate discovery, nearby-driver checks and assignment RPC. Local discovery accepts grace while the production manual assignment RPC requires active.
8. **Medium:** Money in legacy tables is numeric rand values; Phase 1 correctly uses integer cents. Conversion and rounding policy must be explicit at the transition boundary.
9. **Medium:** Driver and Admin screens consume legacy projections and mixed history. They must not present gross fare, assessed fees, or submitted payments as collected MOOVU revenue.

## Authorization matrix

Current verified protected mutation contract:

| Role | Read own finance | Read all driver finance | Submit payment proof | Approve/reject/settle/adjust | Direct ledger mutation |
|---|---:|---:|---:|---:|---:|
| owner | Yes | Yes | No normal need | Yes | No direct table mutation; trusted server RPC only |
| admin | Yes by admin APIs | Yes | No normal need | Yes | Trusted server RPC only |
| dispatcher | Operational reads only | Limited operational | No | No | No |
| support | Support/operational reads only | Limited operational | No | No | No |
| driver | Own only | No | Yes through authenticated server route | No | No |
| customer | No driver finance | No | No | No | No |
| authenticated | RLS-scoped only | No | No generic privilege | No | No |
| anon | No | No | No | No | No |
| service_role | Trusted server reads/RPC execution | Yes as server requires | Server path only | Executes approved RPC after app authorization | RPC only for Phase 1 posting |

**PROPOSED:** adjustments and reversals should require owner, or admin within an owner-approved limit and mandatory reason. Dispatcher/support must remain prohibited.

## Owner business decisions

| Decision | Current verified rule | Available options | Technical recommendation | Business consequence | Owner choice? |
|---|---|---|---|---|---:|
| Target commission | Go 10%; Go XL 12%; fallback 9.5% | current, 10, 12, 15, 18, 20 | Preserve current snapshots; configure future effective-dated rates | Revenue vs driver retention | Yes |
| Same rate by ride type | Different 10/12 | same or differentiated | Effective-dated ride-type schedule | Simplicity vs differentiated economics | Yes |
| Snapshot timing | Completion | booking, assignment, acceptance, completion | Lock at booking/quote version; confirm immutable snapshot at completion | Predictability and promo handling | Yes |
| Mandatory subscription | Mandatory active/unexpired | remove, optional, alternative plan, transitional, retain | Transitional dual-model only after explicit fairness analysis | Double-charge perception and revenue | Yes |
| Warning threshold | Local 85% of R100 | fixed or earnings-relative | Separate configurable warning from hard restriction | Driver cash-flow pressure | Yes |
| Restriction threshold | R100 | R50/100/150/200/300 or earnings-relative | Effective-dated policy, checked atomically | Credit exposure vs availability | Yes |
| Grace behavior | Local discovery allows grace; assignment differs | time grace, debt grace, pending-payment grace | One DB decision function | Operational consistency | Yes |
| Historical ledger | No backfill | full, opening balance, cutoff, hybrid, none | Cutoff plus reconciled opening balances and exception register | Auditability with lowest duplicate risk | Yes |
| Unapplied credit | Recorded but not reusable | refund, carry, auto-allocate, manual allocation | Liability account with deterministic oldest-debt allocation | Driver trust and cash control | Yes |
| Admin adjustments | No Phase 1 use | owner only; limited admin | Reversal/adjustment only, mandatory reason | Control vs support speed | Yes |
| Cancellation compensation | Commission offset | payable, offset, mixed | Separate authorization, collection, offset and payment states | Avoid paying uncollected fees silently | Yes |
| No-show compensation | Commission offset | payable, offset, mixed | Same explicit state model | Driver fairness and exposure | Yes |
| Payment allocation order | Subscription first for combined, then commission | commission first, subscription first, driver choice, oldest debt | Explicit versioned order stored on payment | Transparency and restriction release | Yes |
| Pending payment | No balance effect | no effect, temporary grace, provisional credit | No accounting effect; optional non-financial grace | Fraud exposure vs driver continuity | Yes |
| Restoration timing | Effective after debt projection falls below limit and other checks pass | submit, confirmation, approval, settlement | After authoritative approval/posting commit | Risk control | Yes |

## Commission-rate examples

Cent-accurate round-half-up-to-cent examples; retention is `100% - rate`.

| Fare | 9.5% commission / net | 10% | 12% | 15% | 18% | 20% |
|---:|---:|---:|---:|---:|---:|
| R40 | R3.80 / R36.20 | R4 / R36 | R4.80 / R35.20 | R6 / R34 | R7.20 / R32.80 | R8 / R32 |
| R60 | R5.70 / R54.30 | R6 / R54 | R7.20 / R52.80 | R9 / R51 | R10.80 / R49.20 | R12 / R48 |
| R100 | R9.50 / R90.50 | R10 / R90 | R12 / R88 | R15 / R85 | R18 / R82 | R20 / R80 |
| R150 | R14.25 / R135.75 | R15 / R135 | R18 / R132 | R22.50 / R127.50 | R27 / R123 | R30 / R120 |
| R200 | R19 / R181 | R20 / R180 | R24 / R176 | R30 / R170 | R36 / R164 | R40 / R160 |

Retention percentages are 90.5%, 90%, 88%, 85%, 82%, and 80% respectively. Higher rates improve gross commission yield but increase churn and double-charge risk while subscriptions remain mandatory. The audit has no cost model sufficient to select a rate.

## Subscription model analysis

| Option | Benefit | Cost/risk |
|---|---|---|
| A. Remove subscriptions | Clear per-trip model; lower entry barrier | Immediate recurring-revenue loss and migration complexity |
| B. Optional subscription | Driver choice | Requires explicit benefit design and prevents accidental double charging |
| C. Alternative plan | Subscription or commission | Fairer segmentation but complex eligibility, pricing and reconciliation |
| D. Transitional retention | Lowest migration blast radius | Temporary overlap must be disclosed and time-bounded |
| E. Mandatory subscription plus commission | Highest direct revenue | Highest affordability, fairness and churn risk |

No option is selected. This is an **OWNER DECISION REQUIRED**.

## Driver and Admin experience audit

**LOCAL ONLY:** Driver finance surfaces exist at `/driver/earnings`, `/driver/commission-payments`, `/driver/subscriptions`, and payment receipts. They show legacy balance due, R100 limit, history, subscriptions and payment status.

**LOCAL ONLY:** Admin surfaces exist for earnings reports, commission payments, payment reviews, settlements, subscriptions and receipts.

Smallest future additions:

- Driver: separately show commission owed, unapplied credit, net owed, finance state, immutable charge/payment list, review status, receipt and dispute link.
- Admin: show the same ledger-derived balance, source references, reconciliation status, pending allocations, restricted drivers, and owner/admin reversal controls with mandatory reasons.
- Do not expose payout, withdrawal, online fare collection, or Yoco concepts before Phase 3.

## Audit conclusion

Phase 0 and Phase 1 database claims are verified and Phase 1 remains dormant. Phase 2 is not ready to implement until the owner decisions are approved and the seven trip inconsistencies, two wallet projection mismatches, historical payment linkage gaps, and expired-active subscriptions have an approved reconciliation policy.

