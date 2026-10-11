# Runs one persona's keeper from the installed personas plugin rather than from a repository
# checkout. This is the script an AgentPersona-<name> task launches when bin/Register-PersonaTasks.ps1
# was run with -LauncherRoot, under Windows PowerShell 5.1:
#
#   powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File <LauncherRoot>\Start-InstalledPersona.ps1 -Name <n> [-Roster <path>] [-EnvFile <path>]
#
# Registration copies this file into the launcher root, a folder outside the plugin cache, so the
# task's action names one path that no plugin update moves. At each start the script reads the
# installed plugin's record from installed_plugins.json, copies that version's plugin folder into
# <LauncherRoot>\runtime\<version> unless the snapshot is already there, and runs the snapshot's
# bin\Start-Persona.ps1 with -Name, -Roster and -EnvFile, exiting with its exit code.
#
# The keeper runs from the snapshot rather than from the cache folder for two reasons. The cache
# folder is named for one version, so a task pointed at it keeps that version after an update. And
# Claude Code's cache cleanup may remove a folder no longer installed, while bash reads a running
# supervise.sh from disk as it goes. Nothing removes a snapshot. Each version's snapshot is its own
# folder, so the supervisor path in the
# keeper's command line names the version, and a keeper never adopts a supervisor of another one
# (Open-KeeperLiveSupervisor in bin/Start-Persona.ps1 matches on the full command line).
#
# A new plugin version reaches a persona at its task's next start, a reboot included, and never
# mid-run: the keeper's relaunch loop keeps the supervisor path it started with. Where the task
# restarts while an older version's supervisor is still alive, the new supervisor waits at its
# pre-launch gate, exits 2 on GATE TIMEOUT, and the keeper relaunches it after the base delay
# (keeper-functions.ps1, the exit-2 row) until the old supervisor has ended. Stop the old one the
# way the README's stop procedure says to move the persona over at once.
#
# Every persona task starts at boot, so several copies of this script can build one snapshot at the
# same moment. Each copies into a temporary folder of its own and renames it into place. The rename
# is atomic on one volume, so one copy wins and the others discard theirs and use the winner.
#
# A copy is renamed into place only when it holds every file the keeper and the supervisor need
# (the $script:RequiredFiles list), so an install folder Claude Code has not finished writing never
# becomes a version's snapshot. A temporary copy left by a launcher that was killed mid-copy is
# removed by a later start once it is an hour old, far longer than any copy takes.
#
# A refusal (an unreadable or missing record, a version that cannot name a folder, an install
# folder with no keeper in it, an incomplete copy, a copy that fails) is one line in
# <LauncherRoot>\launcher.log and exit 1, since a scheduled task gives stderr no console. The
# task's restart-on-failure setting retries a 1 every minute, up to its restart count.
[CmdletBinding()]
param(
    # Required. Checked in the body rather than marked Mandatory, for the reason
    # bin/Start-Persona.ps1 gives: a Mandatory prompt under a scheduled task hangs the run.
    [string]$Name,
    [string]$Roster = 'D:/personas/fleet.json',
    [string]$EnvFile = 'D:/personas/keeper.env',
    # The installed plugin id whose version the keeper runs. AGENTIC_MARKETPLACE in
    # bin/agentic-common.sh names the same marketplace.
    [string]$PluginId = 'personas@applefeld',
    # The Claude Code configuration folder holding plugins\installed_plugins.json. CLAUDE_CONFIG_DIR
    # overrides it for Claude Code itself, so it overrides it here too.
    [string]$ConfigDir
)

$script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$script:LogPath = Join-Path $PSScriptRoot 'launcher.log'

# What a copy must hold before it becomes a snapshot: the keeper, its functions, the supervisor,
# the supervisor's shared helpers and the plugin manifest.
$script:RequiredFiles = @(
    'bin\Start-Persona.ps1',
    'bin\keeper-functions.ps1',
    'bin\supervise.sh',
    'bin\agentic-common.sh',
    '.claude-plugin\plugin.json'
)

# How old a leftover temporary copy must be before a start removes it.
$script:StaleTempAge = [TimeSpan]::FromHours(1)

<#
.SYNOPSIS
Appends one timestamped line to launcher.log as UTF-8 without a byte-order mark.

.DESCRIPTION
A failed append goes to stderr, the only other channel the launcher has. The log is not rotated: it
takes one line per task start, so it grows by a few lines per boot.
#>
function Write-LauncherLog {
    param([Parameter(Mandatory)][string]$Text)
    $stamp = [DateTime]::UtcNow.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    try {
        [System.IO.File]::AppendAllText($script:LogPath, "$stamp $Text" + [Environment]::NewLine, $script:Utf8NoBom)
    } catch {
        [Console]::Error.WriteLine("Start-InstalledPersona: could not append to '$script:LogPath': $($_.Exception.Message)")
    }
}

<#
.SYNOPSIS
Logs a refusal, writes it to stderr and exits 1.
#>
function Stop-LauncherWithError {
    param([Parameter(Mandatory)][string]$Text)
    Write-LauncherLog "ERROR $Text"
    [Console]::Error.WriteLine("Start-InstalledPersona: $Text")
    exit 1
}

<#
.SYNOPSIS
Returns the install path and version installed_plugins.json records for one plugin id.

.DESCRIPTION
The file maps each plugin id to an array of install records, one per scope. The user-scope record
is taken where there is one, since that is the scope a fleet machine installs the plugin at, and the
first record otherwise. The caller logs which scope it took. The version becomes a folder name under
the runtime root, so it must start with a letter, digit, underscore or hyphen, hold only those and
dots after that, and not end in a dot, which Windows drops from a folder name. A reserved device
name (CON, PRN, AUX, NUL, COM1 to COM9, LPT1 to LPT9), with or without an extension, is refused too.
#>
function Get-InstalledPluginRecord {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Id)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "installed plugin list '$Path' does not exist"
    }
    try {
        $parsed = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw "installed plugin list '$Path' could not be read: $($_.Exception.Message)"
    }
    $property = $null
    if ($null -ne $parsed.plugins) { $property = $parsed.plugins.PSObject.Properties[$Id] }
    if ($null -eq $property) {
        throw "installed plugin list '$Path' has no record for '$Id'"
    }
    $records = @($property.Value)
    $record = @($records | Where-Object { $_.scope -eq 'user' }) | Select-Object -First 1
    if ($null -eq $record) { $record = $records | Select-Object -First 1 }
    $installPath = [string]$record.installPath
    $version = [string]$record.version
    if ([string]::IsNullOrWhiteSpace($installPath)) {
        throw "the '$Id' record in '$Path' carries no installPath"
    }
    if ($version -notmatch '\A[A-Za-z0-9_-][A-Za-z0-9._-]*\z' -or $version.EndsWith('.') -or
        $version -match '\A(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?\z') {
        throw "the '$Id' record in '$Path' carries version '$version', which cannot name a folder"
    }
    return @{ InstallPath = $installPath; Version = $version; Scope = [string]$record.scope }
}

<#
.SYNOPSIS
Returns the snapshot folder for one plugin version, copying it from the install folder first where
it is not there yet.

.DESCRIPTION
The copy goes to a temporary folder named for this process and is renamed into place, so a reader
never sees a half-copied snapshot. A rename that loses to another launcher's finds the snapshot
present, discards its own copy and returns the winner's. A snapshot already present is used as it
stands, since an install folder is written once per version and never changed afterward.
#>
function Install-PluginSnapshot {
    param(
        [Parameter(Mandatory)][string]$InstallPath,
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$RuntimeRoot
    )
    $snapshot = Join-Path $RuntimeRoot $Version
    if (Test-Path -LiteralPath $snapshot -PathType Container) { return $snapshot }
    [void][System.IO.Directory]::CreateDirectory($RuntimeRoot)
    $temp = Join-Path $RuntimeRoot ".$Version.$PID.tmp"
    try {
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction Stop }
        Copy-Item -LiteralPath $InstallPath -Destination $temp -Recurse -Force -ErrorAction Stop
        $missing = @($script:RequiredFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $temp $_) -PathType Leaf) })
        if ($missing.Count -gt 0) {
            throw "the install folder is incomplete, missing $($missing -join ', ')"
        }
        try {
            [System.IO.Directory]::Move($temp, $snapshot)
        } catch {
            if (-not (Test-Path -LiteralPath $snapshot -PathType Container)) { throw }
            Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
        throw
    }
    return $snapshot
}

<#
.SYNOPSIS
Removes temporary copies under the runtime root that are older than $script:StaleTempAge.

.DESCRIPTION
Only folders named the way Install-PluginSnapshot names its temporary copies are touched, and only
once they are old enough that no live copy can still be writing them. A removal that fails is left
for a later start.
#>
function Remove-StaleTempCopies {
    param([Parameter(Mandatory)][string]$RuntimeRoot)
    if (-not (Test-Path -LiteralPath $RuntimeRoot -PathType Container)) { return }
    $cutoff = [DateTime]::UtcNow - $script:StaleTempAge
    foreach ($dir in @(Get-ChildItem -LiteralPath $RuntimeRoot -Directory -Force -ErrorAction SilentlyContinue)) {
        if ($dir.Name -like '.*.tmp' -and $dir.LastWriteTimeUtc -lt $cutoff) {
            Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

if ([string]::IsNullOrWhiteSpace($Name)) {
    Stop-LauncherWithError '-Name is required.'
}
if ([string]::IsNullOrWhiteSpace($ConfigDir)) {
    $ConfigDir = $env:CLAUDE_CONFIG_DIR
    if ([string]::IsNullOrWhiteSpace($ConfigDir)) { $ConfigDir = Join-Path $env:USERPROFILE '.claude' }
}
$listPath = Join-Path (Join-Path $ConfigDir 'plugins') 'installed_plugins.json'

try {
    $record = Get-InstalledPluginRecord -Path $listPath -Id $PluginId
} catch {
    Stop-LauncherWithError "$Name`: $($_.Exception.Message)"
}
if (-not (Test-Path -LiteralPath (Join-Path $record.InstallPath 'bin\Start-Persona.ps1') -PathType Leaf)) {
    Stop-LauncherWithError "$Name`: '$PluginId' $($record.Version) at '$($record.InstallPath)' holds no bin\Start-Persona.ps1"
}
$runtimeRoot = Join-Path $PSScriptRoot 'runtime'
Remove-StaleTempCopies -RuntimeRoot $runtimeRoot
try {
    $snapshot = Install-PluginSnapshot -InstallPath $record.InstallPath -Version $record.Version -RuntimeRoot $runtimeRoot
} catch {
    Stop-LauncherWithError "$Name`: snapshot of '$($record.InstallPath)' failed: $($_.Exception.Message)"
}

Write-LauncherLog "START $Name $PluginId $($record.Version) scope=$($record.Scope) $snapshot"
$global:LASTEXITCODE = 0
& (Join-Path $snapshot 'bin\Start-Persona.ps1') -Name $Name -Roster $Roster -EnvFile $EnvFile
exit $LASTEXITCODE
