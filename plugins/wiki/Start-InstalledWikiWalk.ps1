#Requires -Version 7.0
# Runs the installed wiki plugin's walker, kb-walk.ps1. This is the script the wiki-walk task runs
# when register-walk.ps1 installed it into a launcher root, under PowerShell 7:
#
#   pwsh -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File <LauncherRoot>\Start-InstalledWikiWalk.ps1
#
# Registration copies this file and installed-plugin-functions.ps1, which it dot-sources for the
# record lookup, into the launcher root, a folder outside the plugin cache, so the task's action
# names one path that no plugin update moves. At each fire the script reads the wiki@applefeld record
# from installed_plugins.json under CLAUDE_CONFIG_DIR, or under %USERPROFILE%\.claude where that is
# unset, checks that the install folder holds kb-walk.ps1, kb-registry.ps1, template\.claude\kb-run.ps1
# and .claude-plugin\plugin.json, copies the install folder to %LOCALAPPDATA%\llm-wiki\runtime\<version>
# unless that snapshot is already there, and runs the snapshot's kb-walk.ps1, exiting with its exit
# code.
#
# The walker runs from the snapshot rather than from the cache folder because the cache folder is
# named for one version and Claude Code may remove it once a newer version is installed, while the
# walker is still reading its scripts. A copy goes to a temporary sibling folder and is renamed into
# place only when it holds every required file. A snapshot folder already there is used only when it
# holds every required file too; one missing any, left by a removal that failed partway, is removed
# and copied again, so a partial snapshot is never run. A temporary copy left by a launcher that was
# killed mid-copy is removed by a later start once it is an hour old.
#
# Before it starts the walker, the script tries to open %LOCALAPPDATA%\llm-wiki\walk.lock for
# exclusive access, the file the walker locks for a pass. Where it opens, no pass is running, and the
# script removes every snapshot folder named for another version, then releases the lock. Where the
# open fails, a pass holds it and nothing is removed. A snapshot that cannot be removed is logged and
# the run goes on.
#
# Where the list file is absent or holds no record for the plugin, the script runs the kb-walk.ps1
# beside itself, so an engine checkout registers too.
#
# The walker runs in this script's own process, so the task's process is the walker's: a task end,
# Stop-ScheduledTask or the execution time limit ends the walker with it and frees walk.lock. The
# working directory is the walker's folder, the snapshot, and the claude path resolved on the
# account's PATH is passed as -Claude. For the call the console's output and error writers are
# pointed at walk-output.log and walk-output.err.log beside the walker's own files, each overwritten
# at every pass, and the walker's pipeline output goes to walk-output.log too; the writers are
# restored afterward. The walker writes child output straight to the console writers, so this keeps
# its relayed output in those two files. The walker's own walk.log and walk-status.json remain the
# record of a pass.
#
# A refusal (a missing functions file, an unreadable list, a record with no install path or a bad
# version, an install folder missing a required file, a failed copy, no walker to run, a walker that
# threw or failed to bind its parameters) is one line in %LOCALAPPDATA%\llm-wiki\walk-launcher.log,
# the same line on stderr and exit 1, since a scheduled task gives stderr no console and a silent 0
# would read as a clean pass. A walker that exits non-zero adds one ERROR line there with its exit
# code and the last line of walk-output.err.log, and the script exits with that code, since the
# error file is overwritten at the next fire. A fire that runs the walker to exit 0 writes no line
# there unless claude is not on PATH or a snapshot could not be removed.
[CmdletBinding()]
param()

$script:PluginId = 'wiki@applefeld'
$script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

# What an install folder must hold: the walker, the registry it loads, the wrapper it runs per wiki
# and the plugin manifest.
$script:RequiredFiles = @(
    'kb-walk.ps1',
    'kb-registry.ps1',
    'template\.claude\kb-run.ps1',
    '.claude-plugin\plugin.json'
)

# How old a leftover temporary copy must be before a start removes it.
$script:StaleTempAge = [TimeSpan]::FromHours(1)

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    [Console]::Error.WriteLine('Start-InstalledWikiWalk: LOCALAPPDATA is not set, so the launcher''s folder is unknown.')
    exit 1
}
$script:WalkDir = Join-Path $env:LOCALAPPDATA 'llm-wiki'
$script:LogPath = Join-Path $script:WalkDir 'walk-launcher.log'

<#
.SYNOPSIS
Appends one timestamped line to walk-launcher.log as UTF-8 without a byte-order mark.

.DESCRIPTION
A failed append goes to stderr, the only other channel the launcher has. The log is not rotated: it
takes a line only on a refusal or a warning.
#>
function Write-LauncherLog {
    param([Parameter(Mandatory)][string]$Text)
    $stamp = [DateTime]::UtcNow.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    try {
        [void][System.IO.Directory]::CreateDirectory($script:WalkDir)
        [System.IO.File]::AppendAllText($script:LogPath, "$stamp $Text" + [Environment]::NewLine, $script:Utf8NoBom)
    } catch {
        [Console]::Error.WriteLine("Start-InstalledWikiWalk: could not append to '$script:LogPath': $($_.Exception.Message)")
    }
}

<#
.SYNOPSIS
Logs a refusal, writes it to stderr and exits 1.
#>
function Stop-LauncherWithError {
    param([Parameter(Mandatory)][string]$Text)
    Write-LauncherLog "ERROR $Text"
    [Console]::Error.WriteLine("Start-InstalledWikiWalk: $Text")
    exit 1
}

<#
.SYNOPSIS
Returns the required files an install folder lacks.
#>
function Get-MissingRequiredFiles {
    param([Parameter(Mandatory)][string]$Folder)
    return @($script:RequiredFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $Folder $_) -PathType Leaf) })
}

<#
.SYNOPSIS
Returns the snapshot folder for one plugin version, copying it from the install folder first where it
is not there yet.

.DESCRIPTION
The copy goes to a temporary folder named for this process and is renamed into place, so a reader
never sees a half-copied snapshot. A rename that loses to another launcher's finds the snapshot
present, discards its own copy and returns the winner's. A snapshot already present is returned only
where it holds every required file; one missing any, which a removal that failed partway leaves, is
removed and copied again. A removal that fails throws.
#>
function Install-WalkSnapshot {
    param(
        [Parameter(Mandatory)][string]$InstallPath,
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$RuntimeRoot
    )
    $snapshot = Join-Path $RuntimeRoot $Version
    if (Test-Path -LiteralPath $snapshot -PathType Container) {
        if ((Get-MissingRequiredFiles -Folder $snapshot).Count -eq 0) { return $snapshot }
        Remove-Item -LiteralPath $snapshot -Recurse -Force -ErrorAction Stop
    }
    [void][System.IO.Directory]::CreateDirectory($RuntimeRoot)
    $temp = Join-Path $RuntimeRoot ".$Version.$PID.tmp"
    try {
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction Stop }
        Copy-Item -LiteralPath $InstallPath -Destination $temp -Recurse -Force -ErrorAction Stop
        $missing = Get-MissingRequiredFiles -Folder $temp
        if ($missing.Count -gt 0) {
            throw "the copy is incomplete, missing $($missing -join ', ')"
        }
        try {
            [System.IO.Directory]::Move($temp, $snapshot)
        } catch {
            if (-not (Test-Path -LiteralPath $snapshot -PathType Container)) { throw }
            Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
        throw
    }
    return $snapshot
}

<#
.SYNOPSIS
Removes temporary copies under the runtime root that are older than $script:StaleTempAge.

.DESCRIPTION
Only folders named the way Install-WalkSnapshot names its temporary copies are touched, and only once
they are old enough that no live copy can still be writing them. A removal that fails is left for a
later start.
#>
function Remove-StaleTempCopies {
    param([Parameter(Mandatory)][string]$RuntimeRoot)
    if (-not (Test-Path -LiteralPath $RuntimeRoot -PathType Container)) { return }
    $cutoff = [DateTime]::UtcNow - $script:StaleTempAge
    foreach ($dir in @(Get-ChildItem -LiteralPath $RuntimeRoot -Directory -Force -ErrorAction SilentlyContinue)) {
        if ($dir.Name -like '.*.tmp' -and $dir.LastWriteTimeUtc -lt $cutoff) {
            Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

<#
.SYNOPSIS
Removes the snapshots of every version but the one about to run, where no walker pass is running.

.DESCRIPTION
The walker holds walk.lock open exclusively for a whole pass. This opens it the same way: if the open
throws, a pass is running, and nothing is removed. If it opens, no pass is running and the other
versions' snapshot folders are removed while the handle is held, so a pass cannot start under the
removal. The handle is released before this returns, so the walker started next can take the lock.
Folders whose names start with a dot are temporary copies, which Remove-StaleTempCopies owns. A
folder that cannot be removed is logged and left.
#>
function Remove-OtherSnapshots {
    param(
        [Parameter(Mandatory)][string]$RuntimeRoot,
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$LockPath
    )
    $lock = $null
    try {
        $lock = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    } catch {
        return
    }
    try {
        foreach ($dir in @(Get-ChildItem -LiteralPath $RuntimeRoot -Directory -Force -ErrorAction SilentlyContinue)) {
            if ($dir.Name.StartsWith('.') -or $dir.Name -ieq $Version) { continue }
            try {
                Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction Stop
            } catch {
                Write-LauncherLog "WARN could not remove the snapshot '$($dir.FullName)': $($_.Exception.Message)"
            }
        }
    } finally {
        $lock.Dispose()
    }
}

try {
    # The log, the lock, the output files and the runtime folder all live here.
    [void][System.IO.Directory]::CreateDirectory($script:WalkDir)

    # Get-InstalledPluginRecord lives in the shared functions file registration copies beside this one.
    $sharedFunctions = Join-Path $PSScriptRoot 'installed-plugin-functions.ps1'
    if (-not (Test-Path -LiteralPath $sharedFunctions -PathType Leaf)) {
        Stop-LauncherWithError "the shared functions file '$sharedFunctions' is missing; re-run the registration to install it"
    }
    . $sharedFunctions

    $configDir = $env:CLAUDE_CONFIG_DIR
    if ([string]::IsNullOrWhiteSpace($configDir)) { $configDir = Join-Path $env:USERPROFILE '.claude' }
    $listPath = Join-Path (Join-Path $configDir 'plugins') 'installed_plugins.json'

    $record = $null
    try {
        $record = Get-InstalledPluginRecord -Path $listPath -Id $script:PluginId
    } catch {
        Stop-LauncherWithError $_.Exception.Message
    }

    if ($null -eq $record) {
        # No installed record: the walker beside this launcher runs, as an engine checkout's does.
        $walkerRoot = $PSScriptRoot
        if (-not (Test-Path -LiteralPath (Join-Path $walkerRoot 'kb-walk.ps1') -PathType Leaf)) {
            Stop-LauncherWithError "'$($script:PluginId)' has no record in '$listPath' and there is no kb-walk.ps1 beside the launcher in '$walkerRoot'"
        }
    } else {
        $missing = Get-MissingRequiredFiles -Folder $record.InstallPath
        if ($missing.Count -gt 0) {
            Stop-LauncherWithError ("'$($script:PluginId)' $($record.Version) at '$($record.InstallPath)' is missing " + ($missing -join ', '))
        }
        $runtimeRoot = Join-Path $script:WalkDir 'runtime'
        Remove-StaleTempCopies -RuntimeRoot $runtimeRoot
        try {
            $walkerRoot = Install-WalkSnapshot -InstallPath $record.InstallPath -Version $record.Version -RuntimeRoot $runtimeRoot
        } catch {
            Stop-LauncherWithError "snapshot of '$($record.InstallPath)' failed: $($_.Exception.Message)"
        }
        Remove-OtherSnapshots -RuntimeRoot $runtimeRoot -Version $record.Version -LockPath (Join-Path $script:WalkDir 'walk.lock')
    }

    # The claude path is resolved here, on the account's PATH, and handed to the walker.
    $walkerArguments = @{}
    $claudeCommand = Get-Command -Name 'claude' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $claudeCommand) {
        $walkerArguments['Claude'] = $claudeCommand.Source
    } else {
        Write-LauncherLog 'WARN claude was not found on PATH; the walker runs without -Claude'
    }

    # The walker runs in this process. A terminating error from it, or a failure to bind its
    # parameters, lands in the catch below as a refusal with exit 1.
    $outPath = Join-Path $script:WalkDir 'walk-output.log'
    $errPath = Join-Path $script:WalkDir 'walk-output.err.log'
    $originalOut = [Console]::Out
    $originalError = [Console]::Error
    $outWriter = $null
    $errWriter = $null
    $global:LASTEXITCODE = 0
    try {
        $outWriter = [System.IO.StreamWriter]::new($outPath, $false, $script:Utf8NoBom)
        $outWriter.AutoFlush = $true
        $errWriter = [System.IO.StreamWriter]::new($errPath, $false, $script:Utf8NoBom)
        $errWriter.AutoFlush = $true
        Set-Location -LiteralPath $walkerRoot
        [Environment]::CurrentDirectory = $walkerRoot
        [Console]::SetOut($outWriter)
        [Console]::SetError($errWriter)
        & (Join-Path $walkerRoot 'kb-walk.ps1') @walkerArguments | ForEach-Object { [Console]::Out.WriteLine([string]$_) }
    } finally {
        [Console]::SetOut($originalOut)
        [Console]::SetError($originalError)
        if ($null -ne $outWriter) { $outWriter.Dispose() }
        if ($null -ne $errWriter) { $errWriter.Dispose() }
    }
    $walkerExit = [int]$global:LASTEXITCODE
    if ($walkerExit -ne 0) {
        $lastError = @(Get-Content -LiteralPath $errPath -ErrorAction SilentlyContinue | Where-Object { $_.Trim() -ne '' }) | Select-Object -Last 1
        if ([string]::IsNullOrEmpty($lastError)) {
            Write-LauncherLog "ERROR the walker exited $walkerExit"
        } else {
            Write-LauncherLog "ERROR the walker exited ${walkerExit}: $lastError"
        }
    }
    exit $walkerExit
} catch {
    Stop-LauncherWithError "unexpected failure: $($_.Exception.Message)"
}
