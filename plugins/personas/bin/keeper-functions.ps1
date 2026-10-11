# Pure functions shared by the process keeper's scripts. Dot-sourced by bin/Start-Persona.ps1 (the
# wrapper the scheduled task runs) and bin/keeper-probe.ps1 (the recorder that measures what a
# task delivers), so the allowlist, the env file reader, the roster reader, the supervisor
# invocation builder, the live supervisor match and the exit-code policy each exist once.
#
#   . (Join-Path $PSScriptRoot 'keeper-functions.ps1')
#
# Nothing here writes a file, sets an environment variable or launches a process. A function that
# cannot produce its answer throws, and the error names the path it was reading, so the caller
# logs it and decides what to do. Both callers run under Windows PowerShell 5.1.

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

<#
.SYNOPSIS
Decides what the keeper does after one supervisor exit, from the exit code and the run's shape.

.DESCRIPTION
Implements the policy table: exit 0 holds; exit 6 parks; exit 1 relaunches after the base delay
and holds once the consecutive short exit-1 count reaches the hold count; exit 2 relaunches after
the base delay with the ladder untouched; 130 and 143 exit without relaunching; every other code
relaunches after the current delay and doubles it up to the cap. A run that lasted the reset uptime
or longer puts the ladder back at the base before the row is applied, so a persona that ran for an
hour and then crashed waits the base delay, not whatever the ladder had climbed to.

Returns a hashtable: Action is 'hold', 'park', 'relaunch' or 'exit'; DelaySeconds is how long to
wait before the next launch (0 when not relaunching); NextDelaySeconds is the ladder value to carry
into the next decision; NextExit1Count is the consecutive short exit-1 count to carry; Reason is one
line of text with no newline, fit for the DECIDE log line and the hold and park markers. A park
stops the wrapper as a hold does, and differs in that the wrapper's next start clears it and
launches, where a hold stops every later start until it is released.
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
                Reason = "supervisor exited 6: parked, relaunched at the keeper's next start"
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
variables, each present only where the entry carries the field. jevLive is an
array of question-set ids rather than a scalar, so it does not ride that same field map: a
non-empty array becomes JEV_LIVE as its members joined with a comma, since the shell halves that
read JEV_LIVE split on commas, and PowerShell's own [string] cast on an array joins with $OFS
(a space by default) instead. A jevLive field present and not a JSON array is thrown rather than
read as empty, naming the roster path, the persona and the field, the same rule Read-KeeperRoster
holds 'enabled' to. A missing required field, or an args element that is --prompt or
starts with --prompt=, is a thrown error naming the roster path, because the roster launches every
persona passive and a prompt is not a thing a boot-time relaunch may carry.

Returns a hashtable: Arguments is a string array; Environment is an ordered hashtable.
#>
function Build-SupervisorInvocation {
    param(
        [Parameter(Mandatory)][object]$Entry,
        [Parameter(Mandatory)][string]$RosterPath
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
    return @{ Arguments = $arguments.ToArray(); Environment = $environment }
}

<#
.SYNOPSIS
Splits a Windows command line into its tokens, the executable first.

.DESCRIPTION
A command line is one string that the process which started another wrote, and the reader has to
undo its quoting. The executable is read as CreateProcess reads it: up to the closing quote when it
opens with one, otherwise up to the first space or tab, with no backslash handling, since a path
such as "C:\Program Files\Git\bin\bash.exe" carries backslashes that escape nothing. Every later
token follows the Microsoft C runtime rules that ConvertTo-NativeArgument in bin/Start-Persona.ps1
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
