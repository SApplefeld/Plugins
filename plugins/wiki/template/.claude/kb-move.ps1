#Requires -Version 5.1
<#
.SYNOPSIS
Moves one file from inbox/ to sources/ inside a knowledge base repo, or, with
-Rename, renames each inbox/ item whose name Claude Code would load as
instructions.

.DESCRIPTION
The single sanctioned path by which a file reaches sources/. It takes the file
by its bare name or by the handle `kb-status.ps1 -What Pending` prints for it,
resolves a handle against the live inbox, validates that the name cannot escape
inbox/ or overwrite an existing source, confirms both the origin and
destination resolve to locations inside the repo and outside .git/ and
.claude/, then opens the inbox entry once through a native handle and acts on
that handle alone. A name Claude Code would load as instructions from
sources/, CLAUDE.md, CLAUDE.local.md, .mcp.json or .claude in any letter case
or one shaped like the short name CLAUDE~1, is refused on both routes and the
file stays in inbox/, where -Rename renames it in place. The list is tested on
the name as given and again on the leaf of each resolved path, since Windows
drops a trailing dot or space when it resolves a path, so CLAUDE.md. and
CLAUDE.md with a trailing space are refused as CLAUDE.md. The handle is opened
with read and delete access, sharing reads alone, and does not follow a link:
a symbolic link or a junction opens as the link itself, and another process
cannot delete, rename or swap the entry while the handle is open. The entry's
attributes, its length and its bytes are read on that handle, the compare
below reads the inbox side from it, and the delete goes through it, so every
act lands on the one file object whose attributes were checked. An inbox file
that is a reparse point, a symbolic link or a junction among them, is refused
on those attributes and nothing is read through it. A hard link is not a
reparse point and is not refused by that check; the move below leaves its
outside name holding its own body alone. A move writes sources/<name> as a
fresh file, created new and copied from the handle, so the running account
owns the source and it shares no body and no owner with the dropped entry,
then deletes the inbox entry through the handle. The copy carries the file's
bytes alone, not its alternate data streams such as the downloaded-file mark.
No last-write time is set: a copy's time is the time of its write, so a
moved source reads as live to `kb-status.ps1 -What Live` whatever time the
drop carried. sources/ is immutable, so an existing destination is never
overwritten. Where sources/<name> already exists, the two files are compared
byte for byte: their lengths first, then, where the lengths agree, their
SHA-256 digests, the inbox side read from the handle and the source over a
read-only stream. Equal digests mean an earlier run ingested this file: the
inbox copy is deleted through the handle, a read-only attribute ignored by the
delete, `duplicate: sources/<name>` is written to stdout and the exit code
is 0, with nothing written to the destination; under -WhatIf nothing is
deleted. Unequal lengths
or digests are a new document under a taken name, refused with one line saying
so, and a person renames the inbox file. An open that throws, a file another
process holds open without sharing delete among the causes, a read that throws
on either file, a copy that throws, or a delete that throws is refused with
its one-line reason and the file stays in inbox/, a partial copy removed first;
where the copy cannot be removed, the line names both files. On a successful
move the destination path, relative to the repo root, is written to stdout.
Under -WhatIf the handle is opened and read the same way and nothing is
created or deleted. One environment variable is a test seam: where
KB_MOVE_TEST_HOLD_SECONDS is an integer from 1 to 300, the run sleeps that
many seconds after the attribute read and before anything is created or
deleted, so a test can act on the entry while the handle holds it. Any other
value is ignored.

With -Rename the script moves nothing to sources/. It lists inbox/ with
hidden and system items and folders included, keeps each item whose name is
on the instruction-name list above, and renames each in place to
inbox/renamed-<name>. A renamed file reaches the ingest as a document under a
name Claude Code does not load. A renamed folder stays in inbox/ as a folder,
which the snapshot does not list and the ingest does not read. Every kept
item is checked before any is renamed, so a refusal by a check leaves inbox/
as it was: a kept name that ends in a dot or a space is refused before any
path is built from it, since Windows drops either when it resolves a path and
the rename would then act on another path, and a person removes the item; a
reparse point is refused as on the move route; an inbox/renamed-<name> that
already exists as a file or a folder is refused naming it; and each origin
and destination must resolve inside the repo and clear of .git/ and
.claude/. The rename reads no byte of any item. It clears
the hidden and system attributes, so a renamed file reaches
`kb-status.ps1 -What Pending`, sets no time, and writes
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
`kb-status.ps1 -What Pending` prints it. The skills move by handle, so no byte
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
pwsh -NoProfile -File ./.claude/kb-status.ps1 -What Pending
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

# The SHA-256 digest of an open stream's bytes as lowercase hexadecimal, read
# from its start, so the inbox side of the compare is read from the handle
# the reparse check inspected and never from the path again. The stream stays
# open for the caller; a read that throws propagates to it.
function Get-StreamDigest {
    param([System.IO.Stream]$Stream)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $Stream.Position = 0
        $digest = $sha.ComputeHash($Stream)
    } finally {
        $sha.Dispose()
    }
    return -join ($digest | ForEach-Object { $_.ToString('x2') })
}

# Define the native handle type the move route acts through.
# Each call returns a Win32 error code, 0 on success, so a failure is reported
# and never thrown. Open asks GENERIC_READ (0x80000000) with DELETE (0x10000),
# shares FILE_SHARE_READ (1) alone, and takes OPEN_EXISTING (3) and
# FILE_FLAG_OPEN_REPARSE_POINT (0x200000). A symbolic link or a junction then
# opens as the link itself, and no other process can delete, rename or swap
# the entry while the handle is open. GetAttributes reads FileBasicInfo
# (class 0) on the handle, whose FileAttributes carries
# FILE_ATTRIBUTE_REPARSE_POINT (0x400). Delete sets FileDispositionInfoEx
# (class 21) with FILE_DISPOSITION_DELETE (1), FILE_DISPOSITION_POSIX_SEMANTICS
# (2) and FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE (0x10). The name then
# leaves inbox/ as this run's handle closes, even where another reader that
# shares delete still holds the file, and a read-only entry needs no attribute
# write. A volume that refuses the POSIX flag with ERROR_INVALID_PARAMETER (87)
# or ERROR_NOT_SUPPORTED (50) is asked again without it, and the name then
# leaves when the last handle closes. Where the extended class itself is
# refused with 87, an older Windows, a second handle on the same file object
# is taken through ReOpenFile with FILE_WRITE_ATTRIBUTES (0x100), never by
# path. The read-only bit is cleared through FileBasicInfo on that handle, and
# FileDispositionInfo (class 4) marks the delete on the first. The main open
# asks no write-attributes right, so a file whose write-attributes right is
# denied still moves wherever the extended class works. The type is compiled
# once per session and carries its own namespace, so it loads beside the other
# helpers' types in one session.
$script:inboxEntrySource = @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace KbMove
{
    public static class InboxEntry
    {
        #region Native Structures

        [StructLayout(LayoutKind.Sequential)]
        private struct BasicInfo
        {
            public long CreationTime;
            public long LastAccessTime;
            public long LastWriteTime;
            public long ChangeTime;
            public uint FileAttributes;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DispositionInfoEx
        {
            public uint Flags;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DispositionInfo
        {
            public byte DeleteFile;
        }

        #endregion

        #region Native Methods

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFileW(string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes, uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern SafeFileHandle ReOpenFile(SafeFileHandle originalFile, uint desiredAccess, uint shareMode, uint flagsAndAttributes);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int infoClass, out BasicInfo info, uint size);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetFileInformationByHandle(SafeFileHandle file, int infoClass, ref BasicInfo info, uint size);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetFileInformationByHandle(SafeFileHandle file, int infoClass, ref DispositionInfoEx info, uint size);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetFileInformationByHandle(SafeFileHandle file, int infoClass, ref DispositionInfo info, uint size);

        #endregion

        #region Public Methods

        public static SafeFileHandle Open(string path, out int error)
        {
            // Open the entry with read and delete access.
            // The open never follows a link, so a link opens as itself and not as its target.
            SafeFileHandle handle = CreateFileW(path, 0x80000000 | 0x10000, 1, IntPtr.Zero, 3, 0x200000, IntPtr.Zero);
            error = handle.IsInvalid ? Marshal.GetLastWin32Error() : 0;
            return handle;
        }

        public static int GetAttributes(SafeFileHandle handle, out uint attributes)
        {
            // Read the attributes on the handle.
            BasicInfo info;
            if (!GetFileInformationByHandleEx(handle, 0, out info, (uint)Marshal.SizeOf(typeof(BasicInfo))))
            {
                attributes = 0;
                return Marshal.GetLastWin32Error();
            }
            attributes = info.FileAttributes;
            return 0;
        }

        public static int Delete(SafeFileHandle handle, uint attributes)
        {
            // Mark the entry for deletion with POSIX semantics.
            // The name then leaves inbox/ as this handle closes, whatever other
            // reader still holds the file, and a read-only attribute is ignored.
            DispositionInfoEx extended = new DispositionInfoEx();
            extended.Flags = 0x1 | 0x2 | 0x10;
            if (SetFileInformationByHandle(handle, 21, ref extended, (uint)Marshal.SizeOf(typeof(DispositionInfoEx))))
            {
                return 0;
            }
            int error = Marshal.GetLastWin32Error();
            if (error != 87 && error != 50)
            {
                return error;
            }

            // Ask again without the POSIX flag.
            // A volume refusing that flag answers ERROR_INVALID_PARAMETER (87) or
            // ERROR_NOT_SUPPORTED (50), and the name then leaves when the last
            // handle on the file closes.
            extended.Flags = 0x1 | 0x10;
            if (SetFileInformationByHandle(handle, 21, ref extended, (uint)Marshal.SizeOf(typeof(DispositionInfoEx))))
            {
                return 0;
            }
            error = Marshal.GetLastWin32Error();
            if (error != 87)
            {
                return error;
            }

            // Clear the read-only bit where the extended class is unknown.
            // The clear goes through a second handle on the same file object,
            // opened from the first and never by path, since the first holds no
            // write-attributes right.
            if ((attributes & 0x1) != 0)
            {
                int clearError = ClearReadOnly(handle, attributes);
                if (clearError != 0)
                {
                    return clearError;
                }
            }

            // Mark the entry for deletion through the plain class.
            DispositionInfo plain = new DispositionInfo();
            plain.DeleteFile = 1;
            return SetFileInformationByHandle(handle, 4, ref plain, (uint)Marshal.SizeOf(typeof(DispositionInfo))) ? 0 : Marshal.GetLastWin32Error();
        }

        #endregion

        #region Private Methods

        private static int ClearReadOnly(SafeFileHandle handle, uint attributes)
        {
            // Reopen the same file object for attribute writes.
            // The second handle asks FILE_WRITE_ATTRIBUTES and shares read and delete with the first.
            using (SafeFileHandle writer = ReOpenFile(handle, 0x100, 0x1 | 0x4, 0))
            {
                if (writer.IsInvalid)
                {
                    return Marshal.GetLastWin32Error();
                }

                // Keep every other attribute.
                // FILE_ATTRIBUTE_NORMAL (0x80) stands in where none remain.
                BasicInfo basic = new BasicInfo();
                basic.FileAttributes = attributes & ~0x1u;
                if (basic.FileAttributes == 0)
                {
                    basic.FileAttributes = 0x80;
                }
                return SetFileInformationByHandle(writer, 0, ref basic, (uint)Marshal.SizeOf(typeof(BasicInfo))) ? 0 : Marshal.GetLastWin32Error();
            }
        }

        #endregion
    }
}
'@

# Compiles the handle type where this session has not, or stops the run with
# one line naming what failed. Without it no entry can be opened, so the run
# stops here, before anything on disk changes.
function Initialize-InboxEntryType {
    try {
        if (-not ('KbMove.InboxEntry' -as [type])) {
            Add-Type -TypeDefinition $script:inboxEntrySource -Language CSharp
        }
    } catch {
        $firstLine = @($_.Exception.Message -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })[0]
        Stop-WithReason "compiling the inbox handle helper failed: $firstLine; nothing was moved."
    }
}

# The text of a Win32 error code, so a native failure reads as the system
# words it and not as a bare number.
function Get-Win32Message {
    param([int]$ErrorCode)
    return ((New-Object System.ComponentModel.Win32Exception($ErrorCode)).Message -replace '\s+', ' ').Trim()
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
# loaded as one. The sweep follows no link at an item it checks or renames and
# reads no byte of any item: a rename is not a read. Every kept item is
# checked before any is renamed, so a refusal by a check leaves inbox/ as it
# was. A kept name that ends in a dot or a space is refused before any path is
# built from it, since Windows drops either when it resolves a path, so the
# path the later acts would use is another item's, or nobody's. A clear or
# rename that throws on a later item refuses with the earlier renames made and
# their renamed: lines written. The new name is renamed- and the old name,
# which no entry on the list matches, since the list is anchored at the start
# of the name.
if ($PSCmdlet.ParameterSetName -eq 'Rename') {
    $inboxDir = Join-Path $repoRoot 'inbox'
    if (-not (Test-Path -LiteralPath $inboxDir -PathType Container)) {
        Stop-WithReason 'inbox/ does not exist.'
    }
    $kept = @(Get-ChildItem -LiteralPath $inboxDir -Force | Where-Object { $_.Name -match $instructionName })
    $planned = @()
    foreach ($item in $kept) {
        $oldName  = $item.Name
        # Windows drops a trailing dot or space when it resolves a path, so
        # for a kept name such as CLAUDE~1.md. the paths built below end in
        # CLAUDE~1.md, which is another item's name, long or short, where one
        # exists, and nobody's otherwise, so the later acts would read, clear
        # and rename that item or throw. The test is on the name the listing
        # returned and builds no path, and this loop runs whole before any
        # rename, so the refusal leaves inbox/ as it was.
        if ($oldName.EndsWith('.', [StringComparison]::Ordinal) -or $oldName.EndsWith(' ', [StringComparison]::Ordinal)) {
            Stop-WithReason "inbox/$oldName ends in a dot or a space, which Windows drops from a path, so it is not renamed and stays in inbox/; a person removes it."
        }
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
    # No time is set: the item stays in inbox/, where no staleness reading
    # applies, and the move route sets none either.
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
# -What Pending lists it: the inbox's own files, .gitkeep left out. The shape is
# checked before the inbox is read, so a value that is not a handle is refused
# as such whatever the tree holds. The resolved name then runs every check a
# name given on the line runs but the apostrophe refusal, which guards only
# the shell line a handle never puts the name on.
if ($PSCmdlet.ParameterSetName -eq 'Handle') {
    if ($Handle -cnotmatch '^[0-9a-f]{12}$') {
        Stop-WithReason 'Handle must be twelve lowercase hexadecimal digits, as kb-status.ps1 -What Pending prints it.'
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
# Both precede the open, the compare and the move, so nothing on disk
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
# the names the open, the compare and the move act on.
foreach ($full in @($srcFull, $destFull)) {
    $leaf = [System.IO.Path]::GetFileName($full)
    if ($leaf -match $instructionName) {
        Stop-WithReason "inbox/$leaf carries an instruction file's name, which Claude Code would load from sources/; it stays in inbox/, where kb-move.ps1 -Rename renames it in place."
    }
}

Assert-InsideRepo @($srcFull, $destFull)

# The entry is opened once, through a handle that does not follow a link, and
# every act below reads from or deletes through that handle, so the file whose
# attributes are checked is the file that is compared, copied and deleted,
# whatever is swapped in at the path meanwhile. The handle asks delete access
# and shares reads alone, so an entry another process holds open without
# sharing delete is refused here, and the run holds the entry against a
# rename or a delete until it exits. An open that fails, the file gone since
# the existence check among the causes, ends as the one-line reason. The
# handle closes in the finally on every path, a refusal included, since
# Stop-WithReason's exit runs the finally before the process ends.
Initialize-InboxEntryType
$openError = 0
$entry = [KbMove.InboxEntry]::Open($srcFull, [ref]$openError)
if ($openError -ne 0) {
    Stop-WithReason ("could not open inbox/$Name, so it stays in inbox/: " + (Get-Win32Message $openError))
}
$entryStream = $null
try {
    # A reparse point in inbox/, a symbolic link or a junction among them, is
    # refused on the handle's own attributes, never its target's, before any
    # byte is read through it. A hard link is not a reparse point and is not
    # refused by this check; the copy below leaves its outside name with its
    # own body alone.
    $attributeValue = [uint32]0
    $attributeError = [KbMove.InboxEntry]::GetAttributes($entry, [ref]$attributeValue)
    if ($attributeError -ne 0) {
        Stop-WithReason ("could not read the attributes of inbox/$Name, so it stays in inbox/: " + (Get-Win32Message $attributeError))
    }
    if (($attributeValue -band 0x400) -ne 0) {
        Stop-WithReason "inbox/$Name is a reparse point, such as a symbolic link; only a plain file is moved."
    }

    # A test seam: where KB_MOVE_TEST_HOLD_SECONDS is an integer from 1 to 300
    # the run sleeps here, after the attribute read and before the gate, with
    # the handle held, so a test can act on the entry from outside while the
    # run holds it. Any other value is ignored.
    $holdSeconds = 0
    if ([int]::TryParse([string]$env:KB_MOVE_TEST_HOLD_SECONDS, [System.Globalization.NumberStyles]::None, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$holdSeconds) -and $holdSeconds -gt 0 -and $holdSeconds -le 300) {
        Start-Sleep -Seconds $holdSeconds
    }

    # The entry's bytes are read over a stream on the handle, with the read
    # access the open granted and no share mode of its own, since sharing was
    # fixed at the open.
    try {
        $entryStream = [System.IO.FileStream]::new($entry, [System.IO.FileAccess]::Read)
    } catch {
        Stop-WithReason ("could not read inbox/$Name, so it stays in inbox/: " + ($_.Exception.GetBaseException().Message -replace '\s+', ' ').Trim())
    }

    $destRelative = "sources/$Name"

    # sources/ is immutable, so an existing destination is never overwritten.
    # Where it exists, the inbox entry and the source are compared byte for
    # byte: their lengths first, so two files of different sizes are told
    # apart with no read of either, then their SHA-256 digests, the inbox side
    # read from the handle and the source over a read-only stream, so the
    # destination's bytes and last-write time stay as they are. Equal digests
    # mean an earlier run ingested this file, and the inbox entry is deleted
    # through the handle inside the gate below. Unequal lengths or digests are
    # a new document under a taken name, refused so a person renames the inbox
    # file. A length or content read that throws on either file ends as the
    # one-line reason and the file stays in inbox/. The compare runs only
    # where the destination exists and the copy only where it does not.
    $isDuplicate = $false
    # The one refusal sentence the ingest skill reads, set once and used at
    # both the length site and the digest site, so the two cannot drift apart.
    $differentContentReason = "$destRelative already exists with different content; sources/ is immutable and is never overwritten, so a person renames the inbox file."
    if (Test-Path -LiteralPath $sourcesPath) {
        try {
            $inboxLength = $entryStream.Length
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
            $inboxDigest = Get-StreamDigest $entryStream
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

    # One gate covers both outcomes, so -WhatIf deletes nothing and creates
    # nothing, with the entry opened and read as on a real run. The gate's
    # target is the file the action touches: the inbox copy for a delete, the
    # destination for a move, so a -WhatIf line names the right one.
    $target = if ($isDuplicate) { "inbox/$Name" } else { $destRelative }
    $action = if ($isDuplicate) { 'Delete the byte-identical duplicate' } else { 'Move file from inbox/ to sources/' }

    if ($PSCmdlet.ShouldProcess($target, $action)) {
        # A duplicate is deleted through the handle that was compared, so the
        # entry removed is the entry whose bytes matched. The delete ignores a
        # read-only attribute, so a read-only duplicate leaves the inbox with
        # no attribute write. A delete that fails ends as the one-line reason
        # and the copy stays in inbox/. The entry leaves the folder when the
        # handle closes in the finally below.
        if ($isDuplicate) {
            $deleteError = [KbMove.InboxEntry]::Delete($entry, $attributeValue)
            if ($deleteError -ne 0) {
                Stop-WithReason ("could not delete the duplicate inbox/$Name, so it stays in inbox/: " + (Get-Win32Message $deleteError))
            }
            Write-Output "duplicate: $destRelative"
            exit 0
        }
        # A move writes the destination as a fresh file, created new so a
        # destination that appeared since the check above is never
        # overwritten, and copied from the handle's stream, so the source is
        # the running account's own file and shares no body with the inbox
        # entry or with any outside name of it. A create that fails or a copy
        # that throws removes the partial destination, where this run created
        # it, and ends as the one-line reason with the entry still in inbox/.
        # The copy carries the entry's bytes alone, not its alternate data
        # streams, so the downloaded-file mark does not reach sources/. The
        # copy is flushed to disk before the entry is marked for deletion.
        # No last-write time is set: the copy's time is the time of its write.
        $destCreated = $false
        $destStream = $null
        try {
            $destStream = [System.IO.File]::Open($destFull, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            $destCreated = $true
            $entryStream.Position = 0
            $entryStream.CopyTo($destStream)
            $destStream.Flush($true)
            $destStream.Dispose()
            $destStream = $null
        } catch {
            $copyReason = ($_.Exception.GetBaseException().Message -replace '\s+', ' ').Trim()
            if ($null -ne $destStream) { try { $destStream.Dispose() } catch { } }
            if ($destCreated) {
                # A partial copy that cannot be removed would hold the name and
                # refuse the entry on every later run, so the line names both.
                try {
                    [System.IO.File]::Delete($destFull)
                } catch {
                    Stop-WithReason ("could not copy inbox/$Name to $destRelative, and could not remove the partial copy, so both files remain and a person reconciles them: " + $copyReason + '; ' + ($_.Exception.GetBaseException().Message -replace '\s+', ' ').Trim())
                }
            }
            Stop-WithReason ("could not copy inbox/$Name to $destRelative, so it stays in inbox/: " + $copyReason)
        }
        # The entry is deleted through the handle once the copy is whole, so
        # the inbox loses the file whose bytes now sit under sources/. A delete
        # that fails removes the copy, so sources/ gains nothing the inbox still
        # holds, and ends as the one-line reason; where the copy cannot be
        # removed either, the line names both files, and a person reconciles
        # them.
        $deleteError = [KbMove.InboxEntry]::Delete($entry, $attributeValue)
        if ($deleteError -ne 0) {
            $deleteReason = Get-Win32Message $deleteError
            try {
                [System.IO.File]::Delete($destFull)
            } catch {
                Stop-WithReason ("could not delete inbox/$Name after copying it to $destRelative, and could not remove the copy, so both files remain and a person reconciles them: " + $deleteReason + '; ' + ($_.Exception.GetBaseException().Message -replace '\s+', ' ').Trim())
            }
            Stop-WithReason ("could not delete inbox/$Name after copying it to sources/, so the copy was removed and it stays in inbox/: " + $deleteReason)
        }
        Write-Output $destRelative
    }
} finally {
    if ($null -ne $entryStream) { $entryStream.Dispose() }
    $entry.Dispose()
}

exit 0
