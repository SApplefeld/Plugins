# Registers the KitOrphanSweep scheduled task, which runs orphan-sweep.ps1 every fifteen minutes.
#
#   .\bin\Register-OrphanSweepTask.ps1 -FindingsPath <path> [-SweeperPath <path> | -LauncherRoot <path>]
#       [-User <name>] [-Start] [-Remove] [-WhatIf]
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
# resolved from $PSScriptRoot, which is right for a checkout; pass it to point at a copy elsewhere.
# A sweeper under a plugins\marketplaces or plugins\cache folder is refused unless -LauncherRoot is
# given, since a plugin update replaces both folders and the task would then run nothing.
#
# -LauncherRoot runs the sweep from the installed personas plugin instead. The script copies
# bin/Start-InstalledOrphanSweep.ps1 and the shared bin/installed-plugin-functions.ps1 it
# dot-sources into that folder, and the task's action runs the launcher copy with -FindingsPath
# and the -ConfigDir this script resolves. At each fire the launcher runs the installed plugin's
# current orphan-sweep.ps1 from the folder the install record names (the launcher's own header
# says how). A root under a plugins\marketplaces or plugins\cache folder is refused, as is a root
# inside the personas plugin folder this script runs from, and so is -SweeperPath beside
# -LauncherRoot, since the two name different actions. -WhatIf prints the copy it would make and
# makes none.
#
# The task's only trigger is a one-time trigger at the registration moment, repeating every fifteen
# minutes with no end; Get-OrphanSweepTaskDefinition says why.
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
    [string]$LauncherRoot,
    [string]$User = [Security.Principal.WindowsIdentity]::GetCurrent().Name,
    [switch]$Start,
    [switch]$Remove,
    [switch]$WhatIf
)

$OrphanSweepTaskName = 'KitOrphanSweep'
$OrphanSweepInterval = New-TimeSpan -Minutes 15
$OrphanSweepTimeLimit = New-TimeSpan -Minutes 5
$OrphanSweepLauncherName = 'Start-InstalledOrphanSweep.ps1'
$InstalledPluginFunctionsName = 'installed-plugin-functions.ps1'

# $PluginInstallFolderPattern, the folders a plugin update replaces, comes from the shared functions
# file beside this script, which a -LauncherRoot run also copies beside the launcher.
if (-not (Test-Path -LiteralPath "$PSScriptRoot\installed-plugin-functions.ps1" -PathType Leaf)) {
    throw "Register-OrphanSweepTask: '$PSScriptRoot\installed-plugin-functions.ps1' does not exist; " +
        "it ships beside this script in the personas plugin's bin folder."
}
. "$PSScriptRoot\installed-plugin-functions.ps1"

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
profile can get that wrong. ScriptPath is the file the action runs with -FindingsPath: the sweeper
itself, or the launcher in -LauncherRoot that runs the installed one. A non-empty ConfigDir is
appended as the launcher's -ConfigDir; the sweeper route passes none.
#>
function Get-OrphanSweepTaskDefinition {
    param(
        [Parameter(Mandatory)][string]$ScriptPath,
        [Parameter(Mandatory)][string]$FindingsPath,
        [Parameter(Mandatory)][string]$User,
        [string]$ConfigDir
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
        "-File `"$ScriptPath`" -FindingsPath `"$FindingsPath`""
    if (-not [string]::IsNullOrEmpty($ConfigDir)) {
        # A backslash before the closing quote escapes it on powershell.exe's command line, and a
        # folder such as a drive root ends in one, so a trailing backslash is doubled to read back
        # as itself.
        if ($ConfigDir.EndsWith('\')) { $ConfigDir += '\' }
        $argumentString += " -ConfigDir `"$ConfigDir`""
    }
    $action = New-ScheduledTaskAction -Execute $psExe -Argument $argumentString

    # The one trigger is a one-time trigger starting at this moment, repeating every fifteen
    # minutes with no duration, which the scheduler reads as no end. A repetition belongs to a
    # trigger and begins only when that trigger fires, so the series starts at registration; a
    # boot trigger registered after boot would not fire until the next boot. The first scheduled
    # fire comes within one interval of registration, and -Start runs one at once. A fire against
    # a scan still running is ignored by the IgnoreNew setting below.
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval $OrphanSweepInterval
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
    Write-Output "  startBoundary: $($Definition.Trigger.StartBoundary)"
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
Throws when the task's action would name a file a plugin update replaces, and when -LauncherRoot
names a folder the launcher could not be installed in.

.DESCRIPTION
With -LauncherRoot the action runs the launcher in that root, so the root itself is tested, and the
launcher and the shared functions file it copies there must sit beside this script. Without it the
action runs the sweeper, which is tested. Each path is compared in its canonical form, the root with
a separator appended, against $PluginInstallFolderPattern, so a folder whose name merely starts with
marketplaces or cache is no match.
#>
function Confirm-OrphanSweepActionOutsidePluginInstall {
    param([string]$SweeperPath, [string]$LauncherRoot)
    if ([string]::IsNullOrEmpty($SweeperPath) -and [string]::IsNullOrEmpty($LauncherRoot)) {
        throw 'Register-OrphanSweepTask: name the action with -SweeperPath or -LauncherRoot.'
    }
    if (-not [string]::IsNullOrEmpty($LauncherRoot)) {
        $launcherFull = [IO.Path]::GetFullPath($LauncherRoot).TrimEnd('\', '/') + '\'
        if ($launcherFull -match $PluginInstallFolderPattern) {
            throw "Register-OrphanSweepTask: -LauncherRoot '$LauncherRoot' sits under a plugins\marketplaces " +
                "or plugins\cache folder, which a plugin update replaces. Name a folder outside both, " +
                "such as one under the account's profile."
        }
        # A checkout or worktree can be removed, and a root at this script's own bin would copy each
        # file onto itself, so the plugin folder is refused as Register-PersonaTasks.ps1 refuses it.
        $pluginFull = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\', '/') + '\'
        if ($launcherFull.StartsWith($pluginFull, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Register-OrphanSweepTask: -LauncherRoot '$LauncherRoot' sits inside the personas plugin folder " +
                "'$pluginFull', which a checkout removal or a plugin update replaces. Name a folder outside it, " +
                "such as one under the account's profile."
        }
        foreach ($name in @($OrphanSweepLauncherName, $InstalledPluginFunctionsName)) {
            $source = Join-Path $PSScriptRoot $name
            if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
                throw "Register-OrphanSweepTask: '$source' does not exist; run this script from a " +
                    "personas plugin folder whose bin holds the files -LauncherRoot installs."
            }
        }
        return
    }
    if ([IO.Path]::GetFullPath($SweeperPath) -match $PluginInstallFolderPattern) {
        throw "Register-OrphanSweepTask: the sweeper '$SweeperPath' sits under a plugins\marketplaces " +
            "or plugins\cache folder, which a plugin update replaces, so the task would run nothing " +
            "after the next update. Pass -LauncherRoot naming a folder outside both, such as one " +
            "under the account's profile, or run from a checkout."
    }
}

<#
.SYNOPSIS
Registers, starts or removes the KitOrphanSweep task, or under -WhatIf prints what it would do.

.DESCRIPTION
Unless -Remove is given, Confirm-OrphanSweepActionOutsidePluginInstall runs first, then the
elevation check, both before any ScheduledTasks cmdlet, including the read that finds an existing
task, and before any copy, so a refused run reads and writes nothing. -Remove needs neither path, so
it skips the first. $IsElevated is a parameter so a caller can drive the guard. With -LauncherRoot
the launcher and the shared functions file are copied into the root before the task is written, so
no task names a launcher that is not there yet; the shared file goes first, so a launcher never
lands without the file it reads, and each copy overwrites an older one, which is how a
re-registration from a newer plugin version updates them. Registration passes -Force, which
replaces a task of the same name in place, so a second run updates the first. Every scheduler call
carries -TaskPath '\' explicitly, since Get-ScheduledTask with no path searches every folder.
#>
function Register-OrphanSweepTask {
    param(
        # The sweeper the action runs; unused when -LauncherRoot is given.
        [string]$SweeperPath,
        [string]$LauncherRoot,
        [Parameter(Mandatory)][string]$FindingsPath,
        [Parameter(Mandatory)][string]$User,
        [switch]$Start,
        [switch]$Remove,
        [switch]$WhatIf,
        [bool]$IsElevated = (Test-IsElevated)
    )

    if (-not $Remove) {
        Confirm-OrphanSweepActionOutsidePluginInstall -SweeperPath $SweeperPath -LauncherRoot $LauncherRoot
    }

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

    $scriptPath = $SweeperPath
    $configDir = $null
    if (-not [string]::IsNullOrEmpty($LauncherRoot)) {
        $scriptPath = Join-Path $LauncherRoot $OrphanSweepLauncherName
        $sharedTarget = Join-Path $LauncherRoot $InstalledPluginFunctionsName
        # The config folder holding installed_plugins.json is resolved here, by the launcher's own
        # rule, where the operator's profile is loaded, and passed in the action, since the S4U
        # logon's environment at fire time is not relied on to resolve it.
        $configDir = $env:CLAUDE_CONFIG_DIR
        if ([string]::IsNullOrWhiteSpace($configDir)) { $configDir = Join-Path $env:USERPROFILE '.claude' }
        $configDir = [IO.Path]::GetFullPath($configDir)
    }
    $definition = Get-OrphanSweepTaskDefinition -ScriptPath $scriptPath -FindingsPath $FindingsPath -User $User -ConfigDir $configDir
    if ($WhatIf) {
        Write-OrphanSweepTaskDefinition -Definition $definition
        if (-not [string]::IsNullOrEmpty($LauncherRoot)) {
            Write-Output "would install shared functions $sharedTarget"
            Write-Output "would install launcher $scriptPath"
        }
        Write-Output "would register $OrphanSweepTaskName"
        if ($Start) { Write-Output "would start $OrphanSweepTaskName" }
        return
    }

    if (-not [string]::IsNullOrEmpty($LauncherRoot)) {
        [void][System.IO.Directory]::CreateDirectory($LauncherRoot)
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $InstalledPluginFunctionsName) -Destination $sharedTarget -Force -ErrorAction Stop
        Write-Output "installed shared functions $sharedTarget"
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $OrphanSweepLauncherName) -Destination $scriptPath -Force -ErrorAction Stop
        Write-Output "installed launcher $scriptPath"
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
        $sweeperResolved = $null
        $launcherRootResolved = $null
        if (-not [string]::IsNullOrEmpty($LauncherRoot)) {
            if (-not [string]::IsNullOrEmpty($SweeperPath)) {
                throw "Register-OrphanSweepTask: -SweeperPath and -LauncherRoot name different actions, " +
                    "the sweeper itself or the launcher that runs the installed one; pass one of them."
            }
            try {
                $launcherRootResolved = Resolve-AbsolutePath -Path $LauncherRoot
            } catch {
                throw "Register-OrphanSweepTask: -LauncherRoot '$LauncherRoot' could not be resolved: $($_.Exception.Message)"
            }
        } else {
            if ([string]::IsNullOrEmpty($SweeperPath)) {
                $SweeperPath = Join-Path $PSScriptRoot 'orphan-sweep.ps1'
            }
            try {
                $sweeperResolved = Resolve-AbsolutePath -Path $SweeperPath
            } catch {
                throw "Register-OrphanSweepTask: -SweeperPath '$SweeperPath' could not be resolved: $($_.Exception.Message)"
            }
        }
        try {
            $findingsResolved = Resolve-AbsolutePath -Path $FindingsPath
        } catch {
            throw "Register-OrphanSweepTask: -FindingsPath '$FindingsPath' could not be resolved: $($_.Exception.Message)"
        }
        Register-OrphanSweepTask -SweeperPath $sweeperResolved -LauncherRoot $launcherRootResolved `
            -FindingsPath $findingsResolved -User $User -Start:$Start -Remove:$Remove -WhatIf:$WhatIf
    } catch {
        # Console.Error.WriteLine, not Write-Error: Write-Error under $ErrorActionPreference =
        # 'Stop' raises a terminating error of its own, which skips the exit 1 below. The message
        # is written as thrown, unwrapped.
        [Console]::Error.WriteLine($_.Exception.Message)
        exit 1
    }
}
