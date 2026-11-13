#Requires -Version 7.0
<#
.SYNOPSIS
Exercises the walker, kb-walk.ps1, against throwaway wikis made from the
engine's template, a stub standing in for Claude, and a temporary account.

.DESCRIPTION
Builds its wikis under a fresh work folder from the template beside the walker
it runs, each a git repository with its own identity, and points the walker's
LOCALAPPDATA and USERPROFILE at folders of the test's own, so the real wiki
list, walk state, ~/.claude.json and its lock are never read or written. The
trust file the walker reads is one the test writes under its own profile
folder. Every walker run passes the test's own claude.cmd stub as -Claude. The
stub records its arguments and working directory, sleeps the seconds
KBWALK_STUB_SLEEP names, and where KBWALK_STUB_MODE is resolve copies the text
KBWALK_STUB_RESOLVED names over wiki/page.md and commits it, which completes a
merge; otherwise it leaves the tree as it found it. On a lint run, where
KBWALK_STUB_LINT is commit the stub makes an empty commit under "Lint:", and
where it is reconcile one under "Reconcile:" alone. On an ingest run, where
KBWALK_STUB_TAKE names a file the stub removes it from inbox/, as an ingest
that moves its source does. Where KBWALK_STUB_ECHO is
set the stub prints one line of its own and then that text, as a model's
output would. Started with --version as its first argument, for the build read
of the wrapper each wiki runs, the stub does none of that: it records its
arguments in a file of its own and prints the build KBWALK_STUB_BUILD names,
or 2.1.257 where the case names none. No case reaches the real claude.

It checks, one case per acceptance bullet: a pass over three wikis calling the
stub once for the one inbox file, with an empty inbox skipped and an untrusted
wiki skipped; a wiki whose stub build is 2.1.256 reading ingest failed, with
the wrapper's refusal in the step's note and in the failures list, no stub
run in the wiki and no ingestFailures, lastIngestAttemptAt or
ingestStalledInbox in its state; a conflicting pull in such a wiki reading
merge failed with the same refusal in its note and in the failures list, no
stub run, and the pull still deferred: conflict with its path, passes 1, no
merge left and HEAD as before; an ingest whose stub leaves the inbox as it
found it reading failed: kb-run.ps1 -Operation Ingest exited 0 and took no
file from inbox/, listed once under failures, and counting ingestFailures 1
with a fresh lastIngestAttemptAt and a digest; two more such passes counting
3, a fourth inside the day held as failed: held after 3 ingest runs that took
no file from inbox/ with no stub call and the log naming when the hold ends,
and a fifth with the last attempt 25 hours back calling the stub again and
counting 4; that held ingest released by a file added to its inbox, its next
pass calling the stub and counting 1 under a new digest, and its emptied
inbox reading skipped: inbox empty with all three fields gone; an ingest that
took nothing from two files on one pass, whose stub takes one on the next,
reading ran with no ingest failure and all three fields gone; the lint gate
both ways on the seven-day stamp, the due lint's model output carrying the
wrapper's lock-held prefix on a later line and the lint still recorded
`run`; a due lint whose run made only a Reconcile: commit,
and one whose run made none, each recorded skipped: no Lint: commit with no
stamp; a due lint with no Lint: commit on three passes in a row counting
lintFailures to 3, its fourth pass inside the day held as skipped: held
after 3 failed lints with no stub call and the log naming when the hold ends,
a fifth pass with the last attempt 25 hours back calling the stub again and
counting 4, and a sixth pass a day on whose lint commits under Lint: stamped
with both fields gone, and a seventh with the count at 3 and the last
attempt a year ahead calling the stub; a due ingest under a
KB_WALK_MODEL_FLOOR_SECONDS over
the remaining budget skipped for budget with no stub call while its pull and
push run; a fast-forward
pull with no stub call and no merge step, a conflicting pull joined by the
stub and pushed with its note naming the restore point and its merge step
ran, a
conflicting pull whose merge run the model-run floor refuses after the fetch,
aborted with no merge step, later step, deferral or count, and
a conflicting pull the stub leaves, its merge step ran, aborted and deferred
across two passes with the pass count rising, then joined on a third and its
count cleared, a conflict on .claude/settings.json deferred with no stub call
and no merge step at all and stuck from its first pass; a fetched commit changing wiki/page.md alone
fast-forwarded, one changing .claude/feed.json alone and one changing
CLAUDE.md alone each stopped before any merge with HEAD as before, no stub
call and the wiki deferred with reason engine change, that path and stuck
true, the stop cleared on the pass after HEAD is brought to the fetched
commit by hand, which reads up to date, one changing .claude/settings.json,
a shipped engine file, to bytes other than the installed engine's and one
renaming CLAUDE.md to wiki/notes.md each stopped the same way on that one
path, .claude/settings.json and CLAUDE.md, one adding wiki/CLAUDE.md
stopped the same way on that path, and a fetched commit restoring one
shipped engine file to the installed engine's bytes fast-forwarded with no
stop; and a wiki whose conflict the stub never joins
driven through three deferred passes to stuck, its fourth pass fetching a
commit origin gained meanwhile, starting no stub, recording no merge step and
naming when the run is held until, and a fifth pass a day after the
last run starting the stub again;
the engine update committed with feed.json kept, a live tree deferred, and a
missing git identity recorded; two clones of one wiki updated to one engine,
the second pulling the first's update with a clean merge and an engine.json
holding templateHash alone, byte-identical on both; an engine update over a
staged page committing only what it wrote; an engine update whose git add a
stale index.lock refuses, recorded failed with the mark at HEAD unchanged, its
ingest and due lint skipped with no stub call while its pull, feed and push
record their own outcomes, and made and committed by the next pass once the
lock is gone, which then ingests and lints; an engine update whose copy throws
on a read-only vendored file, recorded failed with the same two skips; a page edited seconds ago holding
off a wiki's ingest and due lint as deferred: live, with a standing conflict
in a second such wiki still listed as the conflict; a lint and a feed whose run lock
another run holds recorded skipped: run lock held, with no stamp, and a
conflicting pull whose run lock is held reading merge ran: first output line
reports the run lock held, its pull deferred: conflict; -WhatIf
printing the wikis it would visit and writing nothing in the walk folder; a
diverged pull in a wiki with no git identity recorded failed with no merge
started; a merge left in progress aborted by the pull, in a wiki with an
origin whose own origin/main then conflicts and runs the stub, and in one
with no origin whose ingest and lint then run and whose update's deferral
on that merge is cleared in the same pass; a merge left in progress whose
abort git refuses for a stale index.lock, recorded pull failed with no later
step run; a fetch through the ssh command GIT_SSH names, with the walker's
batch-mode GIT_SSH_COMMAND left off; a URL's user name and password in a
child's error text replaced by *** in the status, the log and stdout, a password holding an escape
character included; a standing
conflict kept listed when the next pass's pull is refused for budget, in a
pass whose wiki-owned status script leaves a process holding its stdout,
which the walker drains for 5 seconds and then ends; an ingest stopped at the
pass budget whose printed line still reaches the walker's stdout; the budget
cursor across two passes, with a
lint left under the 60-second child floor skipped for budget, these budget
cases setting KB_WALK_MODEL_FLOOR_SECONDS to 60 so their first model run
starts; a second
walker refused by the lock; and the walker killed while its stub sleeps in
the third of three wikis, leaving no stub process in the process list and a
state whose cursor names the second wiki, holding the second wiki's lint
stamp from that pass and the first wiki, made stuck in that pass, with its
notice fields as they stood before the pass, so the next pass appends its
stuck record.

The notices file, walk-notices.jsonl beside the status file, is checked by id
and text as well, and stuck and still-stuck records by their paths field: the
settings-file conflict's stuck record on its first pass with no pass count; the
engine-change stop's stuck record counting 1 path and naming none, with the
path in its paths field, and its cleared record with no paths field on the
pass after HEAD is brought up by hand; the
stuck record on the third pass of a conflict the stub never joins, none on the
first two and none on the fourth, inside the day; a still-stuck record on the
fifth pass with the last notice 25 hours back; a cleared record with the
restore point and no paths field on the pass whose stub joins the page,
with noticedStuck and lastNoticeAt gone from the state; no record for a
one-pass conflict or for a noticed wiki whose pull is refused for budget; a
file past 1 MB renamed to walk-notices.jsonl.1 over an earlier one before
the pass's record lands in a new file; an append that fails while the test
holds the file, leaving the state with no notice fields, and the next pass
writing the stuck record; a conflicted path holding U+202E carried in the
paths field with a hyphen in that character's place; and a conflict on 12
paths whose text counts 12 and whose paths field holds the first 10.

The test sets GIT_CONFIG_GLOBAL to an empty file and GIT_CONFIG_NOSYSTEM for
its own process and restores both when it finishes. It records every process
it starts and stops only those, by their own process objects, plus any stub
process the kill case read from the process list before the kill, matched by
pid and creation time. A recorded process still alive after that cleanup is
printed as "survivor <pid> <tag>" and never stopped again, and the last line
before the summary reads "survivors <n>". It removes its work folder.

The summary line names the case count and the failure count, and the exit code
is the failure count.

.PARAMETER WalkerPath
The kb-walk.ps1 to run. Defaults to the one beside this test's folder. The
engine root, holding template/, kb-registry.ps1 and new-kb.ps1, is the
walker's own folder.

.PARAMETER WorkRoot
The folder under which the test creates its work folder. Defaults to the
system temp folder.

.EXAMPLE
pwsh -NoProfile -File tests/Test-KbWalk.ps1

.EXAMPLE
pwsh -NoProfile -File tests/Test-KbWalk.ps1 -WalkerPath D:\scratch\engine\kb-walk.ps1
#>
[CmdletBinding()]
param(
    [string]$WalkerPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'kb-walk.ps1'),
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

# What the last pass left, printed under a failed check so the reader sees the
# walker's result, the stub's records and both files without rerunning the test.
function Write-FailureDetail {
    $last = Get-Variable -Name r -Scope Script -ErrorAction SilentlyContinue
    if ($null -ne $last -and $null -ne $last.Value) {
        $stderrFirst = @(Get-Lines ([string]$last.Value.Stderr))
        $stderrText = if ($stderrFirst.Count -gt 0) { $stderrFirst[0] } else { '' }
        Write-Host "  last pass: exit $($last.Value.ExitCode), timed out $($last.Value.TimedOut), $([int]$last.Value.Seconds) s, stderr '$stderrText'"
    }
    foreach ($entry in @(Get-StubRecords)) { Write-Host "  stub record: args '$($entry.Args)' cwd '$($entry.Cwd)'" }
    foreach ($file in @($statusPath, $statePath)) {
        if (Test-Path -LiteralPath $file) {
            $text = (Get-Content -LiteralPath $file -Raw | ConvertFrom-Json -AsHashtable | ConvertTo-Json -Depth 8 -Compress)
            Write-Host "  $(Split-Path -Leaf $file): $text"
        } else {
            Write-Host "  $(Split-Path -Leaf $file): absent"
        }
    }
}

# Every process this test starts, so the finally block can stop any still running.
$script:started = New-Object System.Collections.Generic.List[System.Diagnostics.Process]

# The stub processes the kill case read from the process list before its kill,
# so the finally block can stop any that survived, and no other process.
$script:recordedStubs = @()

# Stops a process this test started and every process it started, by its PID.
# taskkill's output is read in the background and discarded, so the 10-second
# wait on taskkill bounds the read too, and the taskkill process object is
# disposed however the stop ends.
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

# Starts a program with its stdout and stderr read asynchronously, and with the
# named environment variables set, or removed where the value is $null.
function Start-Captured {
    param([string]$FilePath, [string[]]$Arguments, [hashtable]$Environment = @{}, [string]$WorkingDirectory = $null)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    foreach ($argument in $Arguments) { $psi.ArgumentList.Add($argument) }
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    if (-not [string]::IsNullOrEmpty($WorkingDirectory)) { $psi.WorkingDirectory = $WorkingDirectory }
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
# process holding them has ended. Past the timeout the program's tree is stopped
# and the result reads TimedOut.
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
        return [pscustomobject]@{ ExitCode = $null; Stdout = ''; Stderr = ''; TimedOut = $true; Seconds = $seconds }
    }
    $Run.Process.WaitForExit()
    return [pscustomobject]@{ ExitCode = $Run.Process.ExitCode; Stdout = $Run.Stdout.Result; Stderr = $Run.Stderr.Result; TimedOut = $false; Seconds = $seconds }
}

function Invoke-Captured {
    param([string]$FilePath, [string[]]$Arguments, [hashtable]$Environment = @{}, [int]$TimeoutSeconds = 60)
    return Wait-Captured (Start-Captured $FilePath $Arguments $Environment) $TimeoutSeconds
}

# Runs git in one repository with line-ending conversion off, and throws on failure.
function Invoke-Git {
    param([string]$Repo, [string[]]$Arguments, [hashtable]$Environment = @{})
    $result = Invoke-Captured 'git' (@('-C', $Repo, '-c', 'core.autocrlf=false') + $Arguments) $Environment
    if ($result.TimedOut -or $result.ExitCode -ne 0) { throw "git $($Arguments -join ' ') in $Repo failed: $($result.Stderr)" }
    return $result.Stdout
}

# Splits text into its non-empty lines.
function Get-Lines { param([string]$Text) return @($Text -split "`r?`n" | Where-Object { $_ -ne '' }) }

# One record per stub run: the argument line and the working directory.
function Get-StubRecords {
    if (-not (Test-Path -LiteralPath $script:record)) { return }
    $lines = [System.IO.File]::ReadAllLines($script:record)
    for ($i = 0; $i + 1 -lt $lines.Count; $i += 2) {
        [pscustomobject]@{ Args = ($lines[$i] -replace '^ARGS:', ''); Cwd = ($lines[$i + 1] -replace '^CWD:', '').TrimEnd('\') }
    }
}

function Clear-Stub {
    foreach ($file in @($script:record, $script:afterMarker, $script:buildRecord)) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
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

# Waits up to 20 seconds, or the seconds named, for the stub to record itself,
# and returns whether it did.
function Wait-StubRecorded {
    param([int]$Seconds = 20)
    $pollEnd = [DateTime]::UtcNow.AddSeconds($Seconds)
    while (-not (Test-StubRecorded) -and [DateTime]::UtcNow -lt $pollEnd) { Start-Sleep -Milliseconds 200 }
    return (Test-StubRecorded)
}

# The live processes whose command line names this test's stub, and every
# process each of them started, read from the process list. The stub's path
# holds this run's random folder name, so no other test's process matches. The
# test's own process and the pids in -Exclude are skipped, since the walker's
# command line names the stub too. A child is taken only when it started after
# its parent, so a reused parent pid adopts nothing.
function Get-StubProcesses {
    param([int[]]$Exclude = @())
    $all = @(Get-CimInstance -ClassName Win32_Process)
    $found = New-Object System.Collections.Generic.List[object]
    foreach ($process in $all) {
        if (($process.ProcessId -eq $PID) -or ($Exclude -contains $process.ProcessId)) { continue }
        if (($null -ne $process.CommandLine) -and ($process.CommandLine.IndexOf($script:stub, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) {
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

# A short tag for a survivor line: the executable name and the start of its arguments.
function Get-CommandTag {
    param([string]$CommandLine)
    if ([string]::IsNullOrEmpty($CommandLine)) { return 'no command line' }
    $flat = $CommandLine -replace '\s+', ' '
    if ($flat.Length -gt 120) { $flat = $flat.Substring(0, 120) }
    return $flat
}

$script:psExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
Write-Host "Host: $script:psExe ($($PSVersionTable.PSVersion))"

$WalkerPath = (Resolve-Path -LiteralPath $WalkerPath).ProviderPath
$script:engineRoot = Split-Path -Parent $WalkerPath
$templateDir = Join-Path $script:engineRoot 'template'
Write-Host "Walker: $WalkerPath"

$runId = [System.IO.Path]::GetRandomFileName().Replace('.', '')
$work = Join-Path $WorkRoot "kbwalk-test-$runId"
$profileDir = Join-Path $work 'profile'
$localDir = Join-Path $work 'local'
$listDir = Join-Path $localDir 'llm-wiki'
$listPath = Join-Path $listDir 'registry.json'
$statePath = Join-Path $listDir 'walk-state.json'
$statusPath = Join-Path $listDir 'walk-status.json'
$lockPath = Join-Path $listDir 'walk.lock'
$walkLog = Join-Path $listDir 'walk.log'
$noticesPath = Join-Path $listDir 'walk-notices.jsonl'
$claudeJson = Join-Path $profileDir '.claude.json'
$wikisDir = Join-Path $work 'wikis'
$remotesDir = Join-Path $work 'remotes'
$stubDir = Join-Path $work 'stub'
$script:stub = Join-Path $stubDir 'claude.cmd'
$script:record = Join-Path $stubDir 'record.txt'
$script:afterMarker = Join-Path $stubDir 'after-sleep.txt'
$script:buildRecord = Join-Path $stubDir 'build-record.txt'
$resolvedFile = Join-Path $stubDir 'resolved.md'
$emptyConfig = Join-Path $work 'empty.gitconfig'

$ingestArgs = '-p "Use the wiki-ingest skill." --model sonnet --permission-mode default --strict-mcp-config'
$lintArgs = '-p "Use the wiki-lint skill." --model sonnet --permission-mode default --strict-mcp-config'
$mergeArgs = '-p "Use the wiki-merge skill." --model sonnet --permission-mode default --strict-mcp-config'

# The wikis made so far, by name, with their paths; and the trusted ones.
$script:wikis = [ordered]@{}
$script:trustedPaths = New-Object System.Collections.Generic.List[string]

# Writes the trust file the walker reads: one projects entry per trusted wiki.
function Write-TrustFile {
    $projects = [ordered]@{}
    foreach ($path in $script:trustedPaths) { $projects[$path] = [ordered]@{ hasTrustDialogAccepted = $true } }
    $document = [ordered]@{ numStartups = 1; projects = $projects }
    [System.IO.File]::WriteAllText($claudeJson, (ConvertTo-Json -InputObject $document -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
}

# Makes one wiki from the template, committed on main with its own identity,
# marked with the given engine hash, and trusted unless told otherwise.
function New-Wiki {
    param([string]$Name, [string]$EngineHash = $script:engineHash, [bool]$Trusted = $true, [bool]$Identity = $true)
    $path = Join-Path $wikisDir $Name
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    Get-ChildItem -LiteralPath $templateDir -Force | Copy-Item -Destination $path -Recurse -Force
    $mark = [ordered]@{ templateHash = $EngineHash; source = 'test'; copiedAt = [DateTime]::UtcNow.ToString('o') }
    [System.IO.File]::WriteAllText((Join-Path $path '.claude\engine.json'), ((ConvertTo-Json -InputObject $mark) + "`n"), (New-Object System.Text.UTF8Encoding($false)))
    $null = Invoke-Git $path @('init', '-q', '-b', 'main')
    if ($Identity) {
        $null = Invoke-Git $path @('config', 'user.name', 'kb-walk test')
        $null = Invoke-Git $path @('config', 'user.email', 'kbwalk@test.invalid')
    }
    $null = Invoke-Git $path @('add', '-A')
    $null = Invoke-Git $path @('-c', 'user.name=kb-walk test', '-c', 'user.email=kbwalk@test.invalid', 'commit', '-q', '-m', "Initialize $Name")
    $script:wikis[$Name] = $path
    if ($Trusted) { $script:trustedPaths.Add($path) }
    Write-TrustFile
    return $path
}

# Writes the wiki list the registry would have written, naming the given wikis in order.
function Set-List {
    param([string[]]$Names)
    $entries = @()
    foreach ($name in $Names) {
        $entries += [ordered]@{ name = $name; path = $script:wikis[$name]; description = "$name wiki"; addedAt = [DateTime]::UtcNow.ToString('o') }
    }
    $document = [ordered]@{ version = 1; root = $wikisDir; wikis = [object[]]$entries }
    [System.IO.File]::WriteAllText($listPath, (ConvertTo-Json -InputObject $document -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
}

# Writes the walker's state file: the cursor and lastLintAt per named wiki.
function Set-State {
    param([string]$Cursor = $null, [hashtable]$LastLintAt = @{})
    $wikisState = [ordered]@{}
    foreach ($name in $LastLintAt.Keys) { $wikisState[$name] = [ordered]@{ lastLintAt = $LastLintAt[$name] } }
    $document = [ordered]@{ cursor = $Cursor; wikis = $wikisState }
    [System.IO.File]::WriteAllText($statePath, (ConvertTo-Json -InputObject $document -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
}

function Read-State { return (Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json -AsHashtable) }

# One line per entry under a folder, the folder itself included: its path, its
# size or "dir", and its last-write time in ticks. A folder's time moves when an
# entry is made or removed in it, so two equal snapshots mean nothing was written.
function Get-TreeSnapshot {
    param([string]$Root)
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("$Root|dir|$((Get-Item -LiteralPath $Root -Force).LastWriteTimeUtc.Ticks)")
    foreach ($item in @(Get-ChildItem -LiteralPath $Root -Recurse -Force)) {
        $size = if ($item.PSIsContainer) { 'dir' } else { [string]$item.Length }
        $lines.Add("$($item.FullName)|$size|$($item.LastWriteTimeUtc.Ticks)")
    }
    return ($lines -join "`n")
}

# A stamp read from a parsed file as the ISO 8601 text that was written, since
# ConvertFrom-Json turns such text into a DateTime.
function Get-StampText {
    param($Value)
    if ($Value -is [DateTime]) { return $Value.ToUniversalTime().ToString('o', [System.Globalization.CultureInfo]::InvariantCulture) }
    return [string]$Value
}

# The status entry of one wiki, or $null.
function Get-WikiStatus {
    param($Status, [string]$Name)
    if ($null -eq $Status) { return $null }
    foreach ($wiki in @($Status['wikis'])) { if ($wiki['name'] -ceq $Name) { return $wiki } }
    return $null
}

# One step's "outcome: note" text from the status, or '' where the step is absent.
function Get-Step {
    param($Status, [string]$Name, [string]$Step)
    $wiki = Get-WikiStatus $Status $Name
    if ($null -eq $wiki -or -not $wiki['steps'].ContainsKey($Step)) { return '' }
    $entry = $wiki['steps'][$Step]
    if ([string]::IsNullOrEmpty($entry['note'])) { return [string]$entry['outcome'] }
    return "$($entry['outcome']): $($entry['note'])"
}

# The names in the status's deferred list, with their reasons, as "name: reason".
function Get-Deferred {
    param($Status)
    return @(@($Status['deferred']) | ForEach-Object { "$($_['name']): $($_['reason'])" })
}

# The records of the notices file, each parsed. A line that does not parse is
# kept as a record holding only unparsable. With a name, only the records whose
# id opens with that name and a colon; the file is absent until a pass writes
# a notice, and then the result is empty.
function Get-Notices {
    param([string]$Name = '')
    if (-not (Test-Path -LiteralPath $noticesPath)) { return @() }
    $records = New-Object System.Collections.Generic.List[object]
    foreach ($line in @(Get-Lines ([System.IO.File]::ReadAllText($noticesPath)))) {
        try {
            $record = $line | ConvertFrom-Json -AsHashtable
        } catch {
            $record = @{ unparsable = $line }
        }
        if ($Name -ne '' -and -not ([string]$record['id']).StartsWith("$Name`:", [StringComparison]::Ordinal)) { continue }
        $records.Add($record)
    }
    return $records.ToArray()
}

# Whether a notice record's paths field is a JSON array holding exactly the
# expected names, in order and case-sensitively.
function Test-NoticePaths {
    param($Record, [string[]]$Expected)
    if ($null -eq $Record -or -not $Record.ContainsKey('paths')) { return $false }
    $field = $Record['paths']
    if (-not ($field -is [System.Collections.IList])) { return $false }
    if ($field.Count -ne $Expected.Count) { return $false }
    for ($i = 0; $i -lt $Expected.Count; $i++) {
        if (-not ($field[$i] -is [string]) -or ($field[$i] -cne $Expected[$i])) { return $false }
    }
    return $true
}

# The environment every walker run gets: the test's own account folders, no
# budget or model-run floor override, a stub that exits 0 at once and answers a
# build read with its own default build, overlaid with the case's values.
function Get-RunEnvironment {
    param([hashtable]$Overlay = @{})
    $environment = @{
        'LOCALAPPDATA'         = $localDir
        'USERPROFILE'          = $profileDir
        'KB_WALK_SECONDS'      = $null
        'KB_WALK_MODEL_FLOOR_SECONDS' = $null
        'KB_RUN_SECONDS'       = $null
        'KBWALK_STUB_SLEEP'    = '0'
        'KBWALK_STUB_MODE'     = 'leave'
        'KBWALK_STUB_RESOLVED' = $resolvedFile
        'KBWALK_STUB_ECHO'     = $null
        'KBWALK_STUB_LINT'     = $null
        'KBWALK_STUB_TAKE'     = $null
        'KBWALK_STUB_BUILD'    = $null
    }
    foreach ($name in $Overlay.Keys) { $environment[$name] = $Overlay[$name] }
    return $environment
}

function Start-Walker {
    param([hashtable]$Overlay = @{}, [string[]]$Extra = @())
    return Start-Captured $script:psExe (@('-NoProfile', '-File', $WalkerPath, '-Claude', $script:stub) + $Extra) (Get-RunEnvironment $Overlay)
}

# Runs one pass to its end. A pass that did not exit 0 has its stderr echoed,
# so a failing case shows the walker's own reason.
function Invoke-Walker {
    param([hashtable]$Overlay = @{}, [string[]]$Extra = @(), [int]$TimeoutSeconds = 120)
    $result = Wait-Captured (Start-Walker $Overlay $Extra) $TimeoutSeconds
    if ($result.TimedOut -or $result.ExitCode -ne 0) {
        foreach ($line in @(Get-Lines $result.Stderr)) { Write-Host "walker stderr: $line" }
    }
    return $result
}

# The status file parsed, or an empty stand-in marked missing where the pass
# left none, so a case reads as failed rather than stopping the test.
function Read-Status {
    if (-not (Test-Path -LiteralPath $statusPath)) {
        Write-Host "no status file at $statusPath"
        return [ordered]@{ missing = $true; engineHash = $null; wikis = @(); deferred = @(); failures = @() }
    }
    return (Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json -AsHashtable)
}

# Builds a history with two merge bases on a wiki's origin and brings the wiki
# to one side of it. From the base A, where the wiki, the other clone and
# origin's main all stand, the other clone commits B on main, which appends a
# line to $RolledBack, and C on $Side off A, which appends a line to
# $OtherPath. D merges main into the side, and the wiki is fast-forwarded to
# D. E merges C into main with $RolledBack put back to A's text, and origin's
# main is brought to E. The bases of D and E are B and C. git's one merge base
# is the newer by committer date, so C is dated an hour after B: a read
# against C alone lists nothing, the read against B lists $RolledBack, and
# git's merge of E into D takes E's rollback. Returns the ids and A's text of
# $RolledBack.
function New-TwoBaseHistory {
    param([string]$Wiki, [string]$Other, [string]$Side, [string]$RolledBack, [string]$OtherPath)
    $null = Invoke-Git $Other @('fetch', '-q', 'origin')
    $null = Invoke-Git $Other @('checkout', '-q', 'main')
    $null = Invoke-Git $Other @('merge', '-q', '--ff-only', 'origin/main')
    $aId = (Invoke-Git $Other @('rev-parse', 'HEAD')).Trim()
    $rolledFile = Join-Path $Other ($RolledBack -replace '/', '\')
    $otherFile = Join-Path $Other ($OtherPath -replace '/', '\')
    $baseText = [System.IO.File]::ReadAllText($rolledFile)
    $otherText = if (Test-Path -LiteralPath $otherFile) { [System.IO.File]::ReadAllText($otherFile) } else { '' }
    $older = @{ GIT_COMMITTER_DATE = [DateTime]::UtcNow.AddHours(-2).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [System.Globalization.CultureInfo]::InvariantCulture) }
    $newer = @{ GIT_COMMITTER_DATE = [DateTime]::UtcNow.AddHours(-1).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [System.Globalization.CultureInfo]::InvariantCulture) }
    [System.IO.File]::WriteAllText($rolledFile, ($baseText + "A line from the other clone, rolled back by E.`n"))
    $null = Invoke-Git $Other @('add', '--', $RolledBack)
    $null = Invoke-Git $Other @('commit', '-q', '-m', "Remote change to $RolledBack") $older
    $bId = (Invoke-Git $Other @('rev-parse', 'HEAD')).Trim()
    $null = Invoke-Git $Other @('push', '-q', 'origin', 'main')
    $null = Invoke-Git $Other @('checkout', '-q', '-b', $Side, $aId)
    [System.IO.File]::WriteAllText($otherFile, ($otherText + "A side line from the other clone.`n"))
    $null = Invoke-Git $Other @('add', '--', $OtherPath)
    $null = Invoke-Git $Other @('commit', '-q', '-m', "Remote change to $OtherPath") $newer
    $cId = (Invoke-Git $Other @('rev-parse', 'HEAD')).Trim()
    $null = Invoke-Git $Other @('merge', '-q', '--no-ff', '-m', 'Merge main into the side', 'main')
    $dId = (Invoke-Git $Other @('rev-parse', 'HEAD')).Trim()
    $null = Invoke-Git $Other @('push', '-q', 'origin', $Side)
    $null = Invoke-Git $Other @('checkout', '-q', 'main')
    $null = Invoke-Git $Other @('merge', '-q', '--no-commit', '--no-ff', $cId)
    [System.IO.File]::WriteAllText($rolledFile, $baseText)
    $null = Invoke-Git $Other @('add', '--', $RolledBack)
    $null = Invoke-Git $Other @('commit', '-q', '-m', "Merge the side into main with $RolledBack put back")
    $eId = (Invoke-Git $Other @('rev-parse', 'HEAD')).Trim()
    $null = Invoke-Git $Other @('push', '-q', 'origin', 'main')
    $null = Invoke-Git $Wiki @('fetch', '-q', 'origin')
    $null = Invoke-Git $Wiki @('merge', '-q', '--ff-only', $dId)
    return [pscustomobject]@{ A = $aId; B = $bId; C = $cId; D = $dId; E = $eId; BaseText = $baseText }
}

$priorGlobal = $env:GIT_CONFIG_GLOBAL
$priorNoSystem = $env:GIT_CONFIG_NOSYSTEM
$chiIndexLock = $null
$omegaIndexLock = $null
try {
    foreach ($dir in @($profileDir, $listDir, $wikisDir, $remotesDir, $stubDir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($emptyConfig, '')
    $env:GIT_CONFIG_GLOBAL = $emptyConfig
    $env:GIT_CONFIG_NOSYSTEM = '1'

    $hashed = Invoke-Captured $script:psExe @('-NoProfile', '-File', (Join-Path $script:engineRoot 'new-kb.ps1'), '-PrintEngineHash')
    if ($hashed.TimedOut -or $hashed.ExitCode -ne 0) { throw "new-kb.ps1 -PrintEngineHash failed: $($hashed.Stderr)" }
    $script:engineHash = @(Get-Lines $hashed.Stdout)[0]
    $hash8 = $script:engineHash.Substring(0, 8)
    $staleHash = ('a' * 64)
    $yesterday = [DateTime]::UtcNow.AddDays(-1).ToString('o')
    $eightDaysAgo = [DateTime]::UtcNow.AddDays(-8).ToString('o')

    # The stub. ping waits about one second per echo after the first, and is a
    # child process the walker's job must end. In resolve mode the stub takes
    # the resolved text over wiki/page.md and commits it, which completes the
    # merge as the merge skill's kb-commit.ps1 call would. On a lint run,
    # KBWALK_STUB_LINT commit makes an empty commit under Lint:, as a lint that
    # completes does, and reconcile one under Reconcile: alone, as a lint the
    # skill stopped at its live check after reconciling does; unset, the lint
    # commits nothing. On an ingest run, KBWALK_STUB_TAKE names one inbox file
    # the stub removes, as an ingest that moves its source to sources/ does;
    # unset, the ingest leaves the inbox as it found it. A build read, which
    # passes --version first, branches away before the stub writes anything,
    # so the record holds one ARGS: and CWD: pair per run.
    $stubLines = @(
        '@echo off'
        'if "%~1"=="--version" goto version'
        ">>`"$script:record`" echo ARGS:%*"
        ">>`"$script:record`" echo CWD:%CD%"
        'if not defined KBWALK_STUB_SLEEP set KBWALK_STUB_SLEEP=0'
        'set /a KBWALK_STUB_PINGS=KBWALK_STUB_SLEEP+1'
        'ping -n %KBWALK_STUB_PINGS% 127.0.0.1 >nul'
        'if defined KBWALK_STUB_ECHO echo the stub model''s first line'
        'if defined KBWALK_STUB_ECHO echo %KBWALK_STUB_ECHO%'
        'if "%KBWALK_STUB_MODE%"=="resolve" ('
        '  copy /y "%KBWALK_STUB_RESOLVED%" "wiki\page.md" >nul'
        '  git add -- wiki/page.md'
        '  git commit -q -m "Merge: join 1 pages from origin"'
        ')'
        'if "%~2"=="Use the wiki-lint skill." if "%KBWALK_STUB_LINT%"=="commit" git commit -q --allow-empty -m "Lint: stub check, clean"'
        'if "%~2"=="Use the wiki-lint skill." if "%KBWALK_STUB_LINT%"=="reconcile" git commit -q --allow-empty -m "Reconcile: stub leftovers"'
        'if "%~2"=="Use the wiki-ingest skill." if defined KBWALK_STUB_TAKE del /q "inbox\%KBWALK_STUB_TAKE%"'
        ">>`"$script:afterMarker`" echo after"
        'exit 0'
        ':version'
        ">>`"$script:buildRecord`" echo ARGS:%*"
        'if not defined KBWALK_STUB_BUILD set KBWALK_STUB_BUILD=2.1.257'
        'echo %KBWALK_STUB_BUILD%'
        'exit 0'
    )
    [System.IO.File]::WriteAllText($script:stub, (($stubLines -join "`r`n") + "`r`n"), (New-Object System.Text.ASCIIEncoding))

    # --- No list: a status with an empty wikis array and the note.
    $r = Invoke-Walker
    $status = Read-Status
    Test-Check 'with no wiki list the pass exits 0 and writes a status with an empty wikis array and the note "no wikis listed"' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@($status['wikis']).Count -eq 0) -and ($status['note'] -ceq 'no wikis listed'))

    # --- Bullet 1: three wikis, one inbox file, one empty inbox, one untrusted,
    # every lint stamped yesterday: one stub call, in the first wiki.
    $alpha = New-Wiki 'alpha'
    $beta = New-Wiki 'beta'
    $gamma = New-Wiki 'gamma' -Trusted $false
    [System.IO.File]::WriteAllText((Join-Path $alpha 'inbox\drop.md'), "a dropped note`n")
    Set-List @('alpha', 'beta', 'gamma')
    Set-State -LastLintAt @{ alpha = $yesterday; beta = $yesterday; gamma = $yesterday }
    Clear-Stub
    Remove-Item -LiteralPath $statusPath -Force
    $statusAbsentBefore = -not (Test-Path -LiteralPath $statusPath)
    $r = Invoke-Walker @{ 'KBWALK_STUB_TAKE' = 'drop.md' }
    $records = @(Get-StubRecords)
    $status = Read-Status
    Test-Check 'a pass over three wikis exits 0 and calls the stub once, in the first wiki, with the ingest argument line' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $alpha) -and ($records[0].Args -ceq $ingestArgs))
    Test-Check 'the status reads ingest ran for the inbox file, ingest skipped: inbox empty for the empty inbox, and untrusted for the untrusted wiki' (((Get-Step $status 'alpha' 'ingest') -ceq 'ran') -and ((Get-Step $status 'beta' 'ingest') -ceq 'skipped: inbox empty') -and ((Get-WikiStatus $status 'gamma')['result'] -ceq 'untrusted'))
    Test-Check 'the status was written fresh by the pass, with engineHash the engine''s and lint skipped: not due on the stamped wikis' ($statusAbsentBefore -and (Test-Path -LiteralPath $statusPath) -and ($status['engineHash'] -ceq $script:engineHash) -and ((Get-Step $status 'alpha' 'lint') -ceq 'skipped: not due') -and ((Get-Step $status 'beta' 'update') -ceq 'skipped: current') -and (Test-Path -LiteralPath $walkLog))

    # -WhatIf prints the three wikis it would visit and writes nothing on disk:
    # every entry in the walk folder, LOCALAPPDATA\llm-wiki, keeps its size and
    # its last-write time, the folder itself included, so a folder made and
    # removed again inside it still shows in the walk folder's time.
    Clear-Stub
    $walkBefore = Get-TreeSnapshot $listDir
    $r = Invoke-Walker -Extra @('-WhatIf')
    $walkAfter = Get-TreeSnapshot $listDir
    $whatIfLines = @(Get-Lines $r.Stdout)
    Test-Check '-WhatIf exits 0, prints one would-visit line per listed wiki, starts no stub, and leaves every entry in the walk folder as it was' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($whatIfLines.Count -eq 3) -and (@($whatIfLines | Where-Object { -not $_.StartsWith('kb-walk: would visit ', [StringComparison]::Ordinal) }).Count -eq 0) -and (@(Get-StubRecords).Count -eq 0) -and ($walkAfter -ceq $walkBefore))

    # --- A build under the wrapper's floor. The stub's build reaches the wiki's
    # wrapper through the pass's environment, so the pass lists this wiki
    # alone. Its inbox holds a file and its lint is stamped yesterday, so the
    # ingest is the pass's one model run, and the wrapper refuses it: the
    # step reads failed, its note and the failures entry carry the wrapper's
    # line, and the stub's record holds no run.
    $heth = New-Wiki 'heth'
    [System.IO.File]::WriteAllText((Join-Path $heth 'inbox\drop.md'), "a dropped note`n")
    Set-List @('heth')
    Set-State -LastLintAt @{ heth = $yesterday }
    Clear-Stub
    $r = Invoke-Walker @{ 'KBWALK_STUB_BUILD' = '2.1.256' }
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    $hethStep = Get-Step $status 'heth' 'ingest'
    $hethFailures = @(@($status['failures']) | Where-Object { ($_['name'] -ceq 'heth') -and ($_['step'] -ceq 'ingest') })
    $hethHoldFields = @(@('ingestFailures', 'lastIngestAttemptAt', 'ingestStalledInbox') | Where-Object { $state['wikis']['heth'].ContainsKey($_) })
    Test-Check 'a wiki whose stub build is 2.1.256 reads ingest failed with a note holding exited 1, 2.1.256 and is older than 2.1.257, lists one ingest failure holding the same words, starts no stub run, and, since a non-zero exit counts nothing, leaves its state with no ingestFailures, lastIngestAttemptAt or ingestStalledInbox' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and $hethStep.StartsWith('failed: ', [StringComparison]::Ordinal) -and $hethStep.Contains('exited 1') -and $hethStep.Contains('2.1.256') -and $hethStep.Contains('is older than 2.1.257') -and ($hethFailures.Count -eq 1) -and ([string]$hethFailures[0]['note']).Contains('2.1.256') -and ([string]$hethFailures[0]['note']).Contains('is older than 2.1.257') -and ($records.Count -eq 0) -and ($hethHoldFields.Count -eq 0))

    # The same refusal on a merge run. teth's pull conflicts on wiki/page.md
    # and the wrapper refuses its Merge run on the old build: the merge step
    # reads failed with the wrapper's line, listed under failures, while the
    # pull still reads deferred: conflict as for a run that joined nothing.
    $tethBare = Join-Path $remotesDir 'teth.git'
    $null = Invoke-Git $remotesDir @('init', '-q', '--bare', '-b', 'main', $tethBare)
    $teth = New-Wiki 'teth'
    $tethPage = Join-Path $teth 'wiki\page.md'
    [System.IO.File]::WriteAllText($tethPage, "base line`n")
    $null = Invoke-Git $teth @('add', '-A')
    $null = Invoke-Git $teth @('commit', '-q', '-m', 'Add page')
    $null = Invoke-Git $teth @('remote', 'add', 'origin', $tethBare)
    $null = Invoke-Git $teth @('push', '-q', '-u', 'origin', 'main')
    $tethOther = Join-Path $remotesDir 'teth-other'
    $null = Invoke-Git $remotesDir @('clone', '-q', $tethBare, $tethOther)
    $null = Invoke-Git $tethOther @('config', 'user.name', 'other side')
    $null = Invoke-Git $tethOther @('config', 'user.email', 'other@test.invalid')
    [System.IO.File]::WriteAllText((Join-Path $tethOther 'wiki\page.md'), "remote line`n")
    $null = Invoke-Git $tethOther @('commit', '-q', '-a', '-m', 'Remote edit')
    $null = Invoke-Git $tethOther @('push', '-q', 'origin', 'main')
    [System.IO.File]::WriteAllText($tethPage, "local line`n")
    $null = Invoke-Git $teth @('commit', '-q', '-a', '-m', 'Local edit')
    $tethHeadBefore = (Invoke-Git $teth @('rev-parse', 'HEAD')).Trim()
    Set-List @('teth')
    Set-State -LastLintAt @{ teth = $yesterday }
    Clear-Stub
    $r = Invoke-Walker @{ 'KBWALK_STUB_BUILD' = '2.1.256' }
    $records = @(Get-StubRecords)
    $status = Read-Status
    $tethStep = Get-Step $status 'teth' 'merge'
    $tethFailures = @(@($status['failures']) | Where-Object { ($_['name'] -ceq 'teth') -and ($_['step'] -ceq 'merge') })
    $tethDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'teth' })
    $tethPaths = @(if ($tethDeferred.Count -eq 1 -and $tethDeferred[0].ContainsKey('paths')) { @($tethDeferred[0]['paths']) } else { @() })
    $tethMergeHeadGone = (Invoke-Captured 'git' @('-C', $teth, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).ExitCode -ne 0
    Test-Check 'a conflicting pull in a wiki whose stub build is 2.1.256 reads merge failed with a note holding exited 1, 2.1.256 and is older than 2.1.257, lists one merge failure holding the same words, starts no stub run, and leaves the pull deferred: conflict with its path, passes 1, MERGE_HEAD gone and HEAD as before' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and $tethStep.StartsWith('failed: ', [StringComparison]::Ordinal) -and $tethStep.Contains('exited 1') -and $tethStep.Contains('2.1.256') -and $tethStep.Contains('is older than 2.1.257') -and ($tethFailures.Count -eq 1) -and ([string]$tethFailures[0]['note']).Contains('exited 1') -and ([string]$tethFailures[0]['note']).Contains('2.1.256') -and ([string]$tethFailures[0]['note']).Contains('is older than 2.1.257') -and ($records.Count -eq 0) -and ((Get-Step $status 'teth' 'pull') -ceq 'deferred: conflict') -and ($tethDeferred.Count -eq 1) -and ($tethDeferred[0]['reason'] -ceq 'conflict') -and ($tethPaths.Count -eq 1) -and ($tethPaths[0] -ceq 'wiki/page.md') -and ($tethDeferred[0]['passes'] -eq 1) -and $tethMergeHeadGone -and ((Invoke-Git $teth @('rev-parse', 'HEAD')).Trim() -ceq $tethHeadBefore))

    # --- An ingest run that takes nothing. samekh's inbox holds one file and
    # its lint is stamped yesterday, so the ingest is the pass's one model
    # run, and the stub leaves the inbox as it found it. The step reads failed
    # with the fixed note, listed once under failures, and the state counts
    # ingestFailures 1 with the run's start and the digest of the names.
    $tookNothing = 'kb-run.ps1 -Operation Ingest exited 0 and took no file from inbox/'
    $heldNote = 'held after 3 ingest runs that took no file from inbox/'
    $samekh = New-Wiki 'samekh'
    [System.IO.File]::WriteAllText((Join-Path $samekh 'inbox\drop.md'), "a dropped note`n")
    Set-List @('samekh')
    Set-State -LastLintAt @{ samekh = $yesterday }
    Clear-Stub
    $r = Invoke-Walker
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    $samekhFailures = @(@($status['failures']) | Where-Object { ($_['name'] -ceq 'samekh') -and ($_['step'] -ceq 'ingest') })
    $samekhAttempt = [DateTime]::MinValue
    $samekhAttempted = [DateTime]::TryParseExact((Get-StampText $state['wikis']['samekh']['lastIngestAttemptAt']), 'o', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$samekhAttempt)
    $samekhDigest = [string]$state['wikis']['samekh']['ingestStalledInbox']
    Test-Check 'an ingest run that exits 0 and leaves the inbox as it found it reads failed: kb-run.ps1 -Operation Ingest exited 0 and took no file from inbox/, is listed once under failures with that note, and counts ingestFailures 1 with a fresh lastIngestAttemptAt and a 64-digit lowercase ingestStalledInbox' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $samekh) -and ($records[0].Args -ceq $ingestArgs) -and ((Get-Step $status 'samekh' 'ingest') -ceq "failed: $tookNothing") -and ($samekhFailures.Count -eq 1) -and ([string]$samekhFailures[0]['note'] -ceq $tookNothing) -and ($state['wikis']['samekh']['ingestFailures'] -eq 1) -and $samekhAttempted -and ($samekhAttempt.ToUniversalTime() -gt [DateTime]::UtcNow.AddMinutes(-5)) -and ($samekhDigest -cmatch '\A[0-9a-f]{64}\z'))

    # The ingest hold. Two more such passes count samekh's ingestFailures to
    # 3, and a fourth inside the day starts no stub, reads failed with the
    # held note, and the log names the time the hold ends, a day after the
    # third run started. With that start moved 25 hours back, a fifth pass
    # runs the stub again and counts 4.
    $samekhPassesOk = $true
    foreach ($pass in 2..3) {
        Clear-Stub
        $r = Invoke-Walker
        $records = @(Get-StubRecords)
        $status = Read-Status
        $state = Read-State
        $samekhPassOk = (-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Args -ceq $ingestArgs) -and ((Get-Step $status 'samekh' 'ingest') -ceq "failed: $tookNothing") -and ($state['wikis']['samekh']['ingestFailures'] -eq $pass)
        if (-not $samekhPassOk) { Write-Host "samekh pass $pass off its expected shape" }
        $samekhPassesOk = $samekhPassesOk -and $samekhPassOk
    }
    $samekhAttempted = [DateTime]::TryParseExact((Get-StampText $state['wikis']['samekh']['lastIngestAttemptAt']), 'o', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$samekhAttempt)
    $samekhHeldUntil = $samekhAttempt.ToUniversalTime().AddHours(24).ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $samekhHeldFailures = @(@($status['failures']) | Where-Object { ($_['name'] -ceq 'samekh') -and ($_['step'] -ceq 'ingest') })
    $samekhHeldOk = $samekhPassesOk -and $samekhAttempted -and (-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'samekh' 'ingest') -ceq "failed: $heldNote") -and ($samekhHeldFailures.Count -eq 1) -and (@([System.IO.File]::ReadAllLines($walkLog) | Where-Object { $_.Contains(' samekh ingest ') -and $_.Contains($samekhHeldUntil) }).Count -ge 1)
    $state = Read-State
    $state['wikis']['samekh']['lastIngestAttemptAt'] = [DateTime]::UtcNow.AddHours(-25).ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    [System.IO.File]::WriteAllText($statePath, (ConvertTo-Json -InputObject $state -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
    Clear-Stub
    $r = Invoke-Walker
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    Test-Check 'an ingest that takes nothing on three passes in a row calls the stub once a pass and counts ingestFailures 2 and 3, a fourth pass inside the day starts no stub, reads failed: held after 3 ingest runs that took no file from inbox/ and the log names the time the hold ends, and a fifth with the last attempt 25 hours back calls the stub again and counts 4' ($samekhHeldOk -and (-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $samekh) -and ($records[0].Args -ceq $ingestArgs) -and ((Get-Step $status 'samekh' 'ingest') -ceq "failed: $tookNothing") -and ($state['wikis']['samekh']['ingestFailures'] -eq 4))

    # The release, in both forms. samekh is held again, its last attempt
    # fresh. A file added to its inbox changes the names, so the next pass
    # starts the stub, which takes nothing again: the count restarts at 1,
    # never 5, under a digest other than the held one. An emptied inbox then
    # reads skipped: inbox empty with all three fields gone.
    $samekhHeldDigest = [string]$state['wikis']['samekh']['ingestStalledInbox']
    [System.IO.File]::WriteAllText((Join-Path $samekh 'inbox\second.md'), "a second note`n")
    Clear-Stub
    $r = Invoke-Walker
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    $samekhReleasedDigest = [string]$state['wikis']['samekh']['ingestStalledInbox']
    $samekhReleaseOk = (-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Args -ceq $ingestArgs) -and ((Get-Step $status 'samekh' 'ingest') -ceq "failed: $tookNothing") -and ($state['wikis']['samekh']['ingestFailures'] -eq 1) -and ($samekhReleasedDigest -cmatch '\A[0-9a-f]{64}\z') -and ($samekhReleasedDigest -cne $samekhHeldDigest)
    foreach ($name in @('drop.md', 'second.md')) { Remove-Item -LiteralPath (Join-Path $samekh "inbox\$name") -Force }
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $state = Read-State
    $samekhHoldFields = @(@('ingestFailures', 'lastIngestAttemptAt', 'ingestStalledInbox') | Where-Object { $state['wikis']['samekh'].ContainsKey($_) })
    Test-Check 'a held ingest whose inbox gains a file starts the stub on the next pass and, taking nothing, counts ingestFailures 1 under a new digest, and once its inbox is emptied it reads skipped: inbox empty with ingestFailures, lastIngestAttemptAt and ingestStalledInbox gone' ($samekhReleaseOk -and (-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'samekh' 'ingest') -ceq 'skipped: inbox empty') -and ($samekhHoldFields.Count -eq 0))

    # The other direction. ayin's inbox holds two files. The first pass's stub
    # leaves both, so the state counts 1 under their digest. The second pass,
    # over the same two names and that state as the walker wrote it, has the
    # stub take one, as an ingest that moves a source or removes a duplicate
    # does: the ingest reads ran, lists no failure, and all three fields go.
    $ayin = New-Wiki 'ayin'
    [System.IO.File]::WriteAllText((Join-Path $ayin 'inbox\first.md'), "a first note`n")
    [System.IO.File]::WriteAllText((Join-Path $ayin 'inbox\other.md'), "another note`n")
    Set-List @('ayin')
    Set-State -LastLintAt @{ ayin = $yesterday }
    Clear-Stub
    $r = Invoke-Walker
    $state = Read-State
    $ayinWritten = (-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 1) -and ($state['wikis']['ayin']['ingestFailures'] -eq 1) -and $state['wikis']['ayin'].ContainsKey('lastIngestAttemptAt') -and ([string]$state['wikis']['ayin']['ingestStalledInbox'] -cmatch '\A[0-9a-f]{64}\z')
    Clear-Stub
    $r = Invoke-Walker @{ 'KBWALK_STUB_TAKE' = 'first.md' }
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    $ayinFailures = @(@($status['failures']) | Where-Object { ($_['name'] -ceq 'ayin') -and ($_['step'] -ceq 'ingest') })
    $ayinHoldFields = @(@('ingestFailures', 'lastIngestAttemptAt', 'ingestStalledInbox') | Where-Object { $state['wikis']['ayin'].ContainsKey($_) })
    $ayinLeft = @(Get-ChildItem -LiteralPath (Join-Path $ayin 'inbox') -File | Where-Object { $_.Name -ne '.gitkeep' })
    Test-Check 'an ingest that took nothing on one pass, whose stub on the next pass over the same two names takes one, reads ran, lists no ingest failure, and leaves ingestFailures, lastIngestAttemptAt and ingestStalledInbox gone' ($ayinWritten -and (-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Args -ceq $ingestArgs) -and ($ayinLeft.Count -eq 1) -and ((Get-Step $status 'ayin' 'ingest') -ceq 'ran') -and ($ayinFailures.Count -eq 0) -and ($ayinHoldFields.Count -eq 0))

    # --- Bullet 2: the lint gate both ways on the seven-day stamp.
    $delta = New-Wiki 'delta'
    Set-List @('delta', 'beta')
    Set-State -LastLintAt @{ delta = $eightDaysAgo; beta = $yesterday }
    Clear-Stub

    # The stub's model output carries the wrapper's lock-held prefix on its
    # second line, so only a lock check that reads the first line alone
    # records `run` for this lint. The stub commits under Lint:, as a lint
    # that completes does.
    $modelLockLine = 'kb-run: another run holds the lock for this text, printed by the model'
    $r = Invoke-Walker @{ 'KBWALK_STUB_ECHO' = $modelLockLine; 'KBWALK_STUB_LINT' = 'commit' }
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    $deltaStamp = [DateTime]::MinValue
    $deltaStamped = [DateTime]::TryParseExact((Get-StampText $state['wikis']['delta']['lastLintAt']), 'o', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$deltaStamp)
    $deltaSubject = (Invoke-Git $delta @('log', '-1', '--format=%s')).Trim()
    Test-Check 'a wiki stamped eight days ago whose lint commits under Lint: gets one Lint call, reads lint ran, and has a fresh lastLintAt' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $delta) -and ($records[0].Args -ceq $lintArgs) -and $deltaSubject.StartsWith('Lint:', [StringComparison]::Ordinal) -and ((Get-Step $status 'delta' 'lint') -ceq 'ran') -and $deltaStamped -and ($deltaStamp.ToUniversalTime() -gt [DateTime]::UtcNow.AddMinutes(-5)))
    Test-Check 'a wiki stamped yesterday gets no Lint call and keeps its stamp' (((Get-Step $status 'beta' 'lint') -ceq 'skipped: not due') -and ((Get-StampText $state['wikis']['beta']['lastLintAt']) -ceq $yesterday))
    $modelLines = @(Get-Lines $r.Stdout)
    $modelLockAt = [Array]::IndexOf($modelLines, $modelLockLine)
    Test-Check 'a lint whose model output carries the lock-held prefix on a later line reads ran and is stamped, and that line reached the walker''s stdout after the model''s first line' (((Get-Step $status 'delta' 'lint') -ceq 'ran') -and $deltaStamped -and ($modelLockAt -ge 1) -and ($modelLines[$modelLockAt - 1] -ceq 'the stub model''s first line'))

    # A lint that exits 0 with no Lint: commit is not stamped. sampi's lint
    # commits under Reconcile: alone, as a lint the skill stopped at its live
    # check after reconciling does, so HEAD moves; san's lint commits nothing.
    # Each is due, and each reads skipped: no Lint: commit with its stamp kept.
    $sampi = New-Wiki 'sampi'
    $san = New-Wiki 'san'
    $sampiHeadBefore = (Invoke-Git $sampi @('rev-parse', 'HEAD')).Trim()
    Set-List @('sampi')
    Set-State -LastLintAt @{ sampi = $eightDaysAgo }
    Clear-Stub
    $r = Invoke-Walker @{ 'KBWALK_STUB_LINT' = 'reconcile' }
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    $sampiSubject = (Invoke-Git $sampi @('log', '-1', '--format=%s')).Trim()
    $sampiFailures = @(@($status['failures']) | Where-Object { $_['name'] -ceq 'sampi' })
    Test-Check 'a due lint that exits 0 having made only a Reconcile: commit gets its one Lint call, moves HEAD, reads lint skipped: no Lint: commit, keeps its old stamp, and lists no failure' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $sampi) -and ($records[0].Args -ceq $lintArgs) -and ($sampiSubject -ceq 'Reconcile: stub leftovers') -and ((Invoke-Git $sampi @('rev-parse', 'HEAD~1')).Trim() -ceq $sampiHeadBefore) -and ((Get-Step $status 'sampi' 'lint') -ceq 'skipped: no Lint: commit') -and ((Get-StampText $state['wikis']['sampi']['lastLintAt']) -ceq $eightDaysAgo) -and ($sampiFailures.Count -eq 0))
    $sanHeadBefore = (Invoke-Git $san @('rev-parse', 'HEAD')).Trim()
    Set-List @('san')
    Set-State -LastLintAt @{ san = $eightDaysAgo }
    Clear-Stub
    $r = Invoke-Walker
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    Test-Check 'a due lint that exits 0 with no commit at all gets its one Lint call, reads lint skipped: no Lint: commit with HEAD as before, and keeps its old stamp' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $san) -and ($records[0].Args -ceq $lintArgs) -and ((Invoke-Git $san @('rev-parse', 'HEAD')).Trim() -ceq $sanHeadBefore) -and ((Get-Step $status 'san' 'lint') -ceq 'skipped: no Lint: commit') -and ((Get-StampText $state['wikis']['san']['lastLintAt']) -ceq $eightDaysAgo))

    # The lint hold. aleph's due lint makes no Lint: commit on three passes in
    # a row, so its state counts lintFailures 1, 2 and 3. Its stamp stays
    # eight days old, so the fourth pass, inside the day, is held by the hold
    # and not by the seven-day gate: it starts no stub, records skipped: held
    # after 3 failed lints, and the log names the time the hold ends, a day
    # after the third run started. With that start moved 25 hours back, a
    # fifth pass runs the stub again and counts a fourth failure; with it
    # moved back again, a sixth pass whose stub commits under Lint: is stamped
    # and clears both fields.
    $aleph = New-Wiki 'aleph'
    Set-List @('aleph')
    Set-State -LastLintAt @{ aleph = $eightDaysAgo }
    $alephPassesOk = $true
    foreach ($pass in 1..3) {
        Clear-Stub
        $r = Invoke-Walker
        $records = @(Get-StubRecords)
        $status = Read-Status
        $state = Read-State
        $alephPassOk = (-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $aleph) -and ($records[0].Args -ceq $lintArgs) -and ((Get-Step $status 'aleph' 'lint') -ceq 'skipped: no Lint: commit') -and ($state['wikis']['aleph']['lintFailures'] -eq $pass)
        if (-not $alephPassOk) { Write-Host "aleph pass $pass off its expected shape" }
        $alephPassesOk = $alephPassesOk -and $alephPassOk
    }
    $alephAttempt = [DateTime]::MinValue
    $alephAttempted = [DateTime]::TryParseExact((Get-StampText $state['wikis']['aleph']['lastLintAttemptAt']), 'o', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$alephAttempt)
    $alephHeldUntil = $alephAttempt.ToUniversalTime().AddHours(24).ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    Test-Check 'a due lint with no Lint: commit on three passes in a row calls the stub once a pass and counts lintFailures 1, 2 and 3, and a fourth pass inside the day starts no stub, records skipped: held after 3 failed lints, and the log names the time the hold ends' ($alephPassesOk -and $alephAttempted -and (-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'aleph' 'lint') -ceq 'skipped: held after 3 failed lints') -and ([System.IO.File]::ReadAllText($walkLog).Contains("aleph lint has failed 3 times in a row, so its run is held until $alephHeldUntil")))
    $state = Read-State
    $state['wikis']['aleph']['lastLintAttemptAt'] = [DateTime]::UtcNow.AddHours(-25).ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    [System.IO.File]::WriteAllText($statePath, (ConvertTo-Json -InputObject $state -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
    Clear-Stub
    $r = Invoke-Walker
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    Test-Check 'with the last failed lint''s start 25 hours back, the held lint''s fifth pass calls the stub with Lint again, reads skipped: no Lint: commit, and counts lintFailures 4' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $aleph) -and ($records[0].Args -ceq $lintArgs) -and ((Get-Step $status 'aleph' 'lint') -ceq 'skipped: no Lint: commit') -and ($state['wikis']['aleph']['lintFailures'] -eq 4))
    $state['wikis']['aleph']['lastLintAttemptAt'] = [DateTime]::UtcNow.AddHours(-25).ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    [System.IO.File]::WriteAllText($statePath, (ConvertTo-Json -InputObject $state -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
    Clear-Stub
    $r = Invoke-Walker @{ 'KBWALK_STUB_LINT' = 'commit' }
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    $alephStamp = [DateTime]::MinValue
    $alephStamped = [DateTime]::TryParseExact((Get-StampText $state['wikis']['aleph']['lastLintAt']), 'o', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$alephStamp)
    Test-Check 'a held lint''s run a day on that commits under Lint: reads lint ran with a fresh lastLintAt, and its state holds neither lintFailures nor lastLintAttemptAt' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Args -ceq $lintArgs) -and ((Get-Step $status 'aleph' 'lint') -ceq 'ran') -and $alephStamped -and ($alephStamp.ToUniversalTime() -gt [DateTime]::UtcNow.AddMinutes(-5)) -and (-not $state['wikis']['aleph'].ContainsKey('lintFailures')) -and (-not $state['wikis']['aleph'].ContainsKey('lastLintAttemptAt')))

    # A last failed lint's start a year ahead names no run that started, so
    # it reads as absent and holds nothing. aleph's stamp is moved eight days
    # back, so the seven-day gate passes it and only the hold could keep the
    # stub from running.
    $state['wikis']['aleph']['lastLintAt'] = $eightDaysAgo
    $state['wikis']['aleph']['lintFailures'] = 3
    $state['wikis']['aleph']['lastLintAttemptAt'] = [DateTime]::UtcNow.AddDays(365).ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    [System.IO.File]::WriteAllText($statePath, (ConvertTo-Json -InputObject $state -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
    Clear-Stub
    $r = Invoke-Walker
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    Test-Check 'a due lint counting 3 failures whose last attempt reads a year ahead is not held: it calls the stub with Lint, reads skipped: no Lint: commit, and counts lintFailures 4' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $aleph) -and ($records[0].Args -ceq $lintArgs) -and ((Get-Step $status 'aleph' 'lint') -ceq 'skipped: no Lint: commit') -and ($state['wikis']['aleph']['lintFailures'] -eq 4))

    # The model-run floor. bet's inbox holds a file, so its ingest is due.
    # KB_WALK_MODEL_FLOOR_SECONDS 99999 sits over the whole 6900-second budget,
    # while the 60-second child floor and the 120-second floor for starting a
    # wiki sit far under what is left, so only the model-run floor can refuse:
    # the ingest reads skipped: budget with no stub call, while the pull's
    # fetch, diff and fast-forward and the push's upstream read still run.
    $betBare = Join-Path $remotesDir 'bet.git'
    $null = Invoke-Git $remotesDir @('init', '-q', '--bare', '-b', 'main', $betBare)
    $bet = New-Wiki 'bet'
    $null = Invoke-Git $bet @('remote', 'add', 'origin', $betBare)
    $null = Invoke-Git $bet @('push', '-q', '-u', 'origin', 'main')
    [System.IO.File]::WriteAllText((Join-Path $bet 'inbox\drop.md'), "bet note`n")
    Set-List @('bet')
    Set-State -LastLintAt @{ bet = $yesterday }
    Clear-Stub
    $r = Invoke-Walker @{ 'KB_WALK_MODEL_FLOOR_SECONDS' = '99999' }
    $status = Read-Status
    Test-Check 'with KB_WALK_MODEL_FLOOR_SECONDS over the remaining budget and the budget far over the 60-second child floor, a due ingest reads skipped: budget with no stub call, while the same pass''s pull reads ran: up to date, its push skipped: nothing to push, and no failure is listed' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'bet' 'ingest') -ceq 'skipped: budget') -and ((Get-Step $status 'bet' 'pull') -ceq 'ran: up to date') -and ((Get-Step $status 'bet' 'push') -ceq 'skipped: nothing to push') -and (@($status['failures']).Count -eq 0))

    # --- Bullet 3: a wiki with an origin. The bare remote is seeded from the
    # wiki, and a second clone makes the remote's changes.
    $bare = Join-Path $remotesDir 'epsilon.git'
    $null = Invoke-Git $remotesDir @('init', '-q', '--bare', '-b', 'main', $bare)
    $epsilon = New-Wiki 'epsilon'
    [System.IO.File]::WriteAllText((Join-Path $epsilon 'wiki\page.md'), "line one`nline two`n")
    $null = Invoke-Git $epsilon @('add', '-A')
    $null = Invoke-Git $epsilon @('commit', '-q', '-m', 'Add page')
    $null = Invoke-Git $epsilon @('remote', 'add', 'origin', $bare)
    $null = Invoke-Git $epsilon @('push', '-q', '-u', 'origin', 'main')
    $other = Join-Path $remotesDir 'other'
    $null = Invoke-Git $remotesDir @('clone', '-q', $bare, $other)
    $null = Invoke-Git $other @('config', 'user.name', 'other side')
    $null = Invoke-Git $other @('config', 'user.email', 'other@test.invalid')

    [System.IO.File]::WriteAllText((Join-Path $other 'wiki\remote-only.md'), "from the remote`n")
    $null = Invoke-Git $other @('add', '-A')
    $null = Invoke-Git $other @('commit', '-q', '-m', 'Remote page')
    $null = Invoke-Git $other @('push', '-q', 'origin', 'main')
    Set-List @('epsilon')
    Set-State -LastLintAt @{ epsilon = $yesterday }
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $remoteHead = (Invoke-Git $bare @('rev-parse', 'main')).Trim()
    $localHead = (Invoke-Git $epsilon @('rev-parse', 'HEAD')).Trim()
    Test-Check 'a wiki whose origin holds a commit it lacks is fast-forwarded to it with no stub call and no merge step, and nothing is pushed' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 0) -and ($localHead -ceq $remoteHead) -and ((Get-Step $status 'epsilon' 'pull') -ceq 'ran: fast-forward') -and ((Get-Step $status 'epsilon' 'push') -ceq 'skipped: nothing to push') -and ((Get-Step $status 'epsilon' 'merge') -ceq ''))

    [System.IO.File]::WriteAllText((Join-Path $other 'wiki\page.md'), "remote line one`nline two`n")
    $null = Invoke-Git $other @('commit', '-q', '-a', '-m', 'Remote edit')
    $null = Invoke-Git $other @('push', '-q', 'origin', 'main')
    [System.IO.File]::WriteAllText((Join-Path $epsilon 'wiki\page.md'), "local line one`nline two`n")
    $null = Invoke-Git $epsilon @('commit', '-q', '-a', '-m', 'Local edit')
    [System.IO.File]::WriteAllText($resolvedFile, "remote line one and local line one`nline two`n")
    $epsilonHeadBefore = (Invoke-Git $epsilon @('rev-parse', 'HEAD')).Trim()
    Clear-Stub
    $r = Invoke-Walker @{ 'KBWALK_STUB_MODE' = 'resolve' }
    $records = @(Get-StubRecords)
    $status = Read-Status
    $remoteHead = (Invoke-Git $bare @('rev-parse', 'main')).Trim()
    $localHead = (Invoke-Git $epsilon @('rev-parse', 'HEAD')).Trim()
    $parents = @((Invoke-Git $epsilon @('rev-list', '--parents', '-n', '1', 'HEAD')).Trim() -split ' ')
    $mergeHeadGone = (Invoke-Captured 'git' @('-C', $epsilon, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).ExitCode -ne 0
    Test-Check 'a conflicting pull runs the stub with the merge argument line in the wiki' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $epsilon) -and ($records[0].Args -ceq $mergeArgs))
    Test-Check 'where the stub resolves the page and commits, the merge commit has two parents, MERGE_HEAD is gone, the merge step reads ran, the pull reads merged by model with the restore point the pre-merge HEAD, and the pass pushes it' (($parents.Count -eq 3) -and $mergeHeadGone -and ((Get-Step $status 'epsilon' 'pull') -ceq "ran: merged by model, restore point $epsilonHeadBefore") -and ($parents[1] -ceq $epsilonHeadBefore) -and ((Get-Step $status 'epsilon' 'push') -ceq 'ran') -and ($localHead -ceq $remoteHead) -and (@(Get-Deferred $status).Count -eq 0) -and ((Get-Step $status 'epsilon' 'merge') -ceq 'ran'))

    $null = Invoke-Git $other @('pull', '-q', 'origin', 'main')
    [System.IO.File]::WriteAllText((Join-Path $other 'wiki\page.md'), "remote line one and local line one`nremote line two`n")
    $null = Invoke-Git $other @('commit', '-q', '-a', '-m', 'Remote edit two')
    $null = Invoke-Git $other @('push', '-q', 'origin', 'main')
    $localText = "remote line one and local line one`nlocal line two`n"
    [System.IO.File]::WriteAllText((Join-Path $epsilon 'wiki\page.md'), $localText)
    $null = Invoke-Git $epsilon @('commit', '-q', '-a', '-m', 'Local edit two')
    $headBefore = (Invoke-Git $epsilon @('rev-parse', 'HEAD')).Trim()

    # The same conflict met first at the model-run floor. epsilon's local
    # commit is unpushed, so a push over the diverged tree would fail. The
    # floor of 99999 sits over the whole 6900-second budget, while the
    # 60-second child floor and the 120-second floor for starting a wiki sit
    # far under what is left, so only the merge run's model-run floor can
    # refuse; the fetched origin/main moving to the remote's head shows the
    # pull got past its fetch to the merge. The refusal reaches no verdict,
    # so the merge is aborted, the visit ends with no later step, and the
    # count, the last run time and the deferral stay absent.
    $epsilonFetchedBefore = (Invoke-Git $epsilon @('rev-parse', 'refs/remotes/origin/main')).Trim()
    Clear-Stub
    $r = Invoke-Walker @{ 'KB_WALK_MODEL_FLOOR_SECONDS' = '99999' }
    $status = Read-Status
    $state = Read-State
    $epsilonStatus = Get-WikiStatus $status 'epsilon'
    $epsilonFetched = (Invoke-Git $epsilon @('rev-parse', 'refs/remotes/origin/main')).Trim()
    $mergeHeadGone = (Invoke-Captured 'git' @('-C', $epsilon, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).ExitCode -ne 0
    Test-Check 'a conflicting pull whose merge run the model-run floor refuses after the fetch reads skipped: budget with no stub call and no merge step, aborts the merge with HEAD as before, records no feed, ingest, lint or push, lists no deferral or failure, keeps the result visited, and leaves the state with no conflictPasses or lastMergeRunAt' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'epsilon' 'pull') -ceq 'skipped: budget') -and ($epsilonFetched -cne $epsilonFetchedBefore) -and ($epsilonFetched -ceq (Invoke-Git $bare @('rev-parse', 'main')).Trim()) -and $mergeHeadGone -and ((Invoke-Git $epsilon @('rev-parse', 'HEAD')).Trim() -ceq $headBefore) -and (-not $epsilonStatus['steps'].ContainsKey('feed')) -and (-not $epsilonStatus['steps'].ContainsKey('ingest')) -and (-not $epsilonStatus['steps'].ContainsKey('lint')) -and (-not $epsilonStatus['steps'].ContainsKey('push')) -and (@(@($status['deferred']) | Where-Object { $_['name'] -ceq 'epsilon' }).Count -eq 0) -and (@($status['failures']).Count -eq 0) -and ($epsilonStatus['result'] -ceq 'visited') -and (-not $state['wikis']['epsilon'].ContainsKey('conflictPasses')) -and (-not $state['wikis']['epsilon'].ContainsKey('lastMergeRunAt')) -and ((Get-Step $status 'epsilon' 'merge') -ceq ''))

    Clear-Stub
    $r = Invoke-Walker
    $records = @(Get-StubRecords)
    $status = Read-Status
    $mergeHeadGone = (Invoke-Captured 'git' @('-C', $epsilon, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).ExitCode -ne 0
    $pageText = [System.IO.File]::ReadAllText((Join-Path $epsilon 'wiki\page.md'))
    $epsilonStatus = Get-WikiStatus $status 'epsilon'
    $deferredEntry = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'epsilon' })
    $deferredPaths = @(if ($deferredEntry.Count -eq 1) { @($deferredEntry[0]['paths']) } else { @() })
    Test-Check 'where the stub leaves the markers, the merge is aborted: MERGE_HEAD is gone, HEAD and the page are as before, and the stub ran once with Merge' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Args -ceq $mergeArgs) -and $mergeHeadGone -and ((Invoke-Git $epsilon @('rev-parse', 'HEAD')).Trim() -ceq $headBefore) -and ($pageText -ceq $localText))
    Test-Check 'the status lists the wiki under deferred with reason conflict, the path wiki/page.md, passes 1 and stuck false, its result deferred, the merge step ran, and no later step recorded' (($deferredEntry.Count -eq 1) -and ($deferredEntry[0]['reason'] -ceq 'conflict') -and ($deferredPaths.Count -eq 1) -and ($deferredPaths[0] -ceq 'wiki/page.md') -and ($deferredEntry[0]['passes'] -eq 1) -and ($deferredEntry[0]['stuck'] -eq $false) -and ($epsilonStatus['result'] -ceq 'deferred') -and ((Get-Step $status 'epsilon' 'pull') -ceq 'deferred: conflict') -and (-not $epsilonStatus['steps'].ContainsKey('ingest')) -and (-not $epsilonStatus['steps'].ContainsKey('push')) -and ((Get-Step $status 'epsilon' 'merge') -ceq 'ran'))
    Test-Check 'the wiki deferred on a conflict for one pass appends no notice, and the notices file holds no record naming it' (@(Get-Notices 'epsilon').Count -eq 0)
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $deferredEntry = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'epsilon' })
    Test-Check 'a second pass attempts the merge again and lists the wiki under deferred again, with passes 2' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 1) -and (@(Get-Deferred $status) -ccontains 'epsilon: conflict') -and ($deferredEntry.Count -eq 1) -and ($deferredEntry[0]['passes'] -eq 2))

    # A third pass whose stub joins the page lands the merge: the count and
    # the last run's time leave the wiki's state entry with the deferral.
    [System.IO.File]::WriteAllText($resolvedFile, "remote line one and local line one`nremote line two and local line two`n")
    $epsilonHeadBefore = (Invoke-Git $epsilon @('rev-parse', 'HEAD')).Trim()
    Clear-Stub
    $r = Invoke-Walker @{ 'KBWALK_STUB_MODE' = 'resolve' }
    $status = Read-Status
    $state = Read-State
    $parents = @((Invoke-Git $epsilon @('rev-list', '--parents', '-n', '1', 'HEAD')).Trim() -split ' ')
    Test-Check 'a third pass whose stub joins the page lands the merge with the restore point the pre-merge HEAD, lists nothing under deferred, pushes, and drops the count and the last run time from the state' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 1) -and ((Get-Step $status 'epsilon' 'pull') -ceq "ran: merged by model, restore point $epsilonHeadBefore") -and ($parents[1] -ceq $epsilonHeadBefore) -and ((Get-Step $status 'epsilon' 'push') -ceq 'ran') -and (@(Get-Deferred $status).Count -eq 0) -and (-not $state['wikis']['epsilon'].ContainsKey('conflictPasses')) -and (-not $state['wikis']['epsilon'].ContainsKey('lastMergeRunAt')) -and (-not $state['wikis']['epsilon'].ContainsKey('deferred')))

    # A conflict on the settings file is a person's: both sides change
    # .claude/settings.json, and the pass defers without a stub call. The
    # shared base commit carries a trailing line the engine's file lacks, the
    # other side puts the engine's exact bytes back, and lambda's own HEAD
    # changes that line another way: the fetched blob is the installed
    # engine's, so the engine-change stop passes the pull to the merge, and
    # the merge conflicts on the settings file.
    $lambdaBare = Join-Path $remotesDir 'lambda.git'
    $null = Invoke-Git $remotesDir @('init', '-q', '--bare', '-b', 'main', $lambdaBare)
    $lambda = New-Wiki 'lambda'
    $settingsText = [System.IO.File]::ReadAllText((Join-Path $lambda '.claude\settings.json'))
    [System.IO.File]::WriteAllText((Join-Path $lambda '.claude\settings.json'), ($settingsText + "// base side`n"))
    $null = Invoke-Git $lambda @('commit', '-q', '-a', '-m', 'Base settings')
    $null = Invoke-Git $lambda @('remote', 'add', 'origin', $lambdaBare)
    $null = Invoke-Git $lambda @('push', '-q', '-u', 'origin', 'main')
    $lambdaOther = Join-Path $remotesDir 'lambda-other'
    $null = Invoke-Git $remotesDir @('clone', '-q', $lambdaBare, $lambdaOther)
    $null = Invoke-Git $lambdaOther @('config', 'user.name', 'other side')
    $null = Invoke-Git $lambdaOther @('config', 'user.email', 'other@test.invalid')
    Copy-Item -LiteralPath (Join-Path $templateDir '.claude\settings.json') -Destination (Join-Path $lambdaOther '.claude\settings.json') -Force
    $null = Invoke-Git $lambdaOther @('commit', '-q', '-a', '-m', 'Remote settings')
    $null = Invoke-Git $lambdaOther @('push', '-q', 'origin', 'main')
    [System.IO.File]::WriteAllText((Join-Path $lambda '.claude\settings.json'), ($settingsText + "// local side`n"))
    $null = Invoke-Git $lambda @('commit', '-q', '-a', '-m', 'Local settings')
    $lambdaHeadBefore = (Invoke-Git $lambda @('rev-parse', 'HEAD')).Trim()
    Set-List @('lambda')
    Set-State -LastLintAt @{ lambda = $yesterday }
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $lambdaMergeHeadGone = (Invoke-Captured 'git' @('-C', $lambda, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).ExitCode -ne 0
    $lambdaDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'lambda' })
    $lambdaPaths = @(if ($lambdaDeferred.Count -eq 1) { @($lambdaDeferred[0]['paths']) } else { @() })
    Test-Check 'a conflict on .claude/settings.json makes no stub call and records no merge step, and the pass defers the wiki with that path, stuck true on its first pass with passes 1, MERGE_HEAD gone and HEAD as before' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 0) -and ($lambdaDeferred.Count -eq 1) -and ($lambdaDeferred[0]['reason'] -ceq 'conflict') -and ($lambdaPaths -ccontains '.claude/settings.json') -and ($lambdaDeferred[0]['passes'] -eq 1) -and ($lambdaDeferred[0]['stuck'] -eq $true) -and ((Get-Step $status 'lambda' 'pull') -ceq 'deferred: conflict') -and $lambdaMergeHeadGone -and ((Invoke-Git $lambda @('rev-parse', 'HEAD')).Trim() -ceq $lambdaHeadBefore) -and ((Get-Step $status 'lambda' 'merge') -ceq ''))
    $lambdaNotices = @(Get-Notices 'lambda')
    $lambdaStuckText = 'lambda is stuck: its pull from origin conflicts on .claude/settings.json, which no headless run may attempt; a session or a person must resolve the conflict in the wiki, and the walker resumes once a pull lands.'
    Test-Check 'the settings-file conflict appends one stuck record on its first pass, source wiki-walk, its text naming .claude/settings.json and carrying no pass count' (($lambdaNotices.Count -eq 1) -and ([string]$lambdaNotices[0]['id']).StartsWith('lambda:stuck:', [StringComparison]::Ordinal) -and ($lambdaNotices[0]['source'] -ceq 'wiki-walk') -and ($lambdaNotices[0]['text'] -ceq $lambdaStuckText) -and (-not ([string]$lambdaNotices[0]['text']).Contains('passes')))
    Test-Check 'the settings-file stuck record carries a paths field holding exactly .claude/settings.json' (($lambdaNotices.Count -eq 1) -and (Test-NoticePaths $lambdaNotices[0] @('.claude/settings.json')))

    # The guard-rail stop. episemon's origin gains commits a second clone pushes,
    # each a clean fast-forward for episemon. A page change lands. A change to
    # .claude/feed.json alone, a file the engine does not ship, stops the pull
    # before any merge: HEAD stays, no stub runs, and the wiki is deferred
    # with reason engine change, that path and stuck true, with no pass
    # count. Bringing episemon's HEAD to the fetched commit by hand clears it on
    # the next pass, which reads up to date and appends the cleared record.
    # A change to CLAUDE.md alone then stops the same way.
    $episemonBare = Join-Path $remotesDir 'episemon.git'
    $null = Invoke-Git $remotesDir @('init', '-q', '--bare', '-b', 'main', $episemonBare)
    $episemon = New-Wiki 'episemon'
    $null = Invoke-Git $episemon @('remote', 'add', 'origin', $episemonBare)
    $null = Invoke-Git $episemon @('push', '-q', '-u', 'origin', 'main')
    $episemonOther = Join-Path $remotesDir 'episemon-other'
    $null = Invoke-Git $remotesDir @('clone', '-q', $episemonBare, $episemonOther)
    $null = Invoke-Git $episemonOther @('config', 'user.name', 'other side')
    $null = Invoke-Git $episemonOther @('config', 'user.email', 'other@test.invalid')
    [System.IO.File]::WriteAllText((Join-Path $episemonOther 'wiki\page.md'), "a page from the other clone`n")
    $null = Invoke-Git $episemonOther @('add', '--', 'wiki/page.md')
    $null = Invoke-Git $episemonOther @('commit', '-q', '-m', 'Remote page')
    $null = Invoke-Git $episemonOther @('push', '-q', 'origin', 'main')
    Set-List @('episemon')
    Set-State -LastLintAt @{ episemon = $yesterday }
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $episemonRemoteHead = (Invoke-Git $episemonBare @('rev-parse', 'main')).Trim()
    Test-Check 'a fetched commit changing wiki/page.md alone is fast-forwarded with no stub call and nothing deferred' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 0) -and ((Invoke-Git $episemon @('rev-parse', 'HEAD')).Trim() -ceq $episemonRemoteHead) -and ((Get-Step $status 'episemon' 'pull') -ceq 'ran: fast-forward') -and (@(Get-Deferred $status).Count -eq 0))

    [System.IO.File]::WriteAllText((Join-Path $episemonOther '.claude\feed.json'), "{ `"sources`": [] }`n")
    $null = Invoke-Git $episemonOther @('add', '--', '.claude/feed.json')
    $null = Invoke-Git $episemonOther @('commit', '-q', '-m', 'Remote feed')
    $null = Invoke-Git $episemonOther @('push', '-q', 'origin', 'main')
    $episemonHeadBefore = (Invoke-Git $episemon @('rev-parse', 'HEAD')).Trim()
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $episemonStatus = Get-WikiStatus $status 'episemon'
    $episemonDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'episemon' })
    $episemonPaths = @(if ($episemonDeferred.Count -eq 1 -and $episemonDeferred[0].ContainsKey('paths')) { @($episemonDeferred[0]['paths']) } else { @() })
    $episemonNotices = @(Get-Notices 'episemon')
    Test-Check 'a fetched commit changing .claude/feed.json alone, a file the engine does not ship, lands no merge: HEAD as before and no feed.json in the tree, no stub call, the pull deferred: engine change, the wiki listed with that reason, that one path, stuck true and no pass count, its result deferred with no later step, and one stuck record whose text names the wiki and 1 path but not the path, which its paths field holds' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ((Invoke-Git $episemon @('rev-parse', 'HEAD')).Trim() -ceq $episemonHeadBefore) -and (-not (Test-Path -LiteralPath (Join-Path $episemon '.claude\feed.json'))) -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'episemon' 'pull') -ceq 'deferred: engine change') -and ($episemonDeferred.Count -eq 1) -and ($episemonDeferred[0]['reason'] -ceq 'engine change') -and ($episemonPaths.Count -eq 1) -and ($episemonPaths[0] -ceq '.claude/feed.json') -and ($episemonDeferred[0]['stuck'] -eq $true) -and (-not $episemonDeferred[0].ContainsKey('passes')) -and ($episemonStatus['result'] -ceq 'deferred') -and (-not $episemonStatus['steps'].ContainsKey('feed')) -and (-not $episemonStatus['steps'].ContainsKey('push')) -and ($episemonNotices.Count -eq 1) -and ([string]$episemonNotices[0]['id']).StartsWith('episemon:stuck:', [StringComparison]::Ordinal) -and ([string]$episemonNotices[0]['text']).StartsWith('episemon is stuck: ', [StringComparison]::Ordinal) -and ([string]$episemonNotices[0]['text']).Contains('1 path') -and (-not ([string]$episemonNotices[0]['text']).Contains('feed.json')) -and (Test-NoticePaths $episemonNotices[0] @('.claude/feed.json')))

    # A session or a person brings HEAD to the fetched commit: the next pass
    # has nothing to bring, reads up to date, and the notice clears.
    $null = Invoke-Git $episemon @('merge', '-q', '--ff-only', 'origin/main')
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $state = Read-State
    $episemonNotices = @(Get-Notices 'episemon')
    Test-Check 'a stopped wiki whose HEAD is brought by hand to the fetched commit reads pull ran: up to date on the next pass, lists nothing deferred, appends one cleared record with no paths field, and its state holds neither noticedStuck nor lastNoticeAt' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ((Get-Step $status 'episemon' 'pull') -ceq 'ran: up to date') -and (@(Get-Deferred $status).Count -eq 0) -and ($episemonNotices.Count -eq 2) -and ([string]$episemonNotices[1]['id']).StartsWith('episemon:cleared:', [StringComparison]::Ordinal) -and (-not $episemonNotices[1].ContainsKey('paths')) -and (-not $state['wikis']['episemon'].ContainsKey('noticedStuck')) -and (-not $state['wikis']['episemon'].ContainsKey('lastNoticeAt')) -and (-not $state['wikis']['episemon'].ContainsKey('deferred')))

    $episemonClaudeText = [System.IO.File]::ReadAllText((Join-Path $episemonOther 'CLAUDE.md'))
    [System.IO.File]::WriteAllText((Join-Path $episemonOther 'CLAUDE.md'), ($episemonClaudeText + "`nA line from the other clone.`n"))
    $null = Invoke-Git $episemonOther @('commit', '-q', '-a', '-m', 'Remote CLAUDE.md')
    $null = Invoke-Git $episemonOther @('push', '-q', 'origin', 'main')
    $episemonHeadBefore = (Invoke-Git $episemon @('rev-parse', 'HEAD')).Trim()
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $episemonStatus = Get-WikiStatus $status 'episemon'
    $episemonDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'episemon' })
    $episemonPaths = @(if ($episemonDeferred.Count -eq 1 -and $episemonDeferred[0].ContainsKey('paths')) { @($episemonDeferred[0]['paths']) } else { @() })
    $episemonNotices = @(Get-Notices 'episemon')
    Test-Check 'a fetched commit changing CLAUDE.md alone stops the same way: HEAD as before, no stub call, the pull deferred: engine change with the path CLAUDE.md and stuck true, no later step, and a new stuck record carrying that path' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ((Invoke-Git $episemon @('rev-parse', 'HEAD')).Trim() -ceq $episemonHeadBefore) -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'episemon' 'pull') -ceq 'deferred: engine change') -and ($episemonDeferred.Count -eq 1) -and ($episemonDeferred[0]['reason'] -ceq 'engine change') -and ($episemonPaths.Count -eq 1) -and ($episemonPaths[0] -ceq 'CLAUDE.md') -and ($episemonDeferred[0]['stuck'] -eq $true) -and ($episemonStatus['result'] -ceq 'deferred') -and (-not $episemonStatus['steps'].ContainsKey('push')) -and ($episemonNotices.Count -eq 3) -and ([string]$episemonNotices[2]['id']).StartsWith('episemon:stuck:', [StringComparison]::Ordinal) -and (Test-NoticePaths $episemonNotices[2] @('CLAUDE.md')))

    # A shipped engine file whose fetched bytes differ from the installed
    # engine's stops on the blob compare: HEAD is brought to the fetched
    # commit by hand for a clean base, and the other clone appends a line to
    # .claude/settings.json, a file the engine ships, so the fetched blob
    # exists and its id differs from the installed file's.
    $null = Invoke-Git $episemon @('merge', '-q', '--ff-only', 'origin/main')
    $episemonSettingsText = [System.IO.File]::ReadAllText((Join-Path $episemonOther '.claude\settings.json'))
    [System.IO.File]::WriteAllText((Join-Path $episemonOther '.claude\settings.json'), ($episemonSettingsText + "// a line from the other clone`n"))
    $null = Invoke-Git $episemonOther @('commit', '-q', '-a', '-m', 'Remote settings')
    $null = Invoke-Git $episemonOther @('push', '-q', 'origin', 'main')
    $episemonHeadBefore = (Invoke-Git $episemon @('rev-parse', 'HEAD')).Trim()
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $episemonDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'episemon' })
    $episemonPaths = @(if ($episemonDeferred.Count -eq 1 -and $episemonDeferred[0].ContainsKey('paths')) { @($episemonDeferred[0]['paths']) } else { @() })
    Test-Check 'a fetched commit changing .claude/settings.json, a file the engine ships, to bytes other than the installed engine''s stops on the differing blob: HEAD as before, no stub call, the pull deferred: engine change with that one path and stuck true' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ((Invoke-Git $episemon @('rev-parse', 'HEAD')).Trim() -ceq $episemonHeadBefore) -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'episemon' 'pull') -ceq 'deferred: engine change') -and ($episemonDeferred.Count -eq 1) -and ($episemonDeferred[0]['reason'] -ceq 'engine change') -and ($episemonPaths.Count -eq 1) -and ($episemonPaths[0] -ceq '.claude/settings.json') -and ($episemonDeferred[0]['stuck'] -eq $true))

    # A guard rail renamed to an ordinary name with no content change still
    # stops on the path it leaves: from a clean base again, the other clone
    # moves CLAUDE.md to wiki/notes.md, and the pull lists CLAUDE.md, which
    # is always a stop.
    $null = Invoke-Git $episemon @('merge', '-q', '--ff-only', 'origin/main')
    $null = Invoke-Git $episemonOther @('mv', 'CLAUDE.md', 'wiki/notes.md')
    $null = Invoke-Git $episemonOther @('commit', '-q', '-m', 'Remote rename')
    $null = Invoke-Git $episemonOther @('push', '-q', 'origin', 'main')
    $episemonHeadBefore = (Invoke-Git $episemon @('rev-parse', 'HEAD')).Trim()
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $episemonDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'episemon' })
    $episemonPaths = @(if ($episemonDeferred.Count -eq 1 -and $episemonDeferred[0].ContainsKey('paths')) { @($episemonDeferred[0]['paths']) } else { @() })
    Test-Check 'a fetched commit renaming CLAUDE.md to wiki/notes.md with no content change stops on the path it leaves: HEAD as before with CLAUDE.md still in the tree, no stub call, the pull deferred: engine change with the path CLAUDE.md alone and stuck true' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ((Invoke-Git $episemon @('rev-parse', 'HEAD')).Trim() -ceq $episemonHeadBefore) -and (Test-Path -LiteralPath (Join-Path $episemon 'CLAUDE.md')) -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'episemon' 'pull') -ceq 'deferred: engine change') -and ($episemonDeferred.Count -eq 1) -and ($episemonDeferred[0]['reason'] -ceq 'engine change') -and ($episemonPaths.Count -eq 1) -and ($episemonPaths[0] -ceq 'CLAUDE.md') -and ($episemonDeferred[0]['stuck'] -eq $true))

    # A CLAUDE.md below the root is loaded too, so it stops on its last
    # segment: from a clean base again, the other clone adds wiki/CLAUDE.md,
    # and the pull lists that path alone.
    $null = Invoke-Git $episemon @('merge', '-q', '--ff-only', 'origin/main')
    [System.IO.File]::WriteAllText((Join-Path $episemonOther 'wiki\CLAUDE.md'), "A nested line from the other clone.`n")
    $null = Invoke-Git $episemonOther @('add', '--', 'wiki/CLAUDE.md')
    $null = Invoke-Git $episemonOther @('commit', '-q', '-m', 'Remote nested CLAUDE.md')
    $null = Invoke-Git $episemonOther @('push', '-q', 'origin', 'main')
    $episemonHeadBefore = (Invoke-Git $episemon @('rev-parse', 'HEAD')).Trim()
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $episemonDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'episemon' })
    $episemonPaths = @(if ($episemonDeferred.Count -eq 1 -and $episemonDeferred[0].ContainsKey('paths')) { @($episemonDeferred[0]['paths']) } else { @() })
    Test-Check 'a fetched commit adding wiki/CLAUDE.md stops on its last segment: HEAD as before with no wiki/CLAUDE.md in the tree, no stub call, the pull deferred: engine change with the path wiki/CLAUDE.md alone and stuck true' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ((Invoke-Git $episemon @('rev-parse', 'HEAD')).Trim() -ceq $episemonHeadBefore) -and (-not (Test-Path -LiteralPath (Join-Path $episemon 'wiki\CLAUDE.md'))) -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'episemon' 'pull') -ceq 'deferred: engine change') -and ($episemonDeferred.Count -eq 1) -and ($episemonDeferred[0]['reason'] -ceq 'engine change') -and ($episemonPaths.Count -eq 1) -and ($episemonPaths[0] -ceq 'wiki/CLAUDE.md') -and ($episemonDeferred[0]['stuck'] -eq $true))

    # A .claude folder below the root is where Claude Code loads skills from,
    # so a path with that segment stops on the segment alone: from a clean
    # base again, the other clone first adds wiki/.claude-notes/page.md, a
    # folder whose name only begins with .claude, and the pull lands it as a
    # fast-forward; then it adds wiki/.claude/skills/x/SKILL.md, and the pull
    # lists that path alone and refuses it. Neither path holds a CLAUDE.md or
    # CLAUDE.local.md leaf, a CLAUDE~ short name or the root .claude/ folder,
    # so no other rule reads either.
    $null = Invoke-Git $episemon @('merge', '-q', '--ff-only', 'origin/main')
    New-Item -ItemType Directory -Path (Join-Path $episemonOther 'wiki\.claude-notes') -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $episemonOther 'wiki\.claude-notes\page.md'), "A page under a near-miss folder from the other clone.`n")
    $null = Invoke-Git $episemonOther @('add', '--', 'wiki/.claude-notes/page.md')
    $null = Invoke-Git $episemonOther @('commit', '-q', '-m', 'Remote near-miss folder')
    $null = Invoke-Git $episemonOther @('push', '-q', 'origin', 'main')
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $episemonRemoteHead = (Invoke-Git $episemonBare @('rev-parse', 'main')).Trim()
    Test-Check 'a fetched commit adding wiki/.claude-notes/page.md, under a folder whose name only begins with .claude, is fast-forwarded with no stub call and nothing deferred' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 0) -and ((Invoke-Git $episemon @('rev-parse', 'HEAD')).Trim() -ceq $episemonRemoteHead) -and ((Get-Step $status 'episemon' 'pull') -ceq 'ran: fast-forward') -and (@(Get-Deferred $status).Count -eq 0))

    New-Item -ItemType Directory -Path (Join-Path $episemonOther 'wiki\.claude\skills\x') -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $episemonOther 'wiki\.claude\skills\x\SKILL.md'), "A skill from the other clone.`n")
    $null = Invoke-Git $episemonOther @('add', '--', 'wiki/.claude/skills/x/SKILL.md')
    $null = Invoke-Git $episemonOther @('commit', '-q', '-m', 'Remote nested skill folder')
    $null = Invoke-Git $episemonOther @('push', '-q', 'origin', 'main')
    $episemonHeadBefore = (Invoke-Git $episemon @('rev-parse', 'HEAD')).Trim()
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $episemonDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'episemon' })
    $episemonPaths = @(if ($episemonDeferred.Count -eq 1 -and $episemonDeferred[0].ContainsKey('paths')) { @($episemonDeferred[0]['paths']) } else { @() })
    Test-Check 'a fetched commit adding wiki/.claude/skills/x/SKILL.md stops on its nested .claude segment: HEAD as before with no wiki/.claude in the tree, no stub call, the pull deferred: engine change with that path alone and stuck true' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ((Invoke-Git $episemon @('rev-parse', 'HEAD')).Trim() -ceq $episemonHeadBefore) -and (-not (Test-Path -LiteralPath (Join-Path $episemon 'wiki\.claude'))) -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'episemon' 'pull') -ceq 'deferred: engine change') -and ($episemonDeferred.Count -eq 1) -and ($episemonDeferred[0]['reason'] -ceq 'engine change') -and ($episemonPaths.Count -eq 1) -and ($episemonPaths[0] -ceq 'wiki/.claude/skills/x/SKILL.md') -and ($episemonDeferred[0]['stuck'] -eq $true))

    # A history with two merge bases is read against each base. The control
    # rolls wiki/page.md back: the fetched commit changes it against one base
    # and holds it against the other, no path is a guard rail, and the merge
    # lands with the page at its base text, which is what the rollback does.
    # The wiki's merge commit is then pushed, so the next history starts from
    # a base every side holds.
    $null = Invoke-Git $episemon @('merge', '-q', '--ff-only', 'origin/main')
    $episemonControl = New-TwoBaseHistory $episemon $episemonOther 'side-page' 'wiki/page.md' 'wiki/other.md'
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    Test-Check 'a fetched commit on a history with two merge bases, rolling wiki/page.md back against one base and holding it against the other, is merged with no stub call and nothing deferred, the pull naming the restore point and the page reading its base text after the merge' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'episemon' 'pull') -ceq "ran: merged, restore point $($episemonControl.D)") -and (@(Get-Deferred $status).Count -eq 0) -and ((Invoke-Git $episemon @('rev-parse', 'HEAD')).Trim() -cne $episemonControl.D) -and ([System.IO.File]::ReadAllText((Join-Path $episemon 'wiki\page.md')) -ceq $episemonControl.BaseText))
    $null = Invoke-Git $episemon @('push', '-q', 'origin', 'HEAD:main')

    # The same shape with wiki/CLAUDE.md rolled back stops on that path, which
    # only the diff against the base that changed it lists: HEAD stays at D
    # with the guarded line still in the tree, and the pull lists
    # wiki/CLAUDE.md alone among the stops, wiki/page.md being the side's
    # ordinary change. The root CLAUDE.md left origin with the rename above,
    # so the guard rail rolled back is the one the nested check added.
    $episemonTwoBase = New-TwoBaseHistory $episemon $episemonOther 'side-guard' 'wiki/CLAUDE.md' 'wiki/page.md'
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $episemonDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'episemon' })
    $episemonPaths = @(if ($episemonDeferred.Count -eq 1 -and $episemonDeferred[0].ContainsKey('paths')) { @($episemonDeferred[0]['paths']) } else { @() })
    Test-Check 'a fetched commit on a history with two merge bases, rolling wiki/CLAUDE.md back against one base and holding it against the other, stops on wiki/CLAUDE.md: HEAD as before with the guarded line still in wiki/CLAUDE.md, no stub call, the pull deferred: engine change with the path wiki/CLAUDE.md alone and stuck true' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ((Invoke-Git $episemon @('rev-parse', 'HEAD')).Trim() -ceq $episemonTwoBase.D) -and ([System.IO.File]::ReadAllText((Join-Path $episemon 'wiki\CLAUDE.md')) -cne $episemonTwoBase.BaseText) -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'episemon' 'pull') -ceq 'deferred: engine change') -and ($episemonDeferred.Count -eq 1) -and ($episemonDeferred[0]['reason'] -ceq 'engine change') -and ($episemonPaths.Count -eq 1) -and ($episemonPaths[0] -ceq 'wiki/CLAUDE.md') -and ($episemonDeferred[0]['stuck'] -eq $true))

    # The stuck rule. phi's origin and local history disagree on a page and
    # the stub never joins it, so each pass defers it with the count one
    # higher. After three such passes the wiki is stuck: the fourth pass, less
    # than a day after the third's run, fetches and merges but starts no stub,
    # and the log names when the run is held until. With the last run's time
    # moved 25 hours back, the fifth pass starts the stub again.
    $phiBare = Join-Path $remotesDir 'phi.git'
    $null = Invoke-Git $remotesDir @('init', '-q', '--bare', '-b', 'main', $phiBare)
    $phi = New-Wiki 'phi'
    $phiPage = Join-Path $phi 'wiki\page.md'
    [System.IO.File]::WriteAllText($phiPage, "base line`n")
    $null = Invoke-Git $phi @('add', '-A')
    $null = Invoke-Git $phi @('commit', '-q', '-m', 'Add page')
    $null = Invoke-Git $phi @('remote', 'add', 'origin', $phiBare)
    $null = Invoke-Git $phi @('push', '-q', '-u', 'origin', 'main')
    $phiOther = Join-Path $remotesDir 'phi-other'
    $null = Invoke-Git $remotesDir @('clone', '-q', $phiBare, $phiOther)
    $null = Invoke-Git $phiOther @('config', 'user.name', 'other side')
    $null = Invoke-Git $phiOther @('config', 'user.email', 'other@test.invalid')
    [System.IO.File]::WriteAllText((Join-Path $phiOther 'wiki\page.md'), "remote line`n")
    $null = Invoke-Git $phiOther @('commit', '-q', '-a', '-m', 'Remote edit')
    $null = Invoke-Git $phiOther @('push', '-q', 'origin', 'main')
    [System.IO.File]::WriteAllText($phiPage, "local line`n")
    $null = Invoke-Git $phi @('commit', '-q', '-a', '-m', 'Local edit')
    $phiHeadBefore = (Invoke-Git $phi @('rev-parse', 'HEAD')).Trim()
    Set-List @('phi')
    Set-State -LastLintAt @{ phi = $yesterday }
    $phiPassesOk = $true
    $phiNoticeCounts = @()
    foreach ($pass in 1..3) {
        Clear-Stub
        $r = Invoke-Walker
        $records = @(Get-StubRecords)
        $status = Read-Status
        $phiDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'phi' })
        $phiPassOk = (-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $phi) -and ($records[0].Args -ceq $mergeArgs) -and ((Get-Step $status 'phi' 'pull') -ceq 'deferred: conflict') -and ($phiDeferred.Count -eq 1) -and ($phiDeferred[0]['passes'] -eq $pass) -and ($phiDeferred[0]['stuck'] -eq ($pass -ge 3))
        if (-not $phiPassOk) { Write-Host "phi pass $pass off its expected shape" }
        $phiNoticeCounts += @(Get-Notices 'phi').Count
        $phiPassesOk = $phiPassesOk -and $phiPassOk
    }
    Test-Check 'a wiki whose conflict the stub never joins is deferred on three passes in a row, each calling the stub once with Merge, with passes 1, 2 and 3 and stuck true only on the third' $phiPassesOk
    $phiNotices = @(Get-Notices 'phi')
    $phiStuckText = 'phi is stuck: its pull from origin has conflicted on 1 path for 3 passes in a row and the model merge did not join them; the walker fetches every hour and retries the merge once a day; a session must resolve the conflict in the wiki.'
    $phiFinishedAt = Get-StampText $status['finishedAt']
    Test-Check 'the first and second passes of the conflict append no notice, and the third, which makes the wiki stuck, appends one stuck record with source wiki-walk, the id phi:stuck: and the pass''s finish time, and the text naming the wiki, 1 path, 3 passes and the daily retry' (($phiNoticeCounts.Count -eq 3) -and ($phiNoticeCounts[0] -eq 0) -and ($phiNoticeCounts[1] -eq 0) -and ($phiNoticeCounts[2] -eq 1) -and ($phiNotices.Count -eq 1) -and ($phiNotices[0]['id'] -ceq "phi:stuck:$phiFinishedAt") -and ($phiNotices[0]['source'] -ceq 'wiki-walk') -and ($phiNotices[0]['text'] -ceq $phiStuckText))
    Test-Check 'the stuck record carries a paths field holding exactly wiki/page.md, and its text does not name the path' (($phiNotices.Count -eq 1) -and (Test-NoticePaths $phiNotices[0] @('wiki/page.md')) -and (-not ([string]$phiNotices[0]['text']).Contains('wiki/page.md')))
    $state = Read-State
    Test-Check 'the state of the wiki made stuck holds noticedStuck true and a lastNoticeAt time' (($state['wikis']['phi']['noticedStuck'] -eq $true) -and ((Get-StampText $state['wikis']['phi']['lastNoticeAt']).Length -gt 0))
    $state = Read-State
    $phiLastRun = [DateTime]::MinValue
    $phiLastRunStamped = [DateTime]::TryParseExact((Get-StampText $state['wikis']['phi']['lastMergeRunAt']), 'o', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$phiLastRun)
    $phiHeldUntil = $phiLastRun.ToUniversalTime().AddHours(24).ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    # A commit origin gains while the wiki is stuck: only the fourth pass's
    # fetch can move the wiki's tracking ref to it.
    [System.IO.File]::WriteAllText((Join-Path $phiOther 'wiki\phi-upstream.md'), "landed while stuck`n")
    $null = Invoke-Git $phiOther @('add', '--', 'wiki/phi-upstream.md')
    $null = Invoke-Git $phiOther @('commit', '-q', '-m', 'Upstream page while stuck')
    $null = Invoke-Git $phiOther @('push', '-q', 'origin', 'main')
    $phiRemoteHead = (Invoke-Git $phiBare @('rev-parse', 'main')).Trim()
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $phiDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'phi' })
    $phiPaths = @(if ($phiDeferred.Count -eq 1 -and $phiDeferred[0].ContainsKey('paths')) { @($phiDeferred[0]['paths']) } else { @() })
    $phiTracking = (Invoke-Git $phi @('rev-parse', 'refs/remotes/origin/main')).Trim()
    $phiMergeHeadGone = (Invoke-Captured 'git' @('-C', $phi, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).ExitCode -ne 0
    Test-Check 'the stuck wiki''s fourth pass inside the day fetches the commit origin gained meanwhile, starts no stub, records no merge step, lists it deferred with passes 4, stuck true and its path, HEAD as before and no merge left, and the log names the time its run is held until' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and $phiLastRunStamped -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'phi' 'pull') -ceq 'deferred: conflict') -and ($phiDeferred.Count -eq 1) -and ($phiDeferred[0]['passes'] -eq 4) -and ($phiDeferred[0]['stuck'] -eq $true) -and ($phiPaths.Count -eq 1) -and ($phiPaths[0] -ceq 'wiki/page.md') -and ($phiTracking -ceq $phiRemoteHead) -and $phiMergeHeadGone -and ((Invoke-Git $phi @('rev-parse', 'HEAD')).Trim() -ceq $phiHeadBefore) -and ([System.IO.File]::ReadAllText($walkLog).Contains("held until $phiHeldUntil")) -and ((Get-Step $status 'phi' 'merge') -ceq ''))
    Test-Check 'the stuck wiki''s fourth pass inside the day appends no notice' (@(Get-Notices 'phi').Count -eq 1)
    $state = Read-State
    $state['wikis']['phi']['lastMergeRunAt'] = [DateTime]::UtcNow.AddHours(-25).ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    $state['wikis']['phi']['lastNoticeAt'] = [DateTime]::UtcNow.AddHours(-25).ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    [System.IO.File]::WriteAllText($statePath, (ConvertTo-Json -InputObject $state -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
    Clear-Stub
    $r = Invoke-Walker
    $records = @(Get-StubRecords)
    $status = Read-Status
    $phiDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'phi' })
    Test-Check 'with the last run''s time 25 hours back, the stuck wiki''s fifth pass starts the stub with Merge again and lists it with passes 5' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $phi) -and ($records[0].Args -ceq $mergeArgs) -and ($phiDeferred.Count -eq 1) -and ($phiDeferred[0]['passes'] -eq 5) -and ($phiDeferred[0]['stuck'] -eq $true))
    $phiNotices = @(Get-Notices 'phi')
    $phiStillText = 'phi is still stuck after 5 passes: its pull from origin conflicts on 1 path; a session must resolve the conflict in the wiki.'
    Test-Check 'with the last notice 25 hours back, the stuck wiki''s fifth pass appends one still-stuck record naming 5 passes and 1 path, its paths field holding exactly wiki/page.md' (($phiNotices.Count -eq 2) -and ([string]$phiNotices[1]['id']).StartsWith('phi:still:', [StringComparison]::Ordinal) -and ($phiNotices[1]['text'] -ceq $phiStillText) -and (Test-NoticePaths $phiNotices[1] @('wiki/page.md')))

    # A pass whose stub joins the page clears the wiki: the walker lands the
    # merge and the notice says so with the restore point.
    $state = Read-State
    $state['wikis']['phi']['lastMergeRunAt'] = [DateTime]::UtcNow.AddHours(-25).ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    [System.IO.File]::WriteAllText($statePath, (ConvertTo-Json -InputObject $state -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
    [System.IO.File]::WriteAllText($resolvedFile, "remote line and local line`n")
    $phiJoinHeadBefore = (Invoke-Git $phi @('rev-parse', 'HEAD')).Trim()
    Clear-Stub
    $r = Invoke-Walker @{ 'KBWALK_STUB_MODE' = 'resolve' }
    $status = Read-Status
    $state = Read-State
    $phiNotices = @(Get-Notices 'phi')
    $phiClearedText = "phi is no longer stuck: its pull landed, merged by model, restore point $phiJoinHeadBefore."
    Test-Check 'a pass whose stub joins the page appends one cleared record whose text carries merged by model and the pre-merge HEAD as the restore point, and the state holds neither noticedStuck nor lastNoticeAt' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ((Get-Step $status 'phi' 'pull') -ceq "ran: merged by model, restore point $phiJoinHeadBefore") -and ($phiNotices.Count -eq 3) -and ([string]$phiNotices[2]['id']).StartsWith('phi:cleared:', [StringComparison]::Ordinal) -and ($phiNotices[2]['text'] -ceq $phiClearedText) -and (-not $state['wikis']['phi'].ContainsKey('noticedStuck')) -and (-not $state['wikis']['phi'].ContainsKey('lastNoticeAt')))
    Test-Check 'the cleared record carries no paths key' (($phiNotices.Count -eq 3) -and (-not $phiNotices[2].ContainsKey('paths')) -and (-not $phiNotices[2].ContainsKey('unparsable')))

    $allNotices = @(Get-Notices)
    $noticeIds = @($allNotices | ForEach-Object { [string]$_['id'] })
    $noticesWellFormed = ($allNotices.Count -ge 4) -and (@($noticeIds | Select-Object -Unique).Count -eq $noticeIds.Count)
    foreach ($notice in $allNotices) {
        $noticesWellFormed = $noticesWellFormed -and ($notice['id'] -is [string]) -and ($notice['id'] -ne '') -and ($notice['text'] -is [string]) -and ($notice['text'] -ne '') -and ($notice['source'] -ceq 'wiki-walk') -and (-not $notice.ContainsKey('unparsable'))
    }
    Test-Check 'every record in the notices file parses as JSON with a unique non-empty string id, a non-empty string text and the source wiki-walk' $noticesWellFormed

    # The notices file past 1 MB is renamed over any earlier rotated file before
    # the pass writes, and the pass's record lands in a new file. lambda is
    # still stuck on its settings file, with its last notice 25 hours back.
    $seedRecord = ConvertTo-Json -Compress -InputObject ([ordered]@{ id = 'seed:rotation:1'; text = ('x' * 1100000); source = 'wiki-walk'; at = $yesterday })
    [System.IO.File]::WriteAllText($noticesPath, ($seedRecord + "`n"), (New-Object System.Text.UTF8Encoding($false)))
    [System.IO.File]::WriteAllText("$noticesPath.1", "an earlier rotated file`n", (New-Object System.Text.UTF8Encoding($false)))
    $rotationState = [ordered]@{
        cursor = $null
        wikis  = [ordered]@{ lambda = [ordered]@{ lastLintAt = $yesterday; conflictPasses = 1; noticedStuck = $true; lastNoticeAt = [DateTime]::UtcNow.AddHours(-25).ToString('o', [System.Globalization.CultureInfo]::InvariantCulture) } }
    }
    Set-List @('lambda')
    [System.IO.File]::WriteAllText($statePath, (ConvertTo-Json -InputObject $rotationState -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
    Clear-Stub
    $r = Invoke-Walker
    $rotatedLength = if (Test-Path -LiteralPath "$noticesPath.1") { (Get-Item -LiteralPath "$noticesPath.1").Length } else { 0 }
    $rotatedHead = if (Test-Path -LiteralPath "$noticesPath.1") { [System.IO.File]::ReadAllText("$noticesPath.1").Substring(0, 30) } else { '' }
    $freshNotices = @(Get-Notices)
    Test-Check 'a notices file seeded past 1 MB is renamed to walk-notices.jsonl.1 over the earlier one before the pass writes, and the pass''s still-stuck record lands alone in a new walk-notices.jsonl' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($rotatedLength -gt 1MB) -and $rotatedHead.StartsWith('{"id":"seed:rotation:1"', [StringComparison]::Ordinal) -and ($freshNotices.Count -eq 1) -and ([string]$freshNotices[0]['id']).StartsWith('lambda:still:', [StringComparison]::Ordinal) -and ((Get-Item -LiteralPath $noticesPath).Length -lt 1MB))

    # A notices file the walker cannot open: the test holds it with no sharing
    # through a pass that makes lambda stuck on its settings file. The append
    # fails, so the state keeps lambda with no notice fields, and the next pass,
    # with the file free, writes the stuck line.
    $heldState = [ordered]@{
        cursor = $null
        wikis  = [ordered]@{ lambda = [ordered]@{ lastLintAt = $yesterday; conflictPasses = 1 } }
    }
    Set-List @('lambda')
    [System.IO.File]::WriteAllText($statePath, (ConvertTo-Json -InputObject $heldState -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
    $heldStuckBefore = @(Get-Notices 'lambda' | Where-Object { ([string]$_['id']).StartsWith('lambda:stuck:', [StringComparison]::Ordinal) }).Count
    Clear-Stub
    $heldFile = [System.IO.File]::Open($noticesPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    try {
        $r = Invoke-Walker
    } finally {
        $heldFile.Dispose()
    }
    $state = Read-State
    $heldStuckAfter = @(Get-Notices 'lambda' | Where-Object { ([string]$_['id']).StartsWith('lambda:stuck:', [StringComparison]::Ordinal) }).Count
    Test-Check 'a pass whose notice append fails logs it, writes no stuck record, and saves the stuck wiki''s state with neither noticedStuck nor lastNoticeAt' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($heldStuckAfter -eq $heldStuckBefore) -and ([System.IO.File]::ReadAllText($walkLog).Contains('the notices file could not be written')) -and (-not $state['wikis']['lambda'].ContainsKey('noticedStuck')) -and (-not $state['wikis']['lambda'].ContainsKey('lastNoticeAt')))
    Clear-Stub
    $r = Invoke-Walker
    $state = Read-State
    $heldStuckNext = @(Get-Notices 'lambda' | Where-Object { ([string]$_['id']).StartsWith('lambda:stuck:', [StringComparison]::Ordinal) })
    Test-Check 'the next pass, with the notices file free, appends the stuck record and saves noticedStuck true' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($heldStuckNext.Count -eq ($heldStuckBefore + 1)) -and ($heldStuckNext[-1]['text'] -ceq $lambdaStuckText) -and ($state['wikis']['lambda']['noticedStuck'] -eq $true))

    # A conflicted path a remote can steer: stigma's page name holds U+202E,
    # the right-to-left override. The pass that makes it stuck carries the path
    # in its paths field with a hyphen in that character's place, and the text
    # holds no U+202E.
    $override = [string][char]0x202E
    $stigmaBare = Join-Path $remotesDir 'stigma.git'
    $null = Invoke-Git $remotesDir @('init', '-q', '--bare', '-b', 'main', $stigmaBare)
    $stigma = New-Wiki 'stigma'
    $stigmaPage = Join-Path $stigma "wiki\a$($override)b.md"
    [System.IO.File]::WriteAllText($stigmaPage, "base line`n")
    $null = Invoke-Git $stigma @('add', '-A')
    $null = Invoke-Git $stigma @('commit', '-q', '-m', 'Add page')
    $null = Invoke-Git $stigma @('remote', 'add', 'origin', $stigmaBare)
    $null = Invoke-Git $stigma @('push', '-q', '-u', 'origin', 'main')
    $stigmaOther = Join-Path $remotesDir 'stigma-other'
    $null = Invoke-Git $remotesDir @('clone', '-q', $stigmaBare, $stigmaOther)
    $null = Invoke-Git $stigmaOther @('config', 'user.name', 'other side')
    $null = Invoke-Git $stigmaOther @('config', 'user.email', 'other@test.invalid')
    [System.IO.File]::WriteAllText((Join-Path $stigmaOther "wiki\a$($override)b.md"), "remote line`n")
    $null = Invoke-Git $stigmaOther @('commit', '-q', '-a', '-m', 'Remote edit')
    $null = Invoke-Git $stigmaOther @('push', '-q', 'origin', 'main')
    [System.IO.File]::WriteAllText($stigmaPage, "local line`n")
    $null = Invoke-Git $stigma @('commit', '-q', '-a', '-m', 'Local edit')
    $stigmaState = [ordered]@{
        cursor = $null
        wikis  = [ordered]@{ stigma = [ordered]@{ lastLintAt = $yesterday; conflictPasses = 2 } }
    }
    Set-List @('stigma')
    [System.IO.File]::WriteAllText($statePath, (ConvertTo-Json -InputObject $stigmaState -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
    Clear-Stub
    $r = Invoke-Walker
    $stigmaNotices = @(Get-Notices 'stigma')
    $stigmaStuckText = 'stigma is stuck: its pull from origin has conflicted on 1 path for 3 passes in a row and the model merge did not join them; the walker fetches every hour and retries the merge once a day; a session must resolve the conflict in the wiki.'
    Test-Check 'a stuck record for a conflicted path holding U+202E carries no U+202E in its text or its paths field, and the field shows the path with a hyphen in its place' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($stigmaNotices.Count -eq 1) -and ([string]$stigmaNotices[0]['id']).StartsWith('stigma:stuck:', [StringComparison]::Ordinal) -and (-not ([string]$stigmaNotices[0]['text']).Contains($override)) -and ($stigmaNotices[0]['text'] -ceq $stigmaStuckText) -and (Test-NoticePaths $stigmaNotices[0] @('wiki/a-b.md')))
    $stigmaLog = [System.IO.File]::ReadAllText($walkLog, [System.Text.Encoding]::UTF8)
    Test-Check 'the log names the conflicted path holding U+202E with a hyphen in its place' ((-not $stigmaLog.Contains($override)) -and $stigmaLog.Contains('wiki/a-b.md'))

    # A conflict on 12 pages: the stuck record's text counts all 12, and its
    # paths field holds the first 10 in git's order.
    $shoNames = @(1..12 | ForEach-Object { 'wiki/p{0:D2}.md' -f $_ })
    $shoBare = Join-Path $remotesDir 'sho.git'
    $null = Invoke-Git $remotesDir @('init', '-q', '--bare', '-b', 'main', $shoBare)
    $sho = New-Wiki 'sho'
    foreach ($name in $shoNames) { [System.IO.File]::WriteAllText((Join-Path $sho $name), "base line`n") }
    $null = Invoke-Git $sho @('add', '-A')
    $null = Invoke-Git $sho @('commit', '-q', '-m', 'Add pages')
    $null = Invoke-Git $sho @('remote', 'add', 'origin', $shoBare)
    $null = Invoke-Git $sho @('push', '-q', '-u', 'origin', 'main')
    $shoOther = Join-Path $remotesDir 'sho-other'
    $null = Invoke-Git $remotesDir @('clone', '-q', $shoBare, $shoOther)
    $null = Invoke-Git $shoOther @('config', 'user.name', 'other side')
    $null = Invoke-Git $shoOther @('config', 'user.email', 'other@test.invalid')
    foreach ($name in $shoNames) { [System.IO.File]::WriteAllText((Join-Path $shoOther $name), "remote line`n") }
    $null = Invoke-Git $shoOther @('commit', '-q', '-a', '-m', 'Remote edit')
    $null = Invoke-Git $shoOther @('push', '-q', 'origin', 'main')
    foreach ($name in $shoNames) { [System.IO.File]::WriteAllText((Join-Path $sho $name), "local line`n") }
    $null = Invoke-Git $sho @('commit', '-q', '-a', '-m', 'Local edit')
    $shoState = [ordered]@{
        cursor = $null
        wikis  = [ordered]@{ sho = [ordered]@{ lastLintAt = $yesterday; conflictPasses = 2 } }
    }
    Set-List @('sho')
    [System.IO.File]::WriteAllText($statePath, (ConvertTo-Json -InputObject $shoState -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
    Clear-Stub
    $r = Invoke-Walker
    $shoNotices = @(Get-Notices 'sho')
    $shoStuckText = 'sho is stuck: its pull from origin has conflicted on 12 paths for 3 passes in a row and the model merge did not join them; the walker fetches every hour and retries the merge once a day; a session must resolve the conflict in the wiki.'
    Test-Check 'a stuck record for a conflict on 12 paths counts 12 paths in its text and holds the first 10 in its paths field' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($shoNotices.Count -eq 1) -and ([string]$shoNotices[0]['id']).StartsWith('sho:stuck:', [StringComparison]::Ordinal) -and ($shoNotices[0]['text'] -ceq $shoStuckText) -and (Test-NoticePaths $shoNotices[0] $shoNames[0..9]))

    # A conflicting pull whose wiki's run lock is held: the wrapper prints its
    # lock line and does nothing. The walker reads that line from the captured
    # Merge output and names the lock in the log, relays it to its own stdout,
    # and still stamps the last run time, which a model's first line could forge.
    $hetaBare = Join-Path $remotesDir 'heta.git'
    $null = Invoke-Git $remotesDir @('init', '-q', '--bare', '-b', 'main', $hetaBare)
    $heta = New-Wiki 'heta'
    $hetaPage = Join-Path $heta 'wiki\page.md'
    [System.IO.File]::WriteAllText($hetaPage, "base line`n")
    $null = Invoke-Git $heta @('add', '-A')
    $null = Invoke-Git $heta @('commit', '-q', '-m', 'Add page')
    $null = Invoke-Git $heta @('remote', 'add', 'origin', $hetaBare)
    $null = Invoke-Git $heta @('push', '-q', '-u', 'origin', 'main')
    $hetaOther = Join-Path $remotesDir 'heta-other'
    $null = Invoke-Git $remotesDir @('clone', '-q', $hetaBare, $hetaOther)
    $null = Invoke-Git $hetaOther @('config', 'user.name', 'other side')
    $null = Invoke-Git $hetaOther @('config', 'user.email', 'other@test.invalid')
    [System.IO.File]::WriteAllText((Join-Path $hetaOther 'wiki\page.md'), "remote line`n")
    $null = Invoke-Git $hetaOther @('commit', '-q', '-a', '-m', 'Remote edit')
    $null = Invoke-Git $hetaOther @('push', '-q', 'origin', 'main')
    [System.IO.File]::WriteAllText($hetaPage, "local line`n")
    $null = Invoke-Git $heta @('commit', '-q', '-a', '-m', 'Local edit')
    $hetaHeadBefore = (Invoke-Git $heta @('rev-parse', 'HEAD')).Trim()
    Set-List @('heta')
    Set-State -LastLintAt @{ heta = $yesterday }
    Clear-Stub
    $hetaRunLock = [System.IO.File]::Open((Join-Path $heta '.git\kb-run.lock'), [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    try {
        $r = Invoke-Walker
    } finally {
        $hetaRunLock.Dispose()
    }
    $status = Read-Status
    $state = Read-State
    $hetaDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'heta' })
    $hetaMergeHeadGone = (Invoke-Captured 'git' @('-C', $heta, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).ExitCode -ne 0
    Test-Check 'a conflicting pull whose wiki''s run lock is held starts no stub, names the held lock in the log, relays the wrapper''s lock line to the walker''s stdout, stamps the last run time, reads merge ran: first output line reports the run lock held, and defers the wiki with passes 1, MERGE_HEAD gone and HEAD as before' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'heta' 'pull') -ceq 'deferred: conflict') -and ($hetaDeferred.Count -eq 1) -and ($hetaDeferred[0]['passes'] -eq 1) -and $state['wikis']['heta'].ContainsKey('lastMergeRunAt') -and ([System.IO.File]::ReadAllText($walkLog).Contains("heta merge run's first output line reports the wiki's run lock held")) -and ($r.Stdout.Contains('kb-run: another run holds the lock for ')) -and $hetaMergeHeadGone -and ((Invoke-Git $heta @('rev-parse', 'HEAD')).Trim() -ceq $hetaHeadBefore) -and ((Get-Step $status 'heta' 'merge') -ceq 'ran: first output line reports the run lock held'))

    # --- Bullet 4: the engine update with feed.json kept, a live tree, and a
    # wiki with no git identity. The fed upstream is a small repository the
    # feeder copies one page from, so the feed step runs for real.
    $upstream = Join-Path $remotesDir 'upstream'
    New-Item -ItemType Directory -Path (Join-Path $upstream 'docs') -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $upstream 'docs\note.md'), "an upstream note`n")
    $null = Invoke-Git $upstream @('init', '-q', '-b', 'main')
    $null = Invoke-Git $upstream @('add', '-A')
    $null = Invoke-Git $upstream @('-c', 'user.name=upstream', '-c', 'user.email=up@test.invalid', 'commit', '-q', '-m', 'Upstream note')
    $zeta = New-Wiki 'zeta' -EngineHash $staleHash
    $feedJson = "{ `"sources`": [ { `"name`": `"up`", `"url`": $(ConvertTo-Json $upstream), `"branch`": `"main`", `"include`": [`"docs/*.md`"] } ] }`n"
    [System.IO.File]::WriteAllText((Join-Path $zeta '.claude\feed.json'), $feedJson, (New-Object System.Text.UTF8Encoding($false)))
    $null = Invoke-Git $zeta @('add', '-A')
    $null = Invoke-Git $zeta @('commit', '-q', '-m', 'Add feed.json')
    $zetaHeadBefore = (Invoke-Git $zeta @('rev-parse', 'HEAD')).Trim()
    $eta = New-Wiki 'eta' -EngineHash $staleHash
    [System.IO.File]::WriteAllText((Join-Path $eta 'wiki\page.md'), "a page being written now`n")
    $etaHeadBefore = (Invoke-Git $eta @('rev-parse', 'HEAD')).Trim()
    $theta = New-Wiki 'theta' -EngineHash $staleHash -Identity $false
    $thetaHeadBefore = (Invoke-Git $theta @('rev-parse', 'HEAD')).Trim()
    Set-List @('zeta', 'eta', 'theta')
    Set-State -LastLintAt @{ zeta = $yesterday; eta = $yesterday; theta = $yesterday }
    Clear-Stub
    $r = Invoke-Walker
    $records = @(Get-StubRecords)
    $status = Read-Status
    $zetaSubject = (Invoke-Git $zeta @('log', '-1', '--format=%s')).Trim()
    $zetaParent = (Invoke-Git $zeta @('rev-parse', 'HEAD~1')).Trim()
    $zetaMark = Get-Content -LiteralPath (Join-Path $zeta '.claude\engine.json') -Raw | ConvertFrom-Json -AsHashtable
    $zetaFeed = [System.IO.File]::ReadAllText((Join-Path $zeta '.claude\feed.json'))
    $zetaClaudeDirty = (Invoke-Git $zeta @('status', '--porcelain', '--', '.claude')).Trim()
    $zetaInbox = @(Get-ChildItem -LiteralPath (Join-Path $zeta 'inbox') -File | Where-Object { $_.Name -ne '.gitkeep' })
    Test-Check "a wiki whose engine.json hash differs is updated and committed with the subject Engine: update to $hash8, its engine.json now the engine's hash and its .claude/ clean" ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($zetaSubject -ceq "Engine: update to $hash8") -and ($zetaParent -ceq $zetaHeadBefore) -and ($zetaMark['templateHash'] -ceq $script:engineHash) -and ($zetaClaudeDirty -eq '') -and ((Get-Step $status 'zeta' 'update') -ceq "ran: updated to $hash8"))
    Test-Check 'the updated wiki''s feed.json is unchanged, the feed step ran and fed the upstream page, and ingest then ran the stub there, which left the page in the inbox, so the step reads failed: kb-run.ps1 -Operation Ingest exited 0 and took no file from inbox/' (($zetaFeed -ceq $feedJson) -and ((Get-Step $status 'zeta' 'feed') -ceq 'ran') -and ($zetaInbox.Count -eq 1) -and ((Get-Step $status 'zeta' 'ingest') -ceq 'failed: kb-run.ps1 -Operation Ingest exited 0 and took no file from inbox/') -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $zeta))
    $etaMark = Get-Content -LiteralPath (Join-Path $eta '.claude\engine.json') -Raw | ConvertFrom-Json -AsHashtable
    Test-Check 'a wiki with a live edit is recorded deferred: live, left at its commit and its old engine.json, listed under deferred, and its later steps still run' (((Get-Step $status 'eta' 'update') -ceq 'deferred: live') -and ((Invoke-Git $eta @('rev-parse', 'HEAD')).Trim() -ceq $etaHeadBefore) -and ($etaMark['templateHash'] -ceq $staleHash) -and (@(Get-Deferred $status) -ccontains 'eta: live') -and ((Get-Step $status 'eta' 'ingest') -ceq 'skipped: inbox empty'))
    $thetaDirty = (Invoke-Git $theta @('status', '--porcelain', '--', '.claude')).Trim()
    $thetaFailure = @(@($status['failures']) | Where-Object { ($_['name'] -ceq 'theta') -and ($_['step'] -ceq 'update') })
    Test-Check 'a wiki with no git identity records update failed: git identity unset, under failures, with nothing copied or committed' (((Get-Step $status 'theta' 'update') -ceq 'failed: git identity unset') -and ($thetaFailure.Count -eq 1) -and ($thetaFailure[0]['note'] -ceq 'git identity unset') -and ((Invoke-Git $theta @('rev-parse', 'HEAD')).Trim() -ceq $thetaHeadBefore) -and ($thetaDirty -eq ''))

    # Two clones of one wiki on an old engine share one origin. The first is
    # updated and pushes; the second is updated, then pulls the first's update
    # commit, which holds the same files and the same mark, so the merge is
    # clean and no model run starts.
    $muBare = Join-Path $remotesDir 'mu.git'
    $null = Invoke-Git $remotesDir @('init', '-q', '--bare', '-b', 'main', $muBare)
    $mu = New-Wiki 'mu' -EngineHash $staleHash
    $null = Invoke-Git $mu @('remote', 'add', 'origin', $muBare)
    $null = Invoke-Git $mu @('push', '-q', '-u', 'origin', 'main')
    $muTwo = Join-Path $wikisDir 'mu-two'
    $null = Invoke-Git $wikisDir @('clone', '-q', $muBare, $muTwo)
    $null = Invoke-Git $muTwo @('config', 'user.name', 'kb-walk test two')
    $null = Invoke-Git $muTwo @('config', 'user.email', 'kbwalk-two@test.invalid')
    $script:wikis['mu-two'] = $muTwo
    $script:trustedPaths.Add($muTwo)
    Write-TrustFile
    Set-List @('mu')
    Set-State -LastLintAt @{ mu = $yesterday; 'mu-two' = $yesterday }
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $muPushed = ((Get-Step $status 'mu' 'update') -ceq "ran: updated to $hash8") -and ((Get-Step $status 'mu' 'push') -ceq 'ran')
    Set-List @('mu-two')
    Clear-Stub
    $r = Invoke-Walker
    $records = @(Get-StubRecords)
    $status = Read-Status
    $muTwoMark = Get-Content -LiteralPath (Join-Path $muTwo '.claude\engine.json') -Raw | ConvertFrom-Json -AsHashtable
    $muTwoParents = @((Invoke-Git $muTwo @('rev-list', '--parents', '-n', '1', 'HEAD')).Trim() -split ' ')
    $muTwoRestorePoint = if ($muTwoParents.Count -ge 2) { $muTwoParents[1] } else { '' }
    Test-Check 'a second clone updated to the engine its origin already holds pulls that update with a clean merge whose note names the restore point, its first parent, with no stub call and no deferral, and pushes' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and $muPushed -and ($records.Count -eq 0) -and ((Get-Step $status 'mu-two' 'update') -ceq "ran: updated to $hash8") -and ($muTwoParents.Count -eq 3) -and ((Get-Step $status 'mu-two' 'pull') -ceq "ran: merged, restore point $muTwoRestorePoint") -and (@(Get-Deferred $status).Count -eq 0) -and ((Get-Step $status 'mu-two' 'push') -ceq 'ran'))
    $muMarkBytes = [System.IO.File]::ReadAllBytes((Join-Path $mu '.claude\engine.json'))
    $muTwoMarkBytes = [System.IO.File]::ReadAllBytes((Join-Path $muTwo '.claude\engine.json'))
    $muMarksEqual = ([Convert]::ToBase64String($muMarkBytes)) -ceq ([Convert]::ToBase64String($muTwoMarkBytes))
    Test-Check 'the walker''s engine.json holds templateHash as its only key, with no per-machine field and no time, and the two clones'' marks are byte-identical' (($muTwoMark['templateHash'] -ceq $script:engineHash) -and ($muTwoMark.Keys.Count -eq 1) -and $muMarksEqual)

    # One shipped engine file restored on origin to the installed engine's
    # bytes. qoppa's own history holds a changed kb-status.ps1 and the other
    # clone puts the engine's copy back, so the fetched blob is the installed
    # file's while qoppa's HEAD holds other bytes for it: the exemption reads the
    # installed file, not HEAD, and the pull lands as a fast-forward.
    $qoppaBare = Join-Path $remotesDir 'qoppa.git'
    $null = Invoke-Git $remotesDir @('init', '-q', '--bare', '-b', 'main', $qoppaBare)
    $qoppa = New-Wiki 'qoppa'
    [System.IO.File]::AppendAllText((Join-Path $qoppa '.claude\kb-status.ps1'), "`n# a local change to a shipped file`n")
    $null = Invoke-Git $qoppa @('commit', '-q', '-a', '-m', 'Local change to kb-status.ps1')
    $null = Invoke-Git $qoppa @('remote', 'add', 'origin', $qoppaBare)
    $null = Invoke-Git $qoppa @('push', '-q', '-u', 'origin', 'main')
    $qoppaOther = Join-Path $remotesDir 'qoppa-other'
    $null = Invoke-Git $remotesDir @('clone', '-q', $qoppaBare, $qoppaOther)
    $null = Invoke-Git $qoppaOther @('config', 'user.name', 'other side')
    $null = Invoke-Git $qoppaOther @('config', 'user.email', 'other@test.invalid')
    Copy-Item -LiteralPath (Join-Path $templateDir '.claude\kb-status.ps1') -Destination (Join-Path $qoppaOther '.claude\kb-status.ps1') -Force
    $null = Invoke-Git $qoppaOther @('commit', '-q', '-a', '-m', 'Restore the engine''s kb-status.ps1')
    $null = Invoke-Git $qoppaOther @('push', '-q', 'origin', 'main')
    Set-List @('qoppa')
    Set-State -LastLintAt @{ qoppa = $yesterday }
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $qoppaRemoteHead = (Invoke-Git $qoppaBare @('rev-parse', 'main')).Trim()
    Test-Check 'a fetched commit changing one shipped engine file to the bytes the installed engine holds, in a wiki whose own HEAD holds other bytes for it, is fast-forwarded with no stop, no stub call and nothing deferred' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 0) -and ((Invoke-Git $qoppa @('rev-parse', 'HEAD')).Trim() -ceq $qoppaRemoteHead) -and ((Get-Step $status 'qoppa' 'pull') -ceq 'ran: fast-forward') -and (@(Get-Deferred $status).Count -eq 0))

    # An engine update commits exactly the files it wrote: a person's staged
    # page and an untracked file under .claude/ stay out of the commit and stay
    # as they were. Both are dated two hours back, so the tree is not live.
    $xi = New-Wiki 'xi' -EngineHash $staleHash
    $xiStaged = Join-Path $xi 'wiki\staged.md'
    $xiUntracked = Join-Path $xi '.claude\scratch.txt'
    [System.IO.File]::WriteAllText($xiStaged, "a page a person staged`n")
    [System.IO.File]::WriteAllText($xiUntracked, "a person's scratch note`n")
    foreach ($file in @($xiStaged, $xiUntracked)) { [System.IO.File]::SetLastWriteTimeUtc($file, [DateTime]::UtcNow.AddHours(-2)) }
    $null = Invoke-Git $xi @('add', '--', 'wiki/staged.md')

    # A wiki whose run lock and feed lock are both held by another run: the
    # wrapper and the feeder each print their lock line and exit 0 having done
    # nothing. The feed lock sits under the feeder's clone root, named for the
    # wiki's folder and the first 8 hex digits of the SHA-256 of its lowercased
    # path, under the LOCALAPPDATA the walker passes on.
    $nu = New-Wiki 'nu'
    $nuFeedJson = "{ `"sources`": [ { `"name`": `"up`", `"url`": $(ConvertTo-Json $upstream), `"branch`": `"main`", `"include`": [`"docs/*.md`"] } ] }`n"
    [System.IO.File]::WriteAllText((Join-Path $nu '.claude\feed.json'), $nuFeedJson, (New-Object System.Text.UTF8Encoding($false)))
    $null = Invoke-Git $nu @('add', '-A')
    $null = Invoke-Git $nu @('commit', '-q', '-m', 'Add feed.json')
    $nuDigest = [System.Security.Cryptography.SHA256]::Create().ComputeHash((New-Object System.Text.UTF8Encoding($false)).GetBytes($nu.TrimEnd('\').ToLowerInvariant()))
    $nuFeedRoot = Join-Path (Join-Path $localDir 'llm-wiki-feed') "nu-$(-join ($nuDigest[0..3] | ForEach-Object { $_.ToString('x2') }))"
    New-Item -ItemType Directory -Path $nuFeedRoot -Force | Out-Null

    Set-List @('xi', 'nu')
    Set-State -LastLintAt @{ xi = $yesterday; nu = $eightDaysAgo }
    Clear-Stub
    $nuRunLock = [System.IO.File]::Open((Join-Path $nu '.git\kb-run.lock'), [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $nuFeedLock = [System.IO.File]::Open((Join-Path $nuFeedRoot 'feed.lock'), [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    try {
        $r = Invoke-Walker
    } finally {
        $nuRunLock.Dispose()
        $nuFeedLock.Dispose()
    }
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    $xiCommitted = @(Get-Lines (Invoke-Git $xi @('show', '--name-only', '--format=', 'HEAD')))
    $xiSubject = (Invoke-Git $xi @('log', '-1', '--format=%s')).Trim()
    $xiCached = @(Get-Lines (Invoke-Git $xi @('diff', '--cached', '--name-only')))
    $xiUntrackedState = (Invoke-Git $xi @('status', '--porcelain', '--', '.claude/scratch.txt')).Trim()
    Test-Check 'an engine update over a staged page commits exactly what it wrote: the staged page is still staged and absent from the commit, and an untracked file under .claude/ stays untracked' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($xiSubject -ceq "Engine: update to $hash8") -and ($xiCommitted -ccontains '.claude/engine.json') -and (-not ($xiCommitted -ccontains 'wiki/staged.md')) -and (-not ($xiCommitted -ccontains '.claude/scratch.txt')) -and ($xiCached.Count -eq 1) -and ($xiCached[0] -ceq 'wiki/staged.md') -and ($xiUntrackedState -ceq '?? .claude/scratch.txt'))
    $nuFailures = @(@($status['failures']) | Where-Object { $_['name'] -ceq 'nu' })
    Test-Check 'with the wiki''s run lock held, a due lint reads skipped: run lock held, keeps its old stamp, starts no stub, and the wrapper''s lock line reaches the walker''s stdout' (((Get-Step $status 'nu' 'lint') -ceq 'skipped: run lock held') -and ((Get-StampText $state['wikis']['nu']['lastLintAt']) -ceq $eightDaysAgo) -and ($records.Count -eq 0) -and ($nuFailures.Count -eq 0) -and ($r.Stdout.Contains('kb-run: another run holds the lock for ')))
    Test-Check 'with the wiki''s feed lock held, the feed reads skipped: run lock held and nothing reaches the inbox' (((Get-Step $status 'nu' 'feed') -ceq 'skipped: run lock held') -and (@(Get-ChildItem -LiteralPath (Join-Path $nu 'inbox') -File | Where-Object { $_.Name -ne '.gitkeep' }).Count -eq 0) -and ($r.Stdout.Contains('feed-inbox: another feed run holds the lock for ')))

    # Four wikis in one pass. rho has no git identity and an origin that
    # diverged from it, so the pull would need a merge commit. sigma is on an
    # old engine with no origin and a merge of a local branch left stopped on
    # a conflict, with an inbox file and a due lint, so the steps after the
    # pull's abort have work. upsilon is on the current engine with an origin
    # and a merge of a local branch left stopped on a conflict in wiki/other.md,
    # while origin/main conflicts with its main on wiki/page.md alone, so the
    # paths the pull defers on tell a merge of origin/main from the leftover.
    # tau is on an old engine, and its
    # own kb-status.ps1 fails with a git-style error naming two URLs that carry
    # a user name and a password, the second password holding an escape
    # character between its two halves.
    $rhoBare = Join-Path $remotesDir 'rho.git'
    $null = Invoke-Git $remotesDir @('init', '-q', '--bare', '-b', 'main', $rhoBare)
    $rho = New-Wiki 'rho' -Identity $false
    $null = Invoke-Git $rho @('remote', 'add', 'origin', $rhoBare)
    $null = Invoke-Git $rho @('push', '-q', '-u', 'origin', 'main')
    $rhoOther = Join-Path $remotesDir 'rho-other'
    $null = Invoke-Git $remotesDir @('clone', '-q', $rhoBare, $rhoOther)
    $null = Invoke-Git $rhoOther @('config', 'user.name', 'other side')
    $null = Invoke-Git $rhoOther @('config', 'user.email', 'other@test.invalid')
    [System.IO.File]::WriteAllText((Join-Path $rhoOther 'wiki\rho-remote.md'), "from the remote`n")
    $null = Invoke-Git $rhoOther @('add', '-A')
    $null = Invoke-Git $rhoOther @('commit', '-q', '-m', 'Remote page')
    $null = Invoke-Git $rhoOther @('push', '-q', 'origin', 'main')
    $rhoRemoteHead = (Invoke-Git $rhoOther @('rev-parse', 'HEAD')).Trim()
    [System.IO.File]::WriteAllText((Join-Path $rho 'wiki\rho-local.md'), "from this side`n")
    $null = Invoke-Git $rho @('add', '-A')
    $null = Invoke-Git $rho @('-c', 'user.name=kb-walk test', '-c', 'user.email=kbwalk@test.invalid', 'commit', '-q', '-m', 'Local page')
    $rhoHeadBefore = (Invoke-Git $rho @('rev-parse', 'HEAD')).Trim()

    $sigma = New-Wiki 'sigma' -EngineHash $staleHash
    $sigmaPage = Join-Path $sigma 'wiki\page.md'
    [System.IO.File]::WriteAllText($sigmaPage, "base line`n")
    $null = Invoke-Git $sigma @('add', '-A')
    $null = Invoke-Git $sigma @('commit', '-q', '-m', 'Add page')
    $null = Invoke-Git $sigma @('checkout', '-q', '-b', 'side')
    [System.IO.File]::WriteAllText($sigmaPage, "side line`n")
    $null = Invoke-Git $sigma @('commit', '-q', '-a', '-m', 'Side edit')
    $null = Invoke-Git $sigma @('checkout', '-q', 'main')
    [System.IO.File]::WriteAllText($sigmaPage, "main line`n")
    $null = Invoke-Git $sigma @('commit', '-q', '-a', '-m', 'Main edit')
    $sigmaHeadBefore = (Invoke-Git $sigma @('rev-parse', 'HEAD')).Trim()
    $sigmaMerge = Invoke-Captured 'git' @('-C', $sigma, '-c', 'core.autocrlf=false', 'merge', 'side')
    $sigmaSideHead = (Invoke-Git $sigma @('rev-parse', 'side')).Trim()
    $sigmaMergeStarted = ($sigmaMerge.ExitCode -ne 0) -and ((Invoke-Captured 'git' @('-C', $sigma, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).Stdout.Trim() -ceq $sigmaSideHead)
    [System.IO.File]::WriteAllText((Join-Path $sigma 'inbox\drop.md'), "sigma note`n")

    $upsilonBare = Join-Path $remotesDir 'upsilon.git'
    $null = Invoke-Git $remotesDir @('init', '-q', '--bare', '-b', 'main', $upsilonBare)
    $upsilon = New-Wiki 'upsilon'
    $upsilonPage = Join-Path $upsilon 'wiki\page.md'
    $upsilonOtherPage = Join-Path $upsilon 'wiki\other.md'
    [System.IO.File]::WriteAllText($upsilonPage, "base line`n")
    [System.IO.File]::WriteAllText($upsilonOtherPage, "base other`n")
    $null = Invoke-Git $upsilon @('add', '-A')
    $null = Invoke-Git $upsilon @('commit', '-q', '-m', 'Add pages')
    $null = Invoke-Git $upsilon @('remote', 'add', 'origin', $upsilonBare)
    $null = Invoke-Git $upsilon @('push', '-q', '-u', 'origin', 'main')
    $upsilonOther = Join-Path $remotesDir 'upsilon-other'
    $null = Invoke-Git $remotesDir @('clone', '-q', $upsilonBare, $upsilonOther)
    $null = Invoke-Git $upsilonOther @('config', 'user.name', 'other side')
    $null = Invoke-Git $upsilonOther @('config', 'user.email', 'other@test.invalid')
    [System.IO.File]::WriteAllText((Join-Path $upsilonOther 'wiki\page.md'), "remote line`n")
    $null = Invoke-Git $upsilonOther @('commit', '-q', '-a', '-m', 'Remote edit')
    $null = Invoke-Git $upsilonOther @('push', '-q', 'origin', 'main')
    $null = Invoke-Git $upsilon @('checkout', '-q', '-b', 'side')
    [System.IO.File]::WriteAllText($upsilonOtherPage, "side other`n")
    $null = Invoke-Git $upsilon @('commit', '-q', '-a', '-m', 'Side edit')
    $null = Invoke-Git $upsilon @('checkout', '-q', 'main')
    [System.IO.File]::WriteAllText($upsilonPage, "local line`n")
    [System.IO.File]::WriteAllText($upsilonOtherPage, "main other`n")
    $null = Invoke-Git $upsilon @('commit', '-q', '-a', '-m', 'Local edit')
    $upsilonHeadBefore = (Invoke-Git $upsilon @('rev-parse', 'HEAD')).Trim()
    $upsilonSideHead = (Invoke-Git $upsilon @('rev-parse', 'side')).Trim()
    $upsilonMerge = Invoke-Captured 'git' @('-C', $upsilon, '-c', 'core.autocrlf=false', 'merge', 'side')
    $upsilonUnmergedBefore = @(Get-Lines (Invoke-Git $upsilon @('diff', '--name-only', '--diff-filter=U')))
    $upsilonMergeStarted = ($upsilonMerge.ExitCode -ne 0) -and ((Invoke-Captured 'git' @('-C', $upsilon, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).Stdout.Trim() -ceq $upsilonSideHead) -and ($upsilonUnmergedBefore.Count -eq 1) -and ($upsilonUnmergedBefore[0] -ceq 'wiki/other.md')
    $upsilonRemoteHead = (Invoke-Git $upsilonBare @('rev-parse', 'main')).Trim()

    $tau = New-Wiki 'tau' -EngineHash $staleHash
    $failingStatusLines = @(
        '[Console]::Error.WriteLine("fatal: unable to access ''https://user:secret@host.invalid/x/'' or ''https://user:pwhalf1`epwhalf2@host.invalid/y/'': Could not resolve host: host.invalid")'
        'exit 1'
    )
    [System.IO.File]::WriteAllText((Join-Path $tau '.claude\kb-status.ps1'), (($failingStatusLines -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
    $null = Invoke-Git $tau @('add', '-A')
    $null = Invoke-Git $tau @('commit', '-q', '-m', 'Failing status')

    Set-List @('rho', 'sigma', 'tau', 'upsilon')
    Set-State -LastLintAt @{ rho = $yesterday; sigma = $eightDaysAgo; tau = $yesterday; upsilon = $eightDaysAgo }
    Clear-Stub
    $r = Invoke-Walker @{ 'KBWALK_STUB_LINT' = 'commit'; 'KBWALK_STUB_TAKE' = 'drop.md' }
    $status = Read-Status
    $statusText = [System.IO.File]::ReadAllText($statusPath)
    $rhoMergeHeadGone = (Invoke-Captured 'git' @('-C', $rho, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).ExitCode -ne 0
    # The setup push made refs/remotes/origin/main at rho's own first commit,
    # so only the walker's fetch moves it to the other clone's commit.
    $rhoTracking = Invoke-Captured 'git' @('-C', $rho, 'rev-parse', '-q', '--verify', 'refs/remotes/origin/main')
    $rhoFetched = ($rhoTracking.ExitCode -eq 0) -and ($rhoTracking.Stdout.Trim() -ceq $rhoRemoteHead)
    Test-Check 'a wiki with no git identity whose origin diverged fetches the other side''s commit and reads pull failed: git identity unset, with no merge in progress and HEAD as before' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ((Get-Step $status 'rho' 'pull') -ceq 'failed: git identity unset') -and $rhoFetched -and $rhoMergeHeadGone -and ((Invoke-Git $rho @('rev-parse', 'HEAD')).Trim() -ceq $rhoHeadBefore))
    # A merge left in progress is aborted by the pull before anything else.
    # In upsilon the pull then fetches and merges origin/main, which conflicts
    # on wiki/page.md alone, so the stub runs with Merge over that merge and
    # not the leftover, whose conflict was wiki/other.md; the stub leaves the
    # markers, so the pull defers on wiki/page.md.
    $walkLogText = [System.IO.File]::ReadAllText($walkLog)
    $passRecords = @(Get-StubRecords)
    $upsilonRecords = @($passRecords | Where-Object { $_.Cwd -ieq $upsilon })
    $upsilonDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'upsilon' })
    $upsilonPaths = @(if ($upsilonDeferred.Count -eq 1 -and $upsilonDeferred[0].ContainsKey('paths')) { @($upsilonDeferred[0]['paths']) } else { @() })
    $upsilonMergeHeadGone = (Invoke-Captured 'git' @('-C', $upsilon, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).ExitCode -ne 0
    $upsilonTrackingAfter = (Invoke-Git $upsilon @('rev-parse', 'refs/remotes/origin/main')).Trim()
    Test-Check 'a wiki with an origin and a merge of a local branch left in progress has that merge aborted, named in the log, then fetches origin and runs the stub with Merge over the origin/main conflict, deferring on wiki/page.md alone with passes 1' ($upsilonMergeStarted -and (-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($walkLogText.Contains("upsilon pull aborted a merge left in progress with $upsilonSideHead")) -and ($upsilonTrackingAfter -ceq $upsilonRemoteHead) -and ($upsilonRecords.Count -eq 1) -and ($upsilonRecords[0].Args -ceq $mergeArgs) -and ((Get-Step $status 'upsilon' 'pull') -ceq 'deferred: conflict') -and ($upsilonDeferred.Count -eq 1) -and ($upsilonPaths.Count -eq 1) -and ($upsilonPaths[0] -ceq 'wiki/page.md') -and ($upsilonDeferred[0]['passes'] -eq 1))
    Test-Check 'that wiki is left with no merge in progress, HEAD as before, both pages as its main holds them, and its result deferred' ($upsilonMergeHeadGone -and ((Invoke-Git $upsilon @('rev-parse', 'HEAD')).Trim() -ceq $upsilonHeadBefore) -and ([System.IO.File]::ReadAllText($upsilonPage) -ceq "local line`n") -and ([System.IO.File]::ReadAllText($upsilonOtherPage) -ceq "main other`n") -and ((Get-WikiStatus $status 'upsilon')['result'] -ceq 'deferred'))
    # In sigma the engine update finds the leftover and defers with nothing
    # copied, the pull aborts it and is skipped for want of an origin, and the
    # ingest and the due lint then run on the restored tree.
    $sigmaRecords = @($passRecords | Where-Object { $_.Cwd -ieq $sigma })
    $sigmaMark = Get-Content -LiteralPath (Join-Path $sigma '.claude\engine.json') -Raw | ConvertFrom-Json -AsHashtable
    $sigmaClaudeDirty = (Invoke-Git $sigma @('status', '--porcelain', '--', '.claude')).Trim()
    $sigmaMergeHeadGone = (Invoke-Captured 'git' @('-C', $sigma, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).ExitCode -ne 0
    # The stub's lint commit is the one commit the pass adds over the HEAD the
    # aborted merge left.
    $sigmaAdded = @(Get-Lines (Invoke-Git $sigma @('log', "$sigmaHeadBefore..HEAD", '--format=%s')))
    Test-Check 'a wiki on an old engine with no origin and a merge left in progress reads update deferred: merge in progress with nothing copied, has the merge aborted by the pull, named in the log, and the pull skipped: no origin' ($sigmaMergeStarted -and ((Get-Step $status 'sigma' 'update') -ceq 'deferred: merge in progress') -and ($sigmaMark['templateHash'] -ceq $staleHash) -and ($sigmaClaudeDirty -eq '') -and ($walkLogText.Contains("sigma pull aborted a merge left in progress with $sigmaSideHead")) -and $sigmaMergeHeadGone -and ((Get-Step $status 'sigma' 'pull') -ceq 'skipped: no origin') -and ($sigmaAdded.Count -eq 1) -and $sigmaAdded[0].StartsWith('Lint:', [StringComparison]::Ordinal) -and ((Invoke-Git $sigma @('rev-parse', 'HEAD~1')).Trim() -ceq $sigmaHeadBefore) -and ([System.IO.File]::ReadAllText($sigmaPage) -ceq "main line`n"))
    Test-Check 'after that abort the wiki''s ingest and due lint run, each calling the stub once in the wiki' (($sigmaRecords.Count -eq 2) -and ($sigmaRecords[0].Args -ceq $ingestArgs) -and ($sigmaRecords[1].Args -ceq $lintArgs) -and ((Get-Step $status 'sigma' 'ingest') -ceq 'ran') -and ((Get-Step $status 'sigma' 'lint') -ceq 'ran'))
    # The update's deferral named the merge the pull then aborted, so the pass
    # ends with sigma listed nowhere under deferred and no deferral in its
    # state, while the update's own step record keeps what the update did.
    $sigmaState = (Read-State)['wikis']['sigma']
    $sigmaListed = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'sigma' })
    Test-Check 'that wiki''s update deferral on the merge the pull aborted is cleared in the same pass: the status lists no sigma: merge in progress, nor sigma at all, under deferred, the state holds no deferral for it, and its update step still reads deferred: merge in progress' ((-not ((Get-Deferred $status) -ccontains 'sigma: merge in progress')) -and ($sigmaListed.Count -eq 0) -and ($null -ne $sigmaState) -and (-not $sigmaState.ContainsKey('deferred')) -and ((Get-Step $status 'sigma' 'update') -ceq 'deferred: merge in progress'))
    $tauNote = 'kb-status.ps1 -What Live exited 1: fatal: unable to access ''https://***@host.invalid/x/'' or ''https://***@host.invalid/y/'': Could not resolve host: host.invalid'
    $tauStep = Get-Step $status 'tau' 'update'
    $walkLogText = [System.IO.File]::ReadAllText($walkLog)
    Test-Check 'a step note built from a child''s stderr naming https://user:secret@host.invalid/x/ reads https://***@host.invalid/x/, and the secret reaches neither the status, the log nor the walker''s stdout' (($tauStep -ceq "failed: $tauNote") -and (-not $statusText.Contains('secret')) -and (-not $walkLogText.Contains('secret')) -and (-not $r.Stdout.Contains('secret')))
    $tauHalves = @('pwhalf1', 'pwhalf2')
    $tauHalvesShown = @($tauHalves | Where-Object { $statusText.Contains($_) -or $walkLogText.Contains($_) -or $r.Stdout.Contains($_) })
    Test-Check 'a URL whose password holds an escape character between its halves is masked whole as https://***@host.invalid/y/, and neither half reaches the status, the log nor the walker''s stdout' (($tauStep -ceq "failed: $tauNote") -and ($tauHalvesShown.Count -eq 0))

    # A merge left in progress whose abort git refuses: chi is on the current
    # engine with no origin, a merge of a local branch stopped on a conflict,
    # and a stale .git/index.lock, so git merge --abort cannot take the index.
    # It holds an inbox file and a due lint, so a pull that let the visit go on
    # would call the stub.
    $chi = New-Wiki 'chi'
    $chiPage = Join-Path $chi 'wiki\page.md'
    [System.IO.File]::WriteAllText($chiPage, "base line`n")
    $null = Invoke-Git $chi @('add', '-A')
    $null = Invoke-Git $chi @('commit', '-q', '-m', 'Add page')
    $null = Invoke-Git $chi @('checkout', '-q', '-b', 'side')
    [System.IO.File]::WriteAllText($chiPage, "side line`n")
    $null = Invoke-Git $chi @('commit', '-q', '-a', '-m', 'Side edit')
    $null = Invoke-Git $chi @('checkout', '-q', 'main')
    [System.IO.File]::WriteAllText($chiPage, "main line`n")
    $null = Invoke-Git $chi @('commit', '-q', '-a', '-m', 'Main edit')
    $chiMerge = Invoke-Captured 'git' @('-C', $chi, '-c', 'core.autocrlf=false', 'merge', 'side')
    $chiSideHead = (Invoke-Git $chi @('rev-parse', 'side')).Trim()
    $chiMergeStarted = ($chiMerge.ExitCode -ne 0) -and ((Invoke-Captured 'git' @('-C', $chi, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).Stdout.Trim() -ceq $chiSideHead)
    [System.IO.File]::WriteAllText((Join-Path $chi 'inbox\drop.md'), "chi note`n")
    $chiIndexLock = Join-Path $chi '.git\index.lock'
    [System.IO.File]::WriteAllText($chiIndexLock, '')
    Set-List @('chi')
    Set-State -LastLintAt @{ chi = $eightDaysAgo }
    Clear-Stub
    $r = Invoke-Walker
    $status = Read-Status
    $chiMergeHeadKept = (Invoke-Captured 'git' @('-C', $chi, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).Stdout.Trim() -ceq $chiSideHead
    # A removal that fails does not stop the test before its checks run, and the
    # finally block removes the lock again.
    Remove-Item -LiteralPath $chiIndexLock -Force -ErrorAction SilentlyContinue
    $chiPull = Get-Step $status 'chi' 'pull'
    $chiWiki = Get-WikiStatus $status 'chi'
    $chiLaterSteps = @(if ($null -ne $chiWiki) { @('feed', 'ingest', 'lint', 'push') | Where-Object { $chiWiki['steps'].ContainsKey($_) } } else { @('no status entry') })
    $chiFailures = @(@($status['failures']) | Where-Object { ($_['name'] -ceq 'chi') -and ($_['step'] -ceq 'pull') })
    Test-Check 'a merge left in progress whose git merge --abort git refuses for a held index.lock reads pull failed with a note naming git merge --abort and git''s index.lock refusal, the merge still in progress' ($chiMergeStarted -and (-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and $chiPull.StartsWith('failed: git merge --abort exited ', [StringComparison]::Ordinal) -and $chiPull.Contains('index.lock') -and $chiMergeHeadKept)
    Test-Check 'that failed abort ends the visit: no stub call, no feed, ingest, lint or push step recorded, the wiki''s result visited, and the status listing the pull failure' ((@(Get-StubRecords).Count -eq 0) -and ($chiLaterSteps.Count -eq 0) -and ($null -ne $chiWiki) -and ($chiWiki['result'] -ceq 'visited') -and ($chiFailures.Count -eq 1))

    # An engine update whose staging git refuses: omega is on an old engine
    # with no origin and a stale .git/index.lock, so the update copies the
    # engine's files and writes the new mark, and then git add cannot take the
    # index. It holds an inbox file and a due lint, so a pass that went on to
    # ingest or lint over the uncommitted update would call the stub. Once the
    # lock is gone, the next pass makes the update again and commits it, since
    # the update reads the mark committed at HEAD, and then ingests and lints.
    $omega = New-Wiki 'omega' -EngineHash $staleHash
    [System.IO.File]::WriteAllText((Join-Path $omega 'inbox\drop.md'), "omega note`n")
    $omegaIndexLock = Join-Path $omega '.git\index.lock'
    [System.IO.File]::WriteAllText($omegaIndexLock, '')
    Set-List @('omega')
    Set-State -LastLintAt @{ omega = $eightDaysAgo }
    Clear-Stub
    $r = Invoke-Walker @{ 'KBWALK_STUB_LINT' = 'commit' }
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    $omegaUpdate = Get-Step $status 'omega' 'update'
    $omegaTreeMark = Get-Content -LiteralPath (Join-Path $omega '.claude\engine.json') -Raw | ConvertFrom-Json -AsHashtable
    $omegaHeadMark = Invoke-Git $omega @('show', 'HEAD:.claude/engine.json') | ConvertFrom-Json -AsHashtable
    Remove-Item -LiteralPath $omegaIndexLock -Force -ErrorAction SilentlyContinue
    Test-Check 'an engine update whose git add a held index.lock refuses reads update failed with a note naming git and index.lock, the working-tree mark holding the engine''s hash and the mark at HEAD still the old one' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and $omegaUpdate.StartsWith('failed: git ', [StringComparison]::Ordinal) -and $omegaUpdate.Contains('index.lock') -and ($omegaTreeMark['templateHash'] -ceq $script:engineHash) -and ($omegaHeadMark['templateHash'] -ceq $staleHash))
    Test-Check 'that failed update skips the pass''s ingest and lint: each reads skipped: engine update failed, no stub runs, and the lint keeps its old stamp' (((Get-Step $status 'omega' 'ingest') -ceq 'skipped: engine update failed') -and ((Get-Step $status 'omega' 'lint') -ceq 'skipped: engine update failed') -and ($records.Count -eq 0) -and ((Get-StampText $state['wikis']['omega']['lastLintAt']) -ceq $eightDaysAgo))
    Test-Check 'the visit still runs its pull, feed and push, each recording its own outcome for a wiki with no origin and no feed.json' (((Get-Step $status 'omega' 'pull') -ceq 'skipped: no origin') -and ((Get-Step $status 'omega' 'feed') -ceq 'skipped: no feed.json') -and ((Get-Step $status 'omega' 'push') -ceq 'skipped: no origin') -and ((Get-WikiStatus $status 'omega')['result'] -ceq 'visited'))

    # The first pass wrote .claude/engine.json seconds ago, and kb-status.ps1
    # -What Live counts a dirty path written under 30 minutes back as live, so
    # the second pass would defer the update live. Every file under .claude/
    # is dated 31 minutes back, so the tree reads as not live.
    $omegaWrittenAt = [DateTime]::UtcNow.AddMinutes(-31)
    foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $omega '.claude') -Recurse -File -Force)) { [System.IO.File]::SetLastWriteTimeUtc($file.FullName, $omegaWrittenAt) }
    $omegaHeadBefore = (Invoke-Git $omega @('rev-parse', 'HEAD')).Trim()
    Clear-Stub
    $r = Invoke-Walker @{ 'KBWALK_STUB_LINT' = 'commit'; 'KBWALK_STUB_TAKE' = 'drop.md' }
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    $omegaSubjects = @(Get-Lines (Invoke-Git $omega @('log', "$omegaHeadBefore..HEAD", '--reverse', '--format=%s')))
    $omegaHeadMark = Invoke-Git $omega @('show', 'HEAD:.claude/engine.json') | ConvertFrom-Json -AsHashtable
    Test-Check 'with the lock gone, the next pass reads update ran: updated to the engine''s hash, commits it under Engine: update to, and the mark at HEAD holds the engine''s hash' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ((Get-Step $status 'omega' 'update') -ceq "ran: updated to $hash8") -and ($omegaSubjects.Count -ge 1) -and $omegaSubjects[0].StartsWith('Engine: update to', [StringComparison]::Ordinal) -and ($omegaHeadMark['templateHash'] -ceq $script:engineHash))
    Test-Check 'that pass then runs the ingest and the due lint, each calling the stub once in the wiki, and the lint, committing under Lint: after the update, is stamped' (($records.Count -eq 2) -and ($records[0].Cwd -ieq $omega) -and ($records[0].Args -ceq $ingestArgs) -and ($records[1].Cwd -ieq $omega) -and ($records[1].Args -ceq $lintArgs) -and ((Get-Step $status 'omega' 'ingest') -ceq 'ran') -and ((Get-Step $status 'omega' 'lint') -ceq 'ran') -and ($omegaSubjects.Count -eq 2) -and $omegaSubjects[1].StartsWith('Lint:', [StringComparison]::Ordinal) -and ((Get-StampText $state['wikis']['omega']['lastLintAt']) -cne $eightDaysAgo))

    # An engine update whose copy throws: koppa is on an old engine with no
    # origin, an inbox file and a due lint, and its vendored kb-status.ps1 is
    # read-only, so File.Copy cannot overwrite it after the files before it were
    # written. The update reads failed with the new mark never written, and the
    # pass starts no ingest or lint. The attribute is cleared again whatever the
    # pass does.
    $koppa = New-Wiki 'koppa' -EngineHash $staleHash
    [System.IO.File]::WriteAllText((Join-Path $koppa 'inbox\drop.md'), "koppa note`n")
    $koppaReadOnly = Join-Path $koppa '.claude\kb-status.ps1'
    [System.IO.File]::SetAttributes($koppaReadOnly, [System.IO.FileAttributes]::ReadOnly)
    $koppaHeadBefore = (Invoke-Git $koppa @('rev-parse', 'HEAD')).Trim()
    Set-List @('koppa')
    Set-State -LastLintAt @{ koppa = $eightDaysAgo }
    Clear-Stub
    try {
        $r = Invoke-Walker @{ 'KBWALK_STUB_LINT' = 'commit' }
    } finally {
        [System.IO.File]::SetAttributes($koppaReadOnly, [System.IO.FileAttributes]::Normal)
    }
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    $koppaTreeMark = Get-Content -LiteralPath (Join-Path $koppa '.claude\engine.json') -Raw | ConvertFrom-Json -AsHashtable
    $koppaFailures = @(@($status['failures']) | Where-Object { ($_['name'] -ceq 'koppa') -and ($_['step'] -ceq 'update') })
    Test-Check 'an engine update whose copy throws on a read-only vendored file reads update failed: copying the engine''s files failed, lists the failure, commits nothing and leaves the working-tree mark unwritten' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (Get-Step $status 'koppa' 'update').StartsWith('failed: copying the engine''s files failed: ', [StringComparison]::Ordinal) -and ($koppaFailures.Count -eq 1) -and ((Invoke-Git $koppa @('rev-parse', 'HEAD')).Trim() -ceq $koppaHeadBefore) -and ($koppaTreeMark['templateHash'] -ceq $staleHash))
    Test-Check 'that failed copy skips the pass''s ingest and lint: each reads skipped: engine update failed, no stub runs, and the lint keeps its old stamp' (((Get-Step $status 'koppa' 'ingest') -ceq 'skipped: engine update failed') -and ((Get-Step $status 'koppa' 'lint') -ceq 'skipped: engine update failed') -and ($records.Count -eq 0) -and ((Get-StampText $state['wikis']['koppa']['lastLintAt']) -ceq $eightDaysAgo))

    # A person's edit in progress holds off ingest and lint. psi and digamma
    # are on the current engine with no origin, an inbox file, a due lint, and
    # a tracked wiki/ page modified seconds ago and left uncommitted, so
    # kb-status.ps1 -What Live prints it. digamma also carries a conflict
    # deferred by the last pass, which must stay named in the deferred list
    # over this pass's live deferrals. The stub would commit under Lint:, so a
    # lint that started would be stamped.
    $psiWiki = New-Wiki 'psi'
    $digamma = New-Wiki 'digamma'
    foreach ($livePath in @($psiWiki, $digamma)) {
        $livePage = Join-Path $livePath 'wiki\page.md'
        [System.IO.File]::WriteAllText($livePage, "committed line`n")
        $null = Invoke-Git $livePath @('add', '--', 'wiki/page.md')
        $null = Invoke-Git $livePath @('commit', '-q', '-m', 'Add page')
        [System.IO.File]::WriteAllText($livePage, "committed line`na line being written now`n")
        [System.IO.File]::WriteAllText((Join-Path $livePath 'inbox\drop.md'), "a dropped note`n")
    }
    $liveState = [ordered]@{
        cursor = $null
        wikis  = [ordered]@{
            psi     = [ordered]@{ lastLintAt = $eightDaysAgo }
            digamma = [ordered]@{ lastLintAt = $eightDaysAgo; conflictPasses = 1; deferred = [ordered]@{ reason = 'conflict'; paths = @('wiki/page.md') } }
        }
    }
    Set-List @('psi', 'digamma')
    [System.IO.File]::WriteAllText($statePath, (ConvertTo-Json -InputObject $liveState -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
    Clear-Stub
    $r = Invoke-Walker @{ 'KBWALK_STUB_LINT' = 'commit' }
    $status = Read-Status
    $state = Read-State
    $liveDeferred = @(Get-Deferred $status)
    Test-Check 'with a tracked wiki/ page modified seconds ago, ingest and the due lint each read deferred: live, no stub runs, the lint keeps its old stamp, and the status lists the wiki deferred live' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ((Get-Step $status 'psi' 'ingest') -ceq 'deferred: live') -and ((Get-Step $status 'psi' 'lint') -ceq 'deferred: live') -and (@(Get-StubRecords).Count -eq 0) -and ((Get-StampText $state['wikis']['psi']['lastLintAt']) -ceq $eightDaysAgo) -and ($liveDeferred -ccontains 'psi: live'))
    $digammaListed = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'digamma' })
    Test-Check 'in a wiki carrying a standing conflict, the live ingest and lint deferrals leave the conflict named: the status lists it once with reason conflict, its path and passes 1, and its lint keeps its old stamp' (((Get-Step $status 'digamma' 'ingest') -ceq 'deferred: live') -and ((Get-Step $status 'digamma' 'lint') -ceq 'deferred: live') -and ((Get-Step $status 'digamma' 'pull') -ceq 'skipped: no origin') -and ($digammaListed.Count -eq 1) -and ($digammaListed[0]['reason'] -ceq 'conflict') -and (@($digammaListed[0]['paths']) -ccontains 'wiki/page.md') -and ($digammaListed[0]['passes'] -eq 1) -and ((Get-StampText $state['wikis']['digamma']['lastLintAt']) -ceq $eightDaysAgo))

    # A standing conflict from the last pass, and a pull this pass refuses for
    # budget. The wiki's own kb-status.ps1 is replaced by one that sleeps 70
    # seconds, starts a process that holds its stdout for 8 more and then
    # writes a marker, prints nothing and exits 0. With a 130-second budget the
    # wiki starts, the Live read spends the budget under the 60-second floor,
    # the walker drains the held stream for 5 seconds and ends the leftover,
    # and the update's next git read and the pull are both refused for budget.
    # The leftover writes its marker 8 seconds after it starts, 3 seconds after
    # the first drain gives up. What tells an ended leftover from one left
    # running is the second 5-second drain, which waits on the stream the
    # leftover holds: where the walker's stop ends nothing, that drain holds
    # the pass open past the 8 seconds, so the leftover writes its marker.
    # Without that drain the pass would end and its job close first, and the
    # marker would stay absent either way.
    $omicron = New-Wiki 'omicron' -EngineHash $staleHash
    $leftoverMarker = Join-Path $stubDir 'leftover-after.txt'
    $slowStatusLines = @(
        'Start-Sleep -Seconds 70'
        '$psi = New-Object System.Diagnostics.ProcessStartInfo'
        '$psi.FileName = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName'
        '$psi.UseShellExecute = $false'
        '$psi.ArgumentList.Add(''-NoProfile'')'
        '$psi.ArgumentList.Add(''-Command'')'
        "`$psi.ArgumentList.Add('Start-Sleep -Seconds 8; [System.IO.File]::WriteAllText(''$leftoverMarker'', ''after'')')"
        '$null = [System.Diagnostics.Process]::Start($psi)'
        'exit 0'
    )
    [System.IO.File]::WriteAllText((Join-Path $omicron '.claude\kb-status.ps1'), (($slowStatusLines -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
    $null = Invoke-Git $omicron @('add', '-A')
    $null = Invoke-Git $omicron @('commit', '-q', '-m', 'Slow status')
    $omicronState = [ordered]@{
        cursor = $null
        wikis  = [ordered]@{ omicron = [ordered]@{ lastLintAt = $yesterday; conflictPasses = 2; lastMergeRunAt = $yesterday; noticedStuck = $true; lastNoticeAt = $eightDaysAgo; deferred = [ordered]@{ reason = 'conflict'; paths = @('wiki/page.md') } } }
    }
    Set-List @('omicron')
    [System.IO.File]::WriteAllText($statePath, (ConvertTo-Json -InputObject $omicronState -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
    Clear-Stub
    $r = Invoke-Walker @{ 'KB_WALK_SECONDS' = '130' } -TimeoutSeconds 240
    $status = Read-Status
    $state = Read-State
    $omicronDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'omicron' })
    $omicronPaths = @(if ($omicronDeferred.Count -eq 1) { @($omicronDeferred[0]['paths']) } else { @() })
    Test-Check 'a wiki deferred on a conflict last pass whose pull this pass is refused for budget is still listed under deferred with reason conflict, its path and its count of 2 passes unchanged, and keeps its last run time' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ((Get-Step $status 'omicron' 'pull') -ceq 'skipped: budget') -and ($omicronDeferred.Count -eq 1) -and ($omicronDeferred[0]['reason'] -ceq 'conflict') -and ($omicronPaths.Count -eq 1) -and ($omicronPaths[0] -ceq 'wiki/page.md') -and ($omicronDeferred[0]['passes'] -eq 2) -and ($omicronDeferred[0]['stuck'] -eq $false) -and ($state['wikis']['omicron']['conflictPasses'] -eq 2) -and ((Get-StampText $state['wikis']['omicron']['lastMergeRunAt']) -ceq $yesterday))
    Test-Check 'a noticed wiki whose pull this pass is refused for budget appends no notice and keeps noticedStuck true and its last notice time' ((@(Get-Notices 'omicron').Count -eq 0) -and ($state['wikis']['omicron']['noticedStuck'] -eq $true) -and ((Get-StampText $state['wikis']['omicron']['lastNoticeAt']) -ceq $eightDaysAgo))
    Test-Check 'a child that exited 0 while a process it left held its stdout is drained for 5 seconds, the leftover is ended before it writes its marker, with a log line saying so, and the exit code stands, so the step reads skipped: budget and not timed out' (((Get-Step $status 'omicron' 'update') -ceq 'skipped: budget') -and ($r.Stdout.Contains('a process it left still held its output 5 seconds after it ended, and was ended with the job''s processes')) -and (@($status['failures']).Count -eq 0) -and (-not (Test-Path -LiteralPath $leftoverMarker)))

    # A child stopped at the budget still leaves what it printed: the wiki's
    # own kb-run.ps1 is replaced by one that prints a line and sleeps past the
    # pass budget, so the walker stops its tree at the deadline. The model-run
    # floor is set to the 60-second child floor, so the ingest under the
    # 130-second budget still starts.
    $pi = New-Wiki 'pi'
    [System.IO.File]::WriteAllText((Join-Path $pi 'inbox\drop.md'), "pi note`n")
    $stoppedLine = 'pi-run printed this line before the stop'
    $sleepyRunLines = @(
        "[Console]::Out.WriteLine('$stoppedLine')"
        '[Console]::Out.Flush()'
        'Start-Sleep -Seconds 400'
    )
    [System.IO.File]::WriteAllText((Join-Path $pi '.claude\kb-run.ps1'), (($sleepyRunLines -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
    # Committed, so the tree is not live and the ingest's Live read lets it start.
    $null = Invoke-Git $pi @('add', '--', '.claude/kb-run.ps1')
    $null = Invoke-Git $pi @('commit', '-q', '-m', 'Sleepy run')
    Set-List @('pi')
    Set-State -LastLintAt @{ pi = $yesterday }
    Clear-Stub
    $r = Invoke-Walker @{ 'KB_WALK_SECONDS' = '130'; 'KB_WALK_MODEL_FLOOR_SECONDS' = '60' } -TimeoutSeconds 240
    $status = Read-Status
    Test-Check 'an ingest child stopped at the pass budget reads failed for the stop, and the line it printed before the stop reached the walker''s stdout' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ((Get-Step $status 'pi' 'ingest').StartsWith('failed: kb-run.ps1 -Operation Ingest did not finish within the remaining budget', [StringComparison]::Ordinal)) -and (@(Get-Lines $r.Stdout) -ccontains $stoppedLine))

    # --- An ssh command the account configured stands for the pull's fetch.
    # yod's origin is an ssh-form address and GIT_SSH in the walker's
    # environment names a fake ssh, so git reaches origin through the fake only
    # where the walker leaves its batch-mode GIT_SSH_COMMAND off, since git
    # takes that over GIT_SSH. The fake writes its environment to a file and
    # serves the bare remote with git upload-pack. Named ssh, it is read by git
    # as OpenSSH, so git starts no probe of it first. The file's other lines
    # are the control that the absent GIT_SSH_COMMAND line is not an empty read.
    $yodBare = Join-Path $remotesDir 'yod.git'
    $null = Invoke-Git $remotesDir @('init', '-q', '--bare', '-b', 'main', $yodBare)
    $yod = New-Wiki 'yod'
    $null = Invoke-Git $yod @('remote', 'add', 'origin', $yodBare)
    $null = Invoke-Git $yod @('push', '-q', '-u', 'origin', 'main')
    $null = Invoke-Git $yod @('remote', 'set-url', 'origin', 'fakehost:yod.git')
    $yodSshDir = Join-Path $work 'fake-ssh'
    New-Item -ItemType Directory -Path $yodSshDir -Force | Out-Null
    $yodSsh = Join-Path $yodSshDir 'ssh'
    $yodEnvFile = Join-Path $work 'yod-fetch-env.txt'
    [System.IO.File]::WriteAllText($yodSsh, "#!/bin/sh`nenv > '$($yodEnvFile -replace '\\', '/')'`nexec git upload-pack '$($yodBare -replace '\\', '/')'`n", (New-Object System.Text.UTF8Encoding($false)))
    Set-List @('yod')
    Set-State -LastLintAt @{ yod = $yesterday }
    Clear-Stub
    $r = Invoke-Walker @{ 'GIT_SSH' = $yodSsh; 'GIT_SSH_COMMAND' = $null }
    $status = Read-Status
    $yodEnv = @(if (Test-Path -LiteralPath $yodEnvFile) { [System.IO.File]::ReadAllLines($yodEnvFile) })
    $yodSshCommand = @($yodEnv | Where-Object { $_.StartsWith('GIT_SSH_COMMAND=', [StringComparison]::Ordinal) })
    Test-Check 'with GIT_SSH set in the walker''s environment, the pull''s fetch runs with no GIT_SSH_COMMAND: git reaches origin through the GIT_SSH fake, whose environment holds no GIT_SSH_COMMAND line, and the pull reads ran: up to date' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($yodEnv.Count -gt 0) -and ($yodSshCommand.Count -eq 0) -and ((Get-Step $status 'yod' 'pull') -ceq 'ran: up to date'))
    if ($yodEnv.Count -eq 0 -or $yodSshCommand.Count -ne 0) { Write-Host "  pull: $(Get-Step $status 'yod' 'pull'), environment lines $($yodEnv.Count), GIT_SSH_COMMAND lines $($yodSshCommand.Count)" }

    # --- Bullet 5: the budget cursor. The budget sits just above the walker's
    # 120-second floor for starting a wiki, so the first wiki starts and its
    # stub's 75-second ingest leaves under the 60-second floor for starting a
    # child: the first wiki's due lint is skipped for budget rather than started
    # and stopped, the second wiki is skipped, and the next pass starts with it.
    # The model-run floor is set to the 60-second child floor, so the first
    # ingest still starts, and the lint's Live read meets the child floor first.
    $iota = New-Wiki 'iota'
    $kappa = New-Wiki 'kappa'
    [System.IO.File]::WriteAllText((Join-Path $iota 'inbox\drop.md'), "iota note`n")
    [System.IO.File]::WriteAllText((Join-Path $kappa 'inbox\drop.md'), "kappa note`n")
    Set-List @('iota', 'kappa')
    Set-State -LastLintAt @{ iota = $eightDaysAgo; kappa = $yesterday }
    Clear-Stub
    $r = Invoke-Walker @{ 'KB_WALK_SECONDS' = '132'; 'KB_WALK_MODEL_FLOOR_SECONDS' = '60'; 'KBWALK_STUB_SLEEP' = '75' } -TimeoutSeconds 240
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    Test-Check 'with the budget spent inside the first wiki, the first wiki ran ingest, which took no file from inbox/, the second reads skipped: budget, and the cursor stops before it' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $iota) -and ((Get-Step $status 'iota' 'ingest') -ceq 'failed: kb-run.ps1 -Operation Ingest exited 0 and took no file from inbox/') -and ((Get-WikiStatus $status 'kappa')['result'] -ceq 'skipped: budget') -and ([string]$state['cursor'] -ceq 'iota'))
    # The stub leaves iota's inbox file for the later cases over this wiki,
    # so the ingest's own failure is the one the list holds.
    $iotaOtherFailures = @(@($status['failures']) | Where-Object { -not (($_['name'] -ceq 'iota') -and ($_['step'] -ceq 'ingest')) })
    Test-Check 'a due lint left with under 60 seconds of budget reads skipped: budget, starts no stub, keeps its old stamp, and the failures list holds nothing but the ingest that took no file' (((Get-Step $status 'iota' 'lint') -ceq 'skipped: budget') -and ((Get-StampText $state['wikis']['iota']['lastLintAt']) -ceq $eightDaysAgo) -and ($iotaOtherFailures.Count -eq 0) -and (@($status['failures']).Count -eq 1))
    # The lint commits under Lint:, so it is stamped, and the lock and kill
    # cases below over this wiki each start only its ingest.
    Clear-Stub
    $r = Invoke-Walker @{ 'KBWALK_STUB_LINT' = 'commit' }
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    Test-Check 'the next pass starts with the skipped wiki and then visits the first, running its ingest and its still-due lint, which is stamped' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 3) -and ($records[0].Cwd -ieq $kappa) -and ($records[1].Cwd -ieq $iota) -and ($records[1].Args -ceq $ingestArgs) -and ($records[2].Cwd -ieq $iota) -and ($records[2].Args -ceq $lintArgs) -and ((Get-Step $status 'iota' 'lint') -ceq 'ran') -and ((Get-StampText $state['wikis']['iota']['lastLintAt']) -cne $eightDaysAgo))

    # --- Bullet 6: a second walker while the first holds the lock.
    Set-List @('iota')
    Clear-Stub
    $first = Start-Walker @{ 'KBWALK_STUB_SLEEP' = '8' }
    $firstStubRunning = Wait-StubRecorded
    $second = Invoke-Walker
    $firstStillRunning = -not $first.Process.HasExited
    $firstResult = Wait-Captured $first 60
    $secondLines = @(Get-Lines $second.Stdout)
    Test-Check 'a second walker started while the first holds the lock prints one line naming the lock and exits 0, starting nothing' ($firstStubRunning -and $firstStillRunning -and (-not $second.TimedOut) -and ($second.ExitCode -eq 0) -and ($secondLines.Count -eq 1) -and ($secondLines[0].Contains('lock')) -and ($second.Stderr.Trim() -eq '') -and (@(Get-StubRecords).Count -eq 1) -and (-not $firstResult.TimedOut) -and ($firstResult.ExitCode -eq 0))

    # --- Bullet 7: the walker alone is killed while its stub sleeps, by its own
    # process object and never by a tree stop, so only the walker's kill-on-close
    # job can end the stub. The process list is read before the kill and must
    # show the sleeping stub, or the later read proves nothing.
    #
    # The killed pass visits three wikis, and the state it leaves shows the
    # write after each visit. episemon's origin still holds the two-base
    # history rolling wiki/CLAUDE.md back that stopped it above, so from a state holding no notice
    # fields the pass makes it stuck again and collects its stuck notice,
    # which only the pass's end would append. gimel's own kb-run.ps1 makes a
    # Lint: commit, so its due lint is stamped with no stub call. iota's
    # ingest stub then sleeps until the kill. The state read after the kill
    # names gimel as the cursor and holds its fresh stamp, and episemon's
    # deferral with noticedStuck and lastNoticeAt as they stood before the
    # pass, so the next pass appends the stuck record.
    $gimel = New-Wiki 'gimel'
    $lintRunLines = @(
        'git commit -q --allow-empty -m "Lint: gimel check, clean"'
        'exit $LASTEXITCODE'
    )
    [System.IO.File]::WriteAllText((Join-Path $gimel '.claude\kb-run.ps1'), (($lintRunLines -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
    # Committed, so the tree is not live and the lint's Live read lets it start.
    $null = Invoke-Git $gimel @('add', '--', '.claude/kb-run.ps1')
    $null = Invoke-Git $gimel @('commit', '-q', '-m', 'Committing run')
    Set-List @('episemon', 'gimel', 'iota')
    Set-State -LastLintAt @{ episemon = $yesterday; gimel = $eightDaysAgo; iota = $yesterday }
    $episemonNoticesBefore = @(Get-Notices 'episemon').Count
    Clear-Stub
    $killCase = Start-Walker @{ 'KBWALK_STUB_SLEEP' = '20' }
    # The stub starts only after two wikis' visits, so its wait is longer.
    $killStubStarted = Wait-StubRecorded 60
    $script:recordedStubs = @(Get-StubProcesses @($killCase.Process.Id))
    Test-Check 'before the kill, the process list shows the sleeping stub by its command line' ($killStubStarted -and ($script:recordedStubs.Count -ge 1))
    if (-not $killCase.Process.HasExited) { $killCase.Process.Kill() }
    $walkerEnded = $killCase.Process.WaitForExit(10000)
    $survivors = @()
    $pollEnd = [DateTime]::UtcNow.AddSeconds(10)
    do {
        $survivors = @(@(Get-LiveRecorded $script:recordedStubs) + @(Get-StubProcesses @($killCase.Process.Id)))
        if ($survivors.Count -eq 0) { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $pollEnd)
    Test-Check 'after the walker alone is killed, no stub process it started is left in the process list within 10 seconds' ($walkerEnded -and ($script:recordedStubs.Count -ge 1) -and ($survivors.Count -eq 0))
    $stubStartedAt = if (Test-Path -LiteralPath $script:record) { (Get-Item -LiteralPath $script:record).LastWriteTimeUtc } else { [DateTime]::UtcNow }
    $markerWaitEnd = $stubStartedAt.AddSeconds(24)
    while ([DateTime]::UtcNow -lt $markerWaitEnd) { Start-Sleep -Milliseconds 500 }
    Test-Check 'the orphaned stub''s after-sleep marker never appears, 24 seconds after the stub started' ($killStubStarted -and (-not (Test-Path -LiteralPath $script:afterMarker)))
    $killState = Read-State
    Stop-LiveRecorded $script:recordedStubs
    Clear-Stub
    $r = Invoke-Walker
    Test-Check 'after the kill the lock is free, so the next pass proceeds and starts the stub' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 1))
    $gimelStamp = [DateTime]::MinValue
    $gimelStamped = [DateTime]::TryParseExact((Get-StampText $killState['wikis']['gimel']['lastLintAt']), 'o', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$gimelStamp)
    $killEpisemon = $killState['wikis']['episemon']
    $killEpisemonDeferred = ($null -ne $killEpisemon) -and $killEpisemon.ContainsKey('deferred') -and ($killEpisemon['deferred'] -is [System.Collections.IDictionary]) -and ([string]$killEpisemon['deferred']['reason'] -ceq 'engine change')
    $episemonNotices = @(Get-Notices 'episemon')
    Test-Check 'the walker killed in its third wiki leaves a state whose cursor names the second, the last wiki visited, holding the second wiki''s lint stamp from that pass, and the first wiki, made stuck in that pass, with its engine change deferral and noticedStuck and lastNoticeAt as they stood before the pass, so the next pass appends its stuck record' (([string]$killState['cursor'] -ceq 'gimel') -and $gimelStamped -and ($gimelStamp.ToUniversalTime() -gt $killCase.StartedAt) -and $killEpisemonDeferred -and (-not $killEpisemon.ContainsKey('noticedStuck')) -and (-not $killEpisemon.ContainsKey('lastNoticeAt')) -and ($episemonNotices.Count -eq $episemonNoticesBefore + 1) -and ([string]$episemonNotices[-1]['id']).StartsWith('episemon:stuck:', [StringComparison]::Ordinal))
} finally {
    foreach ($process in $script:started) {
        if (-not $process.HasExited) { Stop-StartedTree $process }
    }
    Stop-LiveRecorded $script:recordedStubs
    $survivorCount = 0
    foreach ($process in $script:started) {
        if (-not $process.HasExited) {
            $survivorCount++
            Write-Host "survivor $($process.Id) $(Get-CommandTag $process.StartInfo.FileName)"
        }
    }
    foreach ($process in @(Get-LiveRecorded $script:recordedStubs)) {
        $survivorCount++
        Write-Host "survivor $($process.ProcessId) $(Get-CommandTag $process.CommandLine)"
    }
    Write-Host "survivors $survivorCount"
    if ($null -ne $chiIndexLock -and (Test-Path -LiteralPath $chiIndexLock)) { Remove-Item -LiteralPath $chiIndexLock -Force -ErrorAction SilentlyContinue }
    if ($null -ne $omegaIndexLock -and (Test-Path -LiteralPath $omegaIndexLock)) { Remove-Item -LiteralPath $omegaIndexLock -Force -ErrorAction SilentlyContinue }
    if ($null -eq $priorGlobal) { Remove-Item -LiteralPath Env:GIT_CONFIG_GLOBAL -ErrorAction SilentlyContinue } else { $env:GIT_CONFIG_GLOBAL = $priorGlobal }
    if ($null -eq $priorNoSystem) { Remove-Item -LiteralPath Env:GIT_CONFIG_NOSYSTEM -ErrorAction SilentlyContinue } else { $env:GIT_CONFIG_NOSYSTEM = $priorNoSystem }
    if (Test-Path -LiteralPath $work) {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "$cases kb-walk cases, $failures failed."
exit $failures
