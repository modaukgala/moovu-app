-- READ ONLY. Run immediately before approved production recovery; stop on any guard failure.
begin read only;
set local statement_timeout='30s';
do $preflight$
begin
  if md5(replace(pg_get_functiondef('public.phase5_create_trip(uuid,uuid,text,jsonb,bigint,text,bigint)'::regprocedure),chr(13),''))<>'34d6dd39fac1d8cb1575a14b95eb3f74'
    or md5(replace(pg_get_functiondef('public.reserve_trip_offer(uuid,uuid,integer,integer,numeric,integer,numeric,jsonb,integer,integer,numeric)'::regprocedure),chr(13),''))<>'052109bd24d19fe0bb46aa67c73366a6' then
    raise exception 'P0 preflight: expected vulnerable RPC definitions changed';
  end if;
  if exists(select 1 from (values
      ('id','uuid','uuid_generate_v4()'),
      ('pickup_address','text',null),
      ('dropoff_address','text',null),
      ('payment_method','text','''cash''::text'),
      ('status','text','''requested''::text'),
      ('created_at','timestamptz','now()'),
      ('offer_attempted_driver_ids','_uuid','''{}''::uuid[]'),
      ('issue_reported','bool','false'),
      ('cancellation_fee_amount','numeric','0'),
      ('ride_type','text','''now''::text'),
      ('schedule_status','text','''none''::text'),
      ('dispatch_priority_score','numeric','0'),
      ('dispatch_cycle','int4','0'),
      ('dispatch_sequence','int4','0'),
      ('dispatch_state','text','''idle''::text'),
      ('completed_without_end_otp','bool','false'),
      ('financial_version','int8','0')
    ) expected(name,udt,default_expression) left join information_schema.columns c
      on c.table_schema='public' and c.table_name='trips' and c.column_name=expected.name
    where c.column_name is null or c.is_nullable<>'NO' or c.udt_name<>expected.udt
      or c.column_default is distinct from expected.default_expression) then
    raise exception 'P0 preflight: required trip columns/defaults changed';
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.trips'::regclass
      and contype='f' and confrelid='public.profiles'::regclass
      and pg_get_constraintdef(oid)='FOREIGN KEY (created_by) REFERENCES profiles(id)') then
    raise exception 'P0 preflight: created_by canonical FK changed';
  end if;
  if exists(select auth_user_id from public.customers group by auth_user_id having count(*)>1)
    or exists(select 1 from public.customers c left join auth.users u on u.id=c.auth_user_id where u.id is null) then
    raise exception 'P0 preflight: ambiguous or orphan Customer identity';
  end if;
  if not exists(select 1 from public.phase2_finance_policy where policy_key='phase2-driver-finance'
    and mode='AUTHORITATIVE' and authoritative_effective_from<=now() and not subscription_required
    and go_basis_points=1500 and go_xl_basis_points=1500 and debt_limit_cents=5000) then
    raise exception 'P0 preflight: current finance policy changed';
  end if;
  if exists(select 1 from pg_proc where oid in (
      'public.phase5_create_trip(uuid,uuid,text,jsonb,bigint,text,bigint)'::regprocedure,
      'public.reserve_trip_offer(uuid,uuid,integer,integer,numeric,integer,numeric,jsonb,integer,integer,numeric)'::regprocedure)
    and (not prosecdef or has_function_privilege('anon',oid,'EXECUTE')
      or has_function_privilege('authenticated',oid,'EXECUTE')
      or not has_function_privilege('service_role',oid,'EXECUTE'))) then
    raise exception 'P0 preflight: trusted RPC permissions changed';
  end if;
  if exists(select 1 from pg_class where oid in ('public.profiles'::regclass,'public.customers'::regclass,
    'public.trips'::regclass,'public.driver_trip_offers'::regclass) and not relrowsecurity) then
    raise exception 'P0 preflight: RLS changed';
  end if;
end $preflight$;
select jsonb_build_object(
  'checked_at',now(),
  'identity',(select jsonb_build_object('customers',count(*),'active',count(*) filter(where c.status='active'),
    'missing_profiles',count(*) filter(where p.id is null),'orphan_auth',count(*) filter(where u.id is null))
    from public.customers c left join public.profiles p on p.id=c.auth_user_id left join auth.users u on u.id=c.auth_user_id),
  'duplicate_auth_mappings',(select count(*) from (select auth_user_id from public.customers group by auth_user_id having count(*)>1) x),
  'rpc_definitions',(select jsonb_agg(jsonb_build_object('name',proname,'normalized_hash',md5(replace(pg_get_functiondef(oid),chr(13),'')),
      'acl',proacl,'search_path',proconfig)) from pg_proc where pronamespace='public'::regnamespace
    and proname in ('phase5_create_trip','reserve_trip_offer','accept_trip_offer','expire_due_trip_offers','phase05b_complete_trip','phase2_finance_eligibility')),
  'offer_history_columns',(select jsonb_agg(jsonb_build_object('name',column_name,'udt',udt_name,'nullable',is_nullable))
    from information_schema.columns where table_schema='public' and table_name='driver_trip_offers'
      and column_name in ('id','trip_id','driver_id','status','dispatch_cycle','accept_deadline_at')),
  'finance_policy',(select to_jsonb(p) from public.phase2_finance_policy p where policy_key='phase2-driver-finance')
) evidence;
commit;
