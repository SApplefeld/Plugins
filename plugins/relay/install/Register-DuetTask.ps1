# Registers the Duet server as a Windows scheduled task, with the broker task's three triggers:
# system startup, the operator's logon, and again within two minutes of the server exiting.
#
#   .\install\Register-DuetTask.ps1 -User <account> -EnvFile <state root>\broker.env
#
# Requires an elevated PowerShell session, as Register-BrokerTask.ps1 does. The task is built by
# that script's Register-BrokerScheduledTask, loaded from it here, so the two tasks share one
# definition: the same S4U principal, the same settings, and the same pinned env file. Only the
# name and the script differ. -User is the account Install-Host.ps1 recorded as CHANNEL_TASK_USER,
# so the Duet process reads the state root under the same account the broker does and the ACLs grant.
#
# Idempotent: running it again updates the existing task in place.
param(
    [string]$TaskName = 'SapplefeldChannelsDuet',
    [string]$ScriptPath = (Join-Path $PSScriptRoot 'Start-Duet.ps1'),
    [string]$User = [Security.Principal.WindowsIdentity]::GetCurrent().Name,
    [string]$EnvFile
)

# Dot-sourced with this script's own arguments, so the broker script's parameter block binds these
# values rather than its own defaults into this scope, and its runner, which registers only when the
# script is run directly, stays quiet. It loads Install-Functions.ps1 itself.
. (Join-Path $PSScriptRoot 'Register-BrokerTask.ps1') -TaskName $TaskName -ScriptPath $ScriptPath -User $User -EnvFile $EnvFile

if ($MyInvocation.InvocationName -ne '.') {
    if (-not $EnvFile) { $EnvFile = Join-Path (Get-ChannelStateRoot) 'broker.env' }
    Register-BrokerScheduledTask -TaskName $TaskName -ScriptPath $ScriptPath -User $User -EnvFile $EnvFile
    Write-Host "Registered scheduled task '$TaskName' running '$ScriptPath' at system startup, at logon for '$User' and every two minutes while it is not running, reading '$EnvFile'."
}
