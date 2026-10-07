# Rationale ledger: design-council

This file is the rationale ledger for the documents the `design-council` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/design-council/SKILL.md

This document is the procedure for convening a read-only, multi-lens "design council" that pressure-tests competing approaches at a genuine architecture fork, built specifically against false convergence (models agreeing by capitulation rather than by evidence). It owns the moments of framing a design fork as an outcome plus candidate approaches, picking and dispatching the lens roster, running the blind first round, running the neutral facilitator's convergence verdict, running cross-examination rounds up to a cap, and delivering the synthesis and any unresolved fork to the operator for decision; it also owns the opt-in and cost-envelope gate for that spend. Its load class is `named-trigger`: the description states it is offered by the brainstorming skill when a decision is material and hard to reverse, and is directly invocable when the operator asks to convene the council, pressure-test an approach, or get multiple angles on a design before building, and it explicitly does not govern code review, non-code judgment calls, or a session stuck mid-execution.

Extracted at `6bc07fb`: whole document (`skills.design-council.SKILL.md`). Redrafted on 2026-09-26 by section 9 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, landed at `6128340d` with its fix round at `5288cfb5`, so every live entry's `passage:` line quotes the text at `5288cfb5` and the `flag:` lines record that pass's flags.

### C001
- key: Do not let the orchestrator judge convergence or act as a council member.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:14
- provenance: f62fc16 2026-06-15, the design-council install, which adapted the blind-then-converge protocol from DheerG/swarms Converge and built every rule against false convergence; the seed's a8770b3 changed only pronouns.
- verdict: keep
- reason: The doer-is-not-judge separation is the skill's central defense and nothing mechanical enforces it; the hard-requirements copy (C037) retires so this bullet is the single statement.
- passage: The orchestrator does not judge convergence and is not a council member.

### C002
- key: Run the main session as orchestrator: frame the fork, dispatch agents, carry text between rounds, and present the result to the operator.
- class: mechanic
- source: plugins/grimoire/skills/design-council/SKILL.md:14
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: No finding; the seat definition the rest of the procedure assumes.
- passage: It frames the fork, dispatches agents, carries text between rounds, and presents the result to me.
- flag: weak-reason

### C003
- key: Use read-only `council-member` agents, one per lens, to research the repo and data, take positions, and engage each other across rounds.
- class: mechanic
- source: plugins/grimoire/skills/design-council/SKILL.md:15
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: Picks the agent type the orchestrator dispatches; the read-only property is enforced for that type by plugins/grimoire/hooks/readonly-agent-guard.js, so the word here is descriptive and the type name is what steers dispatch.
- passage: **Council members** - read-only `council-member` agents, one per lens. They research the real repo and data, take positions, and engage each other across rounds.

### C004
- key: Assume members start blank and put the lens and everything they need into the brief.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:15
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: retire
- landed: 970ecf1 section 40
- reason: Step 2 (C018) states the same inherit-nothing contract with the fields enumerated, at the point the brief is composed; this Roles sentence is a forward restatement with no incident behind it. Retired at section 40's close: line 15's third sentence is gone and the bullet closes on "engage each other across rounds.", both proposals satisfied by the one deletion.
- proposed: Line 15 keeps the first two sentences (agent type, one per lens, what members do) and drops the third.
- proposed: (via A007) Delete "They start blank: the brief carries the lens and everything they need." at line 15; C018 at line 28 carries the contract.
- baseline-test: yes

### C005
- key: Use one neutral read-only `design-facilitator` agent that, after each round, maps agreement versus live disagreement, names each dispute's crux, classifies convergence as evidence-resolved or capitulation, and decides another round, converged, or deadlock.
- class: mechanic
- source: plugins/grimoire/skills/design-council/SKILL.md:16
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: rewrite
- landed: 970ecf1 section 40
- reason: The seat definition stays; the return contract it carries is stated again at step 3 (C023), where the orchestrator receives and checks the output, so the contract clauses leave this bullet and live once at line 32. Lands at line 16 (section 40's close) as "**Facilitator** - one read-only `design-facilitator` agent, neutral, separate from the orchestrator.", the seat definition alone; the return contract sits on line 32 under C023 with C038's flag folded in.
- proposed: (via A011) Line 16 becomes the seat definition only ("one read-only design-facilitator agent, neutral, separate from the orchestrator"); line 32 carries the return contract and gains the soft-convergence flag from line 46; line 46 is deleted.
- baseline-test: yes
- passage: **Facilitator** - one read-only `design-facilitator` agent, neutral, separate from the orchestrator.

### C006
- key: Keep the facilitator separate from the orchestrator so the operator's design partner never declares the debate settled.
- class: rationale-example
- source: plugins/grimoire/skills/design-council/SKILL.md:16
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: retire
- landed: 970ecf1 section 40
- reason: The why of C001: the orchestrator is the operator's design partner and is agreeable by default, so a separate seat holds the verdict. The rule is obeyable without this clause and the facilitator charter carries the same reason to the seat that acts on it. Retired at section 40's close: the separation clause survives only as "separate from the orchestrator" inside C005's seat definition on line 16, and its why is gone from the document.
- proposed: Drop "so my design partner never declares the debate settled" from line 16; the ledger entry for C006 carries it.
- baseline-test: yes

### C007
- key: Before dispatching anything, confirm the operator opted in, via the brainstorming offer or a direct request.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:20
- provenance: f62fc16 2026-06-15, the design-council install; re-grounded by 1d9c467 2026-08-15, the consult plan, which made "operator-present, never auto-run" the council's discriminator from the auto-convenable consult.
- verdict: retire
- reason: row 661 (operator opt-in check) merges into Frame's cost-and-yes gate. C016's landed "and dispatch nothing before my yes." carries the bar on dispatching before the operator agrees, and the description carries the two entry routes, the brainstorming offer and a direct request.
- passage: Before dispatching anything, confirm I opted in, via the brainstorming offer or a direct request.

### C008
- key: When invoked cold, restate the fork and the roster and get the operator's go before proceeding.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:20
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: retire
- landed: 970ecf1 section 40
- reason: Step 1 restates the fork and roster and takes the yes on every invocation (C016), so the cold clause adds no act; the gate survives whole in C016. Retired at section 40's close: the cold-invocation sentence is gone from line 20, which now carries C007's sentence alone.
- proposed: (via A016) Delete "If invoked cold, restate the fork and the roster and get my go first." at line 20; step 1 restates the fork and roster and takes the yes on every path.
- baseline-test: yes

### C009
- key: Never auto-run the council.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:20
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: retire
- landed: 970ecf1 section 40
- reason: Restates C007 in the same paragraph, and the description line carries "never runs without me present to adjudicate" from 1d9c467; two statements of the bar remain after this one goes. The consult's autonomous convening is a different instrument by design, not a conflict. Retired at section 40's close: the never-auto-run sentence is gone from line 20, which now carries C007's sentence alone.
- proposed: (via A015) Delete "Never auto-run." at line 20; C007 and the description carry the gate.
- baseline-test: yes

### C010
- key: Treat the council as a real spend because it runs agents and consumes tokens.
- class: rationale-example
- source: plugins/grimoire/skills/design-council/SKILL.md:20
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: retire
- landed: 970ecf1 section 40
- reason: The why of the opt-in gate: a run is token-intensive and slow (brainstorming step 6 says so at the offer). The gate is obeyable without the sentence. Retired at section 40's close: the spend sentence is gone from line 20, which now reads "Before dispatching anything, confirm I opted in - via the brainstorming offer or a direct request." and nothing else.
- proposed: Drop "This skill runs agents and spends tokens." from line 20.
- baseline-test: yes

### C011
- key: State the decision as an outcome (what is true when it is done) plus the 2 to N candidate approaches on the table.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:24
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: Outcome framing is what lets the council weigh approaches the operator did not name; nothing enforces it and the compressions offered lose the example that makes it operable.
- passage: State the decision as an **outcome**, what is true when done, plus the 2–N candidate approaches.

### C012
- key: Frame by outcome because it widens the debate, while naming a solution pre-commits the argument.
- class: rationale-example
- source: plugins/grimoire/skills/design-council/SKILL.md:24
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: "Outcome" is glossed only abstractly; the 50ms-versus-Redis pair is what tells an orchestrator which side of the line a phrasing falls on, so the rule cannot be reliably obeyed without it.
- passage: State the decision as an **outcome**, what is true when done, plus the 2–N candidate approaches. "Profile reads return under 50ms and skip the DB when cached" lets the council weigh caching against query optimization, while "add a Redis cache" pre-commits the argument. The default lenses are performance, maintainability/architecture, and risk-security, which reads `docs/security-model.md` if present. Swap a lens to fit the fork, such as a data-model lens on a schema decision, or an opposite-approach steelman when one option is the obvious favorite. Name the cost to me as seats × round cap, and dispatch nothing before my yes.

### C013
- key: Default the lens roster to three: performance, maintainability/architecture, and risk-security, with the risk-security lens reading `docs/security-model.md` where it exists.
- class: mechanic
- source: plugins/grimoire/skills/design-council/SKILL.md:24
- provenance: f62fc16 2026-06-15, the design-council install; dc87c38 2026-06-28 removed the hardcoded counts from brainstorming so this line is the only place the default lives.
- verdict: keep
- reason: The framing step is where the roster is picked, so it owns the default; the cost-envelope copy (C042) retires.
- passage: The default lenses are performance, maintainability/architecture, and risk-security, which reads `docs/security-model.md` if present.

### C014
- key: Swap a lens to fit the fork, such as a data-model lens on a schema decision or an opposite-approach steelman when one option is the obvious favorite.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:24
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: The bound on C013's default and the only statement of when a non-default lens is used; the member charter names the lenses but not the trigger.
- passage: Swap a lens to fit the fork, such as a data-model lens on a schema decision, or an opposite-approach steelman when one option is the obvious favorite.

### C015
- key: Name the cost to the operator as seats times round cap.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:24
- provenance: f62fc16 2026-06-15, the design-council install; dc87c38 2026-06-28 made this skill the sizing authority by dropping the counts from brainstorming.
- verdict: keep
- reason: The only statement of what the cost is measured in; brainstorming's "name its cost" points here and C043's copy retires.
- passage: Name the cost to me as seats × round cap

### C016
- key: Proceed past framing only on the operator's yes.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:24
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: Operator-decision gate on this fork, roster and cost, distinct from the opt-in that admits the council at all; C008's cold-invocation go is this yes and folds here.
- passage: and dispatch nothing before my yes.

### C017
- key: Dispatch each council member separately and in parallel for round one.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:28
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: Separate dispatch is how blindness is achieved; brainstorming's bar on delegating the conversation does not reach it, since the council argues the fork and returns to the conversation (line 8).
- passage: Dispatch each member separately and in parallel.

### C018
- key: Put verbatim into each round-one brief the outcome, the candidate approaches, that member's lens, the repo paths and data worth reading, and the read-only constraint.
- class: mechanic
- source: plugins/grimoire/skills/design-council/SKILL.md:28
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: The brief contract the orchestrator composes from, and the single owner of it once C004 retires. The read-only item is now also enforced by plugins/grimoire/hooks/readonly-agent-guard.js for the council-member type, so a later pass may drop that one field without loss.
- passage: Each brief carries verbatim the outcome, the approaches, that member's lens, and the repo paths and data worth reading.
- passage: Members inherit nothing else

### C019
- key: Keep members from seeing each other's briefs or outputs during round one.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:28
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: rewrite
- landed: 970ecf1 section 40
- reason: Blindness is the first false-convergence defense and nothing mechanical withholds a brief; the hard-requirements copy (C036) retires so step 2 is the single statement. Flipped to rewrite at section 40's close by C020's retire, which took the clause after the spaced hyphen: the sentence's words are unchanged and it now closes on a period.
- proposed: Members must not see each other's briefs or outputs this round.
- passage: they must not see each other's briefs or outputs this round.

### C020
- key: Keep round one blind because blindness puts genuine divergence on the record before anyone anchors.
- class: rationale-example
- source: plugins/grimoire/skills/design-council/SKILL.md:28
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: retire
- landed: 970ecf1 section 40
- reason: The why of C019: models anchor on whatever they see first, so divergence is only visible if captured before cross-talk. The orchestrator's rule is obeyable without it and the member charter states it to the seat that must hold it. Retired at section 40's close: the clause after the spaced hyphen is gone from line 28, and C019's sentence closes on a period, which C019's entry records.
- proposed: (via A040) Drop the clause after the dash at line 28; the ledger entry for C020 carries it.
- baseline-test: yes

### C021
- key: Require each member to return a position grounded in evidence it actually read plus its strongest objection to each alternative.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:28
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: retire
- landed: 970ecf1 section 40
- reason: row 666 (evidence-grounded positions) merges into the council-member charter, `plugins/grimoire/agents/council-member.md`. Round 1 step 2 there says "Ground each load-bearing claim in evidence you read", step 3 says "Object to each alternative", and the Output block carries POSITION and OBJECTIONS.
- proposed: (via A042) Line 28's last sentence gains "an ungrounded assertion carries no weight"; line 49 is deleted.
- baseline-test: yes
- passage: Each returns a position grounded in evidence it actually read, plus its strongest objection to each alternative.
- passage: An ungrounded assertion carries no weight.

### C022
- key: Hand the facilitator all member positions after the round.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:32
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: The hand-off that makes the neutral seat the judge; the charter states the receiving side and neither seat loads the other's document.
- passage: Hand the facilitator all member positions.

### C023
- key: Require the facilitator to return the agreement map, the attributed live disagreements, each dispute's crux, and a status of CONVERGED, ANOTHER_ROUND with a targeted question per member, or DEADLOCK.
- class: mechanic
- source: plugins/grimoire/skills/design-council/SKILL.md:32
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: rewrite
- landed: 970ecf1 section 40
- reason: Becomes the single statement of the facilitator's return contract in this document, absorbing C038's soft-convergence flag; the orchestrator checks the output against this line and never loads the charter, so a pointer would drop it. Lands at line 32 (section 40's close) with the contract sentence word for word and the classification and the soft-convergence flag as two sentences after it, "It classes each resolved point as evidence-resolved or capitulation. It flags a member that caved without citing why as soft convergence rather than agreement.", the two-sentence form taken on the writing-skills one-idea bar where the proposal says the sentence gains one clause.
- proposed: Line 32's contract sentence gains "with each resolved point classed as evidence-resolved or capitulation, and a member that caved without citing why flagged as soft convergence rather than agreement".
- baseline-test: yes
- passage: It returns the agreement map, the attributed live disagreements, each one's crux, each agreed point classed as evidence-resolved or soft, and a status: CONVERGED, ANOTHER_ROUND with a targeted question per member, or DEADLOCK.

### C024
- key: Treat a CONVERGED verdict after one round as suspect and check it is not just correlated models agreeing.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:32
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: The orchestrator is the one seat that can send another round after the facilitator has signed, so its own instruction to distrust an instant CONVERGED stays beside the charter's.
- passage: Check a first-round CONVERGED is not just correlated models agreeing.

### C025
- key: On ANOTHER_ROUND, re-dispatch the members the facilitator named.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:36
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: The loop step; every clause of the paragraph is a distinct act except the statelessness aside (C027), which leaves.
- passage: On ANOTHER_ROUND, re-dispatch the named members.

### C026
- key: Re-dispatch a member as a fresh agent handed the full transcript.
- class: mechanic
- source: plugins/grimoire/skills/design-council/SKILL.md:36
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: rewrite
- landed: 970ecf1 section 40
- reason: States the re-dispatch form, which forecloses keeping members alive across rounds; obeyable without the equivalence argument that follows it. Flipped to rewrite at section 40's close by C027's retire, which took the clause after the spaced hyphen: the sentence's words are unchanged and it now closes on a period.
- proposed: A re-dispatched member is a fresh agent handed the full transcript.
- passage: A re-dispatched member is a fresh agent handed the full transcript.

### C027
- key: Treat a fresh agent with the full transcript as identical to the same expert continuing, since the model is stateless, so nothing is lost.
- class: rationale-example
- source: plugins/grimoire/skills/design-council/SKILL.md:36
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: retire
- landed: 970ecf1 section 40
- reason: The why of C026: a stateless model given the full transcript is the same expert continuing, so re-dispatch loses nothing and there is no reason to hold a member agent open between rounds. The mechanic is obeyable without it. Retired at section 40's close: the clause after the spaced hyphen is gone from line 36, and C026's sentence closes on a period as this entry's proposal spells it, which C026's entry records.
- proposed: (via A053) Line 36 reads "A re-dispatched member is a fresh agent handed the full transcript." and drops the clause after the dash.
- baseline-test: yes

### C028
- key: Put into each cross-examination brief the member's own prior position, the other positions, and the facilitator's targeted question for that member.
- class: mechanic
- source: plugins/grimoire/skills/design-council/SKILL.md:36
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: The cross-examination brief contract on the composing side; the charter states the receiving side.
- passage: Its brief carries its own prior position, the other positions, and the facilitator's question for it.

### C029
- key: Require each member to engage the strongest objection aimed at it by conceding, rebutting with evidence, or revising, and to report what it conceded versus held.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:36
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: The requirement the orchestrator's brief carries; the charter states the member's act and output shape. Compose versus act.
- passage: It must engage the strongest objection aimed at it by conceding, rebutting with evidence, or revising, and report what it conceded versus held.

### C030
- key: Run another facilitator pass after each cross-examination round.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:36
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: The loop-back from step 4 to step 3; five words of control flow the procedure has no other statement of.
- passage: Then run another facilitator pass.

### C031
- key: Stop the rounds on CONVERGED, on DEADLOCK, or when the round cap is hit, defaulting to three rounds.
- class: mechanic
- source: plugins/grimoire/skills/design-council/SKILL.md:36
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: The stop logic at the step that acts on it and the single owner of the round default once C042 retires. The one recorded run (docs/archive/backlog-2026-Q3.md:32, 2026-07-31) converged in two rounds under this cap.
- passage: Stop on CONVERGED, on DEADLOCK, or at the round cap, default three.

### C032
- key: Present the facilitator's synthesis to the operator: the converged recommendation with its evidence and trade-offs, plus any unresolved fork stated prominently as the operator's decision with each option's optimization.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:40
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: Operator-decision gate: the design fork is the operator's, the doctrine's own example of a decision no seat makes; C039's value-trade-off restatement folds here.
- passage: Present the facilitator's synthesis: any converged recommendation with its evidence and trade-offs, and prominently any unresolved fork as my decision, with what each option optimizes for.

### C033
- key: When the council deadlocked or hit the cap, say so and show the standing positions rather than papering over it.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:40
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: rewrite
- landed: 970ecf1 section 40
- reason: Stays as the delivery act and absorbs C040's fixed return string "unresolved - standing positions follow", so the deadlock delivery is stated once where it is performed. Lands at line 40 (section 40's close) as the proposal's sentence word for word, "If the council deadlocked or hit the cap, return "unresolved - standing positions follow" and show them; do not paper over it or force a consensus.", its semicolon kept as ruling A066 spelled it.
- proposed: (via A066) Line 40's deadlock sentence reads "If the council deadlocked or hit the cap, return "unresolved - standing positions follow" and show them; do not paper over it or force a consensus." and line 48 is deleted.
- baseline-test: yes
- passage: If the council deadlocked or hit the cap, return "unresolved - standing positions follow" and show them, never forcing a consensus.

### C034
- key: Record the operator's decision and its rationale in the plan doc per the kit.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:40
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: keep
- reason: Already the pointer form ("per the kit") at the doctrine's decision-record rule, which owns the dated form and the memory destination.
- passage: Record my decision per the doctrine's Surface decisions in batches bullet.

### C035
- key: Let the council inform the call and never make it; the operator decides.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:40
- provenance: f62fc16 2026-06-15, the design-council install; 1d9c467 2026-08-15 leaned on it as the council's discriminator from the ruling consult.
- verdict: keep
- reason: The council's mandate limit and the gate the skill exists for; the consult rules, the council informs, and the consult plan wrote that distinction into this skill's description on purpose.
- passage: The council informs the call; it never makes it.

### C036
- key: Keep round one blind so divergence is captured before any cross-talk.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:44
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: retire
- landed: 970ecf1 section 40
- reason: Restates C019 with C020's reason attached; step 2 is where the orchestrator withholds the other briefs and owns the rule. Retired at section 40's close: item 1 of the defenses block is gone; with every item of the block retired or folded, the `## False-convergence defenses (hard requirements)` heading and its blank lines left with them (57 to 48 lines), no file in the tree naming the heading (the implementer's grep over plugins, home, docs, test and README).

### C037
- key: Keep the facilitator a separate neutral seat, never the orchestrator and never a member.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:45
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: retire
- landed: 970ecf1 section 40
- reason: Restates C001 from the facilitator's side in the same document; the Roles bullet owns it and the facilitator charter carries the seat's own copy. Retired at section 40's close: item 2 of the defenses block is gone, the block and its heading with it (C036's entry records the heading). The retired item's never-a-member half rests on the two seats being distinct agent types, `council-member` and `design-facilitator`, the Roles bullet stating the orchestrator separation alone.

### C038
- key: Have the facilitator classify each resolved point as evidence-resolved or capitulation, and flag a member that caved without citing why as soft convergence rather than accepting it as agreement.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:46
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: retire
- landed: 970ecf1 section 40
- reason: row 668 (capitulation versus evidence classing) merges into `plugins/grimoire/agents/design-facilitator.md`. Its item 4, "Convergence classification", classes each agreed point as evidence-resolved or soft and flags soft agreement as not convergence. The orchestrator-side clause, "each agreed point classed as evidence-resolved or soft", stays in C023's passage.
- proposed: (via A011) Line 16 becomes the seat definition only ("one read-only design-facilitator agent, neutral, separate from the orchestrator"); line 32 carries the return contract and gains the soft-convergence flag from line 46; line 46 is deleted.
- baseline-test: yes
- passage: It classes each resolved point as evidence-resolved or capitulation. It flags a member that caved without citing why as soft convergence rather than agreement.

### C039
- key: Escalate genuine value trade-offs to the operator and never auto-resolve them.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:47
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: retire
- landed: 970ecf1 section 40
- reason: The gate is real and survives whole: C032 presents every unresolved fork as the operator's decision, C035 bars the council deciding, and the facilitator charter routes a value crux up. This line adds no act to either seat. Retired at section 40's close: item 4 of the defenses block is gone, the block and its heading with it (C036's entry records the heading).
- proposed: (via A077) Delete hard requirement 4 at line 47.
- baseline-test: yes

### C040
- key: When the round cap is hit without real convergence, return "unresolved - standing positions follow" instead of a forced consensus.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:48
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: rewrite
- landed: 970ecf1 section 40
- reason: Restates C033 and fixes the return string; the string folds into C033 at the delivery step and this list entry goes. The facilitator charter carries the seat-side bar on manufacturing convergence. Lands at section 40's close as the deadlock sentence on line 40 recorded under C033, with item 5 of the defenses block gone.
- proposed: (via A066) Line 40's deadlock sentence reads "If the council deadlocked or hit the cap, return "unresolved - standing positions follow" and show them; do not paper over it or force a consensus." and line 48 is deleted.
- baseline-test: yes
- passage: If the council deadlocked or hit the cap, return "unresolved - standing positions follow" and show them, never forcing a consensus.

### C041
- key: Require every load-bearing claim to cite evidence the member actually read, and give ungrounded assertions no weight.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:49
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: retire
- landed: 970ecf1 section 40
- reason: row 666 (evidence-grounded positions) merges into the council-member charter's "Ground each load-bearing claim in evidence you read". The facilitator charter backs it with "Make convergence track evidence, not politeness". C041's own reason already names the member charter as stating the bar for the seat.
- proposed: (via A042) Line 28's last sentence gains "an ungrounded assertion carries no weight"; line 49 is deleted.
- baseline-test: yes
- passage: An ungrounded assertion carries no weight.

### C042
- key: Default the envelope to three seats and a maximum of three cross-examination rounds, with all members read-only.
- class: mechanic
- source: plugins/grimoire/skills/design-council/SKILL.md:53
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: retire
- landed: 970ecf1 section 40
- reason: Every clause is stated where it is acted on (C013 seats, C031 rounds, C003 read-only) and the read-only property is enforced by plugins/grimoire/hooks/readonly-agent-guard.js for both council agent types. Retired at section 40's close: the default-envelope sentence is gone from the Cost envelope section, which now carries C044's sentence alone at line 44.
- proposed: (via A084) Delete "Default three seats, three cross-examination rounds maximum; members are read-only." at line 53.
- baseline-test: yes

### C043
- key: Offer the council only at genuine forks, and name the cost in the offer so the operator authorizes the spend.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:53
- provenance: f62fc16 2026-06-15, the design-council install; overtaken on its first half by dc87c38 2026-06-28, which lowered brainstorming's offer bar ("lower the bar to offer, never the bar to run").
- verdict: retire
- landed: 970ecf1 section 40
- reason: The offer trigger is brainstorming's per the ownership map and history says its lower bar is right, so "only at genuine forks" gives way; the cost half duplicates C015, which carries the formula. The run bar (C007, C016) is untouched. Retired at section 40's close: the offer sentence is gone and line 44 reads "I can cut the roster, cap rounds, or decline at any point.", both proposals satisfied by the one deletion.
- proposed: (via A086) Delete "Offered only at genuine forks, and the offer names the cost so I authorize the spend." at line 53.
- proposed: Line 53 reads "I can cut the roster, cap rounds, or decline at any point."
- baseline-test: yes

### C044
- key: Honor the operator cutting the roster, capping rounds, or declining at any point.
- class: rule
- source: plugins/grimoire/skills/design-council/SKILL.md:53
- provenance: f62fc16 2026-06-15, the design-council install.
- verdict: retire
- reason: row 676 (operator cost envelope), dropped under the mechanism cut.
- passage: I can cut the roster, cap rounds, or decline at any point.
- ruled: cut 2026-09-30

### C045
- key: Run the design council on stable Claude Code, not on the experimental agent-teams harness.
- class: mechanic
- source: plugins/grimoire/skills/design-council/SKILL.md:57
- provenance: f62fc16 2026-06-15, the design-council install, which re-expressed the Converge protocol in the kit's own subagent dispatch idiom.
- verdict: retire
- reason: row 677 (provenance note), dropped under the mechanism cut.
- passage: It runs on stable Claude Code without the experimental agent-teams harness.
- flag: weak-reason
- ruled: cut 2026-09-30
