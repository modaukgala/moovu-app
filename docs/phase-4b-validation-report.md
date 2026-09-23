# MOOVU Phase 4B local and disposable validation — 2026-09-14

## Verdict

**PASS WITH BOUNDED CUTOVER ITEM (final replay, 2026-09-14).** The exact two-file candidate replayed cleanly on a reset disposable Phase 4A baseline. Completion and real offer-acceptance races passed. Authenticated HTTP cutover, expanded failure injection, and the future activation sequence remain separate release gates. The historical notes below describe the earlier development pass; the final replay findings at the end supersede its pending-item list.

## Repository and scope

Repository `D:\Users\KN Mudau\Desktop\Websites\moovu-kasi-rides-redesign`, branch `main`, HEAD `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`. Extensive pre-existing dirty files were left intact. This task added only `docs/phase-4b-*` SQL/test/report files. No application route, UI, environment, deployment, commit, or push changed. No Phase 4B production SQL was executed.

## Source chain and accounting

Trip terminal event -> immutable Phase 4 assessment -> one open Customer liability and one earned Driver compensation -> Phase 1 posted transaction/entries -> append-only business event and notification outbox. A unique, explicitly linked `trip_cancellation_fees.phase4_assessment_id` row is a legacy report projection, not an independent financial source. No `cancellation_credit` wallet transaction is written: the Phase 1 payable is the single earned compensation obligation. Existing Driver earnings/Admin reports can still read the fee projection, but the Driver wallet does not claim the amount was credited or settled.

| Outcome | Debit Customer receivable | Credit Driver payable | Credit assessment clearing |
| --- | ---: | ---: | ---: |
| Go late cancellation | 2,000 | 1,300 | 700 |
| Go XL late cancellation | 3,000 | 2,000 | 1,000 |
| Go no-show | 3,000 | 2,200 | 800 |
| Go XL no-show | 4,000 | 3,000 | 1,000 |

All amounts are ZAR cents. The clearing credit is not recognized revenue. No cash account is posted. The fee assessment is not collection, and `EARNED` is not `PAID`.

## Quote and terminal writers

`phase4b_quote_customer_cancellation` locks an owned trip and persists a 30-second quote with authoritative timestamp, policy/version, assignment/state, split and 180-second boundary. `phase4b_cancel_customer_trip` locks the trip and quote; expired or materially changed terms return `requires_reconfirmation` without cancelling. Free/unassigned cancellation records terminal/audit/outbox only. A positive fee records assessment, linked legacy projection, liability, earned compensation, one grace cycle, balanced Phase 1 posting and outbox in the same database transaction. `phase4b_mark_customer_no_show` requires an authenticated assigned Driver, `arrived`, qualified versioned server arrival evidence and at least 300 seconds from server arrival. Started/completed and different terminal outcomes fail closed. No new function is called by an application route.

The selected policy must exactly match the owner's approved 180/300-second and four split values. No Phase 4 policy row is inserted by either release file. The trip creation timestamp must be at or after the selected policy cutover. A policy row must not be inserted until both RPC cutover and quote/reconfirmation UX are separately approved and ready together.

## Phase 1, reversal, grace and recovery

The separate cutover file extends the Phase 1 source validator with canonical `PHASE4_ASSESSMENT`, preserves the legacy source, and makes the existing Phase 1 posting helper check the locked terminal trip state. Its unique terminal economic-trip index remains intact. Posted history can receive a linked compensating Phase 1 reversal; a narrow unpaid/unsettled Owner/Admin reversal records an append-only action, resolves liability and compensation, and closes a grace cycle only when no qualifying open debt remains. Collected/settled disputes, refunds, offsets and write-offs require later distinct contracts. Extra debt in an active cycle does not reset it. No ride consumption or booking restriction is wired in Phase 4B.

`phase4b_expire_dispatch_trip` is a separate guarded, one-transaction R0 system expiry for a still-unassigned requested/offered trip, including offer/job cleanup and outbox. `phase4b_cancel_trip_operational` allows safe pre-start Admin/Driver cancellation but rejects ongoing/terminal trips. Neither replaces the current application call until cutover; the current multi-request dispatch expiry remains a known live behavior pending that switch.

## Disposable installation and testing

Target confirmed: `tangtlmdpnvmoviwrgvd` (`ACTIVE_HEALTHY`). Seven Phase 4A tables and no policy/Phase 4B functions existed before installation. The initial `phase4b_atomic_decision_posting` DDL failed once on a missing `END IF` and rolled back; a corrected invocation succeeded. A smoke test then exposed an existing platform clearing-account uniqueness conflict; the test rolled back and a narrow disposable correction succeeded. Further disposable-only migrations installed quote/dispatch/operational follow-up, linked fee projection, reversal, replay check and strict policy guard. These corrections are incorporated into the final local two-file release package. **The current exact consolidated files have not been replayed from a pristine 4B state**; this must be done before production migration approval.

The rollback-contained `phase-4b-disposable-validation.sql` passed: unassigned 60/240 seconds free; assigned 60 seconds free; assigned exactly 180 and after 180 charged; arrived Customer late cancellation; Go/Go XL split; no-show 299 rejected, 300 and later accepted, unqualified and wrong Driver rejected; quote assignment change required reconfirmation; duplicate operations and posting replay produced one assessment, liability, compensation, Phase 1 transaction, business event and outbox; journal category/sides and balance matched; no cash/revenue or legacy wallet credit; one grace cycle despite additional debt. Suspending the disposable clearing account caused the posting to fail and the entire terminal update to roll back. Additional rollback-contained checks passed for system expiry R0, ongoing Admin cancellation rejection, unpaid reversal and replay, and rejection of an altered policy. No disposable fixture policy, assessment, quote, trip or auth user remained afterward; four cleanup-disabled guard triggers were verified enabled.

True overlapping sessions **were** exercised through distinct Postgres backend PIDs: duplicate no-show (`723555`/`723556`) and duplicate cancellation (`723571`/`723573`) each yielded one writer and one replay. Concurrent Customer cancellation vs no-show yielded one chargeable cancellation and a rejected no-show. Separate overlapping sessions changed assigned/arrived trips to `ongoing` under a row lock; losing cancellation/no-show calls rejected after the lock released. Those start transitions were direct disposable updates, not the entire authenticated trip-start application flow. Completion vs cancellation/no-show through the full existing completion RPC and Driver acceptance/assignment races were **not** executed, so they remain review items.

Metadata verified anon/authenticated cannot execute any new RPC and service role can execute only designated public entry points; Phase 4A tables retain RLS and no client mutation grants. Customer/Driver ownership was tested by caller identity and wrong-Driver rejection, but the full two-Customer/two-Driver HTTP authorization matrix remains unexecuted.

## Standard checks

`npm test`: 182 passed, 0 failed. `npx tsc --noEmit`: passed. `npm run lint`: passed with three pre-existing unused-variable warnings (two in `documentation/moovu-product-spec/report-template.mjs`, one in Admin layout). `npm run build`: passed. `git diff --check`: passed for tracked changes. A scoped credential-pattern scan of Phase 4B files returned no matches. New untracked SQL files were visually reviewed; they must be included in the final staged diff check before any commit/release.

## Release package and cutover

1. Dormant additive schema/functions: `docs/phase-4b-atomic-decision-posting.sql`, SHA-256 `ba6ba11b8d67e87261ad6fdd2c925bdd44e3d611854770badbb8e33168404288` at this report revision. It adds the quote table, linked legacy projection column, source-type constraint, new guarded functions and narrow grants; no historical backfill, policy insertion or replacement of existing live RPC/Phase 1 function. Do not invoke writers before financial cutover.
2. **Separate financial cutover:** `docs/phase-4b-phase1-cutover.sql`, SHA-256 `00e8a99c886f772f9dbb7dc40a5bbc5356d522a8553132bc6af30a5d2cfa676c`. Replaces only `phase1_validate_financial_source` and `phase1_post_financial_transaction` with guarded additive source support. This requires separate review with the future authenticated route/quote UI cutover. Do not install or activate by inference from dormant schema installation.

The original disposable migration and successive disposable-only correction SQL files are retained as audit artifacts, not a production installation sequence. They must not be applied to production. Rollback of populated assessment/ledger history must use compensating transactions and a reviewed dependency plan, never wholesale table drops.

## Production read-only review

Project `mvazbszenqahgqpznhhq`: seven Phase 4A tables; policy/assessment/liability counts 0; no `phase4b_%` function; Phase 2 `SHADOW`; cancellation, no-show, operational, completion and Phase 1 function fingerprints unchanged. Homepage and Customer, Driver and Admin login pages returned HTTP 200. No production SQL mutation, Phase 4 activation, app deployment, environment change, or Phase 4C work occurred.

## Bounded review items before production

- Reinstall **both exact consolidated release files in order on a clean disposable 4B state**, then rerun the financial, security and rollback matrix. Current disposable was validated by initial migration plus narrow corrections, not by the final split files as shipped.
- Execute full authenticated Customer/Driver route tests, Driver acceptance/arrival, and real completion-vs-cancel/no-show concurrent RPC cases. Confirm ordering with production-like outbox and Phase 2 SHADOW processing.
- Coordinate route cutover, server-issued quote display and reconfirmation, operational cancellation, and dispatch-expiry caller; never insert an effective Phase 4 policy before these are live together. Verify deployment target and rollback plan separately.
- Review collected/settled reversal, payment, dispute, and legacy wallet representation separately; the narrow 4B reversal is intentionally only for unpaid/unsettled assessments.

**Final gate:** This package is ready for additional Phase 4B disposable/release review, **not** Phase 4B production installation or controlled cutover approval yet. Phase 4C has not begun.

---

# MOOVU Phase 4B Final Disposable Replay & Release Review

## 1. Verdict

**PASS WITH BOUNDED CUTOVER ITEM.** Exact-package disposable installation, the core finance matrix, completion races, and real offer-acceptance races passed. Production installation **planning** may proceed with owner review. Authenticated application route cutover, expanded fault matrix, and production change approval remain outstanding; Phase 4 activation is not approved.

## 2. Repository State

`main` at `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`. The extensive pre-existing dirty tree was preserved. This final replay added disposable-only reset and race fixture SQL and updated this report; no application code was changed.

## 3. Final Release Hashes

Dormant `phase-4b-atomic-decision-posting.sql`: `ba6ba11b8d67e87261ad6fdd2c925bdd44e3d611854770badbb8e33168404288`. Separate Phase 1 cutover `phase-4b-phase1-cutover.sql`: `00e8a99c886f772f9dbb7dc40a5bbc5356d522a8553132bc6af30a5d2cfa676c`. Changed from candidate: **NO**.

## 4. Clean Disposable Baseline

Disposable `tangtlmdpnvmoviwrgvd` was reset with `phase-4b-disposable-final-reset.sql`: only prior 4B functions, quote table, linked projection column, and 4B test artifacts were removed; the original Phase 1 source validator and posting helper were restored to production-matching definitions. Seven Phase 4A tables remained. Before replay: zero 4B functions, quotes, policies, and fixture rows; Phase 2 was OFF. No Phase 0/1/2/4A prerequisite was removed.

## 5. Ordered Installation Result

The two **unchanged** candidate files applied successfully in order on disposable, without an intervening patch. Result: 11 `phase4b_%` functions, one quote table with RLS and service-only SELECT, linked legacy fee column, expanded transaction source constraint, and two narrowly replaced Phase 1 functions. Internal 4B helpers are not executable by service role; entry-point grants are service-only. No migration warning or failed candidate statement remained.

## 6. Dormancy Verification

Immediately after installation, policy, assessments, liabilities, compensations, grace cycles, Phase 4 postings, quotes, and linked historical projections were all zero. The package does not insert a policy or backfill old fees. No application route changes automatically because these functions exist.

## 7. Core Cancellation / No-Show Matrix

The rollback-contained `phase-4b-disposable-validation.sql` passed against the exact installed package: unassigned free at 60/240 seconds, assigned free at 60, assigned charged at exactly 180 and after, arrived Customer late cancellation, Go/XL splits, 299-second no-show rejection, 300-second success, wrong Driver and unqualified arrival rejection, one grace cycle, replay, balanced postings, and no fake cash.

## 8. Completion Concurrency

**True overlapping database sessions** tested four lock orderings using the actual `phase05b_complete_trip` RPC. No-show or Customer cancellation winning blocked completion; completion winning blocked no-show or cancellation. The test then posted the appropriate Phase 1 completion journal for completed fixtures and verified exactly one terminal Phase 1 transaction per trip, with no completed trip carrying a Phase 4 fee. Coordinating the completion precondition used a direct disposable trip-start transition rather than the complete authenticated HTTP start flow.

## 9. Assignment / Acceptance Concurrency

**True overlapping database sessions** used the existing `accept_trip_offer` RPC. Cancellation winning the trip lock on an unassigned offered trip produced R0; subsequent acceptance returned offer conflict. In the opposite ordering, acceptance succeeded first, the subsequent authoritative quote was R20, and cancellation created one R20 assessment/posting. The unique active Driver reservation rule rejected an invalid two-offer fixture during setup; the corrected setup used two Drivers. Both committed test fixtures were removed afterward.

## 10. Quote Invalidation / Reconfirmation

The exact-package matrix verified free unassigned quote invalidation after assignment. The rollback-contained `phase-4b-final-quote-races.sql` then passed five cases: quote at 179.6 seconds and confirmation after 180, unassigned-to-assigned, assigned-to-unassigned, expired quote, and assigned-to-arrived status change. All returned reconfirmation and left the trip uncancelled. A further same-terms policy-version switch failed closed with no cancellation, but the current code raises `Trip predates active Phase 4 policy` for the old trip rather than returning the reconfirmation response. The multi-policy user experience and policy selection must be resolved before any later policy-version rollout.

## 11. Authenticated Role Boundary

Metadata on the exact installed functions confirms anon and authenticated have **no EXECUTE** on all 11 4B functions. Service role has EXECUTE only on six public entry points, not the five internal helpers. An additional rollback-contained five-case actor-spoof matrix rejected Customer A quoting Customer B's trip, mismatched Customer ownership, Driver A no-showing Driver B's trip, spoofed Driver assignment, and Support spoofing a Customer; the trip and finance stayed unchanged. Full authenticated HTTP route tests cannot yet run because no Phase 4B HTTP route has been introduced; those tests belong to the separately gated application cutover.

## 12. Phase 1 Source / Terminal Safety

`PHASE4_ASSESSMENT` is the canonical posting source; `trip_cancellation_fees.phase4_assessment_id` is a linked read-only compatibility projection. The terminal economic-trip unique index plus locked trip-state checks prevented fee/completion coexistence in the race fixtures. Replayed posting reused the same transaction. A compensating reversal retains the original terminal slot.

## 13. Driver Compensation Double-Pay Check

Positive fees created one `EARNED` Phase 4 Driver compensation and one Phase 1 payable credit. No `cancellation_credit` wallet transaction, Phase 2 commission credit, duplicate payable, or cash posting appeared in the exact-package matrix. `EARNED` does not mean `PAID`.

## 14. Dispatch Expiry

The dormant `phase4b_expire_dispatch_trip` implementation is guarded to unassigned requested/offered trips, marks R0 terminal expiry, cleans offers/jobs, and writes a durable event/outbox in one transaction. True overlapping sessions tested both lock orders against the exact package: Customer cancellation first produced R0 and expiry returned unchanged; expiry first produced R0 and Customer cancellation rejected the terminal trip. Each trip had one event, zero assessments, and zero monetary postings. The live caller was not switched.

## 15. Operational/Admin Cancellation

The dormant `phase4b_cancel_trip_operational` passed a fresh rollback-contained exact-package matrix: authorized pre-start Admin cancellation, replay, and rejection of ongoing, completed, and already-terminal different outcomes. It cannot override a financial terminal result. No live Admin route was switched.

## 16. Failure Injection / Rollback

The exact-package financial matrix suspended the disposable clearing account and proved the fee writer rolled back its terminal trip change when Phase 1 posting failed. `phase-4b-final-failure-injection.sql` additionally injected insert failures at liability, Driver compensation, financial transaction, business event, and notification outbox. All five rolled the trip back to assigned with no assessment, posting, or Phase 4 event. Duplicate calls replayed without duplicate source, event, or outbox. A deliberate second Phase 1 cancellation posting for the same assessment with a different idempotency key was rejected by the terminal-outcome guard, leaving one posted transaction. Post-commit notification delivery retry remains an application/outbox cutover test; the durable outbox is written transactionally, but no Phase 4B route yet sends it.

## 17. Reversal Deferral Safety

The unpaid/unsettled narrow reversal passed in earlier disposable testing, retaining source links and append-only actions. Collected liabilities, settled Driver compensation, refunds and recovery remain unsupported. Dormant installation creates none of those states; future routes must prevent unsupported Admin reversal actions. Activation must wait for a reviewed state-specific contract or a proven fail-closed gate for those states.

## 18. Historical Safety

The exact two-file package contains no old-fee conversion, backfill, recalculation, or automatic liability/grace creation. Disposable post-install zero counts corroborated schema-only installation.

## 19. Phase 2 Isolation

Disposable Phase 2 remained **OFF** before and after replay; production Phase 2 is **SHADOW**. Phase 4 fee compensation did not enter completed-trip commission, Driver wallet, or Phase 2 balance/lock paths in tested fixtures. The disposable OFF baseline does not itself prove a live SHADOW reconciliation run.

## 20. Production Read-Only Compatibility

Production `mvazbszenqahgqpznhhq` was queried with SELECT only: seven Phase 4A tables, zero policy/assessment/liability/compensation rows, zero 4B functions. Phase 2 policy remains SHADOW, 15%, R50 limit, subscription required. The final replay reset used production-read original Phase 1 function definitions and matched their fingerprints before installing the cutover on disposable. No candidate SQL ran on production. The current routes still call legacy Phase 05B paths, so schema installation alone does not switch runtime behavior.

## 21. Production Cutover Sequence

Future owner-approved stages must be separate: **A** install dormant 4B schema/functions; **A2** review and install the separate Phase 1 source/terminal cutover while no Phase 4 policy exists; **B** deploy authenticated server routes, Customer quote/reconfirmation UI, Driver no-show, dispatch expiry and operational Admin callers behind a disabled gate; **C** insert the approved immutable policy with a future coordinated `effective_from` only after routes and observability are ready; **D** verify first events, reconciliation, role/authorization, and legacy projection. Policy insertion is the economic cutover. Old routes must not remain authoritative for trips after that point.

## 22. Rollback / Fail-Closed Plan

Before policy activation and first use, a reviewed schema/function rollback may be possible. After real Phase 4 events, retain assessments, liabilities, compensations, actions, source links, journal and outbox. Disable/fail-close new Phase 4 entry paths for new trips, preserve already-effective policy/history, and triage in-flight trips by their creation/cutover timestamp. Do not fall back to legacy charging for post-cutover trips or drop populated finance tables. Refunds and settled reversals require compensating contracts, not row deletion.

## 23. Tests

`npm test`: 182 passed. `npx tsc --noEmit`: passed. `npm run lint`: passed with three pre-existing unused-variable warnings. `npm run build`: passed. `git diff --check`: passed for tracked changes. A scoped credential-pattern scan found no match in Phase 4B SQL/report. The new untracked fixture files require staged diff review before any future commit.

## 24. Real Remaining Blockers

No blocker to **installation planning** was found. Before **activation**, complete authenticated route implementation and HTTP role tests, resolve the multi-policy version-switch UX, test post-commit notification retry, and establish an explicit collected/settled reversal fail-closed gate. The future production SQL and deployment each require separate owner approval. These are bounded cutover items, not permission to activate now.

## 25. Production Status

**NO PHASE 4B PRODUCTION SQL. NO PHASE 4 ACTIVATION. NO APP DEPLOYMENT. NO ENV CHANGE.** No commit or push. After cleanup, disposable policy/assessment/liability/compensation/quote and race-fixture counts were zero; all four temporarily disabled cleanup guard triggers were enabled.

## 26. Final Gate

Owner may proceed to **PHASE 4B PRODUCTION INSTALLATION PLANNING** for the exact two candidate hashes, with the bounded cutover items and separate approvals above. This report does not approve SQL execution, deployment, policy activation, or Phase 4C.
