# MOOVU Release 4 financial certification — connected local assessment

Status: **not approved for activation or deployment**. The universal standard-fare increase is server controlled by `MOOVU_UNIVERSAL_FARE_23_ENABLED` and defaults to `false`. No pricing activation date, database migration, provider charge or production write was performed. The dormant Pay Online-only adjustment was removed from this candidate.

## Active-policy separation

The existing fare engine still calculates Go and Go XL using their own base, distance, time, minimum, discount and surge rules. When the new flag is explicitly enabled later, `priceStandardFare` applies 230 basis points to that final engine fare **once**, in integer cents, rounding half up. Cash and Pay Online use the same priced trip fare; payment method is not an input. The present Customer booking UI supports Cash and Pay Online. Transfer is not a selectable Customer method and was not introduced here. Existing Admin manual fare overrides remain separate and require a reason.

| Engine fare | New standard fare | 15% commission | Driver trip remainder |
| ---: | ---: | ---: | ---: |
| R40.00 | R40.92 | R6.14 | R34.78 |
| R76.00 | R77.75 | R11.66 | R66.09 |
| R100.00 | R102.30 | R15.35 | R86.95 |

The authenticated quote endpoint and booking endpoint calculate the same versioned fare. Customer confirmation sends the version and cents; booking rejects a stale or mismatched quote before inserting a trip. An Admin-created standard trip first requests a server quote and requires a second review if its displayed fare changed. The stored trip fare remains locked; completion uses the stored fare or the already established Phase 5 Driver fare basis. The Yoco checkout continues to charge the confirmed trip payment total. Existing trips and payment attempts are never repriced by this code.

## Reconciliation findings

| Area | Evidence and result |
| --- | --- |
| Locked fare, OTP and completion | Local locked-fare and completion contract tests pass. No connected trip lifecycle was run for this candidate. |
| Commission | Local authoritative contract and new 15% rounding tests pass for Go/XL and the examples above. Live policy values were not queried. |
| Driver payable versus provider total | **Confirmed dormant Phase 3 SQL defect**: the installed function equates payment-attempt cents with Driver fare cents. The candidate correction compiled on the isolated schema clone. It now permits a distinct Driver basis only with a Phase 5 policy snapshot and verifies that the locked Customer total equals the provider amount. No positive Phase 5 payment/payable posting was executed. The current app does not call this Phase 3 payable RPC, so this SQL is **not required for the active fare model** and is not an approved production migration. Its separate payment remainder still needs an accounting policy. |
| Posting idempotency and balances | Connected PostgreSQL test on synthetic Cash Go data: a R77.75 locked fare posted R11.66 commission once; a replay and two independent concurrent callers returned the same result. Exactly one financial transaction, two balancing ledger entries and one parity reconciliation row remained. This does not certify all completion/refund paths. No production Driver balances were queried. |
| Debt warning and threshold | Code reads the policy's 5,000-cent threshold, but `phase2FinanceState` has `warning: false` and the existing `20260929150106_retire_commission_operational_lock.sql` reports `financially_eligible: true`. An R40 warning and R50 operational block are **not** established by current code. Policy clarification is required before changing this retired control. |
| Cancellation and no-show | Existing local Phase 4 policy tests pass; no new fee policy was added. No connected cancellation or refund test was run for this candidate. |
| Online lifecycle, refund, reversal, partial settlement | Existing local contract tests pass; LIVE Yoco acceptance and connected non-production provider fixtures were not run here. Provider capture and refund outcomes remain unverified. |
| Customer receipts and Admin totals | Both continue to read persisted trip/payment records. No authenticated connected cross-role reconciliation was run; end-to-end parity remains unverified. |
| Separate Phase 5 fee/credit policy | Unchanged. Its ride fare basis receives the priced standard fare when enabled; its fee/credit algorithm was not altered. This report does not certify its separate accounting. |

## Validation and release boundary

### Connected local database evidence, 20 October 2026

Docker PostgreSQL 17 contains an existing local disposable MOOVU fixture. A new database, `release4_finance_20261020`, was created from that fixture's **schema only**; no Auth users or trips were copied. Source and clone each had 86 public tables, 86 RLS-enabled public relations, 47 public policies, 124 public functions and 58 non-internal public triggers. The clone uses `supabase_admin` ownership, so this is not managed Supabase role equivalence. All new Auth identities, Driver, Customer, trips and ledger rows were synthetic and confined to the clone. `scripts/release4-connected-finance.sql` rejects every other database name; its normal mode rolls back all fixture writes.

| Scenario | Local connected result |
| --- | --- |
| Existing booking snapshot | PASS: R76 locked fare and 1,500-bp commission snapshot persisted in the clone. |
| New Cash Go commission | PASS: R77.75 locked fare, R11.66 commission and R66.09 Driver net. |
| Duplicate and concurrent commission posting | PASS: one transaction, two balanced entries, one parity record after sequential replay and two independent concurrent PostgreSQL sessions. |
| Proposed payable SQL schema compatibility | PASS for compilation on the clone; positive online payable execution, RLS behavior and Phase 5 accounting remain unverified. |
| Flag-disabled and flag-enabled authenticated quotation and booking for Cash/Transfer/Pay Online | BLOCKED: no isolated hosted or local API/Auth stack was bound to this clone. Local pricing contract tests pass, but SQL trip inserts are not equivalent to API booking. Transfer is not a Customer-selectable method in current source. |
| Go XL, OTP completion, receipt, Admin totals, cancellation/no-show, refund/reversal and partial/full settlement | NOT EXECUTED in this connected clone. Existing unit/contract tests cover portions of these paths but cannot establish connected certification. |
| Yoco hosted TEST checkout and signed callback | BLOCKED: no isolated provider sandbox credentials or webhook endpoint available for this clone. No LIVE charge or refund was attempted. |

The local clone is deliberately retained for reproducibility; it contains only synthetic test data. It must not be mistaken for a dedicated managed staging project or a production recovery point.

Final local checks on the candidate source: 345/345 automated tests pass; TypeScript passes; ESLint has zero errors and five pre-existing unrelated warnings; the Next.js production build compiles and generates 212/212 static pages. Diff whitespace and a scoped credential-pattern scan pass. The build uses local build-only Supabase placeholders and exercises compilation/page-data generation, not authenticated Supabase, hosted Yoco or Firebase behavior. No production schema, environment variable, pricing flag or deployment was changed.

Before any activation: run authenticated quote-to-booking, completion, receipt and Admin reconciliation for both flag states on a properly bound disposable app and database; validate Go XL and all payment methods that are actually supported; exercise cancellation, no-show, refund, reversal and settlement with synthetic records; obtain isolated Yoco TEST evidence; resolve whether R40 is informational and whether the retired R50 operational lock should return. If the dormant Phase 3 payable seam will be activated, review its accounting policy and separately approve a migration after positive connected testing. No Release 4 production migration sequence is approved now. Rollback for the application candidate is to retain the current live deployment and leave the pricing flag OFF; already-confirmed fares must remain locked, and an old database snapshot must not overwrite later legitimate writes. Do not treat compilation or local contract tests as production financial certification.
