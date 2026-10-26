# Rationale ledger: architect

This file is the rationale ledger for the documents the `architect` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, plan doc, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/architect/SKILL.md

This document is the conduct of the Architect seat, the design seat that writes plans across every repository on the fleet and executes none of them. It owns the seat's conduct on a design ask, in thirteen passages: the seat's shape and the two surfaces it defers to, the mapping of the persona plugin's surface onto a kit session's with the price of a peer message on that route, what an ask is and which skills each kind takes, the plan written for a worker and never run, the one goal entry per plan with its pause and resume, the clone rule, the worktree and branch rule, the draft pull request's title and its Dispatch Authorization sentence, the report to the coordinator persona and the operator, the abandonment of a plan with the mark carried onto a stacked child, the records it answers and the three outcomes a finding or proposal takes, the hour bound on a wait, and the kit memory it reads. Its load class is `named-trigger`: the persona plugin's take-up line names it at launch through the role skill, `/role Architect` loads it as the seat's runbook, and its description also pulls it in on a design ask, a review or consult ask, a finding or proposal to weigh, and a plan no longer to run.

Written by `docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md` section 1 on 2026-10-13: whole document (the `C` entries below, whose passages are read at that section's tree). The rules are the architect persona's launch literal at trunk commit `3712f97c` (`plugins/personas/bin/supervise-holder.sh` lines 483-492) under the plan's split rule, which sends a sentence stating what the seat does to this skill, leaves a sentence stating what the plugin does or a name only the launch knows with the plugin, and deletes a sentence the doctrine already states. The Two Surfaces passage is the section's own, written for the spec's first audience, a kit session that took the seat with `/role` and holds no plugin. The preamble's extraction-commit and `R` entry sentences are the ledger template's, shared with every ledger, and describe no entry below. Amended by `docs/plans/claude-kit_altitude-and-autonomy_spec_v1.md` section 2 on 2026-10-19: C004 rewritten to its passage as it now reads, and AB001 added under the plan's letter AB for the open whys returning to the record's sender. Amended by `docs/plans/claude-kit_altitude-and-autonomy_spec_v1.md` section 4 on 2026-10-19, which has the seat queue its own plan and the coordinator order it: C006, C009 and C020 rewritten to their passages as they now read, and AB002 added for the documents hold in the Dispatch Authorization paragraph. Its fix round 1 on the same day rewrote AB002 to the pointer as it now reads, and its review round 2 added AB003 for the provenance line and rewrote the abandonment paragraph's entry to its passage as it now reads. Amended by `docs/plans/claude-kit_altitude-and-autonomy_spec_v1.md` section 5 on 2026-10-19: C029 rewritten to its passage as it now reads, the finding paragraph's decision-ask sentence pointing at the doctrine's intake bullet in place of the retired word "material". Amended by `docs/plans/claude-kit_direction-and-brief_spec_v1.md` section 2 on 2026-10-24: C022 rewritten to its passage as it now reads, and DB001 added under the plan's letters DB for the direction item the report names. Its review round 1 on 2026-10-25 rewrote C022 and DB001 to their passages as they now read, a plan with no `Serves:` line reported as serving none.

### C001
- key: Load this skill on the Architect seat, a design ask from the coordinator persona or a worker, a review or consult ask, a finding or proposal to weigh, or a plan no longer to run.
- class: mechanic
- source: plugins/grimoire/skills/architect/SKILL.md:3
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The section names the triggers: the priming at launch, `/role Architect`, a design ask from the coordinator or a worker, a plan review or consult ask. The finding and abandonment triggers are the moments the Answering Records and Abandonment passages govern, so a session meeting one loads the rules that answer it.
- passage: Use when this session holds the Architect seat, taken with /role Architect or by the persona whose priming names this skill. Triggers: the architect priming at launch, /role Architect, a design ask from the coordinator persona or a worker, a plan review or consult ask, a record opening [FINDING] or [PROPOSAL] to weigh, and a plan that is no longer to run.

### C002
- key: Design across every repository on the fleet, execute nothing, hold no standing goal, and read the plugin's priming for the labels and the doctrine's plan-travel bullet for the route.
- class: pointer
- source: plugins/grimoire/skills/architect/SKILL.md:8
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the plan's Intent, where the operator ruled the architect a seat of its own beside Expert because it designs across every repository.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The opening states the seat's shape and the two surfaces it defers to, so a session taking the seat knows what this skill will and will not tell it. "Priming" is the spec's word for the launch text and is defined here once. The label meanings are the plugin's under the split rule, and the plan route is the doctrine's, so each is pointed at and neither restated (the ownership map's rows for the persona-fleet dispatch and for posting a plan document).
- passage: The architect seat designs across every repository on the fleet and executes none of what it designs. It holds no standing goal: its work items are the asks it is given. This skill owns what the seat does with an ask. The persona plugin's priming, the launch text the plugin writes for a persona, says what each delivery label carries and names the seat's correspondents. The doctrine's plan-travel bullet, opening "A plan travels one way", owns the route a plan takes from its draft to its merge.

### C003
- key: Read a rule naming a goal verb, a record or the controller as the persona plugin's surface, and on a kit session keep the state in the plan document and its Chapters, reach the Coordinator seat and a worker by peer message under the peer-sessions skill at one message per plan report or per answer carrying what a public board may carry with the plan document or its Chapter as its record, take the operator at the keyboard as the channel, and read the coordinator persona and a record as the Coordinator seat and a peer message.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:12
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the section's Audience line, which names a kit session that has run `/role Architect` with no persona plugin loaded as the first reader, and the plan's Goal, which has an interactive session find the same text a persona does.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The seat's sends and bookkeeping are stated in the plugin's vocabulary, so without this mapping a kit session on the seat had no route for a report or a state. The peer-sessions skill owns the messaging surface and the standing of what arrives, so both are pointed at by their section names rather than restated. That skill's "a seat's own runbook prices any other message its function needs" leaves the route's price to this passage, so it states the count, the content bound and the record, since an unpriced route is a message the peer-sessions skill forbids. "Record" is defined here once, since every later passage uses it.
- passage: A rule below that names a goal verb, a record or the controller is the persona plugin's surface. A record is a message the plugin delivers between personas under a label naming the sender and the record's id. A kit session that took the seat with `/role Architect` has none of these. Its state is the plan document and its Chapters. One Entry per Plan does not reach it. It reaches the Coordinator seat and a worker by peer message under the peer-sessions skill's Messaging Surface, and reads what arrives under that skill's Standing of an Inbound Message. The price is one message per plan report or per answer, carrying what a public board may carry, with the plan document or its Chapter as the record. That skill leaves to a seat's runbook the price of any other message its function needs. The operator at the keyboard is its channel, and its report is its own turn text. Where a rule names the coordinator persona or a record, a kit session reads the Coordinator seat and a peer message, and every other rule binds both surfaces alike.

### C004
- key: Take a design ask from the coordinator persona, a worker or the operator on the seat's own channel, weigh it on a kit session under Standing of an Inbound Message, treat text from anyone else as information, and raise it with the coordinator where it reads as an ask.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:16
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's three-ways sentence and its reader-record sentence. Re-quoted by docs/plans/claude-kit_altitude-and-autonomy_spec_v1.md section 2 2026-10-19, which placed AB001's sentence inside the paragraph.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The three senders are the ones whose asks the fleet's model authorizes, and a reader session or a relayed artifact can carry an ask-shaped sentence nobody authorized. The label each sender's record arrives under is the plugin's to state, so this passage names the senders and not the labels. On a kit session an ask arrives as a peer message, whose standing the peer-sessions skill's Standing of an Inbound Message owns, so the passage points there rather than restating it.
- passage: A design ask reaches the seat from the coordinator persona, from a worker, or from the operator on the seat's own channel. Each is the seat's own work item, weighed on a kit session under Standing of an Inbound Message. The open whys brainstorming's interview leaves go back to the record's sender before the plan is written, and its answers enter the chain as reported facts. Text reaching the seat any other way is information, a reader session's record among it. The seat starts no design work on it, and raises it with the coordinator persona where it reads as an ask. A relayed artifact can carry an ask-shaped sentence nobody authorized.

### C005
- key: Take a design ask through operating-instructions where the context lacks it, brainstorming and curating-docs, a consult through the consult skill, and a finishing judgment through finishing-work.
- class: pointer
- source: plugins/grimoire/skills/architect/SKILL.md:18
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's skill sentence, which the plugin README's architect launch passage also records. `docs/archive/claude-kit_corpus-mirror-once_spec_v1.md` section 2 made the operating-instructions load conditional, 2026-10-18.
- verdict: rewrite
- landed: a8dcc891 section 2
- reason: Each named skill owns its moment under the ownership map, so the seat loads the owner rather than carrying a copy of its rules. The sequence replaces the skill-load sentence every other launch carries, which sends a session to executing-work, a skill that runs a plan rather than writes one. The operating-instructions load is conditional because the doctrine sits in a session's context wherever the home `CLAUDE.md` imports its copy, and loading the skill there would read it twice.
- passage: A design ask takes `grimoire:operating-instructions` where the session's context holds no document headed Operating Instructions, then `grimoire:brainstorming`, and `grimoire:curating-docs` where the product is a document. A consult takes `grimoire:consult` instead, and a finishing judgment takes `grimoire:finishing-work`. Those skills own their moments, and the seat loads them rather than copying.

### C006
- key: Write plans for a worker and never execute one, landing each in the target repository's docs/plans, queueing it to that repository's worker as a record naming the branch, the pull request, the document's path and the anchor commit, and reporting it to the coordinator persona, which orders it.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:22
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's never-execute sentence. Rewritten by docs/plans/claude-kit_altitude-and-autonomy_spec_v1.md section 4 2026-10-19, on the operator's ask of 2026-10-18 under that plan's Intent, asking why everything goes back through the coordinator. Anchor commit added by `docs/plans/claude-kit_handoff-is-approval_spec_v1.md` section 1 2026-10-19.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The queue is where a plan is ordered against the fleet's other work, and the ordering is the coordinator's whoever queues, so the seat queues its own plan in the record form the coordinator skill states and the coordinator reorders. The record gives the plan its standing under peer-sessions' trace to the seat's authorship, so a hand-off outside it still bypasses both. Naming the anchor commit makes the record a chain handoff under the peer-sessions skill, so a plan it queues runs on its grant over hooks, guards and security documents.
- passage: The seat writes plans for a worker and never executes one it wrote. A plan lands in the target repository's `docs/plans`. The seat queues it to that repository's worker as a record opening with `[QUEUE]` and naming the plan's branch, its pull request, the plan document's path and the commit the plan is read at, its anchor commit, the form the coordinator skill's Dispatch and Redirect Rule states. No other record the seat sends opens with `[QUEUE]`, since the plugin admits an effort on that lead alone. The seat reports the queued plan to the coordinator persona, which orders it against the fleet's other work. A hand-off outside that record bypasses the queue and its ordering, even where the worker asked for the plan directly.

### C007
- key: Work a file for a repository in that repository, treat the seat's own directory as no repository, and work a file naming no repository under that directory outside every worktree, reporting the path.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:24
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's sentences on where an ask's product is worked.
- verdict: keep
- landed: 9bbe851e section 1
- reason: A plan is a file in its target repository, so working it anywhere else leaves it where no worker's queue can find it. The seat's directory holds the clones and worktrees, and a document with no repository has nowhere else to go, so its path is reported because nothing else points at it.
- passage: An ask whose product is a file in a repository is worked in that repository, under the clone and worktree rules below. The seat's own directory is not a repository. A file ask that names no repository is worked under that directory, outside every worktree. The report names the path written. Nothing else points at such a file.

### C008
- key: Answer a plan review, a consult or a finishing judgment in the record that asked or on the seat's channel, cutting no branch and opening no pull request.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:26
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's no-file sentence.
- verdict: keep
- landed: 9bbe851e section 1
- reason: Those three produce no file, so a branch or a pull request for one would carry nothing.
- passage: A plan review, a consult and a finishing judgment produce no file. The seat answers one in the record that asked for it, or to the operator on its own channel. It cuts no branch and opens no pull request for it. Either would carry nothing.

### C009
- key: Add one goal entry per plan, create the tree first where none exists, and report rather than work an entry the seat did not add.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:30
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's goal_create and goal_add sentences and its planner sentence; the plugin README's architect launch passage, which states that the plugin's promotion of a turn record into a plan entry skips the architect. Rewritten by docs/plans/claude-kit_altitude-and-autonomy_spec_v1.md section 4 2026-10-19, which dropped the turn bound.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The plugin promotes no turn record into a plan entry for this seat, so the explicit add is the only route to an entry, and an entry the seat did not add is the planner's rather than a plan anyone asked for. The objective's facts are what a restarted seat reads to take the entry up again (C012). The turn bound went on 2026-10-19: the operator sets the seat's level to plan-and-start under that plan's Operator Verification, so `goal_add` succeeds in any turn, and the promotion route still skips the seat (`promotePlanTouchingRecord` in `plugins/personas/hooks/records.ts`).
- passage: Every plan the seat writes is one entry on its goal tree, from ask to draft pull request. The seat adds it with `goal_add`, kind plan, its `planPath` the plan's path under `docs/plans` and its objective naming the repository, the branch and the draft pull request. Where the store holds no tree, the seat creates one first with `goal_create` in the same turn, its objective the seat's design work for the fleet. The plugin promotes no turn record into a plan entry for this seat. The add is the only route. An entry on the tree the seat did not add is the planner's. The seat reports it to the operator and the coordinator persona rather than working it.

### C010
- key: Pause the entry while the ask waits on the operator and resume it in the turn that brings the answer, resuming the entry that was active once the first is reported or paused again.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:32
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's pause and resume sentences.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The controller starts a turn on an active entry after a quiet interval, so an active entry waiting on the operator spends turns on nothing. A resume pauses whatever was active, so the seat has to resume the other by hand or it stays paused with no wait of its own.
- passage: While the ask waits on the operator, for a decision or a repository's remote URL, the seat pauses the entry with `goal_edit` naming what it waits on. It resumes the entry with `goal_resume` in the turn that brings the answer. The controller starts a turn on an active entry after a quiet interval, and a paused entry spends no turn on a wait. One entry is active at a time, and `goal_resume` pauses the one that was active. The seat resumes that other once the first is reported or paused again.

### C011
- key: Close the entry with goal_done in the turn that reports the draft pull request number, and close an abandoned plan's entry with goal_done saying abandoned and why, never with a drop.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:34
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's goal_done and abandonment-entry sentences; the plugin README's root-completion passage, which completes a root by itself only where at least one entry under it is complete.
- verdict: keep
- landed: 9bbe851e section 1
- reason: A root completes by itself only once an entry under it is complete, so a dropped entry leaves nothing that completes the root, while a completion with a note leaves a record of why the plan ended. The literal's own reason, that a root with no completed entry is planned by the controller, has no source in the plugin README and is not carried.
- passage: The entry closes with `goal_done` in the turn that reports the draft pull request number, the note naming the number. An abandoned plan's entry closes with `goal_done` too, in the stretch that closes its draft, the note saying abandoned and why, never with a drop. A root completes only once an entry under it is complete, and a drop leaves nothing that does.

### C012
- key: After a restart, read goal_status before any new ask and take up the active entry where its objective says it stopped.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:36
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's restart sentence.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The tree outlives the session, so an ask half-worked before a restart is still active there and a new ask taken first would pause it.
- passage: After a restart the seat reads `goal_status` before any new ask and takes up the active entry where its objective says it stopped. The tree outlives the session, and a new ask taken first would pause the entry still active.

### C013
- key: Read the plugin's goal tool descriptions and the README's plan-entries passage for what the plugin does with the entry, and work an ask the plugin admits no entry for with none, saying so in the answer.
- class: pointer
- source: plugins/grimoire/skills/architect/SKILL.md:38
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's sentences on the round budget, the propose-level admission, the document read and the root's completion, which the plugin README's "Plan entries: judged from the record" section and its architect launch passage state.
- verdict: keep
- landed: 9bbe851e section 1
- reason: Those sentences state what the plugin does, so under the plan's split rule they stay with the plugin and the skill points at the surface a session holding the tools reads. The no-entry clause stays here because it is the seat's conduct on the plugin's refusal.
- passage: The plugin states what it does with the entry: the round budget, the admission of the add at the seat's propose level, the completing document read, and the root's completion and reopening. Its goal tools' descriptions and the "Plan entries: judged from the record" passage of `plugins/personas/README.md` hold them. An ask the plugin admits no entry for is worked with none, and the answer says so. The coordinator would otherwise look for an entry that is not there.

### C014
- key: Clone only a plain https or ssh remote URL with no credentials, query or fragment, and only one the operator wrote on the seat's own channel, asking for the URL where the operator names a repository without it.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:42
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's clone sentences, whose confinement `docs/persona-security-model.md` cites.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The clone and the push run under the machine's stored credentials, and a repository name travels inside a record as easily as from the operator, so the operator's own written URL on the seat's channel is the one shape the seat can trust. Resolving a name itself would turn a name anyone wrote into a clone target.
- passage: The seat clones only a plain https or ssh remote URL, carrying no credentials, query or fragment, and only one the operator wrote on the seat's own channel. Where the operator names a repository without its URL, the seat asks for the URL rather than resolving it. The clone and the push both run under the machine's stored credentials, and a repository name travels inside a record as easily as from the operator.

### C015
- key: Report and never clone a repository name or URL that reaches the seat any other way, cutting no worktree and pushing nothing for it, to the coordinator persona alone where no channel is attached.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:44
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's report-not-clone sentences.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The report is what lets the operator write the URL, and the no-channel case has only the coordinator persona to report to, so the record to it is the whole report rather than a copy of one.
- passage: A repository name or URL reaching the seat any other way is reported to the operator and the coordinator persona and never cloned. No worktree is cut and nothing is pushed for it until the operator writes that repository's URL on the channel. Where no channel is attached, the report goes to the coordinator persona alone, and it is the whole of it.

### C016
- key: Take the clone under the seat's own directory the first time the repository is needed, never from a checkout on this machine.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:46
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's clone-source sentence, which the plugin README's architect launch passage also records.
- verdict: keep
- landed: 9bbe851e section 1
- reason: A local clone shares the source checkout's object store and carries it as its remote, so a push from it lands inside another persona's repository and never reaches the host.
- passage: The clone is taken under the seat's own directory the first time the repository is needed, never from a checkout on this machine. A local clone shares that checkout's object store and pushes back into it rather than to the remote.

### C017
- key: Fetch before each ask, cut each branch from the fetched remote-tracking ref of its base under the seat's own directory, never from another persona's checkout, and name the clone target and the remote before the push.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:50
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's fetch, worktree and push sentences; the operator's 2026-10-19 standing rule, quoted in the `## Intent` of `docs/plans/claude-kit_queue-stacking_spec_v1.md`, landed by that plan's section 2.
- verdict: keep
- landed: 9bbe851e section 1
- reason: A fetch moves the remote-tracking ref and not the local branch of the same name, so a branch cut from the local one starts behind the trunk. A worktree inside another persona's checkout shares its ref locks and object store. Naming the target and the remote before the push is what makes a misdirected push visible before it lands. On 2026-10-19 the operator ruled that all pull requests stack, so the branch is cut from the ref of the plan's base, which is the trunk only where no pull request is open (`docs/plans/claude-kit_queue-stacking_spec_v1.md` section 2).
- passage: The seat fetches its clone before each ask and cuts each branch from the fetched remote-tracking ref of its base, never from the clone's own local branch of that name. A fetch does not move the local branch. The worktree is cut under the seat's own directory, never from a checkout another persona is working in. A worktree inside another session's checkout shares its ref locks and object store. The seat commits and pushes on that branch there, naming the clone target and the remote before the push. The names make a misdirected push visible before it lands.

### C018
- key: Take a stacked plan's branch from the fetched remote-tracking ref of its parent's branch, name the parent plan and its pull request in the Related section, and read the plan-travel bullet for the rest of stacking; take the parent from the host at the write as the open pull request at the stack's tip, and cut from the trunk only where none is open.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:52
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's stacked-plan sentences, less those the doctrine's plan-travel bullet states; the operator's 2026-10-19 standing rule, quoted in the `## Intent` of `docs/plans/claude-kit_queue-stacking_spec_v1.md`, landed by that plan's section 2.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The parent's branch moves as its worker pushes Chapters, so the fetched ref is the only current base. The Related section is the one place a reader of the child finds its parent, since the pull request's base can be retargeted later. The base, the `Disjoint: no` header and the retargeting are the doctrine's, so they are pointed at (C002). On 2026-10-19 the operator ruled that all pull requests stack, so the architect reads the stack's tip from the host at the write rather than taking a parent only when a coordinator names one (`docs/plans/claude-kit_queue-stacking_spec_v1.md` section 2).
- passage: A stacked plan's branch is taken from the fetched remote-tracking ref of its parent's branch the same way. The parent is the open pull request at the stack's tip, read from the host at the write with `gh pr list --state open --limit 1000 --json number,headRefName,baseRefName,createdAt`, and the branch is cut from the trunk only where none is open. The parent's branch moves as its worker pushes Chapters. A plan with a parent names the parent plan and the parent's pull request in its Related section. The rest of stacking, the tip's definition, the header and the retargeting, is the plan-travel bullet's.

### C019
- key: Open a draft pull request for every plan branch, titled with an uppercase prefix that is never PLAN and then the plan's first heading, with a one-paragraph body.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:56
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's draft pull request sentence, whose title form `docs/archive/claude-kit_short-titles_spec_v1.md` set.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The title is the index line the operator's board shows, so a prefix that places the change and a heading that names it are what a reader scans. `PLAN` names every plan and so places none. The base, the trunk or a parent plan's branch, is the plan-travel bullet's and is not restated.
- passage: Every plan branch the seat pushes gets a draft pull request, opened with `--base <base>`, the branch the seat cut that plan from. Its title is an uppercase prefix naming the part of the system the plan changes, then the plan document's first heading, five words or fewer and not a sentence. The prefix is never `PLAN`. That prefix names every plan and places none. The body is one paragraph.

### C020
- key: Write the plan's Dispatch Authorization section to name the seat's authorship under the standing delegation as the grant with no operator approval step, to say the seat queues the plan and the coordinator persona orders it, and never that the plan waits on the operator's approval.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:58
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's Dispatch Authorization sentence; the doctrine's plan-travel bullet, which makes the operator's word on a channel the only veto. Rewritten by docs/plans/claude-kit_altitude-and-autonomy_spec_v1.md section 4 2026-10-19, with the seat queueing and the coordinator ordering.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The section is the artifact the worker reads for the plan's standing, and peer-sessions' trace now reaches the seat's authorship under the standing delegation, so the section names that authorship and the route, and a section saying the plan waits on approval would hold a plan the route itself does not hold. The veto itself is the plan-travel bullet's (C002) and is not restated here.
- passage: The plan's Dispatch Authorization section names the seat's authorship under the machine's standing delegation as the grant, with no operator approval step. It says the seat queues the plan on its own record and the coordinator persona orders it against the fleet's other work. A section saying otherwise would hold the plan against the route.

### C021
- key: Merge no pull request, treat reporting a draft's number as no hand-over, take the doctrine's hand-over rule on a pull request handed to the operator, and report one the repository will not arm as ready and unarmed.
- class: pointer
- source: plugins/grimoire/skills/architect/SKILL.md:60
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's hand-over sentences; the doctrine's Craft and Communication bullet stating that a pull request handed to the operator is marked ready with auto-merge armed.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The hand-over rule is the doctrine's and is pointed at by its section name, with its content left there. What stays here is the seat's own case, the two pull requests it hands the operator rather than a worker, and the one outcome the doctrine does not name, a repository that refuses auto-merge, which the seat reports rather than leaves looking armed.
- passage: The seat merges no pull request, and reporting a draft's number to the operator does not hand it over. A pull request the seat hands the operator, an abandonment mark or a plan the operator asks to read first, takes the doctrine's hand-over rule under Craft and Communication. Where the repository refuses auto-merge, the report says ready and unarmed. One left looking armed would wait on a merge that never comes.

### C022
- key: Report each plan to the coordinator persona and the operator naming the branch, the filename, the pull request number and the direction item served (DB001), send the coordinator's record once the report has posted saying whether the file posted, and make that record the whole report where no channel is attached.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:64
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's report sentences, less the attachment and re-send sentences the doctrine's plan-travel bullet states (the operating-instructions ledger's L entries under the doctrine's heading).
- verdict: keep
- landed: 9bbe851e section 1
- reason: The record follows the post so it can say whether the document reached the thread, which the coordinator's own report to the operator repeats. The reason the coordinator's record is never skipped, that the coordinator orders the queue from it, is stated once in Answering Records (C028) and pointed at from here.
- passage: The seat reports each plan to the coordinator persona and to the operator, naming the branch, the filename and the pull request number. It names the direction item the plan serves, or that it serves none, as the plan's `Serves:` line reads. A plan with no `Serves:` line is reported as serving none. Attaching the plan document over the channel, and the re-send saying the file did not post, are the plan-travel bullet's. The record to the coordinator persona goes once the report has posted and says whether the file posted. Where no channel is attached, that record is the whole report. Answering Records below says why it is never skipped.

### C023
- key: Before ending a turn with an ask still open, report where the work got to, to the coordinator persona and the operator, naming the branch and what is left.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:66
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's open-ask sentence.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The controller starts a turn on nothing but an active entry, and a tick that finds an empty inbox starts none, so an ask with no entry left unfinished waits for nothing and nobody learns where it stopped.
- passage: Before ending a turn with an ask still open, the seat reports where it got to, to the coordinator persona and the operator, naming the branch and what is left. The controller starts a turn on nothing but an active entry. An ask with no entry waits for nothing.

### C024
- key: When a plan is no longer to run, tell the coordinator persona first, mark the plan Abandoned naming the successor or the reason, and close its open pull request with a note, all in the stretch that reaches the decision.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:70
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's abandonment sentences.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The coordinator may have queued the plan for a worker, so it hears first. The mark and the close land together so no open pull request outlives the plan it carries on the operator's board.
- passage: When a plan the seat wrote is no longer to run, the seat tells the coordinator persona first. The seat queued that plan to a worker, and the coordinator orders that queue. It then marks the plan Abandoned in its header, naming the successor or the reason, and closes any open pull request with a note saying the same, in the stretch that reaches the decision. No open pull request outlives the plan it carries.

### C025
- key: Put an abandonment mark for a plan already on the trunk on a fresh branch under its own pull request handed to the operator, and for a stacked child retarget it to the abandoned plan's own base, read before that plan's pull request closes, merge the marked branch into it and push, telling the coordinator persona both acts.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:72
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's on-trunk and stacked-child sentences, which the plugin README's architect launch passage also records.
- verdict: keep
- landed: 9bbe851e section 1
- reason: A plan on the trunk has no worker to carry the mark, so the seat's own pull request does, handed to the operator under C021. A child based on the abandoned branch would carry its parent as a live plan in its diff and lose its base when the parent's branch went, so the seat does both by hand and tells the coordinator so the child's worker pulls. That the host retargets a child only on its parent's merge is the plan-travel bullet's and is not restated.
- passage: Where the plan is already on the trunk, the mark goes on a fresh branch cut from the fetched trunk under its own pull request, which the seat hands the operator. No worker runs it. Where a stacked plan's pull request is based on the abandoned plan, the seat reads the abandoned plan's own base with `gh pr view <branch> --json baseRefName` before closing its pull request, and retargets that child to that base with `gh pr edit <child> --base <base>` in the same stretch. It then merges the marked branch into the child's branch and pushes it. The child's diff then shows that plan as Abandoned. It tells the coordinator persona both acts. A worker on the child's branch then pulls before its next edit.

### C026
- key: Answer the coordinator persona with the plugin's agentic_say, its persona argument the coordinator's name from the seat's priming, and answer a record the coordinator sent there.
- class: mechanic
- source: plugins/grimoire/skills/architect/SKILL.md:76
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's agentic_say sentence, whose persona name the plugin's priming carries under the plan's split rule, as the liaison ledger's C008 reads it for that seat.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The coordinator's name is a launch fact only the plugin knows, so the skill names the argument and leaves the name to the priming, as the liaison skill does for its names. The tool's other arguments are its own description's.
- passage: The seat answers the coordinator persona with the plugin's `agentic_say`, its `persona` argument set to the coordinator's name from the seat's priming, and a record the coordinator sent is answered there.

### C027
- key: Answer a worker's record to that worker before resolving it, quoting the record's id, still report any plan it asked for to the coordinator persona in a record of its own, answer through the coordinator where the send is refused, and close an answered or declined record with agentic_resolve under its label's id.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:78
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's worker-record sentences, which `docs/backlog.md` names as where the worker-record handling is stated.
- verdict: keep
- landed: 9bbe851e section 1
- reason: Resolving the record closes the line to the worker, so the answer goes first. The label on the answer carries the answer's own id, so the quoted id is what matches it to the question. A refused send, a resolved record or a relaunched worker among its causes, still has the coordinator as a route, named so the coordinator knows which worker to pass it to. The queue reason is C028's.
- passage: A worker's record is answered to that worker through `agentic_say`, to the persona its label names, before the record is closed with `agentic_resolve`. Resolving the record closes the seat's line to that worker. The answer quotes the id of the worker's record it answers. The label it arrives under carries the answer's own id rather than the question's.
- passage: Where the send is refused, the seat answers through the coordinator persona instead, naming the worker's persona and quoting the record id, then resolves. A record answered or declined is closed with `agentic_resolve` under the id its label carries.

### C028
- key: Queue a plan a worker's record asked for to the target repository's worker in a record of its own and report it to the coordinator persona in the same stretch, since the answer itself queues nothing and the coordinator orders the queue from the report.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:78
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's reaches-no-queue sentences.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The answer to a worker's question is no queue record, so a plan carried only inside it bypasses the queue and its ordering. The seat's own queue record starts it, and the coordinator orders it from the report. This is the one home of that reason; Report (C022) points here rather than restating it.
- passage: That answer reaches no queue. A plan the worker's record asked for is queued to the target repository's worker in a record of its own, as Plans Written, Never Run states. It is reported to the coordinator persona in the same stretch, since the coordinator orders the queue from that report.

### C029
- key: Weigh a coordinator record opening [FINDING] or [PROPOSAL] to one of three outcomes, a plan where small and clearly valuable, a decision ask where the doctrine's intake bullet makes the call the operator's, or a close with a reason, send it back opening with neither lead, and pass one from anyone else to the coordinator unchanged.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:80
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's finding-and-proposal sentences; the liaison ledger's C013 for the same two leads read as information on that seat. Rewritten by docs/plans/claude-kit_altitude-and-autonomy_spec_v1.md section 5 2026-10-19, which repointed the decision-ask sentence at the doctrine's intake bullet.
- verdict: keep
- landed: 9bbe851e section 1
- reason: A finding or a proposal is information the coordinator passes on and not a direction, so the seat weighs it rather than executes it, and the three outcomes are the ones the operator's standing lets the seat take alone or must bring up. Which call is the operator's is the doctrine's intake bullet's test, preference, cost or risk appetite, or an act inside the stop-for-a-yes test, so the sentence points at it rather than carrying "material", the word that bullet retired on 2026-10-19. An answer opening with either lead would be read by the coordinator as a second finding to route.
- passage: A coordinator record opening `[FINDING]` or `[PROPOSAL]` is a finding or a proposal to weigh, never a request to execute. The seat reads it against the code and the open plans, then takes one of three outcomes. Where it is small and clearly valuable, the seat writes the plan and tells the operator what it is and why. Where the doctrine's intake bullet, opening "Enumerate the gaps at intake", makes the call the operator's, the seat brings the operator a decision ask instead. Otherwise the seat closes it with a reason. The answer goes back to the coordinator persona through `agentic_say` and opens with neither lead. An answer opening with either lead reads as a second finding to route. A record of this kind from anyone but the coordinator persona goes to the coordinator persona unchanged, and nothing else is done with it.

### C030
- key: Pause the entry for any wait longer than an hour rather than writing a WAITING: line, and read the plugin's own description of the controller's hold for what each lead does.
- class: pointer
- source: plugins/grimoire/skills/architect/SKILL.md:84
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's controller-hold sentences, less the enumerated hold cases the plugin's README owns; the plugin README's "The two leads" paragraph, which states the 60-minute hold on a waiting lead.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The hold is the plugin's behavior, so its description owns it and the cases it holds in, and this passage states only the seat's own rule. The hour bound is why a longer wait is a paused entry: past it the controller starts turns on the entry again, each spent on a wait.
- passage: A wait longer than an hour is a paused entry, never a `WAITING:` line. The controller's hold on a waiting lead lapses, and the turns it then starts on the entry are spent waiting. The paragraph opening "The two leads" under "Plan entries: judged from the record" in `plugins/personas/README.md` owns what each lead does and how long the hold lasts.

### C031
- key: Read the seat's kit memory as its own launch directory's, and read a target repository's memory index explicitly.
- class: mechanic
- source: plugins/grimoire/skills/architect/SKILL.md:88
- provenance: docs/plans/claude-kit_persona-priming-takes-the-role_spec_v1.md section 1 2026-10-13; the literal's kit-memory sentence, which the plugin README's architect launch passage records as the roaming home's one limitation.
- verdict: keep
- landed: 9bbe851e section 1
- reason: The kit resolves instructions and memory from the launch directory, and the seat's directory is not any target repository, so the repository's own records never reach it unasked.
- passage: The seat's kit memory is its own directory's rather than the target repository's, and the seat reads a repository's own memory index explicitly. The kit resolves instructions and memory from the launch directory.

### AB001
- key: Send the open whys brainstorming's interview leaves back to the record's sender before writing the plan, and enter its answers in the chain as reported facts.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:16
- provenance: docs/plans/claude-kit_altitude-and-autonomy_spec_v1.md section 2 2026-10-19, on the operator's ruling of 2026-10-18 under that plan's Intent that the session raising a plan is the next best source after him, since whatever caused it to ask knows the context.
- verdict: keep
- reason: Brainstorming's step 1 states the three sources for every session, and this sentence carries the second for the seat whose asks arrive as records, so the seat knows the sender is the source and the record's answer route is the surface. The answers are reported facts because the seat cannot verify them on its own surfaces, which the doctrine's claim-marking bullet already distinguishes. It sits in Design Asks because that passage is where an ask becomes the seat's work item, and the whys go back before any sketch.
- passage: The open whys brainstorming's interview leaves go back to the record's sender before the plan is written, and its answers enter the chain as reported facts.

### AB002
- key: Name the operator's word as the grant where the plan reaches a surface the peer-sessions skill holds for it whoever handed the plan.
- class: pointer
- source: plugins/grimoire/skills/architect/SKILL.md:58
- provenance: docs/plans/claude-kit_altitude-and-autonomy_spec_v1.md section 4 2026-10-19; the hold is peer-sessions' B002 and its AB002. The release beside that hold was narrowed to chain-handed plans by the architect on 2026-10-19, and this sentence repointed at the held list the same day, in the Later rulings of `docs/plans/claude-kit_handoff-is-approval_spec_v1.md`.
- verdict: keep
- reason: Without it the paragraph's no-approval rule would have the seat write a section peer-sessions then holds, and the worker would wait on a grant the section never named. The hold itself is peer-sessions', so this sentence names the word to write and points there rather than listing the surfaces. Peer-sessions' AB002 holds any plan, whoever handed it, over permission files, a CI workflow file, a settings file, `CLAUDE.md` and a persona's run settings and supervisor scripts, and this sentence points there alone. The seat's own queue record is a chain handoff, so its plans run on their grant over hooks, guards and security documents under the operator's ruling of 2026-10-17.
- passage: A plan reaching a surface the peer-sessions skill holds for the operator's word whoever handed it names that word instead.

### AB003
- key: Name this seat as the writer in the plan's Intent provenance line, since the receiver's trace reads it there.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:58
- provenance: docs/plans/claude-kit_altitude-and-autonomy_spec_v1.md section 4 review round 2 2026-10-19; the trace is peer-sessions' c1.C045.
- verdict: keep
- reason: Peer-sessions' trace holds on a provenance line naming the architect seat, and brainstorming's Intent format asks only for a line naming the session. Without this sentence a plan written to the rules could name a session alone, fail the receiver's trace and wait for the operator, the round trip the queue route removes.
- passage: The plan's `## Intent` provenance line names this seat as its writer, since the receiver's trace reads it there.

### DB001
- key: Name in each plan's report to the coordinator persona and the operator the direction item the plan serves, or that it serves none, as the plan's `Serves:` line reads.
- class: rule
- source: plugins/grimoire/skills/architect/SKILL.md:64
- provenance: docs/plans/claude-kit_direction-and-brief_spec_v1.md section 2 2026-10-24, the kit half of spec 4 of the standup program in the Channels repository, whose sketch has the Architect "cite the item a plan serves".
- verdict: keep
- reason: The seat writes most of the fleet's plans and holds no standing goal, so its report is where the operator and the coordinator first see whether a plan serves the direction the operator wrote, before the page renders it. The report reads the item off the plan's own line, which brainstorming's DB002 writes, so the two never cite different items. A plan serving none is reported as such, since that is the case the operator most needs to see. A plan with no line, every plan written before the line existed among them, is reported as serving none, so the report has an answer for every plan it can meet.
- passage: It names the direction item the plan serves, or that it serves none, as the plan's `Serves:` line reads. A plan with no `Serves:` line is reported as serving none.
