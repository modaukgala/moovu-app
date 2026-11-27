-- Admin driver edits (names + car details) and real driver account deletion (27 Nov 2026).
-- Every change is written to an audit table first; the onboarding guard only lets through
-- an update that matches an audit row created in the same transaction for the same driver.

create table if not exists public.moovu_driver_admin_changes (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete restrict,
  actor_id uuid not null,
  kind text not null check (kind in ('EDIT', 'DELETE')),
  changes jsonb not null default '{}'::jsonb,
  reason text not null check (length(trim(reason)) between 3 and 2000),
  created_at timestamptz not null default now()
);
alter table public.moovu_driver_admin_changes enable row level security;

-- Let audited admin edits/deletions through the onboarding guard.
do $mig$
declare v_def text; v_anchor text; v_add text;
begin
  v_def := pg_get_functiondef('public.phase6_legacy_guard()'::regprocedure);
  v_anchor := ' driver_uuid:=(to_jsonb(old)->>case when tg_table_name=''drivers'' then ''id'' else ''driver_id'' end)::uuid;';
  v_add := v_anchor || E'\n if exists(select 1 from public.moovu_driver_admin_changes c where c.id::text=current_setting(''moovu.admin_driver_change'',true)\n   and c.driver_id=driver_uuid and c.created_at=transaction_timestamp()) then return case when tg_op=''DELETE'' then old else new end;end if;';
  if position(v_anchor in v_def) = 0 then raise exception 'guard anchor not found'; end if;
  if position('moovu.admin_driver_change' in v_def) = 0 then execute replace(v_def, v_anchor, v_add); end if;
end $mig$;

-- Edit a driver's names and car details. Sensitive identity/licence fields are NOT allowed here
-- (those go back to the driver as an onboarding correction).
create or replace function public.moovu_admin_edit_driver(p_actor uuid, p_driver uuid, p_changes jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_allowed text[] := array['first_name','last_name','vehicle_make','vehicle_model','vehicle_color','vehicle_registration','vehicle_year','seating_capacity'];
  v_key text; v_audit uuid; v_before jsonb; d public.drivers%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Trusted server role required'; end if;
  if not exists(select 1 from public.profiles where id = p_actor and role in ('owner','admin')) then raise exception 'ADMIN_REQUIRED'; end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if not v_key = any(v_allowed) then raise exception 'FIELD_NOT_EDITABLE:%', v_key; end if;
  end loop;
  select * into d from public.drivers where id = p_driver for update;
  if d.id is null or coalesce(d.is_deleted,false) then raise exception 'DRIVER_UNAVAILABLE'; end if;
  if coalesce(trim(p_changes->>'first_name'),'x') = '' or coalesce(trim(p_changes->>'last_name'),'x') = '' then raise exception 'NAME_REQUIRED'; end if;
  select jsonb_object_agg(k, to_jsonb(d)->k) into v_before from jsonb_object_keys(p_changes) k;
  insert into public.moovu_driver_admin_changes(driver_id, actor_id, kind, changes, reason)
  values (p_driver, p_actor, 'EDIT', jsonb_build_object('before', v_before, 'after', p_changes), coalesce(nullif(trim(p_reason),''),'Admin correction'))
  returning id into v_audit;
  perform set_config('moovu.admin_driver_change', v_audit::text, true);
  update public.drivers set
    first_name = coalesce(nullif(trim(p_changes->>'first_name'),''), first_name),
    last_name = coalesce(nullif(trim(p_changes->>'last_name'),''), last_name),
    vehicle_make = case when p_changes ? 'vehicle_make' then nullif(trim(p_changes->>'vehicle_make'),'') else vehicle_make end,
    vehicle_model = case when p_changes ? 'vehicle_model' then nullif(trim(p_changes->>'vehicle_model'),'') else vehicle_model end,
    vehicle_color = case when p_changes ? 'vehicle_color' then nullif(trim(p_changes->>'vehicle_color'),'') else vehicle_color end,
    vehicle_registration = case when p_changes ? 'vehicle_registration' then upper(nullif(trim(p_changes->>'vehicle_registration'),'')) else vehicle_registration end,
    vehicle_year = case when p_changes ? 'vehicle_year' then nullif(trim(p_changes->>'vehicle_year'),'') else vehicle_year end,
    seating_capacity = case when p_changes ? 'seating_capacity' then nullif(trim(p_changes->>'seating_capacity'),'')::int else seating_capacity end
  where id = p_driver;
  update public.driver_profiles set
    first_name = coalesce(nullif(trim(p_changes->>'first_name'),''), first_name),
    last_name = coalesce(nullif(trim(p_changes->>'last_name'),''), last_name)
  where driver_id = p_driver and (p_changes ? 'first_name' or p_changes ? 'last_name');
  perform set_config('moovu.admin_driver_change', '', true);
  return jsonb_build_object('ok', true, 'audit_id', v_audit);
end $function$;

-- Delete a driver account (driver's own request, or admin). Trips and money records are kept for the
-- books but carry no personal details. Returns the login ids so the server can delete them.
create or replace function public.moovu_delete_driver_account(p_actor uuid, p_driver uuid, p_reason text, p_by_driver boolean)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_audit uuid; v_users uuid[]; d public.drivers%rowtype;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Trusted server role required'; end if;
  if p_by_driver then
    if not exists(select 1 from public.driver_accounts where user_id = p_actor and driver_id = p_driver) then raise exception 'NOT_YOUR_ACCOUNT'; end if;
  elsif not exists(select 1 from public.profiles where id = p_actor and role in ('owner','admin')) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  select * into d from public.drivers where id = p_driver for update;
  if d.id is null then raise exception 'DRIVER_UNAVAILABLE'; end if;
  if coalesce(d.is_deleted,false) and d.delete_mode = 'permanent' then return jsonb_build_object('ok', true, 'user_ids', '[]'::jsonb, 'replayed', true); end if;
  if exists(select 1 from public.trips where driver_id = p_driver and status in ('assigned','arrived','ongoing')) then raise exception 'ACTIVE_TRIP'; end if;

  insert into public.moovu_driver_admin_changes(driver_id, actor_id, kind, reason)
  values (p_driver, p_actor, 'DELETE', coalesce(nullif(trim(p_reason),''), case when p_by_driver then 'Driver deleted their account' else 'Removed by admin' end))
  returning id into v_audit;
  perform set_config('moovu.admin_driver_change', v_audit::text, true);

  select coalesce(array_agg(user_id), '{}') into v_users from public.driver_accounts where driver_id = p_driver;
  delete from public.driver_accounts where driver_id = p_driver;

  update public.drivers set
    first_name = 'Deleted', last_name = 'Driver ' || left(p_driver::text, 8), phone = '', email = null, id_number = null,
    notes = null, online = false, busy = false, status = 'deleted', verification_status = 'deleted', lat = null, lng = null, last_seen = null,
    vehicle_vin = null, vehicle_engine_number = null,
    is_deleted = true, deleted_at = now(), delete_mode = 'permanent', deleted_reason = left(coalesce(p_reason,''), 500)
  where id = p_driver;

  update public.driver_profiles set
    first_name = null, last_name = null, phone = null, alt_phone = null, id_number = null, home_address = null,
    area_name = null, emergency_contact_name = null, emergency_contact_phone = null, license_number = null,
    license_code = null, license_expiry = null, pdp_number = null, pdp_expiry = null, profile_photo_url = null, deleted_at = now()
  where driver_id = p_driver;

  update public.phase6_retention_requests set status = 'COMPLETED', qualified_basis = 'Account deleted'
  where driver_id = p_driver and status in ('REQUESTED','HELD','AUTHORIZED');

  perform set_config('moovu.admin_driver_change', '', true);
  return jsonb_build_object('ok', true, 'user_ids', to_jsonb(v_users), 'audit_id', v_audit);
end $function$;

revoke all on function public.moovu_admin_edit_driver(uuid,uuid,jsonb,text) from public, anon, authenticated;
revoke all on function public.moovu_delete_driver_account(uuid,uuid,text,boolean) from public, anon, authenticated;
