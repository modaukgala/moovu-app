# MOOVU Phase 6 Driver Onboarding & Car Scanner Completion Report

Checkpoint: 18 September 2026. This updates the existing report; it is not a production-completion certificate. Production authorization remains conditional on passing the connected gates. Unrelated working-tree changes are preserved.

## 1. Final Verdict

NOT READY for production release. The Windows HTTP blocker was resolved and real authenticated HTTP checks passed. A subsequent isolated-candidate run was interrupted by another task replacing the shared disposable database baseline. Phase 6 tables are now absent. No production migration, deployment or activation occurred.

## 2. Previous Blocker Resolution

Resolved: the isolated C-drive Next runtime generated malformed cross-drive dependency paths and HTTP 500. The corrected launcher copies application files into a same-D-drive sibling, starts the actual Next server with webpack, uses a node_modules junction only for development, and waits for a real unauthenticated 401. It loads disposable credentials in the child process, copies no environment file, and uses real Supabase password sessions. Command: `node --env-file=.env.phase3-e2e.local scripts/phase6-local-http-validation.mjs`. Recorded exit 0 on 17 September for command and extended upload/privacy checks. Production builds use a normal isolated dependency installation; Turbopack rejected the development junction, so it was replaced in the generated release directory.

## 3. Locked Owner Policy D1–D10

D1 PDP optional, dated notice, separate unconfirmed operating rule. D2 existing identity, grace through 30 November SAST, new-work cutoff 1 December. D3 scoped correction/new immutable version. D4 camera preferred/gallery fallback with honest source metadata. D5 one active normalized registration, private Admin conflict. D6 Admin-authorized linked reapplication. D7 event-triggered manual reinspection. D8 references independent of captures; adequate capture reuse. D9 no required Roadworthy, insurance optional. D10 classified retention/holds/audit; no guessed automatic deletion. None of these choices was reopened.

## 4. Security Remediation

Candidate revokes sensitive direct writes, freezes submitted snapshots/files, verifies Auth/ownership/enrollment/state, restricts review to owner/admin, and serializes/idempotently records review decisions. Legacy mutations are retired at route-handler boundaries, independent of middleware. Legacy removal is retired before any login unlink/partial cleanup. Admin suspension/reactivation uses the audited operating-status contract rather than approval-field updates. Legacy document reads are narrowed to owner/admin in source; an additional candidate migration closes broad staff metadata reads and direct mapping writes. That last migration is not installed or validated yet.

## 5. Authenticated HTTP E2E

Earlier recorded PASS: enrollment, save/replay, concurrent revisions, submit/frozen version, correction, scoped resubmit/version 2, legitimate Admin approval, unauthenticated denial, cross-Driver and Customer denial, privileged-field/self-approval denial, six actual private uploads and protected downloads. Expanded run reached reinspection, rejection, replay/third retry, linked reapplication, vehicle conflict rollback and identity checks. It exposed and fixed latest-cycle selection. No full authenticated final isolated-candidate PASS exists after the external database reset. Independent built-runtime read-only HTTP smoke PASS on 18 September: new onboarding and both legacy entry aliases render correctly; protected endpoints deny anonymous access; all 12 retired mutations return 410. No identities or rows created.

## 6. Authentication / Role Safety

Server verifies bearer tokens through Auth. Driver mapping/enrollment and conflicting profile roles are checked; deleted Drivers cannot use owned onboarding/evidence access. Auth signup alone grants no review/approval privilege. The primary E2E fixture now deliberately has no pre-granted Driver profile. Customer identity cannot claim Driver enrollment; other Drivers cannot claim Admin evidence access. Previously observed production mappings without staff-profile rows are preserved. No production test identities were created.

## 7. Google / Apple Status

Google and Apple application methods exist but buttons are dormant. External provider configuration and real callback/enrollment validation remain pending separately. No credentials invented, provider enabled, identity merged or existing authentication weakened.

## 8. Application Data Model

Additive policy, enrollment, linked cycles, revisioned drafts, immutable versions, validated uploads, inspections, immutable review history, vehicle assignments, operation receipts, access audit, retention requests/events and operating events. Existing Auth/Driver/finance IDs are reused. Previously installed disposable tables were removed by a separate baseline replacement; migration history still lists earlier installs and therefore does not prove current schema presence.

## 9. Application State Machine

DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED / REJECTED / CORRECTION_REQUESTED. Scoped correction → RESUBMITTED → UNDER_REVIEW. Admin-authorized reapplication/reinspection creates a new linked cycle. Latest-cycle authority now prevents an older approval being returned after a later rejection.

## 10. Personal Stage

Names, mobile, SA ID, address, area, emergency contact and required ID evidence. Submission validates SA ID date/checksum and mobile format. Draft allowlists reject privileged review/verification fields. Public diagnostics contain no applicant identity data.

## 11. Driving / PDP

Licence number/code/expiry and required Licence capture. PDP optional; missing evidence shows the 30 November 2026 notice. Provided evidence removes the outstanding notice without claiming verification. Driver cannot set a privileged PDP verification status. Operating enforcement remains UNCONFIRMED pending qualified confirmation.

## 12. Vehicle Stage

Make/model/colour/registration/year/VIN/engine/seating and required Licence Disc. Server validates registration, year, VIN, engine and capacity. Insurance optional; Roadworthy excluded from new required evidence. Historical documents remain unchanged by this work.

## 13. MOOVU Car Scanner

Manual non-AI checklist: front/rear/both sides/front and rear interior/odometer/VIN/engine. Reference reuse avoids unnecessary duplicate capture. Admin views private evidence. Event-triggered reinspection action and inspection hold exist. Native Camera API and browser/gallery transport bound images and preserve truthful source labels. Real-device camera testing has not been completed; no mechanical/roadworthiness certification is claimed.

## 14. Draft / Autosave

Revisioned authenticated saves, 1.2-second debounce, account-bound resume, dirty-navigation protection, explicit saved-state reload and stable operation keys until acknowledgement. Correction saves include only requested sections. Command-level autosave/resume/replay was verified earlier; complete browser interaction/recovery QA is not yet recorded.

## 15. Submission / Immutability

Deliberate submission creates immutable version/evidence snapshot. Earlier disposable tests denied version overwrite, reference mutation and storage byte overwrite. Required validated evidence must belong to the same application and correct section. Final candidate rerun requires restoring the actual schema, not trusting stale migration history.

## 16. Correction / Versioning

Admin specifies correction sections and reason. Other sections remain frozen. Driver deliberately resubmits version 2; version 1 is retained. Earlier authenticated tests proved this behavior.

## 17. Admin Review

Owner/admin authorization, actor/time/reason/source-version audit, no submitted-field rewrite, one winner for competing decisions and operation replay receipts. The isolated run's review race was interrupted by database replacement; it cannot be counted as a final passing concurrency result.

## 18. Rejection / Reapplication

Expanded HTTP checks reached successful rejection and stable review retries. They exposed older-approved-cycle fallback; `phase6_latest_cycle_authority` corrected it on disposable. The next run passed self-reapplication denial and Admin-linked reapplication before its final oversize-status assertion. Latest schema is now absent; full candidate reproduction remains blocked by shared-project interference.

## 19. Vehicle Conflict Handling

Normalized registration is locked/checked at approval, with generic conflict response and no cross-Driver identity leakage. Expanded HTTP checks reached a conflicting approval denial and verified the competing application remained UNDER_REVIEW. No merge, relationship deletion or mass lockout was performed.

## 20. Existing Driver Re-registration

ENROLL reuses the authenticated existing Driver mapping. No new financial identity or opening balance is created. Earlier rolled-back disposable grace/deadline checks passed. Latest HTTP checks retained mapping/Driver ID across linked cycles. Production currently retains 56 Drivers and 51 mappings; none has a null created_at.

## 21. Deadline / Grace Enforcement

Locked cutoff is `2026-11-30T22:00:00Z` = 1 December 2026 00:00 SAST. Existing otherwise-eligible approved Drivers retain new-work grace; incomplete enrollment blocks new assignments after cutoff. Active trip progression is outside that assignment-only gate. The additional rolled-back compatibility SQL is saved but could not execute because Phase 6 tables were removed.

## 22. Phase 2 Compatibility

Read-only production refresh: AUTHORITATIVE, Go 1500 basis points, Go XL 1500, debt limit 5000 cents, subscription_required false, zero ledger imbalance. Candidate dispatch/online/offer acceptance composes Phase 6 eligibility with existing finance authority. No commission/debt/credit/ledger/finance ID rewrite by this work. Full final R50/debt/credit/active-trip integration reproduction awaits stable disposable access; it is not claimed passed.

## 23. Phase 4 / Phase 5 Isolation

Production Phase 4 policy remains effective from 14 September; Phase 5 active=true. The isolated runtime preserves deployed booking/dispatch baseline and excludes unrelated dirty-tree P0/customer changes. Final disposable policy/financial isolation checks cannot complete against the replaced schema.

## 24. Storage / Privacy / RLS

Earlier six-category HTTP access matrix passed: anonymous, Customer and other Driver denied; own Driver and legitimate Admin allowed; forged reviewer denied. Content is decoded/validated with sharp, limited to 8 MiB/24 million pixels, JPEG output bounded to 2400 pixels and metadata stripped. Multipart reads are bounded. Browser transport stays below the hosting request-body ceiling. Oversize response corrected to 413. New API responses expose evidence IDs, not private object paths. Production historical buckets are private; broad legacy policies are reviewed for closure by the candidate migrations.

## 25. Retention

Classified records, immutable audit events, holds, qualified authorization and explicit qualified hold release. Declining a request preserves its hold. Deletion requests accurately report pending controlled review; they do not erase accounts. Automatic deletion is disabled. Financial history is separately preserved. No physical-erasure execution or complete orphan/replacement reconciliation validation is claimed.

## 26. Idempotency / Concurrency

Earlier real overlapping HTTP saves/review decisions produced one winner; exact replay returned persisted results and changed replay payload conflicted. Expanded lifecycle verifies stable review replay/third retry. Final candidate concurrency cannot be certified after destructive shared-project drift. No mock or direct-SQL-only result is presented as an HTTP pass.

## 27. Local Tests

Working-tree npm test: 228 passed, 0 failed (two additional draft-security regression tests). Isolated deployed-baseline candidate tests: 214 passed, 0 failed. Latest focused policy/image tests: 10 passed, 0 failed. Latest repository TypeScript and focused ESLint after read-authority changes: PASS. Whole repository ESLint: zero errors, three pre-existing warnings. Latest isolated candidate TypeScript PASS; ESLint zero errors/one pre-existing warning. Repository build passed. Final isolated-candidate production build: PASS with normal npm ci dependencies, including the latest three targeted authorization changes. Scoped credential scan: PASS, 55 source files and 88 browser bundle files; no service-role value in browser bundles and no values emitted. Repository diff check: PASS; isolated diff check has no whitespace errors with CRLF acknowledged.

## 28. Disposable Authenticated E2E

Only project tangtlmdpnvmoviwrgvd used. Real Auth/password sessions, actual Next HTTP handlers, actual image uploads/downloads and database state assertions. Saved fixture/parity preparation remains disposable-only and excluded from production release. Earlier PASS is preserved as historical evidence, not proof of today's absent schema. Interrupted isolated command: `$env:PHASE6_RELEASE_ROOT='D:\Users\KN Mudau\Desktop\Websites\.codex-phase6-release'; node --env-file=.env.phase3-e2e.local scripts/phase6-local-http-validation.mjs`. Failure: zero successful competing review decisions. Follow-up checks independently found phase6_policy absent and drivers=0; REST returned PGRST205. Newly recorded p0_final_clean_baseline_rehearsal / p0_final_clean_production_app_baseline migrations explain the changed test substrate. No blind migration replay or overwrite of the other task's baseline followed.

## 29. Production Preflight

Read-only 18 September refresh: project mvazbszenqahgqpznhhq ACTIVE_HEALTHY, Phase 6 absent, 56 Drivers/51 mappings/262 trips/0 active trips/8 ledger entries/0 ledger imbalances. Public home, Driver login and Admin login return HTTP 200. Latest production deployment remains dpl_DXSpah8kBx3VSjep1o9mMneq1ZC1, READY on 18 September. Production baseline must be refreshed again before any future mutation.

## 30. Production Migrations

NONE applied. The following are local candidate hashes, not a certified final production-installation chain. First six were installed on disposable before its replacement; seventh is not yet installed/validated. Do not reapply based only on migration-history entries.

| Candidate file | SHA-256 |
| --- | --- |
| 20260916190136_phase6_driver_onboarding.sql | 1bec37aa1a7f89fb381dde23996587cad656295d7b8354cd3959744704758e94 |
| 20260916191949_phase6_security_completion.sql | 896a52a7ca1a37684b7b3d48a461036d3f27a0e57060dd39a248fd272a88f9e8 |
| 20260916192353_phase6_retention_workflow.sql | a5f6d9811f9c86d944277e35d7c0af660ec24f84c8299c5a7b73545a8f4398de |
| 20260917190034_phase6_retention_hold_release.sql | b5a98fb8eae7dc1c653b99f7df159b19f5ac0c7a906a0d53a58ad17e321e6b20 |
| 20260917190412_phase6_operating_status_guard.sql | 7f17480dd4d6f96746c9d2cb52cd9e54f48052347e650dba6cf703f7cfe819fe |
| 20260917191303_phase6_latest_cycle_authority.sql | 9fe7246e02c2f9406665ddedc241668f4a183699f1cd70a19b3284d137f450d5 |
| 20260918035959_phase6_legacy_document_read_scope.sql | 4bef2845b835928c61d1814aef3084c5945c8bedd1317aced42b308a2af5c1c8 |

## 31. Production Deployment

NONE. Recovered deployed baseline through supported read-only Vercel source APIs: 542 non-secret runtime/test-fixture files; no environment/native credential files. Isolated release is D:\Users\KN Mudau\Desktop\Websites\.codex-phase6-release. It overlays only declared Phase 6 files, adds sharp 0.34.5, preserves deployed booking and excludes dirty attempt-history changes. No commit/push and no whole-working-tree deployment.

## 32. Production Activation

NONE. No policy/environment/provider activation. Original conditional release authorization remains valid; no additional production approval is requested. Shared-disposable coordination is required to establish the deterministic gates.

## 33. Immediate Production Verification

No post-release verification because no release occurred. Read-only health/finance/baseline checks passed as stated above. No fabricated production applicants/trips/payments, SQL mutation, historical rewrite, financial backfill or external Driver notification.

## 34. Natural Production Application

PENDING — NO NATURAL PHASE 6 DRIVER APPLICATION YET. Phase 6 is not installed/activated. No natural-use test was manufactured; its absence alone is not the release blocker.

## 35. OAuth External Actions Remaining

Google: external console/Supabase configuration, authorized redirects and real disposable callback/enrollment proof. Apple: corresponding provider configuration and identity-bound callback proof. Buttons remain disabled until those checks pass. No encrypted secret retrieval or policy bypass.

## 36. Real Remaining Issues

Concrete release blocker: shared disposable project was replaced during Phase 6 validation and currently lacks its tables. Another MOOVU task is active. Smallest remediation: coordinate exclusive access, inspect the new baseline, restore only missing exact Phase 6 contracts through reviewed migrations/parity, then finish the connected lifecycle/storage/retention/failure/finance/grace/active-trip/browser matrix. Preserve previously passing work; do not blindly reapply installed objects. Finish latest read-scope candidate validation and final package checks. Only then refresh production preflight, install the exact validated chain, deploy/activate and verify within existing authorization. The Windows path defect is resolved; it is not the current blocker. No new audit or Phase 7 is needed.

## 37. Production Status

| Item | Status |
| --- | --- |
| PHASE 6 DEPLOYED | NO |
| NEW DRIVER ONBOARDING | Local candidate only |
| EXISTING DRIVER RE-REGISTRATION | Local candidate only |
| RE-REGISTRATION DEADLINE | Candidate: 30 November 2026 SAST |
| POST-DEADLINE NEW-WORK GATE | Candidate: 1 December 00:00 SAST; not production-active |
| PDP POLICY | Optional onboarding; notice; operating rule UNCONFIRMED |
| ROADWORTHY POLICY | Not required in new candidate; historical preserved |
| INSURANCE POLICY | Optional |
| CAR SCANNER | Local manual candidate; no AI diagnosis |
| ADMIN REVIEW | Local candidate; protected owner/admin |
| PRIVATE DOCUMENT STORAGE | Production legacy buckets private; Phase 6 absent |
| GOOGLE AUTH | Disabled candidate; configuration/verification pending |
| APPLE AUTH | Disabled candidate; configuration/verification pending |
| PHASE 2 | AUTHORITATIVE; 15% / 15%; R50; subscription not required |
| PHASE 4 | Existing effective policy retained |
| PHASE 5 | ACTIVE |
| HISTORICAL DATA REWRITTEN | NO production rewrite by this work |
| EXTERNAL DRIVER NOTIFICATIONS SENT | NONE by this work |

## 38. Final Roadmap Gate

PHASE 6 IMPLEMENTATION BLOCKED

Evidence: the sole authorized disposable project lost Phase 6 tables during the isolated authenticated run; database and REST checks confirm absence. The test substrate cannot be certified while competing replacement work is active. Smallest safe remediation is exclusive disposable coordination and reviewed restoration, followed by the remaining exact-candidate gates. Production remains unchanged.
