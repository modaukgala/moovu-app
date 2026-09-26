-- Run ONLY on tangtlmdpnvmoviwrgvd disposable database. All fixtures roll back.
begin;
set local request.jwt.claim.role='service_role';
do $test$
declare c uuid; d uuid; t uuid; a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); r jsonb; r2 jsonb;
begin
  select id into c from public.customers limit 1;
  select id into d from public.drivers limit 1;
  select id into t from public.trips where customer_id=c limit 1;
  insert into public.online_payment_attempts(id,customer_id,trip_id,provider,state,amount_cents,fare_version,locked_fare_snapshot,payload_hash,idempotency_key,provider_payment_id,verified_at)
  values(a,c,t,'YOCO','SUCCEEDED',7900,repeat(replace(a::text,'-',''),2),'{}',repeat('b',64),'report-test:'||a,'report-payment:'||a,'2041-01-02');
  insert into public.online_provider_events(provider,provider_event_id,payment_attempt_id,raw_event_type,raw_provider_status,body_sha256,trust_state,processing_state,verified_at,processed_at)
  select 'YOCO','report-test:'||a||':'||n,a,'payment.succeeded','succeeded',repeat('c',64),'VERIFIED','PROCESSED','2041-01-02','2041-01-02' from generate_series(1,2) n;
  insert into public.driver_online_payment_attempts(id,driver_id,provider,obligation_type,obligation_version,obligation_snapshot,amount_cents,state,payload_hash,idempotency_key,provider_payment_id,verified_at)
  values(b,d,'YOCO','COMMISSION_DEBT',repeat('d',64),'{}',5655,'SUCCEEDED',repeat('e',64),'report-test:'||b,'report-payment:'||b,'2041-01-03');
  insert into public.online_provider_events(provider,provider_event_id,driver_payment_attempt_id,raw_event_type,raw_provider_status,body_sha256,trust_state,processing_state,verified_at,processed_at)
  values('YOCO','report-test:'||b,b,'payment.succeeded','succeeded',repeat('f',64),'VERIFIED','PROCESSED','2041-01-03','2041-01-03');
  insert into public.online_payment_attempts(customer_id,trip_id,provider,state,amount_cents,fare_version,locked_fare_snapshot,payload_hash,idempotency_key)
  values(c,t,'YOCO','PENDING',100,repeat(replace(b::text,'-',''),2),'{}',repeat('b',64),'report-pending:'||a),
        (c,t,'YOCO','FAILED',100,repeat('a',64),'{}',repeat('b',64),'report-failed:'||a);
  r:=public.admin_verified_yoco_payments_report('2041-01-01','2041-02-01');
  if (r->>'total')::int<>2 or (r->>'trip_cents')::int<>7900 or (r->>'commission_cents')::int<>5655
    or (r->>'total_cents')::int<>13555 then raise exception 'Verified customer/driver, duplicate, exclusion or total invariant failed: %',r; end if;
  r:=public.admin_verified_yoco_payments_report('2041-01-01','2041-02-01','customer');
  if (r->>'total')::int<>1 or (r->>'total_cents')::int<>7900 then raise exception 'Payer filter failed'; end if;
  r:=public.admin_verified_yoco_payments_report('2041-01-01','2041-02-01','all',1,1);
  r2:=public.admin_verified_yoco_payments_report('2041-01-01','2041-02-01','all',2,1);
  if r->'payments'->0->>'id'=r2->'payments'->0->>'id' then raise exception 'Pagination duplicate'; end if;
  r:=public.admin_verified_yoco_payments_report('2041-01-04','2041-01-05');
  if (r->>'total')::int<>0 then raise exception 'Date filter failed'; end if;
  if has_function_privilege('anon','public.admin_verified_yoco_payments_report(timestamptz,timestamptz,text,integer,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.admin_verified_yoco_payments_report(timestamptz,timestamptz,text,integer,integer)','EXECUTE') then raise exception 'Direct client access'; end if;
end $test$;
select 'PASS: verified customer/driver, retry deduplication, pending/failed exclusion, cents reconciliation, date/payer filters, pagination, client RPC denial' as validation;
rollback;
