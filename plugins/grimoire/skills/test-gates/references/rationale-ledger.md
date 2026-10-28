# Rationale ledger: test-gates

This file is the rationale ledger for the documents the `test-gates` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/test-gates/SKILL.md

This document is the kit-wide authority on what a test suite costs to consult and what it detects. It owns these moments: mapping a repository's test layers by run cost; choosing which lane runs at a fix round, a section close, a push, a merge, finishing, and a handoff; discriminating a red from a flake; recording, pinning and comparing wall-clock, fixture-time and contention figures, including the pre-suite check of the box and the gate line's test ledger; and auditing a suite with mutation testing. It states no runnable commands, since a repo's lane invocations are per-repo facts held in that project's memory tier. Load class: named-trigger, per its own frontmatter description, which lists the acts and events that call it (choosing a lane, running the finishing gate, reading a red or a wall-clock figure, recording the gate line, mapping layers, auditing a suite).

Created on 2026-10-27 by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md`, which moved the lanes, the red protocol and the clock and box here from `testing-discipline`. The entries keyed `C`, `X`, `A`, `B` and `AE` moved from the testing-discipline ledger with their ids and history, each with a provenance line naming the move and its source line re-read in this file. Claim ids are unique only under their heading, so an id a moved entry names in its reason or provenance resolves under the testing-discipline heading unless this ledger holds it. The `AG` entries are that section's new text.

### C001
- key: Read a repo's actual lane and suite commands from that project's memory tier wherever this skill names a lane.
- class: pointer
- source: plugins/grimoire/skills/test-gates/SKILL.md:8
- provenance: 27ac5d7 2026-08-27, the testing-discipline plan's Approach bullet "the skill is kit-wide; per-repo facts stay in memory", written so the skill states discipline and never a command. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: The skill is loaded across repos, so any command it carried would be wrong somewhere; the lane commands live in the project tier where `test-suite-invocation` already did. Line 68's duplicate read clause retires (C053); this sentence is the one statement. Since section 4 of `docs/plans/claude-kit_escaped-defect-fixtures_spec_v1.md` on 2026-10-21 it also carries C054's record duty, folded in as that section's trim.
- passage: Lane commands are per-repo facts, recorded in that project's memory tier when a repo first defines its lanes and read from there.

### C002
- key: Treat nothing written in this skill as a command to run.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:8
- provenance: 27ac5d7 2026-08-27, same install as C001. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: rewrite
- landed: 627ad10 section 32
- reason: The rule stays; the "two costs" framing before it is rationale (the skill's authoring and gate decisions are the two costs a suite pays) and the "This skill owns both, kit-wide" claim is the ownership map's row. Neither is obeyed, so dropping them changes no behavior. Lands at line 8 (section 32's close): "A specific repo's exact suite invocation and its lane commands are per-repo facts that live in that project's memory tier, so wherever this skill names a lane, look the command up there; nothing in this file is a command to run." The two-costs framing and the ownership sentence are gone.
- proposed: Line 8 keeps "nothing in this file is a command to run" and the memory-tier pointer; the two-costs framing moves to this ledger and the ownership sentence is dropped as the map's.
- passage: Nothing in this file is a command to run.

### C035
- key: Compose the targeted lane as the changed files' tests plus any whole-tree pin whose subject those files are.
- class: mechanic
- source: plugins/grimoire/skills/test-gates/SKILL.md:18
- provenance: efcfa16 2026-08-27 review finding (a lane of the changed files' tests structurally could not reach a whole-tree pin, which that diff itself demonstrated), restated at cceff11 2026-08-31. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: Deliberately stated in full on the doctrine and here and pinned as such for doctrine-only-reader visibility; a change to the definition lands on both copies or reds the lane-text pin.
- passage: **The targeted lane** is the changed files' tests plus any whole-tree pin whose subject those files are.

### C037
- key: Run a family's pin whatever file it sits in when a change touches a family member.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:18
- provenance: efcfa16 2026-08-27 review finding, as C035. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: rewrite
- landed: 627ad10 section 32
- reason: The act that makes the targeted lane honest; the doctrine's copy gives the reason and this one gives the act, and the definition is pinned on both. Flipped from keep at section 32's close, a respell forced by C036: C036's retirement of its host sentence left this act to open its own, so "and a change" became "A change"; the act is word for word. Landed as the proposal below.
- proposed: A change to a family member runs the family's pin whatever file it sits in.
- passage: A change to a family member runs the family's pin whatever file it sits in.

### C039
- key: Run the finishing gate before the plan's handoff, on the lane the lane script prints.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:19
- provenance: a321af3 2026-08-30 (the moment) and 9784239 2026-08-30 (the one-moment reading), gate-cadence plan; `docs/plans/claude-kit_gate-sized-to-delta_spec_v1.md` section 3, 2026-10-17, on the operator's ruling that day. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: Pinned phrase on both copies; the doctrine names the moments, this skill the mechanics, finishing-work the run inside its pass.
- passage: **The whole gate** is the full suite. The finishing gate runs at finishing, before the plan's handoff, on the lane the lane script prints from the repository's lane map, `test/gate-lanes.json` in the kit. The script is `scripts/gate-lane.js` under the kit plugin root. It prints `lane: whole` where the map cannot bound the delta or the daily gate below has no fresh green run, and its header lists each case.

### C041
- key: Treat finishing's own run as the handoff gate, pay it once per plan, and take the targeted lane over every change after it; the run that ends green is the one paid, and a trunk red's fix comes in on the targeted lane.
- class: mechanic
- source: plugins/grimoire/skills/test-gates/SKILL.md:19
- provenance: 9784239 2026-08-30, gate-cadence Section 6: a reader took "at finishing, before the plan's handoff" as two moments. `docs/archive/claude-kit_fewer-full-runs_spec_v1.md` section 1 added the once-per-plan and ends-green sentences, and `docs/archive/claude-kit_base-head-baseline_spec_v1.md` section 2 the trunk-red one, both 2026-10-06 on operator rulings. `docs/plans/claude-kit_gate-sized-to-delta_spec_v1.md` section 3 cut the gloss and the trunk-red pointer's lane clause, 2026-10-17. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: rewrite
- landed: 4520e999 section 2, with its fix round at ec9371b8
- reason: The parity test asserts this sentence on this skill; the doctrine's sentence was left as approved because it reads correctly under this gloss. The once-per-plan sentence is pinned alike on this skill and both doctrine copies. A red the trunk carries too is fixed on its own pull request, so re-running the gate after it would buy the second run the one-gate rule removed. The re-run takes a fresh report, so a fix touching a `whole` path sends it whole.
- passage: Finishing and the handoff are one moment. A plan pays one green finishing run, and every change after it takes the targeted lane over its own delta. The one finishing gate is the run that ends green, so a red of the plan's own is fixed and the gate re-run on a fresh lane-script report. A red the integration branch's head carries too is the trunk's, and the base-head bullet below routes its fix. A gate whose only reds are the trunk's is the one paid once each of them is fixed or has become a spec.

### C044
- key: Run the whole gate on a merge only where a code file conflicted or both sides changed one, reading each side's changed files against the merge base, and take the targeted lane over the files either side changed on any other merge.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:19
- provenance: 9784239 2026-08-30, gate-cadence Section 6: post-merge lost its lane when the unconditional pre-push gate retired, and a merge's redness sits in files neither parent changed (the 27ac5d7 baseline's stale-stamp reds after merge ee7a336 are the recorded instance). The operator narrowed it on 2026-10-01, in the operator memory record `a-disjoint-code-merge-takes-targeted-lanes-not-the-whole-gate`, and confirmed on 2026-10-05 that a budget or fixture file is not a config file under it; section 1 of `docs/archive/claude-kit_fewer-full-runs_spec_v1.md` landed both on 2026-10-06. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: Pinned on both doctrine copies and this skill. A merged tree holds code no parent ran only where a code file conflicted or both sides changed one. The code-file definition decides the lane on every merge, and it leaves out the budget and fixture files nearly every plan edits, since counting `test/size-budget.json` would send every merge to the whole gate.
- passage: A merge takes the whole gate only where a code file conflicted or both sides changed one. Any other merge takes the targeted lane over the files either side changed. Each side's changed files are those `git diff --name-only <merge-base> <side>` lists, and both sides changed a code file only where the same one appears on both lists. A code file is one that runs or is loaded by what runs. That covers a source file, a script, a hook, a test file, a query or schema file, and a config file a hook, script or program reads to decide what it does, a settings file or a plugin manifest among them. Three kinds are not code files for this rule: markdown, a skill's `SKILL.md` and a probe included; plain text; and a budget or fixture file that only tests and the tool maintaining it read, as `test/size-budget.json` is. The targeted lane of each of those runs the tests that read it.

### C045
- key: Populate the contention lane with the tests whose subject is genuinely machine-shared state, such as a machine-global tier or a real shared lock, each saying so in its own text.
- class: mechanic
- source: plugins/grimoire/skills/test-gates/SKILL.md:20
- provenance: 27ac5d7 2026-08-27, the testing-discipline plan's Section 4 (the memq type-lock test's subject was the machine-global tier, so a sibling's write was indistinguishable from the rival under test); line reworded at a321af3. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: The only definition of the lane's membership in the kit; the finishing pass and the qa-verifier run the lane but read its membership from here.
- passage: **The contention lane** holds the tests whose subject is genuinely machine-shared state (a machine-global tier, a real shared lock), each saying so in its own text.

### C046
- key: Run the contention lane serially, beside the finishing gate or any whole gate, and at a section close whenever that delta touched machine-shared state.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:20
- provenance: 27ac5d7 2026-08-27 review Major (the lane never ran at section close, so a machine-shared change could close green with its tests skipped); schedule restated at a321af3. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: Pinned schedule on both copies, with the finishing pass and the qa-verifier pinned at their points of action.
- passage: It runs serially, beside the finishing gate or any whole gate, and at section close whenever that section's delta touched the lane's subject.

### C047
- key: Move a main-gate test that needs the box to itself into the contention lane rather than retrying the main gate until it passes.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:20
- provenance: 27ac5d7 2026-08-27, from the evening where every red was a contention flake re-run rather than moved. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: The repair the lane exists for; without it the main gate is retried until green, which is the incident.
- passage: A main-gate test that needs the box to itself moves here, which is the fix, rather than the main gate being retried until it passes.
- flag: weak-reason

### C054
- key: Record a repo's lane commands in that project's memory tier when the repo first defines its lanes.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:8
- provenance: 27ac5d7 2026-08-27; the plan's Section 4 landed the kit repo's own lane commands in its project memory as the close-out's memory work. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: rewrite
- landed: 627ad10 section 32
- reason: no finding. Flipped from keep at section 32's close, a respell forced by C053: C053's retirement of the read clause left "record them there" with no referent, so the record duty names the tier itself; the duty is intact and the read stays with line 8. Landed as the proposal below. Folded into line 8 on 2026-10-21 by section 4 of `docs/plans/claude-kit_escaped-defect-fixtures_spec_v1.md` as that section's trim, so the record duty and the read share C001's sentence.
- proposed: The lanes' commands are the per-repo facts named at the top: record them in that project's memory tier when a repo first defines its lanes.
- passage: Lane commands are per-repo facts, recorded in that project's memory tier when a repo first defines its lanes and read from there.

### C055
- key: Discriminate a red by following the protocol rather than by re-running the world.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:27
- provenance: 27ac5d7 2026-08-27, the plan's Approach bullet of the same words, against the evening of four full re-runs. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: no finding.
- passage: A red is discriminated by protocol, not by re-running the world:
- flag: weak-reason

### C056
- key: Capture the exit code and the discriminating output from the run itself: a foreground run's exit status, or a backgrounded run's own marker and log error text.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:29
- provenance: 27ac5d7 2026-08-27; the two forms were the fix for the review Minor that the marker requirement was unexecutable for a foreground run. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: The red protocol's first rung, owned here; the wrapper prohibition and the isolation fallback that follow it are the doctrine's background-task bullet's and become a pointer.
- passage: **Capture the exit code and the discriminating output from the run itself**: a foreground run's own exit status, or a backgrounded run's marker and the error text in its own log.

### C058
- key: Where an isolation screen refuses the marker compound, use a bare redirect plus the run's own summary output.
- class: mechanic
- source: plugins/grimoire/skills/test-gates/SKILL.md:29
- provenance: 27ac5d7 2026-08-27, the same review Minor's isolation-screen half. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
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
- source: plugins/grimoire/skills/test-gates/SKILL.md:30
- provenance: 27ac5d7 2026-08-27; the clean-tree rung was a review Major (no rung separated a regression you caused from a pre-existing red). Section 2 of `docs/archive/claude-kit_base-head-baseline_spec_v1.md` named the integration branch's head as the clean tree on 2026-10-06, on the operator's ruling of 2026-10-06 that a plan pays one whole gate and fixes a trunk red before its handoff. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: rewrite
- landed: 4520e999 section 2, with its fix round at ec9371b8
- reason: The protocol is this skill's; the doctrine's retained clause was re-synced to four rungs at efcfa16, and the qa-verifier's "run twice" is the surface that gives way. Amendment 2 note at section 32's close: "re-synced to four rungs at efcfa16" describes the doctrine before section 1, where the four rungs sat in the doctrine's gate bullet; section 1 removed them there, and at HEAD the doctrine's red-is-a-signal bullet (line 120) points at this skill's red protocol for them, so this skill is their only carrier, which strengthens the keep and A079.
- passage: **Solo, then class, then a full re-run with no code change, then a clean tree.** Solo separates the test from its neighbors. The class run separates the fixture from the box. The unchanged full re-run separates the code from the machine. The same red at the base head the base-head bullet above defines separates a red that was there before you from one you caused.
- flag: stale

### C061
- key: Name the red a flake or a regression, with a reason citing the discriminating output, before moving on.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:31
- provenance: 27ac5d7 2026-08-27, the protocol's closing rung. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: Owner's rung; the doctrine's "A red is a signal" bullet is the principle, and a named flake is still filed as a finding under it, so the qa-verifier does not conflict.
- passage: **Name it flake or regression, with the reason, before moving on.** The reason cites the discriminating output from step 1, never the timing or the feel of the failure.

### C062
- key: Record the suite's wall clock alongside the pass/fail counts at a baseline, and name the lane the baseline ran on; read the whole gate's clock against the daily gate's last run on the same machine, else the last `lane: whole` finishing Chapter, else the last with no verdict line.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:37
- provenance: 27ac5d7 2026-08-27 (a review Major) and efcfa16 2026-08-27 (the lane name, an unscoped-baseline Critical); `docs/archive/claude-kit_base-head-baseline_spec_v1.md` section 2 added the whole gate's reading on 2026-10-06. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: rewrite
- landed: 627ad10 section 32; 4520e999 section 2 of `docs/archive/claude-kit_base-head-baseline_spec_v1.md`, with its fix round at ec9371b8
- reason: The two rules stay; the purpose clause moves here: a later run needs a figure to diff against rather than a recollection, and a lane to diff it on, because a targeted run's clock says nothing about a whole gate's. A targeted finishing gate's clock compares with no whole run, so the fallback names the last whole one.
- proposed: Drop the purpose clause; the bullet reads as the two rules.
- baseline-test: yes
- passage: Record the suite's wall clock beside the baseline's pass/fail counts, and name the lane the baseline ran on. The whole gate's clock is read against the daily gate's last run on the same machine, else the last `lane: whole` finishing Chapter under `docs/archive/`, else the last one with no verdict line.

### C063
- key: Route wall-clock growth past a few minutes as a finding, such as a fast lane for day-to-day edits, rather than absorbing it.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:37
- provenance: 27ac5d7 2026-08-27, designed with C072 as one rule; the operator-tier record on this box (three same-tree runs at 1,913 s to 2,607 s with the quiet box slowest) is why C072 must bound it. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: rewrite
- landed: 627ad10 section 32
- reason: Reads as an absolute threshold; state that the growth is first established under the contention rule, then routed. Lands at line 82 as "Growth is established under the contention rule below before it is read. Established growth past a few minutes is a finding to route, a fast lane for day-to-day edits or the whole gate at the moments that earn it, never a fact of life to absorb."
- proposed: C063 states its dependency: growth established under the contention rule, past a few minutes, is a finding to route.
- baseline-test: yes
- passage: Growth past a few minutes, net of skipped slow suites, is a finding under the contention rule below.

### C064
- key: Give every measured figure recorded in a journal-layer artifact a moment-pin.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:40
- provenance: 7ef71e3 2026-09-01, instruments-not-prose Decision 1 (operator, 2026-08-29): six expired readings leaned on in one evening after the box's hardware changed under them. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: The convention's single owning site, pinned so a restatement anywhere in the shipped kit reddens; every other surface points here.
- passage: A measured figure recorded in a journal-layer artifact carries a moment-pin

### C065
- key: Make a moment-pin state what produced the figure, when, on which machine, and under what contention.
- class: mechanic
- source: plugins/grimoire/skills/test-gates/SKILL.md:40
- provenance: 7ef71e3 2026-09-01; the machine field is what lets a figure be placed against an epoch. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: The pin's form, and "under what contention" is the phrase the parity sweep counts.
- passage: what produced it, when, on which machine, and under what contention.

### C068
- key: In a plan doc, put pinned figures and dated evidence only in its Chapters, its interim board entries, and its Evidence section.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:40
- provenance: 7ef71e3 2026-09-01, Decision 1's sites ("a Chapter, a board line, an evidence entry"). Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: rewrite
- landed: 627ad10 section 32
- reason: "Dated evidence ... nowhere else" over-reaches the decision and bars the "decided YYYY-MM-DD" records the doctrine requires and the archived plans carry in Decisions sections; scope it to moment-pinned measured figures. Lands at line 83 as "A plan doc sitting in curated `docs/` therefore carries moment-pinned figures at its own journal-layer sites, which are its Chapters, its interim board entries and its Evidence section, and nowhere else in it." Its closing tail left with the scoping, beyond the proposal's letter, as the sentence's own rationale: the plan doc is that carve-out because it is the effort's own journal, never because the ban is weaker inside it, and C069's sentence carries the guard.
- proposed: Scope the sentence to moment-pinned measured figures; a dated decision record is the doctrine's decision-batch rule and is untouched.
- baseline-test: yes
- passage: Within a plan doc, pinned figures sit only in its Chapters, its interim board entries and its Evidence section.

### C070
- key: Keep the deep evidence behind a figure, such as a scatter analysis or multi-run comparison, in memory or in the plan's Evidence section, and cite it from a journal line.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:40
- provenance: 7ef71e3 2026-09-01, Decision 1 ("cited from the journal line, never restated in it"); the project memory holding the suite baseline was cut to a pointer and kept the scatter analysis it is the home for. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: Part of the single owning site; removing it reopens restated evidence at every journal line.
- passage: Deep evidence behind a figure, such as a scatter analysis, lives in memory or in that Evidence section, and a journal line cites it there.

### C071
- key: Record the box's process count and free memory, captured at the run, beside every wall-clock figure.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:41
- provenance: 27ac5d7 2026-08-27, the comparable-contention rule (the suite at 333 s quiet and 816 s beside a neighbor at one commit). Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: rewrite
- landed: 627ad10 section 32
- reason: The rule, its bound and the procedure stay; the closing consequence sentence moves here: without a comparable-contention baseline a raw cross-load reading manufactures a finding out of a busy box. Lands at line 84 with the consequence sentence gone; the line ends on C073's procedure "and the two figures show how much of any growth the load alone accounts for."
- proposed: Drop "Without that comparison a raw cross-load reading manufactures a finding out of a busy box."; keep the rule, the bound and the procedure.
- baseline-test: yes
- passage: Every wall-clock figure carries the box's process count and free memory, captured at the run.

### C072
- key: Call wall-clock growth a finding only against a baseline at comparable contention or a same-conditions trend.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:41
- provenance: 27ac5d7 2026-08-27, as C071. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: The bound that keeps C063 honest; the operator-tier scatter record shows the between-run band exceeds the effects the bars were written to detect.
- passage: Growth is a finding only against a baseline at comparable contention or a same-conditions trend.

### C074
- key: Before starting a suite, check the process list for any foreign process holding the box's memory, CPU, or the repo's binaries, whatever its engine or owner.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:42
- provenance: 27ac5d7 2026-08-27, the engine-agnostic box check, after a session followed the doctrine's enumerated list exactly and missed a live node --test gate; d2e2f37 respelled "neighbour". Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: The same rule at two points of action by design, with the skill's bullet pinned on its class phrases and both blind spots so a session loading either copy gets the same check.
- passage: Poll as the doctrine's machine-budget bullet ("One heavy process at a time is a per-machine budget, not a per-directory one") states, counting a runner or build whatever its engine, whether owned by another session or by a running engine.

### C076
- key: Treat the pre-suite poll as a sample and never a clearance, since it cannot see in-process agent fan-out or a neighbor starting after the sample.
- class: rationale-example
- source: plugins/grimoire/skills/test-gates/SKILL.md:42
- provenance: 31faeb3 2026-08-28, review-and-record Section 10, from the coordinator's measured finding (three polls over two minutes returning three pictures of one stretch of work). Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: Pinned on this bullet as the rule's boundary rather than its reason; no machinery replaces the reading and the incident recurs on every shared box.
- passage: The poll is a sample, never a clearance. It cannot see in-process agent fan-out, which spawns no engine, and it cannot see a neighbor that starts after the sample and before the suite. A clean poll is a basis for starting and never proof the box is empty. A machine-state sentence leaving the session names the poll and its age, or says "not polled this turn".

### X001
- key: File a red seen under overlap that passes on a solo re-run to the kaizen inbox as a note naming which suite cannot share the box with what, whatever repository the suite belongs to.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:33
- provenance: docs/plans/claude-kit_heavy-process-claim-retirement_spec_v1.md section 1 2026-09-21, Decision 5; the operator retired the heavy-process claim everywhere on 2026-09-21 after three overlap rounds of four suites produced no red that passed solo. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- landed: 658a62e7 section 1
- reason: With the claim gone, a suite starts on a clean poll, and an overlap red is the one evidence that the retirement was wrong for some suite. The note goes to the kaizen inbox rather than project memory so the count taken on or after 2026-10-05 finds it wherever the suite lives; the second sentence says so because the kaizen bar otherwise routes a project-specific gotcha to memory.
- passage: A red seen with another suite, build or embedding pass on the box that passes on a solo re-run is contention evidence. It goes to the kaizen inbox as a note stating which suite cannot share the box with what, whatever repository the suite belongs to.

### X002
- key: Run the trunk's whole gate once a day with the slow suites admitted, skip a day whose diff holds no code file, route a red narrowed to one commit as a trunk red that day, and revert a commit with no fix draft by the next run.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:22
- provenance: `docs/plans/claude-kit_daily-trunk-gate_spec_v1.md` section 3, from stage 4 of `docs/plans/claude-kit_review-verification_program_v1.md` and its decision 5, which fixes the cadence at once a day; the revert window of one run is the architect's default while the plan's Open Questions entry awaits the operator. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- landed: `docs/plans/claude-kit_daily-trunk-gate_spec_v1.md` section 3
- reason: The finishing gate finds a trunk red only when the next plan finishes, on that plan's clock, and it admits the slow suites only where the changeset touches persona paths. A daily run on the trunk's tip finds the red the day it lands and names the commit that turned it red. The fix goes on the base-head bullet's trunk-red route, which already says why a trunk red is never left for later, so this bullet points there rather than restating it. The revert gives the fix one run first, since a revert is a pull request a person reviews.
- passage: **The daily gate is the trunk's whole gate once a day, slow suites admitted, skipped where the day's diff holds no code file.** A red narrowed to one trunk commit takes the base-head bullet's trunk-red route that day. A commit with no fix draft by the next run is reverted by an architect plan, its work returning under a new plan.

### A001
- key: Rebuild before gating when a merge's diff touches the sources a local build artifact is stamped from, the kit repository's `plugins/grimoire/hooks/` among them.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:19
- provenance: `docs/plans/claude-kit_corpus-compression_spec_v1.md` section 12, 2026-09-26: the doctrine's hook-merge sentence (the operating-instructions ledger's c1.C146), relocated on the operator's ruling of that day (batch row 16) and generalized so it holds in any repository with a stamped build artifact. The mechanism is the project memory merging-hook-edits-staleness-the-build-stamp. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: Git merges lines while the stamp hashes bytes, so a stamp built before a merge no longer matches the merged sources, and the merge raises no conflict to say so; a gate run on the stale build reads the old artifact. The rule sits beside the merge rule (C044) and binds whichever lane that rule gives the merge, and the probe `lane-choice-after-a-merge-touching-hooks` reads it from the doctrine-plus-test-gates shape.
- passage: A merge whose diff touches the sources a local build artifact is stamped from rebuilds before it gates. The merge leaves the stamp stale with no conflict to flag it. In the kit repository those sources are the files under `plugins/grimoire/hooks/`, rebuilt with `build.ps1` or `build.sh`.
- ruled: move 2026-09-26

### B001
- key: Read each red of the one finishing whole gate against the integration branch's head in a clean worktree, fix a trunk red before the handoff on its own branch and pull request, and run no plan-start whole gate.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:21
- provenance: Section 2 of `docs/archive/claude-kit_base-head-baseline_spec_v1.md`, 2026-10-06, written by the ARCHITECT persona on the DEV-PLUGIN worker's question from the finishing pass of `docs/archive/claude-kit_fewer-full-runs_spec_v1.md`, on the operator's ruling of 2026-10-06 that a plan pays one whole gate and fixes a trunk red before its handoff. Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- landed: 4520e999 section 2, with its fix round at ec9371b8 and section 3's at a7122a73
- reason: A baseline splits the reds a plan caused from the reds it inherited, and the exact answer is to run the red file on the trunk the branch merged, which is on disk at the moment it is needed. A plan-start whole gate costs a second full run and reads a trunk the branch has moved past, and a stored failure list is stale once a peer merges. The re-run costs nothing on a green gate. A trunk red left to the inbox stays red for every later plan, so the plan that finds it fixes it. The merge taking that fix in takes the targeted lane over the fix's files on the operator's ruling of 2026-10-06, the merge rule's one exception, since the fix's own pull request has just run them.
- passage: **The whole gate's baseline is the base head.** No plan runs the whole gate at its start to record a baseline. The finishing gate runs once, after the plan's branch has taken in the integration branch. Where the gate reds any test file, add one worktree under the project's `.kit/` scratch path at the integration branch's commit that merge took in, built first where the project's tests read a build output. Where no merge took the integration branch in, as under Review-Only or Commit-and-Push on the trunk, the worktree sits at the effort's base ref, which finishing-work's base-ref paragraph derives. Run each red file there alone with the project's own test command, then remove the worktree. The re-run takes its own worktree because a whole gate reads the tree live, and the finishing pass is still editing the plan's tree. Each base-head result rides the Chapter's `Gate:` line beside the gate's own counts, as `base head <sha>: <file> <pass>/<fail>`. A file red on the branch alone is the plan's, fixed on the plan's branch. So is a file the base head does not hold, which rides the line as `absent` in place of its counts. A file red on both sides is the trunk's. The red protocol below still names it flake or regression, and then the session fixes it before the handoff, on a branch cut from the trunk with a pull request of its own. That fix takes the targeted lane over the failing file, and the plan's branch merges the trunk again once it lands. That merge takes the targeted lane over the files the fix changed, even where the plan changed one of them too, and any other file it brings across takes the merge rule the whole-gate bullet above states. A red whose fix is a design of its own becomes a spec instead. The handoff waits on that pull request or that spec. A trunk red never goes to the kaizen inbox or the backlog, since a red left for later stays red for every plan after this one.

### AE001
- key: Record a defect that reached the trunk or a live run past a green gate in the repository's escaped-defect set, in the plan that fixes it: an entry where an offline check now sees it, and otherwise the reason none can.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:21
- provenance: docs/plans/claude-kit_escaped-defect-fixtures_spec_v1.md section 4 2026-10-21, stage 8 of the review-verification program (docs/review-verification-program.md), carrying its frame: "A fixture set of defects that passed the gate and reached the trunk or a live run, starting with the loader's spread refusal and the hung suite's exit 0, which any plan changing a reviewer charter or a static check runs against". Moved to this ledger from the testing-discipline ledger by section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` on 2026-10-27, when its sentence moved unchanged from `testing-discipline` to `test-gates`.
- verdict: keep
- reason: A defect that escaped a green gate is the evidence of what the gate could not see, and an entry that runs the check now seeing it keeps a later change to that check from silencing it with every gate green. The plan that fixes the defect holds its facts, so that plan writes the entry. The sentence names no path, since each repository holds its own set, and it founds the set where none exists so the first escape is not lost to a missing directory. An escape no offline check can see is still recorded, so the next reader knows it was weighed. It sits beside the trunk-red route because that route fixes an escape and this sentence keeps it fixed.
- passage: A defect that reached the trunk or a live run past a green gate is recorded in the repository's escaped-defect set by the plan that fixes it, founding the set where the repository has none, as an entry where an offline check now sees it and otherwise with the reason none can.

### AG021
- key: Read which tests a change earns and keeps from the testing-discipline skill.
- class: pointer
- source: plugins/grimoire/skills/test-gates/SKILL.md:8
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: The plan split authoring from gating, as its Approach bullet "Two skills replace one" records, so a reader here at an authoring moment needs the one path to the owner.
- passage: Which tests a change earns and keeps lives in `skills/testing-discipline/SKILL.md` under the kit plugin root.

### AG022
- key: Map a repository's tests by run cost onto one ladder, as a per-repo fact held as `layers` in the committed lane map where there is one, with each rung's count and measured clock, or `cost: unmeasured`; the map sizes no lane.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:12
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records; the plan's finishing pass corrected the draft's "memory fact" and "what the lane map below reads when bounding a delta" to the as-built lane script, which holds the layers in the lane map and sizes no lane by them, the contradiction section 4 routed to that pass
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1 and finishing pass
- reason: The plan's Approach makes the layer map the lane map with a run-cost column. An allocation by layer on a Tests: line needs each layer's cost to be read rather than guessed, and a rung with no run reads unmeasured so no figure is invented for it.
- passage: A repository's tests are mapped by what they cost to run, and the map is a per-repo fact beside the lane commands.
- passage: It is held as `layers` in the repo's committed lane map where it has one, and as a project memory otherwise.
- passage: The map is what the architect reads when allocating a section's tests by layer, and it sizes no lane.
- passage: A rung with no measured clock reads `cost: unmeasured`.

### AG023
- key: Run the mutation audit as a lane under a prune plan or a reviewer's flag, never as a gate.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:23
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records; the mutation pilot on a sibling .NET repository (Neat library, Stryker.NET 5.0.0) recorded under that plan's Evidence: 25 min 10 s for the default run and 14 min 40 s with `disable-bail`, over 2,240 production lines on 2 cores
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: A run over one small library took a quarter hour or more, so the audit cannot sit on a gate a section pays at every close. The plan's Approach names it a lane that never gates.
- passage: The audit lane is the mutation run below.
- passage: It runs under a prune plan over one folder at a time, or over one section's delta when a reviewer flags it, and never as a gate.

### AG024
- key: Carry the five slowest test files and the fixture time on the Chapter's Gate: line.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:38
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records; the full run of a sibling .NET repository on the operator's machine recorded under that plan's Evidence: 578 s summed test time against 687 s wall, with 64 classes building a database in a fixture the runner charges to no test
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: The summed test time fell short of the wall clock by the fixture cost, which the runner's per-test log never shows, so the figure has to be measured by a timer the project owns. The slowest files are where that cost concentrates: the top 5 of 622 classes carried 40% of summed time.
- passage: The gate line names the slowest files and the fixture time.
- passage: A runner's per-test log charges fixture setup to no test, so a suite whose summed test time falls short of its wall clock is spending the difference in fixtures, and that cost is measured by a timer in the fixture base class or not at all.
- passage: A test that reaches a full environment belongs on the daily gate's rung, not the finishing gate's.

### AG025
- key: Carry tests added, tests retired and the test-line ratio on the Gate: line, reported and enforced by nothing.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:39
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: The plan's Goal is a Chapter whose gate line lets the operator see whether the suite is getting better. Its Intent refused a blocking hook on the ratio, since an enforced figure is gamed, so the figures are read against the allocation rather than checked by a hook.
- passage: The gate line carries the section's test ledger.
- passage: The figures are reported for the reviewer to read against the section's `Tests:` allocation and are enforced by nothing, since a ratio a hook blocks on is gamed within a week.

### AG026
- key: Read a mutation run's per-test kill sets rather than its score.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:46
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records; the mutation pilot on a sibling .NET repository (Neat library, Stryker.NET 5.0.0) recorded under that plan's Evidence: a score of 75.22% on both runs while the count of tests credited with no kill moved from 26 to 15
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: The score did not move between the two pilot runs while what it said about individual tests did, so the kill sets are the reading and the score is not.
- passage: A mutation run measures what a test detects, and it is the only instrument that does.
- passage: The score is the share killed, and the score is not the useful part.

### AG027
- key: Run every audit with the tool's bail-at-first-failure off, and read no kill set from a run with it on.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:48
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records; the mutation pilot on a sibling .NET repository (Neat library, Stryker.NET 5.0.0) recorded under that plan's Evidence: under the default 26 tests were credited with no kill and with `disable-bail` 15, and one hand-applied mutant at `InnovationHistory.cs:60` failed four of five tests the default run had credited with none
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: Bail stops a mutant at its first failing tests, so a later test is never credited and looks useless. Retiring tests on that data retires tests that work.
- passage: The run credits every failing test, or its per-test data is wrong in a known direction.
- passage: Stryker's `disable-bail` and its equivalents in other tools are on for every audit, and a kill set from a run without it is not read.

### AG028
- key: Scope a mutation run to one folder or one section's changed lines.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:50
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records; the mutation pilot on a sibling .NET repository (Neat library, Stryker.NET 5.0.0) recorded under that plan's Evidence: 14 min 40 s for 2,240 production lines on 2 cores with fast tests
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: The run's cost is the mutant count times the covering tests' clock, so a folder of fast tests takes a quarter hour and one whose tests build a database takes far longer. Scoping keeps a run inside a working session.
- passage: The run is scoped, because its cost is the mutant count times the covering tests' clock.
- passage: The audit runs over one folder under a prune plan, or over one section's changed lines with the tests that section added when a reviewer flags it, with the tool's incremental mode where it has one.

### AG029
- key: Read the audit's three lists as questions, never verdicts.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:52
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records; the mutation pilot on a sibling .NET repository (Neat library, Stryker.NET 5.0.0) recorded under that plan's Evidence: eight kill-nothing tests covered zero mutants and two pinned a pure operator's refusal to mutate its input
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: Tests the pilot's lists would have retired pinned defects the mutator cannot produce, so a list entry starts a reading and never ends one.
- passage: The audit produces three lists, and each list is a question, never a verdict.

### AG030
- key: Ask of a test that kills no mutant whether the mutator can produce its defect, and open and read it where the mutator reaches.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:54
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records; the mutation pilot on a sibling .NET repository (Neat library, Stryker.NET 5.0.0) recorded under that plan's Evidence
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: A record's shape and an enum's membership yield no mutant at all, so an empty kill set there says nothing about the test, while an empty kill set where the mutator reaches is the symptom AG013 in the testing-discipline ledger names.
- passage: A test that kills no mutant asks whether the defect it names is one the mutator can produce.
- passage: A test that kills nothing where the mutator reaches is opened and read.

### AG031
- key: Ask of a test whose kill set another's contains whether it pins its own contract or localizes the red, and rule it under the duplicate class.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:55
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records; the mutation pilot on a sibling .NET repository (Neat library, Stryker.NET 5.0.0) recorded under that plan's Evidence: 39 of 114 named tests have a kill set strictly inside another's
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: A contained kill set is the duplicate symptom, and AG012 in the testing-discipline ledger keeps a fast test that localizes the red, so the list asks both questions and leaves the ruling to the class's owner.
- passage: A test whose kill set another test's contains asks whether it pins a contract the other does not name, and whether its red localizes a defect the other's red only reports.
- passage: Testing-discipline's duplicate class rules it.

### AG032
- key: Strengthen a test whose named rule's boundary survives under its coverage rather than retire it.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:56
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records; the mutation pilot on a sibling .NET repository (Neat library, Stryker.NET 5.0.0) recorded under that plan's Evidence: `Speciate_AutoAdjustsThreshold_ToTargetSpeciesCount` asserted `BeGreaterThan(0.1)` while the rule's comparisons at `Speciator.cs:178` and `:182` survived under 17 and 18 covering tests
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: The test was named for the rule and pinned it too loosely to see a broken boundary, so the defect is in the assertion, and retiring the test would remove the one place the rule is named.
- passage: A survivor on a line a section changed asks whether the section's tests check the behavior they are named for.
- passage: A test named for a rule whose boundary comparison survives under its coverage has an assertion too loose to see the rule, and the repair is to strengthen it, not retire it.

### AG033
- key: Read a fixture family with identical kill sets under testing-discipline's shared-setup rule.
- class: pointer
- source: plugins/grimoire/skills/test-gates/SKILL.md:58
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records; the mutation pilot on a sibling .NET repository (Neat library, Stryker.NET 5.0.0) recorded under that plan's Evidence
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: The identical-kill-set rule is an authoring rule and lives with Shared Setup (AG019 in the testing-discipline ledger), so the audit points there rather than restating it.
- passage: A family of tests on one fixture with identical kill sets is read under testing-discipline's shared-setup rule.

### AG034
- key: Run the mutation audit over the existing suite before the authoring rules land.
- class: rule
- source: plugins/grimoire/skills/test-gates/SKILL.md:60
- provenance: section 1 of `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` 2026-10-27, landing the draft written in that plan's design session of 2026-10-27 with the operator present, as its Intent records
- verdict: keep
- landed: `docs/plans/claude-kit_test-budget-and-gates_spec_v1.md` section 1
- reason: A session copies the shape of the files it joins, so a suite still full of the old pattern teaches it to every new test, whatever the skill says.
- passage: A prune plan runs the audit before the doctrine lands, or the suite keeps teaching the old pattern.
- passage: A session copies the shape it sees in the files it joins, so the retire pass over the existing suite is what makes the authoring rules take.
