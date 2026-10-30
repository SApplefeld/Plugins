#Requires -Version 5.1
<#
.SYNOPSIS
Creates a new knowledge base repo from the engine's template/ directory.

.DESCRIPTION
Instantiates a self-contained knowledge base: it copies the entire template/
tree (including dotfiles and dot-directories) into a fresh destination, writes
the version mark .claude/engine.json, runs git init on the main branch, makes
one initial commit, and verifies the result with tests/Test-KbStructure.ps1
before reporting success. It refuses to touch a destination that already holds
files, so an existing repo is never overwritten. It creates no git remote and
assumes no GitHub account, because each owning entity's git host and identity
differ, and a knowledge base with no remote commits locally. It does not set
git user.name or user.email; the account's own git config owns the committer
identity, and a missing identity stops the run loudly rather than being papered
over. On success it prints the follow-up steps, leading with trusting the new
workspace, because Claude Code ignores permissions.allow in an untrusted
workspace and a scheduled run there silently writes nothing.

The version mark names the engine the knowledge base was copied from:
{ "templateHash": "<sha256>", "source": "<text>", "copiedAt": "<ISO 8601 UTC>" }.
templateHash is the SHA-256 over every file under this engine's own
template/.claude/, so it names the vendored engine and never the schema or the
content, and engine.json itself is outside it. Line endings are read as LF, so
a CRLF and an LF checkout of one engine print the same hash. source is the installed plugin's
version where this script runs from the installPath of wiki@applefeld in
~/.claude/plugins/installed_plugins.json, else the engine checkout's short
commit, else unknown. -PrintEngineHash prints the hash of this engine's
template and exits 0, which is how a later engine decides whether a knowledge
base is behind it.

.PARAMETER Name
The name of the knowledge base. It is used only in the initial commit message.
An empty or whitespace-only name is rejected.

.PARAMETER Path
The destination directory to create as the KB repo root. It must not already
exist with contents. A relative path is resolved against the current location.

.PARAMETER PrintEngineHash
Print the templateHash of this engine's template/.claude/ as 64 lowercase
hexadecimal characters and exit 0, creating nothing.

.EXAMPLE
pwsh -NoProfile -File ./new-kb.ps1 -Name "Eleos KB" -Path ../eleos-kb

.EXAMPLE
pwsh -NoProfile -File ./new-kb.ps1 -PrintEngineHash
#>
[CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'Create')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Create')]
    [string]$Name,

    [Parameter(Mandatory, ParameterSetName = 'Create')]
    [string]$Path,

    [Parameter(Mandatory, ParameterSetName = 'Hash')]
    [switch]$PrintEngineHash
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

# The SHA-256 of every file under <template>/.claude/, as 64 lowercase
# hexadecimal characters. The framing, which any other reader of the mark must
# reproduce byte for byte: take every file under .claude/ at any depth, name
# each by its path relative to the template folder with forward slashes (for
# example .claude/kb-commit.ps1), sort those names ordinally (byte order of
# their UTF-16 code units, no culture), and for each in that order feed the
# hash the name as UTF-8 bytes, one 0x00 byte, the file's length in bytes as
# decimal ASCII digits, one 0x00 byte, then the file's bytes. A file's bytes
# are taken with every CR LF pair as a lone LF, and its length is counted after
# that, so a checkout with either line ending prints one hash. The hash runs
# over the engine's own template, never a knowledge base's copy, so
# engine.json is outside it.
function Get-EngineHash {
    param([string]$TemplateRoot)
    $claudeDir = Join-Path $TemplateRoot '.claude'
    $files = @([System.IO.Directory]::GetFiles($claudeDir, '*', [System.IO.SearchOption]::AllDirectories))
    $prefixLength = $TemplateRoot.TrimEnd('\', '/').Length + 1
    $names = [System.Collections.Generic.List[string]]::new()
    foreach ($file in $files) {
        $names.Add($file.Substring($prefixLength).Replace('\', '/'))
    }
    $names.Sort([System.StringComparer]::Ordinal)
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $zero = [byte[]]@(0)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        foreach ($name in $names) {
            # Latin-1 maps each byte to one character and back, so the
            # replace drops each CR of a CR LF pair and leaves every other byte.
            $latin1 = [System.Text.Encoding]::GetEncoding(28591)
            $bytes = $latin1.GetBytes($latin1.GetString([System.IO.File]::ReadAllBytes((Join-Path $TemplateRoot $name))).Replace("`r`n", "`n"))
            foreach ($part in @($utf8.GetBytes($name), $zero, $utf8.GetBytes($bytes.Length.ToString([System.Globalization.CultureInfo]::InvariantCulture)), $zero, $bytes)) {
                if ($part.Length -gt 0) { [void]$sha.TransformBlock($part, 0, $part.Length, $null, 0) }
            }
        }
        [void]$sha.TransformFinalBlock([byte[]]@(), 0, 0)
        return (($sha.Hash | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally {
        $sha.Dispose()
    }
}

# A property of parsed JSON, or $null where it is absent. Under Set-StrictMode
# a plain access on a missing member throws.
function Get-JsonProperty {
    param($Object, [string]$PropertyName)
    if ($null -eq $Object) { return $null }
    foreach ($property in $Object.PSObject.Properties) {
        if ([string]::Equals($property.Name, $PropertyName, [StringComparison]::Ordinal)) { return $property.Value }
    }
    return $null
}

# Full path with no trailing separator, compared ignoring case, as
# kb-registry.ps1's ConvertTo-NormalPath compares folders.
function ConvertTo-NormalPath {
    param([string]$Value)
    $full = [System.IO.Path]::GetFullPath($Value)
    $pathRoot = [System.IO.Path]::GetPathRoot($full)
    if ($full.Length -gt $pathRoot.Length) { $full = $full.TrimEnd('\', '/') }
    return $full
}

# Where this engine came from, for the version mark's source: the version of
# the wiki@applefeld entry in the account's installed_plugins.json whose
# installPath is this script's folder, else the engine checkout's short commit,
# else unknown. The install record is Claude Code's own file and is read as
# untrusted: any shape but the expected one falls through.
function Get-EngineSource {
    param([string]$EngineRoot)
    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        $installRecord = Join-Path $env:USERPROFILE '.claude/plugins/installed_plugins.json'
        try {
            if (Test-Path -LiteralPath $installRecord -PathType Leaf) {
                $record = Get-Content -LiteralPath $installRecord -Raw | ConvertFrom-Json
                $entries = @(Get-JsonProperty (Get-JsonProperty $record 'plugins') 'wiki@applefeld')
                $here = ConvertTo-NormalPath $EngineRoot
                foreach ($entry in $entries) {
                    $installPath = Get-JsonProperty $entry 'installPath'
                    $version = Get-JsonProperty $entry 'version'
                    if ($installPath -is [string] -and $version -is [string] -and -not [string]::IsNullOrWhiteSpace($version) -and
                        [string]::Equals((ConvertTo-NormalPath $installPath), $here, [StringComparison]::OrdinalIgnoreCase)) {
                        return $version
                    }
                }
            }
        } catch {
            # An unreadable or off-shape install record is not this engine's version.
        }
    }
    try {
        $commit = @(& git -C $EngineRoot rev-parse --short HEAD 2>$null)
        if ($LASTEXITCODE -eq 0 -and $commit.Count -eq 1 -and $commit[0] -match '^[0-9a-f]{4,40}$') {
            return $commit[0]
        }
    } catch {
        # An engine folder outside any git checkout has no commit to name.
    }
    return 'unknown'
}

# The template lives next to this script. A missing template means the engine
# checkout is broken, so there is nothing to instantiate.
$templateDir = Join-Path $PSScriptRoot 'template'
if (-not (Test-Path -LiteralPath $templateDir -PathType Container)) {
    Stop-WithReason "template directory not found next to this script: $templateDir"
}
$templateDir = (Resolve-Path -LiteralPath $templateDir).ProviderPath

if ($PrintEngineHash) {
    Write-Output (Get-EngineHash $templateDir)
    exit 0
}

# A missing git executable throws before any exit code is set, which would
# surface as a stack trace rather than a refusal.
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Stop-WithReason 'git was not found on PATH.'
}

if ([string]::IsNullOrWhiteSpace($Name)) {
    Stop-WithReason 'Name is required and must not be empty or whitespace.'
}

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
    '.claude/engine.json'
    '.claude/kb-move.ps1'
    '.claude/kb-commit.ps1'
    '.claude/kb-run.ps1'
    '.claude/skills/wiki-ingest/SKILL.md'
    '.claude/skills/wiki-lint/SKILL.md'
    '.claude/skills/wiki-query/SKILL.md'
    '.claude/skills/wiki-merge/SKILL.md'
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

# The version mark, written before the verification below so a missing one
# fails the copy, and before git add so the first commit carries it. The hash
# is of this engine's template, computed above the copy's own .claude/ folder.
$engineMark = New-Object System.Collections.Specialized.OrderedDictionary
$engineMark['templateHash'] = Get-EngineHash $templateDir
$engineMark['source'] = Get-EngineSource $PSScriptRoot
$engineMark['copiedAt'] = [DateTime]::UtcNow.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
$engineMarkText = (ConvertTo-Json -InputObject $engineMark) + "`n"
[System.IO.File]::WriteAllText((Join-Path $kbRoot '.claude/engine.json'), $engineMarkText, (New-Object System.Text.UTF8Encoding($false)))

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
Write-Output '  1. Trust the workspace. Run kb-trust.ps1 -Path <kb> from the engine, or'
Write-Output '     open Claude Code interactively in the new KB once and accept the'
Write-Output '     trust dialog. Claude Code ignores permissions.allow'
Write-Output '     in an untrusted workspace, so a scheduled run there writes nothing.'
Write-Output '     The schema-specialization session in step 2 does this anyway.'
Write-Output ''
Write-Output '  2. Specialize the schema. Run the interactive schema-specialization'
Write-Output '     session described in docs/instantiation.md to customize CLAUDE.md'
Write-Output '     for the domain, then commit CLAUDE.md.'
Write-Output ''
Write-Output '  3. Optionally attach a remote. A knowledge base with no remote commits'
Write-Output '     locally and pushes nothing. To share or back one up, create the repo'
Write-Output "     by hand under the owning entity's own git account, then:"
Write-Output '         git remote add origin <url>'
Write-Output '         git push -u origin main'
Write-Output ''
Write-Output '  4. List and automate. Add the knowledge base to the wiki list with'
Write-Output '     kb-registry.ps1 Add, and register the wiki-walk task once per account'
Write-Output '     with register-walk.ps1, as described in docs/runbook_automation.md.'

exit 0
