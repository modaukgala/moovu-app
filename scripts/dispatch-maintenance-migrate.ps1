param([switch]$Execute, [string]$CertificatePath = (Join-Path $env:USERPROFILE 'MOOVU Backup TLS\supabase-ca.crt'))
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskNode = (Get-Command node -ErrorAction Stop).Source
if (-not $Execute) {
  & $taskNode (Join-Path $PSScriptRoot 'dispatch-maintenance-migrate.mjs') --dry-run
  exit $LASTEXITCODE
}
if (-not (Test-Path -LiteralPath $CertificatePath -PathType Leaf)) { throw 'MIGRATION_PREFLIGHT_FAILED: verified TLS CA unavailable.' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'MIGRATION_PREFLIGHT_FAILED: Docker unavailable.' }
$taskImage = 'public.ecr.aws/supabase/postgres:17.11.0.004'
$null = & docker image inspect $taskImage 2>$null
if ($LASTEXITCODE -ne 0) { throw 'MIGRATION_PREFLIGHT_FAILED: PostgreSQL 17 image unavailable.' }
$taskPassword = Read-Host 'Production database password (private; never send to Codex)' -AsSecureString
$taskPointer = [IntPtr]::Zero
try {
  $taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskPassword)
  $env:PGHOST = 'aws-1-eu-west-1.pooler.supabase.com'
  $env:PGPORT = '5432'
  $env:PGUSER = 'postgres.mvazbszenqahgqpznhhq'
  $env:PGDATABASE = 'postgres'
  $env:PGSSLMODE = 'verify-full'
  $env:PGSSLROOTCERT = (Get-Item -LiteralPath $CertificatePath).FullName
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer)
  $env:MOOVU_RELEASE_DOCKER_IMAGE = $taskImage
  $env:MOOVU_RELEASE_EXECUTION_APPROVED = 'true'
  & $taskNode (Join-Path $PSScriptRoot 'dispatch-maintenance-migrate.mjs') --execute
  exit $LASTEXITCODE
} finally {
  foreach ($taskName in @('PGHOST','PGPORT','PGUSER','PGDATABASE','PGSSLMODE','PGSSLROOTCERT','PGPASSWORD',
      'MOOVU_RELEASE_DOCKER_IMAGE','MOOVU_RELEASE_EXECUTION_APPROVED')) {
    Remove-Item -LiteralPath "Env:$taskName" -ErrorAction SilentlyContinue
  }
  if ($taskPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer) }
  $taskPassword.Dispose()
}
