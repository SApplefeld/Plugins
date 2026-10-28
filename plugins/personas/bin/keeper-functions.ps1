# Pure functions shared by the process keeper's scripts. Dot-sourced by bin/Start-Persona.ps1 (the
# wrapper the fleet supervisor starts per enabled entry), bin/Start-Fleet.ps1 (the fleet supervisor
# the scheduled task runs) and bin/keeper-probe.ps1 (the recorder that measures what a task
# delivers), so the allowlist, the env file reader, the roster readers, the supervisor invocation
# builder, the native argument quoting, the live supervisor and live keeper matches, the repo URL
# check, the exit-code policy and the fleet decision each exist once.
#
#   . (Join-Path $PSScriptRoot 'keeper-functions.ps1')
#
# Nothing here sets an environment variable or launches a process, and one function writes a file:
# Build-SupervisorInvocation writes an entry's goal block to goal.json in the run directory it is
# given. A function that cannot produce its answer throws, and the error names the path it was
# reading, so the caller logs it and decides what to do. Every caller runs under Windows
# PowerShell 5.1.

# Every environment variable the keeper is willing to take from the env file. Named explicitly so
# that no key outside this list reaches the process that launches the supervisor. KEEPER_BASH_EXE
# names the executable that runs and is not exported; KEEPER_PATH_PREPEND decides where node and
# claude resolve and is prepended to the process PATH rather than set as a variable of its own.
$script:KeeperEnvAllowlist = @(
    'KEEPER_BASH_EXE',
    'KEEPER_PATH_PREPEND',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP'
)

# The exit-code policy's constants. The delay between relaunches starts at the base, doubles on a
# crash-class exit up to the cap, and returns to the base after a run that lasted the reset uptime.
# Exit 1 holds after the count below of consecutive exit-1 runs that each ended inside the short
# uptime, because a configuration error repeats at once while a launch-time fault a boot can hit
# once does not.
$script:KeeperBaseDelaySeconds = 300
$script:KeeperMaxDelaySeconds = 14400
$script:KeeperResetUptimeSeconds = 3600
$script:KeeperExit1HoldCount = 3
$script:KeeperExit1ShortUptimeSeconds = 60

# The fleet supervisor's constants. A keeper that ends inside the quick-exit uptime on a route no
# marker explains waits the ladder's value before its next start, and the ladder doubles from the
# base to the cap on each such exit; a clone of an entry's repository that fails waits and doubles
# the same ladder, so a bad URL costs one git call per delay. A keeper that lived the keeper's own
# reset uptime ($script:KeeperResetUptimeSeconds) puts the ladder back at the base. The launcher names are the
# two scripts a keeper's command line can carry, the checkout's and the installed route's, so a
# fleet supervisor on either route finds a keeper started on the other.
$script:FleetBaseDelaySeconds = 60
$script:FleetMaxDelaySeconds = 1800
$script:FleetQuickExitSeconds = 60
$script:FleetKeeperLauncherNames = @('Start-Persona.ps1', 'Start-InstalledPersona.ps1')

<#
.SYNOPSIS
Decides what the keeper does after one supervisor exit, from the exit code and the run's shape.

.DESCRIPTION
Implements the policy table: exit 0 holds; exit 6 parks; exit 1 relaunches after the base delay
and holds once the consecutive short exit-1 count reaches the hold count; exit 2 relaunches after
the base delay with the ladder untouched; exit -1, the code Stop-Process and Process.Kill leave
where taskkill /F leaves 1, is a termination from outside with no signal and relaunches after the
base delay with the ladder untouched; 130 and 143 exit without relaunching; every other code
relaunches after the current delay and doubles it up to the cap. A run that lasted the reset uptime
or longer puts the ladder back at the base before the row is applied, so a persona that ran for an
hour and then crashed waits the base delay, not whatever the ladder had climbed to.

Returns a hashtable: Action is 'hold', 'park', 'relaunch' or 'exit'; DelaySeconds is how long to
wait before the next launch (0 when not relaunching); NextDelaySeconds is the ladder value to carry
into the next decision; NextExit1Count is the consecutive short exit-1 count to carry; Reason is one
line of text with no newline, fit for the DECIDE log line and the hold and park markers. A park
stops the wrapper as a hold does, and differs in that the next boot ends it on its own,
where a hold stops every later start until it is released.
#>
function Get-KeeperDecision {
    param(
        [Parameter(Mandatory)][int]$ExitCode,
        [Parameter(Mandatory)][int]$UptimeSeconds,
        [Parameter(Mandatory)][int]$PreviousDelaySeconds,
        [Parameter(Mandatory)][int]$ConsecutiveExit1Count
    )
    $delay = $PreviousDelaySeconds
    if ($delay -lt $script:KeeperBaseDelaySeconds) { $delay = $script:KeeperBaseDelaySeconds }
    if ($UptimeSeconds -ge $script:KeeperResetUptimeSeconds) { $delay = $script:KeeperBaseDelaySeconds }

    switch ($ExitCode) {
        0 {
            return @{
                Action = 'hold'; DelaySeconds = 0; NextDelaySeconds = $delay; NextExit1Count = 0
                Reason = 'supervisor exited 0: shutdown honored or stop complete'
            }
        }
        6 {
            return @{
                Action = 'park'; DelaySeconds = 0; NextDelaySeconds = $delay; NextExit1Count = 0
                Reason = "supervisor exited 6: parked, back at the next boot or a start after the operator's -Release"
            }
        }
        1 {
            $count = 0
            if ($UptimeSeconds -lt $script:KeeperExit1ShortUptimeSeconds) { $count = $ConsecutiveExit1Count + 1 }
            if ($count -ge $script:KeeperExit1HoldCount) {
                return @{
                    Action = 'hold'; DelaySeconds = 0; NextDelaySeconds = $delay; NextExit1Count = $count
                    Reason = "supervisor exited 1 on $count consecutive runs each under $($script:KeeperExit1ShortUptimeSeconds) seconds: usage or configuration error"
                }
            }
            return @{
                Action = 'relaunch'; DelaySeconds = $script:KeeperBaseDelaySeconds; NextDelaySeconds = $delay; NextExit1Count = $count
                Reason = "supervisor exited 1: usage, configuration or launch-time fault, short exit-1 run $count of $($script:KeeperExit1HoldCount)"
            }
        }
        2 {
            return @{
                Action = 'relaunch'; DelaySeconds = $script:KeeperBaseDelaySeconds; NextDelaySeconds = $delay; NextExit1Count = 0
                Reason = 'supervisor exited 2: pre-launch gate failed or timed out'
            }
        }
        -1 {
            return @{
                Action = 'relaunch'; DelaySeconds = $script:KeeperBaseDelaySeconds; NextDelaySeconds = $delay; NextExit1Count = 0
                Reason = 'supervisor exited -1: ended from outside with no signal'
            }
        }
        { $_ -eq 130 -or $_ -eq 143 } {
            return @{
                Action = 'exit'; DelaySeconds = 0; NextDelaySeconds = $delay; NextExit1Count = 0
                Reason = "supervisor exited ${ExitCode}: signaled"
            }
        }
        default {
            $meaning = switch ($ExitCode) {
                3 { 'crash loop' }
                4 { 'restart budget exhausted' }
                5 { 'a child process survived the stop' }
                default { 'unknown exit code' }
            }
            $next = $delay * 2
            if ($next -gt $script:KeeperMaxDelaySeconds) { $next = $script:KeeperMaxDelaySeconds }
            return @{
                Action = 'relaunch'; DelaySeconds = $delay; NextDelaySeconds = $next; NextExit1Count = 0
                Reason = "supervisor exited ${ExitCode}: $meaning"
            }
        }
    }
}

<#
.SYNOPSIS
Reads the roster file and returns the enabled entry with the given name.

.DESCRIPTION
The roster is a JSON array of entry objects (see the roster table in the process keeper plan and
bin/fleet.example.json). The file is read as UTF-8. A file that cannot be read or parsed, a name no
entry carries, an entry that carries no enabled field, and an entry whose enabled field is not the
JSON boolean true are each a thrown error naming the roster path and the name, so a wrapper started
for a persona the roster does not run stops with a message rather than launching something.
#>
function Read-KeeperRoster {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Name
    )
    try {
        $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop
        $parsed = ConvertFrom-Json -InputObject $raw -ErrorAction Stop
        # Windows PowerShell 5.1 returns a JSON array as one object[] rather than enumerating it,
        # so it is piped through ForEach-Object, which enumerates, before it is wrapped as a list.
        $entries = @($parsed | ForEach-Object { $_ })
    } catch {
        throw "roster '$Path' could not be read for persona '$Name': $($_.Exception.Message)"
    }
    $match = $null
    foreach ($entry in $entries) {
        if ($null -eq $entry) { continue }
        if ([string]$entry.name -eq $Name) { $match = $entry; break }
    }
    if ($null -eq $match) {
        throw "roster '$Path' has no entry named '$Name'"
    }
    # -ne coerces its right side to the left side's type, so a string "false" would compare against
    # "True" case-insensitively and pass as enabled. The field must be a JSON boolean. The property
    # is looked up rather than read through $match.enabled, so an entry that carries no such field
    # is told that, and one that carries the wrong type is told that instead.
    $enabledProperty = $match.PSObject.Properties['enabled']
    if ($null -eq $enabledProperty) {
        throw "roster '$Path' entry '$Name' has no 'enabled' field: write enabled true or false without quotes"
    }
    if ($enabledProperty.Value -isnot [bool]) {
        throw "roster '$Path' entry '$Name' has an 'enabled' field that is not a JSON boolean: write true or false without quotes"
    }
    if (-not $match.enabled) {
        throw "roster '$Path' entry '$Name' is not enabled"
    }
    return $match
}

<#
.SYNOPSIS
Spells a Windows path the way the bash that runs the supervisor resolves it.

.DESCRIPTION
bin/supervise.sh treats any --rundir that does not start with / as relative to the directory bash
was started in and prefixes it, so D:/personas/dev/run would become <repo>/D:/personas/dev/run and
the supervisor's own files would land somewhere the wrapper never looks. Git bash mounts each drive
at /<letter>, so D:/personas/dev/run and /d/personas/dev/run name the same directory to bash while
only the second is absolute to it. Backslashes become forward slashes; a UNC path keeps its leading
//server/share; a path already in the bash form, and anything with no drive letter, is returned
with its separators normalized and nothing else changed. This converts arguments only: the wrapper's
own keeper.log, keeper.hold, keeper.park and supervisor.out keep the Windows spelling the roster
carries, which is what .NET resolves.
#>
function ConvertTo-BashPath {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Path)
    if ($Path.Length -eq 0) { return $Path }
    $text = $Path -replace '\\', '/'
    if ($text -match '^([A-Za-z]):(/.*)?$') {
        $drive = $Matches[1].ToLowerInvariant()
        $rest = $Matches[2]
        return "/$drive$rest"
    }
    return $text
}

<#
.SYNOPSIS
Builds the supervisor's argument list and environment map from one roster entry.

.DESCRIPTION
Follows the roster table: the three positional arguments in the order bin/supervise.sh parses
them (<workdir> <persona> <permission-mode>), then --rundir and --channel-name where the entry
carries them, then the args field verbatim. workdir and rundir go through ConvertTo-BashPath,
because bash is the consumer of these two and a Windows spelling of the rundir reads to it as a
relative path. The args field is passed as written, since the keeper does not know what a flag it
has no row for means. model, effort, controllerTickMs, nudgeFloorMs, nudgeIdleMs,
memoryGateDiscardPercent, channelLogRetentionDays, journalRetentionDays, coordinatorPersona,
architectPersona, liaisonPersona, fleetRoster and jevMode become the MODEL, EFFORT, controllerTickMs,
nudgeFloorMs, nudgeIdleMs, memoryGateDiscardPercent, channelLogRetentionDays, journalRetentionDays,
COORDINATOR_PERSONA, ARCHITECT_PERSONA, LIAISON_PERSONA, FLEET_ROSTER and JEV_MODE environment
variables, each present only where the entry carries the field. SETTINGS_FROM_ROSTER is set to 1
on every invocation, so the supervisor rewrites its settings file from the roster at each start.
jevLive is an array of question-set ids rather than a scalar, so it does not ride that same field
map: a non-empty array becomes JEV_LIVE as its members joined with a comma, since the shell halves
that read JEV_LIVE split on commas, and PowerShell's own [string] cast on an array joins with $OFS
(a space by default) instead. A jevLive field present and not a JSON array is thrown rather than
read as empty, naming the roster path, the persona and the field, the same rule Read-KeeperRoster
holds 'enabled' to. A missing required field, or an args element that is --prompt or starts with
--prompt=, is a thrown error naming the roster path, because the roster launches every persona
passive and a prompt is not a thing a boot-time relaunch may carry.

The goal block is an object, which no environment variable carries, so where the entry carries a
goal the block is written to <RunDirectory>/goal.json as UTF-8 without a byte order mark and
GOAL_FILE names that file in the Windows spelling, which the plugin reads through Node. The file is
rewritten at every start, and an entry with no goal removes a goal.json an earlier start left, so
the file always matches the roster. A goal with no -RunDirectory given is a thrown error, since the
block would otherwise be dropped. The block's own shape is the roster validator's to check, so it is
written as the roster holds it. LIFETIME is set on every invocation, to the entry's lifetime or to
standing where the entry has none; a lifetime present and not exactly standing or goal, null
included, is a thrown error naming the field.

Returns a hashtable: Arguments is a string array; Environment is an ordered hashtable.
#>
function Build-SupervisorInvocation {
    param(
        [Parameter(Mandatory)][object]$Entry,
        [Parameter(Mandatory)][string]$RosterPath,
        [string]$RunDirectory
    )
    $name = [string]$Entry.name
    foreach ($required in @('name', 'workdir', 'permissionMode')) {
        $value = $Entry.$required
        if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) {
            throw "roster '$RosterPath' entry '$name' is missing the required field '$required'"
        }
    }
    $arguments = New-Object System.Collections.Generic.List[string]
    $arguments.Add((ConvertTo-BashPath ([string]$Entry.workdir)))
    $arguments.Add($name)
    $arguments.Add([string]$Entry.permissionMode)
    if (-not [string]::IsNullOrWhiteSpace([string]$Entry.rundir)) {
        $arguments.Add('--rundir'); $arguments.Add((ConvertTo-BashPath ([string]$Entry.rundir)))
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$Entry.channelName)) {
        $arguments.Add('--channel-name'); $arguments.Add([string]$Entry.channelName)
    }
    foreach ($extra in @($Entry.args)) {
        if ($null -eq $extra) { continue }
        $text = [string]$extra
        if ($text -eq '--prompt' -or $text.StartsWith('--prompt=')) {
            throw "roster '$RosterPath' entry '$name' carries --prompt in args, which the keeper refuses: every persona launches passive"
        }
        $arguments.Add($text)
    }

    $environment = [ordered]@{}
    $map = [ordered]@{
        model = 'MODEL'
        effort = 'EFFORT'
        controllerTickMs = 'controllerTickMs'
        nudgeFloorMs = 'nudgeFloorMs'
        nudgeIdleMs = 'nudgeIdleMs'
        memoryGateDiscardPercent = 'memoryGateDiscardPercent'
        channelLogRetentionDays = 'channelLogRetentionDays'
        journalRetentionDays = 'journalRetentionDays'
        coordinatorPersona = 'COORDINATOR_PERSONA'
        architectPersona = 'ARCHITECT_PERSONA'
        liaisonPersona = 'LIAISON_PERSONA'
        fleetRoster = 'FLEET_ROSTER'
        jevMode = 'JEV_MODE'
    }
    foreach ($field in $map.Keys) {
        $value = $Entry.$field
        if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) { continue }
        $environment[$map[$field]] = [string]$value
    }
    # jevLive is array-valued, so it cannot ride $map's loop above: a [string]
    # cast on an array joins with $OFS, a space by default, and both shell
    # halves split JEV_LIVE on commas, so a space-joined value would read back
    # as one bogus id and refuse the launch. An empty or absent array carries
    # nothing, the same "not set" state the loop above gives every other field.
    # A present field that is not an array, the likely typo of writing
    # jevLive as a bare string by analogy with the scalar jevMode beside it,
    # is thrown rather than silently dropped, the same rule Read-KeeperRoster
    # holds 'enabled' to: a field of the wrong type is told that instead of
    # being read as absent.
    $jevLiveProperty = $Entry.PSObject.Properties['jevLive']
    if ($null -ne $jevLiveProperty -and $null -ne $jevLiveProperty.Value -and $jevLiveProperty.Value -isnot [System.Array]) {
        throw "roster '$RosterPath' entry '$name' has a 'jevLive' field that is not a JSON array: write jevLive as an array, e.g. [`"turn-disposition`"]"
    }
    if ($Entry.jevLive -is [System.Array] -and $Entry.jevLive.Count -gt 0) {
        $environment['JEV_LIVE'] = ($Entry.jevLive | ForEach-Object { [string]$_ }) -join ','
    }
    # lifetime is a closed set compared byte-exact, the roster validator's rule,
    # so a value the validator would refuse is not read as standing here.
    $lifetimeProperty = $Entry.PSObject.Properties['lifetime']
    $lifetime = 'standing'
    if ($null -ne $lifetimeProperty) {
        $lifetime = $lifetimeProperty.Value
        if (-not ($lifetime -is [string] -and ($lifetime -ceq 'standing' -or $lifetime -ceq 'goal'))) {
            throw "roster '$RosterPath' entry '$name' has a 'lifetime' field that is not standing or goal"
        }
    }
    $goalProperty = $Entry.PSObject.Properties['goal']
    $hasGoal = $null -ne $goalProperty -and $null -ne $goalProperty.Value
    if ($hasGoal -and [string]::IsNullOrWhiteSpace($RunDirectory)) {
        throw "roster '$RosterPath' entry '$name' carries a 'goal' field and no -RunDirectory was given to write goal.json into"
    }
    if (-not [string]::IsNullOrWhiteSpace($RunDirectory)) {
        $goalPath = Join-Path $RunDirectory 'goal.json'
        if ($hasGoal) {
            # -InputObject rather than the pipeline, so the block is serialized as
            # the one object it is and its arrays stay arrays.
            $json = ConvertTo-Json -InputObject $goalProperty.Value -Depth 4
            [System.IO.File]::WriteAllText($goalPath, $json, [System.Text.UTF8Encoding]::new($false))
            $environment['GOAL_FILE'] = $goalPath
        } elseif (Test-Path -LiteralPath $goalPath -PathType Container) {
            throw "run directory '$RunDirectory' holds a goal.json that is not a file: remove it, since entry '$name' carries no goal"
        } elseif (Test-Path -LiteralPath $goalPath) {
            # A remove that fails stops the start, so a stale goal is never left
            # beside a launch that names none.
            try {
                Remove-Item -LiteralPath $goalPath -Force -ErrorAction Stop
            } catch {
                throw "could not remove the stale goal.json at '$goalPath': $($_.Exception.Message)"
            }
        }
    }
    $environment['LIFETIME'] = $lifetime
    # Every keeper-launched supervisor's run directory belongs to the roster,
    # so bin/supervise.sh is told to write settings.json fresh from this
    # environment at each start rather than keep a file an earlier start left.
    $environment['SETTINGS_FROM_ROSTER'] = '1'
    return @{ Arguments = $arguments.ToArray(); Environment = $environment }
}

<#
.SYNOPSIS
Quotes one argument for a native command line the way CreateProcess parsing expects.

.DESCRIPTION
A process is started from one command line rather than an argument array, so an argument carrying a
space (a workdir under a path with spaces) would arrive as two unless it is quoted here. An
argument with no space, tab or quote is passed as written. Every launch in this plugin that builds
a child's command line quotes through this one function, and Split-KeeperCommandLine below undoes
exactly what it writes, so a reader of the process list gets each argument back as it was given.
#>
function ConvertTo-NativeArgument {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
    if ($Text.Length -gt 0 -and $Text -notmatch '[\s"]') { return $Text }
    $escaped = $Text -replace '(\\*)"', '$1$1\"'
    $escaped = $escaped -replace '(\\+)$', '$1$1'
    return '"' + $escaped + '"'
}

<#
.SYNOPSIS
Splits a Windows command line into its tokens, the executable first.

.DESCRIPTION
A command line is one string that the process which started another wrote, and the reader has to
undo its quoting. The executable is read as CreateProcess reads it: up to the closing quote when it
opens with one, otherwise up to the first space or tab, with no backslash handling, since a path
such as "C:\Program Files\Git\bin\bash.exe" carries backslashes that escape nothing. Every later
token follows the Microsoft C runtime rules that ConvertTo-NativeArgument above
writes to: a space or tab outside quotes ends a token, a quote toggles quoting, a doubled quote
inside quotes is one literal quote, 2n backslashes before a quote are n backslashes and the quote
toggles, 2n+1 backslashes before a quote are n backslashes and a literal quote, and backslashes
before anything else are kept as written. An unclosed quote runs to the end of the line.

Returns a string array, empty for a blank line.
#>
function Split-KeeperCommandLine {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$CommandLine)
    $tokens = New-Object System.Collections.Generic.List[string]
    $text = $CommandLine
    $length = $text.Length
    $i = 0
    while ($i -lt $length -and ($text[$i] -eq [char]' ' -or $text[$i] -eq [char]"`t")) { $i++ }
    if ($i -ge $length) { return , $tokens.ToArray() }

    $token = New-Object System.Text.StringBuilder
    if ($text[$i] -eq [char]'"') {
        $i++
        while ($i -lt $length -and $text[$i] -ne [char]'"') { [void]$token.Append($text[$i]); $i++ }
        if ($i -lt $length) { $i++ }
    } else {
        while ($i -lt $length -and $text[$i] -ne [char]' ' -and $text[$i] -ne [char]"`t") { [void]$token.Append($text[$i]); $i++ }
    }
    $tokens.Add($token.ToString())

    while ($true) {
        while ($i -lt $length -and ($text[$i] -eq [char]' ' -or $text[$i] -eq [char]"`t")) { $i++ }
        if ($i -ge $length) { break }
        $token = New-Object System.Text.StringBuilder
        $quoted = $false
        while ($i -lt $length) {
            $c = $text[$i]
            if (-not $quoted -and ($c -eq [char]' ' -or $c -eq [char]"`t")) { break }
            if ($c -eq [char]'\') {
                $run = 0
                while ($i -lt $length -and $text[$i] -eq [char]'\') { $run++; $i++ }
                if ($i -lt $length -and $text[$i] -eq [char]'"') {
                    [void]$token.Append([char]'\', [int][Math]::Floor($run / 2))
                    if ($run % 2 -eq 1) { [void]$token.Append([char]'"'); $i++ }
                } else {
                    [void]$token.Append([char]'\', $run)
                }
                continue
            }
            if ($c -eq [char]'"') {
                if ($quoted -and $i + 1 -lt $length -and $text[$i + 1] -eq [char]'"') {
                    [void]$token.Append([char]'"'); $i += 2
                } else {
                    $quoted = -not $quoted; $i++
                }
                continue
            }
            [void]$token.Append($c); $i++
        }
        $tokens.Add($token.ToString())
    }
    return , $tokens.ToArray()
}

<#
.SYNOPSIS
Finds the live supervisor for this persona in a list of process records, or returns nothing.

.DESCRIPTION
Processes is a list of records carrying ProcessId, ParentProcessId and CommandLine, which is the
shape Get-CimInstance Win32_Process returns; a record with no command line is skipped. Executable
is the bash the wrapper launches with, and Arguments is the wrapper's full argument array: the
supervisor script path first, then what Build-SupervisorInvocation returned.

A record matches when its executable token equals Executable and the three tokens after it equal the
first three elements of Arguments, which are the supervise.sh path, the working directory and the
persona name. The executable is compared ignoring case and treating / and \ as the same character,
since the env file may spell the launcher either way, and nothing else about that path is
normalized. So Executable must be the full path the launcher runs as, spelled as its command line
carries it, since another spelling of the same file does not match. It is read because one
supervisor is three bash.exe processes carrying the same arguments: the Git launcher the keeper
starts and waits on, whose exit code is the supervisor's, and two MSYS bash.exe processes under it
spelled ..\usr\bin\bash.exe, one of them a long-lived fork. A fork orphaned by a supervisor that has
exited carries this persona's arguments with no live parent, and only the executable tells it from a
supervisor that is still running.

The three argument tokens are compared whole and ignoring case, as the roster lookup does, so dev
never matches dev-plugin. No later token is read, so a supervisor launched under an earlier roster,
with another channel name or extra arguments, still matches. The strings are compared in the forms
Build-SupervisorInvocation emits and no path is converted here, so a supervisor started under
another spelling of the same path does not match.

Among the matches, the record returned is the first whose parent is not itself a match, so a
launcher started from another launcher for the same persona yields the outer one.

Returns the matching record, or $null.
#>
function Find-KeeperLiveSupervisor {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Processes,
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(Mandatory)][string[]]$Arguments
    )
    $ignoreCase = [System.StringComparison]::OrdinalIgnoreCase
    $launcher = $Executable.Replace('/', '\')
    $matched = New-Object System.Collections.Generic.List[object]
    foreach ($record in $Processes) {
        if ($null -eq $record) { continue }
        $line = [string]$record.CommandLine
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        # A match's command line carries the script path as written, since a path holds no quote
        # for the tokenizer to undo, so a line without it is passed over before it is tokenized.
        if ($line.IndexOf($Arguments[0], $ignoreCase) -lt 0) { continue }
        $tokens = Split-KeeperCommandLine -CommandLine $line
        if ($tokens.Count -lt 4) { continue }
        if (-not [string]::Equals($tokens[0].Replace('/', '\'), $launcher, $ignoreCase)) { continue }
        $same = $true
        for ($k = 0; $k -lt 3; $k++) {
            if (-not [string]::Equals($tokens[$k + 1], $Arguments[$k], $ignoreCase)) { $same = $false; break }
        }
        if ($same) { $matched.Add($record) }
    }
    $matchedIds = @($matched | ForEach-Object { [string]$_.ProcessId })
    foreach ($record in $matched) {
        if ($matchedIds -notcontains [string]$record.ParentProcessId) { return $record }
    }
    return $null
}

# The two shapes a roster repo may take, the same two hooks/roster.ts's HTTPS_REPO_RE and
# SSH_REPO_RE admit: https://<host>/<path> with no userinfo, port, query or fragment, and
# git@<host>:<path>. A host is dot-separated labels of letters, digits and hyphens, neither
# starting nor ending with a hyphen. A path is slash-separated segments of letters, digits,
# underscore, hyphen and dot, each starting with something other than a dot, so no segment is .
# or .., with one trailing slash allowed. Anchored with \A and \z rather than ^ and $, since the
# .NET $ also matches before a trailing newline and the JavaScript $ does not.
$script:FleetRepoHostPattern = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*'
$script:FleetRepoSegmentPattern = '[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*'
$script:FleetRepoPathPattern = "$($script:FleetRepoSegmentPattern)(?:/$($script:FleetRepoSegmentPattern))*/?"
$script:FleetRepoHttpsPattern = "\Ahttps://(?:$($script:FleetRepoHostPattern))/(?:$($script:FleetRepoPathPattern))\z"
$script:FleetRepoSshPattern = "\Agit@(?:$($script:FleetRepoHostPattern)):(?:$($script:FleetRepoPathPattern))\z"

<#
.SYNOPSIS
Judges a roster repo value against the two shapes git may be handed, returning the refusal or nothing.

.DESCRIPTION
The fleet supervisor runs git clone on the value under the task account, so the value is checked
here, in the process that runs git, against the same two shapes the roster validator in
hooks/roster.ts admits: a roster hand-edited past that validator still cannot pass git an option
such as --upload-pack=x or a local path such as C:/anything. Neither shape can start with a
hyphen or name a local path. The host is unrestricted beyond its label shape, so a localhost or
an IP literal passes. The match is case-sensitive, as the validator's is, so the scheme and the
user are lower case; the host and the path may carry either case.

Returns $null for a value in one of the two shapes, else one line naming the rule, the same
sentence the validator's refusal carries.
#>
function Test-FleetRepoUrl {
    param([AllowNull()][AllowEmptyString()][string]$Url)
    $text = [string]$Url
    $options = [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
    if ([regex]::IsMatch($text, $script:FleetRepoHttpsPattern, $options) -or [regex]::IsMatch($text, $script:FleetRepoSshPattern, $options)) { return $null }
    return 'must be https://<host>/<path> with no userinfo, port, query or fragment, or git@<host>:<path>'
}

<#
.SYNOPSIS
Reads a KEY=value env file into an ordered hashtable.

.DESCRIPTION
Blank lines and lines whose first non-blank character is # are skipped. The first = is the
separator, so a value may itself contain = or ;. Key and value are both trimmed of surrounding
whitespace, since a space either side of the = is spacing in the file rather than part of a path,
and an untrimmed one reaches CreateProcess as a file name that does not exist. A line with no =, or
with nothing before it, is skipped. A key that appears twice takes the last
value and is named in the Duplicates list, so the caller can record that the earlier value was
overridden. The file is read as UTF-8 (Windows PowerShell 5.1 would otherwise read a BOM-less file
in the ANSI code page) and a read failure throws so the caller records it rather than treating the
file as empty.

A value wrapped in a matching pair of double or single quotes loses that pair and is named in the
Unquoted list. Quoting a path with spaces is how the same value would be written in a shell, and a
quoted value passed through as written reaches CreateProcess with the quotes inside the file name,
which fails as file-not-found. Only a matching outer pair is stripped: a value carrying one quote,
or two that do not match, is kept as written.

Returns a hashtable: Values is an ordered hashtable of key to value; Duplicates and Unquoted are
lists of key names.
#>
function Read-KeeperEnvFile {
    param([Parameter(Mandatory)][string]$Path)
    $result = [ordered]@{}
    $duplicates = New-Object System.Collections.Generic.List[string]
    $unquoted = New-Object System.Collections.Generic.List[string]
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8 -ErrorAction Stop) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
        $parts = $line -split '=', 2
        if ($parts.Count -ne 2) { continue }
        $key = $parts[0].Trim()
        if ($key.Length -eq 0) { continue }
        $value = $parts[1].Trim()
        if ($value.Length -ge 2 -and ($value[0] -eq '"' -or $value[0] -eq "'") -and $value[-1] -eq $value[0]) {
            $value = $value.Substring(1, $value.Length - 2)
            if (-not $unquoted.Contains($key)) { $unquoted.Add($key) }
        }
        if ($result.Contains($key) -and -not $duplicates.Contains($key)) { $duplicates.Add($key) }
        $result[$key] = $value
    }
    return @{ Values = $result; Duplicates = $duplicates; Unquoted = $unquoted }
}

<#
.SYNOPSIS
Reads the roster file and returns every entry, enabled or not.

.DESCRIPTION
The fleet supervisor's reader: where Read-KeeperRoster answers for one name, this returns the whole
array, since the fleet supervisor decides for every entry and for every keeper whose entry is gone.
The file is read as UTF-8. A file that cannot be read or parsed, and one whose JSON is not an array,
are each a thrown error naming the roster path, so the caller logs the fault and leaves every live
keeper alone until the next tick. No entry is validated here: an entry's name, enabled field and
directories are judged per entry by the caller, so one bad entry costs that entry alone.

Returns an array of entry objects, empty for an empty array.
#>
function Read-FleetRoster {
    param([Parameter(Mandatory)][string]$Path)
    try {
        $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop
        $parsed = ConvertFrom-Json -InputObject $raw -ErrorAction Stop
    } catch {
        throw "roster '$Path' could not be read: $($_.Exception.Message)"
    }
    if ($parsed -isnot [System.Array]) {
        throw "roster '$Path' reads as not an array: write a JSON array of entry objects"
    }
    # Windows PowerShell 5.1 returns a JSON array as one object[] rather than enumerating it, so it
    # is piped through ForEach-Object, which enumerates, before it is wrapped as a list.
    return , @($parsed | ForEach-Object { $_ })
}

<#
.SYNOPSIS
Returns the text that identifies what a keeper was started on: every field of the entry except enabled.

.DESCRIPTION
The fields are written as compact JSON in ordinal name order, so two entries carrying the same
values in another order fingerprint the same. enabled is left out because a flip of it is decided
as a retire or a start before any fingerprint is compared, so it reads as one action rather than a
retire followed by a restart on the new values.
#>
function Get-FleetEntryFingerprint {
    param([Parameter(Mandatory)][object]$Entry)
    $names = @($Entry.PSObject.Properties | ForEach-Object { $_.Name } | Where-Object { $_ -ne 'enabled' })
    [Array]::Sort($names, [System.StringComparer]::Ordinal)
    $ordered = [ordered]@{}
    foreach ($name in $names) { $ordered[$name] = $Entry.$name }
    return ConvertTo-Json -InputObject $ordered -Compress -Depth 10
}

<#
.SYNOPSIS
Reads the persona name a keeper's command line names, or returns nothing for a line that is no keeper's.

.DESCRIPTION
A keeper is a process whose command line carries one of LauncherNames as the file name of some
token, the path as the scheduler or the fleet supervisor wrote it, and a -Name token followed by a
value. The line is tokenized with Split-KeeperCommandLine, so a quoted path with spaces is one token
and the value comes back as it was given. The file name is the token's text after its last \ or /,
compared whole and ignoring case, so a token that merely contains a launcher's name inside a longer
file name is not it. -Name is compared ignoring case, as PowerShell binds it. A -Name with no value
after it, or one whose next token opens with a hyphen, names nothing. The fleet supervisor's own
line carries a launcher path after -KeeperLauncher and no -Name, so it names nothing either. A line
carrying -Release is the launcher's one-shot marker release, which exits without keeping anything,
so it names nothing.

Returns the -Name value, or $null.
#>
function Get-FleetKeeperName {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$CommandLine,
        [Parameter(Mandatory)][string[]]$LauncherNames
    )
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $null }
    $ignoreCase = [System.StringComparison]::OrdinalIgnoreCase
    $carries = $false
    foreach ($launcher in $LauncherNames) {
        if ($CommandLine.IndexOf($launcher, $ignoreCase) -ge 0) { $carries = $true; break }
    }
    if (-not $carries) { return $null }
    $tokens = Split-KeeperCommandLine -CommandLine $CommandLine
    $launched = $false
    foreach ($token in $tokens) {
        $leaf = $token.Substring($token.LastIndexOfAny([char[]]@('\', '/')) + 1)
        foreach ($launcher in $LauncherNames) {
            if ([string]::Equals($leaf, $launcher, $ignoreCase)) { $launched = $true; break }
        }
        if ($launched) { break }
    }
    if (-not $launched) { return $null }
    foreach ($token in $tokens) {
        if ([string]::Equals($token, '-Release', $ignoreCase)) { return $null }
    }
    for ($k = 0; $k -lt $tokens.Count - 1; $k++) {
        if ([string]::Equals($tokens[$k], '-Name', $ignoreCase)) {
            $value = $tokens[$k + 1]
            if ($value.Length -eq 0 -or $value.StartsWith('-')) { return $null }
            return $value
        }
    }
    return $null
}

<#
.SYNOPSIS
Finds the live keeper for one persona in a list of process records, or returns nothing.

.DESCRIPTION
Processes is a list of records carrying ProcessId, ParentProcessId and CommandLine, the shape
Get-CimInstance Win32_Process returns; a record with no command line is skipped. A record matches
when Get-FleetKeeperName reads Name off its command line, compared whole and ignoring case as the
roster lookup compares, so alpha never matches alpha2. Find-KeeperLiveSupervisor is not reused here
because it compares the three tokens after the executable, and a keeper's line opens with the
PowerShell switches before the script path.

Among the matches, the record returned is the first whose parent is not itself a match, so a
keeper started through a shell wrapper yields the outer process.

Returns the matching record, or $null.
#>
function Find-FleetLiveKeeper {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Processes,
        [Parameter(Mandatory)][string[]]$LauncherNames,
        [Parameter(Mandatory)][string]$Name
    )
    $matched = New-Object System.Collections.Generic.List[object]
    foreach ($record in $Processes) {
        if ($null -eq $record) { continue }
        $found = Get-FleetKeeperName -CommandLine ([string]$record.CommandLine) -LauncherNames $LauncherNames
        if ($null -ne $found -and [string]::Equals($found, $Name, [System.StringComparison]::OrdinalIgnoreCase)) { $matched.Add($record) }
    }
    $matchedIds = @($matched | ForEach-Object { [string]$_.ProcessId })
    foreach ($record in $matched) {
        if ($matchedIds -notcontains [string]$record.ParentProcessId) { return $record }
    }
    return $null
}

<#
.SYNOPSIS
Decides what the fleet supervisor does for one persona this tick, from the roster, the state record, the live keeper and the markers.

.DESCRIPTION
Present and Enabled are the roster's reading of the entry; Fingerprint is Get-FleetEntryFingerprint
of the entry where present. Record is the entry's fleet-state.json record or $null, read for its
action, pid, fingerprint, nextDelaySeconds, notBefore and retireRequestedAt. LiveProcessId is the
live keeper's id or $null. HoldPresent, RetiredPresent, RequestPresent and BootCurrent say whether
the run directory holds keeper.hold, the fleet supervisor's own fleet.retired sidecar, a
shutdown.request, and a keeper.boot naming the current boot. UptimeSeconds is how long the keeper
the record names lived where it has exited, and -1 where no such keeper is known.

The rows, in the order they are tried. A live keeper the record is already retiring is left alone
until RetireBoundSeconds have passed since the request, which is recorded once as retire-timeout
and then left alone again; an entry absent or disabled with any other live keeper is retired, and
a live keeper the record does not name is adopted, clearing a sidecar no shutdown.request is still
in flight beside; a live keeper whose entry's fingerprint differs from the one it started on is
retired, so the next ticks restart it on the new values. With no
live keeper: a retire in flight has completed, which is retired; an entry not wanted is retired
with nothing written where its record says otherwise, and is otherwise nothing; a run directory
holding the sidecar is released and started, since the fleet supervisor wrote that sidecar when
it asked the keeper to stop; a hold with no sidecar, the keeper's own policy hold or the operator's,
is held; a boot marker
naming this boot is parked; a keeper that exited inside the quick-exit uptime waits the ladder's
delay and doubles it up to the cap, one that lived the reset uptime puts the ladder back at the
base, and any other exit starts at once; a backoff, or a clone-failed, whose time has not come
is nothing; and everything else starts. A clone-failed record is the fleet supervisor's own, written
where an entry's repository could not be cloned before its first start, and it waits out its
notBefore as a backoff does, carrying the same ladder. held, parked and retired are recorded once,
so a second tick in the same state is nothing. Only the sidecar and the request count with a live
keeper, since a live keeper is the truth about the rest of its own run directory.

Returns a hashtable: Action is one of none, start, adopted, retire, retire-timeout, retired, held,
parked and backoff; Reason is one line of text fit for the log; Release says a start removes
shutdown.request, keeper.hold and fleet.retired first; ClearRetired says an adoption removes a
stale sidecar; DelaySeconds is a backoff's wait; NextDelaySeconds is the ladder value to carry,
which a start after a failed clone reads as the delay the next failure waits.
#>
function Get-FleetDecision {
    param(
        [Parameter(Mandatory)][bool]$Present,
        [Parameter(Mandatory)][bool]$Enabled,
        [AllowNull()][AllowEmptyString()][string]$Fingerprint,
        [AllowNull()][object]$Record,
        [AllowNull()][object]$LiveProcessId,
        [Parameter(Mandatory)][bool]$HoldPresent,
        [Parameter(Mandatory)][bool]$RetiredPresent,
        [Parameter(Mandatory)][bool]$RequestPresent,
        [Parameter(Mandatory)][bool]$BootCurrent,
        [Parameter(Mandatory)][int]$UptimeSeconds,
        [Parameter(Mandatory)][DateTime]$Now,
        [Parameter(Mandatory)][int]$RetireBoundSeconds
    )
    $wanted = $Present -and $Enabled
    $ladder = $script:FleetBaseDelaySeconds
    $recordAction = ''
    $recordPid = -1
    $recordFingerprint = $null
    if ($null -ne $Record) {
        $recordAction = [string]$Record.action
        if ($null -ne $Record.pid -and [string]$Record.pid -ne '') { $recordPid = [int]$Record.pid }
        if ($null -ne $Record.nextDelaySeconds -and [string]$Record.nextDelaySeconds -ne '') { $ladder = [int]$Record.nextDelaySeconds }
        if ($null -ne $Record.fingerprint) { $recordFingerprint = [string]$Record.fingerprint }
    }
    if ($ladder -lt $script:FleetBaseDelaySeconds) { $ladder = $script:FleetBaseDelaySeconds }
    $retireInFlight = $recordAction -eq 'retiring' -or $recordAction -eq 'retire-timeout'
    $notWantedReason = if (-not $Present) { 'the entry has left the roster' } else { 'the entry reads enabled false' }
    $result = @{ Action = 'none'; Reason = ''; Release = $false; ClearRetired = $false; DelaySeconds = 0; NextDelaySeconds = $ladder }

    if ($null -ne $LiveProcessId) {
        $samePid = $recordPid -eq [int]$LiveProcessId
        if ($retireInFlight -and $samePid) {
            if ($recordAction -eq 'retiring') {
                $requested = ConvertTo-FleetUtcTime $Record.retireRequestedAt
                if ($null -ne $requested -and ($Now - $requested).TotalSeconds -ge $RetireBoundSeconds) {
                    $result.Action = 'retire-timeout'
                    $result.Reason = "still live $RetireBoundSeconds s after the shutdown request, left alone until it exits"
                }
            }
            return $result
        }
        if (-not $wanted) {
            $result.Action = 'retire'; $result.Reason = $notWantedReason
            return $result
        }
        if (-not $samePid) {
            $result.Action = 'adopted'; $result.ClearRetired = $RetiredPresent -and -not $RequestPresent
            $result.Reason = 'a live keeper the state did not name'
            return $result
        }
        if ($Fingerprint -ne $recordFingerprint) {
            $result.Action = 'retire'; $result.Reason = 'the entry changed since its keeper started'
            return $result
        }
        return $result
    }

    if ($retireInFlight) {
        $result.Action = 'retired'; $result.Reason = 'the keeper exited after the shutdown request'
        return $result
    }
    if (-not $wanted) {
        if ($null -ne $Record -and $recordAction -ne 'retired') {
            $result.Action = 'retired'; $result.Reason = "$notWantedReason and no keeper is live, nothing written"
        }
        return $result
    }
    if ($RetiredPresent) {
        $result.Action = 'start'; $result.Release = $true
        $result.Reason = 'released: fleet.retired marks the hold as this fleet supervisor''s own'
        return $result
    }
    if ($HoldPresent) {
        if ($recordAction -ne 'held') { $result.Action = 'held'; $result.Reason = 'keeper.hold with no fleet.retired beside it, the keeper''s own policy hold or the operator''s' }
        return $result
    }
    if ($BootCurrent) {
        if ($recordAction -ne 'parked') { $result.Action = 'parked'; $result.Reason = 'keeper.boot names the current boot' }
        return $result
    }
    if ($recordAction -eq 'started' -or $recordAction -eq 'adopted') {
        if ($UptimeSeconds -ge 0 -and $UptimeSeconds -lt $script:FleetQuickExitSeconds) {
            $next = $ladder * 2
            if ($next -gt $script:FleetMaxDelaySeconds) { $next = $script:FleetMaxDelaySeconds }
            $result.Action = 'backoff'; $result.DelaySeconds = $ladder; $result.NextDelaySeconds = $next
            $result.Reason = "the keeper exited after $UptimeSeconds s on no marker, next start in $ladder s"
            return $result
        }
        $result.Action = 'start'
        if ($UptimeSeconds -ge $script:KeeperResetUptimeSeconds) {
            $result.NextDelaySeconds = $script:FleetBaseDelaySeconds
            $result.Reason = "the keeper exited after $UptimeSeconds s, ladder reset"
        } else {
            $result.Reason = "the keeper exited after $UptimeSeconds s"
        }
        return $result
    }
    if ($recordAction -eq 'backoff' -or $recordAction -eq 'clone-failed') {
        $notBefore = ConvertTo-FleetUtcTime $Record.notBefore
        if ($null -ne $notBefore -and $Now -lt $notBefore) { return $result }
        $result.Action = 'start'
        $result.Reason = if ($recordAction -eq 'backoff') { 'the backoff delay has passed' } else { 'the clone retry delay has passed' }
        return $result
    }
    $result.Action = 'start'
    $result.Reason = if ($null -eq $Record) { 'no keeper is live and no state record names one' } else { "no keeper is live after $recordAction" }
    return $result
}

<#
.SYNOPSIS
Reads a time the fleet state carries as UTC, or returns nothing for an absent or unreadable one.

.DESCRIPTION
The state file writes every time as an ISO 8601 round-trip string, and ConvertFrom-Json under
Windows PowerShell 5.1 hands such a string back as a local DateTime, so a value may arrive as
either. A string is parsed with the invariant culture keeping its offset, and both forms are
returned as UTC.
#>
function ConvertTo-FleetUtcTime {
    param([AllowNull()][object]$Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [DateTime]) { return $Value.ToUniversalTime() }
    $parsed = [DateTime]::MinValue
    if ([DateTime]::TryParse([string]$Value, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsed)) {
        return $parsed.ToUniversalTime()
    }
    return $null
}
