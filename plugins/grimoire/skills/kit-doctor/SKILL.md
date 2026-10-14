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
- **`-Fix` only on my word:** it prompts before installing anything. It runs `memq db-refresh` unprompted where the memory database step warns. On consent, it also removes the retired sidecar's scheduled task and state folder and stops its daemon. On consent, the embedding server repair also deletes and fetches again a pinned download under `~/.claude/kit-embedding-server` whose digest differs, replaces the server's `llama` folder there where the archive is missing or differs from its pin, or the folder holds no `llama-server.exe`, and re-registers a scheduled task `KitEmbeddingServer` whose definition drifted. Beyond those, it deletes only temp files and backups its own run wrote.
- **`-Fix -Yes` only on my word:** for an unattended run, or through a tool shell after my yes in chat. `-Yes` pre-answers the consent prompts `-Fix` already asked for. It authorizes nothing by itself, so name that before running it. It never answers the embedding server's prompt to replace a loopback URL or model already in the config, which needs me at the keyboard. The doctor declines prompts on a redirected stdin, so for an install through a tool shell, ask me in chat first.

## Reading the Report

- Exit 0 with warnings is a working install with named gaps. Exit 1 is a report that found something broken, or no report at all when the doctor rejected an unknown flag. The report body tells them apart. With no report no checks ran, so fix the command line, not the install.
- A `Doctrine import` WARN that the installed copy differs usually means the plugin lags the clone, or the reverse. The doctrine-refresh hook resyncs next session once the plugin is current. Never copy doctrine files by hand.
- `memq shim` names its remedy on the line.
- `Embedding server` names its remedy on the line. A `-Fix` WARN installs, repairs or restarts the machine's loopback server, and a first install downloads 654 MB. Where my account cannot register a boot task, it prints one line to run in an elevated PowerShell, and a second `-Fix` starts the server. A WARN saying the server is starting clears by waiting and re-running. A WARN naming an unmanaged server has no fix until I stop the process that owns the port. A FAIL naming another model or width has no fix, since only I know whether the config or the server is right. An INFO on a machine with no config that names the boot task has no fix, and the line carries the removal command for me to run.
- `memq db-refresh` clears the `Memory database` WARN for queued rows, once its printed failure is fixed. It never clears a WARN naming a missing `pwsh` or `node`, which is a prerequisite to install.
- A `Memory database` INFO naming old memory files lists what is still on disk, the migration marker's time and twin count, what to carry over first, and the `Remove-Item` commands that delete them. The commands are the operator's to run after reading the marker, and `-Fix` never runs them.

After `-Fix`, re-run check mode under the doctrine's "Run the real thing before you call it done", and name what the fix changed on the machine under its "Name any shared or local state you altered outside the code".
