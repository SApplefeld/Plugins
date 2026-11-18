---
name: upgrade-check
description: "Checks a new Claude Code build on one canary persona, in the canary's two halves before and after its restart, before any other persona restarts onto it. A third command reads which model each persona landed on, once the operator asks for it. A fourth command counts what one persona did on each side of a model change. Use when the operator asks for the upgrade check or types upgrade-check in this persona's thread, when a new Claude Code build is on disk and no persona has restarted onto it yet, when the operator asks for the landing check, or when the operator or the coordinator persona asks for the behavior count. A fleet restart alone is no trigger for the landing check."
---

# Upgrade check

Run this on one persona, the canary, before any other persona restarts onto a new Claude Code build. The plugin hooks into Claude Code through an early-access interface that can change between releases without notice. A new build can therefore break the plugin with no error at install. The canary's check has two halves. The first runs before this session restarts, and the second runs in the session that comes back. A third command, `landing`, reads which model each persona landed on, once the operator asks for it. A fourth command, `behavior`, counts what one persona's sessions did on each side of a model change, once the operator or the coordinator persona asks for it.

`bin/upgrade-check.mjs` in the plugin's installed copy does the mechanics. This skill says how to call it, how to read what it prints, and what to tell the operator. Never run the steps by hand, and never judge a verdict the script did not print.

## Inputs

Resolve each value below before running anything.

- **The script.** Read the installed copy's folder from `~/.claude/plugins/installed_plugins.json`: the `installPath` of the entry under `personas@applefeld` with the newest `lastUpdated`. For example, `node -e "const r=require(require('os').homedir()+'/.claude/plugins/installed_plugins.json').plugins['personas@applefeld'];console.log(r.slice().sort((a,b)=>Date.parse(b.lastUpdated)-Date.parse(a.lastUpdated))[0].installPath)"`. The script is `bin/upgrade-check.mjs` under that folder.
- **The launch directory.** The script reads the running session's version from the transcript folder of the directory it runs in. That must be the directory this session was launched in, which stays the same however far the shell moves. For a persona the supervisor starts, it is the directory of the file `$HEARTBEAT_PATH` names. So run both `pre` and `post` with the shell in the launch directory, and move the shell there first where a tool call has moved it. Run from anywhere else, it reads the version as `unknown`, and `post` then fails its version check on a healthy build.
- **`--repo`.** The plugin folder the check reads the hooks, the saved type files and the compiler from. On a machine whose scheduled tasks start personas from a repository checkout, it is `<checkout>/plugins/personas`, that checkout's `plugins/personas` folder. On a machine registered from the installed plugin, with no checkout, it is the installed copy's folder, the one the script input above resolves. Its `node_modules/typescript` must exist in either shape, and `npm install` run once in that folder lays it where it is missing. Without it the compile step reads `fail` and the verdict is triage.
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

1. Run `pre` in the foreground, with the Bash tool's `timeout` set to 600000. Do not set `run_in_background`. Step 3 creates a goal, and the plugin starts a new goal tree only in a turn the operator, the coordinator persona or the architect persona's `[QUEUE]` record started. A background run's finish opens a turn of its own, which is none of these, so `goal_create` would be refused there. The command writes its own exit code, so read the result from that file rather than from the tool's result:

   ```
   node <script> pre --repo <plugin folder> --results D:/personas --canary <persona> > <log folder>/upgrade-pre.log 2>&1; echo $? > <log folder>/upgrade-pre.exit
   ```

   Where the tool's result says the command was moved to the background, let it run. Read `upgrade-pre.exit` in the turn the run's finish opens, and go on from step 2. `pre` can run 18 minutes when six steps each reach their three-minute timeout, and a command still running at the tool's timeout is moved to the background and keeps running.

2. Read the exit code from `upgrade-pre.exit`, and the last line of `upgrade-pre.log` for the verdict. The lines above it are one per step, as `<step>: <result> - <evidence>`.
   - **Exit 0, `pre: clear to restart the canary onto <version> (run <id>)`.** Go to step 3.
   - **Exit 1, `pre: triage <steps> (run <id>)`.** Reply to the operator as `## What to tell the operator` says, and stop. Do not restart unless the operator then tells you to restart anyway. In that case, go on from step 3.
   - **Exit 2, `upgrade-check: cannot run: <reason>`.** Nothing was recorded. Fix what the reason names if it is yours to fix, and send the operator the reason otherwise. One reason is a scratch folder that holds files but no `.upgrade-check-scratch` marker, which means the script did not make it. Delete it by hand only after reading what is in it, or pass `--scratch` naming an empty folder.
   - **Exit 3, `upgrade-check: failed: <reason>`.** The script hit an error it has no verdict for. Its rows may be partly recorded. Do not restart, and send the operator the reason and the path of `upgrade-pre.log`. The rows it did record are in `upgrade-checks.jsonl` under `--results`.
   - **Any other last line.** The script crashed before it could print a line of its own. Read it as exit 3, whatever the exit code says.
3. Create the goal that carries the second half, with `goal_create`. The new session starts with no memory of this one, and the goal tree is what survives the restart. The objective must name this skill, the run id from the verdict line, and the whole `post` command, for example:

   > Finish upgrade check run <id> by following the upgrade-check skill's "After the restart" section. Call goal_status, call agentic_inbox on <coordinator persona>, and send one relay reply. Then run: node <script> post --run <id> --results D:/personas --rundir <run directory> --tools "ok", or --tools "fail: <which call failed and how>".

   Where the operator named the full id this persona's own roster name should reach after this release, add to the objective: `Then run landing with --expect <roster name>=<id> --by <persona>`, with that one pair and the id exactly as the operator named it. The roster name is this persona's entry's `model`, or `opus` where the entry has none. Put no other short name's id in the objective, since this persona's run reads only its own row, and put no id the operator did not name.

   Where `goal_create` is refused because of the turn it runs in, send the operator the verdict, and say the restart waits on any reply from them. This message takes the place of the `pre` clear sentence under `## What to tell the operator`, since you are not restarting now. Create the goal in the turn their reply opens, unless the reply says not to restart. Do not call `supervisor_restart` before the goal exists, since the restart loses everything the goal tree does not hold. The refusal comes, for example, in the turn a long run's finish opens.

4. Call `supervisor_restart` with the reason "upgrade check run <id>: restarting the canary onto <version>".

## After the restart

The goal carries the `post` command, and any expected id the operator named before the restart. This section says how to read them.

1. Call `goal_status`, `agentic_inbox` on the coordinator persona, and send one relay reply. A call works when it returns its result rather than an error. An empty inbox counts as working. Pass `--tools "ok"` where all three worked, else `--tools "fail: <reason>"` naming the one that did not.
2. Run the `post` command from the goal. It takes one heartbeat interval plus five seconds, 35 seconds by default, since it watches the heartbeat advance. Its exit codes read as `pre`'s do. On exit 3, or a last line that is not a verdict, send the operator the reason from the command's output.
3. Run `landing` on this persona alone, with the script and the `--results` value the `post` command names. It reads which model this session answers on. The script finds this session's transcript from the roster, so the shell's folder does not matter:

   ```
   node <script> landing --results D:/personas --persona <persona>
   ```

   This session remembers nothing from before the restart. So add `--expect <roster name>=<id> --by <persona>` only where the goal's objective carries an id the operator named, or an operator message in this session names one, and only for this persona's own roster name. A pair for another name exits 2 here, since this run writes no row for it. `--by` is this persona's own name. The roster name is this persona's entry's `model`, or `opus` where the entry has none. With no id named, run the command as it stands. The script then takes the roster name where it is itself a full id, else carries the id stated last, else reads `gap`.

   This run reads only this session's own transcript, so it needs no ask from the operator. Read its row with the classes listed under the next section. Add the verdict to your reply after `post`'s. Where `post` is clear and this row is flagged, send both, so the operator weighs the flag before the rest of the fleet restarts. Report a `gap` row as unjudged, and never as a match. Where its evidence says no expected id is stated, ask the operator to name the id. On exit 2, send the operator the reason and run nothing more. Never drop `--persona` to get past it, since a run without it reads every persona's transcript, which only the operator's ask allows.
4. Reply to the operator as `## What to tell the operator` says.
5. Call `goal_done` on the goal.

## After the fleet restarts

`landing` reads which model each rostered persona's current session answers on. It compares that model with the id stated for the persona's roster name. It restarts, edits and updates nothing in the fleet. It appends its rows to the record under `--results` and regenerates the table beside it. A roster holds a short name such as `fable`, and the Claude Code build decides which model that name reaches.

Run it across the fleet when the operator asks for the landing check, and never unasked. It reads other sessions' transcripts, so the operator's own ask is what allows each read across the fleet. A fleet restart alone is no reason to run it.

The script does the reading. The session running `landing` never opens a transcript itself, and it reports only what the script printed. From a transcript `landing` prints a reply count, a version token and model ids, and nothing else.

1. Run `landing` with `--results` and `--by`. `--by` is this persona's name. The script records it as who stated each id that `--expect` names on the same run. The roster is `fleet.json` under `--results`, unless `--roster` names another file:

   ```
   node <script> landing --results D:/personas --by <persona>
   ```

2. After a model release, add `--expect <roster name>=<id>`, with the id the operator named for each short name. Separate two pairs with a comma. The roster name is the entry's `model`, or `opus` where the entry has none. Never take an id from the build's own model list. The check asks whether the build reaches the model the operator expects, so the build cannot be the one to state it.
3. Read the exit code and the last line. The exit codes read as `pre`'s do. The lines above the last are one per roster entry, as `landing: <persona>: <result> - <evidence>`.
   - **Exit 0, `landing: every judged persona matches its stated id (run <id>)`.** No row needs triage, and one row or more reads `pass`.
   - **Exit 1, `landing: triage <persona> (<class>), ... (run <id>)`.** Each named persona carries its class, read from the list below. One `fail`, `warn` or `gap` row is enough to make the verdict triage.
   - **Exit 1, `landing: no persona was judged (run <id>)`.** Every entry the run read is disabled, or the roster holds none, so the check confirmed nothing.
   - **Exit 2 or 3.** The reasons for exit 2 include `--expect` without `--by`, a command line holding anything but `landing`'s own five flags, each given once and followed by one value, an id outside the model-id shape, one roster name given twice in `--expect`, an `--expect` name no roster entry carries, an `--expect` name no entry `--persona` leaves carries, and a `--persona` name the roster does not hold. A name no entry carries is often a misspelling. The reason lists the roster names the entries do carry, so compare it against those and run again. A name no entry `--persona` leaves carries is a pair that run cannot record, so drop that pair from `--expect`. The model-id shape is 1 to 80 characters, each a lowercase letter, a digit, a dot, a hyphen or a square bracket, the first a letter or a digit.
4. Reply to the operator as `## What to tell the operator` says. Act on no flag yourself.

The classes and the rows behind them:

- **`another id`, a `fail` row.** No reply matched the expected id. The evidence ends with one of four readings.
  - `this session runs build <a> and the build on disk is <b>, so a restart is the first candidate`: the session's build differs from the build on disk.
  - `this session runs the build on disk, so that build reaches <landed id> for this name: update Claude Code, or restate the expectation with --expect where <landed id> is the newer model`: the build itself reaches that id.
  - `this session's build could not be read, so a restart and an update are both candidates`: the transcript named no usable build. This reading applies whatever the build on disk reads.
  - `the build on disk could not be read, so a restart and an update are both candidates`: the session's build is known and `claude --version` gave none.
- **`mixed`, a `warn` row.** Some replies matched and some did not. The evidence ends `replies ran on more than one model, which neither a restart nor an update changes`.
- **`unjudged`, a `gap` row.** The check could not judge the persona, and the evidence says which of four causes holds: the heartbeat file names no usable session, the persona's last heartbeat is more than ten intervals old, no transcript is found or it holds no reply to read, or no expected id is stated for the roster name. The last cause prints the tally after `landed` and ends `state one with --expect`.
- **A `skipped` row** is a roster entry that is not enabled. It is never triaged.

How the script reaches a row:

- **The expected id belongs to the roster name, taken whole.** It comes from `--expect` on this run first. Next it is the roster name itself, where that name is a full id opening `claude-`. Last it is the newest earlier row in `upgrade-checks.jsonl` that states one for the name.
- **A carried expectation is the id stated on its date, and never the latest model.** The evidence says `the id stated <date> by <persona>`, or `the id the roster entry names`. Say a match in those words. After a release, an id stated before it is the older model's until the operator names the new one.
- **A reply matches on the expected id, or on that id followed by a hyphen and eight digits.** One trailing bracketed suffix such as `[1m]` is removed from the expected id before the comparison, wherever the id came from. The row's `expected` field and the expectation's key keep the suffix.
- **The tally counts replies in the newest 8 MiB of the transcript.** It prints as `<id> x<count>`, largest first, five ids at most and then `(+<k> more)`. A model value outside the model-id shape prints as `(other)`.
- **The session's build is the newest version that part of the transcript records.** A version token is the value's first word, such as `2.1.322`, made of letters, digits, `_`, `.`, `+` and `-`. The build reads `unknown` where the value yields no such token, or a token longer than 32 characters.
- **Evidence past 600 characters is shortened, and the reading is never cut.** The tally names fewer ids first, folding the rest into `(+<k> more)`. The `--by` value is cut next, and the text before the tally last.

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
- `post` clear: the rest of the fleet can restart onto the build. Once the fleet has restarted, say `landing check` in a persona's thread to read which model each persona landed on.
- `post` triage: you are running the new build and the named checks failed, so the rest of the fleet should wait. Add each failing row's evidence.
- `landing` clear: every persona the check judged answers on the id stated for its roster name.
- `landing` triage: the named personas did not all land on the stated id. Name each persona with its class and its reading in plain words. Say a restart, an update and a roster edit are the coordinator's acts on the operator's word. For a persona unjudged because no expected id is stated, give the tally it landed on and ask the operator to name the id.
- `landing` with no persona judged: the check read no enabled persona, so it confirmed nothing.
- `behavior` inside the spread: on each of the seven figures the script counted, the new model differs from the old one by no more than the old model differs from itself. Say the count can show a large shift and cannot rule out a small one. Say early stops and needless approval asks were not counted.
- `behavior` triage: name each item in plain words. For a figure outside the spread, give its new value, its nearest old value and the number of old pairs it was read against, and say a reading over few pairs is weak. For `effort moved`, say the effort changed with the model, so the difference cannot be laid to the model alone. For `the effort moved and the model did not`, say the model stayed and only its effort changed, so a difference is the effort's or the work's and not a new model's. For `effort not recorded`, say the turns on one side or both recorded no usable effort, so the run cannot tell whether the effort moved. Where it prints, make no other claim that the effort moved, and still say whether the model moved. For a figure with no old pair, say it could not be judged. Say early stops and needless approval asks were not counted.
- `behavior` with nothing compared: give the reason in plain words. Where every turn carries one label, say the run recorded the one model's own spread and compared no second model. Where a stretch was too short, give the first count the windows row prints after `it holds`. Say early stops and needless approval asks were not counted.

End with where the full record is, `upgrade-checks.md` in `D:/personas`, and offer to read it back.

## After the model changes

`behavior` is the behavior count. It counts seven figures of what one persona's sessions did on its newest model, and the same seven for the model before it. Beside each figure it prints the old model's own spread, which is how much the old model differs from itself between neighbouring windows of turns. It counts from the persona's transcripts, and never from what the persona reports of itself. It restarts, edits and updates nothing in the fleet. It appends its rows to the record under `--results` and regenerates the table beside it.

Run it when the operator or the coordinator persona asks for the behavior count, once a persona's model has changed. It belongs in the weeks after the change. The harness removes old transcripts on its own schedule, and the old model's turns go with them. Run it on this persona's own name on either one's ask. Run it on another persona's name only on the operator's own ask. That run counts another persona's sessions. Where the coordinator persona asks for another persona's count, tell it that run needs the operator's own ask, and run nothing. A run on a history with no change of model or effort compares nothing and prints the one model's own spread.

The script does the reading. From a transcript `behavior` prints counts, model ids, effort values, version tokens and turn start times, and nothing else. The session never opens a transcript itself, and it reports only what the script printed.

1. Run `behavior` with `--results` and `--persona`. The script finds every transcript of the persona from its roster entry's `workdir`, so the shell's folder does not matter, and a stopped persona can be counted. It reads every transcript whole and finishes in tens of seconds over a few gigabytes of transcripts. Run it in the foreground. The roster is `fleet.json` under `--results`, unless `--roster` names another file:

   ```
   node <script> behavior --results D:/personas --persona <persona>
   ```

2. Leave `--turns <n>` out unless the asker names a value. It sets the most turns a window holds, a whole number from 10 to 500, and 50 where it is left out. A window holds k working turns, a working turn being one with a tool call in it. A turn's label is the model id and the effort its replies ran on. A stretch is an unbroken run of working turns on one label: the newest stretch ends at the newest turn, and the old stretch is the one just before it. k is the smaller of `--turns` and the length of the newest stretch.
3. Read the exit code and the last line. The lines above the last are one per row, as `behavior: <persona>: <row>: <result> - <evidence>`.
   - **Exit 0, `behavior: <persona> on <new id> reads inside the spread of <old id> on all seven figures, over <k> turns a window; early stops and needless approval asks are not counted (run <id>)`.** The model moved, the effort did not, and the windows row and every figure row read `pass`.
   - **Exit 1, `behavior: triage <persona>: <items>; early stops and needless approval asks are not counted (run <id>)`.** The two sides were compared, and each item names something to weigh. The items are joined by a semicolon and a space, in this order. `the effort moved and the model did not`, or `effort moved` where both moved. `effort not recorded`. Then each figure whose row reads `warn`, as `<figure> outside the spread`, and each whose row reads `gap`, as `<figure> has no old pair`.
   - **Exit 1, `behavior: nothing compared for <persona>: <reason> (run <id>)`.** The reason is one of four: `the transcripts hold no labelled working turn`, `the newest stretch holds fewer than 10 working turns`, `the old stretch holds fewer than <k> working turns`, or `every labelled turn carries one label`. The last is a history with no change in it. It still writes the seven figure rows, each `gap`, and they give the one model's own spread.
   - **Exit 2 or 3.** Exit 2 is a refusal before any row is written. Exit 3, `upgrade-check: failed: <reason>`, is an error the script has no verdict for, and its rows may be partly recorded. Exit 2's reasons include a command line holding anything but `behavior`'s own four flags, `--results`, `--persona`, `--turns` and `--roster`, each given once and followed by one value, a `--turns` outside 10 to 500, a `--persona` name the roster does not hold, and a roster entry with no `workdir` or one no transcript folder matches. Another roster entry whose `workdir` leads to the same transcript folder is one more. That folder holds two personas' sessions. Send the asker the reason and run nothing more.
4. Reply to whoever asked, as `## What to tell the operator` says: the operator in its thread, or the coordinator persona with `agentic_say`, its `persona` set to the coordinator persona's name.

The rows:

- **The windows row says what was compared.** Its evidence opens `the model moved`, `the effort moved` or `the model and the effort moved`, then names both sides as `new <model id> at effort <effort>, old <model id> at effort <effort>`. `turns a window` is k, and `old windows` is how many windows of k turns the old side holds. `new window` and `nearest old window` each give the start time and the build of the window's first and last turn. `unlabelled turns left out` counts the turns whose replies name two models, two efforts or no model. `files left out` counts the transcripts that could not be read. The row reads `gap` where an effort reads `(none)`, which is a turn whose replies recorded no usable effort. It reads `warn` where the effort differs between the two sides, and `pass` otherwise.
- **Each of the seven figure rows compares one figure.** The evidence reads `new <value>, nearest old <value>, old windows <lowest> to <highest>, new and old differ by <x>, old pairs differ by <y> at most, larger than <j> of <m> old pairs`. A difference is the larger value plus one, divided by the smaller plus one, so 1.00 is no difference. An old pair is two old windows next to each other. `nearest old` is the old window just before the new one, and j counts the old pairs that differ by less than the new window and the nearest old one do. The row reads `pass` where one old pair or more differs by as much as the new window differs from the nearest old one. It reads `warn` where no old pair does, which is j equal to m. It reads `gap`, with `no old pair` in the evidence, where the old side holds one window.
- **The judged row always reads `gap`.** Its evidence is `early stops and needless approval asks are not counted: a person or a judge reads them`. The script counts neither, so never report either as zero.
- **A history on one label words its rows differently.** The windows row opens `nothing compared: every labelled turn carries one label`, and gives `windows` and `newest window` where the other run gives `old windows` and `new window`. A figure row reads `newest <value>, windows <lowest> to <highest>, pairs of neighbouring windows: <N>, differing by <x> at most`. The pairs take in the newest window, so W windows give W - 1 pairs, and one window gives `no old pair`.

The seven figures, each over one window:

- `tool calls a turn` is the median number of tool calls in a turn.
- `quiet run, median` and `quiet run, longest` read a turn's longest run of tool calls with no reply text between them.
- `quiet run with updates, median` and `quiet run with updates, longest` read the same run, which thinking text also ends.
- `replies per 100 calls` counts the messages sent to the operator's thread. A call that only marks messages as noted is not one.
- `subagents per 100 calls` counts the `Agent` and `Workflow` calls.

How to weigh a row:

- **A `warn` over few old pairs is weak.** With m old pairs, a figure reads outside the spread by chance about once in m + 1 runs. Over two old pairs that is one run in three.
- **`effort moved` means a difference cannot be laid to the model alone.** The effort value changed with the model, and either one can move a figure.
- **The count can show a large shift and cannot rule out a small one.** It holds neither the work nor the build fixed. The persona's work differs from window to window, and the windows row shows where the build changed too.
- **The count names no better model.** A row says inside or outside the old model's spread, and nothing more.
