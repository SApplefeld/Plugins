#Requires -Version 7.0
<#
.SYNOPSIS
Exercises the walker's launcher, Start-InstalledWikiWalk.ps1, and its registration script,
register-walk.ps1, against a temporary plugin list, temporary install folders and a stub walker.

.DESCRIPTION
Builds everything under a fresh work folder and points the launcher's LOCALAPPDATA, USERPROFILE and
CLAUDE_CONFIG_DIR at folders of the test's own, so the real llm-wiki folder, the real
installed_plugins.json and the real scheduled tasks are never read or written. Every child the test
starts has a working folder of the test's own. The stub walker, kb-walk.ps1 in each temporary
install, appends its folder, its working directory, its -Claude value and its process id to the
record file WALKTEST_RECORD names, prints one line to stdout and one to stderr, and exits with the
code WALKTEST_EXIT names. The stub claude on PATH is a claude.cmd that is never run. No case reaches
the real claude or the real walker.

It checks: a record pointing at a temporary install snapshots it under runtime\<version> and runs the
snapshot's kb-walk.ps1 in the launcher's own process with the snapshot as the working directory, the
stub claude as -Claude and the walker's exit code as its own, a non-zero code also leaving one ERROR
line in walk-launcher.log and a zero code none; a snapshot folder missing required files is rebuilt
and then run; a changed version makes a second snapshot, runs it and removes the
first; a held walk.lock leaves an older snapshot standing for a third version, and the next run with
the lock free removes it; an existing snapshot is reused, not copied again; with the list absent, or
holding no record for the plugin, the launcher copied beside a stub walker runs that walker, and with
no walker there refuses; an install missing each required file, an unparsable list, a record with no
install path and a record with a version that cannot name a folder each exit 1 with one line in
walk-launcher.log and run nothing; the walker's stdout and stderr land in walk-output.log and
walk-output.err.log; a PATH with no claude runs the walker without -Claude and logs it; and
register-walk.ps1 -WhatIf and -Remove -WhatIf print their definitions and the task path
\llm-wiki\<computer>.x\ for -User .\x, create nothing and exit 0,
with the registrar refusing a PATH without pwsh or claude and a launcher root under a plugin cache.
It also parses register-walk.ps1 and checks that every Register-ScheduledTask,
Unregister-ScheduledTask and Copy-Item sits inside an if whose condition calls ShouldProcess, and
runs that same check on a synthetic script with an unguarded call to show it can fail.

The test records every process it starts, and every stub process by the pid the stub wrote. A
recorded process still alive at the end is printed as "survivor <pid>" and then stopped, and the last
line before the summary reads "survivors <n>". It removes its work folder. The summary line names the
check count and the failure count, and the exit code is the failure count.

.PARAMETER LauncherPath
The launcher to run. Defaults to the one beside this test's folder. installed-plugin-functions.ps1 is
read from the same folder as the launcher, and a launcher copied into a temporary folder is copied
from this path.

.PARAMETER RegisterPath
The registration script to run. Defaults to the one beside this test's folder.

.PARAMETER WorkRoot
The folder under which the test creates its work folder. Defaults to the system temp folder.

.EXAMPLE
pwsh -NoProfile -File tests/Test-WalkLauncher.ps1
#>
[CmdletBinding()]
param(
    [string]$LauncherPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'Start-InstalledWikiWalk.ps1'),
    [string]$RegisterPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'register-walk.ps1'),
    [string]$WorkRoot = [System.IO.Path]::GetTempPath()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$failures = 0
$cases = 0
function Test-Check {
    param([string]$Description, [bool]$Passed)
    $script:cases++
    if ($Passed) {
        Write-Host "[PASS] $Description"
    } else {
        Write-Host "[FAIL] $Description"
        $script:failures++
        Write-FailureDetail
    }
}

# What the last run left, printed under a failed check so the reader sees the result without
# rerunning the test.
function Write-FailureDetail {
    $last = Get-Variable -Name r -Scope Script -ErrorAction SilentlyContinue
    if ($null -ne $last -and $null -ne $last.Value) {
        $stderrLines = @(Get-Lines ([string]$last.Value.Stderr))
        $stderrText = if ($stderrLines.Count -gt 0) { $stderrLines[0] } else { '' }
        Write-Host "  last run: exit $($last.Value.ExitCode), timed out $($last.Value.TimedOut), stderr '$stderrText'"
    }
    foreach ($entry in @(Get-StubRecords)) { Write-Host "  stub record: root '$($entry.Root)' cwd '$($entry.Cwd)' claude '$($entry.Claude)'" }
    if (Test-Path -LiteralPath $script:launcherLog) {
        foreach ($line in [System.IO.File]::ReadAllLines($script:launcherLog)) { Write-Host "  walk-launcher.log: $line" }
    }
}

# Every process this test starts, so the finally block can stop any still running.
$script:started = New-Object System.Collections.Generic.List[System.Diagnostics.Process]

# Stops a process this test started and every process it started, by its PID.
function Stop-StartedTree {
    param([System.Diagnostics.Process]$Process)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    $psi.Arguments = "/PID $($Process.Id) /T /F"
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $killer = [System.Diagnostics.Process]::Start($psi)
    try {
        $null = $killer.StandardError.ReadToEndAsync()
        $null = $killer.StandardOutput.ReadToEndAsync()
        [void]$killer.WaitForExit(10000)
        if (-not $Process.WaitForExit(5000)) { $Process.Kill() }
    } finally {
        $killer.Dispose()
    }
}

# Starts a program with its stdout and stderr read asynchronously, in a working folder of the test's
# own, with the named environment variables set, or removed where the value is $null.
function Start-Captured {
    param([string]$FilePath, [string[]]$Arguments, [hashtable]$Environment = @{})
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    foreach ($argument in $Arguments) { $psi.ArgumentList.Add($argument) }
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.WorkingDirectory = $script:cwd
    foreach ($name in $Environment.Keys) {
        if ($null -eq $Environment[$name]) {
            [void]$psi.EnvironmentVariables.Remove($name)
        } else {
            $psi.EnvironmentVariables[$name] = [string]$Environment[$name]
        }
    }
    $startedAt = [DateTime]::UtcNow
    $process = [System.Diagnostics.Process]::Start($psi)
    $script:started.Add($process)
    return [pscustomobject]@{
        Process   = $process
        StartedAt = $startedAt
        Stdout    = $process.StandardOutput.ReadToEndAsync()
        Stderr    = $process.StandardError.ReadToEndAsync()
    }
}

# Waits for a started program and both its streams. Past the timeout the program's tree is stopped
# and the result reads TimedOut.
function Wait-Captured {
    param($Run, [int]$TimeoutSeconds = 90)
    $deadline = $Run.StartedAt.AddSeconds($TimeoutSeconds)
    $remaining = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
    $finished = $Run.Process.WaitForExit($remaining)
    if ($finished) {
        $remaining = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        $finished = [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($Run.Stdout, $Run.Stderr), $remaining)
    }
    if (-not $finished) {
        Stop-StartedTree $Run.Process
        return [pscustomobject]@{ ExitCode = $null; Stdout = ''; Stderr = ''; TimedOut = $true }
    }
    $Run.Process.WaitForExit()
    return [pscustomobject]@{ ExitCode = $Run.Process.ExitCode; Stdout = $Run.Stdout.Result; Stderr = $Run.Stderr.Result; TimedOut = $false }
}

# Splits text into its non-empty lines.
function Get-Lines { param([string]$Text) return @($Text -split "`r?`n" | Where-Object { $_ -ne '' }) }

# A folder path in a form two spellings of one folder compare equal in.
function Get-Normal { param([string]$Path) return $Path.TrimEnd('\', '/') }

function Write-Utf8 {
    param([string]$Path, [string]$Text)
    [void][System.IO.Directory]::CreateDirectory((Split-Path -Parent $Path))
    [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false))
}

# The environment every launcher and registrar run gets: the three folders the scripts read pointed
# at the test's own, the stub claude first on PATH, and the stub walker's record and exit code.
function Get-RunEnvironment {
    param([hashtable]$Extra = @{})
    $environment = @{
        LOCALAPPDATA        = $script:local
        USERPROFILE         = $script:profileDir
        CLAUDE_CONFIG_DIR   = $script:configDir
        WALKTEST_RECORD     = $script:record
        WALKTEST_EXIT       = '0'
        Path                = "$script:stubBin;$(Split-Path -Parent $script:pwshExe);$env:Path"
    }
    foreach ($name in $Extra.Keys) { $environment[$name] = $Extra[$name] }
    return $environment
}

# Runs the launcher through the one helper every launcher case uses, from the path under test unless
# a copy is named.
function Invoke-Launcher {
    param([hashtable]$Extra = @{}, [string]$Launcher = $LauncherPath)
    $run = Start-Captured $script:pwshExe @('-NoProfile', '-File', $Launcher) (Get-RunEnvironment $Extra)
    $script:launcherPid = [string]$run.Process.Id
    return Wait-Captured $run
}

function Invoke-Registrar {
    param([string[]]$Arguments, [hashtable]$Extra = @{})
    $run = Start-Captured $script:pwshExe (@('-NoProfile', '-File', $RegisterPath) + $Arguments) (Get-RunEnvironment $Extra)
    return Wait-Captured $run
}

# One record per stub run: the folder the stub ran from, its working directory, its -Claude value
# and its pid with the start time of that process.
function Get-StubRecords {
    if (-not (Test-Path -LiteralPath $script:record)) { return }
    $lines = [System.IO.File]::ReadAllLines($script:record)
    for ($i = 0; $i + 3 -lt $lines.Count; $i += 4) {
        [pscustomobject]@{
            Root   = Get-Normal ($lines[$i] -replace '^ROOT:', '')
            Cwd    = Get-Normal ($lines[$i + 1] -replace '^CWD:', '')
            Claude = ($lines[$i + 2] -replace '^CLAUDE:', '')
            Pid    = ($lines[$i + 3] -replace '^PID:', '')
        }
    }
}

# Remembers the pid of every stub started, so the end of the test can report any still alive.
$script:stubPids = New-Object System.Collections.Generic.List[string]
function Save-StubPids {
    foreach ($entry in @(Get-StubRecords)) { $script:stubPids.Add($entry.Pid) }
}

function Clear-Run {
    Save-StubPids
    foreach ($file in @($script:record, $script:launcherLog, (Join-Path $script:walkDir 'walk-output.log'), (Join-Path $script:walkDir 'walk-output.err.log'))) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
}

# The stub walker. It records itself, prints a line to each stream and exits with WALKTEST_EXIT.
$stubWalker = @'
[CmdletBinding()]
param([string]$Claude)
$lines = @("ROOT:$PSScriptRoot", "CWD:$((Get-Location).ProviderPath)", "CLAUDE:$Claude",
    "PID:$PID/$((Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks)")
[System.IO.File]::AppendAllLines($env:WALKTEST_RECORD, [string[]]$lines)
[Console]::Out.WriteLine('stub-out-line')
[Console]::Error.WriteLine('stub-err-line')
exit ([int]$env:WALKTEST_EXIT)
'@

# Makes an install folder holding the four required files, the walker among them being the stub.
function New-Install {
    param([string]$Name, [string[]]$Without = @())
    $folder = Join-Path $script:installs $Name
    $files = @{
        'kb-walk.ps1'                  = $stubWalker
        'kb-registry.ps1'              = '# registry'
        'template\.claude\kb-run.ps1'  = '# wrapper'
        '.claude-plugin\plugin.json'   = '{"name":"wiki"}'
    }
    foreach ($relative in $files.Keys) {
        if ($Without -contains $relative) { continue }
        Write-Utf8 (Join-Path $folder $relative) $files[$relative]
    }
    return $folder
}

# Writes installed_plugins.json with one wiki@applefeld record. A $null install path leaves the
# field out.
function Write-PluginList {
    param([string]$Version, $InstallPath)
    $record = [ordered]@{ scope = 'user'; version = $Version }
    if ($null -ne $InstallPath) { $record['installPath'] = $InstallPath }
    $list = [ordered]@{ version = 2; plugins = [ordered]@{ 'wiki@applefeld' = @($record) } }
    Write-Utf8 $script:listPath (ConvertTo-Json -InputObject $list -Depth 8)
}

# True when an if condition, read from its parsed form, is one un-negated call to a method named
# ShouldProcess. A -not or ! around the call makes the condition a unary expression, which is false here.
function Test-IsShouldProcessCall {
    param($Condition)
    if ($Condition -isnot [System.Management.Automation.Language.PipelineAst]) { return $false }
    if ($Condition.PipelineElements.Count -ne 1) { return $false }
    $element = $Condition.PipelineElements[0]
    if ($element -isnot [System.Management.Automation.Language.CommandExpressionAst]) { return $false }
    $call = $element.Expression
    if ($call -isnot [System.Management.Automation.Language.InvokeMemberExpressionAst]) { return $false }
    return ($call.Member -is [System.Management.Automation.Language.StringConstantExpressionAst]) -and ($call.Member.Value -ieq 'ShouldProcess')
}

# True when every call to a named command in the script text sits in the body of an if whose
# condition is an un-negated ShouldProcess call, found by walking up the parsed script from each call.
function Test-CallsGuarded {
    param([string]$ScriptText, [string[]]$Commands)
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($ScriptText, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) { return $false }
    $calls = @($ast.FindAll({
        param($node)
        ($node -is [System.Management.Automation.Language.CommandAst]) -and ($Commands -contains $node.GetCommandName())
    }, $true))
    if ($calls.Count -eq 0) { return $false }
    foreach ($call in $calls) {
        $guarded = $false
        $child = $call
        $parent = $call.Parent
        while ($null -ne $parent) {
            if ($parent -is [System.Management.Automation.Language.IfStatementAst]) {
                foreach ($clause in $parent.Clauses) {
                    $inBody = ($child -eq $clause.Item2)
                    if ($inBody -and (Test-IsShouldProcessCall $clause.Item1)) { $guarded = $true }
                }
            }
            $child = $parent
            $parent = $parent.Parent
        }
        if (-not $guarded) { return $false }
    }
    return $true
}

$work = Join-Path ([System.IO.Path]::GetFullPath($WorkRoot)) ("walklauncher-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$script:profileDir = Join-Path $work 'profile'
$script:local = Join-Path $work 'local'
$script:configDir = Join-Path $script:profileDir '.claude'
$script:listPath = Join-Path $script:configDir 'plugins\installed_plugins.json'
$script:walkDir = Join-Path $script:local 'llm-wiki'
$script:runtimeRoot = Join-Path $script:walkDir 'runtime'
$script:launcherLog = Join-Path $script:walkDir 'walk-launcher.log'
$script:lockPath = Join-Path $script:walkDir 'walk.lock'
$script:cwd = Join-Path $work 'cwd'
$script:installs = Join-Path $work 'installs'
$script:stubBin = Join-Path $work 'stubbin'
$script:record = Join-Path $work 'record.txt'
$script:pwshExe = [Environment]::ProcessPath
$script:stubClaude = Join-Path $script:stubBin 'claude.cmd'
$launcherFolder = Split-Path -Parent ([System.IO.Path]::GetFullPath($LauncherPath))
$lock = $null

try {
    foreach ($folder in @($script:profileDir, $script:local, $script:cwd, $script:installs, $script:stubBin)) {
        [void][System.IO.Directory]::CreateDirectory($folder)
    }
    Write-Utf8 $script:stubClaude "@echo off`r`nexit /b 0`r`n"

    # --- A record pointing at a temporary install: snapshot it, run the snapshot.
    $install1 = New-Install 'wiki-1'
    Write-PluginList '1.0.0' $install1
    $snapshot1 = Join-Path $script:runtimeRoot '1.0.0'
    $r = Invoke-Launcher @{ WALKTEST_EXIT = '7' }
    $records = @(Get-StubRecords)
    Test-Check 'the launcher exits with the stub walker''s exit code' ((-not $r.TimedOut) -and ($r.ExitCode -eq 7))
    Test-Check 'a record pointing at an install makes the snapshot folder runtime\<version>' (Test-Path -LiteralPath (Join-Path $snapshot1 'kb-walk.ps1') -PathType Leaf)
    Test-Check 'the stub ran once, from the snapshot and not from the install' ($records.Count -eq 1 -and $records[0].Root -ieq (Get-Normal $snapshot1) -and $records[0].Root -ine (Get-Normal $install1))
    Test-Check 'the stub''s working directory, read from its record, is the snapshot' ($records.Count -eq 1 -and $records[0].Cwd -ieq (Get-Normal $snapshot1))
    Test-Check 'the stub received -Claude carrying the stub claude path found on PATH' ($records.Count -eq 1 -and $records[0].Claude -ieq $script:stubClaude)
    Test-Check 'the stub walker''s process id equals the launcher process''s id, so the walker runs in the launcher''s own process' ($records.Count -eq 1 -and ($records[0].Pid -split '/')[0] -eq $script:launcherPid)

    # --- A walker's non-zero exit leaves one lasting line in walk-launcher.log.
    $exitLines = @(if (Test-Path -LiteralPath $script:launcherLog) { Get-Lines ([System.IO.File]::ReadAllText($script:launcherLog)) })
    Test-Check 'a walker exit of 7 adds exactly one walk-launcher.log line, ERROR the walker exited 7 with the last stderr line' ($exitLines.Count -eq 1 -and $exitLines[0] -match 'ERROR the walker exited 7: stub-err-line$')

    # --- The walker's output reaches the two files, not a pipe.
    $outFile = Join-Path $script:walkDir 'walk-output.log'
    $errFile = Join-Path $script:walkDir 'walk-output.err.log'
    $outText = if (Test-Path -LiteralPath $outFile) { [System.IO.File]::ReadAllText($outFile) } else { '' }
    $errText = if (Test-Path -LiteralPath $errFile) { [System.IO.File]::ReadAllText($errFile) } else { '' }
    Test-Check 'the stub''s stdout line lands in walk-output.log and not in walk-output.err.log' ($outText.Contains('stub-out-line') -and -not $errText.Contains('stub-out-line'))
    Test-Check 'the stub''s stderr line lands in walk-output.err.log and not in walk-output.log' ($errText.Contains('stub-err-line') -and -not $outText.Contains('stub-err-line'))
    Test-Check 'the launcher''s own stdout and stderr carry none of the stub''s lines' ((-not $r.Stdout.Contains('stub-out-line')) -and (-not $r.Stderr.Contains('stub-err-line')))

    # --- An existing snapshot is used as it stands.
    Write-Utf8 (Join-Path $snapshot1 'reuse-marker.txt') 'marker'
    Clear-Run
    $r = Invoke-Launcher
    Test-Check 'a second run with the same version reuses the snapshot, leaving a marker file added to it in place' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (Test-Path -LiteralPath (Join-Path $snapshot1 'reuse-marker.txt')) -and (@(Get-StubRecords).Count -eq 1))
    Test-Check 'a walker exit of 0 writes nothing to walk-launcher.log' (-not (Test-Path -LiteralPath $script:launcherLog))
    Test-Check 'no temporary copy is left under runtime' (@(Get-ChildItem -LiteralPath $script:runtimeRoot -Directory -Force | Where-Object { $_.Name -like '.*.tmp' }).Count -eq 0)

    # --- Stale temporary copies: an aged one is swept at start, a fresh one is left.
    $agedTemp = Join-Path $script:runtimeRoot '.7.0.0.11111.tmp'
    $freshTemp = Join-Path $script:runtimeRoot '.7.0.0.22222.tmp'
    Write-Utf8 (Join-Path $agedTemp 'half.txt') 'half copy'
    Write-Utf8 (Join-Path $freshTemp 'half.txt') 'half copy'
    [System.IO.Directory]::SetLastWriteTimeUtc($agedTemp, [DateTime]::UtcNow.AddHours(-3))
    Clear-Run
    $r = Invoke-Launcher
    Test-Check 'a launcher run removes a dot-named temporary copy under runtime older than the stale age' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (-not (Test-Path -LiteralPath $agedTemp)))
    Test-Check 'a launcher run leaves a fresh dot-named temporary copy under runtime in place' (Test-Path -LiteralPath (Join-Path $freshTemp 'half.txt') -PathType Leaf)
    Remove-Item -LiteralPath $freshTemp -Recurse -Force

    # --- A changed version: a second snapshot is made and run, the first removed.
    $install2 = New-Install 'wiki-2'
    Write-PluginList '2.0.0' $install2
    $snapshot2 = Join-Path $script:runtimeRoot '2.0.0'
    Clear-Run
    $r = Invoke-Launcher
    $records = @(Get-StubRecords)
    Test-Check 'a changed version makes a second snapshot and runs it' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (Test-Path -LiteralPath (Join-Path $snapshot2 'kb-walk.ps1')) -and $records.Count -eq 1 -and $records[0].Root -ieq (Get-Normal $snapshot2) -and $records[0].Cwd -ieq (Get-Normal $snapshot2))
    Test-Check 'with the walk lock free, the first version''s snapshot is removed' (-not (Test-Path -LiteralPath $snapshot1))

    # --- A held walk.lock: nothing is removed, the third version still runs.
    $install3 = New-Install 'wiki-3'
    Write-PluginList '3.0.0' $install3
    $snapshot3 = Join-Path $script:runtimeRoot '3.0.0'
    Clear-Run
    $lock = [System.IO.File]::Open($script:lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    try {
        $r = Invoke-Launcher
    } finally {
        $lock.Dispose()
        $lock = $null
    }
    $records = @(Get-StubRecords)
    Test-Check 'with the walk lock held, a third version still runs from its snapshot' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and $records.Count -eq 1 -and $records[0].Root -ieq (Get-Normal $snapshot3))
    Test-Check 'with the walk lock held, the older snapshot survives' (Test-Path -LiteralPath (Join-Path $snapshot2 'kb-walk.ps1') -PathType Leaf)
    Clear-Run
    $r = Invoke-Launcher
    Test-Check 'the next run with the lock free removes the older snapshot and keeps the one it runs' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (-not (Test-Path -LiteralPath $snapshot2)) -and (Test-Path -LiteralPath (Join-Path $snapshot3 'kb-walk.ps1')))

    # --- No record: the walker beside the launcher runs.
    $solo = Join-Path $work 'solo'
    [void][System.IO.Directory]::CreateDirectory($solo)
    $soloLauncher = Join-Path $solo (Split-Path -Leaf $LauncherPath)
    Copy-Item -LiteralPath $LauncherPath -Destination $soloLauncher
    Copy-Item -LiteralPath (Join-Path $launcherFolder 'installed-plugin-functions.ps1') -Destination (Join-Path $solo 'installed-plugin-functions.ps1')
    Write-Utf8 (Join-Path $solo 'kb-walk.ps1') $stubWalker
    Remove-Item -LiteralPath $script:listPath -Force
    Clear-Run
    $r = Invoke-Launcher @{ WALKTEST_EXIT = '5' } $soloLauncher
    $records = @(Get-StubRecords)
    Test-Check 'with the list file absent, the launcher runs the kb-walk.ps1 beside itself and exits with its code' ((-not $r.TimedOut) -and ($r.ExitCode -eq 5) -and $records.Count -eq 1 -and $records[0].Root -ieq (Get-Normal $solo) -and $records[0].Cwd -ieq (Get-Normal $solo) -and $records[0].Claude -ieq $script:stubClaude)
    Write-Utf8 $script:listPath '{"version":2,"plugins":{"other@market":[{"scope":"user","version":"9.9.9","installPath":"C:\\nowhere"}]}}'
    Clear-Run
    $r = Invoke-Launcher @{} $soloLauncher
    $records = @(Get-StubRecords)
    Test-Check 'with a list holding no wiki@applefeld record, the launcher runs the walker beside itself' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and $records.Count -eq 1 -and $records[0].Root -ieq (Get-Normal $solo))
    $freshLocal = Join-Path $work 'fresh-local'
    [void][System.IO.Directory]::CreateDirectory($freshLocal)
    Clear-Run
    $r = Invoke-Launcher @{ LOCALAPPDATA = $freshLocal } $soloLauncher
    Test-Check 'with no llm-wiki folder yet, a no-record run creates it and the walker''s output file' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (Test-Path -LiteralPath (Join-Path $freshLocal 'llm-wiki\walk-output.log') -PathType Leaf) -and @(Get-StubRecords).Count -eq 1)
    Remove-Item -LiteralPath (Join-Path $solo 'kb-walk.ps1') -Force
    Clear-Run
    $r = Invoke-Launcher @{} $soloLauncher
    $logLines = @(if (Test-Path -LiteralPath $script:launcherLog) { Get-Lines ([System.IO.File]::ReadAllText($script:launcherLog)) })
    Test-Check 'with no record and no kb-walk.ps1 beside the launcher it refuses with exit 1, one log line and no run' ((-not $r.TimedOut) -and ($r.ExitCode -eq 1) -and $logLines.Count -eq 1 -and $logLines[0].Contains('no kb-walk.ps1 beside the launcher') -and @(Get-StubRecords).Count -eq 0)

    # --- Refusals: an install missing each required file.
    foreach ($relative in @('kb-walk.ps1', 'kb-registry.ps1', 'template\.claude\kb-run.ps1', '.claude-plugin\plugin.json')) {
        $broken = New-Install ("broken-" + ($relative -replace '[\\.]', '_')) @($relative)
        Write-PluginList '4.0.0' $broken
        Clear-Run
        $r = Invoke-Launcher
        $logLines = @(if (Test-Path -LiteralPath $script:launcherLog) { Get-Lines ([System.IO.File]::ReadAllText($script:launcherLog)) })
        Test-Check "an install missing $relative is refused by the required-file rule: exit 1, one log line naming it, stub not run, no snapshot" ((-not $r.TimedOut) -and ($r.ExitCode -eq 1) -and $logLines.Count -eq 1 -and $logLines[0].Contains("is missing $relative") -and ($r.Stderr.Contains("is missing $relative")) -and @(Get-StubRecords).Count -eq 0 -and (-not (Test-Path -LiteralPath (Join-Path $script:runtimeRoot '4.0.0'))))
    }

    # --- Refusals: the list.
    Write-Utf8 $script:listPath '{ this is not json'
    Clear-Run
    $r = Invoke-Launcher
    $logLines = @(if (Test-Path -LiteralPath $script:launcherLog) { Get-Lines ([System.IO.File]::ReadAllText($script:launcherLog)) })
    Test-Check 'an unparsable list is refused by the list-read rule: exit 1, one log line saying it could not be read, stub not run' ((-not $r.TimedOut) -and ($r.ExitCode -eq 1) -and $logLines.Count -eq 1 -and $logLines[0].Contains('could not be read') -and @(Get-StubRecords).Count -eq 0)
    Write-PluginList '5.0.0' $null
    Clear-Run
    $r = Invoke-Launcher
    $logLines = @(if (Test-Path -LiteralPath $script:launcherLog) { Get-Lines ([System.IO.File]::ReadAllText($script:launcherLog)) })
    Test-Check 'a record with no install path is refused by the record rule: exit 1, one log line naming installPath, stub not run' ((-not $r.TimedOut) -and ($r.ExitCode -eq 1) -and $logLines.Count -eq 1 -and $logLines[0].Contains('installPath') -and @(Get-StubRecords).Count -eq 0)
    Write-PluginList '..' $install3
    Clear-Run
    $r = Invoke-Launcher
    $logLines = @(if (Test-Path -LiteralPath $script:launcherLog) { Get-Lines ([System.IO.File]::ReadAllText($script:launcherLog)) })
    Test-Check 'a record whose version cannot name a folder is refused by the version rule: exit 1, one log line, stub not run' ((-not $r.TimedOut) -and ($r.ExitCode -eq 1) -and $logLines.Count -eq 1 -and $logLines[0].Contains('cannot name a folder') -and @(Get-StubRecords).Count -eq 0)

    # --- A PATH with no claude: the walker runs without -Claude and the launcher says so.
    Write-PluginList '3.0.0' $install3
    Clear-Run
    $r = Invoke-Launcher @{ Path = "$(Split-Path -Parent $script:pwshExe);$env:SystemRoot\System32" }
    $records = @(Get-StubRecords)
    $logLines = @(if (Test-Path -LiteralPath $script:launcherLog) { Get-Lines ([System.IO.File]::ReadAllText($script:launcherLog)) })
    Test-Check 'with claude off PATH the walker runs without -Claude, the launcher logs one line saying so and exits with the walker''s code' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and $records.Count -eq 1 -and $records[0].Claude -eq '' -and $logLines.Count -eq 1 -and $logLines[0].Contains('claude was not found on PATH'))

    # --- A partial snapshot is rebuilt, never run.
    $install6 = New-Install 'wiki-6'
    Write-PluginList '6.0.0' $install6
    $snapshot6 = Join-Path $script:runtimeRoot '6.0.0'
    Write-Utf8 (Join-Path $snapshot6 'kb-registry.ps1') '# partial'
    Write-Utf8 (Join-Path $snapshot6 'partial-marker.txt') 'marker'
    Clear-Run
    $r = Invoke-Launcher
    $records = @(Get-StubRecords)
    $holdsAll = $true
    foreach ($relative in @('kb-walk.ps1', 'kb-registry.ps1', 'template\.claude\kb-run.ps1', '.claude-plugin\plugin.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $snapshot6 $relative) -PathType Leaf)) { $holdsAll = $false }
    }
    Test-Check 'a snapshot folder holding only some required files is rebuilt: the stub runs from it and it now holds every required file' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and $records.Count -eq 1 -and $records[0].Root -ieq (Get-Normal $snapshot6) -and $holdsAll -and (-not (Test-Path -LiteralPath (Join-Path $snapshot6 'partial-marker.txt'))))

    # --- register-walk.ps1 -WhatIf and -Remove -WhatIf.
    $expectedTaskPath = "\llm-wiki\$env:COMPUTERNAME.x\"
    $defaultRoot = Join-Path $script:walkDir 'launcher'
    $expectedLauncher = Join-Path $defaultRoot 'Start-InstalledWikiWalk.ps1'
    $r = Invoke-Registrar @('-User', '.\x', '-WhatIf')
    Test-Check 'register-walk.ps1 -User .\x -WhatIf exits 0' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0))
    Test-Check '-WhatIf prints the task name wiki-walk' ($r.Stdout -match '(?m)^Task name:\s+wiki-walk\s*$')
    Test-Check '-WhatIf prints the task path \llm-wiki\<computer>.x\ for -User .\x' (($r.Stdout -match '(?m)^Task path:\s+(.+?)\s*$') -and ($Matches[1] -ieq $expectedTaskPath))
    Test-Check '-WhatIf prints the S4U logon type and the Limited run level' (($r.Stdout -match '(?m)^Logon type:\s+S4U\s*$') -and ($r.Stdout -match '(?m)^Run level:\s+Limited\s*$'))
    Test-Check '-WhatIf prints the PT1H repetition interval and the PT2H time limit' (($r.Stdout -match '(?m)^Repeats:\s+PT1H\s*$') -and ($r.Stdout -match '(?m)^Time limit:\s+PT2H\s*$'))
    Test-Check '-WhatIf prints the launcher path under the default launcher root, inside the action line' (($r.Stdout -match '(?m)^Launcher:\s+(.+?)\s*$') -and ($Matches[1] -ieq $expectedLauncher) -and $r.Stdout.Contains("-File `"$expectedLauncher`""))
    Test-Check '-WhatIf prints the pwsh action with the hidden, non-interactive, bypass flags' ($r.Stdout -match '(?m)^Arguments:\s+-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ')
    Test-Check '-WhatIf for another account warns on stderr' ($r.Stderr -match 'warning: pwsh')
    Test-Check '-WhatIf copies nothing: the launcher root does not exist afterwards' (-not (Test-Path -LiteralPath $defaultRoot))
    $r = Invoke-Registrar @('-Remove', '-WhatIf')
    Test-Check 'register-walk.ps1 -Remove -WhatIf exits 0 and prints the task it would unregister' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($r.Stdout -match '(?m)^Task name:\s+wiki-walk\s*$') -and ($r.Stdout -match '(?m)^Remove:\s+unregister the scheduled task wiki-walk\s*$'))
    $r = Invoke-Registrar @('-Remove', '-User', '.\x', '-WhatIf')
    Test-Check 'register-walk.ps1 -Remove -User .\x -WhatIf exits 0 and prints the task path \llm-wiki\<computer>.x\' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($r.Stdout -match '(?m)^Task path:\s+(.+?)\s*$') -and ($Matches[1] -ieq $expectedTaskPath))

    # --- The registrar's refusals.
    # pwsh 7 prepends its own folder to PATH at startup, so no PATH makes the registrar's pwsh refusal fire and the test has no case for it.
    $r = Invoke-Registrar @('-User', '.\x', '-WhatIf') @{ Path = "$(Split-Path -Parent $script:pwshExe);$env:SystemRoot\System32" }
    Test-Check 'the registrar refuses a PATH with no claude by the claude rule: exit 1 and a stderr line naming claude' ((-not $r.TimedOut) -and ($r.ExitCode -eq 1) -and ($r.Stderr -match 'claude was not found on PATH'))
    $cacheRoot = Join-Path $work 'home\plugins\cache\market\wiki'
    $r = Invoke-Registrar @('-User', '.\x', '-WhatIf', '-LauncherRoot', $cacheRoot)
    Test-Check 'the registrar refuses a launcher root under a plugins\cache folder: exit 1 and a stderr line naming it' ((-not $r.TimedOut) -and ($r.ExitCode -eq 1) -and ($r.Stderr -match 'plugins\\cache'))
    $r = Invoke-Registrar @('-User', '.\x', '-WhatIf', '-LauncherRoot', (Split-Path -Parent ([System.IO.Path]::GetFullPath($RegisterPath))))
    Test-Check 'a launcher root naming the registrar''s own folder is accepted by -WhatIf and prints the launcher beside the registrar' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($r.Stdout -match '(?m)^Launcher:\s+.*Start-InstalledWikiWalk\.ps1\s*$'))

    # --- Registers nothing under -WhatIf: read from the parsed source, not from a run.
    $registerText = [System.IO.File]::ReadAllText($RegisterPath)
    Test-Check 'every Register-ScheduledTask, Unregister-ScheduledTask and Copy-Item in register-walk.ps1 sits in the body of an if calling ShouldProcess' (Test-CallsGuarded $registerText @('Register-ScheduledTask', 'Unregister-ScheduledTask', 'Copy-Item'))
    $unguarded = "[CmdletBinding(SupportsShouldProcess)]`nparam()`nif (`$PSCmdlet.ShouldProcess('x', 'y')) { Copy-Item a b }`nRegister-ScheduledTask -TaskName t"
    Test-Check 'the guard check fails on a script with an unguarded Register-ScheduledTask' (-not (Test-CallsGuarded $unguarded @('Register-ScheduledTask', 'Copy-Item')))
    $guardedOnly = "[CmdletBinding(SupportsShouldProcess)]`nparam()`nif (`$PSCmdlet.ShouldProcess('x', 'y')) { Register-ScheduledTask -TaskName t; Copy-Item a b } else { Write-Output 'no' }"
    Test-Check 'the guard check passes on a script whose calls all sit in the ShouldProcess body' (Test-CallsGuarded $guardedOnly @('Register-ScheduledTask', 'Copy-Item'))
    $inElse = "[CmdletBinding(SupportsShouldProcess)]`nparam()`nif (`$PSCmdlet.ShouldProcess('x', 'y')) { Write-Output 'yes' } else { Register-ScheduledTask -TaskName t }"
    Test-Check 'the guard check fails on a Register-ScheduledTask in the else branch of the ShouldProcess if' (-not (Test-CallsGuarded $inElse @('Register-ScheduledTask')))
    $negated = "[CmdletBinding(SupportsShouldProcess)]`nparam()`nif (-not `$PSCmdlet.ShouldProcess('x', 'y')) { Register-ScheduledTask -TaskName t }"
    Test-Check 'the guard check fails on a Register-ScheduledTask in the body of an if whose ShouldProcess condition is negated' (-not (Test-CallsGuarded $negated @('Register-ScheduledTask')))
} finally {
    if ($null -ne $lock) { $lock.Dispose() }

    # Every stub process by the pid and start time it wrote, then every process the test started.
    $survivorCount = 0
    Save-StubPids
    foreach ($recorded in $script:stubPids) {
        $parts = $recorded -split '/'
        try {
            $live = [System.Diagnostics.Process]::GetProcessById([int]$parts[0])
            if ($live.StartTime.ToUniversalTime().Ticks -eq [long]$parts[1]) {
                $survivorCount++
                Write-Host "survivor $($live.Id) stub walker"
                $live.Kill()
                [void]$live.WaitForExit(5000)
            }
            $live.Dispose()
        } catch {
            # The process has ended.
        }
    }
    foreach ($process in $script:started) {
        if (-not $process.HasExited) {
            $survivorCount++
            Write-Host "survivor $($process.Id) $(Split-Path -Leaf $process.StartInfo.FileName)"
            Stop-StartedTree $process
        }
    }
    Write-Host "survivors $survivorCount"
    if (Test-Path -LiteralPath $work) {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "$cases walk-launcher checks, $failures failed."
exit $failures
