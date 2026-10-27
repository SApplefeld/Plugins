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
in one pass. It updates `index.md` and appends a `log.md` entry, then commits
and pushes.

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
  .claude/        <- vendored engine skills (wiki-ingest, wiki-lint, wiki-query) + settings.json permission
                     allowlist + kb-move.ps1, kb-commit.ps1 and kb-status.ps1, the three vetted helpers
                     + feed-inbox.ps1, the repository feeder no agent may run
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

## How to instantiate a KB

At a high level: copy `template/` into a new folder, run `git init -b main`
in it, make an initial commit, then open an interactive Claude Code session
in the new KB and specialize `CLAUDE.md` for the domain (page-type
vocabulary, domain entities, citation granularity). Create the remote by hand
on whichever git host and account the KB's owning entity uses, then push.

`new-kb.ps1` automates the copy-and-init steps; see `docs/instantiation.md`
for the full walkthrough including the schema-specialization session and
remote setup.

To install the engine instead of cloning it, add the marketplace with
`claude plugin marketplace add SApplefeld/plugins`, then install it with
`claude plugin install wiki@applefeld`. Run `new-kb.ps1` from the installed
folder, which sits under the plugin cache, and give `-Path` an absolute path
outside that cache, since a relative one lands beside the installed copy and
a plugin update can remove it. The plugin delivers the two setup scripts,
`new-kb.ps1` and `register-task.ps1`, with the template, three tests and three
documents. Each KB still gets its own vendored copy of the engine, as the
section above describes. A developer who wants to change the engine clones this
repository and runs `new-kb.ps1` from the clone.

## How automation works

A per-user Windows scheduled task runs headless Claude Code
(`claude -p "Use the wiki-ingest skill." --model sonnet --permission-mode default`)
with the KB folder as its working directory, on a cadence. Dropping a file into `inbox/` is the entire
hand-off: the next scheduled run ingests it and pushes a commit. An empty
inbox no-ops, so a frequent cadence costs nothing.

Two mechanics are easy to get wrong, and both fail silently:

- **The model must be pinned.** A too-small or unpinned model does nothing
  while emitting success-shaped text, so the task passes `--model sonnet`.
- **The KB's workspace must be trusted first.** Claude Code ignores
  `permissions.allow` entirely in an untrusted workspace, and no command-line
  flag overrides that while a skill is executing. An untrusted KB's scheduled
  run therefore writes nothing and exits, with the warning going only to
  stderr. Trust is established by opening Claude Code interactively in the KB
  once and accepting the dialog, which the schema-specialization session
  already does. The `deny` rules hold whether or not the workspace is trusted.

A KB whose sources live in git repositories can add a feeder.
`register-task.ps1 -Operation Feed` registers an hourly `wiki-feed-<kb folder>`
task that runs `.claude/feed-inbox.ps1` as plain PowerShell. It copies new and
changed files from the repositories `.claude/feed.json` names into `inbox/`,
and never runs Claude.

Tenancy is by Windows account: one account per entity, each with its own
Claude login and its own git credentials. See `docs/runbook_automation.md` for
registration and verification detail.

## How to verify a KB's structure

```
pwsh -File tests/Test-KbStructure.ps1 -Path <kb-path>
```

Add `-RequireSchema` once a KB has a specialized `CLAUDE.md` in place, and
`-RequireSkills` to also require the three vendored skill files.

`tests/Test-FeedInbox.ps1` tests the feeder and the registrar's Feed operation
against a throwaway repository and KB it builds and removes:

```
pwsh -NoProfile -File tests/Test-FeedInbox.ps1
```

`tests/Test-ReconcileGate.ps1` tests the status helper's `Live` read and the
move helper's stamp the same way, and checks that the three writing skills emit
that read where their steps need it:

```
pwsh -NoProfile -File tests/Test-ReconcileGate.ps1
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
the plugin manifest, this README, the license, the ignore file, the two setup
scripts, the template, the three tests above and three documents.
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
