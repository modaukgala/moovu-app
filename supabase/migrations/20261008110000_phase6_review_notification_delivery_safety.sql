-- Follow-on to 20261007191904. Persist Driver inbox records at decision time,
-- and admit only current Phase 6 review events to the controlled push worker.
-- Historical Phase 05b outbox rows remain unchanged and unclaimed.
create function public.phase6_review_in_app_notification()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_user uuid;
  v_requirement text;
  v_label text;
  v_category text;
  v_title text;
  v_body text;
  v_url text;
begin
  if new.event_type not in ('phase6_correction_requested','phase6_application_approved','phase6_application_rejected') then
    return new;
  end if;
  v_user := (new.payload->>'user_id')::uuid;
  if v_user is null then raise exception 'Phase 6 notification recipient missing'; end if;
  v_requirement := new.payload->>'requirement';
  v_label := case v_requirement
    when 'id_document' then 'SA ID' when 'drivers_license' then 'Driver''s Licence'
    when 'pdp' then 'PDP' when 'vehicle_license_disc' then 'Vehicle Licence Disc'
    when 'insurance' then 'Insurance' when 'front' then 'Front of Vehicle'
    when 'rear' then 'Rear of Vehicle' when 'driver_side' then 'Driver Side'
    when 'passenger_side' then 'Passenger Side' when 'front_interior' then 'Front Interior'
    when 'rear_interior' then 'Rear Interior' when 'odometer' then 'Odometer'
    when 'vin' then 'VIN' when 'engine' then 'Engine Number' else null end;
  if new.event_type='phase6_correction_requested' and v_label is null then
    raise exception 'Phase 6 notification requirement missing';
  end if;
  v_category := new.payload->>'reason_category';
  if v_category not in ('Image is blurry','Document or photo is cut off',
    'Information cannot be read','Wrong document or photo','Document has expired',
    'Incorrect angle or view','Other') then v_category := 'Review requested'; end if;
  v_title := case new.event_type
    when 'phase6_correction_requested' then 'Application evidence needs attention'
    when 'phase6_application_approved' then 'Driver application approved'
    else 'Driver application decision' end;
  v_body := case new.event_type
    when 'phase6_correction_requested' then v_label||': '||v_category||'. Open your application to replace it.'
    when 'phase6_application_approved' then 'Your MOOVU Driver application is approved. You can go online when otherwise eligible.'
    else 'Your Driver application was not approved. Open your application for the review reason.' end;
  v_url := '/driver/onboarding'||case when v_requirement is null then ''
    else '?requirement='||v_requirement end;
  insert into public.app_notifications(user_id,role,title,body,url,data,delivery_status,event_key)
    values(v_user,'driver',v_title,v_body,v_url,
      jsonb_build_object('eventKey',new.business_event_id,'type',new.event_type,
        'applicationId',new.payload->>'application_id','reviewId',new.payload->>'review_id',
        'requirement',v_requirement,'cycle',new.payload->>'cycle','version',new.payload->>'version'),
      'queued','phase05:'||new.business_event_id::text||':'||v_user::text)
    on conflict(user_id,event_key) do nothing;
  return new;
end $$;
revoke all on function public.phase6_review_in_app_notification() from public,anon,authenticated;
create trigger phase6_review_in_app_notification_after_insert
after insert on public.moovu_notification_outbox for each row
execute function public.phase6_review_in_app_notification();

create function public.phase6_claim_review_outbox(p_limit integer default 3)
returns setof public.moovu_notification_outbox
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted worker role required' using errcode='P0001';
  end if;
  return query with due as (
    select o.id from public.moovu_notification_outbox o
    join public.phase6_reviews r on r.id::text=o.payload->>'review_id'
    join public.phase6_applications a on a.id=r.application_id
      and a.id::text=o.payload->>'application_id'
    join public.phase6_enrollments e on e.driver_id=a.driver_id
      and e.user_id::text=o.payload->>'user_id'
    join public.moovu_business_events b on b.id=o.business_event_id
      and b.event_type=o.event_type and b.event_key='phase6-review:'||r.id::text
    where o.status in ('pending','failed') and o.next_attempt_at<=now()
      and o.attempts<8 and o.created_at>=now()-interval '24 hours'
      and not exists(select 1 from public.phase6_reviews later
        where later.application_id=a.id and later.created_at>r.created_at)
      and ((o.event_type='phase6_correction_requested' and r.action='CORRECTION_REQUESTED'
          and a.status='CORRECTION_REQUESTED' and exists(
            select 1 from public.phase6_correction_targets c
            where c.review_id=r.id and c.requirement=o.payload->>'requirement'))
        or (o.event_type='phase6_application_approved' and r.action='APPROVED' and a.status='APPROVED')
        or (o.event_type='phase6_application_rejected' and r.action='REJECTED' and a.status='REJECTED'))
    order by o.created_at for update of o skip locked
    limit greatest(1,least(3,p_limit))
  )
  update public.moovu_notification_outbox o
    set status='processing',attempts=o.attempts+1,locked_at=now(),updated_at=now()
    from due where o.id=due.id returning o.*;
end $$;
revoke all on function public.phase6_claim_review_outbox(integer) from public,anon,authenticated;
grant execute on function public.phase6_claim_review_outbox(integer) to service_role;
