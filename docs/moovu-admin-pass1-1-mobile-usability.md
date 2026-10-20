# MOOVU Admin Pass 1.1 — mobile usability review

## Scope

Baseline: `8bf50a8a1f53211897e759c8fe3e25ca8b04bb37` on `codex/admin-premium-finalisation`. Work is isolated on `codex/admin-premium-pass1-1`. No production deployment, database change, environment change, or business-logic change was made.

## Changes

- Dashboard, Drivers, and Trips use two-column metric tiles below 640px. The final tile in an odd group spans both columns. Labels, values, helpers, status tones, and existing calculation sources remain visible.
- Dashboard and Trips hero panels use tighter phone spacing and heading sizes. Drivers retains its heading, description, Refresh, and Add driver controls.
- The Admin top bar uses less vertical space on phones while keeping Enable Notifications and Logout visible and at least 44px high. Their existing handlers are unchanged.
- The Drivers selected-status filter previously referred to undefined `--moovu-blue`, making its white label nearly invisible. It now uses the existing `--moovu-primary` token and exposes `aria-pressed`. Search focus uses the same defined token.
- No approved correction dialog, finance filter, sidebar, application review, settlement, commission, table, or form flow was changed.

## Local visual evidence

The screenshots are **isolated synthetic previews from a local production build**, not authenticated production screenshots. The local fixture intercepts Admin API calls and denies mutations. Before and after PNGs are in [`admin-pass1-1-screenshots/`](admin-pass1-1-screenshots/). It also includes focused phone-header crops.

| Screen | Viewports checked | Result |
| --- | --- | --- |
| Dashboard | 360×740, 390×844, 412×915, 768×1024, 1440×900 | Two-column phone tiles; alerts and financial values retained; no document overflow |
| Drivers | Same five | Summary tiles compact; search, status filters, records and approval controls visible; selected filter readable; no document overflow |
| Trips | Same five | Summary compact; search and horizontally scrollable status filters remain reachable; no document overflow |
| Shared mobile header | 360×740 and 390×844 focused crops | Navigation, current page, Notifications, and Logout remain visible |

Dashboard and Trips desktop captures are byte-identical to their baseline captures. Drivers desktop layout is unchanged; its selected filter color changes because the previous token was undefined.

Representative comparisons: [Dashboard before](admin-pass1-1-screenshots/before/dashboard-360x740.png) / [after](admin-pass1-1-screenshots/after/dashboard-360x740.png), [Drivers before](admin-pass1-1-screenshots/before/drivers-360x740.png) / [after](admin-pass1-1-screenshots/after/drivers-360x740.png), [Trips before](admin-pass1-1-screenshots/before/trips-360x740.png) / [after](admin-pass1-1-screenshots/after/trips-360x740.png), [header before](admin-pass1-1-screenshots/before/header-390x844.png) / [after](admin-pass1-1-screenshots/after/header-390x844.png).

## Validation and release boundary

- Existing automated tests: **339/339 pass**.
- TypeScript: **pass**.
- Full ESLint: **0 errors**, 5 pre-existing warnings in unchanged files. Scoped ESLint: **pass**.
- Production build: **pass**, 212/212 static pages. The isolated build used a localhost-only synthetic Supabase URL and inert keys for page-data collection; no production credential was copied.
- Visual fixture: **15/15 page and viewport captures pass**, each with document width equal to viewport width. No horizontal document overflow was observed.
- Diff check: pass. No new dependency or migration.

Physical-device touch and keyboard testing, authenticated Admin workflows, private evidence, and real operational data remain unverified in this local preview. Owner visual review is required before a separate production deployment decision.
