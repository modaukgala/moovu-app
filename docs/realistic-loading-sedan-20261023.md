# Realistic Loading Sedan - Local Replacement

Implementation-stage evidence. The owner subsequently authorized a controlled live
deployment on 23 October 2026. Final deployment details and verification boundaries
are recorded separately in `realistic-loading-sedan-deployment-20261023.md`.

Base release: `2ebbcc9842525bb9f6f01b18a0cad84a5cc8f603`.

Worktree: `D:\Users\KN Mudau\Desktop\Websites\moovu-customer-premium-loading`.

## Scope

Only the vehicle artwork is replaced in the common Customer, Driver and Admin loading
scene. No route integrations, readiness conditions, authorization, financial functions,
API calls, native configuration, official logo, headings or loading messages changed.

The replacement is an original AI-generated photorealistic automotive render, not a
live 3D model, a new SVG illustration or an externally downloaded manufacturer asset.
Generated using the built-in image-generation tool; no CLI/API fallback was used.

## Asset

`public/loading/moovu-premium-sedan.webp`

- 1320 x 580 canvas; 113,022 bytes (about 110 KiB).
- Real alpha channel, including fully transparent and opaque pixels.
- Glossy black sedan, restrained yellow lower trim, front facing right, alloy wheels,
  LED lamps, brand-neutral grille and contact shadow.
- No roof sign, taxi lettering or manufacturer badge visible in the inspected render.
- Transparent margins reproduce the previous vehicle's visual footprint, reserving
  space for the route and both markers without changing the surrounding CSS.
- Static optimized WebP served directly with reserved dimensions; no runtime rendering
  dependency or image-optimization cold start is introduced.

Original generated PNG is retained at:
`C:\Users\kgala\.codex\generated_images\019dcfef-7536-7e31-acf3-fa9782522611\exec-d0611225-e0e3-498c-ba47-878a6c0422a1.png`.

## Generation Brief

Original photorealistic premium automotive CGI studio asset; modern four-door sedan,
glossy metallic black, thin yellow lower-door accents, realistic silver alloy wheels,
tyres, LED headlights, tinted windows, mirrors, natural reflections, original unbadged
design. Low front-right three-quarter view, nose facing right and slightly toward the
viewer, passenger-side profile extending left. Entire vehicle visible with a small
soft contact shadow on genuine transparent alpha. No scenery, floor, horizon, text,
roof sign, taxi lettering, manufacturer logos, cartoon outlines or exaggerated geometry.

Reproduction/optimization command from this worktree:

```powershell
node scripts/prepare-loading-sedan.mjs "<path-to-original-transparent-render.png>"
```

The existing Sharp dependency trims padding, fits the render in 1200 x 520 transparent
space, adds 60px horizontal/30px vertical transparent borders, and encodes WebP at quality
88 with alpha quality 100. It rejects opaque output.

## Files Changed or Created

- `src/components/ui/MoovuLoadingScene.tsx`: replaces only the car SVG with the render.
- `src/components/ui/MoovuLoadingScreen.module.css`: removes obsolete wheel rotation only.
- `src/components/customer/loadingExperience.test.ts`: updates rendered-asset assertions
  and verifies file size, dimensions and genuine alpha.
- `public/loading/moovu-premium-sedan.webp`: optimized production asset.
- `scripts/prepare-loading-sedan.mjs`: reproducible asset preparation.
- This report.

Existing untracked deployment reports/screenshots were preserved, not overwritten.

## Animation

Existing one-time arrival, easing, delay and dimensions remain unchanged. The vehicle
enters left to right once, then stays centred. Image wheels are deliberately stationary;
the unchanged forward route highlight communicates motion. There is no reversed,
alternating or flipped vehicle animation. Reduced-motion and background pausing remain.

## Verification

- Complete automated suite: 348 passed.
- Production build: passed with localhost placeholders only.
- ESLint: zero errors; five pre-existing warnings in the full scan.
- Final focused ESLint check: passed with zero errors/warnings. Explicit TypeScript check passed.
- Direct source comparison to HEAD: skyline, route and markers are unchanged, and
  all non-wheel CSS matches after line-ending normalization.
- Image metadata/pixels: valid transparent WebP, expected dimensions, within 180 KB budget.
- Original render visually inspected for realism, direction and excluded branding.

Browser access to the local preview was blocked by the browser security gate. No
workaround was attempted. No new screenshot, desktop/mobile in-page comparison,
runtime full-loop check or physical-device check is claimed for this replacement.
Older screenshots show the previous vehicle and are NOT new-car evidence.

## Local Visual Acceptance

Open `http://localhost:3016/preview/loading` and compare with the approved layout.
Also inspect `?view=mobile`, `?view=driver`, `?view=admin` and `?view=compact`.

1. Check that the car renders without a rectangular background and faces right.
2. Watch the entrance and multiple complete route loops: no reversal or image-wheel rotation.
3. Check desktop, narrow phones and high-density screens: both pins and text remain visible.
4. Verify reduced motion and background/resume behavior on iPhone and Android.

This preview uses localhost-only placeholder Supabase configuration; do not use real
accounts or treat it as authenticated workflow validation.

Deployment readiness: NEEDS CAUTION pending visual acceptance. No commit, push,
deployment, production SQL or other production change was performed for this replacement.
