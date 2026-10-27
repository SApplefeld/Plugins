#Requires -Version 5.1
<#
.SYNOPSIS
Copies new and changed files from configured git repositories into a knowledge
base's inbox/, so the ingest skill picks them up.

.DESCRIPTION
A scheduled feeder that runs as plain PowerShell and never invokes Claude. It is
vendored into the KB like the kb-*.ps1 helpers, but no permission rule grants
it. The KB's settings.json pins permissions.defaultMode to default, so every
session in the KB runs under the allow-list rather than in bypass mode, and the
allow-list neither runs this script nor writes .claude/, where its configuration
.claude/feed.json lives. So the KB agent cannot run it, and an ingested document
cannot widen what is fed. A session launched with an explicit bypass flag is
outside that guarantee. A KB without .claude/feed.json is valid; the feeder then
reports that there is nothing to feed and exits 0.

One run per KB proceeds at a time. A run takes an exclusive lock on the file
feed.lock in the KB's clone root, held open for the whole run, so the operating
system releases it when the run ends, however it ends. A run that finds the lock
held prints one line and exits 0 having changed nothing. A run that holds the
lock first deletes any feed-inbox-*.tmp file a killed run left in the KB's .git
directory.

Each source has a private bare clone under
%LOCALAPPDATA%\llm-wiki-feed\<kb-folder-name>-<hash>\<source-name>, where <hash>
is the first 8 hex digits of the SHA-256 of the KB's lowercased full path, so two
KBs with the same folder name never share clones. The clone is created on the
first run and fetched on every run. Only the configured branch is fetched, into
the local ref refs/feed/head, with transfer.fsckObjects on, and only that ref's
tree is read. The feeder never reads or writes any other checkout. Every git
call runs with core.hooksPath set to an empty directory, so no hook in a clone
can execute.

No git call can wait on a person. Each runs with GIT_TERMINAL_PROMPT=0 and
GCM_INTERACTIVE=never, so neither git nor Git Credential Manager prompts, and
with GIT_SSH_COMMAND set to ssh in batch mode with a 30-second connect timeout
and keep-alives, which replaces any core.sshCommand. Each git call has a bound
by kind. A first fetch, into a clone that has no refs/feed/head yet, takes the
first-fetch bound of 1800 seconds, because it transfers the whole branch history
and git keeps nothing of a stopped fetch. Every later fetch takes the
later-fetch bound of 300 seconds, and every other git call the local bound of 60
seconds.

A run also holds a budget of 50 minutes from its start. The Feed task that
register-task.ps1 registers has a 1-hour execution time limit, and the 10
minutes between them cover local work and stopping a timed-out git process.
Each git call waits for its bound or for what is left of the budget, whichever
is shorter. A call past that wait has its process tree stopped, and the run
exits 1 before writing that file, with one line naming the source and either
the run budget or the kind of bound that stopped it. A git call due after the
budget is spent is never started, and the run exits 1 the same way. So no git
process the feeder starts outlives its run. Ending the task by hand in Task
Scheduler still ends only pwsh, and a git fetch it started can run on after
that.

The environment variable FEED_INBOX_GIT_TIMEOUT_SECONDS replaces all three
bounds, and FEED_INBOX_RUN_SECONDS replaces the budget. Each is a whole number
of seconds from 1 to 99999, and each exists so a test can drive a timeout path
quickly.

Every source is fetched before any file is written, so an unreachable remote or a
bad branch fails the run before inbox/ changes. Each regular file on the branch
tip whose repo-relative path matches an include glob and no exclude glob is a
candidate. A candidate is fed as
    <source>--<path without extension, every / as -->--<blob sha 7>.<ext>
with every character of the path and extension outside A-Z a-z 0-9 . _ - mapped
to a dash, because the ingest skill passes the name to a shell inside double
quotes, where $, a backtick or a parenthesis would expand. The name is one that
kb-move.ps1, kb-commit.ps1 and kb-status.ps1 all accept. A name already present
in inbox/ or sources/ is skipped, so an unchanged file is never fed twice and a
changed file is fed once per content revision. No state file is kept. The
mapping can give two paths one name, such as a/b--c.md and a--b/c.md, or
"a b.md" and a-b.md. The blob hash is part of the name, so only identical
contents collide and no content is lost. NTFS compares names without regard to
case, so dedupe does too, and two paths differing only in case with the same
contents collapse to one fed file.

A candidate is refused with a warning on stderr naming its path, counted as
refused, and the run continues, when its fed name would contain / \ or :, start
with a dash, contain '..', hold a character Windows cannot hold in a file name,
end with a dot or a space, or be longer than 150 characters, or when its blob is
over 25 MB.

At most -MaxFiles minus the number of files already in inbox/ (excluding
.gitkeep) are added per run, so nothing is added while inbox/ already holds
-MaxFiles files and a large backfill flows in batches an ingest run can finish.
The budget goes first to candidates whose path has never been fed, meaning no
file in inbox/ or sources/ carries that path's name up to the blob hash, and only
then to new revisions of paths already fed. Within each group the sources take
turns, one candidate each in config order, and a source's candidates come in
ordinal path order, so one busy source cannot starve another.

A fed .md or .txt file starts with a one-line provenance block naming the
repository, branch, path, and the last commit touching the path with its commit
date, then a blank line, then the original bytes. The block is UTF-8 without a
BOM and uses the body's line ending. The repository URL in it has any user name
or password replaced by ***, as in every line the feeder prints. The path has
any backtick removed so it cannot end the block's code span, and each newline or
other control character shown as a dash so the block stays one line. A UTF-8 BOM on
the body is dropped so it does not sit mid-file; a UTF-16 or UTF-32 body, which
a UTF-8 block would corrupt, is copied without a block. Every other file type is
copied byte for byte. Each file is written under a temporary name inside the
KB's .git directory, on the same volume as inbox/, then moved into inbox/ in one
rename, so a crash never leaves a partial file the ingest skill could pick up. A
file another writer put at the same inbox/ name first is left alone and the
candidate counted as skipped-existing.

With -WhatIf nothing is written to inbox/, but the run still takes the lock,
sweeps stale temporary files, and fetches every source, because the fetch is
what tells it which files it would feed.

Stdout carries one line per fed file, its inbox-relative path, and a closing
summary line. Any failure exits 1 with one line on stderr.

.PARAMETER KbPath
The knowledge base root. Defaults to the parent of the .claude/ directory this
script lives in. It must hold inbox/, sources/, and a .git directory.

.PARAMETER MaxFiles
The most files inbox/ may hold after this run, counting files already there
(excluding .gitkeep). Defaults to 10. Zero adds nothing.

.EXAMPLE
pwsh -NoProfile -File ./.claude/feed-inbox.ps1

.EXAMPLE
pwsh -NoProfile -File ./.claude/feed-inbox.ps1 -MaxFiles 25 -WhatIf

.EXAMPLE
The shape of .claude/feed.json. Every key shown is the full set allowed, and an
unknown key is refused so a misspelt "exclude" cannot silently feed everything.

{
  "sources": [
    {
      "name": "grimoire",
      "url": "git@github.com:SApplefeld/Grimoire.git",
      "branch": "main",
      "include": ["docs/*.md", "**/SKILL.md", "**/README.md"],
      "exclude": ["docs/archive/**"]
    }
  ]
}

name is lowercase letters, digits and dashes, starting with a letter or digit,
and unique. url is an scp-like SSH address ([user@]host:path), an ssh:// URL, a
file:// URL, or a local path. An http://, https://, git:// or any other scheme
is refused, as is git's <transport>::<address> form and any URL carrying a
password, so no source can lean on a credential prompt or store a secret in
feed.json. branch is a plain branch name. include is a non-empty list; exclude
is optional. Globs match repo-relative forward-slash paths case-sensitively: *
matches within one path segment, ** matches across segments including none, so
**/README.md also matches a root README.md. Every other character matches
itself.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$KbPath,

    [int]$MaxFiles = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Git failures are surfaced by checking exit codes explicitly, so native command
# failures must not auto-throw and produce a stack trace.
$PSNativeCommandUseErrorActionPreference = $false

# Writes a single-line reason to stderr and stops with a non-zero exit code, so
# a refusal is legible to an unattended caller without a PowerShell stack trace.
function Stop-WithReason {
    param([string]$Reason)
    [Console]::Error.WriteLine("feed-inbox: $Reason")
    exit 1
}

# Writes a single-line warning to stderr and lets the run continue.
function Write-FeedWarning {
    param([string]$Message)
    [Console]::Error.WriteLine("feed-inbox: warning: $Message")
}

# Reads a property that may be absent. Under Set-StrictMode, a plain property
# access on a missing member throws, so every read of parsed JSON goes through here.
# A list is returned wrapped, because PowerShell unrolls a returned array and a
# one-element list would otherwise reach the caller as its bare element.
function Get-JsonProperty {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    foreach ($property in $Object.PSObject.Properties) {
        if ($property.Name -ceq $Name) {
            if ($null -eq $property.Value) { return $null }
            return ,$property.Value
        }
    }
    return $null
}

# Refuses any key outside the allowed set, naming where it was found.
function Assert-OnlyKeys {
    param($Object, [string[]]$Allowed, [string]$Where)
    foreach ($property in $Object.PSObject.Properties) {
        if ($Allowed -cnotcontains $property.Name) {
            Stop-WithReason "feed.json: unknown key '$($property.Name)' in $Where; allowed keys are $($Allowed -join ', ')."
        }
    }
}

# Reads a JSON list of non-empty glob strings and compiles each to a regex.
function ConvertTo-GlobList {
    param($Value, [string]$Where, [bool]$Required)
    if ($null -eq $Value) {
        if ($Required) { Stop-WithReason "feed.json: $Where is required and must be a non-empty list of globs." }
        return ,@()
    }
    if ($Value -isnot [array]) {
        Stop-WithReason "feed.json: $Where must be a list of globs."
    }
    if ($Required -and $Value.Count -eq 0) {
        Stop-WithReason "feed.json: $Where must be a non-empty list of globs."
    }
    $compiled = New-Object System.Collections.Generic.List[regex]
    foreach ($glob in $Value) {
        if ($glob -isnot [string] -or [string]::IsNullOrWhiteSpace($glob)) {
            Stop-WithReason "feed.json: every entry of $Where must be a non-empty string."
        }
        if ($glob.Contains('\')) {
            Stop-WithReason "feed.json: glob '$glob' in $Where contains a backslash; globs match forward-slash paths."
        }
        $compiled.Add((ConvertTo-GlobRegex $glob))
    }
    return ,$compiled.ToArray()
}

# Compiles a glob to an anchored, case-sensitive regex over a forward-slash path.
# **/ matches zero or more whole segments, any other ** matches anything, * matches
# within one segment, and every other character is literal.
function ConvertTo-GlobRegex {
    param([string]$Glob)
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('^')
    $i = 0
    while ($i -lt $Glob.Length) {
        if ([string]::CompareOrdinal($Glob, $i, '**/', 0, 3) -eq 0) {
            [void]$builder.Append('(?:.*/)?')
            $i += 3
        } elseif ([string]::CompareOrdinal($Glob, $i, '**', 0, 2) -eq 0) {
            [void]$builder.Append('.*')
            $i += 2
        } elseif ($Glob[$i] -eq [char]'*') {
            [void]$builder.Append('[^/]*')
            $i += 1
        } else {
            [void]$builder.Append([regex]::Escape([string]$Glob[$i]))
            $i += 1
        }
    }
    [void]$builder.Append('$')
    return New-Object regex($builder.ToString(), [System.Text.RegularExpressions.RegexOptions]::CultureInvariant)
}

# True when the path matches any include and no exclude.
function Test-PathSelected {
    param([string]$RepoPath, [regex[]]$Include, [regex[]]$Exclude)
    $included = $false
    foreach ($rx in $Include) {
        if ($rx.IsMatch($RepoPath)) { $included = $true; break }
    }
    if (-not $included) { return $false }
    foreach ($rx in $Exclude) {
        if ($rx.IsMatch($RepoPath)) { return $false }
    }
    return $true
}

# The reason a source URL is refused, or $null when it is accepted. Accepted are
# scp-like SSH ([user@]host:path), ssh:// and file:// URLs without a password,
# and local paths. Every other scheme is refused, which takes in http, https and
# git, and so is git's <transport>::<address> form, which runs a remote helper.
# The reason never quotes the URL, so a refusal cannot print a password.
function Get-UrlRefusal {
    param([string]$Url)
    $schemeEnd = $Url.IndexOf('://')
    if ($schemeEnd -ge 0) {
        $scheme = $Url.Substring(0, $schemeEnd)
        if ($scheme -notmatch '^[A-Za-z][A-Za-z0-9+.-]*$') {
            return 'has text before :// that is not a URL scheme'
        }
        if ($scheme -ine 'ssh' -and $scheme -ine 'file') {
            return "uses the '$scheme' scheme; only scp-like SSH (host:path), ssh://, file:// and local paths are accepted"
        }
        $rest = $Url.Substring($schemeEnd + 3)
        $slash = $rest.IndexOf('/')
        $authority = if ($slash -ge 0) { $rest.Substring(0, $slash) } else { $rest }
        $at = $authority.LastIndexOf('@')
        if ($at -ge 0 -and $authority.Substring(0, $at).Contains(':')) {
            return 'carries a password; authenticate with an SSH key instead'
        }
        return $null
    }
    if ($Url.Contains('::')) {
        return 'uses the <transport>::<address> form, which runs a git remote helper; only scp-like SSH (host:path), ssh://, file:// and local paths are accepted'
    }
    # An scp-like address with a colon before its @, as in user:password@host:path.
    # A drive-letter path reaches a slash or backslash before any @, so it passes.
    if ($Url -match '^[^/\\@]*:[^/\\@]*@') {
        return 'carries a password; authenticate with an SSH key instead'
    }
    return $null
}

# The URL with its userinfo, the user name and any password, replaced by ***.
# Every line that prints a URL prints this form. An scp-like address's user is
# the text before @ when a host and a colon follow it; a local path, such as a
# drive-letter path holding an @, is left as it is.
function Format-RedactedUrl {
    param([string]$Url)
    if ($Url -match '^[A-Za-z][A-Za-z0-9+.-]*://') {
        return ($Url -replace '^([A-Za-z][A-Za-z0-9+.-]*://)[^/]*@', '$1***@')
    }
    return ($Url -replace '^[^/\\:]+@(?=[^/\\:]+:)', '***@')
}

# Quotes one argument for a Windows command line so the child process receives
# it unchanged, whatever spaces, quotes or trailing backslashes it holds.
function ConvertTo-CommandLineArgument {
    param([string]$Value)
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') {
        return $Value
    }
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($c in $Value.ToCharArray()) {
        if ($c -eq [char]'\') {
            $backslashes++
            continue
        }
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

# Stops a git process and every process it started, such as ssh, a remote
# helper or a credential helper. taskkill /T walks the tree on both PowerShell
# editions; Windows PowerShell's .NET has no tree-aware Process.Kill. Its output
# is read and discarded so it never reaches the feeder's stdout.
function Stop-GitProcessTree {
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
    if (-not $Process.WaitForExit(5000)) {
        # taskkill could not stop it; stop the git process itself so the run's
        # exit does not leave it holding the clone.
        $Process.Kill()
    }
}

# Runs git with hooks neutralized, prompts disabled and a time bound, and returns
# its exit code, its stdout as raw bytes, and its stderr as text. Stdout is
# captured as bytes because a blob must reach inbox/ byte for byte and a path
# listing is UTF-8, neither of which PowerShell's native-command pipeline
# preserves on 5.1. Both streams are read asynchronously, so a child that fills
# one pipe cannot deadlock the other read, and the wait stays bounded. The wait
# is the call's bound by kind or what is left of the run budget, whichever is
# shorter. Past it the process tree is stopped and the run exits 1 with one line
# naming the action and whichever of the two stopped it. With no budget left,
# the call is not started and the run exits 1 the same way.
function Invoke-Git {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$Action,
        [ValidateSet('first-fetch', 'later-fetch', 'local')][string]$Bound = 'local'
    )
    $budgetLeft = ($script:runDeadline - [DateTime]::UtcNow).TotalSeconds
    if ($budgetLeft -le 0) {
        Stop-WithReason "$Action was not started: the run budget of $script:runBudgetSeconds seconds is spent."
    }
    $boundSeconds = $script:gitBounds[$Bound]
    $budgetCapped = $budgetLeft -lt $boundSeconds
    $waitSeconds = [int][Math]::Ceiling([Math]::Min($boundSeconds, $budgetLeft))
    $all = @('-c', "core.hooksPath=$script:hooksDir") + $Arguments
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $script:gitExe
    $psi.Arguments = (@($all | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
    # No git call may wait on a person: an unattended run has no one to answer,
    # and a credential helper such as Git Credential Manager would block on its
    # own prompt until the bound.
    $psi.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
    $psi.EnvironmentVariables['GCM_INTERACTIVE'] = 'never'
    $psi.EnvironmentVariables['GIT_SSH_COMMAND'] = 'ssh -o BatchMode=yes -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4'
    $process = [System.Diagnostics.Process]::Start($psi)
    $buffer = New-Object System.IO.MemoryStream
    $stdoutTask = $process.StandardOutput.BaseStream.CopyToAsync($buffer)
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $deadline = [DateTime]::UtcNow.AddSeconds($waitSeconds)
    $finished = $process.WaitForExit($waitSeconds * 1000)
    if ($finished) {
        # The streams close when every process holding them ends, which can be
        # after git itself, so they share what is left of the same bound.
        $remaining = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        $finished = [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($stdoutTask, $stderrTask), $remaining)
    }
    if (-not $finished) {
        Stop-GitProcessTree $process
        if ($budgetCapped) {
            Stop-WithReason "$Action did not finish before the run budget of $script:runBudgetSeconds seconds ran out; the git process was stopped."
        }
        Stop-WithReason "$Action did not finish within the $Bound bound of $waitSeconds seconds; the git process was stopped."
    }
    $process.WaitForExit()
    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        Stdout   = $buffer.ToArray()
        Stderr   = $stderrTask.Result
    }
}

# The first non-empty line of git's stderr, for a one-line refusal.
function Get-FirstLine {
    param([string]$Text)
    foreach ($line in ($Text -split "`r?`n")) {
        if (-not [string]::IsNullOrWhiteSpace($line)) { return $line.Trim() }
    }
    return 'no error text from git'
}

# Adds the items of several queues to one list, taking one item from each queue
# in turn, so no queue waits on another's whole length.
function Add-RoundRobin {
    param([object[]]$Queues, [System.Collections.Generic.List[object]]$Into)
    $depth = 0
    $more = $true
    while ($more) {
        $more = $false
        foreach ($queue in $Queues) {
            if ($depth -lt $queue.Count) {
                $Into.Add($queue[$depth])
                $more = $true
            }
        }
        $depth++
    }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# The time bounds on git calls, by kind. A fetch crosses the network; every
# other call reads a local clone. A first fetch transfers the whole branch
# history, and git keeps no partial pack from a stopped fetch. A bound too short
# for it would fail every run alike, so a first fetch gets a longer bound.
$script:gitBounds = @{ 'first-fetch' = 1800; 'later-fetch' = 300; 'local' = 60 }
$timeoutOverride = $env:FEED_INBOX_GIT_TIMEOUT_SECONDS
if (-not [string]::IsNullOrEmpty($timeoutOverride)) {
    if ($timeoutOverride -notmatch '^[1-9][0-9]{0,4}$') {
        Stop-WithReason 'FEED_INBOX_GIT_TIMEOUT_SECONDS must be a whole number of seconds from 1 to 99999.'
    }
    foreach ($kind in @($script:gitBounds.Keys)) { $script:gitBounds[$kind] = [int]$timeoutOverride }
}

# The run budget, 50 minutes from the start of the run. The Feed task has a
# 1-hour execution time limit, and the scheduler then stops only pwsh, so a git
# process still running would outlive the run. Every git call waits no longer
# than the budget has left, and the 10 minutes of margin cover local work and
# stopping a timed-out process tree.
$script:runBudgetSeconds = 3000
$budgetOverride = $env:FEED_INBOX_RUN_SECONDS
if (-not [string]::IsNullOrEmpty($budgetOverride)) {
    if ($budgetOverride -notmatch '^[1-9][0-9]{0,4}$') {
        Stop-WithReason 'FEED_INBOX_RUN_SECONDS must be a whole number of seconds from 1 to 99999.'
    }
    $script:runBudgetSeconds = [int]$budgetOverride
}
$script:runDeadline = [DateTime]::UtcNow.AddSeconds($script:runBudgetSeconds)

# The largest blob fed, 25 MB.
$maxBlobBytes = 25MB

# 1. Resolve the KB and validate the arguments.
if ([string]::IsNullOrEmpty($KbPath)) {
    # The KB root is the parent of the .claude/ directory this script lives in.
    $KbPath = Split-Path -Parent $PSScriptRoot
}
if (-not (Test-Path -LiteralPath $KbPath -PathType Container)) {
    Stop-WithReason "KbPath is not an existing directory: $KbPath"
}
$kbRoot = (Resolve-Path -LiteralPath $KbPath).ProviderPath
$inboxDir   = Join-Path $kbRoot 'inbox'
$sourcesDir = Join-Path $kbRoot 'sources'
$gitDir     = Join-Path $kbRoot '.git'
foreach ($required in @($inboxDir, $sourcesDir, $gitDir)) {
    if (-not (Test-Path -LiteralPath $required -PathType Container)) {
        Stop-WithReason "KB is missing the directory $(Split-Path -Leaf $required): $kbRoot"
    }
}
if ($MaxFiles -lt 0) {
    Stop-WithReason "MaxFiles must be zero or more, not $MaxFiles."
}

# 2. Read and validate the configuration. A KB without one is valid.
$configPath = Join-Path (Join-Path $kbRoot '.claude') 'feed.json'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    Write-Output "feed-inbox: no .claude/feed.json in $kbRoot; nothing to feed."
    exit 0
}
try {
    $config = [System.IO.File]::ReadAllText($configPath) | ConvertFrom-Json
} catch {
    Stop-WithReason "feed.json is not readable JSON: $(Get-FirstLine $_.Exception.Message)"
}
if ($config -isnot [System.Management.Automation.PSCustomObject]) {
    Stop-WithReason 'feed.json must be a JSON object with a "sources" list.'
}
Assert-OnlyKeys $config @('sources') 'the top level'
$sourceList = Get-JsonProperty $config 'sources'
if ($sourceList -isnot [array] -or $sourceList.Count -eq 0) {
    Stop-WithReason 'feed.json: "sources" must be a non-empty list.'
}

$sources = New-Object System.Collections.Generic.List[object]
$seenNames = New-Object System.Collections.Generic.HashSet[string]
$index = 0
foreach ($entry in $sourceList) {
    $where = "sources[$index]"
    if ($entry -isnot [System.Management.Automation.PSCustomObject]) {
        Stop-WithReason "feed.json: $where must be an object."
    }
    Assert-OnlyKeys $entry @('name', 'url', 'branch', 'include', 'exclude') $where

    # The name leads every fed file name, so it may not start with a dash, which
    # kb-move.ps1 refuses, and it names a clone directory, so it must be unique.
    $name = Get-JsonProperty $entry 'name'
    if ($name -isnot [string] -or $name -cnotmatch '^[a-z0-9][a-z0-9-]*$') {
        Stop-WithReason "feed.json: $where.name must be lowercase letters, digits and dashes, starting with a letter or digit."
    }
    $where = "source '$name'"
    if (-not $seenNames.Add($name)) {
        Stop-WithReason "feed.json: the source name '$name' is used more than once."
    }

    $url = Get-JsonProperty $entry 'url'
    if ($url -isnot [string] -or [string]::IsNullOrWhiteSpace($url)) {
        Stop-WithReason "feed.json: $where needs a non-empty url."
    }
    $urlRefusal = Get-UrlRefusal $url
    if ($null -ne $urlRefusal) {
        Stop-WithReason "feed.json: $where url $urlRefusal."
    }

    # The branch is placed inside a fetch refspec, so it is held to plain
    # branch-name characters: no colon, glob, or leading dash can change the refspec.
    $branch = Get-JsonProperty $entry 'branch'
    if ($branch -isnot [string] -or [string]::IsNullOrWhiteSpace($branch)) {
        Stop-WithReason "feed.json: $where needs a non-empty branch."
    }
    if ($branch -cnotmatch '^[A-Za-z0-9._/-]+$' -or $branch.StartsWith('-') -or $branch.Contains('..')) {
        Stop-WithReason "feed.json: $where has an unsupported branch name '$branch'."
    }

    $include = ConvertTo-GlobList (Get-JsonProperty $entry 'include') "$where include" $true
    $exclude = ConvertTo-GlobList (Get-JsonProperty $entry 'exclude') "$where exclude" $false

    $sources.Add([pscustomobject]@{
        Index   = $index
        Name    = $name
        Url     = $url
        ShownUrl = (Format-RedactedUrl $url)
        Branch  = $branch
        Include = $include
        Exclude = $exclude
        Clone   = $null
    })
    $index++
}

# 3. Locate git and the private clone root.
$gitCmd = Get-Command -Name 'git' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $gitCmd) {
    Stop-WithReason 'git was not found on PATH.'
}
$script:gitExe = $gitCmd.Source

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    Stop-WithReason 'LOCALAPPDATA is not set, so the private clone location is unknown.'
}
# The clone root is the KB folder name plus the first 8 hex digits of the
# SHA-256 of the KB's lowercased full path, so two KBs sharing a folder name
# never share clones.
$kbKey = $kbRoot.TrimEnd('\').ToLowerInvariant()
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$kbDigest = $sha256.ComputeHash($utf8NoBom.GetBytes($kbKey))
$kbHash = -join ($kbDigest[0..3] | ForEach-Object { $_.ToString('x2') })
$cloneRoot = Join-Path (Join-Path $env:LOCALAPPDATA 'llm-wiki-feed') "$(Split-Path -Leaf $kbRoot)-$kbHash"

# A fed name up to its blob hash, the part that identifies the upstream path.
# The hash is 7 lowercase hex digits followed by the extension or the end.
$fedNamePattern = New-Object regex('^(.+--)[0-9a-f]{7}(?:\.[^.]+)?$', [System.Text.RegularExpressions.RegexOptions]::CultureInvariant)

$script:hooksDir = $null
$lock = $null
$fed = 0
$skippedExisting = 0
$refused = 0
try {
    # 4. One run per KB at a time. The lock is a file held open with no sharing,
    # so the operating system releases it when this process ends, however it
    # ends, and it can never go stale. The internal file operations below pass
    # -WhatIf:$false, because -WhatIf withholds only the writes into inbox/.
    New-Item -ItemType Directory -Path $cloneRoot -Force -WhatIf:$false | Out-Null
    $lockPath = Join-Path $cloneRoot 'feed.lock'
    try {
        $lock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    } catch {
        $lockError = $_.Exception
        while ($lockError -is [System.Management.Automation.MethodInvocationException] -and $null -ne $lockError.InnerException) {
            $lockError = $lockError.InnerException
        }
        # 32 is ERROR_SHARING_VIOLATION: another run holds the file open.
        if ($lockError -is [System.IO.IOException] -and ($lockError.HResult -band 0xFFFF) -eq 32) {
            Write-Output "feed-inbox: another feed run holds the lock for $kbRoot; nothing fed by this run."
            exit 0
        }
        Stop-WithReason "taking the lock $lockPath failed: $(Get-FirstLine $lockError.Message)"
    }

    # A run killed between writing a temporary file and moving it leaves the file
    # behind in .git. Holding the lock means no other run is writing one now.
    foreach ($staleTemp in @(Get-ChildItem -LiteralPath $gitDir -Filter 'feed-inbox-*.tmp' -File -Force)) {
        Remove-Item -LiteralPath $staleTemp.FullName -Force -WhatIf:$false
    }

    # An empty hooks directory means no git call can execute a hook planted in a
    # clone, such as reference-transaction, which fetch runs.
    $script:hooksDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $script:hooksDir -WhatIf:$false | Out-Null

    # 5. Create and fetch every clone before writing anything, so one bad source
    # fails the run with inbox/ untouched. The URL is passed after --, so it can
    # never be read as an option.
    foreach ($source in $sources) {
        $clone = Join-Path $cloneRoot $source.Name
        # A clone with no refs/feed/head has never completed a fetch, including
        # one whose first fetch was stopped at its bound, so its next fetch is a
        # first fetch too.
        $firstFetch = $true
        if (Test-Path -LiteralPath $clone) {
            if (-not (Test-Path -LiteralPath (Join-Path $clone 'HEAD') -PathType Leaf) -or
                -not (Test-Path -LiteralPath (Join-Path $clone 'objects') -PathType Container)) {
                Stop-WithReason "the private clone for source '$($source.Name)' exists but is not a bare git repository: $clone"
            }
            $probe = Invoke-Git -Arguments @("--git-dir=$clone", 'rev-parse', '--verify', '--quiet', 'refs/feed/head') -Action "reading the fetched ref of source '$($source.Name)'"
            $firstFetch = ($probe.ExitCode -ne 0)
        } else {
            New-Item -ItemType Directory -Path $clone -Force -WhatIf:$false | Out-Null
            $action = "creating the private clone for source '$($source.Name)'"
            $result = Invoke-Git -Arguments @('init', '--bare', '--quiet', $clone) -Action $action
            if ($result.ExitCode -ne 0) {
                Stop-WithReason "$action failed: $(Get-FirstLine $result.Stderr)"
            }
        }
        $source.Clone = $clone

        $refspec = "+refs/heads/$($source.Branch):refs/feed/head"
        $action = "fetching branch '$($source.Branch)' of source '$($source.Name)' from $($source.ShownUrl)"
        $fetchBound = if ($firstFetch) { 'first-fetch' } else { 'later-fetch' }
        $result = Invoke-Git -Arguments @("--git-dir=$clone", '-c', 'transfer.fsckObjects=true', 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--', $source.Url, $refspec) -Action $action -Bound $fetchBound
        if ($result.ExitCode -ne 0) {
            Stop-WithReason "$action failed: $(Get-FirstLine $result.Stderr)"
        }
    }

    # 6. List the candidates: regular files on each branch tip whose path is
    # selected, in ordinal path order within each source. -z keeps every path
    # verbatim, without git's quoting of unusual characters, and -l adds each
    # blob's size.
    $candidates = New-Object System.Collections.Generic.List[object]
    foreach ($source in $sources) {
        $action = "listing branch '$($source.Branch)' of source '$($source.Name)'"
        $result = Invoke-Git -Arguments @("--git-dir=$($source.Clone)", 'ls-tree', '-r', '-z', '-l', '--full-tree', 'refs/feed/head') -Action $action
        if ($result.ExitCode -ne 0) {
            Stop-WithReason "$action failed: $(Get-FirstLine $result.Stderr)"
        }
        $records = $utf8NoBom.GetString($result.Stdout).Split([char]0)
        $keys  = New-Object System.Collections.Generic.List[string]
        $items = New-Object System.Collections.Generic.List[object]
        foreach ($record in $records) {
            if ($record.Length -eq 0) { continue }
            $tab = $record.IndexOf("`t")
            # The size column is padded with spaces, so the fields split on runs.
            $meta = $record.Substring(0, $tab) -split ' +'
            $repoPath = $record.Substring($tab + 1)
            # Mode 100644 and 100755 are regular files; symlinks and submodules are not fed.
            if ($meta[1] -ne 'blob' -or ($meta[0] -ne '100644' -and $meta[0] -ne '100755')) { continue }
            if (-not (Test-PathSelected $repoPath $source.Include $source.Exclude)) { continue }
            $keys.Add($repoPath)
            $items.Add([pscustomobject]@{ Source = $source; Path = $repoPath; Sha = $meta[2]; Size = [long]$meta[3] })
        }
        $keyArray  = $keys.ToArray()
        $itemArray = $items.ToArray()
        [Array]::Sort($keyArray, $itemArray, [System.StringComparer]::Ordinal)
        foreach ($item in $itemArray) { $candidates.Add($item) }
    }

    # 7. What inbox/ and sources/ already hold. The inbox count is the listing
    # kb-status.ps1 -What Inbox reports. Names compare without regard to case,
    # as NTFS does. Each name that has a fed name's shape also records the path
    # it was fed from, its name up to the blob hash.
    $inboxFiles = @(Get-ChildItem -LiteralPath $inboxDir -File)
    $inboxCount = @($inboxFiles | Where-Object { $_.Name -ne '.gitkeep' }).Count
    $existingNames = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $fedPaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($file in @($inboxFiles + @(Get-ChildItem -LiteralPath $sourcesDir -File))) {
        [void]$existingNames.Add($file.Name)
        $match = $fedNamePattern.Match($file.Name)
        if ($match.Success) { [void]$fedPaths.Add($match.Groups[1].Value) }
    }

    # 8. Name each candidate, refuse or skip it, and queue the rest per source:
    # never-fed paths in one set of queues, new revisions of fed paths in another.
    $neverFedQueues = New-Object 'object[]' $sources.Count
    $revisionQueues = New-Object 'object[]' $sources.Count
    for ($i = 0; $i -lt $sources.Count; $i++) {
        $neverFedQueues[$i] = New-Object System.Collections.Generic.List[object]
        $revisionQueues[$i] = New-Object System.Collections.Generic.List[object]
    }
    $invalidNameChars = [System.IO.Path]::GetInvalidFileNameChars()
    foreach ($candidate in $candidates) {
        $sourceName = $candidate.Source.Name
        $repoPath = $candidate.Path
        $label = "${sourceName}:$repoPath"

        # The extension is the text after the leaf's last dot, unless that dot
        # leads the leaf (a dotfile) or ends it.
        $slash = $repoPath.LastIndexOf('/')
        $leaf = $repoPath.Substring($slash + 1)
        $dot = $leaf.LastIndexOf('.')
        if ($dot -gt 0 -and $dot -lt $leaf.Length - 1) {
            $extension = $leaf.Substring($dot + 1)
            $stem = $repoPath.Substring(0, $repoPath.Length - $extension.Length - 1)
        } else {
            $extension = ''
            $stem = $repoPath
        }
        # The ingest skill passes the name to a shell in double quotes, where $,
        # a backtick or a parenthesis would expand, so the path and extension
        # keep only characters no shell or helper reads specially.
        $fedPath = "$sourceName--$($stem.Replace('/', '--') -replace '[^A-Za-z0-9._-]', '-')--"
        $fedName = "$fedPath$($candidate.Sha.Substring(0, 7))"
        if ($extension.Length -gt 0) {
            $fedName = "$fedName.$($extension -replace '[^A-Za-z0-9._-]', '-')"
        }

        # Every rule of the three helpers that take a name (kb-move.ps1 refuses
        # / \ or : and a leading dash; kb-commit.ps1 and kb-status.ps1 refuse
        # '..' and :), plus what Windows cannot hold as a file name, plus the
        # length cap and the size cap.
        $reason = $null
        if ($fedName -match '[/\\:]') {
            $reason = 'its fed name would contain / \ or :, which kb-move.ps1 refuses'
        } elseif ($fedName.StartsWith('-')) {
            $reason = 'its fed name would start with a dash, which kb-move.ps1 refuses'
        } elseif ($fedName.Contains('..')) {
            $reason = "its fed name would contain '..', which kb-commit.ps1 and kb-status.ps1 refuse"
        } elseif ($fedName.IndexOfAny($invalidNameChars) -ge 0) {
            $reason = 'its fed name would contain a character Windows does not allow in a file name'
        } elseif ($fedName.EndsWith('.') -or $fedName.EndsWith(' ')) {
            $reason = 'its fed name would end with a dot or a space, which Windows drops'
        } elseif ($fedName.Length -gt 150) {
            $reason = "its fed name would be $($fedName.Length) characters, over the 150-character cap"
        } elseif ($candidate.Size -gt $maxBlobBytes) {
            $reason = "its blob is $($candidate.Size) bytes, over the 25 MB cap"
        }
        if ($null -ne $reason) {
            Write-FeedWarning "refused ${label}: $reason."
            $refused++
            continue
        }

        if ($existingNames.Contains($fedName)) {
            $skippedExisting++
            continue
        }

        $queued = [pscustomobject]@{ Candidate = $candidate; FedName = $fedName; Extension = $extension; Label = $label }
        if ($fedPaths.Contains($fedPath)) {
            $revisionQueues[$candidate.Source.Index].Add($queued)
        } else {
            $neverFedQueues[$candidate.Source.Index].Add($queued)
        }
    }

    # 9. The drip budget goes to never-fed paths first, then to revisions, each
    # group taken one candidate per source in turn.
    $order = New-Object System.Collections.Generic.List[object]
    Add-RoundRobin -Queues $neverFedQueues -Into $order
    Add-RoundRobin -Queues $revisionQueues -Into $order
    $room = $MaxFiles - $inboxCount

    foreach ($queued in $order) {
        if ($room -le 0) {
            break
        }
        $room--
        $candidate = $queued.Candidate
        $fedName = $queued.FedName
        $extension = $queued.Extension
        $label = $queued.Label
        $repoPath = $candidate.Path

        $inboxRelative = "inbox/$fedName"
        if (-not $PSCmdlet.ShouldProcess($inboxRelative, "Feed $label")) {
            continue
        }

        $blob = Invoke-Git -Arguments @("--git-dir=$($candidate.Source.Clone)", 'cat-file', 'blob', $candidate.Sha) -Action "reading $label"
        if ($blob.ExitCode -ne 0) {
            Stop-WithReason "reading $label failed: $(Get-FirstLine $blob.Stderr)"
        }
        $body = $blob.Stdout

        # UTF-16 LE and UTF-32 LE both begin FF FE, UTF-16 BE begins FE FF, and
        # UTF-32 BE begins 00 00 FE FF.
        $isText = ($extension -ieq 'md') -or ($extension -ieq 'txt')
        $isWideUnicode = (($body.Length -ge 2) -and (
                ($body[0] -eq 0xFF -and $body[1] -eq 0xFE) -or ($body[0] -eq 0xFE -and $body[1] -eq 0xFF))) -or
            (($body.Length -ge 4) -and $body[0] -eq 0x00 -and $body[1] -eq 0x00 -and $body[2] -eq 0xFE -and $body[3] -eq 0xFF)
        if ($isText -and -not $isWideUnicode) {
            # --literal-pathspecs keeps an upstream path from being read as pathspec magic.
            $log = Invoke-Git -Arguments @("--git-dir=$($candidate.Source.Clone)", '--literal-pathspecs', 'log', '-1', '--format=%h%x00%cI', 'refs/feed/head', '--', $repoPath) -Action "reading the history of $label"
            if ($log.ExitCode -ne 0) {
                Stop-WithReason "reading the history of $label failed: $(Get-FirstLine $log.Stderr)"
            }
            $logFields = $utf8NoBom.GetString($log.Stdout).Trim().Split([char]0)
            $commit = $logFields[0]
            $commitDate = if ($logFields.Count -gt 1) { $logFields[1] } else { 'unknown' }

            $bodyStart = 0
            if ($body.Length -ge 3 -and $body[0] -eq 0xEF -and $body[1] -eq 0xBB -and $body[2] -eq 0xBF) {
                $bodyStart = 3
            }
            $newline = "`n"
            $firstLf = [Array]::IndexOf($body, [byte]10, $bodyStart)
            if ($firstLf -gt $bodyStart -and $body[$firstLf - 1] -eq 13) {
                $newline = "`r`n"
            }
            # A backtick in the path would end the code span around it, and a
            # newline or other control character would break the block's one line.
            $shownPath = $repoPath.Replace('`', '') -replace '\p{Cc}', '-'
            $header = "> Fed by feed-inbox.ps1 from $($candidate.Source.ShownUrl) branch $($candidate.Source.Branch), path ``$shownPath``, commit $commit dated $commitDate.$newline$newline"
            $headerBytes = $utf8NoBom.GetBytes($header)
            $content = New-Object byte[] ($headerBytes.Length + $body.Length - $bodyStart)
            [Array]::Copy($headerBytes, 0, $content, 0, $headerBytes.Length)
            [Array]::Copy($body, $bodyStart, $content, $headerBytes.Length, $body.Length - $bodyStart)
        } else {
            $content = $body
        }

        # Stage under the KB's .git directory, on the same volume as inbox/, so the
        # move into inbox/ is one rename and never a visible partial copy. A file
        # another writer put at the same name first is left alone.
        $destination = Join-Path $inboxDir $fedName
        $temp = Join-Path $gitDir ('feed-inbox-' + [System.IO.Path]::GetRandomFileName() + '.tmp')
        try {
            [System.IO.File]::WriteAllBytes($temp, $content)
            [System.IO.File]::Move($temp, $destination)
        } catch {
            $writeError = $_.Exception
            if (Test-Path -LiteralPath $temp) {
                Remove-Item -LiteralPath $temp -Force -WhatIf:$false
            }
            if (Test-Path -LiteralPath $destination) {
                $skippedExisting++
                continue
            }
            Stop-WithReason "writing $inboxRelative failed: $(Get-FirstLine $writeError.Message)"
        }
        Write-Output $inboxRelative
        $fed++
    }
} finally {
    if ($script:hooksDir -and (Test-Path -LiteralPath $script:hooksDir)) {
        Remove-Item -LiteralPath $script:hooksDir -Recurse -Force -WhatIf:$false
    }
    if ($null -ne $lock) {
        $lock.Dispose()
    }
}

Write-Output "feed-inbox: fed $fed, skipped-existing $skippedExisting, refused $refused, inbox now $($inboxCount + $fed)"
exit 0
