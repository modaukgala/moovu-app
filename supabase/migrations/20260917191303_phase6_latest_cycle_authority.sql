-- Latest cycle is authoritative; an older approval cannot reopen a rejected cycle.
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
  select * into a from public.phase6_applications where driver_id=d order by cycle desc limit 1 for update;
  if found and a.status='REJECTED' then raise exception 'Reapplication authorization required' using errcode='P0001';end if;
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


