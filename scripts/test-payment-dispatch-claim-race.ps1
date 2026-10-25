param(
  [string]$Container = 'supabase_db_moovu-release4-local-cert-20261021',
  [string]$Database = 'moovu_dispatch_ownership_20261022'
)
$ErrorActionPreference = 'Stop'
$trip = [guid]::NewGuid().ToString()
$attempt = [guid]::NewGuid().ToString()
$owners = @([guid]::NewGuid().ToString(), [guid]::NewGuid().ToString())
$setup = @"
insert into public.trips(id,pickup_address,dropoff_address,payment_method,status,
  customer_id,ride_type,ride_option,pickup_lat,pickup_lng,fare_amount)
select '$trip'::uuid,'Synthetic pickup','Synthetic destination','online','requested',
  customer_id,'now','go',-26,28,100 from public.trips where customer_id is not null limit 1;
insert into public.online_payment_attempts(id,customer_id,trip_id,provider,amount_cents,
  currency,fare_version,locked_fare_snapshot,state,idempotency_key,payload_hash,verified_at)
select '$attempt'::uuid,customer_id,'$trip'::uuid,'FAKE_TEST',10000,'ZAR',
  repeat('a',64),'{}'::jsonb,'SUCCEEDED','claim-race:$attempt',repeat('b',64),now()
  from public.trips where id='$trip'::uuid;
"@
$setup | docker exec -i $Container psql -U postgres -d $Database -v ON_ERROR_STOP=1 -q
if ($LASTEXITCODE -ne 0) { throw 'LOCAL_FIXTURE_SETUP_FAILED' }
try {
  $jobs = foreach ($owner in $owners) {
    Start-Job -ArgumentList $Container,$Database,$attempt,$owner -ScriptBlock {
      param($containerName,$databaseName,$attemptId,$ownerId)
      docker exec $containerName psql -U postgres -d $databaseName -Atc "select outcome from public.claim_online_payment_dispatch('$attemptId'::uuid,'$ownerId'::uuid,120)"
      if ($LASTEXITCODE -ne 0) { throw 'LOCAL_CLAIM_FAILED' }
    }
  }
  $null = $jobs | Wait-Job
  $outcomes = @($jobs | ForEach-Object { Receive-Job $_ }) | Sort-Object
  if (($outcomes -join ',') -ne 'BUSY,START') {
    throw "LOCAL_CONCURRENT_CLAIM_FAILED: $($outcomes -join ',')"
  }
  Write-Output 'LOCAL_CONCURRENT_CLAIM_PASS: one START, one BUSY'
} finally {
  if ($jobs) { $jobs | Remove-Job -Force }
  # Phase 3 makes verified payment evidence immutable. The dedicated local
  # database is disposable; do not bypass that guard just to clean test rows.
  Write-Output 'Synthetic claim-race fixture retained in disposable local database.'
}
