import { execFileSync, execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

async function readScript(name: string): Promise<string> {
  return readFile(resolve(projectRoot, name), "utf8");
}

function asPowerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function runPowerShell(script: string): string {
  const encodedCommand = Buffer.from(script, "utf16le").toString("base64");

  return execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedCommand,
    ],
    { cwd: projectRoot, encoding: "utf8" },
  ).trim();
}

describe("Windows launcher scripts", () => {
  it("requires Node.js >= 20.9.0", () => {
    const version = execSync("node --version", { encoding: "utf8" }).trim();
    const match = /^v(\d+)\.(\d+)\.(\d+)/u.exec(version);

    expect(match).not.toBeNull();

    const [major, minor, patch] = match!.slice(1).map(Number);
    const versionNumber = major * 10_000 + minor * 100 + patch;

    expect(versionNumber).toBeGreaterThanOrEqual(20 * 10_000 + 9 * 100 + 0);
  });

  it("has a PowerShell launcher with first-run install, env copy, build, and health wait", async () => {
    const script = await readScript("실행하기.ps1");

    expect(script).toMatch(/\[switch\]\s*\$NoBrowser/iu);
    expect(script).toMatch(/node\s+--version/iu);
    expect(script).toMatch(/npm\s+--version/iu);
    expect(script).toMatch(/npm\s+(ci|install)/iu);
    expect(script).toMatch(/\.env\.example/iu);
    expect(script).toMatch(/\.env\.local/iu);
    expect(script).toMatch(/npm\s+(?:cmd\s+)?run\s+build/iu);
    expect(script).toMatch(/3000\s*\.\.\s*3099|3000\s*\.\.\.\s*3099/iu);
    expect(script).toMatch(/\/api\/health/iu);
    expect(script).toMatch(/logs\s*[\\/]\s*app\.pid/iu);
    expect(script).toMatch(/logs\s*[\\/]\s*app\.port/iu);
    expect(script).toMatch(/logs\s*[\\/]\s*app\.log/iu);
    expect(script).toMatch(/Test-RalphtonOwnedServerProcess/iu);
  });

  it("chooses no install only for a complete lockfile-backed node_modules tree", async () => {
    const script = await readScript("실행하기.ps1");

    expect(script).toMatch(
      /function\s+Get-RalphtonDependencyInstallAction/iu,
    );

    const launcherPath = resolve(projectRoot, "실행하기.ps1");
    const probe = `
. ${asPowerShellLiteral(launcherPath)}
$fixtureRoot = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ('ralphton-deps-' + [guid]::NewGuid().ToString('N'))
try {
  [void][System.IO.Directory]::CreateDirectory($fixtureRoot)

  $noLockAction = Get-RalphtonDependencyInstallAction -ProjectRoot $fixtureRoot

  $rootLock = [ordered]@{
    name = 'fixture'
    lockfileVersion = 3
    packages = [ordered]@{
      '' = [ordered]@{ dependencies = [ordered]@{ alpha = '1.0.0' } }
      'node_modules/alpha' = [ordered]@{
        version = '1.0.0'
        resolved = 'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz'
        integrity = 'sha512-fixture'
      }
    }
  }
  $hiddenLock = [ordered]@{
    name = 'fixture'
    lockfileVersion = 3
    packages = [ordered]@{
      'node_modules/alpha' = [ordered]@{
        version = '1.0.0'
        resolved = 'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz'
        integrity = 'sha512-fixture'
      }
    }
  }

  $nodeModules = Join-Path -Path $fixtureRoot -ChildPath 'node_modules'
  $alphaDirectory = Join-Path -Path $nodeModules -ChildPath 'alpha'
  [void][System.IO.Directory]::CreateDirectory($alphaDirectory)
  $packageLockPath = Join-Path -Path $fixtureRoot -ChildPath 'package-lock.json'
  $hiddenLockPath = Join-Path -Path $nodeModules -ChildPath '.package-lock.json'
  $rootLock | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $packageLockPath -Encoding UTF8
  $hiddenLock | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $hiddenLockPath -Encoding UTF8
  $fresh = (Get-Date).ToUniversalTime()
  (Get-Item -LiteralPath $packageLockPath).LastWriteTimeUtc = $fresh.AddSeconds(-2)
  (Get-Item -LiteralPath $alphaDirectory).LastWriteTimeUtc = $fresh.AddSeconds(-1)
  (Get-Item -LiteralPath $hiddenLockPath).LastWriteTimeUtc = $fresh

  $completeAction = Get-RalphtonDependencyInstallAction -ProjectRoot $fixtureRoot

  Remove-Item -LiteralPath $alphaDirectory -Recurse -Force
  $incompleteAction = Get-RalphtonDependencyInstallAction -ProjectRoot $fixtureRoot
}
finally {
  if (Test-Path -LiteralPath $fixtureRoot) {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
  }
}
[pscustomobject]@{
  noLock = $noLockAction
  complete = $completeAction
  incomplete = $incompleteAction
} | ConvertTo-Json -Compress
`;
    const result = JSON.parse(runPowerShell(probe)) as Record<string, string>;

    expect(result).toEqual({
      noLock: "install",
      complete: "none",
      incomplete: "ci",
    });
  }, 30_000);

  it("uses npm ci for every lockfile-backed repair and npm install only without a lockfile", async () => {
    const script = await readScript("실행하기.ps1");

    expect(script).toMatch(
      /Get-RalphtonDependencyInstallAction[\s\S]*['"]ci['"]/iu,
    );
    expect(script).toMatch(/&\s*npm\s+ci/iu);
    expect(script).toMatch(/&\s*npm\s+install/iu);
  });

  it("waits no longer than 60 seconds for the owned health endpoint", async () => {
    const script = await readScript("실행하기.ps1");
    const waitFunction = script.match(
      /function\s+Wait-ForHealth\b[\s\S]*?(?=\r?\nfunction\s)/iu,
    )?.[0];

    expect(waitFunction).toBeDefined();
    expect(waitFunction).toMatch(/AddSeconds\(60\)/iu);
    expect(waitFunction).toMatch(/within 60 seconds/iu);
    expect(waitFunction).not.toMatch(/120/iu);
  });

  it("rotates an app.log larger than 5MB into one app.previous.log generation", async () => {
    const script = await readScript("실행하기.ps1");

    expect(script).toMatch(/function\s+Rotate-RalphtonLogIfOversized/iu);

    const launcherPath = resolve(projectRoot, "실행하기.ps1");
    const probe = `
. ${asPowerShellLiteral(launcherPath)}
$fixtureRoot = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath ('ralphton-log-' + [guid]::NewGuid().ToString('N'))
try {
  [void][System.IO.Directory]::CreateDirectory($fixtureRoot)
  $logFile = Join-Path -Path $fixtureRoot -ChildPath 'app.log'
  $previousFile = Join-Path -Path $fixtureRoot -ChildPath 'app.previous.log'
  [System.IO.File]::WriteAllText($previousFile, 'stale')
  $stream = [System.IO.File]::Open($logFile, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  try { $stream.SetLength((5MB) + 1) } finally { $stream.Dispose() }

  Rotate-RalphtonLogIfOversized -LogFile $logFile

  $currentExists = Test-Path -LiteralPath $logFile
  $previousLength = (Get-Item -LiteralPath $previousFile).Length
}
finally {
  if (Test-Path -LiteralPath $fixtureRoot) {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
  }
}
[pscustomobject]@{
  currentExists = $currentExists
  previousLength = $previousLength
} | ConvertTo-Json -Compress
`;
    const result = JSON.parse(runPowerShell(probe)) as {
      currentExists: boolean;
      previousLength: number;
    };

    expect(result).toEqual({
      currentExists: false,
      previousLength: 5 * 1024 * 1024 + 1,
    });
  }, 30_000);

  it("stores a dedicated hidden server-wrapper PID and cleans failed starts through the stopper", async () => {
    const script = await readScript("실행하기.ps1");

    expect(script).toMatch(/\[switch\]\s*\$ServerChild/iu);
    expect(script).toMatch(/Get-RalphtonOwnerToken/iu);
    expect(script).toMatch(
      /Start-Process[\s\S]*powershell[\s\S]*-WindowStyle\s+Hidden[\s\S]*-PassThru/iu,
    );
    expect(script).toMatch(
      /\$serverProcess\.Id\s*\|\s*Set-Content\s+-LiteralPath\s+\$pidFile/iu,
    );
    expect(script).toMatch(
      /catch\s*\{[\s\S]*&\s*\$stopperScript[\s\S]*-ExpectedPid[\s\S]*-AllowAlreadyExited/iu,
    );
    expect(script).not.toMatch(/Find-NextChildPid/iu);
  });

  it("streams npm output to the literal log path without cmd redirection", async () => {
    const script = await readScript("실행하기.ps1");

    expect(script).toMatch(
      /npm\.cmd[\s\S]*2>&1\s*\|\s*ForEach-Object[\s\S]*Add-Content\s+-LiteralPath\s+\$logFile/iu,
    );
    expect(script).not.toMatch(/Start-Process\s+-FilePath\s+['"]cmd(?:\.exe)?['"]/iu);
    expect(script).not.toMatch(/['"]>>['"]\s*,?\s*\$logFile/iu);
  });

  it("holds an exclusive project launch lock across startup", async () => {
    const launcher = await readScript("실행하기.ps1");

    expect(launcher).toMatch(/function\s+Enter-RalphtonLaunchLock/iu);
    expect(launcher).toMatch(/function\s+Exit-RalphtonLaunchLock/iu);
    expect(launcher).toMatch(/app\.launch\.lock/iu);

    const launcherPath = resolve(projectRoot, "실행하기.ps1");
    const probe = `
. ${asPowerShellLiteral(launcherPath)}
$first = $null
$after = $null
$secondRejected = $false
$reacquiredAfterRelease = $false
try {
  $first = Enter-RalphtonLaunchLock -ProjectRoot ${asPowerShellLiteral(projectRoot)}
  try {
    $second = Enter-RalphtonLaunchLock -ProjectRoot ${asPowerShellLiteral(projectRoot)}
    Exit-RalphtonLaunchLock -LockHandle $second
  }
  catch { $secondRejected = $true }
}
finally {
  if ($first) { Exit-RalphtonLaunchLock -LockHandle $first }
}
try {
  $after = Enter-RalphtonLaunchLock -ProjectRoot ${asPowerShellLiteral(projectRoot)}
  $reacquiredAfterRelease = $true
}
finally {
  if ($after) { Exit-RalphtonLaunchLock -LockHandle $after }
}
[pscustomobject]@{
  secondRejected = $secondRejected
  reacquiredAfterRelease = $reacquiredAfterRelease
} | ConvertTo-Json -Compress
`;
    const result = JSON.parse(runPowerShell(probe)) as Record<string, boolean>;

    expect(result).toEqual({
      secondRejected: true,
      reacquiredAfterRelease: true,
    });
  }, 30_000);

  it("requires a live owned wrapper and owned listening port before health succeeds", async () => {
    const launcher = await readScript("실행하기.ps1");

    expect(launcher).toMatch(
      /function\s+Test-RalphtonProcessTreeOwnsListeningPort/iu,
    );
    expect(launcher).toMatch(
      /function\s+Wait-ForHealth[\s\S]*Test-RalphtonOwnedServerProcess[\s\S]*Test-RalphtonProcessTreeOwnsListeningPort/iu,
    );
    expect(launcher).toMatch(
      /Wait-ForHealth\s+-Port\s+\$port\s+-ProcessId\s+\$serverProcess\.Id/iu,
    );
    expect(launcher).toMatch(/function\s+Stop-RalphtonOwnedProcessIfCurrent/iu);
    expect(launcher).toMatch(
      /Stop-RalphtonOwnedProcessIfCurrent\s+-ProcessId\s+\$serverProcess\.Id/iu,
    );
    expect(launcher).toMatch(
      /catch\s*\{[\s\S]*Write-Warning[\s\S]*browser/iu,
    );

    const launcherPath = resolve(projectRoot, "실행하기.ps1");
    const probe = `
. ${asPowerShellLiteral(launcherPath)}
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$owned = $false
$unrelated = $true
try {
  $listener.Start()
  $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  Start-Sleep -Milliseconds 250
  $owned = Test-RalphtonProcessTreeOwnsListeningPort -ProcessId $PID -Port $port
  $unrelated = Test-RalphtonProcessTreeOwnsListeningPort -ProcessId 4 -Port $port
}
finally {
  $listener.Stop()
}
[pscustomobject]@{
  owned = $owned
  unrelated = $unrelated
} | ConvertTo-Json -Compress
`;
    const result = JSON.parse(runPowerShell(probe)) as Record<string, boolean>;

    expect(result).toEqual({ owned: true, unrelated: false });
  }, 60_000);

  it("opens Chrome when available and supports a browserless switch", async () => {
    const script = await readScript("실행하기.ps1");
    const browserFunction = script.match(
      /function\s+Start-Browser\b[\s\S]*?(?=\r?\nfunction\s|\r?\nif\s*\(\$MyInvocation)/iu,
    )?.[0];

    expect(script).toMatch(/chrome\.exe|Chrome/iu);
    expect(script).toMatch(/Start-Process\s+['"]?http:\/\/localhost/iu);
    expect(script).toMatch(/\$NoBrowser/iu);
    expect(browserFunction).toBeDefined();
    expect(browserFunction).not.toMatch(/-WindowStyle\s+Hidden/iu);
  });

  it("has a production CMD wrapper calling the PowerShell launcher", async () => {
    const script = await readScript("실행하기.cmd");

    expect(script).toMatch(/powershell/iu);
    expect(script).toMatch(/-ExecutionPolicy\s+Bypass/iu);
    expect(script).toMatch(/%~dpn0\.ps1/iu);
  });

  it("has a development CMD wrapper that starts the dev server", async () => {
    const script = await readScript("실행하기-개발모드.cmd");
    const ps1 = await readScript("실행하기.ps1");

    expect(script).toMatch(/powershell/iu);
    expect(script).toMatch(/-ExecutionPolicy\s+Bypass/iu);
    expect(script).toMatch(/-File\s+"%launcher%"/iu);
    expect(script).toMatch(/-Dev/iu);
    expect(ps1).toMatch(/run\s+dev/iu);
  });

  it("keeps CMD wrapper source ASCII and derives Korean script paths from each wrapper name", async () => {
    const production = await readScript("실행하기.cmd");
    const development = await readScript("실행하기-개발모드.cmd");
    const shutdown = await readScript("종료하기.cmd");

    for (const script of [production, development, shutdown]) {
      expect(script).not.toMatch(/[^\u0000-\u007f]/u);
      expect(script).toMatch(/%\*/u);
    }
    expect(production).toMatch(/%~dpn0\.ps1/iu);
    expect(shutdown).toMatch(/%~dpn0\.ps1/iu);
    expect(development).toMatch(/%~dpn0/iu);
    expect(development).toMatch(/:~0,-5/iu);
  });

  it("has a shutdown script that verifies the PID command line before killing", async () => {
    const script = await readScript("종료하기.ps1");

    expect(script).toMatch(/logs\s*[\\/]\s*app\.pid/iu);
    expect(script).toMatch(/Get-CimInstance\s+Win32_Process/iu);
    expect(script).toMatch(/CommandLine/iu);
    expect(script).toMatch(/ServerChild/iu);
    expect(script).toMatch(/OwnerToken/iu);
    expect(script).toMatch(/taskkill(?:\.exe)?\s+.*\/PID/iu);
  });

  it("uses one strict project-owned wrapper identity for duplicate and shutdown decisions", async () => {
    const launcher = await readScript("실행하기.ps1");
    const stopper = await readScript("종료하기.ps1");

    expect(stopper).toMatch(
      /if\s*\(\$MyInvocation\.InvocationName\s+-eq\s+['"]\.['"]\)\s*\{\s*return\s*\}/iu,
    );
    expect(launcher).toMatch(/\.\s+\$stopperScript/iu);
    expect(launcher).toMatch(/Test-RalphtonOwnedServerProcess/iu);
    expect(stopper).toMatch(/function\s+Test-RalphtonOwnedServerProcess/iu);

    const stopperPath = resolve(projectRoot, "종료하기.ps1");
    const launcherPath = resolve(projectRoot, "실행하기.ps1");
    const otherLauncherPath = resolve(projectRoot, "..", "other", "실행하기.ps1");
    const probe = `
. ${asPowerShellLiteral(stopperPath)}
$projectRoot = ${asPowerShellLiteral(projectRoot)}
$owned = [pscustomobject]@{
  Name = 'powershell.exe'
  CommandLine = 'powershell.exe -File "${launcherPath}" -ServerChild -OwnerToken ralphton-task10-server-v1 -ServerPort 3001'
}
$wrongProject = [pscustomobject]@{
  Name = 'powershell.exe'
  CommandLine = 'powershell.exe -File "${otherLauncherPath}" -ServerChild -OwnerToken ralphton-task10-server-v1 -ServerPort 3001'
}
$wrongToken = [pscustomobject]@{
  Name = 'powershell.exe'
  CommandLine = 'powershell.exe -File "${launcherPath}" -ServerChild -OwnerToken someone-else -ServerPort 3001'
}
$pathPrefixDecoy = [pscustomobject]@{
  Name = 'powershell.exe'
  CommandLine = 'powershell.exe -File "${launcherPath}.decoy" -ServerChild -OwnerToken ralphton-task10-server-v1 -ServerPort 3001'
}
$commandDecoy = [pscustomobject]@{
  Name = 'powershell.exe'
  CommandLine = 'powershell.exe -Command "Write-Output ${launcherPath}" -ServerChild -OwnerToken ralphton-task10-server-v1 -ServerPort 3001'
}
$spaceRoot = 'C:\Workspace With Spaces'
$spaceLauncher = Join-Path -Path $spaceRoot -ChildPath (Get-RalphtonLauncherFileName)
$spaceOwned = [pscustomobject]@{
  Name = 'powershell.exe'
  CommandLine = 'powershell.exe -File "' + $spaceLauncher + '" -ServerChild -OwnerToken ralphton-task10-server-v1 -ServerPort 3099'
}
$legacyNode = [pscustomobject]@{
  Name = 'node.exe'
  CommandLine = 'node.exe "${launcherPath}\\node_modules\\next\\dist\\bin\\next" start -p 3001'
}
[pscustomobject]@{
  owned = Test-RalphtonOwnedServerProcess -Process $owned -ProjectRoot $projectRoot
  wrongProject = Test-RalphtonOwnedServerProcess -Process $wrongProject -ProjectRoot $projectRoot
  wrongToken = Test-RalphtonOwnedServerProcess -Process $wrongToken -ProjectRoot $projectRoot
  pathPrefixDecoy = Test-RalphtonOwnedServerProcess -Process $pathPrefixDecoy -ProjectRoot $projectRoot
  commandDecoy = Test-RalphtonOwnedServerProcess -Process $commandDecoy -ProjectRoot $projectRoot
  spaceOwned = Test-RalphtonOwnedServerProcess -Process $spaceOwned -ProjectRoot $spaceRoot
  legacyNode = Test-RalphtonOwnedServerProcess -Process $legacyNode -ProjectRoot $projectRoot
} | ConvertTo-Json -Compress
`;
    const result = JSON.parse(runPowerShell(probe)) as Record<string, boolean>;

    expect(result).toEqual({
      owned: true,
      wrongProject: false,
      wrongToken: false,
      pathPrefixDecoy: false,
      commandDecoy: false,
      spaceOwned: true,
      legacyNode: false,
    });
  }, 30_000);

  it("preserves PID metadata unless taskkill is verified to have stopped the wrapper", async () => {
    const script = await readScript("종료하기.ps1");
    const taskkillIndex = script.indexOf("taskkill");
    const confirmationIndex = script.indexOf(
      "Confirm-RalphtonProcessTreeStopped -TaskkillExitCode",
    );
    const removePidIndex = script
      .toLowerCase()
      .indexOf("remove-item -literalpath $pidfile");

    expect(script).toMatch(/function\s+Stop-RalphtonProcessTree/iu);
    expect(script).toMatch(/\$taskkillExitCode\s*=\s*\$LASTEXITCODE/iu);
    expect(script).toMatch(
      /Confirm-RalphtonProcessTreeStopped[\s\S]*-TaskkillExitCode\s+\$taskkillExitCode/iu,
    );
    expect(taskkillIndex).toBeGreaterThan(-1);
    expect(confirmationIndex).toBeGreaterThan(taskkillIndex);
    expect(removePidIndex).toBeGreaterThan(confirmationIndex);
  });

  it("requires successful taskkill and a fully exited process-tree snapshot", async () => {
    const stopper = await readScript("종료하기.ps1");

    expect(stopper).toMatch(/function\s+Get-RalphtonProcessTreeSnapshot/iu);
    expect(stopper).toMatch(/function\s+Confirm-RalphtonProcessTreeStopped/iu);

    const stopperPath = resolve(projectRoot, "종료하기.ps1");
    const probe = `
. ${asPowerShellLiteral(stopperPath)}
$nonzeroRejected = $false
$liveSnapshotRejected = $false
$goneSnapshotAccepted = $false
try {
  Confirm-RalphtonProcessTreeStopped -TaskkillExitCode 5 -ProcessIds @() -TimeoutMilliseconds 0
}
catch { $nonzeroRejected = $true }
try {
  Confirm-RalphtonProcessTreeStopped -TaskkillExitCode 0 -ProcessIds @($PID) -TimeoutMilliseconds 0
}
catch { $liveSnapshotRejected = $true }
try {
  Confirm-RalphtonProcessTreeStopped -TaskkillExitCode 0 -ProcessIds @(2147483646) -TimeoutMilliseconds 0
  $goneSnapshotAccepted = $true
}
catch { }
[pscustomobject]@{
  nonzeroRejected = $nonzeroRejected
  liveSnapshotRejected = $liveSnapshotRejected
  goneSnapshotAccepted = $goneSnapshotAccepted
} | ConvertTo-Json -Compress
`;
    const result = JSON.parse(runPowerShell(probe)) as Record<string, boolean>;

    expect(result).toEqual({
      nonzeroRejected: true,
      liveSnapshotRejected: true,
      goneSnapshotAccepted: true,
    });
  }, 30_000);

  it("has a shutdown CMD wrapper calling the PowerShell shutdown script", async () => {
    const script = await readScript("종료하기.cmd");

    expect(script).toMatch(/powershell/iu);
    expect(script).toMatch(/-ExecutionPolicy\s+Bypass/iu);
    expect(script).toMatch(/%~dpn0\.ps1/iu);
  });

  it("has a Windows smoke test script covering first run, duplicate blocking, port skip, and shutdown", async () => {
    const script = await readScript("scripts/verify-windows.ps1");

    expect(script).toMatch(/-NoBrowser/iu);
    expect(script).toMatch(/duplicate|already\s+running/iu);
    expect(script).toMatch(/3000\s*\.\.\s*3099|3000\s*\.\.\.\s*3099/iu);
    expect(script).toMatch(/port\s*(?:skip|occupied|in\s+use|free)/iu);
    expect(script).toMatch(/shutdown|종료/iu);
    expect(script).toMatch(/\/api\/health/iu);
  });

  it("aborts later smoke phases when the first browserless launch fails", async () => {
    const script = await readScript("scripts/verify-windows.ps1");
    const launchFailureGate = script.search(
      /if\s*\(\$launchResult\.ExitCode\s+-ne\s+0[\s\S]*?throw/iu,
    );
    const duplicatePhase = script.indexOf("$duplicateResult = Invoke-Launcher");

    expect(launchFailureGate).toBeGreaterThan(-1);
    expect(duplicatePhase).toBeGreaterThan(launchFailureGate);
    expect(script).toMatch(
      /catch\s*\{[\s\S]*\$failures\.Add\([\s\S]*smoke[\s\S]*\)/iu,
    );
  });

  it("captures child output separately from exit status and refuses destructive pre-cleaning", async () => {
    const script = await readScript("scripts/verify-windows.ps1");

    expect(script).toMatch(
      /if\s*\(\$MyInvocation\.InvocationName\s+-eq\s+['"]\.['"]\)\s*\{\s*return\s*\}/iu,
    );
    expect(script).toMatch(/\[pscustomobject\]\s*@\{[\s\S]*ExitCode[\s\S]*Output/iu);
    expect(script).toMatch(/Refus(?:e|ing)[\s\S]*(?:PID|metadata)/iu);
    expect(script).not.toMatch(/Remove-Item\s+-LiteralPath\s+\$pidFile/iu);
    expect(script).not.toMatch(/Remove-Item\s+-LiteralPath\s+\$portFile/iu);

    const verifierPath = resolve(projectRoot, "scripts", "verify-windows.ps1");
    const fixturePath = resolve(
      projectRoot,
      "tests",
      "windows",
      "fixtures",
      "exit-with-output.ps1",
    );
    const probe = `
. ${asPowerShellLiteral(verifierPath)}
$success = Invoke-RalphtonPowerShellFile -FilePath ${asPowerShellLiteral(fixturePath)} -Arguments @('-ExitCode', '0')
$failure = Invoke-RalphtonPowerShellFile -FilePath ${asPowerShellLiteral(fixturePath)} -Arguments @('-ExitCode', '7')
[pscustomobject]@{
  successExitCode = $success.ExitCode
  successOutput = [string]::Join('|', $success.Output)
  failureExitCode = $failure.ExitCode
  failureOutput = [string]::Join('|', $failure.Output)
} | ConvertTo-Json -Compress
`;
    const result = JSON.parse(runPowerShell(probe)) as Record<string, unknown>;

    expect(result).toEqual({
      successExitCode: 0,
      successOutput: "fixture-output",
      failureExitCode: 7,
      failureOutput: "fixture-output",
    });
  }, 90_000);

  it("binds verifier cleanup to the PID captured from its own launch", async () => {
    const verifier = await readScript("scripts/verify-windows.ps1");

    expect(verifier).toMatch(/function\s+Confirm-RalphtonVerifierCleanupPid/iu);
    expect(verifier).toMatch(/['"]-ExpectedPid['"]\s*,\s*\$startedPid/iu);
    expect(verifier).not.toMatch(/['"]-ExpectedPid['"]\s*,\s*\$cleanupRaw/iu);

    const verifierPath = resolve(projectRoot, "scripts", "verify-windows.ps1");
    const probe = `
. ${asPowerShellLiteral(verifierPath)}
$matchingAccepted = $false
$replacementRejected = $false
$missingCaptureRejected = $false
try {
  $matchingAccepted = (Confirm-RalphtonVerifierCleanupPid -StartedPid 1234 -CurrentPidText '1234') -eq 1234
}
catch { }
try {
  Confirm-RalphtonVerifierCleanupPid -StartedPid 1234 -CurrentPidText '5678' | Out-Null
}
catch { $replacementRejected = $true }
try {
  Confirm-RalphtonVerifierCleanupPid -StartedPid 0 -CurrentPidText '1234' | Out-Null
}
catch { $missingCaptureRejected = $true }
[pscustomobject]@{
  matchingAccepted = $matchingAccepted
  replacementRejected = $replacementRejected
  missingCaptureRejected = $missingCaptureRejected
} | ConvertTo-Json -Compress
`;
    const result = JSON.parse(runPowerShell(probe)) as Record<string, boolean>;

    expect(result).toEqual({
      matchingAccepted: true,
      replacementRejected: true,
      missingCaptureRejected: true,
    });
  }, 30_000);
});
