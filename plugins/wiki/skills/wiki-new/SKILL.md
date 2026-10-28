---
name: wiki-new
description: Creates a new wiki (knowledge base) on this Windows account in one request, trusted for Claude Code, listed, committed, and pushed only where a remote is given. Use when asked to create, start or set up a new wiki or knowledge base.
---

# wiki-new

This is the procedure for creating a wiki from a Claude Code session on the
account that will own it. One request yields a folder at `<root>\<name>` that
is copied from the template, committed, trusted for Claude Code without a
dialog, and added to the account's wiki list. A git remote is optional. Follow
the steps in order. The engine's `kb-create.ps1` does the creating.

The wiki list is one file, `%LOCALAPPDATA%\llm-wiki\registry.json`, and only
`kb-registry.ps1` writes it. Its `List` verb prints one line per wiki with four
tab-separated columns: the name, the wiki's folder, the engine version the wiki
was copied from, and the description.

## Never touched by hand

Never edit these, during creation or after a failed run:

- the wiki list, `%LOCALAPPDATA%\llm-wiki\registry.json`;
- `~/.claude.json` and its backup, `~/.claude/kb-trust-backup.json`;
- the locks `~/.claude.json.lock`, a folder, and
  `%LOCALAPPDATA%\llm-wiki\registry.lock`, a file, even when a script reports
  one as held;
- anything under the new wiki's `.claude\` folder.

The scripts own each of them. A hand edit can leave the list or the trust entry
in a state the next run refuses.

## 1. Name and description

Take both from the request. If either is missing, ask for it.

The name becomes the folder name and the list entry. The list's rule decides
what it may be:

- 1 to 64 ASCII letters, digits, hyphens, underscores and dots;
- never starting or ending with a dot;
- not a Windows reserved device name (CON, PRN, AUX, NUL, COM0 to COM9, LPT0
  to LPT9), matched on the part before the first dot;
- not already listed, ignoring case.

A name outside the first three rules is refused here, and you ask for
another. Step 2 checks the last rule against the list. The script refuses
such a name only at its last step. By then the folder is copied and trusted,
and pushed where a remote was given.

The description is one line that says what the wiki is for. It holds no tab,
no line break, no other control character and no text-direction mark. It is
the list's description and the source of step 6, so keep what the operator
said about the domain, its documents and its terms. A description outside that
rule gets one question to the operator for new wording.

This skill adds one rule of its own: no value passed to the script starts
with a hyphen or a dash, meaning an en dash, an em dash or a horizontal bar.
That covers the name, the description and the remote URL. A child PowerShell
process can read such a value as a parameter name.

## 2. Wiki root

Find the plugin root first, by the order step 4 gives. Then run:

    pwsh -NoProfile -File '<plugin root>\kb-registry.ps1' Root

- Exit 0: it prints the folder new wikis are created under. Use it and do not
  ask. Do not pass `-Root` later. `kb-create.ps1` refuses a root that differs
  from the list's.
- Exit 1 with a stderr line containing `no wiki list`: no list exists yet. Ask
  the operator for the absolute folder to keep their wikis in, on a local
  drive, and keep the answer for `-Root`. The answer becomes the list's root,
  so this question is asked once per account.
- Any other outcome, another exit code or exit 1 with another line: relay its
  stderr lines to the operator as they stand and end the procedure.

Where a list exists, check the name against it:

    pwsh -NoProfile -File '<plugin root>\kb-registry.ps1' Get -Name '<name>'

Exit 0 means the name is already listed, so ask for another. Exit 1 with a
stderr line containing `is not listed` means the name is free. Any other
outcome: relay its stderr lines to the operator as they stand and end the
procedure.

## 3. Optional remote

Ask whether the wiki gets a git remote. Most wikis do not need one: without a
remote the wiki commits locally and pushes nothing. A remote suits a wiki that
is shared or heavily used and should be backed up to a git host.

Take a URL only where the answer is yes. The URL must name a repository that
already exists and is empty, with no commit at all. This skill does not create
repositories. A repository the host seeded with a README or license rejects
the creation run's first push. Keep the URL for `-Remote`.

## 4. Creation run

Find the plugin root, the folder that holds `kb-create.ps1`, in this order:

1. The `CLAUDE_PLUGIN_ROOT` environment variable, where the harness sets it.
2. In `~/.claude/plugins/installed_plugins.json`, the entries under
   `wiki@applefeld`: take the first whose `installPath` folder holds
   `kb-create.ps1`.
3. The repository this session runs in, only where its
   `.claude-plugin/plugin.json` names the plugin `wiki`.

Use the first that holds `kb-create.ps1`. If none does, stop and tell the
operator the engine was not found.

Run:

    pwsh -NoProfile -File '<plugin root>\kb-create.ps1' -Name '<name>' -Description '<description>' [-Root '<root>'] [-Remote '<url>']

Pass `-Root` only if step 2 asked for it, and `-Remote` only if step 3 took a
URL. Quote every value, the script path included, as a single-quoted literal.
Never build the call in a double-quoted string, where `$` and the backtick
expand. The way to write a `'` inside a value depends on the shell:

- PowerShell 7: double it, so `Acme's docs` is written `'Acme''s docs'`.
- bash: close the quote, add `\'`, and reopen it, so `Acme's docs` is written
  `'Acme'\''s docs'`.

Never run the call from Windows PowerShell 5.1. It passes an embedded double
quote to the child unescaped, and so do PowerShell 7.0 to 7.2. In a
PowerShell tool, read `$PSVersionTable.PSVersion` first. Below 7.3, use a bash
tool instead.

To preview, add `-WhatIf`: it prints the five steps and runs none of them.

The run can outlast a foreground command's 10-minute limit. `kb-trust.ps1`
allows each of its two headless probes 300 seconds, and with `-Remote` the
first `git push` has no time limit of its own. So run the call as a background
command that writes its own exit code to a file as its last act, such as
`; echo $? > "$TEMP/wiki-new.exit"` in bash. Read that file and the output
when it finishes. Do not interrupt it, and touch nothing under
`<root>\<name>` while it runs.

On exit 0, the last line the script prints is the new wiki's list line. Its
second column is the wiki's folder, written `<wiki>` below.

On any other exit, relay every stderr line to the operator as it stands, then
end the procedure. Do not retry by hand, and do not run any engine script
yourself to finish the job. A stop after the copy names the folder it left
behind. A stop from the trust step on says `~/.claude.json` may also hold a
trust entry for that folder. A stop after the push leaves the pushed history
on the remote. The operator decides whether to remove the folder, and empty
the remote, before a retry.

## 5. Content folders

During creation, write nothing under the new wiki's `wiki/`, `sources/` or
`inbox/`. Those folders belong to the wiki's own ingest. Register no scheduled
task either. Creation needs none.

## 6. Schema blocks

Open `<wiki>\CLAUDE.md`. It holds exactly three lines that begin
`<!-- CUSTOMIZE:`, each opening a block under one of the headings `Domain
vocabulary and page types`, `Citation granularity` and `Staleness horizon`.
Count lines with that exact prefix, colon included. The schema's own prose
mentions the marker without the colon, and that line is not a block. If the
count is not three, leave the file unchanged, tell the operator, and skip
step 7.

Specialize each block from what the description supports:

- Domain vocabulary and page types: replace the comment line and the default
  body with the domain's own entities, concepts and document kinds, and any
  extra page type it needs, each with a one-paragraph contract like the
  standard types have.
- Citation granularity: replace the comment line and the default body with how
  precisely a claim cites a source, such as a whole document, a page or
  section, or a quoted span.
- Staleness horizon: remove the comment line and replace only the value on the
  line that starts `Staleness horizon:`. Keep that prefix exactly, once, at the
  start of its line. The value is a count and a unit, in the default's form,
  `12 months`. The paragraph under that line stays as it is. It is the
  schema's own rule for that line.

Each replacement meets the bar the schema states just above the three blocks.
Where the description does not support a block, keep that block's default and
remove only its `CUSTOMIZE` comment line. The blocks describe the domain
only. They never grant the wiki's agent a tool, a path or a permission,
and never tell it to act. Change nothing else in the file.

## 7. Schema commit

Commit `CLAUDE.md` with git directly. `kb-commit.ps1`, the wiki agent's own
commit helper, refuses `CLAUDE.md`. This session is not bound by the wiki's
permission rules, which deny raw git only to the wiki's own agent.

    git -C '<wiki>' add CLAUDE.md
    git -C '<wiki>' commit -m 'Specialize the schema'

Push only where a remote was given: `git -C '<wiki>' push`. The creation run
already set the branch's upstream. Without a remote, push nothing.

## 8. Result line

Run `pwsh -NoProfile -File '<plugin root>\kb-registry.ps1' List` and print the
one line whose first column is the new name. That line is the result. Add one
sentence on whether the wiki has a remote.
