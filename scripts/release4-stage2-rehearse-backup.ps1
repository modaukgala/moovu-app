param([switch]$Execute)
$ErrorActionPreference = 'Stop'
$worker = Join-Path $PSScriptRoot 'release4-stage2-rehearse-backup.mjs'
$node = (Get-Command node -ErrorAction Stop).Source
if (-not $Execute) {
  & $node $worker '--preflight'
  exit $LASTEXITCODE
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'STAGE2_REHEARSAL_PREFLIGHT_FAILED: Docker unavailable.' }
$secret = Read-Host 'Encrypted backup passphrase (private; never send to Codex)' -AsSecureString
$pointer = [IntPtr]::Zero
try {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  $env:MOOVU_STAGE2_BACKUP_PASSPHRASE = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  & $node $worker
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath 'Env:MOOVU_STAGE2_BACKUP_PASSPHRASE' -ErrorAction SilentlyContinue
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $secret.Dispose()
}
