# Keeps one process keeper alive per enabled roster entry. This is the script the AgentFleet
# scheduled task runs at boot, one per machine, under Windows PowerShell 5.1:
#
#   powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File bin\Start-Fleet.ps1 [-Roster <path>] [-EnvFile <path>] [-TickSeconds <n>] [-RetireBoundSeconds <n>] [-CloneBoundSeconds <n>] [-StartsPerTick <n>] [-DeferredTickSeconds <n>] [-KeeperLauncher <path>]
#
# Every tick the fleet supervisor reads the roster, reads the machine's process list once, and
# decides one thing per entry through Get-FleetDecision (bin/keeper-functions.ps1). It starts a
# keeper, <KeeperLauncher> -Name <name> -Roster <path> -EnvFile <path>, where none is live for the
# entry and no marker says to leave it down. It leaves a live keeper alone where the entry is
# unchanged. It retires a keeper where the entry has left the roster or reads enabled false, and
# retires then restarts one whose entry's other fields changed. A keeper is live where a process
# whose command line carries the launcher's file name and -Name <name> as a whole token is running
# (Find-FleetLiveKeeper), so a fleet supervisor started over running keepers adopts them rather
# than starting a second one beside each. An adoption after a crash records the roster's run
# directory, which a rundir edit made while the fleet supervisor was down moves away from the
# keeper's, so a retire of that keeper never reaches the directory it runs on.
#
# A tick starts at most -StartsPerTick keepers, 5 by default. The entries are walked in roster
# order, so the roster's order is the start order. An entry whose start falls past the cap is left
# exactly as the tick found it, with no state record written, no marker removed and no clone run,
# and the next tick reaches the same start for it. Only a keeper started takes a place: an
# adoption, a retire or any other action takes none, and neither does a start whose release, clone
# or launch failed. A tick that left any start writes one fleet.log line naming those entries in
# the order the tick met them:
#
#   deferred <n> of <m> starts to later ticks, -StartsPerTick <k>: <name>, <name>
#
# where <n> counts the entries left and <m> is <n> plus the keepers the tick started. The next
# tick then comes after -DeferredTickSeconds, 20 by default, or after -TickSeconds where that is
# shorter. A tick that left nothing writes no such line and waits -TickSeconds.
#
# A retire is a request, never a kill: the fleet supervisor writes <rundir>/shutdown.request, which
# the supervisor's poll loop honors and the keeper turns into keeper.hold at the exit 0 it leads
# to, and beside it writes <rundir>/fleet.retired, its own sidecar marking that hold as one it
# asked for. A run directory holding the sidecar, for an entry that is wanted again, is released by
# removing the sidecar, the hold and any request still lying there, and started. A keeper.hold with
# no sidecar is one the fleet supervisor did not ask for, the keeper's own policy hold or the
# operator's, and keeps the persona down; a keeper.boot naming the current boot
# keeps a parked persona down until the next boot. A keeper still live -RetireBoundSeconds after
# the request is recorded retire-timeout and left alone, because every kill in this plugin is
# identity-guarded. This script's one kill ends a clone still running at -CloneBoundSeconds, through
# the job object or process handle it holds for the git it started. A keeper that exits inside 60 seconds of
# its start on a route no marker explains is started again after a delay that doubles from 60 to
# 1,800 seconds, so a broken entry costs one log line per delay rather than a start per tick.
#
# An entry carrying repo, a repository URL, is cloned before its first start: where its workdir is
# absent or an empty directory, the start runs git clone <repo> <workdir> (Invoke-FleetClone) with
# the git on this account's path, under this process, and starts the keeper only once the clone has
# exited 0. The child's environment alone, never this process's, carries git's terminal and
# credential-manager prompts off, ssh in batch mode so it never asks either, and git's own
# low-speed abort at under 1 byte a second for 300 seconds. The clone runs under a Windows job
# object this process holds (New-FleetCloneJob): its process is created suspended, assigned to the
# job and only then resumed, so it runs no instruction outside the job and every process it starts
# joins the job with it. A clone still running -CloneBoundSeconds after its start is killed
# through that job, so the kill reaches the clone and every process it started together, with no
# process id, no taskkill and no parent walk, and the workdir is returned to what it was before
# the clone: removed where the clone created it, emptied where it found it empty, so a later tick
# does not read the half clone as a directory in use. Closing the job, which every path does once
# the clone is over, ends anything still in it, so a git that exited leaving a helper behind
# leaves none past the tick. After a kill a pipe read still pending is abandoned, which holds one
# thread-pool thread until the last process holding the pipe exits, an accepted cost. A clone the
# job refused is one WARN line and runs on, killed at the bound through its own handle alone. A job
# type that cannot be compiled is a clone failure whose reason names the compile error, and no git
# runs. A workdir that exists and is not empty is
# never cloned into, whatever the URL, so a retire and re-add over the same directory starts the
# keeper on what is there. Before git runs, the URL is re-checked (Test-FleetRepoUrl, bin/keeper-functions.ps1)
# against the two shapes the roster validator admits, so a roster hand-edited past that validator
# cannot pass git an option or a local path. A refused URL, a workdir that cannot be resolved or is
# a file, a git not on the path, a git exit other than 0 or a clone killed at the bound is recorded
# clone-failed with its reason, starts no keeper, and is retried on the same ladder a quick exit
# climbs. An entry carrying repo and no workdir has nowhere to clone into, and is one ERROR line
# and left alone, as an entry naming neither rundir nor workdir is.
#
# State the operator can read lives beside the roster: fleet.log (one line per action, rotated at
# 5 MB keeping fleet.log.1, the keeper's own rotation rule) and fleet-state.json (per entry the
# keeper's pid and start time, the fingerprint of the entry it was started on, the entry's run
# directory, which a retire of a removed entry is read from, and the last action; a removed entry's
# record reads retired for one tick and is then dropped). keeper.json
# stays each persona's own truth and is neither read nor written here. The only files written into
# a run directory are shutdown.request and fleet.retired. The only ones removed are those two and
# the keeper.hold the sidecar marks, all three by a release, and a fleet.retired a live keeper
# outlived with no request beside it, by its adoption.
#
# A roster that cannot be read, or reads as not an array, is one ERROR line and leaves every live
# keeper alone until the next tick. -Once is the test seam that runs one tick and exits. A scheduled
# task runs the script without that switch, and it then ticks until it is stopped or reaches one of
# two ends of its own. The first is exit 7 for a new build. Where the installed route's launcher,
# Start-InstalledFleet.ps1, gave all four of -PluginList, -PluginId, -RunningVersion and
# -RuntimeRoot, the script reads the plugin's record from the list after every tick, under -Once as
# well. Where the record names a version other than -RunningVersion and its install folder holds
# every file $InstalledPluginRequiredFiles names (bin/installed-plugin-functions.ps1), the script
# takes that version's snapshot under -RuntimeRoot, writes one HANDOFF line to fleet.log naming
# both versions and the snapshot, and exits 7, which the launcher reads as the word to start the
# new build's fleet supervisor. No keeper is touched. A record that does not read, and an install
# folder missing a required file, leave the script running and are read again after the next tick.
# A snapshot that fails leaves it running too, and that version is not tried again by this process.
# Each cause is one ERROR line: once for a version, and for a record that does not read, once until
# a read next succeeds. With any of the four values empty the list is never read. The second end
# is exit 0 where the launcher is gone. The process that started the script is read off the first
# process list a tick reads that holds the script's own process. Where that process runs
# Start-InstalledFleet.ps1, and a later list that holds the script's own process no longer holds
# it, the script writes one LAUNCHER-GONE line and exits 0 before it decides anything. Where the
# four values were given and that first list no longer holds the process that started the script,
# the script ends the same way at that first list. So a launcher that was ended alone leaves no
# fleet supervisor running beside the one the next task start brings. A script that anything else
# started follows no parent, and neither does one not given all four values whose parent has gone
# by that first list.
#
# On the installed route the script also keeps the launcher folder's files current. Once it has run
# a minute, after the first tick that ends 60 seconds or more after its start and before that
# tick's new-build check, it reads four files in the launcher folder against its own build's copies
# beside it, in this order: installed-plugin-functions.ps1, Start-InstalledPersona.ps1,
# Start-InstalledFleet.ps1 and Start-InstalledOrphanSweep.ps1. It does so only where two things
# hold. -KeeperLauncher names a file called Start-InstalledPersona.ps1, and the script's own folder
# is runtime\<name>\bin under that file's folder, the two folders compared as full paths without
# regard to case or to the direction of a slash. A file the launcher folder holds, whose bytes
# differ from the copy in the script's own folder, is replaced: the new bytes go to a temporary
# file in the launcher folder, one rename puts that file over the old one, and one REFRESH line in
# fleet.log names the file and <name>, the version it came from. A file the launcher folder lacks
# is never created, and one whose bytes are equal is not written. A step that fails is one ERROR
# line, leaves the old file whole, removes the temporary file it wrote or names it where it could
# not be removed, and leaves the files after it in that order as they were, so a failed shared
# functions file never has a launcher written beside it. The refresh runs once in the script's
# life, whatever it found, and touches no keeper and no run directory. A build that ends inside
# its first minute, which is the fleet launcher's failed-move window, has therefore written no
# launcher file. -DelayScale multiplies the 60 seconds, so under -Once the refresh runs only
# where the scaled wait has passed. The running fleet launcher keeps the code it loaded, and a
# replaced file reaches it at the task's next start.
#
# [CmdletBinding()] is what makes an unknown switch a binding error (exit 1) rather than a value
# that lands in $args while the body runs anyway.
[CmdletBinding()]
param(
    [string]$Roster = 'D:/personas/fleet.json',
    [string]$EnvFile = 'D:/personas/keeper.env',
    [ValidateRange(1, 86400)]
    [int]$TickSeconds = 60,
    [ValidateRange(1, 604800)]
    [int]$RetireBoundSeconds = 1800,
    # Seconds a git clone may run before it is killed and recorded clone-failed.
    [ValidateRange(1, 604800)]
    [int]$CloneBoundSeconds = 1800,
    # The most keepers one tick starts; an entry past it is started on a later tick.
    [ValidateRange(1, 1000)]
    [int]$StartsPerTick = 5,
    # Seconds to the next tick after a tick that left a start for later, capped at -TickSeconds.
    [ValidateRange(1, 86400)]
    [int]$DeferredTickSeconds = 20,
    # The script started per entry. Defaults to the sibling Start-Persona.ps1; the installed route
    # passes its launcher root's Start-InstalledPersona.ps1.
    [string]$KeeperLauncher,
    # Runs one tick and exits. Exists so the unit test can drive the loop a tick at a time; a task
    # never passes it.
    [switch]$Once,
    # Multiplies the wait a backoff takes before the next start. The log and the state still
    # record the unscaled delay. Exists so the unit test can walk the doubling ladder in
    # milliseconds; a task never passes it. A negative scale is a binding error.
    [ValidateRange(0, [double]::MaxValue)]
    [double]$DelayScale = 1.0,
    # The four values the installed route's launcher, Start-InstalledFleet.ps1, gives: the path of
    # installed_plugins.json, the plugin's id in it, the version this script was started from, and
    # the folder that holds one snapshot folder per version. The new-build check after each tick
    # runs only where all four hold a value.
    [string]$PluginList,
    [string]$PluginId,
    [string]$RunningVersion,
    [string]$RuntimeRoot
)

. (Join-Path $PSScriptRoot 'keeper-functions.ps1')

$script:LogCapBytes = 5MB
$script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$script:Invariant = [System.Globalization.CultureInfo]::InvariantCulture

# How far a keeper.boot time may sit from the system's boot time while still naming the same boot,
# the keeper's own tolerance: the boot time moves by seconds when the clock is stepped after boot.
$script:SameBootSeconds = 60

# The engine this script runs under, which is the one each keeper is started under, so the task's
# choice of Windows PowerShell 5.1 reaches every keeper.
$script:PowerShellExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName

# Paths are resolved against PowerShell's own current location before anything writes them: the log
# is sized through the provider and appended through .NET, which resolve a relative path against
# different roots, so a path resolved here is the one both halves act on.
function Resolve-FleetPath {
    param([Parameter(Mandatory)][string]$Path)
    return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
}

if ([string]::IsNullOrWhiteSpace($KeeperLauncher)) { $KeeperLauncher = Join-Path $PSScriptRoot 'Start-Persona.ps1' }
$KeeperLauncher = Resolve-FleetPath $KeeperLauncher
$rosterDir = Split-Path -Parent $Roster
if ([string]::IsNullOrWhiteSpace($rosterDir)) { $rosterDir = '.' }
$script:LogPath = Resolve-FleetPath (Join-Path $rosterDir 'fleet.log')
$script:StatePath = Resolve-FleetPath (Join-Path $rosterDir 'fleet-state.json')

# The launcher names a keeper's command line can carry: the two the plugin ships, and the leaf of
# the launcher this fleet supervisor starts, where a test or an operator names another.
$script:LauncherNames = @($script:FleetKeeperLauncherNames)
$launcherLeaf = Split-Path -Leaf $KeeperLauncher
if ($script:LauncherNames -notcontains $launcherLeaf) { $script:LauncherNames += $launcherLeaf }

# The process objects of the keepers this fleet supervisor started or adopted, by entry name in
# lower case. A handle held while the keeper runs is what makes its exit time readable afterwards,
# which is how a quick exit is told from a long run when the tick finds the keeper gone. A keeper
# with no handle, one adopted whose handle could not be opened or one that ran under an earlier
# fleet supervisor, is measured from its recorded start to the tick that found it gone instead.
$script:Handles = @{}

# The process ids already logged as unknown, so a keeper no roster entry and no state record
# names costs one line per fleet supervisor run rather than one per tick.
$script:UnknownLogged = New-Object 'System.Collections.Generic.HashSet[int]'

# The number of starts the last tick left for a later tick, which the main loop reads to choose
# its wait. Every tick sets it, a tick that ends early included.
$script:FleetDeferredCount = 0

# The launcher this fleet supervisor follows: the id and creation time of the process that started
# it, held only where that process runs Start-InstalledFleet.ps1. LauncherRead says a process list
# holding this process's own record has been read for it, so the parent is looked for once, at the
# first such list.
$script:Launcher = $null
$script:LauncherRead = $false

# What the new-build check has already logged, so each cause costs one line per fleet supervisor
# run: the versions whose install folder was found incomplete, the versions whose snapshot failed,
# which are not tried again, and whether the last read of the plugin's record failed.
$script:IncompleteVersions = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$script:FailedVersions = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$script:RecordUnread = $false

# The launcher folder's files this script keeps current on the installed route, in the order it
# replaces them: the shared functions file first, so a launcher is never written after a failed
# write of the file it reads.
$script:LauncherFileNames = @('installed-plugin-functions.ps1', 'Start-InstalledPersona.ps1', 'Start-InstalledFleet.ps1', 'Start-InstalledOrphanSweep.ps1')

# How long the script runs before it refreshes those files, in seconds, which -DelayScale
# multiplies. It equals the fleet launcher's failed-move window, so a build the launcher falls back
# from has written no launcher file. RunClock counts from the script's start, and RefreshDone says
# the one refresh of this run has been reached, whatever it did.
$script:RefreshAfterSeconds = 60
$script:RunClock = [System.Diagnostics.Stopwatch]::StartNew()
$script:RefreshDone = $false

# The one rename a refresh makes. MoveFileExW with MOVEFILE_REPLACE_EXISTING puts the temporary
# file over the old one in a single step on one volume, so a rename that fails leaves the old file
# under its name with its bytes whole. File.Move on the .NET Framework that Windows PowerShell 5.1
# runs on cannot replace a file that exists, so the call is made directly.
$script:FleetLauncherFileSource = @'
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class FleetLauncherFile
{
    private const uint MOVEFILE_REPLACE_EXISTING = 0x00000001;
    private const uint MOVEFILE_WRITE_THROUGH = 0x00000008;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool MoveFileExW(string existing, string replacement, uint flags);

    public static void RenameOver(string from, string to)
    {
        if (!MoveFileExW(from, to, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) throw new Win32Exception();
    }
}
'@

<#
.SYNOPSIS
Appends one timestamped line to fleet.log as UTF-8 without a byte-order mark, rotating first.

.DESCRIPTION
The cap check runs immediately before the append so a line lands in the live generation rather
than in the one about to be renamed away. Rotation renames the log to fleet.log.1, replacing the
previous one; it never truncates in place. A rotation that fails is written into the log as it
stands and stepped over, since the condition that stopped the rename outlives this tick. A failed
append goes to stderr, the only other channel the script has.
#>
function Write-FleetLog {
    param([Parameter(Mandatory)][string]$Text)
    $path = $script:LogPath
    $stamp = [DateTime]::UtcNow.ToString('o', $script:Invariant)
    try {
        if ((Test-Path -LiteralPath $path) -and (Get-Item -LiteralPath $path).Length -gt $script:LogCapBytes) {
            Move-Item -Force -LiteralPath $path -Destination "$path.1" -ErrorAction Stop
        }
    } catch {
        try {
            [System.IO.File]::AppendAllText($path, "$stamp ROTATE failed: $($_.Exception.Message)" + [Environment]::NewLine, $script:Utf8NoBom)
        } catch { }
    }
    try {
        [System.IO.File]::AppendAllText($path, "$stamp $Text" + [Environment]::NewLine, $script:Utf8NoBom)
    } catch {
        [Console]::Error.WriteLine("Start-Fleet: could not append to '$path': $($_.Exception.Message)")
    }
}

<#
.SYNOPSIS
Reads fleet-state.json into an ordered map of entry name, in lower case, to its record.

.DESCRIPTION
Each record is an ordered hashtable carrying the fields the file writes, every time as the ISO
string it was written as, so the file and the memory hold one shape. A file that is absent is an
empty map. One that cannot be read or parsed is logged and treated as empty, since the process list
is the truth about what is live and the next tick adopts what it finds.
#>
function Read-FleetState {
    $records = [ordered]@{}
    if (-not (Test-Path -LiteralPath $script:StatePath -PathType Leaf)) { return $records }
    try {
        $raw = Get-Content -LiteralPath $script:StatePath -Raw -Encoding UTF8 -ErrorAction Stop
        $parsed = @((ConvertFrom-Json -InputObject $raw -ErrorAction Stop) | ForEach-Object { $_ })
    } catch {
        Write-FleetLog "ERROR state '$($script:StatePath)' could not be read, so every live keeper is adopted afresh: $($_.Exception.Message)"
        return $records
    }
    foreach ($item in $parsed) {
        if ($null -eq $item -or [string]::IsNullOrWhiteSpace([string]$item.name)) { continue }
        $record = [ordered]@{}
        foreach ($property in $item.PSObject.Properties) {
            $value = $property.Value
            if ($value -is [DateTime]) { $value = $value.ToUniversalTime().ToString('o', $script:Invariant) }
            $record[$property.Name] = $value
        }
        $records[([string]$item.name).ToLowerInvariant()] = $record
    }
    return $records
}

<#
.SYNOPSIS
Writes fleet-state.json as UTF-8 without a byte-order mark; a failure is logged and stepped over.
#>
function Write-FleetState {
    param([Parameter(Mandatory)][System.Collections.IDictionary]$Records)
    try {
        $list = @($Records.Values | ForEach-Object { [pscustomobject]$_ })
        $json = ConvertTo-Json -InputObject $list -Depth 5
        [System.IO.File]::WriteAllText($script:StatePath, $json + [Environment]::NewLine, $script:Utf8NoBom)
    } catch {
        Write-FleetLog "ERROR state '$($script:StatePath)' could not be written: $($_.Exception.Message)"
    }
}

<#
.SYNOPSIS
Returns the entry's run directory as the keeper resolves it: the rundir field, else <workdir>/run.
#>
function Get-FleetRunDirectory {
    param([Parameter(Mandatory)][object]$Entry)
    $runDir = [string]$Entry.rundir
    if ([string]::IsNullOrWhiteSpace($runDir)) {
        if ([string]::IsNullOrWhiteSpace([string]$Entry.workdir)) { return $null }
        $runDir = Join-Path ([string]$Entry.workdir) 'run'
    }
    return Resolve-FleetPath $runDir
}

<#
.SYNOPSIS
Reads the machine's boot time in UTC, or returns nothing and logs where it cannot be read.

.DESCRIPTION
The same read the keeper makes before it compares keeper.boot. A boot time that cannot be read, or
takes more than 30 seconds to read, leaves every boot marker unread this tick, which starts a parked
persona a tick early at worst, the keeper's own choice for the same fault.
#>
function Get-FleetBootTime {
    try {
        return (Get-CimInstance -ClassName Win32_OperatingSystem -OperationTimeoutSec 30 -ErrorAction Stop).LastBootUpTime.ToUniversalTime()
    } catch {
        Write-FleetLog "ERROR boot time could not be read: $($_.Exception.Message)"
        return $null
    }
}

<#
.SYNOPSIS
Says whether a keeper.boot marker names the current boot, read the way the keeper reads it.

.DESCRIPTION
The first line is parsed as an ISO 8601 time in the invariant culture, assumed UTC where it carries
no offset, and compared with the boot time within SameBootSeconds. A marker that is absent, empty,
unreadable or unparseable is another boot, and so is every marker where the boot time is unknown.
#>
function Test-FleetBootMarker {
    param([Parameter(Mandatory)][string]$Path, [AllowNull()][object]$BootTime)
    if ($null -eq $BootTime) { return $false }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $markerBoot = [DateTimeOffset]::MinValue
    $parsed = $false
    try {
        $first = @(Get-Content -LiteralPath $Path -Encoding UTF8 -TotalCount 1 -ErrorAction Stop)
        if ($first.Count -gt 0) {
            $parsed = [DateTimeOffset]::TryParse(([string]$first[0]).Trim(), $script:Invariant, [System.Globalization.DateTimeStyles]::AssumeUniversal, [ref]$markerBoot)
        }
    } catch { }
    return ($parsed -and [Math]::Abs(($markerBoot.UtcDateTime - $BootTime).TotalSeconds) -lt $script:SameBootSeconds)
}

<#
.SYNOPSIS
Starts one keeper for a persona and returns its process, id and start time.

.DESCRIPTION
The command line is the one the per-persona scheduled task carried, each argument quoted through
ConvertTo-NativeArgument the way the keeper quotes the supervisor's, so a roster or env file path
with a space arrives whole. The process is started detached, with no stream of this script's own
handed down, so the keeper outlives a fleet supervisor that exits, and the next one finds it again
by its command line. Whether it outlives one that Task Scheduler stops depends on how the scheduler
ends the task, which this script does not set. The handle is read as the next statement after the
start, since the exit time is readable afterwards only where the handle was taken while the process
was alive. A start that fails throws, and the caller logs it and tries again next tick.
#>
function Start-FleetKeeper {
    param([Parameter(Mandatory)][string]$Name)
    $arguments = @('-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', $KeeperLauncher, '-Name', $Name, '-Roster', $Roster, '-EnvFile', $EnvFile)
    $native = @($arguments | ForEach-Object { ConvertTo-NativeArgument $_ })
    $process = Start-Process -FilePath $script:PowerShellExe -ArgumentList $native -WindowStyle Hidden -PassThru -ErrorAction Stop
    $null = $process.Handle
    $started = [DateTime]::UtcNow
    try { $started = $process.StartTime.ToUniversalTime() } catch { }
    return @{ Process = $process; ProcessId = [int]$process.Id; StartedUtc = $started }
}

# The type behind New-FleetCloneJob: a Windows job object with one limit, kill on close. Every
# process assigned to it, and every process those start after the assignment, ends together when
# the job is terminated and when its last handle closes. Start creates the clone's process
# suspended, assigns it to the job and only then resumes it, so the process runs no instruction,
# and starts no child, before it is in the job. Each call reports a failure as the Win32 error
# behind it, so a log line names what the system refused.
$script:FleetCloneJobSource = @'
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

// What Start hands back: the process handle, held until the clone is over so its id is not reused
// under the caller; the id; the parent's read end of each pipe; and the join's failure, where the
// job refused the process, null where it joined.
public sealed class FleetCloneStart
{
    public IntPtr Process;
    public int ProcessId;
    public FileStream Stdout;
    public FileStream Stderr;
    public string JoinError;
}

public static class FleetCloneJob
{
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const int STARTF_USESTDHANDLES = 0x00000100;
    private const int STD_INPUT_HANDLE = -10;
    private const uint HANDLE_FLAG_INHERIT = 0x00000001;

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public bool bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, string environment, string currentDirectory, ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(out IntPtr readPipe, out IntPtr writePipe, ref SECURITY_ATTRIBUTES pipeAttributes, int size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int which);

    // An anonymous pipe whose write end the child inherits and whose read end stays this process's
    // alone: a read end the child also held would never reach its end.
    private static void MakePipe(out IntPtr read, out IntPtr write)
    {
        SECURITY_ATTRIBUTES attributes = new SECURITY_ATTRIBUTES();
        attributes.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
        attributes.bInheritHandle = true;
        if (!CreatePipe(out read, out write, ref attributes, 0)) throw new Win32Exception();
        if (!SetHandleInformation(read, HANDLE_FLAG_INHERIT, 0))
        {
            int error = Marshal.GetLastWin32Error();
            CloseHandle(read);
            CloseHandle(write);
            throw new Win32Exception(error);
        }
    }

    // This process's environment with the given pairs replacing any same-named entry, in the block
    // shape CreateProcessW takes: name=value entries each ended by a null, then one more null.
    private static string EnvironmentBlock(string[] names, string[] values)
    {
        SortedDictionary<string, string> map = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables()) map[(string)entry.Key] = (string)entry.Value;
        for (int i = 0; i < names.Length; i++) map[names[i]] = values[i];
        StringBuilder block = new StringBuilder();
        foreach (KeyValuePair<string, string> pair in map) block.Append(pair.Key).Append('=').Append(pair.Value).Append('\0');
        block.Append('\0');
        return block.ToString();
    }

    // Starts the command line suspended, with its standard output and error on fresh pipes and
    // its standard input this process's, assigns the process to the job, and resumes it. A job of
    // zero is joined to nothing. A refusal from the job is carried in the result, not thrown, so
    // the clone runs on outside it; a refusal from anything else ends the process and throws.
    public static FleetCloneStart Start(IntPtr job, string commandLine, string workingDirectory, string[] names, string[] values)
    {
        IntPtr outRead = IntPtr.Zero, outWrite = IntPtr.Zero, errRead = IntPtr.Zero, errWrite = IntPtr.Zero;
        PROCESS_INFORMATION info = new PROCESS_INFORMATION();
        try
        {
            MakePipe(out outRead, out outWrite);
            MakePipe(out errRead, out errWrite);
            STARTUPINFO startup = new STARTUPINFO();
            startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            startup.dwFlags = STARTF_USESTDHANDLES;
            startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
            startup.hStdOutput = outWrite;
            startup.hStdError = errWrite;
            if (!CreateProcessW(null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, EnvironmentBlock(names, values), workingDirectory, ref startup, out info))
            {
                throw new Win32Exception();
            }
            FleetCloneStart result = new FleetCloneStart();
            result.Process = info.hProcess;
            result.ProcessId = info.dwProcessId;
            if (job != IntPtr.Zero && !AssignProcessToJobObject(job, info.hProcess)) result.JoinError = new Win32Exception().Message;
            if (ResumeThread(info.hThread) == unchecked((uint)-1))
            {
                int error = Marshal.GetLastWin32Error();
                TerminateProcess(info.hProcess, 1);
                throw new Win32Exception(error);
            }
            CloseHandle(info.hThread);
            info.hThread = IntPtr.Zero;
            CloseHandle(outWrite);
            outWrite = IntPtr.Zero;
            CloseHandle(errWrite);
            errWrite = IntPtr.Zero;
            result.Stdout = new FileStream(new SafeFileHandle(outRead, true), FileAccess.Read);
            outRead = IntPtr.Zero;
            result.Stderr = new FileStream(new SafeFileHandle(errRead, true), FileAccess.Read);
            errRead = IntPtr.Zero;
            info.hProcess = IntPtr.Zero;
            return result;
        }
        finally
        {
            if (info.hThread != IntPtr.Zero) CloseHandle(info.hThread);
            if (info.hProcess != IntPtr.Zero) CloseHandle(info.hProcess);
            if (outRead != IntPtr.Zero) CloseHandle(outRead);
            if (outWrite != IntPtr.Zero) CloseHandle(outWrite);
            if (errRead != IntPtr.Zero) CloseHandle(errRead);
            if (errWrite != IntPtr.Zero) CloseHandle(errWrite);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits
    {
        public BasicLimits BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, int size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    public static IntPtr Create()
    {
        IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception();
        ExtendedLimits limits = new ExtendedLimits();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, Marshal.SizeOf(typeof(ExtendedLimits))))
        {
            int error = Marshal.GetLastWin32Error();
            CloseHandle(job);
            throw new Win32Exception(error);
        }
        return job;
    }

    public static void Terminate(IntPtr job)
    {
        if (!TerminateJobObject(job, 1)) throw new Win32Exception();
    }

    public static void Close(IntPtr job)
    {
        CloseHandle(job);
    }
}
'@

<#
.SYNOPSIS
Opens the job object a clone runs under, so a kill at the bound reaches every process git started.

.DESCRIPTION
The job carries one limit, kill on close: every process assigned to it, and every process those
start after the assignment, ends together when the job is terminated, and when its last handle
closes, so a throw past the handle still leaves nothing of the clone running. The type behind it
is loaded by the caller, Invoke-FleetClone, before this call. A refusal from the system is a throw
naming it.

Returns the job handle, an IntPtr the caller closes through [FleetCloneJob]::Close.
#>
function New-FleetCloneJob {
    return [FleetCloneJob]::Create()
}

<#
.SYNOPSIS
Clones an entry's repository into its working directory before the first start, or says why not.

.DESCRIPTION
The working directory is read first. One that cannot be resolved, such as a path on a drive that is
not there, or that is a file, is a failure; one that is a directory holding anything is skipped,
whatever the URL, since a clone never lands on a directory in use. Only for one absent or empty is
the URL then judged, through Test-FleetRepoUrl, so a value outside the two shapes the roster
validator admits never reaches git. git is the first application named git on this process's
path, the task account's, and its absence is a failure. The clone is git clone <repo> <workdir> with no other
argument, each quoted through ConvertTo-NativeArgument, run in the working directory's parent,
created where missing, and waited on for at most CloneBoundSeconds. Five variables go into the
child's environment alone, never this process's: GIT_TERMINAL_PROMPT=0 and GCM_INTERACTIVE=never,
so a URL whose credentials the account lacks fails rather than holding the tick on a prompt no
console will answer; GIT_SSH_COMMAND=ssh -o BatchMode=yes, so ssh fails the same way rather than
asking; and GIT_HTTP_LOW_SPEED_LIMIT=1 with GIT_HTTP_LOW_SPEED_TIME=300, so git itself abandons a
transfer under 1 byte a second for 300 seconds. Standard output is drained and standard error kept,
since its last line is what git says went wrong. Both are read asynchronously, so a chatty clone
cannot fill one pipe while this process waits on the other.

The clone runs under a job object this function holds, opened through New-FleetCloneJob before the
start. The process is created suspended through [FleetCloneJob]::Start, assigned to the job and
then resumed, so it runs no instruction, and starts no child, before it is in the job, and every
process git starts is in it too. A clone the job refused is one WARN line and runs on outside it.
The type behind the job is compiled before the job is opened, and a type that cannot be compiled
is a failure whose reason names the compile error, with no git run.
The process handle Start returns is held until the clone is over, so its id names it and no
other. A clone still running at the bound is
killed through the job, which ends the clone and every process it started together, or through
its own handle alone where it joined no job, and given 5 seconds to go. A stream whose read has
not finished by then is left unread, since a process that inherited the pipe can hold it open
past its parent's death. A clone that exited has its job closed first, which ends anything it
left running, and its reads are then waited on for at most 5 seconds, the bound for a holder that
joined no job. The job is closed on every path. The working directory is then returned to what it
was before the clone: removed where the clone created it, emptied where it existed empty, since a
later tick reads a directory holding anything as one in use and starts a keeper on the half clone.
A dying child can hold a file for a moment, so the removal is tried 10 times 500 ms apart, and a
removal still failing is one ERROR line naming the directory. The outcome is failed either way, with a
reason naming the bound and git's last stderr line where one was read.

Returns a hashtable: Outcome is cloned, skipped or failed; Reason is one line of text fit for the
log; Target is the resolved working directory.
#>
function Invoke-FleetClone {
    param([Parameter(Mandatory)][string]$Repo, [Parameter(Mandatory)][string]$WorkDir, [Parameter(Mandatory)][int]$CloneBoundSeconds)
    try {
        $target = Resolve-FleetPath $WorkDir
    } catch {
        return @{ Outcome = 'failed'; Reason = "workdir '$WorkDir' could not be resolved: $($_.Exception.Message)"; Target = $WorkDir }
    }
    if (Test-Path -LiteralPath $target -PathType Leaf) { return @{ Outcome = 'failed'; Reason = "workdir '$target' exists as a file, so nothing is cloned into it"; Target = $target } }
    if (Test-Path -LiteralPath $target -PathType Container) {
        try {
            $held = @(Get-ChildItem -LiteralPath $target -Force -ErrorAction Stop | Select-Object -First 1)
        } catch {
            return @{ Outcome = 'failed'; Reason = "workdir '$target' could not be listed: $($_.Exception.Message)"; Target = $target }
        }
        if ($held.Count -gt 0) { return @{ Outcome = 'skipped'; Reason = "workdir '$target' exists and is not empty"; Target = $target } }
    }
    $refusal = Test-FleetRepoUrl -Url $Repo
    if ($null -ne $refusal) { return @{ Outcome = 'failed'; Reason = "repo refused before git ran: $refusal"; Target = $target } }
    $git = @(Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($git.Count -eq 0) { return @{ Outcome = 'failed'; Reason = 'git is not on the path of the account this fleet supervisor runs as'; Target = $target } }
    $parent = Split-Path -Parent $target
    if ([string]::IsNullOrWhiteSpace($parent)) { return @{ Outcome = 'failed'; Reason = "workdir '$target' has no parent directory to clone from"; Target = $target } }
    $code = -1
    $stderr = ''
    $killed = $false
    # Whether the target was there before git, which is the state a killed clone is returned to.
    $existed = Test-Path -LiteralPath $target -PathType Container
    # The job the clone runs under, zero where it joined none.
    $job = [IntPtr]::Zero
    try {
        [void][System.IO.Directory]::CreateDirectory($parent)
        # The type behind the job and the start is compiled on the first clone in this process and
        # found by name on every later one, since a second Add-Type of a name already loaded is an
        # error. It is loaded outside the try below, so a type that cannot be compiled is a failed
        # clone naming the compile error, reached before git runs.
        if ($null -eq ('FleetCloneJob' -as [type])) { Add-Type -TypeDefinition $script:FleetCloneJobSource -ErrorAction Stop }
        # Opened before the start, so that the join is the first thing done once git is running. A
        # job the system refuses leaves the clone outside any job, killed at the bound through its
        # own handle alone.
        try {
            $job = New-FleetCloneJob
        } catch {
            $job = [IntPtr]::Zero
            Write-FleetLog "WARN the clone of '$Repo' runs under no job object, so a kill at the bound reaches git alone: $($_.Exception.Message)"
        }
        # git's path and the three arguments, each quoted through ConvertTo-NativeArgument, as the
        # one command line the process is started on. The five variables go into its environment
        # block alone, built from this process's environment, which they never enter. The process
        # is created suspended, joined to the job and then resumed, so nothing it does, a child it
        # starts included, happens outside the job.
        $commandLine = (@($git[0].Path, 'clone', $Repo, $target) | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '
        $envNames = [string[]]@('GIT_TERMINAL_PROMPT', 'GCM_INTERACTIVE', 'GIT_SSH_COMMAND', 'GIT_HTTP_LOW_SPEED_LIMIT', 'GIT_HTTP_LOW_SPEED_TIME')
        $envValues = [string[]]@('0', 'never', 'ssh -o BatchMode=yes', '1', '300')
        $start = [FleetCloneJob]::Start($job, $commandLine, $parent, $envNames, $envValues)
        $process = $null
        $stdoutReader = $null
        $stderrReader = $null
        $stdoutTask = $null
        $stderrTask = $null
        try {
            if ($null -ne $start.JoinError) {
                [FleetCloneJob]::Close($job); $job = [IntPtr]::Zero
                Write-FleetLog "WARN the clone of '$Repo' runs under no job object, so a kill at the bound reaches git alone: $($start.JoinError)"
            }
            # The process by its id, which the handle Start returned pins against reuse until the
            # finally below, so the wait, the exit code and the kill read the clone and no other.
            $process = [System.Diagnostics.Process]::GetProcessById($start.ProcessId)
            # Read once so the object caches its own handle, as Start-FleetKeeper does: a Process
            # that did not start its process cannot read its exit code after it has gone otherwise.
            $null = $process.Handle
            $stdoutReader = New-Object System.IO.StreamReader($start.Stdout)
            $stderrReader = New-Object System.IO.StreamReader($start.Stderr)
            $stdoutTask = $stdoutReader.ReadToEndAsync()
            $stderrTask = $stderrReader.ReadToEndAsync()
            if ($process.WaitForExit($CloneBoundSeconds * 1000)) {
                $code = $process.ExitCode
                # A read ends only once every holder of the pipe has let go, and a process git left
                # behind holds it. Closing the job ends that process, so the reads finish; the bound
                # on the wait is for a holder that joined no job, whose read is left unread.
                if ($job -ne [IntPtr]::Zero) { [FleetCloneJob]::Close($job); $job = [IntPtr]::Zero }
                try { [void][System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($stdoutTask, $stderrTask), 5000) } catch { }
                if ($stderrTask.Status -eq 'RanToCompletion') { $stderr = $stderrTask.Result }
            } else {
                $killed = $true
                # Through the job where the clone joined one, which ends it and every process it
                # started together; through its own handle otherwise, or where the job refused.
                $ended = $false
                if ($job -ne [IntPtr]::Zero) { try { [FleetCloneJob]::Terminate($job); $ended = $true } catch { } }
                if (-not $ended) { try { $process.Kill() } catch { } }
                [void]$process.WaitForExit(5000)
                # A read still pending is one a grandchild holds open; its Result would wait as long.
                if ($stderrTask.Status -eq 'RanToCompletion') { $stderr = $stderrTask.Result }
            }
        } finally {
            if ($null -ne $process) { $process.Dispose() }
            # A reader whose read finished is closed here; one still pending is left to end with
            # the read, since closing its pipe under a blocked read is no way to end it.
            if ($null -ne $stdoutTask -and $stdoutTask.IsCompleted) { $stdoutReader.Dispose() }
            if ($null -ne $stderrTask -and $stderrTask.IsCompleted) { $stderrReader.Dispose() }
            # A reader never made leaves its stream to the finalizer, so the stream is closed directly.
            if ($null -eq $stdoutReader) { $start.Stdout.Dispose() }
            if ($null -eq $stderrReader) { $start.Stderr.Dispose() }
            # Closing the job ends anything still in it, on a throw as on the kill path. The
            # process handle goes beside it, which releases the clone's id.
            if ($job -ne [IntPtr]::Zero) { [FleetCloneJob]::Close($job); $job = [IntPtr]::Zero }
            [FleetCloneJob]::Close($start.Process)
        }
    } catch {
        # A start that threw leaves a job holding nothing, closed here since no process joined it.
        if ($job -ne [IntPtr]::Zero) { [FleetCloneJob]::Close($job) }
        return @{ Outcome = 'failed'; Reason = "git clone could not run: $($_.Exception.Message)"; Target = $target }
    }
    if ($killed) {
        $removeError = $null
        for ($try = 0; $try -lt 10; $try++) {
            try {
                if ($existed) {
                    [void][System.IO.Directory]::CreateDirectory($target)
                    Get-ChildItem -LiteralPath $target -Force -ErrorAction Stop | Remove-Item -Recurse -Force -ErrorAction Stop
                } elseif (Test-Path -LiteralPath $target) {
                    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
                }
                $removeError = $null
                break
            } catch {
                $removeError = $_.Exception.Message
                Start-Sleep -Milliseconds 500
            }
        }
        if ($null -ne $removeError) { Write-FleetLog "ERROR the killed clone's workdir '$target' could not be returned to its state before the clone: $removeError" }
    }
    $last = ''
    foreach ($line in [regex]::Split([string]$stderr, '\r?\n')) { if ($line.Trim().Length -gt 0) { $last = $line.Trim() } }
    if ($killed) {
        $reason = "git clone killed after $CloneBoundSeconds s"
        if ($last.Length -gt 0) { $reason = "$reason`: $last" }
        return @{ Outcome = 'failed'; Reason = $reason; Target = $target }
    }
    if ($code -ne 0) { return @{ Outcome = 'failed'; Reason = "git clone exited $code`: $last"; Target = $target } }
    return @{ Outcome = 'cloned'; Reason = 'git clone exited 0'; Target = $target }
}

<#
.SYNOPSIS
Opens a handle to a keeper found live, so its exit time is readable once it has gone, or returns nothing.
#>
function Open-FleetKeeperHandle {
    param([Parameter(Mandatory)][int]$ProcessId)
    $process = $null
    try {
        $process = [System.Diagnostics.Process]::GetProcessById($ProcessId)
        $null = $process.Handle
        return $process
    } catch {
        if ($null -ne $process) { $process.Dispose() }
        return $null
    }
}

<#
.SYNOPSIS
Holds a keeper's process object for an entry, or clears the entry's slot where Process is null.

.DESCRIPTION
The object the slot held before is disposed, so a loop that runs for weeks holds one OS handle per
entry rather than one per keeper it ever started.
#>
function Set-FleetHandle {
    param([Parameter(Mandatory)][string]$Key, [AllowNull()][System.Diagnostics.Process]$Process, [int]$ProcessId)
    $held = $script:Handles[$Key]
    if ($null -ne $held -and -not [object]::ReferenceEquals($held.Process, $Process)) { $held.Process.Dispose() }
    if ($null -eq $Process) { $script:Handles.Remove($Key) } else { $script:Handles[$Key] = @{ Process = $Process; ProcessId = $ProcessId } }
}

<#
.SYNOPSIS
Returns how long the keeper a record names lived, where it has exited, or -1 where no keeper is known.

.DESCRIPTION
With a handle held for the record's pid, the uptime is the process's own exit time against its
start time. Without one, it is the record's start time against now, which overstates a keeper that
exited early in the tick interval; that is the fallback for a keeper an earlier fleet supervisor
started, and it reads a quick exit correctly only where the tick found it soon after.
#>
function Get-FleetExitedUptime {
    param([Parameter(Mandatory)][string]$Key, [Parameter(Mandatory)][System.Collections.IDictionary]$Record, [Parameter(Mandatory)][DateTime]$Now)
    if ($Record.action -ne 'started' -and $Record.action -ne 'adopted') { return -1 }
    $held = $script:Handles[$Key]
    if ($null -ne $held -and $held.ProcessId -eq [int]$Record.pid) {
        try {
            if ($held.Process.HasExited) {
                $seconds = [int][Math]::Floor(($held.Process.ExitTime - $held.Process.StartTime).TotalSeconds)
                if ($seconds -ge 0) { return $seconds }
            }
        } catch { }
    }
    $started = ConvertTo-FleetUtcTime $Record.startedAt
    if ($null -eq $started) { return -1 }
    $seconds = [int][Math]::Floor(($Now - $started).TotalSeconds)
    if ($seconds -lt 0) { $seconds = 0 }
    return $seconds
}

<#
.SYNOPSIS
Removes one marker file, logging RELEASE for a file removed; returns $false where it is still there.
#>
function Remove-FleetMarker {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $true }
    try {
        Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
        Write-FleetLog "RELEASE $Path"
        return $true
    } catch {
        Write-FleetLog "ERROR marker '$Path' could not be removed: $($_.Exception.Message)"
        return $false
    }
}

<#
.SYNOPSIS
Writes the shutdown request and the fleet.retired sidecar into a run directory; returns $false where either failed.

.DESCRIPTION
The supervisor reads shutdown.request by its presence, whatever it holds, so both files carry one
line naming the moment and the reason for the operator. The request is written only beside the
sidecar: a request with no sidecar would end as a hold the fleet supervisor could not tell from
one it did not ask for, which would strand the persona once re-added.
#>
function Write-FleetRetireRequest {
    param([Parameter(Mandatory)][string]$RunDir, [Parameter(Mandatory)][string]$Reason)
    $line = [string[]]@("$([DateTime]::UtcNow.ToString('o', $script:Invariant)) Start-Fleet: $Reason")
    try {
        [System.IO.File]::WriteAllLines((Join-Path $RunDir 'fleet.retired'), $line, $script:Utf8NoBom)
        [System.IO.File]::WriteAllLines((Join-Path $RunDir 'shutdown.request'), $line, $script:Utf8NoBom)
        return $true
    } catch {
        Write-FleetLog "ERROR retire request could not be written in '$RunDir': $($_.Exception.Message)"
        return $false
    }
}

<#
.SYNOPSIS
Reads the launcher that started this script off the tick's process list; returns the read, or nothing where the list holds no record of this process.

.DESCRIPTION
Processes is the tick's own process list. A list that holds no record of this process answers
nothing, and the launcher is read again off the next list. Otherwise this process's record names
its parent. A parent record created no later than this process is the launcher only where the
token after the first -File on its command line is a path whose file name is
Start-InstalledFleet.ps1, compared whole and ignoring case, which is the read
Test-KeeperFleetSupervisorCommandLine (bin/keeper-functions.ps1) makes of a fleet script. A parent
that runs anything else turns the follow rule off, so a fleet supervisor that a task, a test or a
hand run started directly follows no parent. A parent id the list does not hold, or one a process
created after this process holds, is a parent that has already gone. Where the four values were
given, which only the launcher gives, that is the launcher gone; where they were not, the follow
rule is off. A record with no creation time to compare is read as created no later.

Returns $null where the list holds no record of this process, or a hashtable: Launcher is the
followed process's ProcessId and CreationDate, or $null where the follow rule is off, and Gone says
the launcher has already gone.
#>
function Get-FleetLauncher {
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Processes)
    $ignoreCase = [System.StringComparison]::OrdinalIgnoreCase
    $own = $null
    foreach ($record in $Processes) {
        if ($null -ne $record -and [int]$record.ProcessId -eq $PID) { $own = $record; break }
    }
    if ($null -eq $own) { return $null }
    $parent = $null
    foreach ($record in $Processes) {
        if ($null -ne $record -and [string]$record.ProcessId -eq [string]$own.ParentProcessId) { $parent = $record; break }
    }
    # A parent created after this process holds a reused id: the process that started this one has gone.
    if ($null -ne $parent -and $null -ne $parent.CreationDate -and $null -ne $own.CreationDate -and [DateTime]$parent.CreationDate -gt [DateTime]$own.CreationDate) {
        $parent = $null
    }
    if ($null -eq $parent) {
        if ($script:LauncherGaveValues) {
            return @{ Launcher = @{ ProcessId = [int]$own.ParentProcessId; CreationDate = $null }; Gone = $true }
        }
        return @{ Launcher = $null; Gone = $false }
    }
    $tokens = Split-KeeperCommandLine -CommandLine ([string]$parent.CommandLine)
    for ($k = 1; $k -lt $tokens.Count - 1; $k++) {
        if (-not [string]::Equals($tokens[$k], '-File', $ignoreCase)) { continue }
        $leaf = $tokens[$k + 1].Substring($tokens[$k + 1].LastIndexOfAny([char[]]@('\', '/')) + 1)
        if ([string]::Equals($leaf, 'Start-InstalledFleet.ps1', $ignoreCase)) {
            return @{ Launcher = @{ ProcessId = [int]$parent.ProcessId; CreationDate = $parent.CreationDate }; Gone = $false }
        }
        break
    }
    return @{ Launcher = $null; Gone = $false }
}

<#
.SYNOPSIS
Says whether the launcher this script follows has gone, read off the tick's own process list.

.DESCRIPTION
A list that holds no record of this process says nothing about the launcher, and reads as not
gone. Otherwise the launcher is gone where no record carries its id, or where the record that does
was created at another time, which is another process on a reused id. A record with no creation
time to compare is read as the launcher, since a fleet supervisor that ends wrongly leaves the
machine with none.
#>
function Test-FleetLauncherGone {
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Processes)
    $ownSeen = $false
    $held = $null
    foreach ($record in $Processes) {
        if ($null -eq $record) { continue }
        if ([int]$record.ProcessId -eq $PID) { $ownSeen = $true }
        if ($null -eq $held -and [int]$record.ProcessId -eq $script:Launcher.ProcessId) { $held = $record }
    }
    if (-not $ownSeen) { return $false }
    if ($null -eq $held) { return $true }
    if ($null -eq $held.CreationDate -or $null -eq $script:Launcher.CreationDate) { return $false }
    return ([DateTime]$held.CreationDate -ne [DateTime]$script:Launcher.CreationDate)
}

<#
.SYNOPSIS
Reads which build is installed and, where it is another whole build, takes its snapshot; returns the move or nothing.

.DESCRIPTION
The record is read through Get-InstalledPluginRecord and the snapshot taken through
Install-PluginSnapshot (bin/installed-plugin-functions.ps1), the functions the launchers use. A
record naming -RunningVersion is nothing to do. For any other version the install folder is read
first for every file $InstalledPluginRequiredFiles names, so a folder Claude Code is still writing
costs those file reads and no copy, and is read again after the next tick. Only a whole folder is
copied. A snapshot that fails, or one that holds no bin\Start-Fleet.ps1, is not tried again for
that version by this process, since the launcher could start nothing from it. Each cause that
leaves this build running is one ERROR line: once for a version, and for a record that does not
read, once until a read next succeeds.

Returns $null, or a hashtable the caller hands off on: Version is the new version and Snapshot its
snapshot folder.
#>
function Get-FleetNewBuild {
    try {
        $record = Get-InstalledPluginRecord -Path $PluginList -Id $PluginId
    } catch {
        if (-not $script:RecordUnread) {
            $script:RecordUnread = $true
            Write-FleetLog "ERROR new-build check: $($_.Exception.Message); version $($script:RunningBuild) keeps running and the list is read again after each tick"
        }
        return $null
    }
    $script:RecordUnread = $false
    $version = [string]$record.Version
    if ([string]::Equals($version, $RunningVersion, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
    if ($script:FailedVersions.Contains($version)) { return $null }

    $fault = $null
    try {
        $missing = @($InstalledPluginRequiredFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $record.InstallPath $_ -ErrorAction Stop) -PathType Leaf -ErrorAction Stop) })
        if ($missing.Count -gt 0) { $fault = "is missing $($missing -join ', ')" }
    } catch {
        $fault = "could not be read: $($_.Exception.Message)"
    }
    if ($null -ne $fault) {
        if ($script:IncompleteVersions.Add($version)) {
            Write-FleetLog "ERROR new-build check: the install folder '$($record.InstallPath)' of version $version $fault; version $($script:RunningBuild) keeps running and the folder is read again after each tick"
        }
        return $null
    }

    try {
        $snapshot = Install-PluginSnapshot -InstallPath $record.InstallPath -Version $version -RuntimeRoot $RuntimeRoot
        if (-not (Test-Path -LiteralPath (Join-Path $snapshot 'bin\Start-Fleet.ps1') -PathType Leaf)) {
            throw "the snapshot '$snapshot' holds no bin\Start-Fleet.ps1"
        }
    } catch {
        [void]$script:FailedVersions.Add($version)
        Write-FleetLog "ERROR new-build check: the snapshot of version $version from '$($record.InstallPath)' failed and is not tried again by this fleet supervisor, so version $($script:RunningBuild) keeps running: $($_.Exception.Message)"
        return $null
    }
    return @{ Version = $version; Snapshot = $snapshot }
}

<#
.SYNOPSIS
Returns the launcher folder this script refreshes and the version it runs from, or nothing off the installed route.

.DESCRIPTION
Two things must hold. -KeeperLauncher names a file called Start-InstalledPersona.ps1, and this
script's own folder is runtime\<name>\bin under that file's folder. The folders are compared as
full paths, in which every slash runs one way, and without regard to case. So a script run from a
checkout, or from a runtime folder under any other folder, refreshes nothing, whatever
-KeeperLauncher names. The comparison reads the path text alone: a path spelled another way, as a
UNC form, refreshes nothing, and a link or junction inside either path is not
looked through.

Returns $null, or a hashtable: Folder is the launcher folder and Version is <name>, the name of
the snapshot folder the script runs from.
#>
function Get-FleetLauncherRefresh {
    $ignoreCase = [System.StringComparison]::OrdinalIgnoreCase
    $launcherFull = [System.IO.Path]::GetFullPath($KeeperLauncher)
    if (-not [string]::Equals([System.IO.Path]::GetFileName($launcherFull), 'Start-InstalledPersona.ps1', $ignoreCase)) { return $null }
    $folder = [System.IO.Path]::GetDirectoryName($launcherFull)
    $own = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
    $versionFolder = [System.IO.Path]::GetDirectoryName($own)
    if ([string]::IsNullOrEmpty($folder) -or [string]::IsNullOrEmpty($versionFolder)) { return $null }
    $version = [System.IO.Path]::GetFileName($versionFolder)
    if ([string]::IsNullOrEmpty($version)) { return $null }
    $expected = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($folder, 'runtime', $version, 'bin'))
    if (-not [string]::Equals($own, $expected, $ignoreCase)) { return $null }
    return @{ Folder = $folder; Version = $version }
}

<#
.SYNOPSIS
Replaces each launcher file whose bytes differ from this build's copy, with one REFRESH line per file replaced.

.DESCRIPTION
Does nothing where Get-FleetLauncherRefresh names no folder. Otherwise the files LauncherFileNames
lists are taken in order. One the launcher folder lacks is skipped, so no file is ever created
there, and so is one this script's own folder lacks. Where both are there and their bytes are
equal, nothing is written and the file keeps its last-write time. Where they differ, the new bytes
are written through to disk in a new file .<file>.<pid>.tmp in the launcher folder, a name no
launcher file carries and one that must not exist yet, and one rename puts that file over the old
one (FleetLauncherFile). The rename's type is compiled before the temporary file is written. A
read, a compile, a write or a rename that fails is one ERROR line for that file and ends the
refresh: the old file is as it was, a temporary file this run made is removed, or named in that
line where it could not be, and the files after it are left as they were. Nothing else in the
launcher folder is written or removed.
#>
function Update-FleetLauncherFiles {
    $refresh = Get-FleetLauncherRefresh
    if ($null -eq $refresh) { return }
    for ($index = 0; $index -lt $script:LauncherFileNames.Count; $index++) {
        $name = $script:LauncherFileNames[$index]
        $target = Join-Path $refresh.Folder $name
        $source = Join-Path $PSScriptRoot $name
        $temp = Join-Path $refresh.Folder ".$name.$PID.tmp"
        $made = $false
        try {
            if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { continue }
            if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
            [byte[]]$new = [System.IO.File]::ReadAllBytes($source)
            [byte[]]$old = [System.IO.File]::ReadAllBytes($target)
            if ([System.Linq.Enumerable]::SequenceEqual($old, $new)) { continue }
            if ($null -eq ('FleetLauncherFile' -as [type])) { Add-Type -TypeDefinition $script:FleetLauncherFileSource -ErrorAction Stop }
            $stream = New-Object System.IO.FileStream($temp, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None, 4096, [System.IO.FileOptions]::WriteThrough)
            $made = $true
            try {
                $stream.Write($new, 0, $new.Length)
                $stream.Flush($true)
            } finally {
                $stream.Dispose()
            }
            [FleetLauncherFile]::RenameOver($temp, $target)
            Write-FleetLog "REFRESH $name from version $($refresh.Version): the copy '$target' differed from this build's and was replaced"
        } catch {
            $fault = $_.Exception.Message
            $stray = ''
            if ($made -and (Test-Path -LiteralPath $temp)) {
                Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
                if (Test-Path -LiteralPath $temp) { $stray = "; the temporary file '$temp' could not be removed" }
            }
            $left = @($script:LauncherFileNames | Select-Object -Skip ($index + 1))
            $after = ''
            if ($left.Count -gt 0) { $after = ", and $($left -join ', ') are left as they were" }
            Write-FleetLog "ERROR refresh of '$target' from version $($refresh.Version) failed, so the old copy stays as it was$after$($stray): $fault"
            return
        }
    }
}

<#
.SYNOPSIS
Runs one tick: reads the roster, the state and the process list, and applies one decision per entry.

.DESCRIPTION
The roster is judged first, and a roster that cannot be read ends the tick with one ERROR line and
nothing changed. Each entry is then judged on its own: one with no name, with an enabled field that
is not a JSON boolean, with neither rundir nor workdir, with a repo and no workdir to clone it
into, or whose name another entry carries once
case is ignored, is one ERROR line and is left alone, as is every keeper for it. The process list
is read once; a read that fails ends the tick, since a liveness unknown is no basis for a start or
a retire. The first list read that holds this process's own record is where the launcher that
started this script is read (Get-FleetLauncher). A launcher already gone at that read, which
counts only where the four values were given, or gone from a later list that holds this process's
own record, ends the run at exit 0 with one LAUNCHER-GONE line, before any entry is judged. Names
come from the roster and from the state, so a keeper whose entry has left the roster is still
judged, through the run directory its record holds. A live keeper neither names is logged
unknown once and left alone. The boot time is read once per tick, and only where some entry has no
live keeper, since only a boot marker read needs it. A live keeper is asked to stop in the run
directory its record says it was started on, which an edit to rundir or workdir moves away from
the roster's; the roster's directory is where the next keeper starts. A start of an entry carrying
repo clones first (Invoke-FleetClone), and a clone that fails is recorded clone-failed with a
notBefore the ladder sets, which the next ticks wait out before trying again. The clock is read again
when a clone returns, since a clone can hold the tick up to -CloneBoundSeconds: the wait counts from
the clone's end, and every entry handled after it is stamped no earlier than that end. The state is written
once at the end where any record changed, and once more after a clone, before the start it leads to.
A start decided once StartsPerTick keepers have started this tick is left untouched, before any
record, release or clone, and its name goes into one deferred line written after the pass; the
count it leaves is set in FleetDeferredCount for the main loop's wait.
#>
function Invoke-FleetTick {
    $script:FleetDeferredCount = 0
    $now = [DateTime]::UtcNow
    try {
        $entries = Read-FleetRoster -Path $Roster
    } catch {
        Write-FleetLog "ERROR roster: $($_.Exception.Message)"
        return
    }

    $wanted = [ordered]@{}
    $faulted = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($entry in $entries) {
        if ($null -eq $entry) { continue }
        $name = [string]$entry.name
        if ([string]::IsNullOrWhiteSpace($name)) {
            Write-FleetLog "ERROR roster '$Roster' holds an entry with no name, left alone"
            continue
        }
        $key = $name.ToLowerInvariant()
        if ($wanted.Contains($key) -or $faulted.Contains($key)) {
            Write-FleetLog "ERROR roster '$Roster' names '$name' more than once, left alone"
            [void]$wanted.Remove($key)
            [void]$faulted.Add($key)
            continue
        }
        $enabledProperty = $entry.PSObject.Properties['enabled']
        if ($null -eq $enabledProperty -or $enabledProperty.Value -isnot [bool]) {
            Write-FleetLog "ERROR roster '$Roster' entry '$name' has no 'enabled' field that is a JSON boolean, left alone"
            [void]$faulted.Add($key)
            continue
        }
        $runDir = Get-FleetRunDirectory -Entry $entry
        if ($null -eq $runDir) {
            Write-FleetLog "ERROR roster '$Roster' entry '$name' names neither rundir nor workdir, left alone"
            [void]$faulted.Add($key)
            continue
        }
        if (-not [string]::IsNullOrWhiteSpace([string]$entry.repo) -and [string]::IsNullOrWhiteSpace([string]$entry.workdir)) {
            Write-FleetLog "ERROR roster '$Roster' entry '$name' names a repo and no workdir, which a repo needs to clone into, left alone"
            [void]$faulted.Add($key)
            continue
        }
        $wanted[$key] = @{ Name = $name; Enabled = [bool]$enabledProperty.Value; Fingerprint = (Get-FleetEntryFingerprint -Entry $entry); RunDir = $runDir; Repo = [string]$entry.repo; WorkDir = [string]$entry.workdir }
    }

    $records = Read-FleetState
    try {
        $processes = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CommandLine, CreationDate -OperationTimeoutSec 30 -ErrorAction Stop)
    } catch {
        Write-FleetLog "ERROR SCAN failed, nothing decided this tick: $($_.Exception.Message)"
        return
    }

    # The launcher is read once, off the first process list that holds this process's own record,
    # and a list that lacks that record decides nothing about the launcher. A launcher that has
    # gone, found so at that read or on a later list, ends the run here, before anything is
    # decided: no keeper is started or retired and no state is written, and the keepers run on for
    # the fleet supervisor the next task start brings.
    $launcherGone = $false
    $goneAtFirstRead = $false
    if (-not $script:LauncherRead) {
        $read = Get-FleetLauncher -Processes $processes
        if ($null -ne $read) {
            $script:LauncherRead = $true
            $script:Launcher = $read.Launcher
            $launcherGone = $read.Gone
            $goneAtFirstRead = $read.Gone
        }
    } elseif ($null -ne $script:Launcher) {
        $launcherGone = Test-FleetLauncherGone -Processes $processes
    }
    if ($goneAtFirstRead) {
        Write-FleetLog "LAUNCHER-GONE pid=$($script:Launcher.ProcessId): the process that started this fleet supervisor had ended by the first process list that holds this one, and the four values it was given name that process the launcher, so it ends at exit 0 and leaves every keeper as it is"
        exit 0
    }
    if ($launcherGone) {
        Write-FleetLog "LAUNCHER-GONE pid=$($script:Launcher.ProcessId): the Start-InstalledFleet.ps1 process that started this fleet supervisor is no longer running, so it ends at exit 0 and leaves every keeper as it is"
        exit 0
    }

    $keys = New-Object System.Collections.Generic.List[string]
    foreach ($key in $wanted.Keys) { $keys.Add($key) }
    foreach ($key in $records.Keys) { if (-not $keys.Contains($key)) { $keys.Add($key) } }

    # A keeper neither the roster nor the state names, logged once per process.
    foreach ($record in $processes) {
        if ($null -eq $record) { continue }
        $found = Get-FleetKeeperName -CommandLine ([string]$record.CommandLine) -LauncherNames $script:LauncherNames
        if ($null -eq $found) { continue }
        $foundKey = $found.ToLowerInvariant()
        if ($keys.Contains($foundKey) -or $faulted.Contains($foundKey)) { continue }
        $foundPid = [int]$record.ProcessId
        if ($script:UnknownLogged.Add($foundPid)) {
            Write-FleetLog "unknown pid=$foundPid name=$found`: in no roster entry and no state record, left alone"
        }
    }

    $bootTime = $null
    $bootRead = $false
    $changed = $false
    # The keepers this tick has started, and the names of the entries whose start it left for later.
    $startedCount = 0
    $deferred = New-Object System.Collections.Generic.List[string]
    foreach ($key in $keys) {
        if ($faulted.Contains($key)) { continue }
        $want = $wanted[$key]
        $record = $records[$key]
        # A removed entry's retired record is dropped on the tick after it is written, so the state
        # shows the retire and the keys every tick walks hold what the roster names and what is
        # still being retired rather than every name the roster ever held.
        if ($null -eq $want -and $null -ne $record -and [string]$record.action -eq 'retired') {
            [void]$records.Remove($key); $changed = $true; continue
        }
        $name = if ($null -ne $want) { $want.Name } else { [string]$record.name }
        $runDir = if ($null -ne $want) { $want.RunDir } else { [string]$record.rundir }
        $live = Find-FleetLiveKeeper -Processes $processes -LauncherNames $script:LauncherNames -Name $name
        $livePid = $null
        if ($null -ne $live) { $livePid = [int]$live.ProcessId }
        # The run directory the markers are read in and a retire writes into: the live keeper's own
        # where its record names it, else the roster's.
        $keeperDir = $runDir
        if ($null -ne $live -and $null -ne $record -and [string]$record.pid -eq [string]$livePid -and -not [string]::IsNullOrWhiteSpace([string]$record.rundir)) {
            $keeperDir = [string]$record.rundir
        }

        $holdPresent = $false; $retiredPresent = $false; $requestPresent = $false; $bootCurrent = $false; $uptime = -1
        if (-not [string]::IsNullOrWhiteSpace($keeperDir)) {
            $retiredPresent = Test-Path -LiteralPath (Join-Path $keeperDir 'fleet.retired') -PathType Leaf
            $requestPresent = Test-Path -LiteralPath (Join-Path $keeperDir 'shutdown.request') -PathType Leaf
        }
        if ($null -eq $live -and -not [string]::IsNullOrWhiteSpace($runDir)) {
            $holdPresent = Test-Path -LiteralPath (Join-Path $runDir 'keeper.hold') -PathType Leaf
            if (-not $bootRead) { $bootTime = Get-FleetBootTime; $bootRead = $true }
            $bootCurrent = Test-FleetBootMarker -Path (Join-Path $runDir 'keeper.boot') -BootTime $bootTime
            if ($null -ne $record) { $uptime = Get-FleetExitedUptime -Key $key -Record $record -Now $now }
        }
        $fingerprint = if ($null -ne $want) { $want.Fingerprint } else { $null }
        $decision = Get-FleetDecision -Present ($null -ne $want) -Enabled ($null -ne $want -and $want.Enabled) -Fingerprint $fingerprint `
            -Record $record -LiveProcessId $livePid -HoldPresent $holdPresent -RetiredPresent $retiredPresent -RequestPresent $requestPresent -BootCurrent $bootCurrent `
            -UptimeSeconds $uptime -Now $now -RetireBoundSeconds $RetireBoundSeconds
        if ($decision.Action -eq 'none') { continue }
        # Past the cap the entry is left as found: no record, no release, no clone, no start. Its
        # markers, record and keeper are unchanged, so the next tick decides the same start.
        if ($decision.Action -eq 'start' -and $startedCount -ge $StartsPerTick) {
            $deferred.Add($name)
            continue
        }

        $isNew = $null -eq $record
        if ($isNew) {
            $record = [ordered]@{ name = $name; action = $null; actionAt = $null; pid = $null; startedAt = $null; fingerprint = $null; rundir = $runDir; nextDelaySeconds = $decision.NextDelaySeconds; delaySeconds = $null; notBefore = $null; retireRequestedAt = $null }
            $records[$key] = $record
        }
        $stamp = $now.ToString('o', $script:Invariant)
        # A continue inside a switch leaves the switch, not the foreach, so a branch that cannot
        # apply its action clears this flag and breaks out instead.
        $applied = $true
        switch ($decision.Action) {
            'start' {
                if ($decision.Release) {
                    # The request goes first and the sidecar last, so a removal that fails leaves the
                    # sidecar in place and the next tick releases again.
                    $cleared = (Remove-FleetMarker -Path (Join-Path $runDir 'shutdown.request')) -and (Remove-FleetMarker -Path (Join-Path $runDir 'keeper.hold')) -and (Remove-FleetMarker -Path (Join-Path $runDir 'fleet.retired'))
                    if (-not $cleared) { $applied = $false; break }
                }
                if ($null -ne $want -and -not [string]::IsNullOrWhiteSpace($want.Repo)) {
                    # A throw, or no result, is a failure, so a keeper starts only on cloned or skipped.
                    $clone = $null
                    try {
                        $clone = Invoke-FleetClone -Repo $want.Repo -WorkDir $want.WorkDir -CloneBoundSeconds $CloneBoundSeconds
                    } catch {
                        $clone = @{ Outcome = 'failed'; Reason = "the clone step threw: $($_.Exception.Message)"; Target = $want.WorkDir }
                    }
                    if ($null -eq $clone) { $clone = @{ Outcome = 'failed'; Reason = 'the clone step returned no outcome'; Target = $want.WorkDir } }
                    $now = [DateTime]::UtcNow
                    $stamp = $now.ToString('o', $script:Invariant)
                    if ($clone.Outcome -eq 'skipped') {
                        $urlRefusal = Test-FleetRepoUrl -Url $want.Repo
                        if ($null -ne $urlRefusal) { Write-FleetLog "WARN $name has a repo the clone check refuses, and its workdir is in use so nothing is cloned: $urlRefusal" }
                    }
                    if ($clone.Outcome -ne 'cloned' -and $clone.Outcome -ne 'skipped') {
                        # The same ladder a quick exit climbs: this failure waits the carried value,
                        # and the next one waits double, up to the cap.
                        $delay = $decision.NextDelaySeconds
                        $next = $delay * 2
                        if ($next -gt $script:FleetMaxDelaySeconds) { $next = $script:FleetMaxDelaySeconds }
                        $record.action = 'clone-failed'; $record.actionAt = $stamp; $record.pid = $null; $record.rundir = $runDir
                        $record.delaySeconds = $delay; $record.nextDelaySeconds = $next
                        $record.notBefore = $now.AddSeconds($delay * $DelayScale).ToString('o', $script:Invariant)
                        Set-FleetHandle -Key $key -Process $null
                        Write-FleetLog "clone-failed $name repo=$($want.Repo) delay=$delay next=$next notBefore=$($record.notBefore)`: $($clone.Reason)"
                        break
                    }
                    if ($clone.Outcome -eq 'cloned') {
                        # Written now rather than with the tick's other changes, so the state shows
                        # the clone before the start it leads to.
                        $record.action = 'cloned'; $record.actionAt = $stamp; $record.rundir = $runDir
                        Write-FleetLog "cloned $name repo=$($want.Repo) into $($clone.Target)`: $($clone.Reason)"
                        Write-FleetState -Records $records
                    }
                }
                try {
                    $started = Start-FleetKeeper -Name $name
                } catch {
                    Write-FleetLog "ERROR start failed for $name`: $($_.Exception.Message)"
                    $applied = $false; break
                }
                Set-FleetHandle -Key $key -Process $started.Process -ProcessId $started.ProcessId
                $record.action = 'started'; $record.actionAt = $stamp; $record.pid = $started.ProcessId
                $record.startedAt = $started.StartedUtc.ToString('o', $script:Invariant)
                $record.fingerprint = $fingerprint; $record.rundir = $runDir
                $record.nextDelaySeconds = $decision.NextDelaySeconds; $record.delaySeconds = $null; $record.notBefore = $null; $record.retireRequestedAt = $null
                Write-FleetLog "started $name pid=$($started.ProcessId) launcher=$KeeperLauncher`: $($decision.Reason)"
                $startedCount++
            }
            'adopted' {
                if ($decision.ClearRetired) { [void](Remove-FleetMarker -Path (Join-Path $keeperDir 'fleet.retired')) }
                $process = Open-FleetKeeperHandle -ProcessId $livePid
                Set-FleetHandle -Key $key -Process $process -ProcessId $livePid
                $startedUtc = $now
                if ($null -ne $live.CreationDate) { $startedUtc = ([DateTime]$live.CreationDate).ToUniversalTime() }
                $record.action = 'adopted'; $record.actionAt = $stamp; $record.pid = $livePid
                $record.startedAt = $startedUtc.ToString('o', $script:Invariant)
                $record.fingerprint = $fingerprint; $record.rundir = $runDir
                $record.delaySeconds = $null; $record.notBefore = $null; $record.retireRequestedAt = $null
                Write-FleetLog "adopted $name pid=$livePid started=$($record.startedAt)`: $($decision.Reason)"
            }
            'retire' {
                if ([string]::IsNullOrWhiteSpace($keeperDir)) {
                    Write-FleetLog "ERROR retire of $name pid=$livePid`: its run directory is unknown, left alone"
                    $applied = $false; break
                }
                if (-not (Write-FleetRetireRequest -RunDir $keeperDir -Reason "retiring $name`: $($decision.Reason)")) { $applied = $false; break }
                $record.action = 'retiring'; $record.actionAt = $stamp; $record.pid = $livePid; $record.rundir = $keeperDir
                $record.retireRequestedAt = $stamp
                Write-FleetLog "retiring $name pid=$livePid`: $($decision.Reason); shutdown.request and fleet.retired written in $keeperDir"
            }
            'retire-timeout' {
                $record.action = 'retire-timeout'; $record.actionAt = $stamp
                Write-FleetLog "retire-timeout $name pid=$livePid`: $($decision.Reason)"
            }
            'backoff' {
                $record.action = 'backoff'; $record.actionAt = $stamp
                $record.delaySeconds = $decision.DelaySeconds; $record.nextDelaySeconds = $decision.NextDelaySeconds
                $record.notBefore = $now.AddSeconds($decision.DelaySeconds * $DelayScale).ToString('o', $script:Invariant)
                Set-FleetHandle -Key $key -Process $null
                Write-FleetLog "backoff $name pid=$($record.pid) delay=$($decision.DelaySeconds) next=$($decision.NextDelaySeconds) notBefore=$($record.notBefore)`: $($decision.Reason)"
            }
            default {
                # retired, held and parked: a state the record takes once, with no file written.
                $record.action = $decision.Action; $record.actionAt = $stamp
                if ($decision.Action -eq 'retired') { $record.retireRequestedAt = $null }
                Set-FleetHandle -Key $key -Process $null
                Write-FleetLog "$($decision.Action) $name`: $($decision.Reason)"
            }
        }
        if (-not $applied) {
            if ($isNew) { $records.Remove($key) }
            continue
        }
        $changed = $true
    }
    if ($deferred.Count -gt 0) {
        $script:FleetDeferredCount = $deferred.Count
        Write-FleetLog "deferred $($deferred.Count) of $($deferred.Count + $startedCount) starts to later ticks, -StartsPerTick $StartsPerTick`: $($deferred -join ', ')"
    }
    if ($changed) { Write-FleetState -Records $records }
}

# A keeper launcher that is not there makes every start exit at once, which the ticks read as quick
# exits and back off from without naming the file, so its absence ends the run at exit 1 with one
# ERROR line, and the fleet supervisor stays down until the task next starts.
if (-not (Test-Path -LiteralPath $KeeperLauncher -PathType Leaf)) {
    Write-FleetLog "ERROR keeper launcher '$KeeperLauncher' does not exist"
    exit 1
}

# The new-build check is on only where the launcher gave all four values. It reads the plugin's
# record and takes the snapshot through the shared functions file beside this script, which is
# loaded only then. Where that file is missing or does not load, the check is off for this run and
# one line says so. The follow rule reads whether the four values were given whatever that file
# holds, since a parent already gone counts as the launcher gone only where they were.
$script:LauncherGaveValues = -not ([string]::IsNullOrWhiteSpace($PluginList) -or [string]::IsNullOrWhiteSpace($PluginId) -or [string]::IsNullOrWhiteSpace($RunningVersion) -or [string]::IsNullOrWhiteSpace($RuntimeRoot))
$script:NewBuildCheck = $script:LauncherGaveValues
# The log names the build this script runs from: where it runs from a snapshot under -RuntimeRoot,
# that snapshot folder's name. After a fall-back that is the build before, while -RunningVersion
# holds the version that failed. A script run from anywhere else names -RunningVersion.
$script:RunningBuild = $RunningVersion
if ($script:LauncherGaveValues) {
    $ownBuild = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\'))
    $ownRoot = [System.IO.Path]::GetDirectoryName($ownBuild)
    if (-not [string]::IsNullOrEmpty($ownRoot) -and [string]::Equals($ownRoot, [System.IO.Path]::GetFullPath($RuntimeRoot).TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)) {
        $script:RunningBuild = [System.IO.Path]::GetFileName($ownBuild)
    }
}
if ($script:NewBuildCheck) {
    $sharedFunctions = Join-Path $PSScriptRoot 'installed-plugin-functions.ps1'
    $sharedFault = $null
    if (Test-Path -LiteralPath $sharedFunctions -PathType Leaf) {
        try { . $sharedFunctions } catch { $sharedFault = "did not load: $($_.Exception.Message)" }
    } else {
        $sharedFault = 'is missing'
    }
    if ($null -ne $sharedFault) {
        $script:NewBuildCheck = $false
        Write-FleetLog "ERROR the shared functions file '$sharedFunctions' $sharedFault, so the new-build check is off and version $($script:RunningBuild) runs until this fleet supervisor is started again"
    }
}

while ($true) {
    Invoke-FleetTick
    # The launcher files are refreshed once in this run: after the first tick that ends the scaled
    # RefreshAfterSeconds or more after the script's start, and ahead of that tick's new-build
    # check, so a tick that ends the run for a new build has refreshed them first. The refresh is
    # marked done before it runs, so one that failed is not tried again, and a fault in it reaches
    # neither the new-build check nor the loop.
    if (-not $script:RefreshDone -and $script:RunClock.Elapsed.TotalSeconds -ge ($script:RefreshAfterSeconds * $DelayScale)) {
        $script:RefreshDone = $true
        try {
            Update-FleetLauncherFiles
        } catch {
            Write-FleetLog "ERROR refresh of the launcher folder failed and is not tried again by this fleet supervisor: $($_.Exception.Message)"
        }
    }
    # The new-build check comes after the tick and its state write, never inside a tick, and under
    # -Once as well. The snapshot is taken before the exit, so the launcher's next pass finds it
    # present and an install still being written never ends this run.
    if ($script:NewBuildCheck) {
        $move = Get-FleetNewBuild
        if ($null -ne $move) {
            Write-FleetLog "HANDOFF running=$($script:RunningBuild) new=$($move.Version) snapshot=$($move.Snapshot): the plugin list names another version, so this fleet supervisor ends at exit 7 for its launcher to start that one, with every keeper left as it is"
            exit 7
        }
    }
    if ($Once) { break }
    # A tick that left starts for later is followed sooner, so the next batch starts in seconds.
    $wait = $TickSeconds
    if ($script:FleetDeferredCount -gt 0) { $wait = [Math]::Min($DeferredTickSeconds, $TickSeconds) }
    Start-Sleep -Seconds $wait
}
exit 0
