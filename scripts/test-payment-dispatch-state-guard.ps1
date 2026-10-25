param([string]$Container = 'supabase_db_moovu-release4-local-cert-20261021')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$migration = Get-Content -LiteralPath (Join-Path $root 'supabase/migrations/20261022120000_online_payment_dispatch_terminal_guard.sql') -Raw
$before = @'
\set ON_ERROR_STOP on
begin;
set local statement_timeout='10s';
set local lock_timeout='2s';
'@
$after = @'
do $$
declare v_attempt uuid; v_state text; v_rejected boolean:=false;
begin
  select id into strict v_attempt from public.online_payment_attempts limit 1;
  update public.online_payment_attempts set state='SUCCEEDED',dispatch_state='PENDING'
    where id=v_attempt;
  update public.online_payment_attempts set dispatch_state='FAILED' where id=v_attempt;
  update public.online_payment_attempts set dispatch_state='DISPATCHED' where id=v_attempt;
  begin
    update public.online_payment_attempts set dispatch_state='FAILED' where id=v_attempt;
  exception when check_violation then
    v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Stale failure was not rejected'; end if;
  select dispatch_state into v_state from public.online_payment_attempts where id=v_attempt;
  if v_state<>'DISPATCHED' then raise exception 'Dispatched state regressed'; end if;
  update public.online_payment_attempts set dispatch_state='DISPATCHED' where id=v_attempt;
  update public.online_payment_attempts set dispatch_last_error=null where id=v_attempt;
  raise notice 'TERMINAL_GUARD_OLD_AND_NEW_UPDATE_CONTRACT_PASS';
end $$;
rollback;
'@
$inputSql = $before + [Environment]::NewLine + $migration + [Environment]::NewLine + $after
$inputSql | docker exec -i $Container psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q
if ($LASTEXITCODE -ne 0) { throw 'LOCAL_GUARD_TEST_FAILED' }
Write-Output 'LOCAL_GUARD_TEST_PASS_ROLLED_BACK'
