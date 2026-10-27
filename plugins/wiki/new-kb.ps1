#Requires -Version 5.1
<#
.SYNOPSIS
Creates a new knowledge base repo from the engine's template/ directory.

.DESCRIPTION
Instantiates a self-contained knowledge base: it copies the entire template/
tree (including dotfiles and dot-directories) into a fresh destination, runs
git init on the main branch, makes one initial commit, and verifies the result
with tests/Test-KbStructure.ps1 before reporting success. It refuses to touch a
destination that already holds files, so an existing repo is never overwritten.
It creates no git remote and assumes no GitHub account, because each owning
entity's git host and identity differ. It does not set git user.name or
user.email; the account's own git config owns the committer identity, and a
missing identity stops the run loudly rather than being papered over. On
success it prints the follow-up steps, leading with trusting the new workspace,
because Claude Code ignores permissions.allow in an untrusted workspace and a
scheduled run there silently writes nothing.

.PARAMETER Name
The name of the knowledge base. It is used only in the initial commit message.
An empty or whitespace-only name is rejected.

.PARAMETER Path
The destination directory to create as the KB repo root. It must not already
exist with contents. A relative path is resolved against the current location.

.EXAMPLE
pwsh -NoProfile -File ./new-kb.ps1 -Name "Eleos KB" -Path ../eleos-kb
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string]$Name,

    [Parameter(Mandatory)]
    [string]$Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Git failures are surfaced by checking $LASTEXITCODE explicitly, so native
# command failures must not auto-throw and produce a stack trace.
$PSNativeCommandUseErrorActionPreference = $false

# Set once the destination directory has been created. A failure after that
# point leaves a partial KB behind, and the next run would otherwise refuse it
# as an existing non-empty destination, which reads as the operator's fault.
$script:PartialPath = $null

# Writes a single-line reason to stderr and stops with a non-zero exit code, so
# a refusal is legible to an operator without a PowerShell stack trace. When a
# partial destination exists, the operator is told to remove it before retrying.
function Stop-WithReason {
    param([string]$Reason)
    [Console]::Error.WriteLine("new-kb: $Reason")
    if ($script:PartialPath) {
        [Console]::Error.WriteLine("new-kb: this run left a partial knowledge base at $($script:PartialPath). Remove it before retrying.")
    }
    exit 1
}

# Runs git and stops the run if it reports failure. git's own message reaches
# stderr on its own; this adds the one-line reason and the non-zero exit.
function Invoke-GitOrStop {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$FailReason
    )
    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        Stop-WithReason $FailReason
    }
}

# A missing git executable throws before any exit code is set, which would
# surface as a stack trace rather than a refusal.
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Stop-WithReason 'git was not found on PATH.'
}

if ([string]::IsNullOrWhiteSpace($Name)) {
    Stop-WithReason 'Name is required and must not be empty or whitespace.'
}

# The template lives next to this script. A missing template means the engine
# checkout is broken, so there is nothing to instantiate.
$templateDir = Join-Path $PSScriptRoot 'template'
if (-not (Test-Path -LiteralPath $templateDir -PathType Container)) {
    Stop-WithReason "template directory not found next to this script: $templateDir"
}
$templateDir = (Resolve-Path -LiteralPath $templateDir).ProviderPath

$testScript = Join-Path $PSScriptRoot 'tests/Test-KbStructure.ps1'
if (-not (Test-Path -LiteralPath $testScript -PathType Leaf)) {
    Stop-WithReason "structural check not found: $testScript"
}
$testScript = (Resolve-Path -LiteralPath $testScript).ProviderPath

# An existing destination with any content is refused outright. sources/ and
# git history must never be overwritten by an instantiation.
if (Test-Path -LiteralPath $Path) {
    $existing = @(Get-ChildItem -LiteralPath $Path -Force)
    if ($existing.Count -gt 0) {
        Stop-WithReason "destination already exists and is not empty: $Path"
    }
}

# The files that must survive the copy. A silently half-copied engine is the
# worst failure this script can produce, so each is verified after the copy.
$requiredFiles = @(
    '.claude/settings.json'
    '.claude/kb-move.ps1'
    '.claude/kb-commit.ps1'
    '.claude/skills/wiki-ingest/SKILL.md'
    '.claude/skills/wiki-lint/SKILL.md'
    '.claude/skills/wiki-query/SKILL.md'
    'CLAUDE.md'
    'index.md'
    'log.md'
    '.gitignore'
    'inbox/.gitkeep'
    'sources/.gitkeep'
    'wiki/.gitkeep'
)

$doCreate = $PSCmdlet.ShouldProcess($Path, 'Create knowledge base directory')
$doCopy   = $PSCmdlet.ShouldProcess("$templateDir -> $Path", 'Copy template tree')
$doGit    = $PSCmdlet.ShouldProcess($Path, 'git init -b main and make the initial commit')

if (-not ($doCreate -and $doCopy -and $doGit)) {
    # -WhatIf: the three actions above were announced and nothing is written.
    exit 0
}

New-Item -ItemType Directory -Path $Path -Force | Out-Null
$script:PartialPath = (Resolve-Path -LiteralPath $Path).ProviderPath
$kbRoot = (Resolve-Path -LiteralPath $Path).ProviderPath

# Copy each top-level template entry into the destination. Enumerating with
# -Force includes hidden files and dot-directories, and -Recurse on a directory
# entry carries its whole subtree, which a wildcard copy can silently skip.
Get-ChildItem -LiteralPath $templateDir -Force | Copy-Item -Destination $kbRoot -Recurse -Force

foreach ($rel in $requiredFiles) {
    $full = Join-Path $kbRoot $rel
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Stop-WithReason "template copy is incomplete; missing after copy: $rel"
    }
}

Invoke-GitOrStop -Arguments @('-C', $kbRoot, 'init', '-b', 'main') -FailReason 'git init -b main failed.'
Invoke-GitOrStop -Arguments @('-C', $kbRoot, 'add', '-A') -FailReason 'git add -A failed.'

$messageFile = $null
try {
    $messageFile = [System.IO.Path]::GetTempFileName()
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($messageFile, "Initialize $Name knowledge base from the llm-wiki template", $utf8NoBom)

    # A missing git identity fails here with git's own message on stderr; that
    # is surfaced rather than papered over, because the account's git config
    # owns the committer identity.
    Invoke-GitOrStop -Arguments @('-C', $kbRoot, 'commit', '-F', $messageFile) -FailReason 'git commit failed (check that git user.name and user.email are configured for this account).'
} finally {
    if ($messageFile -and (Test-Path -LiteralPath $messageFile)) {
        Remove-Item -LiteralPath $messageFile -Force
    }
}

# The structural check runs in a child process of the same PowerShell host, so
# its own `exit` cannot terminate this script and no assumption is made about
# whether pwsh is on PATH.
$psExe = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
& $psExe -NoProfile -File $testScript -Path $kbRoot -RequireSchema -RequireSkills
if ($LASTEXITCODE -ne 0) {
    Stop-WithReason "structural check failed for the new KB: $kbRoot"
}

# Past every gate, so the destination is a complete KB rather than a partial one.
$script:PartialPath = $null

Write-Output ''
Write-Output "Knowledge base created and committed: $kbRoot"
Write-Output ''
Write-Output 'Follow-up steps, in order:'
Write-Output ''
Write-Output '  1. Trust the workspace. Open Claude Code interactively in the new KB'
Write-Output '     once and accept the trust dialog. Claude Code ignores permissions.allow'
Write-Output '     in an untrusted workspace, so a scheduled run there writes nothing.'
Write-Output '     The schema-specialization session in step 2 does this anyway.'
Write-Output ''
Write-Output '  2. Specialize the schema. Run the interactive schema-specialization'
Write-Output '     session described in docs/instantiation.md to customize CLAUDE.md'
Write-Output '     for the domain, then commit CLAUDE.md.'
Write-Output ''
Write-Output '  3. Create the remote and push. Create the repo by hand under the owning'
Write-Output "     entity's own git account, then:"
Write-Output '         git remote add origin <url>'
Write-Output '         git push -u origin main'
Write-Output ''
Write-Output '  4. Register automation. Register the scheduled ingest task, plus a weekly lint'
Write-Output '     task beside it and a feed task for a fed KB,'
Write-Output '     as described in docs/runbook_automation.md.'

exit 0
