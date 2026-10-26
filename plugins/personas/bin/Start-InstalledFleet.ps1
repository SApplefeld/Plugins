# Runs the fleet supervisor from the installed personas plugin rather than from a repository
# checkout. This is the script the AgentFleet task runs when bin/Register-PersonaTasks.ps1 was run
# with -LauncherRoot, under Windows PowerShell 5.1:
#
#   powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File <LauncherRoot>\Start-InstalledFleet.ps1 [-Roster <path>] [-EnvFile <path>]
#
# Registration copies this file into the launcher root beside bin/Start-InstalledPersona.ps1 and
# bin/installed-plugin-functions.ps1, which this script dot-sources for the record lookup and the
# snapshot, so the task's action names one path that no plugin update moves. At each start the
# script reads the installed plugin's record from installed_plugins.json, takes that version's
# snapshot under <LauncherRoot>\runtime\<version> through Install-PluginSnapshot, the function the
# persona launcher takes its snapshot through, and runs the snapshot's bin\Start-Fleet.ps1 with
# -Roster, -EnvFile and -KeeperLauncher naming <LauncherRoot>\Start-InstalledPersona.ps1, exiting
# with its exit code.
#
# Each keeper is started through the persona launcher rather than from this snapshot, so each keeper
# start takes its own snapshot and a plugin update reaches a persona at its keeper's next start. The
# fleet supervisor itself keeps the version it started with until its task starts again.
#
# The fleet supervisor and the keepers it starts read installed_plugins.json for the one plugin id
# from the one configuration folder: this script takes no -PluginId or -ConfigDir, since the fleet
# supervisor passes neither to a keeper, so both follow the persona launcher's defaults,
# personas@applefeld under CLAUDE_CONFIG_DIR, else .claude under USERPROFILE.
#
# A snapshot already present is run as it stands, so one built from a version that ships no
# bin\Start-Fleet.ps1 is refused here rather than run. A new copy missing that file, or any other
# file $InstalledPluginRequiredFiles names, is refused as incomplete by Install-PluginSnapshot.
#
# A refusal (a missing shared functions file, an unreadable or missing record, a version that
# cannot name a folder, an incomplete copy, a copy that fails, a snapshot with no fleet supervisor)
# is one line in <LauncherRoot>\fleet-launcher.log and exit 1, since a scheduled task gives stderr no
# console. The task's restart-on-failure setting retries a 1 every minute, up to its restart count.
[CmdletBinding()]
param(
    [string]$Roster = 'D:/personas/fleet.json',
    [string]$EnvFile = 'D:/personas/keeper.env'
)

$script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$script:LogPath = Join-Path $PSScriptRoot 'fleet-launcher.log'

# The installed plugin id whose version the fleet supervisor runs, the default
# bin/Start-InstalledPersona.ps1 takes for each keeper.
$script:PluginId = 'personas@applefeld'

<#
.SYNOPSIS
Appends one timestamped line to fleet-launcher.log as UTF-8 without a byte-order mark.

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
        [Console]::Error.WriteLine("Start-InstalledFleet: could not append to '$script:LogPath': $($_.Exception.Message)")
    }
}

<#
.SYNOPSIS
Logs a refusal, writes it to stderr and exits 1.
#>
function Stop-LauncherWithError {
    param([Parameter(Mandatory)][string]$Text)
    Write-LauncherLog "ERROR $Text"
    [Console]::Error.WriteLine("Start-InstalledFleet: $Text")
    exit 1
}

$configDir = $env:CLAUDE_CONFIG_DIR
if ([string]::IsNullOrWhiteSpace($configDir)) { $configDir = Join-Path $env:USERPROFILE '.claude' }
$listPath = Join-Path (Join-Path $configDir 'plugins') 'installed_plugins.json'

# Get-InstalledPluginRecord, Install-PluginSnapshot and Remove-StaleTempCopies live in the shared
# functions file registration copies beside this one.
$sharedFunctions = Join-Path $PSScriptRoot 'installed-plugin-functions.ps1'
if (-not (Test-Path -LiteralPath $sharedFunctions -PathType Leaf)) {
    Stop-LauncherWithError "the shared functions file '$sharedFunctions' is missing; re-run the registration to install it"
}
. "$sharedFunctions"

try {
    $record = Get-InstalledPluginRecord -Path $listPath -Id $script:PluginId
} catch {
    Stop-LauncherWithError $_.Exception.Message
}
$runtimeRoot = Join-Path $PSScriptRoot 'runtime'
Remove-StaleTempCopies -RuntimeRoot $runtimeRoot
try {
    $snapshot = Install-PluginSnapshot -InstallPath $record.InstallPath -Version $record.Version -RuntimeRoot $runtimeRoot
} catch {
    Stop-LauncherWithError "snapshot of '$($record.InstallPath)' failed: $($_.Exception.Message)"
}
$fleetScript = Join-Path $snapshot 'bin\Start-Fleet.ps1'
if (-not (Test-Path -LiteralPath $fleetScript -PathType Leaf)) {
    Stop-LauncherWithError "'$($script:PluginId)' $($record.Version) snapshot '$snapshot' holds no bin\Start-Fleet.ps1"
}

$keeperLauncher = Join-Path $PSScriptRoot 'Start-InstalledPersona.ps1'
Write-LauncherLog "START $($script:PluginId) $($record.Version) scope=$($record.Scope) $snapshot keeper=$keeperLauncher"
$global:LASTEXITCODE = 0
& $fleetScript -Roster $Roster -EnvFile $EnvFile -KeeperLauncher $keeperLauncher
exit $LASTEXITCODE
