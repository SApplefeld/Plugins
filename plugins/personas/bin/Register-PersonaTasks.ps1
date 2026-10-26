# Registers, updates and reports on the one Windows scheduled task, AgentFleet, that runs the fleet
# supervisor at boot, and reports on or removes the AgentPersona-* tasks beside it.
#
#   .\bin\Register-PersonaTasks.ps1 [-Roster <path>] [-EnvFile <path>] [-RepoRoot <path>]
#       [-LauncherRoot <path>] [-User <name>] [-Credential <pscredential>]
#       [-StartupDelay <ISO 8601 duration>]
#       [-RetryInterval <ISO 8601 duration>] [-RetryWindow <ISO 8601 duration>]
#       [-Prune] [-Start] [-WhatIf]
#
# Requires an elevated PowerShell session, the same requirement
# D:/discord-channels/install/Register-BrokerTask.ps1 carries for the same reason: registering a
# scheduled task under the Task Scheduler root fails without it, with an access-denied error that
# does not say why. -WhatIf is the unelevated inspection path: it reads the roster, builds the
# task definition, reads the scheduler for the tasks that already exist, and prints what it would
# do. It skips the elevation throw entirely, because it calls no ScheduledTasks cmdlet that writes,
# so there is nothing for the throw to protect on that path.
#
# The task's action runs bin/Start-Fleet.ps1 with -Roster and -EnvFile. The fleet supervisor reads
# the roster every tick and starts one keeper per enabled entry (its own header says how), so which
# personas run is the roster's business, and no entry has a task of its own: a disabled entry is
# one the fleet supervisor leaves stopped. An existing AgentFleet task is updated with
# Set-ScheduledTask rather than unregistered and re-registered, for the same reason the broker
# script gives: unregister-then-register leaves nothing behind if the process is interrupted
# between the two calls, which is worse than the duplicate-name problem removing first was meant
# to solve. Every task named AgentPersona-* is an orphan, since no roster entry is a task: reported
# always, unregistered only when -Prune is given, because an unregister is the one destructive act
# this script can take and it runs only on an explicit request. The orphan pass runs after
# AgentFleet is written, so a run interrupted between the two still leaves the fleet task in place.
#
# -RepoRoot pins the absolute path to this checkout into the task's own action, the same reason
# the broker script pins -EnvFile: the task runs outside any interactive logon, where a relative
# path resolves against nothing reliable. Left unbound, it resolves in the script body, after the
# param block runs, to the parent of this script's own directory. That default is right when the
# operator runs this script from `<checkout>/plugins/personas` in the repository checkout and wrong from a worktree,
# since a task pointed at a worktree breaks when that worktree is removed. A -RepoRoot under a
# plugins\marketplaces or plugins\cache folder, given or defaulted, is refused unless -LauncherRoot
# is given, before the password prompt, since a plugin update replaces both folders under a running
# supervisor and a task pinned there breaks that update. The read of the existing tasks also reports,
# printed under -WhatIf and on a real run alike, an AgentFleet or AgentPersona-* task whose action's
# -File path already sits under such a folder: the AgentFleet line says this run repoints it, since
# the update in place replaces the action. An orphan left in place keeps its action, so its line
# says nothing repoints it, beside its orphan line. An orphan under -Prune gets no line, since the
# run unregisters it, or would under -WhatIf.
#
# -LauncherRoot runs the fleet from the installed personas plugin instead of a checkout. The script
# copies bin/Start-InstalledFleet.ps1, bin/Start-InstalledPersona.ps1 and the shared
# bin/installed-plugin-functions.ps1 both dot-source into that folder and points the task's action
# at the fleet launcher copy. That launcher runs the installed plugin's current version from a
# snapshot under <LauncherRoot>\runtime and starts each keeper through the persona launcher copy
# (each launcher's own header says how). It is the route for a machine that has the plugin and no
# repository: run this script from the installed plugin's folder, whose bin holds all four files. A
# folder inside the plugin folder, the marketplace or the plugin cache is refused, since a plugin update replaces
# both. -WhatIf prints the copies it would make and makes none.
#
# -StartupDelay holds the task back after its boot trigger fires, so the channel broker's own boot
# task (D:/discord-channels/install/Register-BrokerTask.ps1, which fires at PT30S) has started node
# and logged in to Discord before any persona child attaches its channel. The value is an ISO 8601
# duration of hours, minutes and seconds; the default is PT2M, written once as
# $KeeperDefaultStartupDelay below.
#
# -RetryInterval and -RetryWindow make the boot trigger repeat: after its first fire the trigger
# fires again every -RetryInterval for -RetryWindow, so a task whose logon failed at boot is
# started by a later fire, since the scheduler's restart-on-failure setting does not retry a logon
# that failed. The repetition does not stop a running fleet supervisor when the window ends. The
# defaults are PT5M and PT1H, written once as $KeeperDefaultRetryInterval and
# $KeeperDefaultRetryWindow below. -RetryInterval is refused below one minute or above 31 days,
# and -RetryWindow below -RetryInterval or above 31 days, before the password prompt.
# A fire that finds the task still running is ignored by
# -MultipleInstances IgnoreNew. A trigger lives in the scheduler, so a machine takes a changed
# delay or repetition only when this script is run on it again.
#
# The task is registered with the Password logon type, which is what lets each persona's git, run
# under a keeper the fleet supervisor starts within the task's logon, reach Windows Credential
# Manager, Git Credential Manager's store and the Azure CLI token cache. Those all sit behind the
# account's user-scope DPAPI key, and Windows unlocks that key at task start only when the
# scheduler holds the account's password. Under the S4U logon the broker's task uses, no password
# is stored and user-scope DPAPI returns access denied, so every credential store the operator's
# own session reads is unreadable to the persona. -Credential carries that password. Left unbound
# on a real run from an elevated session, the script prompts for it with Get-Credential for -User;
# it is never taken from the command line, a file or the environment. -WhatIf never prompts, since
# it writes nothing. The cost of this logon type is that a change to the account's password stops
# the task until this script runs again.
#
# [CmdletBinding()] is what makes an unknown switch a binding error (exit 1) rather than a value
# that lands in $args while the body runs anyway.
[CmdletBinding()]
param(
    [string]$Roster = 'D:/personas/fleet.json',
    [string]$EnvFile = 'D:/personas/keeper.env',
    [string]$RepoRoot,
    [string]$LauncherRoot,
    [string]$User = [Security.Principal.WindowsIdentity]::GetCurrent().Name,
    [pscredential]$Credential,
    [string]$StartupDelay,
    [string]$RetryInterval,
    [string]$RetryWindow,
    [switch]$Prune,
    [switch]$Start,
    [switch]$WhatIf
)

# The one place each default is written. The script body fills an unbound -StartupDelay,
# -RetryInterval or -RetryWindow from its variable, and both functions below take them as their
# parameter defaults, so a caller reaching either function directly gets the same values the
# script run does.
$KeeperDefaultStartupDelay = 'PT2M'
$KeeperDefaultRetryInterval = 'PT5M'
$KeeperDefaultRetryWindow = 'PT1H'

# The one task this script registers, and the name pattern of the tasks it treats as orphans.
$FleetTaskName = 'AgentFleet'
$OrphanTaskPattern = 'AgentPersona-*'

# $PluginInstallFolderPattern, the folders a plugin update replaces, is written once in the shared
# functions file beside this script, which a -LauncherRoot run also copies beside the launcher.
# Confirm-RepoRootOutsidePluginInstall tests -RepoRoot against it, Get-PersonaTaskDefinitions tests
# -LauncherRoot against it, and Get-PluginInstallActionFile tests an existing task's action path.
if (-not (Test-Path -LiteralPath "$PSScriptRoot\installed-plugin-functions.ps1" -PathType Leaf)) {
    throw "Register-PersonaTasks: '$PSScriptRoot\installed-plugin-functions.ps1' does not exist; " +
        "it ships beside this script in the personas plugin's bin folder."
}
. "$PSScriptRoot\installed-plugin-functions.ps1"

<#
.SYNOPSIS
Returns the value as a TimeSpan, throwing unless it is an ISO 8601 duration of hours, minutes and
seconds, naming the parameter.

.DESCRIPTION
Uppercase PT, then hours, minutes and seconds with at least one digit, is the whole class this
script admits; -cnotmatch because -notmatch ignores case and would pass pt2m through to the
scheduler. A value of that shape too large for a TimeSpan takes the same refusal rather than the
conversion's own unnamed error. Every duration parameter is checked here, where the operator is
watching, rather than left for Register-ScheduledTask to refuse at the write or for the task engine
to misread at boot.
#>
function ConvertFrom-IsoDuration {
    param([Parameter(Mandatory)][string]$ParameterName, [AllowNull()][AllowEmptyString()][string]$Value)
    $refusal = "Get-PersonaTaskDefinitions: -$ParameterName '$Value' must be an ISO 8601 " +
        "duration of hours, minutes and seconds, such as PT2M or PT1M30S."
    if ($Value -cnotmatch '\APT(?:\d+H)?(?:\d+M)?(?:\d+S)?\z' -or $Value -notmatch '\d') {
        throw $refusal
    }
    try {
        return [System.Xml.XmlConvert]::ToTimeSpan($Value)
    } catch {
        throw $refusal
    }
}

<#
.SYNOPSIS
Writes a TimeSpan as an ISO 8601 duration of hours, minutes and seconds, in the form the scheduler
prints it back.

.DESCRIPTION
Hours carry every whole hour, so a day is 24H and never a D designator, and a part that is zero is
left out: 105 seconds is PT1M45S, 120 seconds is PT2M and a zero span is PT0S.
#>
function Format-IsoDuration {
    param([Parameter(Mandatory)][TimeSpan]$Span)
    $hours = [int][math]::Floor($Span.TotalHours)
    $text = 'PT'
    if ($hours -gt 0) { $text += "$($hours)H" }
    if ($Span.Minutes -gt 0) { $text += "$($Span.Minutes)M" }
    if ($Span.Seconds -gt 0) { $text += "$($Span.Seconds)S" }
    if ($text -eq 'PT') { $text = 'PT0S' }
    return $text
}

<#
.SYNOPSIS
True when the current process is running elevated.
#>
function Test-IsElevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

<#
.SYNOPSIS
Resolves a possibly-relative path to an absolute one, against the caller's own location.

.DESCRIPTION
GetUnresolvedProviderPathFromPSPath resolves a relative path against PowerShell's own current
location rather than the .NET process directory, which is what makes a relative -Roster resolve
against where the operator is standing rather than some other root. GetFullPath afterward collapses
any `..` or `.` segments and normalizes the separators, so the path that lands in a task's action
string is always the same canonical form regardless of how it was typed. The trailing separator
GetFullPath leaves on an input like `<checkout>/plugins/personas/` is trimmed off, since a task action built
from that path must compose with a further segment the same way whether or not the operator typed
one; a bare drive root (`D:` after trimming) gets its separator put back, because a drive letter
with no trailing separator names the current directory on that drive to .NET, not the root.
#>
function Resolve-AbsolutePath {
    param([Parameter(Mandatory)][string]$Path)
    $unresolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    $resolved = [IO.Path]::GetFullPath($unresolved)
    $trimmed = $resolved.TrimEnd('\', '/')
    if ($trimmed -match '^[A-Za-z]:$') { $trimmed += '\' }
    return $trimmed
}
<#
.SYNOPSIS
Reads and validates the roster JSON array, throwing on every shape the fleet supervisor would
refuse to start a keeper from.

.DESCRIPTION
The task's action names the roster and the fleet supervisor reads it at every tick, so a roster it
would log as an error at boot is refused here, where the operator is watching. The file must exist,
parse as JSON, and hold a top-level array. That array check reads the raw text rather than the
parsed result, because a top-level JSON object parses to a single PSCustomObject which `@($parsed)`
below then wraps into a one-element array, and that reads as one valid roster entry. Every entry
must carry `name` and `enabled`; a `name` outside letters, digits, underscore and hyphen is refused
here, the same character class valid_persona_name in bin/agentic-common.sh accepts. A name starting
with a hyphen is refused too, which valid_persona_name alone would not catch, because that name
reaches a keeper's command line as the value after -Name, where a leading hyphen could compose as a
second flag rather than a value; valid_persona_name has no such command-line boundary to protect and
so places no restriction on the first character, and a leading underscore is accordingly accepted
here exactly as it is there. \A...\z (rather than ^...$) refuses a name ending in a newline, which
^...$ alone would still pass under .NET's regex engine. `enabled` must be a JSON boolean, not merely
present, because PowerShell's truthiness reads the string "false" as true; a JSON `null` is reported
by name rather than by its .NET type, since a null value has no type to read here. A `name` repeated
across two entries is refused too, naming the roster path, since the fleet supervisor leaves every
entry carrying a repeated name alone.
#>
function Read-PersonaRoster {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Read-PersonaRoster: roster not found at '$Path'."
    }
    try {
        $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop
    } catch {
        throw "Read-PersonaRoster: could not read roster '$Path': $($_.Exception.Message)"
    }
    # Get-Content -Raw on a zero-byte file returns $null under Windows PowerShell 5.1 rather than an
    # empty string, so the null-or-whitespace check runs before TrimStart and keeps an empty roster
    # on this same refusal instead of the engine's own null-valued-expression error.
    if ([string]::IsNullOrWhiteSpace($text) -or -not $text.TrimStart().StartsWith('[')) {
        throw "Read-PersonaRoster: roster '$Path' must be a top-level JSON array."
    }
    try {
        $parsed = ConvertFrom-Json -InputObject $text -ErrorAction Stop
    } catch {
        throw "Read-PersonaRoster: roster '$Path' is not valid JSON: $($_.Exception.Message)"
    }
    $entries = @($parsed)
    # OrdinalIgnoreCase: the fleet supervisor compares roster names ignoring case, as Windows does
    # the run directories and keeper command lines a name reaches, so two entries differing only in
    # case ("alpha", "Alpha") are one name repeated and are refused here.
    $seenNames = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $entries) {
        $propertyNames = @($entry.PSObject.Properties.Name)
        if ($propertyNames -notcontains 'name') {
            throw "Read-PersonaRoster: an entry in roster '$Path' is missing 'name'."
        }
        if ($propertyNames -notcontains 'enabled') {
            throw "Read-PersonaRoster: entry '$($entry.name)' in roster '$Path' is missing 'enabled'."
        }
        if ($entry.name -notmatch '\A[A-Za-z0-9_][A-Za-z0-9_-]*\z') {
            throw "Read-PersonaRoster: entry name '$($entry.name)' in roster '$Path' must start " +
                "with a letter, digit or underscore and hold only letters, digits, underscore and " +
                "hyphen after that."
        }
        if ($null -eq $entry.enabled) {
            throw "Read-PersonaRoster: entry '$($entry.name)' in roster '$Path' field 'enabled' " +
                "must be a JSON boolean, not null."
        }
        if ($entry.enabled -isnot [bool]) {
            throw "Read-PersonaRoster: entry '$($entry.name)' in roster '$Path' field 'enabled' " +
                "must be a JSON boolean, not $($entry.enabled.GetType().Name)."
        }
        if (-not $seenNames.Add([string]$entry.name)) {
            throw "Read-PersonaRoster: roster '$Path' has more than one entry named '$($entry.name)'."
        }
    }
    # The unary comma prevents PowerShell's own pipeline unwrapping from collapsing a 0- or
    # 1-element array back to $null or a scalar on return, so a caller reads an array for every
    # roster, an empty one included.
    return ,$entries
}

<#
.SYNOPSIS
Throws when -RepoRoot sits under a plugin marketplace or plugin cache folder and no -LauncherRoot
is given.

.DESCRIPTION
A task action that names the plugin folder runs the fleet supervisor from a folder a plugin update
replaces, so the update fails or pulls the supervisor's files from under it. With -LauncherRoot
the action names the launcher and -RepoRoot is the installed plugin folder by design, so the test is skipped.
The canonical path has a separator appended and is matched for a plugins\marketplaces\ or
plugins\cache\ segment pair under either separator, so a folder whose name merely starts with
marketplaces or cache is no match. This is the one place the test is written;
Get-PersonaTaskDefinitions calls it for a direct caller and the script body calls it before the
password prompt.
#>
function Confirm-RepoRootOutsidePluginInstall {
    param([Parameter(Mandatory)][string]$RepoRoot, [string]$LauncherRoot)
    if (-not [string]::IsNullOrEmpty($LauncherRoot)) { return }
    $repoFull = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\', '/') + '\'
    if ($repoFull -match $PluginInstallFolderPattern) {
        throw "Confirm-RepoRootOutsidePluginInstall: -RepoRoot '$RepoRoot' sits under a plugins\marketplaces " +
            "or plugins\cache folder, which a plugin update replaces under a running supervisor. Pass " +
            "-LauncherRoot naming a folder outside both, such as one under the account's profile, or " +
            "run from a checkout."
    }
}

<#
.SYNOPSIS
Returns the -File path of a task action's argument string when it sits under a plugins\marketplaces
or plugins\cache folder, and nothing otherwise.

.DESCRIPTION
The path is the quoted or bare token after -File, the form every action this script builds takes. A
launcher under -LauncherRoot and a checkout's Start-Fleet.ps1 or Start-Persona.ps1 are outside both
folders, so a healthy task yields nothing. Every -File token is tested, and the first under either folder is
returned. A null or empty argument string yields nothing.
#>
function Get-PluginInstallActionFile {
    param([AllowNull()][AllowEmptyString()][string]$Arguments)
    if ([string]::IsNullOrEmpty($Arguments)) { return }
    foreach ($fileMatch in [regex]::Matches($Arguments, '(?i)-File\s+(?:"([^"]+)"|(\S+))')) {
        $file = $fileMatch.Groups[1].Value
        if ([string]::IsNullOrEmpty($file)) { $file = $fileMatch.Groups[2].Value }
        if ($file -match $PluginInstallFolderPattern) { return $file }
    }
}

<#
.SYNOPSIS
Builds the AgentFleet scheduled-task definition, touching no cmdlet that writes.

.DESCRIPTION
New-ScheduledTaskAction, New-ScheduledTaskTrigger, New-ScheduledTaskPrincipal and
New-ScheduledTaskSettingsSet build CIM objects in memory and never touch the Task Scheduler
service, the same way D:/discord-channels/install/Register-BrokerTask.ps1 uses them under -WhatIf,
which is what lets a test call this function and inspect what it built with no elevation and no
side effect. Roster and EnvFile land inside the action's quoted argument string verbatim, and
RepoRoot reaches it as the root of the Start-Fleet.ps1 path built from it, so all three are
refused here if they carry a double quote or end in a path separator (a trailing backslash before
the closing quote escapes that quote on the command line, silently merging two arguments into one),
since this function is itself dot-sourceable and composes the same command line for a caller that
never went through the script body. The target script and the env file must both exist: a missing
Start-Fleet.ps1 means -RepoRoot points at a worktree or a wrong root, and a missing env file means
the task would refuse to start at boot with nothing to say why until then. Neither check is skipped
under -WhatIf, since -WhatIf's purpose is to show what a real run would do and a real run would fail
here too. A -RepoRoot under a plugin marketplace or cache folder is refused here as well when
-LauncherRoot is empty, through Confirm-RepoRootOutsidePluginInstall. The action pins
powershell.exe's own full path under System32 rather than the bare executable name, so the task
engine resolves the exact binary at every boot instead of searching PATH for it.
#>
function Get-PersonaTaskDefinitions {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][string]$Roster,
        [Parameter(Mandatory)][string]$EnvFile,
        [Parameter(Mandatory)][string]$User,
        [string]$StartupDelay = $KeeperDefaultStartupDelay,
        [string]$RetryInterval = $KeeperDefaultRetryInterval,
        [string]$RetryWindow = $KeeperDefaultRetryWindow,
        # Set, the action runs <LauncherRoot>\Start-InstalledFleet.ps1 rather than
        # <RepoRoot>\bin\Start-Fleet.ps1. Register-PersonaTasks copies both launchers and the shared
        # functions file there before it writes the task, so what must exist at this point is each
        # one's source under RepoRoot.
        [string]$LauncherRoot
    )
    $baseDelay = ConvertFrom-IsoDuration -ParameterName 'StartupDelay' -Value $StartupDelay
    $retryIntervalSpan = ConvertFrom-IsoDuration -ParameterName 'RetryInterval' -Value $RetryInterval
    $retryWindowSpan = ConvertFrom-IsoDuration -ParameterName 'RetryWindow' -Value $RetryWindow
    # The Task Scheduler takes a repetition interval of one minute to 31 days, and registers a
    # repetition duration of 31 days. A value outside those may reach the scheduler's refusal only
    # at the write, after the password prompt. A window shorter than the interval
    # would end before the trigger's first repeat, so no failed logon would be retried. So the
    # interval is held to the scheduler's range and the window runs from the interval to 31 days,
    # which the scheduler registers, and anything else is refused here instead.
    if ($retryIntervalSpan -lt [TimeSpan]::FromMinutes(1) -or $retryIntervalSpan -gt [TimeSpan]::FromDays(31)) {
        throw "Get-PersonaTaskDefinitions: -RetryInterval '$RetryInterval' must be at least one " +
            "minute and at most 31 days, the range the Task Scheduler takes."
    }
    if ($retryWindowSpan -lt $retryIntervalSpan) {
        throw "Get-PersonaTaskDefinitions: -RetryWindow '$RetryWindow' must be at least " +
            "-RetryInterval '$RetryInterval', or the trigger never repeats inside it."
    }
    if ($retryWindowSpan -gt [TimeSpan]::FromDays(31)) {
        throw "Get-PersonaTaskDefinitions: -RetryWindow '$RetryWindow' must be at most 31 days, " +
            "a length the Task Scheduler registers."
    }
    $repoBin = Join-Path $RepoRoot 'bin'
    $startScript = Join-Path $repoBin 'Start-Fleet.ps1'
    if (-not [string]::IsNullOrEmpty($LauncherRoot)) {
        $startScript = Join-Path $LauncherRoot 'Start-InstalledFleet.ps1'
    }
    # A bare drive root ("D:\" or "D:/") is exempt from the trailing-separator refusal for
    # -RepoRoot and for nothing else. Resolve-AbsolutePath puts that trailing separator back on
    # purpose, since .NET reads a drive letter with none as the current directory on that drive
    # rather than its root, so refusing it would refuse the one spelling Resolve-AbsolutePath
    # itself produces for a bare -RepoRoot; and -RepoRoot never reaches the action string on its
    # own, only as the root of $startScript, which composes a further segment onto it and so lands
    # in the action with no trailing separator. $Roster and $EnvFile are interpolated into the
    # action's quoted arguments verbatim, so a bare drive root on either would put a backslash
    # immediately before a closing quote, escaping it and merging the next argument into the value.
    $pathsToCheck = @(
        @{ Value = $RepoRoot;    BareDriveRootAllowed = $true },
        @{ Value = $Roster;      BareDriveRootAllowed = $false },
        @{ Value = $EnvFile;     BareDriveRootAllowed = $false },
        @{ Value = $startScript; BareDriveRootAllowed = $false }
    )
    foreach ($candidate in $pathsToCheck) {
        $path = [string]$candidate.Value
        if ($path.Contains('"')) {
            throw "Get-PersonaTaskDefinitions: path '$path' carries a double quote and cannot " +
                "sit inside a quoted task argument."
        }
        $isExemptBareDriveRoot = $candidate.BareDriveRootAllowed -and $path -match '^[A-Za-z]:[\\/]$'
        if (($path.EndsWith('\') -or $path.EndsWith('/')) -and -not $isExemptBareDriveRoot) {
            throw "Get-PersonaTaskDefinitions: path '$path' ends in a path separator, which " +
                "would escape the task action's closing quote and merge two arguments into one."
        }
    }
    Confirm-RepoRootOutsidePluginInstall -RepoRoot $RepoRoot -LauncherRoot $LauncherRoot
    if (-not [string]::IsNullOrEmpty($LauncherRoot)) {
        # The fleet launcher the action names, the persona launcher it starts each keeper through,
        # and the shared functions file both read, in the order a reader meets them.
        foreach ($source in @('Start-InstalledFleet.ps1', 'Start-InstalledPersona.ps1', 'installed-plugin-functions.ps1')) {
            $sourcePath = Join-Path $repoBin $source
            if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
                throw "Get-PersonaTaskDefinitions: '$sourcePath' does not exist; -RepoRoot must name " +
                    "a personas plugin folder whose bin holds the launchers and the shared functions " +
                    "file -LauncherRoot installs."
            }
        }
        # The launcher root must outlive every plugin update, and the plugin folder, the marketplace
        # and the plugin cache are exactly what an update replaces or cleans up. Each path is compared in its
        # canonical form with a separator appended, so a sibling sharing a name prefix is no match.
        $launcherFull = [IO.Path]::GetFullPath($LauncherRoot).TrimEnd('\', '/') + '\'
        $repoFull = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\', '/') + '\'
        if ($launcherFull.StartsWith($repoFull, [StringComparison]::OrdinalIgnoreCase) -or
            $launcherFull -match $PluginInstallFolderPattern) {
            throw "Get-PersonaTaskDefinitions: -LauncherRoot '$LauncherRoot' sits inside the " +
                "plugin folder, the marketplace or the plugin cache, which a plugin update replaces. Name a folder " +
                "outside all three, such as one under the account's profile."
        }
    } elseif (-not (Test-Path -LiteralPath $startScript -PathType Leaf)) {
        throw "Get-PersonaTaskDefinitions: '$startScript' does not exist; -RepoRoot must name " +
            "the root checkout, since a task pointed at a worktree breaks when that worktree is removed."
    }
    if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
        throw "Get-PersonaTaskDefinitions: env file '$EnvFile' does not exist."
    }

    # Pinned rather than the bare executable name: an unqualified -Execute resolves by PATH search
    # order at every boot, which is one more thing an S4U context with no loaded profile can get
    # wrong. $env:SystemRoot is checked for empty or null before it reaches Join-Path below, which
    # would otherwise raise the engine's own null-or-empty-argument binding error in place of this
    # function's own message. Checked here rather than left to fail silently at boot, so a wrong,
    # empty or missing SystemRoot value fails at registration, where an operator is watching,
    # instead of at the next unattended start.
    if ([string]::IsNullOrEmpty($env:SystemRoot)) {
        throw "Get-PersonaTaskDefinitions: `$env:SystemRoot is empty or unset; it does not " +
            "resolve to a working Windows installation on this session."
    }
    $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $psExe -PathType Leaf)) {
        throw "Get-PersonaTaskDefinitions: '$psExe' does not exist; `$env:SystemRoot " +
            "('$env:SystemRoot') does not resolve to a working Windows installation on this session."
    }

    $argumentString = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File " +
        "`"$startScript`" -Roster `"$Roster`" -EnvFile `"$EnvFile`""
    $action = New-ScheduledTaskAction -Execute $psExe -Argument $argumentString
    # AtStartup only, with no AtLogOn trigger beside it as the broker's task carries: the goal
    # is a fleet that needs no logon at all.
    $trigger = New-ScheduledTaskTrigger -AtStartup
    # Held back so the channel broker's own boot task, which fires at PT30S, is listening before
    # the first persona child attaches its Discord channel.
    $trigger.Delay = Format-IsoDuration $baseDelay
    # New-ScheduledTaskTrigger -AtStartup takes no repetition parameters and the object offers no
    # settable Repetition.Interval, so the repetition is built on a -Once trigger, which does,
    # and that trigger's Repetition is assigned across. Only the repetition is used; the -Once
    # trigger's own start time is discarded. A later fire against a running task is ignored by
    # the IgnoreNew setting below.
    $repeater = New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval $retryIntervalSpan -RepetitionDuration $retryWindowSpan
    $trigger.Repetition = $repeater.Repetition
    # The -Once repetition arrives with StopAtDurationEnd true, which would stop a running fleet
    # supervisor when the retry window ends; a running fleet must outlive the window.
    $trigger.Repetition.StopAtDurationEnd = $false
    # Password rather than the broker's S4U, for the reason the header gives: only a logon the
    # scheduler holds the password for unlocks the account's user-scope DPAPI key, and every
    # credential store a persona's git reads sits behind that key. RunLevel Limited for the
    # reason the broker's own comment gives: an elevated task would write files this repo's
    # own tree does not expect an Administrators-owned file inside. This object is what -WhatIf
    # prints and what the write below reads its account and run level from; the password
    # itself reaches only the cmdlet call, from -Credential, since a principal object cannot
    # carry one.
    $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Password -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -MultipleInstances IgnoreNew `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries
    return [pscustomobject]@{
        TaskName  = $FleetTaskName
        Action    = $action
        Trigger   = $trigger
        Principal = $principal
        Settings  = $settings
    }
}

<#
.SYNOPSIS
Prints, under -WhatIf, the block of fields a task definition would register with.

.DESCRIPTION
Every value is read off the built CIM objects rather than off the caller's own literals, so the
printed block is evidence of what New-ScheduledTaskAction, New-ScheduledTaskTrigger,
New-ScheduledTaskPrincipal and New-ScheduledTaskSettingsSet actually built. The settings object's
own property names for the last two lines are DisallowStartIfOnBatteries and
StopIfGoingOnBatteries, inverted from the -AllowStartIfOnBatteries and -DontStopIfGoingOnBatteries
switches that built them, so the print negates them back to the switch names' own sense.
#>
function Write-PersonaTaskDefinition {
    param([Parameter(Mandatory)]$Definition)
    Write-Output "task $($Definition.TaskName)"
    Write-Output "  action: $($Definition.Action.Execute) $($Definition.Action.Arguments)"
    Write-Output "  trigger: $($Definition.Trigger.CimClass.CimClassName)"
    Write-Output "  startupDelay: $($Definition.Trigger.Delay)"
    Write-Output "  retryInterval: $($Definition.Trigger.Repetition.Interval)"
    Write-Output "  retryWindow: $($Definition.Trigger.Repetition.Duration)"
    Write-Output "  stopAtDurationEnd: $($Definition.Trigger.Repetition.StopAtDurationEnd)"
    Write-Output "  account: $($Definition.Principal.UserId)"
    Write-Output "  logon: $($Definition.Principal.LogonType)"
    Write-Output "  runlevel: $($Definition.Principal.RunLevel)"
    Write-Output "  restartCount: $($Definition.Settings.RestartCount)"
    Write-Output "  restartInterval: $($Definition.Settings.RestartInterval)"
    Write-Output "  executionTimeLimit: $($Definition.Settings.ExecutionTimeLimit)"
    Write-Output "  multipleInstances: $($Definition.Settings.MultipleInstances)"
    Write-Output "  startWhenAvailable: $($Definition.Settings.StartWhenAvailable)"
    Write-Output "  allowStartIfOnBatteries: $(-not $Definition.Settings.DisallowStartIfOnBatteries)"
    Write-Output "  dontStopIfGoingOnBatteries: $(-not $Definition.Settings.StopIfGoingOnBatteries)"
}

<#
.SYNOPSIS
Returns the root-level tasks a name or wildcard matches, reading a match of none as an empty list.

.DESCRIPTION
A name that matches no task is an error from Get-ScheduledTask whose id starts
CmdletizationQuery_NotFound, and that one error reads as an empty list. Every other read failure
refuses the run, before any write: a run that read "no tasks" from a failed query would call
Register-ScheduledTask on a name that already exists and throw.
#>
function Read-ExistingTasks {
    param([Parameter(Mandatory)][string]$TaskName)
    try {
        return @(Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop)
    } catch {
        if ($_.FullyQualifiedErrorId -notlike 'CmdletizationQuery_NotFound*') {
            throw "Register-PersonaTasks: could not read $TaskName from the Task Scheduler, so " +
                "nothing was registered, updated or removed: $($_.Exception.Message)"
        }
        return @()
    }
}

<#
.SYNOPSIS
Builds the AgentFleet definition, then registers or updates it, reports on every AgentPersona-*
task and (only under -Prune) removes them.

.DESCRIPTION
$IsElevated, $ExistingTaskNames and $ExistingTaskArguments exist so a test can drive the elevation
guard, the update, register and orphan branches and the plugin-install report with no scheduler
read and no ScheduledTasks cmdlet that writes, the same reason the broker script's
Register-BrokerScheduledTask takes $IsElevated as a parameter.
$WhatIf skips the elevation throw and prints the definition and each planned action instead of
registering, updating or unregistering anything; it is the unelevated inspection path. Without
-WhatIf the elevation check runs before any ScheduledTasks cmdlet, including the reads that list
the existing AgentFleet and AgentPersona-* tasks, since even those reads are skipped when the
elevation throw fires first. Every scheduler read and write below carries -TaskPath '\' explicitly:
Get-ScheduledTask with no -TaskPath searches every folder in the Task Scheduler library, not just
the root, so a same-named task filed under a different folder would otherwise send this function
down the wrong branch (update instead of register, or a prune that targets a root-level task that
was never there) and a write with no -TaskPath lands at the root by default, which is right for
every task this script creates but is worth pinning rather than relying on the default staying
that way.

The only destructive act here is Unregister-ScheduledTask, taken only when -Prune is present,
-WhatIf is absent, and the task name matches AgentPersona-*: an unrequested unregister would take a
task away with no request behind it, so pruning is opt-in on every run rather than a side effect of
a plain registration pass. The orphan count is printed before any of them are removed, and each
removal is named as it happens, so a run that is interrupted partway still leaves a record of what
it meant to do and what it reached.

$Credential is needed on every real run, since every run writes AgentFleet. It is checked right
after the elevation guard and before any scheduler read or write. A missing credential is refused
on a real run only, since -WhatIf writes nothing. A bound credential is checked under -WhatIf too,
so a dry run with a wrong one refuses rather than printing "would register" for a run that would
throw. The two checks on a bound credential: its user name must be $User, compared ignoring case
since Windows account names do, because the principal the definition prints carries $User and a
credential for another account would register a task whose printed block names one account and
whose stored logon is another's; and its password must not be empty, since Get-Credential returns
a credential for an empty entry and the cmdlets would otherwise be handed one. Register takes the
password with -User and the definition's own run level; Set takes it with -User alone, since
Set-ScheduledTask offers no -RunLevel in that parameter set and the task it updates keeps the run
level it was registered with. The password is read off the credential at each call and is assigned
to no variable of this script's, and no output line of this script's carries it. It does reach the
cmdlet's bound parameters, which is the module's only interface, so it can surface where PowerShell
records those: module logging (event 4103) where a policy turns it on, and the $Error record a
failed call leaves in the session.
#>
function Register-PersonaTasks {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][string]$Roster,
        [Parameter(Mandatory)][string]$EnvFile,
        [Parameter(Mandatory)][string]$User,
        [pscredential]$Credential,
        [switch]$Prune,
        [switch]$Start,
        [switch]$WhatIf,
        [bool]$IsElevated = (Test-IsElevated),
        [string[]]$ExistingTaskNames,
        # Task name to the task's action argument string, which the plugin-install report reads.
        # Left unbound, a task named in $ExistingTaskNames has no action to report on.
        [hashtable]$ExistingTaskArguments,
        [string]$StartupDelay = $KeeperDefaultStartupDelay,
        [string]$RetryInterval = $KeeperDefaultRetryInterval,
        [string]$RetryWindow = $KeeperDefaultRetryWindow,
        [string]$LauncherRoot
    )

    if (-not $WhatIf -and -not $IsElevated) {
        throw "Register-PersonaTasks: this must run from an elevated PowerShell session " +
            "(right-click PowerShell, 'Run as Administrator'). Registering a scheduled task under " +
            "the Task Scheduler root fails without it, with an access-denied error that does not " +
            "say why."
    }

    if ($null -ne $Credential) {
        if (-not [string]::Equals($Credential.UserName, $User, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Register-PersonaTasks: -Credential names '$($Credential.UserName)' but " +
                "-User is '$User'; the task's account and its stored logon must be the " +
                "same account, spelled the same way, machine or domain prefix included."
        }
        if ([string]::IsNullOrEmpty($Credential.GetNetworkCredential().Password)) {
            throw "Register-PersonaTasks: -Credential carries an empty password, which the " +
                "Task Scheduler cannot store a logon under."
        }
    } elseif (-not $WhatIf) {
        throw "Register-PersonaTasks: -Credential is required to register or update " +
            "$FleetTaskName, since a task with the Password logon type cannot be written without " +
            "the account's password."
    }

    $definition = Get-PersonaTaskDefinitions -RepoRoot $RepoRoot -Roster $Roster -EnvFile $EnvFile `
        -User $User -StartupDelay $StartupDelay -RetryInterval $RetryInterval `
        -RetryWindow $RetryWindow -LauncherRoot $LauncherRoot
    $taskName = $definition.TaskName

    if ($null -eq $ExistingTaskNames) {
        # Two reads, the fleet task first: each pattern's match of none is its own not-found error,
        # so one read of both would lose the other's tasks to that error.
        $existingTasks = @(Read-ExistingTasks -TaskName $FleetTaskName) + @(Read-ExistingTasks -TaskName $OrphanTaskPattern)
        $existing = @($existingTasks | ForEach-Object { $_.TaskName })
        $existingArguments = @{}
        foreach ($existingTask in $existingTasks) {
            $existingArguments[[string]$existingTask.TaskName] =
                (@($existingTask.Actions | ForEach-Object { $_.Arguments }) -join "`n")
        }
    } else {
        $existing = @($ExistingTaskNames)
        $existingArguments = $ExistingTaskArguments
        if ($null -eq $existingArguments) { $existingArguments = @{} }
    }

    # The launchers and the shared functions file both dot-source are copied after every check
    # above and the reads of the existing tasks, and before the task is written, so a run refused
    # before any write leaves the launcher root as it found it, and no task names a launcher that is
    # not there yet. The shared file goes first, so a launcher never lands without the file it
    # reads, and the persona launcher before the fleet launcher that starts it. Each copy overwrites
    # an older one, which is how a re-registration from a newer plugin version updates them.
    if (-not [string]::IsNullOrEmpty($LauncherRoot)) {
        $repoBin = Join-Path $RepoRoot 'bin'
        $copies = @(
            @{ Label = 'shared functions'; File = 'installed-plugin-functions.ps1' },
            @{ Label = 'launcher'; File = 'Start-InstalledPersona.ps1' },
            @{ Label = 'fleet launcher'; File = 'Start-InstalledFleet.ps1' }
        )
        if (-not $WhatIf) { [void][System.IO.Directory]::CreateDirectory($LauncherRoot) }
        foreach ($copy in $copies) {
            $target = Join-Path $LauncherRoot $copy.File
            if ($WhatIf) {
                Write-Output "would install $($copy.Label) $target"
            } else {
                Copy-Item -LiteralPath (Join-Path $repoBin $copy.File) -Destination $target -Force -ErrorAction Stop
                Write-Output "installed $($copy.Label) $target"
            }
        }
    }

    # The update in place below replaces the action, so an existing task that already runs from a
    # plugin install folder is repointed by this run. The line says so before the task's own write.
    $installedFile = Get-PluginInstallActionFile -Arguments $existingArguments[$taskName]
    if ($null -ne $installedFile) {
        $repointVerb = if ($WhatIf) { 'would repoint' } else { 'repoints' }
        Write-Output "$taskName`: action runs $installedFile, under a plugin install folder; this run $repointVerb it"
    }
    if ($WhatIf) {
        Write-PersonaTaskDefinition -Definition $definition
        # The same $existing test the real branch below takes, so a dry run tells the operator
        # whether the task would be created or updated in place.
        if ($existing -contains $taskName) {
            Write-Output "would update $taskName"
        } else {
            Write-Output "would register $taskName"
        }
        if ($Start) { Write-Output "would start $taskName" }
    } else {
        if ($existing -contains $taskName) {
            Set-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $definition.Action `
                -Trigger $definition.Trigger -Settings $definition.Settings `
                -User $definition.Principal.UserId `
                -Password $Credential.GetNetworkCredential().Password | Out-Null
            Write-Output "updated $taskName"
        } else {
            Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $definition.Action `
                -Trigger $definition.Trigger -Settings $definition.Settings `
                -User $definition.Principal.UserId -RunLevel $definition.Principal.RunLevel `
                -Password $Credential.GetNetworkCredential().Password | Out-Null
            Write-Output "registered $taskName"
        }
        # Enable-ScheduledTask costs nothing on a task that is already enabled, and it exists for
        # a task an operator disabled by hand: whether Set-ScheduledTask on its own would re-enable
        # that task is not something this comment claims either way, so the enable is explicit
        # rather than assumed.
        Enable-ScheduledTask -TaskName $taskName -TaskPath '\' | Out-Null
        if ($Start) {
            Start-ScheduledTask -TaskName $taskName -TaskPath '\'
            Write-Output "started $taskName"
        }
    }

    $orphans = @($existing | Where-Object { $_ -like $OrphanTaskPattern })
    if ($Prune -and -not $WhatIf -and $orphans.Count -gt 0) {
        Write-Output "pruning $($orphans.Count) orphan task(s): $($orphans -join ', ')"
    }
    foreach ($orphanName in $orphans) {
        if ($WhatIf) {
            if ($Prune) {
                Write-Output "orphan $orphanName`: would unregister under -Prune"
            } else {
                Write-Output "orphan $orphanName`: left in place, and while enabled it still starts its persona at boot beside AgentFleet; pass -Prune to unregister"
            }
        } elseif ($Prune) {
            Unregister-ScheduledTask -TaskName $orphanName -TaskPath '\' -Confirm:$false | Out-Null
            Write-Output "unregistered $orphanName"
        } else {
            Write-Output "orphan $orphanName`: left in place, and while enabled it still starts its persona at boot beside AgentFleet; pass -Prune to unregister"
        }
        # An orphan under -Prune is unregistered, so a line about its action would describe a task
        # that is gone.
        $orphanFile = if ($Prune) { $null } else { Get-PluginInstallActionFile -Arguments $existingArguments[$orphanName] }
        if ($null -ne $orphanFile) {
            Write-Output "orphan $orphanName`: action runs $orphanFile, under a plugin install folder; nothing repoints it"
        }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    # Stop turns a thrown .NET exception (GetFullPath on an illegal path, among others) into a
    # terminating error in this scope, same as every `throw` above; without it a .NET method's own
    # exception is merely reported and the script would fall through to the next line instead of
    # stopping, which is how an illegal path would otherwise slip past its own refusal.
    $ErrorActionPreference = 'Stop'
    try {
        if ([string]::IsNullOrEmpty($RepoRoot)) {
            $RepoRoot = Split-Path -Parent $PSScriptRoot
        }
        if ([string]::IsNullOrEmpty($StartupDelay)) {
            $StartupDelay = $KeeperDefaultStartupDelay
        }
        if ([string]::IsNullOrEmpty($RetryInterval)) {
            $RetryInterval = $KeeperDefaultRetryInterval
        }
        if ([string]::IsNullOrEmpty($RetryWindow)) {
            $RetryWindow = $KeeperDefaultRetryWindow
        }
        # Resolve-AbsolutePath's GetUnresolvedProviderPathFromPSPath throws its own generic message
        # for a drive that does not exist ("Cannot find drive. A drive with the name 'Z' does not
        # exist."), naming neither the parameter nor the value that carried it. Each call is wrapped
        # so the operator sees which of -RepoRoot, -Roster or -EnvFile named the bad path.
        try {
            $repoRootResolved = Resolve-AbsolutePath -Path $RepoRoot
        } catch {
            throw "Register-PersonaTasks: -RepoRoot '$RepoRoot' could not be resolved: $($_.Exception.Message)"
        }
        try {
            $rosterResolved = Resolve-AbsolutePath -Path $Roster
        } catch {
            throw "Register-PersonaTasks: -Roster '$Roster' could not be resolved: $($_.Exception.Message)"
        }
        try {
            $envFileResolved = Resolve-AbsolutePath -Path $EnvFile
        } catch {
            throw "Register-PersonaTasks: -EnvFile '$EnvFile' could not be resolved: $($_.Exception.Message)"
        }
        $launcherRootResolved = $null
        if (-not [string]::IsNullOrEmpty($LauncherRoot)) {
            try {
                $launcherRootResolved = Resolve-AbsolutePath -Path $LauncherRoot
            } catch {
                throw "Register-PersonaTasks: -LauncherRoot '$LauncherRoot' could not be resolved: $($_.Exception.Message)"
            }
        }

        # Before the roster is read and before Get-Credential, so a refused root never reaches a
        # password prompt, and before Register-PersonaTasks's elevation refusal, so an unelevated
        # run meets this refusal first.
        Confirm-RepoRootOutsidePluginInstall -RepoRoot $repoRootResolved -LauncherRoot $launcherRootResolved

        # Read for its refusals alone: the task's action names the roster and the fleet supervisor
        # reads its entries, so a roster it would refuse is refused here, before the password prompt.
        $null = Read-PersonaRoster -Path $rosterResolved

        # The prompt is gated on elevation as well as on -WhatIf, so an unelevated real run meets
        # Register-PersonaTasks's own elevation refusal rather than a password prompt it would
        # then fail after. Get-Credential is the one place the password enters: it is never a
        # string parameter of this script.
        if (-not $WhatIf -and $null -eq $Credential -and (Test-IsElevated)) {
            $Credential = Get-Credential -UserName $User -Message (
                "Password for $User, stored by the Task Scheduler so the $FleetTaskName task and every " +
                "persona it starts run under a logon that unlocks this account's credential stores.")
            if ($null -eq $Credential) {
                throw "Register-PersonaTasks: no credential was entered, so nothing was registered or updated."
            }
        }

        Register-PersonaTasks -RepoRoot $repoRootResolved -Roster $rosterResolved `
            -EnvFile $envFileResolved -User $User -Credential $Credential -StartupDelay $StartupDelay `
            -RetryInterval $RetryInterval -RetryWindow $RetryWindow `
            -LauncherRoot $launcherRootResolved -Prune:$Prune -Start:$Start -WhatIf:$WhatIf
    } catch {
        # Console.Error.WriteLine, not Write-Error: Write-Error under $ErrorActionPreference =
        # 'Stop' raises a terminating error of its own, which skips the exit 1 below entirely (the
        # process still exits 1, but only via the unhandled-error path, and the message the host
        # prints is wrapped at console width even when the output is redirected, which breaks a
        # long path across lines). Console.Error.WriteLine writes the message once, unwrapped, to
        # stderr, and returns control so exit 1 actually runs. The message is written as thrown,
        # with no added prefix: every throw above already names the function that raised it, so an
        # outer prefix here would double it for a throw already spelled "Register-PersonaTasks: ...".
        [Console]::Error.WriteLine($_.Exception.Message)
        exit 1
    }
}
