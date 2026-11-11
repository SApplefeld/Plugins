#Requires -Version 5.1
<#
.SYNOPSIS
Exercises the Live read of template/.claude/kb-status.ps1 and the age of a
source template/.claude/kb-move.ps1 writes, against a throwaway git repository
and KB.

.DESCRIPTION
Builds one KB copied from template/ under a fresh work folder, commits it, and
runs the vendored helpers under the same PowerShell host that runs this test.
It checks that a clean tree reads nothing under Live, that a fresh untracked
page and a fresh modified index read as live oldest first, that an untracked
file in a new folder reads by its own path, that a renamed file reads by its new
path, that the same paths aged 31 minutes read nothing under the default window
and read under -Minutes 60, that a path 29 minutes old reads under the default
window, that a tracked file deleted from disk never reads, that -Minutes is
refused by Porcelain, Unpushed, PageDate and Pending and when below 1, that Live
refuses -Path, that Porcelain prints the same lines as git status --porcelain,
that a file planted two days back reads as live at age 0 once kb-move.ps1
writes it into sources/, and that the four writing skills emit the Live read
exactly, ingest and lint twice each and query and merge once, with no
-Minutes, ingest's last read
inside step 4b before its move, lint's last inside its write pass and merge's
inside its live check. It checks that the three kb-move.ps1 output tokens the
ingest skill reads are held by the helper's code, its comments excluded, and
appear in the skill's text, and that the helper's code and the skill's step 1
both say a person reconciles them and that step 1 holds the exact Pending
listing command, so the skill's pair rule cannot lose its listing or drift
from the helper's words unnoticed. It also checks that a child outliving the test's
own run bound reads TimedOut and has its process tree stopped, so a hung child
fails a check instead of hanging the suite.

Each refusal check reads the refusal's own text, so it fails when a different
rule refuses first. The test sets GIT_CONFIG_GLOBAL to an empty file and
GIT_CONFIG_NOSYSTEM for its own process, and removes both and its work folder
when it finishes. It reaches no network and reads nothing from the home folder.

The summary line names the case count and the failure count, and the exit code
is the failure count.

.PARAMETER WorkRoot
The folder under which the test creates its work folder. Defaults to the
system temp folder.

.PARAMETER StatusScript
Optional path of a kb-status.ps1 to test in place of template/.claude's, such as
a copy from another commit.

.PARAMETER MoveScript
Optional path of a kb-move.ps1 to test in place of template/.claude's.

.PARAMETER SkillRoot
Optional path of a skills folder to read in place of template/.claude/skills,
such as a copy from another commit.

.EXAMPLE
pwsh -NoProfile -File tests/Test-ReconcileGate.ps1

.EXAMPLE
pwsh -NoProfile -File tests/Test-ReconcileGate.ps1 -StatusScript D:\scratch\kb-status.trunk.ps1 -MoveScript D:\scratch\kb-move.trunk.ps1
#>
[CmdletBinding()]
param(
    [string]$WorkRoot = [System.IO.Path]::GetTempPath(),
    [string]$StatusScript,
    [string]$MoveScript,
    [string]$SkillRoot
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

# Stops a process this test started and every process still under it, by its
# PID; a process whose parent has already exited is outside taskkill's walk.
# taskkill's output is read asynchronously and discarded, so its ten-second
# wait is the bound.
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
        if (-not $Process.WaitForExit(5000)) { try { $Process.Kill() } catch { } }
    } finally {
        $killer.Dispose()
    }
}

# Starts a program with its stdout and stderr read asynchronously.
function Start-Captured {
    param([string]$FilePath, [string[]]$Arguments)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = (@($Arguments | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
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

# Waits for a started program and both its streams, for at most the timeout
# counted from its start. Past the timeout the program's tree is stopped and the
# result reads TimedOut, with no exit code, so a check that reads it fails.
function Wait-Captured {
    param($Run, [int]$TimeoutSeconds = 120)
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
    return [pscustomobject]@{ ExitCode = $Run.Process.ExitCode; Stdout = $Run.Stdout.Result; Stderr = $Run.Stderr.Result; TimedOut = $false }
}

# Runs a program and captures its exit code, stdout and stderr as text, for at
# most the timeout.
function Invoke-Captured {
    param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutSeconds = 120)
    return Wait-Captured (Start-Captured $FilePath $Arguments) $TimeoutSeconds
}

# Runs git in the test KB with line-ending conversion off and a fixed identity.
function Invoke-Git {
    param([string[]]$Arguments)
    $result = Invoke-Captured 'git' (@('-C', $script:kb, '-c', 'core.autocrlf=false', '-c', 'user.name=gate test', '-c', 'user.email=gate@test.invalid') + $Arguments)
    if ($result.TimedOut -or $result.ExitCode -ne 0) { throw "git $($Arguments -join ' ') failed: $($result.Stderr)" }
    return $result.Stdout
}

function Invoke-Status {
    param([string[]]$Extra)
    return Invoke-Captured $script:psExe (@('-NoProfile', '-File', (Join-Path $script:kb '.claude\kb-status.ps1')) + $Extra)
}

function Invoke-Move {
    param([string]$Name)
    return Invoke-Captured $script:psExe @('-NoProfile', '-File', (Join-Path $script:kb '.claude\kb-move.ps1'), '-Name', $Name)
}

# Splits stdout into its non-empty lines.
function Get-Lines { param([string]$Text) return @($Text -split "`r?`n" | Where-Object { $_ -ne '' }) }

# Sets a KB file's last-write time to a number of minutes before now.
function Set-Age {
    param([string]$RepoPath, [int]$MinutesAgo)
    $full = Join-Path $script:kb ($RepoPath -replace '/', '\')
    [System.IO.File]::SetLastWriteTimeUtc($full, [DateTime]::UtcNow.AddMinutes(-$MinutesAgo))
}

function Write-KbFile {
    param([string]$RepoPath, [string]$Text)
    $full = Join-Path $script:kb ($RepoPath -replace '/', '\')
    New-Item -ItemType Directory -Path (Split-Path -Parent $full) -Force | Out-Null
    [System.IO.File]::WriteAllText($full, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

# True when a refusal exited 1 with exactly one stderr line equal to the reason,
# and wrote nothing to stdout.
function Test-Refusal {
    param($Result, [string]$Reason)
    $lines = @(Get-Lines $Result.Stderr)
    return (($Result.ExitCode -eq 1) -and ($lines.Count -eq 1) -and ($lines[0] -ceq "kb-status: $Reason") -and ($Result.Stdout -eq ''))
}

$script:engineRoot = Split-Path -Parent $PSScriptRoot
$script:psExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
Write-Host "Host: $script:psExe ($($PSVersionTable.PSVersion))"

$runId = [System.IO.Path]::GetRandomFileName().Replace('.', '')
$work = Join-Path $WorkRoot "gate-test-$runId"
$script:kb = Join-Path $work 'kb'
$emptyConfig = Join-Path $work 'empty.gitconfig'

try {
    New-Item -ItemType Directory -Path $script:kb -Force | Out-Null
    [System.IO.File]::WriteAllText($emptyConfig, '')
    $env:GIT_CONFIG_GLOBAL = $emptyConfig
    $env:GIT_CONFIG_NOSYSTEM = '1'

    Get-ChildItem -LiteralPath (Join-Path $script:engineRoot 'template') -Force | Copy-Item -Destination $script:kb -Recurse -Force
    if ($StatusScript) { Copy-Item -LiteralPath $StatusScript -Destination (Join-Path $script:kb '.claude\kb-status.ps1') -Force }
    if ($MoveScript) { Copy-Item -LiteralPath $MoveScript -Destination (Join-Path $script:kb '.claude\kb-move.ps1') -Force }
    $null = Invoke-Git @('init', '-q', '-b', 'main')
    Write-KbFile 'wiki/tracked-gone.md' "to be deleted`n"
    Write-KbFile 'wiki/tracked-moved.md' "to be renamed, with enough text that git sees the same file after the rename`n"
    $null = Invoke-Git @('add', '-A')
    $null = Invoke-Git @('commit', '-q', '-m', 'baseline')

    # --- A clean tree reads nothing and exits 0.
    $r = Invoke-Status @('-What', 'Live')
    Test-Check 'Live on a clean tree prints nothing and exits 0' (($r.ExitCode -eq 0) -and ($r.Stdout -eq '') -and ($r.Stderr -eq ''))

    # --- A fresh touch reads as live, oldest first. The deleted tracked file is
    # in the status the whole time and must read under no window.
    Remove-Item -LiteralPath (Join-Path $script:kb 'wiki\tracked-gone.md')
    Write-KbFile 'wiki/live-page.md' "a page being written`n"
    Write-KbFile 'index.md' "# Index`n`nedited`n"
    Set-Age 'index.md' 2
    Set-Age 'wiki/live-page.md' 0
    $porcelain = Invoke-Status @('-What', 'Porcelain')
    $direct = Invoke-Captured 'git' @('-C', $script:kb, 'status', '--porcelain')
    $r = Invoke-Status @('-What', 'Live')
    $lines = @(Get-Lines $r.Stdout)
    Test-Check 'Live prints the modified index.md at 2 minutes then the untracked wiki page at 0, oldest first, and exits 0' (($r.ExitCode -eq 0) -and ($lines.Count -eq 2) -and ($lines[0] -ceq "2`tindex.md") -and ($lines[1] -ceq "0`twiki/live-page.md"))
    Test-Check 'Live does not read the tracked file deleted from disk, which the status lists as deleted' (($direct.Stdout -match '(?m)^ D wiki/tracked-gone\.md') -and ($r.Stdout -notmatch 'tracked-gone') -and ($r.Stderr -eq ''))

    # --- Porcelain is unchanged by the new mode.
    $expectedPorcelain = @(' D wiki/tracked-gone.md', ' M index.md', '?? wiki/live-page.md')
    Test-Check 'Porcelain prints the same lines as git status --porcelain, and those three' (($porcelain.ExitCode -eq 0) -and ((@(Get-Lines $porcelain.Stdout) -join '|') -ceq (@(Get-Lines $direct.Stdout) -join '|')) -and ((@(Get-Lines $porcelain.Stdout) | Sort-Object) -join '|') -ceq (($expectedPorcelain | Sort-Object) -join '|'))

    # --- The window knob, both ways, for the aged paths.
    Set-Age 'index.md' 31
    Set-Age 'wiki/live-page.md' 31
    $r = Invoke-Status @('-What', 'Live')
    Test-Check 'the same two paths aged 31 minutes print nothing under the default window and exit 0' (($r.ExitCode -eq 0) -and ($r.Stdout -eq ''))
    $r = Invoke-Status @('-What', 'Live', '-Minutes', '60')
    $lines = @(Get-Lines $r.Stdout)
    Test-Check 'the same two paths aged 31 minutes print under -Minutes 60, oldest first' (($r.ExitCode -eq 0) -and ($lines.Count -eq 2) -and ($lines[0] -cmatch '^3[12]\tindex\.md$') -and ($lines[1] -cmatch '^3[12]\twiki/live-page\.md$') -and ($r.Stdout -notmatch 'tracked-gone'))
    $r = Invoke-Status @('-What', 'Live', '-Minutes', '31')
    Test-Check 'a path 31 minutes old is outside a 31-minute window, since the window is exclusive at its width' (($r.ExitCode -eq 0) -and ($r.Stdout -eq ''))
    Set-Age 'index.md' 29
    $r = Invoke-Status @('-What', 'Live')
    $lines = @(Get-Lines $r.Stdout)
    Test-Check 'a path 29 minutes old prints under the default 30-minute window, and the one aged 31 does not' (($r.ExitCode -eq 0) -and ($lines.Count -eq 1) -and ($lines[0] -cmatch '^(29|30)\tindex\.md$'))

    # --- An untracked file in a new folder reads by its own path.
    Write-KbFile 'wiki/newdir/deep page.md' "inside a new folder`n"
    Set-Age 'wiki/live-page.md' 31
    $r = Invoke-Status @('-What', 'Live')
    $lines = @(Get-Lines $r.Stdout)
    Test-Check 'an untracked file in a new folder reads by its own path, not as its folder' (($r.ExitCode -eq 0) -and ($lines -ccontains "0`twiki/newdir/deep page.md") -and ($r.Stdout -notmatch "(?m)^\d+`twiki/newdir/?`r?$"))

    # --- A renamed file reads by its new path.
    $null = Invoke-Git @('mv', 'wiki/tracked-moved.md', 'wiki/tracked-renamed.md')
    Set-Age 'wiki/tracked-renamed.md' 0
    $renameLine = Invoke-Captured 'git' @('-C', $script:kb, 'status', '--porcelain')
    $r = Invoke-Status @('-What', 'Live')
    $lines = @(Get-Lines $r.Stdout)
    Test-Check 'a renamed file reads by its new path and its old path does not read' (($renameLine.Stdout -match '(?m)^R  wiki/tracked-moved\.md -> wiki/tracked-renamed\.md') -and ($r.ExitCode -eq 0) -and ($lines -ccontains "0`twiki/tracked-renamed.md") -and ($r.Stdout -notmatch 'tracked-moved') -and ($r.Stdout -notmatch '->'))

    # --- A fresh file in inbox/ is pending input and never reads, beside a fresh
    # wiki page that does, so the case cannot pass on an empty read.
    Write-KbFile 'inbox/fresh-drop.txt' "just dropped`n"
    Set-Age 'inbox/fresh-drop.txt' 0
    Set-Age 'wiki/live-page.md' 0
    $r = Invoke-Status @('-What', 'Live')
    $lines = @(Get-Lines $r.Stdout)
    Test-Check 'a fresh file in inbox/ prints nothing under Live while a fresh wiki page beside it prints' (($r.ExitCode -eq 0) -and ($lines -ccontains "0`twiki/live-page.md") -and ($r.Stdout -notmatch 'inbox/') -and ($r.Stdout -notmatch 'fresh-drop'))
    Remove-Item -LiteralPath (Join-Path $script:kb 'inbox\fresh-drop.txt')

    # --- Refusals. Each reads the text of the rule that must refuse.
    foreach ($mode in @('Porcelain', 'Unpushed', 'Pending')) {
        $r = Invoke-Status @('-What', $mode, '-Minutes', '10')
        Test-Check "$mode refuses -Minutes with its own one-line reason and exit 1" (Test-Refusal $r "$mode takes no -Minutes.")
    }
    $r = Invoke-Status @('-What', 'PageDate', '-Path', 'index.md', '-Minutes', '10')
    Test-Check 'PageDate refuses -Minutes with its own one-line reason and exit 1, given an otherwise valid -Path' (Test-Refusal $r 'PageDate takes no -Minutes.')
    $r = Invoke-Status @('-What', 'Live', '-Minutes', '0')
    Test-Check 'Live refuses -Minutes 0 with the one-line reason that names the minimum and exit 1' (Test-Refusal $r '-Minutes must be 1 or more: 0')
    $r = Invoke-Status @('-What', 'Live', '-Minutes', '-5')
    Test-Check 'Live refuses a negative -Minutes with the same minimum reason' (Test-Refusal $r '-Minutes must be 1 or more: -5')
    $r = Invoke-Status @('-What', 'Live', '-Path', 'index.md')
    Test-Check 'Live refuses -Path with its own one-line reason and exit 1' (Test-Refusal $r 'Live takes no -Path.')

    # --- The moved copy. A file two days old is not live in inbox/ and reads
    # as sources/<file> at age 0 once kb-move.ps1 has moved it, since the move
    # writes a fresh copy whose last-write time is the time of its write.
    Write-KbFile 'inbox/old-drop.txt' "dropped two days ago`n"
    Set-Age 'inbox/old-drop.txt' (2 * 24 * 60)
    $m = Invoke-Move 'old-drop.txt'
    $after = Invoke-Status @('-What', 'Live')
    Test-Check 'kb-move.ps1 moves the file and prints its sources/ path' (($m.ExitCode -eq 0) -and ((@(Get-Lines $m.Stdout)) -ccontains 'sources/old-drop.txt') -and (Test-Path -LiteralPath (Join-Path $script:kb 'sources\old-drop.txt')))
    Test-Check 'the moved file reads under Live as sources/old-drop.txt at age 0' (($after.ExitCode -eq 0) -and ((@(Get-Lines $after.Stdout)) -ccontains "0`tsources/old-drop.txt"))

    # --- The skills run the read. Each writing skill emits the exact Live
    # command its steps call for, at the step that needs it, and none passes
    # -Minutes. A missing skill file fails its case.
    if ($SkillRoot) {
        $SkillRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($SkillRoot)
    } else {
        $SkillRoot = Join-Path $script:engineRoot 'template\.claude\skills'
    }
    $liveCommand = 'pwsh -NoProfile -File ./.claude/kb-status.ps1 -What Live'
    # Each skill's read count, and the two texts its last read must fall between.
    $skillChecks = @(
        @('wiki-ingest', 2, '**b. Move it.**', 'pwsh -NoProfile -File ./.claude/kb-move.ps1 -Handle'),
        @('wiki-lint', 2, '## The write pass', '## The lint report'),
        @('wiki-query', 1, '', ''),
        @('wiki-merge', 1, '## 2. Check', '## 3. Join')
    )
    foreach ($skill in $skillChecks) {
        $skillFile = Join-Path $SkillRoot "$($skill[0])\SKILL.md"
        $passed = $false
        if (Test-Path -LiteralPath $skillFile -PathType Leaf) {
            $text = [System.IO.File]::ReadAllText($skillFile)
            $hits = [regex]::Matches($text, [regex]::Escape($liveCommand))
            $withMinutes = @($text -split "`r?`n" | Where-Object { ($_ -match 'kb-status\.ps1') -and ($_ -match '-Minutes') }).Count
            $passed = ($hits.Count -eq $skill[1]) -and ($withMinutes -eq 0)
            if ($passed -and $skill[2]) {
                $last = $hits[$hits.Count - 1].Index
                $from = $text.IndexOf($skill[2], [System.StringComparison]::Ordinal)
                $to = $text.IndexOf($skill[3], [System.StringComparison]::Ordinal)
                $passed = ($from -ge 0) -and ($to -gt $from) -and ($last -gt $from) -and ($last -lt $to)
            }
        }
        Test-Check "$($skill[0]) emits the exact Live command $($skill[1]) time(s), its last read at the step that needs it, and never passes -Minutes" $passed
    }

    # --- The ingest skill reads three tokens from kb-move.ps1's output. The
    # helper side reads the helper's parsed code, so its comment help never
    # counts, and finds the code that builds each printed line: for
    # 'renamed: inbox/renamed-', a Write-Output whose string, quoted or joined
    # with +, has 'renamed: inbox/' followed at once by a variable whose every
    # assignment is a string beginning 'renamed-', or by a member whose name is
    # a hashtable key every one of whose values is such a variable; for
    # 'duplicate: sources/', a Write-Output whose string has 'duplicate: '
    # followed at once by a variable whose every assignment begins 'sources/';
    # for the third, a string holding the phrase. Requiring every assignment
    # means an = or += assignment statement to another prefix anywhere in the
    # helper fails the case, though the link is by name rather than traced
    # data flow, so a write by Set-Variable, a foreach binding or a [ref]
    # goes unseen. The skill
    # side reads the skill's text with whitespace runs collapsed, since the
    # skill wraps lines inside a code span, and finds each whole token. A
    # missing or unparsable file fails the case.
    $moveTokens = @('renamed: inbox/renamed-', 'duplicate: sources/', 'already exists with different content')
    if ($MoveScript) {
        $moveFile = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($MoveScript)
    } else {
        $moveFile = Join-Path $script:engineRoot 'template\.claude\kb-move.ps1'
    }
    $ingestFile = Join-Path $SkillRoot 'wiki-ingest\SKILL.md'
    $helperHas = @{}
    $skillHas = @{}
    foreach ($token in $moveTokens) { $helperHas[$token] = $false; $skillHas[$token] = $false }
    $helperReason = 'helper, whose file is missing'
    $codeStrings = $null
    if (Test-Path -LiteralPath $moveFile -PathType Leaf) {
        $moveParseTokens = $null
        $moveParseErrors = $null
        $moveAst = [System.Management.Automation.Language.Parser]::ParseFile($moveFile, [ref]$moveParseTokens, [ref]$moveParseErrors)
        if (@($moveParseErrors).Count -gt 0) {
            $helperReason = 'helper, which does not parse'
        } else {
            $helperReason = 'helper code'
            $constantAst = [System.Management.Automation.Language.StringConstantExpressionAst]
            $expandableAst = [System.Management.Automation.Language.ExpandableStringExpressionAst]
            $variableAst = [System.Management.Automation.Language.VariableExpressionAst]
            $memberAst = [System.Management.Automation.Language.MemberExpressionAst]
            $binaryAst = [System.Management.Automation.Language.BinaryExpressionAst]
            $assignmentAst = [System.Management.Automation.Language.AssignmentStatementAst]
            # Strips a statement, parentheses or a one-statement $( ) to the expression inside.
            $unwrap = {
                param($node)
                while ($true) {
                    if ($node -is [System.Management.Automation.Language.PipelineAst]) {
                        $pure = $node.GetPureExpression()
                        if ($null -eq $pure) { return $node }
                        $node = $pure
                    } elseif ($node -is [System.Management.Automation.Language.CommandExpressionAst]) {
                        $node = $node.Expression
                    } elseif ($node -is [System.Management.Automation.Language.ParenExpressionAst]) {
                        $node = $node.Pipeline
                    } elseif (($node -is [System.Management.Automation.Language.SubExpressionAst]) -and ($node.SubExpression.Statements.Count -eq 1)) {
                        $node = $node.SubExpression.Statements[0]
                    } else {
                        return $node
                    }
                }
            }
            # The text a string begins with: its own, or a + join's left operand's.
            $leadingText = {
                param($node)
                $node = & $unwrap $node
                if (($node -is $constantAst) -or ($node -is $expandableAst)) { return $node.Value }
                if (($node -is $binaryAst) -and ($node.Operator -eq 'Plus')) { return (& $leadingText $node.Left) }
                return $null
            }
            # The expression that follows a prefix at once: the first expansion of
            # a string that reads the prefix then a $, or the right operand of a
            # + join whose left operand is the prefix alone.
            $afterPrefix = {
                param($node, $prefix)
                $node = & $unwrap $node
                if (($node -is $expandableAst) -and $node.Value.StartsWith($prefix + '$', [System.StringComparison]::Ordinal) -and ($node.NestedExpressions.Count -ge 1)) {
                    return (& $unwrap $node.NestedExpressions[0])
                }
                if (($node -is $binaryAst) -and ($node.Operator -eq 'Plus')) {
                    $left = & $unwrap $node.Left
                    if (($left -is $constantAst) -and [string]::Equals($left.Value, $prefix, [System.StringComparison]::Ordinal)) { return (& $unwrap $node.Right) }
                }
                return $null
            }
            $codeStrings = @($moveAst.FindAll({ param($node) ($node -is $constantAst) -or ($node -is $expandableAst) }, $true))
            $printed = @($moveAst.FindAll({
                param($node)
                ($node -is [System.Management.Automation.Language.CommandAst]) -and ($node.GetCommandName() -eq 'Write-Output') -and ($node.CommandElements.Count -ge 2)
            }, $true) | ForEach-Object { $_.CommandElements[1] })
            $assignments = @($moveAst.FindAll({ param($node) $node -is $assignmentAst }, $true))
            # True where a value is a string beginning with the prefix.
            $beginsWith = {
                param($node, $prefix)
                $text = & $leadingText $node
                ($null -ne $text) -and $text.StartsWith($prefix, [System.StringComparison]::Ordinal)
            }
            # Each variable assigned at least once, every assignment a string beginning with the prefix.
            $variablesAssigned = {
                param($prefix)
                @($assignments | Where-Object { $_.Left -is $variableAst } | Group-Object { $_.Left.VariablePath.UserPath } | Where-Object {
                    @($_.Group | Where-Object { -not (& $beginsWith $_.Right $prefix) }).Count -eq 0
                } | ForEach-Object { $_.Name })
            }
            $sourcesVariables = & $variablesAssigned 'sources/'
            $renamedVariables = & $variablesAssigned 'renamed-'
            # Each hashtable key every one of whose values is a renamed- variable,
            # and which no member assignment sets to anything else.
            $renamedKeys = @($moveAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.HashtableAst] }, $true) |
                ForEach-Object { $_.KeyValuePairs } | Where-Object { $_.Item1 -is $constantAst } | Group-Object { $_.Item1.Value } | Where-Object {
                    $key = $_.Name
                    (@($_.Group | Where-Object { $value = & $unwrap $_.Item2; -not (($value -is $variableAst) -and ($renamedVariables -contains $value.VariablePath.UserPath)) }).Count -eq 0) -and
                    (@($assignments | Where-Object { ($_.Left -is $memberAst) -and ($_.Left.Member -is $constantAst) -and ($_.Left.Member.Value -eq $key) -and -not (& $beginsWith $_.Right 'renamed-') }).Count -eq 0)
                } | ForEach-Object { $_.Name })
            $helperHas['renamed: inbox/renamed-'] = @($printed | Where-Object {
                $next = & $afterPrefix $_ 'renamed: inbox/'
                (($next -is $variableAst) -and ($renamedVariables -contains $next.VariablePath.UserPath)) -or
                (($next -is $memberAst) -and ($next.Member -is $constantAst) -and ($renamedKeys -contains $next.Member.Value))
            }).Count -gt 0
            $helperHas['duplicate: sources/'] = @($printed | Where-Object {
                $next = & $afterPrefix $_ 'duplicate: '
                ($next -is $variableAst) -and ($sourcesVariables -contains $next.VariablePath.UserPath)
            }).Count -gt 0
            $helperHas['already exists with different content'] = @($codeStrings | Where-Object { $_.Value.Contains('already exists with different content') }).Count -gt 0
        }
    }
    if (Test-Path -LiteralPath $ingestFile -PathType Leaf) {
        $ingestText = [regex]::Replace([System.IO.File]::ReadAllText($ingestFile), '\s+', ' ')
        foreach ($token in $moveTokens) { $skillHas[$token] = $ingestText.IndexOf($token, [System.StringComparison]::Ordinal) -ge 0 }
    }
    $moveProblems = @()
    foreach ($token in $moveTokens) {
        if (-not $helperHas[$token]) { $moveProblems += "'$token' missing from the $helperReason, $moveFile" }
        if (-not $skillHas[$token]) { $moveProblems += "'$token' missing from the skill text, $ingestFile" }
    }
    $passed = ($moveProblems.Count -eq 0)
    Test-Check "kb-move.ps1's code and the wiki-ingest skill both hold 'renamed: inbox/renamed-', 'duplicate: sources/' and 'already exists with different content', the helper read without its comments and the skill with whitespace collapsed" $passed
    if (-not $passed) { foreach ($problem in $moveProblems) { Write-Host "  $problem" } }

    # --- A copy left beside its inbox twin waits for a person. The helper's
    # both-files lines say a person reconciles them, and the ingest skill's
    # step 1 lists the inbox with the exact Pending command and says the same
    # of an untracked source whose name the inbox still holds, so its
    # reconcile step never commits a copy that may be partial. The helper side
    # reads the parsed code's strings, its comment help aside; the skill side
    # reads step 1 alone, with whitespace collapsed.
    $reconcilePhrase = 'a person reconciles them'
    $inboxCommand = 'pwsh -NoProfile -File ./.claude/kb-status.ps1 -What Pending'
    $helperPairs = ($null -ne $codeStrings) -and (@($codeStrings | Where-Object { $_.Value.Contains($reconcilePhrase) }).Count -gt 0)
    $skillPairs = $false
    if (Test-Path -LiteralPath $ingestFile -PathType Leaf) {
        $stepFrom = $ingestText.IndexOf('## 1. Reconcile', [System.StringComparison]::Ordinal)
        $stepTo = $ingestText.IndexOf('## 2. Snapshot', [System.StringComparison]::Ordinal)
        if (($stepFrom -ge 0) -and ($stepTo -gt $stepFrom)) {
            $stepOne = $ingestText.Substring($stepFrom, $stepTo - $stepFrom)
            $skillPairs = ($stepOne.IndexOf($inboxCommand, [System.StringComparison]::Ordinal) -ge 0) -and ($stepOne.IndexOf($reconcilePhrase, [System.StringComparison]::Ordinal) -ge 0)
        }
    }
    Test-Check "kb-move.ps1's code holds '$reconcilePhrase', and the wiki-ingest skill's step 1 holds the exact Pending command and the same phrase (helper $helperPairs, skill $skillPairs)" ($helperPairs -and $skillPairs)

    # --- The helper's own bound. A child that outlives a short bound reads
    # TimedOut, and its tree is stopped: the child and the grandchild it waits
    # on, each matched by its process id and creation time. The control is the
    # filter seeing that grandchild running under the child before the bound.
    $boundClock = [System.Diagnostics.Stopwatch]::StartNew()
    $run = Start-Captured $script:psExe @('-NoProfile', '-Command', "& '$($script:psExe)' -NoProfile -Command 'Start-Sleep -Seconds 60'")
    $grandchild = @()
    while ($grandchild.Count -eq 0 -and -not $run.Process.HasExited -and $boundClock.Elapsed.TotalSeconds -lt 20) {
        $grandchild = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($run.Process.Id)")
        if ($grandchild.Count -eq 0) { Start-Sleep -Milliseconds 100 }
    }
    $bounded = Wait-Captured $run 25
    $boundClock.Stop()
    $alive = @()
    for ($i = 0; $i -lt 10; $i++) {
        $alive = @($grandchild | Where-Object { $g = $_; @(Get-CimInstance Win32_Process -Filter "ProcessId = $($g.ProcessId)" | Where-Object { $_.CreationDate -eq $g.CreationDate }).Count -gt 0 })
        if ($alive.Count -eq 0) { break }
        Start-Sleep -Milliseconds 500
    }
    $boundPassed = $bounded.TimedOut -and ($null -eq $bounded.ExitCode) -and ($boundClock.Elapsed.TotalSeconds -lt 45) -and $run.Process.HasExited -and ($grandchild.Count -ge 1) -and ($alive.Count -eq 0)
    Test-Check 'a child that sleeps past a 25-second bound under Invoke-Captured reads TimedOut with no exit code inside 45 seconds, and the child and the grandchild it waits on are gone within five seconds after, where the filter saw that grandchild running first' $boundPassed
    if (-not $boundPassed) { Write-Host "  timed out $($bounded.TimedOut), elapsed $([math]::Round($boundClock.Elapsed.TotalSeconds, 1)) s, child exited $($run.Process.HasExited), grandchildren seen $($grandchild.Count), alive $($alive.Count)" }
    foreach ($g in $alive) { Stop-Process -Id $g.ProcessId -Force -ErrorAction SilentlyContinue }
} finally {
    foreach ($process in $script:started) {
        if (-not $process.HasExited) { Stop-StartedTree $process }
    }
    Remove-Item -LiteralPath Env:GIT_CONFIG_GLOBAL -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath Env:GIT_CONFIG_NOSYSTEM -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $work) {
        Remove-Item -LiteralPath $work -Recurse -Force
    }
}

Write-Host "$cases reconcile-gate cases, $failures failed."
exit $failures
