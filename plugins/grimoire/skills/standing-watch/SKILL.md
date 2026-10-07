---
name: standing-watch
description: "Runbook for a standing watch, a loop whose state outlives the context that wrote it. Use when a session watches a live system it does not own on a repeating loop, waking on a timer or an operator message, checking, intervening, and sleeping again. Triggers: a watch or babysitter session, a loop armed with /loop or a self-authored wake prompt, a runbook to follow each pass, a ledger to carry the board between passes, an operator asking the session to keep an eye on a running system."
---

# Standing Watch

A watch is a loop whose state outlives the context that wrote it. Each pass wakes knowing less than the last, acts on what it can read, and hands on what it wrote down. A note written when it was true is read as fact when it is not. The loop's own reasoning is what goes stale most quietly, and everything here follows from that.

## Two Artifacts

A watch runs on exactly two written surfaces, which differ in what they hold rather than in format.

- **The runbook** is the procedure: what a pass checks, in what order, with which commands, and what each result means. It is project-specific, committed, and changes only when the procedure changes.
- **The ledger** is the state: what is true of the watched system now and what the loop has learned about it. It is gitignored, lives under `.kit/`, and is rewritten in place rather than appended to.

Nothing the loop needs lives only in a session's context. Anything else a tick produces, such as a ping, a commit or an intervention on the watched system, is an output of that tick rather than a loop artifact. The class is closed at those two.

## Ledger Shape

Two kinds of content, in separate sections, never interleaved:

- **Standing**: prohibitions, mechanisms confirmed in the system's source, and do-not-reopen traps. What stays true without re-measurement.
- **Situational**: the board as of the last pass, open interventions, recent pings, the length of the quiet streak. Everything a later pass must re-derive before acting on.

Both kinds answer one admission test: a line belongs on the ledger only if a successor with no context needs it to resume the watch. Two tells mark a failing line: it argues rather than states, or its subject is the keeper's own reasoning rather than the watched system. What it carries, where durable, goes where the destination rule below sends it, and otherwise it is dropped.

**Doubt falls to the cheap side, at both forks.** At the first fork, whether a line belongs, a line the keeper cannot confidently say a successor needs stays off and leaves by the admission test's route. That default is the admission test's tie-break for doubt, used only where the keeper cannot call the test. Kept off wrongly, a line costs at worst its loss, which is accepted. Kept on wrongly, it survives every rewrite, since none asks again whether a line belongs.

**The kind fork is decided on the cost of the misfiling, never on the kinds' names.** Doubt about whether a line is a prohibition or a do-not-reopen trap is asked first and falls to standing, since no probe reproduces either. Any other doubt about an admitted line's kind falls to situational: a line wrongly filed standing is acted on stale, and one wrongly filed situational costs one extra probe. Situational is re-derived by probing the watched system, never by reading another record, whatever the line's provenance. A skill that replaces these two kinds states its own fork beside its override, on the same cost.

Every situational sentence carries two things: the time of the evidence behind it, and the command that re-derives it. A sentence with neither is a claim no later pass can check.

**Supersede in place.** When a fact changes, rewrite the line that held it. Never stack a new baseline under an old one and leave both readable. The reading a withdrawal replaced is rewritten in place under supersede, whether the watched thing moved or the instrument was wrong. A correction that earned a ping is a recent ping on the situational list. The trap a broken instrument taught goes on the standing list, and the reasoning behind it goes to the memory store.

A **read protocol** sits at the top of the ledger, stating what a constrained pass reads and in what order. A pass that cannot read the whole file still reads the parts that stop it doing damage.

**Prune on a quiet tick**, never on a busy one. Move superseded history to a dated archive byte-identical to what it replaced, and verify the hash at the destination rather than at the source. Prohibitions and do-not-reopen traps stay on the ledger, however old, until their source retires them. Re-derive any section offsets or line pointers after the last edit of the pass, not before.

## Tick Order

The order is fixed. What a tick does inside the act step is the runbook's business, and the sequence around it does not vary.

1. **Ensure the heartbeat is armed first**, before any check, on any restart. This is the safety arm, and its cadence is the runbook's to state. Session-only timers die with the session, so a loop that checks first and arms later is one crash away from silence nobody notices. A heartbeat already running satisfies this step; the move is to look, not to add a second.
2. **Re-derive the board** from the watched system's own source of truth. Never from the ledger, the handoff, or any situation text a wake prompt carries. A self-authored prompt carries none, by the rule under Wake mechanics, and an operator-authored one may. Each of those is a hint with a timestamp, written by a pass that could not see this one.
3. **Re-measure before obeying.** For every standing DO or DO-NOT that cites a condition, measure the condition now, and re-read the governing document behind it. A plan doc outranks the ledger for that plan's gate: the ledger line was true when it was written and the plan changed under it.
4. **Act**, then **write the ledger**, then **ensure the next wake is armed**, then **sleep.** The write refreshes what the re-derivation measured and leaves any other line as found. On a static board the heartbeat is that wake and nothing more is armed.

## Wake mechanics

A self-authored wake prompt carries the standing prohibitions and a pointer to the ledger, and nothing else. It never carries a situation report. Prohibitions age well and a situation does not. A stale armed instruction is worse than none, because a pass with nothing to contradict it follows it.

Check the timer list against the clock before assuming pacing is covered. A one-shot whose time elapsed during a long pass is stale rather than pending. It fires the instant the pass ends, which reads as a wake the loop did not schedule. Timers fire only while the session is idle, so a long attended turn defers the heartbeat. That is expected behavior, not a broken timer.

Pacing follows the board: a static board gets the heartbeat only, an active one gets a one-shot 15 to 60 minutes out. A board is active when something on it is expected to change before the heartbeat comes round again. A board you cannot confidently place is active, because an unnecessary one-shot spends a pass and a missing one spends the window the loop existed to watch.

## Ping Template

A ping to the operator has three parts, in order:

1. **Corrections to earlier claims, first.** Labeled as a correction, and sent at all only when the correction changes the shape of the operator's decision.
2. **The ask or the report**, in the client-briefing register, which the doctrine owns.
3. **The evidence line**, naming each figure's source and subject, as the doctrine's Before You Send list asks.

Carry a **dedup key per condition**: one ping per condition, and never a re-send of an ask already pending. A loop that re-asks reads as escalation and spends the operator's attention on a question they already answered.

Escalate only under the doctrine's "Pause only for a true blocker" bullet, and report a measurement whose source is down as the doctrine's "cannot measure".

## One-Way-Door Preflight

Before any closure, dismissal, delete, or resume on the watched system, name in one sentence what will act on the thing afterward. If the answer is "the mechanism this closure removes", do not close it. Those four are instances of the class: any action that removes the thing that would have brought the item back.

Killing a dispatched agent is that same door: probe it with a message first, per the doctrine's probe bullet. A watch's tick is none of the wakes `finishing-work`'s unavailability rule fires at, so every pass with a dispatch in flight evaluates that rule's wedge hallmark. It reads `skills/finishing-work/SKILL.md` under the plugin root from the bold lead **Unavailability is the gate failing to run at full strength** and takes every window from that rule, never inventing one. A loop staring at a quiet directory manufactures the stall signal for itself, because quiet is most of what a watch looks at.

## Ending a Watch

A watch ends when the quiet streak runs long enough that the operator retires the loop. It then hands over what the interventions taught, split between what the watched system should do for itself and what the kit should stop the agent doing. So each pass records the condition, what was done, and what it turned out to mean about the watched system.

The destination rule sends a decision about a plan to that plan's Chapters, and a durable lesson about the watch's own instruments to the memory store in the pass that produced it. The ledger keeps the pass record and the current state, and nothing is written to the ledger twice. On a watch with no scheduled end, a standing seat, that write-time routing is the whole mechanism, since distil-at-retirement never fires.
