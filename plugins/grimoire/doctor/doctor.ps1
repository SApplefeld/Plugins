# Health check and setup for the grimoire plugin on this machine.
#
# Ships inside the plugin payload so every machine with the plugin installed
# has the current doctor, clone or not. The repo root keeps thin forwarders
# (doctor.ps1 / doctor.cmd) for the dev-clone habit.
#
# Verifies core setup (execution policy, files left under the plugin's former
# name, doctrine import and freshness, kaizen signpost, git hooks on a clone),
# the ANTHROPIC_API_KEY hazard, the hook layer (hook-canary wiring, node, the
# memq shim), the .kit/ state directory's exposure, the shared memory database
# on the host, the loopback embedding server, the auto-compaction window, the
# retired sidecar's task and state folder, the output style, a status-line
# setting that still names the kit's launcher, and the plugin's install.
#
#   .\doctor.ps1              Check only; prints PASS/WARN/FAIL with remediations.
#   .\doctor.ps1 -Fix         Also applies the safe durable repairs (execution
#                             policy, the memq shim into ~\.claude\bin,
#                             signpost + git hooks on a clone, a memq db-refresh
#                             where the memory database step warns, the move
#                             of files left under the plugin's former name
#                             and the rewrite of a CLAUDE.md import line that
#                             is exactly that name's token, and, each behind
#                             its own consent prompt, the autoCompactWindow
#                             and outputStyle values written into user
#                             settings.json, the plugin install, and the
#                             embedding server's install into
#                             ~\.claude\kit-embedding-server, its scheduled
#                             task and its config block, where it deletes and
#                             refetches a download whose SHA-256 differs from
#                             its pin). Behind
#                             one more consent prompt it disarms the retired
#                             sidecar: it unregisters the scheduled task
#                             claude-kit-sidecar-daemon, stops that daemon's
#                             node process under the kit clone, and removes
#                             ~\.claude\kit-sidecar with everything in it.
#                             Beyond those folders it deletes only files its own
#                             run wrote: the temp file a failed signpost write
#                             or import-line rewrite left, the embedding block
#                             writer's temp file, and the settings writer's
#                             temp file and pre-write backup.
#   .\doctor.ps1 -Fix -Yes    Pre-answers the consent prompts -Fix already
#                             requested, for unattended runs. It authorizes
#                             nothing by itself.
# If scripts are blocked entirely, use the wrapper beside this file:
#   doctor.cmd [-Fix] [-Yes]
# Exit code: 0 when nothing FAILs (warnings allowed), 1 otherwise.

# An unrecognised switch must be a hard error, not a silent extra argument:
# a simple param block binds one into $args and runs anyway, so a flag this
# script no longer accepts would report a clean run having done nothing.
[CmdletBinding()]
param([switch]$Fix, [switch]$Yes)

# Windows PowerShell 5.1 inherits PSModulePath from whatever parent launched it.
# A pwsh 7+ parent (the Claude Code harness, a pwsh terminal) puts its own
# module directories first, and those shadow 5.1's built-in modules: cmdlet
# autoload then finds the pwsh edition of Microsoft.PowerShell.Security and
# fails to load it ("command was found in the module ... but the module could
# not be loaded"), taking Get-ExecutionPolicy down with it. Reset this process's
# PSModulePath to the 5.1 default set; the change dies with the process.
# [Environment]::GetFolderPath follows a OneDrive-redirected Documents folder.
if ($PSVersionTable.PSVersion.Major -le 5) {
    $env:PSModulePath = @(
        (Join-Path ([Environment]::GetFolderPath("MyDocuments")) "WindowsPowerShell\Modules"),
        (Join-Path $env:ProgramFiles "WindowsPowerShell\Modules"),
        (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\Modules")
    ) -join ";"
}

$script:failCount = 0
$script:warnCount = 0

function Report {
    param([string]$Status, [string]$Name, [string[]]$Detail = @())
    # A declined -Fix prompt leads the next report's detail, which is the
    # report of the check that asked: every Get-Consent caller reports straight
    # after its prompt, with no other report between.
    if ($null -ne $script:consentDeclinedNote) {
        $Detail = @($script:consentDeclinedNote) + $Detail
        $script:consentDeclinedNote = $null
    }
    $colors = @{ PASS = "Green"; WARN = "Yellow"; FAIL = "Red"; INFO = "Gray"; FIXED = "Cyan" }
    Write-Host ("[{0,-5}] {1}" -f $Status, $Name) -ForegroundColor $colors[$Status]
    foreach ($line in $Detail) { Write-Host "        $line" }
    if ($Status -eq "FAIL") { $script:failCount++ }
    if ($Status -eq "WARN") { $script:warnCount++ }
}

# Consent gate for an action that changes this machine: installing software, or
# writing a value into user settings. Only ever true under -Fix; -Yes pre-answers
# for unattended runs (it consents to what -Fix already asked for, it never asks
# for more); a non-interactive host that cannot prompt declines rather than
# stalling.
#
# -Interactive withholds the -Yes shortcut for the one class of action -Yes must
# not cover: replacing a value the operator chose, as opposed to supplying one
# that is missing or repairing state the kit itself owns. That class is not
# idempotent against intent. An unattended run cannot tell a deliberate setting
# from a stale one, so it would revert the deliberate one, and would do it again
# after every retune of the constant it compares against. Such an action asks for
# more than the flags did, so it waits for a person.
#
# A decline is held in $script:consentDeclinedNote rather than printed here.
# The prompt runs before the check that asked has printed its heading, so a
# line printed here lands under the previous check's heading. Report prints
# the held line under the asking check's own heading instead.
$script:consentDeclinedNote = $null
function Get-Consent {
    param([string]$Question, [switch]$Interactive)
    if (-not $Fix) { return $false }
    if ($Yes -and -not $Interactive) { return $true }
    # The unattended remedy is real advice for an ordinary prompt and false
    # advice for an -Interactive one, where -Yes is exactly what does not apply.
    $unattendedNote = if ($Interactive) { "this one needs a person, since it replaces a value you chose" } else { "add -Yes to consent unattended" }
    try {
        $answer = Read-Host "$Question [y/N]"
        if ([string]::IsNullOrWhiteSpace($answer)) {
            $script:consentDeclinedNote = "Declined the -Fix prompt for this check: no answer came, and a redirected stdin cannot answer prompts; $unattendedNote."
            return $false
        }
        return $answer -match '^[Yy]'
    }
    catch {
        $script:consentDeclinedNote = "Declined the -Fix prompt for this check: this host is non-interactive and cannot show it; $unattendedNote."
        return $false
    }
}

# The sanitizer every foreign string in this report goes through, beside this
# script. The memory database host probe dot-sources the same file, since the
# Memory database step below prints that probe's lines on this channel, and one
# channel takes one sanitizer. The cap is stated at every call: 120 for a line
# of this report, wider where a quoted value earns it.
. (Join-Path $PSScriptRoot "sanitize-line.ps1")

# --- Locate the payload and, when present, the surrounding repo clone. Dev-only
# --- checks (kaizen signpost writing, git hook wiring) apply only to a clone;
# --- an installed plugin cache must never register itself as the clone.
$pluginRoot = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $pluginRoot ".claude-plugin\plugin.json"))) {
    Report "FAIL" "Plugin payload root" @("Expected .claude-plugin\plugin.json one level above this script; the doctor must live at <plugin>\doctor\doctor.ps1.")
    exit 1
}
$claudeDir = Join-Path $env:USERPROFILE ".claude"

# Shim install, integrity, and PATH-membership helpers, beside this script.
# Dot-sourced here rather than at the check, because Add-ToUserPath below
# uses the PATH predicate it defines.
. (Join-Path $PSScriptRoot "install-memq-shim.ps1")

# Auto-compaction-window writer for user settings.json, beside this script.
# It resolves no paths of its own: this script passes the settings path in,
# and the test suite passes a sandbox path.
. (Join-Path $PSScriptRoot "install-compact-window.ps1")

# Embedding-server state, install and config-block writer, beside this
# script. It resolves no paths of its own: the Embedding server step passes
# the install root, the config path and the task name in, and the test suite
# passes a fixture home's.
. (Join-Path $PSScriptRoot "install-embedding-server.ps1")

# Append a directory to the durable user PATH, and to this process's PATH so
# the current run sees it too. Every kit PATH repair goes through this one
# function.
#
# The registry value is read and written raw. [Environment]::GetEnvironment-
# Variable expands a REG_EXPAND_SZ Path, and SetEnvironmentVariable under
# Windows PowerShell writes back as REG_SZ, so a read-modify-write through
# that API permanently flattens entries such as %USERPROFILE%\bin into
# today's values. Reading with DoNotExpandEnvironmentNames and writing with
# the value's own kind keeps them intact. Membership is the exact per-entry
# compare from Test-UserPathContains, so a directory is never judged present
# because another entry contains its name as a substring, and the separator is
# added only between entries, so an empty Path never gains a leading ';' (an
# empty PATH entry means the current directory, which is a resolution hazard).
# Returns $true when the durable value now lists the directory. A failure is
# reported by the caller rather than thrown: a PATH edit that cannot be made
# is one finding, never a reason to abandon the rest of the health check.
function Add-ToUserPath {
    param([Parameter(Mandatory = $true)][string]$Directory)
    $durable = $false
    $key = $null
    try {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
        if ($null -ne $key) {
            $raw = ""
            $existing = $key.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
            if ($null -ne $existing) { $raw = [string]$existing }
            # Keep the value's own kind; a Path that does not exist yet is
            # created as ExpandString, which is what Windows itself uses.
            $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
            try {
                $existingKind = $key.GetValueKind("Path")
                if ($existingKind -eq [Microsoft.Win32.RegistryValueKind]::String -or
                    $existingKind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString) {
                    $kind = $existingKind
                }
            }
            catch { <# no existing value: the ExpandString default stands #> }
            if (Test-UserPathContains -RawPath $raw -Directory $Directory) { $durable = $true }
            else {
                $trimmed = $raw.TrimEnd(";")
                $updated = if ($trimmed -eq "") { $Directory } else { $trimmed + ";" + $Directory }
                $key.SetValue("Path", $updated, $kind)
                $durable = $true
            }
        }
    }
    catch { $durable = $false }
    finally { if ($null -ne $key) { $key.Close() } }
    # This process too, so the rest of the run sees the directory.
    if (-not (Test-UserPathContains -RawPath $env:Path -Directory $Directory)) {
        $env:Path = if ($env:Path.TrimEnd(";") -eq "") { $Directory } else { $env:Path.TrimEnd(";") + ";" + $Directory }
    }
    return $durable
}

# A payload anywhere under ~/.claude is always an installed cache, never the
# dev clone: /plugin marketplace add clones the whole repo (with .git) under
# ~/.claude/plugins/marketplaces/, so a structural check alone misclassifies
# exactly the copy every install-only machine runs.
$repoRoot = Split-Path (Split-Path $pluginRoot -Parent) -Parent
$isClone = (Split-Path $pluginRoot -Leaf) -eq "grimoire" -and
           (Split-Path (Split-Path $pluginRoot -Parent) -Leaf) -eq "plugins" -and
           (Test-Path (Join-Path $repoRoot ".git")) -and
           -not $pluginRoot.StartsWith($claudeDir, [System.StringComparison]::OrdinalIgnoreCase)

# The copy this run judges against, in the banner's own words. Every derived
# FAIL or WARN ends with Get-PayloadClause and every remedy that installs from
# $pluginRoot names Get-PayloadCopyName, so a report line read without the
# banner still says which copy of the kit produced its expected value.
function Get-PayloadCopyName {
    if ($isClone) { return "repo clone: $repoRoot" }
    return "installed plugin: $pluginRoot"
}
function Get-PayloadClause {
    return "Expected value read from $(Get-PayloadCopyName)."
}

Write-Host "grimoire doctor ($(Get-PayloadCopyName))" -ForegroundColor White
Write-Host ""

# --- Execution policy. A Restricted or AllSigned effective policy blocks every
# --- .ps1 in the kit (the doctor itself, whenever it is launched without the
# --- .cmd wrapper). RemoteSigned is sufficient; Unrestricted is broader than the
# --- kit needs. The Process scope is excluded from the computation: doctor.cmd
# --- launches with -ExecutionPolicy Bypass, and including it would make the
# --- check report Bypass on a machine where a plain .ps1 is still blocked.
$effectivePolicy = $null
$policyProbeError = $null
foreach ($scope in @("LocalMachine", "CurrentUser", "UserPolicy", "MachinePolicy")) {
    try { $scopedPolicy = Get-ExecutionPolicy -Scope $scope -ErrorAction Stop }
    catch {
        if (-not $policyProbeError) { $policyProbeError = $_.Exception.Message }
        continue
    }
    # Store the string form: Get-ExecutionPolicy returns an enum whose
    # Unrestricted member is value 0, so keeping the enum would make every
    # later truthiness check (-not $effectivePolicy) silently discard it.
    if ($null -ne $scopedPolicy -and "$scopedPolicy" -ne "Undefined") { $effectivePolicy = "$scopedPolicy" }
}
if (-not $effectivePolicy -and $policyProbeError) {
    # Every scope query failed, so the true policy is unknown: report that,
    # never a fabricated value. The .cmd entry points still work regardless
    # (they launch with -ExecutionPolicy Bypass); plain .ps1 launches may not.
    Report "WARN" "Execution policy" @(
        "Could not query the policy: $policyProbeError",
        "doctor.cmd still runs (Bypass at launch); a plain .ps1 launch is unverified on this machine."
    )
}
elseif (-not $effectivePolicy) {
    # All scopes genuinely Undefined: the OS default (Restricted on client
    # Windows) is in effect, and the FAIL branch below says so.
    $effectivePolicy = "Restricted"
}
if (-not $effectivePolicy) {
    # WARN path above already reported; skip the policy branches.
}
elseif ($effectivePolicy -in @("Restricted", "AllSigned")) {
    if ($Fix) {
        try {
            Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force -ErrorAction Stop
            Report "FIXED" "Execution policy" @("Was $effectivePolicy; set CurrentUser scope to RemoteSigned.")
        }
        catch {
            Report "FAIL" "Execution policy" @(
                "Effective policy is $effectivePolicy and the fix failed (likely Group Policy): $($_.Exception.Message)",
                "Manual: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned"
            )
        }
    }
    else {
        Report "FAIL" "Execution policy" @(
            "Effective policy is $effectivePolicy; the kit's .ps1 scripts will not run.",
            "Fix: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned   (or re-run doctor with -Fix)"
        )
    }
}
elseif ($effectivePolicy -in @("Unrestricted", "Bypass")) {
    Report "PASS" "Execution policy" @("$effectivePolicy (works, but broader than needed; RemoteSigned is sufficient for the kit).")
}
else {
    Report "PASS" "Execution policy" @("$effectivePolicy")
}

# --- ANTHROPIC_API_KEY. A durable (User/Machine) value reaches every Claude Code
# --- session on this machine, flipping auth off the subscription login and onto
# --- API billing, silently: nothing in the session announces the switch.
$apiKeyScopes = @()
if ($env:ANTHROPIC_API_KEY) { $apiKeyScopes += "process" }
if ([Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "User")) { $apiKeyScopes += "User" }
if ([Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "Machine")) { $apiKeyScopes += "Machine" }
if ($apiKeyScopes.Count -eq 0) {
    Report "PASS" "ANTHROPIC_API_KEY" @("Not set; sessions authenticate via the claude.ai login.")
}
else {
    # Only a User or Machine value reaches sessions this shell did not start; a
    # process-scope value came from whatever launched this shell and dies with it.
    $apiKeyDurable = @($apiKeyScopes | Where-Object { $_ -ne "process" })
    $apiKeyDetail = @(("Set at scope: " + ($apiKeyScopes -join ", ") + "."))
    if ($apiKeyDurable.Count -gt 0) {
        $apiKeyDetail += @(
            "Every session started on this machine inherits it and switches to API-key auth, silently.",
            "Unset the durable value if it is not needed, or scrub it per command",
            "(Bash: env -u ANTHROPIC_API_KEY claude ...)."
        )
    }
    else {
        $apiKeyDetail += @(
            "Process scope only: this shell and its children switch to API-key auth, and sessions started",
            "elsewhere on this machine keep the claude.ai login. Whatever launched this shell exported it;",
            "scrub it per command if a session started from here should not use API-key auth",
            "(Bash: env -u ANTHROPIC_API_KEY claude ...)."
        )
    }
    Report "WARN" "ANTHROPIC_API_KEY" $apiKeyDetail
}

# --- Former-name migration. An install under the plugin's former name wrote
# --- the doctrine file, its stamp and the kaizen signpost under that name, and
# --- CLAUDE.md imports the doctrine file by it. The doctrine-refresh hook moves
# --- all four at a session start; this check reads the same four and, under
# --- -Fix, makes the same moves under the same conditions. A file moves only
# --- where its current name is absent, so a newer write is never replaced; the
# --- stamp moves only with its doctrine file, since a lone old stamp beside a
# --- current file describes some other write; the CLAUDE.md line moves only
# --- where it is exactly the former token, terminator aside and case-sensitive,
# --- and there it moves whatever else the file holds, since once the doctrine
# --- file is renamed that line imports nothing and a second import line loads
# --- the same file once; the hook applies the same comparison. CLAUDE.md is read and
# --- written as bytes, so every other byte and line ending stays as it was. A
# --- CLAUDE.md that is a link, or a chain of them, is followed to its final
# --- target, which is rewritten and the links kept. The rewrite goes to a temp
# --- file beside that target, named with the PID and a random suffix and
# --- created exclusively so no existing file is overwritten, and replaces the
# --- target with File.Replace, which swaps the two in one call, so a killed
# --- process never truncates it. A pair present under both names is reported
# --- and left, since only the operator can say which holds the write to keep.
# --- There is no consent prompt: this is the move the hook makes unprompted,
# --- onto names the kit owns, and -Fix already asked for it. The four old
# --- names spell the plugin's former name because they read the files earlier
# --- installs wrote.
$migrationOldDoctrine = "claude-kit-doctrine.md"
$migrationOldStamp = "claude-kit-doctrine.stamp.json"
$migrationOldSignpost = "claude-kit.local.json"
$migrationOldImport = "@claude-kit-doctrine.md"
$migrationNewImport = "@grimoire-doctrine.md"
$migrationClaudeMd = Join-Path $claudeDir "CLAUDE.md"
$migrationLatin1 = [System.Text.Encoding]::GetEncoding(28591)
$migrationLatin1Bom = $migrationLatin1.GetString([byte[]](0xEF, 0xBB, 0xBF))

function Test-MigrationFree {
    param([string]$Old, [string]$New)
    return (Test-Path -LiteralPath (Join-Path $claudeDir $Old)) -and -not (Test-Path -LiteralPath (Join-Path $claudeDir $New))
}

# CLAUDE.md as line segments, each keeping its own terminator, the UTF-8 byte
# order mark as latin1 text where line 1 opens with one, or "", and the index
# of the first exact former-token line, or -1. Exact means the segment less its
# \r\n or \n terminator, and on line 1 less the mark, compared
# case-sensitively. The line is matched by its text alone, so a line inside a
# comment or a code block counts too.
function Get-MigrationImportState {
    $segments = [regex]::Split($migrationLatin1.GetString([System.IO.File]::ReadAllBytes($migrationClaudeMd)), '(?<=\n)')
    $texts = @($segments | ForEach-Object { $_ -replace '\r?\n$', '' })
    $bom = if ($texts[0].StartsWith($migrationLatin1Bom, [System.StringComparison]::Ordinal)) { $migrationLatin1Bom } else { "" }
    $texts[0] = $texts[0].Substring($bom.Length)
    return @{
        Segments = $segments
        Bom = $bom
        OldAt = [array]::IndexOf($texts, $migrationOldImport)
    }
}

# The file a CLAUDE.md path finally names: each symbolic link is followed, a
# relative target read against its link's own directory, until a path that is
# not a link. A chain longer than 32 links is treated as a loop and throws.
function Resolve-MigrationTarget {
    param([string]$Path)
    $current = [System.IO.Path]::GetFullPath($Path)
    for ($hop = 0; $hop -lt 32; $hop++) {
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if ($item.LinkType -ne "SymbolicLink") { return $current }
        $linkTarget = @($item.Target)[0]
        if (-not [System.IO.Path]::IsPathRooted($linkTarget)) {
            $linkTarget = Join-Path (Split-Path -Parent $current) $linkTarget
        }
        $current = [System.IO.Path]::GetFullPath($linkTarget)
    }
    throw "$Path is a chain of more than 32 links"
}

$migrationMoves = @()
$migrationHeld = @()
if (Test-MigrationFree $migrationOldDoctrine "grimoire-doctrine.md") {
    $migrationMoves += @{ Old = $migrationOldDoctrine; New = "grimoire-doctrine.md" }
    if (Test-MigrationFree $migrationOldStamp "grimoire-doctrine.stamp.json") {
        $migrationMoves += @{ Old = $migrationOldStamp; New = "grimoire-doctrine.stamp.json" }
    }
}
elseif (Test-Path -LiteralPath (Join-Path $claudeDir $migrationOldDoctrine)) {
    $migrationHeld += "Both $migrationOldDoctrine and grimoire-doctrine.md exist in $claudeDir; neither is changed. The hook refreshes grimoire-doctrine.md, so delete the old one once you have kept anything you need from it."
}
if ((Test-Path -LiteralPath (Join-Path $claudeDir $migrationOldStamp)) -and -not ($migrationMoves | Where-Object { $_.Old -eq $migrationOldStamp })) {
    $migrationHeld += "$migrationOldStamp exists in $claudeDir and is left: a stamp moves only with its doctrine file and never over grimoire-doctrine.stamp.json, and the kit does not read this one, so it is safe to delete."
}
if (Test-MigrationFree $migrationOldSignpost "grimoire.local.json") {
    $migrationMoves += @{ Old = $migrationOldSignpost; New = "grimoire.local.json" }
}
elseif (Test-Path -LiteralPath (Join-Path $claudeDir $migrationOldSignpost)) {
    $migrationHeld += "Both $migrationOldSignpost and grimoire.local.json exist in $claudeDir; neither is changed. The kit reads grimoire.local.json, so delete the old one once you have kept any key you set in it."
}
$migrationImport = $null
$migrationImportError = $null
if (Test-Path -LiteralPath $migrationClaudeMd) {
    try { $migrationImport = Get-MigrationImportState }
    catch { $migrationImportError = Get-SanitizedLine $_.Exception.Message 200 }
}
$migrationImportPending = ($null -ne $migrationImport) -and ($migrationImport.OldAt -ge 0)
if ($null -ne $migrationImportError) {
    $migrationHeld += "$migrationClaudeMd is unreadable, so its import line was not checked: $migrationImportError"
}

$migrationPendingLines = @($migrationMoves | ForEach-Object { "$($_.Old) is present in $claudeDir and $($_.New) is absent." })
if ($migrationImportPending) { $migrationPendingLines += "$migrationClaudeMd has the line $migrationOldImport, the doctrine file's former name." }
if ($migrationPendingLines.Count -gt 0 -and $Fix) {
    $migrationDone = @()
    $migrationFailed = @()
    foreach ($move in $migrationMoves) {
        try {
            # No -Force: a file that reached the new name since the read above
            # makes the move fail rather than be replaced.
            Move-Item -LiteralPath (Join-Path $claudeDir $move.Old) -Destination (Join-Path $claudeDir $move.New) -ErrorAction Stop
            $migrationDone += "Renamed $($move.Old) to $($move.New)."
        }
        catch {
            $migrationFailed += "Could not rename $($move.Old) to $($move.New): $(Get-SanitizedLine $_.Exception.Message 200)"
        }
    }
    if ($migrationImportPending) {
        $migrationTarget = $null
        $migrationTmp = $null
        $migrationWritten = $false
        try {
            $migrationTarget = Resolve-MigrationTarget $migrationClaudeMd
            $segments = $migrationImport.Segments
            $lead = if ($migrationImport.OldAt -eq 0) { $migrationImport.Bom } else { "" }
            $segments[$migrationImport.OldAt] = $lead + $migrationNewImport + $segments[$migrationImport.OldAt].Substring($lead.Length + $migrationOldImport.Length)
            $migrationBytes = $migrationLatin1.GetBytes(-join $segments)
            $candidate = "$migrationTarget.tmp-migrate-$PID-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
            # CreateNew fails where anything already holds the path, so the temp
            # is this run's own from the moment it opens.
            $stream = [System.IO.File]::Open($candidate, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            $migrationTmp = $candidate
            try { $stream.Write($migrationBytes, 0, $migrationBytes.Length) }
            finally { $stream.Dispose() }
            $migrationWritten = $true
            # [NullString]::Value, because PowerShell passes a bare $null to a
            # .NET string parameter as "", which Replace rejects as a path.
            [System.IO.File]::Replace($migrationTmp, $migrationTarget, [NullString]::Value)
            $migrationDone += "Changed the line $migrationOldImport in $migrationClaudeMd to $migrationNewImport; no other line changed."
        }
        catch {
            # The temp this run created is removed only while the target still
            # exists, so the one complete copy is never the one deleted; where
            # the target is gone, the temp is kept and named, and called the
            # rewritten file only where its write and close completed.
            $migrationFailed += "Could not rewrite the import line in ${migrationClaudeMd}: $(Get-SanitizedLine $_.Exception.Message 200)"
            if ($null -ne $migrationTmp -and (Test-Path -LiteralPath $migrationTmp -PathType Leaf)) {
                if ($null -ne $migrationTarget -and (Test-Path -LiteralPath $migrationTarget -PathType Leaf)) {
                    Remove-Item -LiteralPath $migrationTmp -ErrorAction SilentlyContinue
                }
                elseif ($migrationWritten) {
                    $migrationFailed += "The rewritten file is kept at $migrationTmp; rename it to $migrationTarget."
                }
                else {
                    $migrationFailed += "$migrationTarget is missing, and the partial temp file $migrationTmp is kept; its write did not complete, so it is not a whole copy of the file."
                }
            }
        }
    }
    if ($migrationFailed.Count -gt 0) { Report "FAIL" "Former-name migration" ($migrationFailed + $migrationDone) }
    else { Report "FIXED" "Former-name migration" $migrationDone }
}
elseif ($migrationPendingLines.Count -gt 0) {
    Report "FAIL" "Former-name migration" ($migrationPendingLines + @("Fix: re-run doctor with -Fix, or start a Claude Code session, whose doctrine-refresh hook makes the same moves."))
}
elseif ($migrationHeld.Count -eq 0) {
    Report "PASS" "Former-name migration" @("No file under the plugin's former name, and no CLAUDE.md line that is exactly its import token, remains in $claudeDir.")
}
if ($migrationHeld.Count -gt 0) { Report "WARN" "Former-name migration" $migrationHeld }

# --- Doctrine import and freshness. The always-on doctrine loads via a one-line
# --- import in ~/.claude/CLAUDE.md; the doctrine-refresh SessionStart hook owns
# --- the sync (it rewrites the file from the installed plugin whenever it
# --- drifts). The freshness check verifies the sync actually happened against
# --- this payload's skill body, using the hook's own frontmatter-strip
# --- semantics, newline-normalized so line endings never false-alarm. The hook
# --- prepends one HTML comment line naming itself as the writer, which is not
# --- part of the skill body, so a first line opening with that comment is
# --- dropped from the installed copy before the two are compared.
function Get-DoctrineBody {
    param([string]$SkillFile)
    $raw = [System.IO.File]::ReadAllText($SkillFile)
    if ($raw.Length -gt 0 -and $raw[0] -eq [char]0xFEFF) { $raw = $raw.Substring(1) }
    $lines = $raw -split "`n"
    if (($lines[0]).Trim() -ne "---") { return $raw }
    $end = -1
    for ($i = 1; $i -lt $lines.Count; $i++) {
        if (($lines[$i]).Trim() -eq "---") { $end = $i; break }
    }
    if ($end -eq -1) { return $raw }
    $body = ($lines[($end + 1)..($lines.Count - 1)] -join "`n")
    return $body -replace "^`r?`n", ""
}

$claudeMd = Join-Path $claudeDir "CLAUDE.md"
$doctrineFile = Join-Path $claudeDir "grimoire-doctrine.md"
$doctrineSkill = Join-Path $pluginRoot "skills\operating-instructions\SKILL.md"
$claudeMdRaw = $null
$claudeMdReadError = $null
if (Test-Path $claudeMd) {
    try {
        $claudeMdRaw = Get-Content $claudeMd -Raw -Encoding UTF8 -ErrorAction Stop
    }
    catch {
        $claudeMdReadError = Get-SanitizedLine $_.Exception.Message 200
    }
}
$importPresent = ($null -ne $claudeMdRaw) -and ($claudeMdRaw -match "@grimoire-doctrine\.md")
if ($null -ne $claudeMdReadError) {
    Report "WARN" "Doctrine import" @("$claudeMd is unreadable: $claudeMdReadError")
}
elseif (-not $importPresent) {
    Report "WARN" "Doctrine import" @("Add this line to $claudeMd so the doctrine loads always-on:  @grimoire-doctrine.md")
}
elseif (-not (Test-Path $doctrineFile)) {
    Report "WARN" "Doctrine import" @("Import line present but $doctrineFile does not exist yet; the doctrine-refresh hook writes it on the next Claude Code session with the plugin installed.")
}
elseif (Test-Path $doctrineSkill) {
    $expected = $null
    $installed = $null
    $doctrineSkillReadError = $null
    $doctrineFileReadError = $null
    try {
        $expected = (Get-DoctrineBody -SkillFile $doctrineSkill) -replace "`r`n", "`n"
    }
    catch {
        $doctrineSkillReadError = Get-SanitizedLine $_.Exception.Message 200
    }
    if ($null -eq $doctrineSkillReadError) {
        try {
            $installed = ([System.IO.File]::ReadAllText($doctrineFile)) -replace "`r`n", "`n"
        }
        catch {
            $doctrineFileReadError = Get-SanitizedLine $_.Exception.Message 200
        }
    }
    if ($null -ne $doctrineSkillReadError) {
        Report "WARN" "Doctrine import" @("$doctrineSkill is unreadable: $doctrineSkillReadError")
    }
    elseif ($null -ne $doctrineFileReadError) {
        Report "WARN" "Doctrine import" @("$doctrineFile is unreadable: $doctrineFileReadError")
    }
    else {
        if ($installed.StartsWith("<!-- Written by the grimoire doctrine-refresh hook", [System.StringComparison]::Ordinal)) {
            $headerEnd = $installed.IndexOf("`n")
            $installed = if ($headerEnd -ge 0) { $installed.Substring($headerEnd + 1) } else { "" }
        }
        if ($expected.TrimEnd("`n") -eq $installed.TrimEnd("`n")) {
            Report "PASS" "Doctrine import" @("Imported, and the installed copy matches this payload's operating-instructions skill.")
        }
        else {
            Report "WARN" "Doctrine import" @(
                "Imported, but $doctrineFile differs from this payload's skill body.",
                "If the plugin here is the one installed, the doctrine-refresh hook rewrites it at the next session, unless that session's plugin is older than the one that last wrote the file.",
                "Where a session reported that decline, deleting ~/.claude/grimoire-doctrine.stamp.json lets the next session rewrite it; if this doctor ran from a clone ahead of or behind the installed plugin, the difference is expected.",
                (Get-PayloadClause)
            )
        }
    }
}
else {
    Report "WARN" "Doctrine import" @("operating-instructions skill not found at $doctrineSkill; cannot verify freshness.")
}

# --- Kaizen signpost + git hooks. Dev-clone concerns: the signpost tells the
# --- kit-doctor skill and this doctor's sidecar check where this machine's kit
# --- clone lives, and hooksPath activates the
# --- pre-commit zip rebuild. From an installed plugin cache, nothing is written
# --- (a cache must never be registered as the clone); an existing signpost is
# --- validated, an absent one is fine for install-only machines. The signpost
# --- may already carry operator-set keys this fix path does not own
# --- (compactNudgeFloor among them), so a rewrite merges into the parsed
# --- object rather than replacing it wholesale; only a signpost that is
# --- absent, or whose contents do not parse as a JSON object, falls back to
# --- the plain two-key template, since a merge has nothing to merge into
# --- either way. The rewrite goes to a sibling temp file that is renamed into
# --- place: a rename replaces the directory entry, so no link of any kind
# --- standing at the signpost path is ever written through, and an
# --- interrupted run cannot leave a truncated signpost. A link found there is
# --- reported and the write skipped, so an operator who pointed this path at
# --- a dotfiles repo hears about it rather than finding a real file where
# --- their link was.
$signpost = Join-Path $claudeDir "grimoire.local.json"
$signpostItem = Get-Item -LiteralPath $signpost -Force -ErrorAction SilentlyContinue
$signpostIsSymlink = ($null -ne $signpostItem) -and (($signpostItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
if ($isClone) {
    $hooksPath = $null
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $hooksPath = (& git -C $repoRoot config core.hooksPath) 2>$null
    }
    $signpostData = $null
    $signpostReadError = $null
    if (Test-Path $signpost) {
        $signpostRaw = $null
        try {
            $signpostRaw = Get-Content $signpost -Raw -Encoding UTF8 -ErrorAction Stop
        }
        catch {
            $signpostReadError = Get-SanitizedLine $_.Exception.Message 200
        }
        if ($null -eq $signpostReadError) {
            try { $signpostData = $signpostRaw | ConvertFrom-Json } catch {}
        }
    }
    $signpostValid = ($null -ne $signpostData) -and $signpostData.kitRepoPath -and (Test-Path $signpostData.kitRepoPath)
    $needSignpost = -not $signpostValid
    $needHooks = ($hooksPath -ne ".githooks")
    if ($Fix -and ($needSignpost -or $needHooks)) {
        $fixedNotes = @()
        $refusedNotes = @()
        if ($needSignpost) {
            if ($signpostIsSymlink) {
                # A link at the signpost path is reported and left alone
                # rather than replaced. The rename below would replace it
                # safely, which is the point: an operator who deliberately
                # linked this path out of a dotfiles repo would lose the link
                # silently, so the write is skipped and named instead. The
                # note rides its own WARN rather than the FIXED list, since
                # nothing was written and a planted link is worth a colour.
                $refusedNotes += "Refused to write ${signpost}: it is a link. Remove it and re-run doctor -Fix so the signpost is written as a real file."
            }
            elseif ($signpostReadError) {
                # A signpost this doctor could not read is never overwritten.
                # The merge below needs the parsed object to keep operator-set
                # keys such as compactNudgeFloor; a file that failed to read
                # has no parsed object to merge from, so writing the plain
                # two-key template over it would silently drop those keys.
                # The write is skipped and the file reported unreadable
                # instead, the same refusal shape as the link case above.
                $refusedNotes += "Refused to write ${signpost}: it is unreadable ($signpostReadError). Make it readable (close whatever holds it, or fix its permissions), then re-run the doctor; -Fix alone will not write over a file it could not read."
            }
            else {
                if (-not (Test-Path $claudeDir)) {
                    New-Item -ItemType Directory -Path $claudeDir | Out-Null
                }
                # $signpostData already holds the parsed object whenever the
                # signpost parsed to one (including the case reached here: it
                # parses fine but its kitRepoPath no longer resolves), so
                # merging is just overwriting the two owned keys on that same
                # object. JSON that parses to an array or a scalar is not a
                # thing to merge into - its PSObject.Properties are .NET
                # adapter members such as Count and SyncRoot, which would land
                # in the operator's config as keys - so it takes the same
                # two-key template as an absent or unparseable signpost.
                if ($signpostData -is [System.Management.Automation.PSCustomObject]) {
                    $newSignpost = [ordered]@{}
                    foreach ($prop in $signpostData.PSObject.Properties) { $newSignpost[$prop.Name] = $prop.Value }
                    $newSignpost['kitRepoPath'] = $repoRoot
                    $newSignpost['machine'] = $env:COMPUTERNAME
                }
                else {
                    $newSignpost = [ordered]@{ kitRepoPath = $repoRoot; machine = $env:COMPUTERNAME }
                }
                # -Depth 100 because the default of 2 renders anything deeper
                # as a PowerShell ToString() of the object, unrecoverably, and
                # the operator keys being preserved here are exactly what that
                # would corrupt. The write lands on a sibling temp file and is
                # renamed over the signpost: Move-Item -Force replaces the
                # directory entry, so a hard link at the signpost path keeps
                # its other name intact. (The .NET Core three-argument
                # File::Move overload with overwrite does not exist in the
                # Windows PowerShell 5.1 that doctor.cmd launches.)
                $signpostTmp = "$signpost.tmp"
                $signpostTmpWritten = $false
                try {
                    [System.IO.File]::WriteAllText($signpostTmp, ($newSignpost | ConvertTo-Json -Depth 100), (New-Object System.Text.UTF8Encoding($false)))
                    $signpostTmpWritten = $true
                    Move-Item -LiteralPath $signpostTmp -Destination $signpost -Force -ErrorAction Stop
                    $fixedNotes += "Wrote $signpost (kitRepoPath -> $repoRoot)."
                }
                catch {
                    # A failed rename (the target locked, permissions denied)
                    # must not report "Wrote" for a write that did not land,
                    # and must not leave the sibling temp file behind for the
                    # next run to trip over. Only a temp file this run wrote is
                    # removed: where the write itself failed, whatever sits at
                    # that path is not the doctor's, and the doctor deletes
                    # nothing it did not create.
                    $refusedNotes += "Failed to write ${signpost}: $(Get-SanitizedLine $_.Exception.Message 200). The signpost was not updated."
                    if ($signpostTmpWritten -and (Test-Path -LiteralPath $signpostTmp -PathType Leaf)) {
                        Remove-Item -LiteralPath $signpostTmp -ErrorAction SilentlyContinue
                    }
                }
            }
        }
        elseif ($signpostData.kitRepoPath -ne $repoRoot) {
            # A valid signpost aimed at another clone is a deliberate choice;
            # never silently retarget kaizen capture.
            $fixedNotes += "Left the existing signpost untouched (kitRepoPath: $($signpostData.kitRepoPath)); delete it and re-run -Fix here to retarget."
        }
        if ($needHooks) {
            if (Get-Command git -ErrorAction SilentlyContinue) {
                & git -C $repoRoot config core.hooksPath .githooks
                $fixedNotes += "Set core.hooksPath -> .githooks."
            }
            else {
                $fixedNotes += "git unavailable; core.hooksPath not set."
            }
        }
        if ($refusedNotes.Count -gt 0) { Report "WARN" "Setup (signpost)" $refusedNotes }
        if ($fixedNotes.Count -gt 0) { Report "FIXED" "Setup (signpost + git hooks)" $fixedNotes }
    }
    elseif ($needSignpost -or $needHooks) {
        $setupGaps = @()
        # Naming the link (or the read failure) as the blocker is what keeps
        # this branch from sending the operator round a loop it cannot leave:
        # -Fix refuses both too, so "re-run with -Fix" alone is advice that
        # cannot work for either.
        if ($needSignpost -and $signpostIsSymlink) { $setupGaps += "kaizen signpost path is a link ($signpost); the fix path refuses to write through it" }
        elseif ($needSignpost -and $signpostReadError) { $setupGaps += "kaizen signpost unreadable ($signpost): $signpostReadError" }
        elseif ($needSignpost) { $setupGaps += "kaizen signpost missing or invalid ($signpost)" }
        if ($needHooks) { $setupGaps += "core.hooksPath is '$hooksPath', not '.githooks' (pre-commit zip rebuild inactive)" }
        $fixAdvice = if ($needSignpost -and $signpostIsSymlink) {
            "Fix: remove the link at $signpost, then re-run doctor with -Fix."
        }
        elseif ($needSignpost -and $signpostReadError) {
            "Fix: make $signpost readable (close whatever holds it, or fix its permissions), then re-run the doctor. -Fix alone will not write over a file it could not read."
        }
        else {
            "Fix: re-run doctor with -Fix."
        }
        Report "WARN" "Setup (signpost + git hooks)" ($setupGaps + @($fixAdvice))
    }
    else {
        $note = "kitRepoPath: $($signpostData.kitRepoPath)"
        if ($signpostData.kitRepoPath -ne $repoRoot) { $note += "  (a different clone than this one; fine if that is the intended clone)" }
        Report "PASS" "Kaizen signpost" @($note)
    }
}
else {
    if (Test-Path $signpost) {
        $signpostData = $null
        $signpostReadError = $null
        $signpostRaw = $null
        try {
            $signpostRaw = Get-Content $signpost -Raw -Encoding UTF8 -ErrorAction Stop
        }
        catch {
            $signpostReadError = Get-SanitizedLine $_.Exception.Message 200
        }
        if ($null -eq $signpostReadError) {
            try { $signpostData = $signpostRaw | ConvertFrom-Json } catch {}
        }
        if ($null -ne $signpostReadError) {
            Report "WARN" "Kaizen signpost" @("$signpost is unreadable: $signpostReadError")
        }
        elseif ($null -ne $signpostData -and (Test-Path $signpostData.kitRepoPath)) {
            Report "PASS" "Kaizen signpost" @("kitRepoPath: $($signpostData.kitRepoPath) (registered clone found on disk).")
        }
        else {
            Report "WARN" "Kaizen signpost" @("$signpost exists but its kitRepoPath is unreadable or missing on disk; re-run doctor -Fix from the intended clone.")
        }
    }
    else {
        Report "INFO" "Kaizen signpost" @("No kit clone registered on this machine (the signpost names a dev clone; fine for install-only machines).")
    }
}

# --- Hook canary. The SessionStart-hook canary probes the plugin cache to catch
# --- broken hooks at session start; it needs hook-canary.js present and wired
# --- into hooks.json's SessionStart array, or the cache breaks silently and every
# --- session runs without the canary guard.
$hookCanaryHook = Join-Path $pluginRoot "hooks\hook-canary.js"
$canaryHooksJsonPath = Join-Path $pluginRoot "hooks\hooks.json"
$canaryHookFileExists = Test-Path -LiteralPath $hookCanaryHook
$canaryWired = $false
$canaryHooksJsonReadError = $null
$canaryHooksJsonError = $null
if (Test-Path -LiteralPath $canaryHooksJsonPath) {
    $canaryHooksJsonRaw = $null
    try {
        $canaryHooksJsonRaw = Get-Content -LiteralPath $canaryHooksJsonPath -Raw -Encoding UTF8 -ErrorAction Stop
    }
    catch {
        $canaryHooksJsonReadError = Get-SanitizedLine $_.Exception.Message 200
    }
    if ($null -eq $canaryHooksJsonReadError) {
        try {
            $canaryHooksJsonData = $canaryHooksJsonRaw | ConvertFrom-Json
            foreach ($entry in @($canaryHooksJsonData.hooks.SessionStart)) {
                foreach ($h in @($entry.hooks)) {
                    if ($h.command -match "hook-canary\.js") { $canaryWired = $true }
                }
            }
        }
        catch {
            $canaryHooksJsonError = Get-SanitizedLine $_.Exception.Message 200
        }
    }
}
if ($canaryHookFileExists -and $canaryWired) {
    Report "PASS" "Hook canary" @("hook-canary.js present and wired in hooks.json's SessionStart array.")
}
else {
    $gaps = @()
    if (-not $canaryHookFileExists) { $gaps += "hook-canary.js not found at $hookCanaryHook" }
    if (-not $canaryWired) {
        if (-not (Test-Path -LiteralPath $canaryHooksJsonPath)) { $gaps += "hooks.json not found at $canaryHooksJsonPath" }
        elseif ($canaryHooksJsonReadError) { $gaps += "hooks.json unreadable: $canaryHooksJsonReadError" }
        elseif ($canaryHooksJsonError) { $gaps += "hooks.json unparseable: $canaryHooksJsonError" }
        else { $gaps += "hooks.json's SessionStart array does not reference hook-canary.js" }
    }
    Report "FAIL" "Hook canary" ($gaps + @("The cache canary probe cannot run without this wiring.", (Get-PayloadClause)))
}

# --- Node. Every kit hook is a 'node ...' command, and the memq shim and
# --- Memory database steps below run under node too, so an unresolved node
# --- is a FAIL here and those steps skip on it.
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCmd) {
    Report "FAIL" "Node" @(
        "node is not on PATH, so no kit hook can run: every one is a 'node ...' command.",
        "Install Node.js and ensure 'node' resolves on PATH."
    )
}
else {
    Report "PASS" "Node" @("node resolves on PATH.")
}

# --- Persona plugin. The per-call guards (docs writes, read-only seats, the
# --- push and PR checks, the memq grant) live in the personas plugin's module,
# --- so a machine without it installed and enabled runs no guard at all. This
# --- reads ~/.claude/plugins/installed_plugins.json for a key whose plugin half
# --- is personas, from any marketplace, with at least one install entry. It
# --- merges enabledPlugins across three tiers, a later one overriding an
# --- earlier per key: ~/.claude/settings.json, then .claude\settings.json and
# --- .claude\settings.local.json under the working directory. The key is
# --- enabled when its merged value is true. A tier file that is absent is
# --- skipped, and one that is unreadable, not a JSON object, or holding an
# --- enabledPlugins that is not an object reads as not enabled. Managed
# --- settings are not read. This is the reading the hook canary makes, with
# --- the doctor's working directory in place of the session's cwd. Keys match
# --- ordinally and case-sensitively, as the canary's JavaScript does, and a key
# --- printed here goes through Get-SanitizedLine, since the project and local
# --- tiers sit in a repository the operator merely opened.
$personasInstalledPath = Join-Path $claudeDir "plugins\installed_plugins.json"
$personasCwd = (Get-Location).Path
$personasTierPaths = @(
    (Join-Path $claudeDir "settings.json"),
    (Join-Path $personasCwd ".claude\settings.json"),
    (Join-Path $personasCwd ".claude\settings.local.json")
)
$personasInstalledObj = $null
$personasGaps = @()
if (-not (Test-Path -LiteralPath $personasInstalledPath)) { $personasGaps += "$personasInstalledPath not found." }
else {
    try {
        $personasInstalledObj = Get-Content -LiteralPath $personasInstalledPath -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json
    }
    catch { $personasGaps += "$personasInstalledPath could not be read or parsed: " + (Get-SanitizedLine $_.Exception.Message 200) }
}
$personasEnabled = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([System.StringComparer]::Ordinal)
$personasTiersRead = @()
foreach ($personasTier in $personasTierPaths) {
    if (-not (Test-Path -LiteralPath $personasTier -PathType Leaf)) { continue }
    $personasTierObj = $null
    try {
        $personasTierObj = Get-Content -LiteralPath $personasTier -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json
    }
    catch {
        $personasGaps += "$personasTier could not be read or parsed: " + (Get-SanitizedLine $_.Exception.Message 200)
        continue
    }
    if (-not ($personasTierObj -is [System.Management.Automation.PSCustomObject])) {
        $personasGaps += "$personasTier does not hold a JSON object."
        continue
    }
    $personasTiersRead += $personasTier
    if (-not ($personasTierObj.PSObject.Properties.Name -contains "enabledPlugins")) { continue }
    if (-not ($personasTierObj.enabledPlugins -is [System.Management.Automation.PSCustomObject])) {
        $personasGaps += "$personasTier holds an enabledPlugins that is not an object."
        continue
    }
    foreach ($personasProp in $personasTierObj.enabledPlugins.PSObject.Properties) { $personasEnabled[$personasProp.Name] = $personasProp.Value }
}
$personasInstalledKeys = @()
if ($personasInstalledObj -is [System.Management.Automation.PSCustomObject] -and
    $personasInstalledObj.plugins -is [System.Management.Automation.PSCustomObject]) {
    $personasInstalledKeys = @($personasInstalledObj.plugins.PSObject.Properties |
        Where-Object { [string]::Equals($_.Name.Split([char]'@')[0], "personas", [System.StringComparison]::Ordinal) -and ($_.Value -is [System.Array]) -and ($_.Value.Count -gt 0) } |
        ForEach-Object { $_.Name })
}
$personasEnabledKey = $null
if ($personasGaps.Count -eq 0) {
    foreach ($personasKey in $personasInstalledKeys) {
        $personasValue = $null
        if ($personasEnabled.TryGetValue($personasKey, [ref]$personasValue) -and ($personasValue -is [bool]) -and $personasValue) { $personasEnabledKey = $personasKey; break }
    }
}
if ($null -ne $personasEnabledKey) {
    Report "PASS" "Persona plugin" @((Get-SanitizedLine $personasEnabledKey 120) + " is installed and enabled, so the persona module's per-call guards run.")
}
else {
    if ($personasGaps.Count -eq 0) {
        if ($personasInstalledKeys.Count -eq 0) { $personasGaps += "$personasInstalledPath has no personas@<marketplace> entry." }
        else {
            $personasKeysText = ($personasInstalledKeys | ForEach-Object { Get-SanitizedLine $_ 120 }) -join ", "
            $personasTiersText = if ($personasTiersRead.Count -gt 0) { $personasTiersRead -join ", " } else { "no settings file present" }
            $personasGaps += "$personasKeysText is installed but no settings tier enables it (read: $personasTiersText)."
        }
    }
    Report "FAIL" "Persona plugin" (@("The personas plugin is not installed and enabled, so no per-call guard runs: the docs-write, read-only, merged-PR push and PR docs guards and the memq grant live in its module.") + $personasGaps + @("Fix: claude plugin install personas@applefeld --scope user, then restart Claude Code."))
}

# --- Installed copy. On a clone, the memq shim check below
# --- also reads the expected value of the kit copy this machine has installed,
# --- so a machine that matches the install and not the checkout in hand
# --- reads as trailing that checkout rather than as broken, and -Fix
# --- installs nothing there. The installed copy is the one the memq shim
# --- itself runs: the checkout's own scripts\memq-shim.js is required under
# --- node as a module, and its resolveMemq() answers
# --- <installed root>\scripts\memq.js. The shim path rides as argv, never
# --- inside the -e source, as the hook load check above does it, and that
# --- source holds no double quote, which Windows PowerShell 5.1 mangles in a
# --- native argument. No answer, a node failure, or an answer naming this
# --- payload itself reads as no installed copy, and the check then
# --- reads exactly as it does without one.
# ---
# --- The lookup runs only when that check first reads the machine
# --- short of this checkout (a resolving shim with a file missing or
# --- differing), and
# --- its answer is kept for the rest of the run, so a healthy run spawns no
# --- node for it. The resolver's stderr is kept rather than dropped: it
# --- carries the note naming which marketplace's copy it chose when several
# --- offer one, which is whose code the check below then loads, so a trailing
# --- INFO prints it.
$installedRoot = $null
$script:InstalledKitRootRead = $false
$script:InstalledKitRoot = $null
$script:InstalledKitResolverNotes = @()
function Get-InstalledKitRoot {
    if ($script:InstalledKitRootRead) { return $script:InstalledKitRoot }
    $script:InstalledKitRootRead = $true
    if (-not $isClone -or $null -eq $nodeCmd) { return $null }
    $resolverShim = Join-Path $pluginRoot "scripts\memq-shim.js"
    if (-not (Test-Path -LiteralPath $resolverShim -PathType Leaf)) { return $null }
    try {
        $resolverOutput = @(& $nodeCmd.Source -e "process.stdout.write(require(process.argv[1]).resolveMemq() || '')" $resolverShim 2>&1)
        $resolverExit = $LASTEXITCODE
        $script:InstalledKitResolverNotes = @($resolverOutput |
            Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } |
            ForEach-Object { $_.ToString() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        $resolvedMemq = (@($resolverOutput | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "").Trim()
        if ($resolverExit -eq 0 -and $resolvedMemq -ne "") {
            $candidateRoot = [System.IO.Path]::GetFullPath((Split-Path (Split-Path $resolvedMemq -Parent) -Parent)).TrimEnd('\', '/')
            if ($candidateRoot -ne [System.IO.Path]::GetFullPath($pluginRoot).TrimEnd('\', '/')) { $script:InstalledKitRoot = $candidateRoot }
        }
    }
    catch { $script:InstalledKitRoot = $null }
    return $script:InstalledKitRoot
}

# --- memq shim. The kit memory store's CLI (memq) ships inside the plugin
# --- payload, and the payload's cache path changes with every release, so
# --- nothing durable may point at it. The shim installed at ~\.claude\bin
# --- re-resolves the installed payload at each invocation, which is what lets
# --- a kit update land without touching the shim; only a first install or a
# --- moved ~\.claude needs -Fix. install-memq-shim.ps1 (dot-sourced near the
# --- top of this script) owns the file layout, the integrity comparison, and
# --- the name-resolution reading, so the repo test suite exercises the same
# --- functions against redirected directories.
# ---
# --- Under -Fix the install always runs when anything is missing OR differs
# --- from this payload's copy, except where a clone run finds the shim
# --- matching the installed copy and resolving it (see Installed copy
# --- above), which reports INFO rather than FAIL. The copy is idempotent,
# --- and a check that prints "re-run with -Fix" while -Fix cannot reach the
# --- repair is a promise the code does not keep. Integrity is a content comparison
# --- (hash for the resolver, exact text for the wrappers), because a smoke
# --- run only proves that something ran, and anything that took the shim's
# --- place would pass it.
if ($null -eq $nodeCmd) {
    Report "INFO" "memq shim" @("Skipped (node unresolved; the Node check above already FAILs on that, and the shim runs under node).")
}
else {
    $memqShim = Get-MemqShimStatus -PluginRoot $pluginRoot -ClaudeDir $claudeDir -NodeExe $nodeCmd.Source
    $memqBinDir = $memqShim.BinDir
    $memqFixNotes = @()
    $memqReported = $false

    # Trailing: some files are missing from or differ against this checkout's
    # copy, and none are missing from or differ against the installed copy's.
    # That machine is healthy for the kit it runs, so the check reads INFO and
    # -Fix installs nothing, since installing this checkout's shim there is the
    # change the operator did not ask for by running a checkout. A file can be
    # missing against this checkout alone, where the checkout's shim set names
    # a file the installed copy's does not; a file missing against the
    # installed copy too is not trailing and reads FAIL. A shim whose health
    # run did not resolve is not trailing either, since the machine is not
    # healthy for any copy: it reads and installs as a difference from this
    # checkout, so -Fix performs the reinstall the FAIL's remedy names.
    #
    # The installed copy judges with its own install-memq-shim.ps1, run in its
    # own dynamic module, because the shim's file set and the wrapper texts are
    # defined in that file rather than read from the payload's scripts. Every
    # file that copy's own helpers name as copied must exist in its scripts:
    # the status function skips a copy it cannot find, which would count a bin
    # file as matching a copy that ships none. An absent script, a missing
    # function, or a throw reads as not trailing.
    $memqTrailing = $false
    if ($memqShim.Resolves -and ($memqShim.Missing.Count -gt 0 -or $memqShim.Stale.Count -gt 0)) {
        $installedRoot = Get-InstalledKitRoot
    }
    if ($memqShim.Resolves -and $null -ne $installedRoot -and ($memqShim.Missing.Count -gt 0 -or $memqShim.Stale.Count -gt 0)) {
        $installedShimScript = Join-Path $installedRoot "doctor\install-memq-shim.ps1"
        if (Test-Path -LiteralPath $installedShimScript -PathType Leaf) {
            try {
                $installedShimModule = New-Module -ScriptBlock { param($ShimScript) . $ShimScript; Export-ModuleMember } -ArgumentList $installedShimScript
                $installedShimMatches = & $installedShimModule {
                    param($InstalledRoot, $ClaudeDir, $NodeExe)
                    $lacking = @(Get-MemqShimCopiedFileNames | Where-Object { -not (Test-Path -LiteralPath (Join-Path $InstalledRoot "scripts\$_") -PathType Leaf) })
                    if ($lacking.Count -gt 0) { return $false }
                    $status = Get-MemqShimStatus -PluginRoot $InstalledRoot -ClaudeDir $ClaudeDir -NodeExe $NodeExe -SkipHealthRun
                    return ($null -ne $status -and @($status.Missing).Count -eq 0 -and @($status.Stale).Count -eq 0)
                } $installedRoot $claudeDir $nodeCmd.Source
                $memqTrailing = ($installedShimMatches -is [bool] -and $installedShimMatches)
            }
            catch { $memqTrailing = $false }
        }
    }

    if ($Fix -and -not $memqTrailing -and ($memqShim.Missing.Count -gt 0 -or $memqShim.Stale.Count -gt 0)) {
        $memqInstall = Install-MemqShim -PluginRoot $pluginRoot -ClaudeDir $claudeDir
        if (-not $memqInstall.Ok) {
            Report "FAIL" "memq shim" $memqInstall.Notes
            $memqReported = $true
        }
        else {
            $memqFixNotes += $memqInstall.Notes
            # Re-read after writing: the report describes the state on disk
            # now, never the state that prompted the repair.
            $memqShim = Get-MemqShimStatus -PluginRoot $pluginRoot -ClaudeDir $claudeDir -NodeExe $nodeCmd.Source
        }
    }

    if (-not $memqReported) {
        $memqGaps = @()
        if ($memqShim.Missing.Count -gt 0 -and -not $memqTrailing) {
            $memqGaps += ("Missing at ${memqBinDir}: " + ($memqShim.Missing -join ", ") + ".")
        }
        if ($memqShim.Stale.Count -gt 0 -and -not $memqTrailing) {
            $memqGaps += ("Differs from this payload's copy at ${memqBinDir}: " + ($memqShim.Stale -join ", ") + ".")
        }

        if ($memqGaps.Count -gt 0) {
            # Both readings are this payload's: a differing file is judged
            # against its copy, and a missing one against the file set its
            # install-memq-shim.ps1 names, so the report names that copy.
            Report "FAIL" "memq shim" ($memqGaps + @(
                "The memory-system skill's memq commands cannot be trusted to run this payload's memq.",
                "Fix: re-run doctor with -Fix (reinstalls the shim files from $(Get-PayloadCopyName) and wires PATH).",
                (Get-PayloadClause)
            ))
        }
        elseif ($memqShim.NoPayload) {
            # No installed plugin to resolve: a clone-only machine, where no
            # -Fix can help because the shim runs the installed payload by
            # design. A warning with the real remediation, never a FAIL that
            # nothing on this machine can clear.
            Report "WARN" "memq shim" @(
                "Installed at $memqBinDir, but no grimoire plugin payload is installed under ~\.claude\plugins for it to run.",
                "Install the plugin (/plugin marketplace add, then install grimoire); the shim picks it up with no doctor re-run."
            )
        }
        elseif (-not $memqShim.Resolves) {
            # Reached only where every shim file matches this payload's copy,
            # since a missing or differing file reads as the gaps FAIL above,
            # whose -Fix reinstall runs. So -Fix has nothing to install here,
            # and the fault is in the shim's own code or in the payload its
            # resolver picked, which this check does not read. The repair for
            # the payload is the plugin's own reinstall. Whether a reinstall
            # at the same version replaces the cached folder is not known
            # here, so no folder is named, and the doctor re-run is the
            # check. On a clone the installed shim matches the checkout's, so
            # a change to the checkout's memq-shim.js reads the same way and
            # is named first with its own repair. The shim's own output can
            # suggest -Fix, so the line after it says -Fix has nothing to do.
            $memqCheckoutSuspect = @()
            if ($isClone) {
                $memqCheckoutSuspect = @("A change to this checkout's scripts\memq-shim.js is the first suspect, since the shim at $memqBinDir matches it: repair or revert the change, then re-run doctor with -Fix so the shim is reinstalled from it.")
            }
            Report "FAIL" "memq shim" ($memqFixNotes + @(
                "Installed at $memqBinDir, but running it did not reach memq's usage banner, so the shim or the payload it ran is damaged.",
                (Get-SanitizedLine ("Shim output: " + $memqShim.Detail) 200),
                "The shim files already match this payload's copy, so -Fix has nothing to reinstall as it stands, whatever the shim output above suggests."
            ) + $memqCheckoutSuspect + @(
                "Fix: uninstall the grimoire plugin and install it again with /plugin, then re-run the doctor; where a newer kit version is published, claude plugin update grimoire replaces the payload too.",
                (Get-PayloadClause)
            ))
        }
        elseif ($null -ne $memqShim.ShadowedBy) {
            # Another memq wins name resolution, so typing `memq` does not run
            # the kit's. PATH is appended to, so an earlier entry always wins
            # and no -Fix here can outrank it: the path is named instead.
            Report "FAIL" "memq shim" ($memqFixNotes + @(
                "The shim is installed and healthy at $memqBinDir, but the name 'memq' resolves elsewhere:",
                ("  " + (Get-SanitizedLine $memqShim.ShadowedBy 200)),
                "That file runs instead of the kit's shim. Remove it, or order its directory after $memqBinDir on PATH."
            ))
        }
        elseif (-not $memqShim.OnPath) {
            # PATH is wired only once the shim is known healthy, so a broken
            # install never leaves PATH pointing at a non-functional memq.
            if ($Fix) {
                if (Add-ToUserPath -Directory $memqBinDir) {
                    Report "FIXED" "memq shim" ($memqFixNotes + @(
                        "Appended $memqBinDir to the user PATH (new shells resolve 'memq'; this session updated too)."
                    ))
                }
                else {
                    Report "WARN" "memq shim" ($memqFixNotes + @(
                        "The shim is installed and healthy at $memqBinDir, but the durable user PATH could not be written.",
                        "Add $memqBinDir to your user PATH by hand, or new shells will not resolve 'memq'."
                    ))
                }
            }
            else {
                Report "WARN" "memq shim" @(
                    "Installed and resolving at $memqBinDir, but that directory is not on PATH, so 'memq' will not resolve in a shell.",
                    "Fix: append $memqBinDir to the user PATH   (or re-run doctor with -Fix)."
                )
            }
        }
        elseif ($memqFixNotes.Count -gt 0) {
            Report "FIXED" "memq shim" ($memqFixNotes + @(
                "$memqBinDir is on PATH, and the shim resolves the installed payload at each invocation."
            ))
        }
        elseif ($memqTrailing) {
            $memqAgainstCheckout = @()
            if ($memqShim.Stale.Count -gt 0) { $memqAgainstCheckout += ("differs in " + ($memqShim.Stale -join ", ")) }
            if ($memqShim.Missing.Count -gt 0) { $memqAgainstCheckout += ("lacks " + ($memqShim.Missing -join ", ")) }
            Report "INFO" "memq shim" (@(
                "$memqBinDir is on PATH, and the shim matches the installed copy and resolves it at each invocation.",
                ("Against this checkout's copy it " + ($memqAgainstCheckout -join " and ") + ", so it trails the checkout in hand: " + (Get-SanitizedLine $installedRoot 200)),
                "-Fix from this checkout installs nothing here; the installed copy's doctor is the one that judges this machine."
            ) + @($script:InstalledKitResolverNotes | ForEach-Object { Get-SanitizedLine $_ 200 }))
        }
        else {
            Report "PASS" "memq shim" @("$memqBinDir is on PATH, and the shim matches this payload and resolves it at each invocation.")
        }
    }
}

# --- Nothing may be inserted between the `# --- Installed copy.` marker above
# --- and the `# --- .kit/ exposure.` marker below. test/doctor-payload.test.js
# --- runs real doctor code by extracting the text between those two markers
# --- and asserting on the reports that region emits, so a check placed in this
# --- gap silently joins that extracted section and fails those cases with a
# --- report count they never asked for. Add new checks after the
# --- `# --- .kit/ exposure.` marker instead.

# --- .kit/ exposure. The kit's project-local state lives in .kit/, and every
# --- file it holds is machine-local by intent: compact-consent.json carries
# --- the session id an operator released, so a
# --- listing, a backup or a git ls-files discloses what has run here without
# --- opening much.
# --- (The role-boundary marker lives under the home directory's own .kit,
# --- keyed by session, and never under a project's, so it is not in this
# --- directory.) The posture that keeps all of it safe is the directory
# --- staying out of git.
# --- The kit writes .kit/.gitignore on each write that can create the folder,
# --- but a tracked file or a folder no kit write has reached since escapes
# --- that, so this checks the whole directory instead of assuming it or
# --- naming one file. It is deliberately not gated on $isClone:
# --- $repoRoot is derived from where this script lives, so it only ever names
# --- the kit's own checkout, whose .gitignore already covers .kit/, while the
# --- exposure exists in whatever project the kit's hooks ran in. The inspected
# --- project is the directory the doctor was launched from: this state is
# --- project-local, so the operator runs the doctor from the project.
$kitStateDir = (Get-Location).Path
$kitStatePath = Join-Path $kitStateDir ".kit"
if (-not (Test-Path -LiteralPath $kitStatePath)) {
    Report "INFO" "Kit state directory exposure" @("No .kit directory in $kitStateDir; nothing to expose.")
}
elseif (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    # Reported rather than skipped silently, so an absent check cannot read as
    # a passing one.
    Report "INFO" "Kit state directory exposure" @("Skipped (git is not on PATH, so tracked and ignored status cannot be read).")
}
else {
    & git -C $kitStateDir rev-parse --is-inside-work-tree 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Report "PASS" "Kit state directory exposure" @("$kitStateDir is not a git working tree, so .kit/ cannot be committed from here.")
    }
    else {
        # Order matters: git stops reporting a path as ignored once it is
        # tracked, so the tracked case must be tested first or it renders as
        # merely unignored and understates the damage. A repository can also
        # ignore .kit/ and still track a file inside it (git add -f), so the
        # two readings are taken over the same directory rather than one
        # standing in for the other. The ignore reading takes two questions,
        # neither about .kit itself: the kit writes .kit/.gitignore containing
        # *, which git applies to the files under .kit/ and never to .kit, so
        # asking about the folder would read a self-ignored one as exposed.
        # First, git add -A would stage no file present there now. Second, a
        # probe name with no extension, which no file of the kit's carries, is
        # ignored too, so the rule covers the whole folder and not only the
        # names present today: a root *.json passes the first question while
        # leaving the next .jsonl the kit writes exposed.
        $kitTracked = @(& git -C $kitStateDir ls-files -- ".kit")
        $kitExposed = @(& git -C $kitStateDir ls-files --others --exclude-standard -- ".kit")
        & git -C $kitStateDir check-ignore -q -- ".kit/kit-exposure-probe"
        $kitIgnored = ($LASTEXITCODE -eq 0) -and ($kitExposed.Count -eq 0)
        if ($kitTracked.Count -gt 0) {
            Report "WARN" "Kit state directory exposure" (@(
                "$($kitTracked.Count) path(s) under $kitStatePath are tracked by git, so their contents are in this repo's history and reach every clone:"
            ) + ($kitTracked | ForEach-Object { "  " + (Get-SanitizedLine $_ 200) }) + @(
                "Fix: git rm --cached each path above, then add .kit/ to this repo's .gitignore."
            ))
        }
        elseif (-not $kitIgnored) {
            Report "WARN" "Kit state directory exposure" @(
                "$kitStatePath is neither tracked nor ignored, so the next 'git add -A' commits it and this repo's kit state reaches every clone.",
                "Fix: add .kit/ to this repo's .gitignore."
            )
        }
        else {
            Report "PASS" "Kit state directory exposure" @("$kitStatePath is gitignored, so this repo's kit state stays on this machine.")
        }
    }
}

# --- Memory database. The shared SQL Server index on the virtualization host
# --- holds the fleet's memory records, one usage row per memory, the outcome
# --- journal and curation queries, and a machine reaches it through the
# --- client config at ~\.claude\kit-memory-db.json. A machine with no config
# --- is a machine with no memory store, which is INFO. With one,
# --- this step runs the host probe beside the installer under -Quick (every
# --- check but the latency measurement) and reads mem.usp_Health under the
# --- config's own publisher login, then reports the local queue's depth, so a
# --- machine whose writes have silently queued says so here. FAIL is any FAIL
# --- line from the probe or a health call that did not answer; WARN is a queue
# --- holding rows or a queue that could not be counted, or a prerequisite (pwsh, node)
# --- missing so the host was not checked; PASS is everything else. Under -Fix
# --- any WARN the health call raised runs memq db-refresh inline, which drains
# --- the queue and refreshes the snapshot, and reports FIXED on a clean run; on
# --- an unmapped login the refresh's own FAIL lines say what it could not do.
# ---
# --- The probe carries #Requires -Version 7.0 (it reads an HTTP refusal as a
# --- result, which only pwsh's -SkipHttpErrorCheck can), while this doctor
# --- runs under Windows PowerShell 5.1 through doctor.cmd, so the probe is
# --- spawned under pwsh explicitly and a machine with no pwsh on PATH reads
# --- WARN naming that rather than the requirement's own error. Every line the
# --- probe, the health call or a failure prints is foreign text on this
# --- channel and takes Get-SanitizedLine at this report's own cap.
# "kit-memory-db.json" mirrors memory-database.js's CONFIG_FILE constant and
# "kit-memory-db-queue.sqlite" its QUEUE_FILE, pinned by comment because
# PowerShell cannot import a CommonJS constant. The queue is not read here: the health
# script below hands the store root to the client, which counts the queue's
# rows itself and creates no queue where none exists.
$dbConfigPath = Join-Path $claudeDir "kit-memory-db.json"
$dbProbeScript = Join-Path $pluginRoot "db\Test-MemoryDatabaseHost.ps1"
$dbClientScript = Join-Path $pluginRoot "scripts\memory-database.js"
$dbMemqScript = Join-Path $pluginRoot "scripts\memq.js"

# One line, no double quotes: it rides as a node -e argument through the
# PowerShell native-command call. The client reads the config at the path it
# is given and counts the queue under the store root it is given, and prints
# one JSON object the step reads back, its last output line.
$script:MemoryDatabaseHealthScript = 'const db = require(process.argv[1]); process.stdout.write(JSON.stringify(db.hostHealth({ configPath: process.argv[2], storeRoot: process.argv[3] })));'

if (-not (Test-Path -LiteralPath $dbConfigPath)) {
    Report "INFO" "Memory database" @("No client config at $dbConfigPath; this machine runs on its own memory store alone.")
}
elseif ($null -eq $nodeCmd) {
    Report "WARN" "Memory database" @("Config present at $dbConfigPath, but node is unresolved and the health reading runs under it, so the host was not checked; the Node check above already FAILs on that.")
}
elseif (-not (Test-Path -LiteralPath $dbProbeScript) -or -not (Test-Path -LiteralPath $dbClientScript)) {
    Report "FAIL" "Memory database" @("The host probe or the client is missing from this plugin payload ($dbProbeScript, $dbClientScript); the payload is incomplete.")
}
else {
    $pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($null -eq $pwshCmd) {
        Report "WARN" "Memory database" @(
            "Config present at $dbConfigPath, but pwsh (PowerShell 7) is not on PATH and the host probe requires it, so the host was not checked.",
            "Install PowerShell 7 to check the host from the doctor; memq itself needs only node."
        )
    }
    else {
        $dbLines = @()
        $dbFailed = $false
        $dbWarned = $false

        # The probe's own lines, each already in the <STATUS>  <n>. <name>: <value>
        # contract, printed under this step at this report's cap. Its exit code
        # is the host's verdict: non-zero on any FAIL line.
        $probeOutput = & $pwshCmd.Source -NoProfile -ExecutionPolicy Bypass -File $dbProbeScript -Quick -ConfigPath $dbConfigPath 2>&1
        $probeCode = $LASTEXITCODE
        $probeLines = @($probeOutput | ForEach-Object { Get-SanitizedLine ([string]$_) 120 } | Where-Object { $_ -ne "" })
        $dbLines += @($probeLines | ForEach-Object { "Probe: " + $_ })
        if ($probeCode -ne 0 -or @($probeLines | Where-Object { $_ -match '^FAIL' }).Count -gt 0) { $dbFailed = $true }

        # mem.usp_Health under the config's publisher login, with the queue depth
        # beside it. A last line that will not parse as JSON is the child having
        # failed: stderr is merged in, so a warning landing last at exit 0
        # cannot pass for an answer.
        $healthOutput = & $nodeCmd.Source -e $script:MemoryDatabaseHealthScript $dbClientScript $dbConfigPath $claudeDir 2>&1
        $healthCode = $LASTEXITCODE
        $healthLines = @($healthOutput | ForEach-Object { [string]$_ })
        $health = $null
        if ($healthCode -eq 0 -and $healthLines.Count -gt 0) {
            try { $health = $healthLines[-1] | ConvertFrom-Json } catch { $health = $null }
        }
        if ($null -eq $health) {
            $dbFailed = $true
            $dbLines += ("Health: could not run the client's health reading: " + (Get-SanitizedLine ($healthLines -join " ") 120))
        }
        elseif (-not $health.ok) {
            $dbFailed = $true
            # Two stand-downs read differently to the operator: a host that
            # was called and did not answer (refused, unreachable, schema), and
            # a config the client would not connect on, where no call was made
            # and the remedy is the file.
            if ($health.standDown -in @("refused", "unreachable", "schema")) {
                $dbLines += ("Health: mem.usp_Health did not answer under the publisher login: " + (Get-SanitizedLine ([string]$health.detail) 120))
            }
            else {
                $dbLines += ("Health: not asked, the client stood down on the config at $dbConfigPath ($($health.standDown)): " + (Get-SanitizedLine ([string]$health.detail) 120))
            }
        }
        else {
            $dbLines += ("Host: schema version " + (Get-SanitizedLine ([string]$health.health.schemaVersion) 20) +
                ", " + (Get-SanitizedLine ([string]$health.health.sharedRecords) 20) + " shared record(s), " +
                (Get-SanitizedLine ([string]$health.health.sharedEmbeddings) 20) + " shared embedding(s).")
            # An empty list is a login the host maps to no sandbox, which no
            # publish can get past.
            $sandboxes = @($health.health.sandboxes)
            if ($sandboxes.Count -eq 0) {
                $dbWarned = $true
                $dbLines += "Sandbox: the host maps this login to no sandbox, so nothing this machine publishes is recorded; re-run the installer's login setup."
            }
            else {
                # A publisher login sees its own sandbox alone. A curator or a
                # Windows-authenticated owner sees every sandbox, so the entry
                # named for this machine is preferred and the first stands in
                # only where none is.
                $own = $sandboxes[0]
                foreach ($entry in $sandboxes) {
                    if ([string]$entry.sandbox -eq $env:COMPUTERNAME) { $own = $entry; break }
                }
                # The health answer's lastPublish is not read: no client
                # records a publish run, and the queue depth below is the
                # signal for writes that have not reached the host.
                $dbLines += ("Sandbox " + (Get-SanitizedLine ([string]$own.sandbox) 40) + ": " +
                    (Get-SanitizedLine ([string]$own.records) 20) + " record(s), " +
                    (Get-SanitizedLine ([string]$own.embeddings) 20) + " embedding(s).")
            }
        }
        # The queue depth rides on the health answer whatever the host said,
        # since a filling queue is worth reporting on a host that is away.
        if ($null -ne $health) {
            if ($null -eq $health.queueDepth) {
                $dbWarned = $true
                $dbLines += "Queue: the local queue could not be counted (another connection may be holding it)."
            }
            elseif ([int]$health.queueDepth -gt 0) {
                $dbWarned = $true
                $dbLines += ("Queue: " + [int]$health.queueDepth + " row(s) wait in the local queue and drain on the next memq db-refresh.")
            }
            else {
                $dbLines += "Queue: empty."
            }
        }

        if ($dbFailed) {
            Report "FAIL" "Memory database" ($dbLines + @("Fix: bring the host up or repair the config, then run memq db-refresh; the local queue holds this machine's writes either way."))
        }
        elseif ($dbWarned -and $Fix) {
            # The refresh inline, through the payload's own memq under the same
            # node: it drains the queue, refreshes the snapshot and exits
            # non-zero for what failed, so the exit code is the verdict and its
            # lines are the detail.
            $syncOutput = & $nodeCmd.Source $dbMemqScript db-refresh 2>&1
            $syncCode = $LASTEXITCODE
            $syncLines = @($syncOutput | ForEach-Object { Get-SanitizedLine ([string]$_) 120 } | Where-Object { $_ -ne "" })
            if ($syncCode -eq 0) {
                Report "FIXED" "Memory database" ($dbLines + @("Ran memq db-refresh:") + @($syncLines | ForEach-Object { "  " + $_ }))
            }
            else {
                Report "FAIL" "Memory database" ($dbLines + @("memq db-refresh exited $syncCode" + ":") + @($syncLines | ForEach-Object { "  " + $_ }))
            }
        }
        elseif ($dbWarned) {
            Report "WARN" "Memory database" ($dbLines + @("Fix: run memq db-refresh, or re-run doctor -Fix to run it from here (the queue drain and the snapshot refresh, inline)."))
        }
        else {
            Report "PASS" "Memory database" $dbLines
        }
    }
}

# The markdown memory tiers under the store root, projects\<p>\memory,
# memory-types and memory-operator, and the two store-root leftovers
# memory-index.jsonl and kit-embedder, are history: the memory database holds
# every record and no kit reader opens them. A machine still holding one is
# told so once, as INFO, with the command that removes exactly what was found,
# one line per path found, each anchored on that literal path. The doctor removes nothing and -Fix does
# not run the command: the files are the operator's and the decision is theirs.
# A project tier is named only where it holds a record file outside its
# pending directory and other than its MEMORY.md: the pending directory is a
# run's live state, and MEMORY.md is the operator's own notes file. The
# command printed for a project is one removal of the tier's .md files, never
# the directory, so what it leaves is everything else: MEMORY.md, the pending
# directory, usage.jsonl, and outcomes.jsonl, which is pre-cutover outcome
# history a later plan imports. Two things the old tiers held are carried
# over before the removals, under their own heading: memq reads a project's
# type from the declarations file `memq declare-type` writes, no longer from
# a Project-Type line in MEMORY.md, so wherever a MEMORY.md still carries
# one, record files or not, the operator is handed the search that finds
# every such line and told to declare each in its checkout; and the tag
# registry now lives at the store root as memory-tag-registry.md, so wherever
# memory-types holds one the move that carries it there is printed. The
# shared tiers and the root leftovers are then removed whole. A printed path
# is the raw one, single quotes doubled inside the literal, so the command
# names the file that is there; only the line an operator reads takes
# Get-SanitizedLine.
# The migration marker at memory-migrated.json, where there is one, says when
# the publish that moved these records ran and how many twins it counted, so
# the operator can weigh the removal against it. Every displayed path and
# marker value takes Get-SanitizedLine; a path inside a printed command is raw.
$oldTierLines = @()
$oldTierCommands = @()
$oldCarryLines = @()
$oldTypeLineFound = $false
$oldProjectsRoot = Join-Path $claudeDir "projects"
if (Test-Path -LiteralPath $oldProjectsRoot -PathType Container) {
    foreach ($oldProject in @(Get-ChildItem -LiteralPath $oldProjectsRoot -Directory -Force -ErrorAction SilentlyContinue)) {
        $oldMemDir = Join-Path $oldProject.FullName "memory"
        if (-not (Test-Path -LiteralPath $oldMemDir -PathType Container)) { continue }
        $oldPendingPrefix = (Join-Path $oldMemDir "pending") + [System.IO.Path]::DirectorySeparatorChar
        $oldIndexPath = Join-Path $oldMemDir "MEMORY.md"
        $oldRecords = @(Get-ChildItem -LiteralPath $oldMemDir -Recurse -File -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -ieq ".md" -and -not $_.FullName.StartsWith($oldPendingPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and -not [string]::Equals($_.FullName, $oldIndexPath, [System.StringComparison]::OrdinalIgnoreCase) })
        if ((Test-Path -LiteralPath $oldIndexPath -PathType Leaf) -and
            ($null -ne (Select-String -LiteralPath $oldIndexPath -Pattern '^Project-Type:' -Quiet -ErrorAction SilentlyContinue))) {
            $oldTypeLineFound = $true
        }
        if ($oldRecords.Count -eq 0) { continue }
        $oldTierLines += ("Old tier: " + (Get-SanitizedLine $oldMemDir 260) + " still holds " + $oldRecords.Count + " record file(s).")
        $quotedMemDir = $oldMemDir.Replace("'", "''")
        $oldTierCommands += ("Get-ChildItem -LiteralPath '" + $quotedMemDir + "' -Recurse -File -Force -Filter '*.md' | Where-Object { -not `$_.FullName.StartsWith('" +
            ($oldPendingPrefix).Replace("'", "''") + "', [System.StringComparison]::OrdinalIgnoreCase) -and `$_.FullName -ne '" +
            $oldIndexPath.Replace("'", "''") + "' } | Remove-Item -Force")
    }
    if ($oldTypeLineFound) {
        # The wildcard stands in the one segment the operator's own project
        # names fill, under the quoted root every other printed path takes,
        # its own wildcard characters escaped so -Path reads them literally.
        $oldCarryLines += ("Select-String -Path '" + [System.Management.Automation.WildcardPattern]::Escape($oldProjectsRoot).Replace("'", "''") + "\*\memory\MEMORY.md' -Pattern '^Project-Type:'")
        $oldCarryLines += "(each hit is a project whose type memq no longer reads from MEMORY.md: run ``memq declare-type <type>`` in that project's checkout)"
    }
}
foreach ($oldShared in @("memory-types", "memory-operator")) {
    $oldSharedDir = Join-Path $claudeDir $oldShared
    if (-not (Test-Path -LiteralPath $oldSharedDir -PathType Container)) { continue }
    $oldRegistryPath = Join-Path $oldSharedDir "tag-registry.md"
    if ($oldShared -eq "memory-types" -and (Test-Path -LiteralPath $oldRegistryPath -PathType Leaf)) {
        $oldCarryLines += ("Move-Item -LiteralPath '" + $oldRegistryPath.Replace("'", "''") +
            "' -Destination '" + (Join-Path $claudeDir "memory-tag-registry.md").Replace("'", "''") + "'")
    }
    $oldRecords = @(Get-ChildItem -LiteralPath $oldSharedDir -Recurse -File -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -ieq ".md" })
    if ($oldRecords.Count -eq 0) { continue }
    $oldTierLines += ("Old tier: " + (Get-SanitizedLine $oldSharedDir 260) + " still holds " + $oldRecords.Count + " record file(s).")
    $oldTierCommands += ("Remove-Item -LiteralPath '" + $oldSharedDir.Replace("'", "''") + "' -Recurse -Force")
}
foreach ($oldLeaf in @("memory-index.jsonl", "kit-embedder")) {
    $oldLeafPath = Join-Path $claudeDir $oldLeaf
    if (-not (Test-Path -LiteralPath $oldLeafPath)) { continue }
    $oldTierLines += ("Old store file: " + (Get-SanitizedLine $oldLeafPath 260) + " is still present.")
    $oldTierCommands += ("Remove-Item -LiteralPath '" + $oldLeafPath.Replace("'", "''") + "' -Recurse -Force")
}
if ($oldTierLines.Count -gt 0 -or $oldCarryLines.Count -gt 0) {
    $oldMarkerPath = Join-Path $claudeDir "memory-migrated.json"
    $oldMarkerLine = "No migration marker at " + (Get-SanitizedLine $oldMarkerPath 260) + ": no publish of these files is recorded on this machine."
    if (Test-Path -LiteralPath $oldMarkerPath -PathType Leaf) {
        $oldMarker = $null
        try { $oldMarker = [System.IO.File]::ReadAllText($oldMarkerPath) | ConvertFrom-Json } catch { $oldMarker = $null }
        if ($null -eq $oldMarker) {
            $oldMarkerLine = "Migration marker: present at " + (Get-SanitizedLine $oldMarkerPath 260) + " but could not be read."
        }
        else {
            $oldMarkerLine = "Migration marker: the publish ran at " + (Get-SanitizedLine ([string]$oldMarker.migratedAt) 40) +
                " and counted " + (Get-SanitizedLine ([string]$oldMarker.twinCount) 20) + " twin(s)."
        }
    }
    $oldCarryBlock = @()
    if ($oldCarryLines.Count -gt 0) { $oldCarryBlock = @("Carry over first:") + @($oldCarryLines | ForEach-Object { "  " + $_ }) }
    $oldRemoveBlock = @()
    if ($oldTierCommands.Count -gt 0) { $oldRemoveBlock = @("Remove with:") + @($oldTierCommands | ForEach-Object { "  " + $_ }) }
    Report "INFO" "Memory database" (@("Old memory files: the memory database holds every record it reads; carry over and remove these when you are ready. A project tier's outcomes.jsonl is kept as pre-cutover outcome history that a later plan imports, and no command below names it. The doctor removes nothing and -Fix does not run this.") +
        $oldTierLines + @($oldMarkerLine) + $oldCarryBlock + $oldRemoveBlock)
}

# --- Auto-compaction window. The boundary-gated compaction feature needs the
# --- harness to OFFER a compaction early enough that the persona module's veto
# --- has something to schedule: the veto can only hold an offer, never raise
# --- one. That offer point is set by autoCompactWindow in user settings.json.
#
# The effective trigger is the configured window minus a reserve (measured,
# not documented: a configured 100,000 fires near 64,000 and a configured
# 150,000 fires near 116,400). The recommended window is sized against the
# roughly 1,000,000-token window the models running plan sessions
# carry, and against where a real run actually sits: context reaches about
# 100,000 once tools and a plan doc have loaded, chapters rarely close below
# 200,000, and quality holds until roughly 400,000. So the trigger belongs
# well above the setup floor and below the point where holding starts to
# cost something, which puts it near 250,000 with a long runway below the
# module's percentage valve for a chapter to close. Every displayed number is
# derived from $recommendedWindow and $autoCompactReserve rather than
# restated, so changing one value cannot strand the prose beside it.
#
# A window set too HIGH is one quiet failure: above the model's real context
# window the trigger is never reached, no compaction is ever offered, and the
# whole feature is inert while looking installed. A window set too LOW is the
# other, and it is worse than doing nothing: it compacts during setup and then
# repeatedly, throwing away context a run has not finished using.
$recommendedWindow = 285000
$autoCompactReserve = 35000
$recommendedTrigger = $recommendedWindow - $autoCompactReserve
# The documented floor of autoCompactWindow's accepted range. Below it the
# harness may clamp or ignore the value, so the real trigger is unknown and a
# derived trigger number would be fiction; the check reports that state
# instead of assessing it.
$windowFloor = 100000
$settingsPath = Join-Path $claudeDir "settings.json"

$configuredWindow = $null
$configuredWindowRaw = $null
$settingsReadable = $false
if (Test-Path -LiteralPath $settingsPath) {
    # Windows PowerShell 5.1's default Get-Content decoding mis-decodes a
    # BOM-less UTF-8 file with the ANSI codepage, so the encoding is explicit
    # here. -ErrorAction Stop turns a locked or unreadable file into a
    # terminating error the catch below can see (ConvertFrom-Json alone is
    # non-terminating), and $settingsReadable gates on an actual parsed
    # object rather than on the pipeline merely finishing, so a read that
    # silently produced nothing is not reported as readable.
    try {
        $settingsObj = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json
        $settingsReadable = ($null -ne $settingsObj)
    }
    catch {}
    if ($settingsReadable -and $settingsObj.PSObject.Properties.Name -contains "autoCompactWindow") {
        # A present value that does not cast is a different state from an
        # absent one: the user set SOMETHING, so it is reported as what it is
        # (and never overwritten by -Fix), rather than misreported as "not
        # set" and replaced.
        $rawWindowValue = $settingsObj.autoCompactWindow
        try { $configuredWindow = [int]$rawWindowValue }
        catch { $configuredWindowRaw = "$rawWindowValue" }
    }
}

if (-not (Test-Path -LiteralPath $settingsPath)) {
    Report "INFO" "Auto-compaction window" @("No user settings.json at $settingsPath, so no window is configured and the harness uses its per-model default.")
}
elseif (-not $settingsReadable) {
    Report "WARN" "Auto-compaction window" @("$settingsPath could not be parsed, so the configured window cannot be read.")
}
elseif ($null -ne $configuredWindowRaw) {
    Report "WARN" "Auto-compaction window" @(
        "autoCompactWindow is set to '" + (Get-SanitizedLine $configuredWindowRaw 120) + "', which is not a usable number, so the trigger cannot be assessed and the harness behavior is undefined.",
        "Set it by hand to $recommendedWindow, or remove it to fall back to the per-model default."
    )
}
elseif ($null -eq $configuredWindow) {
    $detail = @(
        "No autoCompactWindow is set, so the harness compacts at its per-model default trigger, near the top of the context window.",
        "Recommended: $recommendedWindow (offers a compaction near $recommendedTrigger consumed on the ~1,000,000-token window plan sessions run)."
    )
    if ($Fix -and (Get-Consent "Set autoCompactWindow to $recommendedWindow in $settingsPath?")) {
        $result = Set-AutoCompactWindow -Path $settingsPath -Value $recommendedWindow
        if ($result.ok) {
            Report "FIXED" "Auto-compaction window" @("Set autoCompactWindow to $recommendedWindow.", "Restart Claude Code for it to take effect.")
            if ($result.backupLeftover) {
                # The leftover is a plaintext copy of settings.json, which can
                # carry an env block and apiKeyHelper, so it is named rather
                # than silently left behind.
                Report "INFO" "Auto-compaction window" @("The pre-write backup could not be removed and remains at " + (Get-SanitizedLine $result.backupLeftover 200) + "; it holds a plaintext copy of settings.json, so delete it when convenient.")
            }
        }
        else {
            # The reason can carry file-derived text (key names, exception
            # messages), so it is sanitized before this trusted channel.
            Report "WARN" "Auto-compaction window" @("Could not set it: " + (Get-SanitizedLine $result.reason 200) + ".", "Add it by hand instead: `"autoCompactWindow`": $recommendedWindow")
        }
    }
    else {
        Report "INFO" "Auto-compaction window" $detail
    }
}
elseif ($configuredWindow -lt $windowFloor) {
    # Below the documented floor nothing derived from the value can be
    # trusted, so no trigger arithmetic is shown: the honest report is that
    # the behavior is unknown, not a clamped-to-zero number and a PASS.
    Report "WARN" "Auto-compaction window" @(
        "autoCompactWindow is $configuredWindow, below the documented floor of $windowFloor, so the harness may clamp or ignore it and the real trigger is unknown.",
        "Set it to $recommendedWindow (the documented range starts at $windowFloor)."
    )
}
else {
    $trigger = $configuredWindow - $autoCompactReserve
    # Display guard only: the floor branch above already refuses any window
    # small enough to derive a negative trigger, so this clamp is unreachable
    # belt-and-braces against the two constants drifting.
    $displayTrigger = [Math]::Max(0, $trigger)
    $detail = @("autoCompactWindow is $configuredWindow, so a compaction is offered near $displayTrigger consumed (the trigger runs about $autoCompactReserve below the configured window).")
    if ($configuredWindow -ne $recommendedWindow) {
        # A usable window that is not the recommended one is stale rather than
        # broken: its trigger is real. INFO rather than WARN for that reason, so
        # a machine that is merely un-migrated does not report yellow. Without
        # this branch the recommendation could never reach a machine that
        # already has a value, since every other branch here answers only an
        # absent, unparseable, or below-floor one.
        $mismatchDetail = $detail + @(
            "The recommended window is $recommendedWindow, which offers a compaction near $recommendedTrigger consumed."
        )
        # Replacing a value the operator chose is a wider act than filling in an
        # absent one, so it takes an interactive yes and is withheld from -Yes:
        # an unattended run cannot tell a deliberate window from a stale one,
        # and would revert the deliberate one on every run after every retune of
        # $recommendedWindow. The prompt names both values rather than only the
        # target, so the answer is given against the actual change.
        if ($Fix -and (Get-Consent "Change autoCompactWindow from $configuredWindow to $recommendedWindow in $settingsPath?" -Interactive)) {
            $result = Set-AutoCompactWindow -Path $settingsPath -Value $recommendedWindow
            if ($result.ok) {
                Report "FIXED" "Auto-compaction window" @("Changed autoCompactWindow from $configuredWindow to $recommendedWindow.", "Restart Claude Code for it to take effect.")
                if ($result.backupLeftover) {
                    Report "INFO" "Auto-compaction window" @("The pre-write backup could not be removed and remains at " + (Get-SanitizedLine $result.backupLeftover 200) + "; it holds a plaintext copy of settings.json, so delete it when convenient.")
                }
            }
            else {
                # The failure reasons name the pre-write backup's full path, and
                # that backup holds a plaintext copy of settings.json, so this
                # line is allowed more room than the usual report: truncating the
                # one channel that says where a secrets-adjacent copy was left is
                # the wrong economy.
                Report "WARN" "Auto-compaction window" @("Could not change it: " + (Get-SanitizedLine $result.reason 400) + ".", "Set it by hand instead: `"autoCompactWindow`": $recommendedWindow")
            }
        }
        else {
            # The remedy differs by why consent was not given, and naming the
            # flag already supplied would send the operator back through a
            # prompt they just declined.
            $remedy = if ($Fix) {
                "Set it by hand in $settingsPath, or re-run and answer yes at the prompt (this change is withheld from -Yes because it replaces a value you chose)."
            } else {
                "Re-run the doctor with -Fix to change it, which asks before writing, or set it by hand in $settingsPath."
            }
            Report "INFO" "Auto-compaction window" ($mismatchDetail + @($remedy))
        }
    }
    else {
        Report "PASS" "Auto-compaction window" $detail
    }
}

# --- Embedding server. A machine that holds its own memory database serves its
# --- own embeddings from llama.cpp's CPU server on loopback, installed under
# --- ~\.claude\kit-embedding-server and started at boot by the scheduled task
# --- KitEmbeddingServer. This step reads the embedding block of the client
# --- config at ~\.claude\kit-memory-db.json and lands in one of six states
# --- (install-embedding-server.ps1 defines them): no-config and remote read
# --- INFO, since a machine with no config has nothing to embed into and a
# --- remote url is the Memory database step's probe's to read; the no-config
# --- state reads the task too, and names a still-registered one with the
# --- command that removes it, which only the operator runs; ready reads
# --- PASS with the server's working set and one call's time, or WARN where no
# --- task is registered, since another process then owns the port and only
# --- the operator knows whether to stop it; starting reads WARN saying to
# --- wait; silent reads WARN naming what -Fix does; mismatch reads FAIL with
# --- no fix, since the config and the server disagree and only the operator
# --- knows which is right. Under -Fix, behind one consent prompt naming both
# --- downloads and their size, a silent server is installed where the install
# --- root is absent and repaired where it is present, a stopped task is
# --- started and a running one restarted once where the kit's own server
# --- does not answer the full check, and the embedding block is
# --- written where the config has none. A loopback block naming another url
# --- or model is replaced only behind a second, -Interactive prompt, since it
# --- is a value the operator chose. A config with no url is read against
# --- the url -Fix writes. Without -Fix this step opens no connection except to
# --- the loopback url and reads no pin. Outside the install root it deletes
# --- only the embedding block writer's own temp file. Every string the server, the config, the task or the log carries
# --- takes Get-SanitizedLine.
# "kit-memory-db.json" mirrors memory-database.js's CONFIG_FILE constant, as
# the Memory database step's own path does.
$embeddingConfigPath = Join-Path $claudeDir "kit-memory-db.json"
$embeddingInstallRoot = Join-Path $claudeDir "kit-embedding-server"
$embeddingTaskName = "KitEmbeddingServer"
$embeddingPort = Get-EmbeddingServerPort
$embedding = Get-EmbeddingServerState -ConfigPath $embeddingConfigPath -InstallRoot $embeddingInstallRoot -TaskName $embeddingTaskName -Port $embeddingPort
$embeddingTimeoutMs = $embedding.TimeoutMs
$embeddingUrlText = Get-SanitizedLine $embedding.Url 200
$embeddingModelText = Get-SanitizedLine $embedding.Model 120
$embeddingKitUrl = "http://127.0.0.1:" + $embeddingPort

# The task's readings, one line, for every state that read them.
$embeddingTaskLine = $null
if ($null -ne $embedding.TaskReadError) {
    $embeddingTaskLine = "Task ${embeddingTaskName}: could not be read: " + (Get-SanitizedLine $embedding.TaskReadError 200)
}
elseif ($embedding.TaskRegistered -eq $true) {
    $embeddingStarted = "never started"
    if ($embedding.TaskLastStart -is [datetime]) { $embeddingStarted = "last started " + $embedding.TaskLastStart.ToString("yyyy-MM-dd HH:mm:ss") }
    $embeddingTaskLine = "Task ${embeddingTaskName}: registered, " + (Get-SanitizedLine $embedding.TaskState 40) + ", " + $embeddingStarted + "."
}
elseif ($embedding.TaskRegistered -eq $false) {
    $embeddingTaskLine = "Task ${embeddingTaskName}: not registered."
}
$embeddingTaskLines = @()
if ($null -ne $embeddingTaskLine) { $embeddingTaskLines = @($embeddingTaskLine) }

# A loopback block naming another url or model is a value the operator chose:
# -Fix replaces it only behind a second prompt that a person answers.
$embeddingRewrite = ""
if (-not $embedding.BlockMissing -and (Test-EmbeddingServerConfigDiffers -ConfigPath $embeddingConfigPath -Port $embeddingPort)) {
    $embeddingRewrite = "replace the embedding block in $embeddingConfigPath, url $embeddingUrlText and model " + $(if ($embeddingModelText -ne "") { $embeddingModelText } else { "(none)" }) +
        ", with url $embeddingKitUrl and model " + $script:EmbeddingServerModelId
}

# Whether -Fix restarts the kit's task. Where the task is registered and
# running with no drift, the kit's own server decides: the task is restarted
# once unless that server answers the full check at the kit's url, listing the
# kit's model and answering one vector of the expected width. Where the config
# names the kit's url and model, the state read was that check, so its reading
# is reused. Where it names another, -Fix runs the check at the kit's url after
# consent; check mode never does. A drifted task is registered again and
# started, so it is never restarted.
$embeddingRestartable = ($embedding.TaskRegistered -eq $true -and $embedding.TaskRunning -eq $true -and @($embedding.TaskDrift).Count -eq 0)
$embeddingReadKit = ($embedding.Url -eq $embeddingKitUrl -and $embedding.Model -eq $script:EmbeddingServerModelId)
$embeddingRestart = ($embeddingRestartable -and $embeddingReadKit -and $embedding.State -ne "ready")

# What -Fix does for a silent server, in the order it does it.
$embeddingFixActions = @()
if ($embedding.InstallPresent) { $embeddingFixActions += "repairs the install at $embeddingInstallRoot (refetching only a file whose SHA-256 differs from its pin)" }
else { $embeddingFixActions += "installs llama.cpp's CPU server and the bge-m3 Q8 model into $embeddingInstallRoot" }
if ($embedding.TaskRegistered -ne $true) { $embeddingFixActions += "registers the scheduled task $embeddingTaskName and starts it" }
elseif (@($embedding.TaskDrift).Count -gt 0) { $embeddingFixActions += "registers the scheduled task $embeddingTaskName again, since its " + (@($embedding.TaskDrift) -join ", ") + " differs from the kit's definition, and starts it" }
elseif ($embeddingRestart) { $embeddingFixActions += "restarts the running task once and prints the last 20 lines of server.log" }
elseif ($embeddingRestartable -and -not $embeddingReadKit) { $embeddingFixActions += "checks the kit's own server at $embeddingKitUrl and restarts its task once where it does not answer completely, printing the last 20 lines of server.log" }
elseif ($embedding.TaskRunning -ne $true) { $embeddingFixActions += "starts the stopped task" }
if ($embedding.BlockMissing) { $embeddingFixActions += "writes the embedding block into $embeddingConfigPath" }
if ($embeddingRewrite -ne "") { $embeddingFixActions += "asks, in a second prompt a person at a console must answer, to " + $embeddingRewrite }

$embeddingNeedsFix = ($embedding.State -eq "silent") -or
    ($embedding.State -eq "ready" -and $embedding.TaskRegistered -eq $true -and $embedding.BlockMissing)

if ($embedding.State -eq "no-config") {
    $embeddingNoConfigLines = @("No client config at $embeddingConfigPath; this machine has no memory database configured, so it has nothing to embed into.")
    # The task line is added only where a task is registered or its reading
    # failed; a machine with no task keeps the one sentence.
    if ($embedding.TaskRegistered -eq $true -or $null -ne $embedding.TaskReadError) { $embeddingNoConfigLines += $embeddingTaskLines }
    if ($embedding.TaskRegistered -eq $true) {
        $embeddingNoConfigLines += "The task starts the embedding server at boot with nothing to embed into. The doctor removes nothing and -Fix does not run this; remove it with: Unregister-ScheduledTask -TaskName $embeddingTaskName -TaskPath \ -Confirm:`$false"
    }
    Report "INFO" "Embedding server" $embeddingNoConfigLines
}
elseif ($embedding.State -eq "remote") {
    if ($null -ne $embedding.ConfigError) {
        Report "INFO" "Embedding server" @("The client config at $embeddingConfigPath could not be read (" + (Get-SanitizedLine $embedding.ConfigError 200) + "); the Memory database step reports it, and this step checks only a loopback server.")
    }
    else {
        Report "INFO" "Embedding server" @("The config names the embedding server at $embeddingUrlText, which is not this machine; the Memory database step's probe reads it.")
    }
}
elseif ($embedding.State -eq "mismatch") {
    $embeddingDisagree = if ($embedding.Model -eq "") {
        "$embeddingUrlText/v1/models lists " + (Get-SanitizedLine ($embedding.Ids -join ", ") 200) + ", and the config's embedding block names no model to compare it with."
    }
    elseif ($embedding.Ids -notcontains $embedding.Model) {
        "$embeddingUrlText/v1/models does not list $embeddingModelText, the identity the config names; it lists " + (Get-SanitizedLine ($embedding.Ids -join ", ") 200) + "."
    }
    else {
        "$embeddingUrlText/v1/embeddings answered a vector of " + $embedding.Width + " floats, and the client expects 1024."
    }
    Report "FAIL" "Embedding server" (@($embeddingDisagree) + $embeddingTaskLines + @(
        "The config and the server disagree, and only you know which is right, so -Fix changes neither: correct the config's embedding block or the server, then re-run the doctor."
    ))
}
elseif ($embedding.State -eq "starting") {
    $embeddingAge = [int]((Get-Date) - $embedding.TaskLastStart).TotalSeconds
    $embeddingHealth = if ($null -ne $embedding.HealthStatus) { "answered HTTP " + $embedding.HealthStatus } else { "has not answered" }
    Report "WARN" "Embedding server" (@(
        "The task $embeddingTaskName started $embeddingAge second(s) ago and $embeddingUrlText/health $embeddingHealth; the model is still loading.",
        "Wait a minute and run the doctor again."
    ) + $embeddingTaskLines)
}
elseif ($embedding.State -eq "ready" -and $embedding.TaskRegistered -ne $true) {
    if ($null -ne $embedding.TaskReadError) {
        $embeddingUnmanaged = "$embeddingUrlText lists $embeddingModelText and answers one vector of 1024 floats, but the scheduled task $embeddingTaskName could not be read, so whether the kit's task runs this server is unknown."
        $embeddingRemedy = "The server may be the kit's own, so leave it running and re-run the doctor once the task can be read. -Fix does not touch it."
    }
    else {
        $embeddingUnmanaged = "$embeddingUrlText lists $embeddingModelText and answers one vector of 1024 floats, but no scheduled task $embeddingTaskName is registered, so the server is unmanaged: another process owns the port and nothing here brings it back at boot."
        $embeddingRemedy = "Only you know whether to stop that process; stop it and re-run doctor with -Fix to install the kit's server, or leave it as it is. -Fix does not touch it."
    }
    Report "WARN" "Embedding server" (@($embeddingUnmanaged) + $embeddingTaskLines + @($embeddingRemedy))
}
elseif ($embedding.State -eq "ready" -and -not $embeddingNeedsFix) {
    $embeddingWorkingSet = if ($null -ne $embedding.WorkingSetMB) { "working set " + $embedding.WorkingSetMB + " MB" } else { "working set unread" }
    Report "PASS" "Embedding server" (@(
        "$embeddingUrlText lists $embeddingModelText and answers one vector of 1024 floats in " + $embedding.CallMs + " ms; $embeddingWorkingSet."
    ) + $embeddingTaskLines)
}
else {
    # Silent, or ready with no embedding block in the config: the two states
    # -Fix acts on. The pins are read here and nowhere else.
    if ($embedding.State -eq "silent") {
        $embeddingFound = @("Nothing complete answered at $embeddingUrlText within $embeddingTimeoutMs ms: " + $embedding.Detail)
    }
    else {
        $embeddingFound = @("$embeddingUrlText lists $embeddingModelText and answers one vector of 1024 floats, but the config at $embeddingConfigPath names no embedding url, so the memory client cannot reach it.")
    }
    $embeddingConsent = $false
    $embeddingPins = $null
    if ($Fix) {
        $embeddingPins = @(Get-EmbeddingServerPins)
        $embeddingConsent = Get-Consent (Get-EmbeddingServerConsentQuestion -Pins $embeddingPins -InstallRoot $embeddingInstallRoot -TaskName $embeddingTaskName -ConfigRewrite $embeddingRewrite)
    }
    if ($embeddingConsent) {
        # Replacing the operator's own url or model asks again, and -Yes does
        # not answer it; held, the install goes ahead and the block stays.
        $embeddingRewriteConsent = $false
        if ($embeddingRewrite -ne "") {
            $embeddingRewriteConsent = Get-Consent ("Then " + $embeddingRewrite + "?") -Interactive
        }
        if ($embeddingRestartable -and -not $embeddingReadKit) {
            $embeddingKitAnswers = Test-EmbeddingServerAnswers -BaseUrl $embeddingKitUrl -Model $script:EmbeddingServerModelId -TimeoutMs $embeddingTimeoutMs
            $embeddingRestart = -not ($embeddingKitAnswers.Complete -and $embeddingKitAnswers.Identity -and $embeddingKitAnswers.Width -eq $script:EmbeddingServerDimensions)
        }
        $embeddingInstall = Install-EmbeddingServer -InstallRoot $embeddingInstallRoot -ConfigPath $embeddingConfigPath -TaskName $embeddingTaskName `
            -Pins $embeddingPins -Port $embeddingPort -TimeoutMs $embeddingTimeoutMs -Restart:$embeddingRestart -HoldConfigRewrite:(-not $embeddingRewriteConsent)
        if ($embeddingInstall.Ok) {
            $embeddingWorkingSet = if ($null -ne $embeddingInstall.WorkingSetMB) { "working set " + $embeddingInstall.WorkingSetMB + " MB" } else { "working set unread" }
            Report "FIXED" "Embedding server" ($embeddingInstall.Notes + @(
                "The server lists " + $script:EmbeddingServerModelId + " and answers one vector of 1024 floats in " + $embeddingInstall.CallMs + " ms; $embeddingWorkingSet."
            ))
        }
        elseif ($embeddingInstall.Unfinished) {
            Report "WARN" "Embedding server" ($embeddingFound + $embeddingInstall.Notes)
        }
        else {
            Report "FAIL" "Embedding server" ($embeddingFound + $embeddingInstall.Notes)
        }
    }
    else {
        Report "WARN" "Embedding server" ($embeddingFound + $embeddingTaskLines + @(
            "Fix: re-run doctor with -Fix, which " + ($embeddingFixActions -join ", then ") + "."
        ))
    }
}

# Runs `claude plugin install <InstallId>` through the claude the caller
# resolved, and returns its exit code and output lines. It is the Plugin
# install check's one spawn, defined outside that section so the test suite
# can stub it.
function Invoke-KitPluginInstall {
    param([Parameter(Mandatory = $true)][string]$ClaudeExe, [Parameter(Mandatory = $true)][string]$InstallId)
    $output = & $ClaudeExe plugin install $InstallId 2>&1
    return @{ code = $LASTEXITCODE; lines = @($output | ForEach-Object { [string]$_ }) }
}

# The Retired sidecar check's four calls onto the machine. They are defined
# outside that check's section so the test suite can replace each one, and
# they return plain objects so a replacement can return a hashtable.
#
# Get-SidecarDaemonTask returns $null when no task by that name is registered,
# and otherwise an object whose FilePath is the -File path in the task's
# action, or $null where the action names none. A host with no ScheduledTasks
# module, or a query that fails for any reason but the task's absence, throws.
function Get-SidecarDaemonTask {
    param([Parameter(Mandatory = $true)][string]$TaskName)
    if ($null -eq (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) {
        throw "the ScheduledTasks module is not available on this host"
    }
    try {
        $tasks = @(Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop)
    }
    catch {
        if ($_.CategoryInfo.Category -eq [System.Management.Automation.ErrorCategory]::ObjectNotFound) { return $null }
        throw
    }
    if ($tasks.Count -eq 0) { return $null }
    $filePath = $null
    foreach ($action in @($tasks | ForEach-Object { $_.Actions })) {
        if ("$($action.Arguments)" -match '-File\s+(?:"([^"]+)"|(\S+))') {
            $filePath = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
            break
        }
    }
    return [pscustomobject]@{ FilePath = $filePath }
}

function Unregister-SidecarDaemonTask {
    param([Parameter(Mandatory = $true)][string]$TaskName)
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
}

# Every node.exe process with its id and command line. A command line this
# user cannot read comes back empty.
function Get-NodeProcessList {
    return @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop | ForEach-Object {
        [pscustomobject]@{ Id = [int]$_.ProcessId; CommandLine = [string]$_.CommandLine }
    })
}

function Stop-ProcessById {
    param([Parameter(Mandatory = $true)][int]$Id)
    Stop-Process -Id $Id -Force -ErrorAction Stop
}

# How long the Retired sidecar check waits, from the end of its stops, for a
# stopped daemon to leave the process list and for the files it held to be
# released, and how often it looks. They are set outside the check's section so a test
# can shorten them.
$sidecarWaitMs = 10000
$sidecarPollMs = 250

# --- Retired sidecar. The kit ships no judgment daemon, and a plugin update
# --- never removes what one left on a machine: the scheduled task
# --- claude-kit-sidecar-daemon, registered by hand from the kit clone, the
# --- node process it launches, which posts tool calls off the machine, and
# --- the state folder ~\.claude\kit-sidecar. This check reports the task and
# --- the folder at WARN. Under -Fix it asks once, in the ordinary consent
# --- form that -Yes pre-answers, since the state is the kit's own, and on a
# --- yes it unregisters the task first so it cannot relaunch the daemon, then
# --- stops the daemon, then removes the folder, which a live daemon holds
# --- files open in. Each step runs whatever the one before it did, and a
# --- step that fails reads WARN with its error.
# --- A node process is stopped only where its command line names
# --- <clone>\sidecar\daemon.js as a whole path, compared case-insensitively
# --- with / read as \. The clone is the signpost's kitRepoPath or, where the
# --- signpost gives none, the folder two levels above the task action's -File
# --- path, and a clone path that is not absolute counts as none. Any other
# --- command line naming sidecar\daemon.js is reported and left running, as
# --- is every one where no clone is known. The process list is read again
# --- after consent, and a pid is stopped only where it is still listed with a
# --- command line naming the clone's daemon, so a pid the re-read shows
# --- reused for another command line is not stopped. The process list is read only where the task
# --- or the folder is found, so a clean machine reads one PASS, and a node
# --- process whose command line does not name sidecar\daemon.js is never
# --- printed.
# --- A stopped daemon can leave its files held for a moment: a forced stop
# --- returns before the process exits, and the task's wrapper holds the
# --- daemon's log open until node exits. So after the stops the check reads
# --- the process list until each stopped pid has left it, and retries the
# --- folder removal while a file in it is in use, polling every
# --- $sidecarPollMs up to $sidecarWaitMs from the end of the stops. Where the
# --- bound expires, a WARN names the file or folder whose removal failed.
# --- Where the process list cannot be read during the wait, the wait ends
# --- and a WARN says so.
# --- The folder delete is recursive, so it is refused unless the path's
# --- parent is exactly $claudeDir and its leaf exactly kit-sidecar. A link
# --- standing at that path is removed as a link and its target left as it
# --- was. The recursion walks the folder itself, so a link met inside is
# --- removed as a link and never entered, whatever the runtime's own
# --- recursive delete would do with it. A read-only file inside is made
# --- writable first, since a delete refuses it otherwise. Every file path
# --- the check reads or removes derives from $claudeDir, which a test points
# --- at a temp directory. Beyond those files, the check reaches the machine
# --- only through the four functions above, which a test replaces.
$sidecarName = "Retired sidecar"
$sidecarTaskName = "claude-kit-sidecar-daemon"
$sidecarDir = Join-Path $claudeDir "kit-sidecar"
$sidecarTask = $null
$sidecarTaskError = $null
try { $sidecarTask = Get-SidecarDaemonTask -TaskName $sidecarTaskName }
catch { $sidecarTaskError = Get-SanitizedLine $_.Exception.Message 200 }
$sidecarDirItem = Get-Item -LiteralPath $sidecarDir -Force -ErrorAction SilentlyContinue
$sidecarDirIsLink = ($null -ne $sidecarDirItem) -and (($sidecarDirItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
$sidecarFound = ($null -ne $sidecarTask) -or ($null -ne $sidecarDirItem)

# The clone: the signpost's kitRepoPath, read the way the Kaizen signpost
# section reads it, where a missing file, unparseable JSON and a missing key
# all mean the signpost names no clone. Failing that, the task's action.
$sidecarClone = $null
$sidecarSignpost = Join-Path $claudeDir "grimoire.local.json"
if ($sidecarFound -and (Test-Path -LiteralPath $sidecarSignpost)) {
    try {
        $sidecarSignpostData = Get-Content -LiteralPath $sidecarSignpost -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json
        if (($sidecarSignpostData -is [System.Management.Automation.PSCustomObject]) -and
            ($sidecarSignpostData.kitRepoPath -is [string]) -and
            [System.IO.Path]::IsPathRooted($sidecarSignpostData.kitRepoPath)) {
            $sidecarClone = $sidecarSignpostData.kitRepoPath
        }
    }
    catch {}
}
if ($null -eq $sidecarClone -and $null -ne $sidecarTask -and $sidecarTask.FilePath) {
    try {
        $sidecarTaskClone = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetDirectoryName([string]$sidecarTask.FilePath))
        if ($sidecarTaskClone -and [System.IO.Path]::IsPathRooted($sidecarTaskClone)) { $sidecarClone = $sidecarTaskClone }
    }
    catch {}
}
$sidecarClonePattern = $null
if ($null -ne $sidecarClone) {
    $sidecarDaemonPath = (($sidecarClone -replace '/', '\').TrimEnd('\')) + '\sidecar\daemon.js'
    $sidecarClonePattern = '(?i)(?:^|[\s"''])' + [regex]::Escape($sidecarDaemonPath) + '(?:$|[\s"''])'
}

# The daemon processes, each marked by whether it sits under the clone.
$sidecarDaemons = @()
$sidecarProcessError = $null
if ($sidecarFound) {
    try {
        foreach ($sidecarProc in @(Get-NodeProcessList)) {
            $sidecarCommand = ([string]$sidecarProc.CommandLine) -replace '/', '\'
            if ($sidecarCommand -notmatch '(?i)sidecar\\daemon\.js') { continue }
            $sidecarDaemons += [pscustomobject]@{
                Id = [int]$sidecarProc.Id
                CommandLine = [string]$sidecarProc.CommandLine
                UnderClone = ($null -ne $sidecarClonePattern) -and ($sidecarCommand -match $sidecarClonePattern)
            }
        }
    }
    catch {
        $sidecarProcessError = Get-SanitizedLine $_.Exception.Message 200
        $sidecarDaemons = @()
    }
}

# What is found, one line per finding, and what is left for the operator,
# which a -Fix run cannot clear.
$sidecarCloneText = if ($null -ne $sidecarClone) { Get-SanitizedLine $sidecarClone 200 } else { $null }
$sidecarFindings = @()
$sidecarLeft = @()
if ($null -ne $sidecarTaskError) {
    $sidecarLeft += "The scheduled-task query failed, so whether $sidecarTaskName is registered is unknown: $sidecarTaskError"
}
if ($null -ne $sidecarTask) {
    $sidecarActionText = if ($sidecarTask.FilePath) { "its action runs " + (Get-SanitizedLine $sidecarTask.FilePath 200) } else { "its action names no -File path" }
    $sidecarFindings += "Scheduled task $sidecarTaskName is registered; $sidecarActionText."
}
if ($null -ne $sidecarDirItem) {
    if ($sidecarDirIsLink) { $sidecarFindings += "$sidecarDir exists as a link; -Fix removes the link and leaves its target as it is." }
    else { $sidecarFindings += "$sidecarDir exists." }
}
if ($null -ne $sidecarProcessError) {
    $sidecarLeft += "The node process list could not be read, so no daemon process is stopped: $sidecarProcessError"
}
foreach ($sidecarDaemon in $sidecarDaemons) {
    $sidecarCommandText = Get-SanitizedLine $sidecarDaemon.CommandLine 200
    if ($sidecarDaemon.UnderClone) {
        $sidecarFindings += "Daemon process $($sidecarDaemon.Id) is running under the kit clone ${sidecarCloneText}: $sidecarCommandText"
    }
    elseif ($null -ne $sidecarClone) {
        $sidecarLeft += "Daemon process $($sidecarDaemon.Id) has a command line that does not name the kit clone's daemon path ($(Get-SanitizedLine $sidecarDaemonPath 200)), so the doctor never stops it; stop it by hand if it is this kit's: $sidecarCommandText"
    }
    else {
        $sidecarLeft += "Daemon process $($sidecarDaemon.Id) is running, and neither the signpost nor the task names the kit clone, so the doctor never stops it; stop it by hand if it is this kit's: $sidecarCommandText"
    }
}

# The recursive delete. An entry that is a link is removed as a link and never
# entered, so nothing outside the folder is deleted. Everything else is
# removed depth first, then the folder itself.
$sidecarRemoveTree = {
    param([string]$Directory)
    foreach ($sidecarEntry in [System.IO.Directory]::GetFileSystemEntries($Directory)) {
        $sidecarAttributes = [System.IO.File]::GetAttributes($sidecarEntry)
        $sidecarIsDirectory = ($sidecarAttributes -band [System.IO.FileAttributes]::Directory) -ne 0
        if (($sidecarAttributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            if ($sidecarIsDirectory) { [System.IO.Directory]::Delete($sidecarEntry, $false) }
            else { [System.IO.File]::Delete($sidecarEntry) }
        }
        elseif ($sidecarIsDirectory) { & $sidecarRemoveTree $sidecarEntry }
        else {
            if (($sidecarAttributes -band [System.IO.FileAttributes]::ReadOnly) -ne 0) {
                [System.IO.File]::SetAttributes($sidecarEntry, ($sidecarAttributes -band (-bnot [System.IO.FileAttributes]::ReadOnly)))
            }
            $sidecarHeld.Path = $sidecarEntry
            [System.IO.File]::Delete($sidecarEntry)
        }
    }
    $sidecarHeld.Path = $Directory
    [System.IO.Directory]::Delete($Directory, $false)
}

# The IOException behind a failed removal when it is one that clears once the
# daemon's handles close: a sharing violation, a lock violation, or a folder
# not yet empty because a file in it is still pending deletion. $null for any
# other failure, which is not retried.
$sidecarTransientIo = {
    param($Exception)
    $sidecarInner = $Exception
    while ($null -ne $sidecarInner) {
        if ($sidecarInner -is [System.IO.IOException] -and
            @(0x80070020, 0x80070021, 0x80070091) -contains $sidecarInner.HResult) {
            return $sidecarInner
        }
        $sidecarInner = $sidecarInner.InnerException
    }
    return $null
}

if (-not $sidecarFound -and $sidecarLeft.Count -eq 0) {
    Report "PASS" $sidecarName @("No $sidecarTaskName task is registered and no $sidecarDir exists.")
}
elseif (-not $sidecarFound) {
    Report "WARN" $sidecarName ($sidecarLeft + @("No $sidecarDir exists."))
}
elseif ($Fix -and (Get-Consent "Unregister the retired sidecar's scheduled task $sidecarTaskName, stop its daemon under the kit clone, and remove $sidecarDir with everything in it?")) {
    $sidecarDone = @()
    $sidecarFailed = @()
    if ($null -ne $sidecarTask) {
        try {
            Unregister-SidecarDaemonTask -TaskName $sidecarTaskName
            $sidecarDone += "Unregistered the scheduled task $sidecarTaskName."
        }
        catch { $sidecarFailed += "Could not unregister the scheduled task ${sidecarTaskName}: $(Get-SanitizedLine $_.Exception.Message 200)" }
    }
    # The list as it stands now, after the prompt: a pid is stopped only where
    # it is still listed with a command line naming the clone's daemon.
    $sidecarToStop = @($sidecarDaemons | Where-Object { $_.UnderClone } | ForEach-Object { $_.Id })
    $sidecarStopped = @()
    if ($sidecarToStop.Count -gt 0) {
        $sidecarNow = $null
        try { $sidecarNow = @(Get-NodeProcessList) }
        catch { $sidecarFailed += "The node process list could not be read again after the prompt, so no daemon process was stopped: $(Get-SanitizedLine $_.Exception.Message 200)" }
        if ($null -ne $sidecarNow) {
            foreach ($sidecarId in $sidecarToStop) {
                $sidecarStill = @($sidecarNow | Where-Object {
                    ([int]$_.Id -eq $sidecarId) -and ((([string]$_.CommandLine) -replace '/', '\') -match $sidecarClonePattern)
                })
                if ($sidecarStill.Count -eq 0) {
                    $sidecarDone += "Daemon process $sidecarId was no longer running under the kit clone after the prompt, so it was not stopped."
                    continue
                }
                try {
                    Stop-ProcessById -Id $sidecarId
                    $sidecarStopped += $sidecarId
                    $sidecarDone += "Stopped daemon process $sidecarId under the kit clone."
                }
                catch { $sidecarFailed += "Could not stop daemon process ${sidecarId}: $(Get-SanitizedLine $_.Exception.Message 200)" }
            }
        }
    }
    # Each stopped pid is waited on until it leaves the process list, within
    # the bound the folder removal below shares.
    $sidecarClock = [System.Diagnostics.Stopwatch]::StartNew()
    $sidecarRunning = @($sidecarStopped)
    while ($sidecarRunning.Count -gt 0) {
        $sidecarListed = $null
        try { $sidecarListed = @(Get-NodeProcessList | ForEach-Object { [int]$_.Id }) }
        catch {
            $sidecarFailed += "The node process list could not be read while waiting for the stopped daemon to exit, so the wait ended early: $(Get-SanitizedLine $_.Exception.Message 200)"
            $sidecarRunning = @()
            break
        }
        $sidecarRunning = @($sidecarRunning | Where-Object { $sidecarListed -contains $_ })
        if ($sidecarRunning.Count -eq 0 -or $sidecarClock.ElapsedMilliseconds -ge $sidecarWaitMs) { break }
        Start-Sleep -Milliseconds $sidecarPollMs
    }
    foreach ($sidecarId in $sidecarRunning) {
        $sidecarFailed += "Daemon process $sidecarId was still listed when the wait of $sidecarWaitMs ms ended."
    }
    if ($null -ne $sidecarDirItem) {
        $sidecarDirFull = $null
        $sidecarParentOk = $false
        $sidecarLeafOk = $false
        try {
            $sidecarDirFull = [System.IO.Path]::GetFullPath($sidecarDir).TrimEnd('\')
            $sidecarHomeFull = [System.IO.Path]::GetFullPath($claudeDir).TrimEnd('\')
            $sidecarParentOk = [string]::Equals([System.IO.Path]::GetDirectoryName($sidecarDirFull), $sidecarHomeFull, [System.StringComparison]::OrdinalIgnoreCase)
            $sidecarLeafOk = [string]::Equals([System.IO.Path]::GetFileName($sidecarDirFull), "kit-sidecar", [System.StringComparison]::Ordinal)
        }
        catch {}
        if (-not ($sidecarParentOk -and $sidecarLeafOk)) {
            $sidecarFailed += "Refused to remove ${sidecarDir}: its full path is not kit-sidecar directly under $claudeDir."
        }
        else {
            $sidecarHeld = @{ Path = $sidecarDirFull }
            while ($true) {
                try {
                    if ($sidecarDirIsLink) {
                        if ($sidecarDirItem.PSIsContainer) { [System.IO.Directory]::Delete($sidecarDirFull, $false) }
                        else { [System.IO.File]::Delete($sidecarDirFull) }
                        $sidecarDone += "Removed the link at $sidecarDir and left its target as it is."
                    }
                    elseif ($sidecarDirItem.PSIsContainer) {
                        & $sidecarRemoveTree $sidecarDirFull
                        $sidecarDone += "Removed $sidecarDir with everything in it."
                    }
                    else {
                        [System.IO.File]::Delete($sidecarDirFull)
                        $sidecarDone += "Removed the file $sidecarDir."
                    }
                    break
                }
                catch {
                    $sidecarError = $_.Exception
                    $sidecarIo = & $sidecarTransientIo $sidecarError
                    if ($null -eq $sidecarIo) {
                        $sidecarFailed += "Could not remove ${sidecarDir}: $(Get-SanitizedLine $sidecarError.Message 200)"
                        break
                    }
                    if ($sidecarClock.ElapsedMilliseconds -ge $sidecarWaitMs) {
                        $sidecarFailed += "Could not remove ${sidecarDir}: $(Get-SanitizedLine $sidecarHeld.Path 200) was still in use when the wait of $sidecarWaitMs ms ended: $(Get-SanitizedLine $sidecarIo.Message 200)"
                        break
                    }
                    Start-Sleep -Milliseconds $sidecarPollMs
                }
            }
        }
    }
    if ($sidecarFailed.Count -gt 0 -or $sidecarLeft.Count -gt 0) {
        Report "WARN" $sidecarName ($sidecarDone + $sidecarFailed + $sidecarLeft)
    }
    else {
        Report "FIXED" $sidecarName $sidecarDone
    }
}
else {
    $sidecarDeclined = @()
    if ($Fix -and $null -eq $script:consentDeclinedNote) {
        $sidecarDeclined = @("Declined the -Fix prompt for this check, so nothing was changed.")
    }
    $sidecarRemedy = if ($Fix) {
        "Re-run doctor -Fix and answer yes, or add -Yes, to unregister the task, stop the daemon under the kit clone and remove the folder."
    }
    else {
        "Fix: re-run doctor with -Fix, which asks before it unregisters the task, stops the daemon under the kit clone and removes the folder."
    }
    Report "WARN" $sidecarName ($sidecarDeclined + $sidecarFindings + $sidecarLeft + @($sidecarRemedy))
}

# --- Output style. The kit's output style is addressed by plugin name, so a
# --- settings.json that selected it under the plugin's former name names a
# --- style no installed plugin provides once the plugin is renamed.
# --- Claude Code's marketplace rename moves enabledPlugins and
# --- pluginConfigs but not outputStyle, so this check reads
# --- it from the settings read the Auto-compaction window check made, and
# --- -Fix rewrites that one key through Set-UserSettingKey, the writer that
# --- proves every other key survived. The former value spells the plugin's
# --- former name because it reads what an earlier install wrote.
$formerOutputStyle = "claude-kit:Kit"
$currentOutputStyle = "grimoire:Kit"
if (-not (Test-Path -LiteralPath $settingsPath)) {
    Report "PASS" "Output style" @("No user settings.json at $settingsPath, so no output style names the plugin's former name.")
}
elseif (-not $settingsReadable) {
    Report "WARN" "Output style" @("$settingsPath could not be parsed, so the output style cannot be read.")
}
elseif (($settingsObj.PSObject.Properties.Name -contains "outputStyle") -and ("$($settingsObj.outputStyle)" -eq $formerOutputStyle)) {
    $styleByHand = "Set it by hand instead: `"outputStyle`": `"$currentOutputStyle`""
    if ($Fix -and (Get-Consent "Change outputStyle from $formerOutputStyle to $currentOutputStyle in $settingsPath?")) {
        $result = Set-UserSettingKey -Path $settingsPath -Key "outputStyle" -Value $currentOutputStyle
        if ($result.ok) {
            Report "FIXED" "Output style" @("Changed outputStyle from $formerOutputStyle to $currentOutputStyle.", "Restart Claude Code for it to take effect.")
            if ($result.backupLeftover) {
                Report "INFO" "Output style" @("The pre-write backup could not be removed and remains at " + (Get-SanitizedLine $result.backupLeftover 200) + "; it holds a plaintext copy of settings.json, so delete it when convenient.")
            }
        }
        else {
            # The reason names the pre-write backup's full path, a plaintext
            # copy of settings.json, so it gets the wider cap the
            # Auto-compaction window check gives the same line.
            Report "FAIL" "Output style" @("Could not change it: " + (Get-SanitizedLine $result.reason 400) + ".", $styleByHand)
        }
    }
    else {
        $styleRemedy = if ($Fix) { $styleByHand } else { "Fix: re-run doctor with -Fix, which asks before writing, or set it by hand." }
        Report "FAIL" "Output style" @("outputStyle is $formerOutputStyle, the plugin's former name, a style no installed plugin provides.", $styleRemedy)
    }
}
elseif ($settingsObj.PSObject.Properties.Name -contains "outputStyle") {
    Report "PASS" "Output style" @("outputStyle is '" + (Get-SanitizedLine "$($settingsObj.outputStyle)" 120) + "'.")
}
else {
    Report "PASS" "Output style" @("No outputStyle is set.")
}

# --- Status line. The kit ships no status-line widget. Its launcher stays
# --- installed at ~\.claude\bin\kit-statusline.js and prints one empty line,
# --- so a statusLine setting whose command names it draws nothing and prints
# --- no error, and the setting can go. This reads statusLine from the
# --- settings read the Auto-compaction window check made, and says nothing
# --- where the setting is absent, unreadable, or names another command.
if ($settingsReadable -and ($settingsObj.PSObject.Properties.Name -contains "statusLine") -and
    ("$($settingsObj.statusLine.command)" -match "kit-statusline\.js")) {
    Report "WARN" "Status line" @("statusLine in $settingsPath runs kit-statusline.js, which draws a blank status line now that the kit ships no status-line widget.", "Fix: remove the statusLine key from $settingsPath, or point it at another status line.")
}

# --- Plugin install. A host that installed the plugin under its former name
# --- has its enabledPlugins entry renamed by the marketplace's renames map,
# --- but a marketplace added from a git repository reports the renamed plugin
# --- not cached until it is installed once under the new name. This check
# --- reads ~/.claude/plugins/installed_plugins.json, whose plugins object is
# --- keyed <name>@<marketplace>, and where settings enable the plugin and that
# --- file has no entry for it, names the install command, which -Fix runs
# --- behind a consent prompt. Without -Fix it spawns nothing.
$installId = "grimoire@applefeld"
$installedPluginsPath = Join-Path $claudeDir "plugins\installed_plugins.json"
$installByHand = "Run by hand: claude plugin install $installId"
$installEnabled = $false
if ($settingsReadable -and ($settingsObj.PSObject.Properties.Name -contains "enabledPlugins") -and
    ($settingsObj.enabledPlugins -is [System.Management.Automation.PSCustomObject]) -and
    ($settingsObj.enabledPlugins.PSObject.Properties.Name -contains $installId)) {
    $enabledValue = $settingsObj.enabledPlugins.PSObject.Properties[$installId].Value
    $installEnabled = ($enabledValue -is [bool]) -and $enabledValue
}
if (-not $installEnabled) {
    Report "INFO" "Plugin install" @("$installId is not enabled in $settingsPath, so there is no install to check.")
}
elseif (-not (Test-Path -LiteralPath $installedPluginsPath)) {
    Report "WARN" "Plugin install" @("$installId is enabled, but $installedPluginsPath does not exist, so its install cannot be read.")
}
else {
    $installedObj = $null
    $installedReadError = $null
    try {
        $installedObj = Get-Content -LiteralPath $installedPluginsPath -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json
    }
    catch { $installedReadError = Get-SanitizedLine $_.Exception.Message 200 }
    if ($null -ne $installedReadError) {
        Report "WARN" "Plugin install" @("$installedPluginsPath could not be read or parsed, so the install of $installId cannot be read: $installedReadError")
    }
    elseif (-not ($installedObj -is [System.Management.Automation.PSCustomObject]) -or
            -not ($installedObj.plugins -is [System.Management.Automation.PSCustomObject])) {
        Report "WARN" "Plugin install" @("$installedPluginsPath has no plugins object, so the install of $installId cannot be read.")
    }
    elseif ($installedObj.plugins.PSObject.Properties.Name -contains $installId) {
        Report "PASS" "Plugin install" @("$installId is enabled and installed.")
    }
    else {
        $installGap = "$installId is enabled in settings but $installedPluginsPath has no entry for it, so Claude Code reports it not cached."
        if (-not $Fix) {
            Report "FAIL" "Plugin install" @($installGap, "Fix: claude plugin install $installId, or re-run doctor with -Fix to run it.")
        }
        else {
            # Applications only, so a function or alias named claude is never taken.
            $claudeCmd = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($null -eq $claudeCmd) {
                Report "FAIL" "Plugin install" @($installGap, "claude is not on PATH, so -Fix cannot run the install.", $installByHand)
            }
            elseif (Get-Consent "Run claude plugin install $installId?") {
                $installRun = Invoke-KitPluginInstall -ClaudeExe $claudeCmd.Source -InstallId $installId
                $installLines = @($installRun.lines | ForEach-Object { "  " + (Get-SanitizedLine $_ 120) } | Where-Object { $_.Trim() -ne "" })
                if ($installRun.code -eq 0) {
                    Report "FIXED" "Plugin install" (@("Ran claude plugin install ${installId}:") + $installLines)
                }
                else {
                    Report "FAIL" "Plugin install" (@("claude plugin install $installId exited $($installRun.code):") + $installLines + @($installByHand))
                }
            }
            else {
                Report "FAIL" "Plugin install" @($installGap, $installByHand)
            }
        }
    }
}

# --- Summary.
Write-Host ""
if ($script:failCount -gt 0) {
    Write-Host "$($script:failCount) check(s) FAILED, $($script:warnCount) warning(s)." -ForegroundColor Red
    exit 1
}
if ($script:warnCount -gt 0) {
    Write-Host "Healthy with $($script:warnCount) warning(s)." -ForegroundColor Yellow
    exit 0
}
Write-Host "All checks passed." -ForegroundColor Green
exit 0
