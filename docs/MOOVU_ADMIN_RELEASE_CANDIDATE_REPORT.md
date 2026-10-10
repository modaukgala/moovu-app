# MOOVU Admin unified release candidate — 10 October 2026

## Source and scope

- Branch: `codex/admin-unified-release`, based on `a3bad55a2a1d1446506f1f0432da18becc00010b`.
- Current production Vercel deployment: `dpl_A2L1PohgmfiFtZfVq5CzQF9QGY4J` (READY). Its deployment metadata identifies `a3bad55a2a1d1446506f1f0432da18becc00010b` on `codex/phase6-outbox-safety`; the aliases include `admin.moovurides.co.za` and `moovurides.co.za`.
- The candidate contains only Admin pages, corresponding Admin API presentation/read contracts, shared Admin helpers and tests, Admin-specific CSS, and the necessary Phase 6 presentation/test integration. It has no migration or environment change.
- The original Group A/B/C worktree and checkpoint `moovu-admin-unification-checkpoint-20261010-095226` remain intact.
- Excluded: Phase 05g fixtures/scripts/configuration, Admin E2E isolation code, notification worker changes, push-server changes, temporary files, credentials and unrelated work.

## Compatibility evidence

- Read-only production catalog inspection confirmed `drivers`, `trips`, `phase6_applications`, `phase6_enrollments`, `phase6_uploads`, and `phase6_reviews` and the columns queried by the new Admin summary. RLS remains enabled on those tables.
- The new `/api/admin/application-summary` route requires an authenticated Admin and the existing financial Admin role check. Existing Admin routes retain their authentication and mutation handlers. The new route and existing routes compile in the isolated candidate.
- No fare, commission, dispatch, onboarding decision, payment, notification delivery, or authorization mutation was added. The changed finance endpoints alter presentation names and labels only.
- No database migration is required by this candidate. Read-only catalog and static checks do not replace authenticated production smoke tests.

## Validation

- Full candidate suite: 306 passed, 0 failed. The earlier dirty worktree's 311 count includes five tests for excluded notification/E2E isolation work.
- TypeScript: PASS (`npx tsc --noEmit`).
- ESLint: PASS, 0 errors, 5 warnings in unchanged files.
- Next.js production build: PASS using process-only nonfunctional build placeholders; no production credential was used.
- `git diff --check`: PASS. No new dependency.

## Protected preview gate

Do not deploy a preview until the branch's preview Supabase project reference is confirmed by a supported secure binding check. Vercel lists sensitive preview bindings for Supabase URL/keys and Yoco configuration; the names/targets alone do not establish whether preview is isolated from production. Confirm the preview authentication redirect URLs, deployment protection, absence of any preview notification worker or scheduled write job, and payment routes disabled or independently sandboxed before authenticated testing. A preview bound to production must initially be read-only, and no real Admin mutation or payment may be used for smoke testing. No production environment variable needs changing for this candidate.

## Manual smoke after protected preview authorization

Use non-destructive accounts and records only:

1. Owner signs in; verify sidebar, active routes, mobile drawer, and dashboard/review count parity.
2. Dispatcher and Support sign in separately; verify allowed navigation and denied controls follow their current role contracts.
3. Verify Driver names, list/detail profile links, legacy applications and Phase 6 review queues without changing an application.
4. Open Trips, Dispatch, Finance and Reports; inspect labels, filters, responsive tables and empty/error states without assigning trips or posting finance.
5. At 375, 430, 768, 1024 and 1440 pixels, verify navigation, controls, horizontal overflow and keyboard/touch access.

## Rollback

Before any later release, confirm `dpl_A2L1PohgmfiFtZfVq5CzQF9QGY4J` is still the active production deployment and retain its aliases. If a subsequently approved application deployment regresses, use the supported Vercel rollback command with that deployment ID under scope `kgalaletsos-projects`, then verify aliases and nonfinancial Admin smoke tests. Rollback is an external production action requiring separate authorization. This candidate has no database migration or irreversible data operation to reverse.
