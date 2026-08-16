# Google Maps cost control

## Runtime architecture

- Fare distance and duration calculations use `src/lib/maps/routeService.ts`.
- Server Maps calls use `runControlledMapsRequest` for normalized request fingerprints, in-flight deduplication, short process-local response reuse, actor limits, circuit breaking and telemetry.
- Booking, add-stop and `/api/maps/distance` share the same route service. Fare rules remain in the existing fare domain modules.
- `/api/maps/distance` returns a five-minute server-signed route quote. Booking confirmation verifies the route signature and quote before reusing its distance/duration snapshot, so identical confirmation does not require another Google call and client-edited route values are not trusted.
- Client maps keep the live marker separate from route identity. Routes are redrawn only when pickup, destination, stops or trip stage changes.
- Autocomplete waits 500 ms and cancels superseded customer requests.

## Supabase guard

Apply `docs/google-maps-cost-control-migration.sql` manually after review. Until it is applied, the app logs one warning and uses process-local protection. The migration adds only hashed request leases and aggregate outcomes. It does not store coordinates, addresses, place details, routes or Google response payloads.

After applying the migration, an authorized admin can call `GET /api/admin/maps/usage` with the normal Admin bearer token. The response includes local process counters and the last 24 hours of shared aggregate counts.

## Cache policy

Google response content is not persisted in Supabase. The current implementation uses only short-lived process memory to collapse simultaneous calls and brief duplicate UI requests. Place IDs may be retained in the existing application data. Review Google Maps Platform terms before changing this policy or persisting provider content.

## API keys

Use separate keys:

1. `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY`: preferred browser key. Restrict to Maps JavaScript API and Places API, with HTTP referrers for `https://moovurides.co.za/*`, `https://www.moovurides.co.za/*`, `https://driver.moovurides.co.za/*` and `https://admin.moovurides.co.za/*`. `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` remains a non-breaking transition fallback.
2. `GOOGLE_MAPS_SERVER_API_KEY`: server-only key. Restrict to Geocoding API, Places API and Distance Matrix API. Store only in Vercel server environment variables. Use a server-side restriction supported by the deployment architecture; do not expose it to browser code.
3. `GOOGLE_MAPS_API_KEY`: legacy server fallback during migration. Remove after production confirms the new server key.
4. `MAPS_ROUTE_QUOTE_SECRET`: recommended dedicated random server-only HMAC secret. During transition, the server can use existing server secrets, so rollout is non-breaking.

Capacitor builds load the hosted MOOVU domains, so the browser-key referrer rules must include the actual hosted customer and driver origins. Native SDK keys, if introduced later, should be separate and restricted by Android package/SHA-1 or iOS bundle ID.

Verified identifiers in this repository:

- Customer Capacitor/iOS app ID: `za.co.moovu.customer`
- Driver Capacitor/iOS app ID: `za.co.moovu.driver`
- Checked-in legacy Android Gradle application ID: `za.co.moovurides.app`

Before creating Android-native key restrictions, confirm the final generated Customer and Driver Gradle application IDs and release signing SHA-1/SHA-256 from the exact AAB build. Do not apply the legacy Android ID to both Play listings without that packaging check.

## Suggested initial quotas and budgets

Start conservatively, observe a normal week, then raise deliberately:

| API | Suggested daily quota | Suggested per-minute quota |
| --- | ---: | ---: |
| Distance Matrix | 1,000 requests | 90 |
| Geocoding | 600 requests | 120 |
| Places Autocomplete | 4,000 requests | 360 |
| Place Details | 1,500 requests | 180 |

Create Google Cloud budget alerts at 25%, 50%, 75% and 100% of the monthly Maps budget. Budget alerts notify; API quotas and the application circuit breaker are the actual usage controls.

## Expected call behaviour

- Idle customer booking page: no route/fare provider requests.
- Typing a location: one autocomplete request after 500 ms of inactivity; superseded requests are aborted.
- Selecting pickup and destination: one authoritative Distance Matrix route calculation for the estimate, plus one browser route render when the route identity changes.
- Adding or changing a stop: a new route calculation and render only after the stop is resolved.
- Live trip and Admin map: marker coordinates update without recalculating the route on every GPS heartbeat.
- Duplicate requests inside the TTL or concurrent window share work rather than calling Google repeatedly.

## Operations

- Logs use the `[maps-cost-control]` prefix and contain operation, cache state and block reason, never API keys or full addresses.
- A 429 response means the actor limit was reached. A 503 response means the shared or local circuit breaker protected the provider budget.
- If the shared RPC is unavailable, look for `shared guard unavailable; using process-local protection` and verify the migration and Vercel Supabase variables.
- Retain Google Cloud billing alerts and API-level quotas even after the shared guard is active.
