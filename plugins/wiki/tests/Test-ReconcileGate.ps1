#Requires -Version 5.1
<#
.SYNOPSIS
Exercises the Live read of template/.claude/kb-status.ps1 and the last-write
stamp of template/.claude/kb-move.ps1 against a throwaway git repository and KB.

.DESCRIPTION
Builds one KB copied from template/ under a fresh work folder, commits it, and
runs the vendored helpers under the same PowerShell host that runs this test.
It checks that a clean tree reads nothing under Live, that a fresh untracked
page and a fresh modified index read as live oldest first, that an untracked
file in a new folder reads by its own path, that a renamed file reads by its new
path, that the same paths aged 31 minutes read nothing under the default window
and read under -Minutes 60, that a path 29 minutes old reads under the default
window, that a tracked file deleted from disk never reads, that -Minutes is
refused by Porcelain, Unpushed, PageDate and Inbox and when below 1, that Live
refuses -Path, that Porcelain prints the same lines as git status --porcelain,
that kb-move.ps1 stamps a file planted two days back so it reads as live at
age 0, and that the three writing skills emit the Live read exactly, ingest and
lint twice each and query once, with no -Minutes, ingest's last read inside
step 4b before its move and lint's last inside its write pass.

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

# Runs a program and captures its exit code, stdout and stderr as text.
function Invoke-Captured {
    param([string]$FilePath, [string[]]$Arguments)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = (@($Arguments | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::Start($psi)
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $stdout = $process.StandardOutput.ReadToEnd()
    $process.WaitForExit()
    return [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdout; Stderr = $stderrTask.Result }
}

# Runs git in the test KB with line-ending conversion off and a fixed identity.
function Invoke-Git {
    param([string[]]$Arguments)
    $result = Invoke-Captured 'git' (@('-C', $script:kb, '-c', 'core.autocrlf=false', '-c', 'user.name=gate test', '-c', 'user.email=gate@test.invalid') + $Arguments)
    if ($result.ExitCode -ne 0) { throw "git $($Arguments -join ' ') failed: $($result.Stderr)" }
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
    foreach ($mode in @('Porcelain', 'Unpushed', 'Inbox')) {
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

    # --- The stamped move. A file two days old is not live in inbox/ and reads
    # as sources/<file> at age 0 once kb-move.ps1 has moved it.
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
        @('wiki-ingest', 2, '**b. Move it.**', 'pwsh -NoProfile -File ./.claude/kb-move.ps1 -Name'),
        @('wiki-lint', 2, '## The write pass', '## The lint report'),
        @('wiki-query', 1, '', '')
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
} finally {
    Remove-Item -LiteralPath Env:GIT_CONFIG_GLOBAL -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath Env:GIT_CONFIG_NOSYSTEM -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $work) {
        Remove-Item -LiteralPath $work -Recurse -Force
    }
}

Write-Host "$cases reconcile-gate cases, $failures failed."
exit $failures
