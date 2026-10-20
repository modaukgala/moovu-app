# Sustained performance validation

The candidate starts from `a04e32a72f0002fc44d16e9c9dfeb68846bb33f2`. Do not deploy this worktree automatically.

## Client measurements

Driver startup telemetry is disabled in production at build and route level. In non-production, it requires `NEXT_PUBLIC_MOOVU_PERFORMANCE_TELEMETRY=true`, samples at most 5% of tabs and eight events per tab, accepts same-origin requests only, bounds request bodies to 1 KB, and writes no database rows. The 100-request/minute limit is per function instance; review shared rate limiting and log retention before enabling telemetry outside local development. Production startup behavior is independent of telemetry.

## Isolated concurrency test

Run only with an isolated local app and database containing synthetic accounts. Put a JSON fixture outside the repository with at least 100 sessions: `{ "sessions": [{ "role": "driver", "token": "...", "cookie": "..." }] }`. Driver APIs use the test bearer token; authenticated pages need a test session cookie. Do not commit or share the fixture. Set the local app's Supabase URL to the disposable project, and disable external payment and push delivery. The script refuses non-localhost targets and performs GET requests only. Redirects to login count as failures.

`node scripts/performance/isolated-read-load.mjs --base=http://127.0.0.1:3000 --fixture=C:\\path\\to\\synthetic-sessions.json`

The script ramps through 10, 25, 50, and 100 sessions. It stops above 2% errors or 3-second request p95. Its results are HTTP read latency only: it does not prove auth restoration, Realtime stability, writes, booking, dispatch, or total concurrent-user capacity. Test those separately against isolated synthetic fixtures and independent connections. Record device/network, cold and warm startup, database CPU/connections, Vercel function duration, and Supabase query plans before changing indexes or RLS.

## Controlled rollout and rollback

Before release, compare owner-performed Driver cold/warm/background startup on the same device and network, then confirm offers, OTP, online status, Customer booking and Admin finance remain intact. Deploy only after explicit approval. Roll back the web deployment to `dpl_5a3N47UbwbvmQPntu137p8h2Cyfn` if Driver startup, offer delivery, booking, or financial screens regress. There is no database migration in this candidate.
