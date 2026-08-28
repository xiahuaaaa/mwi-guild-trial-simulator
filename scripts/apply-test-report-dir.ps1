# Point QQ Bot (and optional API) at repo artifacts/test-report, then restart.
# Run on the Windows bot host (PowerShell as the logged-in service user):
#
#   powershell -ExecutionPolicy Bypass -File D:\mwi-guild-server\guild-trial-simulator\scripts\apply-test-report-dir.ps1
#
# If the checkout root is D:\mwi-guild-server (not monorepo):
#   powershell -ExecutionPolicy Bypass -File D:\mwi-guild-server\scripts\apply-test-report-dir.ps1 -ServerRoot D:\mwi-guild-server

param(
  [string]$ServerRoot = "D:\mwi-guild-server",
  [string]$EnvFile = "D:\mwi-data\config\qq-bot.env",
  [string]$ApiEnvFile = "D:\mwi-data\config\api.env",
  [switch]$SkipApiEnv,
  [switch]$SkipRestart
)

$ErrorActionPreference = "Stop"

$candidates = @(
  (Join-Path $ServerRoot "guild-trial-simulator\artifacts\test-report"),
  (Join-Path $ServerRoot "artifacts\test-report")
)
$reportDir = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $reportDir) {
  throw "artifacts/test-report not found under $ServerRoot. git pull the PR branch first."
}

$manifest = Join-Path $reportDir "manifest.json"
if (-not (Test-Path $manifest)) {
  throw "Missing $manifest"
}
$pngs = @(
  "1-jellyfish-summary.png",
  "1-jellyfish-members.png",
  "2-hedgehog-summary.png",
  "2-hedgehog-members.png"
) | ForEach-Object { Join-Path $reportDir $_ }
foreach ($png in $pngs) {
  if (-not (Test-Path $png)) { throw "Missing $png" }
}

function Set-EnvKey([string]$Path, [string]$Key, [string]$Value) {
  if (-not (Test-Path $Path)) {
    throw "Env file not found: $Path"
  }
  $lines = Get-Content -LiteralPath $Path -Encoding UTF8
  $found = $false
  $next = foreach ($line in $lines) {
    if ($line -match ("^\s*" + [regex]::Escape($Key) + "\s*=")) {
      $found = $true
      "$Key=$Value"
    } else {
      $line
    }
  }
  if (-not $found) {
    $next = @($next) + "$Key=$Value"
  }
  Set-Content -LiteralPath $Path -Value $next -Encoding UTF8
  Write-Host "Updated $Path -> $Key=$Value"
}

Set-EnvKey -Path $EnvFile -Key "MWI_TEST_REPORT_DIR" -Value $reportDir
if (-not $SkipApiEnv -and (Test-Path $ApiEnvFile)) {
  Set-EnvKey -Path $ApiEnvFile -Key "MWI_TEST_REPORT_DIR" -Value $reportDir
}

Write-Host "Report dir OK: $reportDir"
Get-ChildItem -LiteralPath $reportDir | Select-Object Name, Length | Format-Table -AutoSize

if (-not $SkipRestart) {
  Write-Host "Restarting MWI-Guild-QQBot ..."
  schtasks /Run /TN "MWI-Guild-QQBot" | Out-Host
  Start-Sleep -Seconds 3
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8790/health" -TimeoutSec 5
    Write-Host ("QQ Bot health: " + ($health | ConvertTo-Json -Compress))
  } catch {
    Write-Host "QQ Bot health check failed (service may still be starting): $_"
  }
}

Write-Host "Done. Retry QQ command: 本周分工"
