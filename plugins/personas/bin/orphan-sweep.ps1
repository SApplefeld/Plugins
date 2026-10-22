# Reports tool-call processes that outlived their session. This is the script the KitOrphanSweep
# scheduled task runs every fifteen minutes, under Windows PowerShell 5.1:
#
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File bin\orphan-sweep.ps1 -FindingsPath <path> [-MinAgeHours <n>]
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File bin\orphan-sweep.ps1 -Report [-MinAgeHours <n>]
#
# The script reads the process table once through Get-CimInstance Win32_Process, applies the rule
# in Select-OrphanRoots (bin/orphan-sweep-functions.ps1) with the allowlist beside it
# (bin/orphan-sweep-allowlist.json), and writes one finding per flagged root. It stops nothing and
# changes no process: a finding is a hypothesis for the operator.
#
# A finding is one line of compact JSON: id (<pid>-<CreationDate ticks>), at (the write time),
# pid, image, commandLine (a string, or null where none was readable), createdAt, ageHours,
# cpuSeconds (the whole tree's), tree (the subtree's pids, root first) and rule. Without -Report the
# lines of roots not seen before are appended to -FindingsPath, whose directory is created where
# absent, and the seen file beside it, <FindingsPath>.seen.json, is rewritten with the roots flagged
# now and every prior entry whose process still lives. -Report neither reads nor writes the seen file
# and prints every flagged root's line to stdout, so a hand run shows the whole live set and consumes
# nothing the task would write. Every file is written as UTF-8 without a byte-order mark, since the
# persona plugin's drain parses each line as JSON.
#
# Exit codes: 0 on a completed sweep; 1 on a fault of the script's own (no -FindingsPath without
# -Report, an allowlist or seen file that cannot be read, a write that fails); 2 when the process
# table cannot be read, in which case nothing is written.
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
    [switch]$Report,
    # Test seam: a JSON array of rows with the Win32_Process property names, CreationDate as an ISO
    # 8601 string, read in place of the process table so the unit test drives this script on fixture
    # rows. A task never passes it.
    [string]$RowsPath
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'orphan-sweep-functions.ps1')

$allowlistPath = Join-Path $PSScriptRoot 'orphan-sweep-allowlist.json'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$invariant = [System.Globalization.CultureInfo]::InvariantCulture

function Exit-Fault {
    param([Parameter(Mandatory)][string]$Text, [Parameter(Mandatory)][int]$Code)
    [Console]::Error.WriteLine('orphan-sweep: ' + $Text)
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

$roots = Select-OrphanRoots -Rows $rows -Now $now -Allowlist $allowlist -MinAgeHours $MinAgeHours
$rule = 'dead-parent runtime over ' + $MinAgeHours.ToString($invariant) + 'h not allowlisted'

# One finding as a line of compact JSON. Every field is data copied from the row; nothing here
# builds text for a channel.
function ConvertTo-OrphanFindingLine {
    param([Parameter(Mandatory)][object]$Root)
    $row = $Root.Row
    $commandLine = $null
    if ($null -ne $row.CommandLine) { $commandLine = [string]$row.CommandLine }
    $record = [ordered]@{
        id          = Get-OrphanId -Row $row
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
    return ConvertTo-Json -InputObject $record -Compress -Depth 4
}

if ($Report) {
    foreach ($root in $roots) { Write-Output (ConvertTo-OrphanFindingLine -Root $root) }
    exit 0
}

$seenPath = $FindingsPath + '.seen.json'
$seen = @{}
try {
    if (Test-Path -LiteralPath $seenPath) {
        $parsed = Get-Content -LiteralPath $seenPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -ne $parsed) {
            foreach ($p in $parsed.PSObject.Properties) { $seen[$p.Name] = @{ lastSeen = [string]$p.Value.lastSeen } }
        }
    }
} catch {
    Exit-Fault -Text ('the seen file ' + $seenPath + ' could not be read: ' + $_.Exception.Message) -Code 1
}

$update = Update-OrphanSeen -Seen $seen -Roots $roots -Rows $rows -Now $now

try {
    $dir = Split-Path -Parent $FindingsPath
    if (-not [string]::IsNullOrEmpty($dir) -and -not (Test-Path -LiteralPath $dir)) {
        [void](New-Item -ItemType Directory -Path $dir -Force)
    }
    # Findings land before the seen file, so a failed seen write repeats a finding rather than
    # losing one; the drain's ack file skips an id it has already delivered.
    if ($update.Write.Count -gt 0) {
        $text = New-Object System.Text.StringBuilder
        foreach ($root in $update.Write) { [void]$text.Append((ConvertTo-OrphanFindingLine -Root $root)).Append("`n") }
        [System.IO.File]::AppendAllText($FindingsPath, $text.ToString(), $utf8NoBom)
    }
    $seenJson = ConvertTo-Json -InputObject $update.Seen -Compress -Depth 4
    [System.IO.File]::WriteAllText($seenPath, $seenJson + "`n", $utf8NoBom)
} catch {
    Exit-Fault -Text ('writing ' + $FindingsPath + ' failed: ' + $_.Exception.Message) -Code 1
}
exit 0
