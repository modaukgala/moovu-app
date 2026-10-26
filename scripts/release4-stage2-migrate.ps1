param(
  [switch]$ExecuteProduction,
  [string]$CertificatePath = (Join-Path $env:USERPROFILE 'MOOVU Backup TLS\supabase-ca.crt')
)
$ErrorActionPreference = 'Stop'
$worker = Join-Path $PSScriptRoot 'release4-stage2-migrate.mjs'
$node = (Get-Command node -ErrorAction Stop).Source
if (-not $ExecuteProduction) {
  & $node $worker '--dry-run'
  exit $LASTEXITCODE
}
if (-not (Test-Path -LiteralPath $CertificatePath -PathType Leaf)) { throw 'STAGE2_PREFLIGHT_FAILED: TLS CA unavailable.' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'STAGE2_PREFLIGHT_FAILED: Docker unavailable.' }
$image = 'public.ecr.aws/supabase/postgres:17.11.0.004'
$null = & docker image inspect $image 2>$null
if ($LASTEXITCODE -ne 0) { throw 'STAGE2_PREFLIGHT_FAILED: PostgreSQL 17 image unavailable.' }
$password = Read-Host 'Production database password (private; never send to Codex)' -AsSecureString
$pointer = [IntPtr]::Zero
try {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
  $env:PGHOST = 'aws-1-eu-west-1.pooler.supabase.com'
  $env:PGPORT = '5432'
  $env:PGUSER = 'postgres.mvazbszenqahgqpznhhq'
  $env:PGDATABASE = 'postgres'
  $env:PGSSLMODE = 'verify-full'
  $env:PGSSLROOTCERT = (Get-Item -LiteralPath $CertificatePath).FullName
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $env:MOOVU_STAGE2_EXECUTION_APPROVED = 'true'
  & $node $worker '--execute-production'
  exit $LASTEXITCODE
} finally {
  foreach ($name in @('PGHOST','PGPORT','PGUSER','PGDATABASE','PGSSLMODE','PGSSLROOTCERT','PGPASSWORD','MOOVU_STAGE2_EXECUTION_APPROVED')) {
    Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
  }
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $password.Dispose()
}
