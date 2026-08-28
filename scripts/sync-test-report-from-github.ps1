# Optional: sync TMD test-report PNGs into a separate data dir.
# Prefer pointing MWI_TEST_REPORT_DIR at the repo checkout instead:
#   D:\mwi-guild-server\guild-trial-simulator\artifacts\test-report
#
# Private repo: requires GitHub auth via one of:
#   $env:GITHUB_TOKEN = "<pat with repo contents read>"
#   or `gh auth login` available on PATH
#
#   powershell -ExecutionPolicy Bypass -File D:\mwi-guild-server\guild-trial-simulator\scripts\sync-test-report-from-github.ps1

param(
  [string]$TargetDir = "D:\mwi-data\reports",
  [string]$Branch = "cursor/combat-readiness-default-skills-2ea1",
  [string]$Repo = "xiahuaaaa/mwi",
  [string]$RelativeDir = "guild-trial-simulator/artifacts/test-report"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

$files = @(
  "manifest.json",
  "1-jellyfish-summary.png",
  "1-jellyfish-members.png",
  "2-hedgehog-summary.png",
  "2-hedgehog-members.png"
)

function Get-GitHubRawUrl([string]$PathInRepo) {
  $api = "https://api.github.com/repos/$Repo/contents/$PathInRepo`?ref=$Branch"
  $headers = @{
    Accept = "application/vnd.github+json"
    "User-Agent" = "mwi-test-report-sync"
  }
  if ($env:GITHUB_TOKEN) {
    $headers.Authorization = "Bearer $($env:GITHUB_TOKEN)"
  } elseif (Get-Command gh -ErrorAction SilentlyContinue) {
    $token = (& gh auth token 2>$null)
    if ($token) { $headers.Authorization = "Bearer $token" }
  }
  if (-not $headers.Authorization) {
    throw "Private repo requires GITHUB_TOKEN or authenticated gh CLI."
  }
  $meta = Invoke-RestMethod -Uri $api -Headers $headers
  if (-not $meta.download_url) {
    throw "No download_url for $PathInRepo"
  }
  return $meta.download_url
}

foreach ($name in $files) {
  $pathInRepo = "$RelativeDir/$name"
  $url = Get-GitHubRawUrl $pathInRepo
  $out = Join-Path $TargetDir $name
  Write-Host "Downloading $name ..."
  $headers = @{ "User-Agent" = "mwi-test-report-sync" }
  Invoke-WebRequest -Uri $url -OutFile $out -Headers $headers -UseBasicParsing
  if ((Get-Item $out).Length -lt 100) {
    throw "Downloaded file is unexpectedly small: $out"
  }
}

Write-Host "OK -> $TargetDir"
Get-ChildItem $TargetDir | Select-Object Name, Length
Write-Host "Re-try QQ command: 本周分工"
