# Pure functions of the orphan sweeper. Dot-sourced by bin/orphan-sweep.ps1, the wrapper the
# KitOrphanSweep scheduled task runs, and by test-personas/orphan-sweep-unit-test.mjs, so the rule
# and the seen-set bookkeeping exist once.
#
#   . (Join-Path $PSScriptRoot 'orphan-sweep-functions.ps1')
#
# Nothing here reads the process table, writes a file or touches a process. The functions take
# rows shaped as Win32_Process reports them (ProcessId, ParentProcessId, Name, CreationDate as a
# DateTime, CommandLine, KernelModeTime and UserModeTime in 100-nanosecond units) and return data.
# The sweeper reports and stops nothing. Runs under Windows PowerShell 5.1.

# The images the rule names, by Name without the .exe suffix: the script and tool runtimes a tool
# call starts. Every other image, claude.exe and env.exe among them, is outside the rule.
$script:OrphanRuntimeImages = @('bash', 'sh', 'python', 'python3', 'node', 'pwsh', 'powershell', 'cmd', 'dotnet')

# Win32_Process reports KernelModeTime and UserModeTime in 100-nanosecond units.
$script:OrphanTicksPerSecond = 10000000

<#
.SYNOPSIS
Returns the file name of every whitespace- or quote-delimited token of a command line.

.DESCRIPTION
A token's file name is the text after its last forward or back slash. A null or empty command
line has no tokens. The allowlist matches on these names and never on a substring of the line,
so a shell whose arguments merely mention an allowlisted script is not spared.
#>
function Get-OrphanTokenNames {
    param([AllowNull()][string]$CommandLine)
    $names = New-Object 'System.Collections.Generic.List[string]'
    if ([string]::IsNullOrEmpty($CommandLine)) { return , $names.ToArray() }
    foreach ($token in [regex]::Split($CommandLine, '[\s"'']+')) {
        if ($token.Length -eq 0) { continue }
        $cut = $token.LastIndexOfAny([char[]]@('/', '\'))
        $names.Add($token.Substring($cut + 1))
    }
    return , $names.ToArray()
}

<#
.SYNOPSIS
Classifies a process table and returns each flagged root with its subtree and the tree's CPU seconds.

.DESCRIPTION
A row is a flagged root when all four clauses hold, checked in this order:
  image      its Name without .exe is one of -Images (ordinal, case-insensitive);
  parent     its ParentProcessId names no row, or names a row created after it, which is a reused id;
  age        its CreationDate is more than -MinAgeHours hours before -Now;
  allowlist  no -Allowlist entry's match equals the file name of one token of its CommandLine.
A row with no CreationDate cannot be aged and is refused by the age clause.

The subtree comes from one parent-to-children map built once over the table. The map holds no edge
whose parent row was created after its child, so a reused-id orphan is a root of its own and never
appears inside another root's tree. The walk is breadth-first from the root, so Tree lists the root
first, and a visited set keeps a malformed table from looping.

Returns an array of PSCustomObjects, one per flagged root, in table order: Row (the root's row),
Tree (an int array of the subtree's process ids, root first) and CpuSeconds (KernelModeTime plus
UserModeTime summed over the tree, in seconds). Where -Refusals is given, each refused row's
ProcessId is set in it to the name of the clause that refused it, so a caller can tell which
clause kept a row out.
#>
function Select-OrphanRoots {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Rows,
        [Parameter(Mandatory)][DateTime]$Now,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Allowlist,
        [string[]]$Images = $script:OrphanRuntimeImages,
        [double]$MinAgeHours = 3,
        [hashtable]$Refusals
    )
    $imageSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($i in $Images) { [void]$imageSet.Add($i) }
    $allowSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $Allowlist) { [void]$allowSet.Add([string]$entry.match) }

    $byPid = @{}
    foreach ($row in $Rows) { $byPid[[int]$row.ProcessId] = $row }

    # One pass builds the children map. A parent is live for a row where its row exists and was
    # not created after the row; a row naming itself as parent carries no edge.
    $children = @{}
    $liveParent = @{}
    foreach ($row in $Rows) {
        $id = [int]$row.ProcessId
        $parent = $byPid[[int]$row.ParentProcessId]
        $live = $null -ne $parent -and ($null -eq $parent.CreationDate -or $null -eq $row.CreationDate -or $parent.CreationDate -le $row.CreationDate)
        $liveParent[$id] = $live
        if ($live -and [int]$parent.ProcessId -ne $id) {
            $key = [int]$parent.ProcessId
            if (-not $children.ContainsKey($key)) { $children[$key] = New-Object 'System.Collections.Generic.List[object]' }
            $children[$key].Add($row)
        }
    }

    $roots = New-Object 'System.Collections.Generic.List[object]'
    foreach ($row in $Rows) {
        $id = [int]$row.ProcessId
        $image = [string]$row.Name
        if ($image.EndsWith('.exe', [System.StringComparison]::OrdinalIgnoreCase)) { $image = $image.Substring(0, $image.Length - 4) }
        $clause = $null
        if (-not $imageSet.Contains($image)) { $clause = 'image' }
        elseif ($liveParent[$id]) { $clause = 'parent' }
        elseif ($null -eq $row.CreationDate -or ($Now.ToUniversalTime() - ([DateTime]$row.CreationDate).ToUniversalTime()).TotalHours -le $MinAgeHours) { $clause = 'age' }
        else {
            foreach ($name in (Get-OrphanTokenNames -CommandLine $row.CommandLine)) {
                if ($allowSet.Contains($name)) { $clause = 'allowlist'; break }
            }
        }
        if ($null -ne $clause) {
            if ($null -ne $Refusals) { $Refusals[$id] = $clause }
            continue
        }

        $tree = New-Object 'System.Collections.Generic.List[int]'
        $visited = New-Object 'System.Collections.Generic.HashSet[int]'
        $queue = New-Object 'System.Collections.Generic.Queue[object]'
        $queue.Enqueue($row)
        [void]$visited.Add($id)
        $ticks = [double]0
        while ($queue.Count -gt 0) {
            $node = $queue.Dequeue()
            $nodeId = [int]$node.ProcessId
            $tree.Add($nodeId)
            $ticks += [double]$node.KernelModeTime + [double]$node.UserModeTime
            if ($children.ContainsKey($nodeId)) {
                foreach ($child in $children[$nodeId]) {
                    if ($visited.Add([int]$child.ProcessId)) { $queue.Enqueue($child) }
                }
            }
        }
        $roots.Add([pscustomobject]@{
            Row        = $row
            Tree       = $tree.ToArray()
            CpuSeconds = $ticks / $script:OrphanTicksPerSecond
        })
    }
    return , $roots.ToArray()
}

<#
.SYNOPSIS
Returns the id the sweeper gives a process: its pid and its CreationDate's DateTime.Ticks.

.DESCRIPTION
Windows hands a process id out again once its holder is gone, so the creation ticks tell this
process from any other that held the same id.
#>
function Get-OrphanId {
    param([Parameter(Mandatory)][object]$Row)
    return ([string][int]$Row.ProcessId) + '-' + ([DateTime]$Row.CreationDate).Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture)
}

<#
.SYNOPSIS
Splits the flagged roots into those to write and carries the seen set forward.

.DESCRIPTION
-Seen is a hashtable keyed by id whose values carry lastSeen. A root whose id is already in it is
not written again. The returned set keeps a prior entry only while a live row still carries its id,
so an entry whose process is gone, or whose pid now names a later process, is dropped and the set
stays the size of the live orphan set. Every root flagged now is in the returned set with lastSeen
set to -Now.

Returns a hashtable: Write is the array of roots not seen before, in the order given; Seen is the
new hashtable of id to @{ lastSeen = <ISO 8601> }.
#>
function Update-OrphanSeen {
    param(
        [Parameter(Mandatory)][hashtable]$Seen,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Roots,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Rows,
        [Parameter(Mandatory)][DateTime]$Now
    )
    $liveIds = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    foreach ($row in $Rows) {
        if ($null -ne $row.CreationDate) { [void]$liveIds.Add((Get-OrphanId -Row $row)) }
    }
    $next = @{}
    foreach ($key in $Seen.Keys) {
        if ($liveIds.Contains([string]$key)) { $next[[string]$key] = $Seen[$key] }
    }
    $write = New-Object 'System.Collections.Generic.List[object]'
    $stamp = $Now.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    foreach ($root in $Roots) {
        $id = Get-OrphanId -Row $root.Row
        if (-not $Seen.ContainsKey($id)) { $write.Add($root) }
        $next[$id] = @{ lastSeen = $stamp }
    }
    return @{ Write = $write.ToArray(); Seen = $next }
}
