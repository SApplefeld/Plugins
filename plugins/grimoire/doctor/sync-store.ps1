# The silent store sync: commit what the allowlist admits, fetch from the
# configured upstream, screen every incoming blob against the allowlist,
# rebase onto the fresh tracking ref, push, and record the outcome to
# <StoreRoot>/kit-sync-state.json. The SessionStart hook (memory-session.js)
# spawns this detached whenever the store is pending; it can also be run by
# hand with an explicit -StoreRoot. Either way every git call runs through
# Invoke-MemorySyncGit's environment guard, so a hand run's shell GIT_*
# variables (GIT_SSH_COMMAND, GIT_ASKPASS among them) do not reach git.
#
# There is no default store root: the real store root holds
# .credentials.json, settings.json, and history.jsonl, so a forgotten
# argument must be a loud parameter error rather than a sync attempt against
# the operator's home. That is the same no-default rule
# install-memory-sync.ps1 applies, and this script dot-sources that file for
# every probe and for the commit itself, so the two cannot answer the safety
# questions differently.
#
# This script never prints and always exits 0. It runs detached with its
# streams ignored, so anything it wrote would go nowhere, and a nonzero exit
# would tell nobody anything; the state file is the whole report, as fixed
# enum codes and ISO timestamps, never free text. The hook reads it and maps
# the codes onto its own fixed literals, which is what keeps store-derived
# text out of the session context. The two gates that mean the store is not
# this system's repository at all (git-missing, foreign) write no state file
# either. The single-flight lock is the one exception: it is created before the
# ownership gate is evaluated (the gate needs the dot-sourced installer), so a
# by-hand run against a foreign directory does create, and then remove on exit,
# a kit-sync.lock there; only a run killed in that brief window leaves it. The
# SessionStart hook never reaches this path against a foreign store, because it
# checks ownership before it spawns.
#
# The mutation bar is the doctor's own PASS bar, re-derived on every run
# through Get-MemorySyncStatus and never cached: git available, the store
# root the doctor's own repository, both managed files Canonical, all four
# leak probes run and answered clean, HEAD readable and attached, and the
# dirty probe itself answered. A run that fails the bar records a gate state
# (or nothing, for the two silent gates above) and mutates nothing at all:
# no init, no add, no commit, no network. The IsRepo gate in particular is
# what keeps Install-MemorySyncRepo's git-init branch unreachable from here;
# this script never creates a repository, a remote, or a branch. The commit
# itself goes through Install-MemorySyncRepo, whose pre- and post-add index
# gates still guard the add and whose commit message is the canonical one.
#
# The network flow is fetch-first. The fetch carries no URL and no refspec,
# so the configured upstream is the only place this script ever speaks to,
# and the ahead/behind counts are read only after it, from the fresh
# tracking ref; counts read from a stale ref would call a behind store
# converged and doom every later push. When the fetch shows incoming
# commits, every ENTRY the incoming upstream tree holds is checked, on both a
# tree entry's security-relevant axes, before the rebase touches the tree: its
# mode must be a regular file (a symlink or gitlink at an allowlisted path is
# refused, since a materialized symlink would turn a later memory read into an
# arbitrary-file read) and its path must be allowlisted and traversal-free. A
# disallowed entry refuses the whole intake as inbound-leak, with no merge and
# no push, because a rebase would plant it in the live store root where nothing
# un-writes it. The screen is over tree entries rather than the fetch's new blob
# objects on purpose: an object screen is blind to a disallowed path that reuses
# a blob HEAD already has (a rename, or duplicate content), which is exactly how
# settings.json or a credential file would slip in. A tree that cannot be listed
# or parsed is unproven and retries silently rather than being accused of a
# leak. A second, diff-shaped read follows it and carries the machine axis: the
# entries that differ between the merge base and the incoming commit, filtered
# to this machine's own coordinator directory, whose contract is single-writer.
# Any entry there refuses the intake as inbound-foreign-write, since the whole-
# tree screen cannot see which admitted paths a commit rewrites. Outbound the
# same axis runs inside the installer, over the paths its add staged, and its
# refusal is recorded here as outbound-foreign-write. The upstream is resolved
# to a fixed commit once, and that commit is what the screen reads and the
# rebase replays onto, so a concurrent fetch cannot advance the ref between the
# two. Only when every incoming entry is admitted does the rebase run, and after
# it the whole bar is re-derived before the push, so nothing that fails the
# re-check is published onward. A paused merge, cherry-pick, revert, rebase, or
# `git am` in the store defers the whole run, so no conflict markers are ever
# committed.
#
# Single-flight: kit-sync.lock in the store root, created exclusively and
# carrying the owner's process id and an ISO timestamp. A live lock is a
# concurrent run in progress, which is not a failure, so that path exits
# without touching the state file at all. A lock is stale when its process is
# gone, when the live process holding its pid started after the lock was
# written (a reused pid, so the true owner is gone), or when its timestamp sits
# in the future (a clock that jumped backward would otherwise pin a crashed
# lock fresh forever); a live owner that predates its lock is never stale, so a
# slow fetch keeps it, and the 15-minute age horizon decides only when the lock
# cannot be parsed or the owner's start time cannot be read. Takeover goes
# through a rename, so two runs that both judge the lock stale cannot both win,
# and removal on exit checks the lock still names this process before deleting
# it. Both the lock and the
# state file (and their temporaries) sit at the store root, where the
# allowlist's exclude-all rule keeps them out of every add.

param(
    [Parameter(Mandatory = $true)][string]$StoreRoot
)

# How old a lock must be before it is a crashed run's rather than a live one's.
$script:SyncLockStaleMinutes = 15

# The one gate answer for a status: an empty string when the full mutation bar
# holds, otherwise the fixed reason code for the first bar it fails. A leak is
# checked before an unproven probe set, because a disallowed path any probe
# did see is the more actionable fact than the probes being incomplete. An
# unreadable HEAD fails closed as detached: a head this script cannot read is
# not a head it may commit onto.
function Get-SyncGateReason {
    param([Parameter(Mandatory = $true)][hashtable]$Status)
    if (-not $Status.GitAvailable) { return 'git-missing' }
    if (-not $Status.IsRepo -or -not $Status.IsOwnRepo) { return 'foreign' }
    if ($Status.IgnoreState -ne 'Canonical' -or $Status.AttrState -ne 'Canonical') { return 'drift' }
    if (@($Status.NotIgnored).Count -gt 0 -or @($Status.Unexpected).Count -gt 0 -or
        @($Status.Tracked).Count -gt 0 -or @($Status.HistoryPaths).Count -gt 0) { return 'leaks' }
    if (-not $Status.ProbesRan) { return 'unproven' }
    if (-not $Status.DestinationRead -or $Status.Detached) { return 'detached' }
    return ''
}

# The ahead/behind counts against the configured upstream, read from the local
# remote-tracking ref. The caller fetches first, so the ref is fresh when this
# runs. The literal @{upstream} token rides the argv array, so no
# store-controlled ref text ever occupies a position git could read as a
# flag. Ok false means the counts could not be read at all, which the caller
# treats as a transient failure rather than as zero.
function Get-SyncAheadBehind {
    param(
        [Parameter(Mandatory = $true)][string]$StoreRoot,
        [string]$Ref = '@{upstream}'
    )
    $counts = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @('rev-list', '--left-right', '--count', ($Ref + '...HEAD'))
    if ($counts.Code -ne 0 -or $counts.Output.Count -eq 0) { return @{ Ok = $false; Behind = 0; Ahead = 0 } }
    $m = [regex]::Match($counts.Output[0].Trim(), '^(\d+)\s+(\d+)$')
    if (-not $m.Success) { return @{ Ok = $false; Behind = 0; Ahead = 0 } }
    return @{ Ok = $true; Behind = [int]$m.Groups[1].Value; Ahead = [int]$m.Groups[2].Value }
}

# Whether every entry the upstream tree holds is one the allowlist admits, on
# BOTH of a tree entry's security-relevant axes: its mode and its path. This
# screens the incoming tree, not the objects a fetch introduced. An object
# screen (`rev-list --objects ... --filter=object:type=blob`) lists a blob once
# at its first-seen path and omits any blob HEAD already has, so a rename or a
# duplicate-content push carries a disallowed destination past it with zero
# lines to show; the rebase then writes that path into the live store root,
# where nothing un-writes it. `ls-tree -r @{upstream}` names every entry the
# tree holds, and reading the mode column (not `--name-only`) is what closes
# the second axis: only a regular file (100644/100755) may enter. A symlink
# (120000) or a gitlink (160000) at an allowlisted path would otherwise be
# materialized by the rebase, and a symlink turns a later memory read into an
# arbitrary-file read into the session's trusted context (a memory path that is
# really a link to .credentials.json or an ssh key). A tree entry has no other
# security-relevant attribute, so mode-plus-path is the complete screen.
# quotePath is off so a non-ASCII path arrives decoded rather than as a quoted
# string, matching the installer's own probes.
#
# Returns 'ok' when every entry is admitted, 'leak' when any entry is a
# non-regular-file mode, a traversal (`.`/`..` segment), a still-quoted
# (undecodable) path, or a disallowed path, and 'unproven' when the tree could
# not be listed or a line could not be parsed (git noise on the merged stderr
# stream reads as an unparseable line). The caller gates a leak loudly and lets
# an unproven intake retry silently: a plumbing failure to enumerate is not
# evidence of a leak, and accusing an old-git or transiently-failing box of one
# would nag with a remedy that cannot clear it.
function Test-SyncIncomingAllowed {
    param(
        [Parameter(Mandatory = $true)][string]$StoreRoot,
        [Parameter(Mandatory = $true)][string]$Ref
    )
    # $Ref is a fixed commit the caller resolved once, not the symbolic
    # @{upstream}: screening and rebasing the same fixed commit closes the
    # window in which a concurrent fetch could advance the ref between the two.
    $tree = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @('-c', 'core.quotePath=false', 'ls-tree', '-r', $Ref)
    if ($tree.Code -ne 0) { return 'unproven' }
    foreach ($line in $tree.Output) {
        $text = [string]$line
        if ($text.Trim() -eq '') { continue }
        # Full `ls-tree -r` format: "<mode> <type> <sha>\t<path>". A line that
        # does not match is git noise on the merged stderr stream (or an entry
        # this parse cannot read): unprovable, so the intake is unproven rather
        # than a false leak accusation.
        $m = [regex]::Match($text, '^(\d{6}) (?:blob|commit|tree) [0-9a-f]+\t(.+)$')
        if (-not $m.Success) { return 'unproven' }
        $mode = $m.Groups[1].Value
        if ($mode -ne '100644' -and $mode -ne '100755') { return 'leak' }
        # Strip only the line-ending artifact, then refuse any remaining fringe
        # whitespace: the rebase materializes the raw path, not a trimmed one
        # (Win32 drops a trailing space, NTFS keeps a leading one), so a screen
        # that trimmed its input would validate a different string than lands
        # on disk. A legitimate memory path carries no fringe whitespace.
        $candidate = ([string]$m.Groups[2].Value).TrimEnd("`r", "`n")
        if ($candidate -eq '' -or $candidate.StartsWith('"')) { return 'leak' }
        if ($candidate -ne $candidate.Trim()) { return 'leak' }
        foreach ($segment in ($candidate -replace '\\', '/' -split '/')) {
            if ($segment -eq '.' -or $segment -eq '..') { return 'leak' }
        }
        if (-not (Test-MemorySyncPathAllowed -RelativePath $candidate)) { return 'leak' }
    }
    return 'ok'
}

# Whether an existing lock belongs to a crashed run. A lock carries its
# owner's process id on the first line and an ISO timestamp on the second.
# Parsed, staleness turns on the owner rather than on age, and liveness is
# checked first: a live process whose start time is at or before the lock's
# timestamp is the real owner and is never stale, however long it runs or
# however the clock has since moved, so a slow fetch keeps its lock and a
# backward clock jump cannot let a rival steal it; a live process that started
# AFTER the lock holds a reused pid, so the true owner is gone and the lock is
# stale; and a pid with no process is stale at once. Only when the content
# cannot be parsed, or the owner's start time cannot be read, do the file's own
# write time, a future-timestamp check, and the 15-minute horizon decide, so a
# corrupt or unreadable lock still ages out instead of wedging the sync forever.
function Test-SyncLockStale {
    param([Parameter(Mandatory = $true)][string]$LockPath)
    $now = [DateTime]::UtcNow
    $lockPid = 0
    $lockAt = [DateTime]::MinValue
    $parsed = $false
    try {
        $lines = [System.IO.File]::ReadAllLines($LockPath)
        if ($lines.Count -ge 2 -and [int]::TryParse($lines[0].Trim(), [ref]$lockPid)) {
            $lockAt = [DateTime]::Parse($lines[1].Trim(), [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
            $parsed = $true
        }
    }
    catch {
        $parsed = $false
    }
    if ($parsed) {
        # Liveness is judged before any clock comparison: a live owner is the
        # arbiter, so a clock that jumped backward (which would make a live
        # lock's own timestamp read as "in the future") cannot let a rival
        # declare it stale and steal it mid-run.
        $owner = Get-Process -Id $lockPid -ErrorAction SilentlyContinue
        if ($null -ne $owner) {
            # A live owner whose start time predates the lock is the real owner,
            # and a real owner is never stale however long it runs: a slow first
            # fetch of a large store must not have its lock stolen, which would
            # start a second run mutating the same repository. A live owner that
            # started AFTER the lock was written holds a reused pid, so the true
            # owner is gone and the lock is stale. The grace is two seconds, for
            # clock-precision jitter between the process start and its lock
            # write, not the minute a reused pid could exploit.
            try {
                if ($owner.StartTime.ToUniversalTime() -le $lockAt.AddSeconds(2)) { return $false }
                return $true
            }
            catch {
                # An unreadable start time cannot distinguish owner from reuse:
                # fall back to the future/age horizon rather than trusting the
                # pid.
                if ($lockAt -gt $now.AddMinutes(1)) { return $true }
                return ($lockAt -lt $now.AddMinutes(-$script:SyncLockStaleMinutes))
            }
        }
        # No such process: the owner is gone, so the lock is stale at once.
        return $true
    }
    $item = Get-Item -LiteralPath $LockPath -ErrorAction SilentlyContinue
    if ($null -eq $item) { return $true }
    if ($item.LastWriteTimeUtc -lt $now.AddMinutes(-$script:SyncLockStaleMinutes)) { return $true }
    if ($item.LastWriteTimeUtc -gt $now.AddMinutes(1)) { return $true }
    return $false
}

# Record an outcome to the state file. lastOk moves only on success and
# firstFailSince marks where the current failure streak began: set on the
# first failure after a success (or when no state exists), preserved across
# later failures, cleared on success. The hook's seven-day soft nudge reads
# that field, so a streak that self-heals costs nothing and one that persists
# eventually surfaces. The write goes through a temp file and a rename, so a
# concurrent reader never sees a partial JSON; UTF-8 without a BOM, the same
# encoding the installer writes.
function Write-SyncState {
    param(
        [Parameter(Mandatory = $true)][string]$StoreRoot,
        [Parameter(Mandatory = $true)][string]$Result,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Reason
    )
    $statePath = Join-Path $StoreRoot 'kit-sync-state.json'
    $now = [DateTime]::UtcNow.ToString('o')
    $lastOk = ''
    $firstFailSince = ''
    try {
        if (Test-Path -LiteralPath $statePath -PathType Leaf) {
            $prior = [System.IO.File]::ReadAllText($statePath) | ConvertFrom-Json
            if ($null -ne $prior.lastOk) { $lastOk = [string]$prior.lastOk }
            if ($null -ne $prior.firstFailSince) { $firstFailSince = [string]$prior.firstFailSince }
        }
    }
    catch {
        # An unreadable prior state carries nothing forward; the streak
        # restarts rather than the write failing.
        $lastOk = ''
        $firstFailSince = ''
    }
    if ($Result -eq 'ok') {
        $lastOk = $now
        $firstFailSince = ''
    }
    elseif ($firstFailSince -eq '') {
        $firstFailSince = $now
    }
    $state = [ordered]@{
        lastAttempt    = $now
        lastResult     = $Result
        reason         = $Reason
        lastOk         = $lastOk
        firstFailSince = $firstFailSince
    }
    $json = ConvertTo-Json -InputObject $state -Compress
    $temp = Join-Path $StoreRoot ('kit-sync-state.json.tmp.' + $PID)
    try {
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($temp, $json, $utf8)
        # Replacing an existing file is atomic on NTFS, so a concurrent reader
        # never sees the state file absent; PowerShell's Move-Item -Force is a
        # delete-then-move, which opens exactly that gap. A first write has no
        # destination to replace and simply moves into place.
        if (Test-Path -LiteralPath $statePath -PathType Leaf) {
            [System.IO.File]::Replace($temp, $statePath, [NullString]::Value)
        }
        else {
            [System.IO.File]::Move($temp, $statePath)
        }
    }
    catch {
        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    }
}

# Record a gate outcome, except for the two reasons that mean the directory
# is not this system's repository at all: a foreign store (or a box with no
# git) gets no state file, because writing bookkeeping into a directory this
# script does not own is itself the pollution the gates exist to prevent.
function Write-SyncGateState {
    param(
        [Parameter(Mandatory = $true)][string]$StoreRoot,
        [Parameter(Mandatory = $true)][string]$Reason
    )
    if ($Reason -eq 'foreign' -or $Reason -eq 'git-missing') { return }
    Write-SyncState -StoreRoot $StoreRoot -Result 'gate' -Reason $Reason
}

$lockPath = Join-Path $StoreRoot 'kit-sync.lock'
$lockHeld = $false
try {
    # A live lock is a concurrent run: exit with the state file untouched,
    # because a run already in progress is not a failure and its own outcome
    # is the one worth recording. A stale lock is taken over by rename, so of
    # two runs that both judge it stale only the one whose rename lands
    # proceeds; the loser exits the same way the live-lock case does.
    if (Test-Path -LiteralPath $lockPath -PathType Leaf) {
        if (-not (Test-SyncLockStale -LockPath $lockPath)) { exit 0 }
        $staleName = 'kit-sync.lock.stale.' + $PID
        try {
            Rename-Item -LiteralPath $lockPath -NewName $staleName -ErrorAction Stop
        }
        catch {
            exit 0
        }
        Remove-Item -LiteralPath (Join-Path $StoreRoot $staleName) -Force -ErrorAction SilentlyContinue
    }
    try {
        # CreateNew is a true atomic exclusive create: the OS throws if the
        # file already exists, so two runs racing the same instant cannot both
        # proceed (New-Item's provider tests-then-creates, which is not
        # atomic). Losing that race to another run is the live-lock case again
        # and exits the same way.
        $lockBody = [string]$PID + "`n" + [DateTime]::UtcNow.ToString('o') + "`n"
        $lockStream = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $lockWritten = $false
        try {
            $lockBytes = [System.Text.Encoding]::ASCII.GetBytes($lockBody)
            $lockStream.Write($lockBytes, 0, $lockBytes.Length)
            $lockWritten = $true
        }
        catch { }
        finally {
            $lockStream.Dispose()
        }
        if (-not $lockWritten) {
            # The exclusive create landed but the body write did not (a full
            # disk): remove the empty lock now, since the exit-time cleanup only
            # deletes a lock whose first line is this pid, which an unwritten
            # body does not carry, so an empty lock would otherwise wedge every
            # run for the stale horizon.
            Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
            exit 0
        }
        $lockHeld = $true
    }
    catch {
        exit 0
    }

    . (Join-Path $PSScriptRoot 'install-memory-sync.ps1')

    $status = Get-MemorySyncStatus -StoreRoot $StoreRoot

    # Foreign or git-missing is settled first, because those two write no state
    # at all: a by-hand run against a directory the kit does not own must leave
    # nothing behind, not even the in-progress deferral's bookkeeping below.
    $gate = Get-SyncGateReason -Status $status
    if ($gate -eq 'foreign' -or $gate -eq 'git-missing') {
        Write-SyncGateState -StoreRoot $StoreRoot -Reason $gate
        exit 0
    }

    # An operation left paused in the store (a merge, cherry-pick, revert,
    # rebase, or `git am`), or any unmerged index at all, defers the whole run
    # rather than committing: Install-MemorySyncRepo's `git add -A` would
    # otherwise stage conflict-markered content and its commit would bake the
    # markers into memory files and push them to every machine; a paused rebase
    # would also take the loud 'detached' gate whose doctor -Fix remedy does not
    # apply. The git dir is resolved through git so this holds for a linked
    # worktree too, and it fails closed: git may emit a warning first on the
    # merged stderr stream, so the result is the last line, and a value that is
    # not an existing directory defers rather than skipping the guard. This runs
    # after the ownership gate and before the rest, so a paused rebase defers
    # rather than gating detached.
    $gitDirRes = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @('rev-parse', '--absolute-git-dir')
    $storeGitDir = if ($gitDirRes.Code -eq 0 -and $gitDirRes.Output.Count -gt 0) { ([string]$gitDirRes.Output[-1]).Trim() } else { '' }
    if (-not (Test-Path -LiteralPath $storeGitDir -PathType Container)) {
        Write-SyncState -StoreRoot $StoreRoot -Result 'transient' -Reason 'unproven'
        exit 0
    }
    foreach ($opMarker in @('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply')) {
        if (Test-Path -LiteralPath (Join-Path $storeGitDir $opMarker)) {
            Write-SyncState -StoreRoot $StoreRoot -Result 'transient' -Reason 'unproven'
            exit 0
        }
    }
    $unmerged = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @('ls-files', '--unmerged')
    if ($unmerged.Code -ne 0 -or (@($unmerged.Output | Where-Object { ([string]$_).Trim() -ne '' }).Count -gt 0)) {
        # Any unmerged index entry is a conflict no marker file names (a stash
        # pop, checkout -m, apply -3); a non-zero exit is indeterminate. Either
        # way, defer rather than commit over it.
        Write-SyncState -StoreRoot $StoreRoot -Result 'transient' -Reason 'unproven'
        exit 0
    }

    if ($gate -ne '') {
        Write-SyncGateState -StoreRoot $StoreRoot -Reason $gate
        exit 0
    }

    # A dirty probe that did not answer leaves the commit question open, and
    # an open question is not a license to skip the commit or to guess: fail
    # closed as a transient and let the next run re-ask.
    if (-not $status.DirtyKnown) {
        Write-SyncState -StoreRoot $StoreRoot -Result 'transient' -Reason 'unproven'
        exit 0
    }

    # The bar holds, so pending worktree changes commit through the
    # installer's own gated path: both managed files are already Canonical
    # here, which reduces that function to the ownership-marker refresh, the
    # pre/post-add index gates, and the commit itself.
    if ($status.Dirty) {
        $repair = Install-MemorySyncRepo -StoreRoot $StoreRoot
        if (-not $repair.Ok) {
            # One installer refusal carries its own fixed reason: a staged write
            # under another machine's coordinator directory, which is a standing
            # condition the operator repairs rather than a transient the next
            # run might clear, so it is recorded as a gate under its own code
            # and every other refusal keeps the commit-failed transient.
            if ($repair.Reason -eq 'outbound-foreign-write') {
                Write-SyncGateState -StoreRoot $StoreRoot -Reason 'outbound-foreign-write'
            }
            else {
                Write-SyncState -StoreRoot $StoreRoot -Result 'transient' -Reason 'commit-failed'
            }
            exit 0
        }
    }

    # No upstream is the deliberate commit-only mode (a store the operator
    # keeps remote-less), so the run is done after the commit step.
    if ($status.Upstream -ne '') {
        $fetch = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @('fetch', '--quiet')
        if ($fetch.Code -ne 0) {
            Write-SyncState -StoreRoot $StoreRoot -Result 'transient' -Reason 'fetch-failed'
            exit 0
        }
        # Resolve the fetched upstream to a fixed commit once, then screen and
        # rebase THAT commit rather than the symbolic @{upstream}: a concurrent
        # fetch (an operator's own pull, or a rival run) could otherwise advance
        # the ref between the screen and the rebase and materialize a tree the
        # screen never saw.
        $revUp = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @('rev-parse', '--verify', '@{upstream}')
        $upstreamSha = if ($revUp.Output.Count -gt 0) { ([string]$revUp.Output[-1]).Trim() } else { '' }
        # Fail closed on anything that is not a real object id: a nonzero exit, a
        # blank line, or a git warning on the merged stream would otherwise let
        # a later `<value>...HEAD` read as 0/0 and a false converged 'ok'.
        if ($upstreamSha -cnotmatch $script:MemorySyncObjectIdPattern) {
            Write-SyncState -StoreRoot $StoreRoot -Result 'transient' -Reason 'unproven'
            exit 0
        }
        $counts = Get-SyncAheadBehind -StoreRoot $StoreRoot -Ref $upstreamSha
        if (-not $counts.Ok) {
            Write-SyncState -StoreRoot $StoreRoot -Result 'transient' -Reason 'unproven'
            exit 0
        }
        if ($counts.Behind -gt 0) {
            # Every incoming entry (mode and path) is screened before the rebase
            # touches the tree: a disallowed entry another machine pushed would
            # otherwise land in the live store root, where nothing un-writes it.
            # The fetched ref is left in place on a refusal on purpose: deleting
            # it would make the store read converged and silently stop syncing
            # while the operator-facing gate line vanished. Left in place, the
            # store stays loudly gated until the operator fixes the remote. The
            # next run's own top-of-run history probe (rev-list --objects, scoped
            # to local branches and tags) does not see the refused tip, so the
            # gate reason stays the honest 'inbound-leak'. A tree that cannot be
            # listed at all is unproven, not a leak, so it retries silently
            # rather than nagging.
            $incoming = Test-SyncIncomingAllowed -StoreRoot $StoreRoot -Ref $upstreamSha
            if ($incoming -eq 'leak') {
                Write-SyncState -StoreRoot $StoreRoot -Result 'gate' -Reason 'inbound-leak'
                exit 0
            }
            if ($incoming -ne 'ok') {
                Write-SyncState -StoreRoot $StoreRoot -Result 'transient' -Reason 'unproven'
                exit 0
            }
            # The machine axis on the inbound side, after the allowlist screen
            # and before the rebase. The screen above reads the whole incoming
            # tree, which holds every machine's coordinator directory on every
            # sync, so it cannot see that a commit rewrites THIS machine's
            # board, registry entry or request inbox: only the difference
            # between the merge base and the incoming commit says that. The
            # coordinator directory's contract is single-writer, and a cold
            # successor seat resumes this whole machine from a board it must be
            # able to trust, so a replayed foreign write into it stands the
            # intake down exactly as a leak does: no rebase, no push, and the
            # fetched tip left in place so the gate stays visible and the doctor
            # can name the commit and the paths. A read that could not answer is
            # unproven and retries silently, never a refusal the operator cannot
            # clear.
            $machineName = ''
            try { $machineName = [string](Get-MemorySyncMachineName) } catch { $machineName = '' }
            $inboundOwn = Get-MemorySyncInboundForeignPaths -StoreRoot $StoreRoot -Ref $upstreamSha -Machine $machineName
            if (-not $inboundOwn.Ok) {
                Write-SyncState -StoreRoot $StoreRoot -Result 'transient' -Reason 'unproven'
                exit 0
            }
            if (@($inboundOwn.Paths).Count -gt 0) {
                Write-SyncGateState -StoreRoot $StoreRoot -Reason 'inbound-foreign-write'
                exit 0
            }
            # No --autostash: the commit step above already committed pending
            # memories, so the tree is clean here except for a memq write that
            # landed in the narrow window since. A rebase then fails cleanly
            # (git refuses a dirty rebase) and the next run commits that write
            # first, rather than autostashing content a conflicting reapply
            # would strand in the stash where nothing ever pops it.
            $rebase = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @('rebase', $upstreamSha)
            if ($rebase.Code -ne 0) {
                # A rebase that left its state directory behind is a genuine
                # content conflict and is aborted so the worktree is left
                # exactly as this run found it; a rebase that failed without
                # ever starting (a dirty tree, a plumbing error) is of
                # indeterminate outcome, recorded unproven rather than naming an
                # operation that did not fail.
                $conflicted = (Test-Path -LiteralPath (Join-Path $storeGitDir 'rebase-merge')) -or
                (Test-Path -LiteralPath (Join-Path $storeGitDir 'rebase-apply'))
                if ($conflicted) {
                    $null = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @('rebase', '--abort')
                    Write-SyncState -StoreRoot $StoreRoot -Result 'transient' -Reason 'pull-conflict'
                }
                else {
                    Write-SyncState -StoreRoot $StoreRoot -Result 'transient' -Reason 'unproven'
                }
                exit 0
            }
            # The rebase brought other machines' commits into local history,
            # so the whole bar is re-derived before anything is published:
            # the inbound screen covers the incoming entries, and this re-check
            # covers everything else the bar guards, so nothing that fails it is
            # forwarded by the push.
            $status = Get-MemorySyncStatus -StoreRoot $StoreRoot
            $gate = Get-SyncGateReason -Status $status
            if ($gate -ne '') {
                Write-SyncGateState -StoreRoot $StoreRoot -Reason $gate
                exit 0
            }
            $counts = Get-SyncAheadBehind -StoreRoot $StoreRoot -Ref $upstreamSha
            if (-not $counts.Ok) {
                Write-SyncState -StoreRoot $StoreRoot -Result 'transient' -Reason 'unproven'
                exit 0
            }
        }
        if ($counts.Ahead -gt 0) {
            $push = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @('push', '--quiet')
            if ($push.Code -ne 0) {
                Write-SyncState -StoreRoot $StoreRoot -Result 'transient' -Reason 'push-failed'
                exit 0
            }
        }
    }

    # Nothing to do counts as success: a clean, in-sync store is the outcome
    # this script exists to maintain.
    Write-SyncState -StoreRoot $StoreRoot -Result 'ok' -Reason ''
}
catch {
    # An unexpected failure has no honest enum code, and this script's
    # contract is silence: the state file keeps whatever it held, and the
    # next session start retries.
}
finally {
    # Removal is PID-checked: a run that overstayed the stale horizon and was
    # taken over must not delete the successor's lock on its way out.
    if ($lockHeld) {
        try {
            $lockLines = [System.IO.File]::ReadAllLines($lockPath)
            if ($lockLines.Count -ge 1 -and $lockLines[0].Trim() -eq [string]$PID) {
                Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
            }
        }
        catch {
        }
    }
}
exit 0
