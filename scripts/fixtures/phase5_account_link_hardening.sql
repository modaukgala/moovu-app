begin;

do $$ declare f regprocedure:=to_regprocedure('public.phase6_legacy_guard()');begin
 if f is not null and md5(pg_get_functiondef(f))<>'1b2913494e6b92ed0a5d1b26e81f782d' then
  raise exception 'Onboarding guard differs from the reviewed production definition';end if;
end $$;

-- Retain the existing guard, adding only a same-transaction, audited name projection.
create or replace function public.phase6_legacy_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare driver_uuid uuid; authorized boolean; protected_change boolean;
begin
 if not exists(select 1 from public.phase6_policy where singleton and active) then return case when tg_op='DELETE' then old else new end;end if;
 driver_uuid:=(to_jsonb(old)->>case when tg_table_name='drivers' then 'id' else 'driver_id' end)::uuid;
 if tg_table_name='drivers' and tg_op='UPDATE' and coalesce(auth.role(),'')='service_role' and
  (to_jsonb(new)-array['first_name','last_name','updated_at'])=(to_jsonb(old)-array['first_name','last_name','updated_at']) and
  exists(select 1 from public.phase5a_driver_name_corrections a join public.profiles pr on pr.id=a.actor_id
   join auth.users u on u.id=a.actor_id where a.id::text=current_setting('moovu.phase5a_name_correction',true)
   and a.driver_id=driver_uuid and a.created_at=transaction_timestamp() and pr.role in ('admin','owner') and u.deleted_at is null
   and ((a.field_name='first_name' and (to_jsonb(old)->>'first_name') is not distinct from a.old_value and to_jsonb(new)->>'first_name'=a.new_value and (to_jsonb(new)->>'last_name') is not distinct from (to_jsonb(old)->>'last_name'))
    or (a.field_name='last_name' and (to_jsonb(old)->>'last_name') is not distinct from a.old_value and to_jsonb(new)->>'last_name'=a.new_value and (to_jsonb(new)->>'first_name') is not distinct from (to_jsonb(old)->>'first_name')))) then return new;end if;
 authorized:=exists(select 1 from public.phase6_applications a where a.driver_id=driver_uuid and a.id::text=current_setting('moovu.phase6_review_application',true) and a.status='UNDER_REVIEW');
 if authorized then return new;end if;
 if tg_op='DELETE' then raise exception 'Use the controlled retention workflow' using errcode='P0001';end if;
 if tg_table_name='drivers' then
  protected_change:=(to_jsonb(new)-array['lat','lng','last_seen','online','busy','updated_at','subscription_status','subscription_plan','subscription_expires_at','subscription_amount_due','subscription_last_paid_at','subscription_last_payment_amount']) is distinct from (to_jsonb(old)-array['lat','lng','last_seen','online','busy','updated_at','subscription_status','subscription_plan','subscription_expires_at','subscription_amount_due','subscription_last_paid_at','subscription_last_payment_amount']);
 else protected_change:=to_jsonb(new) is distinct from to_jsonb(old);end if;
 if tg_table_name='drivers' and tg_op='UPDATE' and current_setting('moovu.phase6_operating_driver',true)=driver_uuid::text and (to_jsonb(new)-array['status','updated_at'])=(to_jsonb(old)-array['status','updated_at']) then return new;end if;
 if protected_change then raise exception 'Use versioned onboarding review' using errcode='P0001';end if;
 return new;
end $$;
revoke all on function public.phase6_legacy_guard() from public,anon,authenticated,service_role;

-- Existing ownership must be clean; never repair or reassign accounts implicitly.
do $$ begin
 if exists(select 1 from public.driver_accounts where driver_id is not null group by driver_id having count(*)>1) then
  raise exception 'Conflicting Driver ownership requires review';end if;
end $$;
create unique index if not exists driver_accounts_driver_id_unique_not_null on public.driver_accounts(driver_id) where driver_id is not null;

create table public.phase5a_driver_link_audit (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null,
 previous_driver_id uuid,
 resulting_driver_id uuid,
 actor_id uuid,
 operation_key uuid,
 command jsonb,
 reason text not null,
 source text not null check(source in ('ADMIN','SYSTEM')),
 created_at timestamptz not null default now(),
 unique(actor_id,operation_key)
);
create index phase5a_driver_link_audit_user_created on public.phase5a_driver_link_audit(user_id,created_at desc);
alter table public.phase5a_driver_link_audit enable row level security;
revoke all on public.phase5a_driver_link_audit from public,anon,authenticated;
grant select on public.phase5a_driver_link_audit to service_role;
create trigger phase5a_driver_link_audit_immutable before update or delete on public.phase5a_driver_link_audit
 for each row execute function public.phase6_immutable();

create function public.phase5a_guard_driver_link() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if old.user_id is distinct from new.user_id or (old.driver_id is not null and new.driver_id is not null and old.driver_id<>new.driver_id) then
  raise exception 'Existing Driver ownership cannot be reassigned' using errcode='P0001';end if;
 return new;
end $$;
revoke all on function public.phase5a_guard_driver_link() from public,anon,authenticated,service_role;
create trigger phase5a_driver_link_guard before update on public.driver_accounts for each row execute function public.phase5a_guard_driver_link();

create function public.phase5a_record_driver_link() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=nullif(current_setting('moovu.phase5a_link_actor',true),'')::uuid;
begin
 if tg_op='UPDATE' and old.driver_id is not distinct from new.driver_id then return null;end if;
 insert into public.phase5a_driver_link_audit(user_id,previous_driver_id,resulting_driver_id,actor_id,operation_key,command,reason,source)
 values(case when tg_op='DELETE' then old.user_id else new.user_id end,
  case when tg_op='INSERT' then null else old.driver_id end,
  case when tg_op='DELETE' then null else new.driver_id end,v_actor,
  case when v_actor is null then null else nullif(current_setting('moovu.phase5a_link_key',true),'')::uuid end,
  case when v_actor is null then null else nullif(current_setting('moovu.phase5a_link_command',true),'')::jsonb end,
  coalesce(nullif(current_setting('moovu.phase5a_link_reason',true),''),'Existing authorized account lifecycle: '||tg_op),
  case when v_actor is null then 'SYSTEM' else 'ADMIN' end);
 return null;
end $$;
revoke all on function public.phase5a_record_driver_link() from public,anon,authenticated,service_role;
create trigger phase5a_driver_link_audit after insert or update or delete on public.driver_accounts for each row execute function public.phase5a_record_driver_link();

create function public.phase5a_manage_driver_link(p_actor uuid,p_user uuid,p_driver uuid,p_action text,p_reason text,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.drivers%rowtype; u auth.users%rowtype; current_driver uuid; previous public.phase5a_driver_link_audit%rowtype;
 payload jsonb:=jsonb_build_object('user',p_user,'driver',p_driver,'action',p_action,'reason',trim(p_reason));
begin
 perform 1 from public.profiles where id=p_actor for share;
 perform public.phase6_actor(p_actor,true);
 if p_user is null or p_driver is null or p_key is null or p_action is null or p_action not in ('link','unlink') or
  p_reason is null or length(trim(p_reason)) not between 8 and 2000 then raise exception 'Invalid linking command' using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended('phase5a-link-operation:'||p_actor::text||p_key::text,0));
 select * into previous from public.phase5a_driver_link_audit where actor_id=p_actor and operation_key=p_key;
 if found then
  if previous.command is distinct from payload then raise exception 'Operation key conflict' using errcode='P0001';end if;
  return jsonb_build_object('replayed',true,'audit_id',previous.id);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('phase5a-link-user:'||p_user::text,0));
 select * into u from auth.users where id=p_user for update;
 if not found then raise exception 'Auth identity unavailable' using errcode='P0001';end if;
 select * into d from public.drivers where id=p_driver for update;
 if not found or coalesce(d.is_deleted,false) then raise exception 'Driver unavailable' using errcode='P0001';end if;
 select driver_id into current_driver from public.driver_accounts where user_id=p_user for update;
 if p_action='link' then
  perform 1 from public.profiles where id=p_user for share;
  if u.deleted_at is not null or u.email_confirmed_at is null or u.email is null or d.email is null or
   lower(trim(u.email)) is distinct from lower(trim(d.email)) or
   not exists(select 1 from public.profiles where id=p_user and role='driver') or
   exists(select 1 from public.customers where auth_user_id=p_user) then
   raise exception 'Verified Driver account ownership required' using errcode='P0001';end if;
  if (current_driver is not null and current_driver<>p_driver) or
   exists(select 1 from public.driver_accounts where driver_id=p_driver and user_id<>p_user) or
   exists(select 1 from public.phase6_enrollments where (user_id=p_user and driver_id<>p_driver) or (driver_id=p_driver and user_id<>p_user)) then
   raise exception 'Existing ownership conflicts' using errcode='P0001';end if;
  if current_driver=p_driver then return jsonb_build_object('replayed',true);end if;
 else
  if current_driver is null then return jsonb_build_object('replayed',true);end if;
  if current_driver<>p_driver then raise exception 'Driver link changed; refresh first' using errcode='P0001';end if;
  if coalesce(d.online,false) or coalesce(d.busy,false) or exists(select 1 from public.trips where driver_id=p_driver and status not in ('completed','cancelled','expired','failed')) then
   raise exception 'End active work and go offline before unlinking' using errcode='P0001';end if;
 end if;
 perform set_config('moovu.phase5a_link_actor',p_actor::text,true);
 perform set_config('moovu.phase5a_link_key',p_key::text,true);
 perform set_config('moovu.phase5a_link_command',payload::text,true);
 perform set_config('moovu.phase5a_link_reason',trim(p_reason),true);
 if p_action='link' then
  insert into public.driver_accounts(user_id,driver_id) values(p_user,p_driver)
   on conflict(user_id) do update set driver_id=excluded.driver_id;
 else update public.driver_accounts set driver_id=null where user_id=p_user;end if;
 -- Only the trusted owner may call the retired contract, after the new ownership checks.
 -- Preserve its established business-event/outbox behavior without exposing its unsafe entry point.
 perform public.phase05b_manage_driver_link(null,p_user,p_driver,p_action,p_actor);
 perform set_config('moovu.phase5a_link_actor','',true);
 perform set_config('moovu.phase5a_link_key','',true);
 perform set_config('moovu.phase5a_link_command','',true);
 perform set_config('moovu.phase5a_link_reason','',true);
 return jsonb_build_object('replayed',false);
end $$;
revoke all on function public.phase5a_manage_driver_link(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.phase5a_manage_driver_link(uuid,uuid,uuid,text,text,uuid) to service_role;

-- Retired mutation routes must not retain a callable ownership bypass.
do $$ declare signature text; f regprocedure; begin
 foreach signature in array array['public.phase05b_manage_driver_link(uuid,uuid,uuid,text,uuid)',
  'public.phase05b_approve_driver_application(uuid,uuid)','public.phase05b_submit_driver_application(uuid,jsonb)'] loop
  f:=to_regprocedure(signature);
  if f is not null then execute format('revoke all on function %s from public,anon,authenticated,service_role',f);end if;
 end loop;
end $$;
commit;
