# Rationale ledger: testing-discipline

This file is the rationale ledger for the documents the `testing-discipline` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/testing-discipline/SKILL.md

This document is the kit-wide authority on a test suite's two costs, the authoring decision that sets what the suite can see and the gate decision that sets what it costs to consult. It owns these moments: deciding whether a change earns a test and what shape that test takes; deciding whether a test already in the tree still earns its keep or retires; pinning a hazard that a shared setup hides; pricing a test's runtime shape at authoring; choosing which lane runs at a fix round, a section close, a push, a merge, finishing, and a handoff; discriminating a red from a flake; and recording, pinning, and comparing wall-clock and contention figures, including the pre-suite check of the box. It states no runnable commands, since a repo's lane invocations are per-repo facts held in that project's memory tier. Load class: named-trigger, per its own frontmatter description, which lists the acts and events that call it (writing a test, auditing a suite, choosing a lane after a fix, reading a red or a wall-clock figure).

Extracted at `6bc07fb`: whole document (`skills.testing-discipline.SKILL.md`). Amended on 2026-09-20 by `docs/plans/claude-kit_test-requirement-axis_spec_v1.md` section 1 (`W` entries below). Amended on 2026-09-22 by `docs/plans/claude-kit_heavy-process-claim-retirement_spec_v1.md` section 1 (`X` entry below). Redrafted on 2026-09-26 by section 8 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, landed at `5cce82fa` with its fix round at `6f26f01a`, so every live entry's `passage:` line quotes the text at `6f26f01a` and the `flag:` lines record that pass's flags. Amended on 2026-09-26 by section 12 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, which relocated the doctrine's hook-merge rebuild sentence here (`A` entry below). Amended on 2026-10-06 by section 1 of `docs/archive/claude-kit_fewer-full-runs_spec_v1.md`, which states one whole gate per plan and the operator's merge ruling of 2026-10-01: C040 retired, C041 and C044 rewritten to their passages as they now read, and the reasons of C042, C049 and A001 amended. Amended on 2026-10-06 by section 2 of `docs/archive/claude-kit_base-head-baseline_spec_v1.md`, which names the integration branch's head as the whole gate's baseline (`B` entry below): C041, C059 and C062 rewritten to their passages as they now read, C041 and B001 amended again by section 3's fix round and the finishing pass.

### C001
- key: Read a repo's actual lane and suite commands from that project's memory tier wherever this skill names a lane.
- class: pointer
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:8
- provenance: 27ac5d7 2026-08-27, the testing-discipline plan's Approach bullet "the skill is kit-wide; per-repo facts stay in memory", written so the skill states discipline and never a command.
- verdict: keep
- reason: The skill is loaded across repos, so any command it carried would be wrong somewhere; the lane commands live in the project tier where `test-suite-invocation` already did. Line 68's duplicate read clause retires (C053); this sentence is the one statement.
- passage: Lane commands are per-repo facts, so look each one up in that project's memory tier.

### C002
- key: Treat nothing written in this skill as a command to run.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:8
- provenance: 27ac5d7 2026-08-27, same install as C001.
- verdict: rewrite
- landed: 627ad10 section 32
- reason: The rule stays; the "two costs" framing before it is rationale (the skill's authoring and gate decisions are the two costs a suite pays) and the "This skill owns both, kit-wide" claim is the ownership map's row. Neither is obeyed, so dropping them changes no behavior. Lands at line 8 (section 32's close): "A specific repo's exact suite invocation and its lane commands are per-repo facts that live in that project's memory tier, so wherever this skill names a lane, look the command up there; nothing in this file is a command to run." The two-costs framing and the ownership sentence are gone.
- proposed: Line 8 keeps "nothing in this file is a command to run" and the memory-tier pointer; the two-costs framing moves to this ledger and the ownership sentence is dropped as the map's.
- passage: Nothing in this file is a command to run.

### C003
- key: Write a test for an implementer's acceptance criterion, the behavior the section was dispatched to produce.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:14
- provenance: 27ac5d7 2026-08-27, the litmus for what earns a test, drawn from the 2026-08-26 census of defects caught by tests versus reviews.
- verdict: keep
- reason: no finding.
- passage: **An implementer's acceptance criterion**: the behavior the section was dispatched to produce.
- flag: weak-reason

### C004
- key: Write a test for a path no human drives by hand, such as a hook or a CLI that only machines exercise.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:15
- provenance: 27ac5d7 2026-08-27, the litmus.
- verdict: keep
- reason: no finding.
- passage: **A path no human drives by hand**: a hook, a CLI, anything only machines exercise.
- flag: weak-reason

### C005
- key: Write a cross-surface pin wherever a writer and a reader share a value such as a wire field, a filter constant, or a column list.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:16
- provenance: 27ac5d7 2026-08-27, restating the doctrine's pre-existing cross-component pin at the owner's point of action; the plan's Chapter 1 records the text as doctrine-verbatim.
- verdict: keep
- reason: This skill owns what earns a test; the doctrine's copy is the pointer surface per the ownership map. A session changing the pin rule changes it here and points from the doctrine.
- passage: **A cross-surface pin**: a writer and a reader share a value, such as a wire field, and each side tested only against its own literal hides a mismatch.

### C006
- key: Write a regression test pinning the fixed cause of a defect that actually happened, on a stable form and never on the sentence the fix wrote.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:17
- provenance: 27ac5d7 2026-08-27, the litmus; the census counted eleven regression saves.
- verdict: retire
- superseded-by: W004
- reason: no finding. Superseded on 2026-09-20 by W004 (the pin now sits on a stable form and a defect commit no longer exempts a wording pin; the verdict before it was keep).

### C007
- key: Write a test for any contract whose break no gate short of a test reliably catches, even when no listed item names it.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:19
- provenance: 27ac5d7 2026-08-27, the class closer added at the review round ("the litmus class did not cleanly contain its own first instance", a Minor).
- verdict: keep
- reason: no finding.
- passage: The list is instances of one class: a contract whose break no gate short of a test reliably catches. A candidate that pins such a contract earns its test even where no item names it.
- flag: weak-reason

### C008
- key: Prefer one whole-tree pin that visits every member of a family over a test per function.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:21
- provenance: 27ac5d7 2026-08-27, from the census finding that whole-tree pins were the shapes that caught defects while function mirrors dominated the intentional-change breakages.
- verdict: keep
- reason: The five named shapes are the census's saves and the class closer is what reaches a new shape; a session cutting the list cuts the evidence. C019's focused test composes with it through C020's "what an earlier test cannot see".
- passage: **Prefer one whole-tree pin to a test per function.** The shape that catches real defects is an invariant pinned across the whole tree: a roster or reflection pin over a family, a derived pin that scans a source file, a cross-surface count assertion, a region-extraction test over real code, a fixture self-check. Any assertion that visits every member of a family and fails when one drifts is in that class.

### C009
- key: When a family gains a member, extend the family's pin or write the family's first pin instead of giving the member private function mirrors.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:21
- provenance: 27ac5d7 2026-08-27, same install; the RED probe for this rule half-reproduced (the unguided agent added a roster control and eleven mirrors anyway).
- verdict: keep
- reason: It is C008 at the moment it bites, with the act named; the probe shows the moment is exactly where a writer falls back to mirrors.
- passage: When a family gains a member, extend the family's pin, or write its first, rather than giving the member private function mirrors.

### C010
- key: Retire a test in the tree that falls in a retirement class, and do not write a candidate that falls in one.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:25
- provenance: 70b1f73 2026-09-04, the subtraction-bars plan's Section 1: the kit had rules for adding tests and none for removing them (96,900 test lines against 50,300 product).
- verdict: keep
- reason: Opener of the retire list; the bound (C011) and the class closer (C018) are its other two parts, not copies. The retire-class agreement pin reads the class heads out of this file, so a rename of any head has to carry every carrier.
- passage: A test in the tree retires when it falls in one of these classes, and a candidate that falls in one is not written.

### C011
- key: Repair rather than delete where the contract still needs cover: re-pin a wording pin on a stable form, repoint a moved contract's test at its new home.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:25
- provenance: 70b1f73 2026-09-04, added when the rule as drafted would have retired four or more guards whose comments record the drift they exist to catch.
- verdict: keep
- reason: Without it the retire rule deletes tests whose contract still needs cover; it also covers the wording-pin repair that no class bullet names.
- passage: Where the contract still needs cover, the repair replaces the deletion: a wording pin is re-pinned on a stable form, and a moved contract's test is repointed at its new home.

### C012
- key: Retire an implementation mirror, a test that restates a function's body.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:27
- provenance: 70b1f73 2026-09-04, folded from the skill's former "What never earns one" paragraph (27ac5d7).
- verdict: keep
- reason: no finding.
- passage: **An implementation mirror**: a test restating a function's body, which breaks on every intentional edit and sleeps through defects.

### C013
- key: Retire a hardcoded count pin that another assertion in the same suite already covers.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:28
- provenance: 70b1f73 2026-09-04, with the two exceptions added when the class as drafted retired a live length assertion that guards a set comparison against two empty sets; d2e2f37 2026-09-05 clarified "another leg" as another assertion in the same suite.
- verdict: keep
- reason: The exceptions are what keep the class from retiring instrument controls; C015's duplicate class does not carry them.
- passage: **A count pin a sibling leg already covers**: a hardcoded count that another assertion in the same suite already checks. A count each side derives independently stays, and so does one that is the only detector of a symmetric removal.

### C014
- key: Retire an exact-wording pin on stderr, stdout, or curated prose, pinning the exit code, a stable token, or a machine-read field instead.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:29
- provenance: 70b1f73 2026-09-04; the byte-identity carve-out was the plan's load-bearing correction, since the tree held at least six pinned copy sets no registry names and the rule as written would have retired their guards.
- verdict: keep
- reason: no finding.
- passage: **An exact-wording pin on prose no identity contract covers**: an assert on stderr, stdout or a curated sentence where an exit code, a stable token or a machine-read field would leave the wording free. A text two or more surfaces carry by design keeps its byte-identity pin.
- flag: weak-reason

### C015
- key: Retire a duplicate test whose failure implies another's and which catches nothing the other misses.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:30
- provenance: 70b1f73 2026-09-04; the direction of implication was corrected from the plan's own draft, which had named the more sensitive test as the duplicate.
- verdict: keep
- reason: The count-pin class (C013) is its instance with exceptions, and the control-leg exemption (C017) is its stated carve-out; neither conflicts with it.
- passage: **A duplicate**: a test whose failure implies another's and which catches nothing the other misses.

### C016
- key: Retire an orphan test whose contract no longer exists, and repoint one whose contract merely moved.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:31
- provenance: 70b1f73 2026-09-04.
- verdict: keep
- reason: The class carries its own repair so a reader of the list sees it; C011 is the general rule.
- passage: **An orphan**: a test whose contract no longer exists; one whose contract merely moved earns a repointed test.

### C017
- key: Keep a leg whose job is to prove the comparison beside it had something to compare, whatever its shape.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:33
- provenance: 70b1f73 2026-09-04, added because the classes as drafted retired the withheld controls the doctrine's silent-check bullet mandates, two of them live in the kit's own suite; d2e2f37 respelled "neighbour".
- verdict: keep
- reason: A stated exemption, not a conflict with C015 or C018: a control's defect (an empty comparison) is caught nowhere else. It is written on what the leg is for rather than its shape so a new control shape is covered.
- passage: A control leg is none of these, per the doctrine's withheld-control bullet ("A silent check earns its silence with a withheld control").

### C018
- key: Retire, and never write, any test whose maintenance cost is not paid for, even when no listed class names it.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:35
- provenance: 70b1f73 2026-09-04; the closer's first three reasons reached only the moving-assert half and the holds-on-a-break case was added ("A fold that narrows the rule is not a fold").
- verdict: keep
- reason: All four conditions are load-bearing and the missing fourth was a recorded defect; compressing the closer is where that defect recurs.
- passage: The six are instances of one class: a test whose maintenance cost is not paid for. Its red indicates no defect, or it stays green while the behavior it pins breaks, or the defect it would catch is caught elsewhere, or its contract is gone. A candidate in that class is not written and a test in it retires, even where no item names it.

### C019
- key: Write one focused test per stated behavior, sized like its neighbors.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:37
- provenance: 70b1f73 2026-09-04, the shape bar specified in the subtraction-bars plan's Section 1; d2e2f37 2026-09-05 reworded the paragraph at the finishing fix round.
- verdict: retire
- reason: row 1232 (Shape bar), dropped under the mechanism cut.
- passage: **The shape bar:** one focused test per stated behavior, sized like its neighbors
- flag: weak-reason
- ruled: cut 2026-09-30

### C020
- key: Add a further test beside an existing one only where its subject is something the earlier test cannot see.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:37
- provenance: 70b1f73 2026-09-04, as C019; the instances clause names the controls the doctrine mandates so they are not read as surplus.
- verdict: retire
- reason: row 1232 (Shape bar), dropped under the mechanism cut.
- passage: with a further test beside it only where its subject is what an earlier test cannot see.
- ruled: cut 2026-09-30

### C021
- key: Where a section adds tests and retires none, state the reason in that section's Chapter.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:37
- provenance: 70b1f73 2026-09-04, the section duty from the subtraction-bars plan, with the Chapter's contents left to executing-work.
- verdict: retire
- superseded-by: W006
- reason: The duty is the plan's mechanism for a suite that only grows; the carrier (the Chapter's Delta line) is executing-work's. Superseded on 2026-09-20 by W006 (the sentence moved from the shape bar into the lifecycle paragraph, which states the same duty; the verdict before it was keep).

### C022
- key: For a temporary repro, follow the doctrine's "Make the test earn its green" bullet.
- class: pointer
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:37
- provenance: 70b1f73 2026-09-04 ("with the doctrine's own bullet left to govern a scratch check"); d2e2f37 renamed the scratch check a temporary repro.
- verdict: retire
- reason: row 1232 (Shape bar), dropped under the mechanism cut.
- passage: The doctrine's "Make the test earn its green" bullet governs a temporary repro.
- ruled: cut 2026-09-30

### C023
- key: Pin a hazard that an area's shared setup avoids with one test that does not share that setup.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:41
- provenance: 27ac5d7 2026-08-27, from the memq network blind spot (the memory-anchors plan's Section 7 Critical: every pinned test routed around the cwd walk, so the suite went green over a hang every unpinned session hit); Chapter 1 records the rule shipped on point-of-action rationale, its RED probe not reproducing.
- verdict: rewrite
- landed: 627ad10 section 32
- reason: The paragraph states the act twice (opening and closing "So" sentence); merge them into one statement carrying the diagnostic question and the act. The incident class recurs wherever a fixture avoids a hazard uniformly, so the rule itself stays. Lands at line 41 as one statement: "So when an area's setup is uniform, ask what the uniformity avoids, and pin that hazard with one test that does not share the setup." The two proposed lines read as complementary, the untagged line naming A019's merge as its own form, so the tie-break did not fire.
- proposed: The paragraph is the merged rule of A019 with the memq example retired to this ledger (A022).
- proposed: (via A019) Merge C023 and C024 into one statement that carries the question ("ask what the uniformity avoids") and the act (one test without the setup).
- baseline-test: yes
- passage: So when an area's setup is uniform, ask what the uniformity avoids, and pin that hazard with one test that does not share the setup.

### C024
- key: When an area's setup is uniform, ask what the uniformity avoids and give the area one test without it.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:41
- provenance: 27ac5d7 2026-08-27, as C023.
- verdict: retire
- landed: 627ad10 section 32
- reason: Merged into C023; its one addition, "ask what the uniformity avoids", rides into the merged sentence. Retired at line 41: the separate act sentence is gone, its act riding in C023's merged statement.

### C025
- key: Treat the kit's memq network tests, which pin KIT_MEMORY_PROJECT and so route around the cwd walk, plus their unpinned control, as the worked instance of the blind-spot rule.
- class: rationale-example
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:41
- provenance: 27ac5d7 2026-08-27; the incident is the memory-anchors plan's Section 7 Critical and the memq-network-cwd-resolver plan's control.
- verdict: retire
- landed: 627ad10 section 32
- reason: The rule stands without it, and the example's "the one test that can see it" is already stale: the cwd-resolver plan found four unpinned network cases at its base ref and added seven more, so `test/memq.test.js` now holds many. The worked instance lives here and in that archived plan: pinned memq tests return the pinned segment before the cwd walk, so only an unpinned case can see a hang in the walk. Retired at line 41: the memq worked-example sentence is gone, and `test/memq.test.js` and `KIT_MEMORY_PROJECT` left the file with it.
- proposed: Delete the worked-example sentence; the blind-spot rule stands on the merged statement of A019.
- baseline-test: yes

### C026
- key: Set the suite's wall clock and parallelism when each test is written, not when someone finally profiles the suite.
- class: rationale-example
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:45
- provenance: efcfa16 2026-08-27, when the doctrine's authoring bullet shrank to this principle plus a pointer and the skill restated it as a sanctioned point-of-action copy (plan Chapter 2).
- verdict: retire
- landed: 627ad10 section 32
- reason: The doctrine keeps the principle always-loaded ("A suite's wall clock and its parallelism are set one test at a time, at authoring") and the four pricing bullets are obeyable without the restatement. Its why: a dependent test hides its dependence until the runner goes parallel, and a profiling pass finds the cost after every test has been shaped. Retired at line 45, which now opens "Each expensive shape has a cheaper form that sees the same defects:".
- proposed: Delete the framing sentence; the section opens on "Each expensive shape has a cheaper form that sees the same defects".
- baseline-test: yes

### C027
- key: Replace a spawn per assertion with a spawn per batch: run the process once and assert many times against its output.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:47
- provenance: 27ac5d7 2026-08-27, from the census's 239 spawn-class call sites across 32 test files.
- verdict: keep
- reason: no finding.
- passage: Any cost paid per test that could be paid once per process is paid once, as a spawn per assertion becomes a spawn per batch.
- flag: weak-reason

### C028
- key: Build a fixture once per process and give each test its own copy to mutate, rather than building it per test.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:48
- provenance: 27ac5d7 2026-08-27, the cost shapes.
- verdict: retire
- reason: row 1235 shrink. The fixture shape is one instance of the per-process class, and C033's landed sentence "Any cost paid per test that could be paid once per process is paid once" carries the act.
- passage: **A fixture built per test** becomes one built once per process and copied, so each test mutates its own copy.

### C029
- key: Give each test an owned temp dir instead of a fixed port or shared mutable state.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:49
- provenance: 27ac5d7 2026-08-27; the doctrine's authoring bullet keeps the same sentence by the plan's requirement and routes the shapes here (parity-pinned route).
- verdict: keep
- reason: The owner's statement of the shape; the doctrine's copy is the principle-keeping restatement the plan adjudicated. Deleting it strands C030.
- passage: Any shared resource that could be owned is owned, as a fixed port becomes an owned temp dir.

### C030
- key: Configure the test runner parallel from day one so a dependent test fails at birth rather than at a retrofit.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:49
- provenance: 27ac5d7 2026-08-27; Standing Brief Amendment 2 of the same plan required every test to run green under the parallel runner.
- verdict: keep
- reason: no finding.
- passage: Configure the runner parallel from day one, so a dependent test fails at birth rather than at the retrofit.
- flag: weak-reason

### C031
- key: Use a real process spawn only where a shell, CLI, or cross-process boundary is the subject, and test everything else in-process.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:50
- provenance: 27ac5d7 2026-08-27, the cost shapes.
- verdict: keep
- reason: no finding.
- passage: A real spawn belongs only where a shell, a CLI or a cross-process boundary is the subject.
- flag: weak-reason

### C032
- key: Price a real process spawn at roughly half a second to a second when judging a test's shape.
- class: mechanic
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:50
- provenance: 27ac5d7 2026-08-27, restored at the review round ("the per-spawn cost magnitude, which is the argument for batching, had been dropped", a Minor).
- verdict: retire
- reason: row 1235 shrink. The spawn-cost figure is argument, and C027's and C031's landed sentences carry the act.
- passage: A real process spawn costs on the order of half a second to a second, so a suite that spawns per assertion spends its wall clock proving things about a wrapper nobody is testing.
- flag: environment

### C033
- key: Move any cost paid per test to once per process, and make any shared resource an owned one, beyond the four named shapes.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:52
- provenance: 27ac5d7 2026-08-27, the class closer for the cost shapes.
- verdict: keep
- reason: The closer reaches a shape no bullet names; the bullets are its instances and neither replaces the other.
- passage: Any cost paid per test that could be paid once per process is paid once, as a spawn per assertion becomes a spawn per batch. Any shared resource that could be owned is owned, as a fixed port becomes an owned temp dir.

### C034
- key: Run the lane the gate moment names, never a bigger one.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:56
- provenance: 27ac5d7 2026-08-27, the section opener; the rule proper is C048's closing default from efcfa16.
- verdict: retire
- landed: 627ad10 section 32
- reason: The clause is the reason C048 exists: the suite's wall clock was spent at the cadence, not the test count (four whole gates on one section's fix rounds, 333 s quiet against 816 s beside a neighbor). The lead-in "Each gate moment names its lane" stays as the list's introduction. Retired at line 56, which now reads "Each gate moment names its lane:".
- proposed: (via A029) Cut the wall-clock clause from line 56, leaving "Each gate moment names its lane:"; C048 carries the instruction.
- baseline-test: yes

### C035
- key: Compose the targeted lane as the changed files' tests plus any whole-tree pin whose subject those files are.
- class: mechanic
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:58
- provenance: efcfa16 2026-08-27 review finding (a lane of the changed files' tests structurally could not reach a whole-tree pin, which that diff itself demonstrated), restated at cceff11 2026-08-31.
- verdict: keep
- reason: Deliberately stated in full on the doctrine and here and pinned as such for doctrine-only-reader visibility; a change to the definition lands on both copies or reds the lane-text pin.
- passage: **The targeted lane** is the changed files' tests plus any whole-tree pin whose subject those files are.

### C036
- key: Take the targeted lane at a fix round and at a section close, whatever the delta touched.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:58
- provenance: a321af3 2026-08-30, the gate-cadence plan's core sentence (operator decision 2026-08-30: the whole gate saved for the handoff; 25-plus-minute gates on the NEO box priced a ten-chapter plan at 250 added minutes), with the push forward-reference added against that plan's Section 2 Critical.
- verdict: retire
- landed: 627ad10 section 32
- reason: row 1236 merge. The doctrine's gate bullet carries the moment: "Fix rounds and section close take the targeted lane, whatever the delta touched." It also carries the push condition. The landed pointer "The doctrine's gate bullet (...) names which moment takes which lane." routes there.
- proposed: Keep the definition, C036, C037's act, the push forward-reference and C038's duty (or its pointer per A040); move "a family's pin usually lives in a file of its own, so a lane derived from filenames alone excludes the very shape this skill prefers" to the ledger.
- baseline-test: yes
- passage: is what a fix round and a section close take, whatever the delta touched. A push after a section close is a moment of its own and takes the lane its own condition below names.

### C037
- key: Run a family's pin whatever file it sits in when a change touches a family member.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:58
- provenance: efcfa16 2026-08-27 review finding, as C035.
- verdict: rewrite
- landed: 627ad10 section 32
- reason: The act that makes the targeted lane honest; the doctrine's copy gives the reason and this one gives the act, and the definition is pinned on both. Flipped from keep at section 32's close, a respell forced by C036: C036's retirement of its host sentence left this act to open its own, so "and a change" became "A change"; the act is word for word. Landed as the proposal below.
- proposed: A change to a family member runs the family's pin whatever file it sits in.
- passage: A change to a family member runs the family's pin whatever file it sits in.

### C038
- key: Name in the closing Chapter the lane or lanes that ran for that section.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:58
- provenance: 9784239 2026-08-30, the gate-cadence plan's Section 5: every Chapter satisfied the template and violated the doctrine because nothing that defines a Chapter carried the lane; the template gained its Gate field.
- verdict: retire
- landed: 627ad10 section 32
- reason: row 1236 merge. The doctrine's gate bullet carries "The Chapter that closes a section names the lane or lanes that ran.".
- proposed: (via A040) Replace the sentence with a pointer at the Chapter template's Gate field in executing-work.
- baseline-test: yes
- passage: Executing-work's Chapter template carries the duty to name the lane or lanes that ran, at its Gate field.
- flag: stale

### C039
- key: Run the whole gate at finishing, before the plan's handoff.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:59
- provenance: a321af3 2026-08-30 (the moment) and 9784239 2026-08-30 (the one-moment reading), gate-cadence plan.
- verdict: keep
- reason: Pinned phrase on both copies; the doctrine names the moments, this skill the mechanics, finishing-work the run inside its pass.
- passage: **The whole gate** runs at finishing, before the plan's handoff

### C040
- key: Run the whole gate before a push only where that push lands on a trunk consumers install from directly with no CI gating the merge.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:59
- provenance: a321af3 2026-08-30, gate-cadence Principle 2 (operator decision 2026-08-30): the condition keys on the surface so grimoire stops matching it the day it gains branch protections, with no rule edit.
- verdict: retire
- reason: The operator ruled on 2026-10-05 that one whole gate per plan is enough for a trunk consumers install from too, and section 1 of `docs/archive/claude-kit_fewer-full-runs_spec_v1.md` removed this clause on 2026-10-06. A push takes the targeted lane over its own delta, and the parity pin that held the condition alike across its carriers retired with it.
- passage: and before a push only where that push lands on a trunk consumers install from directly with no CI gating the merge.

### C041
- key: Treat finishing's own full-suite run as the handoff gate, pay it once per plan, and take the targeted lane over every change after it; the run that ends green is the one paid, and a trunk red's fix comes in on the targeted lane.
- class: mechanic
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:59
- provenance: 9784239 2026-08-30, gate-cadence Section 6: a reader took "at finishing, before the plan's handoff" as two moments and looked for a second gate no procedure runs. Section 1 of `docs/archive/claude-kit_fewer-full-runs_spec_v1.md` added the once-per-plan and ends-green sentences on 2026-10-06, on the operator's word of 2026-10-05 that a plan needs one whole gate. Section 2 of `docs/archive/claude-kit_base-head-baseline_spec_v1.md` added the trunk-red sentence on 2026-10-06, on the operator's ruling of 2026-10-06 that a plan pays one whole gate and fixes a trunk red before its handoff.
- verdict: rewrite
- landed: 4520e999 section 2, with its fix round at ec9371b8
- reason: The parity test asserts this sentence on this skill; the doctrine's sentence was left as approved because it reads correctly under this gloss. The once-per-plan sentence is pinned alike on this skill and both doctrine copies. A red the trunk carries too is fixed on its own pull request, so re-running the whole gate after it would buy the second whole run the one-gate rule removed.
- passage: Finishing and the handoff are one moment rather than two: finishing's own full-suite run is the gate the plan hands off on. A plan pays one green finishing run, and every change after it takes the targeted lane over its own delta. The one whole gate is the run that ends green: a red of the plan's own is fixed and re-run whole, since none has passed yet. A red the integration branch's head carries too is the trunk's, and the base-head bullet below routes its fix, which the plan's branch takes in on the targeted lane that bullet states. A gate whose only reds are the trunk's is the one paid once each of them is fixed or has become a spec.

### C042
- key: Decide the pre-push whole gate on the trunk's surface, never a repo's name, and drop it the day the trunk gains branch protections and a merge gate.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:59
- provenance: a321af3 2026-08-30, Principle 2 as C040.
- verdict: retire
- reason: row 1237 merge. The principle is argument. C040 retired on 2026-10-06 with the pre-push moment itself, which claude-kit_fewer-full-runs_spec_v1.md removes from every surface that stated it.
- passage: The pre-push moment keys on the surface, never on a repo's name, so a trunk that gains branch protections and a merge gate stops earning it with nothing here to edit.

### C043
- key: Run finishing's whole gate even where downstream CI exists.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:59
- provenance: a321af3 2026-08-30, gate-cadence Principle 1 (operator decision 2026-08-30): a plan hands off clean on our own evidence.
- verdict: retire
- reason: row 1237 merge. The doctrine's gate bullet carries "It runs at finishing even where downstream CI exists.".
- passage: Finishing earns the gate even where downstream CI exists, because the plan hands off clean on our own evidence and CI is only a backstop.

### C044
- key: Run the whole gate on a merge only where a code file conflicted or both sides changed one, reading each side's changed files against the merge base, and take the targeted lane over the files either side changed on any other merge.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:59
- provenance: 9784239 2026-08-30, gate-cadence Section 6: post-merge lost its lane when the unconditional pre-push gate retired, and a merge's redness sits in files neither parent changed (the 27ac5d7 baseline's stale-stamp reds after merge ee7a336 are the recorded instance). The operator narrowed it on 2026-10-01, in the operator memory record `a-disjoint-code-merge-takes-targeted-lanes-not-the-whole-gate`, and confirmed on 2026-10-05 that a budget or fixture file is not a config file under it; section 1 of `docs/archive/claude-kit_fewer-full-runs_spec_v1.md` landed both on 2026-10-06.
- verdict: keep
- reason: Pinned on both doctrine copies and this skill. A merged tree holds code no parent ran only where a code file conflicted or both sides changed one. The code-file definition decides the lane on every merge, and it leaves out the budget and fixture files nearly every plan edits, since counting `test/size-budget.json` would send every merge to the whole gate.
- passage: A merge takes the whole gate only where a code file conflicted or both sides changed one. Any other merge takes the targeted lane over the files either side changed. Each side's changed files are those `git diff --name-only <merge-base> <side>` lists, and both sides changed a code file only where the same one appears on both lists. A code file is one that runs or is loaded by what runs. That covers a source file, a script, a hook, a test file, a query or schema file, and a config file a hook, script or program reads to decide what it does, a settings file or a plugin manifest among them. Three kinds are not code files for this rule: markdown, a skill's `SKILL.md` and a probe included; plain text; and a budget or fixture file that only tests and the tool maintaining it read, as `test/size-budget.json` is. The targeted lane of each of those runs the tests that read it.

### C045
- key: Populate the contention lane with the tests whose subject is genuinely machine-shared state, such as a machine-global tier or a real shared lock, each saying so in its own text.
- class: mechanic
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:60
- provenance: 27ac5d7 2026-08-27, the testing-discipline plan's Section 4 (the memq type-lock test's subject was the machine-global tier, so a sibling's write was indistinguishable from the rival under test); line reworded at a321af3.
- verdict: keep
- reason: The only definition of the lane's membership in the kit; the finishing pass and the qa-verifier run the lane but read its membership from here.
- passage: **The contention lane** holds the tests whose subject is genuinely machine-shared state (a machine-global tier, a real shared lock), each saying so in its own text.

### C046
- key: Run the contention lane serially, beside the whole gate wherever the whole gate runs, and at a section close whenever that delta touched machine-shared state.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:60
- provenance: 27ac5d7 2026-08-27 review Major (the lane never ran at section close, so a machine-shared change could close green with its tests skipped); schedule restated at a321af3.
- verdict: keep
- reason: Pinned schedule on both copies, with the finishing pass and the qa-verifier pinned at their points of action.
- passage: It runs serially, beside the whole gate wherever the whole gate runs, and at section close whenever that section's delta touched the lane's subject.

### C047
- key: Move a main-gate test that needs the box to itself into the contention lane rather than retrying the main gate until it passes.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:60
- provenance: 27ac5d7 2026-08-27, from the evening where every red was a contention flake re-run rather than moved.
- verdict: keep
- reason: The repair the lane exists for; without it the main gate is retried until green, which is the incident.
- passage: A main-gate test that needs the box to itself moves here, which is the fix, rather than the main gate being retried until it passes.
- flag: weak-reason

### C048
- key: Take the targeted lane at any step not named among the gate moments, and earn the whole gate only at the named moments.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:62
- provenance: efcfa16 2026-08-27 review finding that the lane enumeration was not closed with its class.
- verdict: retire
- reason: row 1236/1237 merge. The doctrine's gate bullet carries "Any other step takes the targeted lane.".
- passage: Any step not named above takes the targeted lane, and only the moments named above earn the whole gate.

### C049
- key: Expect a trunk under this cadence to carry a collateral red mid-plan in the families the plan never touched, chiefly consumers of a shared module it changed.
- class: rationale-example
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:64
- provenance: a321af3 2026-08-30, operator decision 2026-08-30 accepting late discovery with its price named; the window-cutting clause is the fix for that plan's Section 2 Critical (the skill had claimed nothing between sections reads the tree, false for a Commit-and-Push push to main).
- verdict: retire
- landed: 627ad10 section 32
- reason: row 1240 merge. The paragraph is the argument behind the peer rule, and the doctrine's gate bullet carries the act: "A peer whose baseline reddens outside its own diff suspects the in-flight plan first.". The push moment this passage names left the skill on 2026-10-06 (C040), so a merge C044 sends to the whole gate is the one mid-plan whole gate left.
- proposed: Reduce the paragraph to the window-cutting clause and C050; the pricing sentences ("Reserving the whole gate for the handoff buys wall clock at a named price", "So the price is paid between the sections only...") move to the ledger.
- baseline-test: yes
- passage: Two of those moments, a push to a trunk consumers install from directly and a merge, run the whole gate mid-plan. Between them only targeted lanes read the tree, so a family the plan never touched can carry a red unseen.
- flag: stale

### C050
- key: When your own baseline reddens, suspect the in-flight plan before your own change, and confirm by checking whether the red sits outside your diff.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:64
- provenance: a321af3 2026-08-30; the approved text first pointed the heuristic at the changed families and was corrected to the untouched consumers, which is the direction the lane cannot read.
- verdict: retire
- reason: row 1240 merge. The doctrine's gate bullet carries "A peer whose baseline reddens outside its own diff suspects the in-flight plan first.".
- passage: A peer whose own baseline reddens suspects the in-flight plan before its own change, and confirms by checking whether the red sits outside its own diff.

### C051
- key: Read a lane's delta against a baseline recorded on that same lane.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:66
- provenance: efcfa16 2026-08-27 review Critical: splitting the gate into lanes left the baseline unscoped, so a 12-test targeted run could be diffed against an 1853-test baseline and reported as no regressions.
- verdict: retire
- landed: 627ad10 section 32
- reason: row 1241 (Doctrine pointer on baselines), dropped under the mechanism cut.
- proposed: (via A065) Replace line 66 with a pointer at the doctrine's gate bullet for the same-lane baseline and the whole-gate baseline rules.
- baseline-test: yes
- passage: The doctrine's gate bullet ("After each step, run the lane the moment calls for, and report the delta") owns the same-lane baseline and the whole-gate baseline a no-regressions claim takes.
- flag: stale
- ruled: cut 2026-09-30

### C052
- key: Take a whole-gate baseline of its own before claiming no regressions across the suite.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:66
- provenance: efcfa16 2026-08-27, as C051.
- verdict: retire
- landed: 627ad10 section 32
- reason: row 1241 (Doctrine pointer on baselines), dropped under the mechanism cut.
- proposed: (via A065) Replace line 66 with a pointer at the doctrine's gate bullet for the same-lane baseline and the whole-gate baseline rules.
- baseline-test: yes
- passage: The doctrine's gate bullet ("After each step, run the lane the moment calls for, and report the delta") owns the same-lane baseline and the whole-gate baseline a no-regressions claim takes.
- flag: stale
- ruled: cut 2026-09-30

### C053
- key: Read a repo's lane commands from that project's memory tier.
- class: pointer
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:68
- provenance: 27ac5d7 2026-08-27, as C001.
- verdict: retire
- landed: 627ad10 section 32
- reason: Duplicate of C001 within the file; line 68 keeps the record duty (C054) and points at the header for the read. Retired at line 68: the read clause is gone, and C054 is respelled to name the tier the clause named, recorded as a flip forced by this entry.

### C054
- key: Record a repo's lane commands in that project's memory tier when the repo first defines its lanes.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:68
- provenance: 27ac5d7 2026-08-27; the plan's Section 4 landed the kit repo's own lane commands in its project memory as the close-out's memory work.
- verdict: rewrite
- landed: 627ad10 section 32
- reason: no finding. Flipped from keep at section 32's close, a respell forced by C053: C053's retirement of the read clause left "record them there" with no referent, so the record duty names the tier itself; the duty is intact and the read stays with line 8. Landed as the proposal below.
- proposed: The lanes' commands are the per-repo facts named at the top: record them in that project's memory tier when a repo first defines its lanes.
- passage: When a repo first defines its lanes, record their commands in that project's memory tier.

### C055
- key: Discriminate a red by following the protocol rather than by re-running the world.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:72
- provenance: 27ac5d7 2026-08-27, the plan's Approach bullet of the same words, against the evening of four full re-runs.
- verdict: keep
- reason: no finding.
- passage: A red is discriminated by protocol, not by re-running the world:
- flag: weak-reason

### C056
- key: Capture the exit code and the discriminating output from the run itself: a foreground run's exit status, or a backgrounded run's own marker and log error text.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:74
- provenance: 27ac5d7 2026-08-27; the two forms were the fix for the review Minor that the marker requirement was unexecutable for a foreground run.
- verdict: keep
- reason: The red protocol's first rung, owned here; the wrapper prohibition and the isolation fallback that follow it are the doctrine's background-task bullet's and become a pointer.
- passage: **Capture the exit code and the discriminating output from the run itself**: a foreground run's own exit status, or a backgrounded run's marker and the error text in its own log.

### C057
- key: Never read the exit code or error from a background wrapper's completion notification, which reports only the wrapper's exit.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:74
- provenance: 27ac5d7 2026-08-27, restating the doctrine's background-task bullet.
- verdict: retire
- landed: 627ad10 section 32
- reason: The doctrine's bullet title is this sentence, always loaded, and the map gives background-run markers to the doctrine; C056's "from the run itself" already excludes the wrapper. Retired at line 74: the wrapper sentence is gone, C056's "from the run itself" carrying it.
- proposed: (via A073) Delete the sentence; C056's "from the run itself" and the pointer of A071 carry it.
- baseline-test: yes

### C058
- key: Where an isolation screen refuses the marker compound, use a bare redirect plus the run's own summary output.
- class: mechanic
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:74
- provenance: 27ac5d7 2026-08-27, the same review Minor's isolation-screen half.
- verdict: rewrite
- landed: 627ad10 section 32
- reason: No hook performs the fallback, so it is not superseded, but the doctrine owns the isolation screen and states the fallback twice; a pointer keeps the rung from stranding a worktree-isolated reader. Lands at line 74 as "Where an isolation screen refuses the marker compound, the doctrine's background-task bullet owns the fallback." The bullet at `plugins/grimoire/skills/operating-instructions/SKILL.md` line 180 states the fallback. Amendment 2 note: "states the fallback twice" describes the doctrine before section 1 (`a2ca9e5`); at HEAD the doctrine states the fallback once, at that bullet, with its gate bullet (line 100) and its route-around bullet (line 176) pointing there.
- proposed: (via A075) Replace the sentence with a pointer at the doctrine's background-task bullet for the isolation-screen fallback.
- baseline-test: yes
- passage: Where the environment refuses the marker compound, read the run's own summary output after the notification instead.
- flag: stale

### C059
- key: Run the test solo, then its class, then a full re-run with no code change, then check the integration branch's head in a clean worktree or the recorded lane baseline.
- class: mechanic
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:70
- provenance: 27ac5d7 2026-08-27; the clean-tree rung was a review Major (no rung separated a regression you caused from a pre-existing red). Section 2 of `docs/archive/claude-kit_base-head-baseline_spec_v1.md` named the integration branch's head as the clean tree on 2026-10-06, on the operator's ruling of 2026-10-06 that a plan pays one whole gate and fixes a trunk red before its handoff.
- verdict: rewrite
- landed: 4520e999 section 2, with its fix round at ec9371b8
- reason: The protocol is this skill's; the doctrine's retained clause was re-synced to four rungs at efcfa16, and the qa-verifier's "run twice" is the surface that gives way. Amendment 2 note at section 32's close: "re-synced to four rungs at efcfa16" describes the doctrine before section 1, where the four rungs sat in the doctrine's gate bullet; section 1 removed them there, and at HEAD the doctrine's red-is-a-signal bullet (line 120) points at this skill's red protocol for them, so this skill is their only carrier, which strengthens the keep and A079.
- passage: **Solo, then class, then a full re-run with no code change, then a clean tree.** Solo separates the test from its neighbors. The class run separates the fixture from the box. The unchanged full re-run separates the code from the machine. The same red at the integration branch's head, re-run in a clean worktree, or in the lane baseline you recorded, separates a red that was there before you from one you caused.
- flag: stale

### C060
- key: Do not skip the clean-tree rung, or a deterministic pre-existing red gets named a regression of whatever change is in flight.
- class: rationale-example
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:75
- provenance: 27ac5d7 2026-08-27, as C059.
- verdict: retire
- landed: 627ad10 section 32
- reason: The step already says what the rung separates; this repeats the consequence. Its why: the clean-tree or recorded-baseline read is the only rung that can exonerate the change in flight. Retired at line 75, which now ends on C059's rung "separates a regression you caused from one that was there before you arrived."
- proposed: Delete "Skip that last rung and a deterministic pre-existing red gets named a regression of whatever change happens to be in flight."
- baseline-test: yes

### C061
- key: Name the red a flake or a regression, with a reason citing the discriminating output, before moving on.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:76
- provenance: 27ac5d7 2026-08-27, the protocol's closing rung.
- verdict: keep
- reason: Owner's rung; the doctrine's "A red is a signal" bullet is the principle, and a named flake is still filed as a finding under it, so the qa-verifier does not conflict.
- passage: **Name it flake or regression, with the reason, before moving on.** The reason cites the discriminating output from step 1, never the timing or the feel of the failure.

### C062
- key: Record the suite's wall clock alongside the pass/fail counts at a baseline, and name the lane the baseline ran on; read the whole gate's clock against the previous plan's finishing Chapter on the same machine.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:77
- provenance: 27ac5d7 2026-08-27 (the wall-clock capture would have been orphaned when Section 2 shrank the authoring bullet, a review Major) and efcfa16 2026-08-27 (the lane name, from the unscoped-baseline Critical). Section 2 of `docs/archive/claude-kit_base-head-baseline_spec_v1.md` added the whole gate's reading on 2026-10-06, since no plan-start run records a whole-gate clock.
- verdict: rewrite
- landed: 627ad10 section 32; 4520e999 section 2 of `docs/archive/claude-kit_base-head-baseline_spec_v1.md`, with its fix round at ec9371b8
- reason: The two rules stay; the purpose clause moves here: a later run needs a figure to diff against rather than a recollection, and a lane to diff it on, because a targeted run's clock says nothing about a whole gate's. Lands at line 82 as "The suite's wall clock is recorded alongside the pass/fail counts already captured at a baseline, and the baseline names the lane it was run on."
- proposed: Drop the purpose clause; the bullet reads as the two rules.
- baseline-test: yes
- passage: Record the suite's wall clock beside the baseline's pass/fail counts, and name the lane the baseline ran on. The whole gate's clock is read against the previous plan's finishing Chapter on the same machine, which sits under `docs/archive/`, or recorded as having none there, since no plan-start run records one.

### C063
- key: Route wall-clock growth past a few minutes as a finding, such as a fast lane for day-to-day edits, rather than absorbing it.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:82
- provenance: 27ac5d7 2026-08-27, designed with C072 as one rule; the operator-tier record on this box (three same-tree runs at 1,913 s to 2,607 s with the quiet box slowest) is why C072 must bound it.
- verdict: rewrite
- landed: 627ad10 section 32
- reason: Reads as an absolute threshold; state that the growth is first established under the contention rule, then routed. Lands at line 82 as "Growth is established under the contention rule below before it is read. Established growth past a few minutes is a finding to route, a fast lane for day-to-day edits or the whole gate at the moments that earn it, never a fact of life to absorb."
- proposed: C063 states its dependency: growth established under the contention rule, past a few minutes, is a finding to route.
- baseline-test: yes
- passage: Growth established under the contention rule below, past a few minutes, is a finding to route, never a fact of life to absorb.

### C064
- key: Give every measured figure recorded in a journal-layer artifact a moment-pin.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:83
- provenance: 7ef71e3 2026-09-01, instruments-not-prose Decision 1 (operator, 2026-08-29): six expired readings leaned on in one evening after the box's hardware changed under them.
- verdict: keep
- reason: The convention's single owning site, pinned so a restatement anywhere in the shipped kit reddens; every other surface points here.
- passage: A measured figure recorded in a journal-layer artifact carries a moment-pin

### C065
- key: Make a moment-pin state what produced the figure, when, on which machine, and under what contention.
- class: mechanic
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:83
- provenance: 7ef71e3 2026-09-01; the machine field is what lets a figure be placed against an epoch.
- verdict: keep
- reason: The pin's form, and "under what contention" is the phrase the parity sweep counts.
- passage: what produced it, when, on which machine, and under what contention.

### C066
- key: Consult the memory-system skill for the per-hostname configuration-epoch record and the expiry rule that reads a figure against it.
- class: pointer
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:83
- provenance: 7ef71e3 2026-09-01, Section 2 (the epoch as a memory record at a canonical key).
- verdict: retire
- reason: row 1245 shrink. The sentence says who owns a neighboring moment. The memory-system skill's expiry rule carries the per-hostname epoch, and both reviewer charters point at it directly.
- passage: The machine is part of the pin: the configuration epoch a figure is read against is recorded per hostname, so a pin naming no machine can be placed against no epoch.

### C067
- key: Treat the journal layer as the conversation, the plan doc's Chapters, the commit message, and append-only history such as an archive or changelog.
- class: mechanic
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:83
- provenance: 7ef71e3 2026-09-01, restating the doctrine's journey-ban bullet and its append-only exemption.
- verdict: retire
- landed: 627ad10 section 32
- reason: row 1245 shrink. The doctrine's "Documents ship the current state; the journey lives in git" bullet defines the journal layer and the append-only exemption, and C068's landed sentence carries the Chapter site.
- proposed: (via A090) Replace the journal-layer sentence with a pointer at the doctrine's "Documents ship the current state" bullet, keeping only that Chapters carry pinned figures under its append-only exemption.
- baseline-test: yes
- passage: The doctrine's journey ban ("Documents ship the current state; the journey lives in git") defines the journal layer, and a plan doc's Chapters carry pinned figures under its append-only exemption.
- flag: stale

### C068
- key: In a plan doc, put pinned figures and dated evidence only in its Chapters, its interim board entries, and its Evidence section.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:83
- provenance: 7ef71e3 2026-09-01, Decision 1's sites ("a Chapter, a board line, an evidence entry").
- verdict: rewrite
- landed: 627ad10 section 32
- reason: "Dated evidence ... nowhere else" over-reaches the decision and bars the "decided YYYY-MM-DD" records the doctrine requires and the archived plans carry in Decisions sections; scope it to moment-pinned measured figures. Lands at line 83 as "A plan doc sitting in curated `docs/` therefore carries moment-pinned figures at its own journal-layer sites, which are its Chapters, its interim board entries and its Evidence section, and nowhere else in it." Its closing tail left with the scoping, beyond the proposal's letter, as the sentence's own rationale: the plan doc is that carve-out because it is the effort's own journal, never because the ban is weaker inside it, and C069's sentence carries the guard.
- proposed: Scope the sentence to moment-pinned measured figures; a dated decision record is the doctrine's decision-batch rule and is untouched.
- baseline-test: yes
- passage: Within a plan doc, pinned figures sit only in its Chapters, its interim board entries and its Evidence section.

### C069
- key: Carry no dated-evidence annotation in a curated document, a code comment, or a skill body.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:83
- provenance: 7ef71e3 2026-09-01, the bar the operator made load-bearing in Decision 1, written as the one-sentence pointer at the doctrine's ban the plan's Section 1 prescribed.
- verdict: retire
- reason: row 1245 shrink, which restated the doctrine's journey rule. The doctrine's "Documents ship the current state" bullet carries the bar: "Code comments and shipped artifacts state what is true now... Dates, evidence and claim-status marks go in the journal layer.".
- passage: Elsewhere the ban holds, so a curated document, a code comment and a skill body carry no dated-evidence annotation.

### C070
- key: Keep the deep evidence behind a figure, such as a scatter analysis or multi-run comparison, in memory or in the plan's Evidence section, and cite it from a journal line.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:83
- provenance: 7ef71e3 2026-09-01, Decision 1 ("cited from the journal line, never restated in it"); the project memory holding the suite baseline was cut to a pointer and kept the scatter analysis it is the home for.
- verdict: keep
- reason: Part of the single owning site; removing it reopens restated evidence at every journal line.
- passage: Deep evidence behind a figure, such as a scatter analysis, lives in memory or in that Evidence section, and a journal line cites it there.

### C071
- key: Record the box's process count and free memory, captured at the run, beside every wall-clock figure.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:84
- provenance: 27ac5d7 2026-08-27, the comparable-contention rule (the suite at 333 s quiet and 816 s beside a neighbor at one commit).
- verdict: rewrite
- landed: 627ad10 section 32
- reason: The rule, its bound and the procedure stay; the closing consequence sentence moves here: without a comparable-contention baseline a raw cross-load reading manufactures a finding out of a busy box. Lands at line 84 with the consequence sentence gone; the line ends on C073's procedure "and the two figures show how much of any growth the load alone accounts for."
- proposed: Drop "Without that comparison a raw cross-load reading manufactures a finding out of a busy box."; keep the rule, the bound and the procedure.
- baseline-test: yes
- passage: Every wall-clock figure carries the box's process count and free memory, captured at the run.

### C072
- key: Call wall-clock growth a finding only against a baseline at comparable contention or a same-conditions trend.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:84
- provenance: 27ac5d7 2026-08-27, as C071.
- verdict: keep
- reason: The bound that keeps C063 honest; the operator-tier scatter record shows the between-run band exceeds the effects the bars were written to detect.
- passage: Growth is a finding only against a baseline at comparable contention or a same-conditions trend.

### C073
- key: Observe the contention edge by running the same suite on the same tree once with the box quiet and once beside a neighbor's suite.
- class: mechanic
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:84
- provenance: 27ac5d7 2026-08-27 review Minor ("varies widely enough" had no observable edge).
- verdict: retire
- reason: row 1246 shrink. The quiet-versus-loaded recipe goes, and C072's landed sentence carries the comparability act.
- passage: To see the edge, run the same suite on the same tree once with the box quiet and once beside a neighbor's suite, and the two figures show how much of any growth the load alone accounts for.

### C074
- key: Before starting a suite, check the process list for any foreign process holding the box's memory, CPU, or the repo's binaries, whatever its engine or owner.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:85
- provenance: 27ac5d7 2026-08-27, the engine-agnostic box check, after a session followed the doctrine's enumerated list exactly and missed a live node --test gate; d2e2f37 respelled "neighbour".
- verdict: keep
- reason: The same rule at two points of action by design, with the skill's bullet pinned on its class phrases and both blind spots so a session loading either copy gets the same check.
- passage: Poll as the doctrine's machine-budget bullet ("One heavy process at a time is a per-machine budget, not a per-directory one") states, counting a runner or build whatever its engine, whether owned by another session or by a running engine.

### C075
- key: When the pre-suite check finds a foreign process, either wait for it or name the contention in what you report.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:85
- provenance: 27ac5d7 2026-08-27, as C074.
- verdict: retire
- reason: row 1247 merge. The doctrine's machine-budget bullet carries "Wait for a live one or name the contention.".
- passage: and either wait for it or name the contention in what you report.

### C076
- key: Treat the pre-suite poll as a sample and never a clearance, since it cannot see in-process agent fan-out or a neighbor starting after the sample.
- class: rationale-example
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:85
- provenance: 31faeb3 2026-08-28, review-and-record Section 10, from the coordinator's measured finding (three polls over two minutes returning three pictures of one stretch of work).
- verdict: keep
- reason: Pinned on this bullet as the rule's boundary rather than its reason; no machinery replaces the reading and the incident recurs on every shared box.
- passage: The poll is a sample, never a clearance. It cannot see in-process agent fan-out, which spawns no engine, and it cannot see a neighbor that starts after the sample and before the suite. A clean poll is a basis for starting and never proof the box is empty. A machine-state sentence leaving the session names the poll and its age, or says "not polled this turn".

### C077
- key: Let a clean poll license a spawn only alongside the claim protocol, which the role skill owns in full.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:85
- provenance: 31faeb3 2026-08-28, Section 10; the first draft restated the protocol and was cut to a pointer after a Critical (it dropped the carve-out that a proceeding session never writes the claim file).
- verdict: retire
- landed: 658a62e7 section 1
- reason: Pinned phrase; the protocol stays the role skill's and this sentence never grows back into a restatement. Retired on 2026-09-21 by claude-kit_heavy-process-claim-retirement_spec_v1 section 1, which replaces the box-check bullet's claim-protocol sentence with two, the clean-poll sentence and the poll-reporting sentence re-homed from the role skill; the verdict before it was keep.
- proposed: "A clean poll is a basis for starting and never proof the box is empty, so an overlap it missed costs wall clock and is named as contention. A machine-state sentence leaving the session names the poll it rests on and its age, or says "not polled this turn"."

### C078
- key: Treat a run that dies partway through as contention evidence regardless of any clean poll that preceded it.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:85
- provenance: 31faeb3 2026-08-28, Section 10, written as a cross-reference to the doctrine's machine-budget bullet rather than a restatement.
- verdict: retire
- reason: row 1247 merge. The doctrine's machine-budget bullet carries "A run that dies partway, at a fraction that moves between attempts, is contention".
- passage: A run that dies partway through is contention evidence whatever poll preceded it, per the doctrine's machine-budget bullet ("One heavy process at a time is a per-machine budget, not a per-directory one").

### W001
- key: Before writing a test that passes the earn class, ask whether a session could make the change it forbids on its own authority with nothing else needing to change, and write it only where something else would have to change.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:21
- provenance: docs/plans/claude-kit_test-requirement-axis_spec_v1.md section 1 2026-09-20, landing the operator's bar of 2026-09-17 (tests only for key, functional, breaking requirements; preferences, current state and configuration are never pinned) as the design council converged it.
- verdict: keep
- reason: The earn class alone passes a pin on "the menu has three items", since no gate short of a test catches that break either. The second question is what separates a requirement from a choice, and the things that would have to change are listed as surfaces a blind reviewer may open, so the question can be applied without the plan. The earlier phrasing, "the sole way it goes red is a defect", was dropped because a null return that becomes a valid value is a legitimate change that reds a requirement test; "nothing else would need to change" survives it, because the caller changes too. The paragraphs at lines 23 and 25 carry the same rule's bounds: a list no code reads, a comment recording a value, the reshape beside a requirement, and the whole-tree pin.
- passage: Could a session make the change this test forbids on its own authority, with nothing else needing to change? Where it could, the test pins a choice rather than a requirement, and it is not written.

### W002
- key: Never pin what a flag is set to; pin that the guarded code runs when it is on and not when it is off, the direction a guard takes on unreadable input, that an unparseable value degrades rather than throws, and the exact value that disables a guard.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:27
- provenance: docs/plans/claude-kit_test-requirement-axis_spec_v1.md section 1 2026-09-20; the operator's 2026-09-17 example that a method running only when a setting is true earns no test, bounded by the council's security lens to the four things a guard's caller depends on.
- verdict: keep
- reason: A flag is the case where the choice and the requirement sit closest together, so the boundary is stated exactly rather than left to the general question. Each of the four is a way a guard fails open: a throw in a hook that swallows errors is a silent allow, and a looser disabling match disables the guard in more cases.
- passage: **The flag case:** what a flag is set to in a configuration is a choice, and it is not pinned. Beyond the both-ways proof in the doctrine's "Make the test earn its green" bullet, a flag's requirements are the direction a guard takes on unreadable input, an unparseable value degrading rather than throwing, and the exact value that disables a guard.

### W003
- key: Price a test at its wall clock multiplied by every future section that runs the gate, plus every future red with no defect behind it, and state that trade in the Chapter for any test that spawns a process or builds a fixture per test.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:29
- provenance: docs/plans/claude-kit_test-requirement-axis_spec_v1.md section 1 2026-09-20; the operator's 2026-09-17 statement that every test is wall clock added to every future section. That plan's Approach records the gate's clock at 950.5 seconds serial against a 316.8 second three-worker floor and a 260.7 second longest file, read from main at f799f1f7.
- verdict: keep
- reason: The gate's clock is total work over the workers rather than the longest file, so a spawn added in any file lengthens it, which is why the trade is stated per spawning test rather than per file. The operator ruled out a declared test budget, so the price is a statement the Chapter carries and never a cap a ratchet refuses.
- passage: **The price:** a test costs its wall clock at every future gate, plus every edit that reds it with no defect behind it, so it is written only where the break it would catch costs more.

### W004
- key: Pin a fixed defect's cause on a stable form (a token, a direction, a field, a far end), never on the sentence the fix happened to write, and do not read a defect commit as exempting a wording pin from the wording class.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:17
- provenance: docs/plans/claude-kit_test-requirement-axis_spec_v1.md section 1 2026-09-20; the 2026-09-03 test audit kept a wording family in `test/doctrine-parity.test.js` whole under the defect rule, which is the application gap this clause closes.
- verdict: keep
- reason: Supersedes C006. A defect earns a pin on its cause, and the sentence a fix wrote is only the vehicle for that cause. Without the clause any wording pin traceable to a fix commit was immune to the wording class, however often a legitimate rewording turned it red.
- passage: A defect commit does not exempt a wording pin from the wording class.

### W005
- key: Retire a pin on a choice whether or not a sibling duplicates it, reshape it where a requirement sits beside the choice, and keep the carve-outs the other classes state.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:42
- provenance: docs/plans/claude-kit_test-requirement-axis_spec_v1.md section 1 2026-09-20; that plan's Approach records that between the 2026-09-03 test audit's close and f799f1f7 the size budget was edited in 127 commits, 36 moved a test cap, and 25 of those moved `test/doctrine-parity.test.js` as the prose it pins was edited.
- verdict: keep
- reason: The classes before it removed a lone preference pin only where a sibling duplicated it, so a pin on a count or a wording that nothing else stated stayed and turned red on every legitimate edit. The carve-outs are restated inside the class so it cannot be read as retiring a designed-copy identity pin, an only-detector count, a control leg or a runtime-set pin. A test `docs/security-model.md` names as a control retires only with an amendment to that document, so a control is never removed with its description left standing. The lead and the definition clause are compared against every carrier by the sweep at `test/doctrine-parity.test.js` ("every tracked surface naming the retire classes agrees with their owner"), so an edit to either moves the adversarial charter's parenthetical with it.
- passage: a test that goes red on an edit a session could make on its own authority with nothing else needing to change

### W006
- key: Add tests with new code, add and retire with changed code, remove tests with removed code, say why in the Chapter where a section adds tests and retires none, and rule each test the section's own change turned red or edited a defect, a named contract change, or a choice.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:50
- provenance: docs/plans/claude-kit_test-requirement-axis_spec_v1.md section 1 2026-09-20; that plan's Approach records that the 2026-09-03 audit cut 73 tests of the 3,546 its census found while sections added 512 in the week before, so a periodic audit loses to section-rate additions.
- verdict: keep
- reason: Supersedes C021, whose duty it carries unchanged with the pointer at executing-work for the Chapter's contents. Retirement happens at the section that turns the test red because that is the one moment the evidence is in hand: the edit that was legitimate and the test that refused it. Widening the assertion is named because it is the cheap move that keeps the choice pinned.
- passage: A red ruled a choice retires or reshapes the test in the same section. It is never settled by widening the assertion to admit the new value.

### X001
- key: File a red seen under overlap that passes on a solo re-run to the kaizen inbox as a note naming which suite cannot share the box with what, whatever repository the suite belongs to.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:91
- provenance: docs/plans/claude-kit_heavy-process-claim-retirement_spec_v1.md section 1 2026-09-21, Decision 5; the operator retired the heavy-process claim everywhere on 2026-09-21 after three overlap rounds of four suites produced no red that passed solo.
- verdict: keep
- landed: 658a62e7 section 1
- reason: With the claim gone, a suite starts on a clean poll, and an overlap red is the one evidence that the retirement was wrong for some suite. The note goes to the kaizen inbox rather than project memory so the count taken on or after 2026-10-05 finds it wherever the suite lives; the second sentence says so because the kaizen bar otherwise routes a project-specific gotcha to memory.
- passage: A red seen with another suite, build or embedding pass on the box that passes on a solo re-run is contention evidence. It goes to the kaizen inbox as a note stating which suite cannot share the box with what, whatever repository the suite belongs to.

### A001
- key: Rebuild before gating when a merge's diff touches the sources a local build artifact is stamped from, the kit repository's `plugins/grimoire/hooks/` among them.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:72
- provenance: `docs/plans/claude-kit_corpus-compression_spec_v1.md` section 12, 2026-09-26: the doctrine's hook-merge sentence (the operating-instructions ledger's c1.C146), relocated on the operator's ruling of that day (batch row 16) and generalized so it holds in any repository with a stamped build artifact. The mechanism is the project memory merging-hook-edits-staleness-the-build-stamp.
- verdict: keep
- reason: Git merges lines while the stamp hashes bytes, so a stamp built before a merge no longer matches the merged sources, and the merge raises no conflict to say so; a gate run on the stale build reads the old artifact. The rule sits beside the merge rule (C044) and binds whichever lane that rule gives the merge, and the probe `lane-choice-after-a-merge-touching-hooks` reads it from the doctrine-plus-testing-discipline shape.
- passage: A merge whose diff touches the sources a local build artifact is stamped from rebuilds before it gates. The merge leaves the stamp stale with no conflict to flag it. In the kit repository those sources are the files under `plugins/grimoire/hooks/`, rebuilt with `build.ps1` or `build.sh`.
- ruled: move 2026-09-26

### B001
- key: Read each red of the one finishing whole gate against the integration branch's head in a clean worktree, fix a trunk red before the handoff on its own branch and pull request, and run no plan-start whole gate.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:61
- provenance: Section 2 of `docs/archive/claude-kit_base-head-baseline_spec_v1.md`, 2026-10-06, written by the ARCHITECT persona on the DEV-PLUGIN worker's question from the finishing pass of `docs/archive/claude-kit_fewer-full-runs_spec_v1.md`, on the operator's ruling of 2026-10-06 that a plan pays one whole gate and fixes a trunk red before its handoff.
- verdict: keep
- landed: 4520e999 section 2, with its fix round at ec9371b8 and section 3's at a7122a73
- reason: A baseline splits the reds a plan caused from the reds it inherited, and the exact answer is to run the red file on the trunk the branch merged, which is on disk at the moment it is needed. A plan-start whole gate costs a second full run and reads a trunk the branch has moved past, and a stored failure list is stale once a peer merges. The re-run costs nothing on a green gate. A trunk red left to the inbox stays red for every later plan, so the plan that finds it fixes it. The merge taking that fix in takes the targeted lane over the fix's files on the operator's ruling of 2026-10-06, the merge rule's one exception, since the fix's own pull request has just run them.
- passage: **The whole gate's baseline is the base head.** No plan runs the whole gate at its start to record a baseline. The finishing gate runs once, after the plan's branch has taken in the integration branch. Where the gate reds any test file, add one worktree under the project's `.kit/` scratch path at the integration branch's commit that merge took in, built first where the project's tests read a build output. Where no merge took the integration branch in, as under Review-Only or Commit-and-Push on the trunk, the worktree sits at the effort's base ref, which finishing-work's base-ref paragraph derives. Run each red file there alone with the project's own test command, then remove the worktree. The re-run takes its own worktree because a whole gate reads the tree live, and the finishing pass is still editing the plan's tree. Each base-head result rides the Chapter's `Gate:` line beside the gate's own counts, as `base head <sha>: <file> <pass>/<fail>`. A file red on the branch alone is the plan's, fixed on the plan's branch. So is a file the base head does not hold, which rides the line as `absent` in place of its counts. A file red on both sides is the trunk's. The red protocol below still names it flake or regression, and then the session fixes it before the handoff, on a branch cut from the trunk with a pull request of its own. That fix takes the targeted lane over the failing file, and the plan's branch merges the trunk again once it lands. That merge takes the targeted lane over the files the fix changed, even where the plan changed one of them too, and any other file it brings across takes the merge rule the whole-gate bullet above states. A red whose fix is a design of its own becomes a spec instead. The handoff waits on that pull request or that spec. A trunk red never goes to the kaizen inbox or the backlog, since a red left for later stays red for every plan after this one.
