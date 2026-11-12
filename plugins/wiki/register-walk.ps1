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
Where -User is another account it also requires -LauncherRoot, since the default root sits under this
account's profile, which the other account cannot read, and it verifies that the account can read the
named folder before anything is copied or registered, under -WhatIf too. The read is verified from the
folder's access rules, or from those of its nearest existing ancestor where the folder does not exist
yet: an allow rule must grant ReadAndExecute to the account, to Everyone, to Authenticated Users or to
a local group the account is a direct member of, and must reach the copied files: inheritable by
files where the folder exists, and by folders and files without NoPropagateInherit where an ancestor
was read. No deny rule for any of those that reaches the launcher may remove a read right.
Administrators, Power Users, Account Operators, Server Operators, Print Operators, Backup Operators,
RAS Servers, Pre-Windows 2000 Compatible Access, Network Configuration Operators and
Cryptographic Operators count for deny rules alone, so an allow rule for one of them never passes the
check. A limited token holds Administrators for deny only, and membership in any of the other nine
produces a filtered token. The rule holds even where Windows gives the task an unfiltered token, such
as with User Account Control off, so it can refuse a launcher root the task could read. A nested
group, a domain group and a local group whose members cannot be listed are not consulted, and a
refusal names the identities that were, marks each group counted for deny rules alone, names such a
group whose allow rule it did not count, and names any group skipped. It refuses a launcher root
under a plugins\marketplaces or plugins\cache folder, which a plugin update replaces. -LauncherRoot
may name the folder this script runs from, in which case no file is copied onto itself: an engine
checkout registers its own launcher that way.

Without -WhatIf the script requires an elevated session and refuses otherwise. With -WhatIf it prints
the definition it would register and copies and registers nothing; the copy and the registration both
sit inside one ShouldProcess block. -Remove unregisters the -User account's task; with -WhatIf it
prints the task it would unregister and removes nothing.

.PARAMETER User
The account the task runs as, and with -Remove the account whose task is unregistered. .\name is read
as this computer's account of that name. Defaults to the current account.

.PARAMETER LauncherRoot
The folder the launcher and its functions file are copied into. Defaults to
%LOCALAPPDATA%\llm-wiki\launcher. Required where -User is another account, and then verified readable
by that account.

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

# The local groups the read check counts for deny rules alone, by SID, since a group name is
# localized and a SID is not. A limited token, such as the task's S4U logon at the Limited run level
# gets, holds Administrators for deny only, and membership in any of the other nine produces a
# filtered token. So an allow rule for one of them never passes the read check, while a deny rule for
# one of them still binds the task and still refuses. All ten are read alike, on the refusing side.
# The rule holds even where Windows gives the task an unfiltered token, such as with User Account
# Control off, so it can refuse a root the task could read, and the refusal then names the group
# whose allow rule was not counted so the account is granted by name.
$script:DenyOnlyGroupSids = @(
    'S-1-5-32-544',  # Administrators
    'S-1-5-32-547',  # Power Users
    'S-1-5-32-548',  # Account Operators
    'S-1-5-32-549',  # Server Operators
    'S-1-5-32-550',  # Print Operators
    'S-1-5-32-551',  # Backup Operators
    'S-1-5-32-553',  # RAS Servers
    'S-1-5-32-554',  # Pre-Windows 2000 Compatible Access
    'S-1-5-32-556',  # Network Configuration Operators
    'S-1-5-32-569'   # Cryptographic Operators
)

# The identities whose access rules speak for an account, keyed by SID: the account itself, Everyone,
# Authenticated Users and each local group it is a direct member of. A group on
# $script:DenyOnlyGroupSids stays in the set, so its deny rules are read, and the read check counts
# it for deny rules alone. A nested group and a domain group are not consulted, since the registrar
# holds no password for the account and runs no probe as it, so a refusal names exactly what was. An
# account that does not resolve to a SID is refused. Returns the identities, keyed by SID, and the
# names of the local groups whose members could not be listed, which a refusal names as skipped.
function Get-ConsultedIdentities {
    param([Parameter(Mandatory)][string]$Account)
    try {
        $sid = ([Security.Principal.NTAccount]$Account).Translate([Security.Principal.SecurityIdentifier])
    } catch {
        Stop-WithReason "-User '$Account' does not resolve to an account: $($_.Exception.Message)"
    }
    $identities = [ordered]@{}
    $identities[$sid.Value] = $Account
    $identities['S-1-1-0'] = 'Everyone'
    $identities['S-1-5-11'] = 'NT AUTHORITY\Authenticated Users'
    try {
        $groups = @(Get-LocalGroup)
    } catch {
        Stop-WithReason "the local groups could not be listed, so the groups $Account belongs to are unknown: $($_.Exception.Message)"
    }
    $skipped = [System.Collections.Generic.List[string]]::new()
    foreach ($group in $groups) {
        # A group whose members cannot be listed, such as one holding an orphaned SID, is not consulted,
        # and is named as skipped.
        try {
            $members = @(Get-LocalGroupMember -SID $group.SID -ErrorAction Stop)
        } catch {
            $skipped.Add($(if ([string]::IsNullOrEmpty($group.Name)) { $group.SID.Value } else { $group.Name }))
            continue
        }
        if ($members.SID -contains $sid) {
            # A group SID that does not translate to a name is named by the SID itself.
            try {
                $name = $group.SID.Translate([Security.Principal.NTAccount]).Value
            } catch {
                $name = $group.SID.Value
            }
            $identities[$group.SID.Value] = $name
        }
    }
    return [pscustomobject]@{ Identities = $identities; Skipped = $skipped.ToArray() }
}

# Refuses unless the account can read the folder, read from the folder's access rules or, where the
# folder does not exist yet, from those of its nearest existing ancestor. The read holds where an
# allow rule grants ReadAndExecute, or a right set containing it, to one of the account's consulted
# identities and no deny rule for any of them that reaches the launcher removes a read right. A group
# on $script:DenyOnlyGroupSids counts for deny rules alone, for the reason the list's comment gives:
# its allow rule never grants the read, and the refusal marks each such group and names any such allow
# rule it did not count, so the person refused grants the account by name. A rule counts only where it reaches the files
# copied into the folder, since a copied file holds only the inheritable rules of the folder it lands
# in. Where the folder exists, an allow rule counts only where
# it carries ObjectInherit, and a deny rule counts unless it is InheritOnly without ObjectInherit.
# Where an ancestor was read, an allow rule counts only where it carries ContainerInherit and
# ObjectInherit, since the new folder holds only what it inherits too, and a deny rule counts where it
# carries either. On an ancestor, a rule carrying NoPropagateInherit counts as neither, since it stops
# at the ancestor's direct children: a new folder made there gets it for itself alone, and a file
# copied into that folder gets nothing. The check is a read and creates nothing, so it runs under
# -WhatIf too. The task runs as the account, and a launcher it cannot read fails before the launcher
# writes a line.
function Assert-AccountCanRead {
    param([Parameter(Mandatory)][string]$Account, [Parameter(Mandatory)][string]$Folder)
    $consulted = Get-ConsultedIdentities -Account $Account
    $identities = $consulted.Identities
    $readFrom = $Folder
    $isAncestor = $false
    while (-not (Test-Path -LiteralPath $readFrom -PathType Container)) {
        $parent = Split-Path -Parent $readFrom
        if ([string]::IsNullOrEmpty($parent)) {
            Stop-WithReason "-LauncherRoot '$Folder' has no existing ancestor folder whose access rules could be read."
        }
        $readFrom = $parent
        $isAncestor = $true
    }
    try {
        $rules = @((Get-Acl -LiteralPath $readFrom).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    } catch {
        Stop-WithReason "the access rules of '$readFrom' could not be read: $($_.Exception.Message)"
    }
    $readRights = [System.Security.AccessControl.FileSystemRights]::ReadAndExecute
    $objectInherit = [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $bothInherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $inheritOnly = [System.Security.AccessControl.PropagationFlags]::InheritOnly
    $noPropagate = [System.Security.AccessControl.PropagationFlags]::NoPropagateInherit
    $skippedNote = ''
    if ($consulted.Skipped.Count -gt 0) {
        $skippedNote = " Local groups whose members could not be listed, not consulted: $($consulted.Skipped -join ', ')."
    }
    $checked = @($identities.Keys | ForEach-Object {
        if ($script:DenyOnlyGroupSids -contains $_) { "$($identities[$_]) ($_, counted for deny rules only)" } else { "$($identities[$_]) ($_)" }
    }) -join ', '
    $grantedTo = $null
    $uncountedAllow = [System.Collections.Generic.List[string]]::new()
    foreach ($rule in $rules) {
        $sidValue = $rule.IdentityReference.Value
        if (-not $identities.Contains($sidValue)) { continue }
        $propagates = ($rule.PropagationFlags -band $noPropagate) -eq 0
        if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny) {
            # On an ancestor, a propagating deny carrying ObjectInherit reaches the copied files through
            # the new folder, and that reading is exact. One carrying ContainerInherit alone reaches the
            # new folder and not the files, and counts on the same conservative side as a folder-only
            # deny on an existing folder.
            $reachesLauncher = if ($isAncestor) {
                $propagates -and (($rule.InheritanceFlags -band $bothInherit) -ne 0)
            } else {
                # A deny on the existing folder itself counts on purpose even where it is folder-only
                # and the copied files would not inherit it, so this reading over-refuses that deny.
                # That is the conservative side of the rule that no deny for a consulted identity may
                # remove a read right.
                -not ((($rule.PropagationFlags -band $inheritOnly) -ne 0) -and (($rule.InheritanceFlags -band $objectInherit) -eq 0))
            }
            if ($reachesLauncher -and (($rule.FileSystemRights -band $readRights) -ne 0)) {
                Stop-WithReason "-LauncherRoot '$Folder' is not readable by ${Account}: a deny rule on '$readFrom' for $($identities[$sidValue]) removes a read right ($($rule.FileSystemRights)). Identities checked: $checked.$skippedNote The task runs as $Account and would fail before the launcher writes a line."
            }
            continue
        }
        if (($rule.FileSystemRights -band $readRights) -ne $readRights) { continue }
        $needed = if ($isAncestor) { $bothInherit } else { $objectInherit }
        if (($rule.InheritanceFlags -band $needed) -ne $needed) { continue }
        if ($isAncestor -and -not $propagates) { continue }
        # An allow rule that would grant the read for a group counted for deny rules alone is not
        # counted, and is kept so the refusal names it rather than saying no such rule exists.
        if ($script:DenyOnlyGroupSids -contains $sidValue) {
            $named = "$($identities[$sidValue]) ($sidValue)"
            if (-not $uncountedAllow.Contains($named)) { $uncountedAllow.Add($named) }
            continue
        }
        if ($null -eq $grantedTo) { $grantedTo = $identities[$sidValue] }
    }
    if ($null -eq $grantedTo) {
        $where = if ($isAncestor) {
            "its nearest existing ancestor '$readFrom' carries no allow rule granting ReadAndExecute with ContainerInherit and ObjectInherit and without NoPropagateInherit"
        } else {
            "it carries no allow rule granting ReadAndExecute with ObjectInherit, which the copied files would inherit,"
        }
        Stop-WithReason "-LauncherRoot '$Folder' is not readable by ${Account}: $where to any of the identities checked$(if ($uncountedAllow.Count -gt 0) { ' that count for allow rules. Identities checked' }): $checked.$skippedNote The task runs as $Account and would fail before the launcher writes a line.$(if ($uncountedAllow.Count -gt 0) { " An allow rule on '$readFrom' for $($uncountedAllow -join ' and ') would reach the launcher and was not counted, since such a group counts for deny rules only. Grant that account read on the folder by name, or name one it can read." } else { ' Grant that account read on the folder, or name one it can read.' })"
    }
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
# Another account cannot read the default launcher root, which sits under this account's profile, so
# a registration for it names its own root, verified below once resolved.
if (-not $isCurrentUser -and [string]::IsNullOrWhiteSpace($LauncherRoot)) {
    Stop-WithReason "-User names another account ($principalUser), so -LauncherRoot is required: the default launcher root sits under THIS account's %LOCALAPPDATA%, which $principalUser cannot read, and the task would fail before the launcher writes a line. Name a folder $principalUser can read."
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
# The current account registers into a folder of its own and takes no read check.
if (-not $isCurrentUser) {
    Assert-AccountCanRead -Account $principalUser -Folder $launcherRootFull
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
