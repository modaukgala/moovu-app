-- Replace the broad Phase 6 claim with explicit, owner-reviewed job IDs.
-- The general Phase 05b claim remains untouched for unrelated workflows.
drop function public.phase6_claim_review_outbox(integer);
create function public.phase6_claim_review_outbox(p_ids uuid[])
returns setof public.moovu_notification_outbox
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted worker role required' using errcode='P0001';
  end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 3 then
    raise exception 'Reviewed job IDs required' using errcode='P0001';
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
    where o.id=any(p_ids) and o.status in ('pending','failed')
      and o.next_attempt_at<=now() and o.attempts<8
      and o.created_at>=now()-interval '24 hours'
      and not exists(select 1 from public.phase6_reviews later
        where later.application_id=a.id and later.created_at>r.created_at)
      and ((o.event_type='phase6_correction_requested' and r.action='CORRECTION_REQUESTED'
          and a.status='CORRECTION_REQUESTED' and exists(
            select 1 from public.phase6_correction_targets c
            where c.review_id=r.id and c.requirement=o.payload->>'requirement'))
        or (o.event_type='phase6_application_approved' and r.action='APPROVED' and a.status='APPROVED')
        or (o.event_type='phase6_application_rejected' and r.action='REJECTED' and a.status='REJECTED'))
    order by o.created_at for update of o skip locked limit 3
  )
  update public.moovu_notification_outbox o
    set status='processing',attempts=o.attempts+1,locked_at=now(),updated_at=now()
    from due where o.id=due.id returning o.*;
end $$;
revoke all on function public.phase6_claim_review_outbox(uuid[]) from public,anon,authenticated;
grant execute on function public.phase6_claim_review_outbox(uuid[]) to service_role;
