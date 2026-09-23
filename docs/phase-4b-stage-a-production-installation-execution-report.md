# MOOVU Phase 4B Stage A dormant production installation — 2026-09-14

## 1. Verdict

**PASS — STAGE A INSTALLED DORMANT IN PRODUCTION.** The exact approved file installed on the intended production project. Stage B was not applied; Phase 4 policy and application behavior remain inactive.

## 2. Repository state

Repository `D:\Users\KN Mudau\Desktop\Websites\moovu-kasi-rides-redesign`, branch `main`, HEAD `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`. The extensive pre-existing dirty worktree was left intact. No reset, stash, commit, push, application-code change, or deployment was performed.

## 3. Approved file and hash

Applied only `docs/phase-4b-atomic-decision-posting.sql`. SHA-256 was recomputed immediately before submission and matched `ba6ba11b8d67e87261ad6fdd2c925bdd44e3d611854770badbb8e33168404288`. The file was not edited. Its “disposable-only” header was expressly acknowledged and overridden by the owner's Stage A authorization. The submission placed session settings `lock_timeout='5s'` and `statement_timeout='120s'` before the unchanged file body; no other migration body was included.

## 4. Pre-installation baseline

Production project ref `mvazbszenqahgqpznhhq` was `ACTIVE_HEALTHY`, Postgres 17, eu-west-1. Migration history ended with Phase 4A foundation `20260914061234`. Seven Phase 4A tables existed with zero policy, assessment, liability, compensation, grace-cycle, ride-consumption or action rows. There were zero Phase 4B functions, no quote table/index or linked-fee column, and no Stage A object collision. One trip was active. No lock was waiting on the two altered tables immediately before submission.

Pre-install aggregate counts: 27 `trip_cancellation_fees`, 3 `financial_accounts`, 3 `financial_transactions`, 6 `financial_ledger_entries`; zero `PHASE4_ASSESSMENT` transactions. Phase 2 was SHADOW, subscriptions required, Go/Go XL 1,500 basis points, 5,000-cent debt limit, effective from 2026-09-11 18:04 UTC.

## 5. Installation result

Supabase `apply_migration` returned `success:true` for migration `phase4b_stage_a_dormant_atomic_decision_posting`, recorded as version **`20260914160339`**. The approved file's transaction completed; no manual patch or second migration was used. Post-install read-only verification was observed at 2026-09-14 16:04:08 UTC.

## 6. Objects installed

The original seven Phase 4A tables remain, plus the new `phase4b_cancellation_quotes` table with a 30-second expiry check, trip/customer/policy FKs, PK, `phase4b_quotes_trip_idx`, and RLS. `trip_cancellation_fees.phase4_assessment_id` exists with a unique constraint and restrictive FK to the canonical assessment. `financial_transactions_source_type_check` now permits `PHASE4_ASSESSMENT` and preserves all seven prior source values.

All 11 expected `phase4b_%` functions exist. Six service-role entry points are executable; five internal helpers are not service-role callable. The package added no user trigger to the quote table and replaced no existing Phase 1 or Phase 05B function.

## 7. Dormancy verification

Post-install counts were zero for Phase 4 policy, assessment, Customer liability, Driver compensation, grace cycle, ride consumption, financial action, quote, linked historical legacy fee, and `PHASE4_ASSESSMENT` transaction. The active-trip aggregate remained one. The current app routes still invoke legacy Phase 05B functions; no route switch or policy activation occurred.

## 8. Historical safety

Pre/post aggregate counts remained 27 legacy fee rows, 3 financial accounts, 3 transactions and 6 ledger entries. All 27 legacy fee links remained NULL. No historical row was converted, and no Phase 4 debt, payable, grace record or posting was created. The three existing POSTED completion transactions remained balanced; no unbalanced posted transaction was found.

## 9. Phase 1 non-interference

Both Phase 1 function body fingerprints matched **exactly before and after**:

| Function | Pre MD5 | Post MD5 |
| --- | --- | --- |
| `phase1_validate_financial_source(text,uuid)` | `c044f379c0d338a9ede7126f8f112f9c` | `c044f379c0d338a9ede7126f8f112f9c` |
| `phase1_post_financial_transaction(text,text,text,text,uuid,text,text,uuid,timestamptz,jsonb,jsonb,uuid)` | `9e30259ebf45690656a4ef41a0a13359` | `9e30259ebf45690656a4ef41a0a13359` |

The one-terminal-trip unique index remains present with the same recorded definition. Financial-entry immutability, transaction immutability, balanced-journal, and Phase 2 debt-floor guard triggers were enabled after installation. Stage B's replacement function hashes were **not** installed.

## 10. Phase 2 isolation

Before and after: SHADOW; subscriptions required; Go/Go XL 1,500 basis points; debt threshold 5,000 cents; effective from 2026-09-11 18:04 UTC. No Phase 2 setting changed. Three pre-existing SHADOW reconciliation non-parity rows remained three; they reflect 10% legacy versus 15% observational commission, not a Stage A effect.

## 11. Live RPC non-interference

The production body MD5 of each existing entry point was unchanged pre/post: `phase05b_cancel_trip` `395b8ade593ce6a3f480feb7161ad507`; `phase05b_mark_no_show` `0b00825bac13440d055e9b0fa83c41e2`; `phase05b_mark_arrived` `8e899dae0109622e9e4cc42aa9308e91`; `phase05b_cancel_trip_operational` `b1db15f45cf2092ebb1086becc1e6fda`; `phase05b_complete_trip` `7db5b255cb008b571dcfad32a6a3d3f9`; `accept_trip_offer` `4de436ea061cc5992113d865e5782bf1`; and `phase2_post_trip_commission` `8e7d6149fab4c892df773b5a9782eeca`. No live event was invoked for testing.

## 12. Security and grants

Anon and authenticated roles have no EXECUTE on any of the 11 new functions. Service role has EXECUTE only on the six intended entry points. Quote table RLS is enabled, with service role SELECT only and no anon/authenticated table grant. All seven Phase 4A tables retain RLS and no anon/authenticated direct write privilege. Financial transaction and ledger tables also deny anon/authenticated writes. The legacy fee table has broad table-level grants from its prior schema, but RLS is enabled and its only policies are Customer/Driver SELECT; no client write policy was found. No client can directly create the Phase 4 assessment, liability, compensation or posting through these grants.

## 13. Production health

Supabase remained `ACTIVE_HEALTHY`. Read-only HTTP GET results: homepage 200, Customer auth page 200, Driver login page 200, Admin login page 200, and unauthenticated `/api/customer/me` 401 as expected. No production trip, cancellation, no-show, payment or notification was manufactured.

## 14. Migration record

Project `mvazbszenqahgqpznhhq`; migration version `20260914160339`; name `phase4b_stage_a_dormant_atomic_decision_posting`; approved path/hash as in section 3. The exact intended table/column/constraint/index/function/grant/RLS objects are present. All aggregate counts, Phase 1 fingerprints, Phase 2 policy fields and live RPC fingerprints matched the pre-install baseline. The only `phase4_%` table count change is seven foundation tables to eight total because the new quote table is included in that prefix.

## 15. Stage B status

**PHASE 1 CUTOVER NOT APPLIED.** Migration history contains Stage A and no Stage B entry. Both Phase 1 production function fingerprints remain their pre-Stage-A values. The owner must separately approve `docs/phase-4b-phase1-cutover.sql` at SHA-256 `00e8a99c886f772f9dbb7dc40a5bbc5356d522a8553132bc6af30a5d2cfa676c` after a fresh preflight.

## 16. Deployment and environment status

**NO APP DEPLOYMENT. NO ENV CHANGE. NO PHASE 4 ACTIVATION.** No policy was inserted, and no Phase 4B application route was enabled. Phase 4C was not begun.

## 17. Real issues

No Stage A installation failure, object drift, lock timeout or production health regression was observed. The three known Phase 2 SHADOW non-parity rows predate this migration and should be carried into Stage B baseline comparison. The source file's old “disposable-only” comment is inconsistent with its newly authorized production use but did not affect execution; the exact validated bytes were preserved.

## 18. Final gate

**Stage A passed.** The owner may separately consider authorization for **PHASE 4B STAGE B — PHASE 1 CUTOVER INSTALLATION** after reviewing this execution record and a fresh Stage B preflight. This report does not authorize or perform Stage B, app deployment, policy activation or Phase 4C.
