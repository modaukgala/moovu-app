# Phase 6 Admin review release blocker closure — 8 October 2026

This is a preparation record. Production project `mvazbszenqahgqpznhhq` was queried read-only; no production job, migration, configuration or deployment was changed.

## Production source and dependency

Vercel `moovu-app` currently aliases deployment `dpl_CaNzdQAndwUFtkMPJXqhCJM3mpoc` to the production domains. It is a READY CLI deployment with no Git commit metadata. Its packaged subscription-retirement migration has the same SHA-1 file content as release base `18b80c3`, but that is not full-source provenance. Before release, use a clean detached checkout of the exact approved commit, confirm `git status --porcelain` is empty, record `git rev-parse HEAD` and a SHA-256 archive manifest, build and deploy only from that checkout, then retain deployment ID and aliases with the manifest. Never deploy the broad dirty main checkout.

Production migration history includes the seven Phase 6 migrations and `retire_driver_subscription_eligibility`; it lacks `phase6_review_notifications`. Production `phase6_policy.active=false`; finance policy is AUTHORITATIVE, Go/XL 1,500 bp, debt limit 5,000 cents and `subscription_required=false`. Checked RLS is enabled on Phase 6, event, outbox and in-app tables; unbalanced ledger transactions, duplicate transaction keys and duplicate business-event keys are zero. The pinned Admin migration SHA-256 remains `7E486A4B3BFCD24CBC35FF2614A03E6F4BD18A46D666F50F1D29268A88385177` and is additive to these installed dependencies.

## Pending outbox snapshot

At 2026-10-08 04:36 UTC, production contained 416 pending jobs, zero delivered jobs in this table, and zero prior attempts among the pending rows. No recipient identity or token was exported. Existing payloads resolve to Driver accounts and/or trip Customers according to event type; six old `driver_application_submitted` rows also target Admin profiles through worker logic. Classification is a **push-eligibility assessment**, not a change to business or audit records:

| Event type | Pending | B: historical/obsolete for a new push | C: uncertain/held |
| --- | ---: | ---: | ---: |
| `trip_cancelled` | 101 | 99 | 2 |
| `trip_cancelled_admin` | 90 | 88 | 2 |
| `trip_arrived` | 64 | 64 | 0 |
| `trip_completed` | 60 | 60 | 0 |
| `driver_subscription_updated` | 59 | 59 | 0 |
| `trip_cancelled_driver` | 23 | 23 | 0 |
| `payment_reviewed` | 11 | 0 | 11 |
| `driver_application_submitted` | 6 | 0 | 6 |
| `dispatch_auto_cancelled` | 1 | 1 | 0 |
| `driver_settlement_recorded` | 1 | 0 | 1 |
| **Total** | **416** | **394** | **22** |

Category B comprises retired subscription notices and trip-state notices older than 24 hours, all with terminal current trip state for the trip types inspected. Category C includes four more recent cancellation notices plus older payment, application and settlement notices whose current recipient/business relevance needs separate review. **A: current and actionable for immediate push = 0**. This conservative classification does not delete or mark any row delivered. All 416 remain audit-visible. The classification must be refreshed at release time because time and business state change.

## Fail-closed worker design

The original `/api/jobs/outbox` verifies `OUTBOX_JOB_SECRET`, requires the exact `PHASE05_OUTBOX_ENABLED=true`, calls a service-role claim RPC, processes recipients, and acknowledges through `phase05b_finish_outbox`. The generic claim uses `FOR UPDATE SKIP LOCKED`, eight-attempt cap, a five-minute stale lease and backoff. FCM sends to each active registered token, and Web Push handles legacy subscriptions. A stable per-user event key deduplicates in-app records; provider acceptance does not prove physical receipt or make a push exactly once.

This follow-on change preserves the original general claim function but removes it from this route. The route accepts **one to three explicit job IDs** and the new service-role-only claim RPC returns only matching Phase 6 correction/approval/rejection jobs that are at most 24 hours old, still due, still the latest relevant review, bound to the correct Driver, and consistent with authoritative application status. It never reclaims a stale `processing` job automatically. Historical subscription, trip, payment and uncertain jobs cannot be selected by this route even if an operator supplies their IDs. New legitimate jobs remain durably queued if not selected; they are not erased. Provider-uncertain or partial-device failure is recorded and held from automatic retry. Pre-provider failures can follow existing bounded backoff. Concurrent claims use row locks and `SKIP LOCKED`.

A new trigger persists Phase 6 Driver in-app history atomically when the review outbox row is inserted, before any push worker runs. It uses the existing `(user_id,event_key)` uniqueness and only nonsensitive requirement labels/categories. Thus Stage A has persistent in-app notifications while push stays disabled. No public document access, new notification system or financial writer is added.

The three follow-on migrations were applied and verified on **disposable** `tangtlmdpnvmoviwrgvd` only, in this order:

1. `20261008110000_phase6_review_notification_delivery_safety.sql` — SHA-256 `57BDF3DF3459CFC1F6FDA0BE5F8FBF85E186DD2A091DBD9E17DC2CECD09E2A97`.
2. `20261008110005_phase6_review_notification_reviewed_claim.sql` — SHA-256 `EA3F6722E05A7E721D341AD2E73A9FF7B86744AC62EB3A4BA60866FF68119754`.
3. `20261008110010_phase6_review_notification_uncertain_retry_hold.sql` — SHA-256 `7923F85761D08CDD296433608C11266E6470FEF649C6C4B4435091F72F18BBA8`.

The third migration's final newline was normalized after its first disposable application; its idempotent `CREATE OR REPLACE FUNCTION` definition was reapplied to disposable under an `exact` rehearsal name to certify the final file bytes. Production must apply the three listed files once in order, not the extra disposable history entry.

The intermediate broad Phase 6 claim is dropped by migration 2; the final claim signature accepts only `uuid[]`, is executable by service role but not `anon` or `authenticated`, and retains fixed `search_path=public,pg_temp`. The in-app trigger function has the same fixed path. The original `phase05b_claim_outbox` remains installed for unrelated reviewed future use, but this route does not call it.

## Disposable proof and limits

The authenticated local Next.js journey against disposable Supabase passed. It covered new Driver correction, replacement evidence, approval, existing Driver reinspection/re-application and rejection, one durable in-app row at each decision before worker invocation, owning-Driver read and cross-role denial, unauthenticated worker denial, reviewed-ID replay, concurrent invocation claiming exactly once, historical trip-job suppression and an injected provider-uncertain retry hold. No fixture device token existed, so these jobs were acknowledged as handled with in-app delivery; **no physical push was proved**. Unit tests separately cover worker-disabled behavior, stable event keys, provider-accepted result and partial-device failure not being acknowledged as complete. Server source supports multiple registered FCM/Web Push devices; live device acceptance remains pending.

Candidate regression: 294/294 tests, TypeScript, ESLint (zero errors, six baseline warnings), Next production build (208 static pages), credential scan (zero findings) and `git diff --check` passed. The backup launcher’s four local tests passed without connecting to production. No production job was processed.

## Production configuration and controlled invocation

`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` exist by **name** in the Vercel Production environment. `OUTBOX_JOB_SECRET` and `PHASE05_OUTBOX_ENABLED` do not. The deployed `vercel.json` has no `/api/jobs/outbox` schedule. Vercel Cron cannot directly satisfy this route's authenticated POST body of reviewed job IDs, so do **not** add a blind cron. The operator must securely generate/store a high-entropy worker secret in Vercel Production without printing or committing it; set the enable flag only after the safe worker code, claim migrations and backlog classification are approved. A controlled invocation must POST at most three specifically reviewed current Phase 6 job IDs to `https://moovurides.co.za/api/jobs/outbox` over TLS with the dedicated secret. Do not put the secret in command arguments, logs or chat. Before enabling, review the exact job IDs, event types, state, recipient and age; after invocation verify only those IDs changed and inspect failures without resending uncertain results. An automatic schedule needs a separately reviewed selector/authorization design.

## Recovery and release order

The most recent local encrypted archive observed was `moovu-mvazbszenqahgqpznhhq-1791398238537.moovubak`, 8,440,896 bytes, SHA-256 `64b4279b05b4d29af295db716dbafa2a85b12a2c26a9d4d4035f245b6b8559ac`. It is not individually covered by the older isolated-restore report. Immediately before any authorized production migration, the owner should run the private launcher in PowerShell 7, using its existing external official CA at `C:\Users\kgala\MOOVU Backup TLS\supabase-ca.crt`:

```powershell
pwsh -NoProfile -File "D:\Users\KN Mudau\Desktop\Websites\moovu-kasi-rides-redesign\scripts\production-backup.ps1"
```

The launcher prompts privately for the existing database password and separate encryption passphrase. Require its successful sanitized result, archive hash/integrity and independent isolated-restore certification for **that new archive**; check Storage-byte recovery separately. No backup was run in this task.

**Stage A — Admin review and in-app:** confirm a clean pinned source artifact and fresh recovery checkpoint, then separately authorize only the reviewed Admin migration followed by all three follow-on migrations in the order above. Verify definitions, RLS/grants, finance, Phase 6 OFF and empty unrelated diffs. Deploy the exact combined safety commit based on `0196321`; keep `PHASE05_OUTBOX_ENABLED` absent/false. Exercise controlled Admin and Driver workflows and verify in-app history without sending push. Deploying `0196321` alone would omit the atomic inbox trigger, so it is insufficient for this Stage A acceptance.

**Stage B — controlled worker:** after separate authorization, securely configure the secret and enable flag, and manually invoke only a reviewed batch of one to three current Phase 6 job IDs. Confirm exactly-once claim/in-app identity, provider result, error hold and no change to any of the 416 historical jobs. Do not schedule the route yet.

**Stage C — physical acceptance:** on controlled accounts/devices, Admin requests Rear of Vehicle re-upload; Driver receives and taps the push into that requirement; Driver captures a replacement; evidence survives refresh and logout/login; Admin previews the correct replacement; Admin approves and Driver receives approval push plus in-app record; a controlled applicant receives rejection notification. Provider acceptance alone is not a physical-device PASS.

Owner approval remains required for a fresh checkpoint, all production migrations, deployment, worker secret/flag and any live notification send. No finance or Phase 6 enforcement activation is part of this release.
