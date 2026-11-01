#Requires -Version 7.0
<#
.SYNOPSIS
Drops one file into a listed wiki's inbox, the only place a session outside the
wiki writes.

.DESCRIPTION
Reads the wiki's entry from the account's list with kb-registry.ps1 Get -Json,
refuses a name that is not listed, and writes one file under <wiki>\inbox\. The
walker's next pass ingests it as it ingests any source. The script never runs
git, never commits, and never writes outside the inbox; it creates neither the
wiki's folder nor its inbox.

With -Content it writes -Name as UTF-8 without a byte order mark and with LF
line ends, in front of the content a front-matter block carrying dropped-at (UTC,
round-trip format), dropped-by and, where -Note is given, note, so the ingest
skill reads where the file came from with the text. No ingest rule
names or checks these fields, so a hand-made block of the same shape
reads the same. Each value is written
as a JSON-quoted string, which is valid YAML and keeps a colon or a line break
in a value from breaking the block. With -File it copies the file byte for byte
under its own leaf name and adds nothing, since a copied file carries no front
matter of ours; -Name, -DroppedBy and -Note are refused with it.

A name, or a copied file's leaf name, is refused where it is empty or blank,
holds a backslash, a slash or a colon, starts with a dot, holds an apostrophe,
holds a character the
file system forbids in a name, has a stem before its first dot that is a Windows
reserved device name (CON, PRN, AUX, NUL, COM0 to COM9, LPT0 to LPT9, in any
case), ends in a dot or a space, or equals an entry already in the inbox under a
case-insensitive comparison. The file is created only where it does not exist,
so a second writer racing this one is refused rather than overwritten.

A call refused by a rule prints one line, "kb-drop: <reason>", on stderr, exits
1 and writes nothing. A write that fails partway prints the same line naming
the failure and exits 1, and can leave the partial file in the inbox; the script
does not delete it. A call that succeeds prints the written file's full path, as UTF-8 bytes.

.PARAMETER Wiki
The name of a listed wiki.

.PARAMETER File
The path of an existing file to copy into the inbox. Excludes -Content.

.PARAMETER Content
The text to write. Needs -Name. Excludes -File.

.PARAMETER Name
The file name to write under the inbox, for -Content.

.PARAMETER DroppedBy
The dropped-by value, for -Content. Defaults to the current folder.

.PARAMETER Note
A note recorded in the front matter, for -Content.

.EXAMPLE
pwsh -NoProfile -File ./kb-drop.ps1 -Wiki acme -Content "Call notes." -Name call-notes.md -Note "From the Tuesday call"

.EXAMPLE
pwsh -NoProfile -File ./kb-drop.ps1 -Wiki acme -File D:\Downloads\contract.pdf
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Wiki,

    [string]$File,

    [string]$Content,

    [string]$Name,

    [string]$DroppedBy,

    [string]$Note
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Writes a single-line reason to stderr and stops with exit code 1, so a refusal
# is legible to the calling session without a PowerShell stack trace.
function Stop-WithReason {
    param([string]$Reason)
    [Console]::Error.WriteLine("kb-drop: $Reason")
    exit 1
}

$ignoreCase = [StringComparison]::OrdinalIgnoreCase

# The Windows reserved device names; a name whose stem before the first dot
# equals one of them, in any case, opens the device instead of a file.
$reservedNames = @('CON', 'PRN', 'AUX', 'NUL') + @(0..9 | ForEach-Object { "COM$_"; "LPT$_" })

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

# The text of a string as one JSON-quoted string, valid as a YAML value.
function ConvertTo-QuotedValue {
    param([string]$Text)
    return (ConvertTo-Json -InputObject $Text -Compress -EscapeHandling EscapeNonAscii)
}

$bound = $PSBoundParameters
if ($bound.ContainsKey('File') -and $bound.ContainsKey('Content')) {
    Stop-WithReason '-File and -Content exclude each other'
}
if (-not $bound.ContainsKey('File') -and -not $bound.ContainsKey('Content')) {
    Stop-WithReason 'give -File, or -Content with -Name'
}
if ($bound.ContainsKey('File')) {
    foreach ($refused in @('Name', 'DroppedBy', 'Note')) {
        if ($bound.ContainsKey($refused)) {
            Stop-WithReason "-File copies the file as it is, so it takes no -$refused"
        }
    }
} elseif (-not $bound.ContainsKey('Name')) {
    Stop-WithReason '-Content needs -Name'
}

# The wiki's entry, read from the list by the list's own script.
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
$registryScript = Join-Path $PSScriptRoot 'kb-registry.ps1'
$psi.Arguments = (@('-NoProfile', '-File', $registryScript, 'Get', '-Name', $Wiki, '-Json') | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join ' '
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$child = [System.Diagnostics.Process]::Start($psi)
$childOut = $child.StandardOutput.ReadToEndAsync()
$childErr = $child.StandardError.ReadToEndAsync()
if (-not $child.WaitForExit(30000)) {
    try { $child.Kill() } catch { }
    Stop-WithReason 'the wiki list read did not finish in 30 seconds'
}
[void][System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($childOut, $childErr))
if ($child.ExitCode -ne 0) {
    $errorLines = @($childErr.Result -split "`r?`n" | Where-Object { $_.Trim() -ne '' })
    if ($childErr.Result.Contains('is not listed', [StringComparison]::Ordinal)) {
        Stop-WithReason "wiki '$Wiki' is not listed"
    }
    $firstLine = if ($errorLines.Count -gt 0) { $errorLines[0] -replace '^kb-registry: ', '' } else { "the list script exited $($child.ExitCode)" }
    Stop-WithReason "the wiki list could not be read: $firstLine"
}
try {
    $entry = $childOut.Result | ConvertFrom-Json
    $wikiPath = [string]$entry.path
} catch {
    Stop-WithReason "the list entry of wiki '$Wiki' could not be read"
}
if ([string]::IsNullOrWhiteSpace($wikiPath)) { Stop-WithReason "the list entry of wiki '$Wiki' holds no path" }
$inbox = Join-Path $wikiPath 'inbox'
if (-not [System.IO.Directory]::Exists($wikiPath)) { Stop-WithReason "wiki '$Wiki' folder does not exist: $wikiPath" }
if (-not [System.IO.Directory]::Exists($inbox)) { Stop-WithReason "wiki '$Wiki' has no inbox folder: $inbox" }
if ($null -ne ([System.IO.DirectoryInfo]::new($inbox)).LinkTarget) {
    Stop-WithReason "the inbox of wiki '$Wiki' is a link, so a write there could land outside it: $inbox"
}

$sourcePath = $null
if ($bound.ContainsKey('File')) {
    $sourcePath = [System.IO.Path]::GetFullPath($File, (Get-Location -PSProvider FileSystem).ProviderPath)
    if (-not [System.IO.File]::Exists($sourcePath)) { Stop-WithReason "-File is not an existing file: $sourcePath" }
    $fileName = [System.IO.Path]::GetFileName($sourcePath)
} else {
    $fileName = $Name
}

# The name rules, in order, each refusal naming its rule.
if ([string]::IsNullOrWhiteSpace($fileName)) { Stop-WithReason 'the name is empty' }
if ($fileName.IndexOfAny([char[]]@('\', '/', ':')) -ge 0) {
    Stop-WithReason "name '$fileName' holds a path separator or a colon"
}
if ($fileName.StartsWith('.', [StringComparison]::Ordinal)) { Stop-WithReason "name '$fileName' starts with a dot" }
# A session's own name is the one a person types on a shell line, where an
# apostrophe ends a single-quoted string, so a name holding one is refused here
# as kb-move.ps1 -Name refuses it.
if ($fileName.Contains("'")) { Stop-WithReason "name '$fileName' holds an apostrophe" }
if ($fileName.IndexOfAny([System.IO.Path]::GetInvalidFileNameChars()) -ge 0) {
    Stop-WithReason "name '$fileName' holds a character a file name may not hold"
}
$stem = $fileName.Split('.')[0].TrimEnd(' ')
foreach ($reserved in $reservedNames) {
    if ([string]::Equals($stem, $reserved, $ignoreCase)) { Stop-WithReason "name '$fileName' is a reserved device name" }
}
if ($fileName.EndsWith('.', [StringComparison]::Ordinal) -or $fileName.EndsWith(' ', [StringComparison]::Ordinal)) {
    Stop-WithReason "name '$fileName' ends in a dot or a space"
}
foreach ($existing in [System.IO.Directory]::EnumerateFileSystemEntries($inbox)) {
    if ([string]::Equals([System.IO.Path]::GetFileName($existing), $fileName, $ignoreCase)) {
        Stop-WithReason "name '$fileName' already exists in the inbox, compared ignoring case"
    }
}

$target = [System.IO.Path]::GetFullPath((Join-Path $inbox $fileName))
# True once this run has created the target, so a failure after it is not read
# as another writer's file.
$created = $false
$existedBefore = [System.IO.File]::Exists($target)
try {
    if ($null -ne $sourcePath) {
        [System.IO.File]::Copy($sourcePath, $target, $false)
        $created = $true
    } else {
        if (-not $bound.ContainsKey('DroppedBy')) { $DroppedBy = (Get-Location).Path }
        $header = New-Object System.Collections.Generic.List[string]
        $header.Add('---')
        $header.Add("dropped-at: $(ConvertTo-QuotedValue ([DateTime]::UtcNow.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)))")
        $header.Add("dropped-by: $(ConvertTo-QuotedValue $DroppedBy)")
        if ($bound.ContainsKey('Note')) { $header.Add("note: $(ConvertTo-QuotedValue $Note)") }
        $header.Add('---')
        $body = $Content -replace "`r`n", "`n"
        if (-not $body.EndsWith("`n", [StringComparison]::Ordinal)) { $body += "`n" }
        $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes(($header -join "`n") + "`n`n" + $body)
        $stream = [System.IO.File]::Open($target, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $created = $true
        try {
            $stream.Write($bytes, 0, $bytes.Length)
        } finally {
            $stream.Dispose()
        }
    }
} catch {
    if (-not $created -and $existedBefore) {
        Stop-WithReason "name '$fileName' already exists in the inbox"
    }
    if (-not $created -and $null -eq $sourcePath -and $_.Exception -is [System.IO.IOException] -and [System.IO.File]::Exists($target)) {
        Stop-WithReason "name '$fileName' already exists in the inbox"
    }
    Stop-WithReason "writing $target failed: $($_.Exception.GetBaseException().Message)"
}

# The path as UTF-8 bytes on the standard output stream, so a non-ASCII folder
# name reaches the caller whatever the console code page.
$pathBytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($target + "`n")
$stdout = [Console]::OpenStandardOutput()
$stdout.Write($pathBytes, 0, $pathBytes.Length)
$stdout.Flush()
exit 0
