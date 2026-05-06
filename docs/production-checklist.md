# MOOVU Production Readiness Checklist

## Build And Code Quality

- Run `npx tsc --noEmit`.
- Run `npm run build`.
- Run `npm run lint`; it should pass before production testing.
- Confirm all user roles can reach their intended dashboards.

## Vercel Environment Variables

Configure these in Vercel:

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

## Supabase Setup

- Confirm required tables exist.
- Confirm RLS is enabled on customer, driver, trip, payment, receipt, and push tables.
- Confirm server-only actions use service role only in API routes.
- Confirm at least one production admin profile exists with role `owner` or `admin`.
- Confirm driver account links exist in `driver_accounts`.

## Storage Buckets

Create and configure:

- `driver-docs`
- `payment-proofs`

- `driver-docs`: private.
- `payment-proofs`: private. Driver uploads should store object paths, and admin review pages should use signed URLs.

## Google Maps

- Restrict browser key to production domains.
- Restrict server key to server-side APIs where possible.
- Enable required APIs:
  - Maps JavaScript
  - Places
  - Geocoding
  - Distance Matrix or Routes

## Push Notifications

- Generate production VAPID keys.
- Confirm service worker is served from `/sw.js`.
- Test push subscribe for:
  - customer
  - driver
  - admin
- Test push events:
  - new trip offer
  - driver accepted
  - driver arrived
  - trip started
  - trip completed
  - driver payment submitted to admin
  - payment approved/rejected
  - customer-driver chat messages after driver acceptance

## Operational Smoke Test After Deploy

1. Customer signs in.
2. Customer books MOOVU Go.
3. Customer books MOOVU Group.
4. Driver goes online.
5. Driver accepts trip.
6. Driver marks arrived.
7. Driver starts trip with OTP.
8. Driver completes trip with OTP.
9. Receipt opens.
10. Driver earnings update.
11. Admin sees trip.
12. Admin reviews subscription payment.
13. Admin reviews commission payment.
14. Push notifications deliver or fail gracefully.
15. Chat works after driver acceptance and is unavailable before acceptance.
16. Admin proof-of-payment links open through signed URLs.

## PWA And Mobile

- Confirm `manifest.json` values.
- Confirm icons and Apple touch icon.
- Confirm sticky bottom controls are not hidden behind browser/app bars.
- Test at:
  - 360 x 740
  - 390 x 844
  - 430 x 932
  - 768 x 1024
  - 1280 x 800

## Rollback

- Keep the previous successful Vercel deployment available.
- Roll back via Vercel deployment promotion if production breaks.
- Roll back database changes only with reviewed reversible SQL.
