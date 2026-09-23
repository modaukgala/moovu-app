-- Qualified, explicit hold release; declining a request does not remove a hold.
alter table public.phase6_retention_events drop constraint phase6_retention_events_action_check;
alter table public.phase6_retention_events add check(action in ('REQUESTED','HELD','RELEASED','AUTHORIZED','DECLINED'));
create or replace function public.phase6_retention_command(p_actor uuid,p_key uuid,p_action text,p_reason text,p_request uuid default null,p_basis text default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d uuid;r public.phase6_retention_requests%rowtype;op public.phase6_operations%rowtype;payload jsonb;res jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' or p_key is null or length(trim(coalesce(p_reason,''))) not between 8 and 2000 then raise exception 'Invalid retention request' using errcode='P0001';end if;
 if p_action='REQUESTED' then
  if not exists(select 1 from auth.users where id=p_actor and deleted_at is null) or exists(select 1 from public.profiles where id=p_actor and role<>'driver') then raise exception 'Driver identity required' using errcode='P0001';end if;
  select driver_id into d from public.driver_accounts where user_id=p_actor;
  if d is null then raise exception 'Driver mapping required' using errcode='P0001';end if;
 else perform public.phase6_actor(p_actor,true);end if;
 payload:=jsonb_build_object('action',p_action,'request',p_request,'reason',p_reason,'basis',p_basis);
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text,6));
 select * into op from public.phase6_operations where actor_id=p_actor and operation_key=p_key;
 if found then if op.payload<>payload then raise exception 'Idempotency conflict' using errcode='P0001';end if;return op.result;end if;
 if p_action='REQUESTED' then
  insert into public.phase6_retention_requests(driver_id,actor_id,request_key,reason) values(d,p_actor,p_key,p_reason) returning * into r;
 else
  select * into r from public.phase6_retention_requests where id=p_request for update;
  if not found or r.status not in ('REQUESTED','HELD') or p_action not in ('HELD','RELEASED','AUTHORIZED','DECLINED') then raise exception 'Retention decision conflict' using errcode='P0001';end if;
  if p_action='AUTHORIZED' and (r.legal_hold or length(trim(coalesce(p_basis,'')))<8) then raise exception 'Qualified purpose and resolved hold required' using errcode='P0001';end if;
  if p_action='RELEASED' and (not r.legal_hold or length(trim(coalesce(p_basis,'')))<8) then raise exception 'Qualified hold release required' using errcode='P0001';end if;
  update public.phase6_retention_requests set status=case when p_action='RELEASED' then 'REQUESTED' else p_action end,legal_hold=case when p_action='HELD' then true when p_action='RELEASED' then false else r.legal_hold end,qualified_basis=p_basis where id=r.id returning * into r;
 end if;
 insert into public.phase6_retention_events(request_id,actor_id,action,reason,qualified_basis) values(r.id,p_actor,p_action,p_reason,p_basis);
 res:=to_jsonb(r);insert into public.phase6_operations(actor_id,operation_key,payload,result) values(p_actor,p_key,payload,res);
 return res;
end $$;
revoke all on function public.phase6_retention_command(uuid,uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.phase6_retention_command(uuid,uuid,text,text,uuid,text) to service_role;

