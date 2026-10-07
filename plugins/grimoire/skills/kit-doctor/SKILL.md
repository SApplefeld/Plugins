---
name: kit-doctor
description: "Validates and repairs this machine's grimoire installation. Use when the kit was just installed or updated on a machine, when a kit capability misbehaves (hooks, memory tooling, doctrine not loading), or when the operator asks to run the doctor, check the install, or verify kit setup."
---

# Kit Doctor

## Locate the Doctor

Take the first path that exists:

1. `<plugin root>\doctor\doctor.cmd`, the installed copy, with the root from `CLAUDE_PLUGIN_ROOT` or else this skill's base directory's grandparent.
2. `<kitRepoPath>\plugins\grimoire\doctor\doctor.cmd`, with `kitRepoPath` from `~/.claude/grimoire.local.json`.
3. `doctor.cmd` at the cwd's repo root, inside a kit clone.

Path 1's report is the verdict on the machine. `claude plugin update` is the remedy when the installed cache lags the clone. Run path 2 to check the clone, never to get a better answer about the install. On a clone run, an INFO reading `trails the checkout in hand` means the machine matches the installed copy, and `-Fix` from the clone changes nothing there.

Before running a located `doctor.cmd`, confirm it is the kit's. Path 1 needs `..\.claude-plugin\plugin.json` beside its parent, and paths 2 and 3 need `plugins\grimoire\.claude-plugin\plugin.json` under the same root. Surface one that fails instead of running it.

Always invoke the `.cmd` wrapper, not the `.ps1`.

## Check and Fix Modes

- **Check first, always:** run with no flags and show me the PASS/WARN/FAIL lines. Read each WARN and FAIL in one line: what it breaks and its printed remedy.
- **`-Fix` only on my word:** it prompts before installing anything. Its repairs include installing the local embedding stack and committing the store's sync through its gated allowlist. It runs `memq db-sync` unprompted where the memory database step warns. On consent, it also removes the retired sidecar's scheduled task and state folder and stops its daemon. Beyond those, it deletes only temp files and backups its own run wrote.
- **`-Fix -Yes` only on my word:** for an unattended run, or through a tool shell after my yes in chat. `-Yes` pre-answers the consent prompts `-Fix` already asked for. It authorizes nothing by itself, so name that before running it. The doctor declines prompts on a redirected stdin, so for an install through a tool shell, ask me in chat first.

## Reading the Report

- Exit 0 with warnings is a working install with named gaps. Exit 1 is a report that found something broken, or no report at all when the doctor rejected an unknown flag. The report body tells them apart. With no report no checks ran, so fix the command line, not the install.
- A `Doctrine import` WARN that the installed copy differs usually means the plugin lags the clone, or the reverse. The doctrine-refresh hook resyncs next session once the plugin is current. Never copy doctrine files by hand.
- Read `Memory sync` before any push. Its FAIL means credentials are in reach. The store root holds `.credentials.json`, `settings.json`, `history.jsonl` and every session transcript, and the repository there admits only the memory tiers and the machine coordinator directory. PASS means the allowlist is canonical and all four probes answered clean. The WARN that the store root is not a repository yet means nothing syncs or is at risk, and `-Fix` initializes it. Its other WARNs are not `-Fix`'s to clear, so read their remedy or gap on the line.
- Every `Memory sync` FAIL is a stop-and-read, and each class has its own remedy:
  - A managed file the doctor did not write, or a repository it did not create, is one it leaves alone. Review it by hand.
  - A drifted or missing allowlist lets an add stage anything. `-Fix` restores it.
  - Named leak paths are tracked or reachable in history. `-Fix` cannot clear them, since untracking leaves the blob. Rewrite history and rotate credentials.
  - Probes that could not answer leave the negative unproven, not clean, so they fail rather than warn.
- `memq shim` and `Embedder (semantic search)` name their remedy on the line. With the embedder absent, `memq find` still works lexical-only. Its install costs about 400 MB of disk, which `-Fix`'s consent prompt names. An absent or empty index is normal before a machine's first semantic query.
- `memq db-sync` clears the `Memory database` WARN for queued rows or no clean publish in seven days, once its printed failure is fixed. It never clears a WARN naming a missing `pwsh` or `node`, which is a prerequisite to install.

After `-Fix`, re-run check mode under the doctrine's "Run the real thing before you call it done", and name what the fix changed on the machine under its "Name any shared or local state you altered outside the code".
