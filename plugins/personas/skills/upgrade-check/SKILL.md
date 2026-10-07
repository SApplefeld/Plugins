---
name: upgrade-check
description: "Checks a new Claude Code build on one canary persona, in a half before its restart and a half after, before any other persona restarts onto it. Use when the operator asks for the upgrade check or types upgrade-check in this persona's thread, or when a new Claude Code build is on disk and no persona has restarted onto it yet."
---

# Upgrade check

Run this on one persona, the canary, before any other persona restarts onto a new Claude Code build. The plugin hooks into Claude Code through an early-access interface that can change between releases without notice. A new build can therefore break the plugin with no error at install. The check has two halves. The first runs before this session restarts, and the second runs in the session that comes back.

`bin/upgrade-check.mjs` in the plugin's installed copy does the mechanics. This skill says how to call it, how to read what it prints, and what to tell the operator. Never run the steps by hand, and never judge a verdict the script did not print.

## Inputs

Resolve each value below before running anything.

- **The script.** Read the installed copy's folder from `~/.claude/plugins/installed_plugins.json`: the `installPath` of the entry under `personas@applefeld` with the newest `lastUpdated`. For example, `node -e "const r=require(require('os').homedir()+'/.claude/plugins/installed_plugins.json').plugins['personas@applefeld'];console.log(r.slice().sort((a,b)=>Date.parse(b.lastUpdated)-Date.parse(a.lastUpdated))[0].installPath)"`. The script is `bin/upgrade-check.mjs` under that folder.
- **The working directory.** Run both `pre` and `post` from this persona's working directory. The script finds the running session's version in the transcript folder that directory names. Run from anywhere else, it reads the version as `unknown`, and `post` then fails its version check on a healthy build.
- **`--repo`.** The checkout the fleet's scheduled tasks start personas from, `<checkout>/plugins/personas`, the repository checkout's `plugins/personas` folder. Its `node_modules/typescript` must exist, from `npm install` run there once. Without it the compile step reads `fail` and the verdict is triage.
- **`--results`.** The directory that holds the fleet roster, `D:/personas` on the fleet machine. The rows land in `upgrade-checks.jsonl` there, and `upgrade-checks.md` beside it is regenerated from them. Never point it at a scratch folder for a real run, or the next canary cannot find the record.
- **`--canary`.** This persona's name, so the table says which persona ran it.
- **The run directory.** The folder holding this persona's `heartbeat.json`, `settings.json` and `supervisor.log`. It is the directory of the file `$SUPERVISOR_HEARTBEAT_PATH` names.
- **The coordinator persona.** The `coordinatorPersona` value in `<run directory>/settings.json`.
- **A log folder.** Any folder outside `--repo` you can write to, such as your system temp folder. It holds the run's output and exit code.

The script makes its own scratch folder, `cc-validate-<version>` under the system temp folder, and marks it with a `.upgrade-check-scratch` file. It empties that folder at the start of each run.

## What the steps check

`pre` runs seven steps, and the rows and verdicts name them by number:

1. **versions**: the build on disk, and the build this session runs.
2. **types**: regenerates the plugin interface's type definitions from the new build.
3. **diff**: what changed in that interface, and which changed names the plugin's code uses.
4. **compile**: the plugin's code against the new types. A control file the compiler must reject proves the compile can fail.
5. **validate**: `claude plugin validate`, which reads what Claude Code would refuse to load.
6. **engine**: `claude plugin test`, the plugin's own tests run by Claude Code itself.
7. **smoke**: one short headless prompt, with its debug log read for the plugin being skipped or refused.

`post` adds three rows after the restart: the version the new session runs, the heartbeat advancing, and `supervisor.log` since the launch. It adds a fourth row for your tool checks.

## Before the restart

1. Run `pre` with the Bash tool's background option, since it can run 18 minutes when six steps each reach their three-minute timeout. The command writes its own exit code, so read the result from that file rather than from the task finishing:

   ```
   node <script> pre --repo <checkout>/plugins/personas --results D:/personas --canary <persona> > <log folder>/upgrade-pre.log 2>&1; echo $? > <log folder>/upgrade-pre.exit
   ```

2. Read the exit code from `upgrade-pre.exit`, and the last line of `upgrade-pre.log` for the verdict. The lines above it are one per step, as `<step>: <result> - <evidence>`.
   - **Exit 0, `pre: clear to restart the canary onto <version> (run <id>)`.** Go to step 3.
   - **Exit 1, `pre: triage <steps> (run <id>)`.** Reply to the operator as the last section says, and stop. Do not restart unless the operator then tells you to restart anyway. In that case, go on from step 3.
   - **Exit 2, `upgrade-check: cannot run: <reason>`.** Nothing was recorded. Fix what the reason names if it is yours to fix, and send the operator the reason otherwise. One reason is a scratch folder that holds files but no `.upgrade-check-scratch` marker, which means the script did not make it. Delete it by hand only after reading what is in it, or pass `--scratch` naming an empty folder.
   - **Exit 3, `upgrade-check: failed: <reason>`.** The script hit an error it has no verdict for. Its rows may be partly recorded. Do not restart, and send the operator the reason and the path of `upgrade-pre.log`. The rows it did record are in `upgrade-checks.jsonl` under `--results`.
   - **Any other last line.** The script crashed before it could print a line of its own. Read it as exit 3, whatever the exit code says.
3. Create the goal that carries the second half, with `goal_create`. The new session starts with no memory of this one, and the goal tree is what survives the restart. The objective must name this skill, the run id from the verdict line, and the whole `post` command, for example:

   > Finish upgrade check run <id> by following the upgrade-check skill's "After the restart" section. Call goal_status, call agentic_inbox on <coordinator persona>, and send one relay reply. Then run: node <script> post --run <id> --results D:/personas --rundir <run directory> --tools "ok", or --tools "fail: <which call failed and how>".

4. Call `supervisor_restart` with the reason "upgrade check run <id>: restarting the canary onto <version>".

## After the restart

The goal carries the commands, and this section says how to read them.

1. Call `goal_status`, `agentic_inbox` on the coordinator persona, and send one relay reply. A call works when it returns its result rather than an error. An empty inbox counts as working. Pass `--tools "ok"` where all three worked, else `--tools "fail: <reason>"` naming the one that did not.
2. Run the `post` command from the goal. It takes one heartbeat interval plus five seconds, 35 seconds by default, since it watches the heartbeat advance. Its exit codes read as `pre`'s do. On exit 3, or a last line that is not a verdict, send the operator the reason from the command's output.
3. Reply to the operator as the last section says.
4. Call `goal_done` on the goal.

## Reading the results

- **Step 6 reads `gap` on every run today.** The plugin has no engine tests, so there is nothing for `claude plugin test` to run. A gap does not block the verdict. `skipped` means the build no longer has the `test` subcommand, and it reads as triage.
- **Step 7 proves only that the plugin loads.** Its hooks stay passive in the empty scratch folder, so the turn hooks get their first real test at the canary restart.
- **The supervisor's launch check writes `FAIL` lines for about ninety seconds after the restart.** That check waits for the old session's heartbeat to go stale before it launches the new one. The lines are expected, and `post` reads only what follows the new `LAUNCH child-` line, so they do not affect the verdict.
- **A second run appends.** Rerunning on the same build adds a new run under the same version heading and overwrites nothing, so the table is the record of every attempt.
- **A failed `post` leaves the canary on the new build.** The check has no rollback, and Claude Code keeps whichever build is installed. Name the failing rows so the operator can decide whether the rest of the fleet waits.

## What to tell the operator

The operator reads your reply on Discord and cannot open files. Send the verdict line with its `(run <id>)` part removed, then one plain sentence on what it means:

- `pre` clear: the build passed the checks a session can run before restarting, and you are restarting onto it now.
- `pre` triage: the build failed the named steps, and you have not restarted. Add each failing step's name, what it checks from the list above, and its evidence line. Say they can reply "restart anyway" to go on, or leave the fleet where it is while the plugin's owner looks.
- `post` clear: the rest of the fleet can restart onto the build.
- `post` triage: you are running the new build and the named checks failed, so the rest of the fleet should wait. Add each failing row's evidence.

End with where the full record is, `upgrade-checks.md` in `D:/personas`, and offer to read it back.
