# Driver online commission checkout recovery

## Confirmed incident

The production `/api/payments/yoco/driver/checkout` endpoint failed before contacting Yoco. Its unique local idempotency key was derived only from Driver identity and the current balance snapshot. A previously successful R42.45 payment and the Driver's new R42.45 debt produced the same snapshot hash. Read-only production inspection confirmed: historical state SUCCEEDED, current authoritative debt 4245 cents, identical obligation hash, and zero active attempts. A new insert therefore conflicted with the historical unique key; the route hid that error behind the reported preparation message.

The isolated PostgreSQL test reproduced this exact unique-key collision. No genuine Driver or financial record was modified to reproduce it.

## Scoped correction

- Each new commission attempt receives a server-generated UUID used in its local unique key. The obligation snapshot remains immutable and server-authoritative.
- The existing one-active-attempt database index still serializes concurrent requests. The Yoco provider key remains bound to the persisted attempt ID, not to each button tap.
- Valid pending checkouts are reused only when amount, currency, obligation version and trusted Yoco URL match. Unknown/partial/reconciliation attempts cannot create another chargeable checkout.
- Missing/invalid configuration is rejected before inserting an active reservation. Definite provider rejections can release only their own CREATED/unbound attempt; release must be confirmed before telling the Driver retry is available.
- Transport uncertainty, idempotency conflict/mismatch, malformed replies and provider server errors remain fail-closed. Existing uncertain attempts still require the established reconciliation process; they are not automatically erased or marked paid.
- Driver checkout callbacks use the Driver domain for production MOOVU hosts and retain the request origin for local/preview testing.
- The payment button has an immediate in-flight guard and resets after recoverable errors. The existing page layout is unchanged.

No SQL migration, ledger policy change, historical adjustment, provider credential change, customer-payment activation, dispatch change or notification-setting change is required.

## Validation tiers

1. Actual checkout route executed with deterministic injected authentication/database/provider dependencies: 18 tests including repeat R42.45, 12 concurrent taps, terminal states, zero balance, unauthorized sessions, client amount/identity ignored, missing configuration, insertion failure, rejection/retry, timeout, failed release, failed binding, pending mismatch and reconciliation protection. These are mocked boundaries, not real PostgreSQL/Yoco requests.
2. Shared checkout transport tests validate exact 4245-cent submission, provider URL/mode/amount checks and safe uncertainty classification. Existing webhook signature tests remain in the full suite.
3. Seventeen real isolated PostgreSQL assertions: production-matching payment constraints/indexes and trusted Driver-event processor; R42.45 debt; trusted synthetic settlement to zero; new identical debt; old-key collision; eight independent concurrent connections with exactly one reservation; failed event preserving debt; new retry; second equal-amount settlement; duplicate event/payment replay without extra credit; unchanged earlier evidence; one ledger posting per attempt; balanced entries; synthetic-only data and cleanup. Trusted processor events used FAKE_TEST and were not HTTP webhook/signature or actual Yoco delivery tests.
4. Full suite: 447 passing tests. TypeScript passed. Full ESLint: zero errors/six pre-existing warnings; changed files rechecked. Local production build uses localhost/build-only configuration, never production credentials. Its artifact must not be uploaded as a production prebuilt build; Vercel must build the tested commit with its existing production environment.

The PostgreSQL harness clones schema only from the existing local fixture into a uniquely named disposable database; it contacts no production database or real provider and drops its synthetic database afterward. Table/index and processor fingerprints were compared against read-only current production metadata; this is not a claim of complete platform parity.

## Protected production baseline

Baseline application: `61254d0f8b396a3ecbbf6a380924942ff498ec60` / `dpl_HRGXRE6Zvz7rEQbazf4vwe8QiZrM`. Driver Broadcast source remains intact. Its disabled capture and paused scheduler must remain unchanged. GitHub main auto-deploys and must not be merged or overwritten for this fix.

Read-only policy inspection confirms AUTHORITATIVE mode, 1500 basis points for Go/Go XL and a 5000-cent debt threshold, with no subscription requirement. The fix does not modify these values. Yoco production variable names/scopes are present; credentials were not exported, changed or used for a test charge.

The existing 8 November scoped business-database restore certificate was previously verified. This code-only change requires no database migration or destructive restore. The previous application can read the same attempt columns/states and provider keys. Application rollback restores the previous deployment, not historical balances. The certificate does not certify full managed Auth, hosted role equivalence or Storage-byte recovery.

## Controlled live validation plan

After deployment, verify exact SHA, Driver payment page, public portals, unauthenticated rejection, invalid webhook-signature rejection, unchanged broadcast control/scheduler and financial invariant aggregates. Do not use genuine Driver credentials or create a real charge just to produce evidence.

The affected Driver should sign in normally and retry Pay Online. Confirm the hosted checkout shows the current authoritative total (R42.45 if unchanged), then stop before payment unless the Driver authorizes the normal payment. Verify one pending attempt and checkout reuse on retry. If a real payment is separately authorized, verify the signed provider webhook and one ledger credit. Agent-created production checkout/charge and authenticated real-Driver settlement are not part of the offline certification.

## Provider references

- https://developer.yoco.com/api-reference/checkout-api/checkout/create-checkout
- https://developer.yoco.com/docs/checkout-api/idempotency
- https://developer.yoco.com/docs/checkout-api/errors

Yoco documents cents-based amounts and idempotency per unique request; conflicts and idempotency payload mismatches are not treated as proof that no checkout exists. A balance value is not a unique payment identity.
