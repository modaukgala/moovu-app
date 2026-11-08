# Driver Broadcast - final integration and release evidence

Date: 8 November 2026 (Africa/Johannesburg).

## Decision

Production deployment: **BLOCKED / NO-GO**. Do not enable production broadcast,
apply production SQL, push an auto-deploy branch, or represent device delivery as verified.

Engineering and staging evidence below is real, but is not complete production certification.

## Immutable baseline and scope

- Live project: `moovu-app`, `prj_up795H2nXqHcwVNc0rbgwDaslLKf`.
- Live deployment: `dpl_FFEBYASNsUXAxDuMFR5goXSBr8Yh`.
- Live Git metadata: `405458ee32f88002dcce0a321b78173766d33403`.
- Production database: `mvazbszenqahgqpznhhq`.
- Release worktree: `D:\Users\KN Mudau\Desktop\Websites\moovu-driver-broadcast-release-20261108`.
- Release branch: `release/driver-broadcast-20261108`, based directly on the live commit.
- The original development worktree is retained without resetting its changes.
- No payout, pricing, Admin management, payment or commission source differs from the live baseline in this release worktree.
- GitHub: `modaukgala/moovu-app`. The `main` branch automatically creates production deployments; it was not pushed.

## Implemented behavior

Default-off capture selects newly inserted immediate trips. A transactional snapshot records eligible online Drivers and exclusion reasons. Offer insertion and reconciliation are atomic, idempotent and uncapped by the former candidate page limit. Old-policy reservations retain their existing unique reservation restriction. Acceptance remains first-winner-only, revalidates eligibility, invalidates competitors, and uses the actual clock after lock waits.

Each applicable registered device produces durable work independently of the offer. Claims and completion acknowledgements are fenced; retries are bounded and expiry-aware. Invalid devices do not erase offers. Provider acceptance is not a delivery receipt. Driver fetch/display receipts, reconnect reads, independent presence/GPS timestamps and throttled presence updates provide additional evidence without making FCM authoritative.

Offer deadlines remain 25 seconds; the search deadline remains 30 minutes. Scheduling every 10 seconds does not change those deadlines and may introduce up to one scheduler interval of recovery latency.

## Executed local validation

- Automated suite on the clean live-based candidate: **424 passed, zero failed**.
- PostgreSQL harness: **61 passed**, using independent connections and synthetic data.
- Recipient groups: 1, 2, 5, 12, 25, 50 and 100.
- Includes simultaneous acceptance, rollback on injected insertion failure, replay, busy-Driver races, expired/cancelled rejection, token absence, device claim isolation, superseded acknowledgements, interrupted claims, presence/GPS separation, default-off/drain, deadline, request-worker backoff, unpaid-online rejection, paid-owner fencing and payment round acknowledgement.
- The original legacy `reserve_trip_offer` RPC also creates an old-policy offer with broadcast disabled.
- Authenticated local HTTP harness: **26 checks passed**, using real isolated GoTrue, PostgREST and Next APIs. Customer booking, five Driver reads, reconnect, display receipt, five concurrent acceptances, one winner, loser closure, worker authorization, Customer/Driver ownership and Admin authorization were exercised.
- The HTTP harness reused an already built local artifact explicitly; a separate fresh normal production build passed with **219 static pages generated**.
- TypeScript: passed, including build validation.
- ESLint: zero errors; six existing warnings outside the change.
- Diff whitespace checks: passed.
- Dedicated local pg_cron/pg_net test: three actual HTTP requests, intervals 10015ms and 10003ms; anonymous rejection and empty-backlog suppression passed. This receiver was mocked, not a real push provider.

## Hosted staging evidence

Owner explicitly authorized exclusive use of existing staging `dzcgwzvxgelhzukpjhpa`. No additional Supabase project was created.

- Vercel staging project: `moovu-critical-reliability-release`, `prj_gRjAiG5OmahKUZ2cyAT5nlbigzMh`.
- Integration artifact: `dpl_8zvrHhZ9u7EQVcHmJ9XFe6KMh4io`.
- Its deployment-only route signing key left the existing project signing secret unchanged.
- Real hosted Customer registration/booking, both existing synthetic Driver sessions retrieving the same trip, one concurrent acceptance winner, Admin dispatch reads, presence and worker authentication: **10 checks passed**.
- No provider credentials were configured in this staging deployment; synthetic device jobs settled as failed rather than claiming FCM/device delivery.
- Managed pg_cron and pg_net were installed only in staging. The 10-second schedule invoked the protected Vercel worker through Vault-backed worker authentication and the existing deployment-protection automation bypass.
- Background probe trip `b767385a-d6f8-4531-86e8-948933312dc0`: three complete rounds, two expected/two persisted recipients each, three claims, zero failures; recorded HTTP responses were 200 without timeouts.
- Failure/recovery probe `6e313e63-a5f3-4833-9549-ef08afa460c8`: deliberate staging credential mismatch produced 401s while the request remained PENDING at cycle/claim count zero. Restoring the valid credential recovered the backlog with 200 responses and three complete rounds.
- Sample hosted cron starts were 10.014801 and 10.015204 seconds apart. HTTP calls occur only when work is due; round HTTP calls were approximately 30 seconds apart for 25-second offer expiry.

Staging migrations actually applied:

- `20261108083306_driver_offer_broadcast_staging_validation`
- `20261108083523_broadcast_staging_worker_extensions`
- `20261108143614_broadcast_staging_worker_schedule`

The staging schedule used the staging Vercel URL and excluded legacy dispatch jobs so existing unrelated staging fixtures were not processed. Production scheduler execution is not certified by this staging-only configuration.

## Rollback rehearsal

Capture was disabled. Only certification trips were cancelled. The database confirmed zero unfinished broadcast requests and zero pending/sending device jobs. Synthetic push tokens were disabled. The staging schedule was unscheduled.

Vercel rollback was actually executed to `dpl_F1HYTpeRMs6Qgb1j2R6cEzZz655n`, whose Git metadata is the live baseline `405458e`. The database migrations remained installed. **Six authenticated Admin/Driver dispatch, offer and payout read checks passed** against that migrated schema.

This proves a drained application rollback, not an instantaneous rollback of in-flight broadcast work. Production rollback must disable new capture, retain a compatible worker until existing work drains, verify the drain, and then change application traffic. Do not drop audit tables or restore an old archive over newer financial transactions.

## Migration identity

Candidate: `supabase/migrations/20261106165400_driver_offer_broadcast.sql`.

SHA-256: `15fa269d494241a745ba345c0a76cfefb0884695646a6655aec9feb8fd1b463a`.

Scheduler installation is a separate reviewable operation:
`supabase/operations/install-driver-broadcast-scheduler.sql`.
It requires privately provisioned Vault credentials, reviewed extension permissions and the correct target URL. It is not an automatic application migration. No production version of either operation has been executed.

## Recovery evidence and limitations

Newest located archive: `moovu-mvazbszenqahgqpznhhq-1794087966570.moovubak`.

SHA-256: `7e7991ed68322158389cf6e45f06ef726076bf8d851e0f8a1cffcbe450db687c`.

The archive hash matches its metadata and restore certificate. The certificate records authenticated decryption, an isolated restore, 143 count comparisons with no mismatches, and zero unbalanced transactions or duplicate financial keys/events/payables. It is not merely a checksum certificate.

However it explicitly records `productionReleaseCertified=false`, `managedRoleEquivalence=false`, `managedAuthServiceRecoveryCertified=false`, and `storageBytesBackedUp=false`. Its recovery point predates the latest production migration `20261107215722_option_b_online_payout_allocation`. Replaying the exact current migration sequence after restoring this archive has not been certified by this task. A schema-only clone is not a substitute for that evidence.

Do not treat full production recovery as PASS until a suitable current recovery procedure and its scope/limitations are validated. Do not ask for secrets in chat or repeat backup creation unnecessarily; use the existing private recovery tooling for the missing validation only.

## Remaining mandatory limitations

1. Current release-suitable recovery coverage, including the forward replay to the actual production baseline and required managed permissions, is not certified.
2. Actual iPhone/Android foreground, background, terminated and lock-screen provider/device delivery is unverified. No real pushes or payments were sent by this certification.
3. Full production schema parity has not been established from a fresh complete export; live migration metadata, trigger metadata and the acceptance-function fingerprint were inspected read-only. The production acceptance function matches the pinned precondition `1c097974aee6a56bf0a06d5134b65c9b`.
4. A clean live-based candidate must receive its own final staged artifact and source-manifest review before production approval. Earlier hosted integration evidence used the retained development worktree, not a claim of a byte-identical final release artifact.

## Final gate table

| Gate | Result |
| --- | --- |
| Production build | PASS locally; final hosted candidate build still required |
| Transactional broadcast | PASS |
| Reservation compatibility | PASS in PostgreSQL, including paid ownership and old-policy RPC |
| Durable notification persistence/claims | PASS; actual provider/device delivery UNVERIFIED |
| Authenticated integration | PASS local and hosted synthetic flows |
| Hosted scheduling | PASS on approved staging only |
| Recovery and rollback | FAIL overall: drained rollback PASS, recovery coverage unresolved |
| GitHub push | NOT COMPLETED |
| Production deployment | BLOCKED |

No production database, production worker schedule, production flags, Firebase configuration or live application deployment was changed.
