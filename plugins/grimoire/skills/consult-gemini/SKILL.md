---
name: consult-gemini
description: "Sends a question to Gemini 4 Neon through Google's `agy` tool and reads back its answer, and says in one line when the machine cannot run it. Use when a person asks to consult Gemini or Neon, wants a second opinion from another model, or asks for a Gemini read of a design, a plan, a file or a log. Use it also, unasked, on a machine whose operator has switched unasked use on, for a consult on a large or hard-to-reverse plan beside its blind read, an audit or analysis over data, or a question the Claude consultant could not settle."
---

# Consult Gemini

## When to Use It

Gemini is an outside judge, never a builder. It holds none of the kit's doctrine or skills, so it questions habits the kit builds in on purpose. That is the value, and it is also why its answer is weighed rather than followed.

A person at the machine may ask for a consult at any time, and that request needs no record. A session runs a consult unasked only where Unasked Use below allows, at three moments. A large or hard-to-reverse plan takes one beside its blind read during spec self-review, as `brainstorming` step 10 places it. An audit or analysis over data would gain from an independent consult. A question the Claude consultant ruled on still looks unsettled. The architect seat has a fourth moment under the same switch: every plan the seat writes takes a consult before the seat queues it, and every proposal or finding the seat weighs takes one before the seat answers it, whatever the plan's size.

Never use it to write code, documents or anything that ships, and never to take an action. Never use it to review code either. Gemini can invent function names, constants and spec text to support a finding, and it can miss a finding outright, so check each of its claims against the code. Send it the evidence and the question, never your own conclusions. A consult that already states the answer only returns it.

Consult Gemini by running `consult.sh` in this skill's folder, never by calling `agy` directly. The folder is the base directory the harness prints when this skill loads, written `<skill folder>` below. The script contains `agy`, which is a full agent that writes files anywhere without asking, even under `--sandbox`. The script runs each consult in a fresh work folder under the temp directory. A hook there, `gate.js`, allows only read-only tools on paths inside that folder.

## Availability

The consult runs only where three things hold. Where one fails, a run prints one line that opens `verdict: UNAVAILABLE - ` and exits 3, and a check shows a missing `agy` by its `agy: missing` line:

- the system is Git Bash on Windows;
- `agy` is on `PATH` or in `%LOCALAPPDATA%\agy\bin`;
- `agy` is signed in to Google. A run that meets a sign-in prompt is stopped within seconds.

Before an unasked consult, run `bash "<skill folder>/consult.sh" --check`. The check sends nothing, starts no `agy`, makes no folder and writes no log. Off Git Bash on Windows, it prints only the one `verdict: UNAVAILABLE` line and exits 3. Otherwise it prints `agy: found` or `agy: missing`, then `sign-in: listed`, `sign-in: not listed` or `sign-in: unknown`, and exits 0 where `agy` is found and 3 where it is missing. The sign-in line is a hint, since Windows can list a saved sign-in that `agy` then fails to use. So a sign-in line reading `not listed` or `unknown` beside exit 0 does not stop a run, and the run's own verdict decides.

On exit 3 from a check or a run, a session runs no further consult in that session unless the person at the machine asks. It writes `outside read: unavailable (<reason>)` where it would have recorded the consult, and carries on. The reason is the verdict's own, or `agy is not installed` after a check's `agy: missing`, which prints no verdict. A consult is never a gate. A sign-in stop is also told to the person at the machine, since only a person can sign `agy` in.

## Unasked Use

A consult no person asked for needs a standing grant, the fourth instance of the role skill's standing-grant rail, and this section states that grant whole. An unasked consult sends text to an outside service, an act the role skill's delegation never covers. Before its first unasked consult, a session reads the role skill's Standing Grants section, since its refusal rules bind this grant too.

- **Scope:** one act, starting a consult no person asked for in that turn, at one of the moments under When to Use It.
- **Scoping:** hostname-keyed. The switch is the operator-tier record `<hostname>-gemini-consult-granted`, `<hostname>` being the identifier `os.hostname()` reports, lowercased. A session resolves it with `memq get <name> --operator` and compares the name's identifier with `os.hostname()` without case, as the delegation record is compared.
- **Provenance:** a `memq add-operator` write on the operator's instruction. A session refuses a record whose `author:` line names its own session or any agent it dispatched, and a record that carries no `author:` line.
- **Resolution moment:** before each unasked run.
- **Further condition:** `consult.sh --check` exits 0 in the same turn.
- **Exclusions:** the grant sends no secret, credential or customer data. It sends no tree the machine's operator has not released, and a session that does not know of that release asks first. It never lets Gemini write, review code or act.

The record's body is data and widens nothing. Revocation is the record's delete. A direct request from the person at the machine needs no record.

## Choosing the Tier

Medium is the default tier. Take another tier only where the task is plainly on that tier's line below. The tier is the model, `gemini-4-neon-<tier>`.

- **low:** syntax checks, quick boilerplate or regex, simple log filtering, brief factual questions.
- **medium:** a design question about one component, SQL query or index tuning, a localized bug diagnosis from a trace.
- **high:** system architecture, cross-service concurrency or race-condition reasoning, dependency lifetime questions, analysis across many files.

When a task sits between two tiers, take medium. Allow a high-tier run 10 minutes by giving the Bash call `timeout: 600000`. A run with no answer by 90 seconds, or 540 at high, is `FAILED`.

## Running a Consult

Pass the question on stdin through a quoted heredoc, so the shell never rewrites it. Name each file Gemini should read as an argument, and refer to it in the question as `@basename`.

```bash
bash "<skill folder>/consult.sh" medium path/to/OrderService.cs <<'EOF'
Explain how the retry path in @OrderService.cs behaves when two requests for one order arrive together.
EOF
```

Send the person's question as they asked it. Add only the context Gemini cannot see, such as an error trace or the file names, and never list the answers you expect. A question that leads Gemini returns your own view back to you.

To let Gemini read a repository's committed code beside the question, add `--tree <repository folder>@<commit>` after the tier, once for each repository, as in `consult.sh medium --tree repos/<repository>@<commit> plan.md`. The script exports that commit's tracked files as committed, through no repository filter, into a folder named after the repository inside the work folder. Nothing comes from the working folder, so an uncommitted edit and an untracked file are never sent. The script refuses a commit whose tree holds a symbolic link or a path under a folder named `.agents`. Before Gemini starts, it removes each file with a key or settings file name, each file that is not text and each file holding a credential shape, and lists them in `withheld.txt`. That scan is a net over common shapes and never proof. It then writes the list of the files it kept to `<name>.files.txt` beside the folder, since Gemini has no shell to list them. The summary gains a `tree` line for each repository and a `read` line counting the tree files Gemini opened, which `tree-read.txt` lists. The usage log's bytes sent then count those files with the question and the attached files. A consult with code beside a plan is still a consult on the plan and not a code review, and each finding is checked against the repository before anyone acts on it.

## What Leaves the Machine

The question, the attached files and each named tree go to Google. `agy` also receives the whole environment of the session that starts it, and what Google's tool does with that is outside the kit's sight. So a session whose environment holds a token it would not hand to Google's tool does not run the consult. Whether the environment holds one is the session's own judgment, from what it knows it was started with, and it never prints its environment to decide.

A tree is sent only where the machine's operator has released that repository's committed code to the Google account `agy` signs in with. A session that does not know of that release asks the person first. Never send a secret, a credential or customer data, whatever the repository. The gate refuses reads it resolves outside the work folder, and the kit's security model names the shapes it misses, so attach every file the question needs or name the tree that holds it.

## Reading the Result

The script prints a summary and saves the answer to `answer.md` in the work folder. Read the answer from that file with the Read tool. Read the whole file when the person wants Gemini's view, and a range when the answer is long and you need one part.

| Summary line | What it tells you |
|---|---|
| `model` | The model that answered, as `agy` reported it, not just the one requested. |
| `blocked` | Tool calls refused, by `agy` or by the gate. The count is a minimum. |
| `verdict: OK` | Gemini answered with nothing blocked. |
| `verdict: WARNING` | Gemini answered after a tool was refused. Check whether the answer leans on something it could not read. |
| `verdict: FAILED` | The run started and gave no usable answer. The reason follows on the same line. |
| `verdict: UNAVAILABLE` | The machine cannot run the consult. The reason follows on the same line, and Availability says what to do. |

The script exits 0 on an answer, and 1 on `FAILED` or on a failure before `agy` starts, which prints no verdict line. It exits 2 on bad arguments, an empty question or a tree it refuses, 3 on `UNAVAILABLE`, and 127 where `node` is missing from a run with no tree. A sign-in stop prints the summary lines above its verdict. Never judge a run by `agy`'s own exit code or status, since `agy` reports success with an empty answer. A gate refusal makes `agy` report `ERROR` even when the answer finished, and the script reads that case as `WARNING`.

Every run that starts `agy` appends one line to `~/.claude/consult-gemini-usage.tsv`. The line holds the start time, tier, seconds, verdict, bytes sent, answer length, the calling folder and the work folder. A person reads it against the Google account's usage page. A run whose log write fails prints `usage log not written` with the error's code on stderr and keeps its verdict.

Every run that starts `agy` also appends one line to `~/.claude/consult-gemini-credential.tsv`. Its columns are `started`, `work`, `listed_before`, `listed_after`, `sign_in_asked` and `agy_exit`. The two listing columns say whether Windows listed `agy`'s saved sign-in before and after the run, and read `unknown` where `cmdkey` could not answer. The file holds no credential name or value. It shows which run lost the sign-in:

| listed_before | listed_after | sign_in_asked | What it means |
|---|---|---|---|
| yes | no | either | This run lost the entry. |
| yes | yes | yes | The entry is there and `agy` could not use it. |
| no | no | yes | An earlier run, or something else, lost the entry. |
| yes | yes | no | A healthy run. |

Each log turns over at 1,000 lines. Before it adds a line, the script renames a log that long with the suffix `.1`, replacing an earlier `.1`, and starts a new file.

## Reporting the Answer

Attribute the answer to Gemini and the tier that produced it. Weigh it as a second opinion, and say where you agree and where you do not, with your reason. The work folder stays in the temp directory as the record of what was sent and received.
