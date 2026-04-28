# MOOVU Rebuild Architecture

This document defines the safe rebuild target for MOOVU. The current app is being migrated in phases, not deleted all at once.

## Backup

Verified backup before Phase 1:

`D:\Users\KN Mudau\Documents\MOOVU Backups\moovu-kasi-rides-redesign-backup-20260427-194030`

The current source did not contain any `.zip` files at backup time.

## Current Decision

The existing app already has working ideas for booking, driver offers, admin operations, push notifications, payments, commissions, and receipts. The safer approach is to keep the existing routes online while introducing clean shared foundations, then migrate each flow behind the same URLs.

## Target Structure

```text
src/
  app/
    (marketing)/              # Optional future public pages only
    admin/                    # Admin portal routes
    api/                      # Route handlers for external/browser calls
    book/                     # Customer booking flow
    customer/                 # Customer auth/account routes
    driver/                   # Driver portal routes
    ride/                     # Trip tracking, receipts, rating, support
  components/
    app-shell/                # Portal layouts and navigation
    forms/                    # Reusable field/form primitives
    maps/                     # Map and location UI
    notifications/            # Push notification UI
    status/                   # Badges, timeline, state displays
    ui/                       # Low-level reusable UI primitives
  features/
    admin/                    # Admin queries/actions/components
    customer/                 # Customer booking/account logic
    driver/                   # Driver profile/offers/earnings logic
    notifications/            # Push orchestration
    payments/                 # POP, subscription, settlement logic
    trips/                    # Trip lifecycle and offer logic
  lib/
    config/                   # Environment and runtime config helpers
    domain/                   # Shared business constants/types
    supabase/                 # Browser/server/admin Supabase clients
  types/                      # Generated Supabase and app-wide types
supabase/
  migrations/                 # Schema, RLS, functions, storage policies
  seed/                       # Optional demo data, clearly separated
```

## Core Rules For New Code

- Keep authorization on the server. UI checks are only convenience.
- Use route handlers for browser-triggered mutations, file uploads, push notification endpoints, and webhook-like operations.
- Keep shared business rules in `src/lib/domain`, then call them from both API routes and client views.
- Use lazy server client initialization so builds do not crash when runtime-only environment variables are unavailable.
- Keep all database schema changes in `supabase/migrations`.
- Do not add destructive migrations without a rollback/data-impact note.

## Phase Map

1. Clean architecture foundations.
2. Supabase schema, RLS, storage policy notes, and DB type generation.
3. Auth and role enforcement.
4. Customer booking and trip tracking.
5. Driver portal and OTP-secured trip lifecycle.
6. Admin operations, receipts, payments, subscriptions, and settlements.
7. Safe push notification events.
8. Lint, typecheck, build, responsive QA, and Vercel readiness.

