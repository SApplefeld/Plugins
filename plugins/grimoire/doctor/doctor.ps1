# Health check and setup for the grimoire plugin on this machine.
#
# Ships inside the plugin payload so every machine with the plugin installed
# has the current doctor, clone or not. The repo root keeps thin forwarders
# (doctor.ps1 / doctor.cmd) for the dev-clone habit.
#
# Verifies core setup (execution policy, files left under the plugin's former
# name, doctrine import and freshness, kaizen signpost, git hooks on a clone),
# the ANTHROPIC_API_KEY hazard, the hook layer (hook-canary wiring, node, the
# memq shim), the memory store's sync repo and its allowlist, the embedder
# behind semantic memory search, the .kit/ state directory's exposure, the
# shared memory database on the host, the auto-compaction window, the retired
# sidecar's task and state folder, the output style, a status-line setting that
# still names the kit's launcher, and the plugin's install.
#
#   .\doctor.ps1              Check only; prints PASS/WARN/FAIL with remediations.
#   .\doctor.ps1 -Fix         Also applies the safe durable repairs (execution
#                             policy, the memq shim into ~\.claude\bin,
#                             the memory store's sync repo and allowlist,
#                             signpost + git hooks on a clone, a memq db-sync
#                             where the memory database step warns, the move
#                             of files left under the plugin's former name
#                             and the rewrite of a CLAUDE.md import line that
#                             is exactly that name's token, and, each behind
#                             its own consent prompt, the autoCompactWindow
#                             and outputStyle values written into user
#                             settings.json and the plugin install). Behind
#                             one more consent prompt it disarms the retired
#                             sidecar: it unregisters the scheduled task
#                             claude-kit-sidecar-daemon, stops that daemon's
#                             node process under the kit clone, and removes
#                             ~\.claude\kit-sidecar with everything in it.
#                             Beyond that folder it deletes only files its own
#                             run wrote: the temp file a failed signpost write
#                             or import-line rewrite left, and the settings
#                             writer's temp file and pre-write backup.
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

# Memory-sync allowlist, state, and initialization helpers, beside this
# script. It resolves no paths of its own: this script is the only caller that
# knows the real store root, and passes it in.
. (Join-Path $PSScriptRoot "install-memory-sync.ps1")

# Embedder probe, install, and index-health helpers, beside this script. It
# resolves no paths of its own either: this script is the only caller that
# knows the real embedder root and store root, and passes both in.
. (Join-Path $PSScriptRoot "install-embedder.ps1")

# Auto-compaction-window writer for user settings.json, beside this script.
# It resolves no paths of its own: this script passes the settings path in,
# and the test suite passes a sandbox path.
. (Join-Path $PSScriptRoot "install-compact-window.ps1")

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

# --- Node. Every kit hook is a 'node ...' command, and the memq shim, Embedder
# --- and Memory database steps below run under node too, so an unresolved node
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

# --- Installed copy. On a clone, the memq shim, Memory sync and Embedder
# --- checks below also read the expected value of the kit copy this machine
# --- has installed, so a machine that matches the install and not the checkout
# --- in hand reads as trailing that checkout rather than as broken, and -Fix
# --- installs nothing there. The installed copy is the one the memq shim
# --- itself runs: the checkout's own scripts\memq-shim.js is required under
# --- node as a module, and its resolveMemq() answers
# --- <installed root>\scripts\memq.js. The shim path rides as argv, never
# --- inside the -e source, as the hook load check above does it, and that
# --- source holds no double quote, which Windows PowerShell 5.1 mangles in a
# --- native argument. No answer, a node failure, or an answer naming this
# --- payload itself reads as no installed copy, and the three checks then
# --- read exactly as they do without one.
# ---
# --- The lookup runs only when one of those checks first reads the machine
# --- short of this checkout (a resolving shim with a file missing or
# --- differing, a drifted sync allowlist file, or an embedder the checkout
# --- reads absent or unusable), and its answer is kept for the rest of the
# --- run, so a healthy run spawns no node for it. The resolver's stderr is
# --- kept rather than dropped: it carries the note naming which marketplace's
# --- copy it chose when several offer one, which is whose code the checks
# --- below then load, so a trailing INFO prints it.
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
    # own dynamic module as the Memory sync step does it, because the shim's
    # file set and the wrapper texts are defined in that file rather than read
    # from the payload's scripts. Every file that copy's own helpers name as
    # copied must exist in its scripts: the status function skips a copy it
    # cannot find, which would count a bin file as matching a copy that ships
    # none. An absent script, a missing function, or a throw reads as not
    # trailing.
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

# --- Memory sync. The memory store is ~\.claude itself, which also holds
# --- .credentials.json, settings.json, history.jsonl, and every session
# --- transcript, so the sync repo carries an allowlist that excludes
# --- everything and re-includes only the memory tiers and the coordinator
# --- directory. That allowlist is the entire barrier between syncing
# --- memories and publishing credentials, which is why this check
# --- re-derives it on every run and proves the
# --- negative directly (check-ignore on the sensitive files, a dry-run add,
# --- the tracked-file list, and committed history) rather than trusting a file
# --- that merely looks right. Any drift is a FAIL, never a warning. Every leak
# --- probe is printed in every state the section can report, because the
# --- states where the allowlist is least trustworthy are exactly the ones
# --- where a staged or committed secret most needs naming.
# ---
# --- install-memory-sync.ps1 (dot-sourced near the top of this script) owns
# --- the canonical text, the state reading, and the initialization, so the
# --- repo test suite exercises the same functions against a redirected store
# --- root. -Fix is additive: it initializes the repo, writes the two managed
# --- files, and commits what the allowlist admits. It never replaces a .git
# --- it did not create, and never rewrites a .gitignore or .gitattributes
# --- that does not carry the doctor's marker line.

# The leak probes as report lines, plus what to do about them, plus what to say
# when a probe could not answer. Every branch of the section below prints all
# three, because a report that names a broken allowlist without naming what is
# already staged or committed under it reads as reassurance, and a report whose
# leak list is empty because a probe errored reads as a clean index.
function Get-MemorySyncReportLines {
    param($Status)
    $leaks = @()
    foreach ($probe in $Status.NotIgnored) { $leaks += ("Not ignored: " + (Get-SanitizedLine $probe 200)) }
    foreach ($path in ($Status.Unexpected | Select-Object -First 5)) { $leaks += ("An add would stage: " + (Get-SanitizedLine $path 200)) }
    if ($Status.Unexpected.Count -gt 5) { $leaks += ("... and $($Status.Unexpected.Count - 5) more path(s) an add would stage.") }
    foreach ($path in ($Status.Tracked | Select-Object -First 5)) { $leaks += ("Already tracked: " + (Get-SanitizedLine $path 200)) }
    if ($Status.Tracked.Count -gt 5) { $leaks += ("... and $($Status.Tracked.Count - 5) more tracked path(s).") }
    foreach ($path in ($Status.HistoryPaths | Select-Object -First 5)) { $leaks += ("In committed history: " + (Get-SanitizedLine $path 200)) }
    if ($Status.HistoryPaths.Count -gt 5) { $leaks += ("... and $($Status.HistoryPaths.Count - 5) more path(s) in committed history.") }

    # A path in history is its own remedy: untracking leaves the blob
    # reachable, so only a rewrite removes it, and anything secret it held is
    # spent.
    $fixes = @("Untrack what should not be there (git rm --cached) and re-run this check; the doctor removes nothing.")
    if ($Status.HistoryPaths.Count -gt 0) {
        $fixes += "A path already committed stays reachable after git rm --cached: rewrite the history (or start the repository over) and rotate every credential that ever appeared in it."
    }

    # A probe that did not answer is the difference between a clean index and
    # an unread one, and the two are indistinguishable from an empty result
    # set, so the count says how much of the negative was actually proven.
    $unproven = @()
    if ($Status.IsRepo -and -not $Status.ProbesRan) {
        $unproven += ("Only " + $Status.ProbesAnswered + " of " + $Status.ProbesAttempted +
            " direct probes could answer, so the lines above are not a full account of what this repository holds and the negative is unproven.")
        $unproven += @($Status.Notes | ForEach-Object { Get-SanitizedLine $_ 200 })
    }
    # Outside a repository there is no probe to run and no index to read, so
    # any note is what the status has to say about the store root itself.
    $context = @()
    if (-not $Status.IsRepo) { $context += @($Status.Notes | ForEach-Object { Get-SanitizedLine $_ 200 }) }
    return @{ Leaks = $leaks; Fixes = $fixes; Unproven = $unproven; Context = $context }
}

# Whether a push from this store would reach the branch another machine's pull
# reads. Split by what an operator choice can explain: a detached HEAD, a
# branch tracking nothing, an upstream on some other remote, and a push.default
# that refuses this pair of branch names or refuses to push at all are broken in
# ways nobody opts into, so they block. A second branch on origin is the
# reported silent case, but a backup or an abandoned branch explains it too, so
# it is named rather than failed on: a check that exits 1 over a stale ref
# teaches the operator to stop reading this section.
function Get-MemorySyncDestinationLines {
    param($Status)
    $blocking = @()
    $advisory = @()

    if ($Status.Detached) {
        $blocking += "HEAD is detached, so commits here belong to no branch and a push sends nothing."
    }
    elseif ($Status.Branch -ne "" -and $Status.Upstream -eq "") {
        $blocking += ("Branch " + (Get-SanitizedLine $Status.Branch 200) +
            " tracks no upstream, so the close-out's pull and push have no destination.")
    }
    elseif ($Status.Upstream -ne "" -and -not $Status.Upstream.StartsWith("origin/")) {
        $blocking += ("Branch " + (Get-SanitizedLine $Status.Branch 200) + " tracks " +
            (Get-SanitizedLine $Status.Upstream 200) + ", which is not the origin reported above.")
    }

    # A branch that tracks a real branch on origin and still cannot publish to
    # it. The sync runner's push leg is a bare `git push`, so what happens to
    # this store's memories is push.default's to decide, and every check above
    # reads clean in each of the states below.
    #
    # git compares the raw branch.<name>.merge value against refs/heads/<local
    # branch> byte for byte, so the comparison is ordinal over the raw ref: a
    # case-only difference and a short form (`merge = main`) are both refusals
    # a normalized or case-insensitive comparison would call a match.
    $mergeRef = [string]$Status.UpstreamMergeRef
    $pairMismatch = ($Status.Branch -ne "" -and $mergeRef -ne "" -and
        -not [string]::Equals("refs/heads/" + $Status.Branch, $mergeRef, [System.StringComparison]::Ordinal))

    # The rename remedy is printed as a runnable command only where pasting it
    # is safe. Get-SanitizedLine guarantees printable ASCII, which is the
    # character set shell metacharacters live in, and git accepts `;`, `&&`,
    # `|`, `$()` and quotes in a branch name, so both names must also be within
    # a charset that carries none of them and must survive the sanitizer
    # unchanged, truncation marker included. Each name must also open on an
    # alphanumeric: a leading `-` carries no shell meaning at all, but git
    # reads it as an option, so a branch named `-f` composes
    # `git branch -m -f <upstream>`, a forced rename that clobbers an existing
    # ref rather than the rename this line advertises. A merge ref outside
    # refs/heads/ names no branch to rename to at all. Where any of that fails
    # the finding is still reported, in prose: refusing to print a command is
    # the answer, not quoting it.
    $renameSafe = ($pairMismatch -and
        $mergeRef.StartsWith("refs/heads/", [System.StringComparison]::Ordinal) -and
        $Status.Branch -match '^[A-Za-z0-9][A-Za-z0-9._/-]*$' -and
        $Status.UpstreamBranch -match '^[A-Za-z0-9][A-Za-z0-9._/-]*$' -and
        (Get-SanitizedLine $Status.Branch 200) -eq $Status.Branch -and
        (Get-SanitizedLine $Status.UpstreamBranch 200) -eq $Status.UpstreamBranch)
    $renameFix = @()
    if ($renameSafe) {
        $renameFix += ("Fix: rename the local branch to match its upstream (git branch -m " +
            (Get-SanitizedLine $Status.Branch 200) + " " + (Get-SanitizedLine $Status.UpstreamBranch 200) +
            ") in the store root.")
    }
    elseif ($pairMismatch) {
        $renameFix += ("Fix: rename the local branch " + (Get-SanitizedLine $Status.Branch 200) + " to " +
            (Get-SanitizedLine $Status.UpstreamBranch 200) +
            " in the store root. These branch names carry characters that make a pasted command unsafe, so no runnable command is printed here.")
    }

    # The value is matched case-sensitively because git parses it that way and
    # errors on anything it does not recognize, `Simple` included.
    $pushDefault = [string]$Status.PushDefault
    $setPushDefaultFix = "Fix: set push.default to simple in the store root (git config push.default simple)."
    if ($pushDefault -ceq "upstream" -or $pushDefault -ceq "tracking") {
        # The push follows the upstream ref whatever the two names are, so a
        # differing pair costs nothing and is not a finding.
    }
    elseif ($pushDefault -ceq "simple") {
        if ($pairMismatch) {
            # Fatal on every run, while every check above it reads clean.
            $blocking += ("Branch " + (Get-SanitizedLine $Status.Branch 200) + " tracks " +
                (Get-SanitizedLine $Status.Upstream 200) +
                ", and push.default simple refuses a push whose branch names differ, so the store's automated push fails on every run.")
            $blocking += $renameFix
        }
    }
    elseif ($pushDefault -ceq "matching") {
        if ($pairMismatch) {
            # The quietest of the set: matching updates only branches carrying
            # the same name on both ends, so a differing pair matches nothing
            # and the runner records a success for a push that published
            # nothing.
            $blocking += ("Branch " + (Get-SanitizedLine $Status.Branch 200) + " tracks " +
                (Get-SanitizedLine $Status.Upstream 200) +
                ", and push.default matching updates only branches that carry the same name on both ends, so the store's automated push exits successfully while publishing nothing to the branch this store pulls from.")
            $blocking += $renameFix
        }
    }
    elseif ($pushDefault -ceq "nothing") {
        # Names are irrelevant here: a bare push under this setting errors out
        # for want of a refspec, matched pair or not.
        $blocking += "push.default is set to nothing, so a bare push errors out for want of a refspec and the store's automated push fails on every run, whatever the branch names are."
        $blocking += $setPushDefaultFix
    }
    elseif ($pushDefault -ceq "current") {
        if ($pairMismatch) {
            # The push succeeds, and lands on a branch named after the local
            # one rather than on the upstream this store pulls from. Advisory
            # rather than blocking: the memories are published, just where no
            # other machine reads them.
            $advisory += ("Branch " + (Get-SanitizedLine $Status.Branch 200) + " tracks " +
                (Get-SanitizedLine $Status.Upstream 200) +
                ", and push.default current publishes to the branch on origin named after the local branch, so this store's memories land somewhere the other machines never pull from.")
            $advisory += $renameFix
        }
    }
    else {
        $blocking += ("push.default is set to " + (Get-SanitizedLine $pushDefault 200) +
            ", which git does not recognize, so it refuses every push in this store as a malformed config value.")
        $blocking += $setPushDefaultFix
    }

    $others = @($Status.RemoteBranches | Where-Object { $_ -ne $Status.Upstream })
    if ($Status.Upstream -ne "" -and $others.Count -gt 0) {
        $advisory += ("This machine tracks " + (Get-SanitizedLine $Status.Upstream 200) + ", and origin also carries " +
            (($others | Select-Object -First 5 | ForEach-Object { Get-SanitizedLine $_ 200 }) -join ", ") +
            ". A machine pushing to one of those never reaches this store, and neither side reports an error.")
        $advisory += "That reads local refs as of the last fetch; this check makes no network call."
    }
    return @{ Blocking = $blocking; Advisory = $advisory }
}

# The paths a fetched upstream commit writes into this machine's own
# coordinator directory, as report lines. The sync runner refuses such an
# intake and records the reason code alone, its only output channel being the
# state file, so this is where the operator who has to repair the remote learns
# WHICH commit and WHICH paths: the runner leaves the fetched tip in place for
# exactly that reason. The read is the runner's own
# (Get-MemorySyncInboundForeignPaths), so the report cannot name a different
# set than the refusal acted on.
#
# No ahead/behind count is read first: the diff runs from the merge base of
# HEAD and the fetched tip, which is the tip itself when the upstream is not
# ahead, so an in-sync or ahead-only store produces an empty diff by
# construction and no lines here. Every string comes out of the store, so each
# is sanitized like the installer's notes are.
#
# The classification is by path alone, so the pushing machine may be this one:
# a commit this machine published, met by a local HEAD that has since moved
# back (a reset during a repair, a store restored from backup or a snapshot, a
# re-clone of an older state), reads exactly like a peer writing in. The remote
# is correct in that case and the store is behind it, so the lines name both
# repairs and leave the operator, who knows which state the box is in, to pick.
function Get-MemorySyncInboundOwnLines {
    param([Parameter(Mandatory = $true)][hashtable]$Status)
    if (-not $Status.IsRepo -or -not $Status.IsOwnRepo -or $Status.Upstream -eq "") { return @() }
    $revUp = Invoke-MemorySyncGit -StoreRoot $Status.StoreRoot -Arguments @("rev-parse", "--verify", "@{upstream}")
    $upstreamSha = if ($revUp.Output.Count -gt 0) { ([string]$revUp.Output[-1]).Trim() } else { "" }
    if ($revUp.Code -ne 0 -or $upstreamSha -cnotmatch $script:MemorySyncObjectIdPattern) { return @() }
    $machine = ""
    try { $machine = [string](Get-MemorySyncMachineName) } catch { $machine = "" }
    $found = Get-MemorySyncInboundForeignPaths -StoreRoot $Status.StoreRoot -Ref $upstreamSha -Machine $machine
    if (-not $found.Ok -or @($found.Paths).Count -eq 0) { return @() }
    $paths = @($found.Paths)
    $named = (($paths | Select-Object -First 5 | ForEach-Object { Get-SanitizedLine $_ 200 }) -join ", ")
    if ($paths.Count -gt 5) { $named += " (and " + ($paths.Count - 5) + " more)" }
    return @(
        ("The fetched commit " + (Get-SanitizedLine $upstreamSha 200) + " on " + (Get-SanitizedLine $Status.Upstream 200) +
            " writes " + $paths.Count + " path(s) inside this machine's own coordinator directory, which only this machine writes: " + $named),
        ("The sync refuses that intake rather than rebasing it, so the store stays gated until one of two repairs is made, " +
            "and which one depends on where those paths were written."),
        ("If another machine wrote them, the correction is made on that machine by hand with git (commit the undo and push it directly): " +
            "its own sync gate refuses to stage a write under this machine's coordinator directory, so the kit's channel cannot carry the fix."),
        ("If this machine pushed them itself and its HEAD has since moved back (a reset, a restore from a backup or a snapshot, a re-clone of an older state), " +
            "the remote is correct and the repair is local: bring HEAD back up to the upstream rather than changing the remote.")
    )
}

# The report a machine name that reads blank earns, and the state it describes.
# Neither direction of the sync can tell this machine's coordinator directory
# from another's without the name, so the installer refuses every commit and the
# runner refuses every intake, and the two states the runner can record (a
# failed commit and an unproven read) name none of that.
#
# These lines carry a verdict rather than riding as detail. A store that commits
# nothing and rebases nothing is a store not syncing at all, and the reports
# below print detail under a summary line the operator reads as the verdict, so
# a line saying so under a PASS would be the failure with a caption on it. The
# reading is the installer's own (Get-MemorySyncMachineName), and it needs no
# repository state, so it answers on a store with no upstream and no remote at
# all: a blank name stops the sync whether or not the branch tracks anything.
function Get-MemorySyncMachineNameLines {
    $machine = ""
    try { $machine = [string](Get-MemorySyncMachineName) } catch { $machine = "" }
    if ($machine.Trim() -ne "") { return @() }
    return @(
        ("This machine's own name reads blank, so the sync can tell neither a staged nor an incoming coordinator path " +
            "from another machine's: nothing is committed and nothing is rebased until the machine name resolves."),
        "Fix: give this machine a host name the system resolves (the sync reads [System.Net.Dns]::GetHostName()), then re-run this check."
    )
}

$syncStatus = Get-MemorySyncStatus -StoreRoot $claudeDir
$syncFixNotes = @()
$syncReported = $false

if (-not $syncStatus.GitAvailable) {
    Report "WARN" "Memory sync" @(
        "git is not on PATH, so the memory store's sync repo cannot be checked or initialized.",
        "Install git and re-run the doctor; every other check above is unaffected."
    )
}
else {
    $syncForeign = @()
    if ($syncStatus.IgnoreState -eq "Foreign") { $syncForeign += ".gitignore" }
    if ($syncStatus.AttrState -eq "Foreign") { $syncForeign += ".gitattributes" }
    # A repository at the store root that the doctor did not create is nobody
    # else's to write in, and a managed file the doctor did not write is left
    # as found, which means the installer's canonical-allowlist gate refuses to
    # stage anything there. Neither case is offered a -Fix, because the repair
    # the prompt describes is one the installer will not perform.
    $syncAdoptable = ((-not $syncStatus.IsRepo) -or $syncStatus.IsOwnRepo) -and ($syncForeign.Count -eq 0)
    # Every repairable state of both managed files, so a check that prints
    # "re-run with -Fix" is one -Fix actually acts on. A missing file counts:
    # a repo recognized by its config marker with no .gitignore on disk has no
    # rules at all, which is the state most in need of the repair.
    #
    # The last clause is what closes the steady-state hole: a repository
    # already canonical on both managed files never used to reach
    # Install-MemorySyncRepo at all, so -Fix committed nothing beyond the
    # first heal that made it canonical, and every memory a session wrote
    # afterward stayed local until the next drift. Dirty is true only inside
    # an owned repo (Get-MemorySyncStatus leaves it false outside one), so
    # this clause cannot fire for a repo $syncAdoptable would refuse anyway.
    $syncNeedsWork = $syncAdoptable -and ((-not $syncStatus.IsRepo) -or
        $syncStatus.IgnoreState -eq "Missing" -or $syncStatus.IgnoreState -eq "Drift" -or
        $syncStatus.AttrState -eq "Missing" -or $syncStatus.AttrState -eq "Drift" -or
        $syncStatus.Dirty)

    # Trailing: a managed file drifted from the allowlist this checkout derives
    # while both read canonical against the allowlist the installed copy
    # derives. The installed copy's derivation runs in its own dynamic module,
    # so its functions and its script-scope values never replace this script's
    # own. A trailing store is healthy for the kit this machine runs, so its
    # drift is no gap here and -Fix skips Install-MemorySyncRepo whole: that
    # installer restores any managed file reading drifted against this
    # checkout's derivation before it commits, which would install this
    # checkout's allowlist on the machine. Any failure to derive reads as no
    # installed copy.
    $syncTrailing = $false
    if ($syncStatus.IsRepo -and $syncStatus.IsOwnRepo -and
        ($syncStatus.IgnoreState -eq "Drift" -or $syncStatus.AttrState -eq "Drift")) {
        $installedRoot = Get-InstalledKitRoot
    }
    if ($null -ne $installedRoot -and $syncStatus.IsRepo -and $syncStatus.IsOwnRepo -and
        ($syncStatus.IgnoreState -eq "Drift" -or $syncStatus.AttrState -eq "Drift")) {
        $installedSyncScript = Join-Path $installedRoot "doctor\install-memory-sync.ps1"
        if (Test-Path -LiteralPath $installedSyncScript -PathType Leaf) {
            try {
                $installedSyncModule = New-Module -ScriptBlock { param($SyncScript) . $SyncScript; Export-ModuleMember } -ArgumentList $installedSyncScript
                $installedSyncStates = @(& $installedSyncModule {
                    param($StoreRoot)
                    foreach ($managed in (Get-MemorySyncManagedFiles)) {
                        Get-MemorySyncFileState -Path (Join-Path $StoreRoot $managed.Name) -Expected $managed.Text
                    }
                } $claudeDir)
                $syncTrailing = ($installedSyncStates.Count -eq 2 -and @($installedSyncStates | Where-Object { $_ -ne "Canonical" }).Count -eq 0)
            }
            catch { $syncTrailing = $false }
        }
    }
    $syncTrailLines = @()
    if ($syncTrailing) {
        $syncTrailLines += ("The allowlist matches the one the installed copy derives and differs from this checkout's, so it trails the checkout in hand: " + (Get-SanitizedLine $installedRoot 200))
        if ($Fix) {
            $syncTrailLines += ("-Fix left this store as found: the commit of pending memory changes runs from the installed copy's doctor, " + (Get-SanitizedLine (Join-Path $installedRoot "doctor\doctor.cmd") 200) + " -Fix.")
        }
        $syncTrailLines += @($script:InstalledKitResolverNotes | ForEach-Object { Get-SanitizedLine $_ 200 })
    }

    if ($Fix -and $syncNeedsWork -and -not $syncTrailing) {
        # Three shapes, not two: the prompt must never describe a repair that
        # is not happening, so a canonical repo that only needs its pending
        # changes committed asks about exactly that, never about restoring an
        # allowlist that is already right.
        #
        # Every shape names both parts of the store the commit carries. The
        # allowlist admits the memory tiers and the coordinator directory, so
        # a prompt naming only the tiers asks consent for less than the commit,
        # and the sync runner's later push that carries it, actually publish.
        $syncQuestion = if (-not $syncStatus.IsRepo) {
            "Initialize $claudeDir as the memory-sync git repository (allowlist plus one commit of the memory tiers and the coordinator directory)?"
        }
        elseif ($syncStatus.IgnoreState -ne "Canonical" -or $syncStatus.AttrState -ne "Canonical") {
            "Restore the canonical memory-sync allowlist in $claudeDir and commit the memory tiers and the coordinator directory?"
        }
        else {
            "Commit $($syncStatus.DirtyCount) pending change(s) to the memory tiers and the coordinator directory in $claudeDir through the gated allowlist?"
        }
        if (Get-Consent $syncQuestion) {
            $syncInstall = Install-MemorySyncRepo -StoreRoot $claudeDir
            # The installer's notes name paths and quote git's output, both of
            # which come from the store rather than from this script, so they
            # are sanitized like every other store-derived string before
            # reaching a report a human reads to make a security decision.
            if (-not $syncInstall.Ok) {
                # Re-read before reporting: a refusal can follow an init or an
                # add, so the repository the operator is being told about is
                # the one on disk now, not the one the attempt started from.
                $syncStatus = Get-MemorySyncStatus -StoreRoot $claudeDir
                $syncFailed = Get-MemorySyncReportLines $syncStatus
                # A blank machine name is why the installer refuses every
                # commit, so the remedy rides this refusal too. The reading is
                # the installer's own and needs no repository state, and the
                # function is called here rather than reading the tail variable
                # the check-mode branches share, which is assigned further down
                # and past this return path.
                Report "FAIL" "Memory sync" (@($syncInstall.Notes | ForEach-Object { Get-SanitizedLine $_ 200 }) +
                    $syncFailed.Leaks +
                    $(if ($syncFailed.Leaks.Count -gt 0) { $syncFailed.Fixes } else { @() }) +
                    $syncFailed.Unproven + $syncFailed.Context + (Get-MemorySyncMachineNameLines) +
                    (Get-MemorySyncInboundOwnLines $syncStatus))
                $syncReported = $true
            }
            else {
                $syncFixNotes += $syncInstall.Notes
                # Re-read after writing: the report describes the state on disk
                # now, never the state that prompted the repair.
                $syncStatus = Get-MemorySyncStatus -StoreRoot $claudeDir
                $syncForeign = @()
                if ($syncStatus.IgnoreState -eq "Foreign") { $syncForeign += ".gitignore" }
                if ($syncStatus.AttrState -eq "Foreign") { $syncForeign += ".gitattributes" }
            }
        }
    }

    if (-not $syncReported) {
        $syncGaps = @()
        foreach ($pair in @(@(".gitignore", $syncStatus.IgnoreState), @(".gitattributes", $syncStatus.AttrState))) {
            if ($pair[1] -eq "Drift" -and -not $syncTrailing) { $syncGaps += "$($pair[0]) differs from the allowlist this doctor derives." }
            if ($pair[1] -eq "Missing" -and $syncStatus.IsRepo) { $syncGaps += "$($pair[0]) is missing." }
        }
        $syncReport = Get-MemorySyncReportLines $syncStatus
        $syncLeaks = $syncReport.Leaks
        # The leak fixes ride wherever the leaks do, and the unproven lines
        # ride everywhere, because an empty leak list means nothing when a
        # probe could not answer.
        # An upstream commit writing this machine's own coordinator directory is
        # a finding about the remote rather than about this store's allowlist,
        # so it rides every branch below as a named path and changes no
        # verdict: the store's own state is exactly what the branch says it is,
        # and what the operator gains here is the commit and the paths the
        # runner's reason code alone cannot carry. An in-sync store produces no
        # lines, so nothing changes for a healthy report.
        $syncInboundOwn = Get-MemorySyncInboundOwnLines $syncStatus
        # A blank machine name is the other finding this section carries, and
        # unlike the inbound lines it sets a verdict: it rides the tail here so
        # the FAIL branches below name it beside their own finding, and it has
        # its own branch further down for the store that is otherwise healthy.
        # A box whose name resolves produces no lines either way.
        $syncMachineBlank = Get-MemorySyncMachineNameLines
        $syncTail = $(if ($syncLeaks.Count -gt 0) { $syncReport.Fixes } else { @() }) + $syncReport.Unproven +
            $syncInboundOwn + $syncMachineBlank
        # Notes from the installer quote paths and git output, so they carry
        # the same sanitization every other store-derived string does.
        $syncFixLines = @($syncFixNotes | ForEach-Object { Get-SanitizedLine $_ 200 })

        if ($syncForeign.Count -gt 0) {
            # Someone else's file: rewriting it would destroy their rules, so
            # the doctor names it and stops. No -Fix is offered here, because
            # none is going to run. The leak probes are printed all the same:
            # this is a state in which the rules are unknown, which is when
            # what an add would stage and what is already committed matter
            # most.
            Report "FAIL" "Memory sync" ($syncFixLines + @(
                ("$claudeDir holds a " + ($syncForeign -join " and a ") + " the doctor did not write, so the memory-sync allowlist cannot be trusted."),
                "The store root holds .credentials.json, settings.json, history.jsonl, and every session transcript.",
                "Review that file by hand; move it aside to let the doctor write the canonical allowlist."
            ) + $syncLeaks + $syncTail)
        }
        elseif ($syncStatus.IsRepo -and -not $syncStatus.IsOwnRepo) {
            # A repository here that carries no doctor-written allowlist was
            # created by someone else (an operator versioning their dotfiles at
            # the store root). Writing an allowlist and committing into it
            # would put the memory tiers and the coordinator directory, and
            # whatever that repo had staged, in a commit and possibly a push
            # nobody asked for.
            Report "FAIL" "Memory sync" ($syncFixLines + @(
                "$claudeDir is already a git repository the doctor did not create, and it carries no memory-sync allowlist.",
                "The store root holds .credentials.json, settings.json, history.jsonl, and every session transcript, all of which that repository can stage.",
                "Review it by hand; the doctor writes nothing into a repository it did not create."
            ) + $syncLeaks + $syncTail)
        }
        elseif (-not $syncStatus.IsRepo) {
            # The machine lines ride here because this branch's only advice is
            # to re-run with -Fix, and a blank machine name is exactly what the
            # installer that recipe invokes refuses on, so without them the
            # operator is sent to a repair that cannot run. The reading needs
            # no repository state, which is what lets it answer on a store root
            # that is not a repository at all.
            Report "WARN" "Memory sync" (@(
                "$claudeDir is not a git repository, so the memory store does not sync across machines.",
                "Fix: re-run doctor with -Fix (initializes the repo with the gated allowlist from $(Get-PayloadCopyName) and commits the memory tiers and the coordinator directory)."
            ) + $syncReport.Context + $syncMachineBlank)
        }
        elseif ($syncGaps.Count -gt 0) {
            # A missing or drifted allowlist is the other state in which the
            # rules cannot be trusted, so the leak probes are printed here for
            # the same reason they are printed above: what an add would reach
            # and what is already staged or committed is the whole question.
            # Both gaps are this payload's readings: a drifted file is judged
            # against the text its install-memory-sync.ps1 derives, and a
            # missing one against the managed-file set that file names, so
            # the report names that copy either way.
            Report "FAIL" "Memory sync" ($syncFixLines + $syncGaps + @(
                "Until it matches, an add in $claudeDir can stage credentials, settings, and session transcripts.",
                "Fix: re-run doctor with -Fix (restores the canonical allowlist from $(Get-PayloadCopyName))."
            ) + $syncLeaks + $syncTail + @(Get-PayloadClause))
        }
        elseif ($syncLeaks.Count -gt 0) {
            Report "FAIL" "Memory sync" ($syncFixLines + $syncLeaks + @(
                "The allowlist reads as expected, but the repository state above puts non-memory paths in reach of a push."
            ) + $syncTail + $syncTrailLines)
        }
        elseif (-not $syncStatus.ProbesRan) {
            # A probe that could not run proves nothing, and this is the report
            # the operator reads before giving the store a remote, so an
            # unanswerable probe is a failure rather than a warning: a warning
            # exits 0 under a "healthy" summary line.
            # The inbound lines and a blank machine name ride here too: an
            # unanswerable probe is about the allowlist, an upstream writing
            # this machine's own coordinator directory is about the remote, and
            # a name that reads blank is about the box, so an operator hitting
            # more than one needs each of them. The first is read from the
            # repo's refs and HEAD and the second from the machine, neither of
            # which the leak probes' failure disturbs.
            Report "FAIL" "Memory sync" (@(
                "The allowlist matches on disk, but what this repository would actually publish is unverified."
            ) + $syncReport.Unproven + $syncInboundOwn + $syncMachineBlank + $syncTrailLines)
        }
        elseif ($syncMachineBlank.Count -gt 0) {
            # Everything about the allowlist reads clean, and the store still
            # syncs nothing in either direction, so this is the last branch that
            # can hold a finding before the healthy reports begin. It fails
            # rather than warns for the reason the unproven branch above does: a
            # warning exits 0 under a summary line, and the reports below this
            # one end by handing the operator a push recipe for a store that
            # cannot commit.
            Report "FAIL" "Memory sync" ($syncFixLines + $syncMachineBlank + $syncInboundOwn + $syncTrailLines)
        }
        else {
            $syncDetail = @(
                ("Allowlist canonical; " + $syncStatus.Probed.Count + " sensitive path(s) proven ignored, an add would stage memory paths only, and no non-memory blob is reachable in committed history.")
            )
            if ($syncStatus.Remote -ne "") { $syncDetail += ("origin: " + (Get-SanitizedLine (Get-RedactedRemote $syncStatus.Remote) 200)) }
            # The branches below carry $syncDetail rather than $syncTail, so the
            # inbound lines join it here to reach them; an in-sync store adds
            # nothing.
            $syncDetail += $syncInboundOwn
            # Reached either from a plain check (no -Fix) or from a -Fix run
            # whose commit succeeded and cleared the worktree: $syncStatus was
            # re-read after that commit, so Dirty is already false there and
            # this line adds nothing beside the FIXED notes above it. A check
            # that stayed silent about pending, uncommitted memories would
            # tell an operator the store is fine while it holds unsynced work;
            # check mode cannot commit them, but it can say they are there.
            if ($syncStatus.Dirty) {
                # The count leads with a string, never bare: "$int + ' text'"
                # asks PowerShell to add an integer to a string and throws,
                # where "'' + $int + ' text'" concatenates as intended.
                # A trailing store's commit is the installed copy's doctor's
                # to make, since -Fix from this checkout skips the installer.
                $syncDirtyFix = if ($syncTrailing) { "Fix: run the installed copy's doctor with -Fix (commits them through the allowlist it derives)." } else { "Fix: re-run doctor with -Fix (commits them through the gated allowlist)." }
                $syncDetail += ("" + $syncStatus.DirtyCount + " uncommitted change(s) under the allowlist, not yet committed. " + $syncDirtyFix)
            }
            $syncDetail += $syncTrailLines
            # The allowlist is sound from here down, so nothing below is a leak.
            # What is left to prove is that the store publishes somewhere: every
            # probe above can read clean on a store that syncs nowhere, which is
            # a passing report on a memory tier no other machine will ever see.
            $syncDest = Get-MemorySyncDestinationLines $syncStatus

            if ($syncStatus.Remote -eq "") {
                Report "WARN" "Memory sync" ($syncFixLines + $syncDetail + @(
                    "No origin remote, so the store is versioned locally and replicates nowhere: nothing this machine records leaves it, and nothing another machine records arrives.",
                    "Fix: add the private remote (git -C `"$claudeDir`" remote add origin <url>) and push the branch with -u."
                ))
            }
            elseif ($syncDest.Blocking.Count -gt 0) {
                # The remedy below repairs the three findings that leave this
                # store without a usable destination on origin: a HEAD on no
                # branch, a branch tracking nothing, and a branch tracking some
                # remote other than origin. It is withheld from every other
                # finding, which carries its own remedy, because running
                # `push -u origin <branch>` against a branch whose upstream on
                # origin is already correct creates a second branch there and
                # repoints the upstream at it, which is exactly the silent
                # cross-machine divergence the advisory check above reports.
                $syncDestFix = @()
                if ($syncStatus.Detached -or $syncStatus.Upstream -eq "" -or
                    -not $syncStatus.Upstream.StartsWith("origin/")) {
                    $syncDestFix += "Fix: put HEAD on the sync branch and give it an upstream (git -C `"$claudeDir`" push -u origin <branch>)."
                }
                Report "FAIL" "Memory sync" ($syncFixLines + $syncDetail + $syncDest.Blocking + $syncDest.Advisory + $syncDestFix)
            }
            elseif (-not $syncStatus.DestinationRead) {
                Report "WARN" "Memory sync" ($syncFixLines + $syncDetail + @(
                    "The branch this store would push to could not be read, so whether it reaches any other machine is unverified."
                ))
            }
            elseif ($syncDest.Advisory.Count -gt 0) {
                Report "WARN" "Memory sync" ($syncFixLines + $syncDetail + $syncDest.Advisory)
            }
            elseif (-not $syncStatus.RemoteBranchesRead -or $syncStatus.RemoteBranches.Count -eq 0) {
                # The sole-branch claim below rests on having read origin's
                # branches. An unreadable or empty set is not evidence of one
                # branch, and saying so from zero observations is the same
                # mistake as reading an empty leak probe as a clean index.
                Report "WARN" "Memory sync" ($syncFixLines + $syncDetail + @(
                    ("Branch " + (Get-SanitizedLine $syncStatus.Branch 200) + " tracks " +
                        (Get-SanitizedLine $syncStatus.Upstream 200) + ", but no remote-tracking branch for origin could be read here, so whether this store shares a branch with the other machines is unverified."),
                    "Fix: run git -C `"$claudeDir`" fetch origin, then re-run this check."
                ))
            }
            else {
                $syncDetail += ("Destination: " + (Get-SanitizedLine $syncStatus.Branch 200) + " tracks " +
                    (Get-SanitizedLine $syncStatus.Upstream 200) + ", the only branch on origin.")
                if ($syncFixLines.Count -gt 0) {
                    # The commit's other half, stated rather than left to
                    # inference: this block reports a commit directly beside an
                    # "origin:" line and a "Destination:" line naming the branch
                    # this store tracks, and a commit reported beside a
                    # destination with nothing said about publication reads as
                    # published. The push lives in the sync runner alone
                    # (sync-store.ps1), so a -Fix run's outcome is local, and
                    # both carriers of the commit are named.
                    #
                    # This is the only branch that may carry the recipe, and the
                    # reason is the whole point of the report it sits in. Every
                    # other branch reachable from here is a FAIL or a WARN,
                    # including the FAIL raised because a non-memory blob is
                    # reachable in committed history, where handing the operator
                    # a push command would hand them the exact act the leak
                    # probes exist to stop. Only here has the store proven both
                    # that it publishes nothing it should not and that it has a
                    # destination to publish to, so only here is a push the
                    # right next step. $claudeDir is the doctor's own derived
                    # path rather than a store-supplied string, so it embeds
                    # raw like the other Fix lines in this section: sanitizing
                    # it would silently strip a non-ASCII profile name out of a
                    # command the operator is meant to copy.
                    Report "FIXED" "Memory sync" ($syncFixLines + $syncDetail + @(
                        "Committed, not pushed: the commit is local until something carries it, either the background sync runner at the next session start or the manual push below.",
                        "Manual push: git -C `"$claudeDir`" pull --rebase, then git -C `"$claudeDir`" push."
                    ))
                }
                elseif ($syncTrailing) { Report "INFO" "Memory sync" $syncDetail }
                else { Report "PASS" "Memory sync" $syncDetail }
            }
        }
    }
}

# --- Embedder (semantic memory search). memq find's semantic channel needs an
# --- in-process embedding stack that ships outside the plugin payload (the kit
# --- core stays dependency-free), so this section reports whether it is
# --- installed, installs it under -Fix, and reports the derived index's health
# --- without ever sweeping or writing it: the index rebuilds itself, and a
# --- doctor that touched it while reporting on it would have changed the thing
# --- it was reporting.
# ---
# --- install-embedder.ps1 (dot-sourced near the top of this script) owns the
# --- probe, the install, and the index-health reading, so the repo test suite
# --- exercises the same functions against a redirected embedder root and store
# --- root. probeEmbedder's three states get three different reports: 'absent'
# --- is nothing installed yet, 'unusable' is a broken or incomplete install (a
# --- repair, never mistaken for a fresh install), and 'ready' is a working
# --- semantic channel. Absence is a WARN, not a FAIL: memq find degrades to its
# --- lexical channel with a loud line, so a machine without the stack is a
# --- working install with a named gap, the same reading every other optional
# --- capability in this doctor gets.
# "kit-embedder" mirrors memory-index.js's EMBEDDER_DIR constant and
# memq.js's OPERATOR_DIR-style literal duplication: PowerShell cannot import a
# CommonJS constant, so the two sides of this contract are pinned by comment
# rather than by a shared definition, the same way $script:EmbedderConsentSizeMB
# in install-embedder.ps1 is a measured figure rather than a computed one.
$embedderRoot = Join-Path $claudeDir "kit-embedder"
$embedderScript = Join-Path $pluginRoot "scripts\memory-index.js"

if ($null -eq $nodeCmd) {
    Report "INFO" "Embedder (semantic search)" @("Skipped (node unresolved; the Node check above already FAILs on that, and the embedder probe runs under node).")
}
elseif (-not (Test-Path -LiteralPath $embedderScript)) {
    Report "FAIL" "Embedder (semantic search)" @("memory-index.js not found at $embedderScript; this plugin payload is incomplete.")
}
else {
    $embedProbe = Get-EmbedderProbe -MemoryIndexPath $embedderScript -EmbedderRoot $embedderRoot -NodeExe $nodeCmd.Source
    $embedFixNotes = @()
    $embedReported = $false

    # Trailing: the absent and unusable readings are judged against this
    # checkout's memory-index.js (the package it names and the model files it
    # expects), so on a clone a machine healthy for the kit it runs can read
    # either. Where it does, the same probe runs against the installed copy's
    # memory-index.js, with the same embedder root and node, and a 'ready'
    # there reads INFO: that copy's memq is the one this machine runs, and
    # -Fix offers no install, since installing this checkout's stack is the
    # change the operator did not ask for by running a checkout. No installed
    # copy, no memory-index.js in it, a throw, or any other reading leaves
    # the step exactly as it reads without one. 'probe-failed' against this
    # checkout never looks, since this payload's own module could not answer.
    $embedTrailing = $false
    $embedInstalledProbe = $null
    if ($embedProbe.status -eq 'absent' -or $embedProbe.status -eq 'unusable') {
        $installedRoot = Get-InstalledKitRoot
        if ($null -ne $installedRoot) {
            $installedEmbedderScript = Join-Path $installedRoot "scripts\memory-index.js"
            if (Test-Path -LiteralPath $installedEmbedderScript -PathType Leaf) {
                try {
                    $embedInstalledProbe = Get-EmbedderProbe -MemoryIndexPath $installedEmbedderScript -EmbedderRoot $embedderRoot -NodeExe $nodeCmd.Source
                    $embedTrailing = ($null -ne $embedInstalledProbe -and $embedInstalledProbe.status -eq 'ready')
                }
                catch { $embedTrailing = $false }
            }
        }
    }

    # Gated on 'absent' or 'unusable' specifically, never on "not ready":
    # 'probe-failed' (the module present but unloadable, an incomplete plugin
    # payload) also reads not-ready, and offering a fresh install there would
    # promise a multi-hundred-megabyte download that cannot fix a payload
    # problem, ending in FAIL regardless. 'probe-failed' takes its own report
    # in the switch below instead, and never reaches a consent prompt.
    if ($Fix -and -not $embedTrailing -and ($embedProbe.status -eq 'absent' -or $embedProbe.status -eq 'unusable')) {
        if ($null -eq (Get-Command npm -ErrorAction SilentlyContinue)) {
            # The consent prompt must not promise a repair the installer will
            # refuse to perform: Install-Embedder itself checks for npm and
            # returns Ok=false without ever prompting, so this mirrors that
            # refusal before a prompt is even offered, the same shape the
            # memq shim's "no payload to run" WARN takes. No prompt is shown,
            # and this rides as an extra note on the ordinary absent/unusable
            # report below rather than replacing it, so the index-health lines
            # every other state gets still print here too.
            $embedFixNotes = @(
                "npm is not on PATH, so the embedding stack cannot be installed.",
                "Install Node.js (which ships npm) and re-run doctor -Fix."
            )
        }
        else {
            $embedQuestion = if ($embedProbe.status -eq 'unusable') {
                "Repair the local embedding stack at $embedderRoot (re-downloads the missing model files; the full install is about $($script:EmbedderConsentSizeMB) MB on disk)?"
            }
            else {
                "Install the local embedding stack into $embedderRoot (about $($script:EmbedderConsentSizeMB) MB on disk; enables memq find's semantic channel)?"
            }
            if (Get-Consent $embedQuestion) {
                $embedInstall = Install-Embedder -PluginRoot $pluginRoot -EmbedderRoot $embedderRoot -NodeExe $nodeCmd.Source
                # Re-probe either way: the report below must describe the
                # install as it actually stands after this attempt, never as
                # the attempt hoped it would.
                $embedProbe = Get-EmbedderProbe -MemoryIndexPath $embedderScript -EmbedderRoot $embedderRoot -NodeExe $nodeCmd.Source
                $embedInstallNotes = @($embedInstall.Notes | ForEach-Object { Get-SanitizedLine $_ 300 })
                if (-not $embedInstall.Ok) {
                    Report "FAIL" "Embedder (semantic search)" ($embedInstallNotes + @(
                        "Semantic channel inactive; memq find serves lexical results only, with a loud absence line naming the remedy.",
                        "The install directory is left in place for diagnosis; the doctor deletes nothing."
                    ))
                    $embedReported = $true
                }
                else {
                    $embedFixNotes = $embedInstallNotes
                }
            }
        }
    }

    if (-not $embedReported) {
        # A trailing machine's index is read through the installed copy's
        # memory-index.js and judged against the model identity that copy
        # reads as installed, since that copy's memq builds it.
        $embedIndexScript = if ($embedTrailing) { $installedEmbedderScript } else { $embedderScript }
        $embedIndexHealth = Get-EmbedderIndexHealth -MemoryIndexPath $embedIndexScript -EmbedderRoot $embedderRoot -StoreRoot $claudeDir -NodeExe $nodeCmd.Source
        $embedIndexProbe = if ($embedTrailing) { $embedInstalledProbe } else { $embedProbe }
        $embedIndexLines = @((Get-EmbedderIndexHealthLines -IndexHealth $embedIndexHealth -Probe $embedIndexProbe) | ForEach-Object { Get-SanitizedLine $_ 300 })

        # The absent and unusable readings are judged against this payload's
        # memory-index.js (the package it names and the model files it
        # expects), so those two name the copy. The probe-failed reading
        # compares nothing: the payload's own module could not answer.

        if ($embedTrailing) {
            $embedAgainstCheckout = if ($embedProbe.status -eq 'unusable') {
                "reads installed but not usable (" + (Get-SanitizedLine ([string]$embedProbe.detail) 300) + ")"
            }
            else { "reads not installed" }
            Report "INFO" "Embedder (semantic search)" (@(
                ("Installed: $(Get-SanitizedLine ([string]$embedInstalledProbe.packageName) 80)@$(Get-SanitizedLine ([string]$embedInstalledProbe.packageVersion) 40), model $(Get-SanitizedLine ([string]$embedInstalledProbe.model) 80) ($(Get-SanitizedLine ([string]$embedInstalledProbe.dtype) 80)) at $(Get-SanitizedLine ([string]$embedInstalledProbe.packageDir) 200), ready for the installed copy's memory-index.js."),
                ("Against this checkout's memory-index.js it " + $embedAgainstCheckout + ", so it trails the checkout in hand: " + (Get-SanitizedLine $installedRoot 200)),
                "-Fix from this checkout installs nothing here; the installed copy's doctor is the one that judges this machine."
            ) + $embedIndexLines + @($script:InstalledKitResolverNotes | ForEach-Object { Get-SanitizedLine $_ 200 }))
        }
        else {
            switch ($embedProbe.status) {
                'ready' {
                    # packageVersion comes from a package.json this doctor did not
                    # author, the same as every other foreign string reaching this
                    # report, so it takes the same sanitize pass before printing.
                    $embedDetail = @(
                        ("Installed: $($embedProbe.packageName)@$(Get-SanitizedLine ([string]$embedProbe.packageVersion) 40), model $($embedProbe.model) ($($embedProbe.dtype)) at $($embedProbe.packageDir)."),
                        "Semantic channel active; memq find blends lexical and semantic results."
                    ) + $embedIndexLines
                    if ($embedFixNotes.Count -gt 0) { Report "FIXED" "Embedder (semantic search)" ($embedFixNotes + $embedDetail) }
                    else { Report "PASS" "Embedder (semantic search)" $embedDetail }
                }
                'unusable' {
                    Report "WARN" "Embedder (semantic search)" ($embedFixNotes + @(
                        ("Installed but not usable: " + (Get-SanitizedLine ([string]$embedProbe.detail) 300)),
                        "This is a repair, not a fresh install.",
                        ("Fix: " + $embedProbe.remedy),
                        "Semantic channel inactive; memq find serves lexical results only, with a loud absence line naming the remedy."
                    ) + $embedIndexLines + @(Get-PayloadClause))
                }
                'absent' {
                    Report "WARN" "Embedder (semantic search)" ($embedFixNotes + @(
                        "Not installed; memq find serves lexical results only, with a loud absence line naming the remedy.",
                        ("Fix: " + $embedProbe.remedy + "  (about $($script:EmbedderConsentSizeMB) MB on disk)")
                    ) + $embedIndexLines + @(Get-PayloadClause))
                }
                default {
                    # 'probe-failed': the child node process itself could not
                    # answer, an incomplete plugin payload rather than an
                    # ordinary absent-or-broken install. Named as its own state so
                    # it is never mistaken for either.
                    Report "FAIL" "Embedder (semantic search)" (@(
                        "Could not probe the embedder install: " + (Get-SanitizedLine ([string]$embedProbe.detail) 300)
                    ) + $embedIndexLines)
                }
            }
        }
    }
}

# --- Nothing may be inserted between the embedder section above and the
# --- `# --- .kit/ exposure.` marker below. test/embedder-install.test.js runs
# --- real doctor code by extracting the text between the embedder section's
# --- own marker comment and that marker, then asserting on the reports that
# --- region emits, so a check placed in this gap silently joins that
# --- extracted section and fails those cases with a report count they never
# --- asked for. Add new checks after the `# --- .kit/ exposure.` marker
# --- instead.

# --- .kit/ exposure. The kit's project-local state lives in .kit/, and every
# --- file it holds is machine-local by intent: compact-consent.json carries
# --- the session id an operator released, and memory-recognition-nudges.jsonl
# --- carries one line per nudge naming the record and its moment, so a
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
# --- holds the fleet's semantic index, one usage row per memory, the outcome
# --- journal and curation queries
# --- over the markdown memory store, and a machine reaches it through the
# --- client config at ~\.claude\kit-memory-db.json. A machine with no config
# --- is an ordinary machine running on its own store, which is INFO. With one,
# --- this step runs the host probe beside the installer under -Quick (every
# --- check but the latency measurement) and reads mem.usp_Health under the
# --- config's own publisher login, then reports the local queue's depth and
# --- the age of the last clean publish, so a machine that has silently fallen back
# --- to its own store for a week says so here. FAIL is any FAIL line from the
# --- probe or a health call that did not answer; WARN is a queue holding rows,
# --- a last clean publish older than seven days, or a prerequisite (pwsh, node)
# --- missing so the host was not checked; PASS is everything else. Under -Fix
# --- any WARN the health call raised runs memq db-sync inline, which publishes
# --- the store and drains the queue, and reports FIXED on a clean publish; on
# --- an unmapped login the sync's own FAIL lines say what it could not do.
# ---
# --- The probe carries #Requires -Version 7.0 (it reads an HTTP refusal as a
# --- result, which only pwsh's -SkipHttpErrorCheck can), while this doctor
# --- runs under Windows PowerShell 5.1 through doctor.cmd, so the probe is
# --- spawned under pwsh explicitly and a machine with no pwsh on PATH reads
# --- WARN naming that rather than the requirement's own error. Every line the
# --- probe, the health call or a failure prints is foreign text on this
# --- channel and takes Get-SanitizedLine at this report's own cap.
# "kit-memory-db.json" mirrors memory-database.js's CONFIG_FILE constant and
# "kit-memory-db-queue.sqlite" its QUEUE_FILE, pinned by comment for the
# reason the embedder section states. The queue is not read here: the health
# script below hands the store root to the client, which counts the queue's
# rows itself and creates no queue where none exists.
$dbConfigPath = Join-Path $claudeDir "kit-memory-db.json"
$dbProbeScript = Join-Path $pluginRoot "db\Test-MemoryDatabaseHost.ps1"
$dbClientScript = Join-Path $pluginRoot "scripts\memory-database.js"
$dbMemqScript = Join-Path $pluginRoot "scripts\memq.js"
$dbStaleDays = 7

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
        # failed, for the reason the embedder probe reads the same shape.
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
                $lastPublishText = [string]$own.lastPublish
                $publishAge = $null
                if ($lastPublishText -ne "") {
                    $parsedPublish = [DateTimeOffset]::MinValue
                    if ([DateTimeOffset]::TryParse($lastPublishText, [System.Globalization.CultureInfo]::InvariantCulture,
                            [System.Globalization.DateTimeStyles]::None, [ref]$parsedPublish)) {
                        $publishAge = [DateTimeOffset]::UtcNow - $parsedPublish
                    }
                }
                $publishWord = if ($null -eq $publishAge) { "never" } else { [math]::Floor($publishAge.TotalDays).ToString() + " day(s) ago" }
                $dbLines += ("Sandbox " + (Get-SanitizedLine ([string]$own.sandbox) 40) + ": " +
                    (Get-SanitizedLine ([string]$own.records) 20) + " record(s), " +
                    (Get-SanitizedLine ([string]$own.embeddings) 20) + " embedding(s), last clean publish " + $publishWord + ".")
                if ($null -eq $publishAge -or $publishAge.TotalDays -gt $dbStaleDays) {
                    $dbWarned = $true
                    $dbLines += "The last clean publish is older than $dbStaleDays days, so the shared index may not hold this machine's store as it stands. memq db-sync prints what the last run could not deliver."
                }
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
                $dbLines += ("Queue: " + [int]$health.queueDepth + " row(s) wait in the local queue and publish on the next memq db-sync.")
            }
            else {
                $dbLines += "Queue: empty."
            }
        }

        if ($dbFailed) {
            Report "FAIL" "Memory database" ($dbLines + @("Fix: bring the host up or repair the config, then run memq db-sync; the local store is unaffected either way."))
        }
        elseif ($dbWarned -and $Fix) {
            # The publish inline, through the payload's own memq under the same
            # node: it publishes every record, drains the queue and exits non-zero
            # for what failed, so the exit code is the verdict and its lines are
            # the detail.
            $syncOutput = & $nodeCmd.Source $dbMemqScript db-sync 2>&1
            $syncCode = $LASTEXITCODE
            $syncLines = @($syncOutput | ForEach-Object { Get-SanitizedLine ([string]$_) 120 } | Where-Object { $_ -ne "" })
            if ($syncCode -eq 0) {
                Report "FIXED" "Memory database" ($dbLines + @("Ran memq db-sync:") + @($syncLines | ForEach-Object { "  " + $_ }))
            }
            else {
                Report "FAIL" "Memory database" ($dbLines + @("memq db-sync exited $syncCode" + ":") + @($syncLines | ForEach-Object { "  " + $_ }))
            }
        }
        elseif ($dbWarned) {
            Report "WARN" "Memory database" ($dbLines + @("Fix: run memq db-sync, or re-run doctor -Fix to run it from here (a full publish, inline, up to 15 minutes)."))
        }
        else {
            Report "PASS" "Memory database" $dbLines
        }
    }
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
