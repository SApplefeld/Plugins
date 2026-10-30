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
where it is reconcile one under "Reconcile:" alone. Where KBWALK_STUB_ECHO is
set the stub prints one line of its own and then that text, as a model's
output would. No case reaches the real claude.

It checks, one case per acceptance bullet: a pass over three wikis calling the
stub once for the one inbox file, with an empty inbox skipped and an untrusted
wiki skipped; the lint gate both ways on the seven-day stamp, the due lint's
model output carrying the wrapper's lock-held prefix on a later line and the
lint still recorded `run`; a due lint whose run made only a Reconcile: commit,
and one whose run made none, each recorded skipped: no Lint: commit with no
stamp; a fast-forward
pull with no stub call, a conflicting pull joined by the stub and pushed with
its note naming the restore point, and
a conflicting pull the stub leaves, aborted and deferred across two passes
with the pass count rising, then joined on a third and its count cleared,
a conflict on .claude/settings.json deferred with no stub call at all and
stuck from its first pass, and a wiki whose conflict the stub never joins
driven through three deferred passes to stuck, its fourth pass fetching a
commit origin gained meanwhile, starting no stub and naming when the run is
held until, and a fifth pass a day after the
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
another run holds recorded skipped: run lock held, with no stamp; -WhatIf
printing the wikis it would visit and writing nothing in the walk folder; a
diverged pull in a wiki with no git identity recorded failed with no merge
started; a merge left in progress aborted by the pull, in a wiki with an
origin whose own origin/main then conflicts and runs the stub, and in one
with no origin whose ingest and lint then run and whose update's deferral
on that merge is cleared in the same pass; a merge left in progress whose
abort git refuses for a stale index.lock, recorded pull failed with no later
step run; a URL's user name and password in a child's error text replaced by
*** in the status, the log and stdout, a password holding an escape
character included; a standing
conflict kept listed when the next pass's pull is refused for budget, in a
pass whose wiki-owned status script leaves a process holding its stdout,
which the walker drains for 5 seconds and then ends; an ingest stopped at the
pass budget whose printed line still reaches the walker's stdout; the budget
cursor across two passes, with a
lint left under the 60-second child floor skipped for budget; a second
walker refused by the lock; and the walker killed while its stub sleeps,
leaving no stub process in the process list.

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
    param([string]$Repo, [string[]]$Arguments)
    $result = Invoke-Captured 'git' (@('-C', $Repo, '-c', 'core.autocrlf=false') + $Arguments)
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
    foreach ($file in @($script:record, $script:afterMarker)) {
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

# Waits up to 20 seconds for the stub to record itself, and returns whether it did.
function Wait-StubRecorded {
    $pollEnd = [DateTime]::UtcNow.AddSeconds(20)
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
$claudeJson = Join-Path $profileDir '.claude.json'
$wikisDir = Join-Path $work 'wikis'
$remotesDir = Join-Path $work 'remotes'
$stubDir = Join-Path $work 'stub'
$script:stub = Join-Path $stubDir 'claude.cmd'
$script:record = Join-Path $stubDir 'record.txt'
$script:afterMarker = Join-Path $stubDir 'after-sleep.txt'
$resolvedFile = Join-Path $stubDir 'resolved.md'
$emptyConfig = Join-Path $work 'empty.gitconfig'

$ingestArgs = '-p "Use the wiki-ingest skill." --model sonnet --permission-mode default'
$lintArgs = '-p "Use the wiki-lint skill." --model sonnet --permission-mode default'
$mergeArgs = '-p "Use the wiki-merge skill." --model sonnet --permission-mode default'

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

# The environment every walker run gets: the test's own account folders, no
# budget override, and a stub that exits 0 at once, overlaid with the case's values.
function Get-RunEnvironment {
    param([hashtable]$Overlay = @{})
    $environment = @{
        'LOCALAPPDATA'         = $localDir
        'USERPROFILE'          = $profileDir
        'KB_WALK_SECONDS'      = $null
        'KB_RUN_SECONDS'       = $null
        'KBWALK_STUB_SLEEP'    = '0'
        'KBWALK_STUB_MODE'     = 'leave'
        'KBWALK_STUB_RESOLVED' = $resolvedFile
        'KBWALK_STUB_ECHO'     = $null
        'KBWALK_STUB_LINT'     = $null
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
    # commits nothing.
    $stubLines = @(
        '@echo off'
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
        ">>`"$script:afterMarker`" echo after"
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
    $r = Invoke-Walker
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
    Test-Check 'a wiki whose origin holds a commit it lacks is fast-forwarded to it with no stub call, and nothing is pushed' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 0) -and ($localHead -ceq $remoteHead) -and ((Get-Step $status 'epsilon' 'pull') -ceq 'ran: fast-forward') -and ((Get-Step $status 'epsilon' 'push') -ceq 'skipped: nothing to push'))

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
    Test-Check 'where the stub resolves the page and commits, the merge commit has two parents, MERGE_HEAD is gone, the pull reads merged by model with the restore point the pre-merge HEAD, and the pass pushes it' (($parents.Count -eq 3) -and $mergeHeadGone -and ((Get-Step $status 'epsilon' 'pull') -ceq "ran: merged by model, restore point $epsilonHeadBefore") -and ($parents[1] -ceq $epsilonHeadBefore) -and ((Get-Step $status 'epsilon' 'push') -ceq 'ran') -and ($localHead -ceq $remoteHead) -and (@(Get-Deferred $status).Count -eq 0))

    $null = Invoke-Git $other @('pull', '-q', 'origin', 'main')
    [System.IO.File]::WriteAllText((Join-Path $other 'wiki\page.md'), "remote line one and local line one`nremote line two`n")
    $null = Invoke-Git $other @('commit', '-q', '-a', '-m', 'Remote edit two')
    $null = Invoke-Git $other @('push', '-q', 'origin', 'main')
    $localText = "remote line one and local line one`nlocal line two`n"
    [System.IO.File]::WriteAllText((Join-Path $epsilon 'wiki\page.md'), $localText)
    $null = Invoke-Git $epsilon @('commit', '-q', '-a', '-m', 'Local edit two')
    $headBefore = (Invoke-Git $epsilon @('rev-parse', 'HEAD')).Trim()
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
    Test-Check 'the status lists the wiki under deferred with reason conflict, the path wiki/page.md, passes 1 and stuck false, its result deferred, and no later step recorded' (($deferredEntry.Count -eq 1) -and ($deferredEntry[0]['reason'] -ceq 'conflict') -and ($deferredPaths.Count -eq 1) -and ($deferredPaths[0] -ceq 'wiki/page.md') -and ($deferredEntry[0]['passes'] -eq 1) -and ($deferredEntry[0]['stuck'] -eq $false) -and ($epsilonStatus['result'] -ceq 'deferred') -and ((Get-Step $status 'epsilon' 'pull') -ceq 'deferred: conflict') -and (-not $epsilonStatus['steps'].ContainsKey('ingest')) -and (-not $epsilonStatus['steps'].ContainsKey('push')))
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
    # .claude/settings.json, and the pass defers without a stub call.
    $lambdaBare = Join-Path $remotesDir 'lambda.git'
    $null = Invoke-Git $remotesDir @('init', '-q', '--bare', '-b', 'main', $lambdaBare)
    $lambda = New-Wiki 'lambda'
    $null = Invoke-Git $lambda @('remote', 'add', 'origin', $lambdaBare)
    $null = Invoke-Git $lambda @('push', '-q', '-u', 'origin', 'main')
    $lambdaOther = Join-Path $remotesDir 'lambda-other'
    $null = Invoke-Git $remotesDir @('clone', '-q', $lambdaBare, $lambdaOther)
    $null = Invoke-Git $lambdaOther @('config', 'user.name', 'other side')
    $null = Invoke-Git $lambdaOther @('config', 'user.email', 'other@test.invalid')
    $settingsText = [System.IO.File]::ReadAllText((Join-Path $lambda '.claude\settings.json'))
    [System.IO.File]::WriteAllText((Join-Path $lambdaOther '.claude\settings.json'), ($settingsText + "// remote side`n"))
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
    Test-Check 'a conflict on .claude/settings.json makes no stub call, and the pass defers the wiki with that path, stuck true on its first pass with passes 1, MERGE_HEAD gone and HEAD as before' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 0) -and ($lambdaDeferred.Count -eq 1) -and ($lambdaDeferred[0]['reason'] -ceq 'conflict') -and ($lambdaPaths -ccontains '.claude/settings.json') -and ($lambdaDeferred[0]['passes'] -eq 1) -and ($lambdaDeferred[0]['stuck'] -eq $true) -and ((Get-Step $status 'lambda' 'pull') -ceq 'deferred: conflict') -and $lambdaMergeHeadGone -and ((Invoke-Git $lambda @('rev-parse', 'HEAD')).Trim() -ceq $lambdaHeadBefore))

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
    foreach ($pass in 1..3) {
        Clear-Stub
        $r = Invoke-Walker
        $records = @(Get-StubRecords)
        $status = Read-Status
        $phiDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'phi' })
        $phiPassOk = (-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $phi) -and ($records[0].Args -ceq $mergeArgs) -and ((Get-Step $status 'phi' 'pull') -ceq 'deferred: conflict') -and ($phiDeferred.Count -eq 1) -and ($phiDeferred[0]['passes'] -eq $pass) -and ($phiDeferred[0]['stuck'] -eq ($pass -ge 3))
        if (-not $phiPassOk) { Write-Host "phi pass $pass off its expected shape" }
        $phiPassesOk = $phiPassesOk -and $phiPassOk
    }
    Test-Check 'a wiki whose conflict the stub never joins is deferred on three passes in a row, each calling the stub once with Merge, with passes 1, 2 and 3 and stuck true only on the third' $phiPassesOk
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
    Test-Check 'the stuck wiki''s fourth pass inside the day fetches the commit origin gained meanwhile, starts no stub, lists it deferred with passes 4, stuck true and its path, HEAD as before and no merge left, and the log names the time its run is held until' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and $phiLastRunStamped -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'phi' 'pull') -ceq 'deferred: conflict') -and ($phiDeferred.Count -eq 1) -and ($phiDeferred[0]['passes'] -eq 4) -and ($phiDeferred[0]['stuck'] -eq $true) -and ($phiPaths.Count -eq 1) -and ($phiPaths[0] -ceq 'wiki/page.md') -and ($phiTracking -ceq $phiRemoteHead) -and $phiMergeHeadGone -and ((Invoke-Git $phi @('rev-parse', 'HEAD')).Trim() -ceq $phiHeadBefore) -and ([System.IO.File]::ReadAllText($walkLog).Contains("held until $phiHeldUntil")))
    $state = Read-State
    $state['wikis']['phi']['lastMergeRunAt'] = [DateTime]::UtcNow.AddHours(-25).ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    [System.IO.File]::WriteAllText($statePath, (ConvertTo-Json -InputObject $state -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
    Clear-Stub
    $r = Invoke-Walker
    $records = @(Get-StubRecords)
    $status = Read-Status
    $phiDeferred = @(@($status['deferred']) | Where-Object { $_['name'] -ceq 'phi' })
    Test-Check 'with the last run''s time 25 hours back, the stuck wiki''s fifth pass starts the stub with Merge again and lists it with passes 5' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $phi) -and ($records[0].Args -ceq $mergeArgs) -and ($phiDeferred.Count -eq 1) -and ($phiDeferred[0]['passes'] -eq 5) -and ($phiDeferred[0]['stuck'] -eq $true))

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
    Test-Check 'a conflicting pull whose wiki''s run lock is held starts no stub, names the held lock in the log, relays the wrapper''s lock line to the walker''s stdout, stamps the last run time, and defers the wiki with passes 1, MERGE_HEAD gone and HEAD as before' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 0) -and ((Get-Step $status 'heta' 'pull') -ceq 'deferred: conflict') -and ($hetaDeferred.Count -eq 1) -and ($hetaDeferred[0]['passes'] -eq 1) -and $state['wikis']['heta'].ContainsKey('lastMergeRunAt') -and ([System.IO.File]::ReadAllText($walkLog).Contains("heta merge run's first output line reports the wiki's run lock held")) -and ($r.Stdout.Contains('kb-run: another run holds the lock for ')) -and $hetaMergeHeadGone -and ((Invoke-Git $heta @('rev-parse', 'HEAD')).Trim() -ceq $hetaHeadBefore))

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
    Test-Check 'the updated wiki''s feed.json is unchanged, the feed step ran and fed the upstream page, and ingest then ran the stub there' (($zetaFeed -ceq $feedJson) -and ((Get-Step $status 'zeta' 'feed') -ceq 'ran') -and ($zetaInbox.Count -eq 1) -and ((Get-Step $status 'zeta' 'ingest') -ceq 'ran') -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $zeta))
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
    $r = Invoke-Walker @{ 'KBWALK_STUB_LINT' = 'commit' }
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
    $r = Invoke-Walker @{ 'KBWALK_STUB_LINT' = 'commit' }
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
        wikis  = [ordered]@{ omicron = [ordered]@{ lastLintAt = $yesterday; conflictPasses = 2; lastMergeRunAt = $yesterday; deferred = [ordered]@{ reason = 'conflict'; paths = @('wiki/page.md') } } }
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
    Test-Check 'a child that exited 0 while a process it left held its stdout is drained for 5 seconds, the leftover is ended before it writes its marker, with a log line saying so, and the exit code stands, so the step reads skipped: budget and not timed out' (((Get-Step $status 'omicron' 'update') -ceq 'skipped: budget') -and ($r.Stdout.Contains('a process it left still held its output 5 seconds after it ended, and was ended with the job''s processes')) -and (@($status['failures']).Count -eq 0) -and (-not (Test-Path -LiteralPath $leftoverMarker)))

    # A child stopped at the budget still leaves what it printed: the wiki's
    # own kb-run.ps1 is replaced by one that prints a line and sleeps past the
    # pass budget, so the walker stops its tree at the deadline.
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
    $r = Invoke-Walker @{ 'KB_WALK_SECONDS' = '130' } -TimeoutSeconds 240
    $status = Read-Status
    Test-Check 'an ingest child stopped at the pass budget reads failed for the stop, and the line it printed before the stop reached the walker''s stdout' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ((Get-Step $status 'pi' 'ingest').StartsWith('failed: kb-run.ps1 -Operation Ingest did not finish within the remaining budget', [StringComparison]::Ordinal)) -and (@(Get-Lines $r.Stdout) -ccontains $stoppedLine))

    # --- Bullet 5: the budget cursor. The budget sits just above the walker's
    # 120-second floor for starting a wiki, so the first wiki starts and its
    # stub's 75-second ingest leaves under the 60-second floor for starting a
    # child: the first wiki's due lint is skipped for budget rather than started
    # and stopped, the second wiki is skipped, and the next pass starts with it.
    $iota = New-Wiki 'iota'
    $kappa = New-Wiki 'kappa'
    [System.IO.File]::WriteAllText((Join-Path $iota 'inbox\drop.md'), "iota note`n")
    [System.IO.File]::WriteAllText((Join-Path $kappa 'inbox\drop.md'), "kappa note`n")
    Set-List @('iota', 'kappa')
    Set-State -LastLintAt @{ iota = $eightDaysAgo; kappa = $yesterday }
    Clear-Stub
    $r = Invoke-Walker @{ 'KB_WALK_SECONDS' = '132'; 'KBWALK_STUB_SLEEP' = '75' } -TimeoutSeconds 240
    $records = @(Get-StubRecords)
    $status = Read-Status
    $state = Read-State
    Test-Check 'with the budget spent inside the first wiki, the first wiki ran ingest, the second reads skipped: budget, and the cursor stops before it' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and ($records.Count -eq 1) -and ($records[0].Cwd -ieq $iota) -and ((Get-Step $status 'iota' 'ingest') -ceq 'ran') -and ((Get-WikiStatus $status 'kappa')['result'] -ceq 'skipped: budget') -and ([string]$state['cursor'] -ceq 'iota'))
    Test-Check 'a due lint left with under 60 seconds of budget reads skipped: budget, starts no stub, keeps its old stamp, and the failures list is empty' (((Get-Step $status 'iota' 'lint') -ceq 'skipped: budget') -and ((Get-StampText $state['wikis']['iota']['lastLintAt']) -ceq $eightDaysAgo) -and (@($status['failures']).Count -eq 0))
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
    Clear-Stub
    $killCase = Start-Walker @{ 'KBWALK_STUB_SLEEP' = '20' }
    $killStubStarted = Wait-StubRecorded
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
    Stop-LiveRecorded $script:recordedStubs
    Clear-Stub
    $r = Invoke-Walker
    Test-Check 'after the kill the lock is free, so the next pass proceeds and starts the stub' ((-not $r.TimedOut) -and ($r.ExitCode -eq 0) -and (@(Get-StubRecords).Count -eq 1))
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
