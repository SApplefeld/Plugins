# Runs the broker as source, with the runtime configuration Install-Host.ps1 wrote. This is the
# script the scheduled task actually launches; Register-BrokerTask.ps1 points a task at it.
#
# There is no build step (see the plan's Standing Brief Amendments): the broker is invoked as
# `node --import <broker/startup-crash.mjs URL> broker/index.ts`, which is the command a developer
# runs by hand plus a preload that records a loading failure in broker.log. Before each start,
# install/ensure-dependencies.mjs restores the dependencies when they no longer match the
# lockfile.
#
# The broker can ask to be restarted, by exiting with $RestartExitCode, and this script then starts
# it again onto whatever code and configuration are on disk now. Every other exit code ends the
# script with that code, so a broker that crashes or fails to start fails the task visibly rather
# than being relaunched at once into the same failure. The task's two-minute trigger, not this
# script, starts it again. A node that cannot be launched at all, or a
# functions file that cannot be loaded, ends the script with 1, on any pass.

param(
    # Defaults to the repository this script lives in, two levels up from install/. Overridable so
    # a test can point this at a fixture tree instead of the real checkout.
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),

    # Defaults to the standard state root so a bare invocation matches what Install-Host.ps1
    # provisions. Overridable for the same reason as $RepoRoot.
    [string]$EnvFile = $null
)

# Loaded here for the state root default below, and again at the top of every pass.
$functionsFile = Join-Path $PSScriptRoot 'Install-Functions.ps1'
. $functionsFile

# The code the broker exits with to ask for a fresh start; broker/index.ts's RESTART_EXIT_CODE is
# the same value.
$RestartExitCode = 75

if (-not $EnvFile) {
    $EnvFile = Join-Path (Get-ChannelStateRoot) 'broker.env'
}
# A full path, so a bare file name still has a folder for the dependency store beside it.
$EnvFile = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($EnvFile)

# The task's own environment before any pass ran, which does not change while the task runs. A
# PowerShell hashtable, so a lookup ignores case as Windows variable names do.
$taskEnvironment = @{}
foreach ($entry in [Environment]::GetEnvironmentVariables('Process').GetEnumerator()) {
    $taskEnvironment[[string]$entry.Key] = [string]$entry.Value
}

# Every key on any allowlist a pass has loaded during this task, so a key an update took off the
# list is still reset on the passes after. A PowerShell hashtable, so a key ignores case.
$restoredKeys = @{}

# Turns a message into one broker.log line's text. Replaces the class broker/sanitize.ts's
# isInvisible strips, plus U+0085, U+2028 and U+2029, which a log reader may take as line breaks: the
# class install/ensure-dependencies.mjs's appendLog replaces, copied because this script cannot import
# it. The supplementary range U+E0000 to U+E007F is written as its surrogate pairs for .NET.
function ConvertTo-BrokerLogText {
    param([string]$Message)
    return $Message -replace '[\u0000-\u001f\u007f\u0085\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufe00-\ufe0f\ufeff]|\uDB40[\uDC00-\uDC7F]', ' '
}

# Appends one line to the log file CHANNEL_BROKER_LOG_FILE names, where it names one, in broker.log's
# line shape. The path is trimmed as the broker trims it, so the line lands in the broker's own log. A
# log that cannot be written changes nothing about the pass: the same text also goes to the task's
# warning or error stream.
function Write-BrokerLogLine {
    param([string]$Level, [string]$Message)
    $logFile = "$env:CHANNEL_BROKER_LOG_FILE".Trim()
    if ($logFile -eq '') { return }
    $stamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
    $line = "$stamp [$Level] Start-Broker: $(ConvertTo-BrokerLogText $Message)`n"
    try {
        [System.IO.File]::AppendAllText($logFile, $line, [System.Text.UTF8Encoding]::new($false))
    } catch {
        # Dropped, by design.
    }
}

# Each pass loads the functions file again before it applies the env file, so the allowlist a pass
# filters through is the one on disk now: a key a plugin update added to it applies at the next
# restart. The one file a pass cannot re-read is this script itself, which the task read at launch.
# A load that throws, or that leaves the allowlist or a function a pass calls undefined, ends the
# task with 1 rather than starting a pass on the last pass's list. A file with no metadata list, as
# a checkout from before the list has, runs on with an empty one, so those keys are logged rather
# than the task ended. Both lists are cleared first, so a list the file no longer declares is not
# the last load's.
while ($true) {
    $script:ChannelBrokerEnvAllowlist = $null
    $script:ChannelBrokerEnvFileMetadataKeys = $null
    $loadFailure = $null
    try {
        . $functionsFile
        if ($null -eq $script:ChannelBrokerEnvAllowlist) {
            $loadFailure = 'it does not declare the allowlist'
        }
        # A file cut between two statements loads without error, so the functions a pass calls are
        # checked too. At launch no earlier load has defined them.
        foreach ($name in @('Get-ChannelEnvFile', 'Set-ChannelBrokerEnvironment')) {
            if (-not (Get-Command -Name $name -CommandType Function -ErrorAction SilentlyContinue)) {
                $loadFailure = "it does not define $name"
            }
        }
        if ($null -eq $script:ChannelBrokerEnvFileMetadataKeys) {
            $script:ChannelBrokerEnvFileMetadataKeys = @()
        }
    } catch {
        $loadFailure = $_.Exception.Message
    }
    if ($null -ne $loadFailure) {
        $message = "could not load '$functionsFile': $loadFailure"
        # The log path here is the last pass's, or on the first pass the task's own: this pass has not
        # applied the env file yet.
        Write-BrokerLogLine -Level 'error' -Message $message
        Write-Error "Start-Broker: $message"
        exit 1
    }

    # Every key on any list loaded so far starts the pass from the task's own value, so a pass starts
    # from what a fresh task start would see: a key removed from the file or from the list since the
    # last pass is not carried into the next, and a key the task's environment supplied is not lost.
    # A key with no task value restores to null, which removes the variable.
    foreach ($key in $script:ChannelBrokerEnvAllowlist) {
        $restoredKeys[$key] = $true
    }
    foreach ($key in $restoredKeys.Keys) {
        [Environment]::SetEnvironmentVariable($key, $taskEnvironment[$key], 'Process')
    }

    $nodePath = 'node'
    if (Test-Path -LiteralPath $EnvFile) {
        # Only the allowlisted keys become environment variables; see Set-ChannelBrokerEnvironment
        # for why write access to this file must not be arbitrary environment injection into the
        # process that reads the bot token.
        Set-ChannelBrokerEnvironment -Path $EnvFile
        $raw = Get-ChannelEnvFile -Path $EnvFile
        # The function's warning reaches only the task's console output, so each key on neither the
        # allowlist nor the metadata list is also named in broker.log. Written after the file is
        # applied, so a log path the file set on this pass is the one used.
        $refused = @($raw.Keys | Where-Object {
                $script:ChannelBrokerEnvAllowlist -notcontains $_ -and
                $script:ChannelBrokerEnvFileMetadataKeys -notcontains $_
            } | Sort-Object)
        foreach ($key in $refused) {
            Write-BrokerLogLine -Level 'warn' -Message ("'$key' in '$EnvFile' is not a recognized broker " +
                "setting and was not applied.")
        }
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
    # restores the dependencies when they no longer match package-lock.json. It runs under the
    # same pinned node, and a tree with no lockfile has nothing to install, matching the helper's own
    # rule. The helper is this script's sibling and is pointed at $RepoRoot, so a -RepoRoot fixture
    # is checked with the real helper. The helper installs into the dependency store beside the env
    # file, under the state root a plugin update does not replace, and links the checkout's
    # node_modules to it. The store comes from -EnvFile rather than a fresh state root lookup, so a
    # fixture's env file keeps its store inside the fixture. With a log file configured, the
    # helper's outcome line lands in broker.log beside the broker's own.
    if (Test-Path -LiteralPath (Join-Path $RepoRoot 'package-lock.json')) {
        $dependencyStore = Join-Path (Split-Path -Parent $EnvFile) 'dependencies'
        $helperArgs = @(
            (Join-Path $PSScriptRoot 'ensure-dependencies.mjs'), '--root', $RepoRoot, '--store', $dependencyStore
        )
        $helperLog = "$env:CHANNEL_BROKER_LOG_FILE".Trim()
        if ($helperLog -ne '') {
            $helperArgs += @('--log', $helperLog)
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
