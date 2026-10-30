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
marker, and exits with the code KBRUN_STUB_EXIT names. Nothing but the stub
reads those two variables, and no case reaches the real claude.

It checks the pinned argument line for Ingest, Lint and Merge, -WhatIf naming
wiki-merge for Merge, the exit code passed through, the stub's working directory, stderr pass-through, a clean tree and the
lock file after a run, the lock refused while the test holds it and while a
live run holds it, each paired with a run that proceeds once the lock is free,
the budget stop with the stub's process tree gone, the lock free after a wrapper
is killed mid-run, the stub gone from the process list after the wrapper alone
is killed while the stub sleeps, an invalid KB_RUN_SECONDS,
-WhatIf taking no lock, an -Operation outside the set, and claude resolved from
PATH or refused when PATH holds none.

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

# The environment every wrapper run gets: no budget override and a stub that
# exits 0 at once, overlaid with the case's own values.
function Get-RunEnvironment {
    param([hashtable]$Overlay = @{})
    $environment = @{ 'KB_RUN_SECONDS' = $null; 'KBRUN_STUB_SLEEP' = '0'; 'KBRUN_STUB_EXIT' = '0' }
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
    foreach ($file in @($script:record, $script:afterMarker)) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
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
$noClaudeDir = Join-Path $work 'no-claude'
$emptyConfig = Join-Path $work 'empty.gitconfig'
$scrubbedPath = "$noClaudeDir;$(Join-Path $env:SystemRoot 'System32')"

$ingestArgs = '-p "Use the wiki-ingest skill." --model sonnet --permission-mode default'
$lintArgs = '-p "Use the wiki-lint skill." --model sonnet --permission-mode default'
$mergeArgs = '-p "Use the wiki-merge skill." --model sonnet --permission-mode default'
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
    # outside the KB, so the KB's tree stays clean.
    $stubLines = @(
        '@echo off'
        ">>`"$script:record`" echo ARGS:%*"
        ">>`"$script:record`" echo CWD:%CD%"
        ">&2 echo $stubStderr"
        'if not defined KBRUN_STUB_SLEEP set KBRUN_STUB_SLEEP=0'
        'if not defined KBRUN_STUB_EXIT set KBRUN_STUB_EXIT=0'
        'set /a KBRUN_STUB_PINGS=KBRUN_STUB_SLEEP+1'
        'ping -n %KBRUN_STUB_PINGS% 127.0.0.1 >nul'
        ">>`"$script:afterMarker`" echo after"
        'exit %KBRUN_STUB_EXIT%'
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
    # names the merge skill and starts nothing.
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Merge', '-Claude', $stub) @{ 'KBRUN_STUB_EXIT' = '5' }
    $records = @(Get-StubRecords)
    Test-Check 'a Merge run exits with the stub''s exit code, 5, and passes exactly the pinned merge argument line' ((-not $r.TimedOut) -and ($r.ExitCode -eq 5) -and ($records.Count -eq 1) -and ($records[0].Args -ceq $mergeArgs))
    Clear-Stub
    $r = Invoke-Wrapper @('-Operation', 'Merge', '-Claude', $stub, '-WhatIf')
    $lines = @(Get-Lines $r.Stdout)
    Test-Check 'Merge -WhatIf exits 0 with one stdout line naming wiki-merge and the merge argument line, and never starts the stub' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($lines.Count -eq 1) -and $lines[0].Contains('wiki-merge') -and $lines[0].Contains($mergeArgs) -and ($r.Stderr.Trim() -eq '') -and (@(Get-StubRecords).Count -eq 0))

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
    Test-Check '-WhatIf with the lock held exits 0 with one stdout line naming the stub and the lint argument line, and never starts the stub' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($lines.Count -eq 1) -and $lines[0].Contains($stub) -and $lines[0].Contains($lintArgs) -and ($r.Stderr.Trim() -eq '') -and (@(Get-StubRecords).Count -eq 0))

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
