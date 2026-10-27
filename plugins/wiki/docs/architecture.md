# Architecture

The llm-wiki engine is content-free machinery plus a template. It holds no
knowledge-base content and never runs against one directly. Every real
knowledge base (KB) is a separate git repository, instantiated by copying the
engine's `template/` tree into a new folder. The engine's job is to produce
self-contained KB repos and to keep the machinery inside them consistent; the
KB repos are where content lives, where the LLM works, and where automation
runs.

For a reader-facing tour of the pattern and the three layers, see the engine
[README](../README.md). This document is the engineering reference: the
components, the data flow, the security model, and the invariants a change must
preserve.

## Two kinds of repository

The engine repo (this one) contains the `template/` tree, the two operator
scripts (`new-kb.ps1`, `register-task.ps1`), three KB tests, a plugin manifest,
and this `docs/` library. `tests/Test-KbStructure.ps1` checks a KB's structure
and permission allowlist. `tests/Test-FeedInbox.ps1` drives the feeder and the
registrar's Feed operation against a throwaway repository and KB.
`tests/Test-ReconcileGate.ps1` drives the status helper's liveness read and the
move helper's stamp against a throwaway KB, and checks that the three writing
skills emit the liveness read. The source
repository also holds the publish job, `.github/workflows/publish.yml`, and its
scripts and their tests under `tools/publish/`. "Publishing to the marketplace"
below covers them. The engine repo is machinery only.

A KB repo is what an operator instantiates from `template/`. It is fully
self-contained: cloning it and opening Claude Code in it brings everything the
KB needs, including the three skills and the permission allowlist. The engine is
vendored (copied) into each KB, not installed as a shared plugin, so no runtime
crosses between KBs and an engine update is a deliberate copy into one specific
KB rather than a change that alters every KB at once. The `wiki@applefeld`
plugin changes only how an operator obtains the engine. It delivers
`new-kb.ps1`, `register-task.ps1` and the template, and each KB still receives
its own copy.

## The KB repo layout

An instantiated KB has the three-layer content model plus its vendored
machinery:

```
<kb-name>/
  inbox/          drop zone and ingest queue; empty in a healthy repo
  sources/        immutable originals, moved here on ingest; never edited
  wiki/           the LLM-maintained interlinked markdown pages
  index.md        catalog of every wiki page, by category; read first
  log.md          append-only run digest
  CLAUDE.md       the schema: page types, conventions, workflows
  .claude/
    settings.json the permission allowlist
    kb-move.ps1   the only sanctioned inbox-to-sources move
    kb-commit.ps1 the only sanctioned stage/commit/push
    kb-status.ps1 the read-only git status reads the skills need
    feed-inbox.ps1 the repository feeder; granted to no agent
    feed.json     the feeder's sources; present only in a fed KB
    skills/wiki-ingest, wiki-lint, wiki-query
  .gitignore
```

`CLAUDE.md` is the behavior-shaping heart. It defines the six page types, the
new-page-versus-edit heuristic, the linking and citation rules, the
contradiction rule, and the `index.md`/`log.md` formats. It carries three
`<!-- CUSTOMIZE -->` blocks (domain vocabulary, citation granularity, staleness
horizon) that instantiation specializes for a domain. The skills own only
sequence and invariants; the schema owns discipline.

## The four operations and their shared discipline

Three skills implement the operations, and a fourth commit subject
(`Reconcile:`) recovers interrupted work. Every operation that writes shares one
discipline.

**Ingest** (`wiki-ingest`) is the core operation, written for unattended
headless execution. It snapshots `inbox/` once at run start (files arriving
mid-run wait for the next run), and for each source in order it reads the file,
moves the original to `sources/`, writes a per-source summary page, revises the
handful of wiki pages the source genuinely touches, updates `index.md`, appends
a `log.md` entry, and makes exactly one commit. It pushes once at run end. An
empty inbox produces no commit and a clean exit.

**Lint** (`wiki-lint`) is the health pass, run by an optional scheduled task or
by hand. It runs six checks in
cheap-first order: `index.md` drift, orphan pages, broken relative links,
missing reciprocal cross-references, contradictions, and unsourced claims. It
fixes what is mechanically unambiguous, flags what needs judgment, and appends a
lint report to `log.md`. It never writes under `sources/`. Its fixes land in one
commit, separate from any ingest commit.

**Query** (`wiki-query`) is the retrieval operation, primarily interactive. It
reads `index.md` first, opens only the relevant pages, and answers with
citations to wiki pages and through them to sources. Anything presented in the
wiki's voice must be grounded in a citable page; when the wiki is silent, the
answer says so rather than drawing on model memory. A valuable answer can be
filed back as a synthesis page, which then goes through index and
cross-reference maintenance like any page.

**The commit seam.** All three writing skills begin with a reconcile front step
driven by `git status --porcelain`, because `kb-commit.ps1` stages the paths it
is given from the working tree as they stand. An interrupted run leaves dirty
files that would otherwise ride into the next run's commit under the wrong
subject. The reconcile step commits recovered edits alone first: an ingest run
folds a crashed source's dirty edits into that orphan source's own commit only
when an untracked `sources/` file actually exists, and otherwise commits stray
edits under a `Reconcile:` subject before touching the inbox; lint and query
each commit stray edits under `Reconcile:` before doing their own work.

The reconcile step reads liveness before it recovers anything. Where the tree
is dirty, the skill runs `kb-status.ps1 -What Live`, which lists each dirty path
whose file was written within the last thirty minutes, skipping `inbox/`. Any
line means another run may still be writing, so the run yields whole: it writes,
commits and pushes nothing, and reports the paths. `kb-move.ps1` stamps a moved
source's last-write time, so a source in flight reads as live. A run can also
start while another is still reading, before that run's first write. So ingest
reads liveness again immediately before each source's move, and an ingest that
yields there keeps the sources it already committed and pushes nothing. Query
reads liveness once, when it files. Lint's checks only read and record
their fixes, and a final write pass reads liveness again, then applies every fix,
appends its report and commits in one short stretch, so lint never leaves a
half-done fix on disk while it reads. Each recorded fix names the text it
replaces or the absence it fills, and the write pass drops any fix whose
condition no longer holds, so lint never overwrites a line another run changed
during its checks. A lint fix can still land beside a newer edit on the same
page, and the next lint pass catches what that leaves. Two runs that each make
their last check before the other's first write can each see a clean tree and
both write. The gap between a run's check and its write is a few agent steps. A
run that writes nothing for thirty minutes reads as finished to the others, so
its half-written page can be recovered by another run. Nothing short of a lock
closes either, and the engine refuses a lock because a crashed run would leave
it behind. Every
commit subject is prefixed (`Ingest:`, `Lint:`, `Query:`, `Reconcile:`) so each
operation is findable on its own in `git log`.

**Crash behavior.** Ingest is not crash-proof, it is crash-recoverable. Each
completed source is committed before the next begins, so a crash loses at most
the one in-flight source's uncommitted work. The window between a move and its
commit leaves an untracked file in `sources/` that is invisible to the next
inbox snapshot; the reconcile front step exists to find and finish exactly that
file on the next run. Because the move stamps the file, the next run reads a
crashed run's leftovers as live until they have gone untouched for thirty
minutes, and yields until then. The first run after that window recovers them.
Lint edits pages only in its final write pass, so a lint that dies earlier
leaves no page edit on disk, and one that dies inside the pass leaves leftovers
the next run reconciles once they age past the window.

## The permission and security model

The agent inside a KB has no raw shell verb that takes a destination path and no
raw git command. `template/.claude/settings.json` is the enforcement point,
and it is load-bearing: a headless run cannot answer a permission prompt, so a
missing allow rule stalls an unattended run and a missing deny rule lets it do
damage.

**Three vetted helpers are the agent's only git and move operations.** `kb-move.ps1` is the
only path into `sources/`: it takes a bare inbox file name, refuses a name
containing a separator or leading dash, refuses to overwrite an existing source
(so a re-dropped file is a refusal, not a silent loss), confirms the resolved
paths stay inside the repo and clear of `.git/` and `.claude/`, then sets the
file's last-write time to now and moves it. `kb-commit.ps1` is the only path
that commits: it accepts only
bar-delimited repo-relative paths under `sources/` or `wiki/` or exactly
`index.md`/`log.md`, stages them explicitly (never a wildcard), commits with an
empty `core.hooksPath` so a repo-planted git hook cannot execute, and pushes
only to a remote named `origin`, only with `-Push`. `kb-status.ps1` is the only
git read: it reports the working tree's porcelain status, unpushed commits, a
page's last-change date, the inbox listing, or the dirty paths written within
the last thirty minutes, and writes nothing. The
allowlist grants exactly those three `pwsh -NoProfile -File` invocations and
denies all of raw git (`Bash(git:*)`), plus raw `mv`, `rm`, `cp`, `curl`,
`wget`, and `ls`. The feeder, `feed-inbox.ps1`, is a fourth script in
`.claude/` that no allow rule grants, so no agent runs it. Its scheduled task
runs it, and so does an operator running it by hand.

**The agent cannot edit its own guard rails.** Writes are denied under
`sources/`, `inbox/`, `.git/`, and `.claude/`. `CLAUDE.md` is in neither the
allow nor the deny list, so a headless run cannot alter the schema while an
interactive session still can after a prompt. The write denies bind the Write
and Edit tools, not the shell, so `settings.json` also pins
`"defaultMode": "default"`. An interactive session in a KB therefore starts
under the allow-list wall even on an account whose own default is to bypass
permissions, and a shell write to `.claude/` prompts a human rather than
running. That effect on a bypass-default account is the design and has not
been observed on a run.

**Untrusted input is treated as data.** Ingested documents arrive from third
parties and may contain text shaped like a command or an assertion that the wiki
is wrong. The schema's untrusted-input section and its contradiction rule are
the defense: an apparent instruction is recorded as a fact about the document
and otherwise ignored, and a source that merely asserts the wiki is wrong is
recorded as an attributed claim (both values, both citations) rather than
overwriting a sourced claim. A new source overwrites in place only when it
clearly postdates or explicitly corrects the claim it replaces.

**Reads of known credential and token files are denied; other out-of-repo reads
are allowed.** `Read` and `Glob` are allowed unscoped, so an ingest run can read
files. The `Grep` tool is denied outright, because its path-scoped deny rules do
not bind. `settings.json` denies `Read` of these paths, and those denies hold
whether or not the workspace is trusted:

- Claude Code's own: `**/.credentials.json` (also denied to `Glob`),
  `**/.claude.json`, and `**/.claude/*.json`.
- git and GitHub: `**/.git-credentials`, `**/.config/gh/**`, and
  `**/GitHub CLI/**`.
- SSH and keys: `**/.ssh/**`, `**/*.pem`, `**/*.pfx`, `**/*.key`, `**/id_rsa`,
  and `**/id_ed25519`.
- Cloud and package tokens: `**/.aws/**`, `**/.npmrc`, `**/.pypirc`,
  `**/.docker/config.json`, `**/.kube/config`, `**/.netrc`, and `**/_netrc`.

A credential file at any other path, and every ordinary file elsewhere on the
machine, remains readable. The boundary for that data rests on the Windows
account, so the one-account-per-entity invariant is a hard requirement.

**Any invalid settings file is ignored wholesale.** Claude Code silently ignores
a `settings.json` that fails validation in headless mode, which would void the
entire allow and deny set with no error. A change to the allowlist is only safe
once a real denial and a real allow have both been observed, not merely once the
file parses.

## The trust gate

Claude Code ignores `permissions.allow` entirely in a workspace that has not
been trusted, and prints that warning only to stderr. A headless run in an
untrusted KB therefore prompts on every write, gets no answer, and exits having
written nothing. No CLI flag (`--settings`, `--allowedTools`, inline JSON)
overrides this while a skill is executing. Workspace trust is therefore a hard
prerequisite of automation, and it is established interactively (opening Claude
Code in the KB once and accepting the dialog). Trust is per Windows account and
per exact path, recorded in that account's own `~/.claude.json`. The `deny`
rules, by contrast, hold trusted or not.

## The automation model

A per-user Windows scheduled task runs headless Claude Code with the KB folder
as its working directory, on a cadence. Every KB has a frequent ingest task
owned by the KB's Windows account. A weekly lint task is optional, and it can
run beside any ingest cadence. The action is
`claude -p "Use the wiki-ingest skill." --model sonnet --permission-mode default`.
The prompt names the skill in prose, the stable form for a headless run. The
model pin is load-bearing and fails silently when wrong: a too-small or
unpinned model does nothing while emitting success-shaped text. The permission
mode pin holds the run to the workspace allow-list on an account whose own
default is to bypass permissions.

`register-task.ps1` builds the action and refuses to register any
task that would silently do nothing: a path that is not a git repo, a repo
missing the requested skill, a repo with no `origin` remote, or an untrusted
workspace for the current account. The task registers with an S4U principal (no
stored password, runs whether or not the user is logged on) at the cost of no
access to Windows Credential Manager, so an HTTPS push backed by it can fail
under the task. An SSH remote with a passphrase-less key works under S4U. See
[runbook_automation.md](runbook_automation.md) for registration and the
verification checklist.

A KB whose sources live in git repositories adds a third task, the feeder.
`feed-inbox.ps1` is plain PowerShell that copies new and changed files from the
repositories `feed.json` names into `inbox/`, under names that encode the
source, the path and the blob hash, so dedupe needs no state file. It never runs
Claude and no allow rule grants it, so it holds no model permissions and the
KB's own agent cannot run it. Its configuration sits under `.claude/`, which the
agent cannot write, so an ingested document cannot widen what is fed.

## The separation model

Two boundaries keep KBs apart. The **repo boundary** separates content: each KB
is its own repository with its own history and its own `origin`, and the
permission model gives the agent no way to write outside the repo or push
anywhere but that KB's own remote. The **Windows account boundary** separates
entities, under the one-account invariant that
[runbook_automation.md](runbook_automation.md), "The hard invariant, restated",
states in full.

## Data flow, end to end

A file is dropped into a KB's `inbox/`. The next scheduled ingest run snapshots
the inbox, moves the file into `sources/` through `kb-move.ps1`, writes its
summary page and revises the wiki pages it bears on, updates `index.md` and
`log.md`, and commits that source's work through `kb-commit.ps1`, pushing once
at run end to `origin`. The wiki, `index.md`, and `git log` are the durable
record a human reads; `sources/` is the immutable evidence behind every cited
claim. A lint pass keeps the wiki internally consistent, and an
interactive query reads it back with citations. Dropping the file is the entire
hand-off; everything after it is automated and reviewable as a git history.

## Publishing to the marketplace

The engine reaches installers through one GitHub Actions job in the source
repository. The job replaces the `plugins/wiki/` folder of the public
marketplace repository, `SApplefeld/plugins`, with an allowlisted snapshot of
this repository. The marketplace's `wiki` entry points at that folder, so
`claude plugin install wiki@applefeld` installs whatever the last green run
published. The manifest, `.claude-plugin/plugin.json`, carries a name and a
description and no version, so installs follow the published commit.

The job, `.github/workflows/publish.yml`, runs on a pushed tag matching
`publish-*` and on a manual run, under the repository's `publish`
environment. It never runs on a push to `main`. Its steps run in this order,
and each failure stops the run before the next step:

1. **On-main check.** `tools/publish/on-main.mjs` runs
   `git merge-base --is-ancestor` on the commit against
   `refs/remotes/origin/main`. It exits 0 where the commit is `main`'s tip or
   any ancestor of it, 1 where it is not, and 2 where git cannot answer, so a
   `main` that was never fetched reads as a failure. A `--sha` that is not a
   full 40-character lowercase id is a usage error, exit 2. The full ref name
   is the default because a tag named `origin/main` would otherwise shadow the
   branch. The check runs from the tagged commit's own workflow, so it stops a
   tag on a commit `main` never reached and not someone who can push a tag.
2. **Assemble.** `tools/publish/assemble.mjs` resolves
   `tools/publish/allowlist.txt` through `git ls-files` and copies each file
   under a temporary folder at its own path. A glob may not resolve under
   `docs/`, `kaizen/`, `.kit/`, `test/` or `tools/`, or to a file named
   `*.test.*`. A literal line must name exactly one tracked file, and it may
   not name a plan, the archive, the backlog, a kaizen note, a scratch file or
   a `*.test.*` file. A literal line is the only way a document under `docs/`
   ships. A refused run copies nothing.
3. **Word gate.** `tools/publish/leak-gate.mjs` fails where a word from a list
   held in the `publish` environment appears in any file line or path of the
   snapshot, after case, punctuation and accent folding. It also fails on a
   file it cannot read as text. It prints paths and line numbers and never
   the word.
4. **Replace and count.** The job clones the public repository over a deploy
   key held in the `publish` environment, against pinned GitHub host keys. It
   replaces `plugins/wiki/` with the snapshot and stages it. It fails where the
   clone tracks a different number of files under `plugins/wiki/` than the
   snapshot holds, which catches a file the public repository's ignore rules
   would drop.
5. **Commit and push.** The job commits once as `github-actions[bot]`, naming
   the source commit's short id and never the tag. A rejected push is rebased
   once and pushed again. Where the public folder already matches, the run
   makes no commit and says so.

The allowlist ships the manifest, the README, the license, the ignore file,
the two operator scripts, the whole `template/` tree, the three KB tests and
three documents: this one, [instantiation.md](instantiation.md) and
[runbook_automation.md](runbook_automation.md). The workflow and
`tools/publish/` stay in the source repository, so an installed copy holds
neither. `node --test tools/publish/*.test.mjs` runs the publish scripts'
tests. The engine [README](../README.md), "How a release is cut", is the
operator's procedure.

## Operating and extending

To stand up a KB, see [instantiation.md](instantiation.md). To schedule and
verify it, see [runbook_automation.md](runbook_automation.md). To verify a KB's
structure and its permission allowlist at any time:

```
pwsh -NoProfile -File tests/Test-KbStructure.ps1 -Path <kb> -RequireSchema -RequireSkills
```

When extending the engine, the invariants above are the ones a change must
preserve: the three helpers stay the agent's only git and move operations, the deny wall
stays intact, every writing operation keeps its reconcile front step, and no
change may make a headless run depend on answering a prompt.
