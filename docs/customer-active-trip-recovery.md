# Customer Active Trip Recovery

Customer entry routes `/` and `/book` resolve the restored authenticated session
before showing booking UI. A read-only `/api/customer/active-trip` lookup binds
the Customer profile to the verified auth user. It does not repair/create profiles.
The service-side query returns only a destination, never arbitrary Customer data.

Existing active states: requested, offered, assigned, arrived, ongoing.
Terminal states: completed and cancelled. No lifecycle states are introduced.
Future scheduled requested/offered bookings do not capture entry navigation;
assigned/arrived/ongoing scheduled rides remain resumable. Multiple candidates
are ordered by created_at descending then id descending, with a minimal anomaly log.

Cash and verified-online trips resume `/ride/[tripId]`. Unpaid-online trips resume
the existing `/payment/success?tripId=...` confirmation page. The resolver never
dispatches, marks paid, recreates a booking, creates checkout or changes a payment
attempt. Payment, auth, account deletion, legal, support, shared links, receipt,
rating, Driver and Admin routes are excluded by the exact entry-route allowlist.
Existing Trip Status continues its own realtime/status updates when already open.

Cold browser startup, authentication changes, visibility/focus and native
Capacitor appStateChange recheck entry recovery. There is no periodic polling.
Network failures show a retry state rather than exposing new-booking UI. No local
trip ID cache is used, so another authenticated device resolves server state too.

## Validation and Native Release Gate

- Unit/non-regression: npm test, npm run lint, npm run build, npx tsc --noEmit.
- Disposable-only `scripts/customer-resume-e2e.mjs` validates real authenticated
  lookup, states, scheduled protection, payment gate, ownership, multiple candidates,
  fresh browser contexts and payment-route exclusions. Requires PHASE3_E2E_* and
  QA_PLAYWRIGHT_PATH. Test fixtures remain only in tangtlmdpnvmoviwrgvd as evidence.
- No database migration, financial mutation, provider call or production test trip.
- Existing Customer Capacitor configuration loads https://moovurides.co.za; this
  change does not alter native plugins/assets or overwrite the Yoco Browser work.
- Windows checks cannot prove an Xcode archive or physical native cold start.
  Before the combined native release: book a legitimate trip, force-close/reopen,
  background/resume, verify same trip and OTP/map/driver data; repeat after
  cancellation/completion and test an in-app Yoco return. Retain the existing
  Customer/Driver Browser-plugin release work. Do not upload store releases here.
