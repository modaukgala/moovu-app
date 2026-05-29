param(
  [switch]$Prod = $true
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$linkPath = Join-Path $root ".vercel\project.json"
if (!(Test-Path $linkPath)) {
  throw "Missing .vercel/project.json. Run: npx vercel link --project moovu-app"
}

$link = Get-Content $linkPath -Raw | ConvertFrom-Json
if ($link.projectName -ne "moovu-app") {
  throw "Wrong Vercel project link: '$($link.projectName)'. Expected 'moovu-app'."
}

npm run lint
npx tsc --noEmit
npm run build

if ($Prod) {
  npx vercel deploy --prod --yes
} else {
  npx vercel deploy --yes
}
