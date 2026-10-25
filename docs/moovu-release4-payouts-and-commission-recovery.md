# MOOVU Release 4 — Driver payouts and commission recovery

**Decision: not ready for production activation.** This continuation branch adds a local-only, default-off draft payout control plane and read-only views. It cannot approve or pay a batch, recover debt, charge a Customer, contact Yoco, transfer money, or turn on the universal fare flag. Baseline: `a470732f40926c701862eeec1aa85092bc010c12`; the continuation commit is identified in the handoff with `git rev-parse HEAD`.

## Financial architecture and source of authority

| Amount | Current authority | Release 4 treatment |
| --- | --- | --- |
| Customer quotation and confirmed payment | `calculateTripFare`, server quote and booking routes, locked `trips` snapshot; Phase 5 adds its own versioned breakdown only when a database policy is active | Universal 2.3% pricing remains default-off and applies to the final standard fare once, equally for supported methods. |
| Go/Go XL commission and Driver net | Phase 2 policy, completed `trips` snapshot and authoritative commission posting | 1,500 basis points on the locked Driver fare basis. No second commission in payout preview. |
| Prior commission debt | Authoritative Driver debt/credit ledger position, excluding the current trip's commission | Preview accepts only a separately supplied prior debt amount. No debt allocation or settlement is written. |
| Online payment | Signed Yoco event processed into `online_payment_attempts`, provider-event history and a posted `ONLINE_PAYMENT` ledger transaction | Checkout or webhook completion alone is not evidence of the actual processing fee or of bank settlement. |
| Online Driver payable | Existing `online_driver_payables` Phase 3 foundation | The Phase 2 recovery worker calls the corrected completion RPC only when the new payout flag is enabled; the earlier separate-fare correction remains an unapplied candidate. |
| R3 fee | Separate Phase 5 Go service fee and locked policy snapshot | Not the legacy embedded fee. Its accounting defect is reproduced below. |
| Bank transfer fee | Verified bank statement/approved bank pricing, currently absent from app | MOOVU expense only. R2 PayShap and R6 EFT remain estimates, never Driver deductions. |

The legacy fare rules embed **R4 for Go and R5 for Go XL** inside the fare before pricing. Phase 5 instead removes that embedded amount and quotes a separate **R3 Go or R5 Go XL** service fee. `phase5_policy_at` controls this route; no Phase 5 policy was active in the isolated local clone. The Customer booking route persists the Phase 5 customer total, the separate ride-fare basis and the policy version. No historical trip is repriced by this branch.

## R3 booking-fee finding and correction

The existing `phase5_post_service_fee` function posts a collected Phase 5 fee as a debit to a **Driver `COMMISSION_RECEIVABLE`** and a credit to MOOVU `BOOKING_FEE_REVENUE`, with `cash_received_by_moovu=false`, regardless of payment method. That is suitable for a Cash fee collected by the Driver but wrong for a verified Pay Online payment already held by MOOVU. The connected reproduction `scripts/release4-booking-fee-repro.sql` passed on an isolated schema-only PostgreSQL clone: a synthetic R100 online ride plus R3 fee created that Driver receivable. This demonstrates the SQL defect for Phase 5; it does **not** establish how many production transactions were affected. No production financial records were queried or changed.

The candidate `docs/release4-phase5-booking-fee-allocation.sql` branches on the locked trip payment method. It requires a matching `SUCCEEDED`, verified online attempt and posted `ONLINE_PAYMENT` ledger transaction before debiting MOOVU's existing customer-funds liability for the collected fee and crediting booking-fee revenue. Cash/Transfer retains the Driver receivable. The existing idempotency key and immutable ledger are preserved. It creates no new Customer charge, current-trip commission, historical debt, or retrospective reallocation. Historical online fees already posted to Driver receivables require a separate, evidence-led compensating-ledger plan; the candidate does not rewrite them.

The correction needs a distinct migration review before any production use. In particular, validate the live Phase 5 policy state, payment-attempt dependencies, managed-role ownership, cash/transfer collection model, refund treatment, and how previously posted fee transactions should be identified and corrected. The separate Phase 3 payable candidate still needs accounting for any payment remainder; these SQL files must not be silently combined.

## Fee sharing and payout calculation foundation

`calculateOnlinePayoutPreview` uses integer cents and half-up basis-point rounding. It requires a completed trip, a `SUCCEEDED` and `MATCHED` payment, a locked Customer-total reconciliation, and the authoritative current 15% commission. Legacy embedded-fee trips cannot acquire a second booking fee. Phase 5 trips must reconcile fare + service fee − waiver − credit to the confirmed Customer total.

The preview will **not** return a net payout without both actual Yoco fee evidence and an explicitly supplied approved Driver share in basis points. It has **no default 50/50 split** and adds no VAT to an already verified fee total. It caps prior debt recovery at earnings remaining after the proposed Driver fee share, carries unpaid debt forward, and never returns a negative payout. It does not post ledger entries, reserve debt, approve a batch, or perform a transfer; `READY_FOR_REVIEW` is not `PAID`.

Synthetic example only: R200 fare, R30 current commission, R7 **verified** fee, proposed 50/50 share and R45 prior debt yield R170 earnings, R3.50 Driver fee share, R45 recoverable debt and R121.50 preview payout. The R2 PayShap estimate is a MOOVU expense outside this calculation. This example does not approve a fee split or authorize debt recovery.

The current Yoco webhook parses payment ID, checkout ID, amount, currency and status; it does not ingest a processing-fee field. The checked [Yoco Gateway pricing page](https://www.yoco.com/za/gateway/) quotes a published online rate excluding VAT, but neither that rate nor a 3.5% estimate proves MOOVU's actual transaction fee. A trusted provider settlement/export or bank reconciliation tied to the specific payment, including VAT treatment, is required. The existing [Yoco refund API](https://developer.yoco.com/online/api-reference/core-resources/refund-object) supports an idempotency key, but no refund or fee-share operation was invoked here.

## Commission warning and operational eligibility

The approved R40 warning is now reflected by the Phase 2 finance-state helper and visible on Driver Earnings. At R50 the text remains informational and explicitly says trips are not automatically blocked. `eligible` and `restricted` remain `true` and `false` respectively at every debt amount; independent safety, verification and account restrictions are unchanged. The current database retirement of the old debt-based operational lock remains intact. Admin already exposes the balance; no new Admin payout action was added.

## Connected local evidence

All database tests used `release4_finance_20261020`, an isolated PostgreSQL 17 schema-only clone guarded by database-name checks. The clone had no copied Auth users or trip data; the prior synthetic identity fixture existed only there. Each new booking-fee script ran in a transaction and ended with `ROLLBACK`. It never reached production Supabase.

| Test | Result |
| --- | --- |
| Existing Phase 5 R3 online allocation | PASS: reproduced one R3 Driver receivable and one MOOVU revenue credit. |
| Missing payment authority | PASS: corrected function refused an online fee without verified posted payment. |
| Synthetic verified online R3 | PASS: one debit to MOOVU customer-funds liability, one credit to booking-fee revenue, zero Driver receivable debits. Replay left one transaction. |
| Synthetic Cash R3 | PASS: Driver receivable remained the debit source. |
| Function permissions | PASS on local clone: `anon` and `authenticated` cannot execute; `service_role` can. |
| Local clone cleanup | PASS: test transactions rolled back; zero Phase 5 policies/trips remained after tests. |
| Payout-preview examples and rejection cases | PASS locally: proposed R200 example, R100 + R3 separate fee, waiver/credit, missing fee/policy, non-3.5% fee, excess debt, bad commission, refund-pending/failed payment rejection. |

The connected tests validate schema and accounting behavior in a local clone, **not managed Supabase role equivalence or a hosted Yoco transaction**. No actual Yoco fee, VAT invoice, bank transfer fee, provider refund, dispute, chargeback or physical payout was observed.

## Outstanding implementation and policy gates

1. **Fee split:** owner approval of exact Driver/MOOVU percentage, contractual treatment and effective date. No fee deduction is active.
2. **Actual provider fee:** prove a trusted per-payment Yoco fee and VAT basis. If unavailable, payout approval must remain held for reconciliation.
3. **R3 history and basis:** determine affected live Phase 5 transactions, approve any compensating entries, and confirm the separate fee remains outside the 15% ride-fare basis. The candidate SQL does not backfill.
4. **Atomic debt recovery:** design and test a database-backed reservation/allocation linked to the authoritative liability, coordinated with manual commission settlements. The pure preview must not be used to mark debt paid.
5. **Payout lifecycle:** weekly Africa/Johannesburg batches, unique trip assignment, Admin review/hold/approval, verified external payment recording, immutable compensations, and Driver-owned read access require reviewed schema, RLS, grants, audit and connected concurrency tests. There is no automated bank transfer.
6. **Refund/dispute/failed payout:** compensate ledger entries and reconcile each before funds become eligible again. The preview rejects non-final payment states; it does not implement these lifecycle transitions.
7. **UI:** a dedicated Admin Online Payouts workflow and Driver payout history must wait for authoritative payout records. Displaying synthetic payout status against live accounts would be misleading. No authenticated Admin/Driver payout screenshots were captured; responsive acceptance remains pending.

No production migration sequence is approved. Before release, rehearse the approved migrations in dependency order on a current disposable managed-compatible schema; verify RLS and role grants, ledger balance, concurrency and rollback; then stage a default-off application build. Application rollback can return to the existing live deployment while retaining additive schema and legitimate later transactions. Posted financial entries require forward compensating entries, never an old database restore over new money activity.

**Production activation: blocked.** `MOOVU_UNIVERSAL_FARE_23_ENABLED` remains disabled; no payout fee share, bank expense posting, debt recovery or bank transfer is enabled by this branch.

## Online payout continuation

`docs/release4-online-payout-control-plane.sql` is an **unapplied candidate**. It adds verified provider-fee evidence, one-per-payable batch items, payout batches, debt-allocation references, immutable audit events, and a default-disabled payout policy. A service-role-only RPC assembles a bounded weekly `DRAFT` atomically from completed, ledger-posted, reconciled online payables with verified fee evidence. An advisory lock and unique `payable_id` prevent overlapping drafts. Direct `anon` and `authenticated` table/RPC access is denied. The database trigger currently rejects all non-DRAFT states, fee deductions, debt recovery and transfer references, including direct service-role updates. This is intentional until ledger-backed actions are reviewed.

`docs/release4-online-payable-total-separation.sql` was corrected in this branch: Phase 2 already posts commission revenue and Driver commission debt. Online service completion now debits held Customer funds and credits the Driver payable **and the existing trip's commission debt**, rather than crediting commission revenue a second time. It requires the posted Phase 2 commission transaction. Existing posted transactions are immutable; any historical duplicate commission requires a separate evidence-led compensating plan, not a function replacement alone. Neither candidate SQL file was applied to production.

The existing durable Phase 2 recovery worker now calls `phase3_post_completed_online_driver_payable` **after** the idempotent Phase 2 commission posting, only when `MOOVU_ONLINE_PAYOUTS_ENABLED=true`. It acknowledges the recovery job only after both database operations succeed. A payable failure remains retryable; replayed commission posting cannot repeat the commission ledger effect. With the flag unset, the worker follows its prior path. The worker tests simulate the RPC boundary; they do not prove hosted scheduler operation.

The Admin `/admin/online-payouts` page and Driver Earnings panel read only server-authorized batch records when `MOOVU_ONLINE_PAYOUTS_ENABLED=true`; the flag defaults OFF. The Driver API resolves the authenticated `driver_accounts` linkage before filtering by Driver ID. Admin access requires Owner/Admin finance role. Draft figures are labelled preliminary, and no approval or payment button is presented as usable. Admin can export the displayed rows to CSV. These views do not yet show per-trip fee evidence, approved snapshots or actual remaining debt because no approved payout has been posted. No authenticated or physical screenshots were captured; rendering against the synthetic database remains unverified.

### Connected local evidence

The dedicated PostgreSQL 17 database `release4_payout_cert_20261021` was copied from the existing schema-only local Release 4 fixture. The final candidate schema and corrected payable function compiled there. `scripts/release4-online-payout-draft-connected-test.sql` created a synthetic R100 completed online trip, R100 verified fake-provider payment, R15 Phase 2 commission, R85 Driver payable, and R3.50 synthetic verified fee **inside a rolled-back transaction**. It verified one R15 commission-revenue posting, zero remaining current-trip commission debt, one R85 draft with zero fee-share/debt deductions, duplicate payable rejection without partial records, immutable provider-fee evidence, rejection of direct `PAID` mutation, denied authenticated direct table/RPC access, and no payout ledger posting. The script ended with `ROLLBACK`; the clone has no retained test batch. This is not a hosted Yoco transaction or a real transfer.

The pure transition contract has tests for payment/fee reconciliation, policy approval, refund/chargeback hold, dual-control payment evidence, bank confirmation and duplicate terminal-state rejection. It is **not wired to a mutation endpoint or a database approval RPC**, so those tests do not certify an operational payout state transition. Concurrent approval was not exercised. On a separate disposable local database, two simultaneous calls attempted to draft the same payable: one committed and the other was rejected by the unique payable constraint; exactly one batch and one item remained, with zero payout ledger transactions. The synthetic race fixture was not connected to production.

### Application validation

- Full automated suite: **359/359 PASS** after the default-off recovery-worker integration; focused recovery tests passed 8/8.
- TypeScript: **PASS**. ESLint: **PASS**, zero errors and five existing unused-variable warnings.
- Production compilation: **PASS** with Next.js webpack, including 215/215 static pages. This isolated worktree uses an external `node_modules` junction that Turbopack rejects; webpack is the available supported local build path. Build-only placeholder Supabase values were used, with no remote connection or credential copy.
- Authenticated Admin/Driver payout rendering: **NOT EXECUTED**. No genuine screenshots were captured; no hosted or physical-device acceptance is claimed.
- Local cleanup: the six payout-only PostgreSQL test databases created for this run were dropped after verification. The pre-existing `release4_finance_20261020` schema fixture was preserved. Production was untouched.

### Remaining implementation gates

1. Rehearse and approve the default-off Phase 2 recovery-worker integration with the corrected ledger reclassification on a current managed-compatible schema. Historical postings, if any, need evidence-led compensation.
2. Approve and document the Driver/MOOVU actual Yoco fee split, VAT and accounting treatment. The proposed 50/50 policy is stored nowhere as active configuration; actual per-payment provider evidence must be ingested from a trusted source.
3. Implement atomic prior-commission allocation against the authoritative Phase 2 debt ledger, excluding current online commission, coordinating manual settlements and concurrent payouts, and posting balanced idempotent entries. The draft does not settle debt.
4. Add reviewed database transitions for reconciliation, hold/release, approval, external transfer recording, paid/failed/cancelled and forward compensations. This includes dual control, bank evidence verification, refund/chargeback checks, payout-clearing accounting, and failed-transfer replay. The current database guard blocks these states.
5. Complete Admin action controls, Driver-approved/paid parity, statement detail, authenticated responsive screenshots and connected concurrency tests once authoritative transitions exist.
6. Review migration dependency order and managed Supabase roles on a current non-production project. No production schema migration or deployment was performed.

The R3 Phase 5 correction remains a separate candidate. No extra R3 Customer charge or retroactive recovery was created. Estimated PayShap/EFT bank charges remain MOOVU costs outside the Driver preview. The universal 2.3% fare flag remains default-off.

## Final local validation

- Automated tests: 353/353 passed, including the new payout preview and commission notice cases.
- TypeScript: `npx tsc --noEmit` passed.
- ESLint: passed with five pre-existing unused-variable warnings and zero errors.
- Production build: `next build --webpack` passed, including 212/212 static pages. The default Turbopack command was blocked by this isolated worktree's external `node_modules` junction; this dependency-layout issue is not an application compile finding.
- Diff check and scoped credential scan: passed; no secrets or unrelated changes included.

## Atomic payout continuation (local candidate, 21 October 2026)

Continuation branch: `codex/release4-atomic-payout-lifecycle`, based on
`b8f9278e5db4c82089b99df2ec4d47c7290c0e96`. The exact continuation commit
is reported with the final release evidence.

The candidate control plane now has a service-role-only, financially authorized
`release4_review_payout` RPC. It serializes a batch row, rechecks each payable
against posted completion, verified payment, reconciliation and refund state,
then atomically records `RECONCILED`, `HELD`, or preapproval `CANCELLED` with an
append-only audit event. Repeated same-state requests return without another
audit event. Direct status updates are rejected. The Admin panel requires
confirmation and a reason for hold or cancellation. These controls post no
financial entry and initiate no bank transfer. The application flag is OFF.

| Gate | Evidence and status |
| --- | --- |
| Draft, duplicate payable, immutable fee evidence | Local connected synthetic test PASS; prior one-per-payable constraint retained. |
| Reconcile/hold/release/cancel | Local connected PostgreSQL 17 test PASS; direct update rejected, audit replay checked, cancelled batch could not reopen. |
| Approval and prior debt recovery | BLOCKED: no approved fee split or ledger-backed, manual-settlement-safe debt reservation. No approval endpoint. |
| Bank payment and PAID | BLOCKED: independent verified transfer evidence unavailable. Direct `PAID` mutation rejected. |
| Refund, reversal, chargeback, failed transfer | Synthetic pending partial refund blocked reconciliation in a rolled-back local test. Compensating money transitions remain BLOCKED; no historical ledger rewrite. |
| R3 booking fee | Existing reproduced defect and candidate correction preserved separately; no extra Customer charge or retrospective debt. |
| Authenticated Admin/Driver screenshots | BLOCKED: no hosted non-production payout fixture; none captured or claimed. |
| Activation | `MOOVU_ONLINE_PAYOUTS_ENABLED` and `MOOVU_UNIVERSAL_FARE_23_ENABLED` remain OFF. |

This SQL is an **unapplied, additive candidate**, not a production migration.
The dedicated `release4_atomic_cert_20261021` database was created from the
pre-existing schema-only local fixture, used for the candidate SQL and
transaction-rolled-back synthetic tests, then dropped. Production was untouched.
Production requires migration dependency and managed-role/RLS rehearsal,
approved actual-fee accounting and split, ledger-backed debt allocation and
payout clearing, independent bank verification, compensating refund/reversal
logic, authenticated UI acceptance, and a current recovery plan. Application
rollback must retain legitimate financial writes. **Deployment: NOT READY.**

## Final payout engine candidate (21 October 2026)

Branch `codex/release4-final-payout-engine` continues the clean local payout baseline `9c4c6458131f9c3c6c45e8980f8a8c7556e41f1f`. The exact final commit is in the handoff. This section supersedes earlier statements that approval and settlement are unimplemented. `docs/release4-online-payout-financial-engine.sql` is an **unapplied candidate** that follows the existing payout control plane and corrected payable SQL. Production and both payout and universal-fare flags remain unchanged and OFF.

The locked Driver fare is the commission basis. Phase 2 already posts 15% current-trip commission, which the payout never posts twice. Driver earnings are fare less that commission. A verified actual Yoco fee is split 50/50 in cents, with half-up rounding for the Driver share; MOOVU bears the remainder. Prior unpaid Cash/Transfer commission is reserved from the remaining earnings, capped at 100%. Net bank payout is `earnings - Driver Yoco share - reserved prior debt`, never below zero. MOOVU bears the actual bank charge. The separate R3 Phase 5 booking-fee model remains outside the Driver fare and commission basis and requires posted Customer-funded revenue where applicable.

Approval requires an authorized financial Admin, enabled approved policy, verified beneficiary and consent, Monday-to-Monday Johannesburg batch, completed trips, posted payables, verified provider payments and actual fees, and no refund. It locks the batch, payable and debt records, reserves specific debt sources, and records a snapshot and audit without moving money. An Admin records a manual PayShap/EFT reference, actual transfer time and proof; this is `PAYMENT_RECORDED`, not `PAID`. A distinct privileged operator must import independently obtained bank evidence matching destination fingerprint, amount and reference. A different Admin verifies it. Balanced payout, clearing, Yoco-fee expense, actual bank-fee expense and debt recovery post once in the same transaction as `PAID`. A zero-net batch uses `DEBT_OFFSET` with second-Admin review and no fictitious bank transfer. Failed or cancelled unpaid batches release reservations. Refunds hold unpaid batches; after-paid refunds create exceptions without rewriting history. Automatic chargeback/after-paid compensation awaits approved external liability evidence and policy.

| Local connected PostgreSQL 17 scenario | Result |
| --- | --- |
| R100 payout, approval replay, transfer proof, synthetic bank evidence, second review, one balanced settlement, after-paid refund exception | PASS |
| Odd-cent actual provider fee: 351 cents split 176/175 | PASS |
| Prior commission exceeds earnings: full eligible recovery and zero-net debt offset | PASS |
| Two concurrent approvals on one batch | PASS: one approval, one rejected; one approval audit, no payout settlement |
| Direct PAID mutation and bankless paid claim | REJECTED |
| Hosted Yoco actual-fee feed and genuine bank statement | NOT TESTED |
| Authenticated synthetic Admin/Driver screens and device screenshots | NOT TESTED; none claimed |

The synthetic bank-evidence source is restricted to the dedicated local `release4_final_cert_20261021` database. Production has no trusted bank statement importer; the Admin HTTP route cannot fabricate bank evidence. Provider actual-fee/VAT basis, contractual 50/50 split and effective date, beneficiary verification/consent, trusted bank import and independent roles, after-paid refund/chargeback recovery policy, hosted acceptance, and managed Supabase RLS/migration rehearsal remain release gates. Application rollback must retain additive schema and later legitimate financial writes; never restore an old database snapshot over new money. **Deployment: NOT READY.**

Final source validation: 359/359 automated tests, TypeScript, and ESLint (zero errors, five existing warnings) passed. The webpack production build passed with 215/215 static pages using local build-only Supabase placeholders. Default Turbopack cannot follow this worktree's external `node_modules` junction; the no-placeholder webpack run compiled but stopped at page-data collection, as expected. Scoped credential scan and `git diff --check` passed. Connected tests use synthetic local money only; they do not certify hosted provider or bank delivery. No real Admin/Driver screenshots were available.
