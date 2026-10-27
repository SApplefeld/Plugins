# Instantiating a knowledge base

This is the operator's walkthrough for standing up a new knowledge base (KB)
from the llm-wiki engine. It is written for a competent engineer who has never
done it before. Follow the steps in order.

## What instantiation produces

A KB is a self-contained git repo with its own copy of the engine vendored
inside it. Instantiation copies the engine's `template/` tree into a new folder,
initializes git, and makes the first commit. The result holds everything the KB
needs to run: the three-layer content directories (`inbox/`, `sources/`,
`wiki/`), the schema (`CLAUDE.md`), the vetted helper scripts and permission
allowlist under `.claude/`, and the three skills (`wiki-ingest`, `wiki-lint`,
`wiki-query`). No shared runtime crosses into the KB, so an engine update is a
deliberate copy into a specific KB, never a change that touches every KB at
once. For the pattern at a glance, see the engine [README](../README.md); for
the engineering design and the reasons behind it, see
[architecture.md](architecture.md).

## Prerequisites

Every KB is owned by one Windows account, and that account is the boundary
between entities (see the hard invariant at the end). On the owning account:

- **PowerShell 7 (`pwsh`) on PATH.** The helper scripts and the scheduled tasks
  invoke `pwsh`. Windows PowerShell 5.1 also runs `new-kb.ps1`, but the
  automation runbook standardizes on `pwsh`.
- **git configured with that account's own identity and credentials.**
  `new-kb.ps1` makes the initial commit as whoever the account's git config
  says, and it never sets `user.name` or `user.email` for you. If neither is
  configured, the commit fails with git's own message and the script stops.
- **Claude Code installed and logged in under that account.** The
  schema-specialization session and every scheduled run use it.

## Step 1: create the repo

Run `new-kb.ps1` from the engine checkout, or from the installed plugin folder
after `claude plugin install wiki@applefeld`. From the installed folder, give
`-Path` an absolute path outside the plugin cache, since a relative one lands
beside the installed copy. It takes the KB name (used only in
the initial commit message) and the destination path (the new repo root, which
must not already exist with contents):

```
pwsh -NoProfile -File ./new-kb.ps1 -Name "Eleos KB" -Path ../eleos-kb
```

The script copies the template, runs `git init -b main`, makes the initial
commit, and then runs the structural check against the result. It refuses a
destination that already holds files, so it never overwrites an existing repo.
It creates no git remote (step 4 is manual by design). On success it prints four
follow-up steps, leading with trusting the workspace, and steps 2 to 5 below
cover them. Its last printed step says to register the ingest task, plus a
lint task and a feed task where they belong, and Step 5 below says when.

## Step 2: trust the workspace

This step is first for a reason. Claude Code ignores `permissions.allow`
entirely in a workspace that has not been trusted, and it prints that warning
only to stderr. A scheduled ingest run in an untrusted KB therefore prompts on
every write, gets no answer because nobody is watching, and exits having written
nothing. The `deny` rules hold whether or not the workspace is trusted, so
trust affects only what the run is allowed to do, never what it is forbidden.

Trust is per Windows account and per exact path. There are two ways to
establish it:

- **Open Claude Code interactively in the KB folder once and accept the trust
  dialog.** This is the only reliable method, and it is free: the step 3 session
  is interactive and does it anyway. Do this.
- Editing `~/.claude.json` by hand is possible but easy to get wrong. The key is
  `projects["<absolute path>"].hasTrustDialogAccepted`, and the path must match
  exactly what Claude Code records: it stores some keys with forward slashes
  (`D:/personal/eleos-kb`) and some with escaped backslashes
  (`D:\\personal\\eleos-kb`), and the drive-letter case must match. A key that
  does not match is not an error. It is simply ignored, and the KB stays
  untrusted while looking trusted. Prefer the dialog; use the file to verify.

To check whether a KB is already trusted, read `~/.claude.json` and look for the
KB's absolute path under `projects`, with `hasTrustDialogAccepted: true`. Note
that this file contains at least one property with an empty-string name, which
makes a naive `ConvertFrom-Json` throw on both PowerShell 5.1 and 7. `register-task.ps1`
reads it correctly and refuses to register a task for an untrusted KB.

## Step 3: specialize the schema

This is the substantive step. It is an interactive Claude Code session in the
new KB whose job is to adapt `CLAUDE.md` to the domain. `CLAUDE.md` ships
generic, with exactly three `<!-- CUSTOMIZE: ... -->` blocks in its "Domain
customization" section, each holding a working default. Specialization replaces
each block with domain-specific content that is at least as specific as the
default it replaces. The three blocks:

- **Domain vocabulary and page types.** Replace the generic statement with the
  domain's own nouns: its entities, its concepts, the kinds of documents it
  ingests. If the domain needs a page type beyond the six standard ones (entity,
  concept, comparison, overview, synthesis, per-source summary), define it here
  and give it the same one-paragraph contract the standard types get: what it
  holds, what it does not, and how it is named. A good replacement lets a fresh
  session file a new document correctly without guessing.
- **Citation granularity.** State how precisely a claim must cite its source.
  The generic default names the source file plus a section or page number. If
  the domain's sources have finer structure (clause numbers, timestamps, figure
  IDs), say so, so citations land at the granularity a reader can actually
  follow back.
- **Staleness horizon.** How old an unsourced claim may be before the lint pass
  reports it as stale rather than merely unsourced. The default is 12 months.
  Keep this value on its own line, starting with the exact prefix
  `Staleness horizon:`, because the lint pass reads it with an anchored match.
  Do not repeat that prefix anywhere else in the file.

A concrete opening prompt for the session:

```
You are specializing this knowledge base's CLAUDE.md for the <domain> domain.
Read CLAUDE.md in full, then replace the three CUSTOMIZE blocks in the "Domain
customization" section: domain vocabulary and page types, citation granularity,
and the staleness horizon. Each replacement must be at least as specific as the
default it replaces. Do not change anything outside those three blocks. In
particular, do not weaken the "Untrusted input" section or the contradiction
rule. Show me the proposed edits before writing them.
```

When the edits are agreed, commit `CLAUDE.md`.

The "Untrusted input" section and the contradiction rule are security and
integrity guarantees, not domain choices. The untrusted-input section is what
keeps ingested documents treated as data rather than instructions, and the
contradiction rule is what keeps a hostile document from silently overwriting a
sourced claim. Specialization must never soften either one. Add domain
vocabulary; do not relax the guard rails.

## Step 4: create the remote and push

Remote creation is manual by design. Each entity uses its own git host and
account, and the script must not assume one. Create an empty repo on whichever
host the KB's owning entity uses, then:

```
git remote add origin <url>
git push -u origin main
```

The remote must be named `origin`: `kb-commit.ps1`, which every ingest and lint
run uses to push, pushes only to a remote named `origin`.

## Step 5: register automation

Register the scheduled ingest task for this KB under the owning account, plus
a weekly lint task beside it and a feed task for a fed KB. See [runbook_automation.md](runbook_automation.md) for registration and
verification detail.

## Verifying an instantiated KB

Run the structural check against the KB:

```
pwsh -NoProfile -File tests/Test-KbStructure.ps1 -Path <kb> -RequireSchema -RequireSkills
```

A green run confirms the KB's structure: the required directories and files are
present, `CLAUDE.md` and the three skills exist, `settings.json` parses, and the
permission allowlist has the right shape (it denies writes under `sources/`,
`inbox/`, `.git/`, and `.claude/`, denies all of raw git and the raw shell verbs
that would bypass the helpers, denies credential reads, allows the three vetted
helpers, and pins the default permission mode).

A green run does not prove a headless run will complete. That also needs
workspace trust (step 2), which is per account and per path and lives in
`~/.claude.json`, not in the repo. The structural check judges structure only.

## A hard invariant: one Windows account per entity

One Windows account holds one entity's KB, never two, as
[runbook_automation.md](runbook_automation.md), "The hard invariant, restated",
states in full.
