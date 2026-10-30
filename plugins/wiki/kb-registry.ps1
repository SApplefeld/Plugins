#Requires -Version 7.0
<#
.SYNOPSIS
Maintains the account's wiki list, %LOCALAPPDATA%\llm-wiki\registry.json.

.DESCRIPTION
The only writer of the wiki list. The list is one JSON file per Windows account,
shaped { "version": 1, "root": "<folder>", "wikis": [ { "name", "path",
"description", "addedAt" } ] }, and the walker task, the engine's scripts and
the search skills read it. This script checks each entry it adds and each
description it changes, and refuses a list file off its shape, so a list only
this script writes stays clean for every reader.

A name is 1 to 64 ASCII letters, digits, hyphens, underscores and dots, never
starting or ending with a dot, since Windows strips a folder name's trailing
dot, never a Windows reserved device name (CON, PRN, AUX, NUL, COM0 to COM9,
LPT0 to LPT9, matched on the part before the first dot), and
unique in the list ignoring case. A path, like Init's root, opens with a
drive letter on a local drive, so a network share, an admin share, a drive
mapped to a share and the \\?\, \??\ and \\.\ device forms are refused; it
is reached through no junction, symbolic link or mount point, and holds no
character a description may not hold. The folder rules below compare path
text, and these rules leave them one spelling per folder except a subst
drive and an 8.3 short name, which they do not see. A path is an existing
directory, not a listed wiki's path, not inside one and not containing one,
and holds
every file in $requiredFiles, the set new-kb.ps1 verifies after a copy less
.claude/engine.json and less .claude/skills/wiki-merge/SKILL.md. A wiki made
before the version mark existed, or before the merge skill existed, can still
be listed, and the walker's engine update brings it the merge skill.
A description holds no control character, C1
controls included, no line or paragraph separator and no text-direction mark, because List prints one
tab-separated line per wiki and a reader must see the line as written.

A refused call prints one line, "kb-registry: <reason>", on stderr, exits 1
and changes nothing. Init, Add, Remove and Set hold registry.lock, a sibling
of the list opened with no sharing, from their read of the list through the
move, so two writers never both read and check the same list. The file
stays and holds nothing; only the open handle is the lock, so the operating
system releases it when a writer ends, however it ends. A writer waits up to
10 seconds for the lock, and for a reader holding the list open at its move,
then refuses with "the list is held by another writer". List, Get and Root
take no lock and never wait on it. Each write builds the whole document in a temporary file
in the list's folder and moves it over the list, so a writer killed at any
point leaves the previous list whole and at most a stray *.tmp file there,
which no reader opens.

The list's location is read from LOCALAPPDATA at each run. One environment
variable is a test seam: where KB_REGISTRY_TEST_HOLD_SECONDS is an integer
from 1 to 300, a write sleeps that many seconds after the temporary file is complete
and before the move, so a test can kill the writer at that point. Any other
value is ignored.

.PARAMETER Verb
What to do, positional:
  Init    create the list with -Root as the wiki root folder, creating the
          folder where absent. Refused where a list already exists.
  Add     list the wiki -Name at -Path with -Description, and print its line.
  Remove  drop the wiki -Name from the list.
  Set     replace the description of -Name with -Description, and print its line.
  Get     print the line of -Name.
  Root    print the root folder.
  List    print one line per wiki, name<TAB>path<TAB>engine<TAB>description,
          or with -Json the list's wikis array as JSON. The engine column is the
          first eight characters of templateHash in the wiki's
          .claude/engine.json, or unknown where that file is absent or does not
          hold a 64-character hexadecimal templateHash.
Where no list exists, List prints nothing, List -Json prints [], and every
other verb but Init exits 1.

.PARAMETER Root
The absolute folder new wikis are created under, for Init.

.PARAMETER Name
The wiki's name, for Add, Remove, Set and Get.

.PARAMETER Path
The wiki's absolute folder, for Add.

.PARAMETER Description
A one-paragraph description of the wiki, for Add and Set. May be empty.

.PARAMETER Json
For List, print the wikis array as JSON.

.EXAMPLE
pwsh -NoProfile -File ./kb-registry.ps1 Init -Root D:\Wikis

.EXAMPLE
pwsh -NoProfile -File ./kb-registry.ps1 Add -Name acme -Path D:\Wikis\acme -Description "Acme contracts and correspondence."

.EXAMPLE
pwsh -NoProfile -File ./kb-registry.ps1 List
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateSet('Init', 'Add', 'Remove', 'Set', 'Get', 'Root', 'List')]
    [string]$Verb,

    [string]$Root,

    [string]$Name,

    [string]$Path,

    [string]$Description = '',

    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Text.Json

# Writes a single-line reason to stderr and stops with exit code 1, so a refusal
# is legible to the calling session without a PowerShell stack trace.
function Stop-WithReason {
    param([string]$Reason)
    [Console]::Error.WriteLine("kb-registry: $Reason")
    exit 1
}

# The files a listed wiki must hold, the set new-kb.ps1 verifies after a copy
# less .claude/engine.json and less .claude/skills/wiki-merge/SKILL.md, so a wiki
# made before the version mark or before the merge skill can still be listed.
# The walker's engine update brings such a wiki the merge skill.
# tests/Test-KbRegistry.ps1 pins the two sets equal, less those two files.
$requiredFiles = @(
    '.claude/settings.json'
    '.claude/kb-move.ps1'
    '.claude/kb-commit.ps1'
    '.claude/kb-run.ps1'
    '.claude/skills/wiki-ingest/SKILL.md'
    '.claude/skills/wiki-lint/SKILL.md'
    '.claude/skills/wiki-query/SKILL.md'
    'CLAUDE.md'
    'index.md'
    'log.md'
    '.gitignore'
    'inbox/.gitkeep'
    'sources/.gitkeep'
    'wiki/.gitkeep'
)

$reservedNames = @(
    'CON', 'PRN', 'AUX', 'NUL'
    'COM0', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9'
    'LPT0', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
)

$ignoreCase = [StringComparison]::OrdinalIgnoreCase
$noListReason = 'no wiki list; run Init -Root <folder>'

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    Stop-WithReason 'LOCALAPPDATA is not set, so the wiki list location is unknown'
}
$listDir = Join-Path $env:LOCALAPPDATA 'llm-wiki'
$listPath = Join-Path $listDir 'registry.json'

# Reads a string-valued property of a JSON object, or $null where it is absent
# or not a string.
function Get-JsonString {
    param([System.Text.Json.JsonElement]$Element, [string]$PropertyName)
    foreach ($property in $Element.EnumerateObject()) {
        if ([string]::Equals($property.Name, $PropertyName, [StringComparison]::Ordinal)) {
            if ($property.Value.ValueKind -eq [System.Text.Json.JsonValueKind]::String) {
                return $property.Value.GetString()
            }
            return $null
        }
    }
    return $null
}

$heldReason = 'the list is held by another writer'
$writeClock = $null

# True where an exception, unwrapped, is a sharing or lock violation, or with
# -Denied an access denial, which a move over a file a reader holds open meets.
function Test-HeldError {
    param([Exception]$Exception, [switch]$Denied)
    $inner = $Exception.GetBaseException()
    if ($Denied -and $inner -is [System.UnauthorizedAccessException]) { return $true }
    # 32 is ERROR_SHARING_VIOLATION and 33 ERROR_LOCK_VIOLATION.
    return ($inner -is [System.IO.IOException]) -and (@(32, 33) -contains ($inner.HResult -band 0xFFFF))
}

# Opens registry.lock with no sharing, retrying while another writer holds it
# until 10 seconds have passed, then refuses. File.Open makes a handle no
# child process inherits.
function Enter-ListLock {
    $script:writeClock = [System.Diagnostics.Stopwatch]::StartNew()
    [void][System.IO.Directory]::CreateDirectory($listDir)
    $lockPath = Join-Path $listDir 'registry.lock'
    while ($true) {
        try {
            return [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        } catch {
            if (-not (Test-HeldError $_.Exception)) {
                Stop-WithReason "taking the lock $lockPath failed: $($_.Exception.GetBaseException().Message)"
            }
            if ($script:writeClock.Elapsed.TotalSeconds -ge 10) { Stop-WithReason $heldReason }
            Start-Sleep -Milliseconds 100
        }
    }
}

# Reads the list into an ordered dictionary whose wikis entry is a list of
# ordered dictionaries, or returns $null where no list file exists. Every value
# is read as a string, so addedAt keeps its exact text across a rewrite. A file
# off the shape is refused rather than rewritten.
function Read-WikiList {
    if (-not [System.IO.File]::Exists($listPath)) { return $null }
    $invalid = "the wiki list at $listPath is not valid"
    $document = $null
    try {
        $document = [System.Text.Json.JsonDocument]::Parse([System.IO.File]::ReadAllText($listPath))
    } catch {
        Stop-WithReason "$invalid JSON"
    }
    try {
        $top = $document.RootElement
        if ($top.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { Stop-WithReason "$invalid; it is not a JSON object" }
        $version = $null
        $wikisElement = $null
        foreach ($property in $top.EnumerateObject()) {
            if ([string]::Equals($property.Name, 'version', [StringComparison]::Ordinal)) { $version = $property.Value }
            if ([string]::Equals($property.Name, 'wikis', [StringComparison]::Ordinal)) { $wikisElement = $property.Value }
        }
        if ($null -eq $version -or $version.ValueKind -ne [System.Text.Json.JsonValueKind]::Number -or -not [string]::Equals($version.GetRawText(), '1', [StringComparison]::Ordinal)) {
            Stop-WithReason "$invalid; version is not 1"
        }
        $rootValue = Get-JsonString $top 'root'
        if ([string]::IsNullOrEmpty($rootValue)) { Stop-WithReason "$invalid; root is missing" }
        if ($null -eq $wikisElement -or $wikisElement.ValueKind -ne [System.Text.Json.JsonValueKind]::Array) {
            Stop-WithReason "$invalid; wikis is not an array"
        }
        $wikis = New-Object System.Collections.Generic.List[object]
        foreach ($item in $wikisElement.EnumerateArray()) {
            if ($item.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { Stop-WithReason "$invalid; a wikis entry is not an object" }
            $entry = [ordered]@{}
            foreach ($field in @('name', 'path', 'description', 'addedAt')) {
                $value = Get-JsonString $item $field
                if ($null -eq $value) { Stop-WithReason "$invalid; a wikis entry has no string '$field'" }
                $entry[$field] = $value
            }
            $wikis.Add($entry)
        }
        return [ordered]@{ version = 1; root = $rootValue; wikis = $wikis }
    } finally {
        $document.Dispose()
    }
}

# Writes the whole list to a new temporary file in the list's folder, flushes it
# to disk, and moves it over the list, retrying the move while a reader holds
# the list open, inside the 10 seconds the lock's wait began. A failure removes
# the temporary file; a killed process leaves it, and the list as it was before
# the write. The caller holds the lock.
function Write-WikiList {
    param($List)
    # A plain cast, never [object[]]@(...): on PowerShell 7.6 the array
    # subexpression over a list holding an ordered dictionary throws "Argument
    # types do not match".
    $text = [ordered]@{ version = 1; root = $List.root; wikis = [object[]]$List.wikis } | ConvertTo-Json -Depth 4
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($text + [Environment]::NewLine)
    [void][System.IO.Directory]::CreateDirectory($listDir)
    if ([System.IO.File]::Exists($listPath) -and ([System.IO.File]::GetAttributes($listPath) -band [System.IO.FileAttributes]::ReadOnly)) {
        Stop-WithReason "the wiki list at $listPath is read-only, so nothing changed"
    }
    $tempPath = Join-Path $listDir "registry.json.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        $stream = [System.IO.File]::Open($tempPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try {
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Flush($true)
        } finally {
            $stream.Dispose()
        }
        $holdSeconds = 0
        if ([int]::TryParse([string]$env:KB_REGISTRY_TEST_HOLD_SECONDS, [System.Globalization.NumberStyles]::None, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$holdSeconds) -and $holdSeconds -gt 0 -and $holdSeconds -le 300) {
            Start-Sleep -Seconds $holdSeconds
        }
        while ($true) {
            try {
                [System.IO.File]::Move($tempPath, $listPath, $true)
                break
            } catch [System.IO.IOException], [System.UnauthorizedAccessException] {
                if (-not (Test-HeldError $_.Exception -Denied)) {
                    Stop-WithReason "the wiki list at $listPath could not be replaced, so nothing changed: $($_.Exception.GetBaseException().Message)"
                }
                if ($script:writeClock.Elapsed.TotalSeconds -ge 10) { Stop-WithReason $heldReason }
                Start-Sleep -Milliseconds 100
            }
        }
    } finally {
        if ([System.IO.File]::Exists($tempPath)) {
            [System.IO.File]::Delete($tempPath)
        }
    }
}

# Returns the list's index of the wiki named $WikiName, compared ignoring case,
# or -1.
function Find-Wiki {
    param($List, [string]$WikiName)
    for ($i = 0; $i -lt $List.wikis.Count; $i++) {
        if ([string]::Equals($List.wikis[$i].name, $WikiName, $ignoreCase)) { return $i }
    }
    return -1
}

# The first eight characters of the templateHash in a wiki's
# .claude/engine.json, or unknown. The file is the wiki's own and is read as
# untrusted: anything but a JSON object holding a 64-character hexadecimal
# templateHash string reads as unknown.
function Get-EngineMark {
    param([string]$WikiPath)
    $enginePath = Join-Path $WikiPath '.claude/engine.json'
    try {
        if (-not [System.IO.File]::Exists($enginePath)) { return 'unknown' }
        $document = [System.Text.Json.JsonDocument]::Parse([System.IO.File]::ReadAllText($enginePath))
        try {
            if ($document.RootElement.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { return 'unknown' }
            $hash = Get-JsonString $document.RootElement 'templateHash'
            if ($null -ne $hash -and [regex]::IsMatch($hash, '\A[0-9A-Fa-f]{64}\z')) {
                return $hash.Substring(0, 8)
            }
            return 'unknown'
        } finally {
            $document.Dispose()
        }
    } catch {
        return 'unknown'
    }
}

function Format-WikiLine {
    param($Entry)
    return "$($Entry.name)`t$($Entry.path)`t$(Get-EngineMark $Entry.path)`t$($Entry.description)"
}

# The reason a name is refused, or $null where it is acceptable.
function Get-NameRefusal {
    param([string]$Candidate)
    if (-not [regex]::IsMatch($Candidate, '\A[A-Za-z0-9_-](?:[A-Za-z0-9_.-]{0,62}[A-Za-z0-9_-])?\z')) {
        return "name '$Candidate' must be 1 to 64 letters, digits, hyphen, underscore or dot, not starting or ending with a dot"
    }
    $stem = $Candidate.Split('.')[0]
    foreach ($reserved in $reservedNames) {
        if ([string]::Equals($stem, $reserved, $ignoreCase)) {
            return "name '$Candidate' is a reserved device name"
        }
    }
    return $null
}

# Text a List line may not carry: control characters, C1 included, line and
# paragraph separators, and the text-direction marks and controls.
$unsafeText = '[\p{Cc}\u200E\u200F\u061C\u2028\u2029\u202A-\u202E\u2066-\u2069]'

# Refuses a folder that is on no drive, on a network drive, or reached through
# a link at any existing level, naming it as $What. The folder rules compare
# path text, so each of those would give one folder a second spelling.
function Assert-LocalFolder {
    param([string]$Full, [string]$What)
    if ([regex]::IsMatch($Full, $unsafeText)) {
        Stop-WithReason "$What must not contain control characters, line or paragraph separators or text-direction marks"
    }
    $drive = [System.IO.DriveInfo]::new($Full.Substring(0, 1))
    if ($drive.DriveType -eq [System.IO.DriveType]::NoRootDirectory) {
        Stop-WithReason "$What is on drive $($drive.Name), which does not exist: $Full"
    }
    if ($drive.DriveType -eq [System.IO.DriveType]::Network) {
        Stop-WithReason "$What must be a local folder, not on network drive $($drive.Name): $Full"
    }
    for ($segment = $Full; -not [string]::IsNullOrEmpty($segment); $segment = [System.IO.Path]::GetDirectoryName($segment)) {
        if ([System.IO.Directory]::Exists($segment) -and $null -ne ([System.IO.DirectoryInfo]::new($segment)).LinkTarget) {
            Stop-WithReason "$What passes through a link at $segment, so the inside and containing rules cannot compare it"
        }
    }
}

# Refuses a description holding a control character, a line or paragraph
# separator or a text-direction mark, since List is one tab-separated line
# per wiki and must read as written.
function Assert-Description {
    param([string]$Text)
    if ([regex]::IsMatch($Text, $unsafeText)) {
        Stop-WithReason 'description must not contain control characters, tab, line breaks and text-direction marks included'
    }
}

# Normalizes an absolute path to its full form without trailing separators,
# keeping a bare drive or share root as it is.
function ConvertTo-NormalPath {
    param([string]$Value)
    $full = [System.IO.Path]::GetFullPath($Value)
    $pathRoot = [System.IO.Path]::GetPathRoot($full)
    if ($full.Length -gt $pathRoot.Length) {
        $full = $full.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    }
    return $full
}

# True where $Child lies strictly below $Ancestor. The separator appended to the
# ancestor keeps D:\w\ab from reading as inside D:\w\a.
function Test-PathWithin {
    param([string]$Child, [string]$Ancestor)
    $prefix = $Ancestor.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    return $Child.StartsWith($prefix, $ignoreCase)
}

# Refuses a call that leaves out a parameter its verb needs.
$script:boundNames = [System.Collections.Generic.HashSet[string]]::new([string[]]@($PSBoundParameters.Keys), [StringComparer]::OrdinalIgnoreCase)
function Assert-Bound {
    param([string]$ParameterName)
    if (-not $script:boundNames.Contains($ParameterName)) {
        Stop-WithReason "$Verb needs -$ParameterName"
    }
}

# A writer with no list to change refuses before the lock, so it creates no
# folder. Init checks its root first for the same reason, then locks.
$lock = $null
try {
    if ($Verb -in @('Add', 'Remove', 'Set')) {
        if (-not [System.IO.File]::Exists($listPath)) { Stop-WithReason $noListReason }
        $lock = Enter-ListLock
    }
    $list = if ($Verb -ne 'Init') { Read-WikiList } else { $null }

    switch ($Verb) {
        'List' {
            if ($Json) {
                [object[]]$wikis = @()
                if ($null -ne $list) { $wikis = [object[]]$list.wikis }
                Write-Output (ConvertTo-Json -InputObject $wikis -Depth 3)
            } elseif ($null -ne $list) {
                foreach ($entry in $list.wikis) { Write-Output (Format-WikiLine $entry) }
            }
        }

        'Root' {
            if ($null -eq $list) { Stop-WithReason $noListReason }
            Write-Output $list.root
        }

        'Init' {
            Assert-Bound 'Root'
            if (-not [System.IO.Path]::IsPathFullyQualified($Root)) {
                Stop-WithReason "root is not absolute: $Root"
            }
            if (-not [regex]::IsMatch($Root, '\A[A-Za-z]:[\\/]')) {
                Stop-WithReason "root must be a local folder on a drive letter, not a network or device path: $Root"
            }
            try {
                $rootFull = ConvertTo-NormalPath $Root
            } catch {
                Stop-WithReason "root is not a valid path: $Root"
            }
            Assert-LocalFolder $rootFull 'root'
            if ([System.IO.File]::Exists($rootFull)) {
                Stop-WithReason "root is a file, not a folder: $rootFull"
            }
            $lock = Enter-ListLock
            $list = Read-WikiList
            if ($null -ne $list) {
                Stop-WithReason "a wiki list already exists with root '$($list.root)'"
            }
            try {
                [void][System.IO.Directory]::CreateDirectory($rootFull)
            } catch {
                Stop-WithReason "root could not be created at ${rootFull}: $($_.Exception.GetBaseException().Message)"
            }
            Write-WikiList ([ordered]@{ version = 1; root = $rootFull; wikis = @() })
            Write-Output $rootFull
        }

        'Add' {
            if ($null -eq $list) { Stop-WithReason $noListReason }
            Assert-Bound 'Name'
            Assert-Bound 'Path'
            $refusal = Get-NameRefusal $Name
            if ($null -ne $refusal) { Stop-WithReason $refusal }
            if ((Find-Wiki $list $Name) -ge 0) { Stop-WithReason "name '$Name' is already listed" }
            Assert-Description $Description

            if (-not [System.IO.Path]::IsPathFullyQualified($Path)) {
                Stop-WithReason "path is not absolute: $Path"
            }
            if (-not [regex]::IsMatch($Path, '\A[A-Za-z]:[\\/]')) {
                Stop-WithReason "path must be a local folder on a drive letter, not a network or device path: $Path"
            }
            try {
                $pathFull = ConvertTo-NormalPath $Path
            } catch {
                Stop-WithReason "path is not a valid path: $Path"
            }
            Assert-LocalFolder $pathFull 'path'
            if (-not [System.IO.Directory]::Exists($pathFull)) {
                Stop-WithReason "path is not an existing directory: $pathFull"
            }
            foreach ($listed in $list.wikis) {
                if ([string]::Equals($pathFull, $listed.path, $ignoreCase)) {
                    Stop-WithReason "path is already listed as wiki '$($listed.name)'"
                }
                if (Test-PathWithin $pathFull $listed.path) {
                    Stop-WithReason "path is inside listed wiki '$($listed.name)'"
                }
                if (Test-PathWithin $listed.path $pathFull) {
                    Stop-WithReason "path contains listed wiki '$($listed.name)'"
                }
            }
            foreach ($rel in $requiredFiles) {
                if (-not [System.IO.File]::Exists((Join-Path $pathFull $rel))) {
                    Stop-WithReason "path is missing required file '$rel'"
                }
            }

            $entry = [ordered]@{
                name        = $Name
                path        = $pathFull
                description = $Description
                addedAt     = [DateTime]::UtcNow.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
            }
            $list.wikis.Add($entry)
            Write-WikiList $list
            Write-Output (Format-WikiLine $entry)
        }

        'Remove' {
            if ($null -eq $list) { Stop-WithReason $noListReason }
            Assert-Bound 'Name'
            $index = Find-Wiki $list $Name
            if ($index -lt 0) { Stop-WithReason "name '$Name' is not listed" }
            $list.wikis.RemoveAt($index)
            Write-WikiList $list
        }

        'Set' {
            if ($null -eq $list) { Stop-WithReason $noListReason }
            Assert-Bound 'Name'
            Assert-Bound 'Description'
            $index = Find-Wiki $list $Name
            if ($index -lt 0) { Stop-WithReason "name '$Name' is not listed" }
            Assert-Description $Description
            $list.wikis[$index].description = $Description
            Write-WikiList $list
            Write-Output (Format-WikiLine $list.wikis[$index])
        }

        'Get' {
            if ($null -eq $list) { Stop-WithReason $noListReason }
            Assert-Bound 'Name'
            $index = Find-Wiki $list $Name
            if ($index -lt 0) { Stop-WithReason "name '$Name' is not listed" }
            Write-Output (Format-WikiLine $list.wikis[$index])
        }
    }
} finally {
    if ($null -ne $lock) { $lock.Dispose() }
}

exit 0
