-- Read-only review projection. Do not apply to production without schema review and approval.
-- Rollback: drop function public.admin_yoco_payment_review(timestamptz,timestamptz,text,text,text,integer,integer).
create or replace function public.admin_yoco_payment_review(
  p_from timestamptz, p_to timestamptz,
  p_status text default 'all', p_fulfilment text default 'all', p_search text default '',
  p_page integer default 1, p_limit integer default 20
) returns jsonb language plpgsql stable security invoker
set search_path = public, pg_temp
as $function$
declare v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '366 days'
    or p_status not in ('all','pending','verified-paid','failed','refund-review','unknown')
    or p_fulfilment not in ('all','needs-review','no-trip','awaiting-driver','allocated','in-progress','completed','cancelled')
    or length(p_search) > 100 or p_page not between 1 and 100000 or p_limit not between 1 and 50 then
    raise exception 'Invalid review filters';
  end if;
  with source_rows as materialized (
    select a.id, a.customer_id, a.trip_id, a.amount_cents, a.currency, a.state,
      a.created_at, a.verified_at, a.provider_payment_id, a.provider_checkout_id,
      coalesce(nullif(trim(concat_ws(' ',c.first_name,c.last_name)),''),'Customer profile unavailable') payer,
      t.status trip_status, t.driver_id, t.offer_status,
      coalesce(nullif(trim(concat_ws(' ',d.first_name,d.last_name)),''),'Driver profile unavailable') driver_name,
      ev.provider_event_id
    from public.online_payment_attempts a
    left join public.customers c on c.id=a.customer_id
    left join public.trips t on t.id=a.trip_id
    left join public.drivers d on d.id=t.driver_id
    left join lateral (
      select e.provider_event_id from public.online_provider_events e
      where e.payment_attempt_id=a.id and e.provider='YOCO' and e.trust_state='VERIFIED'
        and e.processing_state='PROCESSED' and e.raw_provider_status='succeeded'
      order by e.processed_at,e.id limit 1
    ) ev on true
    where a.provider='YOCO' and a.created_at>=p_from and a.created_at<p_to
  ), classified as materialized (
    select s.*,
      case
        when s.state in ('REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED','REFUND_FAILED') then 'refund-review'
        when s.state in ('CREATED','PENDING') then 'pending'
        when s.state in ('FAILED','CANCELLED','EXPIRED') then 'failed'
        when s.state='SUCCEEDED' and s.verified_at is not null
          and s.provider_payment_id is not null and s.currency='ZAR'
          and s.amount_cents>0 and s.provider_event_id is not null then 'verified-paid'
        else 'unknown'
      end payment_status
    from source_rows s
  ), fulfilment as materialized (
    select c.*,
      case
        when c.payment_status<>'verified-paid' then null
        when c.trip_id is null or c.trip_status is null then 'no-trip'
        when c.trip_status='completed' then 'completed'
        when c.trip_status='cancelled' then 'cancelled'
        when c.trip_status='ongoing' then 'in-progress'
        when c.trip_status in ('assigned','arrived') and c.driver_id is not null
          and c.offer_status='accepted' then 'allocated'
        else 'awaiting-driver'
      end fulfilment_status
    from classified c
  ), filtered as materialized (
    select * from fulfilment f
    where (p_status='all' or f.payment_status=p_status)
      and (p_fulfilment='all' or f.fulfilment_status=p_fulfilment
        or (p_fulfilment='needs-review' and f.fulfilment_status in ('no-trip','awaiting-driver','cancelled')))
      and (trim(p_search)='' or position(lower(trim(p_search)) in lower(f.payer))>0
        or position(lower(trim(p_search)) in lower(coalesce(f.provider_payment_id,'')))>0
        or f.id::text=trim(p_search))
  ), page_rows as (
    select * from filtered order by coalesce(verified_at,created_at) desc,id desc
    limit p_limit offset (p_page-1)*p_limit
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(r) order by coalesce(r.verified_at,r.created_at) desc,r.id desc) from page_rows r),'[]'::jsonb),
    'total',count(*),'page',p_page,'limit',p_limit
  ) into v_result from filtered;
  return v_result;
end $function$;
revoke all on function public.admin_yoco_payment_review(timestamptz,timestamptz,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.admin_yoco_payment_review(timestamptz,timestamptz,text,text,text,integer,integer) to service_role;
