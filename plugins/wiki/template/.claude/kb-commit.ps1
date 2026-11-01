#Requires -Version 5.1
<#
.SYNOPSIS
Stages an explicit set of paths, commits them, and optionally pushes.

.DESCRIPTION
The single sanctioned path by which a knowledge base commits. It accepts only
repo-relative paths under sources/ or wiki/, or the exact files index.md and
log.md, and refuses everything else, including anything under .git/, .claude/,
inbox/, and the CLAUDE.md schema. It stages the named paths explicitly, never
with a wildcard, commits with hooks disabled and the message read from a file,
and, with -Push, pushes the current branch to origin. Every git invocation is
checked, so a failed git step stops the run loudly rather than reporting a
success that did not happen.

.PARAMETER Path
The repo-relative paths to stage and commit, separated by a vertical bar. Each
must be under sources/ or wiki/, or be exactly index.md or log.md, and must
exist on disk. A vertical bar is used because Windows forbids it in a file
name, so it can never be ambiguous with a path that contains a comma or a
semicolon. PowerShell passes arguments to a script run with -File as literal
strings and never splits them into an array, so a single delimited string is
the only form that survives that call. No entry may hold an apostrophe. The
skills pass the string inside a Bash single-quoted string, where an apostrophe
ends the string before this script runs. The skills check for one on some
routes only, so the refusal here is a partial control: it catches one that
arrives escaped or double-quoted.

.PARAMETER Message
The commit message. It may hold no apostrophe, for the same reason as -Path.
Control characters other than newline are stripped and the text is truncated
to 2000 characters before use.

.PARAMETER Push
When set, push the current branch to the origin remote after committing. The
push runs even when this call had nothing to commit, so a commit made by an
earlier call in the same run reaches origin rather than stranding locally. In a
knowledge base with no remote named origin nothing is pushed: the call prints
"kb-commit: no remote named 'origin'; nothing pushed." on stdout and exits 0,
since a local-only knowledge base is the ordinary case.

Git's terminal prompt, Git Credential Manager's prompt and ssh's prompts are
turned off for the push, so a missing credential
fails the push. It waits at most 300 seconds, or the whole number of seconds
from 1 to 99999 that KB_PUSH_TIMEOUT_SECONDS holds, and any other value in that
variable stops the run before anything is staged. Past the bound the git
process tree is stopped while git runs, and the run exits 1 with one line
naming the bound. A process git started that outlives git is not reached.

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-commit.ps1 -Path 'sources/report.pdf|wiki/report-summary.md|index.md|log.md' -Message 'Ingest report.pdf' -Push
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string]$Path,

    [Parameter(Mandatory)]
    [string]$Message,

    [switch]$Push
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Git failures are surfaced by checking $LASTEXITCODE explicitly, so native
# command failures must not auto-throw and produce a stack trace.
$PSNativeCommandUseErrorActionPreference = $false

# Writes a single-line reason to stderr and stops with a non-zero exit code, so
# a refusal is legible to an unattended caller without a PowerShell stack trace.
function Stop-WithReason {
    param([string]$Reason)
    [Console]::Error.WriteLine("kb-commit: $Reason")
    exit 1
}

# Runs git and stops the run if it reports failure.
function Invoke-GitOrStop {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$FailReason
    )
    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        Stop-WithReason $FailReason
    }
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

# Stops a running git process and the processes it started, such as ssh, a remote
# helper or a credential helper. taskkill /T walks the tree on both PowerShell
# editions; Windows PowerShell's .NET has no tree-aware Process.Kill. Its output
# is read and discarded so it never reaches this script's stdout.
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
        # taskkill could not stop it; stop the git process itself so this run
        # does not end with it still pushing.
        $Process.Kill()
    }
}

# Runs git push with every prompt turned off and a time bound, then passes its
# output through and stops the run on a failed exit. An unattended run has no one
# to answer a terminal, credential-manager or ssh prompt, so each is told not to
# ask; the variables are set on the git process alone, never on this script's
# environment. Past the bound the git process tree is stopped while git runs and
# the run exits 1 with one line naming the bound, and git's own output is not
# passed through.
function Invoke-BoundedPush {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$FailReason
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $script:gitExe
    $psi.Arguments = (@($Arguments | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $psi.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
    $psi.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
    $psi.EnvironmentVariables['GCM_INTERACTIVE'] = 'never'
    $psi.EnvironmentVariables['GIT_SSH_COMMAND'] = 'ssh -o BatchMode=yes -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4'
    $process = [System.Diagnostics.Process]::Start($psi)
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $deadline = [DateTime]::UtcNow.AddSeconds($script:pushTimeoutSeconds)
    $finished = $process.WaitForExit($script:pushTimeoutSeconds * 1000)
    if ($finished) {
        # The streams close when every process holding them ends, which can be
        # after git itself, so they share what is left of the same bound.
        $remaining = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        $finished = [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($stdoutTask, $stderrTask), $remaining)
    }
    if (-not $finished) {
        Stop-GitProcessTree $process
        Stop-WithReason "git push did not finish within the push bound of $script:pushTimeoutSeconds seconds; whether it reached the remote is unknown."
    }
    $process.WaitForExit()
    [Console]::Out.Write($stdoutTask.Result)
    [Console]::Error.Write($stderrTask.Result)
    if ($process.ExitCode -ne 0) {
        Stop-WithReason $FailReason
    }
}

# The repo root is the parent of the .claude/ directory this script lives in.
$repoRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).ProviderPath

$paths = @($Path -split '\|' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
if ($paths.Count -eq 0) {
    Stop-WithReason 'at least one path is required.'
}

foreach ($entry in $paths) {
    if ([string]::IsNullOrWhiteSpace($entry)) {
        Stop-WithReason 'a path entry is empty.'
    }
    if ([System.IO.Path]::IsPathRooted($entry)) {
        Stop-WithReason "path must be repo-relative, not rooted: $entry"
    }
    if ($entry -like '*..*') {
        Stop-WithReason "path must not contain '..': $entry"
    }
    if ($entry.Contains(':')) {
        Stop-WithReason "path must not contain ':': $entry"
    }
    # A skill emits -Path and -Message inside Bash single-quoted strings, the
    # one form that passes $, backticks and spaces byte for byte. An apostrophe
    # ends that string in Bash before this script runs, so on that route the
    # ingest and merge skills keep one out of the call. This refusal catches
    # one that arrives escaped or double-quoted.
    if ($entry.Contains("'")) {
        Stop-WithReason "path must not contain an apostrophe: $entry"
    }

    $normalized = $entry -replace '\\', '/'
    $inScope = ($normalized -eq 'index.md') -or
               ($normalized -eq 'log.md') -or
               ($normalized -like 'sources/*') -or
               ($normalized -like 'wiki/*')
    if (-not $inScope) {
        Stop-WithReason "path is outside the committable set (sources/, wiki/, index.md, log.md): $entry"
    }

    $full = Join-Path $repoRoot $entry
    if (-not (Test-Path -LiteralPath $full)) {
        Stop-WithReason "path does not exist on disk: $entry"
    }
}

if ([string]::IsNullOrWhiteSpace($Message)) {
    Stop-WithReason 'commit message is empty.'
}
if ($Message.Contains("'")) {
    Stop-WithReason 'commit message must not contain an apostrophe.'
}

# Strip ASCII control characters other than newline, then cap the length.
$cleanMessage = $Message -replace '[\x00-\x09\x0B-\x1F\x7F]', ''
if ($cleanMessage.Length -gt 2000) {
    $cleanMessage = $cleanMessage.Substring(0, 2000)
}

# The push's time bound: 300 seconds, or KB_PUSH_TIMEOUT_SECONDS where set, so a
# test can drive the timeout quickly. It is read before anything is staged, so a
# bad value stops the run with nothing committed.
$script:pushTimeoutSeconds = 300
$script:gitExe = $null
if ($Push) {
    $timeoutOverride = $env:KB_PUSH_TIMEOUT_SECONDS
    if (-not [string]::IsNullOrEmpty($timeoutOverride)) {
        if ($timeoutOverride -notmatch '^[1-9][0-9]{0,4}$') {
            Stop-WithReason 'KB_PUSH_TIMEOUT_SECONDS must be a whole number of seconds from 1 to 99999.'
        }
        $script:pushTimeoutSeconds = [int]$timeoutOverride
    }
    $gitCmd = Get-Command -Name 'git' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $gitCmd) {
        Stop-WithReason 'git was not found on PATH.'
    }
    $script:gitExe = $gitCmd.Source
}

if (-not $PSCmdlet.ShouldProcess($repoRoot, 'Stage, commit, and optionally push')) {
    exit 0
}

$addArgs = @('-C', $repoRoot, 'add', '--') + $paths
Invoke-GitOrStop -Arguments $addArgs -FailReason 'git add failed.'

& git -C $repoRoot diff --cached --quiet
$hasStagedChanges = ($LASTEXITCODE -ne 0)

$messageFile = $null
$hooksDir    = $null
try {
    # An empty hooks directory means neither the commit nor the push can execute a
    # repo-planted hook such as .git/hooks/pre-commit or .git/hooks/pre-push.
    $hooksDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $hooksDir | Out-Null

    if ($hasStagedChanges) {
        $messageFile = [System.IO.Path]::GetTempFileName()
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($messageFile, $cleanMessage, $utf8NoBom)

        $commitArgs = @('-C', $repoRoot, '-c', "core.hooksPath=$hooksDir", 'commit', '-F', $messageFile)
        Invoke-GitOrStop -Arguments $commitArgs -FailReason 'git commit failed.'
    } else {
        Write-Output 'nothing to commit'
    }

    # A push still runs when this call had nothing to commit, so that commits made
    # by earlier calls in the same run reach origin rather than stranding locally.
    if ($Push) {
        $remotes = @(& git -C $repoRoot remote)
        if ($LASTEXITCODE -ne 0) {
            Stop-WithReason 'unable to list git remotes.'
        }
        if ($remotes -notcontains 'origin') {
            # A knowledge base with no remote commits locally and pushes nothing;
            # that is the ordinary local-first case, not a failure.
            Write-Output "kb-commit: no remote named 'origin'; nothing pushed."
        } else {
            $pushArgs = @('-C', $repoRoot, '-c', "core.hooksPath=$hooksDir", 'push', 'origin', 'HEAD')
            Invoke-BoundedPush -Arguments $pushArgs -FailReason 'git push origin HEAD failed.'
        }
    }
} finally {
    if ($messageFile -and (Test-Path -LiteralPath $messageFile)) {
        Remove-Item -LiteralPath $messageFile -Force
    }
    if ($hooksDir -and (Test-Path -LiteralPath $hooksDir)) {
        Remove-Item -LiteralPath $hooksDir -Recurse -Force
    }
}

exit 0
