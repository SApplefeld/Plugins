#Requires -Version 5.1
<#
.SYNOPSIS
Runs one headless ingest, lint or merge in a knowledge base while holding the
knowledge base's run lock, so two runs that take the lock never overlap.

.DESCRIPTION
The wrapper a scheduled task runs in place of a bare claude call. It is vendored
into the KB beside the kb-*.ps1 helpers, at .claude/kb-run.ps1, and takes the KB
root as the parent of the .claude/ directory it lives in. No permission rule
grants it, so the KB agent cannot run it.

One run per KB proceeds at a time. The wrapper first takes an exclusive lock on
the file .git/kb-run.lock, opened with no sharing and held open by the
wrapper's own process for the whole run, so the operating system releases it
when the wrapper ends, however it ends, and it can never go stale. The lock
lives under .git/ because the KB agent cannot write there and git status never
lists it. A run that finds the lock held prints one line on stdout naming the
KB and the operation and exits 0, so Task Scheduler records a clean no-op. The
lock handle is not inheritable, so the child never holds it.

With the lock held, the wrapper reads which Claude Code build it is about
to run. It starts the claude executable with the one fixed argument --version,
with stdout and stderr redirected and read while the read runs, so nothing the
read prints reaches the wrapper's own streams and a full pipe never stalls it.
A build is three whole numbers joined by dots, each of one to six digits,
starting at the first byte of the first line on stdout, with no digit directly
after the third number. The wrapper keeps those three numbers and nothing else
the read printed. It compares them as numbers, part by part, to 2.1.257, the
oldest build on which the read block the KB's settings turn on,
permissions.blockReadsOutsideWorkingDirectories, works. The read is bounded at
60 seconds or the run's budget, whichever is less. A read still running at the
bound is stopped there, and the kill-on-close job ends any process it started
that the job holds.

The wrapper refuses to start the run, exiting 1 with one line on stderr and the
lock released, where the build is older or could not be read. For an older
build the line reads
    kb-run: Claude Code build 2.1.256 is older than 2.1.257; the Ingest run was not started.
with the build that was read and the operation. Otherwise the line opens
"kb-run: could not read the Claude Code build:" and gives the first of four
reasons that holds, then the operation: the read could not be started, with
the executable's path and the first line of the system's error; the read did
not finish inside its bound; the read exited non-zero, with its exit code; the
first line holds no build. No refusal line carries text the read printed.

With the build read and at or over 2.1.257, the wrapper runs
    claude -p "Use the wiki-ingest skill." --model sonnet --permission-mode default --strict-mcp-config
for Ingest, or the same line naming wiki-lint for Lint or wiki-merge for Merge,
with the KB root as the working directory. The argument line is fixed text; no value a caller supplies
is placed in it, so a claude.cmd that forwards its arguments cannot be handed a
second command. The child inherits the wrapper's stdout and stderr, so a
caller's capture of either stream reads what claude wrote. The wrapper exits
with the child's exit code.

The child runs inside a Windows job object created with kill-on-close, made
before the build read. The build read's process is assigned to it and then the
child's, and no other, so every process either starts joins the job
too and nothing outside their trees ever does. The wrapper alone holds the
job's handle, and no child inherits it, so when the wrapper ends, however it
ends, the operating system ends the build read's or the child's whole tree and
no orphan runs on with the lock free. A process either starts in the moment
before its assignment completes is outside the job. Where the job cannot be
made or a process cannot be assigned, the build read and the run proceed
without it, and the wrapper writes a line on stderr for each failure once
the run has started. So a refusal, or a run that cannot start, writes its own
line alone, and a dry run writes no such line.

A run holds a budget of 6900 seconds from the build read's start, 300 seconds
under the 2-hour execution time limit of the scheduled task that runs the
wrapper, for Ingest, Lint and Merge alike. The build read spends that budget,
and the child waits only for what is left of it, so the two together never
outlast it. The wrapper bounds the child itself, because
a limit that ends the wrapper relies on the job to end the child, and where no
job was made the child would run on with the lock released. The 300 seconds of
margin cover stopping the child. A child past the budget has its whole process
tree stopped, and the wrapper exits 1 with one line on stderr naming the whole
budget. The environment variable KB_RUN_SECONDS replaces the budget, as a whole
number of seconds from 1 to 99999, so a test can drive the stop quickly.

With -WhatIf the wrapper takes no lock and starts no run. It still checks
KB_RUN_SECONDS, resolves claude and reads the build, so each failure and each
build refusal exits 1 as on a real run. Otherwise it prints one line on stdout
naming the command it would run and the working directory, and exits 0.

The wrapper reads no inbox, no skill and no git. Any failure the wrapper itself
detects exits 1 with one line on stderr.

.PARAMETER Operation
The skill to run: Ingest, Lint or Merge.

.PARAMETER Claude
The claude executable to run, as a path. Without it, the first application
named claude on PATH runs, and a PATH holding none stops the run.

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-run.ps1 -Operation Ingest

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-run.ps1 -Operation Lint -Claude "C:\Users\acme\.local\bin\claude.exe" -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Ingest', 'Lint', 'Merge')]
    [string]$Operation,

    [string]$Claude
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Writes a single-line reason to stderr and stops with exit code 1, so a refusal
# is legible to an unattended caller without a PowerShell stack trace.
function Stop-WithReason {
    param([string]$Reason)
    [Console]::Error.WriteLine("kb-run: $Reason")
    exit 1
}

# The first non-empty line of an error message, for a one-line refusal.
function Get-FirstLine {
    param([string]$Text)
    foreach ($line in ($Text -split "`r?`n")) {
        if (-not [string]::IsNullOrWhiteSpace($line)) { return $line.Trim() }
    }
    return 'no error text'
}

# The innermost exception under PowerShell's method-call wrapper, so a .NET
# failure is classified by its own type.
function Get-InnerError {
    param([System.Exception]$Exception)
    while ($Exception -is [System.Management.Automation.MethodInvocationException] -and $null -ne $Exception.InnerException) {
        $Exception = $Exception.InnerException
    }
    return $Exception
}

# Stops the child and every process it started, such as node under a claude.cmd
# shim. taskkill /T walks the tree on both PowerShell editions; Windows
# PowerShell's .NET has no tree-aware Process.Kill. Its output is read
# asynchronously and discarded, so it never reaches the wrapper's stdout and a
# taskkill that hangs ends at the ten-second wait rather than at a read.
function Stop-ProcessTree {
    param([System.Diagnostics.Process]$Process)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    $psi.Arguments = "/PID $($Process.Id) /T /F"
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $killer = [System.Diagnostics.Process]::Start($psi)
    $null = $killer.StandardError.ReadToEndAsync()
    $null = $killer.StandardOutput.ReadToEndAsync()
    [void]$killer.WaitForExit(10000)
    if (-not $Process.WaitForExit(5000)) {
        # taskkill could not stop it; stop the child itself so the wrapper's
        # exit does not leave it running.
        $Process.Kill()
    }
}

# The kill-on-close job object the child runs in. Each call returns a Win32
# error code, 0 on success, so a failure is reported and never thrown. The job
# is made with no security attributes, so its handle is not inheritable and no
# child ever holds it. 0x2000 is JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, and 9 is
# JobObjectExtendedLimitInformation. The type is compiled once per session.
$jobObjectSource = @'
using System;
using System.Runtime.InteropServices;

namespace KbRun
{
    public static class JobObject
    {
        #region Native Structures

        [StructLayout(LayoutKind.Sequential)]
        private struct BasicLimitInformation
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
        private struct ExtendedLimitInformation
        {
            public BasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        #endregion

        #region Native Methods

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObjectW(IntPtr jobAttributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimitInformation info, uint length);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        #endregion

        #region Public Methods

        public static int CreateKillOnClose(out IntPtr job)
        {
            // Create the job.
            job = CreateJobObjectW(IntPtr.Zero, null);
            if (job == IntPtr.Zero)
            {
                return Marshal.GetLastWin32Error();
            }

            // Set kill on close, closing the job again where the limit is refused.
            ExtendedLimitInformation info = new ExtendedLimitInformation();
            info.BasicLimitInformation.LimitFlags = 0x2000;
            if (!SetInformationJobObject(job, 9, ref info, (uint)Marshal.SizeOf(typeof(ExtendedLimitInformation))))
            {
                int error = Marshal.GetLastWin32Error();
                CloseHandle(job);
                job = IntPtr.Zero;
                return error;
            }
            return 0;
        }

        public static int Assign(IntPtr job, IntPtr process)
        {
            return AssignProcessToJobObject(job, process) ? 0 : Marshal.GetLastWin32Error();
        }

        public static void Close(IntPtr job)
        {
            CloseHandle(job);
        }

        #endregion
    }
}
'@

# Makes the job object, or returns [IntPtr]::Zero after adding to $Notes one
# stderr line naming why it could not, so the run proceeds without it. The
# caller writes the notes once the run goes on.
function New-KillOnCloseJob {
    param([System.Collections.Generic.List[string]]$Notes)
    try {
        if (-not ('KbRun.JobObject' -as [type])) {
            Add-Type -TypeDefinition $jobObjectSource -Language CSharp
        }
        $job = [IntPtr]::Zero
        $jobError = [KbRun.JobObject]::CreateKillOnClose([ref]$job)
        if ($jobError -ne 0) {
            $Notes.Add("kb-run: creating the kill-on-close job object failed with Win32 error $jobError; the run proceeds without it.")
            return [IntPtr]::Zero
        }
        return $job
    } catch {
        $Notes.Add("kb-run: creating the kill-on-close job object failed: $(Get-FirstLine (Get-InnerError $_.Exception).Message); the run proceeds without it.")
        return [IntPtr]::Zero
    }
}

# Assigns one process the wrapper started to the job. Only that process's own
# handle is assigned, so the job reaches it and the processes it starts from
# here on, and never the wrapper or any other process. A process that has
# already exited has nothing to contain. With no job, nothing is assigned. A
# failure's stderr line is added to $Notes where the caller passes them, and
# written at once where it does not.
function Add-ProcessToJob {
    param([IntPtr]$Job, [System.Diagnostics.Process]$Process, [System.Collections.Generic.List[string]]$Notes, [string]$Name = 'the claude process', [string]$Outcome = 'the run proceeds without it')
    if ($Job -eq [IntPtr]::Zero) { return }
    $assignError = [KbRun.JobObject]::Assign($Job, $Process.Handle)
    if ($assignError -ne 0 -and -not $Process.HasExited) {
        $note = "kb-run: assigning $Name to the kill-on-close job object failed with Win32 error $assignError; $Outcome."
        if ($null -ne $Notes) { $Notes.Add($note) } else { [Console]::Error.WriteLine($note) }
    }
}

# The oldest Claude Code build a run starts on, as its three numbers. The KB's
# settings turn on permissions.blockReadsOutsideWorkingDirectories, which keeps
# a run's file tools inside the KB and which no older build honors.
$minimumBuild = @(2, 1, 257)

# The most seconds the build read may take, where the run's budget is not less.
$buildReadSeconds = 60

# True where a build's three numbers sit under the floor's, compared as
# numbers and part by part, the first part that differs deciding, and never as
# text, which would sort a four-digit part under a three-digit one.
function Test-BuildOlder {
    param([int[]]$Build, [int[]]$Floor)
    for ($i = 0; $i -lt 3; $i++) {
        if ($Build[$i] -ne $Floor[$i]) { return ($Build[$i] -lt $Floor[$i]) }
    }
    return $false
}

# The KB root is the parent of the .claude/ directory this script lives in.
$kbRoot = Split-Path -Parent $PSScriptRoot
$skill = "wiki-$($Operation.ToLowerInvariant())"
$arguments = "-p `"Use the $skill skill.`" --model sonnet --permission-mode default --strict-mcp-config"
$whatIf = [bool]$WhatIfPreference

$lock = $null
$read = $null
$child = $null
$job = [IntPtr]::Zero
try {
    # One run per KB at a time. The lock is a file held open with no sharing,
    # so the operating system releases it when this process ends, however it
    # ends. File.Open makes a handle no child process inherits.
    if (-not $whatIf) {
        $lockPath = Join-Path $kbRoot '.git\kb-run.lock'
        try {
            $lock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        } catch {
            $lockError = Get-InnerError $_.Exception
            # 32 is ERROR_SHARING_VIOLATION: another run holds the file open.
            if ($lockError -is [System.IO.IOException] -and ($lockError.HResult -band 0xFFFF) -eq 32) {
                Write-Output "kb-run: another run holds the lock for $kbRoot; this $Operation run did nothing."
                exit 0
            }
            Stop-WithReason "taking the lock $lockPath failed: $(Get-FirstLine $lockError.Message)"
        }
    }

    # The run budget, 300 seconds inside the 2-hour execution time limit of the
    # scheduled task that runs this wrapper, for Ingest, Lint and Merge alike.
    # A limit that ends this process relies on the job to end the child, and
    # where no job was made the child would run on, so the wrapper bounds the
    # child itself.
    $budgetSeconds = 6900
    $budgetOverride = $env:KB_RUN_SECONDS
    if (-not [string]::IsNullOrEmpty($budgetOverride)) {
        if ($budgetOverride -notmatch '^[1-9][0-9]{0,4}$') {
            Stop-WithReason 'KB_RUN_SECONDS must be a whole number of seconds from 1 to 99999.'
        }
        $budgetSeconds = [int]$budgetOverride
    }

    if ([string]::IsNullOrEmpty($Claude)) {
        $found = @(Get-Command -Name 'claude' -CommandType Application -ErrorAction SilentlyContinue)
        if ($found.Count -eq 0) {
            Stop-WithReason 'no -Claude path was given and no application named claude is on PATH.'
        }
        $Claude = $found[0].Source
    }

    # One job holds the build read and then the run, so a wrapper that is ended
    # during either leaves no process behind. A line naming a failure to make
    # the job or to assign the read is held in $jobNotes and written only once
    # the run has started, so each refusal and a failed start write their own
    # line alone and a dry run writes none.
    $jobNotes = New-Object System.Collections.Generic.List[string]
    $job = New-KillOnCloseJob $jobNotes

    # The build read. Its argument line is fixed text. Both streams are
    # redirected, so nothing it prints reaches the wrapper's own streams, and
    # both are copied off while it runs, so a full pipe never stalls it. Stdout
    # is kept as bytes, since a decoding reader would swallow a byte-order
    # mark, and a build must start at the first byte. The read is bounded at
    # 60 seconds or the budget, whichever is less, and the budget's clock
    # starts with it.
    $readSeconds = [Math]::Min($buildReadSeconds, $budgetSeconds)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Claude
    $psi.Arguments = '--version'
    $psi.WorkingDirectory = $kbRoot
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $read = [System.Diagnostics.Process]::Start($psi)
    } catch {
        Stop-WithReason "could not read the Claude Code build: starting $Claude failed: $(Get-FirstLine (Get-InnerError $_.Exception).Message); the $Operation run was not started."
    }
    Add-ProcessToJob $job $read $jobNotes 'the build read' 'the build read ran without it'
    $printed = New-Object System.IO.MemoryStream
    $copied = $read.StandardOutput.BaseStream.CopyToAsync($printed)
    $null = $read.StandardError.BaseStream.CopyToAsync([System.IO.Stream]::Null)

    # Stdout closes only when every process holding it has ended, so a read
    # that exits and leaves one behind is still running at the bound too.
    $finished = $read.WaitForExit($readSeconds * 1000)
    if ($finished) {
        $finished = $copied.Wait([int][Math]::Max(0, $readSeconds * 1000 - $clock.ElapsedMilliseconds))
    }
    if (-not $finished) {
        Stop-ProcessTree $read
        Stop-WithReason "could not read the Claude Code build: the read did not finish inside its bound and was stopped; the $Operation run was not started."
    }
    if ($read.ExitCode -ne 0) {
        Stop-WithReason "could not read the Claude Code build: the read exited $($read.ExitCode); the $Operation run was not started."
    }

    # A build is three whole numbers of one to six digits joined by dots, at
    # the first byte of the first line, with no digit directly after the
    # third. Only the three numbers are kept, so no refusal line carries text
    # the read printed.
    if ([System.Text.Encoding]::ASCII.GetString($printed.ToArray()) -notmatch '\A([0-9]{1,6})\.([0-9]{1,6})\.([0-9]{1,6})(?![0-9])') {
        Stop-WithReason "could not read the Claude Code build: the first line the read printed holds no build; the $Operation run was not started."
    }
    $build = @([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
    if (Test-BuildOlder $build $minimumBuild) {
        Stop-WithReason "Claude Code build $($build -join '.') is older than $($minimumBuild -join '.'); the $Operation run was not started."
    }

    if ($whatIf) {
        Write-Output "kb-run: would run `"$Claude`" $arguments in $kbRoot"
        exit 0
    }

    # The child writes straight to the wrapper's own stdout and stderr: nothing
    # is redirected, so nothing is buffered or reordered here.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Claude
    $psi.Arguments = $arguments
    $psi.WorkingDirectory = $kbRoot
    $psi.UseShellExecute = $false
    try {
        $child = [System.Diagnostics.Process]::Start($psi)
    } catch {
        Stop-WithReason "starting $Claude failed: $(Get-FirstLine (Get-InnerError $_.Exception).Message)"
    }
    foreach ($note in $jobNotes) { [Console]::Error.WriteLine($note) }
    Add-ProcessToJob $job $child

    # The child waits only for what the build read left of the budget.
    if (-not $child.WaitForExit([int][Math]::Max(0, $budgetSeconds * 1000 - $clock.ElapsedMilliseconds))) {
        Stop-ProcessTree $child
        Stop-WithReason "the $Operation run did not finish within its budget of $budgetSeconds seconds; its process tree was stopped."
    }
    exit $child.ExitCode
} finally {
    # On a normal exit the child has exited by here. On the budget path taskkill
    # has ended its whole tree. Closing the job's handle ends every process
    # still in the job, such as one the child started and left running or one
    # taskkill missed, before the lock is released. Where no job was made or
    # the assignment failed, such a process outlives the lock, as does one the
    # child started before the assignment completed. The same holds for the
    # build read and any process it started.
    if ($job -ne [IntPtr]::Zero) { [KbRun.JobObject]::Close($job) }
    if ($null -ne $read) { $read.Dispose() }
    if ($null -ne $child) { $child.Dispose() }
    if ($null -ne $lock) { $lock.Dispose() }
}
