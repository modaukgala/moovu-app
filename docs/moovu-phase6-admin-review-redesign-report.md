# MOOVU Phase 6 Admin review redesign

Sections A–O record the original implementation audit. Section P is the later disposable certification and supersedes the earlier untested/blocker statements in A–O.

## A. Current workflow audit

`phase6_applications` holds the current status and draft. `phase6_versions` freezes submitted snapshots. Each draft section's `evidence` object maps a semantic requirement key to a `phase6_uploads.id`; upload order is not meaningful. `phase6_command` is the existing service-role-only lifecycle authority and writes immutable `phase6_reviews`. The private evidence route audits access and checks Admin or owning Driver identity. Admin decisions require an existing `UNDER_REVIEW` state; a submitted/resubmitted application must first be moved there.

## B. Root UX problems

The former Admin view centered raw JSON, upload UUIDs and generic section/source labels. It did not show which capture represented a given requirement, provide useful thumbnails, or distinguish correction from full rejection clearly. It was not an efficient review queue.

## C. Evidence mapping

| Internal key | Admin label |
| --- | --- |
| `id_document` | SA ID |
| `drivers_license` | Driver's Licence |
| `pdp` | PDP (optional) |
| `vehicle_license_disc` | Vehicle Licence Disc |
| `insurance` | Insurance (optional) |
| `front` | Front of Vehicle |
| `rear` | Rear of Vehicle |
| `driver_side` | Driver Side |
| `passenger_side` | Passenger Side |
| `front_interior` | Front Interior |
| `rear_interior` | Rear Interior |
| `odometer` | Odometer |
| `vin` | VIN |
| `engine` | Engine Number |

## D. New Admin workflow

The queue groups authoritative statuses into Needs review, Needs Driver action, Draft, Approved and Rejected. It shows Driver identity, existing/new Driver, cycle, updated date and a computed required-field/evidence count. The detail view uses the current immutable snapshot, readable fields, semantic evidence cards, private thumbnails and full-image previews. Required images must be opened before they can be marked reviewed in the current browser session; those checks are UI safeguards, not new database approval records. Approve, reject and item-specific correction use confirmation/reason dialogs and the existing lifecycle authority. Technical JSON/history remains under collapsed audit details.

## E. Notifications

The reviewed migration wraps the existing Phase 6 command and inserts one `moovu_business_events` event plus one `moovu_notification_outbox` job in the same transaction as a correction/approval/rejection. The existing outbox worker resolves the Driver Auth user, creates the existing in-app notification history and calls `sendPushSafe` for registered devices. Event keys and business-event uniqueness make retries idempotent. Bodies contain only human evidence labels and preset reason categories, not ID/VIN values, image URLs or document contents. Delivery requires the existing outbox worker and push infrastructure to be enabled and exercised; it is not proven here.

## F. Re-upload flow

Requesting Rear of Vehicle maps `rear` to the `scanner` correction section and records the target in `phase6_correction_targets`. The Driver's `/driver/onboarding?requirement=rear` link focuses the correction section and shows the reason. The existing Driver upload/save/submit flow retains unrelated evidence, moves the application to `RESUBMITTED`, and the Admin queue presents it as Needs review. No auto-approval is added. This sequence is code-traced, not authenticated E2E verified.

## G. Approval flow

The wrapper invokes `phase6_command(APPROVED)`, which updates existing canonical Driver approval fields and vehicle assignment; the same transaction enqueues the Driver notification. The message does not direct the Driver to purchase a subscription. Actual online eligibility and the production subscription policy were not proven in this pass.

## H. Security

Evidence stays in the existing private bucket and is served only through the existing authorized/audited route. Added thumbnails use server-side image resizing after authorization. No public Storage URLs or bucket policy changes were made. RLS is enabled on the new correction-target table, with access restricted to service role. Cross-role access and device delivery still require authenticated disposable tests.

## I. Existing Driver identity

No Auth, Driver, enrollment, trip-history or financial-identity creation logic was changed. The existing canonical identity path remains authoritative.

## J. Finance

No fare, ledger, Yoco, settlement, commission, subscription or debt-threshold code was edited in this scoped batch. The previously recorded 1500 bp Go/XL, R50 threshold and `subscription_required=false` baseline is not a fresh production verification.

## K. Validation

`npm test`: 387/387 pass. Focused evidence and notification-routing tests: 12/12 pass. `npx tsc --noEmit`: pass. `npm run lint`: pass with three pre-existing warnings. `npm run build`: pass, 222 generated static pages. Scoped `git diff --check`: pass. No authenticated Admin/Driver E2E, cross-role evidence test, real push delivery, mobile visual QA or disposable migration rehearsal was run.

## L. Database change

`supabase/migrations/20261007191904_phase6_review_notifications.sql` is required for item-specific correction targets and atomic, idempotent decision notifications. It is review-only and **was not applied** to production or disposable Supabase. Review and rehearse it against disposable data before any release. The new Admin decision endpoint fails closed if the RPC is unavailable.

## M. Changed files

`src/app/admin/(protected)/onboarding/page.tsx`, `src/app/api/admin/onboarding/route.ts`, `src/app/api/driver/onboarding/evidence/route.ts`, `src/app/api/driver/onboarding/route.ts`, `src/app/api/jobs/outbox/route.ts`, `src/app/driver/onboarding/page.tsx`, `src/lib/drivers/phase6Policy.ts`, `src/lib/drivers/phase6ReviewPresentation.ts`, `src/lib/drivers/phase6ReviewPresentation.test.ts`, `src/lib/notifications/deepLinkRouting.test.ts`, and the migration above. The wider checkout was already dirty and unrelated changes were preserved.

## N. Production

Production queried: **No** in this implementation pass. Production mutated: **No**. Deployed: **No**. The existing outbox worker is not activated by this change; it needs a separately reviewed schedule/secret/configuration and delivery test.

## O. Verdict

**ADMIN DRIVER ONBOARDING REVIEW REDESIGN BLOCKED - reviewed migration, outbox activation, authenticated role tests and mobile QA remain.** Local code validation is clean, but that is not proof of production notification delivery or full application lifecycle behavior.

## P. Disposable certification continuation (7 October 2026)

The migration file SHA-256 is `7E486A4B3BFCD24CBC35FF2614A03E6F4BD18A46D666F50F1D29268A88385177`. It was applied **only** to disposable project `tangtlmdpnvmoviwrgvd` through the Supabase migration tool, which recorded it as version `20261007201215`, name `phase6_review_notifications`. The table and RPC exist. `phase6_correction_targets` has RLS enabled; `anon` and `authenticated` have no direct select/insert/update authority, while service role has select/insert. The new RPC is `SECURITY DEFINER`, has fixed `search_path=public,pg_temp`, checks `auth.role()=service_role`, and is executable only by service role. The migration creates one table, one RPC and one immutability trigger; it does not replace `phase6_command` or alter financial objects or policy.

The authenticated disposable HTTP journey passed using local Next.js against `tangtlmdpnvmoviwrgvd`. It covered a new Driver, private evidence upload and cross-role denial, authoritative submission/review, concurrent specific `Rear of Vehicle` correction, replacement upload, resubmission, approval, an existing Driver reinspection/re-application cycle, rejection and replay, vehicle conflict denial, and preservation of Auth/Driver identity, a completed historical trip, vehicle and financial-account relationships. The stale runner was updated to send the redesigned correction requirement/category instead of the obsolete generic correction request. Its assertions now verify one correction target, one business event and one outbox job for each correction, approval and rejection, with no sensitive document fields in event payloads. It verifies the replacement rear image becomes current while the front image and prior version stay intact. These are authenticated API/lifecycle checks; they are not a physical browser or push-device acceptance test.

The semantic Admin labels remain bound to requirement keys and evidence UUIDs. Unit tests cover all 14 distinct labels, wrong-section/unvalidated uploads, queue grouping and immutable review snapshot selection. The authenticated HTTP journey verifies Admin and owning Driver evidence reads, and denies another Driver, Customer and unauthenticated reads. Driver correction deep-link routing to `/driver/onboarding?requirement=rear` passes its focused test.

The existing delivery path is `moovu_business_events` → `moovu_notification_outbox` → protected `/api/jobs/outbox` → `phase05b_claim_outbox` → `processOutboxJob` → `sendPushSafe` → `app_notifications` and FCM/Web Push → `phase05b_finish_outbox`. The route requires `OUTBOX_JOB_SECRET` and `PHASE05_OUTBOX_ENABLED=true`; `vercel.json` does not schedule this route. Production worker configuration was not queried or changed. The disposable outbox had unrelated pending trip/payment jobs. To test only the three new review jobs, the authenticated disposable runner temporarily moved those exact fixture jobs ahead of the queue, invoked the local worker with `limit=3`, then restored their timestamps in `finally`. It asserted the three exact job IDs were handled once and no other jobs were claimed. There were no registered push devices for the fixture, so this proves server handling and in-app persistence, **not physical push receipt**. The existing worker reuses a stable event key for in-app history on retry; physical FCM delivery is not guaranteed exactly once after an ambiguous provider response.

A focused local correction now inserts Phase 6 in-app history under that same stable event key before attempting push, so a push-configuration failure does not erase the Driver's persistent update. The Driver onboarding screen reads the existing `app_notifications` table through the authenticated user's RLS and displays recent Phase 6 updates with sanitized internal links. The connected disposable run verified the owning Driver could read all three resulting records, while another Driver, a Customer and an anonymous caller could not. No new notification table or production configuration was added.

Post-rehearsal disposable policy remains `AUTHORITATIVE`, Go/XL `1500` basis points, debt limit `5000` cents and `subscription_required=false`; Phase 6 enforcement remains `active=false`. Checked ledger imbalance groups, duplicate financial keys, duplicate business-event keys and duplicate outbox event IDs are all zero. No production query, migration, deployment or notification send was performed.

Validation after the local correction in the dirty main checkout: authenticated disposable HTTP lifecycle PASS; focused review/routing/outbox tests 19/19 PASS; full regression 388/388 PASS; TypeScript PASS; full ESLint PASS with three pre-existing warnings; build PASS using placeholder Supabase values; credential scan PASS with zero findings; `git diff --check` PASS. A selective isolated candidate was assembled from production release commit `18b80c3`; the Driver onboarding change was merged into the released page so the existing evidence durability fix remains intact. The candidate independently passed the authenticated disposable HTTP lifecycle, 291/291 regression tests, TypeScript, ESLint with six baseline warnings, build, credential scan with zero findings and `git diff --check`. Its smaller test count reflects the clean release baseline excluding unrelated dirty-tree work.

The isolated candidate includes only the reviewed Admin queue/detail, private evidence presentation, Driver correction/in-app UI, decision authority, disposable runner, focused tests, and additive notification migration. It excludes unrelated dirty-tree features, the separately pending iOS camera work, production configuration, worker scheduling and mobile binaries. The candidate does not enable Phase 6 enforcement. Physical acceptance still requires: an actual device receiving the correction push and opening Rear of Vehicle; corrected image capture surviving refresh and appearing in Admin preview; approval push and in-app receipt; and rejection on a controlled test account. Those are release/device checks, not results of this server-side certification.

**Current verdict: PHASE 6 ADMIN REVIEW REDESIGN ENGINEERING CERTIFIED — PHYSICAL NOTIFICATION ACCEPTANCE PENDING.** No production query, migration, configuration change, notification send or deployment occurred. Production release requires separate approval and worker configuration review.
