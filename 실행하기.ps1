#Requires -Version 5.1
[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [switch]$Dev,
  [switch]$ServerChild,
  [int]$ServerPort,
  [string]$OwnerToken
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$stopperBaseName = -join @(
  [char]0xC885,
  [char]0xB8CC,
  [char]0xD558,
  [char]0xAE30
)
$stopperScript = Join-Path -Path $projectRoot -ChildPath "$stopperBaseName.ps1"

# Dot-sourcing exposes the one ownership and termination contract used by both scripts.
. $stopperScript

function Write-LauncherLog {
  param(
    [string]$LogFile,
    [string]$Message
  )

  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -LiteralPath $LogFile -Value "$timestamp $Message" -Encoding UTF8
}

function Rotate-RalphtonLogIfOversized {
  param(
    [string]$LogFile,
    [long]$MaximumBytes = 5MB
  )

  if (-not (Test-Path -LiteralPath $LogFile -PathType Leaf)) { return }
  if ((Get-Item -LiteralPath $LogFile).Length -le $MaximumBytes) { return }

  $previousLogFile = Join-Path -Path (Split-Path -Parent $LogFile) -ChildPath 'app.previous.log'
  if (Test-Path -LiteralPath $previousLogFile) {
    Remove-Item -LiteralPath $previousLogFile -Force
  }
  Move-Item -LiteralPath $LogFile -Destination $previousLogFile
}

function Enter-RalphtonLaunchLock {
  param([string]$ProjectRoot)

  $logsDirectory = Join-Path -Path $ProjectRoot -ChildPath 'logs'
  [void][System.IO.Directory]::CreateDirectory($logsDirectory)
  $lockFile = Join-Path -Path $logsDirectory -ChildPath 'app.launch.lock'

  try {
    return ([System.IO.File]::Open(
      $lockFile,
      [System.IO.FileMode]::OpenOrCreate,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::None
    ))
  }
  catch {
    throw "Another launcher is already starting this project, or the launch lock cannot be acquired. $($_.Exception.Message)"
  }
}

function Exit-RalphtonLaunchLock {
  param([System.IDisposable]$LockHandle)

  if ($LockHandle) {
    $LockHandle.Dispose()
  }
}

function Test-NodeVersion {
  $raw = (node --version).Trim()
  if ($raw -notmatch '^v(\d+)\.(\d+)\.(\d+)') {
    throw "Unable to determine Node.js version from: $raw"
  }

  $installed = [version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
  if ($installed -lt [version]'20.9.0') {
    throw "Node.js $raw is too old. This project requires Node.js >= 20.9.0."
  }
}

function Test-NpmAvailable {
  $null = (npm --version).Trim()
}

function Get-RalphtonInstalledPackagePaths {
  param(
    [string]$NodeModulesDirectory,
    [string]$ParentPackagePath = ''
  )

  if (-not (Test-Path -LiteralPath $NodeModulesDirectory -PathType Container)) { return }

  foreach ($entry in @(Get-ChildItem -LiteralPath $NodeModulesDirectory -Directory -Force)) {
    if ($entry.Name.StartsWith('.')) { continue }

    $packages = if ($entry.Name.StartsWith('@')) {
      @(Get-ChildItem -LiteralPath $entry.FullName -Directory -Force)
    }
    else {
      @($entry)
    }

    foreach ($package in $packages) {
      $packageName = if ($entry.Name.StartsWith('@')) {
        "$($entry.Name)/$($package.Name)"
      }
      else {
        $package.Name
      }
      $packagePath = if ($ParentPackagePath) {
        "$ParentPackagePath/node_modules/$packageName"
      }
      else {
        "node_modules/$packageName"
      }

      Write-Output $packagePath

      if (-not ($package.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        $nestedNodeModules = Join-Path -Path $package.FullName -ChildPath 'node_modules'
        Get-RalphtonInstalledPackagePaths -NodeModulesDirectory $nestedNodeModules -ParentPackagePath $packagePath
      }
    }
  }
}

function ConvertFrom-RalphtonJson {
  param([string]$Json)

  Add-Type -AssemblyName System.Web.Extensions
  $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $serializer.MaxJsonLength = [int]::MaxValue
  return $serializer.DeserializeObject($Json)
}

function Test-RalphtonPackageEntriesEqual {
  param(
    [hashtable]$Expected,
    [hashtable]$Actual
  )

  foreach ($propertyName in @('version', 'resolved', 'integrity', 'link')) {
    $hasExpected = $Expected.ContainsKey($propertyName)
    $hasActual = $Actual.ContainsKey($propertyName)
    if ($hasExpected -ne $hasActual) { return $false }
    if ($hasExpected -and ($Expected[$propertyName] -cne $Actual[$propertyName])) {
      return $false
    }
  }
  return $true
}

function Test-RalphtonDependenciesMatchLockfile {
  param([string]$ProjectRoot)

  $packageLockPath = Join-Path -Path $ProjectRoot -ChildPath 'package-lock.json'
  $nodeModulesDirectory = Join-Path -Path $ProjectRoot -ChildPath 'node_modules'
  $hiddenLockPath = Join-Path -Path $nodeModulesDirectory -ChildPath '.package-lock.json'

  if (-not (Test-Path -LiteralPath $packageLockPath -PathType Leaf)) { return $false }
  if (-not (Test-Path -LiteralPath $nodeModulesDirectory -PathType Container)) { return $false }
  if (-not (Test-Path -LiteralPath $hiddenLockPath -PathType Leaf)) { return $false }

  try {
    $packageLockItem = Get-Item -LiteralPath $packageLockPath
    $hiddenLockItem = Get-Item -LiteralPath $hiddenLockPath
    if ($packageLockItem.LastWriteTimeUtc -gt $hiddenLockItem.LastWriteTimeUtc) { return $false }

    $packageLock = ConvertFrom-RalphtonJson -Json (Get-Content -LiteralPath $packageLockPath -Raw)
    $hiddenLock = ConvertFrom-RalphtonJson -Json (Get-Content -LiteralPath $hiddenLockPath -Raw)
    if (-not $packageLock['packages'] -or -not $hiddenLock['packages']) { return $false }
    if ([int]$packageLock['lockfileVersion'] -ne [int]$hiddenLock['lockfileVersion']) { return $false }

    $expectedPackages = @{}
    foreach ($packagePath in $packageLock['packages'].Keys) {
      $expectedPackages[$packagePath] = $packageLock['packages'][$packagePath]
    }
    $installedPackages = @{}
    foreach ($packagePath in $hiddenLock['packages'].Keys) {
      $installedPackages[$packagePath] = $hiddenLock['packages'][$packagePath]
    }

    foreach ($packagePath in $installedPackages.Keys) {
      if (-not $expectedPackages.ContainsKey($packagePath)) { return $false }
      if (-not (Test-RalphtonPackageEntriesEqual -Expected $expectedPackages[$packagePath] -Actual $installedPackages[$packagePath])) {
        return $false
      }

      $packageDirectory = Join-Path -Path $ProjectRoot -ChildPath $packagePath
      if (-not (Test-Path -LiteralPath $packageDirectory -PathType Container)) { return $false }
      if ((Get-Item -LiteralPath $packageDirectory).LastWriteTimeUtc -gt $hiddenLockItem.LastWriteTimeUtc) {
        return $false
      }
    }

    foreach ($packagePath in $expectedPackages.Keys) {
      if (-not $packagePath) { continue }
      $isOptional = $false
      if ($expectedPackages[$packagePath].ContainsKey('optional')) {
        $isOptional = [bool]$expectedPackages[$packagePath]['optional']
      }
      if (-not $isOptional -and -not $installedPackages.ContainsKey($packagePath)) { return $false }
    }

    foreach ($packagePath in @(Get-RalphtonInstalledPackagePaths -NodeModulesDirectory $nodeModulesDirectory)) {
      if (-not $installedPackages.ContainsKey($packagePath)) { return $false }
    }

    return $true
  }
  catch {
    return $false
  }
}

function Get-RalphtonDependencyInstallAction {
  param([string]$ProjectRoot)

  $packageLockPath = Join-Path -Path $ProjectRoot -ChildPath 'package-lock.json'
  if (-not (Test-Path -LiteralPath $packageLockPath -PathType Leaf)) {
    return 'install'
  }
  if (Test-RalphtonDependenciesMatchLockfile -ProjectRoot $ProjectRoot) {
    return 'none'
  }
  return 'ci'
}

function Install-DependenciesIfNeeded {
  param([string]$LogFile)

  $installAction = Get-RalphtonDependencyInstallAction -ProjectRoot $projectRoot
  if ($installAction -eq 'none') {
    Write-LauncherLog -LogFile $LogFile -Message 'Dependencies match package-lock.json; installation skipped.'
    return
  }

  if ($installAction -eq 'ci') {
    Write-LauncherLog -LogFile $LogFile -Message 'Repairing dependencies from package-lock.json with npm ci...'
    & npm ci
    if ($LASTEXITCODE -ne 0) {
      throw "npm ci failed with exit code $LASTEXITCODE"
    }
  }
  else {
    Write-LauncherLog -LogFile $LogFile -Message 'No package-lock.json found; running npm install...'
    & npm install
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed with exit code $LASTEXITCODE"
    }
  }
}

function Copy-EnvironmentIfMissing {
  param([string]$LogFile)

  $envExample = Join-Path -Path $projectRoot -ChildPath '.env.example'
  $envLocal = Join-Path -Path $projectRoot -ChildPath '.env.local'
  if ((Test-Path -LiteralPath $envExample) -and -not (Test-Path -LiteralPath $envLocal)) {
    Copy-Item -LiteralPath $envExample -Destination $envLocal
    Write-LauncherLog -LogFile $LogFile -Message 'Copied .env.example to .env.local'
  }
}

function Build-Application {
  param(
    [string]$LogFile,
    [switch]$Development
  )

  if ($Development) { return }

  Write-LauncherLog -LogFile $LogFile -Message 'Running production build...'
  & npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "npm run build failed with exit code $LASTEXITCODE"
  }
}

function Test-PortAvailable {
  param([int]$Port)

  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    return $true
  }
  catch {
    return $false
  }
  finally {
    if ($listener) {
      try { $listener.Stop() } catch { }
    }
  }
}

function Find-FreePort {
  $activePorts = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
    ForEach-Object { $_.Port }

  foreach ($port in 3000..3099) {
    if ($activePorts -notcontains $port -and (Test-PortAvailable -Port $port)) {
      return $port
    }
  }

  throw 'No free TCP port found in the range 3000-3099.'
}

function Test-RalphtonProcessTreeOwnsListeningPort {
  param(
    [int]$ProcessId,
    [int]$Port
  )

  $processIds = @(Get-RalphtonProcessTreeSnapshot -ProcessId $ProcessId)
  try {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
    foreach ($listener in $listeners) {
      if ($processIds -contains [int]$listener.OwningProcess) {
        return $true
      }
    }
    return $false
  }
  catch {
    $netstatLines = @(& netstat.exe -ano -p tcp 2>$null)
    foreach ($line in $netstatLines) {
      if ($line -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$") {
        if ($processIds -contains [int]$Matches[1]) {
          return $true
        }
      }
    }
    return $false
  }
}

function Wait-ForHealth {
  param(
    [int]$Port,
    [int]$ProcessId
  )

  $url = "http://127.0.0.1:$Port/api/health"
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    $wrapperProcess = Get-RalphtonProcessById -ProcessId $ProcessId
    if (-not (Test-RalphtonOwnedServerProcess -Process $wrapperProcess -ProjectRoot $projectRoot)) {
      throw "Owned server wrapper $ProcessId exited or changed identity before health succeeded."
    }

    $response = $null
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    }
    catch {
      # The server may still be compiling or binding its port.
    }

    if ($response -and $response.StatusCode -eq 200) {
      if (-not (Test-RalphtonProcessTreeOwnsListeningPort -ProcessId $ProcessId -Port $Port)) {
        throw "Health endpoint on port $Port is not owned by server wrapper $ProcessId."
      }
      return
    }
    Start-Sleep -Seconds 1
  }

  throw "Health check at $url did not return HTTP 200 within 60 seconds."
}

function Stop-RalphtonOwnedProcessIfCurrent {
  param(
    [int]$ProcessId,
    [string]$ProjectRoot
  )

  $currentProcess = Get-RalphtonProcessById -ProcessId $ProcessId
  if (-not $currentProcess) { return }
  if (-not (Test-RalphtonOwnedServerProcess -Process $currentProcess -ProjectRoot $ProjectRoot)) {
    throw "PID $ProcessId changed identity before startup cleanup; no process was stopped."
  }

  Stop-RalphtonProcessTree -ProcessId $ProcessId
}

function Invoke-RalphtonServerChild {
  param(
    [int]$Port,
    [string]$Token,
    [switch]$Development
  )

  if ($Token -cne (Get-RalphtonOwnerToken)) {
    throw 'Invalid server-wrapper ownership token.'
  }
  if ($Port -lt 3000 -or $Port -gt 3099) {
    throw "Server-wrapper port $Port is outside 3000-3099."
  }

  Set-Location -LiteralPath $projectRoot
  $logFile = Join-Path -Path $projectRoot -ChildPath 'logs/app.log'
  # Development mode runs npm run dev; production mode runs npm start.
  $npmArguments = if ($Development) {
    @('run', 'dev', '--', '-p', [string]$Port)
  }
  else {
    @('start', '--', '-p', [string]$Port)
  }

  & npm.cmd @npmArguments 2>&1 | ForEach-Object {
    Add-Content -LiteralPath $logFile -Value ([string]$_) -Encoding UTF8
  }
  $npmExitCode = $LASTEXITCODE
  exit $npmExitCode
}

function Start-Browser {
  param([int]$Port)

  $url = "http://localhost:$Port"
  $chromePath = $null
  foreach ($registryPath in @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe'
  )) {
    try {
      $chromePath = (Get-ItemProperty -LiteralPath $registryPath -ErrorAction Stop).'(default)'
      if ($chromePath) { break }
    }
    catch {
      # Continue through known Chrome locations before using the default browser.
    }
  }

  if (-not $chromePath) {
    $candidates = [System.Collections.Generic.List[string]]::new()
    if ($env:LOCALAPPDATA) {
      $candidates.Add((Join-Path -Path $env:LOCALAPPDATA -ChildPath 'Google\Chrome\Application\chrome.exe'))
    }
    if ($env:ProgramFiles) {
      $candidates.Add((Join-Path -Path $env:ProgramFiles -ChildPath 'Google\Chrome\Application\chrome.exe'))
    }
    if (${env:ProgramFiles(x86)}) {
      $candidates.Add((Join-Path -Path ${env:ProgramFiles(x86)} -ChildPath 'Google\Chrome\Application\chrome.exe'))
    }
    $chromePath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  }

  if ($chromePath -and (Test-Path -LiteralPath $chromePath)) {
    try {
      Start-Process -FilePath $chromePath -ArgumentList $url | Out-Null
      return
    }
    catch {
      # Fall back to the user's registered browser.
    }
  }

  Start-Process "http://localhost:$Port" | Out-Null
}

if ($MyInvocation.InvocationName -eq '.') { return }

if ($ServerChild) {
  Invoke-RalphtonServerChild -Port $ServerPort -Token $OwnerToken -Development:$Dev
  return
}

$launchLock = Enter-RalphtonLaunchLock -ProjectRoot $projectRoot
try {
Set-Location -LiteralPath $projectRoot
$logsDir = Join-Path -Path $projectRoot -ChildPath 'logs'
[void][System.IO.Directory]::CreateDirectory($logsDir)

$pidFile = Join-Path -Path $projectRoot -ChildPath 'logs/app.pid'
$portFile = Join-Path -Path $projectRoot -ChildPath 'logs/app.port'
$logFile = Join-Path -Path $projectRoot -ChildPath 'logs/app.log'

if (Test-Path -LiteralPath $pidFile) {
  $existingRaw = Get-Content -LiteralPath $pidFile -Raw
  if ($existingRaw -notmatch '^\s*\d+\s*$') {
    throw "Invalid PID metadata at $pidFile. It was preserved for manual inspection."
  }

  $existingPid = [int]$existingRaw.Trim()
  $existingProcess = Get-RalphtonProcessById -ProcessId $existingPid
  if ($existingProcess) {
    if (Test-RalphtonOwnedServerProcess -Process $existingProcess -ProjectRoot $projectRoot) {
      throw "An application instance is already running (PID $existingPid). Run the stop wrapper first."
    }
    throw "PID metadata points to a live process that is not the owned server wrapper. Metadata was preserved."
  }

  Remove-Item -LiteralPath $pidFile -Force
  if (Test-Path -LiteralPath $portFile) {
    Remove-Item -LiteralPath $portFile -Force
  }
}
elseif (Test-Path -LiteralPath $portFile) {
  throw "Port metadata exists without PID metadata at $portFile. It was preserved for manual inspection."
}

Rotate-RalphtonLogIfOversized -LogFile $logFile
Test-NodeVersion
Test-NpmAvailable
Install-DependenciesIfNeeded -LogFile $logFile
Copy-EnvironmentIfMissing -LogFile $logFile
Build-Application -LogFile $logFile -Development:$Dev

$port = Find-FreePort
Write-LauncherLog -LogFile $logFile -Message "Selected port $port"

$quotedLauncherPath = '"' + $PSCommandPath + '"'
$childArguments = @(
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  $quotedLauncherPath,
  '-ServerChild',
  '-ServerPort',
  [string]$port,
  '-OwnerToken',
  (Get-RalphtonOwnerToken)
)
if ($Dev) {
  $childArguments += '-Dev'
}
$childArgumentLine = $childArguments -join ' '

$serverProcess = $null
try {
  Write-LauncherLog -LogFile $logFile -Message "Starting owned Next.js server wrapper on port $port..."
  $serverProcess = Start-Process -FilePath (Join-Path -Path $PSHOME -ChildPath 'powershell.exe') -ArgumentList $childArgumentLine -WindowStyle Hidden -PassThru
  $serverProcess.Id | Set-Content -LiteralPath $pidFile -NoNewline -Encoding ASCII
  $port | Set-Content -LiteralPath $portFile -NoNewline -Encoding ASCII

  Wait-ForHealth -Port $port -ProcessId $serverProcess.Id
}
catch {
  $startupMessage = $_.Exception.Message
  $cleanupMessage = $null

  if ($serverProcess) {
    try {
      if (Test-Path -LiteralPath $pidFile) {
        & $stopperScript -ExpectedPid $serverProcess.Id -AllowAlreadyExited -Quiet
      }
      else {
        Stop-RalphtonOwnedProcessIfCurrent -ProcessId $serverProcess.Id -ProjectRoot $projectRoot
        if (Test-Path -LiteralPath $portFile) {
          Remove-Item -LiteralPath $portFile -Force
        }
      }
    }
    catch {
      $cleanupMessage = $_.Exception.Message
    }
  }

  try {
    Write-LauncherLog -LogFile $logFile -Message "Startup failed: $startupMessage"
  }
  catch {
    # Cleanup has already run; a logging failure must not mask its result.
  }

  if ($cleanupMessage) {
    throw "Application startup failed: $startupMessage Cleanup also failed: $cleanupMessage"
  }
  throw "Application startup failed and its process was cleaned up: $startupMessage"
}

Write-LauncherLog -LogFile $logFile -Message "Owned server wrapper started (PID $($serverProcess.Id))"

if (-not $NoBrowser) {
  try {
    Start-Browser -Port $port
  }
  catch {
    Write-Warning "The application is running, but the browser could not be opened: $($_.Exception.Message)"
  }
}

Write-Host "Application is running at http://127.0.0.1:$port (PID $($serverProcess.Id))"
}
finally {
  Exit-RalphtonLaunchLock -LockHandle $launchLock
}
