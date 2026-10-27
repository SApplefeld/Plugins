#Requires -Version 5.1
<#
.SYNOPSIS
Moves one file from inbox/ to sources/ inside a knowledge base repo.

.DESCRIPTION
The single sanctioned path by which a file reaches sources/. It accepts a bare
file name, validates that the name cannot escape inbox/ or overwrite an
existing source, confirms both the origin and destination resolve to locations
inside the repo and outside .git/ and .claude/, then sets the file's last-write
time to now and moves it. A move keeps the time the file arrived with, so
without the stamp a source dropped days ago would read as stale to
`kb-status.ps1 -What Live` in the gap before the first page write; with it the
arrival counts as a touch. sources/ is immutable, so an existing destination is
never overwritten. On success the destination path, relative to the repo root,
is written to stdout.

.PARAMETER Name
The bare file name of the item in inbox/ to move. It must be a plain leaf
name: no directory separators, no drive markers, and not a relative-parent
reference.

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-move.ps1 -Name report.pdf

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-move.ps1 -Name report.pdf
pwsh -NoProfile -File ./.claude/kb-status.ps1 -What Live
Prints `0<tab>sources/report.pdf` among any other live paths.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string]$Name
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Writes a single-line reason to stderr and stops with a non-zero exit code, so
# a refusal is legible to an unattended caller without a PowerShell stack trace.
function Stop-WithReason {
    param([string]$Reason)
    [Console]::Error.WriteLine("kb-move: $Reason")
    exit 1
}

# The repo root is the parent of the .claude/ directory this script lives in.
$repoRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).ProviderPath

if ([string]::IsNullOrEmpty($Name)) {
    Stop-WithReason 'Name is required.'
}
if ($Name -match '[/\\:]') {
    Stop-WithReason 'Name must be a bare file name, not a path (no / \ or : allowed).'
}
if ($Name -eq '.' -or $Name -eq '..') {
    Stop-WithReason 'Name must be a file name, not a directory reference.'
}
if ($Name.StartsWith('-')) {
    Stop-WithReason 'Name must not start with a dash.'
}

$inboxPath   = Join-Path (Join-Path $repoRoot 'inbox') $Name
$sourcesPath = Join-Path (Join-Path $repoRoot 'sources') $Name

if (-not (Test-Path -LiteralPath $inboxPath -PathType Leaf)) {
    Stop-WithReason "inbox/$Name does not exist or is not a file."
}
if (Test-Path -LiteralPath $sourcesPath) {
    Stop-WithReason "sources/$Name already exists; sources/ is immutable and is never overwritten."
}

# Defence in depth: confirm the fully resolved origin and destination stay
# inside the repo and clear of .git/ and .claude/, comparing the normalized
# full paths rather than the raw input.
$sep          = [System.IO.Path]::DirectorySeparatorChar
$rootPrefix   = $repoRoot.TrimEnd('\', '/') + $sep
$gitPrefix    = (Join-Path $repoRoot '.git') + $sep
$claudePrefix = (Join-Path $repoRoot '.claude') + $sep

$srcFull  = [System.IO.Path]::GetFullPath($inboxPath)
$destFull = [System.IO.Path]::GetFullPath($sourcesPath)

foreach ($full in @($srcFull, $destFull)) {
    if (-not $full.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-WithReason "resolved path escapes the repo root: $full"
    }
    if ($full.StartsWith($gitPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-WithReason "resolved path is under .git/: $full"
    }
    if ($full.StartsWith($claudePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-WithReason "resolved path is under .claude/: $full"
    }
}

$destRelative = "sources/$Name"

if ($PSCmdlet.ShouldProcess($destRelative, 'Move file from inbox/ to sources/')) {
    # The stamp comes first, so a stamp that fails leaves the file in inbox/
    # and the refusal true; a move on one volume keeps the time it carries.
    [System.IO.File]::SetLastWriteTimeUtc($srcFull, [DateTime]::UtcNow)
    Move-Item -LiteralPath $srcFull -Destination $destFull
    Write-Output $destRelative
}

exit 0
