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

Current project status: TypeScript and production build pass. Full lint still has older project-wide debt that should be reduced route by route.

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

## Supabase Storage Setup

Create these buckets:

- `driver-docs`
- `payment-proofs`

Use private buckets with signed URLs where possible. If `payment-proofs` remains public for operational simplicity, avoid uploading sensitive bank statements or unrelated personal documents.

## Rollback Notes

- This app does not run destructive migrations automatically.
- Roll back code changes through Git if a deployment fails.
- For SQL changes, always create a reversible migration and test it on staging data before production.
