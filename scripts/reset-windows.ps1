<#
.SYNOPSIS
  ComfyUI Desktop 2.0 -- Windows reset script

.DESCRIPTION
  Wipes app settings, caches, and the Chromium profile for the current build
  AND for the older beta names (ComfyUI Launcher / comfyui-launcher), in case
  leftovers from a previous version are breaking the UI (no styles, no i18n,
  dropdowns not working, etc.) after a manual update.

  Does NOT touch your actual ComfyUI installs at %USERPROFILE%\ComfyUI-Installs.
  The script DOES remove installations.json (the registry), so you may need to
  re-add existing installs via "Add existing installation" on first launch.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\reset-windows.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\reset-windows.ps1 -Yes
#>
[CmdletBinding()]
param(
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'

$runningNames = @(
  'Comfy Desktop',
  'ComfyUI Desktop 2.0',
  'ComfyUI Launcher',
  'comfyui-desktop-2',
  'comfyui-launcher'
)
$running = Get-Process -Name $runningNames -ErrorAction SilentlyContinue
if ($running) {
  Write-Host "Comfy Desktop / Launcher is running. Please quit it first,"
  Write-Host "then re-run this script."
  exit 1
}

$appNames = @(
  'ComfyUI',
  'Comfy Desktop',
  'ComfyUI Desktop 2.0',
  'ComfyUI Launcher',
  'comfyui-desktop-2',
  'comfyui-launcher'
)

$roots = @(
  $env:APPDATA,
  $env:LOCALAPPDATA
)

$targets = New-Object System.Collections.Generic.List[string]
foreach ($root in $roots) {
  if (-not $root) { continue }
  foreach ($name in $appNames) {
    $targets.Add((Join-Path $root $name))
    $targets.Add((Join-Path $root ($name + '-updater')))
  }
}

$existing = @($targets | Where-Object { Test-Path -LiteralPath $_ })

if ($existing.Count -eq 0) {
  Write-Host "Nothing to remove. No ComfyUI Desktop 2.0 / Launcher data found."
  exit 0
}

Write-Host "The following will be permanently deleted:"
Write-Host ""
foreach ($t in $existing) {
  Write-Host "  $t"
}
Write-Host ""
Write-Host "Your ComfyUI installs at $env:USERPROFILE\ComfyUI-Installs will NOT be touched."
Write-Host "(You may need to re-add them via 'Add existing installation' on first launch.)"
Write-Host ""

if (-not $Yes) {
  $reply = Read-Host "Proceed? [y/N]"
  if ($reply -notmatch '^(y|Y|yes|YES)$') {
    Write-Host "Aborted."
    exit 1
  }
}

foreach ($t in $existing) {
  Write-Host "Removing: $t"
  Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction Continue
}

Write-Host ""
Write-Host "Done. Reinstall ComfyUI Desktop 2.0 from the latest installer if you"
Write-Host "haven't already, then launch it. The app should come up with a clean"
Write-Host "profile."
