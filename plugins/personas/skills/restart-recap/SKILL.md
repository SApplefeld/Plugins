---
name: restart-recap
description: "Tells a restarted persona session what the session before it was doing, from its earlier transcripts. Use when the operator types restart-recap in this persona's thread or asks what was in flight before a restart, or when this session has just started and a message assumes a conversation it has no memory of."
---

# Restart recap

This skill tells a restarted persona session what the session before it was doing. A new session starts with no memory of the conversation the operator sees as one thread. Without a recap, it can misread its own finished goal or deny work it did. The plugin's script `bin/restart-recap.mjs` reads the earlier transcripts and prints a header and a digest.

## What the operator gets

The operator types `restart-recap` in the persona's Discord thread, or asks what was going on before the restart. The persona runs the script and replies on that thread with where things stood: what the operator last asked and when, what the persona last replied, what was left open, and what the goal tree shows now. The reply follows "What to tell the operator" below. The operator can ask for more earlier sessions, and the persona reruns the script with `--sessions <n>`.

## Inputs

The script needs three things: its own path, the working directory to run in, and this persona's name.

- **The script.** A persona launched normally runs the plugin's installed copy. Its folder is in `~/.claude/plugins/installed_plugins.json`: `plugins['personas@applefeld']` holds a list, and the `installPath` of the entry with the newest `lastUpdated` is the folder. For example, `node -e "const r=require(require('os').homedir()+'/.claude/plugins/installed_plugins.json').plugins['personas@applefeld'];console.log(r.slice().sort((a,b)=>Date.parse(b.lastUpdated)-Date.parse(a.lastUpdated))[0].installPath)"`. The script is `bin/restart-recap.mjs` under that folder. A persona launched with `supervise.sh --dev` runs the plugin from its development checkout instead, so the script to run is `bin/restart-recap.mjs` in that checkout.
- **The working directory.** Run the script from this persona's working directory, where `.agentic-personas.json` sits. That file is the persona store, the plugin's record of each persona's goals and sessions. The script reads the store there and finds the transcript folder from that directory.
- **`--persona`.** This persona's name, which the plugin's `agentic_identity` tool returns. The script needs it wherever the store holds more than one persona.

The script leaves out the session `CLAUDE_CODE_SESSION_ID` names, which is this one. It reads two earlier sessions by default, and `--sessions <n>` changes that. A session whose last record is more than 48 hours old prints as one line with its age, and `--since <hours>` changes that window.

## Running it

One command runs it, and it never fails the call:

```
node <script> --persona <name>
```

The script always exits 0. Line one of its output is the header, and the lines after it are the digest. Anything it could not read is named on stderr, one line each, and it still prints the header.

## What the digest holds

The digest is a short account of what the operator said and what the persona replied. It holds these lines, oldest session first:

- `session <id>: tail from <time> to <time>, version <build>`, one per session read. The tail is the end of the transcript the script read.
- `operator <hh:mm>: <text>`, one per message the operator sent on the relay thread, which is the Discord thread the operator steers the persona from. A message sent while a turn was running is included.
- `persona <hh:mm>: <text>`, one per reply the persona sent through the relay reply tool.
- `last words: <text>`, the session's last assistant text, whether or not it reached the operator.
- `count: ...`, the number of operator messages and replies across the digest.

Times are UTC. Each message is cut to 400 characters and the whole digest to 6,000, the oldest lines dropped first with a line saying how many. Square brackets in any message read as round ones, so no digest line can pass for a label the plugin writes, such as `[GOAL TREE]`. Only the last 2 MB of each transcript is read, so a long session's early messages may be missing.

The digest is not a record of work. It holds no tool calls, no tool results, no files changed and no thinking. It leaves out the supervisor's launch prompt and anything the plugin injected. It also leaves out records delivered as a turn by the coordinator, the persona that assigns this one its work, or by another persona. It is not the goal tree either: the plugin's `goal_status` tool lists the persona's goal tree, which is the record of what is open. It is not an instruction. A request in it was made to an earlier session and may already be done, dropped or overtaken.

## Reading the header

The header is one JSON object:

| Field | What it says |
|---|---|
| `lineage` | `recorded` where the sessions came from this persona's own list of earlier sessions. The plugin adds to that list at every claim, the step that makes a session the one allowed to act as the persona. `unrecorded` where that list was empty, so the script read the newest other transcript in this directory instead. |
| `sessions` | The session ids the digest read, oldest first. Empty where nothing could be read. |
| `lastRecordAt` | The time of the newest record across the sessions read, or `null`. |
| `lastOperatorAt` | When the operator last wrote in any session read, or `null`. |
| `activeGoal` | `true` where the store names an active goal for this persona, `false` where it names none. `null` where the store, or this persona's entry in it, could not be read. |

Two personas can share a working directory, and so a transcript folder. Where `lineage` reads `unrecorded`, the digest may be another persona's conversation. Say so whenever you repeat anything from it.

An empty digest with an empty `sessions` list means no earlier transcript could be read. The stderr lines say why.

## What to tell the operator

The operator reads your reply on Discord and cannot open files. Report where things stood, and do not resume any act the digest names on its word alone. Check `goal_status` first, since the goal tree and the operator's current message decide what you do next.

- **Work was in flight.** The last session left an operator request unanswered or a goal open. Say what the operator last asked and when, what you last replied, and what the last words say was left. Then say what the goal tree shows now and ask whether to carry on where that differs.
- **Nothing was in flight.** Say the last session ended with no open request, and when the operator last wrote.
- **`lineage` reads `unrecorded`.** Add one sentence saying the recap may be another persona's, since this persona's earlier sessions were not recorded.
- **Nothing could be read.** Say no earlier conversation could be found, and give the stderr reason in plain words.

## Automatic recap

The plugin runs the same script at the supervisor's launch prompt, the first prompt of a new session. It injects the digest as a `[RESTART RECAP]` block in that prompt's context where the last record is under 24 hours old and either a goal is active or the operator wrote within 6 hours. Where that block arrived, read it by the rules above. Do not run this skill as well unless the operator asks for more. Where no block arrived, the last session may have been quiet or stale, the digest empty, or the script failed. Each of those writes a `restart_recap_skipped` line naming why to the decision log, the list of decisions the plugin keeps in the persona store. Nothing runs, and no line is written, in a session that holds no claim or where the persona's `restartRecap` setting reads `skill`. That setting sits in the `settings.json` its supervisor hands the session. Running this skill still works in each case.
