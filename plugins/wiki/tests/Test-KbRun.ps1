#Requires -Version 5.1
<#
.SYNOPSIS
Exercises the run wrapper, template/.claude/kb-run.ps1, against a throwaway git
repository standing in for a KB and a stub standing in for Claude.

.DESCRIPTION
Builds one KB under a fresh work folder, holding only a README and a copy of the
wrapper at .claude\kb-run.ps1, commits it, and runs the wrapper under the same
PowerShell host that runs this test. Every run passes the test's own claude.cmd
stub as -Claude, except the PATH cases, which pass none and set the wrapper's
PATH. The stub records its arguments and working directory, writes one line to
stderr, sleeps the seconds KBRUN_STUB_SLEEP names, writes an after-sleep
marker, and exits with the code KBRUN_STUB_EXIT names. Started with --version
as its first argument, for the wrapper's build read, the stub writes none of
that: it records its arguments in a file of its own, prints the build
KBRUN_STUB_BUILD names, or 2.1.257 where the case names none, prints the text
KBRUN_STUB_BUILD_NOISE names as a second line and on stderr, sleeps the seconds
KBRUN_STUB_BUILD_SLEEP names, and exits with the code KBRUN_STUB_BUILD_EXIT
names. Nothing but the stub reads those six variables, and no case reaches the
real claude.

It checks the pinned argument line for Ingest, Lint and Merge, -WhatIf naming
wiki-merge for Merge, the exit code passed through, the stub's working directory, stderr pass-through, a clean tree and the
lock file after a run, the lock refused while the test holds it and while a
live run holds it, each paired with a run that proceeds once the lock is free,
the budget stop with the stub's process tree gone, the lock free after a wrapper
is killed mid-run, the stub gone from the process list after the wrapper alone
is killed while the stub sleeps, an invalid KB_RUN_SECONDS,
-WhatIf taking no lock, an -Operation outside the set, and claude resolved from
PATH or refused when PATH holds none.

For the build read it checks a stub build of 2.1.256 refused and 2.1.257 run,
2.0.999 and 1.99.999 refused and 2.1.1000, 2.2.0 and 3.0.0 run, the line
"2.1.322 (Claude Code)" run with --version as the read's one argument, a first
line holding no build refused with none of the stub's text in the refusal, a
read that exits non-zero refused, a read that hangs stopped at its bound with
its process gone, a slow read leaving the run only what remains of the
budget, -WhatIf refused on an old build while the test holds the
lock, and a run that finds the lock held reading no build.

The test sets GIT_CONFIG_GLOBAL to an empty file and GIT_CONFIG_NOSYSTEM for its
own process and restores both when it finishes. It stops every process it
started that is still running, by its own process object, and any stub process
the orphan case read from the process list, matched by pid and creation time,
and removes its work folder. It reaches no network and reads nothing from the home folder.

The summary line names the case count and the failure count, and the exit code
is the failure count.

.PARAMETER WorkRoot
The folder under which the test creates its work folder. Defaults to the
system temp folder.

.EXAMPLE
pwsh -NoProfile -File tests/Test-KbRun.ps1
#>
[CmdletBinding()]
param(
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
    }
}

# Quotes one argument for a Windows command line so the child receives it unchanged.
function ConvertTo-CommandLineArgument {
    param([string]$Value)
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($c in $Value.ToCharArray()) {
        if ($c -eq [char]'\') { $backslashes++; continue }
        if ($c -eq [char]'"') {
            [void]$builder.Append([char]'\', 2 * $backslashes + 1)
        } elseif ($backslashes -gt 0) {
            [void]$builder.Append([char]'\', $backslashes)
        }
        $backslashes = 0
        [void]$builder.Append($c)
    }
    [void]$builder.Append([char]'\', 2 * $backslashes)
    [void]$builder.Append('"')
    return $builder.ToString()
}

# Every process this test starts, so the finally block can stop any still running.
$script:started = New-Object System.Collections.Generic.List[System.Diagnostics.Process]

# The stub processes the orphan case read from the process list before its
# kill, so the finally block can stop any that survived, and no other process.
$script:recordedStubs = @()

# Stops a process this test started and every process it started, by its PID.
# taskkill's output is read and discarded.
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
    $null = $killer.StandardError.ReadToEndAsync()
    $null = $killer.StandardOutput.ReadToEnd()
    [void]$killer.WaitForExit(10000)
    if (-not $Process.WaitForExit(5000)) { $Process.Kill() }
}

# Starts a program with its stdout and stderr read asynchronously, and with the
# named environment variables set, or removed where the value is $null.
function Start-Captured {
    param([string]$FilePath, [string[]]$Arguments, [hashtable]$Environment = @{})
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = (@($Arguments | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
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

# Waits for a started program and both its streams, which close only when every
# process holding them has ended, so a surviving grandchild keeps them open. Past
# the timeout the program's tree is stopped and the result reads TimedOut.
function Wait-Captured {
    param($Run, [int]$TimeoutSeconds = 60)
    $deadline = $Run.StartedAt.AddSeconds($TimeoutSeconds)
    $remaining = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
    $finished = $Run.Process.WaitForExit($remaining)
    if ($finished) {
        $remaining = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        $finished = [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($Run.Stdout, $Run.Stderr), $remaining)
    }
    $seconds = ([DateTime]::UtcNow - $Run.StartedAt).TotalSeconds
    if (-not $finished) {
        Stop-StartedTree $Run.Process
        return [pscustomobject]@{ ExitCode = $null; Stdout = ''; Stderr = ''; TimedOut = $true; Seconds = $seconds; StartedAt = $Run.StartedAt }
    }
    $Run.Process.WaitForExit()
    return [pscustomobject]@{ ExitCode = $Run.Process.ExitCode; Stdout = $Run.Stdout.Result; Stderr = $Run.Stderr.Result; TimedOut = $false; Seconds = $seconds; StartedAt = $Run.StartedAt }
}

function Invoke-Captured {
    param([string]$FilePath, [string[]]$Arguments, [hashtable]$Environment = @{}, [int]$TimeoutSeconds = 60)
    return Wait-Captured (Start-Captured $FilePath $Arguments $Environment) $TimeoutSeconds
}

# Runs git in the test KB with line-ending conversion off and a fixed identity.
function Invoke-Git {
    param([string[]]$Arguments)
    $result = Invoke-Captured 'git' (@('-C', $script:kb, '-c', 'core.autocrlf=false', '-c', 'user.name=kb-run test', '-c', 'user.email=kbrun@test.invalid') + $Arguments)
    if ($result.TimedOut -or $result.ExitCode -ne 0) { throw "git $($Arguments -join ' ') failed: $($result.Stderr)" }
    return $result.Stdout
}

# The environment every wrapper run gets: no budget override, a stub that
# exits 0 at once, and a build read the stub answers at once with its own
# default build, overlaid with the case's own values.
function Get-RunEnvironment {
    param([hashtable]$Overlay = @{})
    $environment = @{ 'KB_RUN_SECONDS' = $null; 'KBRUN_STUB_SLEEP' = '0'; 'KBRUN_STUB_EXIT' = '0'; 'KBRUN_STUB_BUILD' = $null; 'KBRUN_STUB_BUILD_NOISE' = $null; 'KBRUN_STUB_BUILD_SLEEP' = '0'; 'KBRUN_STUB_BUILD_EXIT' = '0' }
    foreach ($name in $Overlay.Keys) { $environment[$name] = $Overlay[$name] }
    return $environment
}

function Start-Wrapper {
    param([string[]]$Extra, [hashtable]$Overlay = @{})
    return Start-Captured $script:psExe (@('-NoProfile', '-File', $script:wrapper) + $Extra) (Get-RunEnvironment $Overlay)
}

function Invoke-Wrapper {
    param([string[]]$Extra, [hashtable]$Overlay = @{}, [int]$TimeoutSeconds = 60)
    return Wait-Captured (Start-Wrapper $Extra $Overlay) $TimeoutSeconds
}

# Splits text into its non-empty lines.
function Get-Lines { param([string]$Text) return @($Text -split "`r?`n" | Where-Object { $_ -ne '' }) }

# The stderr lines the wrapper itself wrote, as opposed to the stub's.
function Get-WrapperErrorLines { param([string]$Text) return @(Get-Lines $Text | Where-Object { $_.StartsWith('kb-run: ') }) }

# One record per stub run: the argument line and the working directory.
function Get-StubRecords {
    if (-not (Test-Path -LiteralPath $script:record)) { return }
    $lines = [System.IO.File]::ReadAllLines($script:record)
    for ($i = 0; $i + 1 -lt $lines.Count; $i += 2) {
        [pscustomobject]@{ Args = ($lines[$i] -replace '^ARGS:', ''); Cwd = ($lines[$i + 1] -replace '^CWD:', '') }
    }
}

function Clear-Stub {
    foreach ($file in @($script:record, $script:afterMarker, $script:buildRecord)) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
}

# The argument line of each build read the stub answered, from the stub's own
# record of them.
function Get-BuildReads {
    if (-not (Test-Path -LiteralPath $script:buildRecord)) { return }
    foreach ($line in [System.IO.File]::ReadAllLines($script:buildRecord)) { $line -replace '^ARGS:', '' }
}

# True when a run refused over its build exited 1 with nothing on stdout and
# exactly one stderr line, the wrapper's own, holding each of the given texts,
# and started no model run, so the stub's record holds no run.
function Test-BuildRefusal {
    param($Result, [string[]]$Holds)
    $lines = @(Get-Lines $Result.Stderr)
    if ($Result.TimedOut -or ($Result.ExitCode -ne 1) -or ($Result.Stdout.Trim() -ne '') -or ($lines.Count -ne 1)) { return $false }
    if (-not $lines[0].StartsWith('kb-run: ')) { return $false }
    foreach ($text in $Holds) {
        if (-not $lines[0].Contains($text)) { return $false }
    }
    return (@(Get-StubRecords).Count -eq 0)
}

# Holds the KB's lock the way a running wrapper does.
function Open-Lock {
    return [System.IO.File]::Open($script:lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
}

# True when a refused run exited 0 with exactly one stdout line naming the KB
# and the operation, wrote nothing to stderr, and never started the stub, so the
# stub's record holds only the runs made before it.
function Test-HeldRefusal {
    param($Result, [string]$Operation, [int]$RecordsBefore = 0)
    $lines = @(Get-Lines $Result.Stdout)
    return ((-not $Result.TimedOut) -and ($Result.ExitCode -eq 0) -and ($lines.Count -eq 1) -and $lines[0].Contains($script:kb) -and $lines[0].Contains($Operation) -and ($Result.Stderr.Trim() -eq '') -and (@(Get-StubRecords).Count -eq $RecordsBefore))
}

# True once the stub has written both lines of a record, after which it only
# sleeps. A read that meets the stub's own write counts as not yet.
function Test-StubRecorded {
    if (-not (Test-Path -LiteralPath $script:record)) { return $false }
    try {
        return ([System.IO.File]::ReadAllLines($script:record).Count -ge 2)
    } catch {
        return $false
    }
}

# The live processes whose command line names this test's stub, and every
# process each of them started, read from the process list. The stub's path
# holds this run's random folder name, so no other test's process matches. The
# test's own process and the pids in -Exclude are skipped, since a wrapper's
# command line names the stub too. A child is taken only when it started after
# its parent, so a reused parent pid adopts nothing.
function Get-StubProcesses {
    param([int[]]$Exclude = @())
    $all = @(Get-CimInstance -ClassName Win32_Process)
    $found = New-Object System.Collections.Generic.List[object]
    foreach ($process in $all) {
        if (($process.ProcessId -eq $PID) -or ($Exclude -contains $process.ProcessId)) { continue }
        if (($null -ne $process.CommandLine) -and ($process.CommandLine.IndexOf($stub, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) {
            $found.Add($process)
        }
    }
    for ($i = 0; $i -lt $found.Count; $i++) {
        $parent = $found[$i]
        foreach ($process in $all) {
            if (($process.ParentProcessId -eq $parent.ProcessId) -and ($process.CreationDate -ge $parent.CreationDate)) {
                $known = $false
                foreach ($seen in $found) { if ($seen.ProcessId -eq $process.ProcessId) { $known = $true } }
                if (-not $known) { $found.Add($process) }
            }
        }
    }
    foreach ($process in $found) { $process }
}

# The recorded processes still alive, matched on both the pid and the creation
# time, so a pid the system has since reused is never taken for one of them.
function Get-LiveRecorded {
    param([object[]]$Recorded)
    $all = @(Get-CimInstance -ClassName Win32_Process)
    foreach ($process in $all) {
        foreach ($entry in $Recorded) {
            if (($process.ProcessId -eq $entry.ProcessId) -and ($process.CreationDate -eq $entry.CreationDate)) { $process }
        }
    }
}

# Stops each recorded stub process still alive, by its own pid after the pid
# and creation time match, and nothing else.
function Stop-LiveRecorded {
    param([object[]]$Recorded)
    foreach ($process in @(Get-LiveRecorded $Recorded)) {
        try {
            $handle = [System.Diagnostics.Process]::GetProcessById([int]$process.ProcessId)
            if ([Math]::Abs(($handle.StartTime - $process.CreationDate).TotalSeconds) -lt 1) {
                $handle.Kill()
                [void]$handle.WaitForExit(5000)
            }
            $handle.Dispose()
        } catch {
            # The process ended between the read and the stop.
        }
    }
}

$script:engineRoot = Split-Path -Parent $PSScriptRoot
$script:psExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
Write-Host "Host: $script:psExe ($($PSVersionTable.PSVersion))"

$runId = [System.IO.Path]::GetRandomFileName().Replace('.', '')
$work = Join-Path $WorkRoot "kbrun-test-$runId"
$script:kb = Join-Path $work 'kb'
$script:wrapper = Join-Path $script:kb '.claude\kb-run.ps1'
$script:lockPath = Join-Path $script:kb '.git\kb-run.lock'
$stubDir = Join-Path $work 'stub'
$stub = Join-Path $stubDir 'claude.cmd'
$script:record = Join-Path $stubDir 'record.txt'
$script:afterMarker = Join-Path $stubDir 'after-sleep.txt'
$script:buildRecord = Join-Path $stubDir 'build-record.txt'
$noClaudeDir = Join-Path $work 'no-claude'
$emptyConfig = Join-Path $work 'empty.gitconfig'
$scrubbedPath = "$noClaudeDir;$(Join-Path $env:SystemRoot 'System32')"

$ingestArgs = '-p "Use the wiki-ingest skill." --model sonnet --permission-mode default --strict-mcp-config'
$lintArgs = '-p "Use the wiki-lint skill." --model sonnet --permission-mode default --strict-mcp-config'
$mergeArgs = '-p "Use the wiki-merge skill." --model sonnet --permission-mode default --strict-mcp-config'
$stubStderr = 'kbrun-stub: a line on stderr'

$priorGlobal = $env:GIT_CONFIG_GLOBAL
$priorNoSystem = $env:GIT_CONFIG_NOSYSTEM
try {
    New-Item -ItemType Directory -Path (Join-Path $script:kb '.claude') -Force | Out-Null
    New-Item -ItemType Directory -Path $stubDir -Force | Out-Null
    New-Item -ItemType Directory -Path $noClaudeDir -Force | Out-Null
    [System.IO.File]::WriteAllText($emptyConfig, '')
    $env:GIT_CONFIG_GLOBAL = $emptyConfig
    $env:GIT_CONFIG_NOSYSTEM = '1'

    Copy-Item -LiteralPath (Join-Path $script:engineRoot 'template\.claude\kb-run.ps1') -Destination $script:wrapper
    [System.IO.File]::WriteAllText((Join-Path $script:kb 'README.md'), "kb-run test KB`n")
    $null = Invoke-Git @('init', '-q', '-b', 'main')
    $null = Invoke-Git @('add', '-A')
    $null = Invoke-Git @('commit', '-q', '-m', 'baseline')

    # The stub. ping waits about one second per echo after the first, and is a
    # child process the wrapper's tree stop must end. The record and marker are
    # outside the KB, so the KB's tree stays clean. A build read, which passes
    # --version first, branches away before the stub writes anything, so the
    # record holds one ARGS: and CWD: pair per run and the marker one line.
    $stubLines = @(
        '@echo off'
        'if "%~1"=="--version" goto version'
        ">>`"$script:record`" echo ARGS:%*"
        ">>`"$script:record`" echo CWD:%CD%"
        ">&2 echo $stubStderr"
        'if not defined KBRUN_STUB_SLEEP set KBRUN_STUB_SLEEP=0'
        'if not defined KBRUN_STUB_EXIT set KBRUN_STUB_EXIT=0'
        'set /a KBRUN_STUB_PINGS=KBRUN_STUB_SLEEP+1'
        'ping -n %KBRUN_STUB_PINGS% 127.0.0.1 >nul'
        ">>`"$script:afterMarker`" echo after"
        'exit %KBRUN_STUB_EXIT%'
        ':version'
        ">>`"$script:buildRecord`" echo ARGS:%*"
        'if not defined KBRUN_STUB_BUILD set KBRUN_STUB_BUILD=2.1.257'
        'if not defined KBRUN_STUB_BUILD_SLEEP set KBRUN_STUB_BUILD_SLEEP=0'
        'if not defined KBRUN_STUB_BUILD_EXIT set KBRUN_STUB_BUILD_EXIT=0'
        'echo %KBRUN_STUB_BUILD%'
        'if defined KBRUN_STUB_BUILD_NOISE echo %KBRUN_STUB_BUILD_NOISE%'
        'if defined KBRUN_STUB_BUILD_NOISE >&2 echo %KBRUN_STUB_BUILD_NOISE%'
        'set /a KBRUN_STUB_PINGS=KBRUN_STUB_BUILD_SLEEP+1'
        'ping -n %KBRUN_STUB_PINGS% 127.0.0.1 >nul'
        'exit %KBRUN_STUB_BUILD_EXIT%'
    )
    [System.IO.File]::WriteAllText($stub, (($stubLines -join "`r`n") + "`r`n"), (New-Object System.Text.ASCIIEncoding))

    # --- An Ingest run with the lock free: the pinned line, the exit code, the
    # working directory, stderr pass-through, a clean tree and the lock file.
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Ingest', '-Claude', $stub) @{ 'KBRUN_STUB_EXIT' = '7' }
    $records = @(Get-StubRecords)
    Test-Check 'an Ingest run exits with the stub''s exit code, 7' ((-not $r.TimedOut) -and ($r.ExitCode -eq 7))
    Test-Check 'an Ingest run passes the stub exactly the pinned ingest argument line' (($records.Count -eq 1) -and ($records[0].Args -ceq $ingestArgs))
    Test-Check 'the stub runs with the knowledge base as its working directory' (($records.Count -eq 1) -and ($records[0].Cwd.TrimEnd('\') -ieq $script:kb.TrimEnd('\')))
    Test-Check 'the stub''s stderr line reaches the wrapper''s stderr' (@(Get-Lines $r.Stderr) -ccontains $stubStderr)
    Test-Check 'a stub that sleeps 0 seconds writes its after-sleep marker, so the marker can appear' (Test-Path -LiteralPath $script:afterMarker)
    $porcelain = Invoke-Git @('status', '--porcelain')
    Test-Check 'after the run git status --porcelain prints nothing and .git/kb-run.lock exists' (($porcelain.Trim() -eq '') -and (Test-Path -LiteralPath $script:lockPath -PathType Leaf))

    # --- A Lint run passes the lint twin and a zero exit code.
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Lint', '-Claude', $stub)
    $records = @(Get-StubRecords)
    Test-Check 'a Lint run exits with the stub''s exit code, 0, and passes exactly the pinned lint argument line' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Args -ceq $lintArgs))

    # --- A Merge run passes the merge twin and the stub's exit code; -WhatIf
    # names the merge skill and starts no model run.
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Merge', '-Claude', $stub) @{ 'KBRUN_STUB_EXIT' = '5' }
    $records = @(Get-StubRecords)
    Test-Check 'a Merge run exits with the stub''s exit code, 5, and passes exactly the pinned merge argument line' ((-not $r.TimedOut) -and ($r.ExitCode -eq 5) -and ($records.Count -eq 1) -and ($records[0].Args -ceq $mergeArgs))
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Merge', '-Claude', $stub, '-WhatIf')
    $lines = @(Get-Lines $r.Stdout)
    Test-Check 'Merge -WhatIf exits 0 with one stdout line naming wiki-merge and the merge argument line, and starts no model run' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($lines.Count -eq 1) -and $lines[0].Contains('wiki-merge') -and $lines[0].Contains($mergeArgs) -and ($r.Stderr.Trim() -eq '') -and (@(Get-StubRecords).Count -eq 0))

    # --- A foreign handle on the lock refuses the run; once released, a run proceeds.
    Clear-Stub
    $held = Open-Lock
    try {
        $r = Invoke-Wrapper @('-Operation', 'Lint', '-Claude', $stub)
    } finally {
        $held.Dispose()
    }
    Test-Check 'a run while the test holds .git/kb-run.lock exits 0 with one stdout line naming the KB and Lint, and never starts the stub' (Test-HeldRefusal $r 'Lint')
    $r = Invoke-Wrapper @('-Operation', 'Lint', '-Claude', $stub)
    Test-Check 'once the test releases the lock, the same run proceeds and starts the stub' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 1))

    # --- A live run's lock refuses a second run; after it ends, a run proceeds.
    Clear-Stub
    $first = Start-Wrapper @('-Operation', 'Ingest', '-Claude', $stub) @{ 'KBRUN_STUB_SLEEP' = '20'; 'KBRUN_STUB_EXIT' = '3' }
    $pollEnd = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-StubRecorded) -and [DateTime]::UtcNow -lt $pollEnd) { Start-Sleep -Milliseconds 200 }
    $firstStubRunning = Test-StubRecorded
    $r = Invoke-Wrapper @('-Operation', 'Lint', '-Claude', $stub)
    $firstStillRunning = -not $first.Process.HasExited
    $firstResult = Wait-Captured $first 40
    $records = @(Get-StubRecords)
    Test-Check 'the first run''s stub started within 20 seconds, so the first run holds the lock' $firstStubRunning
    Test-Check 'a second run while the first run''s stub sleeps exits 0 with one stdout line naming the KB and Lint, and never starts the stub' ($firstStillRunning -and (Test-HeldRefusal $r 'Lint' 1) -and ($records[0].Args -ceq $ingestArgs))
    Test-Check 'the first run still finishes with its stub''s exit code, 3' ((-not $firstResult.TimedOut) -and ($firstResult.ExitCode -eq 3))
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Lint', '-Claude', $stub)
    Test-Check 'after the first run ends, a Lint run proceeds and starts the stub' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 1))

    # --- The budget stop. The wait for the wrapper is 20 seconds, and its
    # streams close only when the stub's whole tree has ended. The marker check
    # waits until 34 seconds after the stub wrote its record, which is when its
    # 30-second sleep began, so a survivor would have written the marker.
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Ingest', '-Claude', $stub) @{ 'KB_RUN_SECONDS' = '3'; 'KBRUN_STUB_SLEEP' = '30' } 20
    $wrapperErrors = @(Get-WrapperErrorLines $r.Stderr)
    Test-Check 'with KB_RUN_SECONDS at 3 and a stub sleeping 30, the wrapper and its whole tree end within 20 seconds with exit 1' ((-not $r.TimedOut) -and ($r.ExitCode -eq 1) -and ($r.Seconds -lt 20))
    Test-Check 'the budget stop writes one stderr line of its own, naming the 3-second budget, beside the stub''s line' (($wrapperErrors.Count -eq 1) -and ($wrapperErrors[0] -match 'budget of 3 seconds') -and (@(Get-Lines $r.Stderr).Count -eq 2) -and ($r.Stdout.Trim() -eq '') -and (@(Get-StubRecords).Count -eq 1))
    $stubStartedAt = if (Test-Path -LiteralPath $script:record) { (Get-Item -LiteralPath $script:record).LastWriteTimeUtc } else { [DateTime]::UtcNow }
    $markerWaitEnd = $stubStartedAt.AddSeconds(34)
    while ([DateTime]::UtcNow -lt $markerWaitEnd) { Start-Sleep -Milliseconds 500 }
    Test-Check 'the stopped stub''s after-sleep marker never appears, 34 seconds after the stub started' (-not (Test-Path -LiteralPath $script:afterMarker))
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Ingest', '-Claude', $stub)
    Test-Check 'after the budget stop the lock is free, so a run proceeds and starts the stub' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 1))

    # --- A wrapper whose process tree is killed mid-run leaves no lock: the
    # operating system releases the handle when the process ends, so the next
    # run proceeds. The kill ends the stub too, so this case does not show the
    # child never holds the handle.
    Clear-Stub
    $killed = Start-Wrapper @('-Operation', 'Ingest', '-Claude', $stub) @{ 'KBRUN_STUB_SLEEP' = '20' }
    $pollEnd = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-StubRecorded) -and [DateTime]::UtcNow -lt $pollEnd) { Start-Sleep -Milliseconds 200 }
    $killedStubRunning = Test-StubRecorded
    Stop-StartedTree $killed.Process
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Ingest', '-Claude', $stub)
    Test-Check 'after a wrapper holding the lock has its process tree killed mid-run, the next run proceeds and starts the stub' ($killedStubRunning -and $killed.Process.HasExited -and (-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 1))

    # --- The wrapper alone is killed while its stub sleeps, by its own process
    # object and never by a tree stop, so only the wrapper's kill-on-close job
    # can end the stub. The process list is read before the kill, and must show
    # the sleeping stub there, or the later read proves nothing. After the kill
    # the same read must find none of those processes within 10 seconds, and the
    # marker wait runs to 24 seconds after the stub began its 20-second sleep.
    Clear-Stub
    $orphanCase = Start-Wrapper @('-Operation', 'Ingest', '-Claude', $stub) @{ 'KBRUN_STUB_SLEEP' = '20' }
    $pollEnd = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-StubRecorded) -and [DateTime]::UtcNow -lt $pollEnd) { Start-Sleep -Milliseconds 200 }
    $orphanStubStarted = Test-StubRecorded
    $script:recordedStubs = @(Get-StubProcesses @($orphanCase.Process.Id))
    Test-Check 'before the kill, the process list shows the sleeping stub by its command line' ($orphanStubStarted -and ($script:recordedStubs.Count -ge 1))
    if (-not $orphanCase.Process.HasExited) { $orphanCase.Process.Kill() }
    $wrapperEnded = $orphanCase.Process.WaitForExit(10000)
    $survivors = @()
    $pollEnd = [DateTime]::UtcNow.AddSeconds(10)
    do {
        $survivors = @(@(Get-LiveRecorded $script:recordedStubs) + @(Get-StubProcesses @($orphanCase.Process.Id)))
        if ($survivors.Count -eq 0) { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $pollEnd)
    Test-Check 'after the wrapper alone is killed, no stub process it started is left running within 10 seconds' ($wrapperEnded -and ($script:recordedStubs.Count -ge 1) -and ($survivors.Count -eq 0))
    $stubStartedAt = if (Test-Path -LiteralPath $script:record) { (Get-Item -LiteralPath $script:record).LastWriteTimeUtc } else { [DateTime]::UtcNow }
    $markerWaitEnd = $stubStartedAt.AddSeconds(24)
    while ([DateTime]::UtcNow -lt $markerWaitEnd) { Start-Sleep -Milliseconds 500 }
    Test-Check 'the orphaned stub''s after-sleep marker never appears, 24 seconds after the stub started' ($orphanStubStarted -and (-not (Test-Path -LiteralPath $script:afterMarker)))
    Stop-LiveRecorded $script:recordedStubs

    # --- An invalid budget is refused before the stub starts.
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Ingest', '-Claude', $stub) @{ 'KB_RUN_SECONDS' = '0' }
    Test-Check 'KB_RUN_SECONDS of 0 exits 1 with one stderr line naming the variable, and never starts the stub' ((-not $r.TimedOut) -and ($r.ExitCode -eq 1) -and (@(Get-Lines $r.Stderr).Count -eq 1) -and ($r.Stderr -match 'KB_RUN_SECONDS') -and (@(Get-StubRecords).Count -eq 0))

    # --- -WhatIf takes no lock: with the test holding it, the command line still prints.
    Clear-Stub
    $held = Open-Lock
    try {
        $r = Invoke-Wrapper @('-Operation', 'Lint', '-Claude', $stub, '-WhatIf')
    } finally {
        $held.Dispose()
    }
    $lines = @(Get-Lines $r.Stdout)
    Test-Check '-WhatIf with the lock held exits 0 with one stdout line naming the stub and the lint argument line, and starts no model run' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($lines.Count -eq 1) -and $lines[0].Contains($stub) -and $lines[0].Contains($lintArgs) -and ($r.Stderr.Trim() -eq '') -and (@(Get-StubRecords).Count -eq 0))

    # --- An operation outside the set is refused by parameter binding.
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Query', '-Claude', $stub)
    Test-Check 'an -Operation of Query is refused by binding with a non-zero exit naming the parameter and the rejected value, and never starts the stub' ((-not $r.TimedOut) -and ($r.ExitCode -ne 0) -and ($r.Stderr -match 'Operation') -and ($r.Stderr -match 'Query') -and (@(Get-StubRecords).Count -eq 0))

    # --- Without -Claude, claude resolves from PATH, both ways.
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Ingest') @{ 'PATH' = $scrubbedPath }
    Test-Check 'with no -Claude and no claude on the wrapper''s PATH, the run exits 1 with one stderr line naming PATH, and never starts the stub' ((-not $r.TimedOut) -and ($r.ExitCode -eq 1) -and (@(Get-Lines $r.Stderr).Count -eq 1) -and ($r.Stderr -match 'PATH') -and (@(Get-StubRecords).Count -eq 0))
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Ingest') @{ 'PATH' = "$stubDir;$(Join-Path $env:SystemRoot 'System32')" }
    $records = @(Get-StubRecords)
    Test-Check 'with no -Claude and the stub''s folder on PATH, the run starts the stub with the pinned ingest line' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Args -ceq $ingestArgs))

    # --- The floor, both ways. A build one under it is refused before any run
    # starts, and the refusal leaves the lock free: a run held out by the lock
    # would exit 0 with no record, so the next run's record shows it took it.
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Ingest', '-Claude', $stub) @{ 'KBRUN_STUB_BUILD' = '2.1.256' }
    Test-Check 'a stub build of 2.1.256 exits 1 with one stderr line holding 2.1.256, is older than 2.1.257 and Ingest, and starts no model run' (Test-BuildRefusal $r @('2.1.256', 'is older than 2.1.257', 'Ingest'))
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Ingest', '-Claude', $stub) @{ 'KBRUN_STUB_BUILD' = '2.1.257'; 'KBRUN_STUB_EXIT' = '4' }
    $records = @(Get-StubRecords)
    Test-Check 'the next run takes the lock and a stub build of 2.1.257 runs: exit 4 from the stub and the pinned ingest line' ((-not $r.TimedOut) -and ($r.ExitCode -eq 4) -and ($records.Count -eq 1) -and ($records[0].Args -ceq $ingestArgs))

    # --- The compare is by number, part by part. Read as text, 2.1.1000 sorts
    # under 2.1.257, so only it tells a number compare from a text one.
    # 2.0.999 and 1.99.999 sort under 2.1.257 either way, and show that an
    # earlier part that is lower decides though a later part is higher.
    foreach ($build in @('2.0.999', '1.99.999')) {
        Clear-Stub
        $r = Invoke-Wrapper @('-Operation', 'Lint', '-Claude', $stub) @{ 'KBRUN_STUB_BUILD' = $build }
        Test-Check "a stub build of $build exits 1 with one stderr line holding $build, is older than 2.1.257 and Lint, and starts no model run" (Test-BuildRefusal $r @($build, 'is older than 2.1.257', 'Lint'))
    }
    foreach ($build in @('2.1.1000', '2.2.0', '3.0.0')) {
        Clear-Stub
        $r = Invoke-Wrapper @('-Operation', 'Lint', '-Claude', $stub) @{ 'KBRUN_STUB_BUILD' = $build }
        $records = @(Get-StubRecords)
        Test-Check "a stub build of $build runs: exit 0, nothing of the wrapper's on stderr, and the pinned lint line" ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-WrapperErrorLines $r.Stderr).Count -eq 0) -and ($records.Count -eq 1) -and ($records[0].Args -ceq $lintArgs))
    }

    # --- The line a real build prints. The read is one stub start whose whole
    # argument line is --version, and the run's line is the pinned one.
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Ingest', '-Claude', $stub) @{ 'KBRUN_STUB_BUILD' = '2.1.322 (Claude Code)' }
    $records = @(Get-StubRecords)
    $reads = @(Get-BuildReads)
    Test-Check 'a stub printing "2.1.322 (Claude Code)" runs with the pinned ingest line, after one build read whose argument line is --version alone' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Args -ceq $ingestArgs) -and ($reads.Count -eq 1) -and ($reads[0] -ceq '--version'))

    # --- A first line with no build at its first character. The stub prints
    # that line, a second line and a stderr line, and the refusal's one line
    # holds none of the three texts, nor the numbers after the letter v.
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Ingest', '-Claude', $stub) @{ 'KBRUN_STUB_BUILD' = 'v2.1.300 kbrun-first-line'; 'KBRUN_STUB_BUILD_NOISE' = 'kbrun-noise-line' }
    $printed = @(@('v2.1.300', '2.1.300', 'kbrun-first-line', 'kbrun-noise-line') | Where-Object { $r.Stderr.Contains($_) -or $r.Stdout.Contains($_) })
    Test-Check 'a first line of "v2.1.300 kbrun-first-line" exits 1 with one stderr line holding could not read the Claude Code build, holds no build and Ingest, with none of the text the stub printed on either stream of the wrapper' ((Test-BuildRefusal $r @('could not read the Claude Code build', 'holds no build', 'Ingest')) -and ($printed.Count -eq 0))

    # --- A read that exits non-zero is refused on its exit code, though the
    # build it printed passes the floor.
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Ingest', '-Claude', $stub) @{ 'KBRUN_STUB_BUILD' = '2.1.300'; 'KBRUN_STUB_BUILD_EXIT' = '3' }
    Test-Check 'a build read that prints 2.1.300 and exits 3 exits 1 with one stderr line holding could not read the Claude Code build, exited 3 and Ingest, and not the build it printed' ((Test-BuildRefusal $r @('could not read the Claude Code build', 'exited 3', 'Ingest')) -and (-not $r.Stderr.Contains('2.1.300')))

    # --- A read that hangs. The stub sleeps 60 seconds in its build read under
    # a budget of 8, so the read's bound is the budget. The process list is
    # read while the read sleeps and must show it, or the later read proves
    # nothing. The read is stopped at the budget's 8 seconds, and the bound on
    # the wrapper's end includes the tree stop, up to 10 seconds for taskkill
    # and 5 for the final wait, so the wrapper ends within 28 seconds. A read
    # bound of 60 seconds, or the stub's own 60-second sleep, cannot. The wait
    # for the wrapper is 45 seconds, so a slow end is read as its time.
    Clear-Stub
    $hung = Start-Wrapper @('-Operation', 'Ingest', '-Claude', $stub) @{ 'KB_RUN_SECONDS' = '8'; 'KBRUN_STUB_BUILD_SLEEP' = '60' }
    $pollEnd = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath $script:buildRecord) -and [DateTime]::UtcNow -lt $pollEnd) { Start-Sleep -Milliseconds 100 }
    $hungReads = @(Get-StubProcesses @($hung.Process.Id))
    Test-Check 'while a build read sleeps, the process list shows the stub by its command line' ((Test-Path -LiteralPath $script:buildRecord) -and ($hungReads.Count -ge 1))
    $r = Wait-Captured $hung 45
    $survivors = @()
    $pollEnd = [DateTime]::UtcNow.AddSeconds(10)
    do {
        $survivors = @(@(Get-LiveRecorded $hungReads) + @(Get-StubProcesses))
        if ($survivors.Count -eq 0) { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $pollEnd)
    Test-Check 'with KB_RUN_SECONDS at 8 and a build read sleeping 60, the wrapper ends within 28 seconds with exit 1 and one stderr line holding could not read the Claude Code build, did not finish and Ingest, and no stub process is left running' ((Test-BuildRefusal $r @('could not read the Claude Code build', 'did not finish', 'Ingest')) -and ($r.Seconds -lt 28) -and ($hungReads.Count -ge 1) -and ($survivors.Count -eq 0))
    Stop-LiveRecorded $hungReads

    # --- The build read spends the run's budget. Under a budget of 30, the
    # read sleeps 24 before printing a passing build, and the run sleeps 120.
    # The run waits only for the 6 seconds the read left, so the wrapper ends
    # near 30 seconds plus the tree stop, at most 15, which is under 50. A run
    # that waited the whole budget would end near 54 seconds. The wait for the
    # wrapper is 70 seconds, so that end is read as its time.
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Ingest', '-Claude', $stub) @{ 'KB_RUN_SECONDS' = '30'; 'KBRUN_STUB_BUILD_SLEEP' = '24'; 'KBRUN_STUB_SLEEP' = '120' } 70
    $wrapperErrors = @(Get-WrapperErrorLines $r.Stderr)
    Test-Check 'with KB_RUN_SECONDS at 30, a build read sleeping 24 and a run sleeping 120, the wrapper exits 1 within 50 seconds with one stderr line of its own naming the 30-second budget, after one build read and one run' ((-not $r.TimedOut) -and ($r.ExitCode -eq 1) -and ($r.Seconds -lt 50) -and ($wrapperErrors.Count -eq 1) -and ($wrapperErrors[0] -match 'budget of 30 seconds') -and (@(Get-BuildReads).Count -eq 1) -and (@(Get-StubRecords).Count -eq 1))

    # --- -WhatIf reads the build and takes no lock: with the test holding the
    # lock, an old build is refused and a passing one prints the command line.
    Clear-Stub
    $held = Open-Lock
    try {
        $r = Invoke-Wrapper @('-Operation', 'Lint', '-Claude', $stub, '-WhatIf') @{ 'KBRUN_STUB_BUILD' = '2.1.256' }
        $refused = Test-BuildRefusal $r @('2.1.256', 'is older than 2.1.257', 'Lint')
        $r = Invoke-Wrapper @('-Operation', 'Lint', '-Claude', $stub, '-WhatIf') @{ 'KBRUN_STUB_BUILD' = '2.1.257' }
    } finally {
        $held.Dispose()
    }
    $lines = @(Get-Lines $r.Stdout)
    Test-Check '-WhatIf on a stub build of 2.1.256 with the lock held exits 1 with one stderr line holding 2.1.256, is older than 2.1.257 and Lint, and starts no model run' $refused
    Test-Check '-WhatIf on a stub build of 2.1.257 with the lock held exits 0 with one stdout line naming the stub and the lint argument line, and starts no model run' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($lines.Count -eq 1) -and $lines[0].Contains($stub) -and $lines[0].Contains($lintArgs) -and ($r.Stderr.Trim() -eq '') -and (@(Get-StubRecords).Count -eq 0))

    # --- The lock comes before the build read: a run that finds the lock held
    # never starts the stub, even for a read, so an old build is not refused.
    Clear-Stub
    $held = Open-Lock
    try {
        $r = Invoke-Wrapper @('-Operation', 'Lint', '-Claude', $stub) @{ 'KBRUN_STUB_BUILD' = '2.1.256' }
    } finally {
        $held.Dispose()
    }
    Test-Check 'a run on a stub build of 2.1.256 while the test holds the lock exits 0 with the lock line, and the stub is never started, for a run or for a build read' ((Test-HeldRefusal $r 'Lint') -and (@(Get-BuildReads).Count -eq 0))
} finally {
    foreach ($process in $script:started) {
        if (-not $process.HasExited) { Stop-StartedTree $process }
    }
    Stop-LiveRecorded $script:recordedStubs
    if ($null -eq $priorGlobal) { Remove-Item -LiteralPath Env:GIT_CONFIG_GLOBAL -ErrorAction SilentlyContinue } else { $env:GIT_CONFIG_GLOBAL = $priorGlobal }
    if ($null -eq $priorNoSystem) { Remove-Item -LiteralPath Env:GIT_CONFIG_NOSYSTEM -ErrorAction SilentlyContinue } else { $env:GIT_CONFIG_NOSYSTEM = $priorNoSystem }
    if (Test-Path -LiteralPath $work) {
        Remove-Item -LiteralPath $work -Recurse -Force
    }
}

Write-Host "$cases kb-run cases, $failures failed."
exit $failures
