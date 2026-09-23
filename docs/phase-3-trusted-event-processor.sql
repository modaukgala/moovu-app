-- Phase 3 trusted normalized event processor. The caller MUST authenticate the
-- provider event before invoking this service-role-only function.
-- Production installation requires a separate review and approval.
begin;

create or replace function public.phase3_process_trusted_payment_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_raw_status text,
  p_body_sha256 text,
  p_checkout_id text,
  p_payment_id text,
  p_amount_cents bigint,
  p_currency text,
  p_outcome text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_event public.online_provider_events;
  v_attempt public.online_payment_attempts;
  v_clearing public.financial_accounts;
  v_funds public.financial_accounts;
  v_post jsonb;
  v_reason text;
  v_entries jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted server role required';
  end if;
  if p_provider not in ('YOCO','FAKE_TEST') or length(trim(coalesce(p_event_id,'')))<3
    or p_body_sha256 !~ '^[a-f0-9]{64}$'
    or p_outcome not in ('SUCCEEDED','FAILED')
    or length(trim(coalesce(p_payment_id,'')))<3
  then raise exception 'Invalid normalized provider event'; end if;

  -- Resolve the immutable attempt link before the event row is inserted.
  select * into v_attempt from public.online_payment_attempts
  where provider=p_provider and provider_checkout_id=p_checkout_id;
  insert into public.online_provider_events(
    provider,provider_event_id,payment_attempt_id,raw_event_type,raw_provider_status,
    body_sha256,trust_state,processing_state,verified_at
  ) values (
    p_provider,p_event_id,v_attempt.id,p_event_type,p_raw_status,
    p_body_sha256,'VERIFIED','RECEIVED',now()
  ) on conflict(provider,provider_event_id) do nothing;

  select * into strict v_event from public.online_provider_events
  where provider=p_provider and provider_event_id=p_event_id for update;
  if v_event.body_sha256<>p_body_sha256 then
    raise exception 'Conflicting provider event replay';
  end if;
  if v_event.processing_state='PROCESSED' then
    return jsonb_build_object('result','REPLAYED','payment_attempt_id',v_event.payment_attempt_id);
  end if;
  if v_event.processing_state='RECONCILIATION_REQUIRED' then
    return jsonb_build_object('result','RECONCILIATION_REQUIRED','replayed',true);
  end if;

  -- Checkout and payment identifiers must identify the same attempt.
  select * into v_attempt from public.online_payment_attempts
  where provider=p_provider and provider_checkout_id=p_checkout_id
  for update;
  if not found then
    insert into public.online_payment_reconciliation_items(
      provider_settlement_reference,issue_type,metadata
    ) values (p_event_id,'ORPHAN_PROVIDER_PAYMENT',
      jsonb_build_object('provider',p_provider,'checkout_id',p_checkout_id,'payment_id',p_payment_id));
    update public.online_provider_events set
      processing_state='RECONCILIATION_REQUIRED',processing_attempts=processing_attempts+1,
      last_error='ORPHAN_PROVIDER_PAYMENT'
    where id=v_event.id;
    return jsonb_build_object('result','RECONCILIATION_REQUIRED','reason','ORPHAN_PROVIDER_PAYMENT');
  end if;

  if v_attempt.provider_payment_id is not null
   and v_attempt.provider_payment_id is distinct from p_payment_id then
    v_reason:='PROVIDER_PAYMENT_REFERENCE_MISMATCH';
  elsif v_attempt.amount_cents is distinct from p_amount_cents then
    v_reason:='AMOUNT_MISMATCH';
  elsif v_attempt.currency is distinct from p_currency then
    v_reason:='CURRENCY_MISMATCH';
  elsif v_attempt.state not in ('CREATED','PENDING') then
    v_reason:='INVALID_PAYMENT_STATE';
  end if;

  if v_reason is not null then
    insert into public.online_payment_reconciliation_items(
      payment_attempt_id,provider_settlement_reference,issue_type,
      expected_amount_cents,actual_amount_cents,metadata
    ) values (
      v_attempt.id,p_event_id,v_reason,v_attempt.amount_cents,
      case when p_amount_cents>=0 then p_amount_cents else null end,
      jsonb_build_object('provider',p_provider,'checkout_id',p_checkout_id,'payment_id',p_payment_id,'currency',p_currency)
    );
    update public.online_provider_events set payment_attempt_id=v_attempt.id,
      processing_state='RECONCILIATION_REQUIRED',processing_attempts=processing_attempts+1,
      last_error=v_reason where id=v_event.id;
    if v_attempt.state in ('CREATED','PENDING') then
      update public.online_payment_attempts set state='RECONCILIATION_REQUIRED',
        reconciliation_state='RECONCILIATION_REQUIRED',updated_at=now()
      where id=v_attempt.id;
    end if;
    return jsonb_build_object('result','RECONCILIATION_REQUIRED','reason',v_reason,
      'payment_attempt_id',v_attempt.id);
  end if;

  if p_outcome='FAILED' then
    update public.online_payment_attempts set state='FAILED',raw_provider_state=p_raw_status,
      updated_at=now() where id=v_attempt.id;
  else
    v_clearing:=public.phase1_ensure_financial_account(
      'PAYMENT_CLEARING','PAYMENT_CLEARING','PLATFORM',null,'DEBIT','ZAR');
    v_funds:=public.phase1_ensure_financial_account(
      'PLATFORM:CUSTOMER_FUNDS_LIABILITY:ZAR','UNAPPLIED_FUNDS','PLATFORM',null,'CREDIT','ZAR');
    v_entries:=jsonb_build_array(
      jsonb_build_object('account_id',v_clearing.id,'entry_side','DEBIT','amount_cents',v_attempt.amount_cents),
      jsonb_build_object('account_id',v_funds.id,'entry_side','CREDIT','amount_cents',v_attempt.amount_cents)
    );
    v_post:=public.phase1_post_financial_transaction(
      'online_payment:'||v_attempt.id::text,
      encode(extensions.digest(v_attempt.id::text||':'||v_attempt.amount_cents::text||':ZAR','sha256'),'hex'),
      'ONLINE_PAYMENT','TRIP',v_attempt.trip_id,'ZAR','SYSTEM',null,now(),
      v_entries,jsonb_build_object('payment_attempt_id',v_attempt.id,'provider',p_provider),null
    );
    update public.online_payment_attempts set state='SUCCEEDED',verified_at=now(),
      payment_ledger_transaction_id=(v_post->>'transaction_id')::uuid,
      provider_payment_id=p_payment_id,raw_provider_state=p_raw_status,
      reconciliation_state='MATCHED',updated_at=now()
    where id=v_attempt.id;
  end if;

  update public.online_provider_events set payment_attempt_id=v_attempt.id,
    processing_state='PROCESSED',processed_at=now(),processing_attempts=processing_attempts+1
  where id=v_event.id;
  return jsonb_build_object('result',p_outcome,'payment_attempt_id',v_attempt.id,
    'ledger_transaction_id',v_post->>'transaction_id');
end $$;

revoke all on function public.phase3_process_trusted_payment_event(
  text,text,text,text,text,text,text,bigint,text,text
) from public,anon,authenticated;
grant execute on function public.phase3_process_trusted_payment_event(
  text,text,text,text,text,text,text,bigint,text,text
) to service_role;

commit;
