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
the only form that survives that call.

.PARAMETER Message
The commit message. Control characters other than newline are stripped and the
text is truncated to 2000 characters before use.

.PARAMETER Push
When set, push the current branch to the origin remote after committing. The
push runs even when this call had nothing to commit, so a commit made by an
earlier call in the same run reaches origin rather than stranding locally.

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-commit.ps1 -Path "sources/report.pdf|wiki/report-summary.md|index.md|log.md" -Message "Ingest report.pdf" -Push
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

# Strip ASCII control characters other than newline, then cap the length.
$cleanMessage = $Message -replace '[\x00-\x09\x0B-\x1F\x7F]', ''
if ($cleanMessage.Length -gt 2000) {
    $cleanMessage = $cleanMessage.Substring(0, 2000)
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
            Stop-WithReason "no git remote named 'origin' is configured; cannot push."
        }
        $pushArgs = @('-C', $repoRoot, '-c', "core.hooksPath=$hooksDir", 'push', 'origin', 'HEAD')
        Invoke-GitOrStop -Arguments $pushArgs -FailReason 'git push origin HEAD failed.'
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
