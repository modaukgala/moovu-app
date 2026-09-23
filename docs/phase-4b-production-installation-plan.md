# MOOVU Phase 4B production installation plan — read-only review, 2026-09-14

## 1. Verdict

**READY FOR SEPARATE STAGE A / STAGE B OWNER APPROVAL**, subject to fresh preflight at each stage. This is a planning verdict, not execution approval. Stage A is a dormant schema/function installation; Stage B separately replaces two live Phase 1 functions. Neither creates an effective Phase 4 policy or changes an application caller. Stage C deployment, Stage D activation, and Stage E observation each require their own owner decision. No Phase 4C work is included.

## 2. Repository / hash state

Repository `D:\Users\KN Mudau\Desktop\Websites\moovu-kasi-rides-redesign`, branch `main`, HEAD `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`. The extensive dirty worktree was preserved; no commit, push, reset, stash, or unrelated edit was made. Exact candidate SHA-256:

| Stage | File | SHA-256 |
| --- | --- | --- |
| A | `docs/phase-4b-atomic-decision-posting.sql` | `ba6ba11b8d67e87261ad6fdd2c925bdd44e3d611854770badbb8e33168404288` |
| B | `docs/phase-4b-phase1-cutover.sql` | `00e8a99c886f772f9dbb7dc40a5bbc5356d522a8553132bc6af30a5d2cfa676c` |

Both hashes matched. **Stop** if either changes; revalidate changed files on a clean disposable baseline. The Stage A file's first comment says “disposable-only / do not install in production,” and Stage B's comment ties “activation” to coordinated route/policy cutover. Those are stale or ambiguous release labels relative to this owner-requested staged plan; obtain explicit owner approval naming the exact file and hash before any future installation. This review does not edit either candidate.

## 3. Current production baseline

Read-only Supabase project `mvazbszenqahgqpznhhq` was `ACTIVE_HEALTHY`, Postgres 17, eu-west-1. The Phase 4A foundation migration `phase4a_financial_state_foundation`, version `20260914061234`, is recorded; its local file SHA-256 is `da07331ffb7b4dfb0b714433a44ed590f1073c36e76825c61d50034a34bf3bc9`. At 2026-09-14 13:02 UTC, seven Phase 4A tables existed, all with zero rows:

`phase4_policies`, `phase4_fee_assessments`, `phase4_customer_liabilities`, `phase4_driver_compensations`, `phase4_customer_grace_cycles`, `phase4_grace_ride_consumptions`, and `phase4_financial_actions`. There were zero `phase4b_%` functions, no quote table, and no `trip_cancellation_fees.phase4_assessment_id` column.

Snapshot aggregate counts: 27 legacy `trip_cancellation_fees`, 3 `financial_accounts`, 3 `financial_transactions`, 6 `financial_ledger_entries`. All three transactions were POSTED `TRIP_FINANCIAL_COMPLETION` sourced from `TRIP`; no posted journal was unbalanced. One trip was active, in `assigned` state. These are **baseline snapshots**, not required fixed counts at a future window.

Phase 2 policy: SHADOW, subscriptions required, Go and Go XL 1,500 basis points, debt limit 5,000 cents; effective from 2026-09-11 18:04 UTC. Three existing SHADOW TRIP reconciliations have `parity=false` (aggregate legacy 2,130 cents, ledger 3,195 cents). Read-only grouping showed all three trips locked 1,500 basis points for SHADOW while their legacy commission percentage was 10.00%; the aggregate difference is consistent with those distinct rates. This predates Phase 4B and is not proof of a Stage B regression. Track any *new or unexplained* mismatch separately. Phase 2 remains observational, while subscriptions and legacy finance remain authoritative.

## 4. Dormant migration impact — exact manifest

**ALTER:** `financial_transactions` drops and recreates only `financial_transactions_source_type_check` to add `PHASE4_ASSESSMENT` to its allowed source types. All seven previously allowed values remain. This is a transactional constraint replacement that briefly requires a table lock and validation, even though current three rows use the preserved `TRIP` value. No transaction row is rewritten.

**ALTER/ADD:** `trip_cancellation_fees.phase4_assessment_id uuid` is added, nullable, unique, with a restrictive FK to `phase4_fee_assessments(id)`. The existing 27 rows remain NULL and untouched. The new link makes a future legacy fee row a compatibility projection of its canonical assessment, not a second financial source. No existing fee column is dropped.

**ADD:** `phase4b_cancellation_quotes` with PK, trip/customer/policy FKs, issued/expiry timestamps, immutable quoted terms, and a check limiting expiry to no more than 30 seconds. `phase4b_quotes_trip_idx` is added. RLS is enabled; all table grants are revoked from PUBLIC, anon, authenticated and service role, then service role receives SELECT only. Writes occur inside trusted definer functions.

**ADD:** 11 functions: `phase4b_service`, `phase4b_assert_owner_policy`, `phase4b_cancellation_terms`, `phase4b_quote_customer_cancellation`, `phase4b_post_assessment`, `phase4b_record_assessment`, `phase4b_cancel_customer_trip`, `phase4b_mark_customer_no_show`, `phase4b_expire_dispatch_trip`, `phase4b_cancel_trip_operational`, and `phase4b_reverse_unpaid_assessment`. The six external entry points (quote, Customer cancel, no-show, dispatch expiry, operational cancel, unpaid reversal) are executable by service role only. Five helpers are denied to service role and all 11 are denied to anon/authenticated. The installed disposable package confirmed these grants. These new functions do not replace production functions.

**Triggers:** none added, replaced, or dropped. **Source validator:** unchanged in Stage A. **CREATE OR REPLACE:** none in Stage A. No policy INSERT, no backfill, no liability/compensation/grace/ledger write, and no route switch occur during installation. The Phase 4B writers are not invoked by current routes.

## 5. Phase 1 cutover impact

Stage B has exactly two **CREATE OR REPLACE** statements, with unchanged signatures and existing grants retained:

| Function | Production signature | Current production body MD5 | Candidate body MD5 on exact-package disposable |
| --- | --- | --- | --- |
| `phase1_validate_financial_source` | `(text,uuid)` | `c044f379c0d338a9ede7126f8f112f9c` | `8fe30d1d1cbb612e08928469f7a9d700` |
| `phase1_post_financial_transaction` | `(text,text,text,text,uuid,text,text,uuid,timestamptz,jsonb,jsonb,uuid)` | `9e30259ebf45690656a4ef41a0a13359` | `b450d3c81ce224ace2006745c5cd293a` |

Full `pg_get_functiondef` MD5 values, useful as a second fingerprint, are respectively `e880faeb331840dcb83d5c8ca27dcf05` → `2430bb974c79dead8daed501cd6bda58` and `5f8b2dd0eb7f54534775bbab3aa134d1` → `06d6d5fc4cb804e5831d41ce1d509167`.

The validator adds existence checking for canonical `PHASE4_ASSESSMENT` and retains all existing source branches. The posting helper accepts that source for cancellation/no-show, derives its economic trip, locks the trip and checks completed/cancelled terminal state, checks assessment/type correspondence, and preserves the one-terminal-trip guard. It keeps existing currency, positive/balanced entries, active account, idempotency, source uniqueness, and reversal behavior. No existing transaction or index is rewritten. The production `financial_transactions_one_terminal_trip_outcome_uidx` is present and unchanged.

## 6. Existing financial regression review

Production database callers of the Phase 1 posting helper are `phase2_post_trip_commission`, `phase2_post_verified_driver_payment`, and `phase1_reverse_financial_transaction`. Application completion calls `phase05b_complete_trip` first and then Phase 2 SHADOW commission posting; the Phase 2 function itself already requires `trip.status='completed'`, so Stage B's new completed-state check is consistent with this flow, including replay. The verified Driver payment uses a nonterminal `DRIVER_PAYMENT` category, so the new trip terminal guard is not entered. Reversal remains sourced from `FINANCIAL_TRANSACTION`, retains its separate function and inverted balanced entries. Legacy `TRIP_CANCELLATION_FEE` validation/posting remains supported, provided the trip is cancelled.

The three existing posted completions and six entries are balanced. The existing three SHADOW parity mismatches reflect 10% legacy versus 15% observational commission; capture them before Stage B and compare after natural future completions so they are not misreported as Stage B-created. No production completion, payment, reversal, or synthetic event was invoked during this review.

## 7. In-flight trip safety

Stage A and B have no policy activation or caller change, so existing requested/offered/assigned/arrived/ongoing trips continue on legacy routes. At Stage D, route authority must be chosen by the **server-recorded trip creation timestamp against the immutable policy `effective_from`**, under one consistent server/database contract. A trip created before `effective_from` remains under legacy cancellation/no-show rules even if assigned, arrived, started, or cancelled later. A trip created at or after `effective_from` uses Phase 4 rules only when the policy is effective and all writers/UI are ready. This includes a trip already in flight at the activation instant: do not switch it mid-trip. The selector must read authoritative policy state without a stale cache, and an after-cutover trip must never fall back to legacy charging on error. A safe server boundary must handle policy/route races around the exact timestamp; Stage C tests must prove it before policy insertion.

## 8. Activation preconditions

Before an effective policy can be approved: Stage A and B installed and verified; authenticated Customer and Driver routes tested across owners; Customer quote display and confirmation/reconfirmation UX deployed; multi-policy pre-cutover-trip handling resolved; post-commit outbox retry tested; collected/settled reversal actions fail closed; dispatch expiry and Driver/Admin operational cancellation callers switched safely; all alternate legacy entry points audited; application tests/typecheck/lint/build pass; production deployment and target verified; Phase 2 still SHADOW; subscriptions unchanged; no unexplained new Phase 2 or ledger anomaly. An activation review must recheck each condition, not inherit a previous PASS.

## 9. Multi-policy reconfirmation item

The current candidate prevents silent repricing if a newer policy appears, but for an old trip its eligibility check raises `Trip predates active Phase 4 policy` before returning `requires_reconfirmation`. Money is protected, so this does **not** block dormant Stage A or financial Stage B installation. It **does block Stage D activation approval** until the server distinguishes a pre-policy legacy trip from an existing Phase 4 trip quoted under an older policy. For a Phase 4 trip, select the correct immutable policy/version for that trip; if confirmation terms have changed, return a typed reconfirmation response and require a new quote. Do not turn the error into legacy fallback for an after-cutover trip. Implement and test this in a separately approved Stage C change; do not alter the validated SQL files during this plan.

## 10. Reversal gate

The Phase 4B reversal only covers an assessment whose Customer liability remains wholly unpaid and whose Driver compensation remains EARNED/unsettled. Its state checks and source links must be used by an Owner/Admin route. If the liability has been collected in whole or part, or Driver compensation has been settled/paid, the Admin action must return a clear unsupported-state response **without invoking an alternate generic reversal, refund, or balance edit**. The route must inspect authoritative liability/compensation/payment/settlement state server-side and recheck it within the database operation where applicable. The later collected/settled recovery contract belongs to Phase 4D, not this task.

## 11. Notification retry gate

Stage C must test a natural-equivalent disposable event where one assessment, liability, compensation, Phase 1 transaction, business event and outbox item commit; delivery then fails **after commit**; a worker retry delivers once (or records an idempotent replay) without reposting finance or duplicating any source row. This is an activation gate, not a blocker to dormant installation. Do not create a fake production fee event for the test.

## 12. Stage A — dormant installation procedure

**Separate Approval A required.** Reconfirm project ref `mvazbszenqahgqpznhhq`, project health, Phase 4A migration/version, candidate SHA, seven table names/counts, no 4B functions/table/linked column, no policy, current Phase 2 settings, financial and legacy fee aggregate counts, active-trip aggregates, constraint/index definitions, and app health. Snapshot existing schema/functions and current counts for rollback review. Plan a quiet low-traffic window because ALTER TABLE constraint replacement and nullable unique/FK column installation can briefly lock production tables. Set a bounded lock/statement timeout through the approved execution method if compatible with applying the **exact** file; abort on unexpected lock wait rather than holding checkout traffic.

Apply only `docs/phase-4b-atomic-decision-posting.sql` with the exact SHA above after owner approval. Do not run disposable correction/reset/test files. Post-check: one quote table, one quote index, 11 4B functions with six service-only entry grants, quote RLS and service-only SELECT, linked fee column with unique/FK, expanded source constraint, **no Stage B Phase 1 body-hash change**, no active policy, all seven Phase 4A row counts still zero, unchanged legacy/Phase 1 aggregates except legitimate live drift, Phase 2 SHADOW unchanged, and app health/ordinary trips unaffected. Stop if any object, grant, count, policy, function fingerprint, lock duration, or app response differs unexpectedly. Before any use, rollback is a separately reviewed dependency-order removal of unused Stage A objects plus restoration of the prior constraint; never delete populated financial rows.

## 13. Stage B — Phase 1 cutover procedure

**Separate Approval B required after a Stage A PASS.** Reconfirm project, exact Stage B SHA, current two Phase 1 signatures and production body hashes above, installed Stage A dependencies, terminal unique index, existing source check, no Phase 4 policy or use, Phase 2 SHADOW, baseline three parity mismatches, current financial counts/balance, and app health. If current function fingerprints drift from the recorded preimage, stop for renewed review. Capture exact prior `pg_get_functiondef` definitions and grants before replacement for a narrow pre-use rollback.

Apply only `docs/phase-4b-phase1-cutover.sql` after Approval B. Post-check candidate body hashes above, same signatures and grants, unchanged terminal/source indexes, old source branches retained, balanced posted ledger, Phase 2 policy/counts and prior mismatch baseline not worsened by the install itself, no Phase 4 policy/event, and app/ordinary completion-route health by **read-only** probes. Do not manufacture a production completion. Observe the next legitimate completion and its SHADOW reconciliation before declaring operational confidence. If no Phase 4 event used the new source contract, a separately reviewed restoration of the captured two prior definitions is possible; after Phase 4 use, do not restore functions in a way that strands `PHASE4_ASSESSMENT` history.

## 14. Stage C — gated application deployment plan

**Separate Approval C required.** Implement authenticated Customer quote and confirm endpoints plus Customer UI, authoritative Driver no-show checks, atomic dispatch expiry caller, and safe Driver/Admin operational cancellation caller. Current production paths still call `phase05b_cancel_trip`, `phase05b_mark_no_show`, `phase05b_cancel_trip_operational`, and multi-request `cancelExpiredDispatch`; public unauthenticated cancellation is disabled. Keep Cash/Transfer, legacy pre-cutover trips, subscriptions and Phase 2 SHADOW unchanged. Route by authoritative trip creation/policy time; keep Phase 4 policy absent or future-effective while deploying, and reject after-cutover requests if required Phase 4 capability is unavailable. Do not expose service keys. Validate Customer A/B, Driver A/B, Support/Admin, quote races, failed posting, outbox retry, and alternate entry points before deployment. Deployment alone must not create Phase 4 economics.

## 15. Stage D — policy activation plan

**Separate Approval D required.** Only after all Stage C gates pass, take a fresh UTC timestamp and snapshot Phase 2 mode/policy, subscription state, financial and legacy aggregate counts, seven Phase 4A table counts, active/in-flight trip counts by status, deployed application revision, route-gate state, and project health. Review the immutable policy version and a future `effective_from` with exact approved ZAR cents: free window 180 seconds; no-show 300 seconds; Go late 2,000 = 1,300 Driver + 700 MOOVU; XL late 3,000 = 2,000 + 1,000; Go no-show 3,000 = 2,200 + 800; XL no-show 4,000 = 3,000 + 1,000. Confirm no conflicting version/effective time exists and active trips remain on legacy authority. Insert the reviewed policy only in its separately approved activation run, then verify effective policy and route selection without creating a fake fee event.

## 16. First-event reconciliation plan

**Stage E requires separate continue approval.** Observe natural free cancellation, charged late cancellation and no-show as they occur. Per event compare terminal trip state, authoritative timestamp/policy, single assessment, linked legacy projection, one liability, one EARNED Driver compensation, one balanced Phase 1 transaction, grace-cycle start where applicable, one business event/outbox, and no cash assertion or Phase 2 completed-trip commission on compensation. A free event must have no fee, liability or monetary posting. Reconcile posted entries and notification delivery independently. Record aggregate counts and redacted evidence; never fabricate a production trip/payment for smoke testing.

## 17. Monitoring / stop conditions

Fail-close new Phase 4 entry paths immediately for duplicate terminal posting/assessment/Driver payable, ledger imbalance, wrong split, unassigned charge, charge before 180 seconds, no-show before 300 seconds or without qualified arrival, silent quote repricing, Phase 2 commission on cancellation compensation, fake cash, orphan/duplicate outbox, historical backfill, or unexpected legacy behavior. Preserve all committed records, capture evidence, and reconcile with append-only corrections. Do not delete finance rows or silently fall back to legacy for post-cutover trips. Keep Supabase quota monitoring as a separate infrastructure follow-up.

## 18. Rollback by stage

| Boundary | Safe response |
| --- | --- |
| A before use | Stop; after dependency review remove only unused A objects and restore original source constraint. |
| B before Phase 4 use | Restore captured prior two function definitions/grants only after verifying no `PHASE4_ASSESSMENT` transaction depends on them. |
| C before activation | Revert/disable gated app paths; with no effective policy all trips remain legacy. |
| D after policy insertion but before Phase 4 event | Prefer fail-closed gate and a reviewed forward-effective policy/route correction; immutable policy rows must not be deleted casually. |
| D after real events | Never drop or rewrite assessments, liabilities, compensation, postings, actions or outbox. Fail-close new Phase 4 entry paths; preserve and reconcile history and handle in-flight trips by their creation-time authority. |

## 19. Deployment order / downtime recommendation

Run A, verify, pause; run B, verify, pause; deploy C gated and verify, pause; activate D with a future effective timestamp, then observe E. A and B are separate production windows and approval decisions, not one implicit transaction. A quiet window is prudent for table DDL, with bounded lock wait; no planned customer downtime is needed if locks are short and app remains on legacy paths. C can be a normal gated deployment. Near D, briefly fail-closing cancellation/no-show is preferable to mixed legacy/Phase 4 charging if coordinated routing cannot be proven. Do not insert an effective policy while old routes or cached policy selection could process after-cutover trips.

## 20. Owner approval gates

Approval A names the dormant file/hash and production ref. Approval B separately names the Phase 1 replacement file/hash and captured function preimages. Approval C covers the exact gated app revision/deployment. Approval D covers the immutable policy version, amounts, effective UTC time and activation runbook. Approval E is the decision to continue after natural first-event reconciliation. A PASS at one gate never authorizes the next.

## 21. Real blockers

No evidence-backed blocker to **requesting separate owner approval for Stage A and Stage B** was found. Stage A's misleading “disposable-only” comment must be explicitly acknowledged when Approval A is requested. Stage B must recheck current function fingerprints and the three understood 10%-versus-15% SHADOW differences before execution. **Stage D remains blocked** by absent Phase 4B routes/UI, multi-policy reconfirmation handling, post-commit notification retry proof, and a collected/settled reversal fail-closed Admin path. These activation items do not require delaying a verified dormant installation.

## 22. Production status

**NO PHASE 4B PRODUCTION SQL APPLIED. NO PHASE 4 ACTIVATION. NO APP DEPLOYMENT. NO ENV CHANGE.** All production database calls in this review were SELECT/read-only metadata queries. No production trip, payment, notification, or financial event was created.

## 23. Final gate

The owner may **separately authorize** Stage A — Phase 4B dormant production database installation — and, only after its verified completion, Stage B — Phase 1 cutover installation. Neither stage is authorized by this plan. Stage C, D, E and Phase 4C remain outside this execution scope.
