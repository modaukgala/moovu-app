# MOOVU Phase 0.5G final disposable revalidation

Status: final disposable validation evidence. No production SQL, deployment, commit, or push occurred.

## A. Disposable project identity

- Project: `moovu-phase-05g-disposable`
- Ref: `tangtlmdpnvmoviwrgvd`
- Region: `eu-west-1`
- PostgreSQL: `17.6`
- Production ref excluded: `mvazbszenqahgqpznhhq`
- Identity was rechecked before resumed mutation. The disposable ref was not production.

## B. Clean migration result

The anonymized baseline and migrations `001` through `004` applied successfully. After the initial notification-grant defect was found, the disposable `public` schema was rebuilt and the corrected baseline plus all four migrations were reapplied from scratch successfully. Two later search-path corrections were additive function configuration changes and did not invalidate transactional results.

## C. Core atomicity regression

- Concurrent applicant submission: one account link and one application; original plus deterministic replay.
- Ownership attack: rejected; zero attacker link/application rows.
- Concurrent payment approval: one settlement; original plus replay; R70 received, R50 applied, R20 retained as unapplied excess.
- Concurrent completion: one commission row; original plus replay.
- Concurrent cancellation: one cancellation-fee row; original plus replay.
- Concurrent no-show: one fee row; original plus replay.
- Simultaneous assignment: one trip won the driver; the competing assignment was rejected.
- Completion versus cancellation, cancellation versus no-show, and arrival versus cancellation each produced one terminal winner and one controlled rejection.
- Retention checks blocked deletion of a referenced driver, trip, and wallet.
- The previous Phase 0.5E 1,101-row balance test was preserved and not repeated because the Phase 0.5G corrections affected notification grants and function search paths, not debt aggregation. The offline complete-dataset contract test passed again.

## D. Real Supabase Auth / JWT

Real GoTrue bearer sessions were issued for disposable Customer, Driver, Owner, Admin, Dispatcher, and Support identities. Normal signup was not proved: the disposable project hit its default email-send rate limit. Confirmed anonymized identities were created using the previously established disposable-only Auth schema approach without changing Auth security settings.

All six sessions received `403` for direct subscription-refresh RPC execution, notification insertion, and settlement insertion. Two customer sessions could read no notification rows belonging to the other customer.

## E. Real RLS / grants

`app_notifications` has RLS enabled, authenticated `SELECT` only, an own-user read policy, and service-role-only mutation. Temporary policies used solely to exercise PostgREST upsert semantics were removed; mutation was retested and returned `403`.

Financial mutation privileges and sensitive RPC execution are absent for `anon` and `authenticated`. However, the minimal disposable baseline does not reproduce all existing production-table RLS policies. Supabase Advisor reports sixteen baseline tables with RLS disabled. This prevents Phase 0.5G from proving the complete production ownership/read matrix and remains a production migration-review blocker.

## F. RPC security

- `anon`: sensitive contract execution denied.
- `authenticated`: sensitive contract execution denied.
- `service_role` database role: contract execution succeeded.
- Owner/Admin actor checks succeeded through authoritative database RPCs.
- Dispatcher/Support financial operations were rejected with zero partial writes.
- All 21 sensitive callable functions are denied to `anon`/`authenticated`, granted to `service_role`, and all `SECURITY DEFINER` functions now have controlled search paths.

## G. PostgREST notification upsert

Real PostgREST tests proved first insert, retry update, same-row reuse, separate rows for separate users, and concurrent retries. Twelve concurrent requests returned successful `200`/`201` responses and one unique row ID.

## H. Event-key uniqueness

The database has a unique `(user_id, event_key)` index. Same user/event retries reused one row; the same event for a different user created a distinct row. Direct database and PostgREST behavior agreed.

## I. Outbox claim concurrency

Two simultaneous workers claimed one pending row exactly once: one received the processing row and one received no row. Attempts incremented once.

## J. Five-minute stale recovery

- `4 minutes 59 seconds`: not reclaimable.
- `5 minutes 1 second`: reclaimable.
- Exactly `5 minutes`: reclaimable.

The contract is therefore `>= 5 minutes`, implemented as `locked_at <= now() - interval '5 minutes'`.

## K. Eight-claim poison limit

An item at attempt seven was claimed to attempt eight. After failure it remained retained with status `failed`, attempt count eight, and its error. Even with a due timestamp, a ninth claim returned no row.

## L. Crash/retry idempotency

A business event/outbox item was claimed, one application-notification row was created, and acknowledgement was deliberately omitted. After stale recovery, retry upserted the same notification identity and acknowledged delivery. Final evidence: one business event, one notification row containing retry data, delivered outbox status, and two attempts. No financial RPC was replayed.

## M. `trip_arrived`

Concurrent duplicate arrival produced one transition plus replay, one `trip_arrived` business event, and one outbox row. Arrival versus cancellation produced one cancellation winner and one controlled arrival rejection.

## N. Feature flag

With `PHASE05_OUTBOX_ENABLED=false`, the correctly authorized local worker request returned `503` before database processing and the existing immediate path remains selected by source/unit contracts. With the flag enabled and an intentionally non-privileged disposable credential, the route attempted the outbox contract and failed closed with `503`. Real scheduled-worker cutover and duplicate-free immediate-to-outbox activation require staging.

## O. Outbox job authentication

Actual local HTTP results: no secret `401`, incorrect secret `401`, correct secret with feature disabled `503`. The secret value was disposable and was not written to this report.

## P. HTTP + Supabase integration

A real Driver JWT reached the local arrival route pointed only at the disposable project, but no disposable service-role key is exposed by the available connector. The trusted server query therefore could not be exercised successfully and returned a controlled pre-mutation error. Real successful Customer/Driver/Admin HTTP-to-authoritative-RPC execution remains unproved and requires staging or a separately supplied disposable server credential.

## Q. Corrections made

1. Expanded the disposable `app_notifications` fixture to match worker upsert fields.
2. Added RLS, own-user read policy, and server-only mutation grants for `app_notifications`.
3. Set safe explicit search paths on `phase05b_contract_version`, `is_staff`, `refresh_driver_subscription`, and `increment_driver_offer_received`.

No correction was applied to production.

## R. Remaining staging/review requirements

- Compare and reproduce the real production RLS/read-policy matrix before migration approval.
- Run successful authenticated HTTP routes with a disposable/staging service credential.
- Test deployed scheduler behavior, feature-flag cutover, worker crash injection, FCM/Web Push, native push, and deep links.
- Review Supabase Advisor baseline findings and production grants before activation.

## S. Validation summary

- Clean disposable migrations: 5/5 final baseline/package applications passed after rebuild; additive search-path corrections passed.
- Core database scenarios: 12 passed, 0 failed.
- Concurrency scenarios: 12 passed, 0 failed.
- Real JWT/grant scenarios: 33 passed, 0 failed for the tested matrix; broad production RLS coverage remains unavailable.
- PostgREST/outbox scenarios: 12 passed, 0 failed.
- Local HTTP gate scenarios: 4 passed, 0 failed; 1 trusted-route success blocked by unavailable disposable service credential.
- Targeted local HTTP/outbox tests: 19 passed, 0 failed.
- Complete offline application tests: 122 passed, 0 failed.
- TypeScript: passed.
- Lint: passed with 0 errors and 3 pre-existing warnings.
- Production build: passed; 171 routes/pages generated.
- `git diff --check`: run again after this report.

## T. Repository safety

Branch remained `main` at `87dfec653d2b0791ff5dcb8295ae9dfa4a96ded4`. Existing modified and untracked work was preserved. Nothing was staged, committed, pushed, reset, cleaned, stashed, restored, or deployed.

## U. Disposable project cleanup

Authorized tooling did not expose project deletion. The project was paused successfully after evidence capture. Manual deletion is required for `moovu-phase-05g-disposable` / `tangtlmdpnvmoviwrgvd`.

## V. Next gate

# NOT READY FOR PRODUCTION MIGRATION REVIEW

Reason: the final database/runtime contracts passed their tested scenarios, but the disposable baseline did not reproduce the complete production RLS policy matrix and a successful authenticated HTTP trusted-server path could not be exercised without a disposable service credential. This is not Phase 0 complete and no production migration was applied.

## W. Final service-credential closure (2026-09-02)

This section supersedes the earlier service-credential limitation in sections P, R, S and V. The previously completed closure pass also replaced the minimal fixture permissions with the reviewed production-compatible RLS matrix and revalidated the affected real JWT ownership/role matrix. The final remaining gap was successful trusted-server HTTP execution with a genuine disposable server credential.

Target identity was verified again before execution:

- disposable project: `moovu-phase-05g-disposable`;
- disposable ref: `tangtlmdpnvmoviwrgvd`;
- production ref `mvazbszenqahgqpznhhq` explicitly excluded;
- project status: `ACTIVE_HEALTHY`;
- PostgreSQL: `17.6.1.166` in `eu-west-1`.

The disposable server credential successfully called the protected `phase05b_contract_version` RPC and returned `phase-05b-v1`. Six real GoTrue bearer sessions were then issued for the existing anonymized Customer, Driver, Owner, Admin, Dispatcher and Support identities. No credential value was written to this report or a repository environment file.

## X. Genuine MOOVU HTTP to disposable Supabase proof

The real Next.js MOOVU API ran locally with server-only disposable credentials. Requests traversed:

`real disposable JWT -> MOOVU HTTP route -> HTTP authentication -> HTTP authorization -> server Supabase client -> disposable server credential -> protected RPC/transaction -> disposable Supabase`.

Results:

- Owner subscription activation: HTTP `200`, authoritative financial effect created once.
- Same Owner operation replay: HTTP `200`, `replayed=true`, no duplicate financial effect.
- Admin subscription activation: HTTP `200`, authoritative financial effect created once.
- Dispatcher financial mutation: HTTP `403`, zero financial effect.
- Support financial mutation: HTTP `403`, zero financial effect.
- Driver arrival: HTTP `200` through `phase05b_mark_arrived`.
- Customer cancellation: HTTP `200` through `phase05b_cancel_trip`.
- Authenticated applicant submission: HTTP `200` through `phase05b_submit_driver_application`.

Final financial evidence for the unique runtime proof scope was exactly two subscription-payment effects (Owner plus Admin), with zero duplicate replay effect and zero Dispatcher/Support effect. Disposable API logs independently recorded the protected activation, arrival, cancellation and applicant RPC requests.

## Y. Genuine fail-closed proof

Execution of `phase05b_activate_subscription` was temporarily revoked from `service_role` in the disposable project only. A new authenticated Owner request reached the real MOOVU HTTP route and returned controlled HTTP `500` with `code=operation_failed`.

Before and after counts for the unique operation key were both:

- subscription payments: `0`;
- business events: `0`.

The route did not perform a sequential table-write fallback, no partial mutation occurred and no duplicate financial effect was created. The grant was immediately restored and verified as:

- `service_role` execute: `true`;
- `authenticated` execute: `false`.

## Z. Credential exposure checks

The disposable server credential was not found in:

- HTTP responses;
- local server or build logs;
- production client bundles under `.next/static`;
- generated HTML;
- source, test scripts or documentation;
- browser/public environment variables.

The credential was held only in the temporary PowerShell process. It was not placed in `.env.local`, a tracked file, a `NEXT_PUBLIC_*` variable, Git staging, a commit or a deployment.

## AA. Final validation

- Genuine service-credential protected RPC probe: passed.
- Genuine role/JWT HTTP matrix: 8 representative outcomes passed.
- Genuine fail-closed HTTP/database proof: passed.
- Affected HTTP/outbox contracts: passed within the full suite.
- Complete offline application suite: 122 passed, 0 failed.
- TypeScript (`npx tsc --noEmit`): passed.
- Lint: passed with 0 errors and the same 3 pre-existing warnings.
- Production build: passed.
- Production client/build secret scan: passed.
- No production SQL, deployment, commit or push occurred.

The local environment required a process-scoped TLS verification workaround because its Windows certificate stack rejected outbound test connections. This affected only the disposable local test process; it was not written to application configuration or used in production.

## AB. Final Phase 0.5 verdict

The Phase 0.5 preparation and disposable proof package is complete. This does not apply migrations to production, deploy application code, approve a production release, or begin Phase 1. The next stage is Production Migration Review and Owner Approval.

# READY FOR PRODUCTION MIGRATION REVIEW

# PHASE 0.5 COMPLETE
