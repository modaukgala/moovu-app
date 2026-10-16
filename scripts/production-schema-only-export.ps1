param(
  [string]$CertificatePath = (Join-Path $env:USERPROFILE 'MOOVU Backup TLS\supabase-ca.crt')
)
$ErrorActionPreference = 'Stop'
$taskRef = 'mvazbszenqahgqpznhhq'
$taskDirectory = Join-Path $env:USERPROFILE 'MOOVU Secure Backups'
$taskImage = 'public.ecr.aws/supabase/postgres:17.11.0.004'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'SCHEMA_EXPORT_PREFLIGHT_FAILED: Docker CLI is unavailable.' }
$null = & docker image inspect $taskImage 2>$null
if ($LASTEXITCODE -ne 0) { throw 'SCHEMA_EXPORT_PREFLIGHT_FAILED: local PostgreSQL 17 image is unavailable.' }
$taskVersion = (& docker run --rm --entrypoint=pg_dump $taskImage --version 2>$null | Out-String)
if ($LASTEXITCODE -ne 0 -or $taskVersion -notmatch '\b17\.\d+\b') { throw 'SCHEMA_EXPORT_PREFLIGHT_FAILED: PostgreSQL 17 pg_dump is required.' }
if (-not (Test-Path -LiteralPath $CertificatePath -PathType Leaf)) { throw 'SCHEMA_EXPORT_PREFLIGHT_FAILED: Supabase CA certificate is unavailable.' }
if (-not (Test-Path -LiteralPath $taskDirectory -PathType Container)) { throw 'SCHEMA_EXPORT_PREFLIGHT_FAILED: protected backup directory is unavailable.' }

$taskIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskAllowedSids = @($taskIdentity, 'S-1-5-18', 'S-1-5-32-544')
foreach ($taskRule in (Get-Acl -LiteralPath $taskDirectory).Access) {
  $taskRuleSid = $taskRule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  if ($taskRule.AccessControlType -eq 'Allow' -and $taskRuleSid -notin $taskAllowedSids) {
    throw 'SCHEMA_EXPORT_PREFLIGHT_FAILED: backup directory permits an unexpected identity.'
  }
}

$taskName = 'moovu-' + $taskRef + '-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + '-schema-only.dump'
$taskFinal = Join-Path $taskDirectory $taskName
$taskPartial = $taskFinal + '.partial'
if ((Test-Path -LiteralPath $taskFinal) -or (Test-Path -LiteralPath $taskPartial)) {
  throw 'SCHEMA_EXPORT_PREFLIGHT_FAILED: output name already exists.'
}

$taskPassword = Read-Host 'Existing production DATABASE password (private; never send to Codex)' -AsSecureString
$taskPointer = [IntPtr]::Zero
try {
  $taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskPassword)
  $taskStart = [Diagnostics.ProcessStartInfo]::new()
  $taskStart.FileName = (Get-Command docker).Source
  $taskStart.UseShellExecute = $false
  $taskStart.CreateNoWindow = $true
  $taskStart.RedirectStandardInput = $true
  $taskStart.RedirectStandardOutput = $true
  $taskStart.RedirectStandardError = $true
  $taskMountDirectory = 'type=bind,source=' + $taskDirectory + ',target=/output'
  $taskMountCertificate = 'type=bind,source=' + (Get-Item -LiteralPath $CertificatePath).FullName + ',target=/run/ca.crt,readonly'
  foreach ($taskArg in @('run', '--rm', '-i', '--mount', $taskMountDirectory,
      '--mount', $taskMountCertificate, '--entrypoint=sh',
      '--env', 'PGHOST=aws-1-eu-west-1.pooler.supabase.com', '--env', 'PGPORT=5432',
      '--env', ('PGUSER=postgres.' + $taskRef), '--env', 'PGDATABASE=postgres',
      '--env', 'PGSSLMODE=verify-full', '--env', 'PGSSLROOTCERT=/run/ca.crt',
      '--env', 'PGCONNECT_TIMEOUT=15', '--env', 'PGAPPNAME=moovu-readonly-schema-export',
      '--env', 'PGOPTIONS=-c default_transaction_read_only=on -c lock_timeout=5000',
      '--env', 'PGPASSFILE=/run/nonexistent-pgpass', $taskImage, '-c',
      'IFS= read -r PGPASSWORD || exit 1; export PGPASSWORD; exec pg_dump "$@"',
      'schema-export', '--format=custom', '--schema-only', '--strict-names',
      '--lock-wait-timeout=5s', '--schema=public', '--schema=private', '--schema=auth',
      '--schema=storage', '--schema=supabase_migrations', '--schema=extensions',
      ('--file=/output/' + $taskName + '.partial'))) {
    $taskStart.ArgumentList.Add($taskArg)
  }
  $taskProcess = [Diagnostics.Process]::Start($taskStart)
  $taskProcess.StandardInput.WriteLine([Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer))
  $taskProcess.StandardInput.Close()
  $taskOutput = $taskProcess.StandardOutput.ReadToEndAsync()
  $taskError = $taskProcess.StandardError.ReadToEndAsync()
  $taskProcess.WaitForExit()
  # Never surface raw pg_dump output. The owner only receives this sanitized result.
  $null = $taskOutput.GetAwaiter().GetResult()
  $null = $taskError.GetAwaiter().GetResult()
  if ($taskProcess.ExitCode -ne 0) { throw 'SCHEMA_EXPORT_FAILED: read-only pg_dump did not complete.' }
  $taskItem = Get-Item -LiteralPath $taskPartial -ErrorAction Stop
  if ($taskItem.Length -eq 0) { throw 'SCHEMA_EXPORT_FAILED: empty schema archive.' }
  Move-Item -LiteralPath $taskPartial -Destination $taskFinal
  $taskHash = (Get-FileHash -LiteralPath $taskFinal -Algorithm SHA256).Hash
  Write-Output ([pscustomobject]@{ status = 'SCHEMA_ONLY_EXPORT_READY'; sourceProject = $taskRef;
      filename = $taskName; size = (Get-Item -LiteralPath $taskFinal).Length; sha256 = $taskHash;
      productionMutated = $false; tableDataIncluded = $false } | ConvertTo-Json -Compress)
} finally {
  if ($taskPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer) }
  $taskPassword.Dispose()
}
