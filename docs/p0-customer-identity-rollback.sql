-- Approval required. Functional rollback ONLY; retain repaired canonical profiles
-- and customer role allowance so existing trips remain valid. Never delete actors.
begin;
do $guard$
begin
  if md5(replace(pg_get_functiondef('public.p0_customer_actor_profile()'::regprocedure),chr(13),''))<>'2388d4d24fa0a304cedc66d3c66913ad' then
    raise exception 'P0 identity rollback: expected trigger function changed';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.customers'::regclass
    and tgname='p0_customer_actor_profile' and tgfoid='public.p0_customer_actor_profile()'::regprocedure) then
    raise exception 'P0 identity rollback: expected trigger required';
  end if;
end $guard$;
drop trigger if exists p0_customer_actor_profile on public.customers;
-- Keep the trigger function (not executable by clients) for a safe roll-forward.
-- This disables prevention and can restore the outage for future customers.
-- Prefer forward correction; do not remove customer from the role check.
commit;
