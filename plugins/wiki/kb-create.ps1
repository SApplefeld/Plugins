#Requires -Version 7.0
<#
.SYNOPSIS
Creates a knowledge base in one call: copied, committed, trusted, listed, and
pushed only where a remote is given.

.DESCRIPTION
The script the wiki-new skill runs. It runs five steps in order, each a sibling
script of this one run as its own pwsh process, or git:

  1. kb-registry.ps1 Init -Root <root>, where no wiki list exists and -Root is
     given. A relative -Root is resolved against the run's current location
     first, so the list holds an absolute root. Where a list exists its root is
     used and -Root, if given, must name the same folder. Where neither a list
     nor -Root exists the run is refused. Where Init is refused because another
     run made the list since this run read it, that list is read as an existing
     one and the run goes on from step 2.
  2. new-kb.ps1 -Name <name> -Path <root>\<name>: the template copied, the
     version mark written, the first commit made.
  3. kb-trust.ps1 -Path <root>\<name>: the folder trusted for Claude Code on
     this account, proven by a second probe.
  4. git remote add origin <url> and git push -u origin main, only with
     -Remote. Without it the knowledge base commits locally and pushes nothing.
  5. kb-registry.ps1 Add: the knowledge base listed; its List line is printed.

Each step's refusal stops the run with that step's own stderr line, a sibling
script that succeeds writes none of its stderr through this run (step 4's git
output is passed through either way), and a stop after the folder exists names
the folder so the operator can remove it, as new-kb.ps1 does. A stop the engine
wait makes during step 2 names it too, where this run found the folder absent or
empty and it now exists and holds anything. -WhatIf prints the five steps as
they would run and runs none of them; it still reads the list's root to say
which, and reads the list for the name, so a listed name is refused there too.
Nothing here registers a scheduled task. Before step 1 the run refuses a name or
description the list would refuse at step 5, a value starting with a hyphen or a
dash, and a name already listed, so such a run copies, trusts and pushes
nothing.

.PARAMETER Name
The knowledge base's name, also its folder name under the root.

.PARAMETER Description
A one-paragraph description for the wiki list. May be empty.

.PARAMETER Root
The folder new knowledge bases are created under, needed only where no wiki
list exists yet.

.PARAMETER Remote
An existing git repository URL to attach as origin and push main to. The push
runs with git's and the credential manager's prompts turned off, so a missing
credential fails it. ssh runs in batch mode, with its prompts turned off too,
only where the account or the repository configures no ssh command of its own
(GIT_SSH_COMMAND, GIT_SSH or core.sshCommand); where one is configured it is
used as configured, and the bound below ends any prompt it makes. The push
waits at most 300 seconds, or the whole number of seconds from 1 to 99999 that
KB_PUSH_TIMEOUT_SECONDS holds. Any other value in that variable is refused
before step 1. The core.sshCommand read and the git remote add before the push
each take the same bound of their own. The push's git process runs inside a
kill-on-close Windows job object, which every process git starts after its
assignment joins whatever its parent link, so one terminate call ends them
all. A process git starts in the moment before the script assigns git to the
job is outside the job, and where the assignment fails the script stops git
alone, so a process git started by then can outlive the run. A push past its
bound stops the run at step 4 with a line naming the bound, followed by the
run's lines naming what it left. Where git finished inside the bound and a
process it started still held its output past the bound, that process is
stopped with the job's processes, one stderr line says so, and the run goes on
with git's own exit code.

Each sibling script runs inside the same job, assigned the way git is, so a
create killed partway takes the script and every process it started with it.
A sibling script and its output wait at most 900 seconds, above kb-trust.ps1's
two probes of at most 300 seconds each, or the whole number of seconds from 1
to 99999 that KB_ENGINE_TIMEOUT_SECONDS holds. Any other value in that
variable is refused before step 1. Stopping its processes adds at most
two 5-second drains; past that bound the job's processes are stopped and the
run stops with one line naming the script and the bound. Where the script
exited inside the bound and a process it started still held its output past
the bound, that process is stopped with the job's processes, one stderr line
says so, and the run goes on with the script's own result. Where that process
cannot be stopped, the run stops, since each step reads the script's output.
The job is made on every run before the wiki list is read, so a job that
cannot be made stops the run with the list unread and nothing copied, trusted
or pushed.

.EXAMPLE
pwsh -NoProfile -File ./kb-create.ps1 -Name acme -Description "Acme contracts and correspondence." -Root D:\Wikis

.EXAMPLE
pwsh -NoProfile -File ./kb-create.ps1 -Name acme -Description "Acme contracts." -Remote https://github.com/example/acme-kb.git -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string]$Name,

    [Parameter(Mandatory)]
    [AllowEmptyString()]
    [string]$Description,

    [string]$Root,

    [string]$Remote
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Git failures are surfaced by checking $LASTEXITCODE explicitly, so native
# command failures must not auto-throw and produce a stack trace.
$PSNativeCommandUseErrorActionPreference = $false

# Set once step 2 has created the folder. A failure after that point leaves a
# knowledge base behind that the next run would refuse as a non-empty folder.
# Not $script:WikiPath: names ignore case, so it would be the top-level $wikiPath.
$script:LeftFolder = $null

# The folder step 2 is making, set only while new-kb.ps1 runs and only where
# this run found that folder absent or empty just before step 2, so a folder
# already holding the operator's files is never named as the run's. A stop the
# engine wait makes in that stretch reads it, since new-kb.ps1 may have copied
# the template by then; a refusal new-kb.ps1 makes itself names its own folder.
$script:StepTwoFolder = $null

# Set as step 3 starts, since from then on ~/.claude.json may hold a trust
# entry for the folder. Removing the folder leaves that entry, so a later stop
# says so.
$script:LeftTrust = $false

# Writes a single-line reason to stderr and stops with exit code 1, so a refusal
# is legible to the calling session without a PowerShell stack trace. Once the
# folder exists, the operator is told where it is.
function Stop-WithReason {
    param([string]$Reason)
    [Console]::Error.WriteLine("kb-create: $Reason")
    if ($script:LeftFolder) {
        [Console]::Error.WriteLine("kb-create: this run left a knowledge base at $($script:LeftFolder). Remove it before retrying.")
    }
    if ($script:LeftTrust) {
        [Console]::Error.WriteLine("kb-create: ~/.claude.json may also hold a trust entry for $($script:LeftFolder). It stays after the folder is removed, and a retry at the same path reuses it.")
    }
    exit 1
}

# Names step 2's folder as left by this run, for a stop the engine wait makes
# while new-kb.ps1 runs: only where this run found that folder absent or empty
# before step 2, and it now exists and holds anything, since new-kb.ps1 accepts
# an empty destination and the next run would too. A folder that cannot be read
# is left unnamed, so the stop's own reason still prints.
function Set-LeftFolderFromStepTwo {
    if (-not $script:StepTwoFolder) { return }
    try {
        if ((Test-Path -LiteralPath $script:StepTwoFolder -PathType Container) -and
            ($null -ne (Get-ChildItem -LiteralPath $script:StepTwoFolder -Force | Select-Object -First 1))) {
            $script:LeftFolder = $script:StepTwoFolder
        }
    } catch { }
}

# Full path with no trailing separator, as kb-registry.ps1's ConvertTo-NormalPath
# shapes the root it stores, so the folder printed here is the one the list holds.
function ConvertTo-NormalPath {
    param([string]$Value)
    $full = [System.IO.Path]::GetFullPath($Value)
    $pathRoot = [System.IO.Path]::GetPathRoot($full)
    if ($full.Length -gt $pathRoot.Length) {
        $full = $full.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    }
    return $full
}

# Quotes one argument for a Windows command line so the child receives it unchanged.
function ConvertTo-CommandLineArgument {
    param([string]$Value)
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($c in $Value.ToCharArray()) {
        if ($c -eq [char]'\') { $backslashes++; continue }
        if ($c -eq [char]'"') {
            [void]$builder.Append([char]'\', 2 * $backslashes + 1)
        } elseif ($backslashes -gt 0) {
            [void]$builder.Append([char]'\', $backslashes)
        }
        $backslashes = 0
        [void]$builder.Append($c)
    }
    [void]$builder.Append([char]'\', 2 * $backslashes)
    [void]$builder.Append('"')
    return $builder.ToString()
}

# Runs a sibling script under this same PowerShell host with both streams
# captured, inside the run's kill-on-close job, and returns its exit code and
# text. The child inherits this process's environment, so USERPROFILE,
# LOCALAPPDATA and PATH reach it. Only the child's own handle is assigned, as
# the push's is, so a create killed partway takes the child and everything it
# started with it. The child and its streams, which close once their last
# holder has exited, share the engine bound. A child past it has the job
# terminated and the run stops with one line naming the script and the bound;
# a child that exited inside it while a process it started still holds its
# streams has that process ended with the job's processes, one line saying a
# process it started held them, and its own result returned. Where that
# process is not ended, the run stops, since the caller reads the output.
# During step 2, each stop made here also names the folder step 2 was making,
# where this run found it absent or empty and it now exists and holds anything.
function Invoke-Engine {
    param([string]$ScriptPath, [string[]]$Arguments)
    $scriptName = Split-Path -Leaf $ScriptPath
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $script:psExe
    $psi.Arguments = (@(@('-NoProfile', '-File', $ScriptPath) + $Arguments | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::Start($psi)
    try {
        # Only the child's handle is assigned, so a process it started in the
        # moment before the assignment is outside the job. A child that has
        # already exited has nothing to contain, so its result stands.
        $assignError = [KbCreate.JobObject]::Assign($script:job, $process.Handle)
        if ($assignError -ne 0 -and -not $process.HasExited) {
            # The child can exit between the check and the kill, which then
            # throws; the line below still names the failed assignment. The
            # bounded wait lets a child stopped mid-copy end before its folder
            # is read.
            try { $process.Kill() } catch { }
            try { [void]$process.WaitForExit($script:streamDrainSeconds * 1000) } catch { }
            Set-LeftFolderFromStepTwo
            Stop-WithReason "${scriptName}: assigning its process to the kill-on-close job object failed with Win32 error $assignError; it was stopped."
        }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $streams = [System.Threading.Tasks.Task[]]@($stdout, $stderr)
        $deadline = [DateTime]::UtcNow.AddSeconds($script:engineTimeoutSeconds)
        if (-not $process.WaitForExit($script:engineTimeoutSeconds * 1000)) {
            $null = Stop-JobProcesses $process $streams
            Set-LeftFolderFromStepTwo
            Stop-WithReason "$scriptName did not finish within the engine bound of $script:engineTimeoutSeconds seconds."
        }
        # The streams close when every process holding them ends, which can be
        # after the child itself, so they share what is left of the same bound.
        # The wait is never shorter than the drain, so a child that exits near
        # the bound still has its output read. A process the child started that
        # still holds them then is ended with the job's processes, and the
        # child's own result stands; the caller reads its output, so output
        # that cannot be read stops the run.
        $remaining = [int][Math]::Max($script:streamDrainSeconds * 1000, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        if (-not [System.Threading.Tasks.Task]::WaitAll($streams, $remaining)) {
            $holder = "a process $scriptName started held its output past the engine bound of $script:engineTimeoutSeconds seconds"
            if (-not (Stop-JobProcesses $process $streams)) {
                Set-LeftFolderFromStepTwo
                Stop-WithReason "$holder and was not stopped with the job's processes, so its output could not be read."
            }
            [Console]::Error.WriteLine("kb-create: $holder and was stopped with the job's processes.")
        }
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdout.Result; Stderr = $stderr.Result }
    } finally {
        $process.Dispose()
    }
}

# The kill-on-close job object every child of the run runs in: the engine
# scripts and the push's git. Each call returns a Win32 error code, 0 on
# success, so a failure is reported and never thrown.
# The job is made with no security attributes, so its handle is not inheritable
# and no child ever holds it. 0x2000 is JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, and
# 9 is JobObjectExtendedLimitInformation. Terminate ends every process in the
# job in one call, whatever each one's parent link, which a walk of parent pids,
# such as a tree kill makes, cannot promise. The type is compiled once per session and
# carries its own namespace, so it loads beside the other helpers' copies in
# one session. kb-walk.ps1 and kb-run.ps1 carry the same class under theirs.
$script:jobObjectSource = @'
using System;
using System.Runtime.InteropServices;

namespace KbCreate
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
        private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

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

        public static int Terminate(IntPtr job)
        {
            return TerminateJobObject(job, 1) ? 0 : Marshal.GetLastWin32Error();
        }

        public static void Close(IntPtr job)
        {
            CloseHandle(job);
        }

        #endregion
    }
}
'@

# Compiles the job type where this session has not, and makes the job, or stops
# the run with one line naming what failed. A child whose bound could not end
# every process it starts is the child the bound exists to prevent, so the run
# stops here, before the list is read, rather than proceed without the job.
function New-KillOnCloseJob {
    try {
        if (-not ('KbCreate.JobObject' -as [type])) {
            Add-Type -TypeDefinition $script:jobObjectSource -Language CSharp
        }
    } catch {
        Stop-WithReason "compiling the kill-on-close job object helper failed: $(@(Get-Lines $_.Exception.Message)[0]); the wiki list was not read, and nothing was copied, trusted or pushed."
    }
    $job = [IntPtr]::Zero
    $jobError = [KbCreate.JobObject]::CreateKillOnClose([ref]$job)
    if ($jobError -ne 0) {
        Stop-WithReason "creating the kill-on-close job object failed with Win32 error $jobError; the wiki list was not read, and nothing was copied, trusted or pushed."
    }
    return $job
}

# Ends every process in the job, the child and whatever it started wherever its
# parent link points, then waits for the child's exit and for its streams,
# which close once their last holder has died, each for at most the drain.
# Returns whether the streams closed. A child still running past the drain is
# named in one warning line and the stream wait still decides the result.
# Where the terminate call fails, the line names the error and nothing is
# waited on, since nothing has ended; closing the job as the run ends still
# ends its processes.
function Stop-JobProcesses {
    param([System.Diagnostics.Process]$Process, [System.Threading.Tasks.Task[]]$Streams)
    $terminateError = [KbCreate.JobObject]::Terminate($script:job)
    if ($terminateError -ne 0) {
        [Console]::Error.WriteLine("kb-create: terminating the kill-on-close job object failed with Win32 error $terminateError; closing it as the run ends stops its processes.")
        return $false
    }
    if (-not $Process.WaitForExit($script:streamDrainSeconds * 1000)) {
        [Console]::Error.WriteLine("kb-create: process $($Process.Id) had not exited $script:streamDrainSeconds seconds after the kill-on-close job object was terminated; closing the job as the run ends stops its processes.")
    }
    return [System.Threading.Tasks.Task]::WaitAll($Streams, $script:streamDrainSeconds * 1000)
}

# Runs git push with every prompt turned off and a time bound, inside the run's
# kill-on-close job, passes its output through, and returns its exit code. No
# one answers a terminal or credential-manager prompt here, so each is told not
# to ask; the variables are set on the git process alone, never on this
# script's environment. With -BatchSsh, ssh is told not to ask either, through
# the batch-mode GIT_SSH_COMMAND; the caller leaves it off where the account or
# the repository configures an ssh command of its own, which git then uses.
#
# With -LocalRead the call is a local git call that reaches no remote, named by
# -Action: its stdout is withheld, its stderr passed through, its exit code
# returned, and its lines say nothing of a remote.
#
# Two timeouts are told apart. Where git itself runs past the bound, the job is
# terminated, the run stops with one line naming the bound, and git's own
# output is not passed through. Where git exited inside the bound and its
# streams are still open when the bound runs out, a process git started holds
# its output: the job is terminated, which ends that process, git's output is
# passed through, one stderr line says what held it, and git's own exit code
# is returned, since the push did finish.
function Invoke-BoundedPush {
    param(
        [string[]]$Arguments,
        [string]$Action = 'step 4 (git push -u origin main)',
        [switch]$BatchSsh,
        [switch]$LocalRead
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $script:gitExe
    $psi.Arguments = (@($Arguments | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $psi.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
    $psi.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
    $psi.EnvironmentVariables['GCM_INTERACTIVE'] = 'never'
    if ($BatchSsh) {
        $psi.EnvironmentVariables['GIT_SSH_COMMAND'] = 'ssh -o BatchMode=yes -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4'
    }
    $process = [System.Diagnostics.Process]::Start($psi)
    # Only git's own handle is assigned, so the job reaches git and every
    # process it starts from here on, and never this script. A process git
    # started in the moment before the assignment is outside the job. A git
    # that has already exited has nothing to contain, so its result stands.
    $assignError = [KbCreate.JobObject]::Assign($script:job, $process.Handle)
    if ($assignError -ne 0 -and -not $process.HasExited) {
        # Git can exit between the check and the kill, which then throws; the
        # line below still names the failed assignment.
        try { $process.Kill() } catch { }
        if ($LocalRead) {
            Stop-WithReason "${Action}: assigning git to the kill-on-close job object failed with Win32 error $assignError; git was stopped."
        }
        Stop-WithReason "${Action}: assigning git to the kill-on-close job object failed with Win32 error $assignError; git was stopped, and whether it reached the remote is unknown."
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $streams = [System.Threading.Tasks.Task[]]@($stdoutTask, $stderrTask)
    $deadline = [DateTime]::UtcNow.AddSeconds($script:pushTimeoutSeconds)
    if (-not $process.WaitForExit($script:pushTimeoutSeconds * 1000)) {
        $null = Stop-JobProcesses $process $streams
        if ($LocalRead) {
            Stop-WithReason "$Action did not finish within the push bound of $script:pushTimeoutSeconds seconds."
        }
        Stop-WithReason "$Action did not finish within the push bound of $script:pushTimeoutSeconds seconds; whether it reached the remote is unknown."
    }
    # The streams close when every process holding them ends, which can be
    # after git itself, so they share what is left of the same bound. The wait
    # is never shorter than the drain, so a git that exits near the bound
    # still has its own output read before a holder is named.
    $remaining = [int][Math]::Max($script:streamDrainSeconds * 1000, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
    $held = -not [System.Threading.Tasks.Task]::WaitAll($streams, $remaining)
    $drained = $true
    if ($held) {
        $drained = Stop-JobProcesses $process $streams
    }
    # git exited inside the bound, so this wait returns at once; its own bound
    # keeps it from ever holding the run.
    if (-not $process.WaitForExit($script:streamDrainSeconds * 1000)) {
        [Console]::Error.WriteLine("kb-create: ${Action}: git had not exited $script:streamDrainSeconds seconds after its output closed.")
    }
    if ($drained) {
        if (-not $LocalRead) { [Console]::Out.Write($stdoutTask.Result) }
        [Console]::Error.Write($stderrTask.Result)
    }
    if ($held) {
        $holder = "${Action}: a process git started held its output past the push bound of $script:pushTimeoutSeconds seconds"
        if ($drained) {
            [Console]::Error.WriteLine("kb-create: $holder and was stopped with the job's processes.")
        } else {
            [Console]::Error.WriteLine("kb-create: $holder and was not stopped with the job's processes, so git's output is not passed through.")
        }
    }
    return $process.ExitCode
}

# Whether the account or the repository configures an ssh command of its own:
# GIT_SSH_COMMAND or GIT_SSH in this script's environment, which git inherits,
# or core.sshCommand in any config scope git reads in the repository. git takes
# GIT_SSH_COMMAND over core.sshCommand over GIT_SSH, so a batch-mode
# GIT_SSH_COMMAND set on the push would silence each of them, a deploy key's
# among them. The config is read through the push's runner, under its bound and
# inside its job. Exit 1 is git's answer for an unset key; any other exit stops
# the run at step 4.
function Test-SshCommandConfigured {
    param([string]$Repository)
    if (-not [string]::IsNullOrEmpty($env:GIT_SSH_COMMAND) -or -not [string]::IsNullOrEmpty($env:GIT_SSH)) { return $true }
    $action = 'step 4 (git config --get core.sshCommand)'
    $readExit = Invoke-BoundedPush @('-C', $Repository, 'config', '--get', 'core.sshCommand') -Action $action -LocalRead
    if ($readExit -eq 0) { return $true }
    if ($readExit -eq 1) { return $false }
    Stop-WithReason "$action failed with exit $readExit."
}

# Splits text into its non-empty lines.
function Get-Lines { param([string]$Text) return @($Text -split "`r?`n" | Where-Object { $_ -ne '' }) }

# Re-emits a child's stderr lines, so the step's own refusal reaches the operator.
function Write-ChildErrors {
    param($Result)
    foreach ($line in (Get-Lines $Result.Stderr)) { [Console]::Error.WriteLine($line) }
}

# Runs one step's script and stops the run on its failure, naming the step.
# The child's stderr is passed through only on that failure, so a step that
# succeeds writes nothing of its child's.
function Invoke-Step {
    param([int]$Number, [string]$What, [string]$ScriptPath, [string[]]$Arguments)
    $result = Invoke-Engine $ScriptPath $Arguments
    if ($result.ExitCode -ne 0) {
        Write-ChildErrors $result
        Stop-WithReason "step $Number ($What) failed with exit $($result.ExitCode)."
    }
    return $result
}

# Checks this run against a wiki list that exists: -Root, where given, must
# name the list's root, and the name must not be listed yet. $GivenRoot is
# -Root's full path, or empty where -Root was not given. Get exits 0 only for a
# listed name and refuses an unlisted one by name; any other refusal is passed
# through, as the root read's is. Both reads of an existing list take this
# check: step 1's decision, and step 1 itself where another run's Init made the
# list first.
function Assert-ListAccepts {
    param([string]$ListedRoot, [string]$GivenRoot)
    if (-not [string]::IsNullOrEmpty($GivenRoot) -and -not [string]::Equals($GivenRoot, $ListedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Stop-WithReason "the wiki list already has root '$ListedRoot'; -Root '$Root' names another folder, so nothing was done."
    }
    $getResult = Invoke-Engine $registry @('Get', '-Name', $Name)
    if ($getResult.ExitCode -eq 0) {
        Stop-WithReason "name '$Name' is already listed, so nothing was done."
    }
    if (-not $getResult.Stderr.Contains('is not listed', [StringComparison]::Ordinal)) {
        Write-ChildErrors $getResult
        Stop-WithReason "step 1 (reading the wiki list for $Name) failed with exit $($getResult.ExitCode)."
    }
}

$script:psExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
$registry = Join-Path $PSScriptRoot 'kb-registry.ps1'
$newKb = Join-Path $PSScriptRoot 'new-kb.ps1'
$trust = Join-Path $PSScriptRoot 'kb-trust.ps1'
foreach ($sibling in @($registry, $newKb, $trust)) {
    if (-not (Test-Path -LiteralPath $sibling -PathType Leaf)) {
        Stop-WithReason "sibling script not found next to this script: $sibling"
    }
}
$gitCmd = Get-Command -Name 'git' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $gitCmd) {
    Stop-WithReason 'git was not found on PATH.'
}
$script:gitExe = $gitCmd.Source

# Step 4's time bound: 300 seconds, or KB_PUSH_TIMEOUT_SECONDS where set, so a
# test can drive the timeout quickly. A bad value stops the run here, before
# anything is copied, trusted or pushed. The drain is how long the push's
# streams are waited on after the job is terminated, which ends every process
# holding them, so it is short and fixed. The job is made on every run before
# the list is read and closed as the run's last act.
#
# The engine bound is how long one engine script and its streams may run:
# 900 seconds. The slowest child is kb-trust.ps1, which runs two probes, each
# bounded at 300 seconds and its stream wait at what remains of that, never
# less than 10 seconds, plus up to 10 seconds for the config lock and 3 for
# each of its read and write, about 640 seconds at worst. kb-registry.ps1 waits
# at most 10 seconds for its lock, and its test hold at most 300 seconds more.
# new-kb.ps1 declares no wait. 900 seconds clears the largest with over four
# minutes to spare, so the bound ends only a child that has hung.
# KB_ENGINE_TIMEOUT_SECONDS replaces it where set, read on every run, so a test
# can drive the engine bound's stop in seconds.
$script:pushTimeoutSeconds = 300
$script:engineTimeoutSeconds = 900
$script:streamDrainSeconds = 5
$script:job = [IntPtr]::Zero
if ($PSBoundParameters.ContainsKey('Remote') -and -not [string]::IsNullOrEmpty($env:KB_PUSH_TIMEOUT_SECONDS)) {
    if ($env:KB_PUSH_TIMEOUT_SECONDS -notmatch '^[1-9][0-9]{0,4}$') {
        Stop-WithReason 'KB_PUSH_TIMEOUT_SECONDS must be a whole number of seconds from 1 to 99999.'
    }
    $script:pushTimeoutSeconds = [int]$env:KB_PUSH_TIMEOUT_SECONDS
}
if (-not [string]::IsNullOrEmpty($env:KB_ENGINE_TIMEOUT_SECONDS)) {
    if ($env:KB_ENGINE_TIMEOUT_SECONDS -notmatch '^[1-9][0-9]{0,4}$') {
        Stop-WithReason 'KB_ENGINE_TIMEOUT_SECONDS must be a whole number of seconds from 1 to 99999.'
    }
    $script:engineTimeoutSeconds = [int]$env:KB_ENGINE_TIMEOUT_SECONDS
}

# The list's name and description rules, checked here so a value step 5 would
# refuse stops the run before anything is copied, trusted or pushed. These
# mirror Get-NameRefusal, $reservedNames and $unsafeText in kb-registry.ps1,
# which stays the rule's owner and checks again at step 5.
if (-not [regex]::IsMatch($Name, '\A[A-Za-z0-9_-](?:[A-Za-z0-9_.-]{0,62}[A-Za-z0-9_-])?\z')) {
    Stop-WithReason "name '$Name' must be 1 to 64 letters, digits, hyphen, underscore or dot, not starting or ending with a dot"
}
$reservedNames = @('CON', 'PRN', 'AUX', 'NUL') + (0..9 | ForEach-Object { "COM$_"; "LPT$_" })
if ($reservedNames -contains $Name.Split('.')[0]) {
    Stop-WithReason "name '$Name' is a reserved device name"
}
$unsafeText = '[\p{Cc}\p{Cf}\u2028\u2029]|\uDB40[\uDC00-\uDC7F]'
if ([regex]::IsMatch($Description, $unsafeText)) {
    Stop-WithReason 'description must not contain control characters, tab and line breaks included, or format characters, text-direction marks and zero-width characters included'
}
# A child PowerShell process run with -File reads a value starting with a
# hyphen, en dash, em dash or horizontal bar as a parameter name, so no value
# passed on may start with one.
$dashes = @([char]0x2D, [char]0x2013, [char]0x2014, [char]0x2015)
foreach ($pair in @(@('name', $Name), @('description', $Description), @('remote', $(if ($PSBoundParameters.ContainsKey('Remote')) { $Remote } else { '' })))) {
    if ($pair[1].Length -gt 0 -and $dashes -contains $pair[1][0]) { Stop-WithReason "the $($pair[0]) must not start with a hyphen or a dash: $($pair[1])" }
}
if ($PSBoundParameters.ContainsKey('Remote') -and [string]::IsNullOrWhiteSpace($Remote)) {
    Stop-WithReason '-Remote was given empty; pass a repository URL, or leave -Remote out to commit locally.'
}

try {
    # Every child of the run runs in this job, from the first read of the list
    # on, so a job that cannot be made stops the run before anything is read,
    # copied, trusted or pushed.
    $script:job = New-KillOnCloseJob

    # --- Step 1's decision: the list's root, or an Init with -Root.
    $rootResult = Invoke-Engine $registry @('Root')
    $initNeeded = $false
    $rootFolder = $null
    if ($rootResult.ExitCode -eq 0) {
        # @() keeps one line an array: a function's single-element return unrolls
        # to a bare string, and [0] would then take its first character.
        $rootFolder = @(Get-Lines $rootResult.Stdout)[0]
        $givenRoot = $null
        if ($PSBoundParameters.ContainsKey('Root')) {
            # Resolved against the same base as a root with no list, so one
            # relative -Root names one folder whether or not the list exists.
            if ([string]::IsNullOrWhiteSpace($Root)) { Stop-WithReason "root is not a valid path: $Root" }
            try { $givenRoot = ConvertTo-NormalPath ([System.IO.Path]::GetFullPath($Root, (Get-Location).ProviderPath)) } catch { Stop-WithReason "root is not a valid path: $Root" }
        }
        # A name already listed is refused here rather than at step 5.
        Assert-ListAccepts $rootFolder $givenRoot
    } elseif ($rootResult.Stderr.Contains('no wiki list', [StringComparison]::Ordinal)) {
        # kb-registry.ps1's no-list refusal; any other refusal is passed through.
        if (-not $PSBoundParameters.ContainsKey('Root')) {
            Stop-WithReason 'no wiki list exists on this account and no -Root was given; pass -Root <folder> once to create the list.'
        }
        # A relative root is resolved against the run's current location as
        # PowerShell reports it, so Init is always given an absolute path. An
        # empty or blank root would resolve to that location itself, so it is
        # refused as a root naming no folder.
        if ([string]::IsNullOrWhiteSpace($Root)) { Stop-WithReason "root is not absolute: $Root" }
        try {
            $rootFolder = ConvertTo-NormalPath ([System.IO.Path]::GetFullPath($Root, (Get-Location).ProviderPath))
        } catch {
            Stop-WithReason "root is not a valid path: $Root"
        }
        $initNeeded = $true
    } else {
        Write-ChildErrors $rootResult
        Stop-WithReason "step 1 (reading the wiki list's root) failed with exit $($rootResult.ExitCode)."
    }
    $wikiPath = Join-Path $rootFolder $Name

    $steps = @(
        $(if ($initNeeded) { "1. Create the wiki list with root $rootFolder (kb-registry.ps1 Init)." } else { "1. Use the wiki list's root $rootFolder; no Init needed." })
        "2. Copy the template to $wikiPath and make the first commit (new-kb.ps1)."
        "3. Trust $wikiPath for Claude Code on this account (kb-trust.ps1)."
        $(if ($PSBoundParameters.ContainsKey('Remote')) { "4. Add remote origin $Remote and push main (git)." } else { '4. Attach no remote; the knowledge base commits locally and pushes nothing.' })
        "5. Add $Name to the wiki list (kb-registry.ps1 Add)."
    )
    if ([bool]$WhatIfPreference) {
        foreach ($step in $steps) { Write-Output "kb-create: $step" }
        exit 0
    }

    # --- Step 1. Two first runs against one root can both read no list above
    # and both reach this Init. The list's lock lets one Init through, and the
    # other is refused because a list now exists. That refusal alone is taken
    # as the other run's list: it is read again and checked as an existing list
    # is, and the run goes on from step 2 under its root. Any other Init failure
    # stops the run here with its stderr passed through.
    if ($initNeeded) {
        $initResult = Invoke-Engine $registry @('Init', '-Root', $rootFolder)
        if ($initResult.ExitCode -ne 0) {
            if (-not $initResult.Stderr.Contains('a wiki list already exists', [StringComparison]::Ordinal)) {
                Write-ChildErrors $initResult
                Stop-WithReason "step 1 (kb-registry.ps1 Init) failed with exit $($initResult.ExitCode)."
            }
            $rootResult = Invoke-Engine $registry @('Root')
            if ($rootResult.ExitCode -ne 0) {
                Write-ChildErrors $rootResult
                Stop-WithReason "step 1 (reading the wiki list's root) failed with exit $($rootResult.ExitCode)."
            }
            $listedRoot = @(Get-Lines $rootResult.Stdout)[0]
            Assert-ListAccepts $listedRoot $rootFolder
            $wikiPath = Join-Path $listedRoot $Name
        }
    }

    # --- Step 2. The folder exists from here on, so a later stop names it.
    # A stop during step 2 names it only where it was absent or empty here, so
    # a folder already holding the operator's files stays unnamed. A read that
    # fails leaves it unnamed too.
    try {
        if (-not (Test-Path -LiteralPath $wikiPath) -or
            ((Test-Path -LiteralPath $wikiPath -PathType Container) -and
             ($null -eq (Get-ChildItem -LiteralPath $wikiPath -Force | Select-Object -First 1)))) {
            $script:StepTwoFolder = $wikiPath
        }
    } catch { }
    $null = Invoke-Step 2 'new-kb.ps1' $newKb @('-Name', $Name, '-Path', $wikiPath)
    $script:LeftFolder = $wikiPath
    $script:StepTwoFolder = $null

    # --- Step 3. Set before the step, since kb-trust.ps1 can write the entry and
    # then refuse at its second probe.
    $script:LeftTrust = $true
    $null = Invoke-Step 3 'kb-trust.ps1' $trust @('-Path', $wikiPath)

    # --- Step 4. The URL follows -- so git reads it as a URL, never an option.
    if ($PSBoundParameters.ContainsKey('Remote')) {
        $addExit = Invoke-BoundedPush @('-C', $wikiPath, 'remote', 'add', '--', 'origin', $Remote) -Action 'step 4 (git remote add origin)' -LocalRead
        if ($addExit -ne 0) { Stop-WithReason "step 4 (git remote add origin) failed with exit $addExit." }
        # No git, credential-manager or ssh prompt and a time bound: a missing
        # credential fails here instead of waiting on an answer, and a remote that
        # never answers stops the run at the bound. ssh's batch mode is set only
        # where no ssh command is configured, so a configured one stands.
        $batchSsh = -not (Test-SshCommandConfigured $wikiPath)
        $pushExit = Invoke-BoundedPush @('-C', $wikiPath, 'push', '-u', 'origin', 'main') -BatchSsh:$batchSsh
        if ($pushExit -ne 0) { Stop-WithReason "step 4 (git push -u origin main) failed with exit $pushExit." }
    }

    # --- Step 5. Add prints the new wiki's List line, which is this run's result.
    $added = Invoke-Step 5 'kb-registry.ps1 Add' $registry @('Add', '-Name', $Name, '-Path', $wikiPath, '-Description', $Description)
    foreach ($line in (Get-Lines $added.Stdout)) { Write-Output $line }

    $script:LeftFolder = $null
    $script:LeftTrust = $false
    exit 0
} finally {
    # Closing the job's handle ends every process still in it, so nothing a
    # sibling script or the push started outlives this run, however it ends.
    if ($script:job -ne [IntPtr]::Zero) { [KbCreate.JobObject]::Close($script:job) }
}
