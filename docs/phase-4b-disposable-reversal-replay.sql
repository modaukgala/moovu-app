-- Disposable only. Release package includes this fix inline.
begin;
create or replace function public.phase4b_reverse_unpaid_assessment(p_assessment_id uuid,p_actor_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.phase4_fee_assessments;l public.phase4_customer_liabilities;
  c public.phase4_driver_compensations;v_original uuid;v_reversal uuid;v_result jsonb;v_now timestamptz;v_prior_reason text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required';end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('owner','admin'))
    then raise exception 'Owner/Admin required';end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Reversal reason required';end if;
  select * into a from public.phase4_fee_assessments where id=p_assessment_id;
  if not found then raise exception 'Assessment not found';end if;
  perform 1 from public.trips where id=a.trip_id for update;
  select * into l from public.phase4_customer_liabilities where assessment_id=a.id for update;
  select * into c from public.phase4_driver_compensations where assessment_id=a.id for update;
  if not found or l.id is null or c.id is null then raise exception 'Assessment projections incomplete';end if;
  select financial_transaction_id,reason into v_reversal,v_prior_reason from public.phase4_financial_actions
    where source_key='phase4:reversal:'||a.id;
  if found then
    if v_prior_reason<>trim(p_reason) then raise exception 'Conflicting reversal replay';end if;
    return jsonb_build_object('assessment_id',a.id,'reversal_transaction_id',v_reversal,'replayed',true);end if;
  if l.collected_cents<>0 or l.waived_cents<>0 or l.written_off_cents<>0
    or l.reversed_cents<>0 or c.settled_cents<>0 or c.status in ('SETTLED','CREDITED','REVERSED') then
    raise exception 'Unpaid, unsettled assessment required for this reversal';end if;
  select id into v_original from public.financial_transactions where source_type='PHASE4_ASSESSMENT'
    and source_id=a.id and transaction_state='POSTED' for update;
  if not found then raise exception 'Posted assessment transaction required';end if;
  v_now:=clock_timestamp();
  v_result:=public.phase1_reverse_financial_transaction(v_original,'phase4:reversal:'||a.id,
    encode(sha256(convert_to(a.id::text||':'||v_original::text||':'||trim(p_reason),'UTF8')),'hex'),
    p_actor_id,p_reason);
  v_reversal:=(v_result->>'transaction_id')::uuid;
  update public.phase4_customer_liabilities set open_cents=0,reversed_cents=original_cents,
    status='REVERSED',resolution_at=v_now,resolution_actor_id=p_actor_id,
    resolution_reason=trim(p_reason),updated_at=v_now where id=l.id;
  update public.phase4_driver_compensations set status='REVERSED',updated_at=v_now where id=c.id;
  insert into public.phase4_financial_actions(assessment_id,action_type,amount_cents,source_key,
    actor_id,reason,financial_transaction_id)
  values(a.id,'REVERSAL',a.fee_cents,'phase4:reversal:'||a.id,p_actor_id,trim(p_reason),v_reversal);
  if not exists(select 1 from public.phase4_customer_liabilities where customer_id=a.customer_id
    and status='OPEN' and open_cents>0) then
    update public.phase4_customer_grace_cycles set resolved_at=v_now
      where customer_id=a.customer_id and resolved_at is null;
  end if;
  return jsonb_build_object('assessment_id',a.id,'reversal_transaction_id',v_reversal,'replayed',false);
end $$;
commit;
