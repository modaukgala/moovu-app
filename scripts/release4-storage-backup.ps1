param([switch]$Execute,[long]$ExpectedCount,[long]$ExpectedBytes,[string]$CertifyArchiveName)
$ErrorActionPreference = 'Stop'
$worker = Join-Path $PSScriptRoot 'release4-storage-backup.mjs'
$node = (Get-Command node -ErrorAction Stop).Source
if (-not $Execute -and -not $CertifyArchiveName) {
  & $node $worker '--preflight'
  exit $LASTEXITCODE
}
if ($Execute -and $CertifyArchiveName) { throw 'Choose backup or restore certification, not both.' }
& $node $worker '--preflight' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'STORAGE_BACKUP_PREFLIGHT_FAILED_BEFORE_SECRET_PROMPTS' }
if ($Execute -and ($ExpectedCount -lt 1 -or $ExpectedBytes -lt 1)) { throw 'STORAGE_BACKUP_CURRENT_READONLY_INVENTORY_REQUIRED' }
if ($CertifyArchiveName -and $CertifyArchiveName -notmatch '^storage-backup-\d{8}T\d{6}Z-[a-f0-9]{12}$') { throw 'STORAGE_ARCHIVE_NAME_INVALID' }
$serviceKey = if ($Execute) { Read-Host 'Existing production Supabase service-role key (private; never send to Codex)' -AsSecureString } else { $null }
$passphrase = Read-Host 'Storage backup encryption passphrase (20+ characters; keep separately)' -AsSecureString
$keyPointer = [IntPtr]::Zero
$passPointer = [IntPtr]::Zero
try {
  if ($serviceKey) { $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($serviceKey) }
  $passPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passphrase)
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $node
  $start.WorkingDirectory = Split-Path -Parent $PSScriptRoot
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.ArgumentList.Add($worker)
  if ($Execute) {
    $start.ArgumentList.Add('--backup')
    $start.ArgumentList.Add("--expected-count=$ExpectedCount")
    $start.ArgumentList.Add("--expected-bytes=$ExpectedBytes")
    $start.Environment['MOOVU_STORAGE_SERVICE_ROLE_KEY'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  } else {
    $start.ArgumentList.Add('--certify')
    $start.ArgumentList.Add("--archive=$CertifyArchiveName")
  }
  $start.Environment['MOOVU_STORAGE_BACKUP_PASSPHRASE'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passPointer)
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $child = [Diagnostics.Process]::Start($start)
  $stdout = $child.StandardOutput.ReadToEndAsync()
  $stderr = $child.StandardError.ReadToEndAsync()
  $start.Environment.Remove('MOOVU_STORAGE_SERVICE_ROLE_KEY') | Out-Null
  $start.Environment.Remove('MOOVU_STORAGE_BACKUP_PASSPHRASE') | Out-Null
  $child.WaitForExit()
  [Console]::Out.Write($stdout.GetAwaiter().GetResult())
  [Console]::Error.Write($stderr.GetAwaiter().GetResult())
  if ($child.ExitCode -ne 0) { throw 'STORAGE_BACKUP_BLOCKED: See sanitized category above.' }
} finally {
  if ($keyPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer) }
  if ($passPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passPointer) }
  if ($serviceKey) { $serviceKey.Dispose() }
  $passphrase.Dispose()
}
