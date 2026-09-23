# Phase 3 provider-independent foundation implementation

Date: 2026-09-11
Status: **DISPOSABLE DATABASE VALIDATED — production not changed**

## Scope

This first slice implements internal online-payment contracts without calling Yoco, accepting webhooks, registering endpoints, changing production configuration, or activating Pay Online. The schema is installed only on disposable project `tangtlmdpnvmoviwrgvd`; production remains unchanged. Cash / Transfer remains the default behavior. `MOOVU_ONLINE_PAYMENTS_ENABLED` defaults to false.

## Implemented foundation

- `src/lib/payments/onlinePayment.ts`: provider-independent payment states, controlled transitions, integer-cent/ZAR validation, server-verification dispatch invariant, immutable locked-fare value, and Driver-payable eligibility.
- `src/lib/payments/provider.ts`: narrow server-side provider interface. No Yoco adapter exists.
- `src/lib/payments/onlinePaymentLedger.ts`: balanced journal drafts for pre-service collection and post-completion Driver payable. The completion seam takes the current authoritative commission as input and does not import Phase 2's observational 15% policy.
- `src/lib/dispatch/dispatchTrip.ts`: central application gate reads server-held payment evidence and blocks every dispatch path using `dispatchTrip` unless an online attempt is `SUCCEEDED` with `verified_at`.
- Admin trip creation cannot directly assign an online trip. The additive migration also guards `driver_trip_offers` inserts and trip assignment/status changes, covering RPC and future bypasses at the database boundary.
- Active-trip added stops remain unchanged for Cash / Transfer. Online trips reject automatic fare increases and require a later separately approved customer-consent/payment flow.

## Migration

`docs/phase-3-yoco-provider-independent-foundation.sql` is additive and is installed only on disposable project `tangtlmdpnvmoviwrgvd`. Its validated SHA-256 is `06ad838b67c974b1f53531c9b4d8b1169818fc5dc66e166c1737a17e011e2c25`. It adds:

- `online_payment_attempts`
- `online_provider_events`
- `online_payment_refunds`
- `online_driver_payables`
- `online_payment_reconciliation_items`
- immutable-evidence triggers and central online dispatch guards

Constraints cover integer positive cents, ZAR, internal states, active/success attempt uniqueness, provider checkout/payment/event uniqueness, refund/provider/idempotency references, one Driver payable per trip/payment, unique ledger references, foreign keys, and reconciliation states. RLS is enabled. Anonymous/authenticated mutation is revoked; customers receive read-only access to attempts they own; service-role mutation is reserved for later authenticated server workflows.

## Idempotency and ledger seam

Provider payment receipt and trip completion use distinct stable keys: `online_payment:<payment-id>` and `online_trip_completion:<trip-id>`. Existing Phase 1 balanced-entry helpers are reused. Customer funds received before service debit processor clearing and credit customer-funds liability. Trip completion later debits that liability and credits the Driver payable plus current authoritative commission. Provider fees are absent from the Driver calculation. These are local contracts only; no ledger posting is activated.

## Phase 2 isolation

Phase 2 mode, effective date, subscription authority, 15% observation, R50 observation, SHADOW evidence, and RPCs are untouched. Phase 3 modules do not import Phase 2 policy. Legacy Cash commission behavior remains authoritative. Synthetic disposable fixtures were used only for database validation and were rolled back or removed.

## Provider event safety

The inbox defaults every event to `UNVERIFIED`. No HTTP webhook endpoint or event processor is included, because an arrival at a public endpoint is not trust evidence. No event can mutate payment, booking, dispatch, ledger, or Driver payable state in this slice.

## Yoco blocker classification

**YOCO CONFIRMATION REQUIRED — DOES NOT BLOCK PROVIDER-INDEPENDENT FOUNDATION.**

We require authoritative confirmation of:

1. Checkout webhook headers.
2. Signed-content construction.
3. Secret encoding.
4. Whether the Standard Webhooks algorithm applies to Checkout API events.
5. Authoritative event identifier for duplicate detection.
6. Replay/timestamp semantics.
7. Preferably an official signed test fixture.

No production Yoco verifier may be written until this is resolved.

## Activation and rollback boundary

The server flag stays false. Production has no Phase 3 schema. If later validation fails, keep the flag false and remove only the Phase 3 local application changes. In the disposable environment, the objects can be removed in dependency order after disabling the two dispatch triggers. In a future production rollout, rollback means stopping new online attempts while retaining financial evidence; dropping financial tables is not an operational rollback.

## Next gate

Build and validate the fake-provider server workflow against the disposable database while `MOOVU_ONLINE_PAYMENTS_ENABLED=false`. Real Yoco API and webhook work remains gated on the provider confirmation above.
