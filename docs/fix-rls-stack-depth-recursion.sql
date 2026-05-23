-- MOOVU RLS stack-depth recursion fix (review-only)
-- Do not run on production until reviewed and tested on staging.
--
-- Symptom:
-- Browser/anon reads against protected tables can fail with:
--   code 54001: stack depth limit exceeded
--
-- Likely cause:
-- Some policies call public.is_staff(). If public.is_staff() reads public.profiles
-- as the invoking user, and the profiles SELECT policy also calls public.is_staff(),
-- Postgres recursively evaluates profiles policies until stack depth is exceeded.
--
-- Goal:
-- Keep RLS enabled and protected, but make staff-role checks non-recursive by
-- using a SECURITY DEFINER function with a locked search_path.

begin;

-- 1) Inspect policies that depend on staff checks before changing anything.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and (
    qual ilike '%is_staff%'
    or with_check ilike '%is_staff%'
    or tablename = 'profiles'
  )
order by tablename, policyname;

-- 2) Replace the staff check with a non-recursive SECURITY DEFINER function.
-- Run this as a privileged migration owner in Supabase SQL editor/CLI.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('owner', 'admin', 'dispatcher', 'support')
  );
$$;

comment on function public.is_staff() is
  'MOOVU non-recursive staff check for RLS policies. SECURITY DEFINER prevents profiles policy recursion.';

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_staff() to service_role;

-- Optional if your migration role is not already the table owner/superuser:
-- alter function public.is_staff() owner to postgres;

-- 3) Optional profiles policy template if staging inspection shows the profiles
-- SELECT policy itself uses a direct recursive profiles lookup instead of is_staff().
-- Adjust/drop the existing policy name manually after inspecting pg_policies above.
--
-- drop policy if exists "profiles_select_own_or_staff" on public.profiles;
-- create policy "profiles_select_own_or_staff"
-- on public.profiles
-- for select
-- to authenticated
-- using (
--   id = auth.uid()
--   or public.is_staff()
-- );

-- 4) Verify after applying on staging:
-- select public.is_staff();
-- select id, role from public.profiles limit 1;
-- Then test admin APIs and browser pages.

commit;
