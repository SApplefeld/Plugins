# Runs the broker as source, with the runtime configuration Install-Host.ps1 wrote. This is the
# script the scheduled task actually launches; Register-BrokerTask.ps1 points a task at it.
#
# There is no build step (see the plan's Standing Brief Amendments): the broker is invoked as
# `node --import <broker/startup-crash.mjs URL> broker/index.ts`, which is the command a developer
# runs by hand plus a preload that records a loading failure in broker.log. Before each start,
# install/ensure-dependencies.mjs reinstalls the dependencies when they no longer match the
# lockfile.
#
# The broker can ask to be restarted, by exiting with $RestartExitCode, and this script then starts
# it again onto whatever code and configuration are on disk now. Every other exit code ends the
# script with that code, so a broker that crashes or fails to start still fails the task visibly
# rather than being relaunched into the same failure. A node that cannot be launched at all ends the
# script with 1, on any pass.

param(
    # Defaults to the repository this script lives in, two levels up from install/. Overridable so
    # a test can point this at a fixture tree instead of the real checkout.
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),

    # Defaults to the standard state root so a bare invocation matches what Install-Host.ps1
    # provisions. Overridable for the same reason as $RepoRoot.
    [string]$EnvFile = $null
)

. (Join-Path $PSScriptRoot 'Install-Functions.ps1')

# The code the broker exits with to ask for a fresh start; broker/index.ts's RESTART_EXIT_CODE is
# the same value.
$RestartExitCode = 75

if (-not $EnvFile) {
    $EnvFile = Join-Path (Get-ChannelStateRoot) 'broker.env'
}

# The value each key the env file may set held in the task's own environment before any pass ran,
# null where it held none. Each pass restores these before applying the file, so a pass starts from
# what a fresh task start would see: a key removed from the file since the last pass is not carried
# into the next, and a key the task's environment supplied is not lost.
$taskEnvironment = @{}
foreach ($key in $script:ChannelBrokerEnvAllowlist) {
    $taskEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}

while ($true) {
    foreach ($key in $taskEnvironment.Keys) {
        # A null value removes the variable, which is what an unset key restores to.
        [Environment]::SetEnvironmentVariable($key, $taskEnvironment[$key], 'Process')
    }

    $nodePath = 'node'
    if (Test-Path -LiteralPath $EnvFile) {
        # Only the allowlisted keys become environment variables; see Set-ChannelBrokerEnvironment
        # for why write access to this file must not be arbitrary environment injection into the
        # process that reads the bot token.
        Set-ChannelBrokerEnvironment -Path $EnvFile
        $raw = Get-ChannelEnvFile -Path $EnvFile
        # Pinned by Install-Host.ps1 at install time rather than resolved from PATH here, under
        # -ExecutionPolicy Bypass, where PATH is whatever the triggering logon happened to carry.
        # Read on every pass, so a node path the file changed takes effect at the relaunch.
        if ($raw.Contains('CHANNEL_NODE_EXE') -and -not [string]::IsNullOrWhiteSpace($raw['CHANNEL_NODE_EXE'])) {
            $nodePath = $raw['CHANNEL_NODE_EXE']
        }
    } else {
        # No config yet is not fatal: the broker starts with every knob at its default (see
        # broker/config.ts), which is a registry-only broker with no Discord surfaces, exactly like
        # a local debugging run. Install-Host.ps1 is what makes this file exist.
        Write-Warning "Start-Broker: no config at '$EnvFile'; starting with defaults (no Discord surfaces)."
    }

    $brokerEntry = Join-Path $RepoRoot 'broker\index.ts'
    if (-not (Test-Path -LiteralPath $brokerEntry)) {
        throw "Start-Broker: broker entry point not found at '$brokerEntry'. Is `$RepoRoot correct?"
    }

    # A plugin update re-clones this folder without node_modules, so before every pass the helper
    # reinstalls the dependencies when they no longer match package-lock.json. It runs under the
    # same pinned node, and a tree with no lockfile has nothing to install, matching the helper's own
    # rule. The helper is this script's sibling and is pointed at $RepoRoot, so a -RepoRoot fixture
    # is checked with the real helper. With a log file configured, the helper's outcome line lands
    # in broker.log beside the broker's own.
    if (Test-Path -LiteralPath (Join-Path $RepoRoot 'package-lock.json')) {
        $helperArgs = @((Join-Path $PSScriptRoot 'ensure-dependencies.mjs'), '--root', $RepoRoot)
        if (-not [string]::IsNullOrWhiteSpace($env:CHANNEL_BROKER_LOG_FILE)) {
            $helperArgs += @('--log', $env:CHANNEL_BROKER_LOG_FILE)
        }
        # Cleared first for the same reason as the node launch below: a node that cannot be launched
        # sets no exit code of its own.
        $global:LASTEXITCODE = $null
        & $nodePath @helperArgs
        $helperExitCode = $LASTEXITCODE
        if ($null -eq $helperExitCode) {
            Write-Error "Start-Broker: could not launch node at '$nodePath' to check the dependencies."
            exit 1
        }
        # A broker started over missing or stale dependencies dies loading them, so a failed heal
        # ends the task with the helper's code, and its reason is already on stderr and in the log.
        if ($helperExitCode -ne 0) {
            exit $helperExitCode
        }
    }

    # The preload records a failure to load the broker's modules in broker.log, which happens before
    # the broker's own logger exists. Passed as a file URL, the form --import takes for an absolute
    # Windows path. A tree without the file starts the broker without it.
    $nodeArgs = @()
    $preload = Join-Path $RepoRoot 'broker\startup-crash.mjs'
    if (Test-Path -LiteralPath $preload) {
        $nodeArgs += @('--import', ([System.Uri]$preload).AbsoluteUri)
    }
    $nodeArgs += $brokerEntry

    # Tells the broker a restart it accepts will be followed by a fresh start. A broker run any
    # other way refuses to restart, since nothing would start it again.
    $env:CHANNEL_BROKER_SUPERVISED = '1'
    # A node that cannot be launched sets no exit code, and PowerShell carries on past the failure,
    # so the code is cleared first: otherwise a failed launch reads the last pass's 75 and relaunches
    # without end, or on the first pass reads nothing and ends the task as a success. The check
    # below relies on the default error preference, under which a failed launch does not end the
    # script before it.
    $global:LASTEXITCODE = $null
    # $? is no test of the launch here, since a node that ran and exited non-zero clears it too.
    & $nodePath @nodeArgs
    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode) {
        Write-Error "Start-Broker: could not launch node at '$nodePath'."
        exit 1
    }
    if ($exitCode -ne $RestartExitCode) {
        exit $exitCode
    }
    # The task has no console, so this line is for a run by hand; the broker's own log carries the
    # restart's reason.
    Write-Output "Start-Broker: the broker exited $RestartExitCode asking for a restart; starting it again."
}
