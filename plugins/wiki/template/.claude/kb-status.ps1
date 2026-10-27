#Requires -Version 5.1
<#
.SYNOPSIS
Reports read-only status about a knowledge base repo: working-tree state,
unpushed commits, a page's last-change date, the inbox listing, or the dirty
paths touched within a recent window.

.DESCRIPTION
The only read-only git access a knowledge base session has. Raw git is denied
by the permission allowlist, so this helper exposes exactly the git reads the
skills need, plus an inbox listing, and nothing else. Each mode validates
its own arguments and writes plain text to stdout. It only reads: it moves
nothing, writes nothing, and commits nothing.

.PARAMETER What
The read to perform. One of:
- Porcelain: the working tree's status in `git status --porcelain` form.
- Unpushed: the commits on the current branch not yet on its upstream. A branch
  with no configured upstream reports nothing.
- PageDate: the last-change date (YYYY-MM-DD) of one repo page.
- Inbox: the files waiting in inbox/, one per line as `<bytes><tab><name>`,
  skipping .gitkeep.
- Live: the dirty paths another run may still be writing, one per line as
  `<minutes ago><tab><path>`, oldest first, and nothing when none is live. It
  takes the paths `git status --porcelain` reports, each untracked file by its
  own path, and a renamed file by its new path. A path is live when its
  on-disk last-write time, read against this machine's clock in UTC, is less
  than -Minutes minutes back. The minutes shown are the whole minutes elapsed,
  rounded down, so a path 31 minutes old is outside a 30-minute window and
  inside a 60-minute one. A path with no file on disk, such as a tracked file
  deleted from the working tree, is never live. A last-write time in the
  future counts as live, at 0 minutes. Paths under inbox/ are skipped, because
  a drop is pending input rather than a run's write and the feeder moves each
  file into inbox/ in one rename, so none is half-written. An entry that is a
  folder, such as a nested repository, is skipped, because a folder's time is
  not a file's write. kb-move.ps1 stamps a file's last-write time at its move
  into sources/, so a moved source reads as live.

.PARAMETER Path
Required for PageDate and rejected by every other mode: the repo-relative path
of the page whose last-change date to report. It must be under wiki/ or
sources/, or be exactly index.md or log.md, and must exist on disk.

.PARAMETER Minutes
Optional for Live and rejected by every other mode: the width of the window in
whole minutes, 1 or more. Defaults to 30.

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-status.ps1 -What Porcelain

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-status.ps1 -What Unpushed

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-status.ps1 -What PageDate -Path "wiki/acme-corp.md"

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-status.ps1 -What Inbox

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-status.ps1 -What Live

.EXAMPLE
pwsh -NoProfile -File ./.claude/kb-status.ps1 -What Live -Minutes 60
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Porcelain', 'Unpushed', 'PageDate', 'Inbox', 'Live')]
    [string]$What,

    [string]$Path,

    [int]$Minutes = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Git failures are surfaced by checking $LASTEXITCODE explicitly, so native
# command failures must not auto-throw and produce a stack trace.
$PSNativeCommandUseErrorActionPreference = $false

# Writes a single-line reason to stderr and stops with a non-zero exit code, so
# a refusal is legible to an unattended caller without a PowerShell stack trace.
function Stop-WithReason {
    param([string]$Reason)
    [Console]::Error.WriteLine("kb-status: $Reason")
    exit 1
}

# The repo root is the parent of the .claude/ directory this script lives in.
$repoRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).ProviderPath

$pathSupplied = -not [string]::IsNullOrEmpty($Path)
$minutesSupplied = $PSBoundParameters.ContainsKey('Minutes')

switch ($What) {
    'Porcelain' {
        if ($pathSupplied) {
            Stop-WithReason 'Porcelain takes no -Path.'
        }
        if ($minutesSupplied) {
            Stop-WithReason 'Porcelain takes no -Minutes.'
        }
        $status = & git -C $repoRoot status --porcelain
        if ($LASTEXITCODE -ne 0) {
            Stop-WithReason 'git status --porcelain failed.'
        }
        if ($null -ne $status) {
            Write-Output $status
        }
    }
    'Unpushed' {
        if ($pathSupplied) {
            Stop-WithReason 'Unpushed takes no -Path.'
        }
        if ($minutesSupplied) {
            Stop-WithReason 'Unpushed takes no -Minutes.'
        }
        # A branch with no configured upstream is not an error: there is simply
        # nothing to compare against, so report nothing and stop cleanly.
        & git -C $repoRoot rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            exit 0
        }
        $commits = & git -C $repoRoot log --oneline '@{u}..HEAD'
        if ($LASTEXITCODE -ne 0) {
            Stop-WithReason 'git log @{u}..HEAD failed.'
        }
        if ($null -ne $commits) {
            Write-Output $commits
        }
    }
    'PageDate' {
        if ($minutesSupplied) {
            Stop-WithReason 'PageDate takes no -Minutes.'
        }
        if (-not $pathSupplied) {
            Stop-WithReason 'PageDate requires -Path.'
        }
        if ([System.IO.Path]::IsPathRooted($Path)) {
            Stop-WithReason "path must be repo-relative, not rooted: $Path"
        }
        if ($Path -like '*..*') {
            Stop-WithReason "path must not contain '..': $Path"
        }
        if ($Path.Contains(':')) {
            Stop-WithReason "path must not contain ':': $Path"
        }
        $normalized = $Path -replace '\\', '/'
        $inScope = ($normalized -eq 'index.md') -or
                   ($normalized -eq 'log.md') -or
                   ($normalized -like 'sources/*') -or
                   ($normalized -like 'wiki/*')
        if (-not $inScope) {
            Stop-WithReason "path is outside the readable set (sources/, wiki/, index.md, log.md): $Path"
        }
        $full = Join-Path $repoRoot $Path
        if (-not (Test-Path -LiteralPath $full)) {
            Stop-WithReason "path does not exist on disk: $Path"
        }

        # The path is passed as its own argument after --, never interpolated
        # into a string, so a name cannot be read as an option or a pathspec.
        $date = & git -C $repoRoot log -1 --format=%as -- $Path
        if ($LASTEXITCODE -ne 0) {
            Stop-WithReason "git log for $Path failed."
        }
        if ($null -ne $date) {
            Write-Output $date
        }
    }
    'Inbox' {
        if ($pathSupplied) {
            Stop-WithReason 'Inbox takes no -Path.'
        }
        if ($minutesSupplied) {
            Stop-WithReason 'Inbox takes no -Minutes.'
        }
        $inboxDir = Join-Path $repoRoot 'inbox'
        if (-not (Test-Path -LiteralPath $inboxDir -PathType Container)) {
            Stop-WithReason 'inbox/ does not exist.'
        }
        $items = @(Get-ChildItem -LiteralPath $inboxDir -File | Where-Object { $_.Name -ne '.gitkeep' })
        foreach ($item in $items) {
            Write-Output ("{0}`t{1}" -f $item.Length, $item.Name)
        }
    }
    'Live' {
        if ($pathSupplied) {
            Stop-WithReason 'Live takes no -Path.'
        }
        if ($Minutes -lt 1) {
            Stop-WithReason "-Minutes must be 1 or more: $Minutes"
        }

        # -z keeps every path unquoted and unescaped, and --untracked-files=all
        # lists an untracked file by its own path, where the default collapses a
        # new folder into one directory entry whose time is the folder's. The
        # output is read as UTF-8 so a non-ASCII path resolves on disk; a host
        # with no console to set keeps its default encoding, and the console's
        # encoding is put back afterward. --no-optional-locks keeps the read from
        # taking index.lock while another run commits.
        $savedEncoding = $null
        try {
            $savedEncoding = [Console]::OutputEncoding
            [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        } catch { }
        try {
            $status = & git -C $repoRoot --no-optional-locks status --porcelain -z --untracked-files=all
            $gitExit = $LASTEXITCODE
        } finally {
            if ($null -ne $savedEncoding) {
                try { [Console]::OutputEncoding = $savedEncoding } catch { }
            }
        }
        if ($gitExit -ne 0) {
            Stop-WithReason 'git status --porcelain failed.'
        }

        # Each entry is `XY path`. A rename or copy is followed by one more
        # entry holding its origin, which is skipped: the new path is the one
        # that exists on disk.
        $entries = @((@($status) -join "`n") -split "`0" | Where-Object { $_ -ne '' })
        $now = [DateTime]::UtcNow
        $live = New-Object System.Collections.Generic.List[object]
        for ($i = 0; $i -lt $entries.Count; $i++) {
            $entry = $entries[$i]
            if ($entry.Length -lt 4) {
                continue
            }
            if ($entry.Substring(0, 2) -cmatch '[RC]') {
                $i++
            }
            $relative = $entry.Substring(3)
            if ($relative.StartsWith('inbox/', [System.StringComparison]::Ordinal)) {
                continue
            }

            # A deleted path has no file to read. The lookup is guarded rather
            # than pre-tested, so a file removed between the status read and
            # this read is skipped the same way and never throws.
            try {
                $item = Get-Item -LiteralPath (Join-Path $repoRoot $relative) -Force -ErrorAction Stop
            } catch {
                continue
            }
            if ($item.PSIsContainer) {
                continue
            }
            $elapsed = $now - $item.LastWriteTimeUtc
            $whole = [int][Math]::Max(0, [Math]::Floor($elapsed.TotalMinutes))
            if ($whole -lt $Minutes) {
                $live.Add([pscustomobject]@{ Ticks = $elapsed.Ticks; Minutes = $whole; Path = $relative })
            }
        }
        foreach ($row in @($live | Sort-Object -Property @{ Expression = 'Ticks'; Descending = $true }, @{ Expression = 'Path'; Descending = $false })) {
            Write-Output ("{0}`t{1}" -f $row.Minutes, $row.Path)
        }
    }
}

exit 0
