#Requires -Version 7.0
<#
.SYNOPSIS
Registers the wiki-walk scheduled task, which runs the wiki walker every hour, or removes it.

.DESCRIPTION
One task per Windows account runs the walker, kb-walk.ps1, for every wiki on the account's list. The
task is registered in its own task folder, \llm-wiki\<domain>.<account>\, so one account's
registration or removal never touches another account's task. The task's action runs
Start-InstalledWikiWalk.ps1 from a launcher root, a folder outside the plugin
cache, and the launcher finds the installed plugin's current folder at every fire, so a plugin update
changes the walker with no re-registration. This script copies the launcher and
installed-plugin-functions.ps1 from its own folder into the launcher root, then registers the task.

The trigger is a one-time trigger at the next five minutes past an hour, repeating every hour with no
end. The principal is -User with the S4U logon at the Limited run level, which runs whether or not
the user is logged on and needs no stored password, but cannot read Windows Credential Manager, so a
git push over HTTPS backed by it may fail; a remote over SSH with a passphrase-less key works. The
settings start a missed run when the machine is next available and end a run at 2 hours.

The script refuses where pwsh or claude is not on the PATH of the account it runs as, and warns where
-User is another account, since both were resolved on this account's PATH and the task runs as -User.
It refuses a launcher root under a plugins\marketplaces or plugins\cache folder, which a plugin update
replaces. -LauncherRoot may name the folder this script runs from, in which case no file is copied
onto itself: an engine checkout registers its own launcher that way.

Without -WhatIf the script requires an elevated session and refuses otherwise. With -WhatIf it prints
the definition it would register and copies and registers nothing; the copy and the registration both
sit inside one ShouldProcess block. -Remove unregisters the -User account's task; with -WhatIf it
prints the task it would unregister and removes nothing.

.PARAMETER User
The account the task runs as, and with -Remove the account whose task is unregistered. .\name is read
as this computer's account of that name. Defaults to the current account.

.PARAMETER LauncherRoot
The folder the launcher and its functions file are copied into. Defaults to
%LOCALAPPDATA%\llm-wiki\launcher.

.PARAMETER Remove
Unregisters the -User account's wiki-walk task instead of registering it.

.EXAMPLE
pwsh -NoProfile -File ./register-walk.ps1 -User .\name -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$User = [Security.Principal.WindowsIdentity]::GetCurrent().Name,
    [string]$LauncherRoot,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$script:TaskName = 'wiki-walk'
$script:LauncherName = 'Start-InstalledWikiWalk.ps1'
$script:FunctionsName = 'installed-plugin-functions.ps1'

# Writes a single-line reason to stderr and stops with exit code 1, so a refusal is legible to an
# operator without a PowerShell stack trace.
function Stop-WithReason {
    param([string]$Reason)
    [Console]::Error.WriteLine("register-walk: $Reason")
    exit 1
}

# True when the current process is running elevated.
function Test-IsElevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Resolves a possibly-relative path to an absolute one against the caller's location. A task action
# runs outside any interactive logon, where a relative path resolves against nothing reliable.
function Resolve-AbsolutePath {
    param([Parameter(Mandatory)][string]$Path)
    $unresolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    return [System.IO.Path]::GetFullPath($unresolved)
}

# $PluginInstallFolderPattern comes from the functions file beside this script, which a registration
# also copies beside the launcher.
$sharedFunctions = Join-Path $PSScriptRoot $script:FunctionsName
if (-not (Test-Path -LiteralPath $sharedFunctions -PathType Leaf)) {
    Stop-WithReason "'$sharedFunctions' does not exist; it ships beside this script."
}
. $sharedFunctions

# Task Scheduler cannot resolve the .\user or ./user form, so it is given as COMPUTERNAME\user, here
# for every message and below for the principal.
$principalUser = $User
if ($User -match '^\.[\\/]') {
    $principalUser = "$env:COMPUTERNAME\$($User.Substring(2))"
}
# The task folder names the domain and the account, so each account's task is separate. A name with no
# domain takes this session's domain.
$folderUser = $principalUser
if ($folderUser -notmatch '[\\/]') { $folderUser = "${env:USERDOMAIN}.$folderUser" }
$taskPath = '\llm-wiki\' + ($folderUser -replace '[\\/]', '.') + '\'
# The whole principal is compared, never the name after the separator, so another domain's account of
# the same name is not taken for this one.
$isCurrentUser = ($principalUser -ieq $env:USERNAME) -or
    ($principalUser -ieq "$env:USERDOMAIN\$env:USERNAME") -or
    ($principalUser -ieq "$env:COMPUTERNAME\$env:USERNAME")

# Without -WhatIf the script needs an elevated session, checked before any ScheduledTasks cmdlet.
if (-not $WhatIfPreference -and -not (Test-IsElevated)) {
    Stop-WithReason 'this must run from an elevated PowerShell session (right-click PowerShell, ''Run as Administrator''). Registering a scheduled task under the Task Scheduler root fails without it, with an access-denied error that does not say why.'
}

if ($Remove) {
    Write-Output ''
    Write-Output "Task name:  $script:TaskName"
    Write-Output "Task path:  $taskPath"
    Write-Output "Remove:     unregister the scheduled task $script:TaskName"
    Write-Output ''
    if ($PSCmdlet.ShouldProcess($script:TaskName, 'Unregister scheduled task')) {
        $existing = @(Get-ScheduledTask -TaskName $script:TaskName -TaskPath $taskPath -ErrorAction SilentlyContinue)
        if ($existing.Count -eq 0) {
            Write-Output "No task $script:TaskName to remove."
        } else {
            Unregister-ScheduledTask -TaskName $script:TaskName -TaskPath $taskPath -Confirm:$false -ErrorAction Stop
            Write-Output "Unregistered $script:TaskName."
        }
    } else {
        Write-Output 'Nothing was unregistered.'
    }
    exit 0
}

# pwsh runs the launcher and claude runs the walker's model calls; both are resolved on this
# account's PATH, and the task runs as $User, whose install may differ.
$pwshCmd = Get-Command -Name 'pwsh' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $pwshCmd) {
    Stop-WithReason "pwsh was not found on PATH. PowerShell 7 must be installed for the account the task runs as ($User)."
}
$claudeCmd = Get-Command -Name 'claude' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $claudeCmd) {
    Stop-WithReason "claude was not found on PATH. Claude Code must be installed and logged in under the account the task runs as ($User)."
}
if (-not $isCurrentUser) {
    [Console]::Error.WriteLine("register-walk: warning: pwsh ($($pwshCmd.Source)) and claude ($($claudeCmd.Source)) were resolved on THIS account's PATH, and the task runs as $principalUser, whose install may live elsewhere. Confirm both are installed and Claude Code is logged in for that account.")
}

if ([string]::IsNullOrWhiteSpace($LauncherRoot)) {
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        Stop-WithReason 'LOCALAPPDATA is not set, so the default launcher root is unknown; pass -LauncherRoot.'
    }
    $LauncherRoot = Join-Path (Join-Path $env:LOCALAPPDATA 'llm-wiki') 'launcher'
}
try {
    $launcherRootFull = Resolve-AbsolutePath -Path $LauncherRoot
} catch {
    Stop-WithReason "-LauncherRoot '$LauncherRoot' could not be resolved: $($_.Exception.Message)"
}
if (($launcherRootFull.TrimEnd('\', '/') + '\') -match $PluginInstallFolderPattern) {
    Stop-WithReason "-LauncherRoot '$LauncherRoot' sits under a plugins\marketplaces or plugins\cache folder, which a plugin update replaces. Name a folder outside both, such as one under the account's profile."
}
foreach ($name in @($script:LauncherName, $script:FunctionsName)) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name) -PathType Leaf)) {
        Stop-WithReason "'$(Join-Path $PSScriptRoot $name)' does not exist; run this script from a folder that holds the files it installs."
    }
}
$launcherPath = Join-Path $launcherRootFull $script:LauncherName

# The action names the full pwsh path, since a bare name resolves by PATH search at every fire, and
# a task with no loaded profile can resolve it differently.
$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcherPath`""
$action = New-ScheduledTaskAction -Execute $pwshCmd.Source -Argument $arguments

# The next five minutes past an hour. A repeating trigger with no repetition duration repeats
# indefinitely; Task Scheduler refuses TimeSpan.MaxValue as a duration, so none is passed.
$now = Get-Date
$startAt = $now.Date.AddHours($now.Hour).AddMinutes(5)
if ($startAt -le $now) { $startAt = $startAt.AddHours(1) }
$trigger = New-ScheduledTaskTrigger -Once -At $startAt -RepetitionInterval (New-TimeSpan -Hours 1)

$principal = New-ScheduledTaskPrincipal -UserId $principalUser -LogonType S4U -RunLevel Limited
# -StartWhenAvailable runs a missed occurrence when the machine is next available; the time limit
# bounds a run that hangs, matching the walker's 6900-second pass budget.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings

Write-Output ''
Write-Output "Task name:  $script:TaskName"
Write-Output "Task path:  $taskPath"
Write-Output "Run as:     $($principal.UserId)"
Write-Output "Logon type: $($principal.LogonType)"
Write-Output "Run level:  $($principal.RunLevel)"
Write-Output "Starts at:  $($startAt.ToString('s'))"
Write-Output "Repeats:    $($trigger.Repetition.Interval)"
Write-Output "Execute:    $($action.Execute)"
Write-Output "Arguments:  $($action.Arguments)"
Write-Output "Launcher:   $launcherPath"
Write-Output "Time limit: $($settings.ExecutionTimeLimit)"
Write-Output ''

if ($PSCmdlet.ShouldProcess($script:TaskName, "Install the launcher in $launcherRootFull and register the scheduled task running as $principalUser")) {
    [void][System.IO.Directory]::CreateDirectory($launcherRootFull)
    # The functions file goes first, so a launcher never lands without the file it reads. A copy
    # whose source and destination are one file is skipped, which is how -LauncherRoot may name this
    # script's own folder.
    foreach ($name in @($script:FunctionsName, $script:LauncherName)) {
        $source = Join-Path $PSScriptRoot $name
        $destination = Join-Path $launcherRootFull $name
        if ([System.IO.Path]::GetFullPath($source) -ine [System.IO.Path]::GetFullPath($destination)) {
            Copy-Item -LiteralPath $source -Destination $destination -Force -ErrorAction Stop
            Write-Output "Installed $destination"
        }
    }
    Register-ScheduledTask -TaskName $script:TaskName -TaskPath $taskPath -InputObject $task -Force -ErrorAction Stop | Out-Null
    Write-Output "Registered $script:TaskName."
} else {
    Write-Output 'Nothing was copied and no task was added. Re-run without -WhatIf from an elevated session to register this task.'
}
exit 0
