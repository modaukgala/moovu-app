-- DISPOSABLE ONLY: tangtlmdpnvmoviwrgvd. All fixture/configuration changes roll back.
begin;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare d uuid;u uuid;t uuid;p uuid;position jsonb;before_finance jsonb;after_finance jsonb;failed boolean:=false;v4 jsonb;v5 jsonb;
begin
 select e.driver_id,e.user_id into d,u from public.phase6_enrollments e join auth.users a on a.id=e.user_id where a.email like 'phase6-%@example.invalid' and exists(select 1 from public.phase6_applications x where x.driver_id=e.driver_id and x.status='APPROVED') order by e.created_at desc limit 1;
 if d is null then raise exception 'Disposable approved fixture required';end if;
 select jsonb_agg(to_jsonb(x)) into v4 from public.phase4_policies x;
 select jsonb_agg(to_jsonb(x)) into v5 from public.phase5_policies x;
 update public.phase6_policy set active=false where singleton;
 update public.drivers set created_at='2025-01-01',status='approved',verification_status='approved',profile_completed=true,subscription_status='inactive',subscription_expires_at=null where id=d;
 update public.phase6_enrollments set completed_at=null,inspection_required=false where driver_id=d;
 update public.phase2_finance_policy set mode='AUTHORITATIVE',authoritative_effective_from=now()-interval '1 minute',subscription_required=false where policy_key='phase2-driver-finance' returning id into p;
 update public.phase6_policy set active=true,existing_effective_before=now(),new_work_effective_from=now()+interval '1 day' where singleton;
 if not public.phase6_new_work_eligible(d) then raise exception 'Existing approved grace failed';end if;
 insert into public.trips(driver_id,status,pickup_address,dropoff_address,fare_amount,final_fare,commission_amount,commission_pct) values(d,'assigned','Disposable fixture pickup','Disposable fixture dropoff',400,400,60,15) returning id into t;
 update public.phase6_policy set new_work_effective_from=now()-interval '1 second' where singleton;
 if public.phase6_new_work_eligible(d) then raise exception 'Incomplete deadline gate failed';end if;
 begin
  insert into public.trips(driver_id,status,pickup_address,dropoff_address) values(d,'assigned','Blocked fixture','Blocked fixture');
 exception when sqlstate 'P0001' then failed:=true;end;
 if not failed then raise exception 'Post-deadline new assignment bypass';end if;
 -- An already assigned trip progresses normally despite the new-work restriction.
 update public.trips set status='arrived' where id=t;
 update public.trips set status='ongoing' where id=t;
 update public.trips set status='completed' where id=t;
 if not exists(select 1 from public.trips where id=t and status='completed' and driver_id=d) then raise exception 'Active-trip completion interrupted';end if;
 update public.phase6_enrollments set completed_at=now() where driver_id=d;
 if not public.phase6_new_work_eligible(d) then raise exception 'Completed enrollment should pass';end if;
 update public.phase6_enrollments set inspection_required=true where driver_id=d;
 if public.phase6_new_work_eligible(d) then raise exception 'Event inspection hold bypass';end if;
 update public.phase6_enrollments set inspection_required=false where driver_id=d;
 if not exists(select 1 from public.trips where id=t and commission_basis_points=1500 and commission_policy_id=p and commission_rounding_version='integer-cent-half-up-v1') then raise exception 'Locked Phase 2 snapshot missing';end if;
 perform public.phase2_post_trip_commission(t,u);
 position:=public.phase2_finance_eligibility(d);
 if (position->>'net_owed_cents')::bigint<5000 or (position->>'financially_eligible')::boolean then raise exception 'R50 finance restriction failed';end if;
 if not public.phase6_new_work_eligible(d) then raise exception 'Phase 6 should not replace independent finance gate';end if;
 before_finance:=public.phase2_driver_finance_position(d);
 -- Eligibility/re-registration reads must not reset debt, credit or accounts.
 perform public.phase6_new_work_eligible(d);
 after_finance:=public.phase2_driver_finance_position(d);
 if before_finance<>after_finance then raise exception 'Phase 6 changed finance';end if;
 if (select jsonb_agg(to_jsonb(x)) from public.phase4_policies x) is distinct from v4 or (select jsonb_agg(to_jsonb(x)) from public.phase5_policies x) is distinct from v5 then raise exception 'Phase 4/5 policy changed';end if;
end $$;
rollback;
