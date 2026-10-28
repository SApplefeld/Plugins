# Rationale ledger: testing-discipline

This file is the rationale ledger for the documents the `testing-discipline` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/testing-discipline/SKILL.md

This document is the kit-wide authority on which tests a change earns and keeps. It owns these moments: the triage that decides whether a candidate earns a test, with its default of no and its two questions; spending a section's `Tests:` allocation and asking past it; deciding whether a test already in the tree still earns its keep or retires; the Chapter line each added test carries and the three currencies it reports in; pinning a hazard that a shared setup hides; and pricing a test's runtime shape at authoring. The lanes, reading a red, the clock and box and the mutation audit belong to `test-gates`, whose ledger holds the entries for them. Load class: named-trigger, per its own frontmatter description, which lists the acts and events that call it (writing a test, deciding whether a change earns one, reading a section's `Tests:` line, judging whether a test still earns its keep).

Extracted at `6bc07fb`: whole document (`skills.testing-discipline.SKILL.md`). Amended on 2026-09-20 by `docs/plans/claude-kit_test-requirement-axis_spec_v1.md` section 1 (`W` entries below). Amended on 2026-09-22 by `docs/plans/claude-kit_heavy-process-claim-retirement_spec_v1.md` section 1 (`X` entry below). Redrafted on 2026-09-26 by section 8 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, landed at `5cce82fa` with its fix round at `6f26f01a`, so every live entry's `passage:` line quotes the text at `6f26f01a` and the `flag:` lines record that pass's flags. Amended on 2026-09-26 by section 12 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, which relocated the doctrine's hook-merge rebuild sentence here (`A` entry below). Amended on 2026-10-06 by section 1 of `docs/archive/claude-kit_fewer-full-runs_spec_v1.md`, which states one whole gate per plan and the operator's merge ruling of 2026-10-01: C040 retired, C041 and C044 rewritten to their passages as they now read, and the reasons of C042, C049 and A001 amended. Amended on 2026-10-06 by section 2 of `docs/archive/claude-kit_base-head-baseline_spec_v1.md`, which names the integration branch's head as the whole gate's baseline (`B` entry below): C041, C059 and C062 rewritten to their passages as they now read, C041 and B001 amended again by section 3's fix round and the finishing pass. Amended by `docs/plans/claude-kit_escaped-defect-fixtures_spec_v1.md` section 4 on 2026-10-21: AE001 added under the plan's letter AE for the escaped-defect route, and C001 and C054 rewritten to their passages as they now read, since that section folded the lanes section's record sentence into the opening line. Amended on 2026-10-27 by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md`, which replaced the body with the triage-first draft and moved the lanes, the red protocol and the clock and box to `test-gates`: the live entries whose sentences moved (C001, C002, C035, C037, C039, C041, C044, C045, C046, C047, C054, C055, C056, C058, C059, C061, C062, C063, C064, C065, C068, C070, C071, C072, C074, C076, X001, X002, A001, B001, AE001) went to that skill's ledger with a provenance line naming the move, C003, C007 and W003 retired, C027, C033 and W001 rewritten to their passages as they now read, `AG` entries added for the new text, and every live entry's source line re-read at that delta. Retired entries stay here as history, including those whose sentences sat in the moved sections.

### C003
- key: Write a test for an implementer's acceptance criterion, the behavior the section was dispatched to produce.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:14
- provenance: 27ac5d7 2026-08-27, the litmus for what earns a test, drawn from the 2026-08-26 census of defects caught by tests versus reviews. Retired by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, which replaced the skill body with the triage-first draft.
- verdict: retire
- superseded-by: AG009
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: no finding. The section cut the bullet: an implementer writes its own criteria, so a criterion only it states is a choice by W001's test, and AG009 states the bullet that replaced it.
- passage: **An implementer's acceptance criterion**: the behavior the section was dispatched to produce.
- flag: weak-reason

### C004
- key: Write a test for a path no human drives by hand, such as a hook or a CLI that only machines exercise.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:27
- provenance: 27ac5d7 2026-08-27, the litmus.
- verdict: keep
- reason: no finding.
- passage: **A path no human drives by hand**: a hook, a CLI, anything only machines exercise.
- flag: weak-reason

### C005
- key: Write a cross-surface pin wherever a writer and a reader share a value such as a wire field, a filter constant, or a column list.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:28
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
- provenance: 27ac5d7 2026-08-27, the class closer added at the review round ("the litmus class did not cleanly contain its own first instance", a Minor). Retired by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, which replaced the skill body with the triage-first draft.
- verdict: retire
- superseded-by: AG008
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: no finding. The section cut the closer: the class now opens the list rather than closing it, so no listed item reads as a permission on its own, and AG008 holds that sentence.
- passage: The list is instances of one class: a contract whose break no gate short of a test reliably catches. A candidate that pins such a contract earns its test even where no item names it.
- flag: weak-reason

### C008
- key: Prefer one whole-tree pin that visits every member of a family over a test per function.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:35
- provenance: 27ac5d7 2026-08-27, from the census finding that whole-tree pins were the shapes that caught defects while function mirrors dominated the intentional-change breakages.
- verdict: keep
- reason: The five named shapes are the census's saves and the class closer is what reaches a new shape; a session cutting the list cuts the evidence. C019's focused test composes with it through C020's "what an earlier test cannot see".
- passage: **Prefer one whole-tree pin to a test per function.** The shape that catches real defects is an invariant pinned across the whole tree: a roster or reflection pin over a family, a derived pin that scans a source file, a cross-surface count assertion, a region-extraction test over real code, a fixture self-check. Any assertion that visits every member of a family and fails when one drifts is in that class.

### C009
- key: When a family gains a member, extend the family's pin or write the family's first pin instead of giving the member private function mirrors.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:35
- provenance: 27ac5d7 2026-08-27, same install; the RED probe for this rule half-reproduced (the unguided agent added a roster control and eleven mirrors anyway).
- verdict: keep
- reason: It is C008 at the moment it bites, with the act named; the probe shows the moment is exactly where a writer falls back to mirrors.
- passage: When a family gains a member, extend the family's pin, or write its first, rather than giving the member private function mirrors.

### C010
- key: Retire a test in the tree that falls in a retirement class, and do not write a candidate that falls in one.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:41
- provenance: 70b1f73 2026-09-04, the subtraction-bars plan's Section 1: the kit had rules for adding tests and none for removing them (96,900 test lines against 50,300 product).
- verdict: keep
- reason: Opener of the retire list; the bound (C011) and the class closer (C018) are its other two parts, not copies. The retire-class agreement pin reads the class heads out of this file, so a rename of any head has to carry every carrier.
- passage: A test in the tree retires when it falls in one of these classes, and a candidate that falls in one is not written.

### C011
- key: Repair rather than delete where the contract still needs cover: re-pin a wording pin on a stable form, repoint a moved contract's test at its new home.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:41
- provenance: 70b1f73 2026-09-04, added when the rule as drafted would have retired four or more guards whose comments record the drift they exist to catch.
- verdict: keep
- reason: Without it the retire rule deletes tests whose contract still needs cover; it also covers the wording-pin repair that no class bullet names.
- passage: Where the contract still needs cover, the repair replaces the deletion: a wording pin is re-pinned on a stable form, and a moved contract's test is repointed at its new home.

### C012
- key: Retire an implementation mirror, a test that restates a function's body.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:43
- provenance: 70b1f73 2026-09-04, folded from the skill's former "What never earns one" paragraph (27ac5d7).
- verdict: keep
- reason: no finding.
- passage: **An implementation mirror**: a test restating a function's body, which breaks on every intentional edit and sleeps through defects.

### C013
- key: Retire a hardcoded count pin that another assertion in the same suite already covers.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:44
- provenance: 70b1f73 2026-09-04, with the two exceptions added when the class as drafted retired a live length assertion that guards a set comparison against two empty sets; d2e2f37 2026-09-05 clarified "another leg" as another assertion in the same suite.
- verdict: keep
- reason: The exceptions are what keep the class from retiring instrument controls; C015's duplicate class does not carry them.
- passage: **A count pin a sibling leg already covers**: a hardcoded count that another assertion in the same suite already checks. A count each side derives independently stays, and so does one that is the only detector of a symmetric removal.

### C014
- key: Retire an exact-wording pin on stderr, stdout, or curated prose, pinning the exit code, a stable token, or a machine-read field instead.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:45
- provenance: 70b1f73 2026-09-04; the byte-identity carve-out was the plan's load-bearing correction, since the tree held at least six pinned copy sets no registry names and the rule as written would have retired their guards.
- verdict: keep
- reason: no finding.
- passage: **An exact-wording pin on prose no identity contract covers**: an assert on stderr, stdout or a curated sentence where an exit code, a stable token or a machine-read field would leave the wording free. A text two or more surfaces carry by design keeps its byte-identity pin.
- flag: weak-reason

### C015
- key: Retire a duplicate test whose failure implies another's and which catches nothing the other misses.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:46
- provenance: 70b1f73 2026-09-04; the direction of implication was corrected from the plan's own draft, which had named the more sensitive test as the duplicate.
- verdict: keep
- reason: The count-pin class (C013) is its instance with exceptions, and the control-leg exemption (C017) is its stated carve-out; neither conflicts with it.
- passage: **A duplicate**: a test whose failure implies another's and which catches nothing the other misses.

### C016
- key: Retire an orphan test whose contract no longer exists, and repoint one whose contract merely moved.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:47
- provenance: 70b1f73 2026-09-04.
- verdict: keep
- reason: The class carries its own repair so a reader of the list sees it; C011 is the general rule.
- passage: **An orphan**: a test whose contract no longer exists; one whose contract merely moved earns a repointed test.

### C017
- key: Keep a leg whose job is to prove the comparison beside it had something to compare, whatever its shape.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:50
- provenance: 70b1f73 2026-09-04, added because the classes as drafted retired the withheld controls the doctrine's silent-check bullet mandates, two of them live in the kit's own suite; d2e2f37 respelled "neighbour".
- verdict: keep
- reason: A stated exemption, not a conflict with C015 or C018: a control's defect (an empty comparison) is caught nowhere else. It is written on what the leg is for rather than its shape so a new control shape is covered.
- passage: A control leg is none of these, per the doctrine's withheld-control bullet ("A silent check earns its silence with a withheld control").

### C018
- key: Retire, and never write, any test whose maintenance cost is not paid for, even when no listed class names it.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:52
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
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:66
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
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:64
- provenance: 27ac5d7 2026-08-27, from the census's 239 spawn-class call sites across 32 test files. Rewritten by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, which replaced the skill body with the triage-first draft.
- verdict: rewrite
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: no finding. The section widened the rule from once per process to the widest scope a test's isolation allows, since a database built per class is the same cost one scope up, and moved it to the Shared Setup section.
- passage: Any cost paid per test that could be paid once is paid once, at the widest scope the test's isolation allows.
- passage: A spawn per assertion becomes a spawn per batch, a fixture per test becomes a fixture per class, and a database per class becomes a database per collection with each test isolated by a transaction or its own keys.
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
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:72
- provenance: 27ac5d7 2026-08-27; the doctrine's authoring bullet keeps the same sentence by the plan's requirement and routes the shapes here (parity-pinned route).
- verdict: keep
- reason: The owner's statement of the shape; the doctrine's copy is the principle-keeping restatement the plan adjudicated. Deleting it strands C030.
- passage: Any shared resource that could be owned is owned, as a fixed port becomes an owned temp dir.

### C030
- key: Configure the test runner parallel from day one so a dependent test fails at birth rather than at a retrofit.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:49
- provenance: 27ac5d7 2026-08-27; Standing Brief Amendment 2 of the same plan required every test to run green under the parallel runner.
- verdict: retire
- reason: Cut on 2026-10-17 by section 3 of `docs/plans/claude-kit_gate-sized-to-delta_spec_v1.md`, the orchestrator's call, to pay for the sized gate; no other rule reads it.
- flag: weak-reason

### C031
- key: Use a real process spawn only where a shell, CLI, or cross-process boundary is the subject, and test everything else in-process.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:50
- provenance: 27ac5d7 2026-08-27, the cost shapes.
- verdict: retire
- reason: Cut with C030, on the same call; the per-process cost sentence beside it still prices a spawn.
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
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:64
- provenance: 27ac5d7 2026-08-27, the class closer for the cost shapes. Rewritten by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, which replaced the skill body with the triage-first draft.
- verdict: rewrite
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: The closer reaches a shape no bullet names; the bullets are its instances and neither replaces the other. The section split the closer: its first sentence became the Shared Setup lead (C027), and its owned-resource sentence opens Price the Shape at Authoring.
- passage: Any cost paid per test that could be paid once is paid once, at the widest scope the test's isolation allows.
- passage: Any shared resource that could be owned is owned, as a fixed port becomes an owned temp dir.

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

### C040
- key: Run the whole gate before a push only where that push lands on a trunk consumers install from directly with no CI gating the merge.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:59
- provenance: a321af3 2026-08-30, gate-cadence Principle 2 (operator decision 2026-08-30): the condition keys on the surface so grimoire stops matching it the day it gains branch protections, with no rule edit.
- verdict: retire
- reason: The operator ruled on 2026-10-05 that one whole gate per plan is enough for a trunk consumers install from too, and section 1 of `docs/archive/claude-kit_fewer-full-runs_spec_v1.md` removed this clause on 2026-10-06. A push takes the targeted lane over its own delta, and the parity pin that held the condition alike across its carriers retired with it.
- passage: and before a push only where that push lands on a trunk consumers install from directly with no CI gating the merge.

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

### C069
- key: Carry no dated-evidence annotation in a curated document, a code comment, or a skill body.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:83
- provenance: 7ef71e3 2026-09-01, the bar the operator made load-bearing in Decision 1, written as the one-sentence pointer at the doctrine's ban the plan's Section 1 prescribed.
- verdict: retire
- reason: row 1245 shrink, which restated the doctrine's journey rule. The doctrine's "Documents ship the current state" bullet carries the bar: "Code comments and shipped artifacts state what is true now... Dates, evidence and claim-status marks go in the journal layer.".
- landed: `docs/plans/claude-kit_daily-trunk-gate_spec_v1.md` section 3, which cut the sentence's last form, "The doctrine's journey ban (...) defines the journal layer, so a curated document, a code comment and a skill body carry no dated-evidence annotation."
- passage: Elsewhere the ban holds, so a curated document, a code comment and a skill body carry no dated-evidence annotation.

### C073
- key: Observe the contention edge by running the same suite on the same tree once with the box quiet and once beside a neighbor's suite.
- class: mechanic
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:84
- provenance: 27ac5d7 2026-08-27 review Minor ("varies widely enough" had no observable edge).
- verdict: retire
- reason: row 1246 shrink. The quiet-versus-loaded recipe goes, and C072's landed sentence carries the comparability act.
- passage: To see the edge, run the same suite on the same tree once with the box quiet and once beside a neighbor's suite, and the two figures show how much of any growth the load alone accounts for.

### C075
- key: When the pre-suite check finds a foreign process, either wait for it or name the contention in what you report.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:85
- provenance: 27ac5d7 2026-08-27, as C074.
- verdict: retire
- reason: row 1247 merge. The doctrine's machine-budget bullet carries "Wait for a live one or name the contention.".
- passage: and either wait for it or name the contention in what you report.

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
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:16
- provenance: docs/plans/claude-kit_test-requirement-axis_spec_v1.md section 1 2026-09-20, landing the operator's bar of 2026-09-17 (tests only for key, functional, breaking requirements; preferences, current state and configuration are never pinned) as the design council converged it. Rewritten by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, which replaced the skill body with the triage-first draft.
- verdict: rewrite
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: The earn class alone passes a pin on "the menu has three items", since no gate short of a test catches that break either. The second question is what separates a requirement from a choice, and the things that would have to change are listed as surfaces a blind reviewer may open, so the question can be applied without the plan. The earlier phrasing, "the sole way it goes red is a defect", was dropped because a null return that becomes a valid value is a legitimate change that reds a requirement test; "nothing else would need to change" survives it, because the caller changes too. The paragraphs at lines 23 and 25 carry the same rule's bounds: a list no code reads, a comment recording a value, the reshape beside a requirement, and the whole-tree pin. The section made the question the triage's second question, asked of every candidate after the first (AG004) rather than of a candidate that passed the earn class, and its bounds moved to the requirement-test paragraph under What Earns a Test.
- passage: The second question is whether a session could make the change this test forbids on its own authority, with nothing else needing to change.
- passage: Where it could, the test pins a choice rather than a requirement, and it is not written.

### W002
- key: Never pin what a flag is set to; pin that the guarded code runs when it is on and not when it is off, the direction a guard takes on unreadable input, that an unparseable value degrades rather than throws, and the exact value that disables a guard.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:33
- provenance: docs/plans/claude-kit_test-requirement-axis_spec_v1.md section 1 2026-09-20; the operator's 2026-09-17 example that a method running only when a setting is true earns no test, bounded by the council's security lens to the four things a guard's caller depends on.
- verdict: keep
- reason: A flag is the case where the choice and the requirement sit closest together, so the boundary is stated exactly rather than left to the general question. Each of the four is a way a guard fails open: a throw in a hook that swallows errors is a silent allow, and a looser disabling match disables the guard in more cases.
- passage: **The flag case:** what a flag is set to in a configuration is a choice, and it is not pinned. Beyond the both-ways proof in the doctrine's "Make the test earn its green" bullet, a flag's requirements are the direction a guard takes on unreadable input, an unparseable value degrading rather than throwing, and the exact value that disables a guard.

### W003
- key: Price a test at its wall clock multiplied by every future section that runs the gate, plus every future red with no defect behind it, and state that trade in the Chapter for any test that spawns a process or builds a fixture per test.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:29
- provenance: docs/plans/claude-kit_test-requirement-axis_spec_v1.md section 1 2026-09-20; the operator's 2026-09-17 statement that every test is wall clock added to every future section. That plan's Approach records the gate's clock at 950.5 seconds serial against a 316.8 second three-worker floor and a 260.7 second longest file, read from main at f799f1f7. Retired by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, which replaced the skill body with the triage-first draft.
- verdict: retire
- superseded-by: AG016
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: The gate's clock is total work over the workers rather than the longest file, so a spawn added in any file lengthens it, which is why the trade is stated per spawning test rather than per file. The operator ruled out a declared test budget, so the price is a statement the Chapter carries and never a cap a ratchet refuses. The section cut the price paragraph: the two costs it named are now the two currencies a Chapter reports as figures, held at AG016, and the spawn-site sentence that followed it stays under Price the Shape at Authoring.
- passage: **The price:** a test costs its wall clock at every future gate, plus every edit that reds it with no defect behind it, so it is written only where the break it would catch costs more.

### W004
- key: Pin a fixed defect's cause on a stable form (a token, a direction, a field, a far end), never on the sentence the fix happened to write, and do not read a defect commit as exempting a wording pin from the wording class.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:29
- provenance: docs/plans/claude-kit_test-requirement-axis_spec_v1.md section 1 2026-09-20; the 2026-09-03 test audit kept a wording family in `test/doctrine-parity.test.js` whole under the defect rule, which is the application gap this clause closes.
- verdict: keep
- reason: Supersedes C006. A defect earns a pin on its cause, and the sentence a fix wrote is only the vehicle for that cause. Without the clause any wording pin traceable to a fix commit was immune to the wording class, however often a legitimate rewording turned it red.
- passage: A defect commit does not exempt a wording pin from the wording class.

### W005
- key: Retire a pin on a choice whether or not a sibling duplicates it, reshape it where a requirement sits beside the choice, and keep the carve-outs the other classes state.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:48
- provenance: docs/plans/claude-kit_test-requirement-axis_spec_v1.md section 1 2026-09-20; that plan's Approach records that between the 2026-09-03 test audit's close and f799f1f7 the size budget was edited in 127 commits, 36 moved a test cap, and 25 of those moved `test/doctrine-parity.test.js` as the prose it pins was edited.
- verdict: keep
- reason: The classes before it removed a lone preference pin only where a sibling duplicated it, so a pin on a count or a wording that nothing else stated stayed and turned red on every legitimate edit. The carve-outs are restated inside the class so it cannot be read as retiring a designed-copy identity pin, an only-detector count, a control leg or a runtime-set pin. A test `docs/security-model.md` names as a control retires only with an amendment to that document, so a control is never removed with its description left standing. The lead and the definition clause are compared against every carrier by the sweep at `test/doctrine-parity.test.js` ("every tracked surface naming the retire classes agrees with their owner"), so an edit to either moves the adversarial charter's parenthetical with it.
- passage: a test that goes red on an edit a session could make on its own authority with nothing else needing to change

### W006
- key: Add tests with new code, add and retire with changed code, remove tests with removed code, say why in the Chapter where a section adds tests and retires none, and rule each test the section's own change turned red or edited a defect, a named contract change, or a choice.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:54
- provenance: docs/plans/claude-kit_test-requirement-axis_spec_v1.md section 1 2026-09-20; that plan's Approach records that the 2026-09-03 audit cut 73 tests of the 3,546 its census found while sections added 512 in the week before, so a periodic audit loses to section-rate additions.
- verdict: keep
- reason: Supersedes C021, whose duty it carries unchanged with the pointer at executing-work for the Chapter's contents. Retirement happens at the section that turns the test red because that is the one moment the evidence is in hand: the edit that was legitimate and the test that refused it. Widening the assertion is named because it is the cheap move that keeps the choice pinned.
- passage: A red ruled a choice retires or reshapes the test in the same section. It is never settled by widening the assertion to admit the new value.

### AG001
- key: Treat a test as a liability whose carrying cost is paid at every gate, and make that cost visible when the test is bought.
- class: rationale
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:8
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: The plan's Intent names the gap this answers: a session sees the test in front of it and never the future runs it will cost. The opening states that asymmetry so the triage below reads as its answer rather than as a bare prohibition.
- passage: A test is a liability bought on the hope of future information.
- passage: This skill makes the carrying cost visible at the moment of purchase.

### AG002
- key: Read lane mechanics, the red protocol, the clock and the mutation audit from the test-gates skill.
- class: pointer
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:8
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: The plan split the gate mechanics out because an authoring moment paid for about 1,700 words of them before reaching its own rules, as its Approach bullet "Two skills replace one" records. A reader who arrives here at a gate moment needs the one path to the owner.
- passage: Lane mechanics, the red protocol, the clock and the mutation audit live in `skills/test-gates/SKILL.md` under the kit plugin root.

### AG003
- key: Write no test until a candidate passes the triage's two questions in order; the default is no.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:12
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: The plan's Intent records where its why chain ended: a model matches the first permissive rule it reads. The old skill opened with a list of what earns a test, so its first rule was permissive. The default of no leads, so the first rule a session matches is the one that pushes back.
- passage: A change earns no test until a candidate passes two questions, in order.
- passage: The default is no because the suite's cost grows with every test that gets in, and nothing else in the loop pushes back.

### AG004
- key: Ask first what defect the candidate would catch, as a failure of the code, and write no candidate without an answer.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:14
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: A test that names a function rather than a failure is the coverage-padding shape the plan's Intent describes, and it cannot fail meaningfully. Asking for the defect first culls it before the second question (W001) is reached.
- passage: The first question is what defect this test would catch. The answer names a failure of the code, never a function. "Covers X" is not an answer. A candidate with no answer is not written.

### AG005
- key: Keep both triage questions, since each culls a class the other lets through.
- class: rationale
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:16
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: Neither question covers the other: an implementation mirror can always name a defect, so it passes AG004 and only W001 catches it, while a test naming no defect is culled before W001 is asked.
- passage: The first question culls the tests that cannot fail meaningfully. The second culls the tests that fail on legitimate edits, which the first lets through, since a mirror of a function's body can always name a defect.

### AG006
- key: Spend inside the section's Tests: allocation, and take a candidate past it to the orchestrator as a request against the plan's reserve.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:18
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: The plan's Approach names the sentences calling the line a floor and a ceiling on nothing as where over-testing was licensed in writing. A ceiling with a reserve gives the loop a point that says no while keeping a route past it. The regression test for a defect that happened draws without asking because the earn list already settles it. The plan refused a hard cap per change, since count caps produce enormous tests, so the allocation is per section. How the architect sets the allocation and the reserve is brainstorming's, so the sentence points there.
- passage: The section's `Tests:` line is the floor and the ceiling.
- passage: A candidate the triage passes that the allocation cannot hold goes to the orchestrator as a request naming the contract and the second surface, and the orchestrator grants it from the plan's reserve or declines it with a reason.
- passage: A fix round draws from the reserve too, and only the regression test for a defect that actually happened draws without asking.

### AG007
- key: Name each contract and its pin's shape on a haiku or sonnet section's Tests: line.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:20
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: The triage is a judgment call, and a lower tier handed it alone writes the tests it sees fit, the unsupervised pattern the plan's Intent describes. Naming each contract and its pin's shape moves that judgment to the architect for those tiers.
- passage: A lower tier is told what to pin, never left to decide whether.
- passage: A haiku or sonnet section's `Tests:` line names each contract and the shape of its pin.

### AG008
- key: Write a test for a contract whose break no gate short of a test reliably catches, with the earn list as that class's open instances.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:24
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: C007 stated the same class as a closer after the list. Stating it first, with the list as its instances, follows the plan's Intent: the list lands the questions rather than leading them, so no listed item reads as a permission on its own.
- passage: A test is written for a contract whose break no gate short of a test reliably catches. The second question above is how a candidate shows it is one. The following land that class and do not close it.

### AG009
- key: Write a test for an acceptance criterion only after it passes the second question.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:26
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: C003 made every acceptance criterion an earn class, which passed an implementer's own criterion through as a requirement. An implementer writes its criteria, so a criterion only it states is a choice by W001's test unless a second surface depends on it.
- passage: earns a test only after it passes the second question. An implementer's criterion written as "returns X for input Y" is a choice unless a second surface depends on X.

### AG010
- key: Write a requirement test from the contract before the code, against the public entry point.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:31
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: A test written after the code restates what the code does, which is the implementation-mirror retire class written at authoring. Writing from the contract first keeps the mirror from being written at all.
- passage: A requirement test is written from the contract before the code, against the public entry point.
- passage: A test written after the code describes whatever the code happens to do, and that is where mirrors come from.

### AG011
- key: Write no test of framework behavior, of what the type checker catches, of a getter or private helper, or of a mock's own behavior.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:37
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: Each of these pins a behavior the code under test does not own, so AG004 has no answer for it, and asking the triage each time spends attention on a fixed outcome.
- passage: Some shapes decline without the triage.
- passage: Framework behavior, anything the type checker already catches, a getter, a private helper, and a mock's own behavior pin nothing the code owns.

### AG012
- key: Keep a fast test a slow one subsumes while its clock stays in milliseconds and the second question still passes it.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:46
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records; the mutation pilot on a sibling .NET repository (Neat library, Stryker.NET 5.0.0) recorded under that plan's Evidence: 39 of 114 named tests have a kill set strictly inside another's, and one integration test kills 252 of 422 killed mutants
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: Read by kill set alone, the duplicate class would retire most unit tests under the one integration test that kills most mutants, and the suite would keep a red that reports a defect without naming the unit. The sentence keeps the localizing test while it stays cheap and still pins a requirement.
- passage: A fast test subsumed by a slow one still buys a red that names the broken unit, and keeps its place while its clock stays in milliseconds and the second question still passes it.

### AG013
- key: Read the mutation audit in test-gates for a test that stays green while its behavior breaks or whose defects are caught elsewhere, and judge a red with no defect by reading.
- class: pointer
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:52
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records; the mutation pilot on a sibling .NET repository (Neat library, Stryker.NET 5.0.0) recorded under that plan's Evidence
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: Per-test kill sets show the second and third symptoms of the retire class mechanically, as the pilot's empty and contained kill sets did. A red with no defect behind it never shows in a kill set, so the sentence leaves that symptom to a reader.
- passage: The mutation audit in `test-gates` measures the second and third symptoms, and the first only a reader can judge.

### AG014
- key: Read the file a test joins before writing it.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:54
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: Each of the three things the read finds is a cost not paid twice: the fixture to share is Shared Setup's saving, the sibling that already covers the contract is the duplicate class caught before it is written, and the convention is what the next session copies, as AG034 in the test-gates ledger states.
- passage: Before writing a test, read the file it joins, since that read finds the fixture to share, the sibling that already covers the contract, and the convention to match.

### AG015
- key: Give every test the Chapter adds one line naming its contract, its second surface and its cost, list the declined candidates beside them, and say why where a section adds tests and retires none.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:58
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: A reviewer reading a diff of passing tests cannot see a pointless one, so the line puts the claim each test makes where a reviewer can check it. The retires-none sentence moved here from the lifecycle paragraph, where it read "says why in its Chapter", since this section is where the Chapter's test lines live.
- passage: Every test the Chapter adds carries one line: the contract, the second surface, and its cost.
- passage: The line is what makes over-testing visible at review, since a reviewer cannot see a pointless test in a diff of passing green.
- passage: A section that adds tests and retires none says why.

### AG016
- key: Report a test's two costs, its lines and its clock, against its one worth, the defects only it catches, and enforce none of the figures.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:60
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: W003's price paragraph named the clock and the red-without-defect cost as a statement. The currencies make the same costs figures a Chapter carries, and name the worth only the mutation audit measures. The plan's Intent refused a blocking hook on the ratio, since an enforced figure is gamed and a reported one is read.
- passage: A test's cost has two currencies and its worth has one.
- passage: The ratio and the clock are reported, never enforced, because an enforced number is gamed within a week and a reported one is read.

### AG017
- key: Load shared data once rather than once per test.
- class: rationale-example
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:64
- provenance: no provenance found: the figure rides in the draft section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` landed on 2026-10-27, and that plan's Evidence records no run behind it
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: The example sizes C027's rule in clock terms. Its figure has no recorded run, so a reader leaning on the 1.1 measures before quoting it.
- passage: Ten tests that each loaded the same data took ten times the clock of one, and loading it once took them to 1.1 times.

### AG018
- key: Read the shared-setup hazard rule with the pay-once rule, since paying once is what makes setup uniform.
- class: rationale
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:66
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: Paying a setup once per class or collection (C027) makes the setup uniform across an area, which is the condition C023's hazard rule names, so the section keeps the two together.
- passage: The two rules sit together because the first creates the condition the second guards.

### AG019
- key: Treat tests on one fixture with identical mutation kill sets as assertions that detect nothing the fixture does not, and stand each on the first triage question.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:68
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records; the mutation pilot on a sibling .NET repository (Neat library, Stryker.NET 5.0.0) recorded under that plan's Evidence: three `EvaluateAsync` tests asserting three contracts share one kill set of 39
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: Three tests asserting three contracts with one kill set showed the fixture's construction catching every mutant the assertions were credited with. The first triage question still stands for each, which covers a defect the mutator cannot produce.
- passage: Tests on one fixture whose mutation kill sets are identical are tests whose assertions pull no weight.
- passage: Each member stands on the first triage question alone, which is enough where the defect it names is one the mutator cannot produce.

### AG020
- key: Inject a timeout rather than wait one out in a test.
- class: rule
- source: plugins/grimoire/skills/testing-discipline/SKILL.md:74
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: A real wait is charged to every run for the life of the project, the carrying cost AG001 names, and the plan's Intent records gates grown to an hour. An injected timeout proves the same give-up contract in milliseconds.
- passage: A test never waits out a real timeout.
- passage: The timeout is injected and the test spends milliseconds proving the same contract.
