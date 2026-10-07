# Rationale ledger: standing-watch

This file is the rationale ledger for the documents the `standing-watch` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/standing-watch/SKILL.md

This document is the chassis for a session standing watch over a live system it does not own, running as a repeating loop that wakes, checks, intervenes and sleeps again. It owns the moments where a watch decides what its two written surfaces hold and how they are kept: what goes on the runbook versus the ledger, whether a line is admitted to the ledger at all and under which kind, how a superseded fact is rewritten and when history is pruned, the fixed order of every tick (arm the heartbeat, re-derive the board, re-measure before obeying, act, write, arm, sleep), how a wake prompt is authored and how pacing is chosen, the shape of a ping to the operator, the preflight before any one-way-door action on the watched system including killing a dispatched agent, and where a lesson or a decision is routed at the end of a run or during it. Its load class is `named-trigger`: the frontmatter says to use it when a session watches a live system on a repeating loop, when a loop is armed with /loop or a self-authored wake prompt, when a runbook or ledger is in play, or when the operator asks the session to keep an eye on a running system.

Extracted at `6bc07fb`: whole document (`skills.standing-watch.SKILL.md`). Redrafted on 2026-09-26 by section 8 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, landed at `e9d01625` with its fix round at `6f26f01a`, so every live entry's `passage:` line quotes the text at `6f26f01a` and the `flag:` lines record that pass's flags.

### C001
- key: Run a watch on exactly two written surfaces, the runbook and the ledger, and no others.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:12
- provenance: 0ea17a9 2026-08-18, installed with the skill from the forty-one-pass watch loop whose notes went stale and were obeyed as fact (docs/archive/claude-kit_standing-watch_spec_v1.md, Goal).
- verdict: keep
- reason: No finding. The closed class of two is what lets the loop's memory be enumerated at all; a third surface is a third place for state to go stale unnoticed.
- passage: A watch runs on exactly two written surfaces, which differ in what they hold rather than in format.
- flag: weak-reason

### C002
- key: Keep the runbook as the committed, project-specific procedure: what a pass checks, in what order, with which commands, and what each result means.
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:14
- provenance: 0ea17a9 2026-08-18, installed with the skill (docs/archive/claude-kit_standing-watch_spec_v1.md, Approach).
- verdict: keep
- reason: A001. Nothing enforces the runbook's content; the rule holds because the runbook is the only place the procedure survives a session.
- passage: **The runbook** is the procedure: what a pass checks, in what order, with which commands, and what each result means.

### C003
- key: Change the runbook only when the procedure itself changes.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:14
- provenance: 0ea17a9 2026-08-18, installed with the skill.
- verdict: keep
- reason: No finding. It is the boundary that keeps state out of the committed file and procedure out of the ledger.
- passage: It is project-specific, committed, and changes only when the procedure changes.
- flag: weak-reason

### C004
- key: Keep the ledger gitignored under `.kit/`, holding what is true of the watched system now and what the loop learned.
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:15
- provenance: 0ea17a9 2026-08-18, installed with the skill.
- verdict: keep
- reason: A002 to A004. Park's line places a different artifact; the map gives the ledger to this skill; only the gitignore half is mechanical and it is per-project.
- passage: **The ledger** is the state: what is true of the watched system now and what the loop has learned about it. It is gitignored, lives under `.kit/`,

### C005
- key: Rewrite the ledger in place rather than appending to it.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:15
- provenance: 0ea17a9 2026-08-18, installed with the skill; the act's rule at line 36 was earned by RED/GREEN probe B (docs/archive/claude-kit_standing-watch_spec_v1.md line 237).
- verdict: keep
- reason: A005, A006. An attribute in the artifact's definition, not a second statement of the supersede rule that line 36 owns.
- passage: and is rewritten in place rather than appended to.

### C006
- key: Never let anything the loop needs live only in a session's context.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:17
- provenance: 02980e2 2026-08-18 last touched the line in the arming repair; the sentence is the skill's founding premise from 0ea17a9 2026-08-18.
- verdict: keep
- reason: A007 to A009. The premise stays at line 17 under the A008 rewrite; executing-work's recovery lines govern other artifacts.
- passage: Nothing the loop needs lives only in a session's context.

### C007
- key: End every pass in this fixed order: finish the tick, write the ledger, then arm the wake.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:17
- provenance: 02980e2 2026-08-18, the adversarial review's second arming contradiction between this section and the tick order.
- verdict: retire
- landed: e9245e7 section 29
- reason: row 1187 (Safety arm versus paced arm), merged. The owner is tick step 4 (C062): "**Act**, then **write the ledger**, then **ensure the next wake is armed**, then **sleep.**".
- proposed: (via A010) Line 49 (C062) keeps the sequence; line 17 points at the tick order.
- baseline-test: yes
- passage: The order a pass ends on is fixed by the tick order below, at step 4.

### C008
- key: Treat arming before writing as losing the pass, because the write may never happen.
- class: rationale-example
- source: plugins/grimoire/skills/standing-watch/SKILL.md:17
- provenance: 02980e2 2026-08-18, arming repair; the cost was stated at 0ea17a9 2026-08-18.
- verdict: retire
- reason: row 1187, merged. The write-then-arm order it reasoned for is stated whole at tick step 4 (C062), and the reason stays on this ledger.
- passage: A pass that arms before it writes loses the pass when the write does not happen.

### C009
- key: Recognize exactly two arm reasons and no more: the safety arm (standing repeating heartbeat) and the paced arm (a one-shot setting the next pass).
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:17
- provenance: 02980e2 2026-08-18, the two-arm design that ended the second arming contradiction.
- verdict: retire
- landed: e9245e7 section 29
- reason: row 1187, merged. Tick step 1 (C057) names the safety arm: "This is the safety arm, and its cadence is the runbook's to state." The pacing paragraph (C069) owns the one-shot paced arm.
- proposed: The safety arm is the standing heartbeat, a repeating timer whose only job is to guarantee that some wake exists.
- passage: A watch arms for two reasons only. The safety arm is the standing heartbeat, a repeating timer whose only job is to guarantee that some wake exists. The paced arm is a one-shot that sets when the next pass runs.

### C010
- key: On a restart, put the heartbeat up before checking anything.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:17
- provenance: 02980e2 2026-08-18, arming repair; the restart rule itself is from 0ea17a9 2026-08-18 (tick order).
- verdict: retire
- landed: e9245e7 section 29
- reason: row 1187, merged. The owner is tick step 1 (C057): "**Ensure the heartbeat is armed first**, before any check, on any restart.".
- proposed: (via A014) Line 46 (C057) keeps; line 17's restart clause folds into the pointer at the tick order.
- baseline-test: yes
- passage: The tick order opens with the first and closes with the second, and states when each is armed.

### C011
- key: Treat both arm steps as ensure rather than add: add no second heartbeat, and take no one-shot on a static board.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:17
- provenance: 02980e2 2026-08-18, "reads both steps as ensure rather than add" was the repair's own wording.
- verdict: retire
- landed: e9245e7 section 29
- reason: row 1187, merged. The ensure-never-add reading stays at step 1 (C058, "the move is to look, not to add a second") and at step 4 (C063, "On a static board the heartbeat is that wake and nothing more is armed.").
- proposed: (via A016) Lines 46 (C058) and 49 (C063) keep; line 17 keeps only "both steps read as ensure rather than add" as the pointer's gloss.
- baseline-test: yes
- passage: Both steps read as ensure rather than add.

### C012
- key: Treat anything else a tick produces (a ping, a commit, an intervention) as an output of that tick, never as a loop artifact.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:17
- provenance: 02980e2 2026-08-18.
- verdict: keep
- reason: A008. Closes the two-artifact class; survives the line 17 rewrite unchanged.
- passage: Anything else a tick produces, such as a ping, a commit or an intervention on the watched system, is an output of that tick rather than a loop artifact. The class is closed at those two.

### C013
- key: Keep the ledger's two kinds of content in separate sections and never interleave them.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:21
- provenance: 0ea17a9 2026-08-18, installed with the skill.
- verdict: keep
- reason: No finding. Interleaving is what makes a successor sort before it can act (memory a-coordination-ledger-holds-current-state-not-its-own-journey, Resume cost).
- passage: Two kinds of content, in separate sections, never interleaved:

### C014
- key: File as Standing the prohibitions, mechanisms confirmed in the system's source, and do-not-reopen traps, which stay true without re-measurement.
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:23
- provenance: 0ea17a9 2026-08-18, installed with the skill.
- verdict: keep
- reason: A018. No classifier exists. The backlog (line 361) holds a separate design item that this enumeration lacks the trailing-clause marker the gating-definition rule requires. Amendment 2: the docs/backlog.md line 361 cite sits at the item whose bold lead reads 'The watch chassis's own kind definitions fail the gating-definition rule this plan shipped' (line 376 at 16c5e61, every standing-watch item having moved fifteen lines down the file); prefer the lead over the line.
- passage: **Standing**: prohibitions, mechanisms confirmed in the system's source, and do-not-reopen traps. What stays true without re-measurement.

### C015
- key: File as Situational the board as of the last pass, open interventions, recent pings, and the quiet-streak length, which a later pass must re-derive before acting on.
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:24
- provenance: 0ea17a9 2026-08-18, installed with the skill.
- verdict: keep
- reason: A019. No classifier exists. The backlog (line 362) records that a recent ping cannot carry the re-derive command line 34 requires, a design question for the follow-on. Amendment 2: the docs/backlog.md line 362 cite sits at the item whose bold lead reads 'The watch chassis places a situational member that cannot satisfy its own re-derive obligation' (line 377 at 16c5e61, every standing-watch item having moved fifteen lines down the file); prefer the lead over the line.
- passage: **Situational**: the board as of the last pass, open interventions, recent pings, the length of the quiet streak. Everything a later pass must re-derive before acting on.

### C016
- key: Place a line on the ledger only if a successor with no context needs it to resume the watch.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:26
- provenance: 3074425 2026-08-31, the coordinator board that filled with its own journey; banked operator-tier as a-coordination-ledger-holds-current-state-not-its-own-journey.
- verdict: keep
- reason: A020. The three disqualified grounds are what stops the old re-derivability test being read back in; no hook screens a ledger line.
- passage: Both kinds answer one admission test: a line belongs on the ledger only if a successor with no context needs it to resume the watch.

### C017
- key: Reject a line that argues rather than states, or whose subject is the keeper's own reasoning rather than the watched system.
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:26
- provenance: 3074425 2026-08-31, the memory record's own tell for a drifted ledger.
- verdict: keep
- reason: A021 to A023. Line 79 cites this tell rather than restating it; nothing applies it mechanically.
- passage: Two tells mark a failing line: it argues rather than states, or its subject is the keeper's own reasoning rather than the watched system.

### C018
- key: Route what a rejected line carries, where durable, to the destination rule at the end of this file rather than back onto the ledger.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:26
- provenance: 3074425 2026-08-31.
- verdict: rewrite
- landed: e9245e7 section 29
- reason: A024, A025. This line is the owner of the route; under the rewrite it gains the drop branch line 28 currently adds. Flipped from keep to rewrite at section 29's close: C025's landing moved the drop branch from line 28 onto this sentence, as this entry's own reason foresaw, so the sentence gains ', and otherwise it is dropped' before its semicolon, and the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: What such a line carries, where durable, goes where the destination rule at the end of this file sends it, and otherwise it is dropped; the ledger is not its second home.
- passage: What it carries, where durable, goes where the destination rule below sends it, and otherwise it is dropped.

### C019
- key: Keep off the ledger any line the keeper cannot confidently say a successor needs.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:28
- provenance: 6c725a0 2026-09-03, the inverted default from the 201-kilobyte coordinator board, Section 2 of docs/archive/claude-kit_gating-definitions_spec_v1.md.
- verdict: keep
- reason: A026 to A028. The sentence is pinned verbatim by test/doctrine-parity.test.js (line 1935); a rewording that keeps the direction still fails the pin, so update the pin in the same edit. Amendment 2: the test/doctrine-parity.test.js line 1935 cite sits at the test named `the standing-watch admission default faces outward at both forks and the named inward spellings are absent` at the landing (declared near line 1924; line 1935 is a comment inside it); prefer the test name over the line. Amendment 3: the pin is retired, so Amendment 2's cite names a test that no longer reads this sentence. It reddened on any rewording that kept the direction, an edit a session may make on its own authority, which is the testing-discipline skill's sixth retire class. A re-aimed replacement failed too, the paragraph stating its rule and then pricing the opposite error, so only a binder onto the subject separated them. The direction is now prose-enforced, checked against the coordinator skill's restatement of the default. The surviving legs read the paragraph's lead, its tie-break framing and the founding sentence's absence, none of them the direction. The test was renamed in the same edit, since its old name claimed a direction no leg reads; cite it as `standing-watch carries its admission default, its prune keep for prohibitions and traps, and its kind fork, and the retired inward sentence is absent`.
- passage: At the first fork, whether a line belongs, a line the keeper cannot confidently say a successor needs stays off and leaves by the admission test's route. That default is the admission test's tie-break for doubt, used only where the keeper cannot call the test.

### C020
- key: Accept the loss of a wrongly-excluded line, because a reproducible fact costs one re-derivation, a durable one costs one read of its home surface, and the rest is content the test exists to keep off.
- class: rationale-example
- source: plugins/grimoire/skills/standing-watch/SKILL.md:28
- provenance: 6c725a0 2026-09-03, "with the loss accepted in place rather than argued away".
- verdict: keep
- reason: A029. The third cost is the one instruction that stops a rescue on the only-record ground the founding incident used; the backlog contests this pricing (lines 368, 369), which shows it is load-bearing. Amendment 2: the docs/backlog.md lines 368 and 369 cites sit at the items whose bold leads read 'The watch chassis names no author for a keeper-learned standing DO-NOT, and no destination for one either' and 'The watch chassis's admission default still drops a DO-NOT-shaped line whose membership the keeper cannot call' (lines 383 and 384 at 16c5e61, every standing-watch item having moved fifteen lines down the file); prefer the leads over the lines.
- passage: Kept off wrongly, a line costs at worst its loss, which is accepted.

### C021
- key: Expect a wrongly-admitted line to survive every rewrite, because supersede, prune and the per-pass write all ask what fact a line holds and never whether it belongs.
- class: rationale-example
- source: plugins/grimoire/skills/standing-watch/SKILL.md:28
- provenance: 6c725a0 2026-09-03.
- verdict: rewrite
- landed: e9245e7 section 29
- reason: A027, A030. The one-sentence asymmetry stays because it is why the default faces outward; the trace it currently carries restates lines 36 and 40 and lives here: supersede fires on a changed fact, prune moves only what supersede retired, the per-pass write leaves an unrefreshed line as found, so no later rule asks whether a line belongs. Lands at line 28 as 'Kept on wrongly, a line survives every rewrite this file performs, since none asks again whether a line belongs.', opening 'Kept on wrongly,' rather than the proposal's 'a wrongly-admitted line' to hold the parallel with C020's 'Kept off wrongly,' sentence before it; the three-rule trace lives here, including the sentence 'A line that should never have been admitted holds either a fact of the watched system that no successor needs, which those rewrites keep current rather than remove, or no fact of the watched system at all, the shape the second tell above marks, which none of them touches; so it accrues.' and the clause 'a question the admission test asks once, at placement', neither keyed to another entry.
- proposed: One sentence: a wrongly-admitted line survives every rewrite this file performs, since none asks again whether a line belongs; the three-rule trace lives in this ledger under C021.
- baseline-test: yes
- passage: Kept on wrongly, it survives every rewrite, since none asks again whether a line belongs.

### C022
- key: Fire supersede only when the fact a line holds changes.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:28
- provenance: 6c725a0 2026-09-03 restated it; the rule was installed at 0ea17a9 2026-08-18 (line 36) and earned by probe B.
- verdict: retire
- landed: e9245e7 section 29
- reason: row 1190 shrink. This premise was argument for C021, and C021's landed sentence carries the act. Supersede's own rule stays at C049.
- proposed: (via A031) Line 36 keeps; line 28's premise reads "supersede, under its own rule below, fires only on a changed fact"; line 30's C040 stays.
- baseline-test: yes
- passage: Supersede, under its own rule below, fires only on a changed fact.

### C023
- key: Prune only what supersede has already retired.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:28
- provenance: 6c725a0 2026-09-03 restated it; line 40 ("move superseded history") is from 0ea17a9 2026-08-18.
- verdict: retire
- landed: e9245e7 section 29
- reason: row 1190 shrink. This premise was argument for C021, and C021's landed sentence carries the act. The prune's own rule stays at C052.
- passage: The prune, under its own rule below, moves only what supersede has retired.

### C024
- key: Write back what the re-derive step produced, rewriting a refreshed line current and leaving standing as found any line the re-derivation neither confirmed nor contradicted.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:28
- provenance: 6c725a0 2026-09-03.
- verdict: keep
- reason: A027. The only statement in the file of what the per-pass write does to an unrefreshed line; tick step 4 says only "write the ledger", so this has no owner to point at and may move beside step 4.
- passage: The write refreshes what the re-derivation measured and leaves any other line as found.

### C025
- key: Send a line the admission default keeps off to the destination rule where it carries something durable, and otherwise drop it.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:28
- provenance: 6c725a0 2026-09-03.
- verdict: retire
- landed: e9245e7 section 29
- reason: merged into C019's landed sentence, "...stays off and leaves by the admission test's route.", which now states the route once.
- passage: What the default keeps off leaves by the same route as a line that fails the test.

### C026
- key: Apply the admission default only to what no rule has already placed as ledger content.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: be769a8 2026-09-03, the route by which a doubted prohibition could be kept off and drop from the wake prompt; the residual framing is from 6c725a0 2026-09-03.
- verdict: retire
- reason: row 1191 (Residual default and exemptions), dropped under the mechanism cut.
- passage: **The admission default is residual.** It decides only what no rule has already placed.
- ruled: cut 2026-09-30

### C027
- key: Treat as placed by this file: the two-kinds rule's members, the read protocol, and the pass record named by the destination rule.
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: be769a8 2026-09-03.
- verdict: retire
- reason: row 1191 (Residual default and exemptions), dropped under the mechanism cut.
- passage: This file places the two kinds' members, the read protocol, and the pass record the destination rule names.
- ruled: cut 2026-09-30

### C028
- key: Do not read "the current state" as a placed class of its own; it is the ledger's own definition, already divided into the placed members.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: be769a8 2026-09-03, closing a reading that would make every fact of the watched system a recognised member.
- verdict: retire
- landed: e9245e7 section 29
- reason: row 1207 shrink. The gloss re-explained the ledger's definition, which C004's bullet under Two Artifacts and the two-kinds bullets (C014, C015) still carry.
- passage: The current state is the ledger's own definition under Two Artifacts, which the two-kinds rule already divides into the members it places.

### C029
- key: Apply the admission test to placed classes too; placement settles only that a successor needs the class, never that a line is exempt from the test.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: be769a8 2026-09-03, "the repair is a pointer to the rules that already answer whether such a line is needed, not a new exception".
- verdict: retire
- reason: row 1191 (Residual default and exemptions), dropped under the mechanism cut.
- passage: A rule places a class by naming it as ledger content, which settles that a successor needs the class.
- passage: Placement exempts nothing from the admission test.
- ruled: cut 2026-09-30

### C030
- key: Refuse a line that is not the member it presents as, and refuse a member whose particular line no successor needs to resume the watch.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: be769a8 2026-09-03.
- verdict: retire
- reason: row 1191 (Residual default and exemptions), dropped under the mechanism cut.
- passage: The test still refuses a line that is not the member it presents as, the way a withdrawn reading can pose as one. It also refuses a member whose particular line no successor needs.
- ruled: cut 2026-09-30

### C031
- key: Keep off a recognised member whose particular line the keeper cannot confidently say a successor needs, and route it by the destination rule or drop it.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: be769a8 2026-09-03.
- verdict: retire
- landed: e9245e7 section 29
- reason: row 1191 (Residual default and exemptions), dropped under the mechanism cut.
- proposed: That second refusal is asked of the line rather than of the class, so the keeper can be in doubt on it, and that doubt is the admission default's like any other save on those same two members: a recognised member whose particular line the keeper cannot confidently say a successor needs stays off, under the default exactly as the paragraph above states it, and leaves by the route the admission test's paragraph states, the destination rule where it carries something durable and otherwise dropped.
- passage: That refusal is asked of the line, so the keeper can doubt it. Such doubt is the default's, and the line stays off and leaves by the admission test's route.
- ruled: cut 2026-09-30

### C032
- key: Apply the admission default only in the test's doubt branch, in its three shapes: an unplaced line whose need cannot be called, a line not recognisable as a member, and a recognised member whose particular line cannot be called needed.
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: be769a8 2026-09-03.
- verdict: retire
- reason: row 1191 (Residual default and exemptions), dropped under the mechanism cut.
- passage: The default lives only in that doubt branch, in three shapes. One is a line outside every named class whose need the keeper cannot call. One is a line the keeper cannot recognise as a member. One is a recognised member whose particular line the keeper cannot say a successor needs.
- ruled: cut 2026-09-30

### C033
- key: Read a prohibition's cited condition measuring false as meaning the line does not bind this pass, never that the line is retired.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: be769a8 2026-09-03, a security-lens regression in that round made a false reading a retirement trigger and was reverted.
- verdict: retire
- reason: row 1191 (Residual default and exemptions), dropped under the mechanism cut.
- passage: Where it cites a condition, the re-measure step measures it every pass. A false reading means the line does not bind this pass, never that it is retired.
- ruled: cut 2026-09-30

### C034
- key: Hold a prohibition that cites no condition as binding until the operator's word retires it.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: be769a8 2026-09-03; that round withdrew a governing-document retirement route because the re-measure step re-reads a document only for a line citing a condition.
- verdict: retire
- reason: row 1191 (Residual default and exemptions), dropped under the mechanism cut.
- passage: Where it cites none, it binds until the operator's word retires it.
- ruled: cut 2026-09-30

### C035
- key: Treat a do-not-reopen trap as needed however old it is.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: be769a8 2026-09-03 restated it; the rule is line 40's from 0ea17a9 2026-08-18.
- verdict: retire
- reason: row 1191 (Residual default and exemptions), dropped under the mechanism cut.
- passage: A do-not-reopen trap is needed however old it is, by the prune rule.
- ruled: cut 2026-09-30

### C036
- key: Put a recognised prohibition or trap on the standing list and remove it only when its source retires it.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: be769a8 2026-09-03.
- verdict: keep
- reason: A039, A040. The conclusion that places both members and names the one fact supersede fires on for them; C034 is its premise.
- passage: Prohibitions and do-not-reopen traps stay on the ledger, however old, until their source retires them.

### C037
- key: A consuming skill naming a member whose content no probe reproduces and whose loss licenses the act it closes off must state that the member takes this exemption.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: be769a8 2026-09-03, the exemption pinned on the property rather than the names so a consumer's equivalent member reads it.
- verdict: retire
- reason: row 1191 (Residual default and exemptions), dropped under the mechanism cut.
- passage: What earns those two members their exemption is the property rather than their names: no probe of the watched system reproduces them, and their loss licenses the act they exist to close off. A consuming skill naming a member with that property states that the member takes this exemption.
- ruled: cut 2026-09-30

### C038
- key: Do not admit or rescue a line on the grounds that nothing else records it.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: 6c725a0 2026-09-03, the founding incident's content had no other record either.
- verdict: retire
- reason: row 1191 (Residual default and exemptions), dropped under the mechanism cut.
- passage: Having no other record neither admits a line nor rescues one. A one-record line no rule places stays off under the default's doubt.
- ruled: cut 2026-09-30

### C039
- key: A skill built on this chassis must name by rule every class its ledger is the one record of.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: 6c725a0 2026-09-03, "the placed class defined by the rule that places it rather than by an enumeration the chassis cannot close over its consumers".
- verdict: retire
- reason: row 1191 (Residual default and exemptions), dropped under the mechanism cut.
- passage: So a skill built on this chassis names by rule every class its ledger is the one record of, since an unnamed one is exactly what the default loses.
- ruled: cut 2026-09-30

### C040
- key: Rewrite in place under supersede the reading a withdrawal replaced, whether the watched thing moved or the instrument was wrong.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: be769a8 2026-09-03, routing the founding incident's withdrawn readings to the rule that already places them.
- verdict: keep
- reason: A031, A032. Not a restatement of line 36: it settles that a wrong instrument is a changed fact, which line 36 does not say.
- passage: The reading a withdrawal replaced is rewritten in place under supersede, whether the watched thing moved or the instrument was wrong.

### C041
- key: File a correction that earned a ping as a recent ping on the situational list, file the trap a broken instrument taught on the standing list, and send the reasoning that produced the trap to the memory store.
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: be769a8 2026-09-03, routing the memory record's three "what fails" shapes to their homes.
- verdict: keep
- reason: A044. Three keeper-performed writes; no hook files any of them.
- passage: A correction that earned a ping is a recent ping on the situational list. The trap a broken instrument taught goes on the standing list, and the reasoning behind it goes to the memory store.

### C042
- key: Decide doubt about which kind an admitted line is on the cost of the misfiling, never on the kinds' names.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:32
- provenance: 6c725a0 2026-09-03, the kind fork stated for the chassis and mirrored in the coordinator.
- verdict: keep
- reason: A045, A046. The fork's lead is pinned; the A045 rewrite pointer-izes the restated kind definitions and wake-prompt trace and keeps this sentence.
- passage: **The kind fork is decided on the cost of the misfiling, never on the kinds' names.**

### C043
- key: Re-derive by probing the watched system, never by reading another record, whatever the line's provenance.
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:32
- provenance: 6c725a0 2026-09-03 added "whatever the line's provenance" for told-not-derived lines; the probe rule is tick step 2's from 0ea17a9 2026-08-18.
- verdict: keep
- reason: A047 to A049. Pointer at step 2 carrying a bound step 2 lacks; the backlog (line 362) records that a recent ping cannot meet it. Amendment 2: the docs/backlog.md line 362 cite sits at the item whose bold lead reads 'The watch chassis places a situational member that cannot satisfy its own re-derive obligation' (line 377 at 16c5e61, every standing-watch item having moved fifteen lines down the file); prefer the lead over the line.
- passage: Situational is re-derived by probing the watched system, never by reading another record, whatever the line's provenance.

### C044
- key: On this file's two kinds, let doubt fall to situational, since a wrongly-standing line is acted on stale while a wrongly-situational one costs one extra probe per pass.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:32
- provenance: 6c725a0 2026-09-03.
- verdict: keep
- reason: A050. Pinned through its carve-out clause (test/doctrine-parity.test.js line 1935) because stopping at "situational," left the qualifier position open to a reversing exception. Amendment 2: the test/doctrine-parity.test.js line 1935 cite sits at the test named `the standing-watch admission default faces outward at both forks and the named inward spellings are absent` at the landing (declared near line 1924; line 1935 is a comment inside it); prefer the test name over the line. Amendment 3: this pin is retired on C019's ground, so Amendment 2's cite names a test that no longer reads this fork's direction. The fork sends doubt to situational and then carves out the members whose doubt falls to standing, so a leg reading the general rule needed a binder onto its subject and reddened on a plain rewording. The direction is now prose-enforced. The carve-out's own three legs retire with it in the same edit, each having required a phrase of the carve-out's prose and each watched reddening on a rewording that kept the rule. The test was renamed in that edit, since its old name claimed a direction no leg reads; cite it as `standing-watch carries its admission default, its prune keep for prohibitions and traps, and its kind fork, and the retired inward sentence is absent`.
- passage: Any other doubt about an admitted line's kind falls to situational: a line wrongly filed standing is acted on stale, and one wrongly filed situational costs one extra probe.

### C045
- key: Ask first whether the line is a prohibition or a do-not-reopen trap, and let doubt on that question fall to standing.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:32
- provenance: 6c725a0 2026-09-03; be769a8 2026-09-03 bounded it to doubt ("reaches only the doubt") so it cannot readmit by name.
- verdict: keep
- reason: A045. "such a member falls to standing" and "reaches only the doubt" are both pinned. Amendment: both pins are retired, on C044's ground. Each required a phrase of this carve-out's own prose, and each was watched reddening on a rewording that left the rule untouched, an edit a session may make on its own authority. Nothing else would have to change beside such a rewording: no hook or script reads this prose, `docs/architecture.md` does carry "no probe of the watched system reproduces" verbatim but under no marker region and no byte-identity pin, so it is a restatement rather than a designed copy and nothing holds the two texts equal, neither pin proved a neighbouring leg had something to compare, and `docs/security-model.md` cites no test over this file. The carve-out is prose-enforced, and what stays is a leg on the paragraph's presence, which the chassis owes every consuming skill that states its own fork beside an override of these kinds.
- passage: Doubt about whether a line is a prohibition or a do-not-reopen trap is asked first and falls to standing, since no probe reproduces either.

### C046
- key: A trap filed situational commands the re-opening it forbids, and a prohibition filed situational drops out of the wake prompt and stops binding before any pass reads the ledger.
- class: rationale-example
- source: plugins/grimoire/skills/standing-watch/SKILL.md:32
- provenance: 6c725a0 2026-09-03, each member's own reason; the prohibition case was proven real at be769a8 2026-09-03.
- verdict: retire
- reason: row 1192 shrink. Its two accounts were the carve-out's argument, and C045's landed clause "since no probe reproduces either" carries the act.
- passage: A trap filed situational commands the re-opening it forbids, since re-deriving it is that re-opening. A prohibition filed situational can never be re-derived. It drops out of the wake prompt under Wake mechanics and stops binding before any pass reads the ledger.

### C047
- key: A skill that replaces these two kinds must state its own kind fork beside its override, on the same cost basis.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:32
- provenance: 6c725a0 2026-09-03, the coordinator restates both forks for its own board where the cost runs the other way.
- verdict: keep
- reason: A045. The coordinator's fork is pinned beside the chassis's for exactly this reason.
- passage: A skill that replaces these two kinds states its own fork beside its override, on the same cost.

### C048
- key: Give every situational sentence both the time of the evidence behind it and the command that re-derives it.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:34
- provenance: 0ea17a9 2026-08-18, a neighboring measurement stood in for one that was down in the founding loop.
- verdict: keep
- reason: A052, A053. Executing-work's moment-pin governs a Chapter figure; this governs a ledger line. The backlog (line 362) notes a recent ping cannot carry the command. Amendment 2: the docs/backlog.md line 362 cite sits at the item whose bold lead reads 'The watch chassis places a situational member that cannot satisfy its own re-derive obligation' (line 377 at 16c5e61, every standing-watch item having moved fifteen lines down the file); prefer the lead over the line.
- passage: Every situational sentence carries two things: the time of the evidence behind it, and the command that re-derives it.

### C049
- key: When a fact changes, rewrite the line that held it in place.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:36
- provenance: 0ea17a9 2026-08-18, earned by RED/GREEN probe B (docs/archive/claude-kit_standing-watch_spec_v1.md line 237).
- verdict: keep
- reason: A031, A054. The owner of supersede; the A054 rewrite drops only the reason clause on the next sentence.
- passage: **Supersede in place.** When a fact changes, rewrite the line that held it.

### C050
- key: Never stack a new baseline under an old one and leave both readable.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:36
- provenance: 0ea17a9 2026-08-18.
- verdict: rewrite
- landed: e9245e7 section 29
- reason: A054. The rule stays; its reason moves here: the next pass reads whichever baseline it reaches first and has no way to tell which was current. Lands at line 36 as 'Never stack a new baseline under an old one and leave both readable.', the because-clause gone; C049's sentence before it stands word for word.
- passage: Never stack a new baseline under an old one and leave both readable.

### C051
- key: Put a read protocol at the top of the ledger stating what a constrained pass reads and in what order.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:38
- provenance: 0ea17a9 2026-08-18, installed with the skill.
- verdict: keep
- reason: No finding. The kaizen note of 2026-09-02 (now a `migrated` kaizen issue) records that the coordinator leaves this inherited requirement with no home, a consumer-side gap.
- passage: A **read protocol** sits at the top of the ledger, stating what a constrained pass reads and in what order.

### C052
- key: Prune on a quiet tick, never on a busy one.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:40
- provenance: 0ea17a9 2026-08-18 (docs/archive/claude-kit_standing-watch_spec_v1.md lines 96 to 97).
- verdict: keep
- reason: A055. Stays whole; only C055's reason clause leaves the paragraph.
- passage: **Prune on a quiet tick**, never on a busy one. Move superseded history to a dated archive byte-identical to what it replaced, and verify the hash at the destination rather than at the source.

### C053
- key: Move superseded history to a dated archive byte-identical to what it replaced, and verify the hash at the destination rather than at the source.
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:40
- provenance: 0ea17a9 2026-08-18.
- verdict: keep
- reason: A055, A056. A rule, not a reason; K19's compression that dropped it is rejected. No program performs the prune.
- passage: **Prune on a quiet tick**, never on a busy one. Move superseded history to a dated archive byte-identical to what it replaced, and verify the hash at the destination rather than at the source.

### C054
- key: Keep do-not-reopen traps live in the ledger however old they are.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:40
- provenance: 0ea17a9 2026-08-18.
- verdict: keep
- reason: A042, A043, A055. The owner; its reason ("outlast the reasoning that produced them") stays because lines 30 and 32 cite it.
- passage: Prohibitions and do-not-reopen traps stay on the ledger, however old, until their source retires them.

### C055
- key: Re-derive any section offsets or line pointers after the last edit of the pass, never before.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:40
- provenance: 0ea17a9 2026-08-18.
- verdict: rewrite
- landed: e9245e7 section 29
- reason: A055. The rule stays; its reason moves here: an offset computed mid-edit points at the wrong section for every pass that follows. Lands at line 40 as 'Re-derive any section offsets or line pointers after the last edit of the pass, not before.', the because-clause gone; C052, C053 and C054 stand word for word before it.
- passage: Re-derive any section offsets or line pointers after the last edit of the pass, not before.

### C056
- key: Follow the tick sequence as fixed, and take what happens inside the act step from the runbook.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:44
- provenance: 0ea17a9 2026-08-18.
- verdict: keep
- reason: No finding. After A008 this section is the sole owner of the sequence.
- passage: The order is fixed. What a tick does inside the act step is the runbook's business, and the sequence around it does not vary.

### C057
- key: Ensure the heartbeat is armed first, before any check, on any restart.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:46
- provenance: 02980e2 2026-08-18, the two-arm repair named the heartbeat as the safety arm and the runbook as owner of its cadence.
- verdict: keep
- reason: A057. Owner of the restart rule; the clauses the readers would cut are the repair.
- passage: **Ensure the heartbeat is armed first**, before any check, on any restart. This is the safety arm, and its cadence is the runbook's to state.

### C058
- key: Satisfy the heartbeat step by looking for a running heartbeat rather than adding a second one.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:46
- provenance: 02980e2 2026-08-18.
- verdict: keep
- reason: A016, A017. The step's own ensure reading; line 17's restatement is what gives way.
- passage: A heartbeat already running satisfies this step; the move is to look, not to add a second.

### C059
- key: Re-derive the board from the watched system's own source of truth, never from the ledger, the handoff, or any situation text a wake prompt carries.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:47
- provenance: 0ea17a9 2026-08-18, the founding loop obeyed its own stale notes as fact.
- verdict: keep
- reason: A047, A048, A058, A059. The owner of re-derivation; recap's read-from-disk line is the same doctrine principle on the plan doc.
- passage: **Re-derive the board** from the watched system's own source of truth. Never from the ledger, the handoff, or any situation text a wake prompt carries.

### C060
- key: For every standing DO or DO-NOT that cites a condition, measure the condition now and re-read the governing document behind it before obeying.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:48
- provenance: 0ea17a9 2026-08-18; its probe did not reproduce RED and the plan's Chapter 1 records the point-of-action rationale it ships on (docs/archive/claude-kit_standing-watch_spec_v1.md lines 235, 284).
- verdict: keep
- reason: A060. The trailing clause is the recorded warrant, not decoration.
- passage: For every standing DO or DO-NOT that cites a condition, measure the condition now, and re-read the governing document behind it.

### C061
- key: Let a plan doc outrank the ledger for that plan's gate.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:48
- provenance: 0ea17a9 2026-08-18, a wrong standing line nearly closed an advisory permanently in the founding loop.
- verdict: keep
- reason: A060. Its reason ("the plan changed under it") is the step's warrant and stays.
- passage: A plan doc outranks the ledger for that plan's gate: the ledger line was true when it was written and the plan changed under it.

### C062
- key: Act, then write the ledger, then ensure the next wake is armed, then sleep.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:49
- provenance: 02980e2 2026-08-18.
- verdict: keep
- reason: A010, A011. The owner of the end-of-pass sequence; line 17 points here.
- passage: **Act**, then **write the ledger**, then **ensure the next wake is armed**, then **sleep.**

### C063
- key: On a static board, let the heartbeat be the next wake and arm nothing more.
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:49
- provenance: 02980e2 2026-08-18, the repair of a static board taking no one-shot against an end-of-pass arm called fixed.
- verdict: keep
- reason: A061 to A063. The ensure reading at the step; line 57 owns pacing.
- passage: On a static board the heartbeat is that wake and nothing more is armed.

### C064
- key: Put in a self-authored wake prompt the standing prohibitions and a pointer to the ledger, and nothing else.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:53
- provenance: 0ea17a9 2026-08-18, five self-armed wake prompts had to be re-armed for claims a later finding made false.
- verdict: keep
- reason: A064 to A066. The incident's own shape; the asymmetry reason stays on the same footing as C046.
- passage: A self-authored wake prompt carries the standing prohibitions and a pointer to the ledger, and nothing else.

### C065
- key: Never put a situation report in a wake prompt.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:53
- provenance: 0ea17a9 2026-08-18.
- verdict: keep
- reason: A064, A066. The named instance of the closed class, which is the incident.
- passage: It never carries a situation report. Prohibitions age well and a situation does not.

### C066
- key: Check the timer list against the clock before assuming pacing is covered.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:55
- provenance: 0ea17a9 2026-08-18 (docs/archive/claude-kit_standing-watch_spec_v1.md lines 107 to 110).
- verdict: keep
- reason: A067. Kept with C067 (what the check finds) and C068 (the false positive it would otherwise raise).
- passage: Check the timer list against the clock before assuming pacing is covered.

### C067
- key: Treat a one-shot whose time elapsed during a long pass as stale rather than pending, since it fires the instant the pass ends.
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:55
- provenance: 0ea17a9 2026-08-18.
- verdict: keep
- reason: A067, A068. A reading rule over a timer's behaviour; nothing marks a fired one-shot as stale for the keeper.
- passage: A one-shot whose time elapsed during a long pass is stale rather than pending. It fires the instant the pass ends, which reads as a wake the loop did not schedule.

### C068
- key: Read a deferred heartbeat during a long attended turn as expected behavior, not a broken timer, because timers fire only while the session is idle.
- class: rationale-example
- source: plugins/grimoire/skills/standing-watch/SKILL.md:55
- provenance: 0ea17a9 2026-08-18.
- verdict: keep
- reason: A069. Without the idle-only fact a keeper re-arms on a deferral, which is the act the check prices; both readers keep.
- passage: Timers fire only while the session is idle, so a long attended turn defers the heartbeat. That is expected behavior, not a broken timer.

### C069
- key: Pace by the board: a static board gets the heartbeat only, an active one gets a one-shot 15 to 60 minutes out.
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:57
- provenance: 02980e2 2026-08-18 last touched; the pacing design is 0ea17a9 2026-08-18.
- verdict: keep
- reason: A061, A062, A070. The owner of pacing; no program paces the loop.
- passage: Pacing follows the board: a static board gets the heartbeat only, an active one gets a one-shot 15 to 60 minutes out.

### C070
- key: Count a board as active when something on it is expected to change before the heartbeat comes round again, and treat a board you cannot confidently place as active.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:57
- provenance: 02980e2 2026-08-18.
- verdict: keep
- reason: No finding. The parity pin's inward sweep deliberately excludes this sentence ("a board you cannot confidently place is active" is not a ledger placement), so a rewording here must keep clear of the swept verbs and objects.
- passage: A board is active when something on it is expected to change before the heartbeat comes round again. A board you cannot confidently place is active, because an unnecessary one-shot spends a pass and a missing one spends the window the loop existed to watch.

### C071
- key: Structure a ping in this order: corrections, then the ask or report, then the evidence line.
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:61
- provenance: 0ea17a9 2026-08-18.
- verdict: keep
- reason: A071. Nothing formats a ping.
- passage: A ping to the operator has three parts, in order:

### C072
- key: Put corrections to earlier claims first, labeled as a correction.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:63
- provenance: 0ea17a9 2026-08-18.
- verdict: keep
- reason: No finding. Corrections lead because the operator reads on a phone and acts on the first line.
- passage: **Corrections to earlier claims, first.** Labeled as a correction,
- flag: weak-reason

### C073
- key: Send a correction only when it changes the shape of the operator's decision.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:63
- provenance: 0ea17a9 2026-08-18.
- verdict: keep
- reason: No finding. Pairs with the dedup key: a correction that changes nothing reads as escalation.
- passage: and sent at all only when the correction changes the shape of the operator's decision.
- flag: weak-reason

### C074
- key: Write the ask or the report in the client-briefing register, which the doctrine owns.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:64
- provenance: 0ea17a9 2026-08-18.
- verdict: keep
- reason: A072, A073. Already a pointer at the doctrine, which the ownership map names as the register's owner.
- passage: **The ask or the report**, in the client-briefing register, which the doctrine owns.

### C075
- key: Have every figure or state in the message name its source and its subject.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:65
- provenance: 0ea17a9 2026-08-18, a true engine value reported against the wrong subject a dozen times; the doctrine's Before-you-send question was added in the same commit.
- verdict: keep
- reason: A074 to A076. The ping template's instance of a doctrine principle; the closing sentence is the incident stated as a rule.
- passage: **The evidence line**, naming each figure's source and subject, as the doctrine's Before You Send list asks.

### C076
- key: Carry a dedup key per condition, send one ping per condition, and never re-send an ask already pending.
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:67
- provenance: 0ea17a9 2026-08-18.
- verdict: keep
- reason: A077. No program tracks pending asks.
- passage: Carry a **dedup key per condition**: one ping per condition, and never a re-send of an ask already pending.

### C077
- key: For when to escalate at all, read the doctrine's "Pause only for a true blocker" bullet under How we work; for what a measurement reads when the source is down, read the doctrine's "cannot measure" line under Verify before you claim.
- class: pointer
- source: plugins/grimoire/skills/standing-watch/SKILL.md:69
- provenance: 02980e2 2026-08-18; the "cannot measure" line moved to the doctrine at 0ea17a9 2026-08-18 as one of the four lines every session needs.
- verdict: rewrite
- landed: 2b427ac section 4
- reason: The pointer names both owners and restates neither rule. Under ruling 2, which gives every restatement of an amended rule current text or a bare pointer, the escalation parenthetical names the owner the doctrine names: the doctrine's "Pause only for a true blocker" bullet points at the executing-work skill's closed blocker set, so "which owns the blocker set" became "which points at the executing-work skill for the closed blocker set". Lands at the corpus-rewrite follow-up plan's section 4 as the proposal.
- proposed: Two rules that govern a ping are owned outside this skill and are not restated here: when to escalate at all (the doctrine's "Pause only for a true blocker" bullet, under How we work, which points at the executing-work skill for the closed blocker set a ping may interrupt on), and what a measurement reads when the source that would answer is down (the doctrine's "cannot measure" line, under Verify before you claim).
- passage: Escalate only under the doctrine's "Pause only for a true blocker" bullet, and report a measurement whose source is down as the doctrine's "cannot measure".

### C078
- key: Before any closure, dismissal, delete, or resume on the watched system, name in one sentence what will act on the thing afterward.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:73
- provenance: 0ea17a9 2026-08-18, a wrong standing line nearly closed an advisory permanently.
- verdict: keep
- reason: A078. The trailing clause already marks the four as instances of the class; reordering is taste.
- passage: Before any closure, dismissal, delete, or resume on the watched system, name in one sentence what will act on the thing afterward.

### C079
- key: Do not close it when the answer is "the mechanism this closure removes".
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:73
- provenance: 0ea17a9 2026-08-18.
- verdict: keep
- reason: A078. The preflight's stop; also what makes C085's gate a one-way door (A090).
- passage: If the answer is "the mechanism this closure removes", do not close it.

### C080
- key: Treat killing a dispatched agent as a one-way door subject to the same preflight.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:75
- provenance: d8a3355 2026-08-23, the doctrine's liveness bullets stopped reading silence as alive and standing-watch got a route that resolves; a healthy agent was nearly killed on filesystem silence in the founding loop.
- verdict: keep
- reason: A079. The paragraph's route and its enumeration of what finishing-work owns are the fix for a stranded audience, and line 75 is pinned as the committed pointer (test/doctrine-parity.test.js line 429). Amendment 2: the test/doctrine-parity.test.js line 429 cite sits at the test named `the liveness bullets defer to finishing-work in each copy` at the landing (declared near line 428, its comment naming standing-watch line 75 as the committed pointer near line 422); prefer the test name over the line.
- passage: Killing a dispatched agent is that same door: probe it with a message first, per the doctrine's probe bullet.
- flag: stale

### C081
- key: On every pass with a dispatch in flight, evaluate the wedge hallmark rather than waiting for a trigger.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:75
- provenance: d8a3355 2026-08-23, written into the tick order because a watch never re-blocks.
- verdict: keep
- reason: A080. Intentionally different semantics from executing-work's re-block trigger.
- passage: A watch's tick is none of the wakes `finishing-work`'s unavailability rule fires at, so every pass with a dispatch in flight evaluates that rule's wedge hallmark.

### C082
- key: Read `finishing-work`'s unavailability paragraphs first, from the bold lead "Unavailability is the gate failing to run at full strength".
- class: pointer
- source: plugins/grimoire/skills/standing-watch/SKILL.md:75
- provenance: d8a3355 2026-08-23, the rule located by its bold lead because finishing-work carries no heading for it.
- verdict: keep
- reason: A082, A083. A pointer at the map's owner; the inline plugin-root resolution is what makes it resolve without a second lookup.
- passage: It reads `skills/finishing-work/SKILL.md` under the plugin root from the bold lead **Unavailability is the gate failing to run at full strength** and takes every window from that rule, never inventing one.

### C083
- key: Derive any stall window from that finishing-work rule and never invent one this skill does not own.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:75
- provenance: d8a3355 2026-08-23, replacing a local-window prohibition neither cited surface stated.
- verdict: keep
- reason: A084, A085. Deferral of the figure to its sole owner.
- passage: It reads `skills/finishing-work/SKILL.md` under the plugin root from the bold lead **Unavailability is the gate failing to run at full strength** and takes every window from that rule, never inventing one.

### C084
- key: Guard against manufacturing a stall signal from quiet, because quiet is most of what a watch ever looks at.
- class: rationale-example
- source: plugins/grimoire/skills/standing-watch/SKILL.md:75
- provenance: d8a3355 2026-08-23; the near-kill on filesystem silence is from the founding loop (0ea17a9 2026-08-18).
- verdict: keep
- reason: A086 to A088. The only thing distinguishing the per-pass check from the owner's trigger; both readers keep.
- passage: A loop staring at a quiet directory manufactures the stall signal for itself, because quiet is most of what a watch looks at.

### C085
- key: End a watch when the quiet streak runs long enough that the operator retires the loop.
- class: mechanic
- source: plugins/grimoire/skills/standing-watch/SKILL.md:79
- provenance: 6c725a0 2026-09-03 last touched the line; the sentence is design from 0ea17a9 2026-08-18.
- verdict: keep
- reason: A089, A090. Operator-decision gate that survives on the file's own preflight: a loop retiring itself removes the thing that would act on the watched system afterward.
- passage: A watch ends when the quiet streak runs long enough that the operator retires the loop.

### C086
- key: Hand over at retirement a distilled list of what the interventions taught, split into what the watched system should do for itself and what the kit should stop the agent doing.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:79
- provenance: 0ea17a9 2026-08-18 (design); 6c725a0 2026-09-03 last touched.
- verdict: keep
- reason: A091. The founding loop's own distillation produced this skill.
- passage: It then hands over what the interventions taught, split between what the watched system should do for itself and what the kit should stop the agent doing.

### C087
- key: Write every pass in a form that survives distillation: the condition, what was done about it, and what it turned out to mean.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:79
- provenance: 6c725a0 2026-09-03 added the bound that "what it turned out to mean" is a fact of the watched system, never the keeper's reasoning.
- verdict: keep
- reason: A021, A022, A091. The bound cites the admission test's tell rather than restating it. The backlog (line 364) asks whether one pass record survives the next pass, a design question on this line. Amendment 2: the docs/backlog.md line 364 cite sits at the item whose bold lead reads 'The watch chassis does not say whether one pass record survives the next pass' (line 379 at 16c5e61, every standing-watch item having moved fifteen lines down the file); prefer the lead over the line.
- passage: So each pass records the condition, what was done, and what it turned out to mean about the watched system.

### C088
- key: Send a decision about a plan to that plan's Chapters.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:81
- provenance: 3074425 2026-08-31, the write-time destination rule from the coordinator board incident.
- verdict: keep
- reason: A092 to A094. A pointer at executing-work's Chapter contract, not a restatement of it.
- passage: The destination rule sends a decision about a plan to that plan's Chapters, and a durable lesson about the watch's own instruments to the memory store in the pass that produced it.

### C089
- key: Send a durable lesson about the watch's own instruments to the memory store in the pass that produced it.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:81
- provenance: 3074425 2026-08-31; the memory record's own discipline-at-write-time paragraph.
- verdict: keep
- reason: A093. Stays whole under the rewrite; the backlog (line 360) names the missing leg for a durable fact about the watched system itself. Amendment 2: the docs/backlog.md line 360 cite sits at the item whose bold lead reads 'The watch ledger has no destination for a durable fact about the watched system itself' (line 375 at 16c5e61, every standing-watch item having moved fifteen lines down the file); prefer the lead over the line.
- passage: The destination rule sends a decision about a plan to that plan's Chapters, and a durable lesson about the watch's own instruments to the memory store in the pass that produced it.

### C090
- key: Keep on the ledger the pass record and the current state, and write nothing to the ledger twice.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:81
- provenance: 3074425 2026-08-31.
- verdict: keep
- reason: A093. Stays; "the current state" is to be worded so C028's gloss is unnecessary. Stands word for word at section 29's close; the wording C028's reason asks for lands as the sentence after this one ('The current state is the ledger's own definition under The two artifacts, which the two-kinds rule above already divides into the members it places.') rather than inside it, which C028 records.
- passage: The ledger keeps the pass record and the current state, and nothing is written to the ledger twice.

### C091
- key: On a watch with no scheduled end, rely on write-time routing as the whole mechanism, since distil-at-retirement never fires on a seat that does not retire.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:81
- provenance: 3074425 2026-08-31, the coordinator seat as the standing case.
- verdict: rewrite
- landed: e9245e7 section 29
- reason: A093. The rule and its condition stay; the trailing account moves here: without the routing a standing seat's ledger accumulates its own journey and every successor pays the resume cost (memory a-coordination-ledger-holds-current-state-not-its-own-journey, Unbounded growth and Resume cost). Lands at line 81 as 'On a watch with no scheduled end, a standing seat, that write-time routing is the whole mechanism: distil-at-retirement never fires on a seat that does not retire.', the account from ', and what stands in its place without the routing is accumulation' gone; the memory this reason names is named nowhere in the skill body, so no contract name left with the account. C028's bound sentence lands before this one in the same edit.
- passage: On a watch with no scheduled end, a standing seat, that write-time routing is the whole mechanism, since distil-at-retirement never fires.

### C092
- key: Unlike a prohibition or do-not-reopen trap, doubt about whether a particular "mechanism confirmed in source" line is needed is not exempt from the admission default, and its wrongful exclusion is priced as a re-derivation.
- class: rule
- source: plugins/grimoire/skills/standing-watch/SKILL.md:30
- provenance: be769a8 2026-09-03, the exemption drawn on the property no probe reproduces, which the mechanism member lacks.
- verdict: retire
- reason: row 1191 (Residual default and exemptions), dropped under the mechanism cut.
- passage: The third shape does reach a mechanism confirmed in the system's source, whose loss is priced above as a re-derivation.
- ruled: cut 2026-09-30

### C093
- key: Follow the doctrine's habit, under Environment and tooling discipline, of probing a dispatched agent with a message before any stall-signal kill.
- class: pointer
- source: plugins/grimoire/skills/standing-watch/SKILL.md:75
- provenance: d8a3355 2026-08-23; the probe habit moved to the doctrine at 0ea17a9 2026-08-18 as one of the four lines every session needs.
- verdict: keep
- reason: A079. The committed pointer the parity pin at test/doctrine-parity.test.js line 429 relies on. Amendment 2: the test/doctrine-parity.test.js line 429 cite sits at the test named `the liveness bullets defer to finishing-work in each copy` at the landing (declared near line 428, its comment naming standing-watch line 75 as the committed pointer near line 422); prefer the test name over the line.
- passage: Killing a dispatched agent is that same door: probe it with a message first, per the doctrine's probe bullet.
- flag: stale
