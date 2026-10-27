# Automating a knowledge base

This is the operator's runbook for putting a knowledge base (KB) on a
schedule so it ingests dropped files and maintains itself without anyone
present. It picks up where
[instantiation.md](instantiation.md) leaves off: that document creates and
trusts the KB, this one registers the scheduled tasks and proves they work.
Read it in order, and do not skip the verification checklist. Two failure
modes here produce a run that looks fine and does nothing. The checklist
catches them before they cost you a silent week. For the design behind
the permission model, the trust gate, and the skill-by-name and model-pin
mechanics this runbook relies on, see [architecture.md](architecture.md).

## What automation does

A per-user Windows scheduled task runs headless Claude Code in the KB folder
on a cadence. The task runs one command:

```
claude -p "Use the wiki-ingest skill." --model sonnet --permission-mode default
```

with the KB as its working directory. Drop a file into the KB's `inbox/`, and
the next run ingests it: it moves the original into `sources/`, writes a
summary page, revises the wiki pages the source bears on, updates `index.md`
and `log.md`, commits, and pushes. An empty inbox is a free no-op: the run
reads an empty queue, writes nothing, makes no commit, and exits. So a
frequent cadence costs almost nothing, because most runs find nothing to do.

The wiki-lint skill keeps the wiki healthy: orphan pages, broken links,
missing cross-references, contradictions, and stale claims. Lint commits its
fixes separately from any ingest commit. `register-task.ps1` can register it
as an optional lint task, weekly by default, beside any ingest cadence. A run
that overlaps another yields, as "Overlapping runs yield" below describes.

Every KB has an ingest task owned by the KB's Windows account. A KB whose
sources live in git repositories adds the feeder, which fills `inbox/` from
those repositories. [Repository feeder](#repository-feeder) covers it.

## Prerequisites, per Windows account

Every KB is owned by exactly one Windows account (see the hard invariant at
the end). Everything below must be true under that account, not merely under
yours:

- **Claude Code installed and logged in under that account.** Each account
  carries its own Claude login and subscription. A headless run uses that
  account's login; a task registered for an account with no Claude login does
  nothing.
- **`pwsh` (PowerShell 7) on PATH.** The skills run the KB's helper scripts
  with `pwsh`, and the allow-list grants only that form.
- **Git configured with that account's own identity and credentials**, and
  the KB cloned or created with a remote named `origin`. Every ingest and
  lint run pushes through `kb-commit.ps1`, which pushes only to `origin`.
- **The KB workspace trusted under that account.** Trust is per Windows
  account and per exact path, and it lives in that account's own
  `~/.claude.json`. Establish it by opening Claude Code interactively in the
  KB once as that account and accepting the trust dialog. This is the single
  most important prerequisite; the next section says why.

## Two silent failure modes

Each of these produces a run that exits cleanly, reports success-shaped text,
and changes nothing. A green exit code catches neither. The verification
checklist catches both.

### 1. An untrusted workspace

Claude Code ignores `permissions.allow` entirely in a workspace that has not
been trusted. Headless, that means it prompts on every write, gets no answer
because nobody is watching, and exits having written nothing. The warning
goes only to stderr. No CLI flag overrides this while a skill is executing:
`--settings`, `--allowedTools`, and inline JSON each supply a working
allowlist for a direct prompt but are all ignored under skill execution. The
`deny` rules hold whether or not the workspace is trusted, so trust affects
only what the run is allowed to do, never what it is forbidden. Trust the KB
under the owning account before registering anything. `register-task.ps1`
checks trust for the current account and refuses to register an untrusted KB,
but it cannot read another account's `~/.claude.json`, so trust for the
running account is ultimately yours to establish and verify.

### 2. An unpinned or too-small model

A model too small for the ingest skill moves nothing and commits nothing while
emitting success-shaped text. An unpinned headless spawn inherits the harness
default, whatever that is. Pin `--model sonnet`. `register-task.ps1` pins it.
A hand-run verification command must run the task's exact command, flags
included, or it tests a different thing than the task runs.

## Registering the tasks

Run these from an **elevated** PowerShell (Run as administrator). Registering a
scheduled task with an S4U principal, or for any account, requires elevation;
without it `Register-ScheduledTask` fails with an access-denied error.

Register the tasks under the owning account, from the engine checkout or the
installed plugin folder. From the installed folder, give `-KbPath` the KB's
absolute path. A relative one resolves against the current folder, which is
then inside the plugin cache. Ingest
first:

```
pwsh -NoProfile -File ./register-task.ps1 -Operation Ingest -KbPath ..\eleos-kb -User '.\eleos'
```

Then lint, on its default weekly cadence, as "Overlapping runs yield" below
explains:

```
pwsh -NoProfile -File ./register-task.ps1 -Operation Lint -KbPath ..\eleos-kb -User '.\eleos'
```

`-Operation` selects the skill and the default cadence: Ingest defaults to
every four hours, Lint to weekly on Sunday. Override with `-Cadence`, which
accepts `Hourly`, `Every4Hours`, `Every12Hours`, `Daily`, or `Weekly`:

```
pwsh -NoProfile -File ./register-task.ps1 -Operation Ingest -KbPath ..\eleos-kb -User '.\eleos' -Cadence Every12Hours
```

The task name defaults to the operation plus the KB folder name, for example
`wiki-ingest-eleos-kb` and `wiki-lint-eleos-kb`. Override with `-TaskName`.

Before registering, the script refuses any KB that would silently do nothing:
a path that is not a git repo, a repo missing the requested skill, a repo with
no `origin` remote, or an untrusted workspace. Each refusal exits with a
one-line reason naming the fix.

Add `-WhatIf` to any invocation to see exactly what would be registered
without registering it. Run that first if you want to inspect the task before
committing it to the scheduler.

**Registering for an account other than your own.** The script can verify
trust only for the current account, because it reads only the current
account's `~/.claude.json`. If `-User` names a different account, it refuses
and tells you to establish trust as that account and re-run with
`-SkipTrustCheck`. `-SkipTrustCheck` bypasses only the trust verification and
prints a loud warning; it does not make the workspace trusted. The safest path
is to log in as the owning account and register from there, so the trust check
is real.

### S4U and the push path

The task registers with an S4U (Service For User) principal. It runs whether
or not the user is logged on and needs no stored password. An S4U run cannot
read the account's DPAPI-protected secrets, the store behind Windows
Credential Manager. A `git push` over HTTPS that relies on Credential Manager
can therefore fail from inside the task, even though it succeeds when you run
it by hand while logged on. The verification checklist tests the push path end
to end for this reason.

If the scheduled push fails while a hand-run push succeeds, switch the remote
to SSH with a passphrase-less key, such as a deploy key scoped to that one
repo. A file-based SSH key needs no interactive credential and works under
S4U. `register-task.ps1` registers S4U only and has no stored-password option.

## The verification checklist

This is the heart of the runbook. Run every step, in order, under the owning
account, in the KB folder. Each step names the command and the exact
observable that proves it. A registered task is not a working task until this
passes.

**1. The task exists and runs as the intended account.**

```
Get-ScheduledTask -TaskName wiki-ingest-eleos-kb | Select-Object -ExpandProperty Principal
```

Observable: `UserId` reads the owning account's bare name, such as `eleos`,
with no machine or domain prefix, and `LogonType` is `S4U`. The registrar
registers `.\eleos` as `COMPUTERNAME\eleos`, and Task Scheduler reads a local
account back by its bare name.

**2. The exact command the task runs succeeds by hand, with an empty inbox.**
Confirm `inbox/` holds nothing but `.gitkeep`, then run the task's own command
interactively, capturing stderr to a file:

```
cd <kb>
claude -p "Use the wiki-ingest skill." --model sonnet --permission-mode default 2> run-stderr.txt
```

Observable: the command exits, `git status --porcelain` is empty, and
`git log --oneline -3` shows no new `Ingest:` commit. This proves only that the
skill is invoked and that an empty inbox is a clean no-op. It does not prove the
allowlist works, because an empty inbox performs no allow-gated write: a fully
untrusted KB produces exactly this same clean result. The allowlist is proven by
the canary in step 4, where a real write must land. (Delete `run-stderr.txt`
when done; it is a scratch file, not part of the KB.)

**3. Trust is real: the allowlist is in force.** From the same run's stderr:

```
Select-String -Path run-stderr.txt -Pattern 'Ignoring .* permissions'
```

Observable: no match. A match (the current warning reads "Ignoring N
permissions.allow entries ... this workspace has not been trusted") means the
workspace is untrusted for this account and every write was silently refused;
stop and trust the workspace (open Claude Code interactively in the KB once and
accept the dialog) before going further. Match on `Ignoring .* permissions`
rather than a specific sentence, so a reworded warning still trips it. Because
this check reads stderr for a warning that may change, treat step 4's canary as
the decisive proof: a write that actually lands cannot happen in an untrusted
workspace, so a green step 4 confirms trust regardless of the warning text. The
trust warning appears only on stderr, which is why step 2
redirects it to a file.

**4. A canary file goes from inbox to pushed commit.** Drop a small readable
file into `inbox/`, then run the task itself (not the bare command), so you
exercise the scheduler path:

```
Copy-Item some-note.txt <kb>\inbox\canary.txt
Start-ScheduledTask -TaskName wiki-ingest-eleos-kb
```

Wait for the run to finish (step 6 shows how to read completion), then confirm
every one of these in the KB:

```
Test-Path .\sources\canary.txt                 # True: the original moved in
Get-ChildItem .\wiki\*canary*summary.md        # the summary page exists
Select-String -Path .\index.md -Pattern canary # index.md names it
Select-String -Path .\log.md   -Pattern canary # log.md has the entry
git log --oneline -1                            # subject begins "Ingest:"
git log origin/main..HEAD --oneline             # empty: the commit reached origin
```

Observable: `canary.txt` is in `sources/` and gone from `inbox/`; a summary
page exists in `wiki/`; `index.md` and `log.md` both name it; the newest
commit's subject begins `Ingest:`; and `git log origin/main..HEAD` is empty,
which is what proves the commit reached the remote rather than stranding
locally. If that last command lists a commit, the push failed (see the S4U
note above).

**5. The run completed without a permission prompt.** There is no prompt dialog
to see in a headless run; the tell is the artifact. A prompted run leaves the
file unwritten, so the summary page and the commit from step 4 would not exist.
Their presence is the proof: a run that produced the summary page, the index
entry, and the `Ingest:` commit was never blocked on a prompt. Absence of the
artifact, with the file still sitting in `inbox/`, is the failure.

**6. The task fires on its own schedule, not just when started by hand.** After
a scheduled window has passed without you starting it manually:

```
Get-ScheduledTaskInfo -TaskName wiki-ingest-eleos-kb | Select-Object LastRunTime, LastTaskResult, NextRunTime
```

Observable: `LastRunTime` advances to a time you did not trigger, and
`NextRunTime` is set. `LastTaskResult` of 0 means the process exited cleanly,
but 0 alone does not prove the ingest worked: an untrusted or too-small run
also exits 0. The commit is the proof, not the exit code. To confirm a
scheduled run did real work, drop a canary before a scheduled window and check
after it that the `Ingest:` commit appeared on its own.

## Reading an unattended run

A headless task has no console you watch. Two durable signals tell you what
happened:

- **`log.md`** in the KB. Every run that did work appends one
  `## YYYY-MM-DD - ingest` (or `- lint`) heading with a bullet per source
  handled. A healthy history is a steady sequence of dated headings.
- **`git log`.** Every ingested source is one commit whose subject begins
  `Ingest:`; every lint pass that ran its checks to the end is one `Lint:`
  commit. A run that yielded to another at its start makes no commit, and one
  that yielded later makes no `Lint:` commit and no push, as "Overlapping runs
  yield" below describes. `git log --oneline` reads like a
  maintenance journal. `git log origin/main..HEAD` should be empty; anything
  there is an unpushed commit, which the next run that pushes flushes when a
  yielded run left it.

Telling a healthy no-op from a broken run is the subtle case, because **both
produce zero commits**. A no-op run found an empty inbox and correctly did
nothing. A broken run, from an untrusted workspace or a wrong model, also
wrote nothing. `git log` alone cannot distinguish them. The tell is
`sources/` versus `inbox/`: a healthy idle KB has an empty `inbox/` and its
files in `sources/`; a broken KB has files piling up in `inbox/` that never
move. If dropped files sit in `inbox/` across several scheduled windows and
never reach `sources/`, the task is broken, not idle, and the troubleshooting
table below says where to look.

**Overlapping runs yield.** A run that finds another run's fresh edits on disk
stops and leaves them alone. The ingest and lint tasks both edit `wiki/`,
`index.md`, and `log.md`, and each begins by committing whatever it finds
already changed on disk, which recovers a crashed run. Without a check, a run
that overlapped another would commit that run's half-finished work. So when a
run finds changed files, it first asks whether any was written in the last
thirty minutes, and if one was, it stops with nothing written, committed or
pushed. Ingest asks again before each file it ingests. Lint holds every fix
until one short write pass at its end and asks again there. A run that started
while the other was still working therefore yields too. A run that yields
reports that another run is live and names the files. That is the check
working, and the next scheduled run does the work. A run that yields at its
start makes no commit and adds no heading to `log.md`. In `git log`, an ingest
that yielded looks like one that found nothing to do. A run that yields later keeps what it
already committed, unpushed, and the next run that pushes flushes it. If a lint
task shows no `Lint:` commit for two weeks running, run a lint by hand with the
command below.

So a weekly lint task registers beside any ingest cadence, the hourly one
included. A lint that yields to an ingest runs again the next week, or run it by
hand from the KB folder as the account the tasks run as:
`claude -p "Use the wiki-lint skill." --model sonnet --permission-mode default`.
A lint run by hand yields to a live ingest the same way, so there is no need to
disable the tasks first.

The check cannot separate two runs that each make their last check before the
other's first write, since each finds nothing live then. The gap between a
run's check and its write is a few agent steps, so that race is narrow, and the
commit history shows it if it happens. A run that writes nothing for thirty
minutes also reads as finished, so another run can recover its half-written
page. A daily ingest and the weekly lint both start at 03:00, so on Sundays
they meet that race at the start when the tree holds an old leftover.
Separately, an ingest can finish and commit while lint is still checking. Each
lint fix records the exact text it replaces or the gap it fills, and lint drops
any fix whose condition no longer holds, listing it in its report, so it never
overwrites the ingest's edit. Lint's other fixes to that page can still land
beside the ingest's edit, and the next lint checks the result.

## Repository feeder

A KB whose sources live in git repositories can be fed by a third task
instead of by hand drops. The feeder, `.claude/feed-inbox.ps1`, copies new
and changed files from configured repositories into `inbox/`, and the ingest
task takes them from there. It is plain PowerShell and never runs Claude, so
it needs no trust and holds no model permissions. No allow rule grants it,
and the KB's settings pin the default permission mode, so the KB's own agent
cannot run it or edit its configuration.

### Configuring the sources

The feeder reads `.claude/feed.json` in the KB:

```json
{
  "sources": [
    {
      "name": "grimoire",
      "url": "git@github.com:SApplefeld/Grimoire.git",
      "branch": "main",
      "include": ["README.md", "docs/*.md", "plugins/*/skills/**/*.md"],
      "exclude": ["docs/archive/**"]
    }
  ]
}
```

The `name` is a short label that prefixes every fed file. The `url` must be
an SSH URL or a local path. The feeder refuses an `https://`, `http://` or
`git://` URL and any URL carrying a password. That rule exists because the
URL is written into each fed file's provenance header, and a fed file is
moved into the immutable `sources/` and pushed. A token in the URL would be
published for good. SSH also suits the scheduled task: an S4U run cannot
read Credential Manager, so an HTTPS source would fail there anyway.

Commit `feed.json` with the KB. Only a human edits it.

### Running it by hand first

From the KB folder, under the owning account:

```
pwsh -NoProfile -File .\.claude\feed-inbox.ps1 -WhatIf -MaxFiles 1000
```

`-WhatIf` lists every file the feeder would add and writes nothing to
`inbox/`. It still fetches, because it cannot know what it would feed
without the current tree. The first run also creates the feeder's private
clones under `%LOCALAPPDATA%\llm-wiki-feed\`. The feeder never touches any
other checkout of those repositories. Read the list and tighten `include`
or `exclude` until it holds what the wiki should learn and nothing else.

### What a run does

Each run feeds at most `-MaxFiles` files, 10 by default. It adds nothing
while `inbox/` already holds that many, so a large backfill flows in batches
the ingest task can finish. Files no earlier run has fed go first, taken in
turn from each source, and new revisions of already-fed files follow. A
busy repository therefore cannot starve a quiet one.

A fed file is named `<source>--<path with / as -->--<blob sha 7>.<ext>`.
Any character outside letters, digits, `.`, `_` and `-` becomes `-`, so a
name is always one the ingest helpers accept and the agent's shell cannot
expand. A Markdown or text file gains a short provenance header naming the
repository, path, commit and commit date. The wiki's schema uses it to tell
a newer revision of a document from an older one. A changed upstream file is
fed once per new revision, and an unchanged file is never fed again. The
feeder decides this from the names already in `inbox/` and `sources/`, so it
keeps no state file.

A file the feeder will not feed is skipped with a warning on stderr and
counted as refused. Three cases arise: a fed name containing `..`, a fed name
over 150 characters, and a file over 25 MB. The feeder also checks every other
rule the helpers and Windows apply to a name, which the character mapping
already satisfies. Deleted upstream files are never
unfed: the wiki keeps what it learned, and lint's staleness check is the
backstop.

Only one run per KB proceeds at a time. A second run that starts while one
holds the lock exits 0 with one line and writes nothing.

### Registering the task

From an elevated PowerShell, from the engine checkout or the installed plugin
folder:

```
pwsh -NoProfile -File ./register-task.ps1 -Operation Feed -KbPath ..\example-kb -User '.\kbuser'
```

Feed defaults to `Hourly` and the task name `wiki-feed-<kb folder>`. The
action runs `pwsh -NoProfile -File "<kb>\.claude\feed-inbox.ps1"` with no
Claude call. The registrar runs no trust check for Feed, and
`-SkipTrustCheck` has no effect there. The Feed task's run limit is 1
hour, against 2 hours for Ingest and Lint. Every git call in the feeder
also carries its own timeout and never waits on a credential prompt. A
source's first fetch, which downloads its whole history, may take up to
30 minutes, and later fetches up to 5. The run also holds a 50-minute
budget: no git call waits past it, and the run exits 1 at its next git
call after it, so a stalled remote fails loud within the run and no git
process outlives it. Ending the task by hand in Task Scheduler still
stops only `pwsh`, and a fetch it started can run on. The Grimoire
repository is about 51 MB and clones in seconds over SSH, so these
limits matter only for a much larger repository or a slow link. Run the
feeder by hand once before registering, so every first clone happens
while you watch.

Register the ingest task hourly as well on a fed KB. At the default
four-hour cadence an ingest run drains at most `-MaxFiles` files four
hours apart, about 60 a day. The Grimoire repositories alone produce
about 130 file revisions a day. Hourly ingest raises the ceiling to
`-MaxFiles` an hour, 240 a day at the default. The registrar starts both
tasks at 5 minutes past the hour, so they start together. Ingest snapshots `inbox/`
when it starts, so a file fed at :05 waits for the next hourly ingest. A
feed run that finds the previous batch still in `inbox/` adds nothing, so
intake runs below the ceiling, by as much as half. Each ingested file is
one Sonnet run's worth of work, so the ingest cadence is also the cost
knob.

### Verifying the feeder

1. Run `Start-ScheduledTask -TaskName wiki-feed-<kb folder>` and wait a
   minute. `Get-ScheduledTaskInfo` shows `LastTaskResult` 0.
2. `inbox/` holds new `<source>--...` files, at most `-MaxFiles` of them.
   This also proves the S4U principal can reach the SSH key: an S4U run
   with no access to `%USERPROFILE%\.ssh` fails its fetch and reports a
   non-zero `LastTaskResult`.
3. Open one fed Markdown file and check that its header names the
   repository, path and commit you expect.
4. Run the feeder again by hand with `-WhatIf`. Files already in `inbox/`
   are not listed again.

A non-zero `LastTaskResult` means the run refused. Run the same command by
hand as the owning account and read its one-line reason on stderr.

## The hard invariant, restated

**One Windows account per knowledge base. Never two.** This is not a
preference; it is the boundary between entities.

`Read` and `Glob` are allowed unscoped, and a headless run will read
an absolute path outside its own repo. Credential files are denied, but an
ordinary file is not. So co-locating two entities' KBs under one account puts
one entity's sources within reach of the other entity's agent: a
prompt-injected document dropped into one KB's inbox could instruct the run to
read the other KB's sources and write them into a wiki page that is then
pushed. The repo boundary separates content; the Windows account boundary
separates entities. For two entities whose separation is a legal requirement,
that boundary must never be crossed. Each entity gets its own Windows account,
its own Claude login, its own git credentials, and its own scheduled tasks.

## Troubleshooting

| Symptom | Likely cause | Check |
| --- | --- | --- |
| Task runs but nothing changes | Untrusted workspace | `Select-String -Path run-stderr.txt -Pattern 'Ignoring .* permissions'`; if it matches, trust the KB under the owning account. |
| Task runs but nothing changes | Model too small or unpinned | Confirm the action's arguments contain `--model sonnet`: `(Get-ScheduledTask -TaskName wiki-ingest-eleos-kb).Actions[0].Arguments`. |
| Commits appear but never reach the remote | S4U cannot read Credential Manager for an HTTPS push | `git log origin/main..HEAD` lists commits; try `git push` by hand as that account. If the hand push works, switch the remote to SSH with a passphrase-less key. |
| Commits appear but never reach the remote | No `origin` remote | `git remote` lists no `origin`; add it with `git remote add origin <url>`. |
| A file sits in `inbox/` forever | A name `kb-move.ps1` refuses (a leading dash, a colon, a slash) | The run's report names the file. A human must rename it to a plain leaf name, then it ingests on the next run. |
| The feed task reports a non-zero result | A refused config (an HTTPS or password URL, a bad glob), an unreachable remote, or an S4U run that cannot reach the SSH key | Run `pwsh -NoProfile -File .\.claude\feed-inbox.ps1 -WhatIf` by hand as the owning account and read the one-line reason on stderr. |
| A source is in `sources/` but has no wiki page | A run crashed after moving the file, before committing | `git status --porcelain` shows the untracked `sources/` file. The first ingest run after its files have gone untouched for thirty minutes finishes it in its reconcile step, and an earlier run yields to it. No action is needed unless it persists. |
| Runs keep reporting another run is live | Something other than a run is writing a file outside `inbox/`, such as an editor that saves a page as you type or a hand edit under `.claude/` | `pwsh -NoProfile -File ./.claude/kb-status.ps1 -What Live` in the KB lists each path and its minutes. Finish the hand edit and close the editor. Runs resume once nothing has touched those files for thirty minutes. |
