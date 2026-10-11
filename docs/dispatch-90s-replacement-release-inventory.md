# Combined booking and 90-second dispatch replacement release

## Source evidence and limit

- The candidate is assembled in the isolated `codex/dispatch-90s-release` worktree from Git commit `af4b257ed933b20c9dce24193483dfa161ccb5fd`. Its parent `55c0bb41d9c37f742a2251b7032dabb3eabc699b` supplies the review comparison for the complete booking and dispatch change. This is a **known Git baseline for the new release**, not proof of the old production deployment's source.
- Existing `moovu-app` deployment `dpl_GUBjxjjV523W8GRgC9Ex56izLCgt` is READY. Vercel exposes a 956-output build inventory and build configuration, but its available deployment record has no source archive, `gitSource`, commit metadata or Git SHA. The build-output digest is not a source-tree digest; no Git equivalence is claimed. The September release manifest predates this deployment, and GitHub `main` is at `be20fb47424731e666af5698f283eaf8c4b1c5d2`, so neither proves the deployed source.
- The residual risk is replacement of unknown live source changes. The staged build must be compared by route/behavior against the current live application, and any material difference must block promotion. This inventory does not retroactively certify old source provenance.
- A read-only comparison found no API route present in the deployed Vercel build inventory that is absent from the isolated release build. Public HEAD requests for `/`, `/book`, `/driver` and `/admin` returned HTTP 200. These are route/availability checks only; they do not establish authenticated feature or byte-for-byte source equivalence.

## Review of all 19 candidate files

| File | Classification | Release treatment |
| --- | --- | --- |
| `docs/dispatch-90-second-booking-candidate.md` | Required release documentation | Retain historical and current disposable evidence; older progress notes are chronological. |
| `scripts/booking-defaults-disposable-e2e.mjs` | Required regression test | Disposable-only fixture; no production execution. |
| `src/app/api/jobs/dispatch/route.ts` | Required 90-second dispatch | Authenticated worker and narrowly guarded disposable selector. Selector is unavailable outside development and the exact disposable project. |
| `src/app/book/page.tsx` | Required booking confirmation | Modal, single-submit guard, disclosed terms and fare; the initial modal implementation is in the known base commit. |
| `src/app/globals.css` | Required booking confirmation | Mobile action placement above visible navigation. |
| `src/lib/dispatch/dispatchCandidates.ts` | Required 90-second dispatch | Nearest-first paging for the new policy; isolated release correction preserves the exact legacy 250-row query. |
| `src/lib/dispatch/dispatchTrip.ts` | Required 90-second dispatch | Opt-in routing; old trips retain legacy dispatch. |
| `docs/disposable-dispatch-90s-scheduled-http-test.sql` | Required disposable test documentation | **Never install in production.** |
| `docs/disposable-dispatch-90s-scoped-claim.sql` | Required disposable test documentation | **Never install in production.** |
| `scripts/dispatch-90s-disposable-e2e.mjs` | Required regression test | Disposable lifecycle and scheduled-cadence harness only. |
| `scripts/dispatch-90s-fairness-disposable-e2e.mjs` | Required regression test | Disposable paid/Cash fairness harness only. |
| `scripts/dispatch-90s-paid-disposable-e2e.mjs` | Required regression test | Synthetic signed TEST webhook harness, not hosted Yoco acceptance. |
| `src/lib/dispatch/dispatchTrip90s.ts` | Required 90-second dispatch | Nine bounded slots, nearest-first reservations, terminal closure and no-driver reconciliation. |
| `src/lib/dispatch/matchingWindowPolicy.test.ts` | Required regression test | Timing, paid-radius and activation checks. |
| `src/lib/dispatch/matchingWindowPolicy.ts` | Required 90-second dispatch | Ten-second slots, 90-second deadline, effective-from opt-in. |
| `src/lib/dispatch/notifyDriverOffer.ts` | Required 90-second dispatch | Existing Driver-account-to-`sendPushSafe()` routing extracted for reuse; provider integration unchanged. |
| `supabase/migrations/20261010185641_dispatch_90_second_matching.sql` | Required migration 1 | Additive matching table, indexes, bounded offer guard and trusted start/finish authority. |
| `supabase/migrations/20261010190029_dispatch_90_second_security_correction.sql` | Required migration 2 | Restricts new matching-table service grants and guard-function execution. |
| `supabase/migrations/20261011103000_dispatch_matching_terminal_lifecycle.sql` | Required migration 3 | Terminal outcome constraints and triggers; corrects only terminal rows with a matching window. |

No file in the 19-file candidate was classified as unrelated. The two `docs/disposable-*` SQL helpers are test assets, not production migrations. The source change does not alter commission, debt, subscription, Yoco payment authority, FCM provider implementation, authentication, or Driver eligibility rules. The only notification code movement preserves the existing `sendPushSafe()` call.

## Production database and recovery preflight, read-only

- Production project `mvazbszenqahgqpznhhq` is `ACTIVE_HEALTHY`. The three matching migrations are absent from production history; `dispatch_matching_windows`, its start/finish RPCs, `matching_step` and the no-Driver index are absent. Referenced trips, offers, online attempts and reconciliation tables/columns exist. Existing relevant tables have RLS enabled. There are no conflicting matching index, trigger or function names. The three migrations were previously installed and exercised in order on disposable `tangtlmdpnvmoviwrgvd`; its matching table, RPCs and three triggers are present. This is compatibility evidence, **not** authorization to execute the SQL before a fresh recovery gate.
- Migration SHA-256, in order: `20261010185641_dispatch_90_second_matching.sql` = `0137D108D8DE3B166B35D1DCBCCEB0C244F462BE98EBB2571DF515FB99A0AD4E`; `20261010190029_dispatch_90_second_security_correction.sql` = `54F45B9A117833DA3FCE0B4982E0830310C1E8A8AD7537BD67BCE31839D8B442`; `20261011103000_dispatch_matching_terminal_lifecycle.sql` = `189AA0871D29EDAF930767D73A3DD4A82474F472F769F71CD79257C0301D0EB2`.
- Finance policy remains AUTHORITATIVE, Go/XL 1,500 bp, debt limit 5,000 cents, `subscription_required=false`; Phase 6 policy is OFF. Read-only checks found zero unbalanced transactions, duplicate transaction keys, duplicate provider-event identities or duplicate Driver payables. Production has zero active assigned trips and one awaiting trip at the observed snapshot; this is not a future safe-window certification.
- The last locally available encrypted archive, `moovu-mvazbszenqahgqpznhhq-1791436136007.moovubak`, matches its documented 8,456,150-byte size and SHA-256 `0BD4EB21F4C2762668CE5CEF7B849235B29B7DA749CF9F8EBBBA2E2D3ABC70D2`. It has an earlier independent restore certification, but **28 trips were created after its 8 October capture**. It is not a current recovery point for this release; a fresh production backup and recovery certification are required before staged production work.
- `pg_cron` and `pg_net` are available but not installed in production. A production five-second authenticated scheduler, credential handling and existing-queue isolation remain a separate activation gate. The code must be deployed with `MOOVU_DISPATCH_90S_ENABLED` absent/false until that gate passes.
- Vercel Production lists the existing Yoco checkout/webhook, Firebase server/client, Supabase and `DISPATCH_JOB_SECRET` variable **names**. Their encrypted values and actual Supabase binding were not retrieved or certified. Neither `MOOVU_DISPATCH_90S_ENABLED` nor `MOOVU_DISPATCH_90S_EFFECTIVE_FROM` is listed, so the new policy remains OFF by default in the present configuration. Provider acceptance is not inferred from variable names.

## Isolated validation

- `npm ci --ignore-scripts` installed the pinned dependencies without changing the lockfile. NPM reported 37 dependency advisories (1 low, 9 moderate, 22 high, 5 critical). No dependency was added or upgraded in this release; those advisories need separate triage before a security-certification claim.
- Full regression: 312/312 PASS. Focused dispatch/matching/Yoco contract tests: 22/22 PASS. TypeScript PASS; ESLint PASS with five existing warnings; disposable-configured production build PASS; scoped credential-pattern scan, script syntax checks and `git diff --check` PASS.
- A connected legacy Cash/Transfer disposable booking regression passed 27/27 checks after the legacy query-preservation correction. It confirmed a no-subscription Driver offer, booking replay without duplicate offer/ledger effect, Admin re-offer, 15% commission snapshots and the R50 policy record. The first isolated attempt stopped before booking because the isolated process lacked a Google Maps server key; the successful retry passed that already configured key only as a process environment value, without copying or printing it. These tests ran only against `tangtlmdpnvmoviwrgvd`.
- The prior connected nine-slot, concurrency, paid/Cash fairness and synthetic paid/no-Driver tests remain the evidence for the unchanged 90-second paths. Hosted Yoco TEST and controlled FCM provider acceptance have not been established in this isolated release; do not represent them as passed.

## Release decision

The isolated release source is reviewable and local validation may proceed. **Staged production deployment is blocked** pending a current certified recovery point and verification that the replacement build preserves material live behavior despite the old deployment's missing source provenance. Scheduler activation and the 90-second feature flag remain separate gates. Rollback reference: `dpl_GUBjxjjV523W8GRgC9Ex56izLCgt`; disable the feature and scheduler before restoring the previous deployment, preserving trip and financial records.
