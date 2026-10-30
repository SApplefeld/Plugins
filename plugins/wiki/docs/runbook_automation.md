# Automating a knowledge base

This is the operator's runbook for putting an account's knowledge bases (KBs)
on a schedule, so each one ingests dropped files and maintains itself with no
one present. It picks up where [instantiation.md](instantiation.md) leaves
off: that document creates, trusts and lists a KB, and this one registers the
one scheduled task that services every listed KB and proves it works. Read it
in order, and do not skip the verification checklist. Two failure modes here
produce a run that looks fine and does nothing, and the checklist catches them
before they cost a silent week. For the design behind the permission model,
the trust gate and the model pin, see [architecture.md](architecture.md).

## What a pass does

One scheduled task per Windows account, `wiki-walk`, runs the walker,
`kb-walk.ps1`, once an hour. A run of it is a pass. The pass reads the
account's wiki list, `%LOCALAPPDATA%\llm-wiki\registry.json`, and visits each
listed KB in turn, one at a time. For each KB it takes these steps in order:

1. **Trust.** It checks that the KB's folder is trusted for Claude Code on
   this account. An untrusted KB is recorded `untrusted` and skipped, since a
   headless run there writes nothing.
2. **Engine update.** Where the engine hash in the `.claude/engine.json`
   committed at the KB's HEAD differs from the installed engine's, it copies
   the new files over `.claude/`, keeping the KB's own `feed.json` and any
   file the engine does not ship, and commits them under the subject
   `Engine: update to <hash8>`, `<hash8>` being the first eight characters of
   the installed engine's hash. Where an uncommitted file in the KB was written in the last thirty minutes, or a merge is left in progress, it copies nothing, records the step `deferred`, and tries again next pass.
3. **Pull.** Where the KB has a remote named `origin`, it fetches and merges
   `origin/main`. A merge that conflicts runs the `wiki-merge` skill, which
   joins both sides of each conflicted wiki page. "Conflicting pulls"
   below says what happens when it cannot.
4. **Feed.** Where the KB has `.claude/feed.json`, it runs the repository
   feeder, which copies new files from the configured repositories into
   `inbox/`.
5. **Ingest.** Where `inbox/` holds a file other than `.gitkeep`, it runs the
   `wiki-ingest` skill.
6. **Lint.** Where the KB's last successful lint is absent or more than seven
   days old, it runs the `wiki-lint` skill.
7. **Push.** Where `origin` exists, it pushes any commit the remote lacks.

A model is called only by a conflicting pull, an ingest with a file waiting,
or a lint that is due. A KB with an empty inbox, a lint done this week and
nothing to merge costs no model call, so an hourly pass over an idle account
spends nothing on Claude.

Every model run goes through the KB's own wrapper, `.claude/kb-run.ps1`,
which runs one command in the KB folder:

```
claude -p "Use the wiki-ingest skill." --model sonnet --permission-mode default
```

with `wiki-lint` or `wiki-merge` in place of `wiki-ingest` for the other two.
The ingest moves each original from `inbox/` into `sources/`, writes a summary
page, revises the wiki pages the source bears on, updates `index.md` and
`log.md`, and commits. Lint finds orphan pages, broken links, missing
cross-references, contradictions and unsourced claims, fixes what it can, and
commits its fixes under a `Lint:` subject.

A plugin update reaches every KB on the next pass. The task runs a launcher
from a folder outside the plugin cache, and the launcher finds the installed
plugin's current version at each start, so the walker is always the installed
one. The walker's engine update then brings each KB's vendored files up to
that version.

## Prerequisites, per Windows account

Every KB is owned by exactly one Windows account, as the hard invariant at the
end of this runbook states. Everything below must be true under that account,
not merely under yours:

- **Claude Code installed and logged in under that account.** Each account
  carries its own Claude login and subscription. A headless run uses that
  account's login, so a walker registered for an account with no Claude login
  services nothing.
- **`pwsh` (PowerShell 7) and `claude` on that account's PATH.** The task runs
  the launcher with `pwsh`, the skills run the KB's helper scripts with
  `pwsh`, and the launcher hands the walker the `claude` it finds on PATH.
- **Git configured with that account's own identity.** Every commit the walker
  makes uses `git config user.email`, and an update or merge with no identity
  is recorded `failed: git identity unset`.
- **Each KB listed and trusted under that account.** A KB made with the
  `wiki-new` skill is both, since `kb-create.ps1` runs `kb-trust.ps1` and
  `kb-registry.ps1 Add`. A KB made by hand takes both steps from
  [instantiation.md](instantiation.md). Trust is per Windows account and per
  exact folder, and it lives in that account's own `~/.claude.json`. The next
  section says why it matters most.
- **A remote over SSH, where the KB has one.** A remote is optional. A KB with
  no `origin` is serviced all the same, with no pull and no push. Where a KB
  has one, the S4U passage below explains why it should be SSH with a key
  file.

## Two silent failure modes

Each of these produces a run that exits cleanly, prints success-shaped text,
and changes nothing. A green exit code catches neither, and the verification
checklist catches both.

### 1. An untrusted workspace

Claude Code ignores `permissions.allow` entirely in a workspace that has not
been trusted. Headless, that means it prompts on every write, gets no answer
because no one is watching, and exits having written nothing. The warning goes
only to stderr. No command-line flag overrides this while a skill is
executing: `--settings`, `--allowedTools` and inline JSON each supply a working
allow list for a direct prompt, but each is ignored under skill execution. The
`deny` rules hold whether or not the workspace is trusted, so trust changes
only what a run may do, never what it is forbidden.

The walker's first step guards against it. It reads trust for each KB from the
running account's `~/.claude.json` and skips an untrusted KB, recording it
`untrusted` in the pass's status file. So an untrusted KB is never a silent
no-op: it is named in every pass until it is trusted. Trust it with
`pwsh -NoProfile -File <engine>\kb-trust.ps1 -Path <kb>` as the owning
account, where `<engine>` is the engine checkout or the installed plugin
folder the README's install paragraph names. Opening Claude Code interactively
in the KB once as that account and accepting the dialog works too.

### 2. An unpinned or too-small model

A model too small for the ingest skill moves nothing and commits nothing while
emitting success-shaped text. An unpinned headless run inherits the harness
default, whatever that is. The wrapper pins `--model sonnet` on every run. A
hand-run check must run the wrapper's exact command, flags included, or it
tests a different thing than the pass runs.

## Registering the walker

Register once per account, from an **elevated** PowerShell (Run as
administrator), logged in as the account that owns the KBs. Registering a
task with an S4U principal requires elevation, and without it the registrar
refuses with a one-line reason. So the owning account must be able to
elevate. The task still runs with a limited token, so a scheduled run holds
no administrator rights. An owning account that cannot elevate cannot
register its walker yet, and the backlog item on registering the walker for
another account holds that decision. Run the registrar from the engine
checkout or the installed plugin folder, whose path instantiation.md gives
under "Step 1: create the repo". Look first with `-WhatIf`, which prints the
definition and registers nothing:

```
pwsh -NoProfile -File ./register-walk.ps1 -User '.\kbuser' -WhatIf
```

Then register:

```
pwsh -NoProfile -File ./register-walk.ps1 -User '.\kbuser'
```

`-User` defaults to the account running the script. `.\kbuser` is read as
this computer's account named `kbuser`. The registrar does two things:

- It copies `Start-InstalledWikiWalk.ps1` and `installed-plugin-functions.ps1`
  into the launcher root, `%LOCALAPPDATA%\llm-wiki\launcher` by default.
  `-LauncherRoot` names another folder, and the registrar refuses one inside
  the plugin cache, which a plugin update replaces.
- It registers `wiki-walk` under the task folder
  `\llm-wiki\<domain>.<account>\`, so each account's task is its own and one
  account's registration never replaces another's. The task's action runs the
  launcher with `pwsh`. Its trigger starts at the next five past the hour and
  repeats hourly. It runs as `-User` with the S4U logon at the Limited run
  level, starts a missed run when the machine is next available, and is ended
  at 2 hours.

The registrar refuses where `pwsh` or `claude` is not on the PATH of the
account running it. It warns where `-User` names another account, since both
were found on the registering account's PATH and the task runs as `-User`.
The default launcher root is also the registering account's own
`%LOCALAPPDATA%`. So register as the owning account, not for it.

To remove the task, run the same command with `-Remove`, which unregisters
only the `-User` account's `wiki-walk`:

```
pwsh -NoProfile -File ./register-walk.ps1 -User '.\kbuser' -Remove
```

A KB serviced by the older per-KB tasks, named `wiki-ingest-<kb folder>`,
`wiki-lint-<kb folder>` and `wiki-feed-<kb folder>`, should have those tasks
unregistered in Task Scheduler before `wiki-walk` is registered, so no run
reaches the KB outside the walker.

### S4U and the push path

The task registers with an S4U (Service For User) principal. It runs whether
or not the user is logged on and needs no stored password. An S4U run cannot
read the account's DPAPI-protected secrets, the store behind Windows
Credential Manager. A `git push` over HTTPS that relies on Credential Manager
can therefore fail from inside the task, even though it succeeds when you run
it by hand while logged on. The verification checklist tests the push path
end to end for this reason.

If the scheduled push fails while a hand-run push succeeds, switch the remote
to SSH with a passphrase-less key, such as a deploy key scoped to that one
repository. A file-based SSH key needs no interactive credential and works
under S4U. `register-walk.ps1` registers S4U only and has no stored-password
option.

## The verification checklist

Run every step, in order, as the owning
account. Each step names the command and the exact observable that proves it.
A registered task is not a working task until this passes. The examples use
the account `kbuser`, and `<kb>` stands for the KB's folder. For a local
account, `<domain>` in a task folder is the computer name.

**1. The task exists and runs as the intended account.**

```
$task = Get-ScheduledTask -TaskPath '\llm-wiki\*' -TaskName wiki-walk
$task.TaskPath
$task.Principal
```

Observable: one task, under `\llm-wiki\<domain>.kbuser\`. `UserId` reads the
owning account's bare name, `kbuser`, with no machine or domain prefix, and
`LogonType` is `S4U`. The registrar registers `.\kbuser` as
`COMPUTERNAME\kbuser`, and Task Scheduler reads a local account back by its
bare name.

**2. The walker sees the account's KBs.** From the engine checkout or the
installed plugin folder:

```
pwsh -NoProfile -File ./kb-walk.ps1 -WhatIf
```

Observable: one line per listed KB, in the order the next pass visits them.
`-WhatIf` reads the list, and the walker's state file for the order. It
takes no lock and writes nothing. A KB missing here is missing from the list, and `kb-registry.ps1
List` shows what the list holds.

**3. A pass runs from the scheduler and names every KB.** Start the task and
wait for it to finish. It has finished when
`(Get-ScheduledTask -TaskPath '\llm-wiki\<domain>.kbuser\' -TaskName wiki-walk).State`
reads `Ready` again:

```
Start-ScheduledTask -TaskPath '\llm-wiki\<domain>.kbuser\' -TaskName wiki-walk
```

Then read the pass's status file:

```
Get-Content "$env:LOCALAPPDATA\llm-wiki\walk-status.json"
```

Observable: `finishedAt` is set and later than when you started the task.
`wikis` holds one entry per listed KB. Each trusted KB reads `result`
`visited`, with its steps under `steps`. No KB reads `untrusted`, and
`failures` is empty. An `untrusted` KB is failure mode 1, named.

**4. Trust is real: the allow list is in force.** Read the launcher's capture
of the pass's error output:

```
Select-String -Path "$env:LOCALAPPDATA\llm-wiki\walk-output.err.log" -Pattern 'Ignoring .* permissions'
```

Observable: no match. A match, whose current wording reads "Ignoring N
permissions.allow entries ... this workspace has not been trusted", means a
model run found its workspace untrusted and every write was silently refused.
Match on `Ignoring .* permissions` rather than a sentence, so a reworded
warning still trips it. This check reads stderr for a warning that may change,
so treat step 5's canary as the decisive proof: a write that lands cannot
happen in an untrusted workspace.

**5. A canary file goes from inbox to pushed commit.** Drop a small readable
file into the KB's `inbox/`, start the task again as in step 3, and wait for
the pass to finish:

```
Copy-Item some-note.txt <kb>\inbox\canary.txt
Start-ScheduledTask -TaskPath '\llm-wiki\<domain>.kbuser\' -TaskName wiki-walk
```

Then confirm every one of these from a shell in the KB's folder:

```
Test-Path .\sources\canary.txt                 # True: the original moved in
Get-ChildItem .\wiki\*canary*summary.md        # the summary page exists
Select-String -Path .\index.md -Pattern canary # index.md names it
Select-String -Path .\log.md   -Pattern canary # log.md has the entry
git log --oneline -1                            # subject begins "Ingest:"
git log origin/main..HEAD --oneline             # empty: the commit reached origin
```

Observable: `canary.txt` is in `sources/` and gone from `inbox/`, a summary
page exists in `wiki/`, `index.md` and `log.md` both name it, and the newest
commit's subject begins `Ingest:`. The KB's entry in `walk-status.json` reads
ingest `ran`. Where the KB has `origin`, `git log origin/main..HEAD` is empty,
which proves the commit reached the remote rather than stranding locally. If
it lists a commit, the push failed, as the S4U passage above describes.

A canary that lands also proves the run met no permission prompt. A headless
run has no dialog to see, so the artifact is the tell. A prompted run leaves
the file unwritten, and the summary page and the commit would not exist.

**6. The task fires on its own schedule.** After a scheduled hour has passed
without you starting it:

```
Get-ScheduledTaskInfo -TaskPath '\llm-wiki\<domain>.kbuser\' -TaskName wiki-walk | Select-Object LastRunTime, LastTaskResult, NextRunTime
```

Observable: `LastRunTime` advances to a time you did not trigger, and
`NextRunTime` is set. `LastTaskResult` of 0 means the pass ran to its end, but
0 alone proves nothing about any KB. The walker exits 0 after every pass
whatever it recorded, because Task Scheduler logs any exit as completion and
never retries. The status file is the report, so read its `startedAt` too. A
non-zero result means the launcher or the walker refused, and the next section
says where the reason is.

## Reading an unattended pass

A scheduled task has no console you watch. Everything a pass did is in files
under `%LOCALAPPDATA%\llm-wiki\` for the owning account:

| File | What it holds | When to read it |
| --- | --- | --- |
| `walk-status.json` | The last pass whole: when it started and finished, the engine hash, one entry per KB with its result and each step's outcome and note, every KB still deferred and every failed step | First, after any pass |
| `walk.log` | One block per pass, a line per step with its seconds, kept across passes and rotated to `walk.log.1` at 5 MB | To see a KB's history over several passes |
| `walk-output.log`, `walk-output.err.log` | The walker's console output and that of the feeds, ingests, lints and merges it ran, overwritten at each pass | To read what a model run or the feeder printed |
| `walk-launcher.log` | One line per launcher refusal, a `WARN` line where `claude` is off PATH or an old snapshot cannot be removed, and an `ERROR` line naming the exit code and the last error line whenever the walker exits non-zero | When `LastTaskResult` is not 0 |

In `walk-status.json`, each KB's `result` is one of `visited`, `untrusted`,
`deferred` or `skipped: budget`. Each step's `outcome` is one of `ran`,
`skipped`, `failed` or `deferred`, with a note saying why. An idle KB reads
`skipped` with the note `inbox empty` for ingest and `not due` for lint. A
step whose outcome is `failed` also appears under `failures`, and the walker
goes on to the next step or KB as that step allows. The walker exits 1 only
where it could not read the list, take its lock or write the status file, or where `KB_WALK_SECONDS` holds a value it refuses or `LOCALAPPDATA` is unset.

A pass holds a budget of 6900 seconds, under the task's 2-hour limit. A KB not
started before the budget runs out reads `skipped: budget`, and the next pass
starts with it. So a long ingest on one KB delays the rest by a pass at most,
and never starves them. `KB_WALK_SECONDS` replaces the budget, as a whole number of seconds from 1 to 99999. Any other value stops the walker with exit 1 before it reads the list.

Inside the KB, two durable records remain:

- **`log.md`.** Every ingest or lint that did work appends one dated heading
  with a bullet per source or fix.
- **`git log`.** Every ingested source is one commit whose subject begins
  `Ingest:`, every completed lint one `Lint:` commit, every engine update one
  `Engine:` commit, and every merge the model joined one `Merge:` commit.

A healthy idle KB and a broken one both make no commits, so `git log` alone
cannot tell them apart. The status file can. A KB whose files sit in `inbox/`
reads ingest `ran` or a reason, never `inbox empty`, and a run that ran but
moved nothing leaves the file in `inbox/` across passes. If dropped files sit
in `inbox/` across several passes and never reach `sources/`, the KB is
broken, not idle, and the troubleshooting table says where to look.

### Conflicting pulls

A pull that conflicts runs the `wiki-merge` skill, which joins both sides of
each conflicted file under `wiki/`, `index.md` and `log.md` into one text that
keeps every claim and citation from each, and commits under the subject
`Merge: join <n> pages from origin`. For each merge it lands, by git or by the
model, the pull's note and `walk.log` name the restore point, the commit the
KB was on before the merge, in the form `restore point <hash>`.
`git reset --hard <hash>`, run as the owning account, returns the KB there,
and the next pass pulls and merges again.

A conflict outside those paths, under `sources/`, `CLAUDE.md` or `.claude/`,
is not the model's to join. The merge run starts, joins nothing and commits nothing, the walker aborts the merge, and
the KB reads `deferred: conflict` with the conflicted paths. The KB's other
steps are skipped that pass. The walker attempts the pull again every pass, so
a fix pushed upstream lands on its own. A KB deferred three passes running is
stuck: the walker still attempts its pull every pass, but starts its model
merge run at most once a day. A conflict on `.claude/settings.json`, the file
holding the deny list, starts no model run at all, since a conflicted settings
file voids the deny list while a model reads third-party text. Such a KB is
stuck from its first pass.

Every deferred KB is listed under `deferred` in `walk-status.json`, with its
reason, its conflicted paths, how many passes it has been deferred and whether
it is stuck, until a pass clears it. To clear one by hand, resolve the
conflict in the KB as the owning account, commit and push. The next pass
reads the pull clean and removes the entry.

### Run locks

Scheduled runs never overlap. The walker holds a lock on
`%LOCALAPPDATA%\llm-wiki\walk.lock` for its whole pass, and a second pass
that finds it held prints one line and exits 0. The walker visits one KB at a
time, and each model run takes the KB's own run lock through `kb-run.ps1`, so
a wrapper run you start by hand cannot overlap a scheduled one either. The
feeder takes its own lock instead, `feed.lock` in the KB's clone folder under
`%LOCALAPPDATA%\llm-wiki-feed\`. An ingest or lint that finds the run lock
held, or a feed that finds `feed.lock` held, is recorded
`skipped: run lock held` and runs next pass.

An interactive Claude Code session in a KB takes no lock, so the walker and
the skills guard against it by reading the KB's live files. Before an ingest
or a lint, and before an engine update, the walker asks whether any uncommitted file outside `inbox/` was written in
the last thirty minutes. If one was, the step reads `deferred: live`, starts
no model run, and is tried again next pass. Each writing skill asks the same
question again before it writes, so a session that starts editing mid-run
makes the run stop with nothing written. A lint that stops that way leaves no
`Lint:` commit, and the walker stamps a lint done only where a `Lint:` commit
landed, so a stopped lint is tried again next pass rather than waiting a
week. While you edit a KB by hand, its passes defer until thirty minutes
after your last save.

The check cannot separate a session and a run that each make their last check
before the other's first write, since each finds nothing live then. The gap
between a run's check and its write is a few agent steps, so the race is
narrow, and the commit history shows it if it happens. Each lint fix records
the exact text it replaces or the gap it fills, and lint drops any fix whose
condition no longer holds, so it never overwrites another writer's edit.

## Repository feeder

A KB whose sources live in git repositories can be fed from them instead of
by hand drops. The feeder, `.claude/feed-inbox.ps1`, copies new and changed
files from configured repositories into `inbox/`, and the same pass's ingest
takes them from there. It is plain PowerShell and never runs Claude, so it
needs no trust and holds no model permissions. No allow rule grants it, and
the KB's settings pin the default permission mode, so the KB's own agent
cannot run it or edit its configuration.

### Configuring the sources

The feeder reads `.claude/feed.json` in the KB, and the walker runs it only
where that file exists:

```json
{
  "sources": [
    {
      "name": "handbook",
      "url": "git@github.com:example-org/handbook.git",
      "branch": "main",
      "include": ["README.md", "docs/*.md", "policies/**/*.md"],
      "exclude": ["docs/archive/**"]
    }
  ]
}
```

The `name` is a short label that prefixes every fed file. The `url` must be an
SSH URL or a local path. The feeder refuses an `https://`, `http://` or
`git://` URL and any URL carrying a password. That rule exists because the URL
is written into each fed file's provenance header, and a fed file is moved
into the immutable `sources/` and pushed. A token in the URL would be
published for good. SSH also suits the scheduled task: an S4U run cannot read
Credential Manager, so an HTTPS source would fail there anyway.

Commit `feed.json` with the KB. Only a person edits it.

### Running it by hand first

From the KB folder, as the owning account:

```
pwsh -NoProfile -File .\.claude\feed-inbox.ps1 -WhatIf -MaxFiles 1000
```

`-WhatIf` lists every file the feeder would add and writes nothing to
`inbox/`. It still fetches, because it cannot know what it would feed without
the current tree. The first run also creates the feeder's private clones
under `%LOCALAPPDATA%\llm-wiki-feed\`. The feeder never touches any other
checkout of those repositories. Read the list and tighten `include` or
`exclude` until it holds what the wiki should learn and nothing else. Run the
feeder by hand once before the first pass, so every first clone happens while
you watch.

### What a feed does

Each feed adds at most `-MaxFiles` files, 10 by default, and adds nothing
while `inbox/` already holds that many. A large backfill therefore flows in
batches, one batch a pass, each ingested by the same pass's ingest step. Files
no earlier run has fed go first, taken in turn from each source, and new
revisions of already-fed files follow. A busy repository therefore cannot
starve a quiet one. Each fed file is one Sonnet run's worth of ingest, so the
batch size is also the cost knob.

A fed file is named `<source>--<path with / as -->--<blob sha 7>.<ext>`. Any
character outside letters, digits, `.`, `_` and `-` becomes `-`, so a name is
always one the ingest helpers accept and the agent's shell cannot expand. A
Markdown or text file gains a short provenance header naming the repository,
path, commit and commit date. The wiki's schema uses it to tell a newer
revision of a document from an older one. A changed upstream file is fed once
per new revision, and an unchanged file is never fed again. The feeder decides
this from the names already in `inbox/` and `sources/`, so it keeps no state
file.

A file the feeder will not feed is skipped with a warning on stderr and
added to the refusal count. A fed name containing `..` or longer than 150 characters,
and a file over 25 MB, are among the cases, and the header of
`.claude/feed-inbox.ps1` lists them all. Deleted upstream files are never
unfed: the wiki keeps what it learned, and lint's staleness check is the
backstop.

Every git call the feeder makes carries its own timeout and never waits on a
credential prompt. A source's first fetch, which downloads its whole history,
may take up to 30 minutes, and later fetches up to 5. The walker gives the
feeder a budget of 3000 seconds, or the pass's remaining budget where that is
smaller, and the feeder exits 1 at its next git call past it. A feed that
fails is recorded `failed` with the feeder's reason, and the pass goes on to
the KB's ingest.

### Verifying the feeder

1. Start the task as in checklist step 3 and wait for the pass to finish. The
   KB's entry in `walk-status.json` reads feed `ran`.
2. Its ingest read `ran` too, and `sources/` holds new `<source>--...` files,
   at most `-MaxFiles` of them. This also proves the S4U principal can reach
   the SSH key: an S4U run with no access to `%USERPROFILE%\.ssh` fails its
   fetch and records the feed `failed`.
3. Open one fed Markdown file in `sources/` and check that its header names
   the repository, path and commit you expect.
4. Run the feeder again by hand with `-WhatIf`. Files already fed are not
   listed again.

## The hard invariant, restated

**One Windows account per knowledge base. Never two.** It is the boundary
between entities.

`Read` and `Glob` are allowed unscoped, and a headless run will read an
absolute path outside its own repository. Credential files are denied, but an
ordinary file is not. So putting two entities' KBs under one account puts one
entity's sources within reach of the other entity's agent. A prompt-injected
document dropped into one KB's inbox could instruct the run to read the other
KB's sources and write them into a wiki page that is then pushed. The
repository boundary separates content, and the Windows account boundary
separates entities. For two entities whose separation is a legal requirement,
that boundary must never be crossed. Each entity gets its own Windows account,
its own Claude login, its own git credentials and its own `wiki-walk` task,
and each account's walker reads only that account's wiki list.

## Troubleshooting

| Symptom | Likely cause | Check |
| --- | --- | --- |
| A KB reads `untrusted` | The KB is not trusted for this account | Run `kb-trust.ps1 -Path <kb>` as the owning account, or open Claude Code in the KB once and accept the dialog. |
| An ingest reads `ran` but the file stays in `inbox/` | The KB is untrusted, so the model run wrote nothing, or the model is too small | `Select-String -Path "$env:LOCALAPPDATA\llm-wiki\walk-output.err.log" -Pattern 'Ignoring .* permissions'`; if it matches, trust the KB. Otherwise read `walk-output.log` for the run's own report. |
| Commits appear but never reach the remote | S4U cannot read Credential Manager for an HTTPS push | The KB's push reads `failed`, and `git log origin/main..HEAD` lists commits. Try `git push` by hand as that account. If the hand push works, switch the remote to SSH with a passphrase-less key. |
| A KB reads `deferred: conflict` | A pull conflicted where the model may not join it, or the merge run could not finish | The `deferred` list names the paths. Resolve the conflict in the KB as the owning account, commit and push. "Conflicting pulls" above has the detail. |
| A step reads `deferred: live` pass after pass | Something other than a run is writing a file outside `inbox/`, such as an editor that saves as you type | `pwsh -NoProfile -File ./.claude/kb-status.ps1 -What Live` in the KB lists each path and its minutes. Close the editor, and the step runs thirty minutes after the last write. |
| A step reads `failed: git identity unset` | The owning account has no git identity | Set `git config --global user.name` and `user.email` as that account. |
| A KB reads `skipped: budget` every pass | One KB's runs take the pass's whole 6900-second budget | Read `walk.log` for the step's seconds. A large backfill settles once the inbox drains. |
| A file sits in `inbox/` forever | A name `kb-move.ps1` refuses, such as a leading dash, a colon or a slash | The run's report in `walk-output.log` names the file. A person renames it to a plain leaf name, and it ingests on the next pass. |
| The feed reads `failed` | A refused config, such as an HTTPS or password URL or a bad glob, an unreachable remote, or an S4U run that cannot reach the SSH key | Run `pwsh -NoProfile -File .\.claude\feed-inbox.ps1 -WhatIf` by hand as the owning account and read the one-line reason on stderr. |
| `LastTaskResult` is not 0 | The launcher refused, or the walker could not read the list, take its lock or write the status, or `KB_WALK_SECONDS` holds a value the walker refuses | Read the last lines of `walk-launcher.log`, which name the reason or the walker's exit code and last error line. |
| A source is in `sources/` but has no wiki page | A run crashed after moving the file, before committing | `git status --porcelain` shows the untracked file. The first ingest after its files have gone untouched for thirty minutes finishes it in its reconcile step. No action is needed unless it persists. |
