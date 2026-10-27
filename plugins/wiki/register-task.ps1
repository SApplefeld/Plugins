#Requires -Version 5.1
<#
.SYNOPSIS
Registers a per-user Windows scheduled task that runs a knowledge base's
ingest or lint skill headlessly on a cadence, or its repository feeder.

.DESCRIPTION
Builds and registers a Windows scheduled task that runs headless Claude Code
(claude -p) in a knowledge base folder as a named Windows account, invoking
either the wiki-ingest skill on a frequent cadence or the wiki-lint skill on a
weekly cadence. It refuses to register a task that would silently do nothing:
for Ingest and Lint it verifies the KB is a git repo with the requested skill
and an origin remote, and that the workspace is trusted for the owning
account, because Claude Code ignores permissions.allow in an untrusted
workspace and a scheduled run there writes nothing while no one is watching.

The prompt names the skill in prose ("Use the wiki-ingest skill."), the stable
invocation form for a headless run. The model is pinned to sonnet because an
unpinned headless spawn inherits the harness default and a too-small model does
nothing while emitting success-shaped text. The permission mode is pinned to
default so an account whose own settings default to bypassPermissions still runs
the KB under the workspace allow-list rather than with only the deny wall, which
is the ceiling the KB's security model depends on.

The Feed operation instead runs the KB's vendored .claude/feed-inbox.ps1 under
pwsh. It never invokes Claude and commits nothing, so it needs no skill file,
no origin remote, no model, no permission mode, and no trust check. It needs
only the feeder script and its .claude/feed.json configuration.

With -WhatIf the task is described and nothing is registered. Otherwise the
task is registered and read back so the operator sees what actually landed,
followed by the verification checklist from the automation runbook.

.PARAMETER Operation
Ingest, Lint, or Feed. Ingest runs the wiki-ingest skill; Lint runs the
wiki-lint skill. This selects the skill named in the prompt, the required skill
file, and the default cadence. Feed runs .claude/feed-inbox.ps1 under pwsh.

.PARAMETER KbPath
The knowledge base repo root. It must be a directory and a git repo. For Ingest
and Lint it must hold the requested skill under .claude/skills/ and have a git
remote named origin. For Feed it must hold .claude/feed-inbox.ps1 and
.claude/feed.json.

.PARAMETER User
The Windows account the task runs as, in DOMAIN\user or .\user form. The task
runs under this account's Claude login, git credentials, and workspace trust.

.PARAMETER Cadence
The schedule. One of Hourly, Every4Hours, Every12Hours, Daily, or Weekly. When
omitted it defaults to Every4Hours for Ingest, Weekly for Lint, and Hourly for
Feed.

.PARAMETER TaskName
The scheduled task name. When omitted it is derived from the operation and the
KB folder name, for example wiki-ingest-eleos-kb or wiki-feed-eleos-kb.

.PARAMETER SkipTrustCheck
Skips the workspace trust check. Use this only when registering for an account
other than the current one, whose ~/.claude.json this script cannot read. It
does not make the workspace trusted; it only stops this script from verifying
it. Trust must still be established under the running account or the task
writes nothing.

.EXAMPLE
pwsh -NoProfile -File ./register-task.ps1 -Operation Ingest -KbPath ../eleos-kb -User '.\eleos'

.EXAMPLE
pwsh -NoProfile -File ./register-task.ps1 -Operation Lint -KbPath ../eleos-kb -User '.\eleos' -Cadence Weekly

.EXAMPLE
pwsh -NoProfile -File ./register-task.ps1 -Operation Feed -KbPath ../eleos-kb -User '.\eleos'
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Ingest', 'Lint', 'Feed')]
    [string]$Operation,

    [Parameter(Mandatory)]
    [string]$KbPath,

    [Parameter(Mandatory)]
    [string]$User,

    [ValidateSet('Hourly', 'Every4Hours', 'Every12Hours', 'Daily', 'Weekly')]
    [string]$Cadence,

    [string]$TaskName,

    [switch]$SkipTrustCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Git failures are surfaced by checking $LASTEXITCODE explicitly, so native
# command failures must not auto-throw and produce a stack trace.
$PSNativeCommandUseErrorActionPreference = $false

# Writes a single-line reason to stderr and stops with a non-zero exit code, so
# a refusal is legible to an operator without a PowerShell stack trace.
function Stop-WithReason {
    param([string]$Reason)
    [Console]::Error.WriteLine("register-task: $Reason")
    exit 1
}

# Writes a highly visible multi-line warning to stderr. Used for the trust
# state this script cannot verify, which is the failure that otherwise stays
# silent until a scheduled run has written nothing.
function Write-LoudWarning {
    param([string[]]$Lines)
    [Console]::Error.WriteLine('')
    [Console]::Error.WriteLine('  ****************************************************************')
    foreach ($line in $Lines) {
        [Console]::Error.WriteLine("  * $line")
    }
    [Console]::Error.WriteLine('  ****************************************************************')
    [Console]::Error.WriteLine('')
}

# Folds path separators to forward slashes and lowercases, so a path recorded
# with backslashes and one recorded with forward slashes compare equal. Both
# forms occur as project keys in ~/.claude.json.
function ConvertTo-ComparablePath {
    param([string]$PathValue)
    return ($PathValue -replace '\\', '/').TrimEnd('/').ToLowerInvariant()
}

# Parses a JSON file into nested dictionaries. ~/.claude.json can carry a
# property whose name is an empty string, which the default ConvertFrom-Json
# rejects on both PowerShell editions. On 6+ the -AsHashtable switch tolerates
# it; on 5.1 that switch does not exist, so JavaScriptSerializer, which reads a
# JSON object into a Dictionary, is used instead. Both yield a value that
# supports ContainsKey and key indexing.
function Read-JsonAsDictionary {
    param([string]$FilePath)
    $raw = Get-Content -LiteralPath $FilePath -Raw
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        return $raw | ConvertFrom-Json -AsHashtable
    }
    Add-Type -AssemblyName System.Web.Extensions
    $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $serializer.MaxJsonLength = [int]::MaxValue
    return $serializer.DeserializeObject($raw)
}

# 1. Resolve the KB path and confirm it is a git repo holding the requested skill.
if (-not (Test-Path -LiteralPath $KbPath -PathType Container)) {
    Stop-WithReason "KbPath is not an existing directory: $KbPath"
}
$kbRoot = (Resolve-Path -LiteralPath $KbPath).ProviderPath

if (-not (Test-Path -LiteralPath (Join-Path $kbRoot '.git'))) {
    Stop-WithReason "KbPath is not a git repository (no .git): $kbRoot"
}

# Feed runs the vendored feeder, not a skill. It needs the script and its
# configuration, and nothing a Claude run needs.
$isFeed = ($Operation -eq 'Feed')

# The skill the operation invokes, and the file that must exist for it.
if ($isFeed) {
    $skillName = 'feed-inbox.ps1'
    $feederFile = Join-Path (Join-Path $kbRoot '.claude') 'feed-inbox.ps1'
    foreach ($required in @('.claude/feed-inbox.ps1', '.claude/feed.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $kbRoot $required) -PathType Leaf)) {
            Stop-WithReason "KB is missing the Feed file: $required"
        }
    }
} else {
    if ($Operation -eq 'Ingest') {
        $skillName = 'wiki-ingest'
    } else {
        $skillName = 'wiki-lint'
    }
    $skillRelative = ".claude/skills/$skillName/SKILL.md"
    $skillFile = Join-Path $kbRoot $skillRelative
    if (-not (Test-Path -LiteralPath $skillFile -PathType Leaf)) {
        Stop-WithReason "KB is missing the $Operation skill file: $skillRelative"
    }

    # 2. A task without an origin remote would commit locally and never push,
    # because kb-commit.ps1 pushes only to a remote named origin.
    $remotes = @(& git -C $kbRoot remote)
    if ($LASTEXITCODE -ne 0) {
        Stop-WithReason "unable to list git remotes for: $kbRoot"
    }
    if ($remotes -notcontains 'origin') {
        Stop-WithReason "KB has no git remote named 'origin'; a scheduled run would commit locally and never push. Add one with: git -C `"$kbRoot`" remote add origin <url>"
    }
}

# 3. Verify workspace trust for the owning account, or refuse to register. An
# untrusted workspace makes Claude Code ignore permissions.allow, so the
# scheduled run would prompt on every write, get no answer, and write nothing.
$currentUser = "$env:USERDOMAIN\$env:USERNAME"
# Task Scheduler cannot resolve the .\user or ./user form, so it is given as
# COMPUTERNAME\user, here for every message and below for the principal.
$principalUser = $User
if ($User -match '^\.[\\/]') {
    $principalUser = "$env:COMPUTERNAME\$($User.Substring(2))"
}
# The whole principal is compared, never the name after the separator, so
# another domain's account of the same name is not taken for this one.
$isCurrentUser = ($principalUser -ieq $env:USERNAME) -or
    ($principalUser -ieq "$env:USERDOMAIN\$env:USERNAME") -or
    ($principalUser -ieq "$env:COMPUTERNAME\$env:USERNAME")

if ($isFeed) {
    # No trust check: Feed never runs Claude and holds no model permissions.
    if ($SkipTrustCheck) {
        [Console]::Error.WriteLine('register-task: warning: -SkipTrustCheck has no effect for -Operation Feed, which runs no trust check.')
    }
} elseif ($SkipTrustCheck) {
    Write-LoudWarning @(
        'WORKSPACE TRUST NOT VERIFIED (-SkipTrustCheck).',
        "The task will run as: $principalUser",
        'Trust is per Windows account and lives in that account''s own',
        '~/.claude.json, which this script cannot read from here.',
        'If the KB is not trusted under that account, the scheduled run',
        'writes NOTHING and no one is notified. Establish trust by opening',
        'Claude Code interactively in the KB once as that account and',
        'accepting the trust dialog.'
    )
} elseif (-not $isCurrentUser) {
    Stop-WithReason "cannot verify workspace trust for '$principalUser' from this account ($currentUser); trust lives in that account's own ~/.claude.json. Open Claude Code interactively in the KB once as '$principalUser' and accept the trust dialog, then re-run with -SkipTrustCheck to acknowledge trust was established there."
} else {
    $claudeConfig = Join-Path $env:USERPROFILE '.claude.json'
    if (-not (Test-Path -LiteralPath $claudeConfig -PathType Leaf)) {
        Stop-WithReason "trust cannot be verified: $claudeConfig does not exist. Open Claude Code interactively in the KB once and accept the trust dialog."
    }

    $config = Read-JsonAsDictionary $claudeConfig
    $projectsNode = $null
    if ($config -and $config.ContainsKey('projects')) {
        $projectsNode = $config['projects']
    }

    $trusted = $false
    if ($null -ne $projectsNode) {
        $wanted = ConvertTo-ComparablePath $kbRoot
        foreach ($key in @($projectsNode.Keys)) {
            if ((ConvertTo-ComparablePath $key) -eq $wanted) {
                $entry = $projectsNode[$key]
                if ($entry -and $entry.ContainsKey('hasTrustDialogAccepted') -and $entry['hasTrustDialogAccepted']) {
                    $trusted = $true
                }
                break
            }
        }
    }

    if (-not $trusted) {
        Stop-WithReason "KB workspace is not trusted for this account. Open Claude Code interactively in the KB once and accept the trust dialog. An untrusted workspace makes Claude Code ignore permissions.allow, so the scheduled run would write nothing and no one would notice. Path checked in ${claudeConfig}: $kbRoot"
    }
}

if ($isFeed) {
    # 4. The feeder runs under pwsh, resolved on the current account's PATH; the
    # task runs as $User, whose install may differ.
    $pwshCmd = Get-Command -Name 'pwsh' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $pwshCmd) {
        Stop-WithReason "pwsh was not found on PATH. PowerShell 7 must be installed for the account the task runs as ($User)."
    }
    $executable = $pwshCmd.Source
    if (-not $isCurrentUser) {
        Write-LoudWarning @(
            "pwsh was resolved on THIS account's PATH: $executable",
            "The task runs as $User, whose install may live elsewhere.",
            'Confirm PowerShell 7 is installed for that account.'
        )
    }

    # 5. Build the action: plain PowerShell running the vendored feeder, with no
    # Claude call, model, or permission mode.
    $arguments = "-NoProfile -File `"$feederFile`""
} else {
    # 4. Claude Code must be on PATH for the running account. Get-Command reads the
    # current account's PATH; the task runs as $User, whose install may differ.
    $claudeCmd = Get-Command -Name 'claude' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $claudeCmd) {
        Stop-WithReason "claude was not found on PATH. Claude Code must be installed and logged in under the account the task runs as ($User)."
    }
    $executable = $claudeCmd.Source
    if (-not $isCurrentUser) {
        Write-LoudWarning @(
            "claude was resolved on THIS account's PATH: $executable",
            "The task runs as $User, whose install may live elsewhere.",
            'Confirm Claude Code is installed and logged in under that account.'
        )
    }

    # 5. Build the action. The prompt names the skill in prose, the stable form for
    # a headless run. --model sonnet is pinned because an unpinned headless spawn
    # inherits the harness default and a too-small model does nothing while
    # reporting success. --permission-mode default is pinned because an account
    # defaulting to bypassPermissions would otherwise run the KB with no allow-list
    # ceiling, leaving only the deny wall; default mode holds the run to the
    # workspace allow-list the security model relies on.
    $prompt = "Use the $skillName skill."
    $arguments = "-p `"$prompt`" --model sonnet --permission-mode default"
}
$action = New-ScheduledTaskAction -Execute $executable -Argument $arguments -WorkingDirectory $kbRoot

# 6. Build the trigger from the cadence. An omitted cadence defaults by
# operation: Ingest runs often, Lint runs weekly, Feed runs hourly.
if ([string]::IsNullOrWhiteSpace($Cadence)) {
    if ($Operation -eq 'Ingest') {
        $Cadence = 'Every4Hours'
    } elseif ($isFeed) {
        $Cadence = 'Hourly'
    } else {
        $Cadence = 'Weekly'
    }
}

$startAt = (Get-Date).Date.AddMinutes(5)
# A repeating trigger with no repetition duration repeats indefinitely. Task
# Scheduler refuses TimeSpan.MaxValue as a duration, so none is passed.
switch ($Cadence) {
    'Hourly' {
        $trigger = New-ScheduledTaskTrigger -Once -At $startAt -RepetitionInterval (New-TimeSpan -Hours 1)
    }
    'Every4Hours' {
        $trigger = New-ScheduledTaskTrigger -Once -At $startAt -RepetitionInterval (New-TimeSpan -Hours 4)
    }
    'Every12Hours' {
        $trigger = New-ScheduledTaskTrigger -Once -At $startAt -RepetitionInterval (New-TimeSpan -Hours 12)
    }
    'Daily' {
        $trigger = New-ScheduledTaskTrigger -Daily -At '03:00'
    }
    'Weekly' {
        $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '03:00'
    }
}

# The principal runs the task as $User. S4U (Service For User) runs the task
# whether or not the user is logged on and needs no stored password, but the
# run cannot read Windows Credential Manager, so a git push over HTTPS backed
# by it may fail. A remote over SSH with a passphrase-less key works under S4U;
# the automation runbook covers the push path.
$principal = New-ScheduledTaskPrincipal -UserId $principalUser -LogonType S4U -RunLevel Limited

# -StartWhenAvailable runs a missed occurrence as soon as the machine is next
# available; the execution time limit bounds a run that hangs so it cannot pin
# a slot forever. A feed run only fetches and copies, and bounds each git call
# itself, a first fetch of a source at 30 minutes, so it gets 1 hour; an ingest
# or lint run gets 2 hours.
if ($isFeed) {
    $timeLimit = New-TimeSpan -Hours 1
} else {
    $timeLimit = New-TimeSpan -Hours 2
}
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit $timeLimit

# The default task name pairs the operation with the KB folder so ingest, lint
# and feed tasks for the same KB do not collide.
if ([string]::IsNullOrWhiteSpace($TaskName)) {
    $kbFolderName = Split-Path -Leaf $kbRoot
    if ($isFeed) {
        $TaskName = "wiki-feed-$kbFolderName"
    } else {
        $TaskName = "$skillName-$kbFolderName"
    }
}

$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings

# 7. With -WhatIf, describe the task and register nothing. Otherwise register it
# and read it back so the operator sees what actually landed.
Write-Output ''
Write-Output "Operation:  $Operation ($skillName)"
Write-Output "KB path:    $kbRoot"
Write-Output "Run as:     $principalUser"
Write-Output "Cadence:    $Cadence"
Write-Output "Task name:  $TaskName"
Write-Output "Execute:    $executable"
Write-Output "Arguments:  $arguments"
Write-Output "Time limit: $($settings.ExecutionTimeLimit)"
Write-Output ''

if (-not $PSCmdlet.ShouldProcess($TaskName, "Register scheduled task running as $principalUser")) {
    Write-Output '-WhatIf: nothing was registered. Re-run without -WhatIf to register this task.'
    exit 0
}

Register-ScheduledTask -TaskName $TaskName -InputObject $task -ErrorAction Stop | Out-Null

$registered = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
Write-Output 'Registered. Read back from Task Scheduler:'
Write-Output "  Name:      $($registered.TaskName)"
Write-Output "  Principal: $($registered.Principal.UserId) (LogonType $($registered.Principal.LogonType))"
$repetition = $registered.Triggers[0].Repetition
$repeatFor = if ($repetition.Duration) { $repetition.Duration } else { 'indefinitely' }
Write-Output "  Trigger:   $($registered.Triggers[0].CimClass.CimClassName)"
if ($repetition.Interval) {
    Write-Output "  Repeats:   every $($repetition.Interval), $repeatFor"
}
Write-Output "  Execute:   $($registered.Actions[0].Execute)"
Write-Output "  Arguments: $($registered.Actions[0].Arguments)"
Write-Output "  WorkingDir:$($registered.Actions[0].WorkingDirectory)"

# 8. The verification checklist is the last thing printed, so the operator's
# next action is to prove the task works end to end before trusting it.
Write-Output ''
if ($isFeed) {
    Write-Output 'Registration is not proof the task works. Run the feeder section of'
    Write-Output 'docs/runbook_automation.md now: start the task by hand, confirm its last'
    Write-Output 'run result is 0, and confirm the expected files reached inbox/.'
    exit 0
}
Write-Output 'Registration is not proof the task works. Run the verification'
Write-Output 'checklist in docs/runbook_automation.md now, in order: confirm the'
Write-Output 'principal, run the exact command by hand as the owning account with an'
Write-Output 'empty inbox (no commits, clean exit, no trust warning on stderr), then'
Write-Output 'drop a canary file and confirm it reaches sources/ and pushes to origin.'

exit 0
