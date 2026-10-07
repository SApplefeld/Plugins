# The doctor's memory-sync helpers: what the sync repo's allowlist is, what
# the store root's actual state is against it, and how an initialization is
# performed.
#
# Dot-sourced by doctor.ps1, which calls these under its "memory sync" check;
# the repo test suite dot-sources the same file and runs the same functions
# against a redirected store root, which is why the store root arrives as a
# mandatory parameter and is never resolved from the environment here. There
# is no default: the real store root holds .credentials.json, settings.json,
# and history.jsonl, so a forgotten redirect must be a loud parameter error
# rather than a git init over the operator's home. This file defines
# functions only; dot-sourcing it runs nothing and writes nothing.
#
# The store root is ~/.claude itself, and the allowlist is the whole security
# model of the sync: it excludes everything and re-includes only the memory
# tiers and the coordinator directory, so no add, however careless, can stage
# a credential. The canonical text of both files is defined once here and used
# by both the writer and the check, so the check cannot drift from what the
# installer writes, and the check re-derives it on every doctor run rather than
# trusting a one-time verification.
#
# Verification is by direct probe, never by reading the ignore file alone.
# Each probe reads a different surface, and none of them substitutes for
# another: `git check-ignore` reads the rules, `git add -A --dry-run` reads the
# worktree, `git ls-files` reads the index, and `git rev-list --objects` reads
# the reachable object graph. A tracked file ignores gitignore entirely and
# appears in neither of the first two, so a single forced add would otherwise
# be invisible against a canonical-looking allowlist; and a blob that reached
# a commit stays reachable after it is untracked, so the history probe is the
# only one that can see a credential a push would still publish.
#
# A managed file carrying the marker line is the doctor's own and may be
# rewritten back to canonical; a file without it belongs to whoever wrote it
# and is reported, never touched. Repository ownership is a separate question
# and rests on a git config key set at initialization, so a repository whose
# .gitignore was deleted is still recognizable as the doctor's own and stays
# repairable; a marker-bearing .gitignore is accepted as equivalent evidence.

# Get-RedactedRemote, for the not-own-repository note below, which quotes
# whatever `git remote get-url origin` prints. Dot-sourcing this file defines
# functions only and runs nothing, so loading it here is harmless beside
# doctor.ps1's own dot-source of the same file. Guarded rather than
# unconditional: doctor.ps1 loads the installed copy's own install-memory-sync.ps1
# in an isolated scope to compare managed-file state, a path that never calls
# Install-MemorySyncRepo and so never needs Get-RedactedRemote, and an older
# installed copy shipped before this guard existed may sit beside a doctor
# folder a test fixture populated without its sibling sanitize-line.ps1. A
# missing sibling there must not fail the file load itself.
$sanitizeLineScript = Join-Path $PSScriptRoot "sanitize-line.ps1"
if (Test-Path -LiteralPath $sanitizeLineScript -PathType Leaf) { . $sanitizeLineScript }

# The line both managed files open with, and the only thing that makes a file
# on disk this script's to rewrite.
# Names host state written by earlier installs, kept so existing hosts still match.
$script:MemorySyncMarker = "# claude-kit memory sync allowlist."

# The git config key that records a repository as the doctor's own, and the
# value it carries.
$script:MemorySyncOwnKey = "claudekit.memorysync"
$script:MemorySyncOwnValue = "true"

# What a real git object id looks like, in the two widths git writes (SHA-1 at
# 40 hex characters, SHA-256 at 64) and in no width between them. Every
# revision this script hands to git as an argument is matched against it first,
# so a nonzero exit, an empty line, or git noise on the merged output stream
# cannot become a revision argument.
#
# The anchor is \z rather than $, which in .NET also matches before a trailing
# newline, and every match against this pattern is a -cmatch: git renders object
# ids in lowercase hex, and PowerShell's default -match is case-insensitive.
$script:MemorySyncObjectIdPattern = '^(?:[0-9a-f]{40}|[0-9a-f]{64})\z'

# The file forms an admitted root holds, keyed on the prefix that root's block
# in the ignore file takes. One set is defined per root and every surface that
# needs one reads it from here, so git, the probes, and the merge attributes
# cannot answer differently about a form. The switch carries one arm per root
# and a default that throws, so a root added to the prefix list below, or to
# either surface, and not to an arm here is a thrown error rather than another
# root's forms silently. Which callers surface that error differs, and the
# difference matters: the doctor and the repo suite let it out, where
# sync-store.ps1 runs Get-MemorySyncStatus inside a try whose tail catch is
# bare and whose contract is silence, so on the automatic sync path the throw
# is swallowed and the state file keeps whatever it last held. The check that
# actually stops a root being added to one surface and not another is the
# suite's drift pin over these three lists, not this throw.
#
# The forms differ per root because what writes into each root differs, and a
# form no writer of a root produces is a form that root does not re-include.
#
# The project tier holds the whole of what memq writes: memory bodies and both
# indexes as .md, the outcome journal, the usage sidecar, and the decay pass's
# completion stamp as the extension-less decay-stamp. The journal and the
# stamp are per-project by construction, both of their writers resolving
# through projectMemoryDir, so this is the only root that holds them. The
# run-scoped pending tier sits two levels below this root, under pending/
# <run-id>, and its own usage sidecar takes the same name, which the
# surrounding /**/ reaches at any depth.
#
# The type and operator tiers are shared, and the only memq output written
# into them is the usage sidecar: read stamps, the stamp rewrite a delete
# takes, and the decay pass's usage step all run against a tier directory,
# while the journal's writers and the decay stamp's do not. So those two roots
# admit .md and usage.jsonl and nothing else.
#
# Both sidecars are admitted by name rather than by extension, because a
# re-include written as an extension admits every .jsonl any tool writes
# anywhere under a root, whatever its relationship to the store.
#
# The coordinator directory holds no memq output at all: its contract names
# three files, the board, the registry entries, and the Admin request inbox,
# and all three are .md. Its set is still a form rather than that contract,
# and so is wider than it: .md at any depth under any directory there is
# admitted, where the contract names three paths. What the
# form buys is that it is the one form the contract writes, rather than a
# form no writer of that root produces. A coordinator .jsonl or stamp is a
# widening this function performs by name at the moment that contract defines
# one.
#
# Everything else an admitted directory can hold (locks, the single-generation
# .bak, rename temporaries, a broken-lock rename such as decay.lock.stale.<pid>)
# is transient state of one machine and never syncs.
function Get-MemorySyncAllowedLeafPatterns {
    param([Parameter(Mandatory = $true)][string]$RootPrefix)
    # The two forms every memory root holds, written once because the two
    # shared tiers hold these and nothing else.
    $sharedTierForms = @('*.md', 'usage.jsonl')
    switch ($RootPrefix) {
        '/projects/*/memory' { return @('*.md', 'outcomes.jsonl', 'usage.jsonl', 'decay-stamp') }
        '/memory-types'      { return $sharedTierForms }
        '/memory-operator'   { return $sharedTierForms }
        '/coordinator'       { return @('*.md') }
        default { throw "Get-MemorySyncAllowedLeafPatterns: no leaf set is defined for the root '$RootPrefix'." }
    }
}

# Every root the allowlist admits, in the prefix spelling its own block in the
# ignore file takes. Get-MemorySyncIgnoreText writes those blocks from literal
# prefixes, each carrying its own comment, so this list is for the surfaces
# that need the whole set at once rather than one block at a time.
function Get-MemorySyncAdmittedRootPrefixes {
    return @('/projects/*/memory', '/memory-types', '/memory-operator', '/coordinator')
}

# The transient names, refused last and therefore refused whatever else
# matched. The list is a single definition used by both the ignore text and
# the path predicate, so a name such as foo.tmp.md, which the allowed forms
# admit and this axis denies, cannot be answered one way by git and the other
# way by the probes.
function Get-MemorySyncTransientPatterns {
    return @('*.lock', '*.bak', '*.tmp.*')
}

# The index-reading invocation, defined once so the two readers of the index
# (the tracked-path probe and the installer's gate) cannot answer differently.
# core.quotePath=false prints a path holding non-ASCII bytes as itself rather
# than octal-escaped inside double quotes.
function Get-MemorySyncLsFilesArguments {
    return @("-c", "core.quotePath=false", "ls-files")
}

# The allowlist itself. Each directory level is re-included before its
# contents because git cannot re-include a path whose parent directory is
# excluded, and each root re-includes its files by form rather than excluding
# transient ones by pattern, because a positive rule is closed and a pattern
# list is open. Each root's forms are the ones its own contract defines, read
# from the function above by the same prefix the block is written under. The
# blanket exclusions come last, where the last matching pattern decides, so a
# lock, backup, or rewrite temporary is refused twice.
function Get-MemorySyncIgnoreText {
    $tierRules = {
        param($prefix)
        @("!$prefix/", "$prefix/**", "!$prefix/**/") +
            (Get-MemorySyncAllowedLeafPatterns -RootPrefix $prefix | ForEach-Object { "!$prefix/**/$_" })
    }
    return (@(
        $script:MemorySyncMarker,
        '# Managed by the kit doctor, which re-derives this file on every run and',
        '# reports any difference as a failure.',
        '#',
        "# The store root holds .credentials.json, settings.json, and history.jsonl,",
        '# and its projects/ directories hold full session transcripts. Everything is',
        '# excluded; only memory files inside the memory tiers and the coordinator',
        '# directory are re-included.',
        '',
        '/*',
        '!/.gitignore',
        '!/.gitattributes',
        '',
        '# The project tier: projects/<flattened-project-path>/memory/ and nothing else.',
        '!/projects/',
        '/projects/*',
        '!/projects/*/',
        '/projects/*/*') +
        # $tierRules admits every allowed-leaf-pattern file under this prefix,
        # memory/pending/<run-id>/ included, so a run's own unadjudicated
        # writes still sync and survive a crash before the run ends. That is
        # deliberately wider than memory-index.js's semantic index, which
        # excludes the pending tier so a run's writes never surface in
        # another session's search before adjudication. Sync answers "should
        # this reach another machine"; the index answers "should this be
        # discoverable yet". Different questions, so the two surfaces disagree
        # on purpose.
        (& $tierRules '/projects/*/memory') + @(
        '',
        '# The type tier, live and archived.') +
        (& $tierRules '/memory-types') + @(
        '',
        '# The operator tier, live and archived.') +
        (& $tierRules '/memory-operator') + @(
        '',
        '# The coordinator tier: one directory per machine, holding the seat',
        '# artifacts every machine reads. Every file its contract defines is a',
        '# .md, so .md is the only form re-included here: still a form, and so',
        '# any .md at any depth rather than the three paths that contract names,',
        '# but a journal or a stamp some other tool writes under this directory',
        '# stays home. The same trailing transient exclusions apply, so a lock',
        '# or a rewrite temporary a seat leaves behind is per-machine state that',
        '# stays home too.') +
        (& $tierRules '/coordinator') + @(
        '',
        '# Never, even inside an allowed directory: lock files, the single-generation',
        '# backup memq writes before each rewrite, and its rename temporaries.') +
        (Get-MemorySyncTransientPatterns | ForEach-Object { "**/$_" }) + @(
        '') -join "`n")
}

# Union merge for the store's journals. They are append-only JSONL, so two
# machines that both appended since the last sync hold no conflicting edit,
# only two sets of new lines; a union merge keeps both sides instead of
# raising a conflict over a file whose only history is appends.
#
# The rules are derived from the same per-root leaf sets the allowlist is
# written from, one rule per .jsonl form per root, so no rule here can name a
# form its root does not admit. What that derivation does not settle is the
# root list itself: the ignore text writes its blocks from four literal
# prefixes while this function iterates Get-MemorySyncAdmittedRootPrefixes, so
# a root reaching one list and not the other is caught by the suite's drift
# pin over the two rather than prevented here. A root whose forms hold no
# .jsonl contributes nothing, which is why the coordinator directory has no
# rule here: not an omission, but the absence of anything to merge. The
# prefixes drop the leading slash the ignore file's spelling carries, an
# attributes pattern being rooted by its position in the file rather than by a
# slash.
function Get-MemorySyncAttributesText {
    $rules = @(foreach ($prefix in (Get-MemorySyncAdmittedRootPrefixes)) {
        foreach ($leaf in (Get-MemorySyncAllowedLeafPatterns -RootPrefix $prefix)) {
            if ($leaf -like '*.jsonl') { "$($prefix.TrimStart('/'))/**/$leaf merge=union" }
        }
    })
    # The tier indexes are the same append-only shape as the journals: one
    # "- [record](file.md) - description" line per record, appended at the
    # tail, so two machines that both added records hold disjoint new lines
    # and no conflicting edit. The rule names MEMORY.md alone rather than the
    # tier's *.md form, because a record body is prose, where a union merge
    # would interleave two rewrites into nonsense. The tiers that carry an
    # index are exactly the ones whose leaf set admits usage.jsonl, the
    # sidecar memq maintains beside every index, so the derivation keys on
    # that form rather than on a second root list that could drift. The
    # accepted cost is the one every union rule above already accepts: a line
    # edited on both sides survives as adjacent duplicates instead of a
    # conflict, visible and trivially repaired in an index of unique record
    # names, where a wedged sync is neither.
    $rules += @(foreach ($prefix in (Get-MemorySyncAdmittedRootPrefixes)) {
        if ((Get-MemorySyncAllowedLeafPatterns -RootPrefix $prefix) -contains 'usage.jsonl') {
            "$($prefix.TrimStart('/'))/**/MEMORY.md merge=union"
        }
    })
    return ((@(
        $script:MemorySyncMarker,
        '# Managed by the kit doctor, which re-derives this file on every run and',
        '# reports any difference as a failure.',
        '') + $rules + @(
        '')) -join "`n")
}

# The two managed files, each with the text it must hold.
function Get-MemorySyncManagedFiles {
    return @(
        @{ Name = ".gitignore"; Text = (Get-MemorySyncIgnoreText) },
        @{ Name = ".gitattributes"; Text = (Get-MemorySyncAttributesText) }
    )
}

# One managed file's state: Missing (nothing on disk), Canonical (exactly the
# text above), Drift (the doctor's own file, edited), or Foreign (a file
# without the marker, which belongs to whoever wrote it).
function Get-MemorySyncFileState {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Expected
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return "Missing" }
    # Line endings are normalized on both sides before comparing. A clone made
    # with core.autocrlf checks these files out with CRLF, which is not a
    # change to a single rule; treating it as drift would fail every doctor run
    # on such a machine and start a rewrite-and-checkout loop.
    $actual = [System.IO.File]::ReadAllText($Path) -replace "`r`n", "`n"
    if ($actual -eq ($Expected -replace "`r`n", "`n")) { return "Canonical" }
    if ($actual.StartsWith($script:MemorySyncMarker)) { return "Drift" }
    return "Foreign"
}

# Whether a store root that is already a git repository is the doctor's own
# sync repo. A repository that is not belongs to whoever created it (an
# operator versioning their dotfiles at the store root), and the doctor
# neither writes into it nor commits there, because `git add -A` in such a
# repo would sweep up whatever it had staged and put it in a commit nobody
# asked for.
#
# The evidence is a git config key, which survives the deletion of any file in
# the worktree, so a repository whose allowlist was removed is still the
# doctor's to repair rather than an unreachable stranger. A marker-bearing
# .gitignore counts as the same evidence, which is what lets a repository
# carrying only that file be recognized and gain the key on the next repair.
function Test-MemorySyncRepoIsOwn {
    param(
        [Parameter(Mandatory = $true)][string]$StoreRoot,
        [string]$GitExe = "git"
    )
    $state = Get-MemorySyncFileState -Path (Join-Path $StoreRoot ".gitignore") -Expected (Get-MemorySyncIgnoreText)
    if ($state -eq "Canonical" -or $state -eq "Drift") { return $true }
    if (-not (Test-Path -LiteralPath (Join-Path $StoreRoot ".git"))) { return $false }
    $marker = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("config", "--local", "--get", $script:MemorySyncOwnKey) -GitExe $GitExe
    return ($marker.Code -eq 0 -and $marker.Output.Count -gt 0 -and $marker.Output[0].Trim() -eq $script:MemorySyncOwnValue)
}

# Whether a repo-relative path is one the allowlist is meant to admit. Used to
# judge what a dry-run add would stage, what is already tracked, and what
# committed history holds, so every probe answers against the same rule the
# ignore file encodes. The rule is positive on both axes: the path must sit
# inside one of the roots the allowlist admits, a memory tier or the
# coordinator directory, and its file name must be one of the forms that root
# admits. The root is resolved first because the forms are per root, and they
# differ three ways: the project tier takes the whole of what memq writes
# there, the two shared tiers take .md and the usage sidecar alone, since that
# is the only memq output written into them, and the coordinator directory
# takes .md alone, the one form its contract writes. That last set is a form
# rather than the contract, and so wider than it, admitting a .md at any depth
# where the contract names three paths; what it buys is that the admitted form
# is one the contract writes rather than one no writer there produces. A name
# outside its root's set is refused whether or not any exclusion pattern
# happens to describe it, and a path in no admitted root is refused before any
# form is considered.
function Test-MemorySyncPathAllowed {
    param([Parameter(Mandatory = $true)][string]$RelativePath)
    $p = $RelativePath -replace '\\', '/'
    if ($p -eq ".gitignore" -or $p -eq ".gitattributes") { return $true }
    $rootPrefix = $null
    if ($p -match '^projects/[^/]+/memory/.+') { $rootPrefix = '/projects/*/memory' }
    elseif ($p -match '^memory-types/.+') { $rootPrefix = '/memory-types' }
    elseif ($p -match '^memory-operator/.+') { $rootPrefix = '/memory-operator' }
    elseif ($p -match '^coordinator/.+') { $rootPrefix = '/coordinator' }
    if ($null -eq $rootPrefix) { return $false }
    $leaf = $p.Substring($p.LastIndexOf('/') + 1)
    $leafAllowed = $false
    foreach ($pattern in (Get-MemorySyncAllowedLeafPatterns -RootPrefix $rootPrefix)) {
        if ($leaf -like $pattern) { $leafAllowed = $true; break }
    }
    if (-not $leafAllowed) { return $false }
    # The deny axis runs after the allowed forms and overrides them, which is
    # the order the ignore file's last-match-wins rules produce. It applies to
    # every path component, not just the leaf: the trailing `**/*.bak` form
    # matches a directory named notes.bak as readily as a file, and git cannot
    # re-include anything beneath a directory it has excluded, so a predicate
    # reading the leaf alone would admit paths git refuses.
    foreach ($segment in ($p -split '/')) {
        foreach ($pattern in (Get-MemorySyncTransientPatterns)) {
            if ($segment -like $pattern) { return $false }
        }
    }
    return $true
}

# This machine's name, as the coordinator directory spells it. The reading is
# [System.Net.Dns]::GetHostName(), which is the same string Node's
# os.hostname() returns on the platforms the kit runs, and the coordinator
# directory contract names a machine's directory by that Node reading, so the
# two runtimes must agree or a machine reads its own directory as another's.
# $env:COMPUTERNAME is not the reading: it is Windows-only, and every process
# in a tree inherits whatever a parent set it to. GetHostName() is the narrower
# reading rather than an unredirectable one: on Windows it returns
# $env:_CLUSTER_NETWORK_NAME_ wherever that variable is set, and Node's
# os.hostname() honours the same variable, so the two runtimes agree under it
# and the parity this axis rests on holds either way. What the axis does not do
# is authenticate a writer, which the plan's Approach states outright: a process
# that controls this one's environment already has write access to the store
# root and can write any coordinator file directly, so the axis narrows the sync
# channel and never resists that actor.
function Get-MemorySyncMachineName {
    return [System.Net.Dns]::GetHostName()
}

# Whether a repo-relative path is one THIS machine's coordinator directory
# holds. The coordinator tier is one directory per machine, so the machine is
# the path's second segment, and the answer is what both directions of the sync
# channel key on: outbound, a staged coordinator path this returns false for is
# another machine's file and refuses the commit; inbound, an incoming change
# this returns true for is a write into this machine's own directory and
# refuses the intake. A path outside the coordinator tier is not this machine's
# coordinator path and answers false, so the outbound side asks its own
# "is this under coordinator/" question rather than reading a false here as a
# foreign write.
#
# The comparison is deliberately case-insensitive (-ieq spells out what
# PowerShell's -eq already does, so the rule survives a rewrite that reaches for
# -ceq). Git paths are case-sensitive, but the working tree the runner writes
# sits on filesystems that hold one directory per name whatever its spelling, so
# a path whose machine segment matches this machine's name under a case fold
# lands in this machine's own directory on the disk the write reaches. Reading
# such a variant as own is therefore the truthful answer in both directions: it
# refuses a case-variant write inbound, and it stages a case-variant path
# outbound rather than calling this machine's own file foreign.
function Test-MemorySyncCoordinatorPathIsOwn {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Machine
    )
    if ($Machine.Trim() -eq "") { return $false }
    $segments = ($RelativePath -replace '\\', '/') -split '/'
    if ($segments.Count -lt 2) { return $false }
    if ($segments[0] -ine 'coordinator') { return $false }
    return ($segments[1] -ieq $Machine)
}

# The paths the check proves are ignored: the three sensitive root files, plus
# a sampled session transcript, which is the bulk of what a project directory
# holds beside its memory store. The sample is whatever file sits directly in
# a project directory; when the store has none, the caller reports one fewer
# probe rather than inventing a path, because check-ignore answering about a
# file that does not exist proves less than one about a file that does.
function Get-MemorySyncProbePaths {
    param([Parameter(Mandatory = $true)][string]$StoreRoot)
    $paths = @(".credentials.json", "settings.json", "history.jsonl")
    $projectsDir = Join-Path $StoreRoot "projects"
    if (Test-Path -LiteralPath $projectsDir -PathType Container) {
        $sample = Get-ChildItem -LiteralPath $projectsDir -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -File -ErrorAction SilentlyContinue | Select-Object -First 1 } |
            Select-Object -First 1
        if ($null -ne $sample) {
            $paths += ("projects/" + $sample.Directory.Name + "/" + $sample.Name)
        }
    }
    return $paths
}

# Run git in the store root and return its output plus exit code. Output is
# captured rather than printed so the caller decides what reaches the report,
# and stderr joins it so a git error is diagnosable instead of silent.
#
# Every git call in the sync path passes through here, so the child
# environment is hardened here rather than at any one caller: a hand run of
# the sync script inherits the same protections the unattended background run
# gets from the hook's own gitChildEnv() in kit-git-lib.js. PowerShell cannot
# call that function, so this guard restates its protections rather than
# sharing them.
#
# What the guard covers:
#
# Every GIT_* variable is removed, case-insensitively. None is needed, since
# each call names its repository with -C, and several of them beat what the
# arguments say (GIT_DIR and GIT_WORK_TREE redirect the repository,
# GIT_CONFIG_* injects arbitrary config, the identity variables rewrite
# authorship).
#
# GIT_TERMINAL_PROMPT refuses a credential prompt, so a run with no operator
# at the keyboard fails with a diagnosable error instead of blocking on a
# hidden dialog.
#
# NoDefaultCurrentDirectoryInExePath is defence in depth for anything git
# spawns through a shell (an alias, a credential helper): cmd.exe reads that
# variable from its own environment and then resolves a bare command name
# against PATH alone rather than against the current directory.
#
# core.fsmonitor and core.hooksPath are ordinary repo-local keys git honours,
# so a status against a wrong or planted store root runs its fsmonitor
# program and a commit runs its hooks. Both are pinned inert through git's
# environment-config channel, which beats repo-local config. The pins are
# additive rather than a suppression of the config files: pointing
# GIT_CONFIG_GLOBAL at an empty file would also drop safe.directory, whose
# absence surfaces as a dubious-ownership refusal that reads like a
# permissions bug. fsmonitor is pinned to false, git's own disable value for
# the key, because a Windows process environment cannot hold an empty value
# (the setter deletes the variable instead) and a GIT_CONFIG_VALUE_<i> absent
# while GIT_CONFIG_COUNT names it is a fatal parse error on every call.
# hooksPath points at a fresh path under the temp directory that nothing
# creates, so git finds no hooks to run.
#
# Those two keys are pinned by name, and the class they belong to is not
# closed: any key git documents as a command or program (credential.helper
# and its URL-scoped form, core.sshCommand, core.askPass, core.gitProxy and
# the per-remote proxy, gpg.program and the ssh signing program under
# commit.gpgSign, filter and merge drivers, upload-pack and receive-pack), and
# any remote URL scheme or helper a remote's config selects, also makes git
# run a command on the verbs this funnel uses (fetch, rebase, commit, push),
# and none of them is pinned here. So the coverage above is the two named
# members rather than the class. The environment-config channel exists in
# git 2.31 and later; an older git ignores it silently and this guard
# degrades to the strip alone, with nothing here to say so. HOME and
# XDG_CONFIG_HOME are not stripped, since git needs HOME for its legitimate
# config, so they still select the global config every call here reads;
# docs/security-model.md carries that residual.
#
# The hooksPath pin cannot tell a repo-local hooksPath from a global one, so
# it also keeps an operator's global hooks (a pre-commit secret scanner, say)
# from running on the store's own commit and push. That is deliberate: the
# store is the repository this guard distrusts, its ownership check accepts a
# marker file a clone can carry, and a hook allowed on the write verbs would
# be the planted route reopened behind that check.
#
# The variables are snapshotted and restored in a finally block, so the
# session that dot-sources this file keeps its own environment whether git
# succeeded, failed, or threw. The exit code is read before the restore,
# since the restore is itself PowerShell work that would overwrite it.
function Invoke-MemorySyncGit {
    param(
        [Parameter(Mandatory = $true)][string]$StoreRoot,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$GitExe = "git"
    )
    $all = @("-C", $StoreRoot) + $Arguments
    $inertHooks = Join-Path ([System.IO.Path]::GetTempPath()) ("kit-memory-sync-no-hooks-" + [guid]::NewGuid().ToString())
    $guard = [ordered]@{
        "GIT_TERMINAL_PROMPT"                = "0"
        "NoDefaultCurrentDirectoryInExePath" = "1"
        "GIT_CONFIG_COUNT"                   = "2"
        "GIT_CONFIG_KEY_0"                   = "core.fsmonitor"
        "GIT_CONFIG_VALUE_0"                 = "false"
        "GIT_CONFIG_KEY_1"                   = "core.hooksPath"
        "GIT_CONFIG_VALUE_1"                 = $inertHooks
    }
    # Every name this call disturbs: the ones it strips and the ones it sets.
    # Hashtable lookup is case-insensitive, which is what makes the guarded
    # names match however the caller spelled them.
    $saved = @{}
    foreach ($item in Get-ChildItem Env:) {
        if ($item.Name -match "^GIT_" -or $guard.Contains($item.Name)) { $saved[$item.Name] = $item.Value }
    }
    try {
        foreach ($name in @($saved.Keys)) { Remove-Item -LiteralPath ("Env:\" + $name) -ErrorAction SilentlyContinue }
        foreach ($name in @($guard.Keys)) { Set-Item -LiteralPath ("Env:\" + $name) -Value $guard[$name] }
        $output = & $GitExe @all 2>&1
        $code = $LASTEXITCODE
    }
    finally {
        foreach ($name in @($guard.Keys)) { Remove-Item -LiteralPath ("Env:\" + $name) -ErrorAction SilentlyContinue }
        foreach ($name in @($saved.Keys)) { Set-Item -LiteralPath ("Env:\" + $name) -Value $saved[$name] }
    }
    return @{ Code = $code; Output = @($output | ForEach-Object { [string]$_ }) }
}

# The paths an upstream commit writes into THIS machine's own coordinator
# directory, which is the inbound half of the machine axis. Both readers of
# that question call this one function: the sync runner, which refuses the
# intake before the rebase, and the doctor, which names the paths and the
# commit for the operator who has to repair the remote, so the runner's refusal
# and the report about it cannot answer differently.
#
# The read is diff-shaped rather than tree-shaped, which is the whole point.
# The allowlist screen reads every entry the upstream tree holds, so it cannot
# see WHICH entries an incoming commit changes, and every machine's own
# coordinator directory is present in every tree; only the difference between
# the merge base and the incoming commit says what the rebase would rewrite.
# --diff-filter=ACDMRT names every change to a path (a deletion included; a
# deletion of this machine's board is a write to it), leaving out only the
# unmerged and unknown states a two-commit diff does not produce.
#
# --no-renames is what makes that promise hold for a move. With git's default
# rename detection on, a rename is one entry and --name-only prints its
# destination alone, so an upstream commit moving this machine's board out to
# any other path, which is a deletion of the board, would be read as a write to
# the destination and nothing else. The R in the filter admits that single
# entry rather than restoring the source path. Turned off, the move is a
# deletion and an addition, and the deletion names the path this machine owns.
#
# The filtering happens here in PowerShell rather than through a git pathspec
# on purpose: git folds a pathspec's case wherever core.ignorecase is set, so a
# pathspec would make the machine comparison git's configuration rather than
# this predicate's rule.
#
# Ok is false when the question could not be answered at all: an unresolvable
# merge base (unrelated histories, a ref that does not exist), a diff that
# failed, an undecodable path, or a machine name that read blank. The caller
# treats that as unproven and retries rather than as a clean answer, because a
# read that could not run says nothing about what the incoming commit writes.
function Get-MemorySyncInboundForeignPaths {
    param(
        [Parameter(Mandatory = $true)][string]$StoreRoot,
        [Parameter(Mandatory = $true)][string]$Ref,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Machine,
        [string]$GitExe = "git"
    )
    $answer = @{ Ok = $false; Paths = @() }
    if ($Machine.Trim() -eq "") { return $answer }
    # The incoming ref is a caller's string reaching a git argument list, so it
    # is held to the same object-id shape as the merge base this function
    # resolves below, at the boundary rather than at the call sites: this is the
    # one read both the runner and the doctor share, and a ref shaped like an
    # option or a revision expression is not an answerable question here.
    if ($Ref -cnotmatch $script:MemorySyncObjectIdPattern) { return $answer }
    $baseRes = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("merge-base", "HEAD", $Ref) -GitExe $GitExe
    $base = if ($baseRes.Output.Count -gt 0) { ([string]$baseRes.Output[-1]).Trim() } else { "" }
    # Fail closed on anything that is not a real object id, the same reading the
    # runner makes of the upstream sha: a nonzero exit, an empty line, or git
    # noise on the merged stream would otherwise become a revision argument.
    if ($baseRes.Code -ne 0 -or $base -cnotmatch $script:MemorySyncObjectIdPattern) { return $answer }
    # core.quotePath=false for the same reason every other path-reading probe
    # here asks for it: a path holding non-ASCII bytes arrives as itself rather
    # than octal-escaped inside double quotes, so an ordinary accented memory
    # file is read as the path it is. A non-ASCII machine segment is unverified
    # end to end, since the funnel decodes git's output in the console code
    # page under Windows PowerShell 5.1.
    $diff = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @(
        "-c", "core.quotePath=false", "diff", "--name-only", "--no-renames", "--diff-filter=ACDMRT", $base, $Ref, "--") -GitExe $GitExe
    if ($diff.Code -ne 0) { return $answer }
    $paths = @()
    foreach ($line in $diff.Output) {
        $candidate = ([string]$line).TrimEnd("`r", "`n")
        if ($candidate.Trim() -eq "") { continue }
        if ($candidate.StartsWith('"')) {
            # A quoted path arriving despite the setting above cannot be decoded
            # back to the path it names, so the whole read is unproven rather
            # than a list missing an entry it could not classify.
            return @{ Ok = $false; Paths = @() }
        }
        if (Test-MemorySyncCoordinatorPathIsOwn -RelativePath $candidate -Machine $Machine) { $paths += $candidate }
    }
    return @{ Ok = $true; Paths = @($paths) }
}

# The store root's sync state, as data for the caller to report on: whether
# git is usable, whether the root is a repo, what the two managed files hold,
# and, inside a repo, the four direct probes.
#
# Outside a repo the probes cannot run at all (check-ignore, dry-run add,
# ls-files, and rev-list all require one), so ProbesRan stays false and the
# probe results stay empty. That is the state a fresh machine is in, and it is
# reported as work to do rather than as a passing allowlist.
#
# ProbesAttempted and ProbesAnswered count the four leak probes, so a caller
# can say how much of the negative was actually proven. An empty result set
# means nothing on its own: it reads identically whether a probe found nothing
# or never ran.
#
# Dirty is a fifth, separate fact from the four leak probes: whether the
# worktree holds a change under the allowlist that has not been committed yet
# (a memory the session wrote this run, most commonly). It is not folded into
# ProbesAttempted/ProbesAnswered, because those count how much of the security
# negative was proven and Dirty proves nothing about leaks; a git status call
# that fails leaves Dirty false rather than marking the whole status unproven,
# the same fail-quiet posture the session hook's own sync trigger
# takes on the identical git call. `--untracked-files=all` is what keeps
# DirtyCount an exact file count rather than one line for a whole new
# untracked directory, which git's default porcelain output would collapse to.
function Get-MemorySyncStatus {
    param(
        [Parameter(Mandatory = $true)][string]$StoreRoot,
        [string]$GitExe = "git"
    )
    $status = @{
        StoreRoot     = $StoreRoot
        GitAvailable  = $true
        IsRepo        = $false
        IsOwnRepo     = $false
        IgnoreState   = "Missing"
        AttrState     = "Missing"
        ProbesRan     = $false
        ProbesAttempted = 0
        ProbesAnswered  = 0
        Probed        = @()
        NotIgnored    = @()
        Unexpected    = @()
        Tracked       = @()
        HistoryPaths  = @()
        Remote        = ""
        Branch        = ""
        Detached      = $false
        Upstream      = ""
        # The raw branch.<name>.merge value, which is what git itself compares,
        # and the bare branch name derived from it for the report's prose.
        UpstreamMergeRef = ""
        UpstreamBranch = ""
        # git's own default since 2.0, which is what an unset push.default
        # means, so the unread and the unset states read alike here.
        PushDefault   = "simple"
        RemoteBranches = @()
        RemoteBranchesRead = $false
        DestinationRead = $false
        Dirty         = $false
        DirtyKnown    = $false
        DirtyCount    = 0
        Notes         = @()
    }

    if ($null -eq (Get-Command $GitExe -ErrorAction SilentlyContinue)) {
        $status.GitAvailable = $false
        return $status
    }
    if (-not (Test-Path -LiteralPath $StoreRoot -PathType Container)) {
        $status.Notes += "$StoreRoot does not exist."
        return $status
    }

    $status.IgnoreState = Get-MemorySyncFileState -Path (Join-Path $StoreRoot ".gitignore") -Expected (Get-MemorySyncIgnoreText)
    $status.AttrState = Get-MemorySyncFileState -Path (Join-Path $StoreRoot ".gitattributes") -Expected (Get-MemorySyncAttributesText)

    # A .git directory in the root itself, never one inherited from a parent:
    # rev-parse --is-inside-work-tree would answer true for a store root that
    # happens to sit inside somebody else's checkout.
    if (-not (Test-Path -LiteralPath (Join-Path $StoreRoot ".git"))) { return $status }
    $status.IsRepo = $true
    $status.IsOwnRepo = Test-MemorySyncRepoIsOwn -StoreRoot $StoreRoot -GitExe $GitExe

    $remote = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("remote", "get-url", "origin") -GitExe $GitExe
    if ($remote.Code -eq 0 -and $remote.Output.Count -gt 0) { $status.Remote = $remote.Output[0].Trim() }

    # Where a push from this machine would actually land. The allowlist proves
    # what may be published; this proves there is anywhere to publish it to. A
    # store passes every leak probe above and still replicates nowhere when it
    # has no remote, when its branch tracks nothing, or when origin carries a
    # branch name this machine does not track. The last is the silent one: both
    # the pull and the push succeed, neither reports anything, and no machine
    # ever sees another's memories.
    #
    # Every read here is of a local ref, so the answer costs no network and is
    # as of the last fetch, which is a limit the report states rather than hides.
    $branch = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("rev-parse", "--abbrev-ref", "HEAD") -GitExe $GitExe
    if ($branch.Code -eq 0 -and $branch.Output.Count -gt 0) {
        $status.DestinationRead = $true
        # A detached HEAD answers with the literal string rather than failing,
        # so the name is only a branch when it is not that string.
        if ($branch.Output[0].Trim() -eq "HEAD") { $status.Detached = $true }
        else { $status.Branch = $branch.Output[0].Trim() }
    }

    # No upstream exits nonzero, which is the answer "this branch tracks
    # nothing" rather than a failure to read, so it is recorded as data and
    # never as an unproven probe.
    $upstream = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}") -GitExe $GitExe
    if ($upstream.Code -eq 0 -and $upstream.Output.Count -gt 0) { $status.Upstream = $upstream.Output[0].Trim() }

    # What a bare push, which is what the sync runner issues, does with this
    # branch's pair of names. The value decides everything from a fatal refusal
    # to a push that succeeds while publishing nothing, so the setting is part
    # of whether the destination is reachable at all rather than a formatting
    # detail of the report. It is kept as configured, uppercase and all, because
    # git parses it byte-exactly and rejects a value it does not recognize.
    $pushDefault = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("config", "--get", "push.default") -GitExe $GitExe
    if ($pushDefault.Code -eq 0 -and $pushDefault.Output.Count -gt 0 -and $pushDefault.Output[0].Trim() -ne "") {
        $status.PushDefault = $pushDefault.Output[0].Trim()
    }

    # The ref git compares the local branch against. It is kept raw, because
    # git's own comparison is byte-exact against the configured value: a short
    # form (`merge = main`) and a differently-cased ref are both refusals that a
    # normalized copy would hide. The bare branch name is derived from it for
    # the report's prose, and needs no remote-prefix parsing, so it stays right
    # for a branch name that itself contains a slash.
    if ($status.Branch -ne "" -and $status.Upstream -ne "") {
        $merge = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("config", "--get", "branch.$($status.Branch).merge") -GitExe $GitExe
        if ($merge.Code -eq 0 -and $merge.Output.Count -gt 0) {
            $status.UpstreamMergeRef = $merge.Output[0].Trim()
            $status.UpstreamBranch = ($status.UpstreamMergeRef -replace "^refs/heads/", "")
        }
    }

    # refname:short renders refs/remotes/origin/HEAD as the bare remote name,
    # so both that and the unshortened form are dropped: neither is a branch,
    # and counting either as one reports a divergence on a healthy store.
    $remoteRefs = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin") -GitExe $GitExe
    if ($remoteRefs.Code -eq 0) {
        $status.RemoteBranchesRead = $true
        $status.RemoteBranches = @($remoteRefs.Output |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ -ne "" -and $_ -ne "origin" -and $_ -ne "origin/HEAD" })
    }

    $dirty = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("status", "--porcelain", "--untracked-files=all") -GitExe $GitExe
    if ($dirty.Code -eq 0) {
        $status.DirtyKnown = $true
        $dirtyLines = @($dirty.Output | Where-Object { $_.Trim() -ne "" })
        $status.DirtyCount = $dirtyLines.Count
        $status.Dirty = $dirtyLines.Count -gt 0
    }

    $status.ProbesRan = $true
    $status.ProbesAttempted += 1
    $ignoreProbeOk = $true
    foreach ($probe in (Get-MemorySyncProbePaths -StoreRoot $StoreRoot)) {
        $status.Probed += $probe
        # --no-index asks what the ignore rules say, independently of the
        # index, because check-ignore otherwise answers "not ignored" for a
        # tracked file and would blame the rules for what the ls-files probe
        # below is the one to report.
        $result = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("check-ignore", "-q", "--no-index", "--", $probe) -GitExe $GitExe
        # 0 is ignored and 1 is not ignored; anything else is git failing to
        # answer, which is not the same as a path being staged and is reported
        # as its own note so it can never read as a clean probe.
        if ($result.Code -eq 1) { $status.NotIgnored += $probe }
        elseif ($result.Code -ne 0) {
            $status.ProbesRan = $false
            $ignoreProbeOk = $false
            $status.Notes += ("git check-ignore failed for ${probe}: " + ($result.Output -join " "))
        }
    }
    if ($ignoreProbeOk) { $status.ProbesAnswered += 1 }

    $status.ProbesAttempted += 1
    $dryRunOk = $true
    $dryRun = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("add", "-A", "--dry-run") -GitExe $GitExe
    if ($dryRun.Code -ne 0) {
        $status.ProbesRan = $false
        $dryRunOk = $false
        $status.Notes += ("git add --dry-run failed: " + ($dryRun.Output -join " "))
    }
    else {
        foreach ($line in $dryRun.Output) {
            # Lines read: add 'path' / remove 'path'.
            if ($line -match "^\s*\w+\s+'(.+)'\s*$") {
                $candidate = $Matches[1]
                if ($candidate.StartsWith('"')) {
                    # A backstop. This form of the command prints a path
                    # verbatim inside the single quotes, so a quotepath-encoded
                    # path is not expected here; were one to arrive, it could
                    # not be decoded back to the path it names, and calling an
                    # ordinary unicode-named memory file a leak is the wrong
                    # answer, so it reports as unproven.
                    $status.ProbesRan = $false
                    $dryRunOk = $false
                    $status.Notes += ("Unreadable git add --dry-run path: " + $candidate)
                    continue
                }
                if (-not (Test-MemorySyncPathAllowed -RelativePath $candidate)) { $status.Unexpected += $candidate }
            }
            elseif ($line.Trim() -ne "") {
                # A line in a shape this probe cannot read is unproven, never
                # assumed harmless: a leak probe with a silent-drop branch is
                # not a probe.
                $status.ProbesRan = $false
                $dryRunOk = $false
                $status.Notes += ("Unreadable git add --dry-run line: " + $line)
            }
        }
    }
    if ($dryRunOk) { $status.ProbesAnswered += 1 }

    # core.quotePath=false makes ls-files print a path holding non-ASCII bytes
    # as itself rather than octal-escaped inside double quotes. Without it an
    # ordinary memory file whose name carries an accent reads as a path outside
    # the allowlist, which is a permanent wrong FAIL carrying a remedy naming a
    # literal that does not exist.
    $status.ProbesAttempted += 1
    $trackedOk = $true
    $tracked = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments (Get-MemorySyncLsFilesArguments) -GitExe $GitExe
    if ($tracked.Code -ne 0) {
        $status.ProbesRan = $false
        $trackedOk = $false
        $status.Notes += ("git ls-files failed: " + ($tracked.Output -join " "))
    }
    else {
        foreach ($line in $tracked.Output) {
            $candidate = ([string]$line).Trim()
            if ($candidate -eq "") { continue }
            if ($candidate.StartsWith('"')) {
                # A backstop for a quoted path arriving despite the setting
                # above. It cannot be decoded back to the path it names, so it
                # is unproven rather than assumed either way.
                $status.ProbesRan = $false
                $trackedOk = $false
                $status.Notes += ("Unreadable git ls-files path: " + $candidate)
                continue
            }
            # A tracked path is staged regardless of the ignore rules, which is
            # why this probe exists beside the two that read them.
            if (-not (Test-MemorySyncPathAllowed -RelativePath $candidate)) { $status.Tracked += $candidate }
        }
    }
    if ($trackedOk) { $status.ProbesAnswered += 1 }

    # Committed history, which none of the three probes above can see. A blob
    # that reached a commit stays reachable after the path is untracked, so a
    # repository can read clean on the rules, the worktree, and the index while
    # still holding a credential that a push would publish.
    #
    # The reachable object graph is the surface, not the per-commit diffs: a
    # merge commit lists no file names under git log's default --diff-merges=off,
    # so a blob introduced only during a merge resolution is reachable from a
    # ref, would be published by a push, and appears in no log output at all.
    # rev-list walks objects instead of diffs and cannot miss it. The blob
    # filter is what keeps the output to paths that name a file: without it,
    # rev-list also emits the tree entry for every directory, and a bare
    # directory name is not a path this allowlist admits, so a clean repository
    # would read as a leak. Lines carry an object id, then a space, then the
    # path; a line that is an id alone is a commit object and names no path.
    #
    # A repository with no commits yet emits nothing at exit 0, which is a
    # clean result rather than a failure.
    $status.ProbesAttempted += 1
    $historyOk = $true
    # Scoped to local pushable refs (branches and tags) rather than --all: the
    # outbound leak check is about what THIS store would publish, and --all also
    # spans refs/remotes, so a disallowed path a peer pushed and this store
    # merely fetched (and refused) would otherwise read as a local leak and
    # wedge the sync under the wrong reason with a remedy that cannot clear it.
    $history = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("rev-list", "--objects", "--branches", "--tags", "--filter=object:type=blob") -GitExe $GitExe
    if ($history.Code -ne 0) {
        $status.ProbesRan = $false
        $historyOk = $false
        $status.Notes += ("git rev-list --filter=object:type=blob failed, so committed history is unproven (the filter needs git 2.32 or newer): " + ($history.Output -join " "))
    }
    else {
        $seen = @{}
        foreach ($line in $history.Output) {
            $trimmed = ([string]$line).TrimEnd()
            if ($trimmed -eq "") { continue }
            $split = $trimmed.IndexOf(' ')
            # An id with no path is a commit or tag object, which names no file.
            if ($split -lt 0) { continue }
            $candidate = $trimmed.Substring($split + 1).Trim()
            if ($candidate -eq "") { continue }
            if ($candidate.StartsWith('"')) {
                # A path holding non-ASCII or control bytes arrives
                # quotepath-encoded, and this probe cannot decode it back to
                # the path it names. An unreadable line is unproven, never
                # assumed harmless: a leak probe with a silent-drop branch is
                # not a probe.
                $status.ProbesRan = $false
                $historyOk = $false
                $status.Notes += ("Unreadable git rev-list path: " + $candidate)
                continue
            }
            if ($seen.ContainsKey($candidate)) { continue }
            $seen[$candidate] = $true
            if (-not (Test-MemorySyncPathAllowed -RelativePath $candidate)) { $status.HistoryPaths += $candidate }
        }
    }
    if ($historyOk) { $status.ProbesAnswered += 1 }

    return $status
}

# Bring the store root to the canonical sync state: initialize the repo when
# it is not one, write each managed file that is missing or has drifted from
# the text above, and commit what the allowlist admits.
#
# Additive only. An existing .git is kept as it stands, and a managed file
# without the marker line is left exactly as found and named in the notes,
# because a file this script did not write is not this script's to replace.
# Writing is UTF-8 without a BOM.
#
# Nothing is staged or committed until both managed files read Canonical and
# the whole index answers to the allowlist. Those two gates are positive: they
# assert the state that makes a commit safe rather than testing the paths by
# which it could be unsafe, so the guarantee does not depend on which branch
# above reached them, and an already-tracked file that predates the allowlist
# blocks the commit instead of riding into it. The index gate runs before the
# add as well as after it, and a refusal after the add restores the index to
# the tree it held before, so no refusal leaves a disallowed path staged in a
# repository the operator may be about to give a remote.
#
# A third gate reads the staged paths rather than the index: the coordinator
# tier is one directory per machine, and a commit here carries this machine's
# own directory alone, so a staged path under another machine's coordinator
# directory refuses the commit and returns the index the same way.
#
# An empty commit is not an error. A store whose tiers hold nothing yet (the
# operator tier before it exists, a fresh machine) legitimately stages
# nothing beyond the two managed files, and reporting that as a failure would
# turn a correct initialization into a red check.
function Install-MemorySyncRepo {
    param(
        [Parameter(Mandatory = $true)][string]$StoreRoot,
        [string]$GitExe = "git"
    )
    $notes = @()
    if ($null -eq (Get-Command $GitExe -ErrorAction SilentlyContinue)) {
        return @{ Ok = $false; Notes = @("git is not on PATH, so the memory sync repo cannot be initialized.") }
    }
    if (-not (Test-Path -LiteralPath $StoreRoot -PathType Container)) {
        return @{ Ok = $false; Notes = @("$StoreRoot does not exist, so there is no store to sync.") }
    }

    if (-not (Test-Path -LiteralPath (Join-Path $StoreRoot ".git"))) {
        $init = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("init", "--quiet") -GitExe $GitExe
        if ($init.Code -ne 0) {
            return @{ Ok = $false; Notes = @("git init failed in ${StoreRoot}: " + ($init.Output -join " ")) }
        }
        $notes += "Initialized $StoreRoot as a git repository."
    }
    elseif (-not (Test-MemorySyncRepoIsOwn -StoreRoot $StoreRoot -GitExe $GitExe)) {
        # Somebody else's repository at the store root: report it and stop
        # before writing a file, staging anything, or making a commit in it.
        $note = "$StoreRoot is already a git repository that the doctor did not create, and it carries no doctor-written .gitignore."
        $remote = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("remote", "get-url", "origin") -GitExe $GitExe
        if ($remote.Code -eq 0 -and $remote.Output.Count -gt 0) { $note += " Its origin is " + (Get-RedactedRemote $remote.Output[0].Trim()) + "." }
        return @{ Ok = $true; Notes = @($note, "Nothing was written, staged, or committed there.") }
    }

    # The repository is the doctor's own from here on, so record that as a git
    # config key. It is written on every repair, which is what gives a
    # repository recognized only by its marker-bearing .gitignore evidence that
    # survives that file's deletion.
    $mark = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("config", "--local", $script:MemorySyncOwnKey, $script:MemorySyncOwnValue) -GitExe $GitExe
    if ($mark.Code -ne 0) {
        $notes += ("Could not record the ownership marker (git config $script:MemorySyncOwnKey): " + ($mark.Output -join " "))
    }

    $utf8 = New-Object System.Text.UTF8Encoding($false)
    foreach ($managed in (Get-MemorySyncManagedFiles)) {
        $path = Join-Path $StoreRoot $managed.Name
        $state = Get-MemorySyncFileState -Path $path -Expected $managed.Text
        switch ($state) {
            "Canonical" { }
            "Foreign" {
                $notes += ("$($managed.Name) exists and was not written by the doctor; leaving it untouched.")
            }
            default {
                try { [System.IO.File]::WriteAllText($path, $managed.Text, $utf8) }
                catch { return @{ Ok = $false; Notes = ($notes + @("Could not write ${path}: $($_.Exception.Message)")) } }
                $notes += if ($state -eq "Drift") { "Restored the canonical $($managed.Name)." } else { "Wrote $($managed.Name)." }
            }
        }
    }

    # Both managed files must read Canonical on disk right now. Anything else
    # means the rules that would govern the add are not the rules this script
    # derives, so nothing is staged and nothing is committed.
    foreach ($managed in (Get-MemorySyncManagedFiles)) {
        $state = Get-MemorySyncFileState -Path (Join-Path $StoreRoot $managed.Name) -Expected $managed.Text
        if ($state -ne "Canonical") {
            return @{ Ok = $false; Notes = ($notes + @(
                "$($managed.Name) in $StoreRoot does not hold the canonical allowlist (it reads as $state), so the rules governing an add here are not the doctor's.",
                "Nothing was staged or committed. The store root holds .credentials.json, settings.json, history.jsonl, and every session transcript.")) }
        }
    }

    # The whole index, not the staged difference: a file tracked before the
    # allowlist existed is unmodified, so it appears in ls-files and in no
    # diff, and a commit would carry it forward untouched. The index is left
    # exactly as it stands; untracking somebody's file is the operator's call.
    $indexGate = {
        $indexed = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments (Get-MemorySyncLsFilesArguments) -GitExe $GitExe
        if ($indexed.Code -ne 0) {
            return @("git ls-files failed, so the index could not be checked against the allowlist and nothing was committed: " + ($indexed.Output -join " "))
        }
        $disallowed = @()
        foreach ($line in $indexed.Output) {
            $candidate = ([string]$line).Trim()
            if ($candidate -eq "") { continue }
            if ($candidate.StartsWith('"')) {
                return @("git ls-files returned a path this check cannot read ($candidate), so the index could not be checked against the allowlist and nothing was committed.")
            }
            if (-not (Test-MemorySyncPathAllowed -RelativePath $candidate)) { $disallowed += $candidate }
        }
        if ($disallowed.Count -eq 0) { return @() }
        $named = ($disallowed | Select-Object -First 5) -join ", "
        if ($disallowed.Count -gt 5) { $named += " (and $($disallowed.Count - 5) more)" }
        return @(
            "The index in $StoreRoot holds $($disallowed.Count) path(s) the allowlist does not admit, so no commit was made: $named",
            "Untrack them (git rm --cached) and re-run; the doctor removes nothing from an index it did not fill.")
    }

    # Before the add, so the ordinary refusal changes nothing at all.
    $preAdd = & $indexGate
    if ($preAdd.Count -gt 0) {
        return @{ Ok = $false; Notes = ($notes + $preAdd + @("Nothing was staged; the index is exactly as it was found.")) }
    }

    # The index as a tree object, so a refusal after the add can put it back
    # exactly. An empty index writes the empty tree rather than failing, which
    # is what makes a fresh initialization no special case. Only the index is
    # ever restored: read-tree writes no working file, so nothing on disk is
    # touched by a refusal.
    #
    # The last line of the output, not the first: Invoke-MemorySyncGit returns
    # stdout and stderr merged, so a git warning printed ahead of the tree id
    # is the first line and the id is the last. The value is then held to the
    # object-id shape, the same reading every other revision argument here
    # takes, so noise that reached the last line cannot become a read-tree
    # argument. A value that fails either test leaves $savedTree empty, which
    # makes the closure below report that the staging could not be restored
    # rather than claim a restore that did not happen.
    $savedTree = ""
    $writeTree = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("write-tree") -GitExe $GitExe
    if ($writeTree.Code -eq 0 -and $writeTree.Output.Count -gt 0) {
        $written = ([string]$writeTree.Output[-1]).Trim()
        if ($written -cmatch $script:MemorySyncObjectIdPattern) { $savedTree = $written }
    }

    # The restore itself, and the sentence that reports it. Every refusal from
    # the post-add gate below down to the commit returns through this, so none
    # of them leaves the add's staging behind for the operator to find and
    # unstage: one path back to the saved tree means a refusal added among them
    # later inherits it rather than reimplementing it.
    #
    # The two returns outside that stretch keep their staging deliberately. A
    # failed `git add` is a git failure rather than a judgment about the
    # content, and what it staged before failing is the operator's to inspect.
    # A failed `git commit` is reached only after every gate has admitted the
    # index, so what sits staged there has cleared the allowlist and the machine
    # axis and is genuine pending work the next run re-adds and commits.
    $restoreIndex = {
        $restored = "The staged paths could not be restored, so the index still holds what the add staged; nothing was committed."
        if ($savedTree -ne "") {
            $readTree = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("read-tree", $savedTree) -GitExe $GitExe
            if ($readTree.Code -eq 0) { $restored = "The index was returned to what it held before this run; no file on disk was changed and nothing was committed." }
            else { $restored += " (git read-tree: " + ($readTree.Output -join " ") + ")" }
        }
        return $restored
    }

    $add = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("add", "-A") -GitExe $GitExe
    if ($add.Code -ne 0) {
        return @{ Ok = $false; Notes = ($notes + @("git add failed: " + ($add.Output -join " "))) }
    }
    # And after it, because what the commit would carry is the index the add
    # produced, not the one it started from. A disallowed path reaching the
    # index here is one an add pulled in, so the index goes back to what it
    # held before rather than being left for the operator to unstage.
    $postAdd = & $indexGate
    if ($postAdd.Count -gt 0) {
        return @{ Ok = $false; Notes = ($notes + $postAdd + @((& $restoreIndex))) }
    }

    # --name-only rather than --quiet's bare exit code, so the same call
    # answers both "is there anything to commit" and "how many paths", which
    # is what lets the final note say a real count instead of a fixed
    # sentence. This is also what makes a healthy, canonical repo with
    # uncommitted memory-tier changes reach a commit at all: the caller may
    # invoke this function with both managed files already Canonical, purely
    # because the worktree is dirty, and the count is the only way the note
    # distinguishes "committed pending changes" from the repair notes above it
    # in the same list.
    # core.quotePath=false is set so that a staged path holding non-ASCII bytes
    # can read as itself rather than octal-escaped inside double quotes, and the
    # machine axis below can classify an accented coordinator file by its real
    # segments instead of refusing this machine's own file as another's. A
    # non-ASCII machine segment is unverified end to end, since the funnel
    # decodes git's output in the console code page under Windows PowerShell
    # 5.1; Windows computer names are ASCII in practice.
    #
    # --no-renames so a staged move is two entries, its deletion and its
    # addition, rather than the one entry rename detection produces, whose
    # --name-only rendering names the destination alone. A deletion under a
    # peer machine's coordinator directory paired with a similar-content
    # addition under this machine's own is exactly the shape that pairs, and
    # the machine axis below has to see the deleted path to refuse it.
    $stagedNames = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("-c", "core.quotePath=false", "diff", "--cached", "--name-only", "--no-renames") -GitExe $GitExe
    if ($stagedNames.Code -ne 0) {
        # The first element is parenthesized whole: a comma binds tighter than
        # the + that builds it, so an unparenthesized concatenation would take
        # the element after it as the right operand and the two notes would
        # reach the caller as one line, which the doctor then truncates.
        return @{ Ok = $false; Notes = ($notes + @(
            ("git diff --cached --name-only failed, so what would be committed could not be counted: " + ($stagedNames.Output -join " ")),
            (& $restoreIndex))) }
    }
    $staged = @($stagedNames.Output | ForEach-Object { ([string]$_).TrimEnd("`r", "`n") } | Where-Object { $_.Trim() -ne "" })
    $stagedCount = $staged.Count

    # The machine axis, over the paths the add staged and never over the whole
    # index. The coordinator tier is one directory per machine and every synced
    # machine's directory is tracked here, so a whole-index reading would call
    # every peer machine's files foreign on every run; those files are tracked
    # and unmodified, so they appear in ls-files and in no staged diff, which is
    # exactly what makes the staged list the right surface. What a staged
    # coordinator path under another machine's directory means is that this
    # machine wrote into a directory whose single-writer contract it does not
    # hold, and the commit would publish that write to every machine.
    #
    # A staged deletion counts: deleting another machine's board is a write to
    # it, and the staged list names a deleted path exactly as it names a
    # modified one, so nothing here filters the list to paths that still exist.
    #
    # The refusal is the post-add gate's: the index goes back to the tree it
    # held before the add, no file on disk is touched, and the result carries
    # the fixed reason code the sync runner records in place of its generic
    # commit-failed transient.
    $machine = ""
    try { $machine = [string](Get-MemorySyncMachineName) } catch { $machine = "" }
    if ($machine.Trim() -eq "") {
        return @{ Ok = $false; Notes = ($notes + @(
            "This machine's own name could not be read, so a staged coordinator path could not be told from another machine's and nothing was committed.",
            (& $restoreIndex))) }
    }
    $foreign = @()
    foreach ($candidate in $staged) {
        if ($candidate.StartsWith('"')) {
            # Undecodable despite the setting above: which machine's directory
            # it names cannot be read, and a path this check cannot classify is
            # never assumed to be this machine's own.
            return @{ Ok = $false; Notes = ($notes + @(
                "git diff --cached returned a staged path this check cannot read ($candidate), so nothing was committed.",
                (& $restoreIndex))) }
        }
        # A path is foreign only where it carries a machine segment to judge:
        # coordinator/<machine>/<something>, three segments or more. A file
        # sitting at the tier root, coordinator/<file>, belongs to no machine's
        # directory, so it is outside this axis entirely and stays governed by
        # the allowlist alone, which already decides whether such a form syncs.
        # Refusing it here would stop this store committing anything at all,
        # permanently, over a path no machine owns.
        #
        # The two directions ask different questions of the same predicate, and
        # a path belonging to no machine answers no to both: outbound asks
        # "does this belong to another machine", which is why the segment count
        # is tested here rather than inside the predicate, and inbound asks
        # "does this belong to me", where the predicate's false for a tier-root
        # path is already the right answer and refuses nothing.
        $segments = ($candidate -replace '\\', '/') -split '/'
        if ($segments.Count -ge 3 -and $segments[0] -ieq 'coordinator' -and
            -not (Test-MemorySyncCoordinatorPathIsOwn -RelativePath $candidate -Machine $machine)) {
            $foreign += $candidate
        }
    }
    if ($foreign.Count -gt 0) {
        # The machine segment each offender carries is named beside the paths:
        # the operator's question is which machine's directory this store wrote
        # into, and the second segment is that answer.
        $machines = @($foreign | ForEach-Object { (($_ -replace '\\', '/') -split '/')[1] } | Select-Object -Unique)
        $named = ($foreign | Select-Object -First 5) -join ", "
        if ($foreign.Count -gt 5) { $named += " (and $($foreign.Count - 5) more)" }
        $restored = & $restoreIndex
        return @{
            Ok     = $false
            Reason = 'outbound-foreign-write'
            Notes  = ($notes + @(
                ("The add staged $($foreign.Count) path(s) under a foreign coordinator directory (" + ($machines -join ", ") + "), which only that machine writes: $named"),
                "This machine syncs its own coordinator directory alone. Revert those paths on this machine, or make the change on the machine that owns them.",
                $restored))
        }
    }
    if ($stagedCount -eq 0) {
        $notes += "Nothing to commit; the repository already holds the current memory tiers and coordinator directory."
        return @{ Ok = $true; Notes = $notes }
    }
    $commit = Invoke-MemorySyncGit -StoreRoot $StoreRoot -Arguments @("commit", "--quiet", "-m", "kit memory sync: allowlist, memory tiers, and coordinator directory") -GitExe $GitExe
    if ($commit.Code -ne 0) {
        return @{ Ok = $false; Notes = ($notes + @("git commit failed: " + ($commit.Output -join " "))) }
    }
    $notes += ("Committed " + $stagedCount + " pending change(s) admitted by the allowlist.")
    # The commit's other half is said rather than left to inference, but it is
    # said by the doctor's healthy report branch and not here. Two reasons the
    # note cannot live in this function. This function has a second caller, the
    # sync runner (sync-store.ps1), whose own run does push, so a note asserting
    # otherwise would be false in that context. And the doctor prepends these
    # notes to every report branch it emits, including the one that FAILs
    # because a non-memory blob is reachable in committed history, where a
    # ready-made push recipe is precisely the act the report exists to stop.
    return @{ Ok = $true; Notes = $notes }
}
