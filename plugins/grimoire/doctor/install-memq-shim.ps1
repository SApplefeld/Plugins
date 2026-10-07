# The doctor's memq-shim helpers: what an install consists of, whether the
# installed copy is the expected one, whether it resolves a payload, and
# whether the name `memq` actually reaches it.
#
# Dot-sourced by doctor.ps1, which calls these under its "memq shim" check;
# the repo test suite dot-sources the same file and runs the same functions
# against redirected directories, which is why the plugin root, the .claude
# directory, and the PATH value all arrive as parameters instead of being
# resolved from the environment here. This file defines functions only;
# dot-sourcing it runs nothing and writes nothing.
#
# An install is five files in <ClaudeDir>\bin: memq-shim.js (a byte copy of
# the payload's scripts\memq-shim.js, which holds all the cache resolution
# logic), three wrappers that delegate to it, one per shell that resolves
# a command differently: memq.ps1 for PowerShell, memq.cmd for cmd, and an
# extensionless memq for Git Bash, and kit-statusline.js (a byte copy of the
# payload's scripts\kit-statusline.js, which prints one empty line for a
# status-line setting that still names it and is run by full path from that
# setting, so it needs no wrapper). Each wrapper's
# exact text is defined once here and used by both the writer and the
# integrity check, so the check cannot drift from what the installer writes;
# each .js copy is checked byte-for-byte against the payload's own.
#
# Three wrappers rather than one because the shells disagree about both
# resolution and argument passing. PowerShell searches for .ps1 by its own
# rules, independently of PATHEXT, and prefers a .ps1 over a sibling .cmd, so
# shipping memq.ps1 is what keeps PowerShell callers off cmd.exe's command
# line parser. That matters: a batch wrapper can only forward its arguments as
# %*, which cmd.exe substitutes into the line before parsing it, so an
# argument carrying an odd number of double quotes ends the quoted region and
# text after a following '&' runs as a separate command. memq.cmd still
# carries that exposure for callers that reach it (cmd.exe itself, which does
# not resolve .ps1), which is why memq bounds its stored free text and the
# memory-system skill tells the model to compose summaries rather than paste
# raw text into an argument.
#
# The durable PATH edit is deliberately not here: it writes User-scope
# registry state, which doctor.ps1 owns and a test must never touch. The
# read half and the membership predicate do live here, so the doctor's writer
# and this file's diagnosis answer "is that directory on PATH" identically.

# The five files an install consists of.
function Get-MemqShimFileNames {
    return @("memq-shim.js", "memq.ps1", "memq.cmd", "memq", "kit-statusline.js")
}

# The .js files that are byte copies of the payload's scripts\<name>.
function Get-MemqShimCopiedFileNames {
    return @("memq-shim.js", "kit-statusline.js")
}

# The PowerShell wrapper, and the one a PowerShell caller actually reaches.
# @args splats this script's arguments straight onto the node invocation, so
# nothing is ever handed to cmd.exe to re-parse and no argument can start a
# second command. $LASTEXITCODE is null when the node call never ran at all
# (node missing from PATH, which PowerShell reports as a command-not-found
# error), and exiting 0 there would report success for a memq that never
# started, so that case exits 1.
function Get-MemqPs1WrapperText {
    return (@(
        '& node (Join-Path $PSScriptRoot ''memq-shim.js'') @args',
        'if ($null -eq $LASTEXITCODE) { exit 1 }',
        'exit $LASTEXITCODE',
        '') -join "`r`n")
}

# cmd.exe parses batch files by CRLF lines, so this wrapper is CRLF-terminated.
# The trailing empty element ends the file with its own newline. %* is the
# only argument forwarding a batch file has, and it is substituted before
# cmd.exe parses the line: see this file's header for what that exposes and
# what covers it. PowerShell callers do not come through here, because
# memq.ps1 wins name resolution for them.
function Get-MemqCmdWrapperText {
    return (@('@echo off', 'node "%~dp0memq-shim.js" %*', '') -join "`r`n")
}

# LF only: a CR after '#!/bin/sh' breaks the shebang. Every expansion is
# quoted, so a path holding a space survives and no argument is re-split.
function Get-MemqShWrapperText {
    return (@('#!/bin/sh', 'exec node "$(dirname "$0")/memq-shim.js" "$@"', '') -join "`n")
}

# The durable user PATH exactly as stored, never expanded. A Path stored as
# REG_EXPAND_SZ holds entries such as %USERPROFILE%\bin;
# [Environment]::GetEnvironmentVariable returns those already expanded, so a
# read-modify-write through that API would replace the variables with today's
# values permanently. Every kit reader and writer of this value goes through
# this function and Add-ToUserPath in doctor.ps1.
function Get-UserPathRaw {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $false)
    if ($null -eq $key) { return "" }
    try {
        $value = $key.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($null -eq $value) { return "" }
        return [string]$value
    }
    finally { $key.Close() }
}

# Whether a raw PATH value already lists a directory. An exact per-entry
# compare, never a substring test: a substring test calls "C:\tools\bin"
# present because "C:\tools\bin2" is listed. Case-insensitive with a trailing
# separator ignored, the way Windows resolves paths.
function Test-UserPathContains {
    param([string]$RawPath, [Parameter(Mandatory = $true)][string]$Directory)
    if ([string]::IsNullOrEmpty($RawPath)) { return $false }
    $target = $Directory.TrimEnd('\', '/')
    foreach ($entry in $RawPath.Split(';')) {
        $trimmed = $entry.Trim().TrimEnd('\', '/')
        if ($trimmed -ne "" -and $trimmed -ieq $target) { return $true }
    }
    return $false
}

function Install-MemqShim {
    param(
        [Parameter(Mandatory = $true)][string]$PluginRoot,
        [Parameter(Mandatory = $true)][string]$ClaudeDir
    )
    foreach ($name in (Get-MemqShimCopiedFileNames)) {
        $source = Join-Path $PluginRoot "scripts\$name"
        if (-not (Test-Path -LiteralPath $source)) {
            return @{ Ok = $false; Notes = @("$name not found at $source; this plugin payload is incomplete.") }
        }
    }
    $binDir = Join-Path $ClaudeDir "bin"
    try {
        New-Item -ItemType Directory -Force -Path $binDir | Out-Null
        foreach ($name in (Get-MemqShimCopiedFileNames)) {
            Copy-Item -LiteralPath (Join-Path $PluginRoot "scripts\$name") -Destination (Join-Path $binDir $name) -Force
        }
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText((Join-Path $binDir "memq.ps1"), (Get-MemqPs1WrapperText), $utf8)
        [System.IO.File]::WriteAllText((Join-Path $binDir "memq.cmd"), (Get-MemqCmdWrapperText), $utf8)
        [System.IO.File]::WriteAllText((Join-Path $binDir "memq"), (Get-MemqShWrapperText), $utf8)
    }
    catch {
        return @{ Ok = $false; Notes = @("Could not install into ${binDir}: $($_.Exception.Message)") }
    }
    return @{ Ok = $true; BinDir = $binDir; Notes = @("Installed memq-shim.js, the memq.ps1, memq.cmd, and memq (sh) wrappers, and kit-statusline.js to $binDir.") }
}

# The installed shim's state, as data for the caller to report on: which files
# are missing, which differ from what this payload would install, whether the
# installed resolver finds a payload, and what the name `memq` resolves to.
#
# Integrity is a content comparison, not only a smoke run. A shim that runs
# and prints a usage banner proves that something ran; any payload that took
# its place could print the same banner. Comparing the installed bytes against
# this payload's own answers the question that matters, which is whether the
# expected program is what is installed.
#
# Name resolution: when `memq` resolves to anything at all, that resolution is
# the answer, because it is what a shell actually runs. Only when nothing
# resolves does the durable PATH decide, which is the honest reading of "this
# process's PATH predates the fix, and new shells will find it". A `memq`
# resolving from another directory is reported by path and never smoothed
# over: the durable PATH is appended to, so any earlier entry (user-writable
# ones such as WindowsApps included) wins every invocation.
function Get-MemqShimStatus {
    param(
        [Parameter(Mandatory = $true)][string]$PluginRoot,
        [Parameter(Mandatory = $true)][string]$ClaudeDir,
        [string]$NodeExe = "node",
        [string]$UserPath,
        [switch]$SkipHealthRun
    )
    $binDir = Join-Path $ClaudeDir "bin"
    $status = @{
        BinDir     = $binDir
        Missing    = @()
        Stale      = @()
        Resolves   = $false
        NoPayload  = $false
        Detail     = ""
        ShadowedBy = $null
        OnPath     = $false
    }

    foreach ($name in (Get-MemqShimFileNames)) {
        $installed = Join-Path $binDir $name
        if (-not (Test-Path -LiteralPath $installed -PathType Leaf)) {
            $status.Missing += $name
            continue
        }
        if ((Get-MemqShimCopiedFileNames) -contains $name) {
            $payloadCopy = Join-Path $PluginRoot "scripts\$name"
            if (-not (Test-Path -LiteralPath $payloadCopy -PathType Leaf)) { continue }
            if ((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ne
                (Get-FileHash -LiteralPath $payloadCopy -Algorithm SHA256).Hash) {
                $status.Stale += $name
            }
        }
        else {
            $expected = switch ($name) {
                "memq.ps1" { Get-MemqPs1WrapperText }
                "memq.cmd" { Get-MemqCmdWrapperText }
                default { Get-MemqShWrapperText }
            }
            if ([System.IO.File]::ReadAllText($installed) -ne $expected) { $status.Stale += $name }
        }
    }

    if (-not $SkipHealthRun -and $status.Missing -notcontains "memq-shim.js") {
        # Argless: the shim resolves a payload and then hits memq's own usage
        # banner (exit 1 plus "usage: memq"), the loads-and-runs proof. A shim
        # that cannot resolve a payload also exits 1, so its own message is
        # the discriminator between "damaged" and "nothing installed to point
        # at" (the clone-only machine, which no -Fix can repair).
        $shimPath = Join-Path $binDir "memq-shim.js"
        $probe = & cmd /c "`"$NodeExe`" `"$shimPath`" 2>&1"
        $probeText = ($probe -join "`n")
        $status.Detail = $probeText
        if ($LASTEXITCODE -eq 1 -and $probeText -match "usage: memq") { $status.Resolves = $true }
        elseif ($probeText -match "no installed grimoire payload") { $status.NoPayload = $true }
    }

    $resolved = Get-Command memq -ErrorAction SilentlyContinue
    if ($resolved -and $resolved.Source) {
        if ((Split-Path $resolved.Source -Parent) -ieq $binDir) { $status.OnPath = $true }
        else { $status.ShadowedBy = $resolved.Source }
    }
    elseif ($PSBoundParameters.ContainsKey("UserPath")) {
        $status.OnPath = Test-UserPathContains -RawPath $UserPath -Directory $binDir
    }
    else {
        $status.OnPath = Test-UserPathContains -RawPath (Get-UserPathRaw) -Directory $binDir
    }
    return $status
}
