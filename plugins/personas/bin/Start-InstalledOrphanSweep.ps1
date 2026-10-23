# Runs the installed personas plugin's orphan sweeper. This is the script the KitOrphanSweep task
# runs when bin/Register-OrphanSweepTask.ps1 was run with -LauncherRoot, under Windows PowerShell 5.1:
#
#   powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File <LauncherRoot>\Start-InstalledOrphanSweep.ps1 -FindingsPath <path> -ConfigDir <folder>
#
# Registration copies this file and bin/installed-plugin-functions.ps1, which it dot-sources for the
# record lookup, into the launcher root, a folder outside the plugin cache, so the task's action
# names one path that no plugin update moves. At each fire the script reads the installed plugin's
# record from installed_plugins.json, checks that the version's bin folder holds orphan-sweep.ps1,
# orphan-sweep-functions.ps1 and orphan-sweep-allowlist.json, runs that orphan-sweep.ps1 with
# -FindingsPath, and exits with its exit code, so the task's last result is the sweep's.
#
# The sweeper runs from the folder the install record names, with no snapshot: a sweep takes
# seconds, so no update moves its files under it, and it reads the allowlist the installed version
# ships.
#
# A refusal (a missing shared functions file, an unreadable or missing record, a version folder
# missing a sweeper file) is one line in <LauncherRoot>\orphan-sweep-launcher.log and exit 1, since a
# scheduled task gives stderr no console and a silent 0 would read as a clean sweep. A fire that
# runs the sweeper writes no line here; the sweeper reports through its own exit code and files.
[CmdletBinding()]
param(
    # Handed to the sweeper as given; the sweeper refuses an empty one with exit 1.
    [string]$FindingsPath,
    # The installed plugin id whose sweeper runs. bin/Start-InstalledPersona.ps1 takes the same
    # default.
    [string]$PluginId = 'personas@applefeld',
    # The Claude Code configuration folder holding plugins\installed_plugins.json. CLAUDE_CONFIG_DIR
    # overrides it for Claude Code itself, so it overrides it here too.
    [string]$ConfigDir
)

$script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$script:LogPath = Join-Path $PSScriptRoot 'orphan-sweep-launcher.log'

# What the version's bin folder must hold: the sweeper loads the other two from its own folder.
$script:SweeperFiles = @('orphan-sweep.ps1', 'orphan-sweep-functions.ps1', 'orphan-sweep-allowlist.json')

<#
.SYNOPSIS
Appends one timestamped line to orphan-sweep-launcher.log as UTF-8 without a byte-order mark.

.DESCRIPTION
A failed append goes to stderr, the only other channel the launcher has. The log is not rotated: it
takes a line only on a refusal.
#>
function Write-LauncherLog {
    param([Parameter(Mandatory)][string]$Text)
    $stamp = [DateTime]::UtcNow.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    try {
        [System.IO.File]::AppendAllText($script:LogPath, "$stamp $Text" + [Environment]::NewLine, $script:Utf8NoBom)
    } catch {
        [Console]::Error.WriteLine("Start-InstalledOrphanSweep: could not append to '$script:LogPath': $($_.Exception.Message)")
    }
}

<#
.SYNOPSIS
Logs a refusal, writes it to stderr and exits 1.
#>
function Stop-LauncherWithError {
    param([Parameter(Mandatory)][string]$Text)
    Write-LauncherLog "ERROR $Text"
    [Console]::Error.WriteLine("Start-InstalledOrphanSweep: $Text")
    exit 1
}

# Get-InstalledPluginRecord lives in the shared functions file registration copies beside this one.
$sharedFunctions = Join-Path $PSScriptRoot 'installed-plugin-functions.ps1'
if (-not (Test-Path -LiteralPath $sharedFunctions -PathType Leaf)) {
    Stop-LauncherWithError "the shared functions file '$sharedFunctions' is missing; re-run the registration to install it"
}
. "$sharedFunctions"

if ([string]::IsNullOrWhiteSpace($ConfigDir)) {
    $ConfigDir = $env:CLAUDE_CONFIG_DIR
    if ([string]::IsNullOrWhiteSpace($ConfigDir)) { $ConfigDir = Join-Path $env:USERPROFILE '.claude' }
}
$listPath = Join-Path (Join-Path $ConfigDir 'plugins') 'installed_plugins.json'

try {
    $record = Get-InstalledPluginRecord -Path $listPath -Id $PluginId
} catch {
    Stop-LauncherWithError $_.Exception.Message
}
$binDir = Join-Path $record.InstallPath 'bin'
$missing = @($script:SweeperFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $binDir $_) -PathType Leaf) })
if ($missing.Count -gt 0) {
    Stop-LauncherWithError ("'$PluginId' $($record.Version) at '$($record.InstallPath)' is missing " +
        (($missing | ForEach-Object { "bin\$_" }) -join ', '))
}

$global:LASTEXITCODE = 0
& (Join-Path $binDir 'orphan-sweep.ps1') -FindingsPath $FindingsPath
exit $LASTEXITCODE
