-- Read-only reporting. Rollback: drop this function; payment data is untouched.
create or replace function public.admin_verified_yoco_payments_report(
  p_from timestamptz, p_to timestamptz, p_payer text default 'all',
  p_page integer default 1, p_limit integer default 20
) returns jsonb language plpgsql stable security invoker
set search_path = public, pg_temp
as $function$
declare result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '366 days'
     or p_payer not in ('all','customer','driver') or p_page not between 1 and 100000
     or p_limit not between 1 and 50 then raise exception 'Invalid report filters'; end if;
  with canonical as (
    select a.id, 'customer'::text payer_type, 'Trip Payment'::text purpose,
      coalesce(nullif(trim(concat_ws(' ',c.first_name,c.last_name)),''),'Customer profile unavailable') payer,
      a.amount_cents,a.verified_at,a.provider_payment_id,a.provider_checkout_id,a.payment_ledger_transaction_id,
      a.trip_id,t.pickup_address,t.dropoff_address,a.id::text settlement_reference,
      e.provider_event_id
    from public.online_payment_attempts a
    left join public.customers c on c.id=a.customer_id
    left join public.trips t on t.id=a.trip_id
    join lateral (select ev.provider_event_id from public.online_provider_events ev
      where ev.payment_attempt_id=a.id and ev.provider='YOCO' and ev.trust_state='VERIFIED'
        and ev.processing_state='PROCESSED' and ev.raw_provider_status='succeeded'
      order by ev.processed_at,ev.id limit 1) e on true
    where a.provider='YOCO' and a.state='SUCCEEDED' and a.verified_at is not null
      and a.provider_payment_id is not null and a.currency='ZAR' and a.amount_cents>0
    union all
    select a.id,'driver','Commission Payment',
      coalesce(nullif(trim(concat_ws(' ',d.first_name,d.last_name)),''),'Driver profile unavailable'),
      a.amount_cents,a.verified_at,a.provider_payment_id,a.provider_checkout_id,a.payment_ledger_transaction_id,
      null::uuid,null::text,null::text,a.id::text,e.provider_event_id
    from public.driver_online_payment_attempts a
    left join public.drivers d on d.id=a.driver_id
    join lateral (select ev.provider_event_id from public.online_provider_events ev
      where ev.driver_payment_attempt_id=a.id and ev.provider='YOCO' and ev.trust_state='VERIFIED'
        and ev.processing_state='PROCESSED' and ev.raw_provider_status='succeeded'
      order by ev.processed_at,ev.id limit 1) e on true
    where a.provider='YOCO' and a.state='SUCCEEDED' and a.verified_at is not null
      and a.provider_payment_id is not null and a.currency='ZAR' and a.amount_cents>0
      and a.obligation_type='COMMISSION_DEBT'
  ), unique_payments as (
    select distinct on (provider_payment_id) * from canonical
    order by provider_payment_id,verified_at,id
  ), filtered as materialized (
    select * from unique_payments where verified_at>=p_from and verified_at<p_to
      and (p_payer='all' or payer_type=p_payer)
  ), page_rows as (
    select * from filtered order by verified_at desc,id desc
    limit p_limit offset (p_page-1)*p_limit
  ) select jsonb_build_object(
    'payments',coalesce((select jsonb_agg(to_jsonb(r) order by r.verified_at desc,r.id desc) from page_rows r),'[]'::jsonb),
    'total',count(*),'total_cents',coalesce(sum(amount_cents),0),
    'trip_cents',coalesce(sum(amount_cents) filter(where payer_type='customer'),0),
    'commission_cents',coalesce(sum(amount_cents) filter(where payer_type='driver'),0),
    'page',p_page,'limit',p_limit
  ) into result from filtered;
  return result;
end $function$;
revoke all on function public.admin_verified_yoco_payments_report(timestamptz,timestamptz,text,integer,integer) from public,anon,authenticated;
grant execute on function public.admin_verified_yoco_payments_report(timestamptz,timestamptz,text,integer,integer) to service_role;
