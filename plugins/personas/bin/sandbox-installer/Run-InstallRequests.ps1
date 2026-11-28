# The entry of the SandboxInstaller scheduled task: loads installer-functions.ps1 beside it and runs
# one wake of the installer, which takes at most one persona's install request from the requests
# folder, runs one Claude Code session for it and publishes its answer. The task runs it from the
# administrator clone as the administrator account at the highest run level, at startup and every
# two minutes:
#
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <this script's path>
#
# -InstallerRoot names the installer's tree, by default C:\Program Files\SandboxSetup\installer.
# -SessionProgram names the session program, by default claude. Each function's comment in
# installer-functions.ps1 states what the wake does. The script runs in Windows PowerShell 5.1 and
# refuses PowerShell 7 with one line and exit 1.
[CmdletBinding()]
param(
    [string]$InstallerRoot,
    [string]$SessionProgram = 'claude'
)

if ($PSVersionTable.PSEdition -ne 'Desktop') {
    [Console]::Error.WriteLine('Run-InstallRequests.ps1 runs in Windows PowerShell 5.1 and refuses PowerShell 7.')
    exit 1
}

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'installer-functions.ps1')

$wake = @{ SessionProgram = $SessionProgram }
if ($InstallerRoot) { $wake['Root'] = $InstallerRoot }
[void](Invoke-InstallerWake @wake)
exit 0
