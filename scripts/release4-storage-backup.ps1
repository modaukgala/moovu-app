param([switch]$Execute,[switch]$VerifyCredential,[switch]$VerifyListing,[long]$ExpectedCount,[long]$ExpectedBytes,[string]$CertifyArchiveName)
$ErrorActionPreference = 'Stop'
$worker = Join-Path $PSScriptRoot 'release4-storage-backup.mjs'
$node = (Get-Command node -ErrorAction Stop).Source
if (-not $Execute -and -not $VerifyCredential -and -not $VerifyListing -and -not $CertifyArchiveName) {
  & $node $worker '--preflight'
  exit $LASTEXITCODE
}
$operationCount = [int]$Execute.IsPresent + [int]$VerifyCredential.IsPresent + [int]$VerifyListing.IsPresent + [int][bool]$CertifyArchiveName
if ($operationCount -ne 1) { throw 'Choose one Storage operation.' }
& $node $worker '--preflight' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'STORAGE_BACKUP_PREFLIGHT_FAILED_BEFORE_SECRET_PROMPTS' }
if ($Execute -and ($ExpectedCount -lt 1 -or $ExpectedBytes -lt 1)) { throw 'STORAGE_BACKUP_CURRENT_READONLY_INVENTORY_REQUIRED' }
if ($CertifyArchiveName -and $CertifyArchiveName -notmatch '^storage-backup-\d{8}T\d{6}Z-[a-f0-9]{12}$') { throw 'STORAGE_ARCHIVE_NAME_INVALID' }
$serviceKey = if ($Execute -or $VerifyCredential -or $VerifyListing) { Read-Host 'Existing production Supabase service-role or secret key (private; never send to Codex)' -AsSecureString } else { $null }
$passphrase = if ($VerifyCredential -or $VerifyListing) { $null } else { Read-Host 'Storage backup encryption passphrase (20+ characters; keep separately)' -AsSecureString }
$keyPointer = [IntPtr]::Zero
$passPointer = [IntPtr]::Zero
try {
  if ($serviceKey) { $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($serviceKey) }
  if ($passphrase) { $passPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passphrase) }
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $node
  $start.WorkingDirectory = Split-Path -Parent $PSScriptRoot
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.ArgumentList.Add($worker)
  if ($Execute -or $VerifyCredential -or $VerifyListing) {
    if ($Execute) {
      $start.ArgumentList.Add('--backup')
      $start.ArgumentList.Add("--expected-count=$ExpectedCount")
      $start.ArgumentList.Add("--expected-bytes=$ExpectedBytes")
    } elseif ($VerifyListing) {
      $start.ArgumentList.Add('--list-check')
    } else {
      $start.ArgumentList.Add('--auth-check')
    }
    $start.Environment['MOOVU_STORAGE_SERVICE_ROLE_KEY'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  } else {
    $start.ArgumentList.Add('--certify')
    $start.ArgumentList.Add("--archive=$CertifyArchiveName")
  }
  if ($passphrase) { $start.Environment['MOOVU_STORAGE_BACKUP_PASSPHRASE'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passPointer) }
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
  if ($passphrase) { $passphrase.Dispose() }
}
