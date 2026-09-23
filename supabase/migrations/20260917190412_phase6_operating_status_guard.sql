create table public.phase6_operating_events (
 id uuid primary key default gen_random_uuid(),driver_id uuid not null references public.drivers(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,status text not null check(status in ('inactive','active')),
 reason text not null check(length(reason) between 8 and 2000),created_at timestamptz not null default now()
);
alter table public.phase6_operating_events enable row level security;
revoke all on public.phase6_operating_events from public,anon,authenticated;
grant all on public.phase6_operating_events to service_role;
create trigger phase6_operating_events_immutable before update or delete on public.phase6_operating_events for each row execute function public.phase6_immutable();
create function public.phase6_operating_status(p_actor uuid,p_driver uuid,p_status text,p_reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.drivers%rowtype;position jsonb;
begin
 perform public.phase6_actor(p_actor,true);
 if p_status not in ('inactive','active') or length(trim(coalesce(p_reason,''))) not between 8 and 2000 then raise exception 'Invalid operating action' using errcode='P0001';end if;
 select * into d from public.drivers where id=p_driver for update;
 if not found or coalesce(d.is_deleted,false) then raise exception 'Driver unavailable' using errcode='P0001';end if;
 if p_status='active' then
  if d.status not in ('approved','active','inactive') or d.verification_status<>'approved' or not coalesce(d.profile_completed,false) then raise exception 'Versioned approval required' using errcode='P0001';end if;
  position:=public.phase2_finance_eligibility(p_driver);
  if not coalesce((position->>'financially_eligible')::boolean,false) then raise exception 'Phase 2 eligibility required' using errcode='P0001';end if;
 end if;
 perform set_config('moovu.phase6_operating_driver',d.id::text,true);
 update public.drivers set status=p_status,updated_at=now() where id=d.id;
 if p_status='active' and not coalesce(public.phase6_new_work_eligible(d.id),false) then raise exception 'Driver re-registration required' using errcode='P0001';end if;
 insert into public.phase6_operating_events(driver_id,actor_id,status,reason) values(d.id,p_actor,p_status,p_reason);
end $$;
revoke all on function public.phase6_operating_status(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.phase6_operating_status(uuid,uuid,text,text) to service_role;
create or replace function public.phase6_legacy_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare driver_uuid uuid; authorized boolean; protected_change boolean;
begin
 if not exists(select 1 from public.phase6_policy where singleton and active) then return case when tg_op='DELETE' then old else new end;end if;
 driver_uuid:=(to_jsonb(old)->>case when tg_table_name='drivers' then 'id' else 'driver_id' end)::uuid;
 authorized:=exists(select 1 from public.phase6_applications a where a.driver_id=driver_uuid and a.id::text=current_setting('moovu.phase6_review_application',true) and a.status='UNDER_REVIEW');
 if authorized then return new;end if;
 if tg_op='DELETE' then raise exception 'Use the controlled retention workflow' using errcode='P0001';end if;
 if tg_table_name='drivers' then
  protected_change:=(to_jsonb(new)-array['lat','lng','last_seen','online','busy','updated_at','subscription_status','subscription_plan','subscription_expires_at','subscription_amount_due','subscription_last_paid_at','subscription_last_payment_amount']) is distinct from (to_jsonb(old)-array['lat','lng','last_seen','online','busy','updated_at','subscription_status','subscription_plan','subscription_expires_at','subscription_amount_due','subscription_last_paid_at','subscription_last_payment_amount']);
 else protected_change:=to_jsonb(new) is distinct from to_jsonb(old);end if;
 if tg_table_name='drivers' and tg_op='UPDATE' and current_setting('moovu.phase6_operating_driver',true)=driver_uuid::text and (to_jsonb(new)-array['status','updated_at'])=(to_jsonb(old)-array['status','updated_at']) then return new;end if;
 if protected_change then raise exception 'Use versioned onboarding review' using errcode='P0001';end if;
 return new;
end $$;

