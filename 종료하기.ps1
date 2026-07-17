#Requires -Version 5.1
[CmdletBinding()]
param(
  [int]$ExpectedPid,
  [switch]$AllowAlreadyExited,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

function Get-RalphtonOwnerToken {
  return 'ralphton-task10-server-v1'
}

function Get-RalphtonLauncherFileName {
  $baseName = -join @(
    [char]0xC2E4,
    [char]0xD589,
    [char]0xD558,
    [char]0xAE30
  )
  return "$baseName.ps1"
}

function Get-RalphtonProcessById {
  param([int]$ProcessId)

  return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue)
}

function Test-RalphtonProcessExists {
  param([int]$ProcessId)

  return ($null -ne (Get-RalphtonProcessById -ProcessId $ProcessId))
}

function ConvertFrom-RalphtonWindowsCommandLine {
  param([string]$CommandLine)

  if ([string]::IsNullOrWhiteSpace($CommandLine)) { return @() }

  if (-not ('Ralphton.NativeCommandLine' -as [type])) {
    $typeDefinition = @'
using System;
using System.Runtime.InteropServices;

namespace Ralphton {
  public static class NativeCommandLine {
    [DllImport("shell32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr CommandLineToArgvW(
      string commandLine,
      out int argumentCount
    );

    [DllImport("kernel32.dll")]
    public static extern IntPtr LocalFree(IntPtr memory);
  }
}
'@
    Add-Type -TypeDefinition $typeDefinition
  }

  [int]$argumentCount = 0
  $argumentPointer = [Ralphton.NativeCommandLine]::CommandLineToArgvW($CommandLine, [ref]$argumentCount)
  if ($argumentPointer -eq [IntPtr]::Zero) {
    throw 'CommandLineToArgvW could not parse the process command line.'
  }

  $arguments = [System.Collections.Generic.List[string]]::new()
  try {
    for ($index = 0; $index -lt $argumentCount; $index++) {
      $itemPointer = [Runtime.InteropServices.Marshal]::ReadIntPtr(
        $argumentPointer,
        $index * [IntPtr]::Size
      )
      $arguments.Add([Runtime.InteropServices.Marshal]::PtrToStringUni($itemPointer))
    }
  }
  finally {
    [void][Ralphton.NativeCommandLine]::LocalFree($argumentPointer)
  }

  return $arguments.ToArray()
}

function Test-RalphtonOwnedServerProcess {
  param(
    [object]$Process,
    [string]$ProjectRoot
  )

  if ($null -eq $Process) { return $false }

  $processName = [string]$Process.Name
  $commandLine = [string]$Process.CommandLine
  if ($processName -ine 'powershell.exe' -or [string]::IsNullOrWhiteSpace($commandLine)) {
    return $false
  }

  try {
    $arguments = @(ConvertFrom-RalphtonWindowsCommandLine -CommandLine $commandLine)
  }
  catch {
    return $false
  }

  $fileIndices = @()
  $serverChildIndices = @()
  $ownerTokenIndices = @()
  $serverPortIndices = @()
  for ($index = 0; $index -lt $arguments.Count; $index++) {
    switch -Regex ($arguments[$index]) {
      '^(?i)-File$' { $fileIndices += $index; continue }
      '^(?i)-ServerChild$' { $serverChildIndices += $index; continue }
      '^(?i)-OwnerToken$' { $ownerTokenIndices += $index; continue }
      '^(?i)-ServerPort$' { $serverPortIndices += $index; continue }
    }
  }

  if ($fileIndices.Count -ne 1) { return $false }
  $fileIndex = $fileIndices[0]
  if ($fileIndex -ge ($arguments.Count - 1)) { return $false }

  $launcherPath = Join-Path -Path $ProjectRoot -ChildPath (Get-RalphtonLauncherFileName)
  try {
    $expectedLauncherPath = [IO.Path]::GetFullPath($launcherPath)
    $actualLauncherArgument = $arguments[$fileIndex + 1]
    if (-not [IO.Path]::IsPathRooted($actualLauncherArgument)) { return $false }
    $actualLauncherPath = [IO.Path]::GetFullPath($actualLauncherArgument)
  }
  catch {
    return $false
  }

  if (-not [string]::Equals(
    $actualLauncherPath,
    $expectedLauncherPath,
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
    return $false
  }

  if ($serverChildIndices.Count -ne 1 -or $serverChildIndices[0] -le $fileIndex) {
    return $false
  }
  if ($ownerTokenIndices.Count -ne 1 -or $ownerTokenIndices[0] -le $fileIndex) {
    return $false
  }
  if ($serverPortIndices.Count -ne 1 -or $serverPortIndices[0] -le $fileIndex) {
    return $false
  }

  $ownerIndex = $ownerTokenIndices[0]
  if ($ownerIndex -ge ($arguments.Count - 1)) { return $false }
  if ($arguments[$ownerIndex + 1] -cne (Get-RalphtonOwnerToken)) { return $false }

  $portIndex = $serverPortIndices[0]
  if ($portIndex -ge ($arguments.Count - 1)) { return $false }
  [int]$port = 0
  if (-not [int]::TryParse($arguments[$portIndex + 1], [ref]$port)) { return $false }

  return ($port -ge 3000 -and $port -le 3099)
}

function Get-RalphtonProcessTreeSnapshot {
  param([int]$ProcessId)

  $queue = [System.Collections.Generic.Queue[int]]::new()
  $seen = [System.Collections.Generic.HashSet[int]]::new()
  $snapshot = [System.Collections.Generic.List[int]]::new()
  $queue.Enqueue($ProcessId)

  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if (-not $seen.Add($current)) { continue }
    $snapshot.Add($current)

    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $current" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
      $queue.Enqueue([int]$child.ProcessId)
    }
  }

  return $snapshot.ToArray()
}

function Confirm-RalphtonProcessTreeStopped {
  param(
    [int]$TaskkillExitCode,
    [int[]]$ProcessIds,
    [string[]]$TaskkillOutput = @(),
    [int]$TimeoutMilliseconds = 10000
  )

  $details = ($TaskkillOutput | ForEach-Object { [string]$_ }) -join ' '
  if ($TaskkillExitCode -ne 0) {
    throw "taskkill failed with exit code $TaskkillExitCode. Metadata was preserved. $details"
  }

  $deadline = [DateTime]::UtcNow.AddMilliseconds([Math]::Max(0, $TimeoutMilliseconds))
  do {
    $survivors = @($ProcessIds | Where-Object {
      Test-RalphtonProcessExists -ProcessId $_
    })
    if ($survivors.Count -eq 0) { return }
    if ([DateTime]::UtcNow -ge $deadline) { break }
    Start-Sleep -Milliseconds 200
  } while ($true)

  throw "taskkill returned success but process-tree PIDs remain alive: $($survivors -join ','). Metadata was preserved."
}

function Stop-RalphtonProcessTree {
  param(
    [int]$ProcessId,
    [int]$TimeoutSeconds = 10
  )

  $processTreeSnapshot = @(Get-RalphtonProcessTreeSnapshot -ProcessId $ProcessId)
  $taskkillOutput = @(& taskkill.exe /F /T /PID $ProcessId 2>&1)
  $taskkillExitCode = $LASTEXITCODE
  Confirm-RalphtonProcessTreeStopped -TaskkillExitCode $taskkillExitCode -ProcessIds $processTreeSnapshot -TaskkillOutput $taskkillOutput -TimeoutMilliseconds ($TimeoutSeconds * 1000)
}

function Remove-RalphtonLauncherMetadata {
  param(
    [string]$PidFile,
    [string]$PortFile
  )

  Remove-Item -LiteralPath $PidFile -Force
  if (Test-Path -LiteralPath $PortFile) {
    Remove-Item -LiteralPath $PortFile -Force
  }
}

if ($MyInvocation.InvocationName -eq '.') { return }

$projectRoot = $PSScriptRoot
$pidFile = Join-Path -Path $projectRoot -ChildPath 'logs/app.pid'
$portFile = Join-Path -Path $projectRoot -ChildPath 'logs/app.port'

if (-not (Test-Path -LiteralPath $pidFile)) {
  throw "PID file not found at $pidFile. The application does not appear to be running."
}

$rawPid = Get-Content -LiteralPath $pidFile -Raw
if ($rawPid -notmatch '^\s*\d+\s*$') {
  throw "Invalid PID file contents. Metadata was preserved at $pidFile."
}

$targetPid = [int]$rawPid.Trim()
$hasExpectedPid = $PSBoundParameters.ContainsKey('ExpectedPid')
if ($hasExpectedPid -and $targetPid -ne $ExpectedPid) {
  throw "PID metadata changed from expected PID $ExpectedPid to $targetPid. Metadata was preserved."
}

$process = Get-RalphtonProcessById -ProcessId $targetPid
if (-not $process) {
  if ($AllowAlreadyExited -and $hasExpectedPid) {
    Remove-RalphtonLauncherMetadata -PidFile $pidFile -PortFile $portFile
    if (-not $Quiet) {
      Write-Host "Cleaned metadata for exited startup process $targetPid"
    }
    return
  }

  throw "Process $targetPid is not running. Metadata was preserved for manual inspection."
}

if (-not (Test-RalphtonOwnedServerProcess -Process $process -ProjectRoot $projectRoot)) {
  throw "PID $targetPid is not this project's owned server wrapper. Metadata was preserved and no process was stopped."
}

Stop-RalphtonProcessTree -ProcessId $targetPid
Remove-RalphtonLauncherMetadata -PidFile $pidFile -PortFile $portFile

if (-not $Quiet) {
  Write-Host "Stopped owned application process tree $targetPid"
}
