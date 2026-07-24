# Dispatch and live-location operations

## What the application now enforces

- Every eligible driver selected for a dispatch round receives the trip at once.
- An offer remains valid for 30 seconds.
- A new round starts after an expired round while the trip remains unassigned.
- First valid acceptance wins through the existing atomic acceptance RPC.
- Other offers are withdrawn after assignment.
- Unassigned trips expire five minutes after the original request.
- Driver coordinates are published and consumed every second while the driver page is active and the trip is assigned, arrived, or ongoing.

## Required durable dispatch worker

The web request cannot be the production scheduler. Configure one durable worker
to call `POST /api/jobs/dispatch` at least every 30 seconds with:

```text
Authorization: Bearer <DISPATCH_JOB_SECRET>
Content-Type: application/json
```

The worker must retry transient failures and must use the same
`DISPATCH_JOB_SECRET` configured in Vercel. Suitable options are a durable queue
with delayed callbacks or a continuously running worker. A one-minute Vercel
Cron is not enough for the required 30-second cadence.

Do not make the endpoint public and do not reuse an admin access token as the
machine secret.

## Native background location limit

The current Capacitor Geolocation implementation can publish approximately
once per second while the driver app is active. JavaScript cannot guarantee
one-second updates after iOS suspends the app or Android kills the WebView.

Production background tracking requires a native background-location plugin or
native service:

- iOS: enable the Location Updates background mode, add the matching usage
  description, start significant/continuous native location updates only for an
  assigned or ongoing trip, and stop them when the trip closes.
- Android: use a foreground location service with a persistent notification,
  request the platform-appropriate foreground/background location permissions,
  and stop the service when the trip closes.

These capabilities must be tested on real iPhone and Android devices before
claiming closed-app one-second tracking. Do not enable background location
permissions until the native service is installed and its privacy disclosures
are updated.

## Release checks

1. Apply `docs/operations-reliability-migration.sql` in a staging Supabase project.
2. Configure and verify the durable worker.
3. Book with one, two, three, and five eligible drivers.
4. Confirm every driver receives each 30-second round.
5. Race two accepts and confirm exactly one succeeds.
6. Leave a request untouched and confirm cancellation at five minutes.
7. Test active and background location on real Android and iPhone devices.
