# Runs the Duet server as source, with the runtime configuration Install-Host.ps1 wrote. This is the
# script the Duet scheduled task launches; Register-DuetTask.ps1 points a task at it.
#
# The server is `node duet\index.ts`, the command a developer runs by hand, reading the broker's own
# environment file: the CHANNEL_DUET_* keys are its own, and the CHANNEL_WEB_* keys place its
# approval page and the broker it reads. One run, no relaunch loop: the server exits only on a
# signal or a failure, and the task's two-minute trigger starts it again. The dependencies are the
# broker's, restored before every broker start by install/ensure-dependencies.mjs, so this script
# restores nothing. With CHANNEL_DUET_ENABLED off the script ends with 0 and launches no node. A
# node that cannot be launched ends the script with 1.

param(
    # Defaults to the repository this script lives in, two levels up from install/. Overridable so
    # a test can point this at a fixture tree instead of the real checkout.
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),

    # Defaults to the standard state root so a bare invocation matches what Install-Host.ps1
    # provisions. Overridable for the same reason as $RepoRoot.
    [string]$EnvFile = $null
)

. (Join-Path $PSScriptRoot 'Install-Functions.ps1')

if (-not $EnvFile) {
    $EnvFile = Join-Path (Get-ChannelStateRoot) 'broker.env'
}
$EnvFile = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($EnvFile)

# The switch is read here before node is launched, so the task's two-minute trigger starts no node
# on a host where Duet is off. The spellings read as on are the broker's own: 1, true, yes or on,
# trimmed and in any case. With no config the switch is off.
if (-not (Test-Path -LiteralPath $EnvFile)) {
    Write-Host "Start-Duet: no config at '$EnvFile', so CHANNEL_DUET_ENABLED is off; exiting."
    exit 0
}
$raw = Get-ChannelEnvFile -Path $EnvFile
$duetSwitch = ''
if ($raw.Contains('CHANNEL_DUET_ENABLED')) { $duetSwitch = ([string]$raw['CHANNEL_DUET_ENABLED']).Trim().ToLowerInvariant() }
if ($duetSwitch -cnotin @('1', 'true', 'yes', 'on')) {
    Write-Host "Start-Duet: CHANNEL_DUET_ENABLED is off in '$EnvFile'; exiting."
    exit 0
}

# Only the allowlisted keys become environment variables; see Set-ChannelBrokerEnvironment for why
# write access to this file must not be arbitrary environment injection into the process.
Set-ChannelBrokerEnvironment -Path $EnvFile
# Pinned by Install-Host.ps1 at install time rather than resolved from PATH here, under
# -ExecutionPolicy Bypass, where PATH is whatever the triggering logon happened to carry.
$nodePath = 'node'
if ($raw.Contains('CHANNEL_NODE_EXE') -and -not [string]::IsNullOrWhiteSpace($raw['CHANNEL_NODE_EXE'])) {
    $nodePath = $raw['CHANNEL_NODE_EXE']
}

$duetEntry = Join-Path $RepoRoot 'duet\index.ts'
if (-not (Test-Path -LiteralPath $duetEntry)) {
    throw "Start-Duet: Duet entry point not found at '$duetEntry'. Is `$RepoRoot correct?"
}

# A node that cannot be launched sets no exit code, and PowerShell carries on past the failure, so
# the code is cleared first: otherwise a failed launch reads nothing and ends the task as a success.
$global:LASTEXITCODE = $null
& $nodePath $duetEntry
$exitCode = $LASTEXITCODE
if ($null -eq $exitCode) {
    Write-Error "Start-Duet: could not launch node at '$nodePath'."
    exit 1
}
exit $exitCode
