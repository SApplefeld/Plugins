#Requires -Version 5.1
<#
.SYNOPSIS
Moves one file from inbox/ to sources/ inside a knowledge base repo.

.DESCRIPTION
The single sanctioned path by which a file reaches sources/. It takes the file
by its bare name or by the handle `kb-status.ps1 -What Inbox` prints for it,
resolves a handle against the live inbox, validates that the name cannot escape
inbox/ or overwrite an existing source, confirms both the origin and
destination resolve to locations inside the repo and outside .git/ and
.claude/, then sets the file's last-write time to now and moves it. A move
keeps the time the file arrived with, so
without the stamp a source dropped days ago would read as stale to
`kb-status.ps1 -What Live` in the gap before the first page write; with it the
arrival counts as a touch. An inbox file that is a reparse point, a symbolic
link or a junction among them, is refused before the stamp, so no symbolic
link's or junction's target has its time written. A hard link is not a reparse
point and is not refused by that check. A stamp that throws, a denied
write-attributes right among the causes, is refused with its one-line reason
and the file stays in inbox/, and so is a move that throws after the stamp.
sources/ is immutable, so an existing destination is never overwritten. Where
sources/<name> already exists, the two files are compared byte for byte: their
lengths first, then, where the lengths agree, their SHA-256 digests over
read-only streams. The compare runs after the reparse-point check, so an inbox
file that is a reparse point when checked is refused before any read; the
check is on the path, not on an open handle. Equal digests mean an earlier run
ingested this file: the inbox copy is deleted, a read-only attribute cleared
first, `duplicate: sources/<name>` is written to stdout and the exit code is
0, with no stamp and nothing written to the destination; under -WhatIf nothing
is deleted. Unequal lengths or digests are a new document under a taken name,
refused with one line saying so, and a person renames the inbox file. A read
that throws on either file is refused with its one-line reason and the file
stays in inbox/. On a successful move the destination path, relative to the
repo root, is written to stdout.

.PARAMETER Name
The bare file name of the item in inbox/ to move. It must be a plain leaf
name: no directory separators, no drive markers, and not a relative-parent
reference. It must hold no apostrophe: a name on a shell line sits inside a
Bash single-quoted string, where an apostrophe ends the string before this
script runs, and the refusal here catches a name that reaches the script
escaped or double-quoted. A file so named is moved by its handle instead. A
person at the keyboard moves a file by name; the skills move by handle.
Exactly one of -Name and -Handle is given.

.PARAMETER Handle
The handle of the item in inbox/ to move: the first 12 lowercase hexadecimal
digits of the SHA-256 of the file name's UTF-8 bytes, as the first column of
`kb-status.ps1 -What Inbox` prints it. The skills move by handle, so no byte
of a hand-dropped name sits on their command line for the shell to re-read.
The shape is checked first, then the inbox is listed as the status helper
lists it and each file's handle recomputed. A handle matching no file, or more
than one, is refused. The resolved name then passes every check -Name passes
but the apostrophe refusal, which guards only a name typed on the line, so a
name starting with a dash is refused by handle as by name. Exactly one of
-Name and -Handle is given.

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-move.ps1 -Name report.pdf

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-status.ps1 -What Inbox
Prints `3f2a9c1d8e07<tab>1204<tab>report.pdf`. Then:
pwsh -NoProfile -File ./.claude/kb-move.ps1 -Handle '3f2a9c1d8e07'
Moves inbox/report.pdf to sources/report.pdf and prints `sources/report.pdf`.

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-move.ps1 -Name report.pdf
pwsh -NoProfile -File ./.claude/kb-status.ps1 -What Live
Prints `0<tab>sources/report.pdf` among any other live paths.
#>
[CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'Name')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Name')]
    [string]$Name,

    [Parameter(Mandatory, ParameterSetName = 'Handle')]
    [string]$Handle
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

# The handle of a file name: the first 12 lowercase hexadecimal digits of the
# SHA-256 digest of the name's UTF-8 bytes, with no byte-order mark, no case
# folding and no Unicode normalisation. It depends on the name alone, so a
# listing and a later call agree while the file keeps its name. The same
# function sits in kb-status.ps1 and kb-commit.ps1 byte for byte.
function Get-NameHandle {
    param([string]$Name)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $digest = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Name))
    } finally {
        $sha.Dispose()
    }
    return -join ($digest[0..5] | ForEach-Object { $_.ToString('x2') })
}

# The SHA-256 digest of a file's bytes as lowercase hexadecimal, read over a
# stream opened for reading only and shared for reading, so the file's bytes
# and last-write time are never touched. A read that throws propagates to the
# caller, which turns it into the one-line reason. The open sits inside the
# try, so the hasher is disposed on every path, a throwing open included.
function Get-FileDigest {
    param([string]$Path)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = $null
    try {
        $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
        $digest = $sha.ComputeHash($stream)
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
        $sha.Dispose()
    }
    return -join ($digest | ForEach-Object { $_.ToString('x2') })
}

# The repo root is the parent of the .claude/ directory this script lives in.
$repoRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).ProviderPath

# A handle resolves to a name against the live inbox, listed as kb-status.ps1
# -What Inbox lists it: the inbox's own files, .gitkeep left out. The shape is
# checked before the inbox is read, so a value that is not a handle is refused
# as such whatever the tree holds. The resolved name then runs every check a
# name given on the line runs but the apostrophe refusal, which guards only
# the shell line a handle never puts the name on.
if ($PSCmdlet.ParameterSetName -eq 'Handle') {
    if ($Handle -cnotmatch '^[0-9a-f]{12}$') {
        Stop-WithReason 'Handle must be twelve lowercase hexadecimal digits, as kb-status.ps1 -What Inbox prints it.'
    }
    $inboxDir = Join-Path $repoRoot 'inbox'
    if (-not (Test-Path -LiteralPath $inboxDir -PathType Container)) {
        Stop-WithReason 'inbox/ does not exist.'
    }
    $matched = @(Get-ChildItem -LiteralPath $inboxDir -File | Where-Object { ($_.Name -ne '.gitkeep') -and ((Get-NameHandle $_.Name) -ceq $Handle) })
    if ($matched.Count -eq 0) {
        Stop-WithReason "no file in inbox/ has the handle $Handle; the file has left the inbox since it was listed."
    }
    if ($matched.Count -gt 1) {
        Stop-WithReason "more than one file in inbox/ has the handle $Handle; a person moves them by name."
    }
    $Name = $matched[0].Name
}

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
# A name given on the line sits inside a Bash single-quoted string, the one
# form that passes $, backticks and spaces byte for byte, and an apostrophe
# ends that string in Bash before this script runs. This refusal catches a
# name that arrives escaped or double-quoted, and a person renames the file.
# A name resolved from a handle never sat on a shell line, so it is exempt:
# the handle route is how a file whose name holds an apostrophe is moved.
if ($PSCmdlet.ParameterSetName -eq 'Name' -and $Name.Contains("'")) {
    Stop-WithReason 'Name must not contain an apostrophe; rename the file.'
}

$inboxPath   = Join-Path (Join-Path $repoRoot 'inbox') $Name
$sourcesPath = Join-Path (Join-Path $repoRoot 'sources') $Name

if (-not (Test-Path -LiteralPath $inboxPath -PathType Leaf)) {
    Stop-WithReason "inbox/$Name does not exist or is not a file."
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

# A reparse point in inbox/, a symbolic link or a junction among them, is
# refused before anything writes to it, since a time set through such a link
# can land on a target outside the repo. A hard link is not a reparse point and
# is not refused by this check. The file's own attributes are read,
# never its target's, and a read that throws, a file gone or locked since the
# existence check among the causes, ends as the one-line reason.
try {
    $attributes = [System.IO.File]::GetAttributes($srcFull)
} catch {
    Stop-WithReason ("could not read the attributes of inbox/$Name, so it stays in inbox/: " + ($_.Exception.GetBaseException().Message -replace '\s+', ' ').Trim())
}
if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    Stop-WithReason "inbox/$Name is a reparse point, such as a symbolic link; only a plain file is moved."
}

$destRelative = "sources/$Name"

# sources/ is immutable, so an existing destination is never overwritten.
# Where it exists, the inbox file and the source are compared byte for byte:
# their lengths first, so two files of different sizes are told apart with
# no read of either, then their SHA-256 digests, each read over a read-only
# stream, so the destination's bytes and last-write time stay as they are.
# The compare sits after the reparse-point check, so an inbox file that is a
# reparse point when checked is refused before any read; that check is on the
# path, not on an open handle. Equal digests mean an earlier run ingested
# this file, and the inbox copy is deleted inside the gate below. Unequal
# lengths or digests are a new document under a taken name, refused so a
# person renames the inbox file. A length or content read that throws on
# either file ends as the one-line reason and the file stays in inbox/.
$isDuplicate = $false
# The one refusal sentence the ingest skill reads, set once and used at both
# the length site and the digest site, so the two cannot drift apart.
$differentContentReason = "$destRelative already exists with different content; sources/ is immutable and is never overwritten, so a person renames the inbox file."
if (Test-Path -LiteralPath $sourcesPath) {
    try {
        $inboxLength = [System.IO.FileInfo]::new($srcFull).Length
    } catch {
        Stop-WithReason ("could not read inbox/$Name to compare it with $destRelative, so it stays in inbox/: " + ($_.Exception.GetBaseException().Message -replace '\s+', ' ').Trim())
    }
    try {
        $sourceLength = [System.IO.FileInfo]::new($destFull).Length
    } catch {
        Stop-WithReason ("could not read $destRelative to compare it with inbox/$Name, so it stays in inbox/: " + ($_.Exception.GetBaseException().Message -replace '\s+', ' ').Trim())
    }
    if ($inboxLength -ne $sourceLength) {
        Stop-WithReason $differentContentReason
    }
    try {
        $inboxDigest = Get-FileDigest $srcFull
    } catch {
        Stop-WithReason ("could not read inbox/$Name to compare it with $destRelative, so it stays in inbox/: " + ($_.Exception.GetBaseException().Message -replace '\s+', ' ').Trim())
    }
    try {
        $sourceDigest = Get-FileDigest $destFull
    } catch {
        Stop-WithReason ("could not read $destRelative to compare it with inbox/$Name, so it stays in inbox/: " + ($_.Exception.GetBaseException().Message -replace '\s+', ' ').Trim())
    }
    if ($inboxDigest -cne $sourceDigest) {
        Stop-WithReason $differentContentReason
    }
    $isDuplicate = $true
}

# One gate covers both outcomes, so -WhatIf deletes nothing and moves nothing.
# The gate's target is the file the action touches: the inbox copy for a
# delete, the destination for a move, so a -WhatIf line names the right one.
$target = if ($isDuplicate) { "inbox/$Name" } else { $destRelative }
$action = if ($isDuplicate) { 'Delete the byte-identical duplicate' } else { 'Move file from inbox/ to sources/' }

if ($PSCmdlet.ShouldProcess($target, $action)) {
    # A duplicate takes no stamp: the source already carries its own time, and
    # the delete uses the same path the move uses, through File.Delete, which
    # removes no folder and never prompts. A read-only attribute, read at the
    # reparse check above, is cleared first, so a read-only duplicate leaves
    # the inbox too. A clear or delete that throws, a file another process
    # holds open among the causes, ends as the one-line reason and the copy
    # stays in inbox/, with a read-only attribute the clear removed put back.
    if ($isDuplicate) {
        try {
            if (($attributes -band [System.IO.FileAttributes]::ReadOnly) -ne 0) {
                [System.IO.File]::SetAttributes($srcFull, ($attributes -bxor [System.IO.FileAttributes]::ReadOnly))
            }
            [System.IO.File]::Delete($srcFull)
        } catch {
            $deleteReason = ($_.Exception.GetBaseException().Message -replace '\s+', ' ').Trim()
            if (($attributes -band [System.IO.FileAttributes]::ReadOnly) -ne 0 -and [System.IO.File]::Exists($srcFull)) {
                # Best effort: the refusal below is the outcome either way.
                try { [System.IO.File]::SetAttributes($srcFull, $attributes) } catch { }
            }
            Stop-WithReason ("could not delete the duplicate inbox/$Name, so it stays in inbox/: " + $deleteReason)
        }
        Write-Output "duplicate: $destRelative"
        exit 0
    }
    # The stamp comes first, so a stamp that fails leaves the file in inbox/
    # and the refusal true; a move on one volume keeps the time it carries.
    # A stamp that throws, a denied write-attributes right among the causes,
    # ends as the one-line reason and never as a stack trace. So does a move
    # that throws, such as a source another process holds open, a denied
    # delete, or a destination that appeared since the check above.
    try {
        [System.IO.File]::SetLastWriteTimeUtc($srcFull, [DateTime]::UtcNow)
    } catch {
        Stop-WithReason ("could not set the last-write time of inbox/$Name, so it stays in inbox/: " + ($_.Exception.GetBaseException().Message -replace '\s+', ' ').Trim())
    }
    try {
        Move-Item -LiteralPath $srcFull -Destination $destFull -ErrorAction Stop
    } catch {
        Stop-WithReason ("could not move inbox/$Name to sources/, so it stays in inbox/: " + ($_.Exception.GetBaseException().Message -replace '\s+', ' ').Trim())
    }
    Write-Output $destRelative
}

exit 0
