# Instantiating a knowledge base

This is the operator's walkthrough for standing up a new knowledge base (KB)
from the llm-wiki engine. It is written for a competent engineer who has never
done it before. The usual path is one request in a Claude Code session, and
the next section covers it. The hand path after it is the fallback, for a
machine without the plugin or an operator who wants each step in view. Follow
its steps in order.

## What instantiation produces

A KB is a self-contained git repo with its own copy of the engine vendored
inside it. Instantiation copies the engine's `template/` tree into a new folder,
records the engine version in `.claude/engine.json`, initializes git, and makes
the first commit. The result holds everything the KB
needs to run: the three-layer content directories (`inbox/`, `sources/`,
`wiki/`), the schema (`CLAUDE.md`), the vetted helper scripts and permission
allowlist under `.claude/`, and the four skills (`wiki-ingest`, `wiki-lint`,
`wiki-query`, `wiki-merge`). Outside the folder, instantiation leaves two records on the
owning account: the KB's trust entry in `~/.claude.json` and its line in the
account's wiki list, `%LOCALAPPDATA%\llm-wiki\registry.json`. No shared runtime
crosses into the KB: each KB holds its own copy of the engine files, and the
scheduled walker brings each listed KB's copy up to the installed engine on
its next pass, as a commit in that KB. For the pattern at a glance, see the engine [README](../README.md); for
the engineering design and the reasons behind it, see
[architecture.md](architecture.md).

## Prerequisites

Every KB is owned by one Windows account, and that account is the boundary
between entities (see the hard invariant at the end). On the owning account:

- **PowerShell 7 (`pwsh`) on PATH.** The helper scripts and the account's
  `wiki-walk` task invoke `pwsh`. Windows PowerShell 5.1 also runs `new-kb.ps1`, but the
  automation runbook standardizes on `pwsh`.
- **git configured with that account's own identity and credentials.**
  `new-kb.ps1` makes the initial commit as whoever the account's git config
  says, and it never sets `user.name` or `user.email` for you. If neither is
  configured, the commit fails with git's own message and the script stops.
- **Claude Code installed and logged in under that account.** The
  schema-specialization session and every scheduled run use it.
- **For the usual path, the `wiki@applefeld` plugin installed**, from the
  marketplace the engine [README](../README.md) names.

## Usual path: one request

In a Claude Code session on the owning account, ask for a new wiki and say
what it is for. The skill says wiki where this guide says KB, and the two are
one thing. The `wiki-new` skill runs these steps:

1. It takes a name and a one-line description from the request, and asks for
   whichever is missing. The name becomes the folder name and the list entry.
2. It reads the account's wiki root with `kb-registry.ps1 Root`. Where the
   account has no list yet, it asks once for the absolute folder to keep
   wikis in, on a local drive.
3. It asks whether the KB gets a git remote, and takes a URL only where the
   answer is yes. The hand path's "Step 4 (optional)" says when a remote is
   worth having.
4. It runs `kb-create.ps1`, which copies the template into `<root>\<name>`
   and makes the first commit, runs `kb-trust.ps1` to trust the folder, adds
   the remote and pushes where one was given, and lists the KB with
   `kb-registry.ps1 Add`.
5. It specializes the three `CUSTOMIZE` blocks in `CLAUDE.md` from the
   description, the same blocks the hand path's "Step 3: specialize the
   schema" fills, and commits `CLAUDE.md`.
6. It prints the KB's line from `kb-registry.ps1 List`.

A refused step stops the run with that step's own one-line reason. A stop after
the copy names the folder it left behind, so you can remove it before a retry.
A stop from the trust step on also says `~/.claude.json` may hold a trust entry
for that folder. The entry trusts that one path and nothing else, so it can
stay. A retry at the same path finds the folder already trusted and writes
nothing.

Read the specialized `CLAUDE.md` once creation ends. The session wrote it from
a one-line description. To deepen it, run the session in the hand path's
"Step 3: specialize the schema", and ask it to refine the three blocks rather
than replace them.

## Hand path

These steps produce the same KB without the plugin's skill.

### Step 1: create the repo

Run `new-kb.ps1` from the engine checkout, or from the installed plugin folder
after `claude plugin install wiki@applefeld`. The installed folder is the
`installPath` recorded for `wiki@applefeld` in
`~/.claude/plugins/installed_plugins.json`. From the installed folder, give
`-Path` an absolute path outside the plugin cache, since a relative one lands
beside the installed copy. It takes the KB name (used only in
the initial commit message) and the destination path (the new repo root, which
must not already exist with contents):

```
pwsh -NoProfile -File ./new-kb.ps1 -Name "Acme KB" -Path D:\Wikis\acme-kb
```

The script copies the template, runs `git init -b main`, makes the initial
commit, and then runs the structural check against the result. It refuses a
destination that already holds files, so it never overwrites an existing repo.
It creates no git remote, since step 4 is optional. On success it prints four
follow-up steps, leading with trusting the workspace, and steps 2 to 5 below
cover them. Its last printed step says to list the KB and register the
account's walker, and Step 5 below says how.

Then add the KB to the account's wiki list, so every reader of the list sees
it. Where the account has no list yet, create one first with the folder your
wikis live in:

```
pwsh -NoProfile -File ./kb-registry.ps1 Init -Root D:\Wikis
pwsh -NoProfile -File ./kb-registry.ps1 Add -Name acme-kb -Path D:\Wikis\acme-kb -Description 'Acme contracts and correspondence.'
```

The list's name is separate from the `-Name` given to `new-kb.ps1`, which
appears only in the first commit message. A list name is 1 to 64 ASCII
letters, digits, hyphens, underscores and dots. It neither starts nor ends
with a dot, is not a Windows device name such as `CON`, and is unique in the
list ignoring case. So `Acme KB` is refused for its space, and `acme-kb` is
accepted. The folder need not sit under the root. The root is where
`wiki-new` puts the KBs it creates.

`Add` refuses a name that breaks that rule, a folder missing any file a new KB
holds other than `.claude/engine.json` and
`.claude/skills/wiki-merge/SKILL.md`, and a folder inside a listed KB, among
other cases, each with one `kb-registry:` line on stderr. A KB made before the
version mark or the merge skill existed can still be listed, and the walker's
engine update brings it the merge skill. The list itself is never edited by
hand.

### Step 2: trust the workspace

This step is first for a reason. Claude Code ignores `permissions.allow`
entirely in a workspace that has not been trusted, and it prints that warning
only to stderr. A scheduled ingest run in an untrusted KB therefore prompts on
every write, gets no answer because nobody is watching, and exits having written
nothing. The `deny` rules hold whether or not the workspace is trusted, so
trust affects only what the run is allowed to do, never what it is forbidden.

Trust is per Windows account and per exact path, and a folder does not inherit
it from a trusted parent. There are two ways to establish it:

- **Run `kb-trust.ps1` on the KB.** This is the path `kb-create.ps1` takes:

  ```
  pwsh -NoProfile -File ./kb-trust.ps1 -Path D:\Wikis\acme-kb
  ```

  It runs a short headless Claude Code probe in the folder. In an untrusted
  folder, Claude Code answers with one stderr line naming the exact key it
  wants, shaped like this for a KB at `D:\Wikis\acme-kb`:

  ```
  Ignoring 1 permissions.allow entry from .claude/settings.json: this workspace has not been trusted. Run Claude Code interactively here once and accept the trust dialog, or set projects["D:/Wikis/acme-kb"].hasTrustDialogAccepted: true in <your profile>\.claude.json.
  ```

  The script takes the key from that line and nowhere else, refuses it unless
  it names this folder, and sets `hasTrustDialogAccepted: true` under it. It
  then runs the probe again and exits 0 only where the second probe prints no
  such line. A folder already trusted prints no line, so nothing is written.
  The two probes are two small model calls. The script refuses a folder whose
  `.claude/settings.json` holds no `permissions.allow` entry, since the probe
  there stays silent whatever the trust.

  The write changes that one key and leaves every other property as it was.
  It copies the file to `~/.claude/kb-trust-backup.json` first, so the
  previous state is there if you need it. Where another writer holds the
  file for 10 seconds, the script exits 1 with `kb-trust: ~/.claude.json is
  held by another writer` and changes nothing. Run it again once that writer
  is done. The architecture reference's trust gate describes the lock and the
  write.
- **Open Claude Code interactively in the KB folder once and accept the trust
  dialog.** The step 3 session is interactive and does it anyway.

Do not edit `~/.claude.json` by hand. The key is
`projects["<absolute path>"].hasTrustDialogAccepted`, and the path must match
exactly what Claude Code records. It stores some keys with forward slashes
(`D:/Wikis/acme-kb`) and some with escaped backslashes
(`D:\\Wikis\\acme-kb`), and the drive-letter case must match. A key that
does not match is not an error. It is simply ignored, and the KB stays
untrusted while looking trusted. `kb-trust.ps1` avoids that by taking the key
from Claude Code's own warning and proving it with the second probe.

To check whether a KB is already trusted, read `~/.claude.json` and look for the
KB's absolute path under `projects`, with `hasTrustDialogAccepted: true`. Note
that this file contains at least one property with an empty-string name, which
makes a naive `ConvertFrom-Json` throw on both PowerShell 5.1 and 7. The
walker, `kb-walk.ps1`, reads it correctly. Its first step for each KB reads
that entry under the running account, and it skips an untrusted KB, recording
it `untrusted` in the pass's status file, since a headless run there writes
nothing.

### Step 3: specialize the schema

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

### Step 4 (optional): attach a remote and push

A KB needs no remote. Without one it commits locally and pushes nothing:
`kb-commit.ps1 -Push` prints `kb-commit: no remote named 'origin'; nothing
pushed.` and exits 0, and the ingest skill treats that as the normal case. A
remote suits a KB that is shared or heavily used and should be backed up to a
git host.

Remote creation is manual by design. Each entity uses its own git host and
account, and no script assumes one. Create an empty repo on whichever host the
KB's owning entity uses, with no README or license, then:

```
git remote add origin <url>
git push -u origin main
```

The remote must be named `origin`: `kb-commit.ps1`, which every ingest and lint
run uses to push, pushes only to a remote named `origin`.

### Step 5: register automation

Each account runs one scheduled task, `wiki-walk`, which services every KB on
the account's wiki list each hour. Where the account has none yet, register it
once from an elevated PowerShell, as the owning account, with
`register-walk.ps1`. A KB listed in Step 1 is then serviced from the
next pass, with no registration of its own. A KB with no remote is serviced
too, with no pull and no push. See [runbook_automation.md](runbook_automation.md)
for registration and verification detail.

## Verifying an instantiated KB

Run the structural check against the KB:

```
pwsh -NoProfile -File tests/Test-KbStructure.ps1 -Path <kb> -RequireSchema -RequireSkills
```

A KB created before the version mark existed fails this check on
`.claude/engine.json` until the engine writes that file into it.

A green run confirms the KB's structure: the required directories and files are
present, `CLAUDE.md` and the four skills exist, `settings.json` parses, and the
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
