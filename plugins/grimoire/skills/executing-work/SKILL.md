---
name: executing-work
description: "Autonomous execution of an approved spec or plan from docs/plans/. Use when the operator says to proceed, implement, build, or continue an agreed plan, or when resuming a session that has an In Progress plan doc."
---

# Executing Work

Once the spec is approved, execute it under the completion contract below: no per-step check-ins, no "should you continue?", no gating individual edits. Interrupt me only for a member of the blocker set below.

## Contents

| File | When to read it | What it holds |
|---|---|---|
| [references/starting.md](references/starting.md) | at a run's start, on a resume, and after any compaction | `## Before Starting or Resuming`: the plan-doc read, the approval rule, the intake gap check, the memory recall, the external-engine stand-down and the workspace rule |
| [references/implementing.md](references/implementing.md) | before a section opens and before any implementer is dispatched | steps 1 and 2 of the section loop, with the Dispatch Brief template, the capacity reading, and the rule on awaiting a dispatched agent and stopping one before replacing it; and `## Delegating to Subagents`, with its disjoint-files rule and the rule whose bold lead is "Band the scout by question shape, and state its return contract" |
| [references/review.md](references/review.md) | before any reviewer is dispatched | step 3, with the dispatch table, the Document Review Brief and the Reviewer Dispatch template, and the compensation route, dispatch table row "Gate compensation" |
| [references/findings.md](references/findings.md) | when a review returns, and before any fix | step 4: provenance, the held-finding judge, the design stop, the review-round backstop, the loop's end condition and the out-of-scope route |
| [references/closing.md](references/closing.md) | at a section's close, and at an interim boundary | steps 5, 6, 7 and 8, with the boundary declaration; the interim boundary; and `## Chapter Format`, with the Chapter template |

A reference file read before a compaction is no longer in context, so read it again before the step it serves.

## Completion Contract

The spec is the goal. Once execution starts, run every remaining unblocked section to completion in this session. A section boundary, a long-running gate and context pressure are not stopping points. An externally-driven worker (the External-engine stand-down) finishes its directed section and stops, and that is completion, never an early stop.

**Do not end your turn** to:

- report progress between sections. Close the section and start the next.
- wait on a build, test suite, or Live gate. Background it, poll a readiness signal (`until` on a marker or exit code), and continue.
- manage context. The Chapter and the SessionStart resume hook make a fresh session lossless, and starting one is my call.
- await a subagent on a bare turn-end. End on a `WAITING:` lead instead.
  - End on `WAITING:` once a background dispatch (`run_in_background: true`, the Agent-tool default) is the only remaining work, an agent resumed over SendMessage and a model-override dispatch included. A dispatch is the only remaining work when every next step reads its result, so do work that needs no result first, and read every returned result before ending.
  - The `WAITING:` line names each pending task's id and expected wake, the registry the post-wake turn reads. Arm a timer first where you can, on the window finishing-work's cadence paragraph sets.
  - The one in-turn option is a synchronous dispatch (`run_in_background: false`), chosen per step 1's wait-shape bullet.
  - Read completion from task status, never transcript quiescence, since a mid-run pause reads as done. Only finishing-work's wedge hallmark makes a stall out of silence.

Any stop with unblocked work left, for a reason outside the blocker set, is wrong. Red flags that you are about to stop wrongly: "say the word and continue", "holding for", "paused here", "at the tail of", "ready to continue when you are". With unblocked work remaining, do not write them. Keep going.

**Stop only for a true blocker, and make it loud.** The blocker set:

- an external dependency only I can satisfy (a GUI action, a cloud resource that must be provisioned, a credential or secret you cannot reach),
- a contradiction inside the spec, or a material decision the spec does not cover,
- an act the doctrine's stop-for-a-yes rule gates and no proceed-ahead covers,
- a systematic-debugging dead end.

The set is closed, and capacity is never on it. The plan doc keeps the state across a compaction, so a stop reasoned from context is a stop dressed as a blocker. The two `WAITING:` occasions below are not on it either, since each ends a turn with no work stranded.

**Before any BLOCKED at all, the expert ask goes out, and it goes ahead of the consult.** Send the blocker to the repo's live expert seat, and on declaring notify this machine's live coordinator seat, on the route, bounds and record rule the peer-sessions skill's Worker seat bullet states. The ask never gates: keep working, and declare exactly when you would have without it. With no live expert seat, go straight to the consult. The ask and the notice carry the same public-board cap as the declaration's first line. `docs/security-model.md` carries the readership analysis, and the coordinator skill owns the precondition it names.

**Before any BLOCKED that turns on a decision, the consult runs too, after the ask and before the declaration.** The consult skill owns the mechanics, and its trigger (b) owns which blockers go straight up instead, what reaches me, and the one substitution step 4's review-round backstop grants.

When you stop, the message's very first characters are `BLOCKED: <exactly what you need from me>`, with no summary, bold or heading above it, and any shipped-work recap after the BLOCKED paragraph. The body is a decision brief in the doctrine's client-briefing register, decidable from the brief alone on my phone with no session context. The persona controller reads that leading prefix as a stop for my answer, so a `BLOCKED:` line mid-message, or one wrapped in bold or a heading, is no stop. A capacity reason (context, compaction, a fresh session) is never a blocker. Never write a progress update as a stop.

**The first line carries only what you would put on a public board, because it travels further than the rest of the message.** The coordinator notice carries it onto the coordinator seat's brief and board. So compose that one line for a public board and keep it inside 120 printable-ASCII characters, since what runs past is dropped mid-clause. Spell any path in that line repo-relative. The cap is a standard, stated against a public board so that moving the board somewhere quieter never reads as relaxing it. `docs/security-model.md` carries the readership analysis, and the coordinator skill owns the precondition it names, which bounds what that seat lands rather than what you send.

Waiting is the third stop shape, and it has two occasions. The first is the completion contract's dispatch bullet: a turn whose only remaining work is dispatched background subagents ends with `WAITING:` as its very first characters, naming the pending dispatch, never a foreground wait or a pause dressed as a blocker. Take the first-turn reading at the first wake at or after its window closes, per finishing-work's cadence paragraph. On the wake, evaluate the hallmark at the first re-block, before anything else with that dispatch.

The second is a park: a stop at the next safe boundary taken on a request, never on the run's own judgment. A stop request from the operator, direct or relayed by the coordinator, is honored at the next safe boundary under the ordinary rules: the interim board entry where a section is mid-flight, the commit the recorded commit model directs, and the boundary declared as step 8 states.

A parked session leads its stop message, and every later turn it ends while parked, with `WAITING:`, since the persona controller holds the run on that lead. That line names the park and its ground only, never capacity in any form. Once every dispatch is finished or explicitly stopped, answer a relayed request with one line naming the parked state, as the turn's last act. The ground is the window the operator declared to this session directly, else the operator's own instruction, else the request itself, named as the request.

Before that line, settle each dispatch under finishing-work's unavailability rule, which owns both readings and their windows. A dispatch whose growth or first-turn window has closed takes the hallmark check through its probe, or its TaskStop for a synthetic-only pair. One whose first-turn reading is pending holds the park, ending turns on the dispatch occasion's `WAITING:` line until a wake at or after its window's close takes the reading. A parking session stops a never-started agent, records in the interim board entry what it was asked and that it never started, and leaves the re-dispatch to the resuming session. Park only on what survives.

Nothing in the kit wakes a parked session on a timer, save a parked coordinator seat's own reconciliation wake, whose conduct the coordinator skill states. A dispatch's completion notification re-invokes a session that stopped on `WAITING:`. BLOCKED's leading-prefix rule and capacity refusal apply to `WAITING:` too.

**The goal template.** A plan run is approved by my word on a warranted channel, by the plan's `## Dispatch Authorization` section, which the curating-docs skill defines, or by a chain handoff inside the bounds the peer-sessions skill states. What holds the run to completion sits outside the kit: the persona controller in a persona session, and Claude Code's own `/goal` in an interactive one. The persona controller is the personas plugin's supervisor, which drives a persona session from its goal tree and stops prompting it to continue while its last turn opens with `WAITING:` or `BLOCKED:`. The completion contract binds the run either way, and with neither in place it binds alone.

**A plan arriving mid-run is itself the trigger to take it on, once its standing holds.** The peer-sessions skill owns that gate, settled before the plan is taken on: the message's own standing, and the trace of a `## Dispatch Authorization` grant to the operator, which is mandatory and which no tool performs for you. A plan whose standing does not establish is held. One that holds is taken on at the earliest boundary this tree allows, and runs after everything the run already holds.

The run records it in the in-flight plan's doc and runs it next. A tree older than the plan's commit takes the plan on at the next safe tree advance, re-checking against the sender's named anchor at each boundary the run already takes.

Tell the sender which state the plan reached, in the reply vocabulary the peer-sessions skill owns. Each record, and a held plan's note of what the hold waits on, goes in the interim board entry where no Chapter is being written that turn, else the Chapter. An arriving plan is never a blocker or a reason to end the turn. Record it and continue into the next section.

**Handoff.** When execution begins in a conversation that was just brainstorming, say so in one line ("Spec approved, switching to autonomous execution of all N sections"), so I can scope it down.

## Section Loop

Run each Section of Work in order. Sections run concurrently only where the disjoint-files rule in "Delegating to Subagents" permits.

1. Confirm the approach, then implement: read [references/implementing.md](references/implementing.md) before acting.
2. Verify with evidence: read [references/implementing.md](references/implementing.md) before acting.
3. Review: read [references/review.md](references/review.md) before acting.
4. Address findings: read [references/findings.md](references/findings.md) before acting.
5. Update the plan doc: read [references/closing.md](references/closing.md) before acting.
6. Adjudicate the applied stamps, then append a Chapter: read [references/closing.md](references/closing.md) before acting.
7. Apply the commit model: read [references/closing.md](references/closing.md) before acting.
8. Declare the compaction boundary: read [references/closing.md](references/closing.md) before acting.

Then continue to the next section. Do not stop here.

## Consult

The consult skill (`consult/SKILL.md`) owns the consult: its seat, triggers, brief, model rule and how a ruling is adjudicated. Use the consult for a question whose framing may be wrong, the expert ask for an answer that may already exist, and the reviewers for a diff.

## Finishing Handoff

Invoke the finishing-work skill; the effort is not done without it. This holds under Review-Only, which defers only the commit: finishing-work still flips the plan to Complete, archives it and stages it with the code.
