#Requires -Version 5.1
<#
.SYNOPSIS
Runs one headless ingest or lint in a knowledge base while holding the knowledge
base's run lock, so two runs that take the lock never overlap.

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

With the lock held, the wrapper runs
    claude -p "Use the wiki-ingest skill." --model sonnet --permission-mode default
for Ingest, or the same line naming wiki-lint for Lint, with the KB root as the
working directory. The argument line is fixed text; no value a caller supplies
is placed in it, so a claude.cmd that forwards its arguments cannot be handed a
second command. The child inherits the wrapper's stdout and stderr, so a
caller's capture of either stream reads what claude wrote. The wrapper exits
with the child's exit code.

A run holds a budget of 6900 seconds from the child's start, 300 seconds under
the 2-hour execution time limit register-task.ps1 gives the Ingest and Lint
tasks. A scheduler limit on the wrapper's process would end only the wrapper,
leaving claude running with the lock released, so the wrapper bounds the child
itself. The 300 seconds of margin cover stopping the child. A child past the
budget has its whole process tree stopped, and the wrapper exits 1 with one line
on stderr. The environment variable KB_RUN_SECONDS replaces the budget, as a
whole number of seconds from 1 to 99999, so a test can drive the stop quickly.

With -WhatIf the wrapper takes no lock and runs nothing. It still checks
KB_RUN_SECONDS and resolves claude, so either failure exits 1 as on a real run.
Otherwise it prints one line on stdout naming the command it would run and the
working directory, and exits 0.

The wrapper reads no inbox, no skill and no git. Any failure the wrapper itself
detects exits 1 with one line on stderr.

.PARAMETER Operation
The skill to run: Ingest or Lint.

.PARAMETER Claude
The claude executable to run, as a path. Without it, the first application
named claude on PATH runs, and a PATH holding none stops the run.

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-run.ps1 -Operation Ingest

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-run.ps1 -Operation Lint -Claude "C:\Users\eleos\.local\bin\claude.exe" -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Ingest', 'Lint')]
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
# PowerShell's .NET has no tree-aware Process.Kill. Its output is read and
# discarded so it never reaches the wrapper's stdout.
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
    $null = $killer.StandardOutput.ReadToEnd()
    [void]$killer.WaitForExit(10000)
    if (-not $Process.WaitForExit(5000)) {
        # taskkill could not stop it; stop the child itself so the wrapper's
        # exit does not leave it running.
        $Process.Kill()
    }
}

# The KB root is the parent of the .claude/ directory this script lives in.
$kbRoot = Split-Path -Parent $PSScriptRoot
$skill = "wiki-$($Operation.ToLowerInvariant())"
$arguments = "-p `"Use the $skill skill.`" --model sonnet --permission-mode default"
$whatIf = [bool]$WhatIfPreference

$lock = $null
$child = $null
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

    # The run budget. The Ingest and Lint tasks have a 2-hour execution time
    # limit, and the scheduler then stops only this process, so the wrapper
    # bounds the child itself, 300 seconds inside the limit.
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

    if (-not $child.WaitForExit($budgetSeconds * 1000)) {
        Stop-ProcessTree $child
        Stop-WithReason "the $Operation run did not finish within its budget of $budgetSeconds seconds; its process tree was stopped."
    }
    exit $child.ExitCode
} finally {
    # On a normal exit the child has exited by here. On the budget path taskkill
    # has ended its whole tree; where taskkill failed, the fallback only told
    # the child to end and does not wait for it, and a process it started may
    # outlive the lock. On a normal exit a process the child started and left
    # running also outlives it.
    if ($null -ne $child) { $child.Dispose() }
    if ($null -ne $lock) { $lock.Dispose() }
}
