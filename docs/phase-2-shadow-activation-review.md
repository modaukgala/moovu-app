# Final Phase 2 SHADOW activation review

Review date: 11 September 2026  
Repository: `D:\Users\KN Mudau\Desktop\Websites\moovu-kasi-rides-redesign`  
Production Supabase: `mvazbszenqahgqpznhhq`  
Production deployment: `dpl_2tZbsRFZ3t92gzgeboXqDhYY18Ng` (READY)  
Rollback deployment: `dpl_G34Qh4vHNeECgevMM1GmA1CYCeso`  
Corrective migration SHA-256: `46d4e019e336da5a7064f8aa7a1dd20f9ce1d2eacddf8b0379e20c209e3be0b0`  
Review mode: read-only; SHADOW was not enabled.

## Decision and resolved blocker

The prerequisites for a separately approved, monitored SHADOW activation are satisfied. The original historical-payment blocker is **RESOLVED** by the validated cutoff/debt-floor correction, its installation in production, and deployment of the route that recognizes `PRE_CUTOFF_SKIPPED` as resolved.

The original review found that the payment RPC could replay the historical R104.60 approval, reduce nonexistent Phase 2 debt below zero, and hide that result through clamping. The correction now compares immutable `reviewed_at` with one immutable cutoff, persists pre-cutoff skips with zero financial effect, caps payment application at posted debt, places legitimate excess in unapplied credit, locks each Driver posting path, and rejects negative debt structurally.

The current quota classification is **SAFE BUT MONITOR**. This review does not authorize activation.

## Repository and validation

- Branch: `main`
- HEAD: `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`
- Existing dirty work was preserved; no reset, clean, stash, revert, commit, or push occurred.
- Correction tests: **5/5 PASS**
- Phase 2 focused suite: **22/22 PASS**
- Full direct Node suite: **170/170 PASS**
- TypeScript: **PASS**
- ESLint: **PASS**, 0 errors and 3 existing unrelated warnings
- Production build: **PASS**, 171/171 pages
- Credential scan: **PASS**, zero candidates
- `git diff --check`: **PASS**, line-ending notices only

## Current production state

Vercel confirms the production deployment is READY. Its reviewed correction route is `src/app/api/admin/payment-reviews/route.ts`, SHA-256 `B67A573AE769FD29EA83ACE1C6EE30F4FCE80C00DEF57141DE96B837C6F880A8`.

SELECT-only production verification returned:

| Item | Value |
| --- | ---: |
| Database policy mode | OFF |
| `effective_from` | NULL |
| `subscription_required` | true |
| Financial accounts / transactions / entries | 0 / 0 / 0 |
| Shadow reconciliation rows | 0 |
| Corrected functions / triggers | 3 / 3 |

Application mode also defaults to OFF. SHADOW and AUTHORITATIVE are OFF, 15% and R50 are inactive, subscriptions remain authoritative, and no opening balances exist.

## Health and quota

Supabase is Healthy, available, not paused or read-only, and has no active HTTP 402 restriction. The latest dashboard evidence showed CPU 4%, disk 4%, RAM 49%, connections 9/60, and no Advisor issue.

- Egress: 2.003/5 GB (40%); 2.997 GB remaining; zero current overage
- Storage: 0.679/1 GB (68%)
- Database: 0.073/0.5 GB (15%)
- Grace period: active due to previous-cycle egress; ends 19 September 2026

SHADOW adds low-volume RPC, ledger, and log traffic. Current capacity permits starting before 19 September, but quota must be checked daily and on the deadline. Any 402 or restriction is an immediate stop condition.

## Corrective objects and authorization

Production contains `phase2_guard_finance_policy_cutoff()`, `phase2_assert_driver_commission_debt_floor()`, corrected `phase2_post_verified_driver_payment(uuid,uuid)`, and their three triggers. All corrected functions use fixed `search_path=public, pg_temp`.

The payment RPC is service-role-only; PUBLIC, anon, and authenticated are denied. The HTTP route admits Owner/Admin, rejects Dispatcher/Support, and derives the actor from the authenticated session. Null, malformed, missing, or client-forged actors fail closed. Per-Driver advisory locking, source uniqueness, and the debt-floor trigger protect concurrent retries and non-negative debt. The cutoff may be set once and is then immutable.

## Historical R104.60 safety

Request `e7e165ee-48e1-407b-afac-bf051f9cd080` remains approved for R104.60 with `reviewed_at = 2026-09-06 12:53:20.282831+00`. It has zero Phase 2 transactions and zero shadow decisions.

With a later cutoff, an authorized replay will persist `PRE_CUTOFF_SKIPPED`, apply zero debt reduction and zero credit, create no financial transaction or eligibility effect, and return the persisted skip on later retries. The deployed route logs it as resolved and does not resend the notification. The request was not replayed in this review.

## Exact future cutover

Choose one server-controlled UTC timestamp `T` at least 15 minutes ahead. In a separately approved activation, execute exactly one guarded row update:

```sql
begin;
select pg_advisory_xact_lock(hashtextextended('phase2-shadow-activation', 0));
update public.phase2_finance_policy
set mode='SHADOW', effective_from=timestamptz '<T>', updated_at=now()
where policy_key='phase2-driver-finance'
  and mode='OFF'
  and effective_from is null
returning policy_key,mode,effective_from,subscription_required,
          go_basis_points,go_xl_basis_points,debt_limit_cents;
commit;
```

Exactly one row must return `SHADOW`, timestamp `T`, `subscription_required=true`, basis points 1,500/1,500, and debt limit 5,000 cents. Then set the existing production application mode to SHADOW and deploy the exact current production source, reaching READY before `T`. The database update must occur first with future `T` so every trip created at/after `T` receives its snapshot.

If READY cannot be reached before `T`, return both modes to OFF before `T`. Because the cutoff becomes immutable, restarting after an OFF interval requires a separately reviewed policy-version/resumption design; it must not silently reinterpret events during the interval.

Payments use immutable `reviewed_at`; trips use immutable creation-time snapshots. Events before `T` remain historical, and events at/after `T` enter SHADOW.

## SHADOW economics

Legacy remains authoritative. SHADOW does not alter customer charges, Driver eligibility, dispatch, offers, active trips, subscription rules, payment approvals, or trip completion. It posts an independent comparison ledger only. It creates no opening balances automatically.

### 15% behavior: option A

Post-cutoff trips lock a 15% Phase 2 snapshot. Legacy remains authoritative at Go 10% and Go XL 12%. A correct 10%/12% versus 15% difference is **EXPECTED BUSINESS-POLICY VARIANCE** when there is exactly one balanced, correctly sourced transaction using the locked fare and 1,500 basis points.

A missing/duplicate source, wrong fare or formula, wrong snapshot, unbalanced transaction, orphan entry, conflicting payload, negative debt, or unexplained amount is a **TECHNICAL DEFECT**.

### R50 and subscriptions remain observational

Phase 2 calculates proposed eligibility below 5,000 cents, but no dispatch, offer, active-trip, status, or assignment path consumes it in SHADOW. Legacy R100 plus active subscription rules remain authoritative. Compare both eligible, both restricted, legacy-only eligible, and Phase2-only eligible; never lock a Driver from Phase 2 data.

`subscription_required` remains true outside AUTHORITATIVE. A proposed no-subscription comparison is read-only and must not update Driver or subscription state.

## Payment behavior

- Pre-cutoff approval: persisted zero-effect skip.
- Post-cutoff approval: database-authoritative shadow posting.
- Applied amount: capped by posted Phase 2 debt.
- Legitimate excess: unapplied credit.
- Negative debt: rejected atomically.
- Legacy approval: authoritative.
- Recovery: replay retries stable `driver_payment:<request UUID>` identity.
- Concurrent/third retry: persisted result, no duplicate finance.
- Notification: suppressed on legacy replay.

## Trip completion

The hardened legacy completion RPC commits the real trip and legacy commission. SHADOW then calls `phase2_post_trip_commission` using `trip_commission:<trip UUID>`. A shadow failure never reverses a legitimate legacy completion. An authorized replay retries the same source; idempotency prevents duplicate finance, and replay suppresses duplicate direct notification.

A trip created before `T` has no Phase 2 snapshot even if it completes later. Activate only when there is no active/ongoing trip to avoid misleading unresolved logs and ambiguous first-window evidence. This needs a brief quiet window, not platform downtime.

## Reconciliation and observability

The SELECT-only production report must measure:

- eligible legacy and shadow populations;
- exactly one posted transaction per eligible source;
- historical skips;
- missing, recovered, and unresolved effects;
- duplicate source/idempotency violations;
- expected policy variance versus unexpected posting variance;
- per-Driver debt and unapplied credit;
- unbalanced transactions, orphan entries/transactions, invalid reversals, and all invariant violations.

Use `docs/phase-2-disposable-invariants.sql` as the invariant pattern and add cutoff-population left joins for missing trip/payment effects. Monitor `phase2_shadow_reconciliations`, financial transactions/entries, authoritative trip/payment rows, Phase 0.5 business events/outbox, and Vercel resolved/unresolved logs. There is no dedicated Phase 2 Admin dashboard. At current volume, inspect every legitimate event on day one and run reconciliation at least daily afterward.

## Failure response

| Condition | Action |
| --- | --- |
| One transient shadow timeout/DB error after legacy success | Continue briefly; authorized replay must recover exactly one source |
| Process crash/overlapping retry | Continue only if idempotent recovery succeeds and invariants remain clean |
| Malformed actor/wrong role | Expected denial; stop if any mutation occurs |
| Missing/mismatched cutoff | Do not start or immediately return both modes OFF |
| HTTP 402, pause, or read-only restriction | Immediately return both modes OFF and reconcile all in-scope events |
| Duplicate, negative debt, imbalance, orphan, invalid reversal, wrong source, or unexplained variance | Immediately return both modes OFF and preserve evidence |
| Persistent missing effect or legacy/customer/Driver regression | Return OFF; use application rollback if code-related |

Returning OFF ends this observation under the immutable cutoff. Resumption requires separate review. This is not an AUTHORITATIVE rollback design.

## Authenticated-check status

No owner-controlled Admin session was available during deployment, and no payment should be manufactured. This is not a blocker because route/role tests pass, unauthenticated production APIs return 401, production grants are service-role-only, disposable Owner/Admin and denial matrices passed, and live post-deployment Driver API traffic returned 200.

Use existing controlled accounts for non-mutating portal checks at activation if available. Absence of a natural payment is evidence coverage to record, not permission to create one.

## Activation window

Immediately before activation require:

- Healthy Supabase, no 402, quota below limit;
- application and database OFF; cutoff NULL;
- ledger 0/0/0, zero shadow rows, zero invariant violations;
- production deployment READY with no unresolved errors;
- all corrected objects/grants present;
- no migration or deployment underway;
- no active/ongoing trip;
- no commission/combined payment review in flight; and
- monitoring plus OFF response assigned and open.

Use a brief booking/payment-review hold around `T`, then release it after both modes and the exact cutoff are verified.

## Initial observation target

Observe 7 days and at least 8 naturally completed post-cutoff trips. If traffic is lower, extend only until 8 trips, capped at 14 days. Observe one legitimate commission/combined Driver payment if it occurs naturally.

If no payment occurs, retain disposable payment proof, record zero production opportunities, and observe the payment path for up to 30 calendar days. Do not manufacture transactions. A recovery pauses the acceptance clock until reconciled.

## Pass and stop criteria

SHADOW passes only when legacy behavior remains correct; every eligible event posts exactly once; historical payments remain zero-effect skips; all recovery completes; duplicate finance, negative debt, imbalance, orphans, invalid reversals, invariant violations, unresolved failures, and unexpected variance are zero; policy variance is correctly classified; R50/subscription effects stay observational; and quota/logs remain healthy.

Stop immediately for authoritative behavior change, authorization bypass, unexpected historical posting, incorrect cutoff, duplicate/unbalanced finance, negative debt, persistent missing effects, unexplained amount variance, HTTP 402/restriction, or SHADOW-attributable health degradation.

## Blockers and recommendation

No technical blocker remains. The quota grace period is an operational warning requiring daily monitoring. The exact coordinated cutoff procedure, brief quiet window, and OFF response plan are required. Authenticated non-mutating portal verification is desirable but not blocking.

Proceed only after explicit owner approval of the exact timestamp, SQL row update, production environment change, deployment, monitoring owner, and OFF response plan.

## Final safety confirmation

SHADOW was not enabled. AUTHORITATIVE remains OFF, `effective_from` remains NULL, 15% is not authoritative, R50 is not enforced, subscriptions are unchanged, opening balances are absent, and ledger/shadow counts remain 0/0/0 and zero. No deployment, production mutation, environment change, commit, push, Yoco work, or Phase 3 work occurred.

## Final verdict

PHASE 2 FINAL SHADOW ACTIVATION REVIEW PASSED

READY FOR OWNER APPROVAL TO ENABLE PHASE 2 SHADOW
