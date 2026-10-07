# Rationale ledger: consult

This file is the rationale ledger for the documents the `consult` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/consult/SKILL.md

This document is the kit's escalation instrument: it tells a session how to convene one fresh-context judge, the `consultant` agent, to rule on a single question the session cannot settle on its own. It owns the moments where a session is stuck mid-execution and must decide whether and how to escalate: a second failed attempt at the same problem, a BLOCKED that turns on a decision, a systematic-debugging dead end, a hard-to-reverse or load-bearing decision the spec does not cover, and the design stop, which the floor carries as its own shape while executing-work's step 4 convenes its seat. It also owns the shape of the consult brief, the model and dispatch route for the consultant, the adjudication of the returned ruling, and the choice between the consult and its siblings (design-council, cold, the diff reviewers). Load class: `named-trigger` - the frontmatter says to use it mid-execution at the trigger floor and when the operator asks for a consult or a second opinion on a problem, so it is loaded before convening a consult rather than at session or plan start.

Extracted at `6bc07fb`: whole document (`skills.consult.SKILL.md`). Re-extracted at `d9540ad` over the hunks the Section 5 merge changed (`R` entries below). Re-extracted at `4b2e64c` over the hunks the Section 8 merge changed (`S` entries below). Redrafted on 2026-09-26 by section 9 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, landed at `3ba47390` with its fix round at `5288cfb5`, so every live entry's `passage:` line quotes the text at `5288cfb5` and the `flag:` lines record that pass's flags.

### C001
- key: Convene a consult when you hit the trigger floor mid-execution or when the operator asks for a consult or second opinion on a problem.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:3
- provenance: 1d9c467 2026-08-15, the consult plan (docs/archive/claude-kit_consult_spec_v1.md) built after the sapplefeld-ai-os run where the in-context advisor confirmed a wrong framing; d6cd30d 2026-08-15 narrowed the description's trigger (b) to a BLOCKED that turns on a decision.
- verdict: retire
- superseded-by: R001, R003
- reason: The instruction survives verbatim at HEAD line 3, which 9f1ed1b rewrote (merged at d9540ad) to name the design stop; it continues as R003 with R001, and this id retires as the pre-merge duplicate. The passage itself is kept: the description is the harness's match surface and each enumerated trigger is a match term.

### C002
- key: Decide whether to consult by checking the trigger floor, never by how stuck the session feels.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:3
- provenance: 1d9c467 2026-08-15, the plan's trigger philosophy: stuck sessions feel almost done, so the triggers are a counted floor.
- verdict: retire
- superseded-by: R004
- reason: Survives verbatim at HEAD line 3 as R004 after the 9f1ed1b merge; this id retires as the pre-merge duplicate and the passage stands.

### C003
- key: Do not use the consult to review a diff; send diffs to the adversarial and blind reviewers instead.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:3
- provenance: 1d9c467 2026-08-15, the plan's sibling discriminator set (consult, design-council, cold, the reviewers).
- verdict: retire
- superseded-by: R005
- reason: Survives verbatim at HEAD line 3 as part of R005 after the 9f1ed1b merge; this id retires as the pre-merge duplicate and the passage stands.

### C004
- key: Do not use the consult for design-time divergence; use design-council instead.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:3
- provenance: 1d9c467 2026-08-15, the plan's sibling discriminator set.
- verdict: retire
- superseded-by: R005
- reason: Survives verbatim at HEAD line 3 as part of R005 after the 9f1ed1b merge; this id retires as the pre-merge duplicate and the passage stands.

### C005
- key: Dispatch exactly one read-only fresh judge, the `consultant` agent, on one question, without giving it this session's transcript.
- class: mechanic
- source: plugins/grimoire/skills/consult/SKILL.md:8
- provenance: 1d9c467 2026-08-15, the consult plan; the read-only half is enforced by plugins/grimoire/hooks/readonly-agent-guard.js, which governs `consultant` by name.
- verdict: retire
- superseded-by: R006
- reason: 9f1ed1b rewrote line 8 (merged at d9540ad) so the consultant is the seat at every floor shape but the design stop, whose judge executing-work step 4 names; the instruction survives at HEAD line 8 with that carve-out as R006, and this id retires as the pre-merge duplicate.

### C006
- key: Require the consultant to issue a ruling, test the querent's framing rather than ratify it, and end implementable.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:8
- provenance: 1d9c467 2026-08-15, the plan's mandate ("rule, don't survey; end implementable; every stated instinct is flagged to be tested"), which is what made the incident's fresh-context ruling work.
- verdict: retire
- superseded-by: R008
- reason: Survives verbatim at HEAD line 8 as R008 after the 9f1ed1b merge; this id retires as the pre-merge duplicate. The within-document duplicate of its test-not-ratify clause at line 28 (C024) is the copy that leaves.

### C007
- key: Treat the consultant's blindness to the transcript as the source of its value, since the framing reaches it as text it can test rather than as its own reasoning.
- class: rationale-example
- source: plugins/grimoire/skills/consult/SKILL.md:8
- provenance: 1d9c467 2026-08-15, the plan's "Why the consult exists": the in-context advisor, sharing the transcript, confirmed the wrong framing in the 2026-08-15 incident.
- verdict: retire
- superseded-by: R007
- reason: Survives verbatim at HEAD line 8 as R007 after the 9f1ed1b merge; this id retires as the pre-merge duplicate. The rationale itself is kept in the document (see R007): withholding the transcript is an omission whose value is invisible from the act, and no hook reads brief contents.

### C008
- key: Use the consult as the kit's only escalation instrument, since the kit provides no in-context advisor.
- class: rationale-example
- source: plugins/grimoire/skills/consult/SKILL.md:8
- provenance: d6cd30d 2026-08-15 retired the advisor experiment as superseded (unmeasurable: server-side tool, no local record); 1d9c467 wrote the sentence as present-tense fact per the plan.
- verdict: retire
- superseded-by: R009
- reason: Survives verbatim at HEAD line 8 as R009 after the 9f1ed1b merge; this id retires as the pre-merge duplicate. The sentence is kept in the document (see R009) because the advisor is a live harness setting the kit never edits, so a session can meet it enabled.

### C009
- key: Treat the triggers as a counted floor a re-reader can recognize, because stuck sessions feel almost done rather than stuck.
- class: rationale-example
- source: plugins/grimoire/skills/consult/SKILL.md:12
- provenance: 1d9c467 2026-08-15, the plan's trigger philosophy paragraph.
- verdict: keep
- reason: Without this sentence the floor's bullets read as symptoms to recognize in oneself, which is the under-firing the floor exists to defeat; the 2026-09-08 kaizen note (now a `migrated` kaizen issue) records a section that owed the consult at the second round and got it at the sixth, so the class is still live and no machinery counts the floor.
- passage: Stuck sessions feel almost done, not stuck, so the triggers are a counted floor a re-reader can recognize.

### C010
- key: Convene a consult on a second failed attempt at the same problem, whatever its shape.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:14
- provenance: 1d9c467 2026-08-15 installed trigger (a); fb5d4fe 2026-09-07 added the review seesaw shape (review-loop-exit plan); 9f1ed1b 2026-09-09 added the design stop shape.
- verdict: retire
- superseded-by: R010
- reason: Survives at HEAD line 14 with five shapes as R010 after the 9f1ed1b merge; this id retires as the pre-merge duplicate and the passage stands.

### C011
- key: Where executing-work's tier-escalation ladder already owns the moment, follow that ladder instead of consulting.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:14
- provenance: 1d9c467 2026-08-15, a review fix: trigger (a) as drafted conflicted with the tier-escalation ladder and was made to defer to it.
- verdict: retire
- superseded-by: R013, R014
- reason: Survives verbatim at HEAD line 14 as R013 after the 9f1ed1b merge, now bounded by R014 so it does not reach the design stop; this id retires as the pre-merge duplicate.

### C012
- key: Convene a consult on any BLOCKED that turns on a decision, before escalating.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:15
- provenance: 1d9c467 2026-08-15, trigger (b), narrowed in the same commit's review fix from "any BLOCKED" after it mandated a consult before credential and destructive BLOCKEDs.
- verdict: retire
- superseded-by: S001
- reason: The gate it states is the operator's own preference, cost or risk-appetite call (class operator-decision), not loop upkeep; executing-work line 51 restates it for the BLOCKED path and names this skill as the owner of the mechanics. Both readers' compressions were the same length as the passage. Superseded at `4b2e64c` by S001 (the Section 8 merge; the verdict before it was keep).

### C013
- key: After the consult, send the operator only the preference, cost, or risk-appetite fork that survives, with the ruling attached.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:15
- provenance: 1d9c467 2026-08-15, the plan's trigger (b) sentence.
- verdict: retire
- superseded-by: S002
- reason: At the trigger the routing promise is what makes "consult first" a filter rather than a delay before an inevitable escalation; C039 is the same routing at adjudication and both were kept apart deliberately. The gate is operator-decision class and stays. Superseded at `4b2e64c` by S002 (the Section 8 merge; the verdict before it was keep).

### C014
- key: Send an external dependency only the operator can satisfy, and a destructive action awaiting their yes, straight to the operator without a consult.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:15
- provenance: 1d9c467 2026-08-15, the review fix that exempted the two shapes after the pre-BLOCKED rule proved over-broad.
- verdict: retire
- superseded-by: S003
- reason: Class blast-radius: the destructive arm is the doctrine's stop-for-a-yes on an irreversible act, and the dependency arm waits on something only the operator can supply. A gate on an irreversible act stays. Superseded at `4b2e64c` by S003 (the Section 8 merge; the verdict before it was keep).

### C015
- key: Convene a consult at a systematic-debugging dead end, before the stop-and-report.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:16
- provenance: 1d9c467 2026-08-15, trigger (c), wired from the systematic-debugging skill's side in the same commit.
- verdict: keep
- reason: The skill fixes the moment inside the debugging procedure; the consultant charter's description names the trigger only as its own match surface, which cannot point at the skill.
- passage: **(c) A systematic-debugging dead end**, before the stop-and-report.

### C016
- key: Convene a consult on a hard-to-reverse or load-bearing decision the spec does not cover, where you would otherwise be guessing.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:17
- provenance: 1d9c467 2026-08-15, trigger (d), the general license.
- verdict: keep
- reason: The skill carries the guessing bound the charter's description compresses to "weighty"; owner keeps the whole.
- passage: **(d) The general license:** a hard-to-reverse or load-bearing decision the spec does not cover, where you would otherwise be guessing.

### C017
- key: Send a spec gap to the operator only where the answer turns on preference, cost, or risk appetite; rule on it yourself where it turns on facts about the system.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:19
- provenance: 1d9c467 2026-08-15, the plan's preference-versus-facts discriminator (decided 2026-08-15).
- verdict: keep
- reason: The discriminator binds two seats and each reads it on its own surface: the consultant to know what it may rule, the session to know what to send up. Operator-decision class; it both creates and bounds the gate, so it stays.
- passage: A spec gap is the operator's only where the answer turns on preference, cost or risk appetite. Where it turns on facts about the system, it is rulable.

### C018
- key: Rule a mixed question first, so only the small real fork reaches the operator rather than the whole tangle.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:19
- provenance: 1d9c467 2026-08-15, the same discriminator paragraph.
- verdict: keep
- reason: Narrows the operator gate rather than creating one; what survives is still the operator's fork (operator-decision). Two seats apply it, so both surfaces carry it.
- passage: A mixed question is ruled first, so only the small real fork reaches the operator.

### C019
- key: State the decision plainly in the brief.
- class: mechanic
- source: plugins/grimoire/skills/consult/SKILL.md:25
- provenance: 1d9c467 2026-08-15, the plan's brief template.
- verdict: keep
- reason: Compose versus receive: the skill tells the session what to write, the charter tells the agent what to expect, and neither reader loads the other's surface.
- passage: The decision, stated plainly.

### C020
- key: Return NEEDS_CONTEXT, not a survey, for a consult that arrives without a decision to rule on.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:25
- provenance: 1d9c467 2026-08-15, the plan's brief template; the plan-reviewer's kindred rule (ead49db 2026-09-08) was modelled on it.
- verdict: keep
- reason: Two charters, two dispatches, two missing inputs; the consult's copy is the session-side statement of what a decision-less brief buys.
- passage: A brief without one gets NEEDS_CONTEXT back, not a survey.

### C021
- key: Put the evidence in the brief: for a review-failure consult the rounds' surviving findings, for a debugging consult the hypothesis history.
- class: mechanic
- source: plugins/grimoire/skills/consult/SKILL.md:26
- provenance: 1d9c467 2026-08-15, the plan's brief template; fb5d4fe 2026-09-07 trimmed the wording under the size ratchet.
- verdict: keep
- reason: Compose versus receive; the per-kind evidence is the session's to assemble and the charter says only "the evidence".
- passage: The evidence: a review-failure consult's surviving findings, or a debugging consult's hypothesis history.

### C022
- key: Name in the brief the repo paths worth reading.
- class: mechanic
- source: plugins/grimoire/skills/consult/SKILL.md:27
- provenance: 1d9c467 2026-08-15, the plan's brief template.
- verdict: keep
- reason: Compose versus receive, as C019.
- passage: The repo paths worth reading.

### C023
- key: State the querent's current lean in the brief and label it explicitly as an instinct to test.
- class: mechanic
- source: plugins/grimoire/skills/consult/SKILL.md:28
- provenance: 1d9c467 2026-08-15, the plan's brief template; the label is what the incident's ruling turned on.
- verdict: rewrite
- landed: 433c23d section 39
- reason: Compose versus receive; the label is the session's act and the charter's expectation. The trailing clause on this bullet is C024 and leaves. Flipped to rewrite at section 39's close by C024's retire, which took the bullet's trailing clause: the bullet now closes on a period after "an instinct to test".
- proposed: The querent's current lean, explicitly labeled as an instinct to test.
- passage: The querent's current lean, explicitly labeled as an instinct to test.

### C024
- key: Have the consultant check the querent's lean rather than ratify it.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:28
- provenance: 1d9c467 2026-08-15, the same plan sentence that produced line 8's mandate.
- verdict: retire
- landed: 433c23d section 39
- reason: A within-document duplicate: line 8 states the test-not-ratify mandate for the session and the charter's Test the framing bullet states it for the agent, and the lean bullet's own label ("an instinct to test") already carries the meaning. Safe because both owners keep the rule whole; the edit ends the bullet at the label and is flagged for baseline-testing. Retired at section 39's close: the bullet at line 28 ends "explicitly labeled as an instinct to test." and the checks-never-ratifies clause is gone; C023's entry records the bullet as landed.
- proposed: Same edit as A015: the lean bullet ends at "explicitly labeled as an instinct to test".
- proposed: Same edit as A015.
- baseline-test: yes

### C025
- key: State in the brief what an implementable answer would look like.
- class: mechanic
- source: plugins/grimoire/skills/consult/SKILL.md:29
- provenance: 1d9c467 2026-08-15, the plan's brief template.
- verdict: keep
- reason: Compose versus receive, as C019.
- passage: What an implementable answer would look like.

### C026
- key: Write bulky evidence to the gitignored `.kit/` scratch path and reference it in the brief by path, never pasted inline.
- class: mechanic
- source: plugins/grimoire/skills/consult/SKILL.md:31
- provenance: 1d9c467 2026-08-15, the plan's brief template.
- verdict: retire
- reason: row 517 (Bulky evidence to scratch path), merged. The owner text is executing-work's "**Hand bulky inputs over as files,** not pasted inline" (`plugins/grimoire/skills/executing-work/SKILL.md` line 462) and the doctrine's `.kit/` scratch rule.
- passage: Bulky evidence goes to the gitignored `.kit/` scratch path and rides in the brief as a path, never inline.

### C027
- key: Treat writing the brief as part of the mechanism, not overhead, since the briefing cost forces the problem outside the session's own reasoning loop.
- class: rationale-example
- source: plugins/grimoire/skills/consult/SKILL.md:33
- provenance: 1d9c467 2026-08-15, the plan's discriminator against the advisor ("zero briefing cost" versus "the briefing cost is the mechanism"); the advisor was retired in d6cd30d.
- verdict: retire
- landed: 433c23d section 39
- reason: The contrast it drew lost its second term when the advisor left the kit, and the five brief fields plus the NEEDS_CONTEXT return are obeyable without it. The why is this: a brief written for a reader with no transcript forces the session to state the problem outside its own loop, which is where a wrong premise becomes visible. Retired at section 39's close: the paragraph and the blank line after it are gone, so the `## The model rule` heading follows the design-stop sentence pair with one blank line between.
- proposed: Delete the line "Writing the brief is itself part of the mechanism..." from the brief section; the rationale lives in this ledger under C027.
- baseline-test: yes

### C028
- key: Dispatch the consult as a plain Agent-tool call to `consultant` with the fable model override, at dispatch table row "Fable consultant".
- class: mechanic
- source: plugins/grimoire/skills/consult/SKILL.md:37
- provenance: 1d9c467 2026-08-15, the plan's static Fable-at-high rule (decided 2026-08-15); 42599a6 2026-08-24 reworded only the unavailability clause; test/dispatch-table.test.js's effort map pins the charter's effort.
- verdict: keep
- reason: The consult skill owns the model rule under the ownership map, and the Agent route is the default because the charter's frontmatter effort is already `high`, where the plan reviewer's is `low` and needs Workflow; the contention with brainstorming is two intentional routes, not a conflict.
- passage: The consultant runs at dispatch table row "Fable consultant", a plain Agent-tool dispatch with the fable model override, after executing-work's capacity reading.

### C029
- key: Where the fable tier is unavailable, or executing-work's capacity reading returned `-> downgrade`, dispatch at dispatch table row "Consultant stand-in" instead.
- class: mechanic
- source: plugins/grimoire/skills/consult/SKILL.md:37
- provenance: 1d9c467 2026-08-15, the operator's ruling that the cost hold dies and Opus at `max` is the standing stand-in; 42599a6 2026-08-24 aligned the condition to finishing-work's gate-level fact, pinned by test/doctrine-parity.test.js line 3769; docs/plans/claude-kit_capacity-gate_spec_v1.md section 4 2026-09-24 added the measured downgrade as a separate condition.
- verdict: keep
- reason: The contention with brainstorming's wait rule is two intentional semantics: memory `model-tier-substitution-for-review` (operator, 2026-08-18) draws the line at design and planning work, which waits, while a gate-shaped mid-execution seat substitutes. The condition's wording is pinned: any edit must keep "the stand-in is dispatch table row \"Consultant stand-in\"" and "could not be run at the fable tier".
- passage: Where this consult could not be run at the fable tier in this environment, per finishing-work's unavailability rule, or where that reading returned `-> downgrade`, the stand-in is dispatch table row "Consultant stand-in",

### C030
- key: Fill executing-work's Reviewer Dispatch template naming all three fields explicitly: `agentType` as `grimoire:consultant`, `model`, and `effort`.
- class: mechanic
- source: plugins/grimoire/skills/consult/SKILL.md:37
- provenance: 1d9c467 2026-08-15, the plan's model rule; d6cd30d 2026-08-15 made executing-work's template name `grimoire:consultant`.
- verdict: rewrite
- landed: 433c23d section 39
- reason: Executing-work owns the Reviewer Dispatch template and its three required fields (line 384), so the enumeration here is a partial copy the ownership map calls a defect; the consult-specific value (`agentType` `grimoire:consultant`) rides with the pointer. Safe because the template already marks all three REQUIRED and the pointer remains; flagged for baseline-testing. Lands at line 37 (section 39's close) as "filling executing-work's Reviewer Dispatch template with `agentType` `grimoire:consultant`.", the consult-specific value riding on a pointer, with C031's sentence, the Fable-at-high default, the unavailability clause and the standing-dispatch sentence word for word.
- passage: filling executing-work's Reviewer Dispatch template with `agentType` `grimoire:consultant`.

### C031
- key: Read executing-work's Reviewer Dispatch template for why each dispatch field is required; a consult dispatch only fills it in.
- class: pointer
- source: plugins/grimoire/skills/consult/SKILL.md:37
- provenance: 1d9c467 2026-08-15, the plan's model rule.
- verdict: retire
- reason: row 519 (Fable high with Opus fallback), shrink. Executing-work's Reviewer Dispatch template carries why each field is required, and C030's landed pointer still names the template.
- passage: and that template owns why each field is required.

### C032
- key: Convene a consult at the triggers autonomously, with no per-plan and no per-session ask.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:37
- provenance: d6cd30d 2026-08-15: both reviewers found the fallback route citing an authorization that excluded it; the doctrine's covered class was widened first and this sentence was added to point at it.
- verdict: retire
- reason: row 519 (Fable high with Opus fallback), shrink, standing-dispatch restatement. The doctrine's "**Dispatch is requested standing...**" bullet carries the act: "so is a consult at the consult skill's triggers, with no per-session ask" (`home/grimoire-doctrine.md` line 169).
- passage: The doctrine's standing-dispatch bullet covers both routes, so a consult at the triggers needs no per-plan or per-session ask.

### C033
- key: Keep the consult's model choice static; never pick a tier dynamically at dispatch time.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:39
- provenance: 1d9c467 2026-08-15, "Why static Fable-at-high, never dynamic (decided 2026-08-15)".
- verdict: rewrite
- landed: 433c23d section 39
- reason: A rule with no machinery behind it (nothing stops a session choosing a lower tier for a consult) whose incident class recurs whenever a stuck session judges its own question simple. Flipped to rewrite at section 39's close by C034's retire, which took the colon clause: the opening clause now stands as the whole sentence, closing on a period.
- proposed: The model choice is static, never dynamic.
- passage: The model choice is static, never set by how hard the question looks.

### C034
- key: Treat any rule asking the stuck session to pick a tier as failing exactly when needed, since the consult fires when the session's judgment is compromised.
- class: rationale-example
- source: plugins/grimoire/skills/consult/SKILL.md:39
- provenance: 1d9c467 2026-08-15, the same decision paragraph.
- verdict: retire
- landed: 433c23d section 39
- reason: C033 states the rule in the same sentence's opening clause and is obeyable without the reason. The why is this: the consult fires at the moment the session's judgment is compromised, so a rule that asks that session to choose a tier correctly fails precisely when it is needed. Retired at section 39's close: the colon clause is gone from line 39, and C033's sentence closes on a period, which C033's entry records.
- proposed: Cut the sentence after "The model choice is static, never dynamic"; the why lives in this ledger under C034.
- baseline-test: yes

### C035
- key: Give the consultant the compensation notch because it is gate-shaped: a shallow ruling gets adopted and steers the section with nothing downstream re-asking.
- class: rationale-example
- source: plugins/grimoire/skills/consult/SKILL.md:39
- provenance: 1d9c467 2026-08-15, a review fix that recast the notch rule on gate-shaped versus plan-following ground in executing-work step 4 so it covers the consultant.
- verdict: retire
- landed: 433c23d section 39
- reason: The ground is executing-work's (line 402) and this sentence is a copy applied to one seat; C028 names the tier outright. The why is this: the consultant is gate-shaped, so an under-powered ruling is adopted silently with nothing downstream re-asking the question, which is what the top tier compensates for. Retired at section 39's close: the gate-shaped sentence is gone from line 39, C028 still naming the tier at line 37.
- proposed: Delete the sentence "And the consultant is gate-shaped, which is why it earns the compensation notch..."; the why lives in this ledger under C035 and in executing-work step 4.
- baseline-test: yes

### C036
- key: Have the consultant return a RULING with its EVIDENCE and CONFIDENCE, plus an OPERATOR FORK when one survives.
- class: mechanic
- source: plugins/grimoire/skills/consult/SKILL.md:43
- provenance: 1d9c467 2026-08-15, the plan's adjudication section and the charter's output contract.
- verdict: keep
- reason: The charter owns the output contract; this one sentence names the sections the session must adjudicate, without which C037 to C039 cannot be stated. The OPERATOR FORK carries an operator-decision gate that stays.
- passage: The consultant returns a RULING with its EVIDENCE and CONFIDENCE, plus an OPERATOR FORK when one survives.

### C037
- key: Treat the ruling as a hypothesis and check it against the real code before acting on it.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:43
- provenance: 1d9c467 2026-08-15; the incident was a ruling adopted on a wrong premise.
- verdict: keep
- reason: The consult skill owns how a ruling is adjudicated (executing-work line 473 says so by name), so this is the doctrine's hypothesis rule applied at the owned moment rather than a copy; the charter's version binds the consultant's own evidence.
- passage: Check the ruling against the real code,

### C038
- key: Adopt what holds, and record in the Chapter both the ruling and what was discarded and why.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:43
- provenance: 1d9c467 2026-08-15, the plan's adjudication section.
- verdict: keep
- reason: The Chapter destination is consult-specific and executing-work's Chapter template (Review Findings, Metrics) reads what this tells the session to record.
- passage: adopt what holds, and record in the Chapter both the ruling and what was discarded and why.

### C039
- key: When the ruling leaves a genuine preference fork, send that fork to the operator as the BLOCKED with the ruling attached.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:43
- provenance: 1d9c467 2026-08-15, the plan's trigger (b) routing stated at adjudication.
- verdict: keep
- reason: The routing act at the moment it happens; operator-decision class, guarding the operator's call. C013 is its anticipation at the trigger and both were kept apart deliberately.
- passage: A surviving preference fork goes to the operator as the BLOCKED, with the ruling attached.

### C040
- key: Use the consult when you need the frame checked by fresh context in a single seat, convenable mid-execution.
- class: rationale-example
- source: plugins/grimoire/skills/consult/SKILL.md:47
- provenance: 1d9c467 2026-08-15, the plan's discriminator set, born of the incident where the right instrument was not found mid-execution.
- verdict: retire
- reason: row 522 (Consult versus sibling instruments), merged. The frontmatter carries it, and so does executing-work line 452: "Use the consult for a question whose framing may be wrong".
- passage: **The consult** checks the frame: fresh context, a single seat, convenable mid-execution.

### C041
- key: Use design-council instead for multi-lens divergence at design time with the operator present to adjudicate.
- class: rationale-example
- source: plugins/grimoire/skills/consult/SKILL.md:48
- provenance: 1d9c467 2026-08-15, the plan's discriminator set.
- verdict: retire
- reason: row 522 (Consult versus sibling instruments), merged into the frontmatter's R005: "not design-time divergence (design-council)".
- passage: **design-council** is multi-lens divergence at design time, with the operator present to adjudicate.

### C042
- key: Use cold instead when the operator's own preference contaminates the framing and fresh judgment is needed.
- class: rationale-example
- source: plugins/grimoire/skills/consult/SKILL.md:49
- provenance: 1d9c467 2026-08-15, the plan's discriminator set.
- verdict: retire
- landed: c57e40a section 3
- reason: The cold skill is gone from the tree, so the pointer has no target; the sibling list stands on its three remaining members, C040, C041 and C043.

### C043
- key: Use the reviewers instead when the subject is a diff rather than a question.
- class: rationale-example
- source: plugins/grimoire/skills/consult/SKILL.md:50
- provenance: 1d9c467 2026-08-15, the plan's discriminator set.
- verdict: retire
- reason: row 522 (Consult versus sibling instruments), merged. R005 in the frontmatter carries it: "Not a diff review (the adversarial and blind reviewers)". So does executing-work line 452: "the reviewers for a diff".
- passage: **The reviewers** judge diffs, not questions.

### R001
- key: Convene one fresh-context judge to rule on a question this session cannot settle.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:3
- provenance: 9f1ed1b 2026-09-09, section 3 of the review-loop provenance plan (docs/plans/claude-kit_review-loop-provenance_spec_v1.md), merged at d9540ad; the sentence itself dates from 1d9c467 2026-08-15.
- verdict: keep
- reason: The HEAD form of C001's opening clause; the description is the harness's match surface and this is its lead term.
- passage: Convenes one fresh-context judge to rule on a question this session cannot settle:

### R002
- key: Use the `consultant` agent for every shape the trigger floor sends to a consult except the design stop.
- class: mechanic
- source: plugins/grimoire/skills/consult/SKILL.md:3
- provenance: 9f1ed1b 2026-09-09, the design stop: a judge that must never receive the querent's lean, so its seat is the scope adjudicator or the live Expert seat rather than the consultant.
- verdict: keep
- reason: The seat carve-out stated on the match surface so a session at a design stop does not dispatch the consultant with a lean the judge must not see; executing-work step 4 owns the design stop and this is the pointer-sized statement.
- passage: the consultant agent at every floor shape but the design stop, whose judge executing-work convenes.

### R003
- key: Convene a consult mid-execution at any trigger-floor shape this skill takes, and when the operator asks for a consult or a second opinion.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:3
- provenance: 9f1ed1b 2026-09-09 rewrote the line; the instruction is 1d9c467 2026-08-15, the consult plan's trigger philosophy.
- verdict: keep
- reason: The HEAD form of C001; the four enumerated triggers are the match terms the harness keys on, and d6cd30d records that the description is the trigger surface.
- passage: Use when, mid-execution, the session reaches a second failed attempt at the same problem, any BLOCKED that turns on a decision, a debugging dead end or a weighty decision the spec does not cover, and when the operator asks to 'get a consult on X' or wants a 'second opinion on this problem'.

### R004
- key: Decide whether to consult by checking the trigger floor, never by whether the session feels stuck.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:3
- provenance: 9f1ed1b 2026-09-09 rewrote the line; the instruction is 1d9c467 2026-08-15, the trigger philosophy.
- verdict: keep
- reason: The HEAD form of C002; the load decision itself, placed where the session decides whether to load, and the 2026-09-08 kaizen note shows the under-firing class is still live.
- passage: The session that needs this feels almost done rather than stuck, so check the floor, not the feeling.

### R005
- key: Do not use a consult to review a diff or to run design-time divergence; those go to the reviewers and to design-council.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:3
- provenance: 9f1ed1b 2026-09-09 rewrote the line; the exclusions are 1d9c467 2026-08-15, the discriminator set.
- verdict: keep
- reason: The HEAD form of C003 and C004; exclusions on the match surface, with the body's sibling lines as the pointers at the owners.
- passage: Not a diff review (the adversarial and blind reviewers) and not design-time divergence (design-council).

### R006
- key: Dispatch one read-only fresh judge on one question, the `consultant` agent at every consult shape but the design stop.
- class: mechanic
- source: plugins/grimoire/skills/consult/SKILL.md:8
- provenance: 9f1ed1b 2026-09-09 added the design-stop carve-out; the rule is 1d9c467 2026-08-15, with the read-only half enforced by plugins/grimoire/hooks/readonly-agent-guard.js.
- verdict: keep
- reason: The HEAD form of C005 with the carve-out executing-work step 4 owns; the no-transcript half has no machinery behind it and is what the blindness rationale (R007) keeps obeyed.
- passage: One read-only fresh judge, the `consultant`, rules on one question the session could not settle.

### R007
- key: Keep the judge blind to this session's transcript, because a framing that arrives as text can be tested rather than merely extended.
- class: rationale-example
- source: plugins/grimoire/skills/consult/SKILL.md:8
- provenance: 9f1ed1b 2026-09-09 rewrote the line; the rationale is 1d9c467 2026-08-15, "Why the consult exists": the advisor confirmed the wrong framing because it shared the transcript.
- verdict: keep
- reason: The HEAD form of C007. Withholding the transcript is an omission whose value is invisible from the act, no hook reads brief contents, and the incident (a shared-context judge ratifying a wrong frame) recurs the first time a session pastes its reasoning in.
- passage: It never sees this session's transcript, so it can test the framing rather than extend it.

### R008
- key: Have the consult rule rather than survey, test the querent's framing rather than ratify it, and end implementable.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:8
- provenance: 9f1ed1b 2026-09-09 rewrote the line; the mandate is 1d9c467 2026-08-15.
- verdict: keep
- reason: The HEAD form of C006; the session-side statement of the mandate the charter owns, one sentence, which the session adjudicating a return needs on its own surface.
- passage: It rules rather than surveys, tests the querent's framing rather than ratifying it, and ends implementable.

### R009
- key: Escalate through the consult; do not reach for an in-context advisor, as the kit provides none.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:8
- provenance: 9f1ed1b 2026-09-09 rewrote the line; the sentence is 1d9c467 with the advisor retired in d6cd30d 2026-08-15.
- verdict: keep
- reason: The HEAD form of C008; the advisor is a live harness setting the kit never edits, so the sentence is what fixes the escalation route for a session that meets it enabled.
- passage: The kit has no in-context advisor, and the consult is its escalation instrument.

### R010
- key: Convene a consult on a second failed attempt at the same problem, whatever the attempt's shape.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:14
- provenance: 9f1ed1b 2026-09-09 added the design stop shape; 1d9c467 installed the trigger and fb5d4fe 2026-09-07 the seesaw shape. goal-fit section 3 2026-09-19 moved the design stop out of this bullet into its own bullet (e), so the shapes this key reaches are the implementation round, the debugging hypothesis, the review round and the seesaw.
- verdict: keep
- reason: The HEAD form of C010; the skill owns the shapes and the charter's description names the trigger only as its own match surface.
- passage: **(a) A second failed attempt at the same problem**, whatever its shape, a review seesaw's second reversal of one passage's fix included.

### R011
- key: Carry the design stop as its own floor bullet, and let executing-work's step 4 convene the judge it names instead of the `consultant`.
- class: mechanic
- source: plugins/grimoire/skills/consult/SKILL.md:18
- provenance: 9f1ed1b 2026-09-09, the design stop, added so a re-reader counting second-attempt shapes finds it. goal-fit section 3 2026-09-19 moved it out of bullet (a) into its own bullet (e), the stop no longer being a second failed attempt but a question put before the first one.
- verdict: keep
- reason: The one shape on the floor whose seat is not the consultant; stated here because a session counting the floor would otherwise dispatch the consultant with the lean that judge must never receive. Executing-work step 4 owns the stop and this is the pointer.
- passage: Executing-work's step 4 convenes its judge, never the `consultant`, because that judge must never receive the querent's lean.

### R012
- key: Expect the design stop not to be the only shape routing elsewhere, since the repeating-class Critical branch goes to the tier ladder.
- class: rationale-example
- source: plugins/grimoire/skills/consult/SKILL.md:14
- provenance: 9f1ed1b 2026-09-09, the design stop paragraph.
- verdict: retire
- landed: 433c23d section 39
- reason: R011 is obeyable without it and executing-work step 4 owns the design stop whole. The why is this: the design stop is listed on the floor, not only in executing-work, because a re-reader counting second-attempt shapes has to find it, and it is not the only shape that routes away from the consultant, the repeating-class Critical branch going to the tier ladder. Retired at section 39's close: the sentence is gone from line 14 and its neighbours are joined with one space, the sentence before it still ending "because that judge must never receive the querent's lean."
- proposed: Delete "It is not alone in routing elsewhere, the repeating-class Critical branch below going to the tier ladder, and it is listed here because a re-reader counting the second-attempt shapes has to find it." from line 14.
- baseline-test: yes

### R013
- key: Where executing-work's tier-escalation ladder owns the moment, follow the ladder rather than convening a consult.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:14
- provenance: 9f1ed1b 2026-09-09 rewrote the line; the deferral is the 1d9c467 review fix that resolved trigger (a)'s conflict with the ladder.
- verdict: keep
- reason: The HEAD form of C011; without it a second failed review round with a repeating Critical class would draw a consult on framing where the ladder's tier bump is the remedy.
- passage: A second failed review round whose Criticals repeat a class goes to executing-work's tier-escalation ladder instead.

### R014
- key: Fire the design stop beside the tier ladder rather than deferring to it.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:18
- provenance: 9f1ed1b 2026-09-09; executing-work states the same from the owner's side (the ladder keys on Criticals, the stop on the add-decision). goal-fit section 3 2026-09-19 re-keyed the stop and moved this bound onto bullet (e) with it.
- verdict: retire
- reason: row 514 (Design stop routing), merged. Executing-work step 4 carries it at line 363: "It fires on that line alone, never on severity, provenance or a round count, at the adjudication that wrote it and before anything is built.".
- passage: It fires beside the tier-escalation ladder rather than deferring to it.

### R015
- key: Do not apply this brief section or the three sections below it to the design stop.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:33
- provenance: 9f1ed1b 2026-09-09, the design stop.
- verdict: retire
- landed: 433c23d section 39
- reason: row 518 (Section scope excludes design stop), dropped under the mechanism cut.
- proposed: This section and the three below it are the `consultant`'s, so none of them reaches the design stop.
- passage: This section and the three below it are the `consultant`'s, so none of them reaches the design stop.
- ruled: cut 2026-09-30

### R016
- key: For the design stop, take the brief from the scope adjudicator's charter, dispatch as executing-work's step 4 states, and adopt its bucket as a ruling.
- class: mechanic
- source: plugins/grimoire/skills/consult/SKILL.md:33
- provenance: 9f1ed1b 2026-09-09, the design stop.
- verdict: retire
- landed: 433c23d section 39
- reason: row 514 (Design stop routing), merged. Bullet (e) now carries the pointer at step 4 (R011's landed text). The owner text is executing-work line 363: "The held-finding judge rules, never the `consultant`... Its brief is the charter's fixed one".
- proposed: Keep "This section and the three below it are the `consultant`'s, so none of them reaches the design stop" and replace the rest of the sentence with a pointer at executing-work step 4 as the owner of the design stop's brief, dispatch and ruling.
- baseline-test: yes
- passage: Executing-work's step 4 owns that stop's brief, dispatch and ruling.

### S001
- key: Convene a consult on any BLOCKED that turns on a decision, before taking that BLOCKED to the operator.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:15
- provenance: 1d9c467 2026-08-15, trigger (b), narrowed in the same commit's review fix from "any BLOCKED" after it mandated a consult before credential and destructive BLOCKEDs; cf78ef5 2026-09-09 rewrote line 15 by appending the backstop-substitution pointer and left this clause verbatim.
- verdict: keep
- reason: The gate it states is the operator's own preference, cost or risk-appetite call, not loop upkeep; executing-work line 51 restates it for the BLOCKED path and names this skill as the owner of the mechanics, so the owner's copy holds.
- passage: **(b) Any BLOCKED that turns on a decision.** Consult first,

### S002
- key: Send the operator only the preference, cost, or risk-appetite fork that survives the consult, and attach the ruling to it.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:15
- provenance: 1d9c467 2026-08-15, the plan's trigger (b) sentence; cf78ef5 2026-09-09 rewrote line 15 by appending the backstop-substitution pointer and left this clause verbatim.
- verdict: keep
- reason: At the trigger the routing promise is what makes "consult first" a filter rather than a delay before an inevitable escalation; C039 is the same routing at adjudication and both were kept apart deliberately. Operator-decision class with no machinery routing the fork.
- passage: and send the operator only the preference, cost or risk-appetite fork that survives, ruling attached.

### S003
- key: Take an external dependency only the operator can satisfy, or a destructive action awaiting their yes, straight to the operator without ruling on it.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:15
- provenance: 1d9c467 2026-08-15, the review fix that exempted the two shapes after the pre-BLOCKED rule proved over-broad; cf78ef5 2026-09-09 rewrote line 15 by appending the backstop-substitution pointer and left this clause verbatim.
- verdict: keep
- reason: Class blast-radius: the gated arm is an act the doctrine's stop-for-a-yes rule gates and no proceed-ahead covers, and the dependency arm waits on something only the operator can supply, so neither is a decision to rule on and the gate on such an act stays. The arm reads as the rule's own class rather than as a destructive act, since the doctrine gates on a consequence test rather than on a named category. Executing-work line 51 restates the two shapes from the BLOCKED side and this skill's copy is the owner's.
- passage: An external dependency only the operator can satisfy, or an act the stop-for-a-yes rule gates and no proceed-ahead covers, goes straight up.

### S004
- key: Accept a design stop's own ruling in place of the consult this BLOCKED trigger orders.
- class: rule
- source: plugins/grimoire/skills/consult/SKILL.md:15
- provenance: cf78ef5 2026-09-09, Chapter 8 of the review-loop provenance plan: trigger (b) stated no carve-out, so a session that loaded this skill would dispatch a consultant beside the judge the review-round backstop had already convened.
- verdict: keep
- reason: The carve-out on this document's own trigger is the consult skill's to state, while the substitution's conditions stay with executing-work's step 4 backstop paragraph (line 414, restated at line 51), and the clause restates none of them, so it is already the pointer the ownership map asks for. test/review-loop-provenance.test.js subject 5b pins "review-round backstop", "step 4" and "substitution" inside the (b) bullet with a mutation control, so any edit must keep all three there.
- passage: Executing-work's review-round backstop names a substitution for this trigger: a design stop's own ruling stands in for the consult and for nothing else this trigger orders,

### S005
- key: Read executing-work's step 4 backstop paragraph for the conditions under which a design stop's ruling substitutes for this consult.
- class: pointer
- source: plugins/grimoire/skills/consult/SKILL.md:15
- provenance: cf78ef5 2026-09-09, the same pointer clause, installed so the consult skill and executing-work agree on the one moment a judge stands in for the consultant.
- verdict: keep
- reason: The pointer at the owner of the conditions, in the form the ownership map asks a non-owner to carry (as C031 does for the dispatch template); it shares one sentence with S004 and the subject 5b pin requires "step 4" in the (b) bullet, so the pointer cannot move out of the bullet without a red.
- passage: on the conditions its step 4 backstop paragraph states.

### C044
- key: Carry the plan's `## Goal` and `## Intent` by path in the brief where a plan exists, saying so where the plan carries no record.
- class: mechanic
- source: plugins/grimoire/skills/consult/SKILL.md:28
- provenance: docs/plans/claude-kit_goal-fit_spec_v1.md section 2 2026-09-19, which admits the record to every fresh-context seat that holds the plan's what.
- verdict: keep
- reason: C023 already labels the querent's lean an instinct to test, and this field is what the seat tests it against. By path rather than quoted, because the record is bounded to about one screen and the seat holds Read; quoting it into every brief would put the orchestrator between the judge and the operator's own words. The explicit no-record case stops a seat reading a missing section as a defective brief.
- passage: The plan's `## Goal` and `## Intent` by path, where a plan exists, so the consultant tests the frame against the operator's own words. Where the plan has no `## Intent`, the Goal rides alone and the brief says so.
