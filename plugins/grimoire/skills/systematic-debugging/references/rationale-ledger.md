# Rationale ledger: systematic-debugging

This file is the rationale ledger for the documents the `systematic-debugging` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/systematic-debugging/SKILL.md

This document is the kit's root-cause debugging discipline: it defines a five-phase gated workflow (classify, reproduce, investigate, hypothesize and test, fix the root cause) plus an escalation rule for repeated failed fixes. It owns the moments where a session is investigating a bug, a failure, unexpected behavior, a failing test, or a production incident, and specifically the moment before any fix is proposed; it also owns the decision point after two failed fix attempts, where it directs a consult and a stop-and-report. Its load class is `named-trigger`: the frontmatter says to use it whenever investigating a bug or failure and BEFORE proposing any fix, naming triggers such as 'bug', 'broken', 'failing', 'why is this happening', error reports, and any situation where a previous fix attempt did not work, with the sole carve-out that it is skipped for trivial fixes whose cause is directly visible.

Extracted at `6bc07fb`: whole document (`skills.systematic-debugging.SKILL.md`). Redrafted on 2026-09-26 by section 9 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, landed at `d0d590ec` with its fix round at `5288cfb5`, so every live entry's `passage:` line quotes the text at `5288cfb5` and the `flag:` lines record that pass's flags, and A003 below is the classify-first step that section added.

### C001
- key: Load and follow this debugging discipline whenever investigating a bug, failure, unexpected behavior, failing test, or incident, before proposing any fix.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:3
- provenance: 51e8c42 2026-06-11, the skill's creation commit, which states the discipline as a design rather than an incident; 0e47170 2026-07-15 quoted the description and left its trigger list whole while trimming sibling skills' tails.
- verdict: keep
- reason: The description is the harness's skill-selection surface, so its trigger words are matching machinery rather than prose to a reader; the failed-fix trigger is repeated at line 41 because that line is read by a session already inside the skill weighing the trivial-fix carve-out.
- passage: Use whenever investigating a bug, failure, unexpected behavior, failing test, or production incident - BEFORE proposing any fix.
- passage: A failed first fix means you are now debugging, so use this skill.

### C002
- key: Never propose a fix until you have reproduced and understood the root cause.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:8
- provenance: 51e8c42 2026-06-11, the skill's creation commit ("fix the cause not the symptom").
- verdict: keep
- reason: The ownership map makes this skill the owner of root-causing a failure before proposing a fix and the doctrine's Root-cause bullet the pointer, so the iron rule is the owner's whole statement. The sentence "This is the one workflow where gating is deliberate" stays with it as the bound that keeps the doctrine's effort-matching rule from licensing a skip of the phases.
- passage: The iron rule: **no fix without a reproduced, understood root cause.** This is the one workflow where gating is deliberate.

### C003
- key: Treat a pre-cause fix as a guess, and a guess that hides the symptom as the worst outcome because the defect survives unseen.
- class: rationale-example
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:8
- provenance: 51e8c42 2026-06-11, installed with the iron rule; no incident, memory record or kaizen note ties it to a case.
- verdict: retire
- landed: e4f8ade section 44
- reason: The why of the iron rule, held here: a fix proposed before the cause is a guess, and a guess that makes the symptom disappear is the most expensive outcome because the defect survives hidden. The rule is obeyable without it, so the document keeps the rule alone; re-run a baseline before shipping the cut since the wording shapes behavior. Retired at section 44's close: the sentence is gone and line 8 reads "The iron rule: **no fix without a reproduced, understood root cause.** This is the one workflow where gating is deliberate.", C002's two sentences; this reason carries the why.
- proposed: Move the sentence to this ledger as C003's why; the document keeps the iron rule alone.
- baseline-test: yes

### C004
- key: Obtain a reliable reproduction of the failure before doing anything else.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:12
- provenance: 51e8c42 2026-06-11, the skill's creation commit ("reproduce" as the first phase).
- verdict: keep
- reason: This is Phase 1's gate and the skill owns the debugging moment; the doctrine's temporary-repro bullet is the mechanic it invokes and C005 points at it in the next sentence, so neither document copies the other.
- passage: Reproduce the failure reliably before investigating

### C005
- key: Build the reproduction as a minimal temporary script or test that demonstrates the failure on demand, per the global temporary repro-script discipline.
- class: mechanic
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:12
- provenance: 51e8c42 2026-06-11, the skill's creation commit.
- verdict: keep
- reason: No finding. This sentence is the skill's pointer at the doctrine's "Make the test earn its green" bullet, which testing-discipline names as the governor of a temporary repro, and it is the pointer that lets Phase 4 drop its own copy of the delete step.
- passage: with a minimal temporary script or test per the doctrine's "Make the test earn its green" bullet.

### C006
- key: When the failure cannot be reproduced, gather evidence through logging, input narrowing, and environment comparison instead of fixing.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:12
- provenance: 51e8c42 2026-06-11, the skill's creation commit.
- verdict: rewrite
- landed: e4f8ade section 44
- reason: The cannot-reproduce carve-out is this skill's alone and stays; the change is that the next sentence's quoted offer ("I can't reproduce it but this change should help") folds into this one as the named antipattern, so the passage forbids the fix once rather than twice. Behavior-shaping wording, so baseline-test the merged sentence. Lands at line 12 (section 44's close) as "If the failure cannot be reproduced, the job is evidence-gathering (logging, narrowing inputs, environment comparison) rather than fixing, which is why 'I can't reproduce it but this change should help' is never a debugging outcome.", one sentence composed from this proposal's shape with C007's quoted offer kept verbatim inside it; C004's and C005's sentences before it are unchanged.
- proposed: (via A012) One sentence: the job is evidence-gathering rather than fixing, and "I can't reproduce it but this change should help" is the offer that sentence forbids.
- baseline-test: yes
- passage: If it will not reproduce, gather evidence by logging, narrowing inputs and comparing environments. "I can't reproduce it but this change should help" is never an outcome.

### C007
- key: Never offer "I can't reproduce it but this change should help" as a debugging outcome.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:12
- provenance: 51e8c42 2026-06-11, the skill's creation commit; no incident found behind the quoted form.
- verdict: rewrite
- landed: e4f8ade section 44
- reason: The same prohibition as C006's "not fixing", voiced as the sentence a session would type; it survives as the antipattern named inside C006's sentence rather than as a separate rule. Keep the quoted form when merging, since a named antipattern is what a reader recognizes in its own draft. Lands at line 12 (section 44's close) inside C006's sentence, the quoted offer verbatim in double quotes; C006's entry records the landed sentence.
- passage: Reproduce the failure reliably before investigating, with a minimal temporary script or test per the doctrine's "Make the test earn its green" bullet. If it will not reproduce, gather evidence by logging, narrowing inputs and comparing environments. "I can't reproduce it but this change should help" is never an outcome.

### C008
- key: Build the evidence before forming any opinion about the cause.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:16
- provenance: 51e8c42 2026-06-11, the skill's creation commit.
- verdict: keep
- reason: The Phase 2 lead and the document's earliest statement of evidence-before-opinion; the Phase 3 closing tag "Evidence first, code second" (C024) retires as its duplicate, which makes this the surviving in-skill statement.
- passage: Build the evidence before forming opinions:

### C009
- key: Read the actual error in full: the whole message, the whole stack, and the relevant log lines, not a summary.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:18
- provenance: 51e8c42 2026-06-11, the skill's creation commit; 830ff28 2026-06-17 genericized the ELEOS.ErrorLog reference in the same bullet.
- verdict: keep
- reason: The doctrine's red-is-a-signal bullet gates calling a red a flake; this gates the investigation's first read of the error, a different act. The bullet is re-cut so this instruction and the server-side check (C010) stand as two sentences.
- passage: **Read the actual error** whole.

### C010
- key: Check the project's server-side error log or audit table for the server-side view of the failure.
- class: mechanic
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:18
- provenance: 51e8c42 2026-06-11 installed it as "Check ELEOS.ErrorLog / usp_AuditError payloads"; 830ff28 2026-06-17 genericized the target, pattern kept.
- verdict: rewrite
- landed: e4f8ade section 44
- reason: No finding. The instruction stands on its own once C011's reason moves here; it names where the server-side view lives on a stack whose client exception and server error are recorded separately. Flipped to rewrite at section 44's close by C011's retire, which took the clause after its semicolon: the words are unchanged and the sentence closes on a period.
- proposed: Check the project's server-side error log or audit table for the server-side view.
- passage: Check the project's server-side error log or audit table for the server-side view.
- flag: environment

### C011
- key: Expect the C# exception and the SQL error to be different facts rather than one.
- class: rationale-example
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:18
- provenance: 51e8c42 2026-06-11, installed from the ELEOS stack's experience; no memory record or kaizen note pins it to a named incident.
- verdict: retire
- landed: e4f8ade section 44
- reason: The why of C010, held here: on a C#-over-SQL stack the exception the client sees and the error the server logged are often different facts, which is why the server-side log is read separately. C010 is obeyable without it; baseline-test the cut since it changes an investigation bullet. Retired at section 44's close: the clause after the semicolon is gone from line 18 and C010's sentence closes on a period, which C010's entry records.
- proposed: Ledger entry for C011 carries the why; the document keeps C010's instruction.
- baseline-test: yes

### C012
- key: Check what changed by reading git log and diff around the onset and the deployment history.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:19
- provenance: 51e8c42 2026-06-11, the skill's creation commit.
- verdict: retire
- reason: row 1213 (Check what changed recently), dropped under the mechanism cut.
- passage: **Check what changed**: git log and diff around the onset, and deployment history.
- ruled: cut 2026-09-30

### C013
- key: Assume most bugs are regressions from a recent, findable change.
- class: rationale-example
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:19
- provenance: 51e8c42 2026-06-11, the skill's creation commit; no incident found.
- verdict: retire
- landed: e4f8ade section 44
- reason: The prior that motivates C012, held here: most bugs are regressions from a recent, findable change, so the history check is cheap and usually decisive. The check is obeyable without the prior; baseline-test the cut. Retired at section 44's close: the sentence is gone from line 19, C012's sentence closing the bullet unchanged.
- proposed: Ledger entry for C013; the document keeps C012.
- baseline-test: yes

### C014
- key: Trace the data flow backward from the symptom to the first point where reality diverges from expectation.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:20
- provenance: 51e8c42 2026-06-11, the skill's creation commit.
- verdict: keep
- reason: No finding. The backward trace is the investigation's method for locating the divergence point and nothing else in the corpus states it.
- passage: **Trace the data flow backward**, dispatching the Explore subagent for unfamiliar territory rather than guessing.

### C015
- key: Dispatch the Explore subagent for unfamiliar territory rather than guessing at the structure.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:20
- provenance: 51e8c42 2026-06-11, the skill's creation commit.
- verdict: keep
- reason: No finding. The doctrine's standing dispatch request covers the Explore dispatch; this names the moment in the investigation where structure is unknown and guessing is the failure mode.
- passage: **Trace the data flow backward**, dispatching the Explore subagent for unfamiliar territory rather than guessing.

### C016
- key: Check for deployment drift by comparing the deployed object against source via `sys.sql_modules` and the file.
- class: mechanic
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:22
- provenance: 51e8c42 2026-06-11, whose message names deployment drift as one of this stack's recurring root causes.
- verdict: keep
- reason: No finding. Shell-then-ALTER deployment (the sql-style house convention) is what makes a missed deployment silent, and the commit installing it names drift as a recurring cause; nothing mechanical detects a stale proc.
- passage: Deployment drift: does the deployed object match source? (shell-then-ALTER means a missed deployment leaves a stale proc silently in place - compare `sys.sql_modules` against the file).
- flag: environment

### C017
- key: Check whether a trigger or nested call runs as the caller instead of the impersonated user, inspecting `WITH EXECUTE AS` boundaries.
- class: mechanic
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:23
- provenance: 51e8c42 2026-06-11, whose message names EXECUTE AS context as one of this stack's recurring root causes.
- verdict: keep
- reason: No finding. Named at install as a recurring, invisible cause on a stack where application principals are EXECUTE-only and procs impersonate; no machinery surfaces it.
- passage: Security context: is a trigger or nested call running as the caller instead of the impersonated user? `WITH EXECUTE AS` boundaries are a classic invisible cause.
- flag: environment

### C018
- key: Query the actual data rather than assuming its shape.
- class: mechanic
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:24
- provenance: 51e8c42 2026-06-11, whose message names data shape as one of this stack's recurring root causes.
- verdict: keep
- reason: No finding. The doctrine's Root-cause bullet says to interrogate the actual data at the principle level; this is the owner's checklist item with the shapes that recur (NULLs, duplicates, empty string versus NULL).
- passage: Actual data: query it for the shape nobody believed existed, such as NULLs, duplicates, or empty strings vs NULL.

### C019
- key: Confirm the procedure's declared isolation level matches its use.
- class: mechanic
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:25
- provenance: 51e8c42 2026-06-11, the skill's creation commit.
- verdict: keep
- reason: No finding. A READ UNCOMMITTED proc returning mid-transaction state is a cause no other document names and no tool flags.
- passage: Isolation level: READ UNCOMMITTED procs can return mid-transaction state; confirm the proc's declared level matches its use.
- flag: environment

### C020
- key: State one hypothesis at a time explicitly, in the form "X causes Y because Z."
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:29
- provenance: 51e8c42 2026-06-11, the skill's creation commit ("hypothesize one change at a time").
- verdict: keep
- reason: The Phase 3 method; the paragraph around it is re-cut only to drop C023's cost clause and C024's closing tag, and this sentence stands verbatim.
- passage: State one hypothesis at a time: "X causes Y because Z." Test it with the smallest check that can falsify it, such as a query, a log line or a one-variable change. Never bundle changes.

### C021
- key: Test each hypothesis with the smallest test that can falsify it, such as a query, a log line, or a one-variable change.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:29
- provenance: 51e8c42 2026-06-11, the skill's creation commit.
- verdict: keep
- reason: Stands verbatim inside the re-cut Phase 3 paragraph; the falsifying test is what makes a hypothesis a hypothesis rather than a guess.
- passage: Test it with the smallest check that can falsify it, such as a query, a log line or a one-variable change.

### C022
- key: Never bundle changes while testing a hypothesis.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:29
- provenance: 51e8c42 2026-06-11, the skill's creation commit ("one change at a time").
- verdict: rewrite
- landed: e4f8ade section 44
- reason: Stands verbatim; the cost clause that follows it (C023) moves here and the prohibition is whole without it. Flipped to rewrite at section 44's close by C023's retire, which took the clause after its semicolon: the words are unchanged and the sentence closes on a period, the last of the paragraph once C024's tag left.
- proposed: Never bundle changes.
- passage: Never bundle changes.

### C023
- key: Treat a symptom that moves after two simultaneous changes as having taught you nothing.
- class: rationale-example
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:29
- provenance: 51e8c42 2026-06-11, the skill's creation commit; no incident found.
- verdict: retire
- landed: e4f8ade section 44
- reason: The why of C022, held here: if two things changed and the symptom moved, the result attributes to neither, so the test taught nothing. "Never bundle changes" is obeyable without it; baseline-test the cut. Retired at section 44's close: the clause after the semicolon is gone from line 29 and C022's sentence reads "Never bundle changes.", which C022's entry records.
- proposed: Ledger entry for C023.
- baseline-test: yes

### C024
- key: Gather evidence first and write code second.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:29
- provenance: 51e8c42 2026-06-11, the skill's creation commit; no incident found behind the repetition.
- verdict: retire
- landed: e4f8ade section 44
- reason: A within-document duplicate: the iron rule (C002) and the Phase 2 lead (C008) already order evidence before code inside this skill, and the doctrine's Root-cause bullet carries the principle. Safe to drop because both survivors are in the same document a session reads; baseline-test since it is a closing tag a reader may anchor on. Retired at section 44's close: 'Evidence first, code second.' is gone from line 29, which now closes on C022's sentence.
- proposed: (via A026) Delete "Evidence first, code second." from line 29.
- baseline-test: yes

### C025
- key: Fix the root cause, not the symptom.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:33
- provenance: 51e8c42 2026-06-11, the skill's creation commit ("fix the cause not the symptom").
- verdict: keep
- reason: A different moment from the iron rule: C002 gates when a fix may be proposed and this says what the fix must target, and a session can satisfy the first while violating the second. Stands verbatim while the sentence after it is re-cut.
- passage: Fix the cause, not the symptom, and verify the repro now passes.

### C026
- key: After the fix, verify the reproduction now passes.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:33
- provenance: 51e8c42 2026-06-11, the skill's creation commit.
- verdict: keep
- reason: Phase 4's exit condition; the doctrine's watch-it-pass step is the same act, but a phase workflow that names no exit is not followable, so this is the one repro step the skill keeps beside its C005 pointer.
- passage: Fix the cause, not the symptom, and verify the repro now passes.

### C027
- key: After the fix, run the surrounding tests to confirm nothing else moved.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:33
- provenance: 51e8c42 2026-06-11 wrote "surrounding tests"; the targeted lane was defined later, at 27ac5d7 2026-08-27 (testing-discipline skill) and efcfa16 2026-08-27 / a321af3 2026-08-30 (the doctrine's lane bullet).
- verdict: rewrite
- landed: e4f8ade section 44
- reason: A real conflict: "surrounding tests" is looser than the targeted lane (the changed files' tests plus any whole-tree pin whose subject those files are), so a session obeying this line can skip a family pin the doctrine requires at a fix round. The doctrine owns which lane each moment takes, so this line names the targeted lane and points at that bullet; baseline-test the reworded step. Lands at line 33 (section 44's close) as "run the targeted lane the doctrine's After-each-step bullet names for a fix round", the proposal's words; the bullet it points at opens 'After each step, run the lane the moment calls for, and report the delta.' at line 100 of `plugins/grimoire/skills/operating-instructions/SKILL.md` (line 95 of the frontmatter-free doctrine copies), and C026's and C029's sentences beside it are unchanged.
- proposed: Replace "run the surrounding tests to confirm nothing else moved" with "run the targeted lane the doctrine's After-each-step bullet names for a fix round".
- baseline-test: yes
- passage: The doctrine's After-each-step and Close-each-section bullets own the lane, the kit memory store write and the Chapter that follow.
- flag: stale

### C028
- key: Delete the repro script after the fix.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:33
- provenance: 51e8c42 2026-06-11, the skill's creation commit.
- verdict: retire
- landed: e4f8ade section 44
- reason: A copy of the doctrine's "Make the test earn its green" step and carve-out (delete it unless told to keep it), which testing-discipline names as the governor of a temporary repro and which C005 already points at; the doctrine is always loaded, so a Phase 4 session still meets the step. Baseline-test the cut. Retired at section 44's close: the clause is gone from line 33, whose Then: list is three items with C026's and C029's words unchanged; the doctrine's Make-the-test bullet (line 114 of `plugins/grimoire/skills/operating-instructions/SKILL.md`, 109 of the frontmatter-free copies) carries the step.
- proposed: (via A032) Drop the "delete the repro script (unless told to keep it)" clause from line 33.
- baseline-test: yes

### C029
- key: Bank any durable learning to the kit memory store, recording the gotcha rather than the incident.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:33
- provenance: 51e8c42 2026-06-11 installed it pointing at "auto memory"; eb7d29d 2026-08-09, from a kaizen inbox note on harness-injection claims, re-pointed it at the kit memory store, which the kit is independent of auto-memory by design.
- verdict: retire
- reason: row 1217 (Fix cause, verify, bank learning), merged. The doctrine's "Close each section with a Chapter" bullet carries "Durable codebase learnings go to memory, not the Chapter". Its Kaizen Capture bullet carries "State any lesson, wherever it lands, one level more general than its incident". C027's pointer sentence keeps the words "kit memory store", which eb7d29d fixed as the destination.
- passage: Bank any durable learning to the kit memory store as the gotcha, not the incident.

### C030
- key: Record the finding in the plan doc's Chapter.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:33
- provenance: 51e8c42 2026-06-11, the skill's creation commit.
- verdict: retire
- reason: row 1217 (Fix cause, verify, bank learning), merged. The doctrine's "Close each section with a Chapter" bullet owns the Chapter, and executing-work owns its format. C027's pointer sentence points there.
- passage: In a planned effort, record the finding in the plan doc's Chapter.

### C031
- key: Stop after two failed fixes, because the mental model is wrong.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:37
- provenance: 51e8c42 2026-06-11 installed the escalation rule; 1d9c467 2026-08-15 (consult plan, Section 5) placed the consult before the stop after Scenario B's RED showed the old text read as conditional.
- verdict: keep
- reason: An operator-decision gate that fires once per stuck problem, not per loop: it is one of executing-work's four blockers, and 1d9c467 kept it deliberately when adding the consult ("The stop still happens"). The bold sentence stays verbatim; its restatement (C032) retires.
- passage: **Two failed fixes mean the mental model is wrong - stop.**

### C032
- key: Do not attempt a third fix from the same understanding.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:37
- provenance: 51e8c42 2026-06-11, installed beside the stop; the consult plan's Scenario B (docs/archive/claude-kit_consult_spec_v1.md) shows the duplicate did not by itself prevent a third attempt.
- verdict: retire
- landed: e4f8ade section 44
- reason: The bold stop bars the third attempt on its own, and C033 and C034 carry "from the same understanding" by saying what replaces it. The paragraph was baseline-tested at 1d9c467, so re-run Scenario B after the cut rather than assuming the GREEN survives. Retired at section 44's close: the sentence is gone whole from line 37 and 'Instead:' follows C031's bold stop directly; the Scenario B re-run this reason orders is carried on the plan's Chapter 44 as a decision-batch item, the section's RED and GREEN reading being the probe after leg the rewrite plan sets.

### C033
- key: Instead list every assumption in play and verify each against evidence.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:37
- provenance: 51e8c42 2026-06-11, the skill's creation commit.
- verdict: keep
- reason: What a session does instead of the third attempt; stands verbatim inside the re-cut escalation paragraph.
- passage: List every assumption in play and verify each against evidence.

### C034
- key: Widen the frame to consider the design, the spec, the deployment, or the data as the defect's home rather than the suspected code.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:37
- provenance: 51e8c42 2026-06-11, the skill's creation commit.
- verdict: keep
- reason: Stands verbatim. Note for a session editing this paragraph: Scenario B's RED arm read "widen the frame" as licence for a third unassisted investigation, and the consult sentence that follows (C035) is what closed that reading, so the two sentences are edited together.
- passage: Widen the frame to the design, the spec, the deployment and the data, not just the suspect code.

### C035
- key: Convene a consult on the dead end before you stop and report.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:37
- provenance: 1d9c467 2026-08-15, consult plan Section 5 (docs/archive/claude-kit_consult_spec_v1.md), baseline-tested RED/GREEN on Scenario B and re-run 2 for 2.
- verdict: rewrite
- landed: e4f8ade section 44
- reason: The consult skill owns the trigger (its trigger (c) is this dead end) and this sentence is the in-workflow pointer at it; the baseline test shows this document's sentence is what moved behavior, since the RED arm ran with the old text and did not convene. Flipped to rewrite at section 44's close by C036's retire, which took the clause after its colon: the words are unchanged and the sentence closes on a period, still following C034's sentence directly.
- proposed: Convene a consult on the dead end before you stop and report.
- passage: Convene a consult on the dead end before you stop and report.

### C036
- key: Use a fresh-context ruling because it never formed the mental model that just failed twice and can test the frame you can only extend.
- class: rationale-example
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:37
- provenance: 1d9c467 2026-08-15, consult plan Section 5.
- verdict: retire
- landed: e4f8ade section 44
- reason: The why of C035, held here: a fresh-context judge never formed the mental model that failed twice, so it can test the frame where the stuck session can only extend it. C035 is obeyable without it; the sentence was tested whole, so re-run Scenario B after the cut. Retired at section 44's close: the clause is gone from line 37, C035's sentence closing on a period and C037's pointer opening its own sentence, and C038's 'the ruling' respelled 'the consult's ruling' at the close pass, which their entries record; the Scenario B re-run is carried as C032's entry says.
- proposed: Drop the "a fresh-context ruling never formed the mental model that just failed twice, so it can test the frame you can only extend" clause; the ledger carries it.
- baseline-test: yes

### C037
- key: Read the consult skill at `consult/SKILL.md` for the consult's triggers and mechanics.
- class: pointer
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:37
- provenance: 1d9c467 2026-08-15; its review round replaced a repo-tree path that does not exist on an installed machine with the plugin-relative one.
- verdict: rewrite
- landed: e4f8ade section 44
- reason: The pointer at the owner the ownership map names for consult triggers and mechanics; a compression that drops it would leave this skill carrying a copy of a rule it does not own. Flipped to rewrite at section 44's close by C036's retire, which left this clause to open its own sentence: the words are unchanged and its first letter is capitalised.
- proposed: The consult skill (`consult/SKILL.md`) owns the triggers and the mechanics.
- passage: The consult skill (`consult/SKILL.md`) owns the triggers and mechanics.

### C038
- key: Still stop and still send the report after the consult, carrying the consult's ruling in it.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:37
- provenance: 1d9c467 2026-08-15, consult plan Section 5 ("the report that still goes out carries the ruling"); the review round also gave "the report" its antecedent.
- verdict: rewrite
- landed: e4f8ade section 44
- reason: Written to keep the consult from being read as replacing the stop: the dead end stays a blocker in executing-work's set, and the ruling rides in the report so the operator decides with it rather than before it. Flipped to rewrite at section 44's close by C036's retire, which took 'a fresh-context ruling' from the paragraph and left 'the ruling' with no stated antecedent: respelled 'the consult's ruling', this entry's own key, after round 1's adversarial lens read the bare phrase; every other word unchanged.
- proposed: The stop still happens and the report still goes out, carrying the consult's ruling: if the root cause implicates a design decision, surface it to me with the evidence and the ruling attached rather than quietly patching around it.
- passage: The stop and the report still happen, carrying the consult's ruling.

### C039
- key: Surface a root cause that implicates a design decision to the operator with the evidence and the ruling attached, rather than quietly patching around it.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:37
- provenance: 51e8c42 2026-06-11 ("surface it to Scott with the evidence"); a8770b3 2026-06-28 re-voiced it to "me"; 1d9c467 2026-08-15 added "and the ruling attached".
- verdict: keep
- reason: An operator-decision gate: a design decision is the material-decision blocker executing-work names, and the blocked-escalation plan records that class as a gap in standing no relayed answer resolves. The act it forbids, patching around a design defect silently, is the one a green fix would hide.
- passage: A root cause implicating a design decision comes to me with the evidence and the ruling, never patched around quietly.

### C040
- key: Fix a directly visible cause with a trivial fix under the global rules without this skill's ceremony.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:41
- provenance: 51e8c42 2026-06-11, the skill's creation commit.
- verdict: retire
- reason: row 1220 (Trivial-fix exemption and re-entry), shrunk. The frontmatter description's "Skip only for trivial fixes where the cause is directly visible." still carries the act.
- passage: A directly visible cause with a trivial fix, such as a typo, skips the phases and is fixed under the doctrine's rules.

### C041
- key: Treat a failed first fix as the signal that you are now debugging and must use this skill.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:41
- provenance: 51e8c42 2026-06-11, the skill's creation commit.
- verdict: keep
- reason: The bound on C040's carve-out, read by a session already inside the skill; the frontmatter's failed-fix trigger serves the harness's selection and is not re-read mid-work, so the body line is not a duplicate of it. The doctrine's craft bullet on re-diagnosing a new symptom instructs a different next act.
- passage: A failed first fix means you are now debugging, so use this skill.

### A003
- key: Before reproducing a failure, sort it into code, environment, tool, external service or unknown, and never change working code to route around an environment problem.
- class: rule
- source: plugins/grimoire/skills/systematic-debugging/SKILL.md:12
- provenance: docs/plans/claude-kit_corpus-compression_spec_v1.md section 9, 2026-09-26, the classify-first step the operator approved from the Supreme review, declared growth of about forty words.
- verdict: keep
- reason: A failure read as code by default gets a code fix, and an environment, tool or external-service failure fixed in code leaves working code bent around a problem that is not in it. The sort comes before reproduction because the bin decides whether a repro in this tree can show the cause at all. The four implementer charters point their BLOCKED status here (A004 to A007 under the executing-work ledger), so this step is the one owner of the sort.
- passage: Before reproducing, decide whether the failure lives in the code or outside it. Never change working code to route around an environment problem.
