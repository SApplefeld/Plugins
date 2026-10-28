#Requires -Version 7.0
<#
.SYNOPSIS
Marks a knowledge base folder trusted for Claude Code on this account, and
proves it, without the trust dialog.

.DESCRIPTION
Claude Code ignores every permissions.allow entry in a workspace the account
has not trusted, and trust is per exact folder and per account, recorded as
projects["<folder>"].hasTrustDialogAccepted in the account's ~/.claude.json.
This script runs a headless probe in the folder,
    claude -p "Reply with the single word ok." --model haiku --permission-mode default
with stderr captured. In an untrusted folder whose .claude/settings.json holds
at least one allow entry, Claude Code prints one stderr line opening
"Ignoring " that names the exact key to set, between projects[" and
"].hasTrustDialogAccepted. The script takes the key from that line and from
nowhere else, refuses it unless it names this folder, writes
hasTrustDialogAccepted: true under it, runs the probe again, and exits 0 only
where the second probe prints no such line. Where the first probe prints no
such line the folder is already trusted and nothing is written.

A folder whose .claude/settings.json is absent or holds no permissions.allow
entry is refused before any probe, since a silent probe there proves nothing.

The settings file is read and written through System.Text.Json.Nodes, which
keeps every other property as it is, the empty-named property included, which
ConvertFrom-Json cannot hold. Only projects[<key>].hasTrustDialogAccepted is
set; the projects object and the key's object are created only where absent,
and no other property is touched. The file is first copied to
~/.claude/kb-trust-backup.json, a name the template's Read(**/.claude/*.json)
deny covers, so a knowledge base's agent cannot read the copy of a file it is
denied. Then the new document is written to a temporary
file beside it and moved over it, so a crash leaves the old file whole. The
read through the move runs under Claude Code's own lock on the file, the
directory ~/.claude.json.lock, so a live session's save neither erases the key
nor is erased by it. Where another writer holds that lock for 10 seconds the
script exits 1 with "kb-trust: ~/.claude.json is held by another writer",
changing nothing. Once the lock is taken, the clock is read before the backup,
before the move and after each blocked move: at 3 seconds the script exits 1
with the file unchanged.
After the second probe a third read of the file must still hold the key true. This
script adds, removes and edits no permission rule anywhere; it only marks the
folder trusted, which makes the folder's own .claude/settings.json allow
entries live.

~/ is the USERPROFILE environment variable, read at each run. Every refusal is
one stderr line, "kb-trust: <reason>", with exit 1; a refusal after the first
probe carries that probe's first stderr line, with control and text-direction
characters removed.

.PARAMETER Path
The knowledge base folder, absolute, on a local drive letter.

.EXAMPLE
pwsh -NoProfile -File ./kb-trust.ps1 -Path D:\Wikis\acme
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Text.Json
# CreateDirectoryW fails where the directory exists, which makes one call a
# lock; .NET's CreateDirectory and New-Item each succeed on an existing one.
Add-Type -Namespace KbTrust -Name NativeMethods -MemberDefinition '[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool CreateDirectoryW(string lpPathName, IntPtr lpSecurityAttributes);'

# Writes a single-line reason to stderr and stops with exit code 1, so a refusal
# is legible to the calling session without a PowerShell stack trace.
function Stop-WithReason {
    param([string]$Reason)
    [Console]::Error.WriteLine("kb-trust: $Reason")
    exit 1
}

# Text a refusal line may not carry, copied from kb-registry.ps1's $unsafeText:
# control characters, C1 included, line and paragraph separators, and the
# text-direction marks and controls.
$unsafeText = '[\p{Cc}\u200E\u200F\u061C\u2028\u2029\u202A-\u202E\u2066-\u2069]'

# The probe's command line is fixed text; no caller value is placed in it.
$probeArguments = '-p "Reply with the single word ok." --model haiku --permission-mode default'
$probeBudgetSeconds = 300
$warningPrefix = 'Ignoring '
$keyOpen = 'projects["'
$keyClose = '"].hasTrustDialogAccepted'

# Normalizes an absolute path to its full form without trailing separators,
# keeping a bare drive root as it is. Copied from kb-registry.ps1's
# ConvertTo-NormalPath so the key is compared the way the list compares
# folders; an export from that script would be the cleaner route.
function ConvertTo-NormalPath {
    param([string]$Value)
    $full = [System.IO.Path]::GetFullPath($Value)
    $pathRoot = [System.IO.Path]::GetPathRoot($full)
    if ($full.Length -gt $pathRoot.Length) {
        $full = $full.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    }
    return $full
}

# A property of a JSON object of the wanted kind, or $null where the element is
# not an object, the property is absent or its kind differs. The pattern of
# kb-registry.ps1's Get-JsonString: the file is the wiki's own and read as
# untrusted.
function Get-JsonElement {
    param([System.Text.Json.JsonElement]$Element, [string]$PropertyName, [System.Text.Json.JsonValueKind]$Kind)
    if ($Element.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { return $null }
    foreach ($property in $Element.EnumerateObject()) {
        if ([string]::Equals($property.Name, $PropertyName, [StringComparison]::Ordinal)) {
            if ($property.Value.ValueKind -eq $Kind) { return $property.Value }
            return $null
        }
    }
    return $null
}

# Hostile text made safe for one stderr line: unsafe characters removed and
# the length capped.
function ConvertTo-SafeText {
    param([string]$Text)
    $clean = [regex]::Replace($Text, $unsafeText, '')
    if ($clean.Length -gt 400) { $clean = $clean.Substring(0, 400) + '...' }
    return $clean
}

# Splits text into its non-empty lines.
function Get-Lines { param([string]$Text) return @($Text -split "`r?`n" | Where-Object { $_ -ne '' }) }

# The warning lines in a probe's stderr: those opening with the fixed prefix.
function Get-WarningLines {
    param([string]$Stderr)
    return @(Get-Lines $Stderr | Where-Object { $_.StartsWith($warningPrefix, [StringComparison]::Ordinal) })
}

# The key between projects[" and "].hasTrustDialogAccepted in a warning line,
# or $null where the line holds no such span.
function Get-WarningKey {
    param([string]$Line)
    $open = $Line.IndexOf($keyOpen, [StringComparison]::Ordinal)
    if ($open -lt 0) { return $null }
    $start = $open + $keyOpen.Length
    $close = $Line.IndexOf($keyClose, $start, [StringComparison]::Ordinal)
    if ($close -lt 0) { return $null }
    return $Line.Substring($start, $close - $start)
}

# Runs the probe in the knowledge base with both streams captured, stopping
# its whole process tree past the budget. Returns the exit code and the text
# of each stream.
function Invoke-Probe {
    param([string]$ClaudePath, [string]$WorkingDirectory)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ClaudePath
    $psi.Arguments = $probeArguments
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    # A closed stdin reads as end of input at once, so claude -p never waits on
    # whatever stream this script inherited.
    $psi.RedirectStandardInput = $true
    $process = $null
    try {
        $process = [System.Diagnostics.Process]::Start($psi)
    } catch {
        Stop-WithReason "starting $ClaudePath failed: $(ConvertTo-SafeText $_.Exception.GetBaseException().Message)"
    }
    try {
        $process.StandardInput.Close()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($probeBudgetSeconds * 1000)) {
            $process.Kill($true)
            Stop-WithReason "the probe did not finish within $probeBudgetSeconds seconds; its process tree was stopped."
        }
        $process.WaitForExit()
        [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($stdout, $stderr))
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdout.Result; Stderr = $stderr.Result }
    } finally {
        $process.Dispose()
    }
}

# The first line of a probe's stderr made safe, for a refusal that carries
# what the probe said.
function Get-ProbeSummary {
    param($Probe)
    $lines = @(Get-Lines $Probe.Stderr)
    if ($lines.Count -eq 0) { return "exit $($Probe.ExitCode), no stderr" }
    return "exit $($Probe.ExitCode), $($lines.Count) stderr line(s), the first: $(ConvertTo-SafeText $lines[0])"
}

# --- The folder.
if ([regex]::IsMatch($Path, $unsafeText)) {
    Stop-WithReason 'path must not contain control characters, line or paragraph separators or text-direction marks'
}
if (-not [System.IO.Path]::IsPathFullyQualified($Path)) {
    Stop-WithReason "path is not absolute: $Path"
}
if (-not [regex]::IsMatch($Path, '\A[A-Za-z]:[\\/]')) {
    Stop-WithReason "path must be a local folder on a drive letter, not a network or device path: $Path"
}
try {
    $kbRoot = ConvertTo-NormalPath $Path
} catch {
    Stop-WithReason "path is not a valid path: $Path"
}
if (-not [System.IO.Directory]::Exists($kbRoot)) {
    Stop-WithReason "path is not an existing directory: $kbRoot"
}

# --- The allow entry the warning depends on. Without one the probe prints
# nothing in an untrusted folder too, so its silence would prove nothing.
$settingsPath = Join-Path $kbRoot '.claude/settings.json'
if (-not [System.IO.File]::Exists($settingsPath)) {
    Stop-WithReason "$kbRoot has no .claude/settings.json, so the probe could not show whether it is trusted"
}
$allowCount = 0
try {
    $settingsDocument = [System.Text.Json.JsonDocument]::Parse([System.IO.File]::ReadAllText($settingsPath))
    try {
        $permissions = Get-JsonElement $settingsDocument.RootElement 'permissions' ([System.Text.Json.JsonValueKind]::Object)
        $allow = if ($null -ne $permissions) { Get-JsonElement $permissions 'allow' ([System.Text.Json.JsonValueKind]::Array) } else { $null }
        if ($null -ne $allow) { $allowCount = $allow.GetArrayLength() }
    } finally {
        $settingsDocument.Dispose()
    }
} catch {
    Stop-WithReason "$settingsPath is not valid JSON, so the probe could not show whether the folder is trusted"
}
if ($allowCount -eq 0) {
    Stop-WithReason "$settingsPath holds no permissions.allow entry, so the probe could not show whether the folder is trusted"
}

# --- The account's settings file and the probe executable.
if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
    Stop-WithReason 'USERPROFILE is not set, so the location of ~/.claude.json is unknown'
}
$claudeConfig = Join-Path $env:USERPROFILE '.claude.json'
# Under ~/.claude/ and ending .json, so the template's Read(**/.claude/*.json)
# deny covers it as Read(**/.claude.json) covers the file it copies.
$backupPath = Join-Path $env:USERPROFILE '.claude\kb-trust-backup.json'

$found = @(Get-Command -Name 'claude' -CommandType Application -ErrorAction SilentlyContinue)
if ($found.Count -eq 0) {
    Stop-WithReason 'no application named claude is on PATH'
}
$claudePath = $found[0].Source

# --- The first probe: silence means trusted already, a warning names the key.
$first = Invoke-Probe $claudePath $kbRoot
$warnings = @(Get-WarningLines $first.Stderr)
if ($warnings.Count -eq 0) {
    if ($first.ExitCode -ne 0) {
        Stop-WithReason "the probe failed without naming a trust key ($(Get-ProbeSummary $first))"
    }
    Write-Output "kb-trust: $kbRoot is already trusted; nothing written."
    exit 0
}
$key = Get-WarningKey $warnings[0]
if ($null -eq $key) {
    Stop-WithReason "the warning line names no projects key ($(Get-ProbeSummary $first))"
}
if ([regex]::IsMatch($key, $unsafeText)) {
    Stop-WithReason 'the warning line''s key holds control characters or text-direction marks, so it is not used'
}
# The key names this folder, compared as kb-registry.ps1 compares folders, or
# it is not written: a forged or confusing line must not trust another folder.
$keyNamesFolder = $false
if ([regex]::IsMatch($key, '\A[A-Za-z]:[\\/]')) {
    try {
        $keyNamesFolder = [string]::Equals((ConvertTo-NormalPath $key), $kbRoot, [StringComparison]::OrdinalIgnoreCase)
    } catch {
        $keyNamesFolder = $false
    }
}
if (-not $keyNamesFolder) {
    Stop-WithReason "the warning line's key '$(ConvertTo-SafeText $key)' does not name $kbRoot, so nothing was written"
}

# --- The write: one property under one key, everything else as it was, under
# Claude Code's own lock on ~/.claude.json: the directory beside it, which each
# of its saves creates before it re-reads the file and removes after. The lock
# is held from the read through the move and never across a probe, since each
# probe is a claude process that takes it too. A held lock is waited on for 10
# seconds and never taken over, stale or not; Claude Code reclaims a stale one
# itself. Once taken, the lock's clock is read before the backup, before the
# move and after each blocked move, and at 3 seconds the run refuses with the
# file unchanged. That keeps the hold well inside the 10 second age at which
# Claude Code judges a lock stale, short of one file call that itself stalls.
$lockPath = "$claudeConfig.lock"
$lockClock = [System.Diagnostics.Stopwatch]::StartNew()
while (-not [KbTrust.NativeMethods]::CreateDirectoryW($lockPath, [IntPtr]::Zero)) {
    if ([System.IO.File]::Exists($lockPath) -or ($lockClock.Elapsed.TotalSeconds -ge 10)) {
        if ([System.IO.Directory]::Exists($lockPath)) { Stop-WithReason "~/.claude.json is held by another writer" }
        Stop-WithReason "the lock $(ConvertTo-SafeText $lockPath) could not be created, so nothing was written"
    }
    Start-Sleep -Milliseconds 100
}
$lockClock.Restart()
# Entered only once this run has created the lock, so the finally removes a
# lock of this run's own and never one it found held.
try {
    if (-not [System.IO.File]::Exists($claudeConfig)) {
        Stop-WithReason "$claudeConfig does not exist; run Claude Code once on this account first"
    }
    $root = $null
    try {
        $root = [System.Text.Json.Nodes.JsonNode]::Parse([System.IO.File]::ReadAllText($claudeConfig))
    } catch {
        Stop-WithReason "$claudeConfig is not valid JSON, so nothing was written"
    }
    if ($root -isnot [System.Text.Json.Nodes.JsonObject]) {
        Stop-WithReason "$claudeConfig is not a JSON object, so nothing was written"
    }
    $projects = $root['projects']
    if ($null -eq $projects) {
        $projects = [System.Text.Json.Nodes.JsonObject]::new()
        $root['projects'] = $projects
    } elseif ($projects -isnot [System.Text.Json.Nodes.JsonObject]) {
        Stop-WithReason "projects in $claudeConfig is not a JSON object, so nothing was written"
    }
    $entry = $projects[$key]
    if ($null -eq $entry) {
        $entry = [System.Text.Json.Nodes.JsonObject]::new()
        $projects[$key] = $entry
    } elseif ($entry -isnot [System.Text.Json.Nodes.JsonObject]) {
        Stop-WithReason "projects[`"$(ConvertTo-SafeText $key)`"] in $claudeConfig is not a JSON object, so nothing was written"
    }
    $entry['hasTrustDialogAccepted'] = [System.Text.Json.Nodes.JsonValue]::Create($true)

    $writeOptions = [System.Text.Json.JsonSerializerOptions]::new()
    $writeOptions.WriteIndented = $true
    $writeOptions.Encoder = [System.Text.Encodings.Web.JavaScriptEncoder]::UnsafeRelaxedJsonEscaping
    $newText = $root.ToJsonString($writeOptions)
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($newText)

    if ($lockClock.Elapsed.TotalSeconds -ge 3) {
        Stop-WithReason "$claudeConfig was not written: reading it held the lock for 3 seconds"
    }
    try {
        [void][System.IO.Directory]::CreateDirectory((Split-Path -Parent $backupPath))
        [System.IO.File]::Copy($claudeConfig, $backupPath, $true)
    } catch {
        Stop-WithReason "the backup $backupPath could not be written, so nothing changed: $($_.Exception.GetBaseException().Message)"
    }
    $tempPath = Join-Path $env:USERPROFILE ".claude.json.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        $stream = [System.IO.File]::Open($tempPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try {
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Flush($true)
        } finally {
            $stream.Dispose()
        }
        if ($lockClock.Elapsed.TotalSeconds -ge 3) {
            Stop-WithReason "$claudeConfig is unchanged and the backup stands: the lock had been held for 3 seconds"
        }
        # The move retries while another process holds the file open, until the
        # lock has been held for 3 seconds.
        while ($true) {
            try {
                [System.IO.File]::Move($tempPath, $claudeConfig, $true)
                break
            } catch [System.IO.IOException], [System.UnauthorizedAccessException] {
                $inner = $_.Exception.GetBaseException()
                # 32 is ERROR_SHARING_VIOLATION and 33 ERROR_LOCK_VIOLATION.
                $held = ($inner -is [System.UnauthorizedAccessException]) -or (($inner -is [System.IO.IOException]) -and (@(32, 33) -contains ($inner.HResult -band 0xFFFF)))
                if (-not $held) {
                    Stop-WithReason "$claudeConfig could not be replaced, so it is unchanged and the backup stands: $($inner.Message)"
                }
                if ($lockClock.Elapsed.TotalSeconds -ge 3) {
                    Stop-WithReason "$claudeConfig is held open by another process, so it is unchanged and the backup stands"
                }
                Start-Sleep -Milliseconds 100
            }
        }
    } finally {
        if ([System.IO.File]::Exists($tempPath)) {
            [System.IO.File]::Delete($tempPath)
        }
    }
} finally {
    try {
        [System.IO.Directory]::Delete($lockPath)
    } catch {
        [Console]::Error.WriteLine("kb-trust: the lock $(ConvertTo-SafeText $lockPath) could not be removed: $(ConvertTo-SafeText $_.Exception.GetBaseException().Message)")
        exit 1
    }
}

# --- The second probe proves the write: no warning line, or the trust did
# not take.
$second = Invoke-Probe $claudePath $kbRoot
if (@(Get-WarningLines $second.Stderr).Count -gt 0) {
    Stop-WithReason "the folder still reads untrusted after the write ($(Get-ProbeSummary $second)); the previous file is at $backupPath"
}
if ($second.ExitCode -ne 0) {
    Stop-WithReason "the second probe failed ($(Get-ProbeSummary $second)); the previous file is at $backupPath"
}

# --- A third read proves the key outlived the probe's own save of the file:
# Claude Code re-reads the file under the lock and merges, so a save that
# rewrote a stale copy would show here as the key gone or not true. The read
# takes no lock, so one that fails is tried once more after 200 milliseconds,
# in case it met a save in progress.
$afterRoot = $null
foreach ($attempt in 1, 2) {
    try {
        $afterRoot = [System.Text.Json.Nodes.JsonNode]::Parse([System.IO.File]::ReadAllText($claudeConfig))
        break
    } catch {
        if ($attempt -eq 2) {
            Stop-WithReason "$claudeConfig could not be read as JSON after the second probe, so the key could not be confirmed; the previous file is at $backupPath"
        }
        Start-Sleep -Milliseconds 200
    }
}
$kept = $false
try {
    $kept = ($afterRoot['projects'][$key]['hasTrustDialogAccepted'].ToJsonString() -ceq 'true')
} catch {
    $kept = $false
}
if (-not $kept) {
    Stop-WithReason "$claudeConfig no longer holds the key as trusted after the second probe, so another writer replaced it; the previous file is at $backupPath"
}
Write-Output "kb-trust: $kbRoot is now trusted for this account."
exit 0
