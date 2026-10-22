# Registers the KitOrphanSweep scheduled task, which runs orphan-sweep.ps1 every fifteen minutes.
#
#   .\bin\Register-OrphanSweepTask.ps1 -FindingsPath <path> [-SweeperPath <path>] [-User <name>]
#       [-Start] [-Remove] [-WhatIf]
#
# The task runs Windows PowerShell 5.1, by its System32 path, on orphan-sweep.ps1 with
# -FindingsPath <path>. The sweeper reads the process table, appends findings to that file and
# rewrites the seen file beside it, creating their folder if it is missing; it stops no process,
# and the session's drain reads the findings file. The operator registers the task
# by running this script from an elevated session. Nothing else registers it.
#
# -FindingsPath is required: it is the file the sweeper appends to and the file the personas
# plugin's orphanSweepFindings option names, and a task without it would sweep into nowhere.
#
# -SweeperPath names the sweeper to run. Left unbound it is orphan-sweep.ps1 beside this script,
# resolved from $PSScriptRoot, which is right for a checkout and for an installed copy of the bin
# folder; pass it to point at a copy elsewhere.
#
# The trigger is AtStartup with a repetition every fifteen minutes with no end. New-ScheduledTaskTrigger
# -AtStartup takes no repetition parameters, so the repetition is built on a -Once trigger and
# assigned across, and its StopAtDurationEnd is set false after the copy, since the -Once
# repetition arrives with it true.
#
# The principal is -User with the S4U logon at the Limited run level: the sweeper needs no stored
# password and no DPAPI key, and an elevated task would write a findings file an unelevated session
# might not read. The settings carry a five minute execution time limit, IgnoreNew for a scan that
# is still running when the next fires, and no restart policy, since a scan that failed is the next
# scan's to repeat.
#
# Without -WhatIf the script requires an elevated session and refuses otherwise, before any
# ScheduledTasks cmdlet runs. -WhatIf is the unelevated inspection path: it builds the definition,
# prints every field read off the built objects, and calls no cmdlet that writes. It never prompts.
#
# -Start runs the task once after registering it. -Remove unregisters it.
#
# [CmdletBinding()] is what makes an unknown switch a binding error (exit 1) rather than a value
# that lands in $args while the body runs anyway.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$FindingsPath,
    [string]$SweeperPath,
    [string]$User = [Security.Principal.WindowsIdentity]::GetCurrent().Name,
    [switch]$Start,
    [switch]$Remove,
    [switch]$WhatIf
)

$OrphanSweepTaskName = 'KitOrphanSweep'
$OrphanSweepInterval = New-TimeSpan -Minutes 15
$OrphanSweepTimeLimit = New-TimeSpan -Minutes 5

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
A task action runs outside any interactive logon, where a relative path resolves against nothing
reliable, so both paths in the action are made absolute here. GetFullPath collapses `..` and `.`
segments and normalizes the separators.
#>
function Resolve-AbsolutePath {
    param([Parameter(Mandatory)][string]$Path)
    $unresolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    return [System.IO.Path]::GetFullPath($unresolved)
}

<#
.SYNOPSIS
Builds the KitOrphanSweep definition: action, trigger, principal and settings.

.DESCRIPTION
Every object comes from the ScheduledTasks builders, which work in memory and contact no service,
so -WhatIf can print what they built. The powershell.exe path is pinned rather than the bare name,
since an unqualified -Execute resolves by PATH search at every boot, and a task with no loaded
profile can get that wrong.
#>
function Get-OrphanSweepTaskDefinition {
    param(
        [Parameter(Mandatory)][string]$SweeperPath,
        [Parameter(Mandatory)][string]$FindingsPath,
        [Parameter(Mandatory)][string]$User
    )

    if ([string]::IsNullOrEmpty($env:SystemRoot)) {
        throw "Get-OrphanSweepTaskDefinition: `$env:SystemRoot is empty or unset; it does not " +
            "resolve to a working Windows installation on this session."
    }
    $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $psExe -PathType Leaf)) {
        throw "Get-OrphanSweepTaskDefinition: '$psExe' does not exist; `$env:SystemRoot " +
            "('$env:SystemRoot') does not resolve to a working Windows installation on this session."
    }

    $argumentString = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass " +
        "-File `"$SweeperPath`" -FindingsPath `"$FindingsPath`""
    $action = New-ScheduledTaskAction -Execute $psExe -Argument $argumentString

    # New-ScheduledTaskTrigger -AtStartup takes no repetition parameters and the object offers no
    # settable Repetition.Interval, so the repetition is built on a -Once trigger, which does, and
    # that trigger's Repetition is assigned across. Only the repetition is used; the -Once
    # trigger's own start time is discarded. A fire against a scan still running is ignored by the
    # IgnoreNew setting below.
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $repeater = New-ScheduledTaskTrigger -Once -At (Get-Date) `
        -RepetitionInterval $OrphanSweepInterval
    $trigger.Repetition = $repeater.Repetition
    # The -Once repetition arrives with StopAtDurationEnd true, which would end the repetition at
    # the window's close; this one has no close.
    $trigger.Repetition.StopAtDurationEnd = $false

    $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType S4U -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet `
        -ExecutionTimeLimit $OrphanSweepTimeLimit `
        -MultipleInstances IgnoreNew `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries

    return [pscustomobject]@{
        TaskName  = $OrphanSweepTaskName
        Action    = $action
        Trigger   = $trigger
        Principal = $principal
        Settings  = $settings
    }
}

<#
.SYNOPSIS
Prints, under -WhatIf, the block of fields the task would register with.

.DESCRIPTION
Every value is read off the built CIM objects rather than off this script's own literals, so the
printed block is evidence of what the builders actually built. The settings object's own property
names for the last two lines are DisallowStartIfOnBatteries and StopIfGoingOnBatteries, inverted
from the -AllowStartIfOnBatteries and -DontStopIfGoingOnBatteries switches that built them, so the
print negates them back to the switch names' own sense. The restart fields are printed so the
absence of a restart policy is visible as the builder's own values.
#>
function Write-OrphanSweepTaskDefinition {
    param([Parameter(Mandatory)]$Definition)
    Write-Output "task $($Definition.TaskName)"
    Write-Output "  action: $($Definition.Action.Execute) $($Definition.Action.Arguments)"
    Write-Output "  trigger: $($Definition.Trigger.CimClass.CimClassName)"
    Write-Output "  repetitionInterval: $($Definition.Trigger.Repetition.Interval)"
    # An empty Duration is the Task Scheduler's indefinite repetition.
    $duration = $Definition.Trigger.Repetition.Duration
    Write-Output "  repetitionDuration: $(if ([string]::IsNullOrEmpty($duration)) { 'indefinite' } else { $duration })"
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
Registers, starts or removes the KitOrphanSweep task, or under -WhatIf prints what it would do.

.DESCRIPTION
Without -WhatIf the elevation check runs first, before any ScheduledTasks cmdlet, including the
read that finds an existing task, so a refused run reads and writes nothing. $IsElevated is a
parameter so a caller can drive the guard. Registration passes -Force, which replaces a task of
the same name in place, so a second run updates the first. Every scheduler call carries
-TaskPath '\' explicitly, since Get-ScheduledTask with no path searches every folder.
#>
function Register-OrphanSweepTask {
    param(
        [Parameter(Mandatory)][string]$SweeperPath,
        [Parameter(Mandatory)][string]$FindingsPath,
        [Parameter(Mandatory)][string]$User,
        [switch]$Start,
        [switch]$Remove,
        [switch]$WhatIf,
        [bool]$IsElevated = (Test-IsElevated)
    )

    if (-not $WhatIf -and -not $IsElevated) {
        throw "Register-OrphanSweepTask: this must run from an elevated PowerShell session " +
            "(right-click PowerShell, 'Run as Administrator'). Registering a scheduled task under " +
            "the Task Scheduler root fails without it, with an access-denied error that does not " +
            "say why."
    }

    if ($Remove) {
        if ($WhatIf) {
            Write-Output "would unregister $OrphanSweepTaskName"
            return
        }
        $existing = @(Get-ScheduledTask -TaskName $OrphanSweepTaskName -TaskPath '\' -ErrorAction SilentlyContinue)
        if ($existing.Count -eq 0) {
            Write-Output "no task $OrphanSweepTaskName to remove"
            return
        }
        Unregister-ScheduledTask -TaskName $OrphanSweepTaskName -TaskPath '\' -Confirm:$false | Out-Null
        Write-Output "unregistered $OrphanSweepTaskName"
        return
    }

    $definition = Get-OrphanSweepTaskDefinition -SweeperPath $SweeperPath -FindingsPath $FindingsPath -User $User
    if ($WhatIf) {
        Write-OrphanSweepTaskDefinition -Definition $definition
        Write-Output "would register $OrphanSweepTaskName"
        if ($Start) { Write-Output "would start $OrphanSweepTaskName" }
        return
    }

    Register-ScheduledTask -TaskName $definition.TaskName -TaskPath '\' -Action $definition.Action `
        -Trigger $definition.Trigger -Principal $definition.Principal -Settings $definition.Settings `
        -Force | Out-Null
    Write-Output "registered $OrphanSweepTaskName"
    if ($Start) {
        Start-ScheduledTask -TaskName $OrphanSweepTaskName -TaskPath '\'
        Write-Output "started $OrphanSweepTaskName"
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    # Stop turns a thrown .NET exception into a terminating error in this scope, same as every
    # `throw` above, so it reaches the catch and the exit 1 below.
    $ErrorActionPreference = 'Stop'
    try {
        if ([string]::IsNullOrEmpty($SweeperPath)) {
            $SweeperPath = Join-Path $PSScriptRoot 'orphan-sweep.ps1'
        }
        try {
            $sweeperResolved = Resolve-AbsolutePath -Path $SweeperPath
        } catch {
            throw "Register-OrphanSweepTask: -SweeperPath '$SweeperPath' could not be resolved: $($_.Exception.Message)"
        }
        try {
            $findingsResolved = Resolve-AbsolutePath -Path $FindingsPath
        } catch {
            throw "Register-OrphanSweepTask: -FindingsPath '$FindingsPath' could not be resolved: $($_.Exception.Message)"
        }
        Register-OrphanSweepTask -SweeperPath $sweeperResolved -FindingsPath $findingsResolved `
            -User $User -Start:$Start -Remove:$Remove -WhatIf:$WhatIf
    } catch {
        # Console.Error.WriteLine, not Write-Error: Write-Error under $ErrorActionPreference =
        # 'Stop' raises a terminating error of its own, which skips the exit 1 below. The message
        # is written as thrown, unwrapped.
        [Console]::Error.WriteLine($_.Exception.Message)
        exit 1
    }
}
