$ErrorActionPreference = "Stop"

$HomeDir = [Environment]::GetFolderPath("UserProfile")
$RepoDir = Join-Path $HomeDir "xiaohongshu-cli"
$UvCandidates = @(
  (Join-Path $HomeDir ".local\bin\uv.exe"),
  "uv.exe",
  "uv"
)

function Find-Uv {
  foreach ($candidate in $UvCandidates) {
    try {
      $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
      if ($cmd) { return $cmd.Source }
    } catch {}
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

Write-Host ""
Write-Host "=== Xiaohongshu login helper ===" -ForegroundColor Yellow
Write-Host "This window is opened by Market Hub. Scan the QR code if prompted."
Write-Host ""

$Uv = Find-Uv
if (-not $Uv) {
  Write-Host "uv was not found. Please install uv first, then try again." -ForegroundColor Red
  Write-Host "Installer: https://docs.astral.sh/uv/getting-started/installation/"
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path $RepoDir)) {
  Write-Host "xiaohongshu-cli was not found at $RepoDir" -ForegroundColor Yellow
  Write-Host "Cloning https://github.com/jackwener/xiaohongshu-cli.git ..."
  git clone https://github.com/jackwener/xiaohongshu-cli.git $RepoDir
}

Set-Location $RepoDir

Write-Host ""
Write-Host "Checking current login status..." -ForegroundColor Cyan
& $Uv run xhs status --json
if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "Already logged in. You can return to Market Hub." -ForegroundColor Green
  Read-Host "Press Enter to close"
  exit 0
}

Write-Host ""
Write-Host "Starting QR login. Use Xiaohongshu mobile app to scan." -ForegroundColor Cyan
& $Uv run xhs login --qrcode

Write-Host ""
Write-Host "Checking login result..." -ForegroundColor Cyan
& $Uv run xhs status

Write-Host ""
Write-Host "If the status is authenticated, return to Market Hub and click refresh/check login." -ForegroundColor Green
Read-Host "Press Enter to close"
