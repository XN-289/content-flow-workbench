param(
  [switch]$Uninstall,
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"
$taskName = "Content Flow Workbench ($env:USERNAME)"

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed scheduled task: $taskName"
  exit 0
}

$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$server = Join-Path $repo "scripts/server.mjs"

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$server`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Runs the local Content Flow Workbench server for the current user." `
  -Force | Out-Null

if ($StartNow) {
  Start-ScheduledTask -TaskName $taskName
}

Write-Output "Installed scheduled task: $taskName"
Write-Output "Workbench: http://127.0.0.1:5177"
