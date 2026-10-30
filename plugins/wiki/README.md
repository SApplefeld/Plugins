# llm-wiki engine

A standalone, content-free engine implementing Karpathy's LLM Wiki pattern
(https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). This repo
holds machinery and a template only. It holds no knowledge-base content, ever:
every real knowledge base lives in its own repo, instantiated from the
`template/` directory here.

## The three-layer architecture

Every knowledge base built from this engine has three layers:

- **`sources/`**: immutable raw originals. A file lands here once, on ingest,
  and is never edited again. If a source needs correcting, a corrected file
  is ingested alongside it; the original stays.
- **`wiki/`**: an LLM-maintained set of interlinked markdown pages: entities,
  concepts, comparisons, overviews, syntheses, and per-source summaries. This
  is the knowledge base a human or a query actually reads.
- **`CLAUDE.md`**: the schema. It defines the page types, the new-page-versus-
  edit heuristic, linking and citation rules, and the maintenance workflows,
  turning the LLM into a disciplined wiki maintainer rather than a chat
  partner that free-associates. The schema is the single most important
  artifact in this whole system. Drift, an LLM quietly diverging from the
  schema's discipline over many runs, is the primary failure mode this engine
  is built to resist.

## The three operations

**Ingest.** A file arrives in `inbox/`. The ingest run reads it, moves the
original to `sources/` (never deleted, never edited again), writes a summary
page for it, and revises the existing wiki pages that source actually touches,
in one pass. It updates `index.md` and appends a `log.md` entry, then commits,
and pushes where the KB has a remote named `origin`.

Designed for unattended, headless execution. Every completed source is
committed before the next one starts, so a crash loses at most the source in
flight. It does not lose that one either: the move into `sources/` happens
before the commit, so a crash in between leaves the file tracked by neither the
inbox nor git, and every ingest run begins by reconciling exactly that state. The same
step recovers a lint or query run that died mid-edit, committing what it
recovered under its own `Reconcile:` subject rather than folding it into a
source's commit. A run that finds a dirty file written within the last thirty
minutes treats it as another run's live work and stops without writing more, so
an ingest and a lint can be scheduled side by side. Two runs that each check
before the other writes can still both write, and a run silent for thirty
minutes reads as finished to the others.
Lint also drops any fix whose target text another run changed while lint was
checking, whose gap another run filled, or whose missing link target
reappeared, so it never writes over that run's edit, though its other fixes to the
same page can land beside it until the next lint checks the result.

**Query.** Given a question, the query operation reads `index.md` first, opens
the relevant pages, and synthesizes an answer with citations back to wiki
pages and, through them, to sources. A valuable answer can optionally be filed
back into the wiki as a synthesis page, at which point it goes through the
same index and cross-reference maintenance as any other page.

**Lint.** The health pass. It detects orphan pages unreachable from
`index.md`, broken relative links, missing reciprocal cross-references,
contradictions between pages (flagged with both citations, auto-resolved only
when one side is clearly superseded by a newer source), stale claims past the
staleness horizon declared in the KB's `CLAUDE.md`, and drift between
`index.md` and the actual page set. Lint fixes land as their own commits,
separate from ingest commits, and never touch `sources/`.

## KB repo anatomy

An instantiated knowledge base has this shape:

```
<kb-name>/
  inbox/          <- drop zone; the ingestion queue; empty in a healthy repo
  sources/        <- immutable originals, moved here on ingest; never edited
  wiki/           <- the LLM-maintained pages (entities, concepts, comparisons, syntheses, per-source summaries)
  index.md        <- catalog of every wiki page with one-line summaries, by category; read first on query
  log.md          <- append-only run digest (ingests, lint passes, queries filed back)
  CLAUDE.md       <- the schema: page types, conventions, workflows; per-KB, specialized over time
  .claude/        <- vendored engine skills (wiki-ingest, wiki-lint, wiki-query, wiki-merge) + settings.json permission
                     allowlist + kb-move.ps1, kb-commit.ps1 and kb-status.ps1, the three vetted helpers
                     + feed-inbox.ps1, the repository feeder no agent may run
                     + kb-run.ps1, the run wrapper holding one lock per KB, which no agent may run
  .gitignore
```

Every file move, every commit and every git read goes through the three
helpers, `kb-move.ps1`, `kb-commit.ps1` and `kb-status.ps1`, each validating its
own arguments. All of raw git is denied to the agent, as are raw `mv`, `rm`,
`cp`, `curl`, `wget` and `ls`.

## Why one repo per knowledge base, never branches

Each knowledge base is a permanently disjoint domain: two entities' knowledge
bases are never meant to merge, diverge from a common ancestor, or share
history. Branches exist to partition versions of the same content; that model
does not fit content that must never cross-contaminate. A repo per knowledge
base gives each domain independent history and independent identity.

Separation rests on two boundaries, and they are not the same strength:

- **Writes and pushes are bounded by the permission model.** The agent running
  in a KB has no shell verb that can write outside the repo, and no way to push
  to any remote other than that KB's own `origin`.
- **Reads are bounded by the Windows account.** The one-account invariant is
  stated in full in
  [docs/runbook_automation.md](docs/runbook_automation.md), "The hard
  invariant, restated".

See [docs/architecture.md](docs/architecture.md) for the full model.

For the same reason, the engine itself is vendored (copied) into every KB
repo rather than installed as a shared plugin. A vendored copy means each KB
is fully self-contained: clone it, open Claude Code in it, and everything the
KB needs, including the skills, is already inside. No shared runtime crosses
domain lines, and an engine update is a deliberate, auditable copy into a
specific KB rather than something that changes every KB's behavior at once.
Each KB records which engine it was copied from in its own
`.claude/engine.json`, a hash of the template's `.claude/` folder. A KB that
is moved or cloned keeps that mark.

## How to instantiate a KB

Ask for one. In a Claude Code session on the Windows account that will own
the KB, ask for a new wiki and say what it is for. The skill says wiki where
this README says KB, and the two are one thing. The plugin's `wiki-new` skill
asks for a name and a one-line description. It asks once per account for the
folder KBs are created under, and it asks whether this KB gets a git remote.
It then runs `kb-create.ps1`, which copies the template into `<root>\<name>`,
makes the first commit and trusts the folder for Claude Code on this account.
Trusting it writes outside the KB, into Claude Code's own settings: an entry
for the folder in the account's `~/.claude.json`, whose earlier contents are
first copied to `~/.claude/kb-trust-backup.json`. It also lists the KB, and
pushes only where a remote was given. Last, the skill specializes `CLAUDE.md`
for the domain from the description and commits it.

A remote is optional. A KB with no remote commits locally and pushes nothing.
The ingest skill treats that as the normal case, and `kb-commit.ps1 -Push`
prints one line and exits 0 where no `origin` exists, so a lint run's commit
succeeds too. A remote suits a
KB that is shared or heavily used and should be backed up to a git host. It
must be an existing, empty repository on whichever host and account the KB's
owning entity uses, since the skill does not create one. The scheduled walker
services a local-only KB too, skipping only its pull and its push.

The account's KBs are listed in one file, `%LOCALAPPDATA%\llm-wiki\registry.json`.
Only `kb-registry.ps1` writes it. It checks each entry it adds and each
description it changes, and it refuses a list file that is off its shape.
`pwsh -NoProfile -File kb-registry.ps1 List` prints one line per KB: its
name, its folder, the first eight characters of its engine hash, and its
description.

The hand path still works. `new-kb.ps1` copies the template and makes the
first commit, and `docs/instantiation.md` walks through trust, the
schema-specialization session, the optional remote and listing the KB.

To install the engine instead of cloning it, add the marketplace with
`claude plugin marketplace add SApplefeld/plugins`, then install it with
`claude plugin install wiki@applefeld`. The `wiki-new` skill finds the
installed folder itself. For the hand path, that folder is the `installPath`
Claude Code records for `wiki@applefeld` in
`~/.claude/plugins/installed_plugins.json`. Give `new-kb.ps1` an absolute
`-Path` outside the plugin cache, since a relative one lands beside the
installed copy and a plugin update can remove it. The plugin delivers the
`wiki-new` skill and the three scripts behind it: `kb-create.ps1`, which runs
`kb-trust.ps1` and `kb-registry.ps1` in turn. It also delivers `new-kb.ps1`
for the hand path, the walker `kb-walk.ps1`, and `register-walk.ps1` with the
launcher it installs, with the template, six tests and three documents.
Each KB still gets its own vendored copy of the engine, as the section above
describes. A developer who wants to change the engine clones this repository
and runs the scripts from the clone.

## How automation works

One Windows scheduled task per account, `wiki-walk`, runs the walker,
`kb-walk.ps1`, every hour. Each pass visits every KB on the account's wiki
list in turn, one at a time. For each it brings the vendored engine files up
to the installed version, pulls from `origin` where one exists, runs the
feeder where the KB has sources, runs an ingest where `inbox/` holds a file,
runs a lint where the last one is a week old, and pushes. Dropping a file into
`inbox/` is the entire hand-off: the next pass ingests it and pushes a commit.

The walker calls a model only where there is work: an ingest with a file
waiting, a lint that is due, or a pull that conflicts, which a model run joins.
An idle KB costs no model call, so the hourly pass costs nothing on a quiet
account. Each model run goes through the KB's wrapper, `.claude/kb-run.ps1`,
which runs headless Claude Code
(`claude -p "Use the wiki-ingest skill." --model sonnet --permission-mode default`)
with the KB folder as its working directory. Every pass writes
`%LOCALAPPDATA%\llm-wiki\walk-status.json`, which names each KB, each step's
outcome, every failure and every KB deferred on a conflict. `register-walk.ps1`
registers the task once per account, and a plugin update reaches the walker
and every KB's vendored files on the next pass with no re-registration.

Two mechanics are easy to get wrong, and both fail silently:

- **The model must be pinned.** A too-small or unpinned model does nothing
  while emitting success-shaped text, so the run wrapper passes `--model sonnet`.
- **The KB's workspace must be trusted first.** Claude Code ignores
  `permissions.allow` entirely in an untrusted workspace, and no command-line
  flag overrides that while a skill is executing. An untrusted KB's scheduled
  run therefore writes nothing and exits, with the warning going only to
  stderr. The walker checks trust first and skips an untrusted KB, naming it
  `untrusted` in the status file. `kb-create.ps1` trusts a new KB through
  `kb-trust.ps1`. A KB made by hand is trusted by running `kb-trust.ps1`, or
  by opening Claude Code interactively in it once and accepting the dialog.
  The `deny` rules hold whether or not the workspace is trusted.

A KB whose sources live in git repositories can add a feeder. Where the KB
holds `.claude/feed.json`, each pass runs `.claude/feed-inbox.ps1` as plain
PowerShell before the ingest. It copies new and changed files from the
repositories `feed.json` names into `inbox/`, and never runs Claude.

Tenancy is by Windows account: one account per entity, each with its own
Claude login and its own git credentials. See `docs/runbook_automation.md` for
registration and verification detail.

## How to verify a KB's structure

```
pwsh -File tests/Test-KbStructure.ps1 -Path <kb-path>
```

Add `-RequireSchema` for an instantiated KB. It requires `CLAUDE.md` and the
version mark `.claude/engine.json`, so the bare template, which has no version
mark, is checked without it. A KB created before the version mark existed fails
`-RequireSchema` on `.claude/engine.json` until the engine writes that file into
it. Add `-RequireSkills` to also require the four vendored skill files.

`tests/Test-FeedInbox.ps1` tests the feeder against a throwaway repository and
KB it builds and removes:

```
pwsh -NoProfile -File tests/Test-FeedInbox.ps1
```

`tests/Test-ReconcileGate.ps1` tests the status helper's `Live` read and the
move helper's stamp the same way, and checks that the four writing skills emit
that read where their steps need it:

```
pwsh -NoProfile -File tests/Test-ReconcileGate.ps1
```

`tests/Test-KbRun.ps1` tests the run wrapper's lock, budget stop and argument
line against a stub it writes in place of `claude`:

```
pwsh -NoProfile -File tests/Test-KbRun.ps1
```

`tests/Test-KbWalk.ps1` runs the walker over throwaway KBs and a temporary
wiki list, with a stub in place of `claude`, and checks each step's model
gate, the pull's merge and deferral, the budget and the lock.
`tests/Test-WalkLauncher.ps1` tests the launcher's snapshot of a temporary
install and `register-walk.ps1 -WhatIf`, and registers nothing:

```
pwsh -NoProfile -File tests/Test-KbWalk.ps1
pwsh -NoProfile -File tests/Test-WalkLauncher.ps1
```

## How a release is cut

This section is for the source repository. The publish workflow, its
allowlist and its scripts stay there, so an installed copy holds none of them.

The engine reaches the public marketplace from a GitHub Actions workflow in
`.github/workflows/publish.yml`. To cut a release, tag `main` with
`publish-<YYYYMMDD>`, or any other tag starting `publish-`, and push the tag.
A manual run works too, started against a `publish-` tag, since the
`publish` environment admits no other ref. Then read the run in the Actions
tab. A green run makes at most one commit in `SApplefeld/plugins`. That
commit replaces `plugins/wiki/` and touches nothing else there. When the
public folder already matches, the run makes no commit and says so.

The job builds its snapshot from `tools/publish/allowlist.txt` and refuses to
publish in these cases, among others:

- An allowlist line resolves to no tracked file, or names a folder.
- A glob resolves to a path under `docs/`, `kaizen/`, `.kit/`, `test/` or
  `tools/`, or to a file named `*.test.*`. Only a literal line admits one
  document under `docs/`.
- A literal line names a plan, the archive, the backlog, a kaizen note, a
  scratch file or a file named `*.test.*`.
- The commit being published is not `main`'s tip or an ancestor of it. The
  run ends before it assembles anything. A tag on an older `main` commit
  passes and republishes that older snapshot. This catches a tag on a commit `main` never reached,
  not someone who can push one, since the check runs from the tagged commit's
  own workflow.
- A file or a path in the snapshot holds a word from the list kept in the
  repository's `publish` environment, or a file cannot be read as text.
- The public clone tracks a different number of files under `plugins/wiki/`
  than the snapshot holds.

The public folder is the engine as an installer needs it and nothing else:
the plugin manifest, this README, the license, the ignore file, the eight
scripts at its root, the `wiki-new` skill, the template, six tests and three
documents. `tools/publish/allowlist.txt` names each one.
`node --test tools/publish/*.test.mjs` runs the tests for the publish scripts.

## Deliberately out of scope

- **Hybrid search or embeddings.** A flat `index.md` is sufficient to a few
  hundred pages; this is revisited only if a KB approaches that scale.
- **Cloud routines.** Ingest reads local drops in `inbox/`; a cloud routine
  would still need something local to push files first, so it adds a hop
  without removing one. A possible later addition for repo-only passes like
  lint.
- **Git LFS.** Not needed until a KB's `sources/` grows heavy enough that
  plain git storage becomes a problem.
- **Cross-KB linking or querying.** Structurally excluded: knowledge bases
  are separate repos precisely so nothing can reach across them.
