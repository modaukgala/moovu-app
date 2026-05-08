# MOOVU Deployment Notes

## Required Environment Variables

Use `.env.example` as the deployment checklist:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
- `GOOGLE_MAPS_API_KEY`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `PUSH_INTERNAL_API_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_VAPID_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

Never commit `.env.local` or production secrets.

## Vercel Deployment

1. Set the environment variables above in the Vercel project.
2. Confirm Supabase tables, RLS policies, and storage buckets exist before production traffic.
3. Run local validation before pushing:

```bash
npx tsc --noEmit
npm run build
npm run lint
```

Current project status: TypeScript, production build, and full lint pass locally.

## Supabase Type Generation

The Supabase CLI was not available on this Windows workstation during the deployment-readiness pass. Install it before the next schema/type sync, then generate database types with:

```bash
supabase gen types typescript --project-id mvazbszenqahgqpznhhq --schema public > src/lib/supabase/database.types.ts
```

After generation, wire the typed database into the browser/admin Supabase clients in a small follow-up so existing queries can be validated without changing behavior.

## Google Maps Setup

- Browser key: use `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and restrict it to the deployed domains.
- Server key: use `GOOGLE_MAPS_API_KEY` for API routes and restrict it to required Google Maps APIs.
- Required APIs include Places, Geocoding, Maps JavaScript, and Distance Matrix or Routes depending on the configured implementation.

## Push Notification Setup

- Generate VAPID keys and configure:
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY`
  - `VAPID_SUBJECT`
- Confirm the PWA service worker is served from `public/sw.js`.
- Confirm `/api/push/subscribe` validates authenticated user roles before storing role-scoped subscriptions.
- Use `/api/push/test-self` from the customer, driver, and admin UI to prove each logged-in role can receive a notification on its own device.
- Keep `PUSH_INTERNAL_API_KEY` server-only; `/api/push/send` must not be called from public browser code.
- Firebase Cloud Messaging is supported alongside the existing web-push path. Public Firebase client variables may be exposed to the browser, but `FIREBASE_PRIVATE_KEY` and `FIREBASE_CLIENT_EMAIL` must be server-only in Vercel.
- Apply `docs/fcm-notifications-migration.sql` on staging/production before relying on FCM token storage.
- The Firebase private key must preserve newlines. In Vercel it can be stored with escaped `\n`; the server helper converts escaped newlines at runtime.
- Browser/PWA push requires HTTPS in production. iOS push support depends on installed PWA behavior and current Safari limitations. Native Play Store/App Store packaging should use Capacitor with FCM/APNs for fully reliable app notifications.

## Cancellation And No-Show Setup

- Apply `docs/cancellation-management-migration.sql` before relying on full cancellation/no-show fee reporting tables and optional trip columns.
- The app server calculates fees. Current policy:
  - free cancellation during the first 2 minutes or before driver dispatch.
  - late cancellation R15 after driver dispatch, split R10 driver and R5 MOOVU.
  - no-show R30 after driver arrival plus 5 minutes, split R22 driver and R8 MOOVU.

## Supabase Storage Setup

Create these buckets:

- `driver-docs`
- `payment-proofs`

Use private buckets with signed URLs:

- `driver-docs`: private.
- `payment-proofs`: private. New driver POP uploads store `pop_file_path`; admin payment review responses generate short-lived signed URLs for viewing proof files.

Do not expose public proof-of-payment URLs in production.

## Rollback Notes

- This app does not run destructive migrations automatically.
- Roll back code changes through Git if a deployment fails.
- For SQL changes, always create a reversible migration and test it on staging data before production.
