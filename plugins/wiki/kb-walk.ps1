#Requires -Version 7.0
<#
.SYNOPSIS
Visits every wiki in the account's wiki list once, in turn, bringing each up to
the installed engine, pulling and pushing where it has an origin, and running
the feeder, an ingest or a lint only where there is work.

.DESCRIPTION
The one scheduled pass per Windows account. It runs from the engine folder it
lives in, beside kb-registry.ps1, new-kb.ps1 and template/, and reads the
account's wiki list through kb-registry.ps1 List -Json. One pass proceeds at a
time: the walker first takes an exclusive lock on %LOCALAPPDATA%\llm-wiki\walk.lock,
opened with no sharing and held open by its own process, so the operating
system releases it when the walker ends, however it ends. A pass that finds
the lock held prints one line on stdout and exits 0.

The pass reads its state file, %LOCALAPPDATA%\llm-wiki\walk-state.json, which
holds per wiki the last successful lint time and any standing deferral, and a
cursor naming the wiki the last pass ended on. Wikis are visited in list order
starting after the cursor, so a long wiki cannot starve the rest. The state is
written whole after each wiki's visit as well as at the pass's end, so a pass
cut short keeps every visited wiki's cursor, lint stamp and deferral. Where no list
exists or the list holds no wikis, the pass writes a status with an empty wikis
array and the note "no wikis listed", and exits 0.

For each wiki, in order, each step logged with its seconds, and a failed step
recorded and the pass moving on as each step states:

  1. Trust. The wiki's path must hold hasTrustDialogAccepted true in
     ~/.claude.json. Where it does not, the wiki is recorded untrusted and
     skipped, since a headless run there writes nothing.
  2. Engine update. Where the templateHash in the .claude/engine.json
     committed at the wiki's HEAD differs from what this engine's new-kb.ps1
     -PrintEngineHash prints and kb-status.ps1 -What Live prints nothing,
     every file under the engine's
     template/.claude/ is copied over the wiki's .claude/, keeping the wiki's
     own .claude/feed.json and every file the engine does not ship, the new
     engine.json is written holding the hash alone, so two machines on one
     engine write the same bytes, and
     exactly the files written are committed with hooks disabled under the
     subject "Engine: update to <hash8>". A live tree records
     "deferred: live" and the step is retried next pass. A merge left in
     progress records "deferred: merge in progress" and copies nothing, and
     the pull then handles that merge. Where the copy, the staging or the
     commit fails or times out once the first file is written, the step is
     recorded failed and the written files stay in the tree uncommitted: the
     pull, the feed and the push still run, each recording its own outcome,
     while that pass's ingest and lint each record "skipped: engine update
     failed" and start no model run. The next pass reads the old mark at HEAD
     and makes the update again.
  3. Pull. A merge left in progress when the step starts, a killed pass's
     leftover or anyone's unfinished merge, is aborted first with git merge
     --abort, and the log names the wiki; where the MERGE_HEAD read or the
     abort fails, the pull is recorded failed and the wiki's remaining steps
     skip. Then, where a remote named origin exists: git fetch origin, then
     a fast-forward merge of origin/main, else a merge under git's own
     message for a merge of origin/main into main; with no origin the step
     is skipped and the visit goes on. After the fetch, origin/main is resolved once to its
     commit id, and every read and merge below names that id, so a later
     fetch cannot bring a commit the stop never read. Before any merge, the
     paths the fetched commit changes are read against every merge base:
     git merge-base --all HEAD <id> lists the bases, one git diff
     --no-renames --name-only -z <base> <id> is read per base, and the
     union of their paths is what the merge would bring, a rename listed as
     the path it leaves and the path it makes. Every base is read because
     git builds a merge with several bases from all of them, so a guard
     rail one base changed could be rolled back by a merge whose paths a
     single-base read never listed. Where the id, the base list or any diff
     fails or times out, or the two histories share no base, the pull is
     recorded failed and the visit goes on over the unchanged tree, as after
     a failed fetch. A changed path under .claude/, matched without regard
     to case, stops the pull: no merge lands and no model run
     starts, the step records "deferred: engine change" with the stopping
     paths, and the wiki is stuck from that pass with its remaining steps
     skipped. So does a changed path with a segment equal to .claude anywhere
     below the root, as in wiki/.claude/skills/x/SKILL.md, or that is the
     single segment .claude, matched without regard to case and never
     exempt, since Claude Code loads skills from a nested .claude/ folder
     and the engine ships nothing below the root; a segment that only
     begins with the name, such as .claude-notes, is no stop. So does any
     changed path whose first segment is shaped like a
     Windows short name, a ~ followed by a digit as in CLAUDE~1, which may be
     a second spelling of a guard rail at the wiki's root on disk. So do
     a changed CLAUDE.md or CLAUDE.local.md at any depth, a root .mcp.json,
     and any segment shaped like their short name, CLAUDE~ and digits as in
     wiki/CLAUDE~1.MD, each matched without regard to case and never exempt,
     since Claude Code loads each such file. A path is exempt only where it
     is spelled exactly .claude/ plus the relative path of a file the
     installed engine ships under template/.claude/, as the engine's own
     update commits it, and the fetched blob is the one that update would
     commit, compared as blob ids: git rev-parse <id>:<path> against git
     hash-object --path <path> over the installed file, both run in the wiki
     so its own attributes and filters apply. .claude/engine.json, spelled
     so, is exempt where its templateHash is this pass's engine hash, and is
     a stop where the pass has no engine hash. A deleted path, CLAUDE.md, a
     file the engine does not ship such as .claude/feed.json, any other case
     spelling under .claude/, and any differing blob are stops. So two
     clones of one wiki on one engine exchange their engine-update commits,
     and a wiki two machines share is held only while their engines differ.
     The stop keeps no pass count and no daily hold, and clears when a pull
     next reads ran: once a session or a person brings the wiki's HEAD to hold
     the change, or the other machine's engine is updated. A conflicting
     merge runs the wiki's kb-run.ps1 -Operation Merge, whose model run joins
     both sides. The merge is resolved where MERGE_HEAD is gone and HEAD moved
     afterward. Any other end state aborts the merge, records "deferred:
     conflict" with the conflicted paths, and skips the wiki's remaining steps.
     For each merge the walker lands, by git or by the model, the step note
     and the log name the restore point, the merge's first parent, in the form
     "restore point <hash>". The wiki's state entry counts the consecutive
     passes deferred on a conflict, conflictPasses, and holds the time its
     last model Merge run started, lastMergeRunAt; a pull that ran removes
     both, and one that failed or that the budget refused leaves both as they
     were. A wiki whose count is 3 or more when the pull starts is stuck: it is
     still fetched and merged every pass, so a fix upstream lands, but its
     model run starts only where lastMergeRunAt is absent or 24 hours or more
     old, and otherwise the merge is aborted and deferred with no run, the
     log saying until when the run is held. A conflict on .claude/settings.json
     starts no model run, so such a wiki is stuck from its first pass: the
     merge is aborted and deferred the same way, and the wiki stays stuck
     until a session or a person resolves the settings file.
     A deferred wiki is attempted again every pass and stays in the status's
     deferred list until a pass clears it. Only a pull that reaches its own
     verdict, ran or deferred anew, clears a standing conflict; a pull refused
     for budget or failed leaves it listed with its reason. A pull refused for
     budget, its merge run at the model-run floor among them, skips the
     wiki's remaining steps as a deferral does, and changes neither
     conflictPasses nor lastMergeRunAt.
  4. Feed. Where .claude/feed.json exists, the wiki's feed-inbox.ps1 runs with
     FEED_INBOX_RUN_SECONDS set to the smaller of 3000 and the remaining budget.
  5. Ingest. Where inbox/ holds any file other than .gitkeep, the walker reads
     kb-status.ps1 -What Live, and where it prints nothing, kb-run.ps1
     -Operation Ingest runs. A Live read that is missing, times out or exits
     non-zero records the step failed; one that prints any line records
     "deferred: live", starts no model run, and the step is tried again next
     pass.
  6. Lint. Where the wiki's last lint is absent or older than seven days, the
     walker reads kb-status.ps1 -What Live as the ingest does, then reads HEAD,
     and kb-run.ps1 -Operation Lint runs. The time is stamped only where the
     run exits 0 and a commit whose subject begins "Lint:" landed after that
     HEAD read. The lint skill ends a run another writer went live in, at its
     first step or before its write pass, with exit 0 and no Lint: commit,
     keeping any Reconcile: commit it made, so a moved HEAD alone stamps
     nothing. A run with no Lint: commit records "skipped: no Lint: commit",
     a failed HEAD or log read records the step failed, and either way the
     lint is tried again next pass, unless the hold below applies. The
     wiki's state entry counts the consecutive failed lints, lintFailures,
     and holds the time the last such run started, lastLintAttemptAt: a run
     whose kb-run.ps1 child did not exit 0, or that recorded "skipped: no
     Lint: commit", raises the count and sets the time; a stamp removes both;
     and a lint that reached no verdict, "deferred: live", "skipped: run lock
     held", "skipped: budget", "skipped: engine update failed" or a failed
     HEAD or log read, leaves both as they were. A due lint whose count is 3
     or more starts no run while lastLintAttemptAt is under 24 hours old, a
     time later than now reading as absent: it records "skipped: held after
     3 failed lints", and the log says until when
     the run is held.
  7. Push. Where origin exists: with an upstream set, git push origin HEAD where
     kb-status.ps1 -What Unpushed prints anything; with none, git push -u origin HEAD.

A model is called only by steps 3, 5 and 6, each only where that step has work.
Every commit the walker itself makes uses the account's git identity, and where
git config user.email prints nothing the step records "failed: git identity
unset" rather than committing.

The pass holds a budget of 6900 seconds, 300 seconds under the 2-hour limit of
the scheduled task that runs it. KB_WALK_SECONDS replaces it, as a whole number
of seconds from 1 to 99999. A wiki is not started with under 120 seconds left,
and is recorded "skipped: budget" with the cursor stopped before it. No child
is started with under 60 seconds left: a step that needs one is recorded
"skipped: budget" instead. No kb-run.ps1 child, the ingest, lint and merge
model runs, is started with under 600 seconds left, a floor
KB_WALK_MODEL_FLOOR_SECONDS replaces as a whole number of seconds from 1 to
99999: the step is recorded "skipped: budget" as for the 60-second floor, and
a merge so refused is aborted as that floor's refusal aborts it and ends the
visit, while the pass's git calls and its other children keep the 60-second
floor alone. A merge abort, and the commit that finishes an engine update
already copied, run whatever is left, all such calls sharing one
deadline 60 seconds past the budget, and each waited for at least 15 seconds
however late it starts, so none is stopped as it starts. Each
kb-run.ps1 child runs with KB_RUN_SECONDS set to the remaining budget, so no
child outlives the pass. A feed, ingest or lint whose child's first stdout
line reports the wiki's run lock held, and which exits having done nothing, is
recorded "skipped: run lock held", and such a lint stamps nothing: no lint is
stamped without its own Lint: commit. A merge run whose first stdout line
reports the lock held is named in the log and still stamps its last run time,
since a model run's first line can carry the same text and the stuck wiki's
daily limit must not rest on it. Every child
runs with the wiki as its working directory. The feeder, ingest, lint and
merge children have their stdout and stderr read line by line and written
through to the walker's own as each line arrives. Every child is assigned
at its start to one Windows job object created with kill-on-close, which the
walker alone holds, so when the walker ends, however it ends, the operating
system ends every child's whole tree. A child that has not ended when the
remaining budget runs out has its tree stopped and its step recorded failed.
A captured child's streams are drained for 5 seconds after it ends; a process
it left that still holds them then is ended with the job's processes, the log
says so, and the child's own exit code stands.
Every git call the walker makes runs with GIT_TERMINAL_PROMPT=0,
GCM_INTERACTIVE=never, an http stall bound of 1000 bytes a
second over 60 seconds, and core.hooksPath set to a fresh
empty folder, no-hooks beside the pass files, so no git call waits on a person
and no hook a wiki holds can run. A fetch or push also runs ssh in batch mode,
only where the account or the wiki configures no ssh command of its own
(GIT_SSH_COMMAND, GIT_SSH or core.sshCommand); where one is configured it is
used as configured, and the pass budget ends any prompt it makes.

Each pass writes %LOCALAPPDATA%\llm-wiki\walk-status.json whole through a
temporary file: startedAt, finishedAt, engineHash, wikis as one object per
wiki with a result among visited, untrusted, deferred and "skipped: budget",
and for a visited wiki a steps object whose entries carry an outcome among ran,
skipped, failed and deferred, a note and the seconds taken; deferred as the
names still deferred with their reasons, a conflict's or a stop's paths, a
conflict's count of consecutive deferred passes as passes and whether the wiki
is stuck; failures
as every failed step; and
a note where the pass has one, such as "no wikis listed" or a kill-on-close
job that could not be replaced. The status is written once, at the pass's
end, as the pass's report, while the state is written after each visit too.
The walker's own step notes, in the status
file and walk.log, have any URL's userinfo replaced by ***, so a remote's
credentials in git's error text never reach a note. Output from the feed,
ingest, lint and Merge children is not filtered: it reaches the walker's
stdout and stderr as the child printed it. walk.log under the same folder takes one block per pass
and is rotated at 5 MB. The walker exits 0 after a pass, whatever it recorded, and exits 1 only
where LOCALAPPDATA is unset, KB_WALK_SECONDS or KB_WALK_MODEL_FLOOR_SECONDS is
not a whole number of seconds from 1 to 99999,
or it could not read the list, take the lock or write the status.

A wiki that becomes stuck is reported in walk-notices.jsonl beside the status
file, which a session on the account reads. The walker appends one JSON line
with id, text, paths on a stuck or still-stuck line, source (the string
wiki-walk) and at, written before the state
and the status, and never rewrites a line. The state written after each visit
holds each wiki's noticedStuck and lastNoticeAt as they stood before the pass,
so those two fields still reach the state only once the line is in the file. A line is written in the pass whose
pull leaves a wiki stuck, in each pass at least 24 hours after the wiki's last
line while its pull is still deferred, and in the pass whose pull lands after a
line was written. The wiki's state entry holds noticedStuck and lastNoticeAt
for this, and a pass whose append fails puts both back as they were, so the
next pass writes the line. A pull refused for budget or failed writes nothing
and leaves both as they were. A line's text names the wiki, how many paths
git found conflicted and the pass count, or for a conflict on
.claude/settings.json that file alone, or for an engine-change stop how many
pulled paths stopped it; it names no other path and never a page's content.
Its paths field is an array of at most the first 10 conflicted or stopping
paths; a cleared line has none. Those names and the cleared line's note are text a
remote can steer, so a path's ASCII control characters become spaces as in
every log line, and each path in the field and the note then has every other
control character, every basic-plane format character, and every tag, line
separator and paragraph separator character replaced by a hyphen. A pass
killed, or whose state write fails,
after its append writes the notice again, under a new id, in the next pass
whose pull is deferred; where a later pull lands first, no cleared line
follows that notice,
and a disk that fills mid-append can leave one line a reader cannot parse and
skips. A file over 1 MB is renamed to
walk-notices.jsonl.1 before the pass appends, over any earlier one.

With -WhatIf the walker takes no lock, runs nothing but the list read, and
writes nothing on disk. It prints the wikis it would visit, in order, and
exits 0.

.PARAMETER Claude
The claude executable each kb-run.ps1 child runs, as a path. Without it, each
child resolves claude on its own PATH.

.EXAMPLE
pwsh -NoProfile -File ./kb-walk.ps1

.EXAMPLE
pwsh -NoProfile -File ./kb-walk.ps1 -Claude "C:\Users\kbuser\.local\bin\claude.exe" -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Claude
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Writes a single-line reason to stderr and stops with exit code 1, so a refusal
# is legible to an unattended caller without a PowerShell stack trace.
function Stop-WithReason {
    param([string]$Reason)
    [Console]::Error.WriteLine("kb-walk: $Reason")
    exit 1
}

# The first non-empty line of a text, for a one-line note.
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

# Stops a child and every process it started. taskkill /T walks the tree, and
# its output is read and discarded so it never reaches the walker's stdout.
# Both streams are read in the background, so the 10-second wait on taskkill
# bounds the read too. The taskkill process object is disposed however the
# stop ends.
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
    try {
        $null = $killer.StandardError.ReadToEndAsync()
        $null = $killer.StandardOutput.ReadToEndAsync()
        [void]$killer.WaitForExit(10000)
        if (-not $Process.WaitForExit(5000)) {
            $Process.Kill()
        }
    } finally {
        $killer.Dispose()
    }
}

# Two native helpers. JobObject is the kill-on-close job object every child
# runs in. Each of its calls returns a Win32 error code, 0 on success, so a
# failure is reported and never thrown. The job is made with no security
# attributes, so its handle is not inheritable and no child ever holds it.
# 0x2000 is JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, and 9 is
# JobObjectExtendedLimitInformation. ChildStreams reads a captured child's
# stdout and stderr line by line as the lines arrive, keeps them, and with
# relay on writes each through to the walker's own stream at once, so the log
# is live and a child stopped at the deadline still leaves what it printed.
# The types are compiled once per session, and carry their own namespace so
# they load beside kb-run.ps1's in one session.
$nativeSource = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace KbWalk
{
    public sealed class ChildStreams : IDisposable
    {
        #region Variables

        // Collected Lines.
        private readonly object _gate = new object();
        private readonly List<string> _stdout = new List<string>();
        private readonly List<string> _stderr = new List<string>();

        // Stream State.
        private readonly CountdownEvent _open = new CountdownEvent(2);
        private readonly bool _relay;
        private bool _disposed;

        #endregion

        #region Constructor

        public ChildStreams(
                Process process,
                bool relay
        )
        {
            // Save Settings.
            _relay = relay;

            // Attach the Line Handlers.
            process.OutputDataReceived += (sender, e) => Receive(e.Data, _stdout, Console.Out);
            process.ErrorDataReceived += (sender, e) => Receive(e.Data, _stderr, Console.Error);

            // Start Reading Both Streams.
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
        }

        #endregion

        #region Properties

        public string Stdout
        {
            get { lock (_gate) { return string.Join("\n", _stdout); } }
        }

        public string Stderr
        {
            get { lock (_gate) { return string.Join("\n", _stderr); } }
        }

        #endregion

        #region Public Methods

        public bool WaitForStreams(int milliseconds)
        {
            return _open.Wait(milliseconds);
        }

        public void Dispose()
        {
            // Release the Countdown Once.
            lock (_gate)
            {
                if (_disposed) return;
                _disposed = true;
                _open.Dispose();
            }
        }

        #endregion

        #region Private Methods

        private void Receive(string line, List<string> lines, TextWriter writer)
        {
            // Mark the Stream Closed at its End. A stream that ends after the
            // walker disposed this object, as one a leftover held does, is ignored.
            if (line is null)
            {
                lock (_gate)
                {
                    if (_disposed) return;
                    try { _open.Signal(); } catch (InvalidOperationException) { }
                }
                return;
            }

            // Keep the Line.
            lock (_gate) { lines.Add(line); }

            // Write the Line Through. A closed walker stream never stops the read.
            if (!_relay) return;
            try { writer.WriteLine(line); } catch (IOException) { } catch (ObjectDisposedException) { }
        }

        #endregion
    }

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

# Makes the job object, or returns [IntPtr]::Zero after one stderr line naming
# why it could not, so the pass proceeds without it.
function New-KillOnCloseJob {
    try {
        $job = [IntPtr]::Zero
        $jobError = [KbWalk.JobObject]::CreateKillOnClose([ref]$job)
        if ($jobError -ne 0) {
            [Console]::Error.WriteLine("kb-walk: creating the kill-on-close job object failed with Win32 error $jobError; the pass proceeds without it.")
            return [IntPtr]::Zero
        }
        return $job
    } catch {
        [Console]::Error.WriteLine("kb-walk: creating the kill-on-close job object failed: $(Get-FirstLine (Get-InnerError $_.Exception).Message); the pass proceeds without it.")
        return [IntPtr]::Zero
    }
}

# Parses a JSON file into nested dictionaries. ~/.claude.json can carry a
# property whose name is an empty string, which the default ConvertFrom-Json
# rejects; the -AsHashtable switch tolerates it, and the value supports
# ContainsKey and key indexing.
function Read-JsonAsDictionary {
    param([string]$FilePath)
    $raw = Get-Content -LiteralPath $FilePath -Raw
    return $raw | ConvertFrom-Json -AsHashtable
}

# Folds path separators to forward slashes and lowercases, so a path recorded
# with backslashes and one recorded with forward slashes compare equal. Both
# forms occur as project keys in ~/.claude.json.
function ConvertTo-ComparablePath {
    param([string]$PathValue)
    return ($PathValue -replace '\\', '/').TrimEnd('/').ToLowerInvariant()
}

# Text from a wiki or a child, made fit for one of the walker's own notes: the
# userinfo of any URL in it replaced by ***, so a remote's credentials in git's
# error text never reach a step note in the status or walk.log, and then every
# control character turned into a space, so a path or a message cannot break a
# log line. The userinfo runs from :// to the last @ before the next slash or
# whitespace, as the feeder's Format-RedactedUrl reads it, and is replaced
# first, so a control byte inside it that is not whitespace is masked with the
# rest rather than turned into a space that ends the match. A tab, carriage
# return or line feed still ends it. ASCII controls then become spaces, and
# every other character of $script:unsafeText becomes a hyphen, so a steered
# path or git message cannot reorder or hide part of a log line. Output a
# child prints to the walker's own streams never passes through here.
function ConvertTo-LogText {
    param([string]$Text)
    if ($null -eq $Text) { return '' }
    $masked = $Text -replace '://[^/\s]*@', '://***@'
    $spaced = $masked -replace '[\x00-\x1F\x7F]', ' '
    return ([regex]::Replace($spaced, $script:unsafeText, '-')).Trim()
}

# One line to the pass's log and to stdout, where the children's output goes too.
function Write-Log {
    param([string]$Text)
    $line = "$([DateTime]::UtcNow.ToString('HH:mm:ss', [System.Globalization.CultureInfo]::InvariantCulture)) $Text"
    [Console]::Out.WriteLine($line)
    if ($null -ne $script:logPath) {
        try {
            [System.IO.File]::AppendAllText($script:logPath, $line + [Environment]::NewLine, $script:utf8NoBom)
        } catch {
            # A log that cannot be written never stops the pass; stdout still carries the line.
        }
    }
}

# The whole seconds of budget left in the pass, never below zero.
function Get-RemainingSeconds {
    return [int][Math]::Max(0, [Math]::Floor(($script:deadline - [DateTime]::UtcNow).TotalSeconds))
}

# Ends every process left in the job after a captured child exited or was
# stopped, then replaces the job for the children still to come. The walker
# runs one child at a time, and the job takes only the children the walker
# assigns and the processes they start, which cannot leave it, so at this
# point it holds that child's leftovers, and any process an earlier child left
# running, and nothing the walker did not start. Closing the job's handle
# ends its processes too, since it is made with kill-on-close.
#
# The replacement is made before the old job is closed, so a failed creation
# never leaves the pass without a job it could keep. Where creation fails and
# the terminate succeeded, the old job is empty and is kept. Where both fail,
# the old job still holds the leftovers and only closing it ends them, so it is
# closed, the pass runs its remaining children with no job, and the status
# carries a note saying the kill-on-close guarantee lapsed.
function Stop-JobLeftovers {
    $terminateError = [KbWalk.JobObject]::Terminate($script:job)
    if ($terminateError -ne 0) {
        [Console]::Error.WriteLine("kb-walk: terminating the kill-on-close job object failed with Win32 error $terminateError; closing it ends its processes.")
    }
    $replacement = New-KillOnCloseJob
    if ($replacement -ne [IntPtr]::Zero) {
        [KbWalk.JobObject]::Close($script:job)
        $script:job = $replacement
        return
    }
    if ($terminateError -eq 0) { return }
    [KbWalk.JobObject]::Close($script:job)
    $script:job = [IntPtr]::Zero
    $lapse = 'the kill-on-close job object could not be replaced, so the children started after this point in the pass run without it'
    $script:passNotes.Add($lapse)
    Write-Log $lapse
}

# Starts a program in the wiki, assigns it to the job at once, and waits for it
# up to the pass's remaining budget, stopping its tree past that. With -Capture
# both streams are read line by line as they arrive, and with -Relay each line
# is also written through to the walker's own stream at once. Without -Capture
# the child inherits the process's own standard handles, which the launcher's
# in-process redirect never reaches, so every caller passes it. The result carries ExitCode, TimedOut,
# Stdout, Stderr and Leftovers, and a stopped child's result still carries
# what it printed before the stop.
#
# The streams close only when every process holding them has ended, which can
# be after the child itself. After the child exits or is stopped, they are
# drained for at most $streamDrainSeconds. Past that, every process left in
# the job is ended, and Leftovers names what happened; the exit code read from
# the child stands, so a child that exited 0 is never recorded as timed out.
#
# A child is never started with under $childFloorSeconds of the pass budget
# left: the call throws OperationCanceledException instead, which the step
# records as skipped: budget. A -Required call starts whatever is left. It is
# kept for a call that finishes or undoes a write the walker began, such as
# the merge abort, and for the pass's own reads of its inputs. Every -Required
# call shares one deadline, $childFloorSeconds past the pass budget, and each
# waits until that deadline or $requiredFloorSeconds, whichever is longer, so
# no required call is stopped as it starts. A git add, commit or merge abort
# stopped mid-write can leave .git/index.lock, which fails every later pass in
# that wiki.
#
# A required call that does not end in its wait costs a tail past it: up to 15
# seconds of tree stop, the 10-second wait on taskkill and the 5-second wait
# on the child in Stop-ProcessTree, and two $streamDrainSeconds drains. A call
# started before the shared deadline therefore ends by at most 25 seconds past
# it, and each call started after it costs at most about 40 seconds: the
# $requiredFloorSeconds floor, the tree stop and both drains. The worst traced
# path is a pull's Merge run stopped at the budget, whose tree stop takes 15
# seconds, then the MERGE_HEAD read ending 85 seconds past the budget, then
# the HEAD read and the merge abort at about 40 seconds each, about 165
# seconds past the budget in all. That stays inside the 300 seconds the
# 6900-second budget leaves under the task's 2-hour limit.
function Invoke-Child {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory,
        [hashtable]$Environment = @{},
        [switch]$Capture,
        [switch]$Relay,
        [switch]$Required,
        [switch]$Utf8
    )
    if ($Required) {
        $waitMilliseconds = [int][Math]::Max($script:requiredFloorSeconds * 1000, ($script:requiredDeadline - [DateTime]::UtcNow).TotalMilliseconds)
    } else {
        $remaining = Get-RemainingSeconds
        if ($remaining -lt $script:childFloorSeconds) {
            throw [System.OperationCanceledException]::new("$FilePath was not started: under $script:childFloorSeconds seconds of the pass budget are left.")
        }
        $waitMilliseconds = $remaining * 1000
    }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    foreach ($argument in $Arguments) { $psi.ArgumentList.Add($argument) }
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = [bool]$Capture
    $psi.RedirectStandardError = [bool]$Capture
    # git writes paths as UTF-8 bytes; read in the console code page they turn
    # into other characters and escape the strip a notice applies.
    if ($Capture -and $Utf8) {
        $psi.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
        $psi.StandardErrorEncoding = [System.Text.UTF8Encoding]::new($false)
    }
    foreach ($name in $Environment.Keys) {
        if ($null -eq $Environment[$name]) {
            [void]$psi.EnvironmentVariables.Remove($name)
        } else {
            $psi.EnvironmentVariables[$name] = [string]$Environment[$name]
        }
    }
    $process = [System.Diagnostics.Process]::Start($psi)
    $streams = $null
    try {
        # Only the child's own handle is assigned, so the job reaches the child
        # and every process it starts from here on, and never the walker.
        if ($script:job -ne [IntPtr]::Zero) {
            $assignError = [KbWalk.JobObject]::Assign($script:job, $process.Handle)
            if ($assignError -ne 0 -and -not $process.HasExited) {
                [Console]::Error.WriteLine("kb-walk: assigning a child to the kill-on-close job object failed with Win32 error $assignError; the pass proceeds without it.")
            }
        }
        if ($Capture) { $streams = [KbWalk.ChildStreams]::new($process, [bool]$Relay) }
        $exited = $process.WaitForExit($waitMilliseconds)
        if (-not $exited) { Stop-ProcessTree $process }

        # Drain the streams for a short fixed bound, and end what still holds them.
        $leftovers = ''
        if ($null -ne $streams -and -not $streams.WaitForStreams($script:streamDrainSeconds * 1000)) {
            $leftovers = "a process it left still held its output $script:streamDrainSeconds seconds after it ended"
            if ($script:job -eq [IntPtr]::Zero) {
                $leftovers = "$leftovers, and the pass has no job object to end it"
            } else {
                Stop-JobLeftovers
                if ($streams.WaitForStreams($script:streamDrainSeconds * 1000)) {
                    $leftovers = "$leftovers, and was ended with the job's processes"
                } else {
                    $leftovers = "$leftovers, and still held it after the job's processes were ended"
                }
            }
            Write-Log "$(Split-Path -Leaf $FilePath) in $(ConvertTo-LogText $WorkingDirectory): $leftovers"
        }
        $outText = ''
        $errText = ''
        if ($null -ne $streams) {
            $outText = $streams.Stdout
            $errText = $streams.Stderr
        }
        if (-not $exited) {
            return [pscustomobject]@{ ExitCode = $null; TimedOut = $true; Stdout = $outText; Stderr = $errText; Leftovers = $leftovers }
        }
        return [pscustomobject]@{ ExitCode = $process.ExitCode; TimedOut = $false; Stdout = $outText; Stderr = $errText; Leftovers = $leftovers }
    } finally {
        if ($null -ne $streams) { $streams.Dispose() }
        $process.Dispose()
    }
}

# Runs git in a wiki with no prompt possible and no hook runnable, and its
# output captured. The guards are the feeder's: GIT_TERMINAL_PROMPT and
# GCM_INTERACTIVE stop git and the credential manager asking, with -BatchSsh
# ssh runs in batch mode with a connect timeout, and core.hooksPath names an
# empty directory. A fetch or push passes -BatchSsh only where the account or
# the wiki configures no ssh command of its own, so a configured one stands.
# The http stall bound ends a fetch or push over HTTPS that moves under 1000
# bytes a second for 60 seconds, as the ssh keepalive does over ssh.
function Invoke-Git {
    param([string]$WikiPath, [string[]]$Arguments, [switch]$Required, [switch]$BatchSsh)
    $environment = @{
        'GIT_TERMINAL_PROMPT' = '0'
        'GCM_INTERACTIVE'     = 'never'
    }
    if ($BatchSsh) {
        $environment['GIT_SSH_COMMAND'] = 'ssh -o BatchMode=yes -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4'
    }
    $guards = @('-C', $WikiPath, '-c', "core.hooksPath=$script:hooksDir") + $script:gitStallBound
    return Invoke-Child 'git' ($guards + $Arguments) $WikiPath $environment -Capture -Required:$Required -Utf8
}

# Whether a fetch or push in the wiki may take the batch-mode ssh command: only
# where the walker's environment holds neither GIT_SSH_COMMAND nor GIT_SSH,
# which git inherits, and git reads no core.sshCommand for the wiki from any
# config scope. git takes GIT_SSH_COMMAND over core.sshCommand over GIT_SSH, so
# setting the first would silence an ssh command the account or the wiki
# configured, a deploy key's among them. The config is read under the pass
# budget, as the call it guards is. Returns Allowed, or Failed holding the read's
# result where it timed out or ended in an exit other than 0 or 1, exit 1 being
# git's answer for an unset key, for the caller to record as its step's failure.
function Get-SshBatchDecision {
    param([string]$WikiPath)
    if (-not [string]::IsNullOrEmpty($env:GIT_SSH_COMMAND) -or -not [string]::IsNullOrEmpty($env:GIT_SSH)) {
        return [pscustomobject]@{ Allowed = $false; Failed = $null }
    }
    $read = Invoke-Git $WikiPath @('config', '--get', 'core.sshCommand')
    if ($read.TimedOut -or ($read.ExitCode -ne 0 -and $read.ExitCode -ne 1)) {
        return [pscustomobject]@{ Allowed = $false; Failed = $read }
    }
    return [pscustomobject]@{ Allowed = ($read.ExitCode -eq 1); Failed = $null }
}

# True where a captured stdout's first non-empty line starts with the child's
# own lock-held prefix, which the child prints before exiting 0 having done
# nothing. Only the first line is read: both children print that line before
# anything else reaches stdout, and a model run's later output shares the pipe,
# so a later line carrying the prefix is the model's and never the lock's.
function Test-LockHeld {
    param($Result, [string]$Prefix)
    foreach ($line in @(Get-Lines $Result.Stdout)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        return $line.StartsWith($Prefix, [StringComparison]::Ordinal)
    }
    return $false
}

# The non-empty lines of a captured stream.
function Get-Lines {
    param([string]$Text)
    return @(($Text -split "`r?`n") | Where-Object { $_ -ne '' })
}

# One note for a child that did not exit 0: its exit code, or the stop, and
# any leftover process ended after it.
function Get-ChildNote {
    param($Result, [string]$What)
    if ($Result.TimedOut) {
        $note = "$What did not finish within the remaining budget; its process tree was stopped"
    } else {
        $line = Get-FirstLine $Result.Stderr
        $note = "$What exited $($Result.ExitCode)"
        if ($line -ne 'no error text') { $note = "$note`: $(ConvertTo-LogText $line)" }
    }
    if (-not [string]::IsNullOrEmpty($Result.Leftovers)) { $note = "$note; $($Result.Leftovers)" }
    return $note
}

# True where the account's git identity is set in the wiki, so a commit the
# walker makes there, an engine update's or a pull's merge, can be made.
function Test-GitIdentity {
    param([string]$WikiPath)
    $identity = Invoke-Git $WikiPath @('config', 'user.email')
    return ((-not $identity.TimedOut) -and @(Get-Lines $identity.Stdout).Count -gt 0)
}

# Runs one of the wiki's vendored scripts under this host, in the wiki.
function Invoke-WikiScript {
    param([string]$WikiPath, [string]$ScriptName, [string[]]$Arguments, [hashtable]$Environment = @{}, [switch]$Capture, [switch]$Relay)
    $scriptPath = Join-Path (Join-Path $WikiPath '.claude') $ScriptName
    if (-not [System.IO.File]::Exists($scriptPath)) {
        return [pscustomobject]@{ ExitCode = $null; TimedOut = $false; Stdout = ''; Stderr = "kb-walk: the wiki has no .claude/$ScriptName"; Leftovers = ''; Missing = $true }
    }
    $result = Invoke-Child $script:psExe (@('-NoProfile', '-File', $scriptPath) + $Arguments) $WikiPath $Environment -Capture:$Capture -Relay:$Relay
    return [pscustomobject]@{ ExitCode = $result.ExitCode; TimedOut = $result.TimedOut; Stdout = $result.Stdout; Stderr = $result.Stderr; Leftovers = $result.Leftovers; Missing = $false }
}

# Called before every kb-run.ps1 child, the ingest, lint and merge model runs.
# A model run is never started with under $modelFloorSeconds of the pass budget
# left, since one started later is stopped unfinished at the budget: the call
# throws the OperationCanceledException Invoke-Child throws for its own floor,
# so the step records skipped: budget and a merge in progress is aborted as
# for that floor. The pass's git calls and its other children keep
# $childFloorSeconds alone.
function Assert-ModelFloor {
    $remaining = Get-RemainingSeconds
    if ($remaining -lt $script:modelFloorSeconds) {
        throw [System.OperationCanceledException]::new("kb-run.ps1 was not started: under $script:modelFloorSeconds seconds of the pass budget are left for a model run.")
    }
}

# The templateHash in the .claude/engine.json committed at a revision of the
# wiki, HEAD unless another is named, as Hash, with the git read kept in Read.
# The committed mark is read rather than the working-tree file, so an update
# whose add or commit failed after its copy still reads as differing and is
# made again. The update step's read runs whatever the budget, with -Required;
# the pull's read of the fetched mark is refused for budget as its other calls
# are. Where the read exits non-zero, as for a revision or a path that is
# absent, Hash reads unknown; where it timed out, Read says so and Hash reads
# unknown. The mark is the wiki's or the remote's and is read as untrusted:
# anything but a JSON object holding a 64-character hexadecimal templateHash
# string reads as unknown.
function Get-HeadEngineHash {
    param([string]$WikiPath, [string]$Revision = 'HEAD', [switch]$Required)
    $read = Invoke-Git $WikiPath @('show', "$Revision`:.claude/engine.json") -Required:$Required
    $hash = 'unknown'
    if ((-not $read.TimedOut) -and $read.ExitCode -eq 0) {
        try {
            $mark = $read.Stdout.TrimStart([char]0xFEFF) | ConvertFrom-Json -AsHashtable
            if ($mark -is [System.Collections.IDictionary] -and $mark.Contains('templateHash')) {
                $value = $mark['templateHash']
                if ($value -is [string] -and [regex]::IsMatch($value, '\A[0-9A-Fa-f]{64}\z')) { $hash = $value.ToLowerInvariant() }
            }
        } catch {
            $hash = 'unknown'
        }
    }
    return [pscustomobject]@{ Hash = $hash; Read = $read }
}

# The per-wiki entry of the state file, made where absent.
function Get-WikiState {
    param([string]$Name)
    if (-not $script:stateWikis.Contains($Name)) { $script:stateWikis[$Name] = [ordered]@{} }
    return $script:stateWikis[$Name]
}

# Records one step's outcome on the wiki's status entry, logs it, and lists a
# failure or a deferral where the status collects them.
function Add-Step {
    param($Wiki, [string]$Step, [string]$Outcome, [string]$Note, [DateTime]$StartedAt, [string[]]$Paths = @())
    $seconds = [Math]::Round(([DateTime]::UtcNow - $StartedAt).TotalSeconds, 1)
    $entry = [ordered]@{ outcome = $Outcome; note = $Note; seconds = $seconds }
    $Wiki.steps[$Step] = $entry
    $text = $Outcome
    if (-not [string]::IsNullOrEmpty($Note)) { $text = "$Outcome`: $Note" }
    Write-Log "$($Wiki.name) $Step $text ($($seconds)s)"
    if ($Outcome -eq 'failed') {
        $script:status.failures.Add([ordered]@{ name = $Wiki.name; step = $Step; note = $Note })
    }
    if ($Outcome -eq 'deferred') {
        $deferral = [ordered]@{ reason = $Note }
        if ($Paths.Count -gt 0) { $deferral['paths'] = @($Paths) }
        (Get-WikiState $Wiki.name)['deferred'] = $deferral
    }
}

# True where the wiki's kb-status.ps1 -What Live prints nothing, so a step
# that writes in the tree may start. Otherwise the step is recorded and $false
# returned: failed where the read is missing, timed out or exited non-zero,
# and deferred: live where it printed any line, so the step is tried again
# next pass. The read is a child like any other, refused for budget the same way.
function Test-QuietTree {
    param($Wiki, [string]$WikiPath, [string]$Step, [DateTime]$StartedAt)
    $live = Invoke-WikiScript $WikiPath 'kb-status.ps1' @('-What', 'Live') -Capture
    if ($live.Missing -or $live.TimedOut -or $live.ExitCode -ne 0) {
        Add-Step $Wiki $Step 'failed' (Get-ChildNote $live 'kb-status.ps1 -What Live') $StartedAt
        return $false
    }
    if (@(Get-Lines $live.Stdout).Count -gt 0) {
        Add-Step $Wiki $Step 'deferred' 'live' $StartedAt
        return $false
    }
    return $true
}

# Step 2: the engine update. Returns $true where the step failed after it
# began writing the engine's files, so the tree holds an update that is not
# committed and the visit skips this pass's ingest and lint; $false otherwise.
function Invoke-UpdateStep {
    param($Wiki, [string]$WikiPath)
    $startedAt = [DateTime]::UtcNow
    if ($null -eq $script:engineHash) {
        Add-Step $Wiki 'update' 'failed' 'engine hash unreadable' $startedAt
        return $false
    }
    $headMark = Get-HeadEngineHash $WikiPath -Required
    if ($headMark.Read.TimedOut) {
        Add-Step $Wiki 'update' 'failed' (Get-ChildNote $headMark.Read 'git show HEAD:.claude/engine.json') $startedAt
        return $false
    }
    if ($headMark.Hash -eq $script:engineHash) {
        Add-Step $Wiki 'update' 'skipped' 'current' $startedAt
        return $false
    }

    # A merge left unfinished, by an abort that failed or one an earlier pass
    # could not run, would take the update's commit into it, so nothing is
    # copied until the pull has settled it.
    $mergeHead = Invoke-Git $WikiPath @('rev-parse', '-q', '--verify', 'MERGE_HEAD')
    if ($mergeHead.TimedOut) {
        Add-Step $Wiki 'update' 'failed' (Get-ChildNote $mergeHead 'git rev-parse MERGE_HEAD') $startedAt
        return $false
    }
    if ($mergeHead.ExitCode -eq 0) {
        Add-Step $Wiki 'update' 'deferred' 'merge in progress' $startedAt
        return $false
    }
    if (-not (Test-QuietTree $Wiki $WikiPath 'update' $startedAt)) {
        return $false
    }
    if (-not (Test-GitIdentity $WikiPath)) {
        Add-Step $Wiki 'update' 'failed' 'git identity unset' $startedAt
        return $false
    }

    # Every file the engine ships is copied over the wiki's copy, and nothing
    # is removed, so feed.json and every file the engine does not ship stay.
    # The paths written are kept, so the commit takes exactly those. A copy
    # or mark write that throws once the first write has begun has already
    # changed the tree, so it is recorded failed with the same return as a
    # failed commit; one that throws before any write returns $false.
    $sourceRoot = Join-Path $script:engineRoot 'template\.claude'
    $targetRoot = Join-Path $WikiPath '.claude'
    $written = New-Object System.Collections.Generic.List[string]
    $writing = $false
    try {
        foreach ($file in [System.IO.Directory]::GetFiles($sourceRoot, '*', [System.IO.SearchOption]::AllDirectories)) {
            $relative = $file.Substring($sourceRoot.Length).TrimStart('\', '/')
            $target = Join-Path $targetRoot $relative
            $targetDir = Split-Path -Parent $target
            $writing = $true
            if (-not [System.IO.Directory]::Exists($targetDir)) { [void][System.IO.Directory]::CreateDirectory($targetDir) }
            [System.IO.File]::Copy($file, $target, $true)
            $written.Add('.claude/' + ($relative -replace '\\', '/'))
        }

        # The mark holds the hash alone, with no time and no per-machine field, so
        # two machines that update one wiki to one engine write the same bytes, and
        # the pull that later joins their two update commits merges cleanly.
        $engineMark = [ordered]@{ templateHash = $script:engineHash }
        $writing = $true
        [System.IO.File]::WriteAllText((Join-Path $targetRoot 'engine.json'), ((ConvertTo-Json -InputObject $engineMark) + "`n"), $script:utf8NoBom)
        $written.Add('.claude/engine.json')
    } catch {
        Add-Step $Wiki 'update' 'failed' "copying the engine's files failed: $(ConvertTo-LogText (Get-FirstLine (Get-InnerError $_.Exception).Message))" $startedAt
        return $writing
    }

    # The add and the commit name the same paths, so a person's staged work
    # and every untracked file stay out of the commit and stay as they were.
    # Both finish a write already made in the tree, so they run whatever the
    # budget. A failed add or commit leaves the copied files and the new mark in
    # the tree, which kb-status.ps1 -What Live then reads as live for 30
    # minutes, so the step returns $true and the visit starts no ingest or lint
    # model run over them. Because the current-engine test reads the mark
    # committed at HEAD, the next pass copies, stages and commits them again.
    $added = Invoke-Git $WikiPath (@('add', '--') + $written) -Required
    if ($added.TimedOut -or $added.ExitCode -ne 0) {
        Add-Step $Wiki 'update' 'failed' (Get-ChildNote $added 'git add') $startedAt
        return $true
    }
    $hash8 = $script:engineHash.Substring(0, 8)
    $committed = Invoke-Git $WikiPath (@('commit', '-q', '-m', "Engine: update to $hash8", '--') + $written) -Required
    if ($committed.TimedOut -or $committed.ExitCode -ne 0) {
        Add-Step $Wiki 'update' 'failed' (Get-ChildNote $committed 'git commit') $startedAt
        return $true
    }
    Add-Step $Wiki 'update' 'ran' "updated to $hash8" $startedAt
    return $false
}

# True where the wiki has a remote named origin.
function Test-Origin {
    param([string]$WikiPath)
    $remotes = Invoke-Git $WikiPath @('remote')
    return ((-not $remotes.TimedOut) -and ($remotes.ExitCode -eq 0) -and (@(Get-Lines $remotes.Stdout) -contains 'origin'))
}

# The commit HEAD names, or an empty string. -Required reads it whatever the
# budget, for a read that reports a write already made.
function Get-Head {
    param([string]$WikiPath, [switch]$Required)
    $head = Invoke-Git $WikiPath @('rev-parse', '--verify', '-q', 'HEAD') -Required:$Required
    if ($head.TimedOut -or $head.ExitCode -ne 0) { return '' }
    return (Get-FirstLine $head.Stdout)
}

# The wiki's count of consecutive passes deferred on a conflict, from its
# state entry. The entry is read as untrusted: anything but a whole number
# reads as 0.
function Get-ConflictPasses {
    param($State)
    $passes = 0
    if ($State.Contains('conflictPasses') -and [int]::TryParse([string]$State['conflictPasses'], [System.Globalization.NumberStyles]::None, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$passes)) {
        return $passes
    }
    return 0
}

# A run-start time from a wiki's state entry, by its field name, or $null
# where the entry holds none it can read. A time later than now reads as none,
# since no run started then, so the lint hold outlasts no day.
function Get-PastStateTime {
    param($State, [string]$Name)
    $last = [DateTime]::MinValue
    if ($State.Contains($Name) -and ($State[$Name] -is [string]) -and
        [DateTime]::TryParseExact($State[$Name], 'o', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$last)) {
        $last = $last.ToUniversalTime()
        if ($last -gt [DateTime]::UtcNow) { return $null }
        return $last
    }
    return $null
}

# The time the wiki's last model Merge run started, from its state entry, or
# $null where the entry holds none it can read.
function Get-LastMergeRunAt {
    param($State)
    $last = [DateTime]::MinValue
    if ($State.Contains('lastMergeRunAt') -and ($State['lastMergeRunAt'] -is [string]) -and
        [DateTime]::TryParseExact($State['lastMergeRunAt'], 'o', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$last)) {
        return $last.ToUniversalTime()
    }
    return $null
}

# Records a pull that ran: a landed pull ends the wiki's run of conflicts, so
# the count and the last run's time go with it.
function Add-PullRan {
    param($Wiki, [string]$Note, [DateTime]$StartedAt)
    $state = Get-WikiState $Wiki.name
    $state.Remove('conflictPasses')
    $state.Remove('lastMergeRunAt')
    Add-Step $Wiki 'pull' 'ran' $Note $StartedAt
}

# The note of a landed merge, naming the restore point: the merge's first
# parent, which is the HEAD read before the merge.
function Get-MergeNote {
    param([string]$How, [string]$Before)
    if ([string]::IsNullOrEmpty($Before)) { return $How }
    return "$How, restore point $Before"
}

# The paths among those a pull would bring that may not land unread: each
# under .claude/ or equal to CLAUDE.md, the wiki's guard rails, less the ones
# that are the installed engine's own bytes, and the never-exempt stops this
# comment names below. Both names are matched without
# regard to case, since the wiki's checkout folds case and a .Claude/ entry in
# the fetched tree lands in .claude/. A path whose first segment is shaped
# like a Windows short name, a ~ followed by a digit as in CLAUDE~1, may be a
# second spelling of a guard rail at the wiki's root on disk, so it is a
# stop; a page such as wiki/draft~1.md is not. Claude Code also loads a
# CLAUDE.md or CLAUDE.local.md at any depth and a .mcp.json at the root, so a
# path whose last segment is either name, a root .mcp.json, and a segment at
# any depth shaped like their short name, CLAUDE~ and digits with or without
# an extension as in wiki/CLAUDE~1.MD, all matched without regard to case,
# are stops that are never exempt. So is a path with a segment equal to
# .claude anywhere below the root, or that is the single segment .claude,
# matched without regard to case: Claude Code loads skills from a nested
# .claude/ folder, and the engine ships nothing below the root, so no such
# path can be its own. A segment that only begins with the name, such as
# .claude-notes, is no stop, and the root .claude/ folder is read by the
# exemption below. The
# exemption reads spelling exactly, since a second case spelling of a file
# is a second index entry: a path is exempt only where it is .claude/ plus
# the relative path of a file the engine ships under template/.claude/,
# spelled as the engine's own update commits it, and the fetched blob's id,
# from git rev-parse, equals the id git hash-object gives the installed file
# at that path in the wiki, under the wiki's own attributes and filters, so
# the ids compare bytes git would commit and no captured text stands in for
# them. .claude/engine.json, spelled so, is exempt where the fetched mark's
# templateHash is this pass's engine hash, and is a stop where the pass has
# none. A path the fetched tree lacks, a deletion, is a stop, as is a path
# the engine does not ship, any other case spelling under .claude/ and any
# differing blob. Revision is the fetched commit's id, so every read names
# the commit the merge will take. Returns Stops, the stopping paths as git
# printed them, or Failed holding the first read that timed out or ended in
# an exit the read does not define, with What naming it, for the caller to
# record as the pull's failure.
function Get-GuardRailStops {
    param([string]$WikiPath, [string]$Revision, [string[]]$ChangedPaths)
    $stops = New-Object System.Collections.Generic.List[string]

    # The paths the engine's own update writes, built as it builds them. With
    # no template folder the set is empty, so every guard-rail path stops.
    $sourceRoot = Join-Path $script:engineRoot 'template\.claude'
    $shipped = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    if ([System.IO.Directory]::Exists($sourceRoot)) {
        foreach ($file in [System.IO.Directory]::GetFiles($sourceRoot, '*', [System.IO.SearchOption]::AllDirectories)) {
            [void]$shipped.Add('.claude/' + ($file.Substring($sourceRoot.Length).TrimStart('\', '/') -replace '\\', '/'))
        }
    }
    foreach ($path in $ChangedPaths) {
        if ([regex]::IsMatch($path, '^[^/]*~[0-9]')) {
            $stops.Add($path)
            continue
        }
        $leaf = $path.Substring($path.LastIndexOf('/') + 1)
        if ($leaf.Equals('CLAUDE.md', [StringComparison]::OrdinalIgnoreCase) -or $leaf.Equals('CLAUDE.local.md', [StringComparison]::OrdinalIgnoreCase)) {
            $stops.Add($path)
            continue
        }
        if ($path.Equals('.mcp.json', [StringComparison]::OrdinalIgnoreCase)) {
            $stops.Add($path)
            continue
        }
        if ([regex]::IsMatch($path, '(^|/)CLAUDE~[0-9]+(\.[^/]*)?(/|$)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
            $stops.Add($path)
            continue
        }
        # A whole segment equal to .claude after the first, or the whole path
        # being that one segment. The root folder, .claude/ and more, is left
        # to the exemption below.
        if ([regex]::IsMatch($path, '^\.claude$|/\.claude(/|$)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
            $stops.Add($path)
            continue
        }
        $underClaude = $path.StartsWith('.claude/', [StringComparison]::OrdinalIgnoreCase)
        if (-not $underClaude) { continue }
        if ($path -ceq '.claude/engine.json') {
            if ($null -ne $script:engineHash) {
                $mark = Get-HeadEngineHash $WikiPath -Revision $Revision
                if ($mark.Read.TimedOut) {
                    return [pscustomobject]@{ Stops = @(); Failed = $mark.Read; What = 'git show origin/main:.claude/engine.json' }
                }
                if ($mark.Hash -eq $script:engineHash) { continue }
            }
        } elseif ($shipped.Contains($path)) {
            $fetched = Invoke-Git $WikiPath @('rev-parse', '-q', '--verify', "$Revision`:$path")
            if ($fetched.TimedOut -or ($fetched.ExitCode -ne 0 -and $fetched.ExitCode -ne 1)) {
                return [pscustomobject]@{ Stops = @(); Failed = $fetched; What = "git rev-parse origin/main:$(ConvertTo-LogText $path)" }
            }
            if ($fetched.ExitCode -eq 0) {
                $installed = Join-Path $sourceRoot ($path.Substring('.claude/'.Length) -replace '/', '\')
                $own = Invoke-Git $WikiPath @('hash-object', '--path', $path, '--', $installed)
                if ($own.TimedOut -or $own.ExitCode -ne 0) {
                    return [pscustomobject]@{ Stops = @(); Failed = $own; What = "git hash-object --path $(ConvertTo-LogText $path)" }
                }
                if ((Get-FirstLine $fetched.Stdout) -ceq (Get-FirstLine $own.Stdout)) { continue }
            }
        }
        $stops.Add($path)
    }
    return [pscustomobject]@{ Stops = @($stops); Failed = $null; What = '' }
}

# Step 3: the pull. Returns $true where the wiki's remaining steps may run.
function Invoke-PullStep {
    param($Wiki, [string]$WikiPath, [bool]$HasOrigin)
    $startedAt = [DateTime]::UtcNow

    # A merge left in progress, a killed pass's leftover or anyone's unfinished
    # merge, is aborted before anything else, so the pull starts from a clean
    # tree and the wiki's later steps never commit into it. Exit 1 is git's
    # quiet answer that no MERGE_HEAD exists. Any other end of the read, or an
    # abort that does not succeed, records the pull failed and skips the
    # wiki's remaining steps, so no step runs over a merge of unknown state.
    # Both calls run whatever the budget: the abort undoes a write, and the
    # read decides whether one is needed.
    $mergeHead = Invoke-Git $WikiPath @('rev-parse', '-q', '--verify', 'MERGE_HEAD') -Required
    if ($mergeHead.TimedOut -or ($mergeHead.ExitCode -ne 0 -and $mergeHead.ExitCode -ne 1)) {
        Add-Step $Wiki 'pull' 'failed' (Get-ChildNote $mergeHead 'git rev-parse MERGE_HEAD') $startedAt
        return $false
    }
    if ($mergeHead.ExitCode -eq 0) {
        $aborted = Invoke-Git $WikiPath @('merge', '--abort') -Required
        if ($aborted.TimedOut -or $aborted.ExitCode -ne 0) {
            Add-Step $Wiki 'pull' 'failed' (Get-ChildNote $aborted 'git merge --abort') $startedAt
            return $false
        }

        # The update step, finding this merge, deferred on it. The merge is gone
        # now, so that deferral no longer names the wiki's state and leaves the
        # slot; any other deferral there stays. The update's own step record
        # still reads deferred, since that is what the update did this pass.
        $state = Get-WikiState $Wiki.name
        if ($state.Contains('deferred') -and ($state['deferred'] -is [System.Collections.IDictionary]) -and ([string]$state['deferred']['reason'] -ceq 'merge in progress')) {
            $state.Remove('deferred')
        }
        Write-Log "$($Wiki.name) pull aborted a merge left in progress with $(ConvertTo-LogText (Get-FirstLine $mergeHead.Stdout))"
    }

    if (-not $HasOrigin) {
        Add-Step $Wiki 'pull' 'skipped' 'no origin' $startedAt
        return $true
    }
    $ssh = Get-SshBatchDecision $WikiPath
    if ($null -ne $ssh.Failed) {
        Add-Step $Wiki 'pull' 'failed' (Get-ChildNote $ssh.Failed 'git config --get core.sshCommand') $startedAt
        return $true
    }
    $fetched = Invoke-Git $WikiPath @('fetch', 'origin') -BatchSsh:($ssh.Allowed)
    if ($fetched.TimedOut -or $fetched.ExitCode -ne 0) {
        Add-Step $Wiki 'pull' 'failed' (Get-ChildNote $fetched 'git fetch origin') $startedAt
        return $true
    }

    # origin/main is resolved once to the fetched commit's id, and every read
    # and merge below names that id, so a fetch landing between them cannot
    # bring a commit the guard never read.
    $resolved = Invoke-Git $WikiPath @('rev-parse', '-q', '--verify', 'origin/main^{commit}')
    if ($resolved.TimedOut -or $resolved.ExitCode -ne 0) {
        Add-Step $Wiki 'pull' 'failed' (Get-ChildNote $resolved 'git rev-parse origin/main') $startedAt
        return $true
    }
    $fetchedId = Get-FirstLine $resolved.Stdout

    # What the merge would bring is read before any merge: the paths origin/main
    # changes against every merge base, as their union. A pulled change to the
    # wiki's guard rails would run as the account at the next step with no
    # reader. A change under .claude/ lands only where it is the installed
    # engine's own bytes, and one to a nested .claude folder, to a CLAUDE.md
    # or CLAUDE.local.md at any depth or to the root .mcp.json never lands;
    # otherwise nothing is merged and the wiki is stuck from this pass, as a
    # settings-file conflict leaves it, until a pull reads ran. Every base is
    # read, one diff each, because git builds a merge with several bases from
    # all of them, so a guard rail one base changed could be rolled back by a
    # merge whose paths a single-base read never listed; a path unchanged
    # against every base is unchanged against the base git builds, so the
    # union is a superset of what the merge changes. Renames are listed as a
    # deletion and an addition, so a guard rail renamed to an ordinary name
    # still lists the path it leaves. Exit 1 from merge-base is git's answer
    # that the histories share no commit, and is recorded failed with its
    # own note. A read that fails leaves the tree unchanged, so the visit
    # goes on over it as after a failed fetch. The base ids are git's own
    # text, read a line each. The paths are the remote's text and reach the
    # log, the status and a notice only through ConvertTo-LogText, as the
    # conflicted paths do.
    $bases = Invoke-Git $WikiPath @('merge-base', '--all', 'HEAD', $fetchedId)
    if ($bases.TimedOut -or ($bases.ExitCode -ne 0 -and $bases.ExitCode -ne 1)) {
        Add-Step $Wiki 'pull' 'failed' (Get-ChildNote $bases 'git merge-base --all HEAD origin/main') $startedAt
        return $true
    }
    if ($bases.ExitCode -eq 1) {
        Add-Step $Wiki 'pull' 'failed' 'git merge-base --all HEAD origin/main found no merge base' $startedAt
        return $true
    }
    $changedPaths = New-Object System.Collections.Generic.List[string]
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($baseLine in @(Get-Lines $bases.Stdout)) {
        $base = $baseLine.Trim()
        $changed = Invoke-Git $WikiPath @('diff', '--no-renames', '--name-only', '-z', $base, $fetchedId)
        if ($changed.TimedOut -or $changed.ExitCode -ne 0) {
            Add-Step $Wiki 'pull' 'failed' (Get-ChildNote $changed "git diff $base origin/main") $startedAt
            return $true
        }
        foreach ($path in @(($changed.Stdout -split "`0") | Where-Object { $_ -ne '' })) {
            if ($seen.Add($path)) { $changedPaths.Add($path) }
        }
    }
    $guard = Get-GuardRailStops $WikiPath $fetchedId @($changedPaths)
    if ($null -ne $guard.Failed) {
        Add-Step $Wiki 'pull' 'failed' (Get-ChildNote $guard.Failed $guard.What) $startedAt
        return $true
    }
    if ($guard.Stops.Count -gt 0) {
        $paths = @($guard.Stops | ForEach-Object { ConvertTo-LogText $_ })
        Write-Log "$($Wiki.name) pull would change $($paths -join ', '); a pulled change under .claude/ lands only as the installed engine's own bytes and one to a nested .claude folder, a CLAUDE.md, a CLAUDE.local.md or the root .mcp.json never lands, so no merge lands and the wiki is stuck until a session or a person brings its HEAD to hold the change or the other machine's engine is updated"
        Add-Step $Wiki 'pull' 'deferred' 'engine change' $startedAt $paths
        (Get-WikiState $Wiki.name)['deferred']['stuck'] = $true
        return $false
    }
    $before = Get-Head $WikiPath
    $fastForward = Invoke-Git $WikiPath @('merge', '--ff-only', $fetchedId)
    if ((-not $fastForward.TimedOut) -and $fastForward.ExitCode -eq 0) {
        $note = if ((Get-Head $WikiPath -Required) -eq $before) { 'up to date' } else { 'fast-forward' }
        Add-PullRan $Wiki $note $startedAt
        return $true
    }

    # The merge commits under the account's identity, so without one no merge
    # is started.
    if (-not (Test-GitIdentity $WikiPath)) {
        Add-Step $Wiki 'pull' 'failed' 'git identity unset' $startedAt
        return $true
    }
    # The message is git's own for a merge of origin/main into main, which a merge
    # named by commit id would otherwise replace with the id.
    $merged = Invoke-Git $WikiPath @('merge', '--no-edit', '-m', "Merge remote-tracking branch 'origin/main'", $fetchedId)
    if ((-not $merged.TimedOut) -and $merged.ExitCode -eq 0) {
        Add-PullRan $Wiki (Get-MergeNote 'merged' $before) $startedAt
        return $true
    }

    # From here a merge may be in progress. The calls that read its state and
    # the abort run whatever the budget; a call refused for budget aborts the
    # merge before the refusal reaches the step's record.
    try {
        # A merge that stopped on anything but conflicts is undone and recorded.
        $unmerged = Invoke-Git $WikiPath @('diff', '--name-only', '--diff-filter=U', '-z') -Required
        $rawPaths = @()
        if ((-not $unmerged.TimedOut) -and $unmerged.ExitCode -eq 0) {
            $rawPaths = @(($unmerged.Stdout -split "`0") | Where-Object { $_ -ne '' })
        }
        $paths = @($rawPaths | ForEach-Object { ConvertTo-LogText $_ })
        if ($paths.Count -eq 0) {
            $null = Invoke-Git $WikiPath @('merge', '--abort') -Required
            Add-Step $Wiki 'pull' 'failed' (Get-ChildNote $merged 'git merge origin/main') $startedAt
            return $true
        }

        # A wiki deferred on a conflict by 3 or more passes in a row is stuck:
        # its model run starts at most once a day, so a conflict no run can
        # join costs one run a day rather than one an hour, while the fetch and
        # the merge above still land a fix made upstream.
        $state = Get-WikiState $Wiki.name
        $passesBefore = Get-ConflictPasses $state
        $settingsConflict = $rawPaths -ccontains '.claude/settings.json'
        $heldUntil = $null
        if ($passesBefore -ge 3) {
            $lastRun = Get-LastMergeRunAt $state
            if ($null -ne $lastRun -and $lastRun -gt [DateTime]::UtcNow.AddHours(-24)) { $heldUntil = $lastRun.AddHours(24) }
        }
        if ($settingsConflict) {
            # A conflict on the wiki's settings file voids its deny list, so no
            # headless run may read the tree: the wiki is stuck from this pass.
            Write-Log "$($Wiki.name) pull conflicts on .claude/settings.json; no model run may attempt it, so the wiki is stuck until a session or a person resolves it"
        } elseif ($null -ne $heldUntil) {
            Write-Log "$($Wiki.name) pull conflicts on $($paths -join ', '); the wiki is stuck after $passesBefore passes, and its model run is held until $($heldUntil.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture))"
        } else {
            # The model run joins both sides. The merge is resolved only where
            # MERGE_HEAD is gone and HEAD moved; any other end state is aborted.
            # The run's start time is kept so a stuck wiki's next run waits a
            # day from it.
            Assert-ModelFloor
            Write-Log "$($Wiki.name) pull conflicts on $($paths -join ', '); running Merge"
            $runArguments = @('-Operation', 'Merge')
            if (-not [string]::IsNullOrEmpty($Claude)) { $runArguments += @('-Claude', $Claude) }
            $runStartedAt = [DateTime]::UtcNow
            $run = Invoke-WikiScript $WikiPath 'kb-run.ps1' $runArguments @{ 'KB_RUN_SECONDS' = [string][Math]::Max(1, (Get-RemainingSeconds)) } -Capture -Relay
            if (-not $run.Missing) {
                if (Test-LockHeld $run 'kb-run: another run holds the lock for ') {
                    Write-Log "$($Wiki.name) merge run's first output line reports the wiki's run lock held"
                }
                $state['lastMergeRunAt'] = $runStartedAt.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
            }
            $mergeHead = Invoke-Git $WikiPath @('rev-parse', '-q', '--verify', 'MERGE_HEAD') -Required
            $after = Invoke-Git $WikiPath @('rev-parse', '--verify', '-q', 'HEAD') -Required
            $moved = (-not $after.TimedOut) -and $after.ExitCode -eq 0 -and ((Get-FirstLine $after.Stdout) -ne $before)
            $resolved = (-not $run.Missing) -and (-not $mergeHead.TimedOut) -and ($mergeHead.ExitCode -ne 0) -and $moved
            if ($resolved) {
                Add-PullRan $Wiki (Get-MergeNote 'merged by model' $before) $startedAt
                return $true
            }
        }
    } catch [System.OperationCanceledException] {
        $null = Invoke-Git $WikiPath @('merge', '--abort') -Required
        throw
    }
    $null = Invoke-Git $WikiPath @('merge', '--abort') -Required

    # The deferral carries the count after this pass, and whether the wiki is
    # stuck after it, so the status says both without reading the rule.
    $state['conflictPasses'] = $passesBefore + 1
    Add-Step $Wiki 'pull' 'deferred' 'conflict' $startedAt $paths
    $state['deferred']['stuck'] = ($state['conflictPasses'] -ge 3) -or $settingsConflict
    return $false
}

# Step 4: the feeder.
function Invoke-FeedStep {
    param($Wiki, [string]$WikiPath)
    $startedAt = [DateTime]::UtcNow
    if (-not [System.IO.File]::Exists((Join-Path $WikiPath '.claude\feed.json'))) {
        Add-Step $Wiki 'feed' 'skipped' 'no feed.json' $startedAt
        return
    }
    $seconds = [Math]::Max(1, [Math]::Min(3000, (Get-RemainingSeconds)))
    $fed = Invoke-WikiScript $WikiPath 'feed-inbox.ps1' @() @{ 'FEED_INBOX_RUN_SECONDS' = [string]$seconds } -Capture -Relay
    if ($fed.Missing -or $fed.TimedOut -or $fed.ExitCode -ne 0) {
        Add-Step $Wiki 'feed' 'failed' (Get-ChildNote $fed 'feed-inbox.ps1') $startedAt
        return
    }
    if (Test-LockHeld $fed 'feed-inbox: another feed run holds the lock for ') {
        Add-Step $Wiki 'feed' 'skipped' 'run lock held' $startedAt
        return
    }
    Add-Step $Wiki 'feed' 'ran' $fed.Leftovers $startedAt
}

# Runs kb-run.ps1 for one operation with the remaining budget, and records it.
# Returns $true only where the operation ran, never where the wiki's run lock
# was held and the wrapper did nothing. The model-run floor refuses the run
# for budget before it starts.
function Invoke-RunStep {
    param($Wiki, [string]$WikiPath, [string]$Step, [string]$Operation, [DateTime]$StartedAt)
    $runArguments = @('-Operation', $Operation)
    if (-not [string]::IsNullOrEmpty($Claude)) { $runArguments += @('-Claude', $Claude) }
    Assert-ModelFloor
    $run = Invoke-WikiScript $WikiPath 'kb-run.ps1' $runArguments @{ 'KB_RUN_SECONDS' = [string][Math]::Max(1, (Get-RemainingSeconds)) } -Capture -Relay
    if ($run.Missing -or $run.TimedOut -or $run.ExitCode -ne 0) {
        $note = Get-ChildNote $run "kb-run.ps1 -Operation $Operation"
        Add-Step $Wiki $Step 'failed' $note $StartedAt
        return $false
    }
    if (Test-LockHeld $run 'kb-run: another run holds the lock for ') {
        Add-Step $Wiki $Step 'skipped' 'run lock held' $StartedAt
        return $false
    }
    Add-Step $Wiki $Step 'ran' $run.Leftovers $StartedAt
    return $true
}

# Step 5: ingest, only where the inbox holds a file.
function Invoke-IngestStep {
    param($Wiki, [string]$WikiPath)
    $startedAt = [DateTime]::UtcNow
    $inbox = Join-Path $WikiPath 'inbox'
    $files = @()
    if ([System.IO.Directory]::Exists($inbox)) {
        $files = @([System.IO.Directory]::GetFiles($inbox) | Where-Object { [System.IO.Path]::GetFileName($_) -ne '.gitkeep' })
    }
    if ($files.Count -eq 0) {
        Add-Step $Wiki 'ingest' 'skipped' 'inbox empty' $startedAt
        return
    }
    if (-not (Test-QuietTree $Wiki $WikiPath 'ingest' $startedAt)) { return }
    $null = Invoke-RunStep $Wiki $WikiPath 'ingest' 'Ingest' $startedAt
}

# The wiki's count of consecutive failed lints, from its state entry. The
# entry is read as untrusted: anything but a whole number reads as 0.
function Get-LintFailures {
    param($State)
    $failures = 0
    if ($State.Contains('lintFailures') -and [int]::TryParse([string]$State['lintFailures'], [System.Globalization.NumberStyles]::None, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$failures)) {
        return $failures
    }
    return 0
}

# The time the wiki's last failed lint run started, through Get-PastStateTime.
function Get-LastLintAttemptAt {
    param($State)
    return (Get-PastStateTime $State 'lastLintAttemptAt')
}

# Step 6: lint, only on the day it is due, and stamped only where the run
# made its own Lint: commit. The lint skill ends a run another writer went
# live in, at its first step or before its write pass, with exit 0 and no
# Lint: commit, keeping any Reconcile: commit it made, while a run that
# completes always commits under Lint:, a clean one included. So the stamp
# reads the subjects of the commits made after the HEAD read just before the
# run, and a moved HEAD alone stamps nothing. The subjects are only compared,
# never written to a note or the log.
#
# A lint that failed 3 or more times in a row is held, as a stuck wiki's merge
# run is: it starts no run until a day after the last failed run started, so a
# lint that cannot finish costs one run a day rather than one an hour. A run
# whose child did not exit 0, or that made no Lint: commit, is a failure; a
# lint that reached no verdict, live, lock held, refused for budget, skipped
# for a failed engine update or failed on a HEAD or log read, counts nothing.
function Invoke-LintStep {
    param($Wiki, [string]$WikiPath)
    $startedAt = [DateTime]::UtcNow
    $state = Get-WikiState $Wiki.name
    $last = [DateTime]::MinValue
    $stamped = $state.Contains('lastLintAt') -and ($state['lastLintAt'] -is [string]) -and
        [DateTime]::TryParseExact($state['lastLintAt'], 'o', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$last)
    if ($stamped -and $last.ToUniversalTime() -gt [DateTime]::UtcNow.AddDays(-7)) {
        Add-Step $Wiki 'lint' 'skipped' 'not due' $startedAt
        return
    }
    $failures = Get-LintFailures $state
    if ($failures -ge 3) {
        $lastAttempt = Get-LastLintAttemptAt $state
        if ($null -ne $lastAttempt -and $lastAttempt -gt [DateTime]::UtcNow.AddHours(-24)) {
            $heldUntil = $lastAttempt.AddHours(24)
            Write-Log "$($Wiki.name) lint has failed $failures times in a row, so its run is held until $($heldUntil.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture))"
            Add-Step $Wiki 'lint' 'skipped' 'held after 3 failed lints' $startedAt
            return
        }
    }
    if (-not (Test-QuietTree $Wiki $WikiPath 'lint' $startedAt)) { return }
    $headRead = Invoke-Git $WikiPath @('rev-parse', '--verify', '-q', 'HEAD') -Required
    if ($headRead.TimedOut -or $headRead.ExitCode -ne 0) {
        Add-Step $Wiki 'lint' 'failed' (Get-ChildNote $headRead 'git rev-parse HEAD') $startedAt
        return
    }
    $before = Get-FirstLine $headRead.Stdout
    $attemptedAt = [DateTime]::UtcNow.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    if (-not (Invoke-RunStep $Wiki $WikiPath 'lint' 'Lint' $startedAt)) {
        # The run step records failed for a child that did not exit 0, and
        # skipped for a held run lock, which reached no verdict.
        if ([string]$Wiki.steps['lint']['outcome'] -ceq 'failed') {
            $state['lintFailures'] = $failures + 1
            $state['lastLintAttemptAt'] = $attemptedAt
        }
        return
    }

    # The run recorded ran; a run with no Lint: commit, or whose commits
    # cannot be read, replaces that record.
    $logged = Invoke-Git $WikiPath @('log', "$before..HEAD", '--format=%s') -Required
    if ($logged.TimedOut -or $logged.ExitCode -ne 0) {
        Add-Step $Wiki 'lint' 'failed' (Get-ChildNote $logged 'git log') $startedAt
        return
    }
    $lintCommits = @(Get-Lines $logged.Stdout | Where-Object { $_.StartsWith('Lint:', [StringComparison]::Ordinal) })
    if ($lintCommits.Count -eq 0) {
        $state['lintFailures'] = $failures + 1
        $state['lastLintAttemptAt'] = $attemptedAt
        Add-Step $Wiki 'lint' 'skipped' 'no Lint: commit' $startedAt
        return
    }
    $state['lastLintAt'] = [DateTime]::UtcNow.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    $state.Remove('lintFailures')
    $state.Remove('lastLintAttemptAt')
}

# Step 7: the push.
function Invoke-PushStep {
    param($Wiki, [string]$WikiPath, [bool]$HasOrigin)
    $startedAt = [DateTime]::UtcNow
    if (-not $HasOrigin) {
        Add-Step $Wiki 'push' 'skipped' 'no origin' $startedAt
        return
    }
    $upstream = Invoke-Git $WikiPath @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
    $pushArguments = @('push', '-u', 'origin', 'HEAD')
    if ((-not $upstream.TimedOut) -and $upstream.ExitCode -eq 0) {
        $unpushed = Invoke-WikiScript $WikiPath 'kb-status.ps1' @('-What', 'Unpushed') -Capture
        if ($unpushed.Missing -or $unpushed.TimedOut -or $unpushed.ExitCode -ne 0) {
            Add-Step $Wiki 'push' 'failed' (Get-ChildNote $unpushed 'kb-status.ps1 -What Unpushed') $startedAt
            return
        }
        if (@(Get-Lines $unpushed.Stdout).Count -eq 0) {
            Add-Step $Wiki 'push' 'skipped' 'nothing to push' $startedAt
            return
        }
        $pushArguments = @('push', 'origin', 'HEAD')
    }
    $ssh = Get-SshBatchDecision $WikiPath
    if ($null -ne $ssh.Failed) {
        Add-Step $Wiki 'push' 'failed' (Get-ChildNote $ssh.Failed 'git config --get core.sshCommand') $startedAt
        return
    }
    $pushed = Invoke-Git $WikiPath $pushArguments -BatchSsh:($ssh.Allowed)
    if ($pushed.TimedOut -or $pushed.ExitCode -ne 0) {
        Add-Step $Wiki 'push' 'failed' (Get-ChildNote $pushed 'git push') $startedAt
        return
    }
    Add-Step $Wiki 'push' 'ran' '' $startedAt
}

# Runs one step and returns what it returns. Where a child the step needs was
# refused for budget, the step is recorded skipped: budget and $null returned,
# so the pass never starts a child only to stop it and never records a failure
# for a step it did not run.
function Invoke-Budgeted {
    param($Wiki, [string]$Step, [scriptblock]$Body)
    $startedAt = [DateTime]::UtcNow
    try {
        return (& $Body)
    } catch [System.OperationCanceledException] {
        Add-Step $Wiki $Step 'skipped' 'budget' $startedAt
        return $null
    }
}

# The time of the wiki's last notice, from its state entry, or $null where the
# entry holds none it can read.
function Get-LastNoticeAt {
    param($State)
    $last = [DateTime]::MinValue
    if ($State.Contains('lastNoticeAt') -and ($State['lastNoticeAt'] -is [string]) -and
        [DateTime]::TryParseExact($State['lastNoticeAt'], 'o', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$last)) {
        return $last.ToUniversalTime()
    }
    return $null
}

# Text a remote can steer, such as a conflicted path, with each character of
# the line-unsafe class kb-registry.ps1 defines in its $unsafeText replaced by
# a hyphen, so a notice stays one line that reads as written.
function ConvertTo-NoticeText {
    param([string]$Text)
    return [regex]::Replace([string]$Text, $script:unsafeText, '-')
}

# The conflicted paths as a notice's paths field carries them: the first
# $noticePathLimit, each stripped. The caller wraps the result in @() so one
# path or none still makes an array.
function ConvertTo-NoticePaths {
    param([object[]]$Paths)
    $kept = @($Paths | Select-Object -First $script:noticePathLimit)
    return @($kept | ForEach-Object { ConvertTo-NoticeText ([string]$_) })
}

# The conflicted paths as a notice's text counts them: "1 path", "N paths", or
# "paths the walker did not record" where the deferral holds none. The text
# carries only this count, so a steered name never reaches the sentence.
function Format-NoticePathCount {
    param([object[]]$Paths)
    $count = @($Paths).Count
    if ($count -eq 0) { return 'paths the walker did not record' }
    if ($count -eq 1) { return '1 path' }
    return "$count paths"
}

# Collects the notice this visit's pull verdict earns, and keeps the wiki's
# noticedStuck and lastNoticeAt in step with it. Only a pull that ran or was
# deferred anew speaks; a pull refused for budget, failed or skipped
# leaves the wiki as it was. A pull that ran clears a noticed wiki. A deferred
# pull earns a stuck line where the wiki is stuck and has no notice yet, and a
# still-stuck line where its last notice is 24 hours or more old. Each notice
# carries the two fields as they stood before this visit changed them, so
# Write-Notices can put them back where the append fails.
function Add-VisitNotice {
    param($Wiki, $State, [string]$PullOutcome)
    $noticed = $State.Contains('noticedStuck') -and ($State['noticedStuck'] -eq $true)
    $prior = [ordered]@{}
    foreach ($field in @('noticedStuck', 'lastNoticeAt')) {
        if ($State.Contains($field)) { $prior[$field] = $State[$field] }
    }
    if ($PullOutcome -ceq 'ran') {
        if (-not $noticed) { return }
        $State.Remove('noticedStuck')
        $State.Remove('lastNoticeAt')
        $note = ConvertTo-NoticeText ([string]$Wiki.steps['pull']['note'])
        $text = "$($Wiki.name) is no longer stuck: its pull landed."
        if ($note -ne '') { $text = "$($Wiki.name) is no longer stuck: its pull landed, $note." }
        $script:notices.Add([pscustomobject]@{ Name = $Wiki.name; Kind = 'cleared'; Text = $text; Paths = $null; State = $State; Prior = $prior })
        return
    }
    if ($PullOutcome -cne 'deferred') { return }
    if (-not ($State.Contains('deferred') -and $State['deferred'] -is [System.Collections.IDictionary])) { return }
    $deferral = $State['deferred']
    $paths = @()
    if ($deferral.Contains('paths')) { $paths = @($deferral['paths']) }
    $passes = Get-ConflictPasses $State
    $now = [DateTime]::UtcNow
    $pathCount = Format-NoticePathCount $paths
    $engineChange = ([string]$deferral['reason'] -ceq 'engine change')
    if (-not $noticed) {
        if (-not ($deferral.Contains('stuck') -and $deferral['stuck'] -eq $true)) { return }
        $kind = 'stuck'
        if ($engineChange) {
            # The stop lands nothing, so the text counts the pulled paths and
            # names the two ways it clears, with no pass count, since the
            # stop keeps none.
            $text = "$($Wiki.name) is stuck: its pull from origin would change $pathCount among .claude/, any nested .claude folder, any CLAUDE.md or CLAUDE.local.md, and the root .mcp.json, which the walker lands only as the installed engine's own bytes under the root .claude/ and never elsewhere; a session or a person must bring the wiki's HEAD to hold the change or update the other machine's engine, and the walker resumes once a pull lands."
        } elseif ($paths -ccontains '.claude/settings.json') {
            $text = "$($Wiki.name) is stuck: its pull from origin conflicts on .claude/settings.json, which no headless run may attempt; a session or a person must resolve the conflict in the wiki, and the walker resumes once a pull lands."
        } else {
            $text = "$($Wiki.name) is stuck: its pull from origin has conflicted on $pathCount for $passes passes in a row and the model merge did not join them; the walker fetches every hour and retries the merge once a day; a session must resolve the conflict in the wiki."
        }
    } else {
        $last = Get-LastNoticeAt $State
        if ($null -ne $last -and $last -gt $now.AddHours(-$script:noticeIntervalHours)) { return }
        $kind = 'still'
        if ($engineChange) {
            $text = "$($Wiki.name) is still stuck: its pull from origin would change $pathCount among .claude/, any nested .claude folder, any CLAUDE.md or CLAUDE.local.md, and the root .mcp.json; a session or a person must bring the wiki's HEAD to hold the change or update the other machine's engine."
        } else {
            $text = "$($Wiki.name) is still stuck after $passes passes: its pull from origin conflicts on $pathCount; a session must resolve the conflict in the wiki."
        }
    }
    $State['noticedStuck'] = $true
    $State['lastNoticeAt'] = $now.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    $script:notices.Add([pscustomobject]@{ Name = $Wiki.name; Kind = $kind; Text = $text; Paths = @(ConvertTo-NoticePaths $paths); State = $State; Prior = $prior })
}

# One wiki's visit: the trust gate, then the six steps in order.
function Invoke-Visit {
    param($Wiki)
    $wikiPath = $Wiki.path
    $state = Get-WikiState $Wiki.name
    if (-not $script:trusted.Contains((ConvertTo-ComparablePath $wikiPath))) {
        $Wiki.result = 'untrusted'
        Write-Log "$($Wiki.name) untrusted; skipped"
        return
    }
    if (-not [System.IO.Directory]::Exists($wikiPath)) {
        $Wiki.result = 'visited'
        Add-Step $Wiki 'update' 'failed' 'the wiki folder does not exist' ([DateTime]::UtcNow)
        return
    }
    $Wiki.result = 'visited'

    # This pass's steps record their own deferrals. A standing conflict from an
    # earlier pass is cleared only where this pass's pull reaches its own
    # verdict, ran or deferred anew; where it does not, as when it is refused
    # for budget or fails, the earlier deferral and its reason stay.
    $prior = $null
    if ($state.Contains('deferred')) { $prior = $state['deferred'] }
    $state.Remove('deferred')
    try {
        # An update that failed after it began writing leaves its files in the
        # tree uncommitted, so this pass starts no ingest or lint model run
        # over them; the other steps run as written.
        $updated = Invoke-Budgeted $Wiki 'update' { Invoke-UpdateStep $Wiki $wikiPath }
        $updateBroken = ($true -eq $updated)

        # Whether origin exists is read inside the pull, so a refusal there is
        # the pull's; the push reads it again where the pull could not.
        $pulled = Invoke-Budgeted $Wiki 'pull' {
            $origin = Test-Origin $wikiPath
            [pscustomobject]@{ HasOrigin = $origin; Proceed = (Invoke-PullStep $Wiki $wikiPath $origin) }
        }

        # A pull that ends the visit early is a deferred conflict, an
        # engine-change stop, a failed merge abort, or a pull refused for
        # budget. A merge run refused at the model-run floor leaves the tree
        # diverged from origin, so no later step may commit or push over it,
        # and a refusal before the merge run leaves every later step the same
        # or a smaller budget. Only a deferral makes the wiki's result
        # deferred; a refusal reaches no verdict, so the result stays visited.
        if ($null -ne $pulled -and -not $pulled.Proceed) {
            if ($Wiki.steps.Contains('pull') -and ([string]$Wiki.steps['pull']['outcome'] -ceq 'deferred')) { $Wiki.result = 'deferred' }
            return
        }
        if ($null -eq $pulled -and $Wiki.steps.Contains('pull') -and ([string]$Wiki.steps['pull']['outcome'] -ceq 'skipped') -and ([string]$Wiki.steps['pull']['note'] -ceq 'budget')) {
            return
        }
        $null = Invoke-Budgeted $Wiki 'feed' { Invoke-FeedStep $Wiki $wikiPath }
        if ($updateBroken) {
            Add-Step $Wiki 'ingest' 'skipped' 'engine update failed' ([DateTime]::UtcNow)
            Add-Step $Wiki 'lint' 'skipped' 'engine update failed' ([DateTime]::UtcNow)
        } else {
            $null = Invoke-Budgeted $Wiki 'ingest' { Invoke-IngestStep $Wiki $wikiPath }
            $null = Invoke-Budgeted $Wiki 'lint' { Invoke-LintStep $Wiki $wikiPath }
        }
        $null = Invoke-Budgeted $Wiki 'push' {
            $origin = if ($null -ne $pulled) { $pulled.HasOrigin } else { Test-Origin $wikiPath }
            Invoke-PushStep $Wiki $wikiPath $origin
        }
    } finally {
        $pullOutcome = $null
        if ($Wiki.steps.Contains('pull')) { $pullOutcome = [string]$Wiki.steps['pull']['outcome'] }
        $standingConflict = ($prior -is [System.Collections.IDictionary]) -and (([string]$prior['reason'] -ceq 'conflict') -or ([string]$prior['reason'] -ceq 'engine change'))

        # The state holds one deferral per wiki. Where this pass's update,
        # ingest or lint recorded its own, live or merge in progress, and a
        # standing conflict or engine-change stop is carried, the pull's
        # deferral takes the slot: that step's deferral is found again by the
        # same step next pass, while the pull's must stay named until a pull
        # resolves it.
        if ($standingConflict -and $pullOutcome -cne 'ran' -and $pullOutcome -cne 'deferred') {
            $state['deferred'] = $prior
        }
        Add-VisitNotice $Wiki $state $pullOutcome
    }
}

# Writes a JSON document whole: to a temporary file beside its target, then
# moved over it, so a reader never sees a partial file.
function Write-JsonWhole {
    param([string]$TargetPath, $Document)
    $tempPath = "$TargetPath.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        [System.IO.File]::WriteAllText($tempPath, ((ConvertTo-Json -InputObject $Document -Depth 8) + "`n"), $script:utf8NoBom)
        [System.IO.File]::Move($tempPath, $TargetPath, $true)
    } finally {
        if ([System.IO.File]::Exists($tempPath)) { try { [System.IO.File]::Delete($tempPath) } catch { } }
    }
}

# Appends the pass's collected notices to the notices file, one JSON line
# each. A file over 1 MB is first renamed to walk-notices.jsonl.1 over any
# earlier one; a rename that fails is logged and the lines go to the current
# file. A file whose last byte is not a line feed, as a killed append leaves
# it, gets one before the new lines. Where the append fails it is logged, and
# each noticed wiki's noticedStuck and lastNoticeAt go back to what they were
# before this pass, so the state written next makes the next pass compare
# again and write the line then.
function Write-Notices {
    if ($script:notices.Count -eq 0) { return }
    try {
        if ([System.IO.File]::Exists($script:noticesPath) -and (Get-Item -LiteralPath $script:noticesPath).Length -gt $script:noticesMaxBytes) {
            [System.IO.File]::Move($script:noticesPath, "$script:noticesPath.1", $true)
        }
    } catch {
        Write-Log "the notices file could not be rotated: $(Get-FirstLine (Get-InnerError $_.Exception).Message)"
    }
    try {
        $at = [string]$script:status.finishedAt
        $lines = New-Object System.Collections.Generic.List[string]
        foreach ($notice in $script:notices) {
            $record = [ordered]@{ id = "$($notice.Name):$($notice.Kind):$at"; text = $notice.Text }
            if ($null -ne $notice.Paths) { $record['paths'] = @($notice.Paths) }
            $record['source'] = 'wiki-walk'
            $record['at'] = $at
            $lines.Add((ConvertTo-Json -InputObject $record -Compress))
        }
        $stream = [System.IO.FileStream]::new($script:noticesPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::Read)
        try {
            $prefix = ''
            if ($stream.Length -gt 0) {
                $null = $stream.Seek(-1, [System.IO.SeekOrigin]::End)
                if ($stream.ReadByte() -ne 10) { $prefix = "`n" }
            }
            $null = $stream.Seek(0, [System.IO.SeekOrigin]::End)
            $bytes = $script:utf8NoBom.GetBytes($prefix + ($lines -join "`n") + "`n")
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Flush($true)
        } finally {
            $stream.Dispose()
        }
    } catch {
        Write-Log "the notices file could not be written, so this pass's notices are left for the next pass: $(Get-FirstLine (Get-InnerError $_.Exception).Message)"
        foreach ($notice in $script:notices) {
            foreach ($field in @('noticedStuck', 'lastNoticeAt')) {
                if ($notice.Prior.Contains($field)) {
                    $notice.State[$field] = $notice.Prior[$field]
                } else {
                    $notice.State.Remove($field)
                }
            }
        }
    }
}

# Writes the state whole through Write-JsonWhole: the cursor and every wiki's
# entry. A write that fails is logged and the pass goes on. With
# -BeforeNotices, as after each visit, each wiki whose notice this pass has
# collected carries noticedStuck and lastNoticeAt as they stood before the
# pass, the notice's Prior: its line reaches the notices file only at the
# pass's end, and a state holding the new fields before that append would lose
# the notice to a kill between them.
function Write-StateFile {
    param([switch]$BeforeNotices)
    $wikis = $script:stateWikis
    if ($BeforeNotices -and $script:notices.Count -gt 0) {
        $wikis = [ordered]@{}
        foreach ($name in @($script:stateWikis.Keys)) { $wikis[[string]$name] = $script:stateWikis[$name] }
        foreach ($notice in $script:notices) {
            $entry = [ordered]@{}
            foreach ($field in @($notice.State.Keys)) { $entry[[string]$field] = $notice.State[$field] }
            foreach ($field in @('noticedStuck', 'lastNoticeAt')) {
                if ($notice.Prior.Contains($field)) {
                    $entry[$field] = $notice.Prior[$field]
                } else {
                    $entry.Remove($field)
                }
            }
            $wikis[[string]$notice.Name] = $entry
        }
    }
    try {
        Write-JsonWhole $script:statePath ([ordered]@{ cursor = $script:cursor; wikis = $wikis })
    } catch {
        Write-Log "the state file could not be written: $(Get-FirstLine (Get-InnerError $_.Exception).Message)"
    }
}

# Writes the notices, then the state and the status, the pass-level notes
# joined into the status's note, and stops the pass with exit 1 where the
# status cannot be written. The notices go first so the state records a
# notice's fields only once its line is in the file.
function Write-PassFiles {
    $script:status.finishedAt = [DateTime]::UtcNow.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    $deferred = New-Object System.Collections.Generic.List[object]
    foreach ($wiki in $script:status.wikis) {
        $state = Get-WikiState $wiki.name
        if ($state.Contains('deferred') -and $state['deferred'] -is [System.Collections.IDictionary]) {
            $entry = [ordered]@{ name = $wiki.name; reason = [string]$state['deferred']['reason'] }
            if ($state['deferred'].Contains('paths')) { $entry['paths'] = @($state['deferred']['paths']) }
            # A conflict carries its pass count; an engine-change stop keeps
            # none. Both say whether the wiki is stuck, which the session hook
            # prints as its stuck suffix.
            if ($entry['reason'] -ceq 'conflict') { $entry['passes'] = Get-ConflictPasses $state }
            if (($entry['reason'] -ceq 'conflict') -or ($entry['reason'] -ceq 'engine change')) {
                $entry['stuck'] = ($state['deferred'].Contains('stuck') -and $state['deferred']['stuck'] -eq $true)
            }
            $deferred.Add($entry)
        }
    }
    $script:status.deferred = $deferred
    if ($script:passNotes.Count -gt 0) {
        $notes = @($script:passNotes)
        if ($script:status.Contains('note')) { $notes = @($script:status['note']) + $notes }
        $script:status['note'] = $notes -join '; '
    }
    Write-Notices
    Write-StateFile
    try {
        Write-JsonWhole $script:statusPath $script:status
    } catch {
        Stop-WithReason "writing the status $script:statusPath failed: $(Get-FirstLine (Get-InnerError $_.Exception).Message)"
    }
}

$script:engineRoot = $PSScriptRoot
$script:psExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
$script:utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:job = [IntPtr]::Zero
# The fewest seconds of pass budget a child is started with, which is also how
# far past the budget the required calls' shared deadline lies, the seconds a
# captured child's streams are drained after it ends, and the http stall bound
# every git call carries. The pass's own reads of the list and the engine are
# required calls, so a budget under the floor still writes a status.
$script:childFloorSeconds = 60
# The fewest seconds of pass budget a kb-run.ps1 child, a model run, is started
# with. KB_WALK_MODEL_FLOOR_SECONDS replaces it.
$script:modelFloorSeconds = 600
# The fewest seconds a required call is waited for, however far past the
# required calls' shared deadline it starts.
$script:requiredFloorSeconds = 15
$script:streamDrainSeconds = 5
# Pass-level notes the status carries in its note, such as a lapse of the
# kill-on-close job.
$script:passNotes = New-Object System.Collections.Generic.List[string]
$script:gitStallBound = @('-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=60')
$script:logPath = $null
# The notices file's size bound in bytes, the hours between a stuck wiki's
# repeated lines, the most conflicted paths one line's paths field holds, and
# the lines the pass's visits have collected for it.
$script:noticesMaxBytes = 1MB
$script:noticeIntervalHours = 24
$script:noticePathLimit = 10
$script:notices = New-Object System.Collections.Generic.List[object]
# Text a notice may not carry, copied from kb-registry.ps1's $unsafeText:
# control characters, the basic plane's format characters, the tag characters,
# and line and paragraph separators. tests/Test-UnsafeTextParity.ps1 checks the
# copy.
$script:unsafeText = '[\p{Cc}\p{Cf}\u2028\u2029]|\uDB40[\uDC00-\uDC7F]'
$whatIf = [bool]$WhatIfPreference

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    Stop-WithReason 'LOCALAPPDATA is not set, so the walker''s folder is unknown.'
}
$walkDir = Join-Path $env:LOCALAPPDATA 'llm-wiki'
$lockPath = Join-Path $walkDir 'walk.lock'
$script:statePath = Join-Path $walkDir 'walk-state.json'
$script:statusPath = Join-Path $walkDir 'walk-status.json'
$walkLog = Join-Path $walkDir 'walk.log'
$script:noticesPath = Join-Path $walkDir 'walk-notices.jsonl'

$lock = $null
$script:hooksDir = $null
try {
    # One pass per account at a time. The lock is a file held open with no
    # sharing, so the operating system releases it when this process ends,
    # however it ends. File.Open makes a handle no child process inherits.
    if (-not $whatIf) {
        if (-not [System.IO.Directory]::Exists($walkDir)) { [void][System.IO.Directory]::CreateDirectory($walkDir) }
        try {
            $lock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        } catch {
            $lockError = Get-InnerError $_.Exception
            # 32 is ERROR_SHARING_VIOLATION: another pass holds the file open.
            if ($lockError -is [System.IO.IOException] -and ($lockError.HResult -band 0xFFFF) -eq 32) {
                Write-Output "kb-walk: another pass holds the lock $lockPath; this pass did nothing."
                exit 0
            }
            Stop-WithReason "taking the lock $lockPath failed: $(Get-FirstLine $lockError.Message)"
        }
    }

    # The pass budget, 300 seconds inside the 2-hour execution time limit of
    # the scheduled task that runs the walker.
    $budgetSeconds = 6900
    $budgetOverride = $env:KB_WALK_SECONDS
    if (-not [string]::IsNullOrEmpty($budgetOverride)) {
        if ($budgetOverride -notmatch '^[1-9][0-9]{0,4}$') {
            Stop-WithReason 'KB_WALK_SECONDS must be a whole number of seconds from 1 to 99999.'
        }
        $budgetSeconds = [int]$budgetOverride
    }
    $modelFloorOverride = $env:KB_WALK_MODEL_FLOOR_SECONDS
    if (-not [string]::IsNullOrEmpty($modelFloorOverride)) {
        if ($modelFloorOverride -notmatch '^[1-9][0-9]{0,4}$') {
            Stop-WithReason 'KB_WALK_MODEL_FLOOR_SECONDS must be a whole number of seconds from 1 to 99999.'
        }
        $script:modelFloorSeconds = [int]$modelFloorOverride
    }
    $passStartedAt = [DateTime]::UtcNow
    $script:deadline = $passStartedAt.AddSeconds($budgetSeconds)
    $script:requiredDeadline = $script:deadline.AddSeconds($script:childFloorSeconds)

    # The native helpers every child needs. Without them no child can be read,
    # so the list cannot be either.
    try {
        if (-not ('KbWalk.ChildStreams' -as [type])) {
            Add-Type -TypeDefinition $nativeSource -Language CSharp
        }
    } catch {
        Stop-WithReason "reading the wiki list failed: compiling the walker's child helpers failed: $(Get-FirstLine (Get-InnerError $_.Exception).Message)"
    }

    # The list, read through the registry so its shape is the registry's.
    $registry = Join-Path $script:engineRoot 'kb-registry.ps1'
    $listed = Invoke-Child $script:psExe @('-NoProfile', '-File', $registry, 'List', '-Json') $script:engineRoot @{} -Capture -Required
    if ($listed.TimedOut -or $listed.ExitCode -ne 0) {
        Stop-WithReason "reading the wiki list failed: $(Get-FirstLine $listed.Stderr)"
    }
    $wikis = @()
    try {
        $wikis = @($listed.Stdout | ConvertFrom-Json -AsHashtable)
    } catch {
        Stop-WithReason "reading the wiki list failed: $(Get-FirstLine (Get-InnerError $_.Exception).Message)"
    }

    # The state: the cursor and the per-wiki entries. A file off its shape
    # starts the pass fresh, with one log line.
    $script:cursor = $null
    $script:stateWikis = [ordered]@{}
    $stateNote = $null
    if ([System.IO.File]::Exists($script:statePath)) {
        try {
            $state = Read-JsonAsDictionary $script:statePath
            if ($state -is [System.Collections.IDictionary]) {
                if ($state.Contains('cursor') -and $state['cursor'] -is [string]) { $script:cursor = $state['cursor'] }
                if ($state.Contains('wikis') -and $state['wikis'] -is [System.Collections.IDictionary]) {
                    foreach ($key in @($state['wikis'].Keys)) {
                        if ($state['wikis'][$key] -is [System.Collections.IDictionary]) {
                            $entry = [ordered]@{}
                            foreach ($field in @($state['wikis'][$key].Keys)) {
                                # ConvertFrom-Json turns ISO 8601 text into a DateTime; the
                                # entry keeps the stamp as the text the walker wrote.
                                $value = $state['wikis'][$key][$field]
                                if ($value -is [DateTime]) { $value = $value.ToUniversalTime().ToString('o', [System.Globalization.CultureInfo]::InvariantCulture) }
                                $entry[$field] = $value
                            }
                            $script:stateWikis[[string]$key] = $entry
                        }
                    }
                }
            }
        } catch {
            $stateNote = "the state file could not be read and the pass starts fresh: $(Get-FirstLine (Get-InnerError $_.Exception).Message)"
        }
    }

    # The visit order: list order, starting after the cursor.
    $order = New-Object System.Collections.Generic.List[object]
    $startIndex = 0
    if ($null -ne $script:cursor) {
        for ($i = 0; $i -lt $wikis.Count; $i++) {
            if ([string]::Equals([string]$wikis[$i]['name'], $script:cursor, [StringComparison]::OrdinalIgnoreCase)) { $startIndex = $i + 1; break }
        }
    }
    for ($i = 0; $i -lt $wikis.Count; $i++) {
        $order.Add($wikis[($startIndex + $i) % $wikis.Count])
    }

    if ($whatIf) {
        foreach ($wiki in $order) { Write-Output "kb-walk: would visit $($wiki['name']) at $($wiki['path'])" }
        exit 0
    }

    # Every git call runs with hooks pointed at this folder, made fresh and
    # empty for the pass. It sits beside the pass files, so a pass that is
    # killed leaves nothing elsewhere. It is made only past the -WhatIf exit,
    # since -WhatIf writes nothing on disk, and no git call runs before it.
    $script:hooksDir = Join-Path $walkDir 'no-hooks'
    if ([System.IO.Directory]::Exists($script:hooksDir)) { [System.IO.Directory]::Delete($script:hooksDir, $true) }
    [void][System.IO.Directory]::CreateDirectory($script:hooksDir)

    # The log, rotated at 5 MB before the pass writes its block.
    if ([System.IO.File]::Exists($walkLog) -and (Get-Item -LiteralPath $walkLog).Length -gt 5MB) {
        [System.IO.File]::Move($walkLog, "$walkLog.1", $true)
    }
    $script:logPath = $walkLog

    $script:job = New-KillOnCloseJob
    $script:engineHash = $null
    $hashed = Invoke-Child $script:psExe @('-NoProfile', '-File', (Join-Path $script:engineRoot 'new-kb.ps1'), '-PrintEngineHash') $script:engineRoot @{} -Capture -Required
    $hashLines = @(Get-Lines $hashed.Stdout)
    if ((-not $hashed.TimedOut) -and $hashed.ExitCode -eq 0 -and $hashLines.Count -eq 1 -and $hashLines[0] -match '^[0-9a-f]{64}$') {
        $script:engineHash = $hashLines[0]
    }

    $script:status = [ordered]@{
        startedAt  = $passStartedAt.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
        finishedAt = $null
        engineHash = $script:engineHash
        wikis      = New-Object System.Collections.Generic.List[object]
        deferred   = @()
        failures   = New-Object System.Collections.Generic.List[object]
    }
    $hash8 = if ($null -ne $script:engineHash) { $script:engineHash.Substring(0, 8) } else { 'unknown' }
    Write-Log "=== pass started $($script:status.startedAt) engine $hash8 budget $($budgetSeconds)s ==="
    if ($null -ne $stateNote) { Write-Log $stateNote }
    if ($null -eq $script:engineHash) { Write-Log "the engine hash could not be read: $(Get-FirstLine $hashed.Stderr)" }

    if ($order.Count -eq 0) {
        $script:status['note'] = 'no wikis listed'
        Write-Log 'no wikis listed'
        Write-PassFiles
        exit 0
    }

    # The trust file, read once. The wikis whose path holds
    # hasTrustDialogAccepted true are the ones a headless run can write in.
    $script:trusted = [System.Collections.Generic.HashSet[string]]::new()
    $claudeConfig = Join-Path $env:USERPROFILE '.claude.json'
    try {
        if ([System.IO.File]::Exists($claudeConfig)) {
            $config = Read-JsonAsDictionary $claudeConfig
            if ($config -is [System.Collections.IDictionary] -and $config.Contains('projects') -and $config['projects'] -is [System.Collections.IDictionary]) {
                foreach ($key in @($config['projects'].Keys)) {
                    $entry = $config['projects'][$key]
                    if ($entry -is [System.Collections.IDictionary] -and $entry.Contains('hasTrustDialogAccepted') -and $entry['hasTrustDialogAccepted'] -eq $true) {
                        [void]$script:trusted.Add((ConvertTo-ComparablePath ([string]$key)))
                    }
                }
            }
        } else {
            Write-Log "no $claudeConfig; every wiki is untrusted"
        }
    } catch {
        Write-Log "reading $claudeConfig failed, so every wiki is untrusted: $(Get-FirstLine (Get-InnerError $_.Exception).Message)"
    }

    foreach ($member in $order) {
        $wiki = [ordered]@{ name = [string]$member['name']; path = [string]$member['path']; result = $null; steps = [ordered]@{} }
        $script:status.wikis.Add($wiki)
        if ((Get-RemainingSeconds) -lt 120) {
            $wiki.result = 'skipped: budget'
            Write-Log "$($wiki.name) skipped: budget"
            continue
        }
        $visitStartedAt = [DateTime]::UtcNow
        try {
            Invoke-Visit $wiki
        } catch {
            $wiki.result = 'visited'
            Add-Step $wiki 'visit' 'failed' (ConvertTo-LogText (Get-FirstLine (Get-InnerError $_.Exception).Message)) $visitStartedAt
        }
        $script:cursor = $wiki.name
        # The state is written after every visit, so a pass cut short keeps
        # each visited wiki's cursor, lint stamp and deferral.
        Write-StateFile -BeforeNotices
        Write-Log "$($wiki.name) $($wiki.result) ($([Math]::Round(([DateTime]::UtcNow - $visitStartedAt).TotalSeconds, 1))s)"
    }

    Write-PassFiles
    Write-Log "=== pass finished $($script:status.finishedAt) ==="
    exit 0
} finally {
    # Closing the job's handle ends every process still in it, so no child
    # outlives the pass, before the lock is released.
    if ($script:job -ne [IntPtr]::Zero) { [KbWalk.JobObject]::Close($script:job) }
    if ($null -ne $lock) { $lock.Dispose() }
    if ($null -ne $script:hooksDir -and [System.IO.Directory]::Exists($script:hooksDir)) {
        try { [System.IO.Directory]::Delete($script:hooksDir, $true) } catch { }
    }
}
