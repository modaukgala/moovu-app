-- MOOVU Phase 0.5B - atomic applicant linkage, manual assignment and outbox claims
-- REVIEW ONLY / NOT APPLIED. Requires 001 and 002. No Auth user creation occurs here.
begin;

do $$ begin
  if exists(select 1 from public.driver_accounts group by user_id having count(*)>1) then
    raise exception 'Duplicate driver account user links require ownership review'; end if;
  if exists(select 1 from public.driver_applications group by user_id having count(*)>1) then
    raise exception 'Duplicate driver applications require ownership review'; end if;
end $$;
create unique index if not exists driver_accounts_user_phase05b_uidx on public.driver_accounts(user_id);
create unique index if not exists driver_applications_user_phase05b_uidx on public.driver_applications(user_id);

-- Ownership links are established only by the trusted RPCs below. Existing
-- links remain unchanged and authenticated users retain own-link SELECT access.
drop policy if exists driver_accounts_insert_own on public.driver_accounts;
revoke insert,update,delete,truncate on public.driver_accounts from anon,authenticated;
revoke insert,update,delete,truncate on public.driver_applications from anon,authenticated;

create or replace function public.phase05b_submit_driver_application(p_user_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare a public.driver_accounts%rowtype; d public.drivers%rowtype; v_driver uuid; v_app uuid; v_event uuid;
        v_email text:=lower(trim(p_payload->>'email')); v_phone text:=nullif(trim(p_payload->>'phone'),'');
        v_first text:=coalesce(nullif(trim(p_payload->>'first_name'),''),'Unnamed');
        v_last text:=coalesce(nullif(trim(p_payload->>'last_name'),''),'Driver');
begin
  if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Authenticated user missing' using errcode='P0001';end if;
  perform pg_advisory_xact_lock(hashtextextended('driver-applicant:'||p_user_id::text,0));
  select * into a from public.driver_accounts where user_id=p_user_id for update;
  if a.driver_id is not null then
    select * into d from public.drivers where id=a.driver_id for update;
    if not found or coalesce(d.is_deleted,false) then raise exception 'Applicant ownership requires review' using errcode='P0001';end if;
    v_driver:=d.id;
  else
    if exists(select 1 from public.drivers where lower(email)=v_email) or
       (v_phone is not null and exists(select 1 from public.drivers where phone=v_phone)) then
      raise exception 'Matching legacy applicant requires ownership review' using errcode='P0001';
    end if;
    insert into public.drivers(first_name,last_name,phone,email,status,verification_status,profile_completed,online,busy,is_deleted,
      vehicle_make,vehicle_model,vehicle_year,vehicle_color,vehicle_registration,vehicle_vin,vehicle_engine_number,seating_capacity)
    values(v_first,v_last,v_phone,v_email,'pending','pending_review',false,false,false,false,
      nullif(p_payload->>'vehicle_make',''),nullif(p_payload->>'vehicle_model',''),nullif(p_payload->>'vehicle_year',''),
      nullif(p_payload->>'vehicle_color',''),nullif(p_payload->>'vehicle_registration',''),nullif(p_payload->>'vehicle_vin',''),
      nullif(p_payload->>'vehicle_engine_number',''),nullif(p_payload->>'seating_capacity','')::integer)
    returning id into v_driver;
    insert into public.driver_accounts(user_id,driver_id) values(p_user_id,v_driver);
  end if;
  if coalesce(d.verification_status,'')<>'approved' then
    update public.drivers set first_name=v_first,last_name=v_last,phone=v_phone,email=v_email,
      vehicle_make=nullif(p_payload->>'vehicle_make',''),vehicle_model=nullif(p_payload->>'vehicle_model',''),
      vehicle_year=nullif(p_payload->>'vehicle_year',''),vehicle_color=nullif(p_payload->>'vehicle_color',''),
      vehicle_registration=nullif(p_payload->>'vehicle_registration',''),vehicle_vin=nullif(p_payload->>'vehicle_vin',''),
      vehicle_engine_number=nullif(p_payload->>'vehicle_engine_number',''),
      seating_capacity=nullif(p_payload->>'seating_capacity','')::integer where id=v_driver;
  end if;
  insert into public.driver_profiles(driver_id,first_name,last_name,phone,id_number,home_address,area_name,
    emergency_contact_name,emergency_contact_phone,updated_at)
  values(v_driver,v_first,v_last,v_phone,nullif(p_payload->>'id_number',''),nullif(p_payload->>'home_address',''),
    nullif(p_payload->>'area_name',''),nullif(p_payload->>'emergency_name',''),nullif(p_payload->>'emergency_phone',''),now())
  on conflict(driver_id) do update set first_name=excluded.first_name,last_name=excluded.last_name,phone=excluded.phone,
    id_number=excluded.id_number,home_address=excluded.home_address,area_name=excluded.area_name,
    emergency_contact_name=excluded.emergency_contact_name,emergency_contact_phone=excluded.emergency_contact_phone,updated_at=now();
  insert into public.driver_applications(user_id,full_name,phone,email,notes,status)
  values(p_user_id,trim(v_first||' '||v_last),v_phone,v_email,nullif(p_payload->>'notes',''),'pending')
  on conflict(user_id) do update set full_name=excluded.full_name,phone=excluded.phone,email=excluded.email,notes=excluded.notes,
    status=case when public.driver_applications.status in ('approved','rejected') then public.driver_applications.status else 'pending' end
  returning id into v_app;
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
  values('driver-application:'||p_user_id::text,'driver_application_submitted','driver',v_driver,p_user_id,
    jsonb_build_object('application_id',v_app,'driver_id',v_driver))
  on conflict(event_key) do update set payload=excluded.payload returning id into v_event;
  insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
    values(v_event,'driver_application_submitted',jsonb_build_object('application_id',v_app,'driver_id',v_driver))
    on conflict(business_event_id) do nothing;
  return jsonb_build_object('contract_version',public.phase05b_contract_version(),'driver_id',v_driver,
    'application_id',v_app,'replayed',a.driver_id is not null);
end $$;

-- Hard manual assignment. It does not change candidate ranking or dispatch timing.
create or replace function public.phase05b_assign_driver(p_trip_id uuid,p_driver_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare t public.trips%rowtype;d public.drivers%rowtype;v_role text;v_due numeric;v_event uuid;
begin
  select role into v_role from public.profiles where id=p_actor_id;
  if v_role not in ('owner','admin','dispatcher','support') then raise exception 'Manual assignment not authorized' using errcode='P0001';end if;
  -- Consistent order: trip, then driver. Existing dispatch functions must be reviewed to match before activation.
  select * into t from public.trips where id=p_trip_id for update;
  if not found or t.status not in ('requested','offered') or t.driver_id is not null then raise exception 'Trip is not assignable' using errcode='P0001';end if;
  select * into d from public.drivers where id=p_driver_id for update;
  if not found or coalesce(d.is_deleted,false) or coalesce(d.busy,false) or not coalesce(d.online,false)
     or d.status not in ('approved','active') or coalesce(d.verification_status,'')<>'approved'
     or not coalesce(d.profile_completed,false) then raise exception 'Driver is not hard-eligible' using errcode='P0001';end if;
  if d.subscription_expires_at is null or d.subscription_expires_at<now() or coalesce(d.subscription_status,'')<>'active' then
    raise exception 'Driver subscription is not active' using errcode='P0001';end if;
  select coalesce((public.phase05b_driver_debt(d.id)->>'balance_due')::numeric,0) into v_due;
  if v_due>=100 then raise exception 'Driver commission restriction is active' using errcode='P0001';end if;
  if exists(select 1 from public.trips where driver_id=d.id and status in ('assigned','arrived','ongoing') and id<>t.id) then
    raise exception 'Driver already has an active trip' using errcode='P0001';end if;
  -- Production records assignment/acceptance through status plus trip_events;
  -- accepted_at/assigned_at columns do not exist and are intentionally not added.
  update public.trips set driver_id=d.id,status='assigned',offer_status='accepted' where id=t.id;
  update public.drivers set busy=true where id=d.id;
  insert into public.trip_events(trip_id,event_type,message,old_status,new_status,created_by)
    values(t.id,'assignment','Manually assigned eligible driver '||d.id,t.status,'assigned',p_actor_id);
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
    values('trip-assigned:'||t.id::text,'trip_assigned','trip',t.id,p_actor_id,jsonb_build_object('driver_id',d.id,'source','admin_manual'))
    returning id into v_event;
  insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
    values(v_event,'trip_assigned',jsonb_build_object('trip_id',t.id,'driver_id',d.id));
  return jsonb_build_object('contract_version',public.phase05b_contract_version(),'trip_id',t.id,'driver_id',d.id,'replayed',false);
end $$;

create or replace function public.phase05b_claim_outbox(p_limit integer default 20)
returns setof public.moovu_notification_outbox language plpgsql security definer set search_path=public,pg_temp
as $$ begin
  return query with due as (select id from public.moovu_notification_outbox
    where attempts<8 and (
      (status in ('pending','failed') and next_attempt_at<=now())
      or (status='processing' and locked_at<=now()-interval '5 minutes')
    ) order by created_at for update skip locked limit greatest(1,least(100,p_limit)))
  update public.moovu_notification_outbox o set status='processing',attempts=attempts+1,locked_at=now(),updated_at=now()
    from due where o.id=due.id returning o.*;
end $$;
create or replace function public.phase05b_finish_outbox(p_id uuid,p_delivered boolean,p_error text default null)
returns void language plpgsql security definer set search_path=public,pg_temp
as $$ begin
 update public.moovu_notification_outbox set status=case when p_delivered then 'delivered' else 'failed' end,
   delivered_at=case when p_delivered then now() else delivered_at end,last_error=case when p_delivered then null else left(p_error,500) end,
   next_attempt_at=case when p_delivered then next_attempt_at else now()+make_interval(secs=>least(3600,30*greatest(1,attempts))) end,
   locked_at=null,updated_at=now() where id=p_id;
end $$;

create or replace function public.phase05b_approve_driver_application(p_application_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.driver_applications%rowtype;v_driver uuid;v_role text;v_event uuid;v_key text:='driver-application-approved:'||p_application_id::text;
begin
 select role into v_role from public.profiles where id=p_actor_id;
 if v_role not in ('owner','admin','dispatcher','support') then raise exception 'Application approval not authorized' using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended('application:'||p_application_id::text,0));
 select * into a from public.driver_applications where id=p_application_id for update;
 if not found or a.user_id is null then raise exception 'Owned application not found' using errcode='P0001';end if;
 select driver_id into v_driver from public.driver_accounts where user_id=a.user_id for update;
 if v_driver is null then
  insert into public.drivers(first_name,last_name,phone,email,status,online,busy)
  values(split_part(coalesce(a.full_name,''),' ',1),nullif(substr(coalesce(a.full_name,''),length(split_part(coalesce(a.full_name,''),' ',1))+2),''),a.phone,a.email,'approved',false,false)
  returning id into v_driver;
  insert into public.driver_accounts(user_id,driver_id) values(a.user_id,v_driver);
 else update public.drivers set status='approved' where id=v_driver;end if;
 update public.driver_applications set status='approved' where id=a.id;
 insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
 values(v_key,'driver_application_approved','driver_application',a.id,p_actor_id,jsonb_build_object('application_id',a.id,'driver_id',v_driver))
 on conflict(event_key) do update set event_key=excluded.event_key returning id into v_event;
 insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
 values(v_event,'driver_application_approved',jsonb_build_object('application_id',a.id,'driver_id',v_driver)) on conflict(business_event_id) do nothing;
 return jsonb_build_object('contract_version',public.phase05b_contract_version(),'application_id',a.id,'driver_id',v_driver,'replayed',a.status='approved');
end $$;

create or replace function public.phase05b_manage_driver_link(p_application_id uuid,p_user_id uuid,p_driver_id uuid,p_action text,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.driver_applications%rowtype;v_role text;v_event uuid;v_key text;
begin
 select role into v_role from public.profiles where id=p_actor_id;
 if v_role not in ('owner','admin','dispatcher','support') then raise exception 'Driver linking not authorized' using errcode='P0001';end if;
 if p_action not in ('approve','reject','link','unlink') then raise exception 'Invalid link action' using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended('applicant:'||p_user_id::text,0));
 if p_application_id is not null then
  select * into a from public.driver_applications where id=p_application_id for update;
  if not found or a.user_id<>p_user_id then raise exception 'Application ownership mismatch' using errcode='P0001';end if;
 end if;
 if p_action='link' then
  if p_driver_id is null or not exists(select 1 from public.drivers where id=p_driver_id for update) then raise exception 'Driver not found' using errcode='P0001';end if;
  if exists(select 1 from public.driver_accounts where driver_id=p_driver_id and user_id<>p_user_id) then raise exception 'Driver belongs to another account' using errcode='P0001';end if;
  insert into public.driver_accounts(user_id,driver_id) values(p_user_id,p_driver_id)
   on conflict(user_id) do update set driver_id=excluded.driver_id;
  if p_application_id is not null then update public.driver_applications set status='approved' where id=p_application_id;end if;
 elsif p_action='unlink' then update public.driver_accounts set driver_id=null where user_id=p_user_id;
 elsif p_action='approve' then update public.driver_applications set status='approved' where id=p_application_id;
 else update public.driver_applications set status='rejected' where id=p_application_id;end if;
 v_key:='driver-link:'||p_user_id::text||':'||p_action||':'||coalesce(p_application_id::text,'none')||':'||coalesce(p_driver_id::text,'none');
 insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
 values(v_key,'driver_link_'||p_action,'auth_user',p_user_id,p_actor_id,jsonb_build_object('application_id',p_application_id,'driver_id',p_driver_id,'action',p_action))
 on conflict(event_key) do update set event_key=excluded.event_key returning id into v_event;
 insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
 values(v_event,'driver_link_'||p_action,jsonb_build_object('user_id',p_user_id,'driver_id',p_driver_id,'action',p_action)) on conflict(business_event_id) do nothing;
 return jsonb_build_object('contract_version',public.phase05b_contract_version(),'user_id',p_user_id,'driver_id',p_driver_id,'action',p_action,'replayed',false);
end $$;

revoke all on function public.phase05b_submit_driver_application(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.phase05b_assign_driver(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.phase05b_claim_outbox(integer) from public,anon,authenticated;
revoke all on function public.phase05b_finish_outbox(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.phase05b_submit_driver_application(uuid,jsonb) to service_role;
grant execute on function public.phase05b_assign_driver(uuid,uuid,uuid) to service_role;
grant execute on function public.phase05b_claim_outbox(integer) to service_role;
grant execute on function public.phase05b_finish_outbox(uuid,boolean,text) to service_role;
revoke all on function public.phase05b_approve_driver_application(uuid,uuid) from public,anon,authenticated;
grant execute on function public.phase05b_approve_driver_application(uuid,uuid) to service_role;
revoke all on function public.phase05b_manage_driver_link(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.phase05b_manage_driver_link(uuid,uuid,uuid,text,uuid) to service_role;

commit;

-- Existing-data risks: duplicate user/application links and schemas where
-- dispatch columns differ. Preflight must clear them; no automatic adoption or cleanup.
