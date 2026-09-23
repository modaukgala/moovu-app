-- Disposable first-install simulation. Transaction rolls back all DDL.
begin isolation level repeatable read;
set local lock_timeout='5s';
create temporary table p0_profile_baseline on commit drop as select md5(string_agg(to_jsonb(p)::text,',' order by p.id)) checksum from public.profiles p;
drop trigger p0_customer_actor_profile on public.customers;
drop function public.p0_customer_actor_profile();
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check(role in ('owner','admin','dispatcher','support','driver')) not valid;
-- REVIEW ONLY: production requires separate approval. No Auth/FK/deletion changes.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $guard$
declare definition text;
begin
  if not exists(select 1 from pg_attribute where attrelid='public.profiles'::regclass
      and attname='id' and atttypid='uuid'::regtype and attnotnull)
    or not exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass
      and contype='f' and confrelid='auth.users'::regclass
      and pg_get_constraintdef(oid)='FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE')
    or not exists(select 1 from pg_class where oid='public.profiles'::regclass and relrowsecurity) then
    raise exception 'P0 identity preflight: canonical Auth/profile schema changed';
  end if;
  if exists(select auth_user_id from public.customers group by auth_user_id having count(*)>1)
    or exists(select 1 from public.customers c left join auth.users u on u.id=c.auth_user_id where u.id is null) then
    raise exception 'P0 identity preflight: ambiguous or orphan Customer identity';
  end if;
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.profiles'::regclass and conname='profiles_role_check';
  if definition = 'CHECK ((role = ANY (ARRAY[''owner''::text, ''admin''::text, ''dispatcher''::text, ''support''::text, ''driver''::text])))'
    or definition = 'CHECK ((role = ANY (ARRAY[''owner''::text, ''admin''::text, ''dispatcher''::text, ''support''::text, ''driver''::text]))) NOT VALID' then
    alter table public.profiles drop constraint profiles_role_check;
    alter table public.profiles add constraint profiles_role_check
      check(role in ('owner','admin','dispatcher','support','driver','customer'));
  elsif definition is distinct from 'CHECK ((role = ANY (ARRAY[''owner''::text, ''admin''::text, ''dispatcher''::text, ''support''::text, ''driver''::text, ''customer''::text])))' then
    raise exception 'P0 identity preflight: unexpected role allowlist';
  end if;
  if exists(select 1 from pg_trigger where tgrelid='public.customers'::regclass
      and tgname='p0_customer_actor_profile' and tgfoid is distinct from
      to_regprocedure('public.p0_customer_actor_profile()')) then
    raise exception 'P0 identity preflight: trigger name collision';
  end if;
  if to_regprocedure('public.p0_customer_actor_profile()') is not null
    and md5(replace(pg_get_functiondef(to_regprocedure('public.p0_customer_actor_profile()')),chr(13),''))<>'2388d4d24fa0a304cedc66d3c66913ad' then
    raise exception 'P0 identity preflight: trigger function name collision or drift';
  end if;
end $guard$;

-- Customer persistence, not user-editable metadata, establishes the canonical actor.
-- Explicit customer role is essential: the legacy profiles.role DEFAULT is admin.
create or replace function public.p0_customer_actor_profile()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if not exists(select 1 from auth.users where id=new.auth_user_id) then
    raise exception 'Canonical Customer Auth identity required';
  end if;
  insert into public.profiles(id,role,full_name,phone,created_at)
    values(new.auth_user_id,'customer',nullif(trim(concat_ws(' ',new.first_name,new.last_name)),''),
      coalesce(new.normalized_phone,new.phone),coalesce(new.created_at,now()))
    on conflict(id) do nothing;
  return new;
end $function$;
revoke all on function public.p0_customer_actor_profile() from public,anon,authenticated;

drop trigger if exists p0_customer_actor_profile on public.customers;
create trigger p0_customer_actor_profile after insert or update of auth_user_id on public.customers
  for each row execute function public.p0_customer_actor_profile();

insert into public.profiles(id,role,full_name,phone,created_at)
select c.auth_user_id,'customer',nullif(trim(concat_ws(' ',c.first_name,c.last_name)),''),
  coalesce(c.normalized_phone,c.phone),c.created_at
from public.customers c join auth.users u on u.id=c.auth_user_id
where not exists(select 1 from public.profiles p where p.id=c.auth_user_id)
on conflict(id) do nothing;

do $verify$
begin
  if exists(select 1 from public.customers c left join public.profiles p on p.id=c.auth_user_id where p.id is null) then
    raise exception 'P0 identity postflight: missing actor profiles remain';
  end if;
end $verify$;


do $verify$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.customers'::regclass and tgname='p0_customer_actor_profile')
    or (select checksum from p0_profile_baseline) is distinct from (select md5(string_agg(to_jsonb(p)::text,',' order by p.id)) from public.profiles p) then
    raise exception 'First identity install failed or changed existing profiles';
  end if;
end $verify$;
rollback;
