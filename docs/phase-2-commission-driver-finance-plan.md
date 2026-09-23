# MOOVU Phase 2 Commission and Driver Finance Plan

Status: **PROPOSED - NOT IMPLEMENTED**  
Dependency: owner approval of the decisions in the Phase 2 audit  
Safety rule: Phase 1 ledger remains dormant until disposable, staging, production-shadow, and reconciliation gates pass.

## Proposed architecture

1. Keep trip fare and commission snapshots as immutable economic source facts after completion.
2. Post all Phase 2 financial effects through one server-authorized, database-atomic contract.
3. Use Phase 1 integer-cent double-entry transactions as the future authority.
4. Derive Driver balances, restrictions, Admin totals, and legacy wallet compatibility projections from posted ledger events.
5. Preserve legacy rows as evidence. Correct errors using linked reversals or adjustments.
6. Publish notifications and receipts from a post-commit outbox; notification failure must never roll back or duplicate finance.
7. Treat fee assessment, collection, compensation authorization, compensation payment, commission offset, and revenue recognition as different events.

## Proposed account model

Phase 1 already permits the necessary categories. Phase 2 should use stable accounts such as:

- Platform: commission receivable, commission revenue, bank/payment clearing, cancellation/no-show receivable, cancellation/no-show revenue, unapplied funds, adjustment clearing.
- Driver-owned: commission debt/control, unapplied credit, compensation payable, earnings control.
- Customer-owned where needed: outstanding liability.
- Phase 3 reserved only: driver earnings payable/future payout and payment clearing.

Account codes must be deterministic, currency-specific, non-PII, and created only through the protected account RPC.

## Balanced journal designs

Amounts below are examples only and are not postings.

| Event | Debit | Credit | Stable idempotency/source |
|---|---|---|---|
| 1. Cash/transfer trip completion, fare R100, 15% | Driver commission receivable R15 | MOOVU commission revenue R15 | `trip-commission:<trip-id>:v<financial-version>`; source trip |
| 2. Commission recognition | Same entry as completion; do not double-post | Same entry as completion | One transaction represents the receivable and revenue |
| 3. Exact R15 settlement | MOOVU bank/clearing R15 | Driver commission receivable R15 | `driver-settlement:<settlement-id>` |
| 4. Partial R5 settlement | MOOVU bank/clearing R5 | Driver commission receivable R5 | settlement ID |
| 5. R20 paid against R15 | MOOVU bank/clearing R20 | Receivable R15; driver unapplied-credit liability R5 | payment request ID |
| 6. Unapplied driver credit | Included in overpayment transaction | Driver unapplied-credit liability R5 | same payment transaction, no duplicate event |
| 7. Apply R5 credit later | Driver unapplied-credit liability R5 | Driver commission receivable R5 | `credit-allocation:<credit-id>:<debt-id>` |
| 8. Cancellation fee assessment R20 | Customer cancellation liability R20 | Deferred/assessed cancellation control R20 | cancellation-fee ID |
| 9. Fee collection R20 | Bank/payment clearing R20; assessed control R20 | Customer liability R20; recognized cancellation revenue and/or driver compensation funding R20 | collection ID linked to fee |
| 10. Driver cancellation compensation R13 | Driver compensation expense/control R13 | Driver compensation payable R13 | compensation authorization ID |
| 11. No-show compensation R22 | Driver compensation expense/control R22 | Driver compensation payable R22 | no-show compensation ID |
| 12. Waive R20 assessed fee | Assessed cancellation control R20 | Customer cancellation liability R20 | `fee-waiver:<fee-id>:<decision-id>` |
| 13. Approved adjustment R3 | Appropriate expense/receivable R3 | Adjustment clearing or target balance R3 | adjustment ID with reason |
| 14. Full reversal | Exact opposite of original entries | Exact opposite of original entries | `reversal:<original-transaction-id>` |
| 15. Incorrect posting correction | Reverse original, then post corrected event | Reverse original, then post corrected event | reversal key plus new corrected source/version key |

The cancellation journal must be finalized with an accountant before activation. The core invariant is that assessment is not cash collection and driver compensation authorization is not payment.

## Financial balance definitions

| Value | Definition | Source | Visibility | Phase |
|---|---|---|---|---|
| Commission owed to MOOVU | Posted commission receivable less settlements/credits/reversals | Ledger | Driver/Admin | Phase 2 |
| Unapplied driver credit | Cash received not yet allocated, a liability to Driver | Ledger | Driver/Admin | Phase 2 |
| Net amount owed | max(commission owed minus applicable credit, zero), with credit still separately disclosed | Ledger query/RPC | Driver/Admin | Phase 2 |
| Driver gross trip earnings | Completed gross cash/transfer fare paid directly to Driver | Trip source plus ledger references | Driver/Admin | Phase 2 |
| Driver economic net | Gross fare less commission and approved offsets | Immutable trip snapshot/ledger | Driver/Admin | Phase 2 |
| MOOVU commission revenue | Posted commission revenue, net of reversals | Ledger | Admin | Phase 2 |
| MOOVU cash collected | Cleared settlements/collections actually received | Ledger plus external evidence | Admin | Phase 2 |
| Customer cancellation liability | Assessed but unpaid cancellation/no-show amount | Ledger | Customer/Admin where policy allows | Phase 2 |
| Driver compensation authorized | Approved obligation to Driver | Ledger/control event | Driver/Admin | Phase 2 |
| Driver compensation paid | Cleared cash paid or settled offset | Ledger | Driver/Admin | Phase 2/3 depending channel |
| Future driver payable | MOOVU-held online-trip proceeds owed to Driver | Payment clearing/ledger | Not exposed now | Phase 3 |

## Commission policy technical baseline

- Store an effective-dated rate schedule by ride type after owner approval.
- Snapshot the selected policy ID, percentage, rounding version, and quote version on the trip before acceptance; completion uses that immutable snapshot.
- Never silently reprice an existing or completed trip when configuration changes.
- Use integer cents for all posted values and one documented rounding rule.
- Reject a completion if the source snapshot/version changed concurrently.
- Enforce one canonical terminal economic outcome per trip.
- Correct a posted event only with reversal plus corrected transaction.
- Use one authoritative server/RPC calculation and database uniqueness.

## Finance eligibility state model

```text
NORMAL
  -> WARNING
  -> GRACE
  -> RESTRICTED
  -> PAYMENT SUBMITTED
  -> WAITING CONFIRMATION
  -> APPROVED
  -> AUTOMATIC RESTORATION
```

The owner must set thresholds and grace rules. Accounting balances do not change for a pending submission. Any optional operational grace is a separate, expiring status. Assignment/acceptance must re-evaluate finance, subscription, approval, busy state, active trip and payment state inside the same authoritative database boundary.

Rejected requests return to the prior finance state. Duplicate approvals replay the original result. Partial payment reduces debt only by the approved allocation. Overpayment creates unapplied credit. Reversals recompute eligibility from ledger balances. Restoration occurs only after the financial commit and all non-financial eligibility rules pass.

## Transition stages

| Stage | Entry criteria | Flag/state | Required proof | Rollback | Exit criteria |
|---|---|---|---|---|---|
| A. Prepare | Owner rules approved; reconciliation policy approved | read OFF, write OFF | migration review, unit/static tests, inventory | abandon local package | disposable package approved |
| B. Disposable/staging shadow | Clean disposable install | shadow write ON only there; read OFF | real DB idempotency, roles, RLS, races, rollback, journals | disable flag/reset disposable | all invariants and reconciliation pass |
| C. Production shadow | explicit migration/deploy approvals; backup and monitoring | production shadow write ON, read OFF | every legacy result compared to ledger; zero unexplained drift | disable shadow; ledger remains non-authoritative | approved observation window and parity |
| D. Ledger authority for commission | owner cutover approval | ledger read ON for commission; dual projection monitored | authenticated Driver/Admin flows and full-dataset parity | switch reads to legacy, keep immutable ledger evidence | stable balances and operations |
| E. Legacy compatibility | sustained ledger authority | legacy writes only through projection contract | projection parity and no independent writers | resume prior read adapter if needed | legacy wallet classified read-only where possible |

Every stage requires named observability: posting success/failure, idempotent replay, conflicting replay, reconciliation delta, projection failure, outbox delay, restricted/restored drivers, unapplied-credit total, and orphan sources.

## Historical strategy

| Strategy | Auditability | Duplicate/anomaly risk | Reversibility | Recommendation |
|---|---|---|---|---|
| Full historical backfill | High if perfect inputs | Highest | Difficult | Not preferred with known snapshot/linkage gaps |
| Opening balances only | Clear cutover | Medium | Good | Viable but loses detailed pre-cutover ledger history |
| Cutoff only, no opening balance | Simple | Leaves legacy debt outside ledger | Easy | Insufficient for authoritative debt |
| Hybrid reconciliation | Strong | Controlled exception complexity | Good | **Safest technical recommendation** |
| No historical posting | Preserves legacy only | Split authority indefinitely | Easy | Not suitable for full Phase 2 authority |

**Recommended, owner approval required:** establish a cutoff, reconcile every driver’s legacy debt and evidence, create one approved opening-balance transaction per driver, retain legacy history unchanged, and keep an exception register for the seven trip mismatches, two wallet mismatches, and unlinked historical approvals. Do not synthesize detailed historical postings that the source data cannot prove.

## Failure, retry, and concurrency contract

| Race/failure | Lock and uniqueness | Winner/loser behavior | Recovery |
|---|---|---|---|
| Completion twice | trip row + driver advisory lock; trip/version key | first posts; second exact replay | return original transaction |
| Commission post twice | unique idempotency/source | first posts; same payload replays; conflict rejects | investigate payload conflict |
| Completion vs cancellation/no-show | trip row; one terminal-outcome index | one terminal state wins; loser controlled conflict | no fallback writes |
| Settlement twice | driver lock; settlement source/key | first applies; duplicate replays | return allocation |
| Admin approval twice | request row + driver lock | first decides; same action replays; conflicting action rejects | immutable review event |
| Settlement vs new commission | shared driver lock | serialize; each uses resulting ledger balance | deterministic recomputation |
| Two payments approved | request locks plus same driver lock | serialize allocations | excess becomes credit |
| Restriction check vs settlement | evaluate inside assignment lock after finance lock order is defined | assignment uses committed authoritative balance | retry serialization conflict |
| Ledger succeeds, projection fails | one transaction if projection is mandatory; otherwise ledger commit plus repair outbox | never report legacy success alone | alert and idempotent projection repair |
| Legacy succeeds, ledger fails | prohibited after ledger authority; single DB transaction | whole operation fails | fail closed, no sequential fallback |
| Notification fails | financial commit first; unique outbox event | finance remains committed | retry outbox |
| Receipt fails | receipt is post-commit projection | approval remains committed | regenerate by transaction ID |
| Reversal retried | one-reversal index + key | replay or conflict | return original reversal |
| Credit allocated twice | lock credit/debt; unique allocation source | one allocation wins | recompute remaining credit |

Concurrency proof must use a real disposable PostgreSQL database with simultaneous sessions. Mocks and static SQL inspection are supplementary only.

## Implementation surfaces

### Database package

- Add Phase 2 transaction/source types and, only if required, explicit payment allocation and reconciliation-status structures.
- Add protected posting/orchestration RPCs for trip commission, payment review/allocation, settlement, credit allocation, fee lifecycle, adjustment and reversal.
- Add one authoritative finance-eligibility RPC consumed inside assignment/acceptance.
- Add immutable source references, policy/version snapshots, operation keys and allocation uniqueness.
- Retain server-only grants and least-privilege RLS.
- Create reconciliation views/functions that expose aggregates without permitting mutation.

### Server application

- Introduce a single finance service around protected RPC contracts.
- Integrate completion, cancellation/no-show, payment approval and settlement without sequential fallback.
- Keep Phase 1 flags default OFF and separate shadow-write/read-authority flags.
- Emit receipts/notifications only from committed transaction IDs/outbox events.
- Remove or quarantine obsolete sequential writers only after usage proof and cutover approval.

### Driver UI

- Replace ambiguous wallet language with separate owed, credit and net-owed values.
- Add ledger-derived transaction details, payment status, restriction reason, receipt and support/dispute entry.
- Preserve map-first navigation and current trip workflows.

### Admin UI

- Add ledger/source drill-down, reconciliation state, allocations, unapplied credits, restriction status and discrepancy queue.
- Owner/admin-only reversal/adjustment actions require reason and confirmation.
- Dispatcher/support remain read-only within approved operational scope.

## Test plan

1. Unit: integer-cent conversion, rounding, rate snapshots, allocation order, state transitions and journal balancing.
2. Contract: fail closed when any hardened RPC is missing, version-mismatched, or cannot establish an authoritative result.
3. Disposable database: clean migration, rollback, grants, RLS, SECURITY DEFINER search path, immutability and balancing.
4. Concurrency: every race listed above using simultaneous sessions.
5. Idempotency: exact replay, conflicting payload, duplicate source, reversal replay and allocation replay.
6. Reconciliation: all 230 trips, 51 wallets, 140 commission transactions, seven settlements, 24 payment requests, 23 cancellation-fee rows, and every future shadow transaction.
7. Authenticated HTTP: owner/admin permitted; dispatcher/support rejected; Driver/customer own-scope reads; direct mutation rejected.
8. Staging: real trip completion, payments, receipts, restrictions/restoration, outbox and projection repair.
9. Production shadow: legacy-vs-ledger parity monitoring through an owner-approved observation window.
10. Regression: booking, fare lock, assignment, start/end completion, cancellations, no-show, subscriptions, Driver online/offline, reports and notifications.

## Acceptance gates

- Phase 0/1 state and source/deployment drift documented.
- All owner decisions approved in writing.
- Migration and rollback reviewed.
- Known historical anomalies have signed reconciliation dispositions.
- Disposable and staging database tests pass.
- Real concurrency and idempotency tests pass.
- Full-dataset reconciliation reaches the approved tolerance, with no unexplained financial delta.
- Role/RLS and authenticated Driver/Admin tests pass.
- No financial sequential fallback remains.
- Outbox/receipt retries are proven post-commit and idempotent.
- Deployment diff and exact artifact are reviewed.
- Separate explicit production migration, application deployment and flag activation approvals are obtained.
- Post-deploy verification completes before Phase 2 is declared complete.

## Rollback requirements

- Flags default OFF and can independently disable shadow posting and ledger reads.
- Stage C rollback returns to legacy authority without deleting ledger evidence.
- No rollback script may delete posted financial history.
- Failed/corrected postings use reversals.
- Schema rollback must preserve new financial rows and source references.
- Projection repair must be idempotent and observable.
- A production cutoff ledger activation requires a backup, owner-approved runbook, named operator, monitoring window and abort thresholds.

## Phase 3 compatibility, design only

Phase 2 should reserve stable source references and account categories for future payment clearing, customer settlement, Driver payable, commission recognition, refunds and payouts. A future online R100 fare would debit processor/payment clearing and credit customer fare settlement; settlement would allocate the Driver payable and MOOVU commission without pretending the Driver collected cash.

No Yoco API, webhook, credential, Pay Online UI, payout logic, or Phase 3 behavior is part of this plan.

## Delivery sequence

```text
OWNER BUSINESS DECISIONS
  -> BUILD REVIEWED LOCAL PACKAGE
  -> DISPOSABLE DATABASE TEST
  -> STAGING TEST
  -> FULL RECONCILIATION
  -> PRODUCTION MIGRATION REVIEW
  -> OWNER APPROVAL
  -> CONTROLLED SHADOW DEPLOYMENT
  -> POST-DEPLOY VERIFICATION
  -> SEPARATE LEDGER-AUTHORITY APPROVAL
  -> PHASE 2 COMPLETE
```

This document authorizes no implementation or production action.
