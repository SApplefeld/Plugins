# Runs one persona's supervisor under the process keeper's exit-code policy. This is the script
# the fleet supervisor, bin/Start-Fleet.ps1, starts once per enabled roster entry and starts again
# when it finds no keeper live for the entry, under Windows PowerShell 5.1:
#
#   powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File bin\Start-Persona.ps1 -Name <n> [-Roster <path>] [-EnvFile <path>] [-Release]
#
# The wrapper reads the persona's roster entry, applies the env file's allowlisted keys to its own
# process, launches bin/supervise.sh through the bash the env file names, and loops on
# Get-KeeperDecision (bin/keeper-functions.ps1) over the supervisor's exit code: relaunch after a
# delay, hold, park, hand off, or exit. Exit -1 is a termination with no signal (Stop-Process and
# Process.Kill leave it where taskkill /F leaves 1): it relaunches after the base delay with the
# ladder untouched. The wrapper leaves that code itself: while it waits on a supervisor, launched or
# adopted, it reads the last write time of the run directory's supervisor.log, and once it has seen
# that time unchanged for more than -SilenceBoundSeconds, 900 by default, with the supervisor still
# alive, it ends the interpreter running the supervisor script, then the supervisor it waits on,
# then the stuck processes of the supervisor's family (SILENCE in keeper.log). It spares the child
# and the stdin holder the newest handle.json names, the run then reads as exit -1, and the DECIDE
# reason names the silence. An attempt that cannot read the family, that cannot tell whether a
# process under the supervisor is the interpreter, or that leaves the interpreter running, ends
# nothing more and leaves the supervisor running, and the next attempt comes once the log has been
# silent for the bound again. So an interpreter that can never be ended or told, or a process list
# that never reads, leaves the supervisor silent until a person acts.
# Exit 7 is a requested restart. A supervisor this wrapper launches ends its run
# on one, because the wrapper sets SUPERVISOR_RESTART_EXITS=1 for it, and the wrapper then hands the
# persona off: it exits and writes no marker, so the fleet supervisor's next tick starts the persona
# again through its launcher, with the roster and the env file read afresh. It hands off only where
# a fleet supervisor serving its roster is live, the roster still names the entry once and enabled,
# with the workdir a keeper needs to launch, and neither a hold marker nor a boot marker that can
# name this boot stands in the run directory, since the fleet supervisor leaves an entry down beside
# either. Where any of the four is not so, nothing would start the persona again, so it logs
# HANDOFF not taken with the reason and launches the supervisor again at once.
# Before each launch it looks for a supervisor already running for the
# persona, and where it finds one it waits on that one instead of launching (ADOPT in keeper.log).
# State the operator can read lives under the entry's run directory:
# keeper.log (one line per event, rotated at 5 MB keeping keeper.log.1), keeper.json (the last
# run's facts), supervisor.out (the supervisor's own stdout and stderr, appended per launched run),
# keeper.hold (present while the persona is held; -Release removes it), keeper.park (present
# while the persona is parked; a start of a later boot removes it, logs UNPARK and launches, and
# -Release removes it too) and keeper.boot (the machine's boot time at the moment the policy parked
# the persona or the supervisor was signalled out; -Release removes it too). The fleet supervisor
# starts an exited keeper again on its next tick, so a start that finds keeper.boot within a minute of the
# current boot time logs BOOTED and launches nothing, which leaves a persona stopped by policy this
# boot down until the next boot or an operator's -Release. A launch, a relaunch and a fault write no
# keeper.boot, so a repeated start after a wrapper that was killed finds a supervisor to ADOPT. A hold
# marker outranks both: a start that finds a hold logs HOLD, leaves every marker in place and
# launches nothing. A refusal that happens before the roster has named a run directory goes to
# keeper-refused.log beside the roster file, the only place known at that point, because a
# scheduled task has no console for stderr to reach.
#
# Exit codes of the wrapper itself: 0 when the policy said hold, park or exit, or when the wrapper
# handed the persona off, or when -Release ran, or when a hold marker was already present, or when
# the boot marker already named this boot (BOOTED); 1 on a fault of the wrapper's own (an unknown
# flag, a roster or env file that cannot be read, a supervisor that cannot be launched). The fleet
# supervisor's quick-exit backoff is the backstop for the 1s.
#
# [CmdletBinding()] is what makes an unknown switch a binding error (exit 1) rather than a value
# that lands in $args while the body runs anyway.
[CmdletBinding()]
param(
    # Required. Checked in the body rather than marked Mandatory, because a Mandatory parameter
    # left off the command line opens an interactive prompt, and under a scheduled task there is
    # no console to answer it, so the run would hang rather than fail.
    [string]$Name,
    [string]$Roster = 'D:/personas/fleet.json',
    [string]$EnvFile = 'D:/personas/keeper.env',
    # Removes the hold, park and boot markers and exits without launching.
    [switch]$Release,
    # Multiplies every sleep between relaunches. The DECIDE line still records the unscaled delay.
    # Exists so the unit test can walk the doubling ladder in seconds; a task never passes it. A
    # negative scale would make Start-Sleep throw and end the loop at the first relaunch, so it is
    # a binding error instead.
    [ValidateRange(0, [double]::MaxValue)]
    [double]$DelayScale = 1.0,
    # How many seconds a live supervisor's log may go without a write before the wrapper ends the
    # supervisor and launches it again. It carries no default here: the default is a constant of
    # keeper-functions.ps1, which exists only once that file is dot-sourced below, so the body sets
    # it there. Exists so the unit test can reach the bound in seconds; a task never passes it.
    [ValidateRange(1, [int]::MaxValue)]
    [int]$SilenceBoundSeconds,
    # The four facts a hand-off is decided from. read, the default, reads the first from the
    # machine's process list and the second from the roster. It reads the third from the boot time
    # this keeper read at its start, and checks for keeper.boot only where that read failed. It reads
    # the fourth with one check for keeper.hold. true and false fix the fact with no read. They exist
    # so the unit test decides a hand-off without this machine's fleet supervisor or its boot time; a
    # task never passes them.
    [ValidateSet('read', 'true', 'false')]
    [string]$FleetSupervisorLive = 'read',
    [ValidateSet('read', 'true', 'false')]
    [string]$RosterEnabled = 'read',
    [ValidateSet('read', 'true', 'false')]
    [string]$BootMarkerClear = 'read',
    [ValidateSet('read', 'true', 'false')]
    [string]$HoldClear = 'read'
)

. (Join-Path $PSScriptRoot 'keeper-functions.ps1')

if (-not $PSBoundParameters.ContainsKey('SilenceBoundSeconds')) { $SilenceBoundSeconds = $script:KeeperSilenceBoundSeconds }

$script:LogCapBytes = 5MB
$script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$script:LogPath = $null

# How long one wait on the launched supervisor blocks before it is renewed. It bounds nothing: the
# wait returns the moment the process exits, and the renewal only exists so that a supervisor
# running longer than this never ends the wait.
$script:ExitWaitMilliseconds = 1000

# The most one wait step adds to a supervisor's quiet count, however long the step took. An ordinary
# step takes ExitWaitMilliseconds, so a step far longer is time the machine spent suspended or
# paused, which is not taken as the supervisor's silence (Add-KeeperQuietSeconds in
# bin/keeper-functions.ps1).
$script:QuietStepCapSeconds = 5

# How far apart two reads of one process's Win32_Process record may place its start time while
# still naming the same process: a live supervisor the keeper adopts or watches, and each process of
# a silent supervisor's family the keeper is about to end. Both reads convert the same kernel value
# the same way, so a gap past this means the id now belongs to another process.
$script:AdoptStartToleranceSeconds = 2

# How often the process record of a live supervisor whose handle could not be opened is read again,
# to learn when it has gone.
$script:AdoptWatchSeconds = 10

# What every capture file of this wrapper carries in its name: the process id, and the moment the
# process started. Windows hands a process id out again once the process holding it is gone, so a
# name built from the id alone can be the name a survivor of an earlier wrapper is still writing
# into, and Start-Process opens a redirect target by truncating it. The start time distinguishes
# this incarnation from any other that ever held the same id, across a reboot included.
$script:CaptureId = "$PID-" + [System.Diagnostics.Process]::GetCurrentProcess().StartTime.ToString('yyyyMMddHHmmssfff', [System.Globalization.CultureInfo]::InvariantCulture)

# How much of a capture file's tail is read to find the supervisor's last stderr line. The line sits
# at the end of the file, so reading the end of it costs a launch that wrote megabytes a buffer
# rather than the whole capture as one string.
$script:CaptureTailBytes = 64KB

<#
.SYNOPSIS
Appends one timestamped line to a keeper log as UTF-8 without a byte-order mark, rotating first.

.DESCRIPTION
Without -Path the line goes to the run directory's keeper.log, which is unknown until the roster
has been read; a line written before then and without a path is dropped. A refusal raised before
that point names the fallback log beside the roster file instead, so the operator has something to
read where a scheduled task gives stderr no console.

The cap check runs immediately before the append so a line lands in the live generation rather
than in the one about to be renamed away. Rotation renames the log to <name>.1, replacing the
previous one; it never truncates in place. A rotation that fails is written into the log as it
stands and stepped over, since the condition that stopped the rename outlives this run and raising
would leave the persona unlaunched over a log file. A failed append goes to stderr, the only other
channel the wrapper has.
#>
function Write-KeeperLog {
    param([Parameter(Mandatory)][string]$Text, [string]$Path)
    if ([string]::IsNullOrEmpty($Path)) { $Path = $script:LogPath }
    if ([string]::IsNullOrEmpty($Path)) { return }
    $stamp = [DateTime]::UtcNow.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    try {
        if ((Test-Path -LiteralPath $Path) -and (Get-Item -LiteralPath $Path).Length -gt $script:LogCapBytes) {
            Move-Item -Force -LiteralPath $Path -Destination "$Path.1" -ErrorAction Stop
        }
    } catch {
        try {
            [System.IO.File]::AppendAllText($Path, "$stamp ROTATE failed: $($_.Exception.Message)" + [Environment]::NewLine, $script:Utf8NoBom)
        } catch { }
    }
    try {
        [System.IO.File]::AppendAllText($Path, "$stamp $Text" + [Environment]::NewLine, $script:Utf8NoBom)
    } catch {
        [Console]::Error.WriteLine("Start-Persona: could not append to '$Path': $($_.Exception.Message)")
    }
}

<#
.SYNOPSIS
Reports a fault of the wrapper's own on stderr and in the log, then exits 1.
#>
function Stop-KeeperWithError {
    param([Parameter(Mandatory)][string]$Text)
    Write-KeeperLog "ERROR $Text"
    [Console]::Error.WriteLine("Start-Persona: $Text")
    exit 1
}

<#
.SYNOPSIS
Applies the env file's allowlisted keys to this process and returns the bash executable it names.

.DESCRIPTION
Each key: outside the allowlist it is named on the ENV ignored: line and not applied; empty or
whitespace-only it is named on an ENV empty: line and not applied, because Set-Item on env: with an
empty value removes the variable under Windows PowerShell 5.1 and keeps it under pwsh 7; a key that
appears twice takes the last value and is named on an ENV duplicate: line; a value written inside a
matching pair of quotes loses them and is named on an ENV unquoted: line, since the quotes would
otherwise be part of the file name or the path.
KEEPER_BASH_EXE is returned rather than exported and KEEPER_PATH_PREPEND is prepended to PATH.
Returns $null when the file names no bash executable.
#>
function Set-KeeperEnvironment {
    param([Parameter(Mandatory)][string]$Path)
    try {
        $read = Read-KeeperEnvFile -Path $Path
    } catch {
        Stop-KeeperWithError "env file '$Path' could not be read: $($_.Exception.Message)"
    }
    foreach ($dup in $read.Duplicates) { Write-KeeperLog "ENV duplicate: $dup" }
    foreach ($key in $read.Unquoted) { Write-KeeperLog "ENV unquoted: $key" }
    $ignored = New-Object System.Collections.Generic.List[string]
    $bashExe = $null
    foreach ($key in $read.Values.Keys) {
        if ($script:KeeperEnvAllowlist -notcontains $key) {
            $ignored.Add($key)
            continue
        }
        $value = [string]$read.Values[$key]
        if ([string]::IsNullOrWhiteSpace($value)) {
            Write-KeeperLog "ENV empty: $key"
            continue
        }
        switch ($key) {
            'KEEPER_BASH_EXE' { $bashExe = $value }
            'KEEPER_PATH_PREPEND' {
                $delivered = [Environment]::GetEnvironmentVariable('PATH', 'Process')
                if ([string]::IsNullOrEmpty($delivered)) { $env:PATH = $value } else { $env:PATH = $value + ';' + $delivered }
            }
            default {
                try {
                    Set-Item -Path "env:$key" -Value $value -ErrorAction Stop
                } catch {
                    Write-KeeperLog "ENV failed: $key $($_.Exception.Message)"
                }
            }
        }
    }
    if ($ignored.Count -gt 0) { Write-KeeperLog "ENV ignored: $($ignored -join ';')" }
    return $bashExe
}

<#
.SYNOPSIS
Appends one capture file to supervisor.out while another process may still be writing to it.

.DESCRIPTION
A descendant that outlives the supervisor holds the write end of the file it inherited, and an
ordinary read asks for a share mode such a writer's handle refuses. The source is opened permitting
a concurrent writer and a concurrent delete, so the copy takes what the file holds at the moment it
runs. The bytes go through a buffer rather than through one string, so a supervisor that wrote a
great deal costs the wrapper the buffer and not the whole launch's output. Copying the bytes also
keeps whatever the supervisor wrote exactly as it wrote it, which for bash and node programs is
UTF-8 whatever the console code page says.
#>
function Copy-KeeperCaptureFile {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Destination)
    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $source = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
    try {
        $target = [System.IO.File]::Open($Destination, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
        try { $source.CopyTo($target) } finally { $target.Dispose() }
    } finally { $source.Dispose() }
}

<#
.SYNOPSIS
Returns the last non-blank line of a capture file, reading only its tail.

.DESCRIPTION
The file is opened the way Copy-KeeperCaptureFile opens it, so a descendant still holding the write
end does not refuse the read. Only the last $script:CaptureTailBytes are read, since the line being
looked for is the last one. A read that starts inside the file lands in the middle of a line and of
a UTF-8 sequence, so the first line of such a read is dropped: the line before it is whole, and one
of those is what the marker names.
#>
function Get-KeeperCaptureLastLine {
    param([Parameter(Mandatory)][string]$Path)
    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
    $partial = $false
    try {
        if ($stream.Length -gt $script:CaptureTailBytes) {
            [void]$stream.Seek(-$script:CaptureTailBytes, [System.IO.SeekOrigin]::End)
            $partial = $true
        }
        $reader = New-Object System.IO.StreamReader($stream, $script:Utf8NoBom)
        try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
    $lines = @($text -split "`r?`n")
    if ($partial -and $lines.Count -gt 1) { $lines = $lines[1..($lines.Count - 1)] }
    $last = ''
    foreach ($line in $lines) {
        if (-not [string]::IsNullOrWhiteSpace($line)) { $last = $line.Trim() }
    }
    return $last
}

<#
.SYNOPSIS
Removes the capture files this wrapper's own earlier launches left behind in the run directory.

.DESCRIPTION
A launch whose supervisor left a descendant behind cannot remove its own two capture files, because
that descendant still holds the handle it inherited and Windows refuses to delete a file opened
without delete sharing. Each later launch of this wrapper takes the ones that have since come free,
so the run directory carries a stale pair only while a survivor of that launch is alive.

Only names carrying this wrapper's own capture id are taken. Another wrapper's pair is deletable in
the window between its supervisor exiting and that wrapper appending the pair to supervisor.out,
which is a window nothing outside that wrapper can see, so a sweep by name shape alone would take a
run's captured output out from under a live peer and leave it logging a capture it could not read.
A pair an earlier incarnation of this wrapper left behind is outside this sweep for that same
reason and stays in the run directory.
#>
function Remove-KeeperCaptureLeftovers {
    param([Parameter(Mandatory)][string]$OutputPath)
    $leaf = Split-Path -Leaf $OutputPath
    try {
        $stale = @(Get-ChildItem -LiteralPath (Split-Path -Parent $OutputPath) -File -ErrorAction Stop |
            Where-Object { $_.Name -like "$leaf.$script:CaptureId.*.stdout" -or $_.Name -like "$leaf.$script:CaptureId.*.stderr" })
    } catch {
        return
    }
    foreach ($file in $stale) {
        try { Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop } catch { }
    }
}

<#
.SYNOPSIS
Runs the supervisor once, appends its output to supervisor.out, and returns its exit code, uptime and last stderr line.

.DESCRIPTION
The supervisor's stdout and stderr are redirected to two files of this launch's own, and the wait is
on the launched process alone: Start-Process returns as soon as the process is started when it is
not given -Wait, and WaitForExit with a timeout returns the moment that one process exits. -Wait
waits for every descendant instead, and a supervisor that exits 5 has left one by definition, so the
wrapper would not see that exit until the survivor died and would then count the survivor's life as
the supervisor's uptime.

The process's handle is read as the next statement after the start, because the exit code is
readable afterwards only where the first read of the handle happened while the process was still
alive. A supervisor that exits inside that gap, which is the time one statement takes against a
process that has still to load its image, reports no exit code, and the caller treats that as a
wrapper fault rather than feeding it to the policy.

The two streams are captured separately because the hold marker names the supervisor's last stderr
line, which is knowable only from a stream carrying stderr alone. Both files are appended to
supervisor.out, stdout first, and then removed, so the record the operator reads is one file per run
directory. Each name carries this wrapper's capture id and this launch's number: a descendant that
outlives the supervisor keeps writing into the file handle it inherited, and a name no later launch
and no other wrapper reuses is what keeps that writing out of the next launch's capture and makes
the file it holds open safe to leave until a later launch can remove it. A launch that cannot start
is a wrapper fault and ends the run.

The wait is Wait-KeeperWatchedSupervisor's, which ends a supervisor whose log at LogPath has been
silent for more than SilenceBoundSeconds. SilenceSeconds in the returned hashtable is how long the
log had been silent where that happened, and 0 otherwise. ExitCode is then -1, the code such an end
leaves, whatever the process reports: a launcher that exited by itself once its interpreter was
ended reports a code of its own.
#>
function Invoke-Supervisor {
    param(
        [Parameter(Mandatory)][string]$BashExe,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$OutputPath,
        [Parameter(Mandatory)][int]$Launch,
        [Parameter(Mandatory)][string]$LogPath,
        [Parameter(Mandatory)][int]$SilenceBoundSeconds
    )
    Remove-KeeperCaptureLeftovers -OutputPath $OutputPath
    $stdoutPath = "$OutputPath.$script:CaptureId.$Launch.stdout"
    $stderrPath = "$OutputPath.$script:CaptureId.$Launch.stderr"
    # One command line, each argument quoted the way CreateProcess parsing expects
    # (ConvertTo-NativeArgument in bin/keeper-functions.ps1).
    $native = @($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ })
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $process = Start-Process -FilePath $BashExe -ArgumentList $native -WorkingDirectory $WorkingDirectory `
            -PassThru -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -ErrorAction Stop
        $null = $process.Handle
    } catch {
        Stop-KeeperWithError "launch failed: '$BashExe' $($Arguments -join ' '): $($_.Exception.Message)"
    }
    $silence = Wait-KeeperWatchedSupervisor -Process $process -Arguments $Arguments -LogPath $LogPath -SilenceBoundSeconds $SilenceBoundSeconds
    $stopwatch.Stop()
    $exitCode = $process.ExitCode
    if ($silence -gt 0) { $exitCode = -1 }
    $process.Dispose()

    $lastError = ''
    foreach ($path in @($stdoutPath, $stderrPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        try {
            Copy-KeeperCaptureFile -Path $path -Destination $OutputPath
            if ($path -eq $stderrPath) { $lastError = Get-KeeperCaptureLastLine -Path $path }
        } catch {
            # The output copy is not what the persona is for, so a run whose capture could not be
            # read or appended is recorded and carries on.
            Write-KeeperLog "CAPTURE failed: '$path' $($_.Exception.Message)"
            continue
        }
        try {
            Remove-Item -LiteralPath $path -Force -ErrorAction Stop
        } catch {
            Write-KeeperLog "CAPTURE held: '$path' $($_.Exception.Message)"
        }
    }

    return @{
        ExitCode = $exitCode
        UptimeSeconds = [int][Math]::Floor($stopwatch.Elapsed.TotalSeconds)
        LastErrorLine = $lastError
        SilenceSeconds = $silence
    }
}

<#
.SYNOPSIS
Waits for a supervisor to exit, and ends it with the stuck processes of its family once its log has been silent past the bound.

.DESCRIPTION
The wait is on Process alone and is renewed every ExitWaitMilliseconds, as a supervisor may run for
days. A supervisor can stay alive and stop working, and its exit is then never seen, so each renewal
reads the last write time of the supervisor's log at LogPath. A healthy supervisor writes there
about once a minute. The wrapper counts how long the log has been quiet. The count starts at 0 with
the wait and goes back to 0 whenever the write time reads differently from the read before, so it
measures from the last change of that time the wrapper saw, or from the wait's start where it saw
none. A log not yet created reads as one fixed time until it is. Each renewal adds the time it took,
measured on a Stopwatch and capped at QuietStepCapSeconds by Add-KeeperQuietSeconds
(bin/keeper-functions.ps1), so a wall clock set forward adds nothing and a suspended machine adds
one capped renewal. Test-KeeperSupervisorSilent judges the count in whole seconds against
SilenceBoundSeconds, and that whole count is the one the SILENCE line and SilenceSeconds carry. A
read of the log's time that fails gives no verdict for that renewal, since ending a supervisor on a
time nobody read could end a healthy one.

On silence Stop-KeeperSilentSupervisor runs. Where it ended the supervisor, the wait goes on with no
further watch until the process has exited. Where it did not, one of two things holds. The
supervisor had exited by itself with no interpreter ended, and the wait then ends on that exit with
no silence to return. Or the attempt left the supervisor running, since the wait on Process is the
only thing that brings a later attempt. With the supervisor left running, the watch goes on with
the quiet count back at 0 and counts from the end of the attempt, so the next attempt comes only
once the log has been silent for the whole bound again, and a log that moved in between cancels it,
as for any supervisor. Nothing but the bound paces the attempts. So an interpreter that can never
be ended or told, or a process list that never reads, leaves the supervisor silent, with one
attempt's lines in keeper.log per bound, until a person acts.

Returns the seconds the log had been silent where this wrapper ended the supervisor, and 0 where the
process exited with no such end.
#>
function Wait-KeeperWatchedSupervisor {
    param(
        [Parameter(Mandatory)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$LogPath,
        [Parameter(Mandatory)][int]$SilenceBoundSeconds
    )
    $silence = 0
    $watching = $true
    $count = 0.0
    $lastWrite = $null
    $step = [System.Diagnostics.Stopwatch]::StartNew()
    while (-not $Process.WaitForExit($script:ExitWaitMilliseconds)) {
        if (-not $watching) { continue }
        $count = Add-KeeperQuietSeconds -QuietSeconds $count -StepSeconds $step.Elapsed.TotalSeconds -StepCapSeconds $script:QuietStepCapSeconds
        $step.Restart()
        try {
            $write = [System.IO.File]::GetLastWriteTimeUtc($LogPath)
        } catch {
            continue
        }
        if ($null -ne $lastWrite -and $write -ne $lastWrite) { $count = 0.0 }
        $lastWrite = $write
        $quiet = [int][Math]::Floor($count)
        if (-not (Test-KeeperSupervisorSilent -QuietSeconds $quiet -BoundSeconds $SilenceBoundSeconds)) { continue }
        if (Stop-KeeperSilentSupervisor -Process $Process -Arguments $Arguments -LogPath $LogPath -QuietSeconds $quiet -SilenceBoundSeconds $SilenceBoundSeconds) {
            $watching = $false
            $silence = $quiet
        } else {
            $count = 0.0
            $step.Restart()
        }
    }
    return $silence
}

<#
.SYNOPSIS
Ends a silent supervisor's interpreter, then the supervisor, then the stuck forks of its family, and says whether the supervisor was ended.

.DESCRIPTION
The supervisor is ended after its interpreter, and an attempt that cannot finish ends nothing more and leaves it
running. The caller waits on Process, the launcher, and on nothing else, so a launcher ended above a
running interpreter would leave that interpreter with no later attempt, and the supervisor launched
next would hold at its pre-launch gate for as long as the interpreter lived.

One SILENCE line names the process, the log, how long it has been quiet and the bound. The newest
child handle under the log's directory and the machine's process list are then read once, before
anything is ended, so the records are one moment of the family. Select-KeeperSupervisorFamily
(bin/keeper-functions.ps1) picks from the records: the interpreter running the supervisor script,
which is the family record under the launcher, and the forks with nothing under them. It leaves out
the persona's child and its stdin holder, which the handle names, and everything under them, so the
supervisor launched next finds the child alive and adopts it. Only the handle's child id and start
ticks tell the child's pipeline stage from a stuck fork, and only a handle the interpreter wrote
names this supervisor's child. So the start ticks of the processes the handle names as the child and
as its writer are read now, by Read-KeeperProcessStartTicks, beside the list and before anything is
ended. Where no handle is read, the child it names is not in the family with the start it records,
or its writer is not the interpreter with the start it records, the interpreter alone is picked. A
run directory that holds no handle is a supervisor with no child recorded, and the interpreter is
then picked alone too. A fork whose parent chain in the list does not reach the interpreter, such as
a stage an earlier supervisor of the persona left, is never picked. No handle value picks a record.

Where a read fails, the attempt ends there with one SILENCE scan failed line and nothing ended, the
launcher included: a run directory whose handles cannot be listed, a process list that cannot be
read, a list holding no record with a start time for the launcher, without which no interpreter can
be told, and a selection that fails. So does a record of the same list whose parent is the
launcher and which carries no command line or no start time. The selection matches on both, so it
picks no such record, and the record may be the interpreter. A doubt counts as still running: each
such record is one SILENCE left line, and the attempt ends with nothing ended. A record under the
launcher that carries both, such as a console host, is no doubt. Neither is a record whose start
time is earlier than the launcher's, whatever else it lacks: its parent link names a process that
has gone, whose id the launcher now holds, so it is not under the launcher, as
Select-KeeperSupervisorFamily reads the same link.

The picked records are then ended in this order:

  interpreter  each picked record under the launcher, by Stop-KeeperFamilyMember. One it leaves is
               read by id with Test-KeeperProcessRunning. Where that read finds a running process,
               or cannot tell, the attempt ends there with nothing more ended. One that has gone is
               passed over.
  launcher     Process, through the handle the wrapper already holds, which is what keeps its id
               from naming another process. One that has already exited is not asked to end, since
               whether ending an exited process is refused depends on the engine. One whose end is
               refused may be on its way out, so it is waited on for two seconds. One still running
               then ends the attempt there. One that has exited, before the end or within that
               wait, counts as ended only where this attempt ended an interpreter, since Git's
               launcher may exit by itself once its interpreter is gone. With no interpreter ended,
               the supervisor exited by itself, as on a requested restart: the attempt ends there,
               and the run keeps the supervisor's own exit code.
  forks        every other picked record, by Stop-KeeperFamilyMember, each ended or left by itself.

Each process ended is one SILENCE killed line. Each one not ended is one SILENCE left line with the
reason, which says so where the attempt ends there. In an attempt that finishes, a stuck fork the
selection leaves is one SILENCE left line giving the reason the selection returns for it: it is not
under this supervisor's interpreter, the child is not known, or the handle is not this supervisor's.
It is not ended, since the child's pipeline stage has a stuck fork's shape. An attempt that ends
early writes no line for such a fork. A family record the selection neither picks nor leaves gets no
line: a record the handle's holder or child id names, and every record under one, and a record with
something under it that is not the interpreter. Nothing here throws.

Returns $true where the launcher was ended, or had exited after this attempt ended an interpreter,
which is the supervisor ended by this wrapper. Returns $false where the attempt ended early: the
launcher is left running, for the caller to try again, or exited by itself.
#>
function Stop-KeeperSilentSupervisor {
    param(
        [Parameter(Mandatory)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$LogPath,
        [Parameter(Mandatory)][int]$QuietSeconds,
        [Parameter(Mandatory)][int]$SilenceBoundSeconds
    )
    $launcherId = $Process.Id
    $again = 'tries again once the log has been silent for the bound again'
    Write-KeeperLog "SILENCE pid=$launcherId log='$LogPath' quiet=$QuietSeconds bound=${SilenceBoundSeconds}: the supervisor is alive and its log has not moved, so the keeper ends it and the stuck processes of its family"
    $named = @{ HolderId = ''; ChildId = ''; ChildTicks = ''; ChildLiveTicks = ''; SupervisorId = ''; SupervisorTicks = ''; SupervisorLiveTicks = '' }
    $family = $null
    try {
        $handle = Read-KeeperNewestHandle -RunDirectory (Split-Path -Parent $LogPath)
        if ($null -ne $handle) {
            $named.HolderId = [string]$handle.holderWinPid
            $named.ChildId = [string]$handle.childWinPid
            $named.ChildTicks = [string]$handle.childTicks
            $named.SupervisorId = [string]$handle.supervisorWinPid
            $named.SupervisorTicks = [string]$handle.supervisorTicks
            $named.ChildLiveTicks = Read-KeeperProcessStartTicks -ProcessId $named.ChildId
            $named.SupervisorLiveTicks = Read-KeeperProcessStartTicks -ProcessId $named.SupervisorId
        }
        $processes = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CommandLine, CreationDate, Name -OperationTimeoutSec 30 -ErrorAction Stop)
        $launcherStarted = $null
        foreach ($record in $processes) {
            if ($null -eq $record -or [string]$record.ProcessId -ne [string]$launcherId) { continue }
            $launcherStarted = $record.CreationDate
            break
        }
        if ($null -eq $launcherStarted) { throw 'the process list holds no record with a start time for the supervisor' }
        $family = Select-KeeperSupervisorFamily -Processes $processes -Arguments $Arguments -LauncherId $launcherId @named
    } catch {
        Write-KeeperLog "SILENCE scan failed: $($_.Exception.Message), so the keeper ends no process, the supervisor pid=$launcherId included, and $again"
        return $false
    }

    # A picked record under the launcher is an interpreter and every other one is a stuck fork: the
    # selection picks a fork only where its parent chain reaches an interpreter, and a record whose
    # parent is the launcher has no interpreter above it.
    $interpreters = @($family.Selected | Where-Object { [string]$_.ParentProcessId -eq [string]$launcherId })
    $forks = @($family.Selected | Where-Object { [string]$_.ParentProcessId -ne [string]$launcherId })

    # A record under the launcher with no command line or no start time may be the interpreter. The
    # selection picks a record only where it carries both. Such a record is a read the keeper cannot
    # trust, so it is checked before anything is ended, and the attempt then ends nothing. A record
    # that started before the launcher is not under it and is passed over, as the selection passes
    # it over: its parent link names a process that has gone, whose id the launcher now holds.
    $untold = $false
    $launcherUtc = ([DateTime]$launcherStarted).ToUniversalTime()
    foreach ($record in $processes) {
        if ($null -eq $record -or [string]$record.ParentProcessId -ne [string]$launcherId) { continue }
        if ($null -ne $record.CreationDate -and ([DateTime]$record.CreationDate).ToUniversalTime() -lt $launcherUtc) { continue }
        if (-not [string]::IsNullOrWhiteSpace([string]$record.CommandLine) -and $null -ne $record.CreationDate) { continue }
        Write-KeeperLog "SILENCE left pid=$($record.ProcessId) name=$($record.Name): its process record carries no command line or no start time, so the keeper could not tell whether it is the interpreter, ends nothing, leaves the supervisor pid=$launcherId running and $again"
        $untold = $true
    }
    if ($untold) { return $false }

    $endedInterpreter = $false
    foreach ($record in $interpreters) {
        $reason = Stop-KeeperFamilyMember -Record $record
        if ($null -eq $reason) {
            Write-KeeperLog "SILENCE killed pid=$($record.ProcessId) name=$($record.Name), of the supervisor's family"
            $endedInterpreter = $true
            continue
        }
        if (Test-KeeperProcessRunning -ProcessId $record.ProcessId) {
            Write-KeeperLog "SILENCE left pid=$($record.ProcessId) name=$($record.Name): $reason, so the keeper ends nothing more, leaves the supervisor pid=$launcherId running and $again"
            return $false
        }
        Write-KeeperLog "SILENCE left pid=$($record.ProcessId) name=$($record.Name): $reason"
    }

    # The launcher's exit is read before its end is asked for: Windows PowerShell refuses the end of
    # an exited process and PowerShell 7 does not, so an exit before this read reads the same under
    # both. Under PowerShell 7 an exit in the moment between this read and the end still reads as an
    # end.
    $exited = $false
    try { $exited = $Process.HasExited } catch { $exited = $false }
    if (-not $exited) {
        try {
            $Process.Kill()
            Write-KeeperLog "SILENCE killed pid=$launcherId, the supervisor this keeper waited on"
        } catch {
            $reason = $_.Exception.Message
            try {
                $exited = $Process.HasExited
                if (-not $exited) {
                    $null = $Process.WaitForExit(2000)
                    $exited = $Process.HasExited
                }
            } catch {
                $exited = $false
            }
            if (-not $exited) {
                Write-KeeperLog "SILENCE left pid=${launcherId}: $reason, so the keeper ends nothing more and $again"
                return $false
            }
        }
    }
    if ($exited) {
        if (-not $endedInterpreter) {
            Write-KeeperLog "SILENCE left pid=${launcherId}: the supervisor this keeper waited on had exited by itself with no interpreter ended, so the keeper ends nothing more and the run keeps the supervisor's own exit code"
            return $false
        }
        Write-KeeperLog "SILENCE left pid=${launcherId}: the supervisor this keeper waited on had exited by itself"
    }

    foreach ($record in $forks) {
        $reason = Stop-KeeperFamilyMember -Record $record
        if ($null -eq $reason) {
            Write-KeeperLog "SILENCE killed pid=$($record.ProcessId) name=$($record.Name), of the supervisor's family"
        } else {
            Write-KeeperLog "SILENCE left pid=$($record.ProcessId) name=$($record.Name): $reason"
        }
    }
    foreach ($entry in @($family.Left)) {
        Write-KeeperLog "SILENCE left pid=$($entry.ProcessId) name=$($entry.Name): $($entry.Reason), so the keeper does not end it"
    }
    return $true
}

<#
.SYNOPSIS
Says whether a process id names a running process now, counting a read that cannot tell as running.

.DESCRIPTION
ProcessId is the id of a process record the keeper could not end. GetProcessById refuses an id no
process holds with an ArgumentException, which is the one answer read as not running, with a process
that reports it has exited. Every other failure, an id that is no number among them, is a doubt and
reads as running, since the caller ends a supervisor's launcher only once its interpreter is gone.
The id is not checked against a start time, so another process that has taken the id reads as
running too. Nothing here throws.

Returns $true or $false.
#>
function Test-KeeperProcessRunning {
    param([Parameter(Mandatory)][AllowNull()][object]$ProcessId)
    $read = $null
    try {
        $read = [System.Diagnostics.Process]::GetProcessById([int]$ProcessId)
        return (-not $read.HasExited)
    } catch [System.ArgumentException] {
        return $false
    } catch {
        return $true
    } finally {
        if ($null -ne $read) { $read.Dispose() }
    }
}

<#
.SYNOPSIS
Reads the start ticks of the process an id names now, as the supervisor reads them, or returns empty.

.DESCRIPTION
ProcessId is a Windows process id as a child handle records it. It is read only where it is ASCII
digits within the range of an id, so a value the handle file carries reaches Get-Process as a
number and nothing else. The process is read with Get-Process and its StartTime.Ticks returned as
decimal digits, the read and the value the supervisor records in the handle (bin/supervise.sh,
resolve_windows_start_ticks), so the two compare by equality with no time conversion between them.
Get-Process asks the system for a process it names by id and waits on no other process, so the read
has no timeout of its own. A process gone, or one whose start cannot be read, gives empty. Nothing
here throws.

Returns the ticks as a digit string, or an empty string.
#>
function Read-KeeperProcessStartTicks {
    param([AllowEmptyString()][string]$ProcessId = '')
    $id = 0
    if (-not [int]::TryParse($ProcessId, [System.Globalization.NumberStyles]::None, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$id)) { return '' }
    $read = $null
    try {
        $read = Get-Process -Id $id -ErrorAction Stop
        return ([int64]$read.StartTime.Ticks).ToString([System.Globalization.CultureInfo]::InvariantCulture)
    } catch {
        return ''
    } finally {
        if ($null -ne $read) { $read.Dispose() }
    }
}

<#
.SYNOPSIS
Ends one process a list read named, where it is still the process that read saw, and returns why not otherwise.

.DESCRIPTION
Windows hands a process id out again once its process is gone, so the id in a record read earlier
may name another process by now. A handle to the id is opened first, which keeps the id from being
handed out again, and the id's record is then read once more through Test-KeeperSupervisorRecord.
Only a record still carrying the start time the list gave, within AdoptStartToleranceSeconds, is
the same process, and it is ended through the open handle. A record with no start time cannot be
checked and is left. So is a process that has gone, one whose handle cannot be opened, one whose
second read fails and one whose end is refused. Nothing here throws.

Returns $null where the process was ended, and otherwise one line of text saying why it was left.
#>
function Stop-KeeperFamilyMember {
    param([Parameter(Mandatory)][object]$Record)
    if ($null -eq $Record.CreationDate) { return 'its process record carries no start time' }
    $member = $null
    try {
        $id = [int]$Record.ProcessId
        $startedUtc = ([DateTime]$Record.CreationDate).ToUniversalTime()
        $member = [System.Diagnostics.Process]::GetProcessById($id)
        $null = $member.Handle
        if (-not (Test-KeeperSupervisorRecord -ProcessId $id -StartedUtc $startedUtc)) {
            return "its process record is gone or carries another start time than $($startedUtc.ToString('o')), so the id names another process"
        }
        $member.Kill()
        return $null
    } catch {
        return [string]$_.Exception.Message
    } finally {
        if ($null -ne $member) { $member.Dispose() }
    }
}

<#
.SYNOPSIS
Looks for a supervisor already running for this persona and opens a handle to it, or returns nothing.

.DESCRIPTION
A supervisor outlives the keeper that launched it when that keeper ends first, and the fleet
supervisor's next start of the keeper would otherwise launch a second one beside it, which the pre-launch gate
refuses for as long as the first one lives. The machine's process list is read and handed to
Find-KeeperLiveSupervisor (bin/keeper-functions.ps1) with the bash and the arguments this wrapper
would launch with. The match's start time is read off its process record before anything waits on
it, so its uptime counts from when it started rather than from when this wrapper found it. A record
that carries no start time is no match.

The handle is opened and read before the wait for the reason Invoke-Supervisor reads its own: the
exit code is readable afterwards only where the handle was taken while the process was alive.
Windows hands a process id out again once its process is gone, and an open handle keeps the id
from being handed out, so once the handle is open the id's process record is read again. A record
gone, or carrying a start time more than AdoptStartToleranceSeconds from the scan's, is another
process under the same id and no match. The two reads are compared rather than the record with
the process's own StartTime, since those two convert the kernel value differently and can disagree
by the daylight-saving offset for a process started before a change. A second read that fails
counts as the same process, so the keeper adopts rather than launches beside a live supervisor.
A match that has exited by the time the handle is open is no match. The wrapper launches after each
no match.

A match still running whose handle cannot be opened is watched rather than launched beside, since a
second supervisor would be refused by the pre-launch gate for as long as the first one lives. Its
record is read again every AdoptWatchSeconds until it is gone or carries another start time, and the
process list is then scanned again. Without a handle its exit code cannot be read, so the watch
hands no run to the policy and does not count as a launch. The watch writes one keeper.log line as
it starts and one as it ends. A match whose handle cannot be opened and whose record is already
gone or changed on the second read is no match. A process list that cannot be read is no match.

A scan that finds no match logs nothing. Every other no match is one keeper.log line: SCAN failed
for a list that cannot be read, ADOPT skipped for a record with no start time or one that changed
after its handle opened, and ADOPT failed for a match that exited, or whose handle could not be
opened and whose record had gone or changed. A failed second read is one SCAN failed line of its
own.

Returns a hashtable: Process is the opened process, ProcessId its id, StartedUtc its start time.
#>
function Open-KeeperLiveSupervisor {
    param(
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(Mandatory)][string[]]$Arguments
    )
    while ($true) {
        try {
            $processes = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CommandLine, CreationDate -ErrorAction Stop)
            $match = Find-KeeperLiveSupervisor -Processes $processes -Executable $Executable -Arguments $Arguments
        } catch {
            Write-KeeperLog "SCAN failed: $($_.Exception.Message)"
            return $null
        }
        if ($null -eq $match) { return $null }
        $matchId = [int]$match.ProcessId
        if ($null -eq $match.CreationDate) {
            Write-KeeperLog "ADOPT skipped pid=${matchId}: its process record carries no start time"
            return $null
        }
        $startedUtc = ([DateTime]$match.CreationDate).ToUniversalTime()
        $process = $null
        try {
            $process = [System.Diagnostics.Process]::GetProcessById($matchId)
            $null = $process.Handle
        } catch {
            if ($null -ne $process) { $process.Dispose() }
            if (Watch-KeeperUnopenedSupervisor -ProcessId $matchId -StartedUtc $startedUtc -Reason $_.Exception.Message) { continue }
            return $null
        }
        try {
            if ($process.HasExited) { throw 'the process exited before its handle was opened' }
        } catch {
            $process.Dispose()
            Write-KeeperLog "ADOPT failed pid=${matchId}: $($_.Exception.Message)"
            return $null
        }
        $same = $true
        try {
            $same = Test-KeeperSupervisorRecord -ProcessId $matchId -StartedUtc $startedUtc
        } catch {
            Write-KeeperLog "SCAN failed: $($_.Exception.Message)"
        }
        if (-not $same) {
            $process.Dispose()
            Write-KeeperLog "ADOPT skipped pid=${matchId}: its process record changed after the scan, gone or carrying another start time than $($startedUtc.ToString('o')), so the id names another process"
            return $null
        }
        return @{ Process = $process; ProcessId = $matchId; StartedUtc = $startedUtc }
    }
}

<#
.SYNOPSIS
Waits out a live supervisor whose handle could not be opened, by reading its process record.

.DESCRIPTION
Reason is why the handle could not be opened. The process id's record is read again first. Present
with the start time the scan saw, within AdoptStartToleranceSeconds, it is the same process still
running: that is one ADOPT watching line, then the record is read every AdoptWatchSeconds until it
is gone or carries another start time, then one ADOPT ended line. Absent or carrying another start
time, the process the scan saw has ended and the ADOPT failed line is written instead.

A read that fails, first or during the watch, is one SCAN failed line and counts as the process
still present, so the watch starts or keeps sleeping. The watch ends only on a read that succeeds
and shows the record gone or carrying another start time, since ending it on a failed read would
launch a second supervisor beside one that may still be running.

Returns $true when the process was watched until it went, $false when it had already gone.
#>
function Watch-KeeperUnopenedSupervisor {
    param(
        [Parameter(Mandatory)][int]$ProcessId,
        [Parameter(Mandatory)][DateTime]$StartedUtc,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Reason
    )
    $present = $true
    try {
        $present = Test-KeeperSupervisorRecord -ProcessId $ProcessId -StartedUtc $StartedUtc
    } catch {
        Write-KeeperLog "SCAN failed: $($_.Exception.Message)"
    }
    if (-not $present) {
        Write-KeeperLog "ADOPT failed pid=${ProcessId}: $Reason"
        return $false
    }
    Write-KeeperLog "ADOPT watching pid=$ProcessId without a handle: $Reason"
    while ($true) {
        Start-Sleep -Seconds $script:AdoptWatchSeconds
        try {
            if (-not (Test-KeeperSupervisorRecord -ProcessId $ProcessId -StartedUtc $StartedUtc)) { break }
        } catch {
            Write-KeeperLog "SCAN failed: $($_.Exception.Message)"
        }
    }
    Write-KeeperLog "ADOPT ended pid=$ProcessId, exit code unreadable"
    return $true
}

<#
.SYNOPSIS
Reads one process id's record again and says whether it still names the process a scan saw.

.DESCRIPTION
The record is read with a filtered Get-CimInstance Win32_Process query, the same source as the scan,
so its start time is converted the same way as the one StartedUtc came from. A record present with
a start time within AdoptStartToleranceSeconds of StartedUtc, compared by Test-KeeperStartWithin
(bin/keeper-functions.ps1), is the same process. A record gone, or carrying no start time or
another one, is not. A read that fails, or that has no answer within 30 seconds, throws, so each
caller decides what an unreadable record means.

Returns $true for the same process, $false otherwise.
#>
function Test-KeeperSupervisorRecord {
    param(
        [Parameter(Mandatory)][int]$ProcessId,
        [Parameter(Mandatory)][DateTime]$StartedUtc
    )
    $record = @(Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -Property ProcessId, CreationDate -OperationTimeoutSec 30 -ErrorAction Stop) | Select-Object -First 1
    return ($null -ne $record -and $null -ne $record.CreationDate -and
        (Test-KeeperStartWithin -RecordedUtc ([DateTime]$record.CreationDate).ToUniversalTime() -StartedUtc $StartedUtc -ToleranceSeconds $script:AdoptStartToleranceSeconds))
}

<#
.SYNOPSIS
Waits on an adopted supervisor and returns its exit code, uptime and an empty last stderr line.

.DESCRIPTION
The shape Invoke-Supervisor returns, so the loop hands an adopted run to Get-KeeperDecision exactly
as it hands a launched one. The uptime runs from the process's own start time. The wrapper did not
start this process and holds neither of its output streams, so there is no last stderr line. An
exit code that cannot be read comes back as $null, which the loop treats as the wrapper fault it is
for a launched supervisor.

The wait is Wait-KeeperWatchedSupervisor's, as for a launched supervisor: Arguments is the argument
array the family is matched on, and an adopted supervisor whose log at LogPath has been silent for
more than SilenceBoundSeconds is ended the same way, with SilenceSeconds saying for how long and
ExitCode then -1 whatever the process reports.
#>
function Wait-KeeperAdoptedSupervisor {
    param(
        [Parameter(Mandatory)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory)][DateTime]$StartedUtc,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$LogPath,
        [Parameter(Mandatory)][int]$SilenceBoundSeconds
    )
    $silence = Wait-KeeperWatchedSupervisor -Process $Process -Arguments $Arguments -LogPath $LogPath -SilenceBoundSeconds $SilenceBoundSeconds
    $uptime = [int][Math]::Floor(([DateTime]::UtcNow - $StartedUtc).TotalSeconds)
    if ($uptime -lt 0) { $uptime = 0 }
    $exitCode = $null
    try { $exitCode = $Process.ExitCode } catch { $exitCode = $null }
    if ($silence -gt 0) { $exitCode = -1 }
    $Process.Dispose()
    return @{ ExitCode = $exitCode; UptimeSeconds = $uptime; LastErrorLine = ''; SilenceSeconds = $silence }
}

<#
.SYNOPSIS
Says whether a fleet supervisor serving the given roster is live on this machine.

.DESCRIPTION
The machine's process list is read and each command line is handed to
Test-KeeperFleetSupervisorCommandLine (bin/keeper-functions.ps1), which says what counts. A process
list that cannot be read within 30 seconds is one SCAN failed line and $false, since a hand-off to a
fleet supervisor nobody saw could leave the persona with nothing to start it.
#>
function Test-KeeperFleetSupervisorLive {
    param([Parameter(Mandatory)][string]$RosterPath)
    try {
        $processes = @(Get-CimInstance Win32_Process -Property ProcessId, CommandLine -OperationTimeoutSec 30 -ErrorAction Stop)
    } catch {
        Write-KeeperLog "SCAN failed: $($_.Exception.Message)"
        return $false
    }
    foreach ($record in $processes) {
        if ($null -eq $record) { continue }
        if (Test-KeeperFleetSupervisorCommandLine -CommandLine ([string]$record.CommandLine) -RosterPath $RosterPath) { return $true }
    }
    return $false
}

<#
.SYNOPSIS
Writes keeper.json as UTF-8 without a byte-order mark; a failure is logged and stepped over.
#>
function Write-KeeperState {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][hashtable]$State)
    try {
        $json = [pscustomobject]$State | ConvertTo-Json -Depth 3
        [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, $script:Utf8NoBom)
    } catch {
        Write-KeeperLog "STATE failed: '$Path' $($_.Exception.Message)"
    }
}

# Every refusal until the run directory is ready has no keeper.log to reach, and a scheduled task
# gives stderr no console either, so each one is also written beside the roster file. That is the one
# location known without reading anything the roster says, so it is resolved before the first refusal
# rather than after it.
$rosterDir = Split-Path -Parent $Roster
if ([string]::IsNullOrWhiteSpace($rosterDir)) { $rosterDir = '.' }
# Resolved against PowerShell's own current location before anything writes it. Write-KeeperLog
# checks the size through the provider and appends through .NET, which resolve a relative path
# against different roots, so a path resolved here is the one both halves act on.
$fallbackLog = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath(
    (Join-Path $rosterDir 'keeper-refused.log'))

if ([string]::IsNullOrWhiteSpace($Name)) {
    Write-KeeperLog -Path $fallbackLog -Text 'ROSTER error: -Name is required.'
    [Console]::Error.WriteLine('Start-Persona: -Name is required.')
    exit 1
}

try {
    $entry = Read-KeeperRoster -Path $Roster -Name $Name
} catch {
    Write-KeeperLog -Path $fallbackLog -Text "ROSTER error: $($_.Exception.Message)"
    [Console]::Error.WriteLine("Start-Persona: $($_.Exception.Message)")
    exit 1
}

# The roster's spelling of the name, not the command line's: -Name matches case-insensitively, and
# the state file and the supervisor argument both name the persona the roster runs.
$personaName = [string]$entry.name

# The wrapper's own paths keep the Windows spelling the roster carries, because .NET resolves these;
# only the arguments handed to bash are converted (Build-SupervisorInvocation).
$runDir = [string]$entry.rundir
if ([string]::IsNullOrWhiteSpace($runDir)) { $runDir = Join-Path ([string]$entry.workdir) 'run' }
# Resolved for the same reason $fallbackLog is: the run directory is created through .NET and the
# logs under it are rotated through the provider.
$runDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($runDir)
try {
    if (-not (Test-Path -LiteralPath $runDir -PathType Container)) {
        # .NET takes the path literally, as the guard above does. New-Item -Path would instead read
        # a run directory whose name carries [ or ] as a wildcard and create some other directory,
        # or none.
        [void][System.IO.Directory]::CreateDirectory($runDir)
    }
} catch {
    Write-KeeperLog -Path $fallbackLog -Text "ROSTER error: run directory '$runDir' could not be created: $($_.Exception.Message)"
    [Console]::Error.WriteLine("Start-Persona: run directory '$runDir' could not be created: $($_.Exception.Message)")
    exit 1
}
$script:LogPath = Join-Path $runDir 'keeper.log'
$holdPath = Join-Path $runDir 'keeper.hold'
$parkPath = Join-Path $runDir 'keeper.park'
$bootPath = Join-Path $runDir 'keeper.boot'
$statePath = Join-Path $runDir 'keeper.json'
$outputPath = Join-Path $runDir 'supervisor.out'
# The supervisor's own log, which the wrapper reads for its last write and never writes.
$supervisorLogPath = Join-Path $runDir 'supervisor.log'

if ($Release) {
    # The hold marker first, then the park marker, then the boot marker, one RELEASE line for each
    # file removed. A marker that cannot be removed is a fault of the wrapper's own and ends the
    # release there.
    $released = 0
    foreach ($marker in @(@{ Path = $holdPath; Kind = 'hold' }, @{ Path = $parkPath; Kind = 'park' }, @{ Path = $bootPath; Kind = 'boot' })) {
        if (-not (Test-Path -LiteralPath $marker.Path -PathType Leaf)) { continue }
        try {
            Remove-Item -LiteralPath $marker.Path -Force -ErrorAction Stop
        } catch {
            Stop-KeeperWithError "$($marker.Kind) marker '$($marker.Path)' could not be removed: $($_.Exception.Message)"
        }
        Write-KeeperLog "RELEASE $($marker.Path)"
        $released++
    }
    if ($released -eq 0) { Write-KeeperLog 'RELEASE none' }
    exit 0
}

# A hold marker is read first and stops the start whether or not a park marker stands beside it, so
# a persona the operator stopped never comes back because it was also parked.
if (Test-Path -LiteralPath $holdPath -PathType Leaf) {
    $reason = 'unreadable'
    try {
        $first = @(Get-Content -LiteralPath $holdPath -Encoding UTF8 -TotalCount 1 -ErrorAction Stop)
        if ($first.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($first[0])) { $reason = $first[0].Trim() }
    } catch {
        $reason = "unreadable: $($_.Exception.Message)"
    }
    Write-KeeperLog "HOLD $reason"
    exit 0
}

# The fleet supervisor starts an exited keeper again on its next tick. The boot marker is written when the policy
# parks the persona or the supervisor is signalled out, so a marker holding this boot's time means
# the persona was stopped on purpose this boot, and the repeated start leaves that stop alone. The
# check sits after the hold check, so a hold outranks it, and before the park check, so the repeated
# fire leaves a park marker in place. The system's boot time moves by seconds when the clock is
# stepped after boot, so the two times are the same boot when they are within a minute. A marker that
# is empty, unreadable or unparseable is another boot. A boot time that cannot be read, or that takes
# more than 30 seconds to read, launches without reading or writing the marker: a repeated start that
# launches is the goal, and a duplicate launch is already stopped by the fleet supervisor's live-keeper
# match and by ADOPT. That launch does not protect a park during that fire.
$bootTime = $null
try {
    $bootTime = (Get-CimInstance -ClassName Win32_OperatingSystem -OperationTimeoutSec 30 -ErrorAction Stop).LastBootUpTime.ToUniversalTime()
} catch {
    Write-KeeperLog "ERROR boot time could not be read: $($_.Exception.Message)"
}
if ($null -ne $bootTime -and (Test-Path -LiteralPath $bootPath -PathType Leaf)) {
    $markerBoot = [DateTimeOffset]::MinValue
    $parsed = $false
    try {
        $first = @(Get-Content -LiteralPath $bootPath -Encoding UTF8 -TotalCount 1 -ErrorAction Stop)
        if ($first.Count -gt 0) {
            $parsed = [DateTimeOffset]::TryParse(([string]$first[0]).Trim(), [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal, [ref]$markerBoot)
        }
    } catch { }
    if ($parsed -and [Math]::Abs(($markerBoot.UtcDateTime - $bootTime).TotalSeconds) -lt 60) {
        Write-KeeperLog "BOOTED $bootPath"
        exit 0
    }
}

# A park marker is cleared by the start and never stops it. One that cannot be removed is logged
# and the start launches anyway, because the next park or hold overwrites or outranks it.
if (Test-Path -LiteralPath $parkPath -PathType Leaf) {
    try {
        Remove-Item -LiteralPath $parkPath -Force -ErrorAction Stop
        Write-KeeperLog "UNPARK $parkPath"
    } catch {
        Write-KeeperLog "ERROR park marker '$parkPath' could not be removed: $($_.Exception.Message)"
        [Console]::Error.WriteLine("Start-Persona: park marker '$parkPath' could not be removed: $($_.Exception.Message)")
    }
}

# The env file is the source of KEEPER_BASH_EXE. When it is absent, a value already on the process
# environment stands in, so a hand launch from a shell that exported it still works; a task with
# neither has nothing to run bash with and stops.
$bashExe = $null
if (Test-Path -LiteralPath $EnvFile -PathType Leaf) {
    $bashExe = Set-KeeperEnvironment -Path $EnvFile
} else {
    Write-KeeperLog "ENV missing: $EnvFile"
}
if ([string]::IsNullOrWhiteSpace($bashExe)) {
    $bashExe = [Environment]::GetEnvironmentVariable('KEEPER_BASH_EXE', 'Process')
}
if ([string]::IsNullOrWhiteSpace($bashExe)) {
    Stop-KeeperWithError "no bash executable: KEEPER_BASH_EXE is neither in env file '$EnvFile' nor in the process environment"
}

try {
    $invocation = Build-SupervisorInvocation -Entry $entry -RosterPath $Roster -RunDirectory $runDir
} catch {
    Stop-KeeperWithError $_.Exception.Message
}
# A supervisor this wrapper launches ends a requested restart at exit 7 rather than launching the
# next child itself, which is what brings the restart to the decision loop below as a hand-off. The
# value is set here and is not an env file key, so no line of that file changes it. A supervisor the
# wrapper adopts keeps the environment it was started with.
$invocation.Environment['SUPERVISOR_RESTART_EXITS'] = '1'
foreach ($key in $invocation.Environment.Keys) {
    try {
        Set-Item -Path "env:$key" -Value $invocation.Environment[$key] -ErrorAction Stop
    } catch {
        Write-KeeperLog "ENV failed: $key $($_.Exception.Message)"
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
# bash is the only reader of this path, so it is spelled the way bash resolves it, as every other
# argument in the list is.
$supervisorPath = ConvertTo-BashPath (Join-Path $repoRoot 'bin/supervise.sh')
$arguments = @($supervisorPath) + $invocation.Arguments

# Records that the persona was stopped by policy this boot. A marker that cannot be written is logged
# and the wrapper still exits 0, as for the park marker: without it a repeated start launches the
# persona again, which a park or a signal exit must not allow. A boot time never read writes
# nothing.
function Write-KeeperBootMarker {
    if ($null -eq $bootTime) { return }
    try {
        [System.IO.File]::WriteAllLines($bootPath, [string[]]@($bootTime.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)), $script:Utf8NoBom)
    } catch {
        Write-KeeperLog "ERROR boot marker '$bootPath' could not be written: $($_.Exception.Message)"
        [Console]::Error.WriteLine("Start-Persona: boot marker '$bootPath' could not be written: $($_.Exception.Message)")
    }
}

$launchCount = 0
$delay = $script:KeeperBaseDelaySeconds
$exit1Count = 0
while ($true) {
    # A supervisor already running for this persona is waited on rather than launched beside. An
    # adopted run is not a launch, so it leaves launchCount where it stands.
    $adopted = Open-KeeperLiveSupervisor -Executable $bashExe -Arguments $arguments
    if ($null -ne $adopted) {
        $started = $adopted.StartedUtc
        Write-KeeperLog "ADOPT pid=$($adopted.ProcessId)"
        $run = Wait-KeeperAdoptedSupervisor -Process $adopted.Process -StartedUtc $started -Arguments $arguments -LogPath $supervisorLogPath -SilenceBoundSeconds $SilenceBoundSeconds
    } else {
        $launchCount++
        $started = [DateTime]::UtcNow
        Write-KeeperLog "LAUNCH $launchCount $bashExe $($arguments -join ' ')"
        $run = Invoke-Supervisor -BashExe $bashExe -Arguments $arguments -WorkingDirectory $repoRoot -OutputPath $outputPath -Launch $launchCount -LogPath $supervisorLogPath -SilenceBoundSeconds $SilenceBoundSeconds
    }
    $ended = [DateTime]::UtcNow
    if ($null -ne $adopted) {
        Write-KeeperLog "EXIT adopted pid=$($adopted.ProcessId) code=$($run.ExitCode) uptime=$($run.UptimeSeconds)"
    } else {
        Write-KeeperLog "EXIT $launchCount code=$($run.ExitCode) uptime=$($run.UptimeSeconds)"
    }

    # No exit code means the policy has no input: passing $null to its Mandatory [int] would be an
    # uncaught binding error, which would end the wrapper with no DECIDE line, no state file and no
    # hold marker. It is a fault of the wrapper's own instead.
    if ($null -eq $run.ExitCode) {
        if ($null -ne $adopted) {
            Stop-KeeperWithError "adopted supervisor pid=$($adopted.ProcessId) reported no exit code"
        }
        Stop-KeeperWithError "supervisor '$bashExe' reported no exit code after launch $launchCount"
    }

    $decision = Get-KeeperDecision -ExitCode $run.ExitCode -UptimeSeconds $run.UptimeSeconds -PreviousDelaySeconds $delay -ConsecutiveExit1Count $exit1Count -SilenceSeconds $run.SilenceSeconds
    # A park records its reason in the same field a hold does, so a reader of keeper.json finds why
    # the persona is down in one place whichever marker the decision writes.
    $holdReason = $null
    if ($decision.Action -eq 'hold' -or $decision.Action -eq 'park') { $holdReason = $decision.Reason }
    Write-KeeperState -Path $statePath -State @{
        persona = $personaName
        launchCount = $launchCount
        lastStart = $started.ToString('o')
        lastEnd = $ended.ToString('o')
        lastExitCode = $run.ExitCode
        currentDelay = $decision.NextDelaySeconds
        holdReason = $holdReason
    }
    Write-KeeperLog "DECIDE exit=$($run.ExitCode) uptime=$($run.UptimeSeconds) action=$($decision.Action) delay=$($decision.DelaySeconds) reason=$($decision.Reason)"

    switch ($decision.Action) {
        'hold' {
            # Line 1 is the reason. An exit-1 hold of a launched supervisor adds its last stderr line
            # and the path of supervisor.out, so the operator reading the marker sees why without
            # opening it. An adopted supervisor's output never reached supervisor.out, so its marker
            # carries the reason alone.
            $lines = New-Object System.Collections.Generic.List[string]
            $lines.Add($decision.Reason)
            if ($run.ExitCode -eq 1 -and $null -eq $adopted) {
                $lines.Add($run.LastErrorLine)
                $lines.Add($outputPath)
            }
            try {
                [System.IO.File]::WriteAllLines($holdPath, $lines, $script:Utf8NoBom)
            } catch {
                # Exit 0 even though the marker is missing, as for every stop the policy asked for.
                # The ERROR line is the record, and without the marker the fleet supervisor's next
                # start launches again.
                Write-KeeperLog "ERROR hold marker '$holdPath' could not be written: $($_.Exception.Message)"
                [Console]::Error.WriteLine("Start-Persona: hold marker '$holdPath' could not be written: $($_.Exception.Message)")
            }
            exit 0
        }
        'park' {
            # The reason is the only line. The marker stops nothing: a start of a later boot removes it
            # and launches, so it exists to tell that start, and the fleet reading, that the persona
            # parked rather than stopped. The boot marker beside it makes a start of this boot leave
            # the park alone.
            Write-KeeperBootMarker
            try {
                [System.IO.File]::WriteAllLines($parkPath, [string[]]@($decision.Reason), $script:Utf8NoBom)
            } catch {
                # Exit 0 for the reason a hold marker that cannot be written exits 0. Without the
                # marker a start launches, which is what a park asks for anyway.
                Write-KeeperLog "ERROR park marker '$parkPath' could not be written: $($_.Exception.Message)"
                [Console]::Error.WriteLine("Start-Persona: park marker '$parkPath' could not be written: $($_.Exception.Message)")
            }
            exit 0
        }
        'exit' {
            # A signal exit stays down until the next boot, so a repeated start later this boot
            # must not bring the persona back.
            Write-KeeperBootMarker
            exit 0
        }
        'handoff' {
            # A wrapper that exits here leaves no marker, so only a fleet supervisor that is running
            # for this roster, and still finds the entry in it once and enabled with no hold or boot
            # marker beside it, starts the persona again. The roster fact also asks for the workdir a
            # keeper needs to launch.
            # Each fact is read now, and one that cannot be read is false.
            $fleetFact = $FleetSupervisorLive -eq 'true'
            if ($FleetSupervisorLive -eq 'read') { $fleetFact = Test-KeeperFleetSupervisorLive -RosterPath $Roster }
            $rosterFact = $RosterEnabled -eq 'true'
            if ($RosterEnabled -eq 'read') { $rosterFact = Test-KeeperRosterHandoffEntry -Path $Roster -Name $personaName }
            # A start that read the boot time and found a marker naming this boot exited BOOTED, so
            # only a keeper that could not read the boot time can stand beside one. The boot time is
            # the one this keeper read at its start, and it is read no second time.
            $bootFact = $BootMarkerClear -eq 'true'
            if ($BootMarkerClear -eq 'read') { $bootFact = ($null -ne $bootTime) -or -not (Test-Path -LiteralPath $bootPath -PathType Leaf) }
            # A hold counts whatever stands beside it, the fleet supervisor's own sidecar included.
            $holdFact = $HoldClear -eq 'true'
            if ($HoldClear -eq 'read') { $holdFact = -not (Test-Path -LiteralPath $holdPath -PathType Leaf) }
            $handoff = Get-KeeperHandoffDecision -FleetSupervisorLive $fleetFact -RosterEnabled $rosterFact -BootMarkerClear $bootFact -HoldClear $holdFact
            if ($handoff.Handoff) { exit 0 }
            # Nothing would start the persona again, so the supervisor is launched again from this
            # wrapper's own copy with no sleep, on the ladder values the decision carried.
            Write-KeeperLog "HANDOFF not taken: $($handoff.Reason), so the build did not move and the supervisor is launched again by this keeper"
            $delay = $decision.NextDelaySeconds
            $exit1Count = $decision.NextExit1Count
        }
        default {
            $delay = $decision.NextDelaySeconds
            $exit1Count = $decision.NextExit1Count
            Start-Sleep -Milliseconds ([int][Math]::Round($decision.DelaySeconds * 1000 * $DelayScale))
        }
    }
}
