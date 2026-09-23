-- DISPOSABLE ONLY. Production already grants these privileges; RLS remains enabled.
begin;
grant select,insert,update on public.dispatch_jobs to service_role;
commit;

