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

The engine repo (this one) contains the `template/` tree, the five operator
scripts, the plugin-level `wiki-new` skill, six KB tests, a plugin manifest,
and this `docs/` library. `new-kb.ps1` copies the template.
`kb-create.ps1` creates a KB, `kb-trust.ps1` trusts it and `kb-registry.ps1`
lists it. `register-task.ps1` registers a KB's scheduled tasks. `tests/Test-KbRegistry.ps1` drives the list script, and
`tests/Test-KbCreate.ps1` drives creation, trust and the commit helper's
no-remote case against a stub in place of `claude`. `tests/Test-KbStructure.ps1` checks a KB's structure
and permission allowlist. `tests/Test-FeedInbox.ps1` drives the feeder and the
registrar's Feed operation against a throwaway repository and KB.
`tests/Test-ReconcileGate.ps1` drives the status helper's liveness read and the
move helper's stamp against a throwaway KB, and checks that the three writing
skills emit the liveness read. `tests/Test-KbRun.ps1` drives the run wrapper
against a stub in place of `claude`. The source
repository also holds the publish job, `.github/workflows/publish.yml`, and its
scripts and their tests under `tools/publish/`. "Publishing to the marketplace"
below covers them. The engine repo is machinery only.

A KB repo is what an operator instantiates from `template/`. It is fully
self-contained: cloning it and opening Claude Code in it brings everything the
KB needs, including the three skills and the permission allowlist. The engine is
vendored (copied) into each KB, not installed as a shared plugin, so no runtime
crosses between KBs and an engine update is a deliberate copy into one specific
KB rather than a change that alters every KB at once. The `wiki@applefeld`
plugin changes how an operator obtains the engine and how a session creates a
KB. It delivers the scripts, the `wiki-new` skill and the template, and each KB
still receives its own copy. None of the five scripts is vendored into a KB,
so a KB's agent can run none of them.

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
    engine.json   the engine version this KB was copied from
    settings.json the permission allowlist
    kb-move.ps1   the only sanctioned inbox-to-sources move
    kb-commit.ps1 the only sanctioned stage/commit/push
    kb-status.ps1 the read-only git status reads the skills need
    kb-run.ps1    the run wrapper holding one lock per KB; granted to no agent
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

`engine.json` holds `templateHash`, a SHA-256 over every file under the
engine's `template/.claude/`, taken as sorted relative paths with their bytes
and with each CRLF read as LF. It also holds `source`, the installed plugin's
version or the engine checkout's short commit, and `copiedAt`. The hash names
the vendored machinery only, never the schema or the content, and
`new-kb.ps1 -PrintEngineHash` prints the engine's current value to compare
against. The file sits under `.claude/`, which the agent cannot write.
`tests/Test-KbStructure.ps1 -RequireSchema` requires it.

## Creation and the wiki list

A session creates a KB through the plugin's `wiki-new` skill. The skill
gathers a name, a description and an optional remote URL, then runs
`kb-create.ps1`, which runs five steps in order, each a separate process:

1. `kb-registry.ps1 Init -Root <root>`, only where the account has no list
   yet.
2. `new-kb.ps1`: the template copied to `<root>\<name>`, the version mark
   written, the first commit made.
3. `kb-trust.ps1`: the folder trusted, as the trust gate below describes.
4. `git remote add origin` and `git push -u origin main`, only where a remote
   was given.
5. `kb-registry.ps1 Add`: the KB listed.

Each step's refusal stops the run with that step's own stderr line. A stop
after the copy names the folder for the operator to remove, and a stop from
the trust step on also names the trust entry it may have left. The skill then
fills the three `CUSTOMIZE` blocks from the description and commits
`CLAUDE.md` with git directly, since `kb-commit.ps1` refuses the schema path.

The wiki list is one JSON file per Windows account,
`%LOCALAPPDATA%\llm-wiki\registry.json`, holding the root folder and one entry
per KB with its name, folder, description and the time it was added.
`kb-registry.ps1` is its only writer. It checks each entry it adds, and each
description it changes, against these rules: a name of 1 to
64 ASCII letters, digits, hyphens, underscores and dots, unique ignoring case;
a folder on a local drive letter, reached through no link, outside every
listed KB, and holding every file a new KB holds except the version mark
`.claude/engine.json`, so a KB made before the mark existed can still be
listed. A writer holds
`registry.lock`, a sibling file opened with no sharing, from its read of the
list through its move, so two writers never act on the same read. Each write
goes to a temporary file in the same folder and moves over the list, so a
killed writer leaves the previous list whole. Readers take no lock. `List`
prints one tab-separated line per KB: name, folder, the first eight
characters of its engine hash or `unknown`, and description. The list lives
in one account's profile, so it can never route a document across the
account boundary between entities.

## The four operations and their shared discipline

Three skills implement the operations, and a fourth commit subject
(`Reconcile:`) recovers interrupted work. Every operation that writes shares one
discipline.

**Ingest** (`wiki-ingest`) is the core operation, written for unattended
headless execution. It snapshots `inbox/` once at run start (files arriving
mid-run wait for the next run), and for each source in order it reads the file,
moves the original to `sources/`, writes a per-source summary page, revises the
handful of wiki pages the source genuinely touches, updates `index.md`, appends
a `log.md` entry, and makes exactly one commit. It pushes once at run end, and
a KB with no remote named `origin` pushes nothing. An
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
page, and the next lint pass catches what that leaves. A run outside the run
lock, described in the next paragraph, has this read as its only guard. Two such
runs that each make their last check before the other's first write can each see
a clean tree and both write. For an ingest, that window opens after each
source's commit, since the tree is clean between sources, so a lint whose write
pass starts in that gap sees nothing to yield to. A run that writes nothing for
thirty minutes reads as finished to a run outside the lock, so its half-written
page can be recovered by that run. Every commit subject is prefixed (`Ingest:`,
`Lint:`, `Query:`, `Reconcile:`) so each operation is findable on its own in
`git log`.

**The run lock.** An ingest or lint run through the wrapper, `pwsh -NoProfile
-File .claude/kb-run.ps1 -Operation Ingest` or `-Operation Lint`, holds the
knowledge base's run lock for the whole run. An operator's hand run takes it,
and so would any task whose action is that command. Without `-Claude <path>` the
wrapper runs the first `claude` on PATH, and it stops with one stderr line where
PATH holds none. The lock is a handle on `.git/kb-run.lock` that the wrapper's
own process holds open with no sharing. The file itself stays after every run,
and only the open handle is the lock. Windows releases the handle when the
wrapper's process ends, so a crashed wrapper leaves no lock behind. A second run
through the wrapper that finds the lock held prints one line on stdout, writes
nothing and exits 0. Task Scheduler records that as a successful run, and the
stdout line is the only sign it skipped. A run that takes the lock exits with
its `claude` child's exit code, and the child writes straight to the wrapper's
stdout and stderr. Where `.git` under the knowledge base is not a folder, as in
a clone whose `.git` is a file, the lock cannot be taken, and the wrapper exits
1 with one stderr line. With `-WhatIf` the wrapper takes no lock and runs
nothing, and prints the one command it would run. No permission rule grants the
wrapper, so the agent cannot start one. The wrapper bounds its `claude` child
with a budget of 6900 seconds, which `KB_RUN_SECONDS` replaces as a whole number
of seconds from 1 to 99999. Any other value exits 1 with one stderr line before
`claude` starts. Past the budget it stops the child's whole process tree with
`taskkill` and exits 1. Where `taskkill` fails, the wrapper ends only the child
itself, so a process the child started can keep running with the lock released.
A process the child leaves running after a normal exit outlives the lock the
same way. `taskkill` finds a process's descendants through their parent, so a
process whose own parent had exited before the stop is outside the tree and
outlives the lock too. So does a descendant `taskkill` fails to stop while it
stops the child. Task Scheduler's End stops only the wrapper's own process, and
the wrapper then stops nothing. The child keeps running with the lock released,
so a later run can overlap it. The ingest and lint tasks `register-task.ps1`
registers call `claude` directly, so they take no lock. An interactive session
in the knowledge base takes none either. Both are guarded only by the liveness
read above.

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
`wget`, and `ls`. The feeder, `feed-inbox.ps1`, and the run wrapper,
`kb-run.ps1`, are two more scripts in `.claude/` that no allow rule grants, so
no agent runs either. A scheduled task or an operator's hand runs them.

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
prerequisite of automation. Trust is per Windows account and per exact path,
recorded in that account's own `~/.claude.json`, and a folder does not inherit
it from a trusted parent. The `deny` rules, by contrast, hold trusted or not.

`kb-trust.ps1` is the trust writer, and creation runs it on every new KB. It
runs `claude -p "Reply with the single word ok." --model haiku
--permission-mode default` in the KB. In an untrusted folder whose
`settings.json` holds an allow entry, Claude Code prints one stderr line
opening `Ignoring ` that names the exact key it reads, between `projects["`
and `"].hasTrustDialogAccepted`. The writer takes the key from that line and
nowhere else, refuses it unless it names this folder, and sets
`hasTrustDialogAccepted: true` under it through `System.Text.Json.Nodes`.
That keeps every other property, including the empty-named one
`ConvertFrom-Json` cannot hold. It copies the file to
`~/.claude/kb-trust-backup.json` first, writes a temporary file beside the
original and moves it over. It then runs the probe again and succeeds only
where no warning prints, and a third read must still find the key true.

The read through the move runs under Claude Code's own lock on the file, the
folder `~/.claude.json.lock`, which the writer creates with a call that fails
where it exists and removes only where it created it. A live session takes
the same lock for each save, so neither erases the other's change. The writer
never holds the lock across a probe, since each probe is a Claude Code process
that takes it too. It waits up to 10 seconds for a held lock and then refuses,
changing nothing. Once it holds the lock it reads its clock before the backup,
before the move and after each blocked move, and refuses at 3 seconds, well
inside the 10 second age at which Claude Code treats the lock as stale.
Opening Claude Code in the KB once and accepting the dialog remains the hand
path.

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
is its own repository with its own history and, where it has one, its own
`origin`, and the
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
the five operator scripts, the whole `template/` tree, the `skills/` tree
holding `wiki-new`, three KB tests (`tests/Test-KbStructure.ps1`,
`tests/Test-FeedInbox.ps1` and `tests/Test-ReconcileGate.ps1`), and
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
