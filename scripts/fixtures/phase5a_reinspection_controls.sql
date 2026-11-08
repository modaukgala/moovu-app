-- Phase 5A. No backfill: historical free-text authorizations remain Needs Review.
begin;
alter table public.phase6_applications drop constraint phase6_applications_status_check;
alter table public.phase6_applications add constraint phase6_applications_status_check
 check(status in ('DRAFT','SUBMITTED','UNDER_REVIEW','CORRECTION_REQUESTED','RESUBMITTED','APPROVED','REJECTED','CANCELLED'));
drop index public.phase6_one_current_cycle;
create unique index phase6_one_current_cycle on public.phase6_applications(driver_id)
 where status not in ('REJECTED','APPROVED','CANCELLED');

create table public.phase6_reinspection_authorizations (
 application_id uuid primary key references public.phase6_applications(id) on delete restrict,
 previous_application_id uuid not null references public.phase6_applications(id) on delete restrict,
 previous_version integer not null,
 actor_id uuid not null references auth.users(id) on delete restrict,
 reason_code text not null check(reason_code in ('OPTIONAL_ADMIN_REVIEW','DOCUMENT_EXPIRED','IDENTITY_REQUIRED','POLICY_REQUIRED','COMPLIANCE_REQUIRED','NEEDS_REVIEW')),
 reason text not null check(length(trim(reason)) between 8 and 2000),
 created_at timestamptz not null default now()
);
create table public.phase6_reinspection_cancellations (
 application_id uuid primary key references public.phase6_reinspection_authorizations(application_id) on delete restrict,
 driver_id uuid not null references public.drivers(id) on delete restrict,
 previous_application_id uuid not null references public.phase6_applications(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 operation_key uuid not null, reason text not null check(length(trim(reason)) between 8 and 2000),
 previous_status text not null, resulting_status text not null,
 eligibility jsonb not null, created_at timestamptz not null default now(), unique(actor_id,operation_key)
);
create index phase6_reinspection_cancellations_driver_created_idx on public.phase6_reinspection_cancellations(driver_id,created_at desc);
alter table public.phase6_reinspection_authorizations enable row level security;
alter table public.phase6_reinspection_cancellations enable row level security;
revoke all on public.phase6_reinspection_authorizations,public.phase6_reinspection_cancellations from public,anon,authenticated;
grant select,insert on public.phase6_reinspection_authorizations,public.phase6_reinspection_cancellations to service_role;
create trigger phase6_reinspection_authorizations_immutable before update or delete on public.phase6_reinspection_authorizations for each row execute function public.phase6_immutable();
create trigger phase6_reinspection_cancellations_immutable before update or delete on public.phase6_reinspection_cancellations for each row execute function public.phase6_immutable();

-- Prevent new compliance rows appearing between classification and commit.
-- Existing rows are locked below; inserts serialize on the same enrollment row.
create function public.phase5a_requirement_insert_lock() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from public.phase6_enrollments where driver_id=new.driver_id for update;
 return new;
end $$;
revoke all on function public.phase5a_requirement_insert_lock() from public,anon,authenticated,service_role;
create trigger phase5a_document_insert_lock before insert on public.driver_documents for each row execute function public.phase5a_requirement_insert_lock();
create trigger phase5a_profile_insert_lock before insert on public.driver_profiles for each row execute function public.phase5a_requirement_insert_lock();

-- Read-only classifier shared by Admin presentation and the cancellation transaction.
create function public.phase5a_reinspection_state(p_application uuid) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare a public.phase6_applications%rowtype; prev public.phase6_applications%rowtype;
 au public.phase6_reinspection_authorizations%rowtype; e public.phase6_enrollments%rowtype;
 d public.drivers%rowtype; p public.phase6_policy%rowtype; snap jsonb; doc jsonb;
 v_section text; item text; expiry text; blockers text[]:='{}'; uncertain text[]:='{}';
 category text; active boolean; linked boolean; historical_reason text; historical_actor uuid; historical_date timestamptz;
begin
 select * into a from public.phase6_applications where id=p_application;
 if not found then raise exception 'Application unavailable' using errcode='P0001';end if;
 select * into au from public.phase6_reinspection_authorizations where application_id=a.id;
 select * into prev from public.phase6_applications where driver_id=a.driver_id and cycle<a.cycle and status='APPROVED' order by cycle desc limit 1;
 if au.application_id is null and (prev.id is null or not exists(select 1 from public.phase6_reviews where application_id=prev.id and action='REINSPECTION_AUTHORIZED')) then return null;end if;
 select reason,actor_id,created_at into historical_reason,historical_actor,historical_date from public.phase6_reviews
  where application_id=prev.id and action='REINSPECTION_AUTHORIZED' order by created_at desc limit 1;
 select * into e from public.phase6_enrollments where driver_id=a.driver_id;
 select * into d from public.drivers where id=a.driver_id;
 select * into p from public.phase6_policy where singleton;
 linked:=exists(select 1 from public.driver_accounts da join auth.users u on u.id=da.user_id
  join public.profiles pr on pr.id=u.id where da.driver_id=a.driver_id and da.user_id=e.user_id and pr.role='driver' and u.deleted_at is null);
 active:=a.status not in ('APPROVED','REJECTED','CANCELLED') and not exists(select 1 from public.phase6_applications where driver_id=a.driver_id and cycle>a.cycle and status<>'CANCELLED');
 if prev.id is null or prev.status<>'APPROVED' or e.completed_at is null then blockers:=array_append(blockers,'Previous versioned approval is missing');end if;
 if not exists(select 1 from public.phase6_reviews where application_id=prev.id and source_version=prev.version and action='APPROVED') then uncertain:=array_append(uncertain,'Previous approval audit requires review');end if;
 if not linked then blockers:=array_append(blockers,'Driver account linking requires verification');end if;
 if d.id is null or coalesce(d.is_deleted,true) or coalesce(d.status,'') not in ('approved','active') or d.verification_status is distinct from 'approved' or not coalesce(d.profile_completed,false) then blockers:=array_append(blockers,'Driver has an unresolved operating or identity restriction');end if;
 if p.singleton is null then uncertain:=array_append(uncertain,'Onboarding policy is unavailable');end if;
 select snapshot into snap from public.phase6_versions where application_id=prev.id and version=prev.version;
 if snap is null then uncertain:=array_append(uncertain,'Approved snapshot is unavailable');
 else
  if snap->>'checklist_version' is distinct from p.checklist_version::text then blockers:=array_append(blockers,'Current mandatory checklist requires verification');end if;
  foreach item in array array['id_document','drivers_license','vehicle_license_disc','front','rear','driver_side','passenger_side','front_interior','rear_interior','odometer','vin','engine'] loop
   v_section:=case when item='id_document' then 'personal' when item='drivers_license' then 'driving' when item='vehicle_license_disc' then 'vehicle' else 'scanner' end;
   if not exists(select 1 from public.phase6_uploads u where u.id::text=snap->'draft'->v_section->'evidence'->>item and u.application_id=prev.id and u.section=v_section and u.state='VALIDATED' and snap->'evidence' @> jsonb_build_object(u.id::text,true)) then blockers:=array_append(blockers,'Required verified evidence missing: '||item);end if;
  end loop;
  foreach item in array array['license_expiry','vehicle_license_expiry','pdp_expiry'] loop
   if item='pdp_expiry' and p.pdp_operating_rule<>'REQUIRED' then continue;end if;
   v_section:=case when item='vehicle_license_expiry' then 'vehicle' else 'driving' end;
   expiry:=snap->'draft'->v_section->>item;
   if expiry is null or expiry !~ '^\d{4}-\d{2}-\d{2}$' then uncertain:=array_append(uncertain,'Document validity requires review: '||item);
   else
    begin
     if expiry::date<=current_date then blockers:=array_append(blockers,'Mandatory document expired: '||item);end if;
    exception when datetime_field_overflow or invalid_datetime_format then uncertain:=array_append(uncertain,'Invalid document expiry: '||item);end;
   end if;
  end loop;
  if p.pdp_operating_rule='REQUIRED' and not exists(select 1 from public.phase6_uploads u where u.application_id=prev.id and u.id::text=snap->'draft'->'driving'->'evidence'->>'pdp' and u.state='VALIDATED' and snap->'evidence' @> jsonb_build_object(u.id::text,true)) then blockers:=array_append(blockers,'Mandatory PDP verification missing');end if;
  if a.draft is distinct from snap->'draft' or a.version<>0 then uncertain:=array_append(uncertain,'New or changed submission requires review');end if;
  if exists(select 1 from public.driver_profiles dp where dp.driver_id=a.driver_id and
   ((dp.id_number is not null and dp.id_number is distinct from snap->'draft'->'personal'->>'id_number') or
    (dp.license_number is not null and dp.license_number is distinct from snap->'draft'->'driving'->>'license_number'))) then uncertain:=array_append(uncertain,'Verified identity differs from approved evidence');end if;
 end if;
 -- A current required legacy document can add a restriction; older optional evidence cannot clear one.
 for doc in select to_jsonb(dd) from public.driver_documents dd where dd.driver_id=a.driver_id and dd.is_required is true loop
  if lower(coalesce(doc->>'review_status',doc->>'status','')) not in ('approved','verified') then blockers:=array_append(blockers,'Required document verification unresolved');end if;
  expiry:=coalesce(doc->>'expires_at',doc->>'expires_on');
  if expiry is not null and expiry::date<=current_date then blockers:=array_append(blockers,'Required document expired');end if;
 end loop;
 if exists(select 1 from public.driver_profiles dp where dp.driver_id=a.driver_id and (dp.deleted_at is not null or dp.license_expiry<=current_date or dp.vehicle_license_expiry<=current_date or (p.pdp_operating_rule='REQUIRED' and dp.pdp_expiry<=current_date))) then blockers:=array_append(blockers,'Driver profile document or identity restriction');end if;
 if au.application_id is null or au.reason_code='NEEDS_REVIEW' then uncertain:=array_append(uncertain,'Authorization has no reliable classification');end if;
 if au.application_id is not null and (au.previous_application_id is distinct from prev.id or au.previous_version is distinct from prev.version) then uncertain:=array_append(uncertain,'Previous approval relationship requires review');end if;
 if au.application_id is not null and not exists(select 1 from public.phase6_inspections i where i.application_id=a.id and i.trigger_reason=au.reason and i.checklist_version=p.checklist_version) then uncertain:=array_append(uncertain,'Inspection policy or reason changed after authorization');end if;
 category:=case when cardinality(blockers)>0 or au.reason_code in ('DOCUMENT_EXPIRED','IDENTITY_REQUIRED','POLICY_REQUIRED','COMPLIANCE_REQUIRED') then 'MANDATORY' when cardinality(uncertain)>0 then 'NEEDS_REVIEW' else 'OPTIONAL' end;
 return jsonb_build_object('category',category,'reason',coalesce(au.reason,historical_reason),'reasonCode',au.reason_code,
  'authorizedAt',coalesce(au.created_at,historical_date),'authorizedBy',coalesce(au.actor_id,historical_actor),'source',case when au.application_id is null then 'Legacy authorization' else 'Admin' end,
  'previousApplicationId',prev.id,'previousVersion',prev.version,'previousStatus',prev.status,'active',active,
  'canCancel',active and category='OPTIONAL' and e.inspection_required,'blockers',to_jsonb(blockers||uncertain),
  'currentEligible',coalesce(public.phase6_new_work_eligible(a.driver_id),false) and cardinality(blockers)=0,
  'cancelled',a.status='CANCELLED');
end $$;
revoke all on function public.phase5a_reinspection_state(uuid) from public,anon,authenticated,service_role;

create function public.phase5a_admin_reinspection_state(p_actor uuid,p_application uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin perform public.phase6_actor(p_actor,true);return public.phase5a_reinspection_state(p_application);end $$;
revoke all on function public.phase5a_admin_reinspection_state(uuid,uuid) from public,anon,authenticated;
grant execute on function public.phase5a_admin_reinspection_state(uuid,uuid) to service_role;

create function public.phase5a_authorize_reinspection(p_actor uuid,p_application uuid,p_revision integer,p_key uuid,p_reason text,p_reason_code text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.phase6_applications%rowtype; b public.phase6_applications%rowtype; payload jsonb;op public.phase6_operations%rowtype;next_cycle integer;
begin
 perform public.phase6_actor(p_actor,true);
 if p_key is null or p_reason is null or length(trim(p_reason)) not between 8 and 2000 or p_reason_code is null or p_reason_code not in ('OPTIONAL_ADMIN_REVIEW','DOCUMENT_EXPIRED','IDENTITY_REQUIRED','POLICY_REQUIRED','COMPLIANCE_REQUIRED','NEEDS_REVIEW') then raise exception 'Invalid reinspection authorization' using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text,6));
 payload:=jsonb_build_object('action','REINSPECTION_AUTHORIZED_5A','application',p_application,'revision',p_revision,'reason',p_reason,'reasonCode',p_reason_code);
 select * into op from public.phase6_operations where actor_id=p_actor and operation_key=p_key;
 if found then if op.payload<>payload then raise exception 'Idempotency conflict' using errcode='P0001';end if;return op.result;end if;
 select * into a from public.phase6_applications where id=p_application;
 perform 1 from public.phase6_enrollments where driver_id=a.driver_id for update;
 select * into a from public.phase6_applications where id=p_application for update;
 if not found or a.status<>'APPROVED' or a.revision is distinct from p_revision then raise exception 'Reinspection authorization conflict' using errcode='P0001';end if;
 if exists(select 1 from public.phase6_applications where driver_id=a.driver_id and cycle>a.cycle and status<>'CANCELLED') then raise exception 'A newer cycle exists' using errcode='P0001';end if;
 select max(cycle)+1 into next_cycle from public.phase6_applications where driver_id=a.driver_id;
 insert into public.phase6_applications(driver_id,cycle,draft) values(a.driver_id,next_cycle,a.draft) returning * into b;
 insert into public.phase6_inspections(application_id,trigger_reason) values(b.id,trim(p_reason));
 insert into public.phase6_reinspection_authorizations(application_id,previous_application_id,previous_version,actor_id,reason_code,reason) values(b.id,a.id,a.version,p_actor,p_reason_code,trim(p_reason));
 update public.phase6_enrollments set inspection_required=true where driver_id=a.driver_id;
 insert into public.phase6_operations(actor_id,operation_key,payload,result) values(p_actor,p_key,payload,to_jsonb(b));
 return to_jsonb(b);
end $$;
revoke all on function public.phase5a_authorize_reinspection(uuid,uuid,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function public.phase5a_authorize_reinspection(uuid,uuid,integer,uuid,text,text) to service_role;
create or replace function public.phase6_reinspection(p_actor uuid,p_application uuid,p_revision integer,p_key uuid,p_reason text) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 select public.phase5a_authorize_reinspection(p_actor,p_application,p_revision,p_key,p_reason,'NEEDS_REVIEW');
$$;

create function public.phase5a_cancel_reinspection(p_actor uuid,p_application uuid,p_revision integer,p_key uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.phase6_applications%rowtype; prev public.phase6_applications%rowtype;state jsonb;payload jsonb;op public.phase6_operations%rowtype;res jsonb;
begin
 perform public.phase6_actor(p_actor,true);
 if p_key is null or p_reason is null or length(trim(p_reason)) not between 8 and 2000 then raise exception 'Cancellation reason required' using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text,6));
 payload:=jsonb_build_object('action','REINSPECTION_CANCELLED','application',p_application,'revision',p_revision,'reason',p_reason);
 select * into op from public.phase6_operations where actor_id=p_actor and operation_key=p_key;
 if found then if op.payload<>payload then raise exception 'Idempotency conflict' using errcode='P0001';end if;return op.result;end if;
 select * into a from public.phase6_applications where id=p_application;
 perform 1 from public.phase6_enrollments where driver_id=a.driver_id for update;
 perform 1 from public.drivers where id=a.driver_id for update;
 perform 1 from public.phase6_policy where singleton for share;
 perform 1 from public.driver_accounts where driver_id=a.driver_id for share;
 perform 1 from public.profiles where id=(select user_id from public.phase6_enrollments where driver_id=a.driver_id) for share;
 perform 1 from auth.users where id=(select user_id from public.phase6_enrollments where driver_id=a.driver_id) for share;
 perform 1 from public.driver_profiles where driver_id=a.driver_id for share;
 perform 1 from public.driver_documents where driver_id=a.driver_id for share;
 perform 1 from public.phase6_applications where driver_id=a.driver_id order by cycle for update;
 perform 1 from public.phase6_inspections where application_id=p_application for share;
 select * into a from public.phase6_applications where id=p_application;
 if not found or a.revision is distinct from p_revision or a.status='CANCELLED' then raise exception 'Reinspection changed; refresh and review' using errcode='P0001';end if;
 perform 1 from public.phase6_uploads where application_id in (select id from public.phase6_applications where driver_id=a.driver_id) for share;
 state:=public.phase5a_reinspection_state(a.id);
 if not coalesce((state->>'canCancel')::boolean,false) then raise exception 'Reinspection cancellation restricted; review required actions' using errcode='P0001';end if;
 select * into prev from public.phase6_applications where id=(state->>'previousApplicationId')::uuid;
 update public.phase6_applications set status='CANCELLED',revision=revision+1,updated_at=now() where id=a.id;
 update public.phase6_enrollments set inspection_required=false where driver_id=a.driver_id;
 if not coalesce(public.phase6_new_work_eligible(a.driver_id),false) then raise exception 'Driver remains ineligible' using errcode='P0001';end if;
 insert into public.phase6_reinspection_cancellations(application_id,driver_id,previous_application_id,actor_id,operation_key,reason,previous_status,resulting_status,eligibility)
 values(a.id,a.driver_id,prev.id,p_actor,p_key,trim(p_reason),a.status,prev.status,state||jsonb_build_object('currentEligible',true));
 res:=to_jsonb(prev);
 insert into public.phase6_operations(actor_id,operation_key,payload,result) values(p_actor,p_key,payload,res);
 return res;
end $$;
revoke all on function public.phase5a_cancel_reinspection(uuid,uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.phase5a_cancel_reinspection(uuid,uuid,integer,uuid,text) to service_role;

-- Preserve the installed command body and all its validation. Only resolve ENROLL
-- to the prior approved version after a recorded cancellation; cancelled rows stay frozen.
alter function public.phase6_command(uuid,uuid,text,uuid,integer,jsonb) rename to phase5a_original_command;
revoke all on function public.phase5a_original_command(uuid,uuid,text,uuid,integer,jsonb) from public,anon,authenticated,service_role;
create function public.phase6_command(p_actor uuid,p_key uuid,p_action text,p_application uuid default null,p_revision integer default null,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d uuid;res jsonb; effective public.phase6_applications%rowtype;
begin
 if p_action='ENROLL' then
  if coalesce(auth.role(),'')<>'service_role' or not exists(select 1 from auth.users where id=p_actor and deleted_at is null) then raise exception 'Trusted operation required' using errcode='P0001';end if;
 else perform public.phase6_actor(p_actor,p_action in ('UNDER_REVIEW','APPROVED','REJECTED','CORRECTION_REQUESTED','REAPPLICATION_AUTHORIZED'));end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text,6));
 select driver_id into d from public.phase6_applications where id=p_application;
 if p_action='ENROLL' then select driver_id into d from public.driver_accounts where user_id=p_actor;end if;
 perform 1 from public.phase6_enrollments where driver_id=d for update;
 if exists(select 1 from public.phase6_applications where id=p_application and status='CANCELLED') then raise exception 'Cancelled reinspection is immutable' using errcode='P0001';end if;
 res:=public.phase5a_original_command(p_actor,p_key,p_action,p_application,p_revision,p_payload);
 if p_action='ENROLL' and exists(select 1 from public.phase6_applications where id=(res->>'id')::uuid and status='CANCELLED') then
  select a.* into effective from public.phase6_applications a where a.driver_id=d and a.status<>'CANCELLED' order by a.cycle desc limit 1;
  if effective.status is distinct from 'APPROVED' then raise exception 'Previous approval unavailable' using errcode='P0001';end if;
  return to_jsonb(effective);
 end if;
 return res;
end $$;
revoke all on function public.phase6_command(uuid,uuid,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.phase6_command(uuid,uuid,text,uuid,integer,jsonb) to service_role;

create table public.phase5a_driver_name_corrections (
 id uuid primary key default gen_random_uuid(),
 driver_id uuid not null references public.drivers(id),
 actor_id uuid not null references auth.users(id),
 operation_key uuid not null,
 field_name text not null check(field_name in ('first_name','last_name')),
 old_value text,
 new_value text not null check(length(trim(new_value)) between 1 and 100),
 reason text not null check(length(trim(reason)) between 8 and 2000),
 created_at timestamptz not null default now(),
 unique(actor_id,operation_key)
);
alter table public.phase5a_driver_name_corrections enable row level security;
revoke all on public.phase5a_driver_name_corrections from public,anon,authenticated;
grant select,insert on public.phase5a_driver_name_corrections to service_role;
create trigger phase5a_driver_name_corrections_immutable before update or delete on public.phase5a_driver_name_corrections
 for each row execute function public.phase6_immutable();

create function public.phase5a_correct_driver_name(p_actor uuid,p_driver uuid,p_field text,p_value text,p_expected text,p_reason text,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.drivers%rowtype; old_value text; prior public.phase5a_driver_name_corrections%rowtype;
begin
 perform public.phase6_actor(p_actor,true);
 if p_driver is null or p_key is null or p_field is null or p_field not in ('first_name','last_name') or p_value is null
  or length(trim(p_value)) not between 1 and 100 or p_value ~ '[[:cntrl:]]'
  or p_reason is null or length(trim(p_reason)) not between 8 and 2000 then
  raise exception 'Invalid name correction' using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_key::text,0));
 select * into prior from public.phase5a_driver_name_corrections where actor_id=p_actor and operation_key=p_key;
 if found then
  if prior.driver_id is distinct from p_driver or prior.field_name is distinct from p_field or prior.old_value is distinct from p_expected
   or prior.new_value is distinct from trim(p_value) or prior.reason is distinct from trim(p_reason) then
   raise exception 'Operation key conflict' using errcode='P0001';end if;
  return jsonb_build_object('ok',true,'replayed',true,'auditId',prior.id);
 end if;
 select * into d from public.drivers where id=p_driver for update;
 if not found or coalesce(d.is_deleted,false) then raise exception 'Driver unavailable' using errcode='P0001';end if;
 old_value:=case when p_field='first_name' then d.first_name else d.last_name end;
 if old_value is distinct from p_expected then raise exception 'Driver name changed; refresh first' using errcode='P0001';end if;
 insert into public.phase5a_driver_name_corrections(driver_id,actor_id,operation_key,field_name,old_value,new_value,reason)
 values(p_driver,p_actor,p_key,p_field,old_value,trim(p_value),trim(p_reason)) returning * into prior;
 perform set_config('moovu.phase5a_name_correction',prior.id::text,true);
 if p_field='first_name' then update public.drivers set first_name=trim(p_value) where id=p_driver;
 else update public.drivers set last_name=trim(p_value) where id=p_driver;end if;
 perform set_config('moovu.phase5a_name_correction','',true);
 return jsonb_build_object('ok',true,'replayed',false,'auditId',prior.id);
end $$;
revoke all on function public.phase5a_correct_driver_name(uuid,uuid,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.phase5a_correct_driver_name(uuid,uuid,text,text,text,text,uuid) to service_role;
commit;
