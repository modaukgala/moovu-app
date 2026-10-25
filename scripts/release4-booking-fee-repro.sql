\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database() <> 'release4_finance_20261020' then
    raise exception 'The R3 reproduction requires the isolated Release 4 local clone';
  end if;
end $$;
select set_config('request.jwt.claim.role','service_role',true);

insert into public.phase5_policies(version,effective_from,currency,membership_price_cents,
  membership_days,go_service_fee_cents,go_xl_service_fee_cents,member_waiver_bps,
  referrer_reward_cents,referee_reward_cents,credit_expiry_days,automatic_renewal,
  referral_qualification,active)
values('release4-synthetic-only',now()-interval '1 day','ZAR',9900,30,300,500,10000,
  2000,1000,90,false,'FIRST_ELIGIBLE_COMPLETED_RIDE',false);

insert into public.trips(id,customer_id,driver_id,pickup_address,dropoff_address,status,
  completed_at,payment_method,fare_amount,final_fare,original_fare,ride_option,
  commission_amount,driver_net_earnings,phase5_policy_version,phase5_policy_effective_from,
  phase5_ride_fare_cents,phase5_service_fee_cents,phase5_membership_waiver_cents,
  phase5_credit_cents,phase5_customer_total_cents,phase5_driver_fare_basis_cents)
values('a4300000-0000-4000-8000-000000000003',
  'a4100000-0000-4000-8000-000000000001',
  'a4200000-0000-4000-8000-000000000001','Synthetic pickup','Synthetic destination',
  'completed',now(),'online',103,103,103,'go',15,85,
  'release4-synthetic-only',now()-interval '1 day',10000,300,0,0,10300,10000);

select public.phase5_post_service_fee('a4300000-0000-4000-8000-000000000003',
  'a4000000-0000-4000-8000-000000000001');
do $$ declare receivable_count integer; revenue_count integer; begin
  select count(*) into receivable_count
  from public.financial_ledger_entries e
  join public.financial_transactions t on t.id=e.transaction_id
  join public.financial_accounts a on a.id=e.account_id
  where t.idempotency_key='phase5:service-fee:a4300000-0000-4000-8000-000000000003'
    and a.account_category='COMMISSION_RECEIVABLE' and a.owner_type='DRIVER'
    and e.amount_cents=300 and e.entry_side='DEBIT';
  select count(*) into revenue_count
  from public.financial_ledger_entries e
  join public.financial_transactions t on t.id=e.transaction_id
  join public.financial_accounts a on a.id=e.account_id
  where t.idempotency_key='phase5:service-fee:a4300000-0000-4000-8000-000000000003'
    and a.account_category='BOOKING_FEE_REVENUE' and e.amount_cents=300
    and e.entry_side='CREDIT';
  if receivable_count<>1 or revenue_count<>1 then
    raise exception 'Expected Phase 5 R3 allocation path was not reproduced';
  end if;
end $$;
\echo CONNECTED_R3_ONLINE_DRIVER_RECEIVABLE_REPRODUCED
rollback;
