#Requires -Version 5.1
<#
.SYNOPSIS
Stages an explicit set of paths, or a source named by handle, or the recovered
pages it finds itself, commits them, and optionally pushes.

.DESCRIPTION
The single sanctioned path by which a knowledge base commits. It accepts only
repo-relative paths under sources/ or wiki/, or the exact files index.md and
log.md, and refuses everything else, including anything under .git/, .claude/,
inbox/, and the CLAUDE.md schema. It also refuses, on every route, a path
holding an instruction file's name at any depth: CLAUDE.md, CLAUDE.local.md,
.mcp.json, a .claude folder or a CLAUDE~ short name such as CLAUDE~1.MD, in
any letter case. After staging it reads the index back and refuses, unstaging
the entries it named, where any staged path holds such a name, so a folder or a
pattern given as -Path cannot stage one under a name the entry did not
spell. It stages the named paths explicitly, never
with a wildcard, commits with hooks disabled and the message read from a file,
and, with -Push, pushes the current branch to origin. Every git invocation is
checked, so a failed git step stops the run loudly rather than reporting a
success that did not happen.

Three forms, one per parameter set. With -Path alone, the paths given are
staged and -Message is the whole message: the form a person uses. With
-SourceHandle, the source under sources/ whose name has that handle is staged
with any -Path entries, and the helper writes the subject from the name it
resolved. With -Reconcile, the helper reads the working tree itself and stages
the recovered pages. The skills use the last two, so no byte of a hand-dropped
or hand-placed file name sits on their command line for the shell to re-read.

.PARAMETER Path
The repo-relative paths to stage and commit, separated by a vertical bar. Each
must be under sources/ or wiki/, or be exactly index.md or log.md, must name
no instruction file Claude Code loads in any of its segments, and must
exist on disk. A vertical bar is used because Windows forbids it in a file
name, so it can never be ambiguous with a path that contains a comma or a
semicolon. PowerShell passes arguments to a script run with -File as literal
strings and never splits them into an array, so a single delimited string is
the only form that survives that call. No entry may hold an apostrophe. The
skills pass the string inside a Bash single-quoted string, where an apostrophe
ends the string before this script runs. The skills check for one on some
routes only, so the refusal here is a partial control: it catches one that
arrives escaped or double-quoted. Required on its own; optional beside
-SourceHandle, where no entry may be under sources/, compared without regard
to case, since the handle names the source; refused beside -Reconcile.

.PARAMETER SourceHandle
The handle of the source under sources/ to stage: the first 12 lowercase
hexadecimal digits of the SHA-256 of the file name's UTF-8 bytes, the value
`kb-status.ps1 -What Inbox` printed for the file before kb-move.ps1 moved it,
or the value `kb-status.ps1 -What Sources` prints for a file already there.
The shape is checked first, then the files under sources/ are listed and each
one's handle recomputed. A handle matching no file, or more than one, is
refused. The resolved file is staged after the -Path entries, and the message
is the subject `Ingest: <resolved name>`, a blank line, then -Message as the
body, whatever that body opens with.

.PARAMETER Reconcile
Stage the recovered work of an interrupted run, read from `git status` by this
helper: every modified or untracked file under wiki/, and a modified index.md
or log.md. Nothing under sources/ or inbox/ is staged, and a tree with nothing
that qualifies is refused. A path outside that set already staged is refused
too, a source an interrupted commit staged among them, which is committed
first by -SourceHandle. The message is the subject `Reconcile: <n> files`,
a blank line, the staged paths one per line, a blank line, then -Message as
the body. Takes no -Path.

.PARAMETER Message
The commit message, or with -SourceHandle or -Reconcile its body. It may hold
no apostrophe, for the same reason as -Path. Control characters other than
newline are stripped, and the whole message, subject and path list included,
is truncated to 2000 characters before use.

.PARAMETER Push
When set, push the current branch to the origin remote after committing. The
push runs even when this call had nothing to commit, so a commit made by an
earlier call in the same run reaches origin rather than stranding locally. In a
knowledge base with no remote named origin nothing is pushed: the call prints
"kb-commit: no remote named 'origin'; nothing pushed." on stdout and exits 0,
since a local-only knowledge base is the ordinary case.

Git's terminal prompt and Git Credential Manager's prompt are turned off for
the push, so a missing credential fails the push. ssh runs in batch mode, with
its prompts turned off too, only where the account or the repository
configures no ssh command of its own (GIT_SSH_COMMAND, GIT_SSH or
core.sshCommand); where one is configured it is used as configured, and the
bound below ends any prompt it makes. The push waits at most 300 seconds, or
the whole number of seconds from 1 to 99999 that KB_PUSH_TIMEOUT_SECONDS holds,
and any other value in that variable stops the run before anything is staged.
The core.sshCommand read before the push takes the same bound of its own. The
push's git process runs inside a kill-on-close Windows job object, which every
process git starts after its assignment joins whatever its parent link, so one
terminate call ends them all. A process git starts in the moment before the
helper assigns git to the job is outside the job, and where the assignment
fails the helper stops git alone, so a process git started by then can outlive
the run. Past the bound while git runs, the job is terminated and the run
exits 1 with one line naming the bound. Where git finished inside the bound
and a process it started still held its output past the bound, that process is
stopped with the job's processes, git's output is passed through, the run ends
on git's own exit code, and one stderr line says a process git started held
its output. The job is made before anything is staged, so a job that cannot be
made stops the run with nothing committed.

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-commit.ps1 -Path 'sources/report.pdf|wiki/report-summary.md|index.md|log.md' -Message 'Ingest report.pdf' -Push

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-commit.ps1 -SourceHandle '3f2a9c1d8e07' -Path 'wiki/report-summary.md|index.md|log.md' -Message 'Revised: acme-corp, pricing-model' -Push
Stages sources/report.pdf, the file whose handle that is, with the three
paths, under the subject `Ingest: report.pdf` and the body given.

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-commit.ps1 -Reconcile -Message 'Recovered from an interrupted lint run.'
Stages the modified and untracked wiki/ pages and a modified index.md or
log.md, under the subject `Reconcile: <n> files` and a body listing them.
#>
[CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'Path')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Path')]
    [Parameter(ParameterSetName = 'SourceHandle')]
    [string]$Path,

    [Parameter(Mandatory, ParameterSetName = 'SourceHandle')]
    [string]$SourceHandle,

    [Parameter(Mandatory, ParameterSetName = 'Reconcile')]
    [switch]$Reconcile,

    [Parameter(Mandatory)]
    [string]$Message,

    [switch]$Push
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Git failures are surfaced by checking $LASTEXITCODE explicitly, so native
# command failures must not auto-throw and produce a stack trace.
$PSNativeCommandUseErrorActionPreference = $false

# Writes a single-line reason to stderr and stops with a non-zero exit code, so
# a refusal is legible to an unattended caller without a PowerShell stack trace.
function Stop-WithReason {
    param([string]$Reason)
    [Console]::Error.WriteLine("kb-commit: $Reason")
    exit 1
}

# The handle of a file name: the first 12 lowercase hexadecimal digits of the
# SHA-256 digest of the name's UTF-8 bytes, with no byte-order mark, no case
# folding and no Unicode normalisation. It depends on the name alone, so a
# listing and a later call agree while the file keeps its name. The same
# function sits in kb-status.ps1 and kb-move.ps1 byte for byte.
function Get-NameHandle {
    param([string]$Name)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $digest = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Name))
    } finally {
        $sha.Dispose()
    }
    return -join ($digest[0..5] | ForEach-Object { $_.ToString('x2') })
}

# Runs git and stops the run if it reports failure.
function Invoke-GitOrStop {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$FailReason
    )
    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        Stop-WithReason $FailReason
    }
}

# Quotes one argument for a Windows command line so the child process receives
# it unchanged, whatever spaces, quotes or trailing backslashes it holds.
function ConvertTo-CommandLineArgument {
    param([string]$Value)
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') {
        return $Value
    }
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($c in $Value.ToCharArray()) {
        if ($c -eq [char]'\') {
            $backslashes++
            continue
        }
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

# The kill-on-close job object the push's git process runs in. Each call returns
# a Win32 error code, 0 on success, so a failure is reported and never thrown.
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

namespace KbCommit
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
# the run with one line naming what failed. A push whose bound could not end
# every process it starts is the push the bound exists to prevent, so the run
# stops here, before anything is staged, rather than proceed without the job.
function New-KillOnCloseJob {
    try {
        if (-not ('KbCommit.JobObject' -as [type])) {
            Add-Type -TypeDefinition $script:jobObjectSource -Language CSharp
        }
    } catch {
        $firstLine = @($_.Exception.Message -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })[0]
        Stop-WithReason "compiling the kill-on-close job object helper for the push failed: $firstLine; nothing was staged."
    }
    $job = [IntPtr]::Zero
    $jobError = [KbCommit.JobObject]::CreateKillOnClose([ref]$job)
    if ($jobError -ne 0) {
        Stop-WithReason "creating the kill-on-close job object for the push failed with Win32 error $jobError; nothing was staged."
    }
    return $job
}

# Ends every process in the job, git and whatever it started wherever its
# parent link points, then waits for git's exit and for its streams, which
# close once their last holder has died, for at most the drain. Returns whether
# the streams closed. Where the terminate call fails, the line names the error
# and nothing is waited on, since nothing has ended; closing the job as the run
# ends still ends its processes.
function Stop-JobProcesses {
    param([System.Diagnostics.Process]$Process, [System.Threading.Tasks.Task[]]$Streams)
    $terminateError = [KbCommit.JobObject]::Terminate($script:job)
    if ($terminateError -ne 0) {
        [Console]::Error.WriteLine("kb-commit: terminating the kill-on-close job object failed with Win32 error $terminateError; closing it as the run ends stops its processes.")
        return $false
    }
    $Process.WaitForExit()
    return [System.Threading.Tasks.Task]::WaitAll($Streams, $script:streamDrainSeconds * 1000)
}

# Runs git push with every prompt turned off and a time bound, inside the run's
# kill-on-close job, then passes its output through and stops the run on a
# failed exit. An unattended run has no one to answer a terminal or
# credential-manager prompt, so each is told not to ask; the variables are set
# on the git process alone, never on this script's environment. With
# -BatchSsh, ssh is told not to ask either, through the batch-mode
# GIT_SSH_COMMAND; the caller leaves it off where the account or the
# repository configures an ssh command of its own, which git then uses.
#
# With -LocalRead the call is a git read that reaches no remote, named by
# -Action: its stdout is withheld, its stderr passed through, and its exit code
# returned rather than read as a failure, and its lines say nothing of a remote.
#
# Two timeouts are told apart. Where git itself runs past the bound, the job is
# terminated, the run exits 1 with one line naming the bound, and git's own
# output is not passed through. Where git exited inside the bound and its
# streams are still open when the bound runs out, a process git started holds
# its output: the job is terminated, which ends that process, git's output is
# passed through, one stderr line says what held it, and the run goes on to
# git's own exit code, since the push did finish and a failure line here would
# have the walker record a landed push as one that did not land.
function Invoke-BoundedPush {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [string]$FailReason,
        [string]$Action = 'git push',
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
    $assignError = [KbCommit.JobObject]::Assign($script:job, $process.Handle)
    if ($assignError -ne 0 -and -not $process.HasExited) {
        # Git can exit between the check and the kill, which then throws; the
        # line below still names the failed assignment.
        try { $process.Kill() } catch { }
        if ($LocalRead) {
            Stop-WithReason "assigning $Action to the kill-on-close job object failed with Win32 error $assignError; git was stopped."
        }
        Stop-WithReason "assigning $Action to the kill-on-close job object failed with Win32 error $assignError; git was stopped, and whether it reached the remote is unknown."
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
    $process.WaitForExit()
    if ($drained) {
        if (-not $LocalRead) { [Console]::Out.Write($stdoutTask.Result) }
        [Console]::Error.Write($stderrTask.Result)
    }
    if ($held) {
        $holder = "a process git started held its output past the push bound of $script:pushTimeoutSeconds seconds"
        if ($drained) {
            [Console]::Error.WriteLine("kb-commit: $holder and was stopped with the job's processes.")
        } else {
            [Console]::Error.WriteLine("kb-commit: $holder and was not stopped with the job's processes, so git's output is not passed through.")
        }
    }
    if ($LocalRead) {
        return $process.ExitCode
    }
    if ($process.ExitCode -ne 0) {
        Stop-WithReason $FailReason
    }
}

# Whether the account or the repository configures an ssh command of its own:
# GIT_SSH_COMMAND or GIT_SSH in this script's environment, which git inherits,
# or core.sshCommand in any config scope git reads in the repository. git takes
# GIT_SSH_COMMAND over core.sshCommand over GIT_SSH, so a batch-mode
# GIT_SSH_COMMAND set on the push would silence each of them, a deploy key's
# among them. The config is read through the push's runner, under its bound and
# inside its job. Exit 1 is git's answer for an unset key; any other exit stops
# the run.
function Test-SshCommandConfigured {
    param([Parameter(Mandatory)][string]$Repository)
    if (-not [string]::IsNullOrEmpty($env:GIT_SSH_COMMAND) -or -not [string]::IsNullOrEmpty($env:GIT_SSH)) { return $true }
    $readExit = Invoke-BoundedPush -Arguments @('-C', $Repository, 'config', '--get', 'core.sshCommand') -Action 'git config --get core.sshCommand' -LocalRead
    if ($readExit -eq 0) { return $true }
    if ($readExit -eq 1) { return $false }
    Stop-WithReason "git config --get core.sshCommand failed with exit $readExit."
}

# The repo root is the parent of the .claude/ directory this script lives in.
$repoRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).ProviderPath

$sourceHandleSet = ($PSCmdlet.ParameterSetName -eq 'SourceHandle')
$reconcileSet    = ($PSCmdlet.ParameterSetName -eq 'Reconcile')

$paths = @()
if ($PSBoundParameters.ContainsKey('Path')) {
    $paths = @($Path -split '\|' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
}
if ($paths.Count -eq 0 -and -not $sourceHandleSet -and -not $reconcileSet) {
    Stop-WithReason 'at least one path is required.'
}

# A source handle resolves to a name against the files under sources/, as
# kb-status.ps1 -What Inbox listed the file before kb-move.ps1 moved it. The
# shape is checked before the directory is read, so a value that is not a
# handle is refused as such whatever the tree holds.
$resolvedSource = $null
if ($sourceHandleSet) {
    if ($SourceHandle -cnotmatch '^[0-9a-f]{12}$') {
        Stop-WithReason 'SourceHandle must be twelve lowercase hexadecimal digits, as kb-status.ps1 -What Inbox or -What Sources prints it.'
    }
    $sourcesDir = Join-Path $repoRoot 'sources'
    if (-not (Test-Path -LiteralPath $sourcesDir -PathType Container)) {
        Stop-WithReason 'sources/ does not exist.'
    }
    $matched = @(Get-ChildItem -LiteralPath $sourcesDir -File | Where-Object { ($_.Name -ne '.gitkeep') -and ((Get-NameHandle $_.Name) -ceq $SourceHandle) })
    if ($matched.Count -eq 0) {
        Stop-WithReason "no file under sources/ has the handle $SourceHandle; kb-move.ps1 has not moved it there."
    }
    if ($matched.Count -gt 1) {
        Stop-WithReason "more than one file under sources/ has the handle $SourceHandle; a person commits them by path."
    }
    $resolvedSource = $matched[0].Name
}

# True where any segment of a slash-separated path names an instruction file
# Claude Code loads. Claude Code loads a CLAUDE.md or CLAUDE.local.md from any
# folder it works in and a .claude/ folder beside it, so a file under wiki/ by
# one of those names is an instruction the next run follows, whatever it
# holds. Claude Code reads .mcp.json at the project root alone, and the nested
# name is refused because nothing legitimate writes it. The names alone are
# read, never the content, and each is matched as a whole segment, so
# CLAUDE.md.bak, notes-CLAUDE.md and .claude-notes pass. A segment shaped
# like a Windows short name of one, CLAUDE~ and digits with or without an
# extension as in CLAUDE~1.MD, is refused too, as the walker's pull stop
# refuses it. Every match is without regard to case, since Windows reads
# claude.md as CLAUDE.md. This is the one place the names live: the entry
# check and the staged-index check both call it.
function Test-InstructionPath {
    param([string]$normalized)
    foreach ($segment in ($normalized -split '/')) {
        $instructionName = $segment.Equals('CLAUDE.md', [System.StringComparison]::OrdinalIgnoreCase) -or
                           $segment.Equals('CLAUDE.local.md', [System.StringComparison]::OrdinalIgnoreCase) -or
                           $segment.Equals('.claude', [System.StringComparison]::OrdinalIgnoreCase) -or
                           $segment.Equals('.mcp.json', [System.StringComparison]::OrdinalIgnoreCase) -or
                           [regex]::IsMatch($segment, '^CLAUDE~[0-9]+(\..*)?$', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if ($instructionName) {
            return $true
        }
    }
    return $false
}

# Every staged path passes these checks: the caller's -Path entries, and the
# paths the helper builds from sources/ and from git status. The apostrophe
# rule and the sources/ rule guard the command line, so they hold for the
# caller's entries only.
function Assert-PathEntry {
    param([string]$entry, [bool]$fromHelper)
    if ([string]::IsNullOrWhiteSpace($entry)) {
        Stop-WithReason 'a path entry is empty.'
    }
    if ([System.IO.Path]::IsPathRooted($entry)) {
        Stop-WithReason "path must be repo-relative, not rooted: $entry"
    }
    # A name the helper read from a listing may hold two dots in a row; only
    # a '..' segment leaves the folder. The caller's entries keep the stricter
    # substring rule.
    if ((-not $fromHelper) -and ($entry -like '*..*')) {
        Stop-WithReason "path must not contain '..': $entry"
    }
    if ($fromHelper -and ($entry -match '(^|[/\\])\.\.([/\\]|$)')) {
        Stop-WithReason "path must not contain a '..' segment: $entry"
    }
    if ($entry.Contains(':')) {
        Stop-WithReason "path must not contain ':': $entry"
    }
    # A skill emits -Path and -Message inside Bash single-quoted strings, the
    # one form that passes $, backticks and spaces byte for byte. An apostrophe
    # ends that string in Bash before this script runs, so on that route the
    # ingest and merge skills keep one out of the call. This refusal catches
    # one that arrives escaped or double-quoted.
    if ((-not $fromHelper) -and $entry.Contains("'")) {
        Stop-WithReason "path must not contain an apostrophe: $entry"
    }

    $normalized = $entry -replace '\\', '/'
    # With a handle the helper names the source itself, so a -Path entry under
    # sources/ would put a source's name on the line after all, or stage a
    # second source into this source's commit.
    if ((-not $fromHelper) -and $sourceHandleSet -and ($normalized -like 'sources/*')) {
        Stop-WithReason "path under sources/ is not taken with -SourceHandle; the handle names the source: $entry"
    }
    $inScope = ($normalized -eq 'index.md') -or
               ($normalized -eq 'log.md') -or
               ($normalized -like 'sources/*') -or
               ($normalized -like 'wiki/*')
    if (-not $inScope) {
        Stop-WithReason "path is outside the committable set (sources/, wiki/, index.md, log.md): $entry"
    }
    # The instruction-file rule runs on every route, a handle's resolved source
    # and a reconciled path included. It reads the entry's own segments; a
    # folder or a pattern entry that stages such a name without spelling it is
    # caught by the same rule over the index after git add.
    if (Test-InstructionPath $normalized) {
        Stop-WithReason "path names an instruction file Claude Code loads (CLAUDE.md, CLAUDE.local.md, .mcp.json, a .claude folder or a short name of one), which no knowledge base commits: $entry"
    }

    $full = Join-Path $repoRoot $entry
    if (-not (Test-Path -LiteralPath $full)) {
        Stop-WithReason "path does not exist on disk: $entry"
    }
}

foreach ($entry in $paths) {
    Assert-PathEntry $entry $false
}

# The resolved source joins the staged set after the caller's entries: its
# name came from the directory listing, never from the line.
if ($sourceHandleSet) {
    Assert-PathEntry "sources/$resolvedSource" $true
    $paths += "sources/$resolvedSource"
}

# With -Reconcile the staged set is read from git status: every modified,
# staged-as-new or untracked file under wiki/, and a modified or staged-as-new
# index.md or log.md. A page staged as new is what an interrupted commit leaves. -z keeps every
# path unquoted and unescaped, and --untracked-files=all lists an untracked
# file by its own path. The output is read as UTF-8 so a non-ASCII path
# resolves on disk; a host with no console to set keeps its default encoding,
# and the console's encoding is put back afterward.
if ($reconcileSet) {
    $savedEncoding = $null
    try {
        $savedEncoding = [Console]::OutputEncoding
        [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    } catch { }
    try {
        $status = & git -C $repoRoot status --porcelain -z --untracked-files=all
        $gitExit = $LASTEXITCODE
        $alreadyStaged = & git -C $repoRoot diff --cached --name-only -z
        $stagedExit = $LASTEXITCODE
    } finally {
        if ($null -ne $savedEncoding) {
            try { [Console]::OutputEncoding = $savedEncoding } catch { }
        }
    }
    if ($gitExit -ne 0) {
        Stop-WithReason 'git status --porcelain failed.'
    }
    if ($stagedExit -ne 0) {
        Stop-WithReason 'git diff --cached failed.'
    }

    # Each entry is `XY path`. A rename or copy is followed by one more entry
    # holding its origin, and both are skipped: a rename is already staged.
    $entries = @((@($status) -join "`n") -split "`0" | Where-Object { $_ -ne '' })
    $recovered = New-Object System.Collections.Generic.List[string]
    for ($i = 0; $i -lt $entries.Count; $i++) {
        $entry = $entries[$i]
        if ($entry.Length -lt 4) {
            continue
        }
        $xy = $entry.Substring(0, 2)
        if ($xy -cmatch '[RC]') {
            $i++
            continue
        }
        $relative = $entry.Substring(3)
        $modified  = $xy.Contains('M') -or $xy.StartsWith('A')
        $untracked = ($xy -eq '??')
        $qualifies = ($relative.StartsWith('wiki/', [System.StringComparison]::Ordinal) -and ($modified -or $untracked)) -or
                     ((($relative -eq 'index.md') -or ($relative -eq 'log.md')) -and $modified)
        if (-not $qualifies) {
            continue
        }
        # A path deleted from the working tree is not recovered work.
        if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $relative) -PathType Leaf)) {
            continue
        }
        $recovered.Add($relative)
    }
    if ($recovered.Count -eq 0) {
        Stop-WithReason 'nothing to reconcile: no modified or untracked file under wiki/, and no modified index.md or log.md.'
    }
    # The commit takes the whole index, so a path staged before this call
    # would ride in uncounted. It is refused rather than committed.
    $outside = @((@($alreadyStaged) -join "`n") -split "`0" | Where-Object { ($_ -ne '') -and (-not $recovered.Contains($_)) })
    if ($outside.Count -gt 0) {
        Stop-WithReason "a path outside the reconcile set is already staged ($($outside.Count) in all); a person commits or unstages it first: $($outside[0])"
    }
    foreach ($relative in $recovered) {
        Assert-PathEntry $relative $true
    }
    $paths = @($recovered)
}

if ([string]::IsNullOrWhiteSpace($Message)) {
    Stop-WithReason 'commit message is empty.'
}
if ($Message.Contains("'")) {
    Stop-WithReason 'commit message must not contain an apostrophe.'
}

# The helper writes the subject where it resolved the name itself, so the
# name reaches git from the file system and never from the line. -Message is
# the body, whatever it opens with.
$fullMessage = $Message
if ($sourceHandleSet) {
    $fullMessage = "Ingest: $resolvedSource`n`n$Message"
} elseif ($reconcileSet) {
    $listed = New-Object System.Collections.Generic.List[string]
    $budget = 1000
    foreach ($p in $paths) {
        if ($p.Length + 1 -gt $budget) {
            break
        }
        $listed.Add($p)
        $budget -= $p.Length + 1
    }
    $more = ''
    if ($listed.Count -lt $paths.Count) {
        $more = "`n... and $($paths.Count - $listed.Count) more"
    }
    $fullMessage = "Reconcile: $($paths.Count) files`n`n$($listed -join "`n")$more`n`n$Message"
}

# Strip ASCII control characters other than newline, then cap the length.
$cleanMessage = $fullMessage -replace '[\x00-\x09\x0B-\x1F\x7F]', ''
if ($cleanMessage.Length -gt 2000) {
    $cleanMessage = $cleanMessage.Substring(0, 2000)
}

# The push's time bound: 300 seconds, or KB_PUSH_TIMEOUT_SECONDS where set, so a
# test can drive the timeout quickly. It is read before anything is staged, so a
# bad value stops the run with nothing committed. The drain is how long the
# push's streams are waited on after the job is terminated, which ends every
# process holding them, so it is short and fixed. The job is made with -Push
# before anything is staged and closed as the run's last act.
$script:pushTimeoutSeconds = 300
$script:streamDrainSeconds = 5
$script:gitExe = $null
$script:job = [IntPtr]::Zero
if ($Push) {
    $timeoutOverride = $env:KB_PUSH_TIMEOUT_SECONDS
    if (-not [string]::IsNullOrEmpty($timeoutOverride)) {
        if ($timeoutOverride -notmatch '^[1-9][0-9]{0,4}$') {
            Stop-WithReason 'KB_PUSH_TIMEOUT_SECONDS must be a whole number of seconds from 1 to 99999.'
        }
        $script:pushTimeoutSeconds = [int]$timeoutOverride
    }
    $gitCmd = Get-Command -Name 'git' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $gitCmd) {
        Stop-WithReason 'git was not found on PATH.'
    }
    $script:gitExe = $gitCmd.Source
}

if (-not $PSCmdlet.ShouldProcess($repoRoot, 'Stage, commit, and optionally push')) {
    exit 0
}

$messageFile = $null
$hooksDir    = $null
try {
    # With -Push, the job the push runs in is made before anything is staged,
    # so a job that cannot be made stops the run with nothing committed.
    if ($Push) {
        $script:job = New-KillOnCloseJob
    }

    # --literal-pathspecs on the handle and reconcile routes: a name the helper
    # read from disk holding [ ] or * stages that file alone, never a sibling
    # the pattern would match. A person's plain -Path stages as it always has.
    # The reset below takes the same mode, so it names the same entries.
    $pathspecMode = @()
    if ($sourceHandleSet -or $reconcileSet) {
        $pathspecMode = @('--literal-pathspecs')
    }
    $addArgs = @('-C', $repoRoot) + $pathspecMode + @('add', '--') + $paths
    Invoke-GitOrStop -Arguments $addArgs -FailReason 'git add failed.'

    # The commit takes the whole index, and a plain -Path entry may be a folder
    # or a pattern, which git add expands to paths the entry check never saw:
    # 'wiki/notes' stages wiki/notes/CLAUDE.md with it. So the staged set is
    # read back and every path in it, a path staged before this run included,
    # takes the instruction-file rule. On a hit the entries this run named are
    # reset to HEAD in the same pathspec mode git add took, which unstages
    # every stage under those entries, a folder entry's earlier stages
    # included, and nothing outside them, and the run stops with the refusal.
    # The output is read as UTF-8 so a non-ASCII path is compared whole, as
    # the reconcile route reads git status.
    $savedEncoding = $null
    try {
        $savedEncoding = [Console]::OutputEncoding
        [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    } catch { }
    try {
        $stagedNow = & git -C $repoRoot diff --cached --name-only -z
        $stagedExit = $LASTEXITCODE
    } finally {
        if ($null -ne $savedEncoding) {
            try { [Console]::OutputEncoding = $savedEncoding } catch { }
        }
    }
    if ($stagedExit -ne 0) {
        Stop-WithReason 'git diff --cached failed.'
    }
    foreach ($stagedPath in @((@($stagedNow) -join "`n") -split "`0" | Where-Object { $_ -ne '' })) {
        if (Test-InstructionPath $stagedPath) {
            $resetArgs = @('-C', $repoRoot) + $pathspecMode + @('reset', '-q', '--') + $paths
            Invoke-GitOrStop -Arguments $resetArgs -FailReason "git reset failed after a staged path named an instruction file; a person unstages it: $stagedPath"
            Stop-WithReason "path names an instruction file Claude Code loads (CLAUDE.md, CLAUDE.local.md, .mcp.json, a .claude folder or a short name of one), which no knowledge base commits: $stagedPath"
        }
    }

    & git -C $repoRoot diff --cached --quiet
    $hasStagedChanges = ($LASTEXITCODE -ne 0)

    # An empty hooks directory means neither the commit nor the push can execute a
    # repo-planted hook such as .git/hooks/pre-commit or .git/hooks/pre-push.
    $hooksDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $hooksDir | Out-Null

    if ($hasStagedChanges) {
        $messageFile = [System.IO.Path]::GetTempFileName()
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($messageFile, $cleanMessage, $utf8NoBom)

        # The commit names no pathspec, so the flag here guards nothing; it
        # takes the whole index.
        $commitArgs = @('-C', $repoRoot, '-c', "core.hooksPath=$hooksDir", '--literal-pathspecs', 'commit', '-F', $messageFile)
        Invoke-GitOrStop -Arguments $commitArgs -FailReason 'git commit failed.'
    } else {
        Write-Output 'nothing to commit'
    }

    # A push still runs when this call had nothing to commit, so that commits made
    # by earlier calls in the same run reach origin rather than stranding locally.
    if ($Push) {
        $remotes = @(& git -C $repoRoot remote)
        if ($LASTEXITCODE -ne 0) {
            Stop-WithReason 'unable to list git remotes.'
        }
        if ($remotes -notcontains 'origin') {
            # A knowledge base with no remote commits locally and pushes nothing;
            # that is the ordinary local-first case, not a failure.
            Write-Output "kb-commit: no remote named 'origin'; nothing pushed."
        } else {
            # ssh's batch mode is set only where no ssh command is configured,
            # so a configured one stands.
            $batchSsh = -not (Test-SshCommandConfigured -Repository $repoRoot)
            $pushArgs = @('-C', $repoRoot, '-c', "core.hooksPath=$hooksDir", 'push', 'origin', 'HEAD')
            Invoke-BoundedPush -Arguments $pushArgs -FailReason 'git push origin HEAD failed.' -BatchSsh:$batchSsh
        }
    }
} finally {
    # Closing the job's handle ends every process still in it, so nothing the
    # push started outlives this run, however the run ends.
    if ($script:job -ne [IntPtr]::Zero) { [KbCommit.JobObject]::Close($script:job) }
    if ($messageFile -and (Test-Path -LiteralPath $messageFile)) {
        Remove-Item -LiteralPath $messageFile -Force
    }
    if ($hooksDir -and (Test-Path -LiteralPath $hooksDir)) {
        Remove-Item -LiteralPath $hooksDir -Recurse -Force
    }
}

exit 0
