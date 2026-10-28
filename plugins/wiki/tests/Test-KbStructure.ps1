#Requires -Version 5.1
<#
.SYNOPSIS
Checks that a folder has the KB repo structure the llm-wiki engine expects.

.DESCRIPTION
Verifies the directories and files a KB repo must contain: inbox/, sources/,
wiki/, .claude/, .claude/skills/, index.md, log.md, .gitignore, the
.claude/settings.json, kb-move.ps1, kb-commit.ps1, and kb-status.ps1 helpers,
and the kb-run.ps1 run wrapper.

Also checks the permission allowlist, which is load-bearing: a headless run
cannot answer a permission prompt, so a missing allow rule stalls an
unattended ingest and a missing deny rule lets it damage sources/ or read a
secret. The checks confirm settings.json parses, denies writes under
sources/, inbox/, .git/ and .claude/, denies every raw git verb and the raw
shell verbs that would bypass the helpers, denies the Grep tool, denies reads
of credential files, allows the three vetted helpers a KB session calls to
move a file, to commit, and to read status, and pins permissions.defaultMode
to default so a bypass-default account still runs under the allow-list.

Passing this check does not prove a headless run will complete. Claude Code
ignores permissions.allow entirely in a workspace that has not been trusted,
so the runbook's trust check is the other half of the guarantee. This script
judges structure, never whether a wiki page is accurate or useful.

.PARAMETER Path
Path to the KB repo (or the bare template/) to check.

.PARAMETER RequireSchema
Also require CLAUDE.md and the version mark .claude/engine.json to exist. An
instantiated KB has both; the bare template has no engine.json, since
new-kb.ps1 writes it at the copy.

.PARAMETER RequireSkills
Also require the wiki-ingest, wiki-lint, and wiki-query skill files. An
instantiated KB has all three; the bare template gains them as the engine
is built out.

.EXAMPLE
pwsh -File tests/Test-KbStructure.ps1 -Path template

.EXAMPLE
pwsh -File tests/Test-KbStructure.ps1 -Path ./eleos-kb -RequireSchema -RequireSkills
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Path,

    [switch]$RequireSchema,

    [switch]$RequireSkills
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    Write-Host "[FAIL] path not found or not a directory: $Path"
    exit 1
}
$root = Resolve-Path -LiteralPath $Path
$failures = 0

function Test-Check {
    param(
        [string]$Description,
        [bool]$Passed
    )
    if ($Passed) {
        Write-Host "[PASS] $Description"
    } else {
        Write-Host "[FAIL] $Description"
        $script:failures++
    }
}

# Reads a property that may be absent. Under Set-StrictMode, a plain property
# access on a missing member throws, so every read of parsed JSON goes through here.
# The property collection is enumerated one at a time rather than projected with
# .Name, because projecting a member off an empty collection throws the same way.
function Get-JsonProperty {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    foreach ($property in $Object.PSObject.Properties) {
        if ($property.Name -eq $Name) { return $property.Value }
    }
    return $null
}

# True when at least one permission rule matches the pattern.
function Test-RuleMatch {
    param([string[]]$Rules, [string]$Pattern)
    return [bool]($Rules | Where-Object { $_ -match $Pattern })
}

$requiredDirs = @('inbox', 'sources', 'wiki', '.claude', '.claude/skills')
foreach ($dir in $requiredDirs) {
    $full = Join-Path $root $dir
    Test-Check -Description "directory exists: $dir" -Passed (Test-Path -LiteralPath $full -PathType Container)
}

$requiredFiles = @('index.md', 'log.md', '.gitignore', '.claude/settings.json', '.claude/kb-move.ps1', '.claude/kb-commit.ps1', '.claude/kb-status.ps1', '.claude/kb-run.ps1')
foreach ($file in $requiredFiles) {
    $full = Join-Path $root $file
    Test-Check -Description "file exists: $file" -Passed (Test-Path -LiteralPath $full -PathType Leaf)
}

if ($RequireSchema) {
    # An instantiated KB carries the schema and the version mark new-kb.ps1
    # writes; the bare template carries the schema but not the version mark.
    foreach ($file in @('CLAUDE.md', '.claude/engine.json')) {
        $full = Join-Path $root $file
        Test-Check -Description "file exists: $file" -Passed (Test-Path -LiteralPath $full -PathType Leaf)
    }
}

if ($RequireSkills) {
    foreach ($skill in @('wiki-ingest', 'wiki-lint', 'wiki-query')) {
        $full = Join-Path $root ".claude/skills/$skill/SKILL.md"
        Test-Check -Description "file exists: .claude/skills/$skill/SKILL.md" -Passed (Test-Path -LiteralPath $full -PathType Leaf)
    }
}

$settingsChecks = @(
    'settings.json has permissions.allow array'
    'settings.json has permissions.deny array'
    'deny array blocks writes under sources/'
    'deny array blocks writes under inbox/'
    'deny array blocks writes under .git/'
    'deny array blocks writes under .claude/'
    'deny array blocks raw shell verbs'
    'deny array blocks every raw git verb'
    'deny array blocks the Grep tool'
    'deny array blocks reads of credential files'
    'allow array covers wiki page writes'
    'allow array covers the commit helper'
    'allow array covers moving a file out of inbox/'
    'allow array covers the status helper'
    'allow array grants no raw git write verb'
    'permissions.defaultMode is pinned to default'
)

$settingsPath = Join-Path $root '.claude/settings.json'
$settings = $null
$parsed = $false
if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
    try {
        $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
        $parsed = $true
    } catch {
        $parsed = $false
    }
}
Test-Check -Description 'settings.json parses as JSON' -Passed $parsed

if (-not $parsed) {
    foreach ($check in $settingsChecks) { Test-Check -Description $check -Passed $false }
} else {
    $permissions = Get-JsonProperty $settings 'permissions'
    $allowRules = @(@(Get-JsonProperty $permissions 'allow') | Where-Object { $_ })
    $denyRules  = @(@(Get-JsonProperty $permissions 'deny')  | Where-Object { $_ })

    Test-Check -Description 'settings.json has permissions.allow array' -Passed ($allowRules.Count -gt 0)
    Test-Check -Description 'settings.json has permissions.deny array'  -Passed ($denyRules.Count -gt 0)

    Test-Check -Description 'deny array blocks writes under sources/' -Passed (Test-RuleMatch $denyRules '^(Write|Edit)\(.*sources')
    Test-Check -Description 'deny array blocks writes under inbox/'   -Passed (Test-RuleMatch $denyRules '^(Write|Edit)\(.*inbox')
    Test-Check -Description 'deny array blocks writes under .git/'    -Passed (Test-RuleMatch $denyRules '^(Write|Edit)\(.*\.git')
    Test-Check -Description 'deny array blocks writes under .claude/' -Passed (Test-RuleMatch $denyRules '^(Write|Edit)\(.*\.claude')

    # sources/ immutability and the no-outside-write guarantee hold only if the raw
    # verbs that could bypass the helpers are denied outright.
    Test-Check -Description 'deny array blocks raw shell verbs' -Passed (
        (Test-RuleMatch $denyRules '^Bash\(mv') -and
        (Test-RuleMatch $denyRules '^Bash\(rm') -and
        (Test-RuleMatch $denyRules '^Bash\(cp') -and
        (Test-RuleMatch $denyRules '^Bash\(ls')
    )

    # Every raw git verb is denied outright, so the agent reaches git only through
    # the vetted helpers, which run it as a pwsh subprocess the rules do not reach.
    # A prefix rule on git reads (diff, log) could not constrain a --output or a
    # --no-index that turns a read into an arbitrary write or an out-of-repo read.
    Test-Check -Description 'deny array blocks every raw git verb' -Passed (Test-RuleMatch $denyRules '^Bash\(git:\*\)$')

    # Grep's path-scoped deny rules do not bind, so the tool is denied outright; no
    # skill needs it.
    Test-Check -Description 'deny array blocks the Grep tool' -Passed ($denyRules -contains 'Grep')

    # Read is allowed unscoped, so only these deny rules keep an injected instruction
    # from reading a credential file and writing it into a page that gets pushed.
    Test-Check -Description 'deny array blocks reads of credential files' -Passed (
        (Test-RuleMatch $denyRules '^Read\(\*\*/\.credentials\.json\)') -and
        (Test-RuleMatch $denyRules '^Read\(\*\*/\.claude\.json\)') -and
        (Test-RuleMatch $denyRules '^Read\(\*\*/\.git-credentials\)') -and
        (Test-RuleMatch $denyRules '^Read\(\*\*/\.ssh/') -and
        (Test-RuleMatch $denyRules '^Read\(\*\*/\.aws/') -and
        (Test-RuleMatch $denyRules '^Read\(\*\*/\*\.pem\)') -and
        (Test-RuleMatch $denyRules '^Read\(\*\*/id_ed25519\)') -and
        (Test-RuleMatch $denyRules '^Read\(\*\*/\.config/gh/') -and
        (Test-RuleMatch $denyRules '^Read\(\*\*/GitHub CLI/') -and
        (Test-RuleMatch $denyRules '^Read\(\*\*/\.netrc\)') -and
        (Test-RuleMatch $denyRules '^Read\(\*\*/_netrc\)') -and
        (Test-RuleMatch $denyRules '^Read\(\*\*/\.claude/\*\.json\)')
    )

    # A structurally valid allowlist that omits a verb the ingest flow needs leaves an
    # unattended run stalled on a prompt nobody can answer. These assert the minimum set.
    Test-Check -Description 'allow array covers wiki page writes' -Passed (Test-RuleMatch $allowRules '^Write(\(|$)')
    Test-Check -Description 'allow array covers the commit helper' -Passed (Test-RuleMatch $allowRules '^Bash\(pwsh .*kb-commit\.ps1')
    Test-Check -Description 'allow array covers moving a file out of inbox/' -Passed (Test-RuleMatch $allowRules '^Bash\(pwsh .*kb-move\.ps1')
    Test-Check -Description 'allow array covers the status helper' -Passed (Test-RuleMatch $allowRules '^Bash\(pwsh .*kb-status\.ps1')

    # The agent must reach git writes only through the vetted helpers, never a raw verb.
    Test-Check -Description 'allow array grants no raw git write verb' -Passed (
        -not (Test-RuleMatch $allowRules '^Bash\(git (add|commit|push|mv|remote|config|reset|clean|checkout)')
    )

    # A session in the KB on an account whose own settings default to
    # bypassPermissions would otherwise run with only the deny wall, so it could
    # write .claude/feed.json through a shell verb or run the feeder. Pinning the
    # mode here holds every session to the allow-list, which grants neither.
    Test-Check -Description 'permissions.defaultMode is pinned to default' -Passed ((Get-JsonProperty $permissions 'defaultMode') -ceq 'default')
}

if ($failures -eq 0) {
    Write-Host "All checks passed for: $root"
    exit 0
} else {
    Write-Host "$failures check(s) failed for: $root"
    exit 1
}
