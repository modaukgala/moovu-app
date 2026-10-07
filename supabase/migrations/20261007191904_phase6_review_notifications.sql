-- Keep Phase 6 command/review history authoritative. This wrapper adds a
-- requirement-specific correction marker and durable notification in the same transaction.
create table public.phase6_correction_targets (
  review_id uuid primary key references public.phase6_reviews(id) on delete restrict,
  requirement text not null check (requirement in (
    'id_document','drivers_license','pdp','vehicle_license_disc','insurance',
    'front','rear','driver_side','passenger_side','front_interior','rear_interior',
    'odometer','vin','engine'
  )),
  reason_category text not null check (reason_category in (
    'Image is blurry','Document or photo is cut off','Information cannot be read',
    'Wrong document or photo','Document has expired','Incorrect angle or view','Other'
  )),
  created_at timestamptz not null default now()
);
alter table public.phase6_correction_targets enable row level security;
revoke all on public.phase6_correction_targets from public, anon, authenticated;
grant select, insert on public.phase6_correction_targets to service_role;

create function public.phase6_admin_review(
  p_actor uuid, p_key uuid, p_action text, p_application uuid,
  p_revision integer, p_reason text, p_requirement text default null,
  p_category text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_section text;
  v_result jsonb;
  v_review public.phase6_reviews%rowtype;
  v_driver uuid;
  v_user uuid;
  v_event uuid;
  v_type text;
begin
  if coalesce(auth.role(),'') <> 'service_role' or p_key is null then
    raise exception 'Trusted review required' using errcode='P0001';
  end if;
  if p_action not in ('CORRECTION_REQUESTED','APPROVED','REJECTED') or
     p_reason is null or length(trim(p_reason)) not between 8 and 2000 then
    raise exception 'Invalid review decision' using errcode='P0001';
  end if;
  if p_action = 'CORRECTION_REQUESTED' then
    v_section := case
      when p_requirement = 'id_document' then 'personal'
      when p_requirement in ('drivers_license','pdp') then 'driving'
      when p_requirement in ('vehicle_license_disc','insurance') then 'vehicle'
      when p_requirement in ('front','rear','driver_side','passenger_side','front_interior','rear_interior','odometer','vin','engine') then 'scanner'
      else null end;
    if v_section is null or p_category is null or p_category not in (
      'Image is blurry','Document or photo is cut off','Information cannot be read',
      'Wrong document or photo','Document has expired','Incorrect angle or view','Other'
    ) then raise exception 'Invalid evidence requirement' using errcode='P0001'; end if;
  elsif p_requirement is not null or p_category is not null then
    raise exception 'Evidence target belongs only to a correction' using errcode='P0001';
  end if;

  v_result := public.phase6_command(p_actor,p_key,p_action,p_application,p_revision,
    jsonb_build_object('reason',trim(p_reason),'sections',case when v_section is null then '[]'::jsonb else jsonb_build_array(v_section) end));
  select * into v_review from public.phase6_reviews
    where application_id=p_application and action=p_action
    and source_version=(v_result->>'version')::integer;
  if not found then raise exception 'Review record unavailable' using errcode='P0001'; end if;

  if v_section is not null then
    insert into public.phase6_correction_targets(review_id,requirement,reason_category)
      values(v_review.id,p_requirement,p_category)
      on conflict(review_id) do nothing;
    if not exists(select 1 from public.phase6_correction_targets
      where review_id=v_review.id and requirement=p_requirement and reason_category=p_category) then
      raise exception 'Correction replay conflict' using errcode='P0001';
    end if;
  end if;
  select a.driver_id,e.user_id into v_driver,v_user from public.phase6_applications a
    join public.phase6_enrollments e on e.driver_id=a.driver_id where a.id=p_application;
  if v_user is null then raise exception 'Driver notification target unavailable' using errcode='P0001'; end if;
  v_type := case p_action when 'CORRECTION_REQUESTED' then 'phase6_correction_requested'
    when 'APPROVED' then 'phase6_application_approved' else 'phase6_application_rejected' end;
  insert into public.moovu_business_events(event_key,event_type,aggregate_type,aggregate_id,actor_id,payload)
    values('phase6-review:'||v_review.id::text,v_type,'phase6_application',p_application,p_actor,
      jsonb_build_object('application_id',p_application,'driver_id',v_driver,'user_id',v_user,
        'review_id',v_review.id,'cycle',v_result->>'cycle','version',v_result->>'version',
        'requirement',p_requirement,'reason_category',p_category))
    on conflict(event_key) do nothing returning id into v_event;
  if v_event is null then
    select id into v_event from public.moovu_business_events where event_key='phase6-review:'||v_review.id::text;
  end if;
  insert into public.moovu_notification_outbox(business_event_id,event_type,payload)
    values(v_event,v_type,jsonb_build_object('application_id',p_application,'driver_id',v_driver,
      'user_id',v_user,'review_id',v_review.id,'cycle',v_result->>'cycle','version',v_result->>'version',
      'requirement',p_requirement,'reason_category',p_category))
    on conflict(business_event_id) do nothing;
  return v_result;
end $$;
revoke all on function public.phase6_admin_review(uuid,uuid,text,uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.phase6_admin_review(uuid,uuid,text,uuid,integer,text,text,text) to service_role;
create trigger phase6_correction_targets_immutable before update or delete
  on public.phase6_correction_targets for each row execute function public.phase6_immutable();
