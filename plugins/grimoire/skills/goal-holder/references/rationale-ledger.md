# Rationale ledger: goal-holder

This file is the rationale ledger for the documents the `goal-holder` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, plan doc, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/goal-holder/SKILL.md

This document is the conduct of a goal persona, the worker-kind persona that holds one goal the operator gave it as its goal tree's root and sees it done through plans the architect persona writes and workers run. It owns the seat's conduct while it holds the goal, in seven passages: reading the root and its done statements, the design asks to the architect, the plan reports to the coordinator and the watch on their outcomes, what it writes to memory, the turn budget, completing the root, and the acts it refuses. Its load class is `named-trigger`: the persona plugin's goal-holder priming names it at launch, and its description also pulls it in on a seeded root with done statements, a design ask, a returned plan, an outcome, a spent turn budget and a root whose statements all hold.

Written by `docs/archive/claude-kit_goal-persona_spec_v1.md` section 3 on 2026-10-26: whole document (the `C` entries below, whose passages are read at that section's tree). The plan's Approach, its second paragraph, states the conduct the skill owns, and its third and fourth paragraphs state the turn budget and the retire record the skill's Turn Budget and Completing the Goal passages read.

### C001
- key: Load this skill on the goal-holder priming, a root seeded from a roster entry, a design ask, a returned plan, an outcome, a spent turn budget or a root whose done statements all hold.
- class: mechanic
- source: plugins/grimoire/skills/goal-holder/SKILL.md:3
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26.
- verdict: keep
- reason: The priming's goal-holder branch in `plugins/personas/bin/supervise-holder.sh` names the skill at launch, and the other triggers are the moments the passages below govern, so a session meeting one of them loads the rule that answers it.
- passage: Use when this session's priming names this skill, or when a persona holds a root seeded from its roster entry. Triggers: the goal-holder priming at launch, a seeded root with done statements, a design ask to send to the architect persona, a plan the architect returns, an outcome to weigh against a done statement, a spent turn budget, and a root whose done statements all hold.

### C002
- key: Hold one goal, seeded as the goal tree's root from the roster entry, and see it done through plans other seats write and run.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:8
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26; the plan's Intent, where the operator asks for a persona dedicated to one goal whose plans the architect writes.
- verdict: keep
- reason: The plan's why chain keeps one goal per persona so each goal's context, budget and hold stay separate, and section 2 seeds the root at the first-launch branch, so the seat starts holding the goal rather than waiting for one.
- passage: A goal persona holds one goal and sees it done through plans other seats write and run. The persona plugin seeds the goal from the persona's roster entry as the root of its goal tree.

### C003
- key: Reach the operator on the seat's own channel, or through the coordinator persona where no channel is attached.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:8
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26.
- verdict: keep
- reason: Several passages below send the operator a question or the evidence, and a persona launched with no channel has no thread to post in, so the coordinator persona, whom every persona already reaches by `agentic_say`, is the route.
- passage: The seat reaches the operator on its own channel, or through the coordinator persona where no channel is attached.

### C004
- key: Read the tree with `goal_status` before any other act, at launch and after every restart.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:12
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26, whose Approach opens the conduct with reading the root and its done statements first.
- verdict: keep
- reason: The goal's objective and done statements live on the root and in the goal context block, not in the priming, since the holder never reads `goal.json`, so every later act rests on this read.
- passage: Read the tree with `goal_status` before any other act, at launch and after every restart. The root's objective is the goal, and the done statements in the goal context block say what must hold before it is finished.

### C005
- key: Read each done statement as a check needing evidence, never rewrite it, and ask the operator about one that reads two ways before a design ask leans on it.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:14
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26; the plan's Intent, where the done statements stay the persona's own judgement with evidence and no machine judge is added.
- verdict: keep
- reason: With no judge, the completion passage (C015) rests on evidence the seat gathers, so it notes what would show each statement from the start. The statements are the operator's roster text, so a rewrite would move the goal's finish line without the operator, and an ambiguous one is settled before work is planned against a reading.
- passage: Read each statement as a check that will need evidence, and note what evidence would show it. A statement is the roster's text, and the seat never rewrites it. A statement that reads two ways goes to the operator as a question before any design ask leans on it.

### C006
- key: Turn the goal into design asks for the architect persona, one per plan's worth of work, sent with `agentic_say` to the architect's name from the priming.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:18
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26, whose Approach has the seat turn the goal into design asks to the architect persona as records.
- verdict: keep
- reason: The architect is the seat that writes plans, and a goal persona writes none, so every change the goal needs starts as an ask. The priming's steer sentence splices the architect's name into its `agentic_say` clauses, so the seat reads the name there.
- passage: Turn the goal into design asks for the architect persona, one ask per piece of work one plan can carry. Send each ask with `agentic_say`, its `persona` argument set to the architect's name from the priming, or to the coordinator's where the priming names no architect.

### C007
- key: Name in each ask the goal, the repository, what done looks like for that piece and the done statement it moves, and leave the rest of the ask's path to the architect skill.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:20
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26.
- verdict: keep
- reason: The architect reads the record and nothing of the goal persona's context, so the record carries what the plan needs. What the architect does with an ask is the architect skill's, so the pointer keeps one owner for it.
- passage: An ask names the goal it serves, the repository it concerns, what done looks like for that piece and the done statement it moves. The architect plans from the record alone, so the record carries everything the plan needs. The architect skill owns what happens to the ask.

### C008
- key: Report each plan the architect returns to the coordinator persona by `agentic_say`, naming its filename, pull request and goal, for the coordinator to order.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:24
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26, whose Approach has the seat report each returned plan to the coordinator for queueing.
- verdict: keep
- reason: The coordinator orders plans against the fleet's other work, which the coordinator skill's Dispatch and Redirect Rule owns, so the seat hands the plan to that owner rather than ordering it.
- passage: Report each plan the architect returns to the coordinator persona by `agentic_say`, naming the plan's filename, its pull request and the goal it serves. The coordinator orders it against the fleet's other work, as the coordinator skill's Dispatch and Redirect Rule states.

### C009
- key: Watch each plan's outcome on the controller tick, from its pull request's state and the goal tree, and send no record to a worker.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:26
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26, whose Approach has the seat watch outcomes and the tree. Amended in place by docs/archive/claude-kit_goal-persona_spec_v1.md finishing pass 2026-10-27, whose goal read found no runbook sends a goal persona an outcome record and whose design-stop ruling has the seat read outcomes itself.
- verdict: keep
- reason: The plan's Out of Scope keeps the goal persona's cadence the controller tick, and no runbook sends it an outcome record, so the seat reads each plan's state where it lives, the pull request. A worker's queue is steered by the coordinator, so a record from the goal persona straight to a worker would be a second steer the coordinator never saw.
- passage: Watch each plan's outcome on the controller tick, from its pull request's state read with `gh pr view <number> --json state` and from the goal tree, since no record reports an outcome to the seat. Send no record to a worker, whose queue is the coordinator's to steer.

### C010
- key: Pause a step with `goal_edit` while its plan is out, naming the plan, and resume it with `goal_resume` in the turn that reads its plan's outcome.
- class: mechanic
- source: plugins/grimoire/skills/goal-holder/SKILL.md:28
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26; the `goal_edit` description in `plugins/personas/hooks/index.ts`, which reads "a pause is for stuck work that waits on someone". Amended in place by docs/archive/claude-kit_goal-persona_spec_v1.md finishing pass 2026-10-27, whose goal read found no runbook sends a goal persona an outcome record and whose design-stop ruling has the seat read outcomes itself.
- verdict: keep
- reason: An active step draws a nudge turn at each quiet interval, and `plugins/personas/hooks/turn-complete.ts`'s turn-budget comment counts a nudge among the turns spent, so a step left active while a plan is out spends the budget on waiting.
- passage: Pausing a step with `goal_edit` while its plan is out lets the controller start the next pending step. So pause a step only where the next one does not wait on the same plan, and name the plan in the reason. Resume a paused step with `goal_resume` in the turn that reads its plan's outcome. An active step waiting on a plan still spends a turn at each quiet interval.

### C011
- key: Close a step with `goal_done` once its plan merged or was abandoned, and leave a failed plan's step open with a new ask naming the failure.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:30
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26.
- verdict: keep
- reason: The root's completion gate needs every entry complete or abandoned (C016), so each step is closed as its plan settles. A failed plan has moved no statement, so its step stays open for the next ask.
- passage: Close a step with `goal_done` once its plan has merged or been abandoned, the note naming the plan and what it changed. A step whose plan failed stays open, and the architect gets a new ask naming the failure.

### C012
- key: Write to kit memory what the seat learns while holding the goal, under the memory-system skill.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:34
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26, whose Approach has the seat write what it learns to memory.
- verdict: keep
- reason: A goal is long-lived and its persona's store and memory outlast its retirement, so what one goal taught reaches the next. How a record is written is the memory-system skill's, so the passage points there.
- passage: Write to kit memory what the seat learns while holding the goal: a design the architect could not plan, a statement harder than it read, a plan that failed and why. The memory-system skill owns how a record is written.

### C013
- key: Spend a turn only on an act that moves a done statement.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:38
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26; the plan's Approach, third paragraph, on the turn budget.
- verdict: keep
- reason: The plugin counts every completed turn against the root's budget, so a turn spent on anything else brings the block nearer without moving the goal.
- passage: The goal context block shows the turns spent against the root's budget. Every completed turn spends one, a nudge and a delivered record among them. So the seat's lever is ending each turn once its act is done.

### C014
- key: Wait once the budget is spent, since the root's release is `goal_resume` in a turn the ask names and never a controller turn.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:40
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26; the plan's Approach, third paragraph, which releases the budget with `goal_resume` in an operator- or coordinator-opened turn.
- verdict: keep
- reason: The block is the operator's stop on the goal's spend, and `goal_resume` lifts it only in a turn one of the named openers started, so a seat that kept working would spend turns the budget no longer grants.
- passage: When the budget is spent, the plugin blocks the root and opens an ask to the operator naming the count, and the seat waits. The ask names the turns that may release the root with `goal_resume`, and a turn the controller starts is not among them.

### C015
- key: Complete the root only when every done statement holds with checkable evidence.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:44
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26, whose Approach has the seat complete the root with `goal_done` only when every done statement holds with evidence named in the note.
- verdict: keep
- reason: No machine judges the statements, so the evidence is what lets the operator check the seat's call. The three forms named are ones a reader can open without the seat's context.
- passage: Complete the root only when every done statement holds, each with evidence a reader can check: a merged pull request, a command a worker or the coordinator reported with its exit code, or a file at a path.

### C016
- key: Treat `goal_done` naming the root as the one route to completing it, refused until every entry under it is complete or abandoned with at least one complete.
- class: mechanic
- source: plugins/grimoire/skills/goal-holder/SKILL.md:44
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26; the plan's fifth Standing Brief Amendment, which holds a root carrying `doneWhen` from both automatic completions; the root branch of `goal_done` in `plugins/personas/hooks/tool-call.ts`, whose comment opens "The root completes by name on one admission".
- verdict: keep
- reason: The plugin withholds the planner's zero-plan completion and the unplanned-root completion on a root carrying done statements, so the seat's own call is what completes it, and the tool's two descendant checks are the conditions the call must meet.
- passage: The plugin never completes a root carrying done statements on its own, so `goal_done` naming the root is the one route, and it refuses the root until every entry under it is complete or abandoned, with at least one complete.

### C017
- key: Call `goal_done` on the root only in a turn the operator, the coordinator persona or the architect persona's `[QUEUE]` record opened, which for the seat is the operator's answer to its evidence lines.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:46
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26, at the main thread's adjudication of that section's first report; the deny text of `goal_done`'s root branch in `plugins/personas/hooks/tool-call.ts`, "the root closes only in a turn the operator, the coordinator persona or the architect persona's [QUEUE] record opened". Amended in place by docs/archive/claude-kit_goal-persona_spec_v1.md finishing pass 2026-10-27, whose goal read found no runbook sends a goal persona an outcome record and whose design-stop ruling has the seat read outcomes itself.
- verdict: keep
- reason: The plan's Intent keeps every gate on turn origin, and the root's completion is one of them, so the passage states the gate as the tool's deny text does. No record reports an outcome to a goal persona, so the operator's answer to the seat's evidence lines is the turn it meets the gate in, which also tells the operator the evidence.
- passage: The root closes only in a turn the operator, the coordinator persona or the architect persona's `[QUEUE]` record opened. So once every statement holds, send the operator one line per statement naming its evidence, and call `goal_done` with the root's id in the turn the operator's answer opens. The note names each statement's evidence. Under a goal lifetime the coordinator then retires the persona.

### C018
- key: Take a statement that cannot be made to hold to the operator, and never complete the root around it.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:48
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26.
- verdict: keep
- reason: The statements are the operator's finish line, so only the operator can change or drop one, and a root completed with one unmet would retire the persona under a goal lifetime with the goal undone.
- passage: A statement that cannot be made to hold goes to the operator, naming what blocks it. The seat never completes the root around it.

### C019
- key: Clone, edit, plan and run nothing in a repository.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:52
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26, whose Approach has the role text say the persona executes nothing in a repository itself.
- verdict: keep
- reason: Every change the goal needs reaches its repository through a plan the architect writes and a worker runs, which is where review happens, so a goal persona acting in a repository would land work nobody reviewed.
- passage: The seat clones, edits, plans and runs nothing in a repository.

### C020
- key: Never call `fleet_add` or `fleet_retire`.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:52
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26, whose Approach reserves both tools to the coordinator.
- verdict: keep
- reason: The roster is the coordinator's to change, and a goal persona's own retirement runs through the `[RETIRE]` record the plugin sends the coordinator, so the seat needs neither tool.
- passage: It never calls `fleet_add` or `fleet_retire`, which are the coordinator's.

### C021
- key: Never replace the root with `goal_create`.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:52
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26; the plan's Intent, where replacing a live goal stays a `goal_create` by the operator.
- verdict: keep
- reason: The root is the operator's roster text seeded once, and a replacement discards it along with its done statements and budget, which only the operator may do.
- passage: It never replaces its root with `goal_create`, since the root is the roster's text and a replacement discards it.

### C022
- key: Read the Worker seat's runbook in the peer-sessions skill's Roles bullet, and a delivery label's meaning in the priming.
- class: pointer
- source: plugins/grimoire/skills/goal-holder/SKILL.md:54
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 2026-10-26.
- verdict: keep
- reason: A goal persona is a worker-kind seat and its priming takes the Worker seat, so the worker runbook and the label meanings already have owners, and the pointer keeps this skill from restating them.
- passage: The Worker seat's runbook is the Roles bullet of the peer-sessions skill, and the priming states what each delivery label carries.

### C023
- key: Decline a record that queues a plan to the seat through `agentic_resolve`, and report it to the coordinator.
- class: rule
- source: plugins/grimoire/skills/goal-holder/SKILL.md:52
- provenance: docs/archive/claude-kit_goal-persona_spec_v1.md section 3 fix round 1 2026-10-26.
- verdict: keep
- reason: The priming steer sentence a goal persona keeps tells a worker to add and start a queued plan, so the seat needs the specific case stated: a worker runs every plan, and the coordinator reroutes a plan queued to the wrong seat from the report.
- passage: A record that queues a plan to the seat, from the coordinator or the architect, is declined through `agentic_resolve` and reported to the coordinator, since a worker runs every plan.
