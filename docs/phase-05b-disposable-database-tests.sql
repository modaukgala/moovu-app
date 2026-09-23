-- MOOVU PHASE 0.5B DISPOSABLE DATABASE TEST HARNESS
-- PREPARED BUT NOT EXECUTED. NEVER RUN AGAINST PRODUCTION.
-- This file intentionally contains placeholders and aborts unless the operator
-- explicitly creates isolated fixture IDs in a disposable Supabase project.

begin;

do $$ begin
  if current_setting('moovu.disposable_test_database', true) is distinct from 'confirmed' then
    raise exception 'Refusing to run: set moovu.disposable_test_database=confirmed only in an approved disposable database';
  end if;
end $$;

-- Required harness procedure (to be implemented with disposable fixture IDs):
-- 1. Applicant: two concurrent phase05b_submit_driver_application calls for one
--    auth user, retry, foreign ownership claim and duplicate link. Assert one
--    driver/account/application ownership set and deterministic replay.
-- 2. Payment: simultaneous approve/approve and approve/reject sessions. Assert
--    one terminal request, one settlement/subscription effect and one event.
--    Inject exceptions after each internal write in a disposable copy and assert rollback.
-- 3. Completion: race completion/completion, completion/cancellation,
--    completion/no-show and completion/fare update. Assert one terminal event,
--    one immutable commission snapshot and one driver release.
-- 4. Cancellation: race cancellation/cancellation and cancellation/arrival.
--    Assert one fee/offset/event and deterministic replay.
-- 5. No-show: test missing, stale, future and distant evidence; duplicate no-show;
--    race no-show/completion/cancellation. Assert ineligible calls mutate nothing.
-- 6. Assignment: reserve one driver from two sessions for two trips. Assert at
--    most one assignment and revalidation of subscription, busy and debt state.
-- 7. RLS/grants: SET ROLE anon/authenticated and prove direct INSERT/UPDATE/DELETE
--    and EXECUTE are denied on hardened financial objects. Test two customers,
--    two drivers, current staff roles and service-role server contract separately.
-- 8. Outbox: claim one event from two workers, retry failure, deliver twice.
--    Assert one financial event and no financial RPC invocation during delivery.
-- 9. Scale: generate >1,000 completed commission rows, settlements and credits;
--    compare phase05b_driver_debt with direct SQL SUM results.
-- 10. Direct ownership insertion/cross-user linking fails for authenticated users.
-- 11. anon/authenticated cannot execute subscription refresh or offer-counter mutation.
-- 12. Owner/Admin financial operations succeed; Dispatcher/Support mutations fail.
-- 13. Parent deletion cannot remove wallet, settlement, subscription, fee or event history.
-- 14. Overpayment preserves received/applied/unapplied values across retry and rollback.
-- 15. Outbox retries create exactly one user-facing notification per event identity.
-- 16. Missing/version-mismatched RPCs fail closed with no sequential-write fallback.

-- Deliberate stop: replace this exception only in the approved disposable harness.
do $$ begin raise exception 'Template only: disposable fixtures and concurrent sessions are required'; end $$;

rollback;
