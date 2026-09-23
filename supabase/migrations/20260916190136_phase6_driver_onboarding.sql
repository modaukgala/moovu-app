-- Additive Phase 6 foundation. No historical application or financial backfill.
create table public.phase6_policy (
 singleton boolean primary key default true check(singleton),
 active boolean not null default false,
 existing_effective_before timestamptz not null default now(),
 deadline timestamptz not null default '2026-11-30T22:00:00Z',
 new_work_effective_from timestamptz not null default '2026-11-30T22:00:00Z',
 pdp_operating_rule text not null default 'UNCONFIRMED' check(pdp_operating_rule in ('UNCONFIRMED','REQUIRED')),
 automatic_deletion_enabled boolean not null default false check(not automatic_deletion_enabled),
 checklist_version integer not null default 1 check(checklist_version=1)
);
insert into public.phase6_policy(singleton) values(true);
create table public.phase6_enrollments (
 driver_id uuid primary key references public.drivers(id) on delete restrict,
 user_id uuid not null unique references auth.users(id) on delete restrict,
 existing_driver boolean not null,
 created_at timestamptz not null default now(),
 completed_at timestamptz
);
create table public.phase6_applications (
 id uuid primary key default gen_random_uuid(),
 driver_id uuid not null references public.phase6_enrollments(driver_id) on delete restrict,
 cycle integer not null check(cycle>0),
 status text not null default 'DRAFT' check(status in ('DRAFT','SUBMITTED','UNDER_REVIEW','CORRECTION_REQUESTED','RESUBMITTED','APPROVED','REJECTED')),
 revision integer not null default 0,
 draft jsonb not null default '{}',
 correction_sections text[] not null default '{}',
 version integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(driver_id,cycle)
);
create unique index phase6_one_current_cycle on public.phase6_applications(driver_id) where status<>'REJECTED';
create table public.phase6_versions (
 application_id uuid not null references public.phase6_applications(id) on delete restrict,
 version integer not null,
 snapshot jsonb not null,
 submitted_at timestamptz not null default now(),
 primary key(application_id,version)
);
create table public.phase6_uploads (
 id uuid primary key default gen_random_uuid(),
 application_id uuid not null references public.phase6_applications(id) on delete restrict,
 section text not null check(section in ('personal','driving','vehicle','scanner')),
 object_path text not null unique,
 source text not null check(source in ('camera','gallery','file','unknown')),
 state text not null default 'PENDING' check(state in ('PENDING','VALIDATED','FAILED','SUPERSEDED')),
 digest text,
 mime text,
 bytes integer check(bytes>0 and bytes<=8388608),
 width integer,
 height integer,
 created_at timestamptz not null default now(),
 finalized_at timestamptz,
 retention_class text not null default 'ONBOARDING_EVIDENCE',
 legal_hold boolean not null default false
);
create table public.phase6_inspections (
 application_id uuid primary key references public.phase6_applications(id) on delete restrict,
 checklist_version integer not null default 1,
 provider text,
 created_at timestamptz not null default now()
);
create table public.phase6_reviews (
 id uuid primary key default gen_random_uuid(),
 application_id uuid not null references public.phase6_applications(id) on delete restrict,
 source_version integer not null,
 actor_id uuid not null references auth.users(id) on delete restrict,
 action text not null check(action in ('UNDER_REVIEW','APPROVED','REJECTED','CORRECTION_REQUESTED','REAPPLICATION_AUTHORIZED')),
 reason text not null check(length(reason) between 8 and 2000),
 sections text[] not null default '{}',
 created_at timestamptz not null default now(),
 unique(application_id,source_version,action)
);
create table public.phase6_vehicle_assignments (
 registration text primary key,
 driver_id uuid not null references public.drivers(id) on delete restrict,
 application_id uuid not null references public.phase6_applications(id) on delete restrict,
 updated_at timestamptz not null default now()
);
create table public.phase6_operations (
 actor_id uuid not null,
 operation_key uuid not null,
 payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(actor_id,operation_key)
);
create function public.phase6_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Immutable onboarding history' using errcode='P0001';end $$;
create trigger phase6_versions_immutable before update or delete on public.phase6_versions for each row execute function public.phase6_immutable();
create trigger phase6_reviews_immutable before update or delete on public.phase6_reviews for each row execute function public.phase6_immutable();
create function public.phase6_freeze_upload() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.phase6_versions v where v.application_id=old.application_id and v.snapshot->'evidence' @> jsonb_build_object(old.id::text,true)) then
  raise exception 'Submitted evidence is immutable' using errcode='P0001';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger phase6_upload_freeze before update or delete on public.phase6_uploads for each row execute function public.phase6_freeze_upload();

-- Sensitive metadata stays server-mediated, including legacy rows.
revoke insert,update,delete,truncate,trigger,references on public.drivers,public.driver_profiles,public.driver_documents from public,anon,authenticated;
grant update(lat,lng,last_seen) on public.drivers to authenticated;
revoke insert,update,delete,truncate,trigger,references on public.profiles,public.driver_profile_corrections from public,anon,authenticated;
do $$ declare r record;begin
 for r in select policyname from pg_policies where schemaname='storage' and tablename='objects' and
 (coalesce(qual,'')||coalesce(with_check,'')) ~ '(driver-documents|vehicle-photos)' loop
  execute format('drop policy %I on storage.objects',r.policyname);
 end loop;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('phase6-evidence','phase6-evidence',false,8388608,array['image/jpeg','image/png','image/webp'])
 on conflict(id) do update set public=false,file_size_limit=8388608,allowed_mime_types=excluded.allowed_mime_types;

create function public.phase6_actor(p_actor uuid,p_admin boolean default false) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare d uuid;r text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Trusted server required' using errcode='P0001';end if;
 if not exists(select 1 from auth.users where id=p_actor and deleted_at is null) then raise exception 'Invalid actor' using errcode='P0001';end if;
 select role into r from public.profiles where id=p_actor;
 if p_admin then
  if r is null or r not in ('owner','admin') then raise exception 'Reviewer not authorized' using errcode='P0001';end if;
  return null;
 end if;
 if r is not null and r<>'driver' then raise exception 'Driver role conflicts with enrollment' using errcode='P0001';end if;
 select driver_id into d from public.driver_accounts where user_id=p_actor;
 if d is null or not exists(select 1 from public.phase6_enrollments e join public.drivers dr on dr.id=e.driver_id where e.user_id=p_actor and e.driver_id=d and not coalesce(dr.is_deleted,false)) then
  raise exception 'Driver enrollment required' using errcode='P0001';
 end if;
 return d;
end $$;

create function public.phase6_command(p_actor uuid,p_key uuid,p_action text,p_application uuid default null,p_revision integer default null,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d uuid;a public.phase6_applications%rowtype;op public.phase6_operations%rowtype;res jsonb;doc uuid;item text;section text;v_registration text;v_role text;n integer;u public.phase6_uploads%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' or p_key is null then raise exception 'Trusted operation required' using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text,6));
 select * into op from public.phase6_operations where actor_id=p_actor and operation_key=p_key;
 if found then
  if op.payload<>jsonb_build_object('action',p_action,'application',p_application,'revision',p_revision,'payload',p_payload) then raise exception 'Idempotency conflict' using errcode='P0001';end if;
  return op.result;
 end if;
 if p_action='ENROLL' then
  if not exists(select 1 from auth.users where id=p_actor and deleted_at is null) then raise exception 'Invalid actor' using errcode='P0001';end if;
  if exists(select 1 from public.profiles where id=p_actor and role<>'driver') then raise exception 'Driver enrollment not authorized' using errcode='P0001';end if;
  select driver_id into d from public.driver_accounts where user_id=p_actor;
  if d is null then
   if exists(select 1 from public.customers where auth_user_id=p_actor) or exists(select 1 from public.profiles where id=p_actor and role<>'driver') then raise exception 'Driver enrollment not authorized' using errcode='P0001';end if;
   if exists(select 1 from public.drivers where lower(email)=lower((select email from auth.users where id=p_actor))) then raise exception 'Existing identity requires ownership review' using errcode='P0001';end if;
   insert into public.drivers(first_name,last_name,phone,email,status,verification_status,profile_completed,online,busy,is_deleted)
    values('Pending','Driver','',(select email from auth.users where id=p_actor),'pending','pending_review',false,false,false,false) returning id into d;
   insert into public.driver_accounts(user_id,driver_id) values(p_actor,d);
   insert into public.phase6_enrollments(driver_id,user_id,existing_driver) values(d,p_actor,false);
  else
   if exists(select 1 from public.drivers where id=d and coalesce(is_deleted,false)) then raise exception 'Identity requires review' using errcode='P0001';end if;
   insert into public.phase6_enrollments(driver_id,user_id,existing_driver) values(d,p_actor,true) on conflict(driver_id) do nothing;
  end if;
  select * into a from public.phase6_applications where driver_id=d and status<>'REJECTED' order by cycle desc limit 1 for update;
  if not found then
   if exists(select 1 from public.phase6_applications where driver_id=d and status='REJECTED') then raise exception 'Reapplication authorization required' using errcode='P0001';end if;
   insert into public.phase6_applications(driver_id,cycle) values(d,1) returning * into a;
   insert into public.phase6_inspections(application_id) values(a.id);
  end if;
 else
  if p_action in ('UNDER_REVIEW','APPROVED','REJECTED','CORRECTION_REQUESTED','REAPPLICATION_AUTHORIZED') then perform public.phase6_actor(p_actor,true);
  else d:=public.phase6_actor(p_actor,false);end if;
  select * into a from public.phase6_applications where id=p_application for update;
  if not found or (d is not null and a.driver_id<>d) then raise exception 'Application unavailable' using errcode='P0001';end if;
  if a.revision is distinct from p_revision then raise exception 'Revision conflict' using errcode='P0001';end if;
  if p_action='SAVE' then
   if a.status not in ('DRAFT','CORRECTION_REQUESTED') then raise exception 'Submitted application is frozen' using errcode='P0001';end if;
   if jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536 then raise exception 'Invalid draft' using errcode='P0001';end if;
   for section in select jsonb_object_keys(p_payload) loop
    if section not in ('personal','driving','vehicle','scanner') or (a.status='CORRECTION_REQUESTED' and not section=any(a.correction_sections)) then raise exception 'Section is not correctable' using errcode='P0001';end if;
   end loop;
   update public.phase6_applications set draft=draft||p_payload,revision=revision+1,updated_at=now() where id=a.id returning * into a;
  elsif p_action='SUBMIT' then
   if a.status not in ('DRAFT','CORRECTION_REQUESTED') then raise exception 'Invalid submission state' using errcode='P0001';end if;
   foreach section in array array['personal','driving','vehicle','scanner'] loop
    if coalesce(jsonb_typeof(a.draft->section),'null')<>'object' then raise exception 'Required section missing' using errcode='P0001';end if;
   end loop;
   for item in select unnest(array['first_name','last_name','phone','id_number','home_address','area_name','emergency_contact_name','emergency_contact_phone']) loop
    if nullif(trim(a.draft->'personal'->>item),'') is null then raise exception 'Personal requirements missing' using errcode='P0001';end if;
   end loop;
   if (a.draft->'personal'->>'id_number') !~ '^[0-9]{13}$' or (a.draft->'personal'->>'phone') !~ '^0[6-8][0-9]{8}$' then raise exception 'Invalid identity or phone' using errcode='P0001';end if;
   if nullif(a.draft->'driving'->>'license_number','') is null or nullif(a.draft->'driving'->>'license_code','') is null or coalesce((a.draft->'driving'->>'license_expiry')::date,current_date)<=current_date then raise exception 'Valid licence required' using errcode='P0001';end if;
   for item in select unnest(array['vehicle_make','vehicle_model','vehicle_color','vehicle_registration','vehicle_vin','vehicle_engine_number']) loop
    if nullif(trim(a.draft->'vehicle'->>item),'') is null then raise exception 'Vehicle requirements missing' using errcode='P0001';end if;
   end loop;
   if coalesce(a.draft->'vehicle'->>'vehicle_year','') !~ '^[0-9]{4}$' or coalesce(a.draft->'vehicle'->>'seating_capacity','') !~ '^[3-7]$' then raise exception 'Vehicle capacity/year required' using errcode='P0001';end if;
   if (a.draft->'vehicle'->>'vehicle_year')::integer not between 1995 and extract(year from now())::integer+1 then raise exception 'Invalid vehicle year' using errcode='P0001';end if;
   res:='{}';
   foreach item in array array['id_document','drivers_license','vehicle_license_disc','front','rear','driver_side','passenger_side','front_interior','rear_interior','odometer','vin','engine'] loop
    section:=case when item='id_document' then 'personal' when item='drivers_license' then 'driving' when item='vehicle_license_disc' then 'vehicle' else 'scanner' end;
    doc:=(a.draft->section->'evidence'->>item)::uuid;
    select * into u from public.phase6_uploads where id=doc and application_id=a.id and state='VALIDATED' and phase6_uploads.section=case when item='id_document' then 'personal' when item='drivers_license' then 'driving' when item='vehicle_license_disc' then 'vehicle' else 'scanner' end;
    if not found then raise exception 'Validated required evidence missing' using errcode='P0001';end if;
    res:=res||jsonb_build_object(doc::text,true);
   end loop;
   -- Optional PDP/insurance are frozen too when referenced.
   for section in select unnest(array['driving','vehicle']) loop
    for item in select jsonb_object_keys(coalesce(a.draft->section->'evidence','{}')) loop
     doc:=(a.draft->section->'evidence'->>item)::uuid;
     if not exists(select 1 from public.phase6_uploads where id=doc and application_id=a.id and state='VALIDATED') then raise exception 'Invalid optional evidence' using errcode='P0001';end if;
     res:=res||jsonb_build_object(doc::text,true);
    end loop;
   end loop;
   insert into public.phase6_versions(application_id,version,snapshot) values(a.id,a.version+1,jsonb_build_object('draft',a.draft,'evidence',res,'checklist_version',1));
   update public.phase6_applications set status=case when version=0 then 'SUBMITTED' else 'RESUBMITTED' end,version=version+1,revision=revision+1,updated_at=now() where id=a.id returning * into a;
  elsif p_action='REAPPLICATION_AUTHORIZED' then
   if a.status<>'REJECTED' then raise exception 'Only rejected applications may reapply' using errcode='P0001';end if;
   insert into public.phase6_reviews(application_id,source_version,actor_id,action,reason) values(a.id,a.version,p_actor,p_action,p_payload->>'reason');
   insert into public.phase6_applications(driver_id,cycle) values(a.driver_id,a.cycle+1) returning * into a;
   insert into public.phase6_inspections(application_id) values(a.id);
  else
   if p_action='UNDER_REVIEW' and a.status not in ('SUBMITTED','RESUBMITTED') then raise exception 'Review state conflict' using errcode='P0001';end if;
   if p_action in ('APPROVED','REJECTED','CORRECTION_REQUESTED') and a.status<>'UNDER_REVIEW' then raise exception 'Review required' using errcode='P0001';end if;
   if p_action not in ('UNDER_REVIEW','APPROVED','REJECTED','CORRECTION_REQUESTED') then raise exception 'Unknown action' using errcode='P0001';end if;
   if p_action='CORRECTION_REQUESTED' then
    if jsonb_array_length(coalesce(p_payload->'sections','[]'))=0 then raise exception 'Correction scope required' using errcode='P0001';end if;
    for section in select jsonb_array_elements_text(p_payload->'sections') loop
     if section not in ('personal','driving','vehicle','scanner') then raise exception 'Invalid correction scope' using errcode='P0001';end if;
    end loop;
   end if;
   if p_action='APPROVED' then
    perform set_config('moovu.phase6_review_application',a.id::text,true);
    v_registration:=upper(regexp_replace(a.draft->'vehicle'->>'vehicle_registration','[ -]','','g'));
    perform pg_advisory_xact_lock(hashtextextended(v_registration,6));
    if exists(select 1 from public.phase6_vehicle_assignments va where va.registration=v_registration and va.driver_id<>a.driver_id) or exists(select 1 from public.drivers dr where dr.id<>a.driver_id and dr.status in ('approved','active') and upper(regexp_replace(dr.vehicle_registration,'[ -]','','g'))=v_registration) then raise exception 'Vehicle conflict requires review' using errcode='P0001';end if;
    delete from public.phase6_vehicle_assignments where driver_id=a.driver_id;
    insert into public.phase6_vehicle_assignments(registration,driver_id,application_id) values(v_registration,a.driver_id,a.id);
    update public.phase6_enrollments set completed_at=now() where driver_id=a.driver_id;
    update public.drivers set status='approved',verification_status='approved',profile_completed=true,
     first_name=a.draft->'personal'->>'first_name',last_name=a.draft->'personal'->>'last_name',phone=a.draft->'personal'->>'phone',
     vehicle_make=a.draft->'vehicle'->>'vehicle_make',vehicle_model=a.draft->'vehicle'->>'vehicle_model',vehicle_registration=a.draft->'vehicle'->>'vehicle_registration',vehicle_color=a.draft->'vehicle'->>'vehicle_color',vehicle_year=a.draft->'vehicle'->>'vehicle_year',vehicle_vin=a.draft->'vehicle'->>'vehicle_vin',vehicle_engine_number=a.draft->'vehicle'->>'vehicle_engine_number',seating_capacity=(a.draft->'vehicle'->>'seating_capacity')::integer where id=a.driver_id;
   end if;
   insert into public.phase6_reviews(application_id,source_version,actor_id,action,reason,sections)
    values(a.id,a.version,p_actor,p_action,p_payload->>'reason',array(select jsonb_array_elements_text(coalesce(p_payload->'sections','[]'))));
   update public.phase6_applications set status=p_action,correction_sections=array(select jsonb_array_elements_text(coalesce(p_payload->'sections','[]'))),revision=revision+1,updated_at=now() where id=a.id returning * into a;
  end if;
 end if;
 res:=to_jsonb(a);
 insert into public.phase6_operations(actor_id,operation_key,payload,result) values(p_actor,p_key,jsonb_build_object('action',p_action,'application',p_application,'revision',p_revision,'payload',p_payload),res);
 return res;
end $$;

create function public.phase6_new_work_eligible(p_driver uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when not p.active then true
  when exists(select 1 from public.phase6_enrollments e where e.driver_id=p_driver and e.completed_at is not null) then true
  when now()<p.new_work_effective_from and exists(select 1 from public.drivers d where d.id=p_driver and d.created_at<p.existing_effective_before and d.status in ('approved','active')) then true
  else false end from public.phase6_policy p where singleton;
$$;
-- Service-mediated legacy forms must not bypass versioned approval after activation.
create function public.phase6_legacy_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare driver_uuid uuid; authorized boolean; protected_change boolean;
begin
 if not exists(select 1 from public.phase6_policy where singleton and active) then return case when tg_op='DELETE' then old else new end;end if;
 driver_uuid:=(to_jsonb(old)->>case when tg_table_name='drivers' then 'id' else 'driver_id' end)::uuid;
 authorized:=exists(select 1 from public.phase6_applications a where a.driver_id=driver_uuid and a.id::text=current_setting('moovu.phase6_review_application',true) and a.status='UNDER_REVIEW');
 if authorized then return new;end if;
 if tg_op='DELETE' then raise exception 'Use the controlled retention workflow' using errcode='P0001';end if;
 if tg_table_name='drivers' then
  protected_change:=(to_jsonb(new)-array['lat','lng','last_seen','online','busy','updated_at','subscription_status','subscription_plan','subscription_expires_at','subscription_amount_due','subscription_last_paid_at','subscription_last_payment_amount']) is distinct from (to_jsonb(old)-array['lat','lng','last_seen','online','busy','updated_at','subscription_status','subscription_plan','subscription_expires_at','subscription_amount_due','subscription_last_paid_at','subscription_last_payment_amount']);
 else protected_change:=to_jsonb(new) is distinct from to_jsonb(old);end if;
 if protected_change then raise exception 'Use versioned onboarding review' using errcode='P0001';end if;
 return new;
end $$;
create trigger phase6_driver_legacy_guard before update or delete on public.drivers for each row execute function public.phase6_legacy_guard();
create trigger phase6_profile_legacy_guard before update or delete on public.driver_profiles for each row execute function public.phase6_legacy_guard();

create function public.phase6_storage_freeze() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.bucket_id='phase6-evidence' and exists(select 1 from public.phase6_uploads u join public.phase6_versions v on v.application_id=u.application_id where u.object_path=old.name and v.snapshot->'evidence' @> jsonb_build_object(u.id::text,true)) then
  raise exception 'Submitted evidence is immutable' using errcode='P0001';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger phase6_storage_freeze before update or delete on storage.objects for each row execute function public.phase6_storage_freeze();
create function public.phase6_assignment_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.driver_id is null then return new;end if;
 if tg_table_name='driver_trip_offers' then
  if new.status not in ('pending','shown') then return new;end if;
 else
  if new.status<>'assigned' then return new;end if;
  if tg_op='UPDATE' and old.status='assigned' and old.driver_id=new.driver_id then return new;end if;
 end if;
 if not coalesce(public.phase6_new_work_eligible(new.driver_id),false) then raise exception 'Driver onboarding required for new work' using errcode='P0001';end if;
 return new;
end $$;
create trigger phase6_trip_assignment_guard before insert or update of driver_id,status on public.trips for each row execute function public.phase6_assignment_guard();
create trigger phase6_offer_assignment_guard before insert or update of driver_id,status on public.driver_trip_offers for each row execute function public.phase6_assignment_guard();
do $$ declare t text;f record;begin
 foreach t in array array['phase6_policy','phase6_enrollments','phase6_applications','phase6_versions','phase6_uploads','phase6_inspections','phase6_reviews','phase6_vehicle_assignments','phase6_operations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'phase6_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
