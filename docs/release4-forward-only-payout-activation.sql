-- Apply only after the five certified Stage 2 migrations. No activation is performed here.
begin;

do $$ begin
  if not exists (select 1 from public.online_payout_policy where policy_key='manual-online-payouts')
    or exists (select 1 from public.online_driver_payables)
  then raise exception 'Forward-only payout baseline requires review'; end if;
end $$;

alter table public.online_payout_policy
  add column effective_at timestamptz,
  add column activation_reference text,
  add column activation_approved_by uuid references auth.users(id) on delete restrict,
  add column activation_recorded_at timestamptz,
  add constraint release4_activation_fields_complete check (
    (effective_at is null and activation_reference is null and activation_approved_by is null and activation_recorded_at is null)
    or (effective_at is not null and activation_reference is not null
      and length(trim(activation_reference)) between 3 and 200
      and activation_approved_by is not null and activation_recorded_at is not null));

create function public.release4_guard_payout_activation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'Payout activation is immutable'; end if;
  if old.effective_at is not null and (
    new.effective_at is distinct from old.effective_at or
    new.activation_reference is distinct from old.activation_reference or
    new.activation_approved_by is distinct from old.activation_approved_by or
    new.activation_recorded_at is distinct from old.activation_recorded_at)
  then raise exception 'Payout activation is immutable'; end if;
  if old.effective_at is null and new.effective_at is not null and
    new.effective_at < statement_timestamp() then
    raise exception 'Payout activation must not be backdated';
  end if;
  return new;
end $$;
create trigger release4_guard_payout_activation_trigger
  before update or delete on public.online_payout_policy
  for each row execute function public.release4_guard_payout_activation();

-- The existing one-argument posting function remains intact for the wrapper,
-- but can no longer be called directly through a service-role API client.
revoke execute on function public.phase3_post_completed_online_driver_payable(uuid) from service_role;

create function public.release4_post_forward_online_payable(
  p_trip_id uuid,p_expected_effective_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_effective_at timestamptz; v_trip public.trips;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Trusted server role required'; end if;
  select effective_at into v_effective_at from public.online_payout_policy
    where policy_key='manual-online-payouts';
  if v_effective_at is null or p_expected_effective_at is distinct from v_effective_at then
    raise exception 'Payout activation mismatch'; end if;
  select * into v_trip from public.trips where id=p_trip_id for update;
  if not found then raise exception 'Trip not found'; end if;
  if v_trip.status='completed' and v_trip.completed_at is not null and
    v_trip.completed_at<v_effective_at then
    return jsonb_build_object('result','HISTORICAL_EXCLUDED');
  end if;
  return public.phase3_post_completed_online_driver_payable(p_trip_id);
end $$;
revoke all on function public.release4_post_forward_online_payable(uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.release4_post_forward_online_payable(uuid,timestamptz)
  to service_role;

create function public.release4_guard_forward_payable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_effective_at timestamptz; v_completed_at timestamptz;
begin
  select effective_at into v_effective_at from public.online_payout_policy
    where policy_key='manual-online-payouts';
  select completed_at into v_completed_at from public.trips where id=new.trip_id;
  if v_effective_at is null or v_completed_at is null or v_completed_at<v_effective_at
    or new.earned_at is distinct from v_completed_at then
    raise exception 'Payable requires post-activation authoritative completion';
  end if;
  return new;
end $$;
create trigger release4_guard_forward_payable_trigger
  before insert or update on public.online_driver_payables
  for each row execute function public.release4_guard_forward_payable();

create function public.release4_guard_forward_payout_item()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_effective_at timestamptz; v_completed_at timestamptz;
begin
  select effective_at into v_effective_at from public.online_payout_policy
    where policy_key='manual-online-payouts';
  select t.completed_at into v_completed_at from public.online_driver_payables p
    join public.trips t on t.id=p.trip_id where p.id=new.payable_id;
  if v_effective_at is null or v_completed_at is null or v_completed_at<v_effective_at then
    raise exception 'Payout item requires post-activation completion';
  end if;
  return new;
end $$;
create trigger release4_guard_forward_payout_item_trigger
  before insert or update on public.online_payout_items
  for each row execute function public.release4_guard_forward_payout_item();

revoke all on function public.release4_guard_payout_activation(),
  public.release4_guard_forward_payable(),public.release4_guard_forward_payout_item()
  from public,anon,authenticated;
commit;
