-- Additive event/replacement/retention controls. No historical backfill or timed deletion.
-- Function definitions at the end also synchronize the initial disposable candidate.
alter table public.phase6_enrollments add column inspection_required boolean not null default false;
alter table public.phase6_inspections add column trigger_reason text;
alter table public.phase6_inspections add column scheduled_after timestamptz;
alter table public.phase6_uploads add column replaces_upload_id uuid references public.phase6_uploads(id) on delete restrict;
create table public.phase6_retention_requests (
 id uuid primary key default gen_random_uuid(),driver_id uuid not null references public.drivers(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 request_key uuid not null,reason text not null check(length(reason) between 8 and 2000),
 status text not null default 'REQUESTED' check(status in ('REQUESTED','HELD','AUTHORIZED','COMPLETED','DECLINED')),
 qualified_basis text,legal_hold boolean not null default false,
 created_at timestamptz not null default now(),unique(actor_id,request_key)
);
create table public.phase6_access_audit (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id) on delete restrict,
 application_id uuid not null references public.phase6_applications(id) on delete restrict,
 upload_id uuid references public.phase6_uploads(id) on delete restrict,
 action text not null check(action in ('VIEW_EVIDENCE','RETENTION_REQUEST','HOLD_EVIDENCE','RECONCILE_UPLOAD')),
 created_at timestamptz not null default now()
);
alter table public.phase6_retention_requests enable row level security;
alter table public.phase6_access_audit enable row level security;
revoke all on public.phase6_retention_requests,public.phase6_access_audit from public,anon,authenticated;
grant all on public.phase6_retention_requests,public.phase6_access_audit to service_role;
create trigger phase6_access_audit_immutable before update or delete on public.phase6_access_audit for each row execute function public.phase6_immutable();
alter table public.phase6_reviews drop constraint phase6_reviews_action_check;
alter table public.phase6_reviews add check(action in ('UNDER_REVIEW','APPROVED','REJECTED','CORRECTION_REQUESTED','REAPPLICATION_AUTHORIZED','REINSPECTION_AUTHORIZED'));
drop index public.phase6_one_current_cycle;
create unique index phase6_one_current_cycle on public.phase6_applications(driver_id) where status not in ('REJECTED','APPROVED');

create function public.phase6_reinspection(p_actor uuid,p_application uuid,p_revision integer,p_key uuid,p_reason text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.phase6_applications%rowtype;res jsonb;op public.phase6_operations%rowtype;payload jsonb;
begin
 perform public.phase6_actor(p_actor,true);
 payload:=jsonb_build_object('action','REINSPECTION_AUTHORIZED','application',p_application,'revision',p_revision,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text,6));
 select * into op from public.phase6_operations where actor_id=p_actor and operation_key=p_key;
 if found then if op.payload<>payload then raise exception 'Idempotency conflict' using errcode='P0001';end if;return op.result;end if;
 select * into a from public.phase6_applications where id=p_application for update;
 if not found or a.status<>'APPROVED' or a.revision is distinct from p_revision or length(trim(coalesce(p_reason,''))) not between 8 and 2000 then raise exception 'Reinspection authorization conflict' using errcode='P0001';end if;
 if exists(select 1 from public.phase6_applications where driver_id=a.driver_id and cycle>a.cycle) then raise exception 'A newer cycle exists' using errcode='P0001';end if;
 insert into public.phase6_reviews(application_id,source_version,actor_id,action,reason) values(a.id,a.version,p_actor,'REINSPECTION_AUTHORIZED',p_reason);
 update public.phase6_enrollments set inspection_required=true where driver_id=a.driver_id;
 insert into public.phase6_applications(driver_id,cycle,draft) values(a.driver_id,a.cycle+1,a.draft) returning * into a;
 insert into public.phase6_inspections(application_id,trigger_reason) values(a.id,p_reason);
 res:=to_jsonb(a);
 insert into public.phase6_operations(actor_id,operation_key,payload,result) values(p_actor,p_key,payload,res);
 return res;
end $$;
create or replace function public.phase6_new_work_eligible(p_driver uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when not p.active then true
  when exists(select 1 from public.phase6_enrollments e where e.driver_id=p_driver and e.inspection_required) then false
  when exists(select 1 from public.phase6_enrollments e where e.driver_id=p_driver and e.completed_at is not null) then true
  when now()<p.new_work_effective_from and exists(select 1 from public.drivers d where d.id=p_driver and d.created_at<p.existing_effective_before and d.status in ('approved','active')) then true
  else false end from public.phase6_policy p where singleton;
$$;
revoke all on function public.phase6_reinspection(uuid,uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.phase6_reinspection(uuid,uuid,integer,uuid,text) to service_role;
create function public.phase6_inspection_approved() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status='APPROVED' and old.status='UNDER_REVIEW' then
  update public.phase6_enrollments set inspection_required=false where driver_id=new.driver_id;
 end if;return new;
end $$;
create trigger phase6_inspection_approved after update of status on public.phase6_applications for each row execute function public.phase6_inspection_approved();
revoke all on function public.phase6_inspection_approved() from public,anon,authenticated;
do $$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('phase05b_submit_driver_application','phase05b_approve_driver_application') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end $$;
create or replace function public.phase6_actor(p_actor uuid,p_admin boolean default false) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
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

create or replace function public.phase6_command(p_actor uuid,p_key uuid,p_action text,p_application uuid default null,p_revision integer default null,p_payload jsonb default '{}') returns jsonb
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


