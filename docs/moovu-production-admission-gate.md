# Production admission gate — review candidate

This migration originated as a separate preparatory change based on
`e356191651cc8aff4b5da733afd72bfbd91a3195` and is now included in a
combined release candidate based on the live notification source
`2ed552041b9b11d3750897bed1f6ca0db988d8f0`. It has not been installed
in production, deployed, or used to switch production admission state.

## Writer inventory and policy

| Path | During MAINTENANCE | Authority |
| --- | --- | --- |
| Customer Cash/Transfer/online booking, including scheduled rides and Phase 5 RPC/fallback insert | Reject a **new** trip; an idempotent replay of an already-created trip remains possible | `trips` BEFORE INSERT trigger; Customer API maps rejection to HTTP 503 |
| Admin trip creation | Reject a new trip | Same trigger; Admin API maps rejection to HTTP 503 |
| Direct Supabase/PostgREST or SECURITY DEFINER trip insert, including service role | Reject | Same trigger, independent of RLS and application version |
| New Customer Yoco checkout attempt | Reject before the provider is called | `online_payment_attempts` BEFORE INSERT trigger |
| New Driver commission checkout attempt | Reject before the provider is called | `driver_online_payment_attempts` BEFORE INSERT trigger |
| Already PENDING checkout reuse | Allow return to the existing provider checkout; no new attempt or provider identity is created | Existing idempotent route branch |
| Existing CREATED attempt that has not yet bound a provider checkout | Do not close admission until it is reconciled or bound | Transition checks both attempt tables for CREATED rows |
| Signed Yoco callback, trusted payment RPC, provider-event posting and online-payment dispatch recovery | Continue, unchanged | Existing HMAC, provider-mode, trusted RPC and idempotency authority |
| Existing Driver offers, acceptance, OTP, trip completion, scheduled-trip release, cancellation and financial settlement | Continue, unchanged | Existing route/RPC and RLS authority; no UPDATE/DELETE guard is installed |
| Auth, trip history, read-only application access | Continue, unchanged | Existing Auth and read policies |
| Phase 6 outbox, finance recovery and other existing jobs | Continue, unchanged | This gate does not claim a global write freeze |

Only `src/lib/payments/yoco/client.ts` creates new Customer/Driver hosted checkouts in
the current release source. The retired subscription checkout is already HTTP 410.
The scheduled-trip worker releases **existing** trips and does not insert a new one.
No background route found in this source creates trips outside the listed booking
paths. A future writer or payment domain requires a fresh inventory and trigger
review before this gate is reused.

## State, concurrency and security

The migration adds one private RLS-enabled singleton state row (`NORMAL` by
default), an RLS-enabled audit table, and three INSERT triggers. The triggers
read the state row `FOR SHARE` for the entire write transaction. An Owner
transition updates that same row and therefore waits for in-flight admissions
before MAINTENANCE becomes visible. New inserts after the transition fail with
`MOOVU_ADMISSION_CLOSED`. In NORMAL the trigger returns the unchanged row.

The Owner-only Admin route checks the authenticated user and current profile.
The service-only transition RPC independently checks the supplied actor's
current `profiles.role = 'owner'`, validates the reason, records the audit and
refuses an already-selected mode. `anon` and `authenticated` have no direct
table access or transition execution; service role has SELECT but not direct
UPDATE on state/audit. Functions have fixed `search_path`. Existing trip and
payment RLS, grants and financial functions are not modified.

The transition refuses MAINTENANCE while either payment-attempt table has a
`CREATED` row, because a provider request may be underway after its attempt
insert committed. A historical stuck CREATED row also blocks closure until
**separately reviewed** reconciliation; it must never be altered merely to
obtain a green gate. Already PENDING hosted checkouts may still succeed after
admission closes. Their signed webhook and normal financial posting remain
enabled. This is deliberate and must be included in backup/recovery planning.

## Rollout and activation — separate authorization required

1. Review schema drift, exact migration hash, trigger names, RLS, grants and
   production recovery. Install only `20261012191510_production_admission_gate.sql`
   while the current application continues in NORMAL. Verify that the state is
   NORMAL and existing booking/checkout behavior is intact. This is a separate
   production migration approval, **not granted by this document**.
2. Deploy the maintenance-aware application as its own reviewed artifact, with
   state still NORMAL. Verify Customer/Admin booking and Customer/Driver
   checkout, authenticated Yoco webhook, existing trip continuation and normal
   authentication. The older application remains compatible with the database
   trigger but would show a generic error if MAINTENANCE were switched on.
3. Before a release window, inspect active trips/offers, CREATED and PENDING
   attempts, callbacks, reconciliation, workers, locks and the production
   write position. The Owner may request NORMAL → MAINTENANCE through
   `POST /api/admin/maintenance-admission` with a reason. Record the returned
   revision/time and verify new trip/attempt inserts fail while in-flight
   processing succeeds. Do not create a real trip or payment solely to test
   this in production.
4. Allow existing trips and signed payment events to resolve naturally. The
   gate **does not freeze financial writes**, including payments initiated
   before closure. A backup taken now is a recovery point, not permission to
   overwrite later legitimate writes. Certify the archive by isolated restore,
   compare the write position and invariants, and require an approved PITR or
   forward-compatible recovery plan for any later writes. If zero-loss
   recovery cannot be established, stop the other release.
5. Only after the separate dispatch release gates pass, apply its reviewed
   migrations and promote its exact staged artifact. Restore NORMAL using the
   same Owner route, verify the audit/state, Customer/Driver/Admin health,
   payment event processing and financial invariants. Keep 90-second dispatch
   OFF and its scheduler inactive pending their separate acceptance.

**Emergency exit:** an authenticated Owner can request MAINTENANCE → NORMAL
through the same endpoint. If the application route is unavailable, an
authorized operator can invoke the same audited `moovu_admission_transition`
RPC with the server-side service role through a trusted private channel and a
current Owner actor ID. Confirm the exact target project first; never expose
the service credential or invoke it from a browser client. Before rolling back
the application to an older deployment,
restore NORMAL first. Do not restore a stale database snapshot over legitimate
post-backup trips/payments. Database rollback can remove the three triggers
only after NORMAL is confirmed; preserve the state/audit records for review.

## Remaining certification requirements

Disposable project `tangtlmdpnvmoviwrgvd` received this migration as history
entry `20261012192001 production_admission_gate`; it remains in NORMAL. The
connected catalog showed three triggers, RLS on both tables, no direct
service-role UPDATE grant, no `anon`/`authenticated` transition EXECUTE grant,
and no audit rows after the rolled-back checks. Within transactions that were
rolled back, direct trip and both attempt inserts were rejected in MAINTENANCE;
the actual `phase5_create_trip` and `phase5_create_online_trip` RPCs were
rejected for a controlled synthetic Customer before trip or financial posting.
The disposable project had one pre-existing CREATED Customer attempt, so the
Owner transition correctly refused activation without changing that attempt.
Independent in-memory PostgreSQL lifecycle checks covered NORMAL →
MAINTENANCE → NORMAL, audit revisions, inserts, existing-row updates and
unauthorized transition rejection. The combined candidate subsequently passed
two true overlapping-session races in the isolated local PostgreSQL stack:
booking first made the Owner transition wait 2995 ms before rejecting the next
booking; transition first made a booking wait 3008 ms before rejection. Both
tests restored NORMAL and removed their synthetic trip. The local stack is not
production-equivalent: its `trips` table has 62 columns and 2 indexes, versus
132 columns and 21 indexes in production. The accepted-trip financial lifecycle
and signed Yoco continuation still require an isolated restore of the current
production schema before release certification.

The pre-existing Customer CREATED attempt was not modified, so a successful
Owner transition on this shared disposable project was not exercised. Signed
webhook continuation, existing trip/OTP completion, authenticated HTTP
responses, and actual provider delivery were not rerun against MAINTENANCE;
the webhook, trusted processor and trip UPDATE routes were left unchanged.
These are required before production installation or activation is certified.
Physical Yoco delivery and production recovery remain separate release checks.
