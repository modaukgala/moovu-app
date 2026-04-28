# MOOVU Kasi Rides — VS Code Setup

## Quick start

```bash
npm install
npm run dev
```

Then open http://localhost:3000

---

## Environment variables

Create a `.env.local` file in the project root with:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Google Maps
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
GOOGLE_MAPS_API_KEY=your_google_maps_api_key

# Web Push (optional)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your_vapid_public_key
VAPID_PRIVATE_KEY=your_vapid_private_key
VAPID_SUBJECT=mailto:you@yourdomain.com
```

Copy from `.env.example` as a starting point.

---

## Recommended VS Code extensions

- ESLint
- Tailwind CSS IntelliSense
- Prettier
- TypeScript and JavaScript Language Features (built-in)

---

## Phase 3 UI changes applied

| Task | What changed |
|------|-------------|
| 1 | "Use my location" is now a compact inline button beside the Pickup label |
| 2 | Typing a location without selecting dropdown now auto-resolves via geocode API |
| 3 | Ride history removed from below inputs — Trips link stays in top header |
| 4 | MOOVU Go (1–3 riders) and MOOVU Group (1–6 riders, 1.35× fare) replace old options |
| 5 | Pricing formula hidden from customers — shows "Final fare confirmed before booking" |
| 6 | Admin portal removed from home page — replaced with "Drive with MOOVU" section |
| 7 | Receipt redesigned as a clean document layout with MOOVU logo |

## Files changed in this phase

- `src/app/book/page.tsx`
- `src/app/page.tsx`
- `src/app/ride/[tripId]/receipt/page.tsx`
- `src/app/globals.css`
