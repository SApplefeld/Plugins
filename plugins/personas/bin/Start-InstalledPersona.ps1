# Runs one persona's keeper from the installed personas plugin rather than from a repository
# checkout. This is the script the fleet supervisor starts per enabled roster entry when the
# AgentFleet task runs bin/Start-InstalledFleet.ps1, which bin/Register-PersonaTasks.ps1 points it
# at when run with -LauncherRoot, under Windows PowerShell 5.1:
#
#   powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File <LauncherRoot>\Start-InstalledPersona.ps1 -Name <n> [-Roster <path>] [-EnvFile <path>]
#
# Registration copies this file into the launcher root, a folder outside the plugin folder, the
# marketplace and the plugin cache, so the path the fleet supervisor starts is one no plugin update
# moves. It copies bin/installed-plugin-functions.ps1 beside it, which this script dot-sources for
# the record lookup and the snapshot. At each start the script reads the
# installed plugin's record from installed_plugins.json, copies that version's plugin folder into
# <LauncherRoot>\runtime\<version> unless the snapshot is already there, and runs the snapshot's
# bin\Start-Persona.ps1 with -Name, -Roster and -EnvFile, exiting with its exit code.
#
# The keeper runs from the snapshot rather than from the cache folder for two reasons. The cache
# folder is named for one version, so a keeper started from it keeps that version after an update.
# And Claude Code's cache cleanup may remove a folder no longer installed, while bash reads a running
# supervise.sh from disk as it goes. Nothing removes a snapshot. Each version's snapshot is its own
# folder, so the supervisor path in the
# keeper's command line names the version, and a keeper never adopts a supervisor of another one
# (Open-KeeperLiveSupervisor in bin/Start-Persona.ps1 matches on the full command line).
#
# A new plugin version reaches a persona at its keeper's next start, a reboot included, and never
# mid-run: the keeper's relaunch loop keeps the supervisor path it started with. Where the keeper
# restarts while an older version's supervisor is still alive, the new supervisor waits at its
# pre-launch gate, exits 2 on GATE TIMEOUT, and the keeper relaunches it after the base delay
# (keeper-functions.ps1, the exit-2 row) until the old supervisor has ended. Stop the old one the
# way the README's stop procedure says to move the persona over at once.
#
# The fleet supervisor starts every enabled entry's keeper in one tick, and bin/Start-InstalledFleet.ps1
# takes its own snapshot under the same runtime root, so several launchers can build one snapshot at
# the same moment. Install-PluginSnapshot (bin/installed-plugin-functions.ps1) copies into a
# temporary folder per process and renames it into place, so one copy wins and the others use it.
#
# A copy is renamed into place only when it holds every file the fleet supervisor, the keeper and
# the supervisor need ($InstalledPluginRequiredFiles in the shared functions file), so an install
# folder Claude Code has not finished writing never becomes a version's snapshot. A temporary copy
# left by a launcher that was killed mid-copy is removed by a later start once it is an hour old,
# far longer than any copy takes.
#
# A refusal (a missing shared functions file, an unreadable or missing record, a version that
# cannot name a folder, an install folder with no keeper in it, an incomplete copy, a copy that
# fails) is one line in <LauncherRoot>\launcher.log and exit 1, since a keeper the fleet supervisor
# starts has no console. The fleet supervisor reads an exit inside 60 seconds of the start as a
# quick exit and starts the keeper again after its backoff delay (bin/Start-Fleet.ps1).
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

<#
.SYNOPSIS
Appends one timestamped line to launcher.log as UTF-8 without a byte-order mark.

.DESCRIPTION
A failed append goes to stderr, the only other channel the launcher has. The log is not rotated: it
takes one line per keeper start, so it grows by a few lines per boot.
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

if ([string]::IsNullOrWhiteSpace($Name)) {
    Stop-LauncherWithError '-Name is required.'
}
if ([string]::IsNullOrWhiteSpace($ConfigDir)) {
    $ConfigDir = $env:CLAUDE_CONFIG_DIR
    if ([string]::IsNullOrWhiteSpace($ConfigDir)) { $ConfigDir = Join-Path $env:USERPROFILE '.claude' }
}
$listPath = Join-Path (Join-Path $ConfigDir 'plugins') 'installed_plugins.json'

# Get-InstalledPluginRecord, Install-PluginSnapshot and Remove-StaleTempCopies live in the shared
# functions file registration copies beside this one.
$sharedFunctions = Join-Path $PSScriptRoot 'installed-plugin-functions.ps1'
if (-not (Test-Path -LiteralPath $sharedFunctions -PathType Leaf)) {
    Stop-LauncherWithError "$Name`: the shared functions file '$sharedFunctions' is missing; re-run the registration to install it"
}
. "$sharedFunctions"

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
