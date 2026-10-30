#Requires -Version 5.1
<#
.SYNOPSIS
Exercises the repository feeder, template/.claude/feed-inbox.ps1, against a
throwaway git repository and KB.

.DESCRIPTION
Builds a local upstream git repository and two KBs copied from template/ under
a fresh work folder, points each KB's .claude/feed.json at the upstream by path,
and runs the vendored feeder under the same PowerShell host that runs this test.
It checks the drip cap, fed names and provenance headers, dedupe against inbox/
and sources/, a changed upstream file, excluded and unmatched paths, refused
names, -WhatIf, hook neutralization against a planted hook, the failure paths
(bad URL, refused URL forms, invalid config, missing config), and the template
allow-list. A second upstream covers shell-metacharacter mapping, the '..' and
25 MB refusals, UTF-32 BE, selection order across two sources, the KB lock, the
stale-temp sweep, and the git timeouts and the run budget, driven by a sleeping
upload-pack hook.

The feeder keeps private clones under
%LOCALAPPDATA%\llm-wiki-feed\<kb-name>-<path hash>. The test KBs are named
feedtest-<random>, and the test removes their clone folders and its work folder
when it finishes.

.PARAMETER WorkRoot
The folder under which the test creates its work folder. Defaults to the
system temp folder.

.EXAMPLE
pwsh -NoProfile -File tests/Test-FeedInbox.ps1

.EXAMPLE
powershell -NoProfile -File tests/Test-FeedInbox.ps1 -WorkRoot D:\scratch
#>
[CmdletBinding()]
param(
    [string]$WorkRoot = [System.IO.Path]::GetTempPath()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$failures = 0
function Test-Check {
    param([string]$Description, [bool]$Passed)
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

# Runs git in the upstream repo with line-ending conversion off, so each blob is
# exactly the bytes the test wrote.
function Invoke-Upstream {
    param([string[]]$Arguments)
    $result = Invoke-Captured 'git' (@('-C', $script:upstream, '-c', 'core.autocrlf=false', '-c', 'user.name=feed test', '-c', 'user.email=feed@test.invalid') + $Arguments)
    if ($result.ExitCode -ne 0) { throw "upstream git $($Arguments -join ' ') failed: $($result.Stderr)" }
    return $result.Stdout.Trim()
}

function Write-UpstreamFile {
    param([string]$RepoPath, [byte[]]$Bytes)
    $full = Join-Path $script:upstream ($RepoPath -replace '/', '\')
    New-Item -ItemType Directory -Path (Split-Path -Parent $full) -Force | Out-Null
    [System.IO.File]::WriteAllBytes($full, $Bytes)
}

function Get-Utf8Bytes { param([string]$Text) return (New-Object System.Text.UTF8Encoding($false)).GetBytes($Text) }

function Test-BytesEqual {
    param([byte[]]$A, [byte[]]$B)
    return ([Convert]::ToBase64String($A) -ceq [Convert]::ToBase64String($B))
}

# The fed-file names in a KB folder, sorted, excluding .gitkeep.
function Get-Names {
    param([string]$Dir)
    return @(Get-ChildItem -LiteralPath $Dir -File | Where-Object { $_.Name -ne '.gitkeep' } | ForEach-Object { $_.Name } | Sort-Object)
}

function New-TestKb {
    param([string]$Path)
    New-Item -ItemType Directory -Path $Path | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $script:engineRoot 'template') -Force | Copy-Item -Destination $Path -Recurse -Force
    $result = Invoke-Captured 'git' @('-C', $Path, 'init', '-q', '-b', 'main')
    if ($result.ExitCode -ne 0) { throw "git init failed for $Path" }
}

function Set-FeedConfig {
    param([string]$Kb, [string]$Json)
    [System.IO.File]::WriteAllText((Join-Path $Kb '.claude\feed.json'), $Json, (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-Feeder {
    param([string]$Kb, [string[]]$Extra = @())
    return Invoke-Captured $script:psExe (@('-NoProfile', '-File', (Join-Path $Kb '.claude\feed-inbox.ps1')) + $Extra)
}

# Splits stdout into its non-empty lines.
function Get-Lines { param([string]$Text) return @($Text -split "`r?`n" | Where-Object { $_ -ne '' }) }

# The last non-empty line, or an empty string when there is none.
function Get-LastLine {
    param([string]$Text)
    $lines = @(Get-Lines $Text)
    if ($lines.Count -eq 0) { return '' }
    return $lines[$lines.Count - 1]
}

# True when the summary line, the last line of stdout, carries exactly the four
# counts fed, skipped-existing, refused and inbox, in that order. Only the
# integers are compared, so the check pins the counts and not the wording.
function Test-Summary {
    param([string]$Stdout, [int[]]$Counts)
    $found = @([regex]::Matches((Get-LastLine $Stdout), '\d+') | ForEach-Object { [int]$_.Value })
    return (($found -join ',') -ceq ($Counts -join ','))
}

# The private clone root the feeder uses for a KB: the KB folder name, a dash,
# and the first 8 hex digits of the SHA-256 of its lowercased full path.
function Get-CloneBase {
    param([string]$KbDir)
    $full = (Resolve-Path -LiteralPath $KbDir).ProviderPath.TrimEnd('\').ToLowerInvariant()
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $digest = $sha.ComputeHash((New-Object System.Text.UTF8Encoding($false)).GetBytes($full))
    $hex = -join ($digest[0..3] | ForEach-Object { $_.ToString('x2') })
    return Join-Path (Join-Path $env:LOCALAPPDATA 'llm-wiki-feed') "$(Split-Path -Leaf $KbDir)-$hex"
}

$script:engineRoot = Split-Path -Parent $PSScriptRoot
$script:psExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
Write-Host "Host: $script:psExe ($($PSVersionTable.PSVersion))"

$runId = [System.IO.Path]::GetRandomFileName().Replace('.', '')
$work = Join-Path $WorkRoot "feed-test-$runId"
$kbName  = "feedtest-$runId"
$kb2Name = "feedtest-$runId-b"
$kb  = Join-Path $work $kbName
$kb2 = Join-Path $work $kb2Name
$kb3 = Join-Path $work "$kbName-c"
$kb4 = Join-Path $work "$kbName-d"
$kb5 = Join-Path $work "$kbName-e"
# Each clone root is filled in once its KB exists, because the root is keyed by
# the KB's resolved full path. The finally block removes every one that is set.
$cloneBase = $null; $cloneBase2 = $null; $cloneBase3 = $null; $cloneBase4 = $null; $cloneBase5 = $null
$script:upstream = Join-Path $work 'upstream'

try {
    New-Item -ItemType Directory -Path $script:upstream -Force | Out-Null
    $null = Invoke-Upstream @('init', '-q', '-b', 'main')

    $longStem = 'l' * 150
    $bodies = @{
        'README.md'                 = (Get-Utf8Bytes "root readme`n")
        'docs/a.md'                 = (Get-Utf8Bytes "alpha`n")
        'docs/b.md'                 = (Get-Utf8Bytes "bravo`r`nline two`r`n")
        'docs/c.md'                 = ([byte[]](0xEF, 0xBB, 0xBF) + (Get-Utf8Bytes "charlie`n"))
        'docs/notes.txt'            = (Get-Utf8Bytes "plain text`n")
        'docs/data.bin'             = ([byte[]](0..255))
        'docs/LICENSE'              = (Get-Utf8Bytes "license text`n")
        'docs/archive/README.md'    = (Get-Utf8Bytes "archived`n")
        'docs/sub/deep.md'          = (Get-Utf8Bytes "too deep for docs/*.md`n")
        'notes/other.md'            = (Get-Utf8Bytes "not included`n")
        'skills/x/SKILL.md'         = (Get-Utf8Bytes "a skill`n")
        "docs/$longStem.md"         = (Get-Utf8Bytes "long name`n")
    }
    foreach ($key in $bodies.Keys) { Write-UpstreamFile $key $bodies[$key] }
    $null = Invoke-Upstream @('add', '-A')
    $null = Invoke-Upstream @('commit', '-q', '-m', 'initial')

    function Get-BlobShort { param([string]$RepoPath) return (Invoke-Upstream @('rev-parse', "HEAD:$RepoPath")).Substring(0, 7) }
    $expected = [ordered]@{}
    $expected['README.md']         = "up--README--$(Get-BlobShort 'README.md').md"
    $expected['docs/LICENSE']      = "up--docs--LICENSE--$(Get-BlobShort 'docs/LICENSE')"
    $expected['docs/a.md']         = "up--docs--a--$(Get-BlobShort 'docs/a.md').md"
    $expected['docs/b.md']         = "up--docs--b--$(Get-BlobShort 'docs/b.md').md"
    $expected['docs/c.md']         = "up--docs--c--$(Get-BlobShort 'docs/c.md').md"
    $expected['docs/data.bin']     = "up--docs--data--$(Get-BlobShort 'docs/data.bin').bin"
    $expected['docs/notes.txt']    = "up--docs--notes--$(Get-BlobShort 'docs/notes.txt').txt"
    $expected['skills/x/SKILL.md'] = "up--skills--x--SKILL--$(Get-BlobShort 'skills/x/SKILL.md').md"

    $urlJson = ConvertTo-Json $script:upstream
    $goodSource = "{ `"name`": `"up`", `"url`": $urlJson, `"branch`": `"main`", `"include`": [`"docs/*.md`", `"docs/*.txt`", `"docs/*.bin`", `"docs/LICENSE`", `"**/SKILL.md`", `"**/README.md`"], `"exclude`": [`"docs/archive/**`"] }"

    New-TestKb $kb
    $cloneBase = Get-CloneBase $kb
    Set-FeedConfig $kb "{ `"sources`": [ $goodSource ] }"
    $inbox   = Join-Path $kb 'inbox'
    $sources = Join-Path $kb 'sources'
    $everFed = New-Object System.Collections.Generic.List[string]

    # The header the feeder must write for a given path, up to the commit fields.
    $urlPattern = [regex]::Escape($script:upstream)
    function Test-Header {
        param([string]$Name, [string]$RepoPath, [byte[]]$Body, [string]$Newline, [string]$CommitPrefixOf)
        $file = Join-Path $script:inboxNow $Name
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
        $bytes = [System.IO.File]::ReadAllBytes($file)
        $text = (New-Object System.Text.UTF8Encoding($false)).GetString($bytes)
        $nl = [regex]::Escape($Newline)
        $pattern = "^> Fed by feed-inbox\.ps1 from $urlPattern branch main, path ``$([regex]::Escape($RepoPath))``, commit ([0-9a-f]{7,40}) dated \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})\.$nl$nl"
        $m = [regex]::Match($text, $pattern)
        if (-not $m.Success) { return $false }
        if ($CommitPrefixOf -and -not $CommitPrefixOf.StartsWith($m.Groups[1].Value)) { return $false }
        $headerLength = (New-Object System.Text.UTF8Encoding($false)).GetByteCount($m.Value)
        $rest = New-Object byte[] ($bytes.Length - $headerLength)
        [Array]::Copy($bytes, $headerLength, $rest, 0, $rest.Length)
        return (Test-BytesEqual $rest $Body)
    }
    $script:inboxNow = $inbox

    # --- Acceptance 1: a first run feeds at most -MaxFiles matching files, in path order.
    $r = Invoke-Feeder $kb @('-MaxFiles', '3')
    if ($r.ExitCode -ne 0) { Write-Host "first run stderr: $($r.Stderr)" }
    $firstThree = @($expected['README.md'], $expected['docs/LICENSE'], $expected['docs/a.md'])
    Test-Check 'first run exits 0' ($r.ExitCode -eq 0)
    Test-Check 'first run feeds exactly the first 3 candidates in ordinal path order' ((@(Get-Names $inbox) -join '|') -ceq (@($firstThree | Sort-Object) -join '|'))
    Test-Check 'first run prints one inbox-relative line per fed file' ((@(Get-Lines $r.Stdout | Where-Object { $_ -like 'inbox/*' }) -join '|') -ceq (@($firstThree | ForEach-Object { "inbox/$_" }) -join '|'))
    Test-Check 'first run summary counts fed 3, skipped 0, refused 1, inbox 3' (Test-Summary $r.Stdout @(3, 0, 1, 3))
    Test-Check 'the over-long name is refused with a warning naming its path' ($r.Stderr -match "refused up:docs/$longStem\.md")
    Test-Check 'a .md file gets the provenance header and its body unchanged' (Test-Header $expected['README.md'] 'README.md' $bodies['README.md'] "`n" $null)
    Test-Check 'a file with no extension is named with no trailing dot and copied byte for byte' (Test-BytesEqual ([System.IO.File]::ReadAllBytes((Join-Path $inbox $expected['docs/LICENSE']))) $bodies['docs/LICENSE'])
    Test-Check 'the private clone is a bare repo under LOCALAPPDATA\llm-wiki-feed\<kb>\<source>' (Test-Path -LiteralPath (Join-Path $cloneBase 'up\HEAD') -PathType Leaf)
    Test-Check 'no staging file is left in the KB .git directory' (@(Get-ChildItem -LiteralPath (Join-Path $kb '.git') -Filter 'feed-inbox-*').Count -eq 0)
    foreach ($n in Get-Names $inbox) { $everFed.Add($n) }

    # --- Acceptance 6: an inbox already at -MaxFiles gains nothing.
    $before = (Get-Names $inbox) -join '|'
    $r = Invoke-Feeder $kb @('-MaxFiles', '3')
    Test-Check 'inbox-full run exits 0' ($r.ExitCode -eq 0)
    Test-Check 'inbox-full run adds nothing (inbox names unchanged)' (((Get-Names $inbox) -join '|') -ceq $before)
    Test-Check 'inbox-full run summary counts fed 0, skipped 3, refused 1, inbox 3' (Test-Summary $r.Stdout @(0, 3, 1, 3))
    $r = Invoke-Feeder $kb @('-MaxFiles', '2')
    Test-Check 'an inbox over -MaxFiles adds nothing' ((((Get-Names $inbox) -join '|') -ceq $before) -and (Test-Summary $r.Stdout @(0, 3, 1, 3)))

    # -WhatIf writes nothing to inbox/, and the only operations it reports as
    # skipped are the feeds themselves: the internal hooks-dir and temp-file
    # operations still run, so every What-if line names an inbox/ target.
    $r = Invoke-Feeder $kb @('-MaxFiles', '100', '-WhatIf')
    Test-Check '-WhatIf exits 0 and writes nothing to inbox/' (($r.ExitCode -eq 0) -and (((Get-Names $inbox) -join '|') -ceq $before))
    $whatIfLines = @(Get-Lines $r.Stdout | Where-Object { $_ -like 'What if:*' })
    Test-Check '-WhatIf reports only feed operations, never an internal directory operation' (($whatIfLines.Count -gt 0) -and (@($whatIfLines | Where-Object { $_ -notmatch 'target "inbox/' }).Count -eq 0))

    # --- Dedupe against sources/: the ingest skill moves fed files to sources/; they are never re-fed.
    foreach ($n in Get-Names $inbox) { Move-Item -LiteralPath (Join-Path $inbox $n) -Destination (Join-Path $sources $n) }
    $r = Invoke-Feeder $kb @('-MaxFiles', '100')
    $rest = @($expected['docs/b.md'], $expected['docs/c.md'], $expected['docs/data.bin'], $expected['docs/notes.txt'], $expected['skills/x/SKILL.md'])
    Test-Check 'after a move to sources/, the next run feeds only the remaining 5' ((@(Get-Names $inbox) -join '|') -ceq (@($rest | Sort-Object) -join '|'))
    Test-Check 'after a move to sources/, summary counts fed 5, skipped 3, refused 1, inbox 5' (Test-Summary $r.Stdout @(5, 3, 1, 5))
    Test-Check 'a CRLF .md keeps its CRLF body and gets a CRLF header' (Test-Header $expected['docs/b.md'] 'docs/b.md' $bodies['docs/b.md'] "`r`n" $null)
    $cBody = New-Object byte[] ($bodies['docs/c.md'].Length - 3)
    [Array]::Copy($bodies['docs/c.md'], 3, $cBody, 0, $cBody.Length)
    Test-Check 'a UTF-8 BOM body has its BOM dropped, not left mid-file' (Test-Header $expected['docs/c.md'] 'docs/c.md' $cBody "`n" $null)
    Test-Check 'a .txt file gets the provenance header' (Test-Header $expected['docs/notes.txt'] 'docs/notes.txt' $bodies['docs/notes.txt'] "`n" $null)
    Test-Check 'a binary file is copied byte for byte with no header' (Test-BytesEqual ([System.IO.File]::ReadAllBytes((Join-Path $inbox $expected['docs/data.bin']))) $bodies['docs/data.bin'])
    Test-Check '**/SKILL.md matches a nested path' ((Get-Names $inbox) -contains $expected['skills/x/SKILL.md'])
    foreach ($n in Get-Names $inbox) { $everFed.Add($n) }

    # --- Acceptance 2: an immediate re-run feeds nothing new.
    $before = (Get-Names $inbox) -join '|'
    $r = Invoke-Feeder $kb @('-MaxFiles', '100')
    Test-Check 're-run exits 0 and feeds nothing new' (($r.ExitCode -eq 0) -and (((Get-Names $inbox) -join '|') -ceq $before))
    Test-Check 're-run summary counts fed 0, skipped 8, refused 1, inbox 5' (Test-Summary $r.Stdout @(0, 8, 1, 5))

    # Hooks: plant a reference-transaction hook in the private clone. The control
    # runs git there without the feeder's hooksPath and must fire it; the feeder's
    # own fetch must not.
    $clone = Join-Path $cloneBase 'up'
    $marker = Join-Path $work 'hook-fired.txt'
    $hookFile = Join-Path $clone 'hooks\reference-transaction'
    [System.IO.File]::WriteAllText($hookFile, "#!/bin/sh`necho fired >> '$($marker -replace '\\', '/')'`n", (New-Object System.Text.UTF8Encoding($false)))
    $control = Invoke-Captured 'git' @("--git-dir=$clone", 'update-ref', 'refs/test/control', 'refs/feed/head')
    Test-Check 'control: the planted hook fires for a plain git call in the clone' (($control.ExitCode -eq 0) -and (Test-Path -LiteralPath $marker))
    if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker -Force }

    # --- Acceptance 3: changing one file upstream feeds exactly its new revision.
    Write-UpstreamFile 'docs/a.md' (Get-Utf8Bytes "alpha revised`n")
    $null = Invoke-Upstream @('add', '-A')
    $null = Invoke-Upstream @('commit', '-q', '-m', 'revise a')
    $newCommit = Invoke-Upstream @('rev-parse', 'HEAD')
    $newA = "up--docs--a--$(Get-BlobShort 'docs/a.md').md"
    $before = @(Get-Names $inbox)
    $headBefore = (Invoke-Captured 'git' @("--git-dir=$clone", 'rev-parse', 'refs/feed/head')).Stdout.Trim()
    $r = Invoke-Feeder $kb @('-MaxFiles', '100')
    $headAfter = (Invoke-Captured 'git' @("--git-dir=$clone", 'rev-parse', 'refs/feed/head')).Stdout.Trim()
    $added = @(Get-Names $inbox | Where-Object { $before -notcontains $_ })
    Test-Check 'a changed upstream file feeds exactly its new revision' (($added.Count -eq 1) -and ($added[0] -ceq $newA))
    Test-Check 'the new revision header names the new commit' (Test-Header $newA 'docs/a.md' (Get-Utf8Bytes "alpha revised`n") "`n" $newCommit)
    Test-Check 'changed-file summary counts fed 1, skipped 7, refused 1, inbox 6' (Test-Summary $r.Stdout @(1, 7, 1, 6))
    # The hook check means something only if this run's fetch moved the ref, the
    # reference transaction the planted hook would fire on.
    Test-Check 'the feeder fetch moved refs/feed/head to the new commit during this run' (($headBefore -cne $headAfter) -and ($headAfter -ceq $newCommit))
    Test-Check 'the feeder fetch ran no hook from the clone' (-not (Test-Path -LiteralPath $marker))
    foreach ($n in Get-Names $inbox) { $everFed.Add($n) }

    # --- Acceptance 4: excluded and unmatched paths are never fed, across every run above.
    $allNames = @(@(Get-Names $inbox) + @(Get-Names $sources) | Sort-Object -Unique)
    $wanted = @(@($expected.Values) + @($newA) | Sort-Object -Unique)
    Test-Check 'inbox/ and sources/ hold exactly the expected fed names' (($allNames -join '|') -ceq ($wanted -join '|'))
    Test-Check 'the excluded path docs/archive/** was never fed' (@($everFed | Where-Object { $_ -like 'up--docs--archive--*' }).Count -eq 0)
    Test-Check 'docs/*.md did not match the two-segment docs/sub/deep.md' (@($everFed | Where-Object { $_ -like 'up--docs--sub--*' }).Count -eq 0)
    Test-Check 'an unincluded path notes/other.md was never fed' (@($everFed | Where-Object { $_ -like 'up--notes--*' }).Count -eq 0)

    # --- Acceptance 5 and the other refusals, on a second KB with an empty inbox.
    New-TestKb $kb2
    $cloneBase2 = Get-CloneBase $kb2
    $inbox2 = Join-Path $kb2 'inbox'

    $r = Invoke-Feeder $kb2
    Test-Check 'a KB with no feed.json exits 0 with nothing to feed' (($r.ExitCode -eq 0) -and ($r.Stdout -match 'nothing to feed') -and (@(Get-Names $inbox2).Count -eq 0))

    $badUrl = ConvertTo-Json (Join-Path $work 'no-such-repo')
    Set-FeedConfig $kb2 "{ `"sources`": [ $($goodSource.Replace('"up"', '"good"')), { `"name`": `"bad`", `"url`": $badUrl, `"branch`": `"main`", `"include`": [`"**/*.md`"] } ] }"
    $r = Invoke-Feeder $kb2
    Test-Check 'a bad URL exits non-zero' ($r.ExitCode -ne 0)
    Test-Check 'a bad URL is refused by the fetch, in one stderr line naming the source' ((@(Get-Lines $r.Stderr).Count -eq 1) -and ($r.Stderr -match "^feed-inbox: fetching branch 'main' of source 'bad' from .*no-such-repo failed: "))
    Test-Check 'a bad URL after a good source writes nothing to inbox/' (@(Get-Names $inbox2).Count -eq 0)
    Test-Check 'the good source was fetched before the failure (fetch-all-first)' (Test-Path -LiteralPath (Join-Path $cloneBase2 'good\refs\feed\head'))

    $configCases = @(
        @{ Label = 'not JSON';            Json = '{ "sources": [ ';                                                            Expect = 'not readable JSON' }
        @{ Label = 'a bad source name';   Json = "{ `"sources`": [ $($goodSource.Replace('"up"', '"Bad_Name"')) ] }";        Expect = 'sources\[0\]\.name must be lowercase' }
        @{ Label = 'a misspelt key';      Json = "{ `"sources`": [ $($goodSource.Replace('"exclude"', '"exlude"')) ] }";     Expect = "unknown key 'exlude'" }
        @{ Label = 'an empty include';    Json = "{ `"sources`": [ { `"name`": `"x`", `"url`": $urlJson, `"branch`": `"main`", `"include`": [] } ] }"; Expect = 'include must be a non-empty list' }
        @{ Label = 'an empty url';        Json = "{ `"sources`": [ { `"name`": `"x`", `"url`": `"`", `"branch`": `"main`", `"include`": [`"*`"] } ] }"; Expect = 'needs a non-empty url' }
        @{ Label = 'an empty branch';     Json = "{ `"sources`": [ { `"name`": `"x`", `"url`": $urlJson, `"branch`": `"`", `"include`": [`"*`"] } ] }"; Expect = 'needs a non-empty branch' }
        @{ Label = 'a refspec branch';    Json = "{ `"sources`": [ { `"name`": `"x`", `"url`": $urlJson, `"branch`": `"main:evil`", `"include`": [`"*`"] } ] }"; Expect = 'unsupported branch name' }
        @{ Label = 'a duplicate name';    Json = "{ `"sources`": [ $goodSource, $goodSource ] }";                             Expect = "'up' is used more than once" }
        # URL rules. Each Expect names the rule: the refused scheme, the transport
        # form, or the password. Each URL points at a closed local port, so a
        # feeder without the rule fails fast at the fetch instead of hanging.
        @{ Label = 'an https URL';        Json = "{ `"sources`": [ { `"name`": `"x`", `"url`": `"https://127.0.0.1:1/x.git`", `"branch`": `"main`", `"include`": [`"*`"] } ] }"; Expect = "source 'x' url uses the 'https' scheme" }
        @{ Label = 'an http URL';         Json = "{ `"sources`": [ { `"name`": `"x`", `"url`": `"HTTP://127.0.0.1:1/x.git`", `"branch`": `"main`", `"include`": [`"*`"] } ] }"; Expect = "source 'x' url uses the 'HTTP' scheme" }
        @{ Label = 'a git:// URL';        Json = "{ `"sources`": [ { `"name`": `"x`", `"url`": `"git://127.0.0.1:1/x.git`", `"branch`": `"main`", `"include`": [`"*`"] } ] }"; Expect = "source 'x' url uses the 'git' scheme" }
        @{ Label = 'a transport:: URL';   Json = "{ `"sources`": [ { `"name`": `"x`", `"url`": `"ext::sh -c false`", `"branch`": `"main`", `"include`": [`"*`"] } ] }"; Expect = "source 'x' url uses the <transport>::" }
        @{ Label = 'an ssh URL with a password'; Json = "{ `"sources`": [ { `"name`": `"x`", `"url`": `"ssh://feeduser:hunter2@127.0.0.1:1/x.git`", `"branch`": `"main`", `"include`": [`"*`"] } ] }"; Expect = "source 'x' url carries a password" }
        # No :// in this URL, so only the scp-like password rule can name a password.
        @{ Label = 'an scp-like URL with a password'; Json = "{ `"sources`": [ { `"name`": `"x`", `"url`": `"feeduser:hunter2@nohost.invalid:x.git`", `"branch`": `"main`", `"include`": [`"*`"] } ] }"; Expect = "source 'x' url carries a password" }
    )
    foreach ($case in $configCases) {
        Set-FeedConfig $kb2 $case.Json
        $r = Invoke-Feeder $kb2
        Test-Check "config with $($case.Label) is refused by validation, nothing written" (($r.ExitCode -ne 0) -and ($r.Stderr -match $case.Expect) -and (@(Get-Lines $r.Stderr).Count -eq 1) -and (@(Get-Names $inbox2).Count -eq 0))
        if ($case.Label -like '*with a password') {
            Test-Check 'the password refusal does not echo the password' (($r.Stderr + $r.Stdout) -notmatch 'hunter2')
        }
    }

    # An accepted ssh:// URL with a user name reaches the fetch. The fetch fails
    # on the closed port, and its one-line refusal prints the URL with the user
    # name redacted.
    Set-FeedConfig $kb2 "{ `"sources`": [ { `"name`": `"sshsrc`", `"url`": `"ssh://feeduser@127.0.0.1:1/x.git`", `"branch`": `"main`", `"include`": [`"*`"] } ] }"
    $r = Invoke-Feeder $kb2
    Test-Check 'an ssh:// URL is accepted and fails at the fetch, in one stderr line naming the source' (($r.ExitCode -ne 0) -and (@(Get-Lines $r.Stderr).Count -eq 1) -and ($r.Stderr -match "^feed-inbox: fetching branch 'main' of source 'sshsrc' from ") -and (@(Get-Names $inbox2).Count -eq 0))
    Test-Check 'the fetch-failure line redacts the URL userinfo' (($r.Stderr -notmatch 'feeduser') -and ($r.Stderr -match '127\.0\.0\.1'))

    # --- The template grants the feeder no allow rule, so the KB agent cannot run it.
    $settings = [System.IO.File]::ReadAllText((Join-Path $script:engineRoot 'template\.claude\settings.json')) | ConvertFrom-Json
    Test-Check 'no allow rule in template settings.json names feed-inbox' (@($settings.permissions.allow | Where-Object { $_ -match 'feed' }).Count -eq 0)

    # --- A second upstream for name mapping, name and size refusals, UTF-32 BE,
    # selection order across sources, the KB lock, the stale-temp sweep, and the
    # git timeout.
    $script:upstream = Join-Path $work 'upstream2'
    New-Item -ItemType Directory -Path $script:upstream -Force | Out-Null
    $null = Invoke-Upstream @('init', '-q', '-b', 'main')
    # Single quotes keep the dollar sign, parentheses and backtick literal.
    $metaPath = 'odd/x$(y) `z.md'
    $u32be = [byte[]](0x00, 0x00, 0xFE, 0xFF, 0x00, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00, 0x0A)
    $bodies2 = @{
        'aa/a1.md'    = (Get-Utf8Bytes "a1`n")
        'aa/a2.md'    = (Get-Utf8Bytes "a2`n")
        'aa/a3.md'    = (Get-Utf8Bytes "a3`n")
        'bb/b1.md'    = (Get-Utf8Bytes "b1`n")
        'bb/b2.md'    = (Get-Utf8Bytes "b2`n")
        'odd/a..b.md' = (Get-Utf8Bytes "dot dot`n")
        'odd/u32be.md' = $u32be
    }
    $bodies2[$metaPath] = (Get-Utf8Bytes "metacharacters`n")
    foreach ($key in $bodies2.Keys) { Write-UpstreamFile $key $bodies2[$key] }
    # One byte over the 25 MB cap. Zeros compress to almost nothing, so the
    # fetch stays fast.
    $hugeFull = Join-Path $script:upstream 'big\huge.bin'
    New-Item -ItemType Directory -Path (Split-Path -Parent $hugeFull) -Force | Out-Null
    $stream = [System.IO.File]::Create($hugeFull)
    try { $stream.SetLength(25MB + 1) } finally { $stream.Dispose() }
    $null = Invoke-Upstream @('add', '-A')
    $null = Invoke-Upstream @('commit', '-q', '-m', 'second upstream')
    $url2Json = ConvertTo-Json $script:upstream
    $sourceAa = "{ `"name`": `"aa`", `"url`": $url2Json, `"branch`": `"main`", `"include`": [`"aa/*.md`"] }"
    $sourceBb = "{ `"name`": `"bb`", `"url`": $url2Json, `"branch`": `"main`", `"include`": [`"bb/*.md`"] }"

    # The lock: a second run that cannot take the KB's lock exits 0 with one line
    # and writes nothing, and its stale-temp sweep does not run.
    New-TestKb $kb3
    $cloneBase3 = Get-CloneBase $kb3
    $inbox3   = Join-Path $kb3 'inbox'
    $sources3 = Join-Path $kb3 'sources'
    Set-FeedConfig $kb3 "{ `"sources`": [ $sourceAa, $sourceBb ] }"
    $stale = Join-Path $kb3 '.git\feed-inbox-stale.tmp'
    [System.IO.File]::WriteAllText($stale, 'left by a killed run')
    New-Item -ItemType Directory -Path $cloneBase3 -Force | Out-Null
    $held = [System.IO.File]::Open((Join-Path $cloneBase3 'feed.lock'), [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    try {
        $r = Invoke-Feeder $kb3 @('-MaxFiles', '2')
    } finally {
        $held.Dispose()
    }
    Test-Check 'a run that cannot take the KB lock exits 0 with one stdout line and writes nothing' (($r.ExitCode -eq 0) -and (@(Get-Lines $r.Stdout).Count -eq 1) -and ($r.Stderr.Trim() -eq '') -and (@(Get-Names $inbox3).Count -eq 0) -and (Test-Path -LiteralPath $stale))

    # Selection order: never-fed paths first, round-robin across sources in
    # config order, ordinal path within a source.
    $r = Invoke-Feeder $kb3 @('-MaxFiles', '2')
    $a1 = "aa--aa--a1--$(Get-BlobShort 'aa/a1.md').md"
    $a2 = "aa--aa--a2--$(Get-BlobShort 'aa/a2.md').md"
    $a3 = "aa--aa--a3--$(Get-BlobShort 'aa/a3.md').md"
    $b1 = "bb--bb--b1--$(Get-BlobShort 'bb/b1.md').md"
    $b2 = "bb--bb--b2--$(Get-BlobShort 'bb/b2.md').md"
    Test-Check 'two sources and -MaxFiles 2: the first run feeds the first path of each source' (((Get-Names $inbox3) -join '|') -ceq ((@($a1, $b1) | Sort-Object) -join '|'))
    Test-Check 'two-source first run summary counts fed 2, skipped 0, refused 0, inbox 2' (Test-Summary $r.Stdout @(2, 0, 0, 2))
    Test-Check 'a stale feed-inbox-*.tmp left in .git by a killed run is swept' (-not (Test-Path -LiteralPath $stale))

    foreach ($n in Get-Names $inbox3) { Move-Item -LiteralPath (Join-Path $inbox3 $n) -Destination (Join-Path $sources3 $n) }
    Write-UpstreamFile 'aa/a1.md' (Get-Utf8Bytes "a1 revised`n")
    $null = Invoke-Upstream @('add', '-A')
    $null = Invoke-Upstream @('commit', '-q', '-m', 'revise a1')
    $a1New = "aa--aa--a1--$(Get-BlobShort 'aa/a1.md').md"
    $r = Invoke-Feeder $kb3 @('-MaxFiles', '1')
    Test-Check 'a never-fed path is fed before a revision of an already-fed path' (((Get-Names $inbox3) -join '|') -ceq $a2)
    Test-Check 'never-fed-first run summary counts fed 1, skipped 1, refused 0, inbox 1' (Test-Summary $r.Stdout @(1, 1, 0, 1))
    $r = Invoke-Feeder $kb3 @('-MaxFiles', '3')
    Test-Check 'the never-fed group is taken round-robin across sources, still ahead of the revision' (((Get-Names $inbox3) -join '|') -ceq ((@($a2, $a3, $b2) | Sort-Object) -join '|'))
    $r = Invoke-Feeder $kb3 @('-MaxFiles', '10')
    Test-Check 'the revision is fed once no never-fed path remains' (((Get-Names $inbox3) -join '|') -ceq ((@($a1New, $a2, $a3, $b2) | Sort-Object) -join '|'))

    # A path holding a newline, which git allows and NTFS cannot hold, so it is
    # committed through the index alone. Nothing later runs add -A, which would
    # stage its deletion from the working tree.
    $nlPath = "odd/new`nline.md"
    $nlBody = Get-Utf8Bytes "newline path`n"
    $nlFile = Join-Path $work 'newline-body.txt'
    [System.IO.File]::WriteAllBytes($nlFile, $nlBody)
    $nlSha = Invoke-Upstream @('hash-object', '-w', '--', $nlFile)
    $null = Invoke-Upstream @('-c', 'core.protectNTFS=false', 'update-index', '--add', '--cacheinfo', "100644,$nlSha,$nlPath")
    $null = Invoke-Upstream @('-c', 'core.protectNTFS=false', 'commit', '-q', '-m', 'newline path')
    $nlName = "odd--odd--new-line--$($nlSha.Substring(0, 7)).md"

    # Name mapping, the name and size refusals, and UTF-32 BE.
    New-TestKb $kb4
    $cloneBase4 = Get-CloneBase $kb4
    $inbox4 = Join-Path $kb4 'inbox'
    Set-FeedConfig $kb4 "{ `"sources`": [ { `"name`": `"odd`", `"url`": $url2Json, `"branch`": `"main`", `"include`": [`"odd/*`", `"big/*`"] } ] }"
    $r = Invoke-Feeder $kb4 @('-MaxFiles', '100')
    $metaName = "odd--odd--x--y---z--$(Get-BlobShort $metaPath).md"
    $u32Name  = "odd--odd--u32be--$(Get-BlobShort 'odd/u32be.md').md"
    $names4 = @(Get-Names $inbox4)
    # Only the '..' rule can refuse odd/a..b.md: its fed name is short and every
    # character is in the mapped set. Only the size cap can refuse big/huge.bin:
    # its fed name passes every name rule.
    Test-Check "a fed name containing '..' is refused with a warning naming its path, and not fed" (($r.Stderr -match [regex]::Escape('refused odd:odd/a..b.md')) -and (@($names4 | Where-Object { $_.Contains('..') }).Count -eq 0))
    Test-Check 'a blob over 25 MB is refused with a warning naming its path, and not fed' (($r.Stderr -match [regex]::Escape('refused odd:big/huge.bin')) -and (@($names4 | Where-Object { $_ -like 'odd--big--*' }).Count -eq 0))
    Test-Check 'shell metacharacters, spaces and backticks in a path map to dashes in the fed name' ($names4 -ccontains $metaName)
    $urlPattern = [regex]::Escape($script:upstream)
    $script:inboxNow = $inbox4
    Test-Check 'the header names the true upstream path with backticks stripped' (Test-Header $metaName 'odd/x$(y) z.md' $bodies2[$metaPath] "`n" $null)
    Test-Check 'a UTF-32 BE body is copied byte for byte with no header' (Test-BytesEqual ([System.IO.File]::ReadAllBytes((Join-Path $inbox4 $u32Name))) $u32be)
    Test-Check 'the header shows a newline in the path as a dash' (Test-Header $nlName 'odd/new-line.md' $nlBody "`n" $null)
    $nlFed = Join-Path $inbox4 $nlName
    $nlLineFeeds = if (Test-Path -LiteralPath $nlFed) { @([System.IO.File]::ReadAllBytes($nlFed) | Where-Object { $_ -eq 10 }).Count } else { -1 }
    Test-Check 'a newline in the path leaves the header block at its 2 lines, 3 line feeds with the 1-line body' ($nlLineFeeds -eq 3)
    Test-Check 'odd-source summary counts fed 3, skipped 0, refused 2, inbox 3' (Test-Summary $r.Stdout @(3, 0, 2, 3))

    # The git timeout. A packObjectsHook in a global config file read through
    # GIT_CONFIG_GLOBAL makes the upstream side of a first fetch sleep, and
    # FEED_INBOX_GIT_TIMEOUT_SECONDS shortens the bound so the run is quick.
    New-TestKb $kb5
    $cloneBase5 = Get-CloneBase $kb5
    $inbox5 = Join-Path $kb5 'inbox'
    Set-FeedConfig $kb5 "{ `"sources`": [ { `"name`": `"slow`", `"url`": $url2Json, `"branch`": `"main`", `"include`": [`"aa/*.md`"] } ] }"
    $hangMarker = "hang-$runId"
    $hangScript = Join-Path $work "$hangMarker.sh"
    [System.IO.File]::WriteAllText($hangScript, "#!/bin/sh`nsleep 40`n")
    $hangConfig = Join-Path $work 'hang.gitconfig'
    [System.IO.File]::WriteAllText($hangConfig, "[uploadpack]`n`tpackObjectsHook = sh '$($hangScript -replace '\\', '/')'`n")
    $env:GIT_CONFIG_GLOBAL = $hangConfig
    $env:FEED_INBOX_GIT_TIMEOUT_SECONDS = '5'
    try {
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        $r = Invoke-Feeder $kb5
        $elapsed = $watch.Elapsed.TotalSeconds
    } finally {
        Remove-Item -LiteralPath Env:GIT_CONFIG_GLOBAL -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath Env:FEED_INBOX_GIT_TIMEOUT_SECONDS -ErrorAction SilentlyContinue
    }
    Test-Check 'a fetch that outlives the git timeout exits non-zero inside the bound, in one stderr line naming the source, nothing written' (($r.ExitCode -ne 0) -and ($elapsed -lt 30) -and (@(Get-Lines $r.Stderr).Count -eq 1) -and ($r.Stderr -match "source 'slow'") -and (@(Get-Names $inbox5).Count -eq 0))
    # The override replaces every bound alike, so only the bound's kind in the
    # line shows the feeder chose the first-fetch bound for a clone never fetched.
    Test-Check 'the timeout line names the first-fetch bound for a clone that has never completed a fetch' ($r.Stderr -match '\bfirst-fetch bound\b')

    # The run budget. With the budget below the per-call bound, the budget caps
    # the same slow first fetch, and the run ends near the budget.
    $env:GIT_CONFIG_GLOBAL = $hangConfig
    $env:FEED_INBOX_GIT_TIMEOUT_SECONDS = '30'
    $env:FEED_INBOX_RUN_SECONDS = '5'
    try {
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        $r = Invoke-Feeder $kb5
        $elapsed = $watch.Elapsed.TotalSeconds
    } finally {
        Remove-Item -LiteralPath Env:GIT_CONFIG_GLOBAL -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath Env:FEED_INBOX_GIT_TIMEOUT_SECONDS -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath Env:FEED_INBOX_RUN_SECONDS -ErrorAction SilentlyContinue
    }
    Test-Check 'a fetch that outlives the run budget exits non-zero in one stderr line naming the run budget, nothing written' (($r.ExitCode -eq 1) -and (@(Get-Lines $r.Stderr).Count -eq 1) -and ($r.Stderr -match 'run budget') -and ($r.Stderr -match "source 'slow'") -and (@(Get-Names $inbox5).Count -eq 0))
    Test-Check 'a run stopped by its 5-second budget ends near the budget, well before the 30-second per-call bound' (($elapsed -ge 4) -and ($elapsed -lt 20))

    # Waits for any process running the hang hook to end, and returns those that
    # have not. A leftover is this test's own process tree.
    function Get-HangLeftover {
        $found = @()
        for ($i = 0; $i -lt 10; $i++) {
            $found = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($hangMarker) })
            if ($found.Count -eq 0) { break }
            Start-Sleep -Milliseconds 500
        }
        return ,$found
    }
    $leftover = Get-HangLeftover
    Test-Check 'the timed-out git process trees were stopped, so no process runs the hang hook' ($leftover.Count -eq 0)
    # A leftover is stopped by its PID.
    foreach ($p in $leftover) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    $r = Invoke-Feeder $kb5 @('-MaxFiles', '1')
    Test-Check 'without the hang, the next run fetches and feeds normally' (($r.ExitCode -eq 0) -and (Test-Summary $r.Stdout @(1, 0, 0, 1)))

    # A later fetch, into a clone that holds refs/feed/head, takes the later-fetch
    # bound. A new upstream commit gives upload-pack something to pack, so the
    # hook runs.
    Write-UpstreamFile 'aa/a4.md' (Get-Utf8Bytes "a4`n")
    $null = Invoke-Upstream @('add', '-A')
    $null = Invoke-Upstream @('commit', '-q', '-m', 'add a4')
    $env:GIT_CONFIG_GLOBAL = $hangConfig
    $env:FEED_INBOX_GIT_TIMEOUT_SECONDS = '5'
    try {
        $r = Invoke-Feeder $kb5
    } finally {
        Remove-Item -LiteralPath Env:GIT_CONFIG_GLOBAL -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath Env:FEED_INBOX_GIT_TIMEOUT_SECONDS -ErrorAction SilentlyContinue
    }
    Test-Check 'a later fetch past its bound exits non-zero in one stderr line naming the later-fetch bound' (($r.ExitCode -eq 1) -and (@(Get-Lines $r.Stderr).Count -eq 1) -and ($r.Stderr -match '\blater-fetch bound\b') -and ($r.Stderr -notmatch 'first-fetch'))
    $leftover = Get-HangLeftover
    Test-Check 'the timed-out later fetch was stopped, so no process runs the hang hook' ($leftover.Count -eq 0)
    foreach ($p in $leftover) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
} finally {
    foreach ($dir in @($work, $cloneBase, $cloneBase2, $cloneBase3, $cloneBase4, $cloneBase5)) {
        if ($dir -and (Test-Path -LiteralPath $dir)) {
            Remove-Item -LiteralPath $dir -Recurse -Force
        }
    }
}

if ($failures -eq 0) {
    Write-Host 'All feeder checks passed.'
    exit 0
} else {
    Write-Host "$failures feeder check(s) failed."
    exit 1
}
