# Reports tool-call processes that outlived their session, and ends a reported one once the task's
# action says so. This is the script the KitOrphanSweep scheduled task runs every fifteen minutes,
# under Windows PowerShell 5.1:
#
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File bin\orphan-sweep.ps1 -FindingsPath <path> [-MinAgeHours <n>] [-EndAfterHours <n>] [-RepeatHours <n>]
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File bin\orphan-sweep.ps1 -Report [-MinAgeHours <n>]
#
# The script reads the process table once through Get-CimInstance Win32_Process, applies the rule
# in Select-OrphanRoots (bin/orphan-sweep-functions.ps1) with the allowlist beside it
# (bin/orphan-sweep-allowlist.json), and writes one record per event. A finding is a hypothesis
# for the operator; the end is the operator's own switch.
#
# Every record is one line of compact JSON with a non-empty id and a kind. A found record (kind
# "found", the line a root gets the first time it is flagged) carries id (<pid>-<CreationDate
# ticks>), at (the write time), pid, image, commandLine (a string, or null where none was readable),
# createdAt, ageHours, cpuSeconds (the whole tree's), tree (the subtree's pids, root first) and
# rule. A still record (kind "still", id <root id>-still-<n>) is written for a root that lives on,
# once every -RepeatHours after its last notice, and carries the same fields plus
# cpuSecondsSinceNotice and noticeHours. An ended record (kind "ended", id <root id>-ended-<ticks of
# the sweep>) is written for every end attempt and carries the same fields plus ended, the pids
# ended, and refused, pid-and-reason pairs for the pids left alone.
#
# The end rule. A tree is ended only when all of these hold: -EndAfterHours was given, so a run
# without it is report-only whatever else is bound; the root is flagged by the four clauses this
# sweep; its seen entry carries a firstSeen from an earlier sweep;
# at least -EndAfterHours hours have passed since firstSeen, or since lastEnded where an attempt was
# made before, zero allowed; each pid is read again from the live table at the moment of the end
# and left alone where its creation time differs from the row this sweep read, so a reused id is
# never ended; and the sweeper's own pid, its ancestors read from the live table, and pids 0 and 4
# are never ended whatever the rows say. Every process-ending call sits inside Stop-OrphanTree and
# nowhere else. A survivor keeps its seen entry, with ends and lastEnded recorded, so its still
# records keep climbing and the next attempt comes a grace after lastEnded. A member of the tree
# whose command line carries an allowlisted token is never ended, and neither is any pid below it in
# the tree, so a keeper started under a flagged root lives on.
#
# Without -Report the lines are appended to -FindingsPath, whose directory is created where absent,
# and the seen file beside it, <FindingsPath>.seen.json, is rewritten with the roots flagged now and
# every prior entry whose process still lives. The status file, <FindingsPath>.status.json, is
# written last as { at, exit, fault, rows, flagged, written, ended }, and a fault writes it before
# exiting, so the persona plugin's drain can tell a sweep that failed from one that stopped landing.
# The status write never creates the findings directory, so a fault before that directory exists
# leaves no file and the drain's stale notice covers it. -Report neither reads nor writes the seen
# file, ends nothing, writes no status and prints every flagged root's line to stdout, so a hand run
# shows the whole live set and consumes nothing the task would write. Every file is written as UTF-8
# without a byte-order mark, since the drain parses each line as JSON.
#
# Exit codes: 0 on a completed sweep; 1 on a fault of the script's own (no -FindingsPath without
# -Report, an allowlist or seen file that cannot be read, a write that fails); 2 when the process
# table cannot be read, in which case nothing but the status file is written, and that only where
# the findings directory exists.
#
# [CmdletBinding()] makes an unknown switch a binding error (exit 1) rather than a value that lands
# in $args while the body runs anyway.
[CmdletBinding()]
param(
    # Required unless -Report. Checked in the body rather than marked Mandatory, because a Mandatory
    # parameter left off the command line opens a prompt that a scheduled task has no console to answer.
    [string]$FindingsPath,
    [ValidateRange(0, [double]::MaxValue)]
    [double]$MinAgeHours = 3,
    # The switch that turns the end on. Left off the command line, the sweep is report-only. Given,
    # a root reported in an earlier sweep and still flagged is ended once this many hours have passed
    # since it was first reported, or since the last attempt on it. Zero is allowed.
    [ValidateRange(0, [double]::MaxValue)]
    [double]$EndAfterHours,
    # Hours between repeat notices for a root that lives on after its first report.
    [ValidateRange(0, [double]::MaxValue)]
    [double]$RepeatHours = 1,
    [switch]$Report,
    # Test seam: a JSON array of rows with the Win32_Process property names, CreationDate as an ISO
    # 8601 string, read in place of the process table so the unit test drives this script on fixture
    # rows. A task never passes it. The protected set and each pid's re-read before an end still come
    # from the live table, so a fixture can never talk the sweeper into ending its own chain.
    [string]$RowsPath
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'orphan-sweep-functions.ps1')

$allowlistPath = Join-Path $PSScriptRoot 'orphan-sweep-allowlist.json'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$invariant = [System.Globalization.CultureInfo]::InvariantCulture
$counts = @{ rows = 0; flagged = 0; written = 0; ended = 0 }

# The status record. The text lands in a temp file beside the status path and is moved over it in
# one step, so the drain, which reads the file on every pass, never sees a half-written status and
# posts a false unreadable fault. A status write that fails is said on stderr and changes nothing
# else, since the drain's stale notice covers a status that never lands.
function Write-OrphanStatus {
    param([Parameter(Mandatory)][int]$Code, $Fault = $null)
    if ($Report -or [string]::IsNullOrEmpty($FindingsPath)) { return }
    try {
        $faultText = $null
        if (-not [string]::IsNullOrEmpty([string]$Fault)) { $faultText = [string]$Fault }
        $record = [ordered]@{
            at      = (Get-Date).ToString('o', $invariant)
            exit    = $Code
            fault   = $faultText
            rows    = [int]$counts.rows
            flagged = [int]$counts.flagged
            written = [int]$counts.written
            ended   = [int]$counts.ended
        }
        $statusPath = $FindingsPath + '.status.json'
        $tempPath = $statusPath + '.tmp'
        [System.IO.File]::WriteAllText($tempPath, (ConvertTo-Json -InputObject $record -Compress -Depth 2) + "`n", $utf8NoBom)
        if (Test-Path -LiteralPath $statusPath) {
            [System.IO.File]::Replace($tempPath, $statusPath, [NullString]::Value)
        } else {
            [System.IO.File]::Move($tempPath, $statusPath)
        }
    } catch {
        [Console]::Error.WriteLine('orphan-sweep: writing the status file failed: ' + $_.Exception.Message)
    }
}

function Exit-Fault {
    param([Parameter(Mandatory)][string]$Text, [Parameter(Mandatory)][int]$Code)
    [Console]::Error.WriteLine('orphan-sweep: ' + $Text)
    Write-OrphanStatus -Code $Code -Fault $Text
    exit $Code
}

if (-not $Report -and [string]::IsNullOrEmpty($FindingsPath)) {
    Exit-Fault -Text '-FindingsPath is required unless -Report is given' -Code 1
}

try {
    # Parenthesized so Windows PowerShell 5.1, whose ConvertFrom-Json emits an array as one object,
    # yields the entries one by one.
    $allowlist = @((Get-Content -LiteralPath $allowlistPath -Raw -Encoding UTF8 | ConvertFrom-Json))
} catch {
    Exit-Fault -Text ('the allowlist ' + $allowlistPath + ' could not be read: ' + $_.Exception.Message) -Code 1
}

$now = Get-Date
$stamp = $now.ToString('o', $invariant)
try {
    if ([string]::IsNullOrEmpty($RowsPath)) {
        $rows = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, Name, CreationDate, CommandLine, KernelModeTime, UserModeTime)
    } else {
        $rows = @((Get-Content -LiteralPath $RowsPath -Raw -Encoding UTF8 | ConvertFrom-Json) | ForEach-Object {
            $created = $null
            if ($null -ne $_.CreationDate) {
                $created = [DateTime]::Parse([string]$_.CreationDate, $invariant, [System.Globalization.DateTimeStyles]::RoundtripKind).ToLocalTime()
            }
            [pscustomobject]@{
                ProcessId       = [int]$_.ProcessId
                ParentProcessId = [int]$_.ParentProcessId
                Name            = [string]$_.Name
                CreationDate    = $created
                CommandLine     = $_.CommandLine
                KernelModeTime  = [uint64]$_.KernelModeTime
                UserModeTime    = [uint64]$_.UserModeTime
            }
        })
    }
    # A live table always holds this process at least, so an empty reading is a failed one; taking
    # it would drop every seen entry and report each live orphan again on the next sweep.
    if ($rows.Count -eq 0) { throw 'the reading returned no rows' }
} catch {
    Exit-Fault -Text ('the process table could not be read: ' + $_.Exception.Message) -Code 2
}
$counts.rows = $rows.Count

$roots = Select-OrphanRoots -Rows $rows -Now $now -Allowlist $allowlist -MinAgeHours $MinAgeHours
$counts.flagged = $roots.Count
$rule = 'dead-parent runtime over ' + $MinAgeHours.ToString($invariant) + 'h not allowlisted'

# One record as a line of compact JSON: the root's fields under -Id and -Kind, then -Extra's pairs.
# Every field is data copied from the row; nothing here builds text for a channel.
function ConvertTo-OrphanRecordLine {
    param(
        [Parameter(Mandatory)][object]$Root,
        [Parameter(Mandatory)][string]$Kind,
        [Parameter(Mandatory)][string]$Id,
        [System.Collections.IDictionary]$Extra = @{}
    )
    $row = $Root.Row
    $commandLine = $null
    if ($null -ne $row.CommandLine) { $commandLine = [string]$row.CommandLine }
    $record = [ordered]@{
        id          = $Id
        kind        = $Kind
        at          = (Get-Date).ToString('o', $invariant)
        pid         = [int]$row.ProcessId
        image       = [string]$row.Name
        commandLine = $commandLine
        createdAt   = ([DateTime]$row.CreationDate).ToString('o', $invariant)
        ageHours    = [Math]::Round(($now.ToUniversalTime() - ([DateTime]$row.CreationDate).ToUniversalTime()).TotalHours, 2)
        cpuSeconds  = [Math]::Round([double]$Root.CpuSeconds, 3)
        tree        = [int[]]@($Root.Tree)
        rule        = $rule
    }
    foreach ($key in $Extra.Keys) { $record[[string]$key] = $Extra[$key] }
    return ConvertTo-Json -InputObject $record -Compress -Depth 4
}

function ConvertTo-OrphanFindingLine {
    param([Parameter(Mandatory)][object]$Root)
    return ConvertTo-OrphanRecordLine -Root $Root -Kind 'found' -Id (Get-OrphanId -Row $Root.Row)
}

if ($Report) {
    foreach ($root in $roots) { Write-Output (ConvertTo-OrphanFindingLine -Root $root) }
    exit 0
}

# The pids no sweep ends: 0 and 4, this process and every ancestor of it, read by following
# ParentProcessId up the live table and never the rows this sweep classified. The walk stops at a
# parent created after its child, since that id was reused and names no ancestor.
function Get-OrphanProtectedIds {
    $table = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, CreationDate)
    $byPid = @{}
    foreach ($p in $table) { $byPid[[int]$p.ProcessId] = $p }
    $set = New-Object 'System.Collections.Generic.HashSet[int]'
    [void]$set.Add(0)
    [void]$set.Add(4)
    $id = [int]$PID
    while ($set.Add($id) -and $byPid.ContainsKey($id)) {
        $node = $byPid[$id]
        $parent = $byPid[[int]$node.ParentProcessId]
        if ($null -eq $parent -or ($null -ne $parent.CreationDate -and $null -ne $node.CreationDate -and $parent.CreationDate -gt $node.CreationDate)) { break }
        $id = [int]$parent.ProcessId
    }
    return , $set
}

# Ends one overdue tree, root first and then the rest in tree order, under the end rule in the
# header. Returns a hashtable: Ended, the pids ended; Refused, one @{ pid; reason } per pid left alone.
function Stop-OrphanTree {
    param(
        [Parameter(Mandatory)][object]$Root,
        [Parameter(Mandatory)][hashtable]$RowsById,
        [Parameter(Mandatory)][System.Collections.Generic.HashSet[int]]$Protected,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Allowlist
    )
    $ended = New-Object 'System.Collections.Generic.List[int]'
    $refused = New-Object 'System.Collections.Generic.List[object]'
    $spared = Get-OrphanAllowlistedIds -Tree $Root.Tree -RowsById $RowsById -Allowlist $Allowlist
    foreach ($id in $Root.Tree) {
        $id = [int]$id
        $reason = $null
        if ($Protected.Contains($id)) {
            $reason = 'protected: the sweeper, an ancestor of it, or a system pid'
        } elseif ($spared.ContainsKey($id)) {
            $reason = $spared[$id]
        } else {
            $row = $RowsById[$id]
            try {
                # The identity check is per pid at the moment of the end: the pid is read again from
                # the live table, and only an instance whose creation time equals the row this sweep
                # read is handed to Terminate. A pid number alone is never enough.
                $live = @(Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = ' + $id) -Property ProcessId, CreationDate) | Select-Object -First 1
                if ($null -eq $live) {
                    $reason = 'gone: no live process holds the pid'
                } elseif ($null -eq $row -or $null -eq $row.CreationDate -or $null -eq $live.CreationDate -or ([DateTime]$live.CreationDate).ToUniversalTime() -ne ([DateTime]$row.CreationDate).ToUniversalTime()) {
                    $reason = 'reused: the live creation time differs from the row the sweep read'
                } else {
                    $result = Invoke-CimMethod -InputObject $live -MethodName Terminate -Arguments @{ Reason = [uint32]1 }
                    if ($null -eq $result -or [int]$result.ReturnValue -ne 0) {
                        $code = 'none'
                        if ($null -ne $result) { $code = [string]$result.ReturnValue }
                        $reason = 'Terminate returned ' + $code
                    }
                }
            } catch {
                $reason = 'the end failed: ' + $_.Exception.Message
            }
        }
        if ($null -eq $reason) { $ended.Add($id) } else { $refused.Add([ordered]@{ pid = $id; reason = $reason }) }
    }
    return @{ Ended = $ended.ToArray(); Refused = $refused.ToArray() }
}

$seenPath = $FindingsPath + '.seen.json'
$seen = @{}
try {
    if (Test-Path -LiteralPath $seenPath) {
        $parsed = Get-Content -LiteralPath $seenPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -ne $parsed) {
            foreach ($p in $parsed.PSObject.Properties) {
                $entry = @{}
                if ($null -ne $p.Value) { foreach ($f in $p.Value.PSObject.Properties) { $entry[[string]$f.Name] = $f.Value } }
                $seen[$p.Name] = $entry
            }
        }
    }
    $seenArgs = @{ RepeatHours = $RepeatHours }
    if ($PSBoundParameters.ContainsKey('EndAfterHours')) { $seenArgs.EndAfterHours = $EndAfterHours }
    $update = Update-OrphanSeen -Seen $seen -Roots $roots -Rows $rows -Now $now @seenArgs
} catch {
    Exit-Fault -Text ('the seen file ' + $seenPath + ' could not be read or updated: ' + $_.Exception.Message) -Code 1
}

$lines = New-Object 'System.Collections.Generic.List[string]'
foreach ($root in $update.Write) { $lines.Add((ConvertTo-OrphanFindingLine -Root $root)) }
foreach ($due in $update.Repeat) {
    $rootId = Get-OrphanId -Row $due.Root.Row
    $lines.Add((ConvertTo-OrphanRecordLine -Root $due.Root -Kind 'still' -Id ($rootId + '-still-' + ([int]$due.Notice).ToString($invariant)) -Extra ([ordered]@{
        cpuSecondsSinceNotice = [Math]::Round([double]$due.CpuSecondsSinceNotice, 3)
        noticeHours           = [Math]::Round([double]$due.NoticeHours, 2)
    })))
}

# The ends come before any write, so a tree is ended on the reading that found it overdue and the
# seen entry records the attempt whatever the outcome.
if ($update.Overdue.Count -gt 0) {
    try {
        $protected = Get-OrphanProtectedIds
    } catch {
        Exit-Fault -Text ('the process table could not be read: ' + $_.Exception.Message) -Code 2
    }
    $rowsById = @{}
    foreach ($row in $rows) { $rowsById[[int]$row.ProcessId] = $row }
    foreach ($root in $update.Overdue) {
        $outcome = Stop-OrphanTree -Root $root -RowsById $rowsById -Protected $protected -Allowlist $allowlist
        $counts.ended += $outcome.Ended.Count
        $rootId = Get-OrphanId -Row $root.Row
        $lines.Add((ConvertTo-OrphanRecordLine -Root $root -Kind 'ended' -Id ($rootId + '-ended-' + $now.Ticks.ToString($invariant)) -Extra ([ordered]@{
            ended   = [int[]]@($outcome.Ended)
            refused = [object[]]@($outcome.Refused)
        })))
        $entry = $update.Seen[$rootId]
        $entry['ends'] = [int]$entry['ends'] + 1
        $entry['lastEnded'] = $stamp
    }
}

try {
    $dir = Split-Path -Parent $FindingsPath
    if (-not [string]::IsNullOrEmpty($dir) -and -not (Test-Path -LiteralPath $dir)) {
        [void](New-Item -ItemType Directory -Path $dir -Force)
    }
    # Records land before the seen file, so a failed seen write repeats a record rather than losing
    # one; the drain's ack file skips an id it has already delivered.
    if ($lines.Count -gt 0) {
        $text = New-Object System.Text.StringBuilder
        foreach ($line in $lines) { [void]$text.Append($line).Append("`n") }
        [System.IO.File]::AppendAllText($FindingsPath, $text.ToString(), $utf8NoBom)
    }
    $counts.written = $lines.Count
    $seenJson = ConvertTo-Json -InputObject $update.Seen -Compress -Depth 4
    [System.IO.File]::WriteAllText($seenPath, $seenJson + "`n", $utf8NoBom)
} catch {
    Exit-Fault -Text ('writing ' + $FindingsPath + ' failed: ' + $_.Exception.Message) -Code 1
}
Write-OrphanStatus -Code 0
exit 0
