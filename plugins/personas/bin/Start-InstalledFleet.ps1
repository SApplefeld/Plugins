# Runs the fleet supervisor from the installed personas plugin rather than from a repository
# checkout. This is the script the AgentFleet task runs when bin/Register-PersonaTasks.ps1 was run
# with -LauncherRoot, under Windows PowerShell 5.1:
#
#   powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File <LauncherRoot>\Start-InstalledFleet.ps1 [-Roster <path>] [-EnvFile <path>]
#
# Registration copies this file into the launcher root beside bin/Start-InstalledPersona.ps1 and
# bin/installed-plugin-functions.ps1, which this script dot-sources for the record lookup and the
# snapshot, so the task's action names one path that no plugin update moves.
#
# The launcher is a loop, and it ends only on a refusal, which the last paragraph states, or at the
# suite's -RestartLimit: a fleet supervisor that ends is followed by another start. Each pass reads
# the installed plugin's record from installed_plugins.json, takes that version's snapshot under
# <LauncherRoot>\runtime\<version> through Install-PluginSnapshot, the function the persona
# launcher takes its snapshot through, and writes one START line to
# <LauncherRoot>\fleet-launcher.log. It then starts the snapshot's bin\Start-Fleet.ps1 as a process
# of its own, under the engine this script runs under, with -Roster, -EnvFile and -KeeperLauncher
# naming <LauncherRoot>\Start-InstalledPersona.ps1. It waits for that one process, never for a
# keeper the process started, and reads its exit code. Exit 7 is the fleet supervisor's word that
# the plugin list names another build whose snapshot it has taken, and the launcher starts the next
# pass. On any other code the launcher starts the same fleet supervisor again, as the restart
# paragraph below states, unless the pass is a failed move. A fleet supervisor that exits 7 was
# given a version as -RunningVersion. Where the next pass reads the version it was given from the
# list, compared ignoring case, the two reads of the list disagree and a start that gives the
# version again would end the same way. That holds whether or not the pass can take that version's
# snapshot. The launcher then writes one NO-MOVE line naming the version and starts that fleet
# supervisor's snapshot again with none of the four values the next paragraph names. That fleet
# supervisor never exits 7, so no move happens until the task next starts.
#
# A fleet supervisor whose parameter block declares -PluginList, -PluginId, -RunningVersion and
# -RuntimeRoot is given those four as well: the list's path, the plugin's id, the version the pass
# read and the runtime folder. The block is read by parsing the script, which runs none of it. An
# older build's fleet supervisor declares none of the four, is given none and never exits 7.
#
# A fall-back is what the launcher does with a move that failed. A pass after the first fails where
# it cannot read the record, take the snapshot or find the fleet supervisor in it, and where its
# fleet supervisor ends inside -FailedMoveSeconds on any code but 7, unless the NO-MOVE rule takes
# the pass. The launcher then writes one FALLBACK line and starts the snapshot that ran before,
# with the failed version as -RunningVersion, so the older build stays until the list names yet
# another version. Where the failed pass read no version, the fall-back is given none of the four
# values. A fall-back that ends on any code but 7 is never a failed move, and neither is a start
# the NO-MOVE rule made, so each is restarted. -FailedMoveSeconds is 60 by default and no task
# passes it.
#
# A restart is what the launcher does with a fleet supervisor that ended on any code but 7, 0 among
# them, where the pass is no failed move. A fleet supervisor ends at 0 only where it found its
# launcher gone, so a 0 this loop reads is a wrong reading or a start that failed, and each leaves
# the machine with no fleet supervisor. The launcher writes one RESTART line naming the version,
# the code, the run time and the delay, waits the delay, writes the START line again and starts the
# same snapshot's fleet supervisor with the arguments the ended one had: the four values where it
# was given them, with the failed version as -RunningVersion on a fall-back, and none of the four
# on a start the NO-MOVE rule made. A restart reads no record and takes no snapshot. It is not a
# move, so the failed-move window never judges a start the restart rule made. The first restart
# waits 60 seconds. Each restart doubles the delay the next one waits, to at most 1800 seconds, and
# a fleet supervisor that ran 3600 seconds or more puts the delay back at 60. The delay is the
# launcher's for its whole life, across an exit 7 and a fall-back. Those are the numbers the fleet
# supervisor uses for a keeper that ends quickly. Stopping the task is the way to stop the chain:
# it ends the launcher, and the fleet supervisor then ends itself. -RestartLimit and
# -RestartDelayScale exist for the suite and no task passes either.
#
# Each keeper is started through the persona launcher rather than from this snapshot, so each keeper
# start takes its own snapshot and a plugin update reaches a persona at its keeper's next start. An
# update reaches the fleet supervisor within about one of its ticks. The loop is the copy of this
# file the task started, so the loop's own code changes at the task's next start.
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
# A refusal on the first pass (a missing shared functions file, an unreadable or missing record, a
# version that cannot name a folder, an incomplete copy, a copy that fails, a snapshot with no fleet
# supervisor) is one ERROR line in <LauncherRoot>\fleet-launcher.log, since a scheduled task gives
# stderr no console. So is a fall-back whose snapshot no longer holds the fleet supervisor. The
# launcher then ends at exit 1, and nothing starts it again until the task's trigger next fires.
[CmdletBinding()]
param(
    [string]$Roster = 'D:/personas/fleet.json',
    [string]$EnvFile = 'D:/personas/keeper.env',
    # Seconds from its start inside which a fleet supervisor started on a pass after the first is a
    # failed move where it ends on any code but 7. Exists so the suite can read both sides of the
    # window; a task never passes it.
    [ValidateRange(0, 3600)]
    [int]$FailedMoveSeconds = 60,
    # The most restarts the launcher makes of a fleet supervisor that ended, over the launcher's
    # whole life. The default, -1, is no limit. With 0 or more, the launcher ends at the fleet
    # supervisor's exit code once it has made that many. Exists so the suite can read the
    # launcher's end; a task never passes it.
    [int]$RestartLimit = -1,
    # Multiplies the wait before a restart and the run time that puts the delay back at its base.
    # The RESTART line still names the unscaled delay. Exists so the suite can walk the delay
    # ladder in seconds; a task never passes it. It is held from 0 to 1 as a binding error: a
    # negative scale would make Start-Sleep throw, and at 1 the longest wait, in milliseconds, still
    # fits the integer Start-Sleep takes.
    [ValidateRange(0.0, 1.0)]
    [double]$RestartDelayScale = 1.0
)

$script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$script:LogPath = Join-Path $PSScriptRoot 'fleet-launcher.log'

# The installed plugin id whose version the fleet supervisor runs, the default
# bin/Start-InstalledPersona.ps1 takes for each keeper.
$script:PluginId = 'personas@applefeld'

# The engine this script runs under, which is the one each fleet supervisor is started under, so
# the task's choice of Windows PowerShell 5.1 reaches the fleet supervisor and every keeper.
$script:PowerShellExe = (Get-Process -Id $PID).Path

# The parameters a fleet supervisor declares where it takes the launcher's four values.
$script:FleetValueParameters = @('PluginList', 'PluginId', 'RunningVersion', 'RuntimeRoot')

# The restart delay, in seconds. The first restart of a fleet supervisor that ended waits the base,
# each restart doubles the delay the next one waits up to the maximum, and a fleet supervisor that
# ran the reset uptime or longer puts the delay back at the base. They are the values
# keeper-functions.ps1 holds for a keeper that ends quickly, stated here because the launcher loads
# no file from a snapshot.
$script:RestartBaseDelaySeconds = 60
$script:RestartMaxDelaySeconds = 1800
$script:RestartResetUptimeSeconds = 3600

<#
.SYNOPSIS
Appends one timestamped line to fleet-launcher.log as UTF-8 without a byte-order mark.

.DESCRIPTION
A failed append goes to stderr, the only other channel the launcher has. The log is not rotated: it
takes one START line for each fleet supervisor the launcher starts, one FALLBACK line for each
fall-back, one NO-MOVE line for each move that goes nowhere and one RESTART line for each restart
of a fleet supervisor that ended, so it grows by a few lines per boot and per plugin update. Where
a fleet supervisor ends at once on every start, it grows by one RESTART line and one START line
each thirty minutes, about 100 lines a day.
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

<#
.SYNOPSIS
Says whether a fleet supervisor script declares all four of the launcher's value parameters.

.DESCRIPTION
The script is parsed and none of it runs. A script that does not parse, one with no parameter
block and one whose block lacks any of the four each answer no, so that fleet supervisor is started
with none of the four values. Names are compared ignoring case, as parameter binding compares them.
#>
function Test-FleetScriptTakesValues {
    param([Parameter(Mandatory)][string]$Path)
    $tokens = $null
    $errors = $null
    try {
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
    } catch {
        return $false
    }
    if ($null -eq $ast -or $null -eq $errors -or $errors.Count -gt 0 -or $null -eq $ast.ParamBlock) { return $false }
    $declared = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
    foreach ($name in $script:FleetValueParameters) {
        if ($declared -notcontains $name) { return $false }
    }
    return $true
}

<#
.SYNOPSIS
Reads the installed record and takes its snapshot for one pass; returns the fleet supervisor to start, or why none can be.

.DESCRIPTION
Returns a hashtable. Version, Scope, Snapshot and FleetScript name the fleet supervisor the pass
starts. Refusal is $null, or the reason the pass can start nothing, and Version is then $null where
the record itself did not read. The caller decides what a refusal costs: exit 1 on the first pass
and a fall-back on a later one.
#>
function Get-LauncherPass {
    $pass = @{ Version = $null; Scope = $null; Snapshot = $null; FleetScript = $null; Refusal = $null }
    try {
        $record = Get-InstalledPluginRecord -Path $script:ListPath -Id $script:PluginId
    } catch {
        $pass.Refusal = $_.Exception.Message
        return $pass
    }
    $pass.Version = $record.Version
    $pass.Scope = $record.Scope
    Remove-StaleTempCopies -RuntimeRoot $script:RuntimeRoot
    try {
        $pass.Snapshot = Install-PluginSnapshot -InstallPath $record.InstallPath -Version $record.Version -RuntimeRoot $script:RuntimeRoot
    } catch {
        $pass.Refusal = "snapshot of '$($record.InstallPath)' failed: $($_.Exception.Message)"
        return $pass
    }
    $pass.FleetScript = Join-Path $pass.Snapshot 'bin\Start-Fleet.ps1'
    if (-not (Test-Path -LiteralPath $pass.FleetScript -PathType Leaf)) {
        $pass.Refusal = "'$($script:PluginId)' $($record.Version) snapshot '$($pass.Snapshot)' holds no bin\Start-Fleet.ps1"
    }
    return $pass
}

<#
.SYNOPSIS
Logs one FALLBACK line for a failed move, or ends the launcher where the snapshot that ran before cannot be started.

.DESCRIPTION
Failed is the pass that failed and Cause says how: the exit code, or the refusal. Previous is the
pass whose fleet supervisor ran before it. Where Previous's snapshot no longer holds the fleet
supervisor, the launcher ends at exit 1 with one ERROR line. Otherwise the FALLBACK line names the
failed version, where the pass read one, the cause, and the version started in its place.
#>
function Write-LauncherFallback {
    param(
        [Parameter(Mandatory)][hashtable]$Failed,
        [Parameter(Mandatory)][hashtable]$Previous,
        [Parameter(Mandatory)][string]$Cause
    )
    $failedVersion = '(no version read)'
    if ($null -ne $Failed.Version) { $failedVersion = $Failed.Version }
    if (-not (Test-Path -LiteralPath $Previous.FleetScript -PathType Leaf)) {
        Stop-LauncherWithError "the move to $failedVersion failed ($Cause), and the snapshot that ran before, '$($Previous.Snapshot)', holds no bin\Start-Fleet.ps1 to fall back to"
    }
    Write-LauncherLog "FALLBACK $($script:PluginId) failed=$failedVersion $Cause; starting $($Previous.Version) from '$($Previous.Snapshot)' in its place"
}

$configDir = $env:CLAUDE_CONFIG_DIR
if ([string]::IsNullOrWhiteSpace($configDir)) { $configDir = Join-Path $env:USERPROFILE '.claude' }
$script:ListPath = Join-Path (Join-Path $configDir 'plugins') 'installed_plugins.json'
$script:RuntimeRoot = Join-Path $PSScriptRoot 'runtime'

# Get-InstalledPluginRecord, Install-PluginSnapshot and Remove-StaleTempCopies live in the shared
# functions file registration copies beside this one.
$sharedFunctions = Join-Path $PSScriptRoot 'installed-plugin-functions.ps1'
if (-not (Test-Path -LiteralPath $sharedFunctions -PathType Leaf)) {
    Stop-LauncherWithError "the shared functions file '$sharedFunctions' is missing; re-run the registration to install it"
}
. "$sharedFunctions"

$keeperLauncher = Join-Path $PSScriptRoot 'Start-InstalledPersona.ps1'

# $previous is the pass whose fleet supervisor last ended at exit 7, which is the one a fall-back
# starts again. $failed is the pass that failed, and holds a value only for the pass that is its
# fall-back, so one move falls back at most once. $given is the -RunningVersion the fleet
# supervisor last started was given, or $null where it was started with none of the four values.
# $noMove is true for the pass the NO-MOVE rule started, which the failed-move window never judges.
# $restartDelay is the seconds the next restart waits and $restarts the count of restarts made, and
# both are the launcher's for its whole life, so no pass sets either again.
$previous = $null
$failed = $null
$given = $null
$noMove = $false
$restartDelay = $script:RestartBaseDelaySeconds
$restarts = 0
while ($true) {
    $noMove = $false
    if ($null -ne $failed) {
        $pass = $previous
        $runningVersion = $failed.Version
    } else {
        $pass = Get-LauncherPass
        # A pass that reads the record after the first follows only an exit 7, and the fleet
        # supervisor that ended there ran from $previous's snapshot, on a fall-back as on any other
        # pass. The version compared is the one it was given, never its snapshot's, so a fall-back
        # that exits 7 because the list went back to its own version is given the four values. The
        # check comes before the refusal branch, so a pass refused after it read the version takes
        # the rule too; a pass that read no version compares unequal and takes the refusal branch.
        if ($null -ne $given -and $null -ne $pass.Version -and $pass.Version -ieq $given) {
            Write-LauncherLog "NO-MOVE $($script:PluginId) $given the fleet supervisor given this version ended at exit 7 and the plugin list still names it; no move happens until the task next starts"
            $pass = $previous
            $runningVersion = $null
            $noMove = $true
        } elseif ($null -ne $pass.Refusal) {
            if ($null -eq $previous) { Stop-LauncherWithError $pass.Refusal }
            Write-LauncherFallback -Failed $pass -Previous $previous -Cause "refused: $($pass.Refusal)"
            $failed = $pass
            continue
        } else {
            $runningVersion = $pass.Version
        }
    }

    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $pass.FleetScript, '-Roster', $Roster, '-EnvFile', $EnvFile, '-KeeperLauncher', $keeperLauncher)
    $given = $null
    if ($null -ne $runningVersion -and (Test-FleetScriptTakesValues -Path $pass.FleetScript)) {
        $arguments += @('-PluginList', $script:ListPath, '-PluginId', $script:PluginId, '-RunningVersion', $runningVersion, '-RuntimeRoot', $script:RuntimeRoot)
        $given = $runningVersion
    }

    # The pass's fleet supervisor is started here, and started again with the same arguments each
    # time it ends on a code the restart rule takes. The inner loop reads no record, takes no
    # snapshot and leaves $previous, $failed and $given as the pass set them. It ends at an exit 7
    # or at a failed move, each of which the outer loop takes from there. $restarted is true once
    # the restart rule has made a start in this pass, and the failed-move window judges only the
    # start before that.
    $restarted = $false
    $failedMove = $false
    while ($true) {
        Write-LauncherLog "START $($script:PluginId) $($pass.Version) scope=$($pass.Scope) $($pass.Snapshot) keeper=$keeperLauncher"

        # The call operator on an executable waits for that one process and for no process it
        # started, so a keeper that outlives the fleet supervisor does not hold the loop. That
        # holds only while the call's output stays uncaptured: piped or assigned, the call would
        # wait until every keeper holding the child's output closed it. It quotes each argument
        # that holds a space. Windows PowerShell 5.1 drops an empty argument and misquotes a spaced
        # one that ends in a backslash, and no argument here takes either form. The code is set to
        # 0 first, so a start that fails never reads as a 7 an earlier fleet supervisor left.
        $global:LASTEXITCODE = 0
        $clock = [System.Diagnostics.Stopwatch]::StartNew()
        & $script:PowerShellExe @arguments
        $code = $LASTEXITCODE
        $seconds = $clock.Elapsed.TotalSeconds
        $ran = $seconds.ToString('0.0', [System.Globalization.CultureInfo]::InvariantCulture)

        # A run of the reset uptime puts the delay back at the base, whatever code it ended on.
        if ($seconds -ge ($script:RestartResetUptimeSeconds * $RestartDelayScale)) { $restartDelay = $script:RestartBaseDelaySeconds }

        if ($code -eq 7) { break }
        if (-not $restarted -and $null -eq $failed -and -not $noMove -and $null -ne $previous -and $seconds -lt $FailedMoveSeconds) {
            $failedMove = $true
            break
        }
        if ($RestartLimit -ge 0 -and $restarts -ge $RestartLimit) { exit $code }

        Write-LauncherLog "RESTART $($script:PluginId) $($pass.Version) exit $code after $ran s; starting it again in $restartDelay s"
        Start-Sleep -Milliseconds ([int][Math]::Round($restartDelay * 1000 * $RestartDelayScale))
        $restartDelay = [Math]::Min($restartDelay * 2, $script:RestartMaxDelaySeconds)
        $restarts++
        $restarted = $true
    }

    if ($failedMove) {
        Write-LauncherFallback -Failed $pass -Previous $previous -Cause "exit $code after $ran s, inside the $FailedMoveSeconds s window"
        $failed = $pass
        continue
    }
    if ($null -eq $failed) { $previous = $pass }
    $failed = $null
}
