#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent -Path $PSScriptRoot
$launcherBaseName = -join @(
  [char]0xC2E4,
  [char]0xD589,
  [char]0xD558,
  [char]0xAE30
)
$stopperBaseName = -join @(
  [char]0xC885,
  [char]0xB8CC,
  [char]0xD558,
  [char]0xAE30
)
$launcher = Join-Path -Path $projectRoot -ChildPath "$launcherBaseName.ps1"
$stopper = Join-Path -Path $projectRoot -ChildPath "$stopperBaseName.ps1"
$pidFile = Join-Path -Path $projectRoot -ChildPath 'logs/app.pid'
$portFile = Join-Path -Path $projectRoot -ChildPath 'logs/app.port'
$failures = [System.Collections.Generic.List[string]]::new()

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    $failures.Add($Message)
  }
}

function Invoke-RalphtonPowerShellFile {
  param(
    [string]$FilePath,
    [string[]]$Arguments = @()
  )

  $argumentList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $FilePath) + $Arguments
  $output = @(& powershell @argumentList 2>&1)
  $exitCode = $LASTEXITCODE

  return [pscustomobject]@{
    ExitCode = [int]$exitCode
    Output = [string[]]@($output | ForEach-Object { [string]$_ })
  }
}

function Invoke-Launcher {
  # Use development mode for the process-lifecycle smoke test so the verifier is
  # not blocked by unrelated production-build failures in other tasks.
  return (Invoke-RalphtonPowerShellFile -FilePath $launcher -Arguments @('-NoBrowser', '-Dev'))
}

function Invoke-Stopper {
  param([string[]]$Arguments = @())

  return (Invoke-RalphtonPowerShellFile -FilePath $stopper -Arguments $Arguments)
}

function Confirm-RalphtonVerifierCleanupPid {
  param(
    [int]$StartedPid,
    [string]$CurrentPidText
  )

  if ($StartedPid -le 0) {
    throw 'Verifier did not capture a valid PID from its own launch.'
  }
  if ($CurrentPidText -notmatch '^\d+$') {
    throw 'Current PID metadata is invalid.'
  }

  $currentPid = [int]$CurrentPidText
  if ($currentPid -ne $StartedPid) {
    throw "PID metadata changed from verifier-owned PID $StartedPid to $currentPid."
  }

  return $StartedPid
}

if ($MyInvocation.InvocationName -eq '.') { return }

# The smoke test owns everything it creates. Existing PID/port metadata is never
# deleted or reused because it may identify a real application instance.
if ((Test-Path -LiteralPath $pidFile) -or (Test-Path -LiteralPath $portFile)) {
  throw 'Refusing to run Windows verification while PID or port metadata already exists. Stop the active app first; existing metadata was preserved.'
}

# The launcher searches ports 3000..3099 for a free one.
function Find-OccupiableSmokePort {
  $activePorts = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
    ForEach-Object { $_.Port }

  foreach ($port in 3000..3099) {
    if ($activePorts -contains $port) { continue }

    $listener = $null
    try {
      $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
      $listener.Start()
      $listener.Stop()
      return $port
    }
    catch {
      continue
    }
    finally {
      if ($listener) {
        try { $listener.Stop() } catch { }
      }
    }
  }

  throw 'No free port in 3000-3099 is available for the occupied-port smoke test.'
}

$occupiedPort = Find-OccupiableSmokePort
$listenerProc = $null
$dummyNodeProc = $null
$appPort = $null
$startedPid = $null
$launcherInvoked = $false

try {
  # Smoke: occupied port skip. Hold 3000 so the launcher must pick another port.
  $listenerScript = @"
`$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $occupiedPort)
`$listener.Start()
try {
  while (`$true) { Start-Sleep -Seconds 1 }
}
finally {
  `$listener.Stop()
}
"@
  $listenerEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($listenerScript))
  $listenerProc = Start-Process -FilePath 'powershell' -ArgumentList "-NoProfile -EncodedCommand $listenerEncoded" -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 2

  # Smoke: first browserless run starts the app on an available port.
  $launcherInvoked = $true
  $launchResult = Invoke-Launcher
  if (Test-Path -LiteralPath $pidFile) {
    $startedRaw = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    if ($startedRaw -match '^\d+$') {
      $startedPid = [int]$startedRaw
    }
  }

  Assert-True -Condition ($launchResult.ExitCode -eq 0) -Message "Launcher exit code was $($launchResult.ExitCode), expected 0. $($launchResult.Output -join ' ')"
  Assert-True -Condition (Test-Path -LiteralPath $pidFile) -Message 'PID file logs/app.pid was not created.'
  Assert-True -Condition (Test-Path -LiteralPath $portFile) -Message 'Port file logs/app.port was not created.'

  if ($launchResult.ExitCode -ne 0) {
    throw "First browserless launch failed; later smoke phases were skipped. $($launchResult.Output -join ' ')"
  }
  if (-not (Test-Path -LiteralPath $pidFile) -or -not (Test-Path -LiteralPath $portFile)) {
    throw 'First browserless launch returned success without complete PID/port metadata; later smoke phases were skipped.'
  }

  if (Test-Path -LiteralPath $portFile) {
    $appPort = (Get-Content -LiteralPath $portFile -Raw).Trim()
    Assert-True -Condition ($appPort -match '^\d+$') -Message "Port file contents are not numeric: $appPort"
    if ($appPort -match '^\d+$') {
      Assert-True -Condition ([int]$appPort -ne $occupiedPort) -Message "Launcher did not skip occupied port $occupiedPort; chose $appPort"
    }
  }

  if ($appPort -match '^\d+$') {
    try {
      $health = Invoke-WebRequest -Uri "http://127.0.0.1:$appPort/api/health" -UseBasicParsing -TimeoutSec 5
      Assert-True -Condition ($health.StatusCode -eq 200) -Message "Health check returned $($health.StatusCode)."
    }
    catch {
      Assert-True -Condition $false -Message "Health check failed: $_"
    }
  }

  # Smoke: duplicate run is blocked without changing the active PID metadata.
  $duplicateResult = Invoke-Launcher
  Assert-True -Condition ($duplicateResult.ExitCode -ne 0) -Message 'Duplicate launcher run was not blocked.'
  if ($startedPid -and (Test-Path -LiteralPath $pidFile)) {
    $duplicatePid = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    Assert-True -Condition ($duplicatePid -eq [string]$startedPid) -Message 'Duplicate launch changed the active PID metadata.'
  }

  # Smoke: another Node process must survive application shutdown.
  $dummyNodeProc = Start-Process -FilePath 'node' -ArgumentList '-e','setTimeout(()=>{},120000)' -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 1

  # Smoke: shutdown removes only owned app metadata after verified termination.
  $stopResult = Invoke-Stopper
  Assert-True -Condition ($stopResult.ExitCode -eq 0) -Message "Stopper exit code was $($stopResult.ExitCode), expected 0. $($stopResult.Output -join ' ')"
  Assert-True -Condition (-not (Test-Path -LiteralPath $pidFile)) -Message 'PID file was not removed after shutdown.'
  Assert-True -Condition (-not (Test-Path -LiteralPath $portFile)) -Message 'Port file was not removed after shutdown.'

  if ($appPort -match '^\d+$') {
    try {
      Invoke-WebRequest -Uri "http://127.0.0.1:$appPort/api/health" -UseBasicParsing -TimeoutSec 1 | Out-Null
      Assert-True -Condition $false -Message 'Health check still succeeded after shutdown.'
    }
    catch {
      # Expected: the server is no longer reachable.
    }
  }

  $dummyAlive = $null -ne (Get-CimInstance Win32_Process -Filter "ProcessId = $($dummyNodeProc.Id)" -ErrorAction SilentlyContinue)
  Assert-True -Condition $dummyAlive -Message 'An unrelated Node process was killed during shutdown.'
}
catch {
  $failures.Add("Windows smoke aborted: $($_.Exception.Message)")
}
finally {
  # Only ask the ownership-validating stopper to clean an instance launched by
  # this verifier. If it refuses or cannot kill, metadata is preserved.
  if ($launcherInvoked -and (Test-Path -LiteralPath $pidFile)) {
    $cleanupRaw = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    try {
      $null = Confirm-RalphtonVerifierCleanupPid -StartedPid ([int]$startedPid) -CurrentPidText $cleanupRaw
      $cleanupArguments = @('-ExpectedPid', $startedPid, '-AllowAlreadyExited', '-Quiet')
      $cleanupResult = Invoke-Stopper -Arguments $cleanupArguments
      if ($cleanupResult.ExitCode -ne 0) {
        $failures.Add("Cleanup stopper failed with exit code $($cleanupResult.ExitCode). Metadata was preserved. $($cleanupResult.Output -join ' ')")
      }
    }
    catch {
      $failures.Add("Cleanup refused changed or unproven PID metadata and preserved it: $($_.Exception.Message)")
    }
  }

  if ($listenerProc -and -not $listenerProc.HasExited) {
    Stop-Process -Id $listenerProc.Id -Force -ErrorAction SilentlyContinue
  }
  if ($dummyNodeProc -and -not $dummyNodeProc.HasExited) {
    Stop-Process -Id $dummyNodeProc.Id -Force -ErrorAction SilentlyContinue
  }
}

if ($failures.Count -gt 0) {
  Write-Host 'Windows launcher smoke tests FAILED:'
  foreach ($failure in $failures) {
    Write-Host "  - $failure"
  }
  exit 1
}

Write-Host 'Windows launcher smoke tests PASSED.'
