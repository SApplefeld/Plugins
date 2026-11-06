#Requires -Version 5.1
<#
.SYNOPSIS
Moves one file from inbox/ to sources/ inside a knowledge base repo, or, with
-Rename, renames each inbox/ item whose name Claude Code would load as
instructions.

.DESCRIPTION
The single sanctioned path by which a file reaches sources/. It takes the file
by its bare name or by the handle `kb-status.ps1 -What Inbox` prints for it,
resolves a handle against the live inbox, validates that the name cannot escape
inbox/ or overwrite an existing source, confirms both the origin and
destination resolve to locations inside the repo and outside .git/ and
.claude/, then sets the file's last-write time to now and moves it. A name
Claude Code would load as instructions from sources/, CLAUDE.md,
CLAUDE.local.md, .mcp.json or .claude in any letter case or one shaped like
the short name CLAUDE~1, is refused on both routes and the file stays in
inbox/, where -Rename renames it in place. The list is tested on the name as
given and again on the leaf of each resolved path, since Windows drops a
trailing dot or space when it resolves a path, so CLAUDE.md. and CLAUDE.md with
a trailing space are refused as CLAUDE.md. A move
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

With -Rename the script moves nothing to sources/. It lists inbox/ with
hidden and system items and folders included, keeps each item whose name is
on the instruction-name list above, and renames each in place to
inbox/renamed-<name>. A renamed file reaches the ingest as a document under a
name Claude Code does not load. A renamed folder stays in inbox/ as a folder,
which the snapshot does not list and the ingest does not read. Every kept
item is checked before any is renamed, so a refusal by a check leaves inbox/
as it was: a reparse point is refused as on the move route, an
inbox/renamed-<name> that already exists as a file or a folder is refused
naming it, and each origin and destination must resolve inside the repo and
clear of .git/ and .claude/. The rename reads no byte of any item. It clears
the hidden and system attributes, so a renamed file reaches
`kb-status.ps1 -What Inbox`, sets no time stamp, and writes
`renamed: inbox/renamed-<name>` to stdout, one line per item. Where no item
is on the list it writes nothing and exits 0. A clear or rename that throws
is refused with its one-line reason. That refusal comes after the checks, so
the items renamed before it stay renamed and their renamed: lines are already
written. Under -WhatIf nothing is renamed and no attribute changes.

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

.PARAMETER Rename
Sweeps inbox/ for the names on the instruction-name list and renames each
such file or folder in place to renamed-<name>. It takes no -Name and no
-Handle: the script finds the names itself, hidden and system items among
them, so no name sits on the command line and no listing a caller took can
miss one.

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-move.ps1 -Name report.pdf

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-move.ps1 -Rename
With a hidden inbox/CLAUDE.md and a plain inbox/notes.md, renames the first to
inbox/renamed-CLAUDE.md, clears its hidden attribute, leaves notes.md as it
is, and prints `renamed: inbox/renamed-CLAUDE.md`.

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
    [string]$Handle,

    [Parameter(Mandatory, ParameterSetName = 'Rename')]
    [switch]$Rename
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

# Defence in depth: confirms each fully resolved path stays inside the repo
# and clear of .git/ and .claude/, comparing the normalized full path rather
# than the raw input, and refuses the run on the first that does not. Both
# routes call it on their origin and destination before anything on disk
# changes.
function Assert-InsideRepo {
    param([string[]]$Paths)
    foreach ($full in $Paths) {
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
}

# The repo root is the parent of the .claude/ directory this script lives in.
$repoRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).ProviderPath

# The names Claude Code loads as instructions, a copy of kb-commit.ps1's line, the reference, pinned by tests/Test-InstructionNameParity.ps1.
$instructionName = '^(CLAUDE\.md|CLAUDE\.local\.md|\.mcp\.json|\.claude|CLAUDE~[0-9]+(\..*)?)$'

# The prefixes Assert-InsideRepo tests a resolved path against.
$sep          = [System.IO.Path]::DirectorySeparatorChar
$rootPrefix   = $repoRoot.TrimEnd('\', '/') + $sep
$gitPrefix    = (Join-Path $repoRoot '.git') + $sep
$claudePrefix = (Join-Path $repoRoot '.claude') + $sep

# -Rename sweeps inbox/ for the names on the list and renames each item in
# place. A renamed file reaches the ingest as a document under a name Claude
# Code does not load, and a renamed folder stays in inbox/ as a folder, which
# the snapshot does not list and the ingest does not read. The listing takes
# -Force, since a hidden or system item is loaded as a plain one and would
# otherwise be left in place, and takes folders, since a .claude folder is
# loaded as one. The sweep resolves no name and reads no byte of any item: a
# rename is not a read. Every kept item is checked before any is renamed, so
# a refusal by a check leaves inbox/ as it was. A clear or rename that throws
# on a later item refuses with the earlier renames made and their renamed:
# lines written. The new name is renamed- and the old name, which no entry on
# the list matches, since the list is anchored at the start of the name.
if ($PSCmdlet.ParameterSetName -eq 'Rename') {
    $inboxDir = Join-Path $repoRoot 'inbox'
    if (-not (Test-Path -LiteralPath $inboxDir -PathType Container)) {
        Stop-WithReason 'inbox/ does not exist.'
    }
    $kept = @(Get-ChildItem -LiteralPath $inboxDir -Force | Where-Object { $_.Name -match $instructionName })
    $planned = @()
    foreach ($item in $kept) {
        $oldName  = $item.Name
        $newName  = "renamed-$oldName"
        $srcFull  = [System.IO.Path]::GetFullPath((Join-Path $inboxDir $oldName))
        $destFull = [System.IO.Path]::GetFullPath((Join-Path $inboxDir $newName))
        Assert-InsideRepo @($srcFull, $destFull)
        # The item's own attributes are read, never a link target's, so a
        # reparse point is refused on the path and a rename through it never
        # reaches the target. The read also finds the hidden and system bits
        # the rename clears below.
        try {
            $attributes = [System.IO.File]::GetAttributes($srcFull)
        } catch {
            Stop-WithReason ("could not read the attributes of inbox/$oldName, so it stays in inbox/: " + ($_.Exception.GetBaseException().Message -replace '\s+', ' ').Trim())
        }
        if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            Stop-WithReason "inbox/$oldName is a reparse point, such as a symbolic link; only a plain file is moved."
        }
        # The destination is never overwritten, a hidden one included, and
        # NTFS compares names ignoring case, so a File or Directory exists
        # read, each of which sees hidden items, is the check.
        if ([System.IO.File]::Exists($destFull) -or [System.IO.Directory]::Exists($destFull)) {
            Stop-WithReason "inbox/$newName already exists, so inbox/$oldName stays as it is and nothing is renamed."
        }
        $planned += [pscustomobject]@{ OldName = $oldName; NewName = $newName; Source = $srcFull; Attributes = $attributes }
    }
    # Each rename sits inside its own gate, so -WhatIf names every item it
    # would rename and renames none. The hidden and system bits are cleared
    # first, so a renamed file reaches the snapshot.
    # No time stamp is set: the item stays in inbox/, where no staleness
    # reading applies, and the stamp is the move route's alone.
    foreach ($plan in $planned) {
        if (-not $PSCmdlet.ShouldProcess("inbox/$($plan.OldName)", "Rename in place to inbox/$($plan.NewName)")) { continue }
        $cleared = [System.IO.FileAttributes]($plan.Attributes -band (-bnot ([System.IO.FileAttributes]::Hidden -bor [System.IO.FileAttributes]::System)))
        try {
            if ($cleared -ne $plan.Attributes) {
                [System.IO.File]::SetAttributes($plan.Source, $cleared)
            }
        } catch {
            Stop-WithReason ("could not clear the attributes of inbox/$($plan.OldName), so it stays in inbox/: " + ($_.Exception.GetBaseException().Message -replace '\s+', ' ').Trim())
        }
        try {
            Rename-Item -LiteralPath $plan.Source -NewName $plan.NewName -ErrorAction Stop
        } catch {
            Stop-WithReason ("could not rename inbox/$($plan.OldName) to inbox/$($plan.NewName), so it stays in inbox/: " + ($_.Exception.GetBaseException().Message -replace '\s+', ' ').Trim())
        }
        Write-Output "renamed: inbox/$($plan.NewName)"
    }
    exit 0
}

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
# A source keeps its inbox name, and Claude Code loads a CLAUDE.md or another
# instruction file from the folder of a file it reads, so a file under
# sources/ by such a name would instruct every later run that reads beside
# it. This refusal tests the name as given, on the line or from a handle,
# before any path is read, and the resolved leaves are tested again below.
# Both precede the stamp, the compare and the move, so nothing on disk
# changes. -match ignores case, as Windows reads claude.md as CLAUDE.md.
if ($Name -match $instructionName) {
    Stop-WithReason "inbox/$Name carries an instruction file's name, which Claude Code would load from sources/; it stays in inbox/, where kb-move.ps1 -Rename renames it in place."
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

$srcFull  = [System.IO.Path]::GetFullPath($inboxPath)
$destFull = [System.IO.Path]::GetFullPath($sourcesPath)

# Windows drops a trailing dot or space when it resolves a path, so a name
# such as CLAUDE.md. passes the test on the name as given and still reaches
# inbox/CLAUDE.md. The list is tested again on the leaf of each resolved path,
# the names the stamp, the compare and the move act on.
foreach ($full in @($srcFull, $destFull)) {
    $leaf = [System.IO.Path]::GetFileName($full)
    if ($leaf -match $instructionName) {
        Stop-WithReason "inbox/$leaf carries an instruction file's name, which Claude Code would load from sources/; it stays in inbox/, where kb-move.ps1 -Rename renames it in place."
    }
}

Assert-InsideRepo @($srcFull, $destFull)

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
