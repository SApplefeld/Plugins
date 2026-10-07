# Rationale ledger: brainstorming

This file is the rationale ledger for the documents the `brainstorming` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, plan doc, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/brainstorming/SKILL.md

This document is the kit's brainstorming skill: it governs the collaborative design conversation that precedes any new feature, project, or non-trivial change, and it ends by producing a written spec in `docs/plans/` that the executing-work skill runs on. It owns these moments: the pre-design memory and backlog recall, the scope check that splits an oversized request into sub-project specs, the one-question-at-a-time design dialog, the offer of the design council at a hard fork, the contract-surface scout sweep that derives files in scope, the plan sketch, the spec write and its indexing, the spec self-review with its blind read and plan review, the choice of commit model, the per-section model tier and locus assignment, the `Tests:` and document-review lines, the Fable-usage rules, and the frozen spec format and header contract. A session loads it as a `named-trigger`: the frontmatter says to use it when the operator wants to think through a problem before building, or on any substantial new effort without an existing spec, with phrases like "let's think through", "help me design", or "spec this out".

Extracted at `6bc07fb`: whole document (`skills.brainstorming.SKILL.md`). Amended by `docs/plans/claude-kit_goal-fit_spec_v1.md` section 1 on 2026-09-19 (C174 to C181 below) and section 4 on 2026-09-19 (C182 below). Amended on 2026-09-20 by `docs/plans/claude-kit_test-requirement-axis_spec_v1.md` section 2 (`W` entries below). Amended by `docs/plans/claude-kit_jev-coverage-check_spec_v1.md` section 3 on 2026-09-21 (C183 below). Amended by `docs/plans/claude-kit_prose-register_spec_v1.md` section 4 on 2026-09-22 (`P` entries below). Redrafted on 2026-09-26 by section 8 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, landed at `64340c18` with its fix round at `6f26f01a`, so every live entry's `passage:` line quotes the text at `6f26f01a` and the `flag:` lines record that pass's flags. Amended by `docs/plans/claude-kit_short-titles_spec_v1.md` section 1 on 2026-10-05 (D001 below).

### C001
- key: Explore the problem space in conversation with the operator, then capture the agreement as a spec for executing-work to run.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:8
- provenance: f8c0649 2026-06-10, the kit's founding commit, which consolidated the operator's prior working-pattern artifacts and narrates no incident.
- verdict: keep
- reason: Brainstorming owns the design conversation and the spec it produces per the ownership map, and no hook makes a session hold the conversation before writing a spec.
- passage: Explore the problem with me in conversation, then capture the agreement as a spec for the executing-work skill to run.

### C002
- key: Never delegate the design conversation itself to a subagent.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:8
- provenance: f8c0649 2026-06-10, the founding commit; no incident narrated.
- verdict: keep
- reason: The council's dispatches are an opted-in instrument whose advice returns to the conversation, so the bar does not conflict with them, and nothing mechanical stops a session from handing the dialog to an agent.
- passage: Never delegate the conversation itself to a subagent.

### C003
- key: Treat the design step as a conversation whose value is the back-and-forth, not a gate to clear.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:8
- provenance: f8c0649 2026-06-10, the founding commit; no incident narrated.
- verdict: retire
- landed: 16c5e61 section 28
- reason: Why C001 and C002 exist: a design run as a gate produces a spec nobody explored, and the operator wants the corners felt out together; the rules are obeyable without this, so the reason lives here. Retired as line 8's two middle sentences, the line reading 'Explore the problem space WITH me in conversation, then capture the agreement as a spec that the executing-work skill runs on. Never delegate the conversation itself to a subagent.'
- proposed: Delete "This is a conversation, not a gate. The value is the back-and-forth, feeling out all corners of the problem together." from line 8; the ledger entry for C003 carries the reason.
- baseline-test: yes

### C004
- key: Open the effort by running `memq recall`, which returns the whole memory store as one bounded digest.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:12
- provenance: f270e9c 2026-07-31 installed `memq recall` as the design-time opener when the memory system landed; fa5df56 2026-08-09 placed the backlog read after it.
- verdict: keep
- reason: No hook runs recall for a session (session-start.js carries no recall call), so the prose is the only thing that makes the digest reach the design.
- passage: Open with `memq recall`, which returns the whole memory store as one bounded digest.

### C005
- key: Consult the memory-system skill for what the recall digest contains and how to act on it.
- class: pointer
- source: plugins/grimoire/skills/brainstorming/SKILL.md:12
- provenance: f270e9c 2026-07-31, the memory system's install; the memory-system skill is the owner per the ownership map.
- verdict: keep
- reason: Already the pointer form the one-owner rule asks for.
- passage: The memory-system skill owns what it contains and how to act on it.

### C006
- key: Read the recall digest against the problem at hand and pull out what bears on it.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:12
- provenance: f270e9c 2026-07-31; reworded at fa5df56 2026-08-09 with the backlog-visibility plan.
- verdict: keep
- reason: The act that turns the digest into design input; nothing mechanical does it, and a design that ignores a recalled gotcha repeats it.
- passage: Read it against the problem and pull what bears on it.

### C007
- key: Run the memory recall before the code reading.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:12
- provenance: fa5df56 2026-08-09, the backlog-visibility plan, which fixed the order recall, backlog, code so parked solutions surface before a fresh design.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The order survives in C004's "Open with", C009's "next" and C013's "Then", so the standalone ordering sentence is a duplicate within the step and goes with C008's rationale in the same sentence. Retired with C008's sentence; the order survives in the step's own sequence ('Open with', 'next', 'Then'), and 'Read it against the problem at hand and pull what bears on it.' now runs straight into the backlog sentence.
- proposed: Handled by A007's deletion; no further edit.
- baseline-test: yes

### C008
- key: Recall first because it names the prior attempt or gotcha the code reading should look for, and a record you would never search for surfaces only in a full digest.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:12
- provenance: fa5df56 2026-08-09, written with the ordering it explains.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The why of recall-first: the digest tells the code read what to look for, and a keyword search never finds the record you did not think to search for; the order is obeyable from the step's sequence alone. Retired as the sentence 'This runs before the code reading, because it is what tells you which prior attempt or hard-won gotcha the code reading should be looking for, and because a record you would never have thought to search for only surfaces when the digest lists everything.' whole, with C007.
- proposed: Delete the "because it is what tells you ... when the digest lists everything" clauses with A007's sentence; the ledger entry for C008 keeps the why.
- baseline-test: yes

### C009
- key: Read `docs/backlog.md` next where it exists.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:12
- provenance: fa5df56 2026-08-09, the backlog-visibility plan (docs/archive/backlog-visibility_spec_v1.md): parked solutions were not surfacing before a fresh design.
- verdict: keep
- reason: The session-start hook reports only counts and dates from the backlog, never items, so the read is the only way a parked solution reaches the design.
- passage: Next read `docs/backlog.md` where it exists.

### C010
- key: Surface any backlog item bearing on the problem at hand, with its date.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:12
- provenance: fa5df56 2026-08-09, the backlog-visibility plan.
- verdict: keep
- reason: The date is what the 90-day aging pass keys on, and surfacing the item is what lets the operator decide whether the parked answer is the design.
- passage: Surface any item bearing on the problem, with its date,

### C011
- key: Surface bearing backlog items because the parked solution may already exist.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:12
- provenance: fa5df56 2026-08-09, the backlog-visibility plan.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The why of C010: a fresh design that ignores a parked solution rebuilds it; the duty is obeyable without the clause. Retired as the clause ', since the parked solution may already exist', the sentence reading 'surface any item bearing on the problem at hand, with its date, and name in the spec any backlog item this effort will cover'.
- proposed: Delete ", since the parked solution may already exist" from line 12.
- baseline-test: yes

### C012
- key: Name in the spec any backlog item this effort will cover, so the close-out prune retires it.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:12
- provenance: fa5df56 2026-08-09, the backlog-visibility plan, whose prune pass reads the spec for covered items.
- verdict: keep
- reason: The close-out prune (curating-docs) retires only items a plan names, so an unnamed covered item outlives the work that covered it.
- passage: name in the spec any item this effort covers, so the close-out prune retires it.

### C013
- key: Read the relevant code after the recall and backlog reads.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:12
- provenance: f8c0649 2026-06-10 founding text, sequenced after the backlog read at fa5df56 2026-08-09.
- verdict: keep
- reason: The step in the owned sequence, carrying the Explore vehicle; the doctrine's read-the-files bullet is the principle it instantiates.
- passage: Then read the relevant code per the doctrine's "Analyze, surface concerns, then propose before you build" bullet,

### C014
- key: Use the built-in Explore subagent for broad reconnaissance so the main context stays lean.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:12
- provenance: f8c0649 2026-06-10, founding text.
- verdict: keep
- reason: No finding; the vehicle is named nowhere else a session has loaded at step 1.
- passage: using the built-in Explore subagent for broad reconnaissance so the main context stays lean.
- flag: weak-reason

### C015
- key: Never design against guessed signatures or imagined architecture.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:12
- provenance: f8c0649 2026-06-10, founding text.
- verdict: retire
- reason: row 461 (Read real code via Explore), merge. The doctrine's "Analyze, surface concerns, then propose before you build" bullet carries it ("read the involved files and docs first. Check current library docs rather than guessing an unfamiliar signature"). The read-the-involved-files clause also covers imagined architecture.
- passage: Never design against guessed signatures or imagined architecture.

### C016
- key: Stamp a recalled record with `memq touch <name> --applied` in the same turn it changes the design.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:12
- provenance: f270e9c 2026-07-31, the memory system's applied-stamp ledger.
- verdict: keep
- reason: The CLI records a stamp only when the session issues it; no hook stamps on the session's behalf.
- passage: When a recalled record changes the design, stamp it that turn with `memq touch <name> --applied`.

### C017
- key: Gauge the size of the request before drilling into design questions.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:14
- provenance: 830ff28 2026-06-18, the scope check ported from a sibling fork plus session mining.
- verdict: keep
- reason: Nothing mechanical sizes a request, and a spec that should have been three is caught only here.
- passage: Before drilling into questions, split a request spanning independent subsystems, each with its own data and lifecycle and useful alone, into sub-project specs.
- flag: weak-reason

### C018
- key: Where the request spans multiple independent subsystems, name the pieces, their relations, and the build order, then split it into sub-project specs.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:14
- provenance: 830ff28 2026-06-18, the scope check.
- verdict: keep
- reason: The split's trigger and act; obeyable as written and enforced by no machinery.
- passage: Before drilling into questions, split a request spanning independent subsystems, each with its own data and lifecycle and useful alone, into sub-project specs. Name how they relate and the build order,
- flag: weak-reason

### C019
- key: Brainstorm the first sub-project through this process, and give each sub-project its own spec and its own execute and finish cycle.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:14
- provenance: 830ff28 2026-06-18, the scope check.
- verdict: keep
- reason: The clause the readers' compressions dropped; it is what stops a split from producing one umbrella spec with sub-headings.
- passage: then brainstorm the first through this process, and give each its own spec and its own execute and finish cycle.

### C020
- key: Decompose first because refining the details of something that should have been three specs is wasted.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:14
- provenance: 830ff28 2026-06-18, the scope check.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The why of C018's ordering: detail refined on the wrong decomposition is thrown away; the split rule is obeyable without it. Retired as line 14's closing sentence, the line ending at 'its own execute and finish cycle.'
- proposed: Delete "Decomposing first beats refining the details of something that should have been three specs." from line 14.
- baseline-test: yes

### C021
- key: Ask the question whose answer most changes the design.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:16
- provenance: f8c0649 2026-06-10, founding text; scoped to route (c) at e872098 2026-08-18.
- verdict: keep
- reason: The design dialog's pacing rule, owned here; the operator-decision gate it carries is genuine.
- passage: Ask the question whose answer most changes the design,

### C022
- key: Wait for the answer before asking the next question.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:16
- provenance: f8c0649 2026-06-10, founding text; the intake-gap-check plan (e872098, archived plan line 110) resolved the contest with the doctrine's batched ask by scoping this rule to the design conversation.
- verdict: keep
- reason: Intentionally different from the doctrine's mid-run batched ask; a session in the design conversation asks one at a time by design, and the recorded review Major settled which moment each rule owns.
- passage: and wait for the answer before the next.
- flag: weak-reason

### C023
- key: Do not front-load a questionnaire.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:16
- provenance: f8c0649 2026-06-10, founding text.
- verdict: retire
- landed: 16c5e61 section 28
- reason: C022 stated as a prohibition on the same line with no bound of its own; the questionnaire is the failure C022 already prevents. Retired as the sentence 'Do not front-load a questionnaire.', C022's rule standing before the intake-gap sentence.
- proposed: Handled by A027.
- baseline-test: yes

### C024
- key: Ask route (c) intake gaps one at a time inside this conversation rather than in the batched form used mid-run and at close-out.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:16
- provenance: e872098 2026-08-18, the intake-gap-check plan: a review Major found the doctrine's "asked, batched" and this step both claiming route (c), and brainstorming was scoped to the design conversation.
- verdict: keep
- reason: This is the sentence that records the intentional split, so removing it re-opens the contest the review closed.
- passage: This is how route (c) of the doctrine's intake gap check is asked here, rather than in the batch its mid-run and close-out asks use.

### C025
- key: Still enumerate the intake gaps; one-question-at-a-time is no license to skip the enumeration.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:16
- provenance: e872098 2026-08-18, the intake-gap-check plan.
- verdict: keep
- reason: The pointer's own carve-out at the owner (doctrine) of the enumeration: a model fills gaps silently, and the one-question pace must not become the excuse for never listing them.
- passage: It is no license to skip the enumeration.

### C026
- key: Answer route (a) and route (b) gaps yourself and declare them, rather than asking the operator.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:16
- provenance: e872098 2026-08-18, the intake-gap-check plan.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: The doctrine owns the three routes; drop the route glosses so the clause points ("routes (a) and (b) are answered by the session and declared, not asked") rather than carrying a partial copy that can drift from the owner's definitions. Lands at line 16 as 'and routes (a) and (b) are answered by the session and declared, not asked.', the route glosses gone; the doctrine's intake bullet defines the routes.
- proposed: (via A034) Reduce to "routes (a) and (b) are answered by the session and declared, not asked", dropping the route glosses; the doctrine's intake bullet defines them.
- baseline-test: yes
- passage: Routes (a) and (b) are answered by the session and declared, not asked.

### C027
- key: Feel out the corners: edge cases, failure modes, integration points, performance, consumers, re-run behavior, and existing solutions of a similar shape.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:18
- provenance: f8c0649 2026-06-10, founding text.
- verdict: keep
- reason: No finding.
- passage: **Feel out the corners.** Ask what happens on re-run (idempotency matters in this codebase).
- flag: environment

### C028
- key: Present options with their tradeoffs whenever a real decision exists.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:20
- provenance: f8c0649 2026-06-10, founding text.
- verdict: keep
- reason: "A real decision" is the route (c) gap; the same step's C026 already sends a low-blast default to decide-and-declare, so the doctrine's low-blast pick draws the same act under both surfaces.
- passage: **Present options with tradeoffs** when a real decision exists, per the doctrine's "At a fork, lead with your recommendation and the alternatives you weighed" bullet.

### C029
- key: State a recommendation and the reason for it.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:20
- provenance: f8c0649 2026-06-10, founding text.
- verdict: retire
- reason: row 466 (Options, recommendation, open disagreement), merge. The doctrine's Judgment bullet "At a fork, lead with your recommendation and the alternatives you weighed. Say why the others lose." carries it.
- passage: State a recommendation and the reason.

### C030
- key: Disagree openly with the operator's framing when warranted; give the arguments rather than agreement.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:20
- provenance: f8c0649 2026-06-10, founding text.
- verdict: retire
- reason: row 466, merge. The doctrine's Directness bullet "Disagree up front. If my plan or code is wrong, say so first, with the reason." carries it.
- passage: Disagree openly with my framing when warranted; I want the arguments, not agreement.

### C031
- key: Hold your position under pushback and move only on a new fact, never on tone.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:20
- provenance: 830ff28 2026-06-18, ported with the fork improvements.
- verdict: retire
- landed: 16c5e61 section 28
- reason: A partial copy of the doctrine's "Disagree up front" rule, which is always loaded and carries the bare-challenge re-verification bound this copy omits; a partial copy of an owner's rule is what the one-owner rule removes. Retired as the sentence 'Hold the position under pushback and move on a new fact, not on tone.'; the doctrine's 'Disagree up front' bullet carries the rule with the bare-challenge re-verification bound this copy omitted.
- proposed: (via A043) Delete "Hold the position under pushback and move on a new fact, not on tone." from line 20; the doctrine carries it.
- baseline-test: yes

### C032
- key: Offer the `design-council` skill before settling a hard fork 1:1.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:22
- provenance: f62fc16 2026-06-15 installed the council as an offer from brainstorming; dc87c38 2026-06-28 rebuilt the offer step after comparing against a sibling kit.
- verdict: keep
- reason: The ownership map has brainstorming own the offer and design-council own the run; the trigger with its four fork instances lives here.
- passage: offer the `design-council` skill before settling it 1:1. Such a fork is an architecture or schema choice, build-vs-buy, a migration direction, or a tradeoff expensive or awkward to undo.

### C033
- key: Offering costs one line the operator declines in a word, while running the council is token-intensive and slow.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:22
- provenance: dc87c38 2026-06-28, the reason given for lowering the offer bar.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The why of C034: the asymmetry between a one-line offer and a slow multi-agent run is what justifies erring toward the offer; C034 is obeyable without it. Retired as the sentence 'Offering is cheap, running is not: the offer is one line and I decline in a word, while the run is token-intensive and slow.'; the proposal's 'keeping "So err toward offering" as a plain instruction' is landed with the conjunction dropped and the capital moved, since the sentence it referred back to is the one this entry retires. Its landing respelled C034's keep sentence; C034 records the flip.
- proposed: Delete "Offering is cheap, running is not: the offer is one line and I decline in a word, while the run is token-intensive and slow." from line 22, keeping "So err toward offering" as a plain instruction.
- baseline-test: yes

### C034
- key: Err toward offering the council; lower the bar to offer, never the bar to run.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:22
- provenance: dc87c38 2026-06-28, a deliberate lowering of the offer bar.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: Real but minor contest with the council's "Offered only at genuine forks"; this later, deliberate rule at the offer's owner wins, and the council's envelope line is the side to bring current. Flipped from keep to rewrite at section 28's close: C033's retire took the sentence this one's opening 'So' referred back to, so the conjunction leaves and the sentence opens with a capital, and the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Err toward offering, and lower the bar to offer, never the bar to run.
- passage: Err toward offering, and lower the bar to offer, never the bar to run.

### C035
- key: Make the council offer in the turn you recognize the fork, not a later turn.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:22
- provenance: dc87c38 2026-06-28, the anti-deferral guard.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: Installed against a named failure (the deferred offer that never lands); nothing mechanical times the offer. Flipped from keep to rewrite at section 28's close: C036's retire took the quoted excuse after this sentence's colon, so the colon becomes a period, and the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Make the offer in the turn you recognize the fork, not a later one you control.
- passage: Make the offer in the turn you recognize the fork, not a later one you control.

### C036
- key: Deferring the offer to a later turn is precisely how the offer never gets made.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:22
- provenance: dc87c38 2026-06-28.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The why of C035, with the excuse quoted; the same-turn rule is obeyable without the quote. Retired as the clause ': "offer it later if the fork is still open" is precisely how it never gets offered', the colon becoming a period. Its landing respelled C035's keep sentence; C035 records the flip.
- proposed: Delete ': "offer it later if the fork is still open" is precisely how it never gets offered' from line 22.
- baseline-test: yes

### C037
- key: Do not auto-run the design council; name its cost so the operator can authorize the spend.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:22
- provenance: 830ff28 2026-06-18 added "Do not auto-run"; dc87c38 2026-06-28 made the cost generic so the session sizes the run at offer time.
- verdict: keep
- reason: The instruction has to sit where the session is at offer time, before the council skill is loaded; the gate it carries is the operator's decision on how much deliberation their fork is worth, and the doctrine's interrupt-only rule governs an agreed run, not the design dialog.
- passage: Do not auto-run it, and name the cost so I can authorize the spend.

### C038
- key: Stay in the 1:1 conversation if the operator declines the council.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:22
- provenance: dc87c38 2026-06-28, the rebuilt offer step.
- verdict: keep
- reason: The offer-time decline is brainstorming's moment; the council's decline-at-any-point covers the run it owns.
- passage: If I decline, stay in the 1:1 conversation.

### C039
- key: The council returns a converged recommendation or a cleanly-stated unresolved fork, and informs the operator's call rather than replacing it or the conversation.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:22
- provenance: f62fc16 2026-06-15, the council's install; restated here at dc87c38 2026-06-28.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The council's return contract and inform-never-decide rule are stated whole at design-council step 5, the owner; this copy adds nothing and the operator-decision gate survives at the owner. Retired as the sentence 'The council returns a converged recommendation or a cleanly-stated unresolved fork; it informs my call, never replaces it or the conversation.'; the owner carries it at `plugins/grimoire/skills/design-council/SKILL.md` line 40 at the landing ('The council informs the call; it never makes it.').
- proposed: (via A060) Delete "The council returns a converged recommendation or a cleanly-stated unresolved fork; it informs my call, never replaces it or the conversation." from line 22; design-council step 5 carries it.
- baseline-test: yes

### C040
- key: Treat the design council as offered, never as a default step.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:22
- provenance: dc87c38 2026-06-28, the closing sentence of the rebuilt step.
- verdict: retire
- landed: 16c5e61 section 28
- reason: Restates C037 three sentences earlier and the council's own opt-in check, with no bound of its own. Retired as line 22's closing sentence 'This is offered, not default.', the line ending at 'I can invoke it directly at any time.'
- proposed: (via A064) Delete "This is offered, not default." from line 22.
- baseline-test: yes

### C041
- key: Run one scout sweep returning every surface that speaks the contract, before the sketch, where the design changes a contract or a shared surface.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:24
- provenance: 83b81ac 2026-08-19, the boundary-cadence-and-spec-scope plan, from the 2026-08-18 spec-scope kaizen note: a seven-surface contract change shipped scoped to two, and probes showed a bare-change session finds 17 of 18 surfaces unprompted, so the fix site is spec authoring.
- verdict: keep
- reason: No hook derives Files in scope from the tree; the incident recurs on every contract change authored from memory.
- passage: Where a name, rule, or shape the change touches appears in more than one file, one scout sweep runs before the sketch and returns every surface that speaks that contract.

### C042
- key: Write the sections' "Files in scope" lists from what the sweep returns.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:24
- provenance: 83b81ac 2026-08-19, the spec-scope section.
- verdict: keep
- reason: The derivation duty at the step where the sweep returns; the template's annotated field is the slot 83b81ac's review required, not a second owner.
- passage: Write the sections' "Files in scope" lists from its return, and cite its searches and the surfaces they found in the Approach.

### C043
- key: Evaluate the sweep trigger without running the sweep: it fires when a name, rule, or shape the change touches appears in more than one file, and unsure counts as yes.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:24
- provenance: 83b81ac 2026-08-19; its review had found a trigger "undecidable at the moment it had to fire" in the sibling section, and this trigger is written to evaluate before the sweep.
- verdict: keep
- reason: The trigger's decidability is the reason it reads as it does; dropping the doubt rule re-opens the undecidable trigger.
- passage: Where a name, rule, or shape the change touches appears in more than one file, one scout sweep runs before the sketch and returns every surface that speaks that contract. Unsure counts as yes.

### C044
- key: Run the coverage sweep as its own second pass even where Explore already mapped the area; never substitute step 1's reconnaissance for it.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:24
- provenance: 83b81ac 2026-08-19, the spec-scope section.
- verdict: keep
- reason: Step 1 reads to understand and this reads for coverage; the incident's shape was a scope authored from what the author remembered from reconnaissance.
- passage: The sweep is its own second pass, reading for coverage, and runs even where Explore already mapped the area.

### C045
- key: Band the scout and state its return contract per `executing-work/SKILL.md`'s "Band the scout by question shape, and state its return contract".
- class: pointer
- source: plugins/grimoire/skills/brainstorming/SKILL.md:24
- provenance: 83b81ac 2026-08-19; the plan directed a pointer at executing-work's banding rather than a restatement.
- verdict: keep
- reason: Already the pointer at the owner the ownership map names for scouts.
- passage: Band it and state its return contract per `executing-work/SKILL.md`'s "Band the scout by question shape, and state its return contract", on the built-in Explore subagent carrying that band's explicit model override.

### C046
- key: Run the sweep through the built-in Explore subagent carrying that band's explicit model override.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:24
- provenance: 83b81ac 2026-08-19.
- verdict: keep
- reason: Names the vehicle and that the band's override rides, without naming a model, so it cannot drift from executing-work's banding.
- passage: Band it and state its return contract per `executing-work/SKILL.md`'s "Band the scout by question shape, and state its return contract", on the built-in Explore subagent carrying that band's explicit model override.

### C047
- key: Cite the sweep's return in the spec's Approach: the searches run and the surfaces they found.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:24
- provenance: 83b81ac 2026-08-19; the citation is what lets the self-review check coverage.
- verdict: keep
- reason: The step's duty to fill the Approach slot the template carries; the template line is the field's shape, not a second rule.
- passage: Write the sections' "Files in scope" lists from its return, and cite its searches and the surfaces they found in the Approach.

### C048
- key: Send the sweep's returned surfaces back through step 2's split check before any sketch where they span independent subsystems.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:24
- provenance: 83b81ac 2026-08-19.
- verdict: keep
- reason: The route by which a sweep that reveals an oversized effort reaches the split rule instead of a bloated spec.
- passage: Surfaces spanning independent subsystems go back through step 2's split check before any sketch.

### C049
- key: Authoring scope from memory is the anti-pattern: a contract change ships scoped to a fraction of the surfaces that speak it, the rest arriving one review round at a time.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:24
- provenance: 83b81ac 2026-08-19; the plan named this as the incident's evidence pattern (2026-08-18 kaizen note).
- verdict: retire
- landed: 16c5e61 section 28
- reason: The incident behind C041 and C042: a contract change shipped to two of seven surfaces and the rest surfaced one review round at a time; the rules are obeyable without the shape, which now lives here. Retired as line 24's closing sentence, the line ending at 'before any sketch.'
- proposed: Delete "Authoring scope from memory is the anti-pattern, and its shape is a contract change shipping scoped to a fraction of the surfaces that speak it, the rest arriving one review round at a time." from line 24.
- baseline-test: yes

### C050
- key: Present a short sketch first, covering goal, approach, and the sections of work, before writing the full spec.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:26
- provenance: f8c0649 2026-06-10, founding text.
- verdict: keep
- reason: Brainstorming states the sketch's contents and its agreed bound; the doctrine's concise-plan bullet points here.
- passage: Present a short sketch first: goal, approach, the sections of work.

### C051
- key: Redirecting at the sketch is cheap and redirecting after the full write-up is expensive.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:26
- provenance: f8c0649 2026-06-10, founding text.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The why of C050; the sketch-first rule is obeyable without it. Retired as the sentence 'Cheap to redirect here; expensive after the full write-up.', line 26 running from the sketch's parts to 'Iterate on the sketch until agreed.'
- proposed: Delete "Cheap to redirect here; expensive after the full write-up." from line 26.
- baseline-test: yes

### C052
- key: Iterate on the sketch until it is agreed.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:26
- provenance: f8c0649 2026-06-10, founding text.
- verdict: keep
- reason: The operator-decision gate on the expensive write; the design is the operator's call.
- passage: Iterate on it until agreed.
- flag: weak-reason

### C053
- key: Carry an `Assumptions` block naming the route (a) and route (b) items in plain words in the sketch and in every later recap the operator approves.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:26
- provenance: e872098 2026-08-18, the intake-gap-check plan: a declared assumption must never live only in a document because the operator approves plans from the recap without reading the doc.
- verdict: keep
- reason: Names the block, its contents and the artifacts that carry it, which the doctrine's "rides in the recap" leaves unspecified; the plan placed it here on purpose.
- passage: The sketch, and every later recap I approve, carries an `Assumptions` block naming the route (a) and route (b) items in plain words

### C054
- key: The operator's approval covers the declared assumptions, and a recap omitting the block has not shown the plan.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:26
- provenance: e872098 2026-08-18, the intake-gap-check plan.
- verdict: keep
- reason: Not motivation but the consequence acted on: an approval given on a block-less recap is not approval of the plan, which the block's duty alone does not say.
- passage: and my approval covers them.
- passage: A recap that omits the block has not shown the plan.

### C055
- key: Write the spec to `docs/plans/<project>_spec_v1.md`, incrementing the version where the name exists, and never overwriting a prior version.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:28
- provenance: f8c0649 2026-06-10, founding text; curating-docs became the owner of the plan doc's name at b49a47b 2026-06-19 and 662e5e3 2026-08-01.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: The instance with the content type filled as `spec`, sitting where the spec is written (662e5e3: a pointer only works in the skill loaded at the moment of the act); the three patterns agree once `spec` fills the slot. Flipped from keep to rewrite at section 28's close: Standing Brief Amendment 1 names this sentence's plan-file name form and orders it current to the doctrine's landed form (`<project>_<content-type>_v<n>.md`, the form `plugins/grimoire/skills/curating-docs/references/templates.md` states and the doctrine's plan-doc bullet points at), against this entry's own reason that `spec` filling the slot is right at the site where a spec is written, which the operator's decision batch holds as the question of the amendment's reach over a keep-held restatement, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: 9. **Write the spec** to `docs/plans/<project>_<content-type>_v<n>.md` (increment the version if the name exists; never overwrite a prior version).
- passage: **Write the spec** to `docs/plans/<project>_<content-type>_v<n>.md` (increment the version if the name exists; never overwrite a prior version).

### C056
- key: Invoke the `curating-docs` skill's create path and add the new plan to the `docs/README.md` index.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:28
- provenance: b49a47b 2026-06-19, Document Backlog Handling, which created curating-docs and this invocation.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: Keep the invocation and drop the restated steps; curating-docs owns the create path, and the restatement is the partial copy that lost the owner's archived-plan carve-out. Lands with C057 as one sentence, 'Then run the `curating-docs` skill's create path (index entry, cross-references, backlog next-steps).', the tagged line's replacement text; the untagged line's constraint holds, the gating-definition passage from 'One class of sentence is written against its exclusions' to the end of line 28 standing word for word, which is what keeps the bounded-artifact class sentence's parity pin verbatim.
- proposed: Apply A086; leave the gating-definition sentences as written.
- proposed: (via A086) Replace "Then invoke the `curating-docs` skill's create path: add the new plan to the `docs/README.md` index, and if it builds on or supersedes an existing plan, cross-reference both directions (a `## Related` section in the new plan, and a supersession note in the older plan's header)." with "Then run the `curating-docs` skill's create path (index entry, cross-references, backlog next-steps)."
- baseline-test: yes
- passage: Then run the `curating-docs` skill's create path (index entry, cross-references, backlog next-steps).

### C057
- key: Cross-reference both directions where the plan builds on or supersedes another: a `## Related` section in the new plan and a supersession note in the older plan's header.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:28
- provenance: b49a47b 2026-06-19; the archive became append-only with a one-way pointer at afc7790 2026-07-25, which this copy never absorbed.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: Real conflict with curating-docs's append-only archive where the older plan is archived; the owner is right, so the mechanics leave this document and ride the create-path pointer. Lands with C056 as one sentence, 'Then run the `curating-docs` skill's create path (index entry, cross-references, backlog next-steps).'; the cross-reference mechanics leave this document and ride the pointer.
- proposed: Handled by A086; the cross-reference mechanics leave this document.
- proposed: (via A086) Replace "Then invoke the `curating-docs` skill's create path: add the new plan to the `docs/README.md` index, and if it builds on or supersedes an existing plan, cross-reference both directions (a `## Related` section in the new plan, and a supersession note in the older plan's header)." with "Then run the `curating-docs` skill's create path (index entry, cross-references, backlog next-steps)."
- baseline-test: yes
- passage: Then run the `curating-docs` skill's create path (index entry, cross-references, backlog next-steps).

### C058
- key: A plan unfindable from the index and pointing at nothing it extends is half-written.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:28
- provenance: b49a47b 2026-06-19.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The why of indexing and cross-referencing, whose acts now point at curating-docs; a plan the index cannot reach is invisible to the next session. Retired as the sentence 'A plan no one can find from the index, that does not point at the work it extends, is half-written.', between the create-path pointer and the gating-definition passage.
- proposed: Delete "A plan no one can find from the index, that does not point at the work it extends, is half-written." from line 28.
- baseline-test: yes

### C059
- key: Write a gating definition against its exclusions rather than its paraphrase.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:28
- provenance: c18afce 2026-09-03, the gating-definitions plan: a coordination ledger reached 201 KB against a 35 KB ceiling because its admission rule was read as a membership test by one party and a description of state by the other, and the two readings paraphrased identically (operator memory test-a-gating-definition-by-crossing-not-by-disjoint-exclusions).
- verdict: keep
- reason: The class sentence is a parity-pinned copy shared with the blind-reader charter (test/doctrine-parity.test.js:6195) because a dispatched reader loads no skill; no hook checks a definition's exclusions. The test/doctrine-parity.test.js:6195 cite sits at the test named `the bounded-artifact class sentence reads the same on both gating surfaces` at the landing (declared near line 6218, the compared sentence built just below it); prefer the test name over the line.
- passage: A gating definition is written against its exclusions rather than its paraphrase. A gating definition is a phrase deciding what a bounded artifact admits, where a bounded artifact is a thing that holds content, keeps other content out, and cannot grow without limit, so a class of actions or of conditions is not one however cleanly it divides.

### C060
- key: A document, a ledger, a board, and a spec's own scope lists are instances of a bounded artifact rather than its boundary, so an artifact none of them names is still covered where it meets the definition.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:28
- provenance: c18afce 2026-09-03; the real run found the class sentence loose enough to stretch over classes of actions, and the bound was narrowed.
- verdict: retire
- reason: row 472 (Gating definition drafting rule), shrink. The instance list is argument. The class sentence in C059's landed passage still states the bound, and that bound covers any artifact meeting it.
- passage: A document, a ledger, a board and a spec's own scope lists are instances of that class rather than its boundary, and an artifact none of them names is covered wherever it meets the definition.

### C061
- key: Make a gating definition either close its set in the repo's idiom (`the set is closed at`, `a closed list of`) or name three things it excludes, in place.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:28
- provenance: c18afce 2026-09-03, the authoring form.
- verdict: keep
- reason: The blind reader's bar on printed exclusions was designed against this rule on purpose (a reader copying the printed list would make agreement automatic), so the two are one instrument, not a conflict.
- passage: It either closes its set in the repo's idiom (`the set is closed at`, `a closed list of`), or names in place at least three things it excludes.

### C062
- key: Where a gating definition is an enumeration followed by a trailing general clause, say whether that clause summarizes the examples or extends past them.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:28
- provenance: c18afce 2026-09-03; the founding incident's line had exactly this shape.
- verdict: keep
- reason: The two readings paraphrase identically, so only the author saying which the clause is separates them; nothing mechanical reads the form.
- passage: An enumeration followed by a trailing general clause says whether the clause summarizes the examples or extends past them.

### C063
- key: Where a definition resists both forms, apply the what-changes backstop: ask what a reader would do differently if the line were deleted.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:28
- provenance: c18afce 2026-09-03 (archived plan principle 1).
- verdict: keep
- reason: The backstop for the definition neither form fits; obeyable with C064's verdicts beside it.
- passage: Where a definition resists both forms, ask what a reader would do differently if the line were deleted: nothing marks decoration, and behavior you did not intend marks the defect.

### C064
- key: A line that changes nothing is decoration, and one that changes behavior the author did not intend is the defect this rule catches.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:28
- provenance: c18afce 2026-09-03.
- verdict: keep
- reason: The backstop asks a question and this sentence classifies its two answers; without it the backstop returns no verdict.
- passage: Where a definition resists both forms, ask what a reader would do differently if the line were deleted: nothing marks decoration, and behavior you did not intend marks the defect.

### C065
- key: Read the spec once with fresh eyes before handing it to executing-work and fix inline: placeholders, contradicting sections, two-way-readable requirements, and scope that drifted past the goal.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: 830ff28 2026-06-18, the spec self-review ported from session mining.
- verdict: keep
- reason: Names the defect classes and the timing; the doctrine's check-your-own-plan sentence is the principle, and no gate reads a spec for placeholders.
- passage: **Spec self-review.** Before handing the spec to executing-work, read it once and fix inline placeholders, contradictions, scope drift past the goal and requirements readable two ways, with no second inline pass.

### C066
- key: Check that every surface the step 7 sweep returned appears in some section's Files in scope or under `## Out of Scope`, and place any that appears in neither before the spec ships.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: 83b81ac 2026-08-19; its review found the rule "named an enforcement check that no site implemented", and this is that check.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: The author's check against the sweep's return; the plan reviewer's later check against the tree (ead49db) is a second instrument, not a replacement. Flipped from keep to rewrite at section 28's close: C067's retire took the because-clause between this sentence's lead and its colon, so the lead runs straight into the colon; the round's blind lens found the keep standing on a changed sentence, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Coverage is checked here: every surface step 7's sweep returned appears in some section's Files in scope or under `## Out of Scope`, and one appearing in neither is placed before the spec ships.
- passage: Coverage is checked here: every surface step 7's sweep returned appears in some section's Files in scope or under `## Out of Scope`, and one appearing in neither is placed before the spec ships.

### C067
- key: Coverage is checked at the self-review because that is where the whole spec is read at once and under-coverage is a property of the sections together.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: 83b81ac 2026-08-19.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The why of C066's timing: a per-section check cannot see a surface no section claims; the check is obeyable without it. Retired to 'Coverage is checked here: every surface', as the proposal reads. Its landing respelled C066's keep sentence; C066 records the flip.
- proposed: Reduce "Coverage is checked here, because this is where the whole spec is read at once and under-coverage is a property of the sections together: every surface" to "Coverage is checked here: every surface".
- baseline-test: yes

### C068
- key: Check that every claim the Goal paragraph makes is owned by some section's acceptance criteria, and give an unowned Goal sentence a section, record it under `## Operator Verification`, or strike it from the Goal.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: a5e184b 2026-08-25, the kaizen-batch plan (archived plan line 61: a goal-coverage question beside the files-in-scope one).
- verdict: keep
- reason: The author's Goal-outward check; the plan reviewer reads sections back against the Goal from a fresh context, and both stand.
- passage: Every claim the Goal makes is owned by some section's acceptance criteria. A Goal sentence no section delivers is given a section, recorded under `## Operator Verification` where only my action can deliver it, or struck from the Goal.

### C069
- key: The Goal check must happen at the self-review, because sections can cover every swept file and still leave a Goal promise unbuilt, and nothing downstream reads the Goal against what shipped.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: a5e184b 2026-08-25.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The why of C068's timing; its claim about a missing downstream check is the motivating-clause shape a5e184b's own review flagged as defect-prone, so it belongs in this ledger rather than in rule text. Retired as the sentence 'The Goal check survives the surface one, because the sections can cover every swept file and still leave a promise in the Goal unbuilt, and nothing downstream reads the Goal against what shipped, so it happens here or it happens nowhere.', the third-home sentence before it standing.
- proposed: Delete "The Goal check survives the surface one, because the sections can cover every swept file and still leave a promise in the Goal unbuilt, and nothing downstream reads the Goal against what shipped, so it happens here or it happens nowhere." from line 30.
- baseline-test: yes

### C070
- key: A defect caught at the self-review is a sentence to fix, while the same defect found mid-execution is rework.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: 830ff28 2026-06-18 installed the self-review step; this sentence's own install was not traced separately.
- verdict: retire
- landed: 16c5e61 section 28
- reason: A cost comparison with no act; the self-review's acts stand without it. Retired as the sentence 'A defect caught here is a sentence to fix; the same defect found mid-execution is rework.', 'The inline pass gets no second inline pass' following the third-home sentence directly.
- proposed: Delete "A defect caught here is a sentence to fix; the same defect found mid-execution is rework." from line 30.
- baseline-test: yes

### C071
- key: Give the inline pass no second inline pass: fix and move on.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: e872098 2026-08-18, the intake-gap-check plan's fresh read.
- verdict: keep
- reason: Bounds the inline pass so the blind read, not a second self-read, is what catches the gaps the session filled.
- passage: **Spec self-review.** Before handing the spec to executing-work, read it once and fix inline placeholders, contradictions, scope drift past the goal and requirements readable two ways, with no second inline pass.

### C072
- key: Run the blind read that follows the inline pass; it is separate and not optional.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: e872098 2026-08-18; its review found the first dispatch would have been refused by the reader's charter, which is why the dispatch is now fixed in words.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: No hook dispatches the reader; the trivial-spec skip is the rule's own carve-out. Flipped from keep to rewrite at section 28's close: C073's retire took the because-clause after this sentence's comma, so the comma becomes a period; the round's blind lens found the keep standing on a changed sentence, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: The blind read that follows is separate and is not optional.
- passage: The blind read that follows is separate and is not optional.

### C073
- key: The blind read is required because the inline read cannot catch a gap this session already filled while reading.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: e872098 2026-08-18.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The why of C072: a model cannot see the gaps it filled, so only a reader without the session's context finds them; C072 is obeyable without it. Retired to 'The blind read that follows is separate and is not optional.', as the proposal reads. Its landing respelled C072's keep sentence; C072 records the flip.
- proposed: Reduce "The blind read that follows is separate and is not optional, because the inline read cannot catch a gap this session already filled while reading." to "The blind read that follows is separate and is not optional."
- baseline-test: yes

### C074
- key: Before the blind-read dispatch goes out, record which phrases in the spec you count as gating definitions, their locations and nothing more.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03; the plan's rulings moved the author's record before the dispatch and then reduced it to locations when the comparison became crossing rather than list-versus-list.
- verdict: retire
- reason: row 478 (Gating litmus with paired members), dropped under the mechanism cut.
- passage: Before dispatching it, record which phrases in the spec you count as gating definitions, their locations and nothing more.
- ruled: cut 2026-09-30

### C075
- key: You wrote the definitions, so an exclusion list drafted now would be neither independent of them nor forgettable, and the comparison is built to need neither.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03 (archived plan line 98 and the consult that replaced disjoint lists with crossing).
- verdict: retire
- landed: 16c5e61 section 28
- reason: The why of "and nothing more": an author's own exclusion list is neither independent of the definitions nor forgettable, and the crossing comparison needs only the reader's pairs; C074 is obeyable as written. Retired as the sentence 'You wrote those definitions, so an exclusion list drafted now is neither independent of them nor forgettable, and the comparison below is built to need neither.', the record-your-definitions sentence running straight into the blind-reader dispatch.
- proposed: Delete "You wrote those definitions, so an exclusion list drafted now is neither independent of them nor forgettable, and the comparison below is built to need neither." from line 30.
- baseline-test: yes

### C076
- key: Dispatch the `blind-reader` agent with the spec itself as the document under review and `Reader: an implementer with no session context, engineer persona, may open the repository`.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: e872098 2026-08-18; the charter was split so a spec named as the subject is not contamination.
- verdict: keep
- reason: The exact dispatch shape the charter accepts, fixed after a faithful agent would have refused its only input.
- passage: Dispatch the `blind-reader` agent with the spec itself as the document under review and `Reader: an implementer with no session context, engineer persona, may open the repository`.

### C077
- key: Adjudicate each blind-read question one of three ways: answer it in the spec, declare it under `## Assumptions` and in the recap, or put it to the operator with a recommendation.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: e872098 2026-08-18, the three routes of the intake gap check applied to the reader's return.
- verdict: keep
- reason: The owner of the three-way adjudication that the plan-review sentence cites; the third route's hold is the operator's own design call.
- passage: Adjudicate each question it returns, and each pair its charter returns per gating definition, one of three ways: answer it in the spec, declare it under `## Assumptions` and in the recap, or put it to me with a recommendation.

### C078
- key: Record `blind read: <n> questions, <a> answered, <b> assumed, <c> asked` in the handoff recap.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: e872098 2026-08-18.
- verdict: keep
- reason: The recap line is how the operator sees that the read ran and what it produced; no hook writes it.
- passage: Record `blind read: <n> questions, <a> answered, <b> assumed, <c> asked` in the handoff recap.

### C079
- key: Expect the blind reader to return three pairs per gating definition as part of its own charter: a thing the rule admits, the nearest thing it keeps out, and the separating feature.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03; the plan ruled the litmus is carried by no dispatch field because three surfaces close the dispatch to paths and the `Reader:` line.
- verdict: keep
- reason: Says the contract lives in the charter, forbids the dispatch field a session might add, and supplies the vocabulary the comparison that follows uses.
- passage: and each pair its charter returns per gating definition

### C080
- key: Compare your recorded set of gating definitions against the reader's set first.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03.
- verdict: retire
- reason: row 478 (Gating litmus with paired members), dropped under the mechanism cut.
- passage: First compare the two sets of definitions.
- ruled: cut 2026-09-30

### C081
- key: Where one side counted a phrase as a gating definition and the other did not, rewrite that phrase until it either reads as a rule or plainly decides nothing, before the spec ships.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03.
- verdict: retire
- reason: row 478 (Gating litmus with paired members), dropped under the mechanism cut.
- passage: Rewrite a phrase only one side counted, before the spec ships, until it either reads as a rule or plainly decides nothing.
- flag: weak-reason
- ruled: cut 2026-09-30

### C082
- key: For each shared definition, place all six of the reader's members against your own reading, writing beside each a verdict of in, out, or cannot place, plus the clause of the definition that decides it.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03; two review rounds and a consult replaced disjoint exclusion lists with crossing, since two readers who agree still draw disjoint samples from an unbounded complement.
- verdict: retire
- reason: row 478 (Gating litmus with paired members), dropped under the mechanism cut.
- passage: Then place all six members of each shared definition against your own reading: in, out, or cannot place, with the clause that decides it.
- ruled: cut 2026-09-30

### C083
- key: Read each pair's separating feature and ask whether your own rule turns on that feature.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03; the real run reported that two readers differ in examples while converging on separating features.
- verdict: retire
- reason: row 478 (Gating litmus with paired members), dropped under the mechanism cut.
- passage: Then ask whether your rule turns on each pair's separating feature.
- ruled: cut 2026-09-30

### C084
- key: Cite the deciding clause because nothing mechanical stops you reading the reader's member into your rule after the fact, and a placement you cannot tie to a clause is a result rather than a pass.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The why of C082's clause requirement: an after-the-fact placement is unfalsifiable without the clause; the clause-less case is already classified in the Unplaced result, so the sentence's classification is not the only one. Retired as the sentence 'The clause citation is what keeps this honest, since nothing mechanical stops you reading the reader's member into your rule after the fact, and a placement you cannot tie to a clause is a result rather than a pass.', 'Four results follow, each with its act.' following the separating-feature sentence directly.
- proposed: Delete "The clause citation is what keeps this honest, since nothing mechanical stops you reading the reader's member into your rule after the fact, and a placement you cannot tie to a clause is a result rather than a pass." from line 30.
- baseline-test: yes

### C085
- key: On a crossed result, rewrite the definition before the spec ships.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03; crossing is the founding incident's signal (each side's exclusions sat inside what the other admitted).
- verdict: retire
- landed: 16c5e61 section 28
- reason: row 478 (Gating litmus with paired members), dropped under the mechanism cut.
- proposed: Crossed, meaning any member you place on the side opposite the reader, or a separating feature your rule does not turn on: the definition is rewritten before the spec ships.
- passage: Crossed: a member you place opposite the reader, or a separating feature your rule does not turn on. Rewrite the definition before the spec ships.
- ruled: cut 2026-09-30

### C086
- key: A crossed result is two rules wearing one sentence, which is the defect the whole check exists to catch.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The founding incident's description of what a crossing is; C085 names its trigger and act without it. Retired to 'Crossed, meaning any member you place on the side opposite the reader, or a separating feature your rule does not turn on: the definition is rewritten before the spec ships.', as the proposal reads. Its landing respelled C085's keep sentence; C085 records the flip.
- proposed: Reduce "Crossed, meaning any member you place on the side opposite the reader, or a separating feature your rule does not turn on: that is two rules wearing one sentence, which is the defect this whole check exists to catch, and the definition is rewritten before the spec ships." to "Crossed, meaning any member you place on the side opposite the reader, or a separating feature your rule does not turn on: the definition is rewritten before the spec ships."
- baseline-test: yes

### C087
- key: On an unplaced result, place the member by intent and rewrite the definition until its own text places it too, or, where the member is immaterial, record it as excluded under `## Assumptions` and in the recap in the fixed bullet form.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03; the gating plan's principle 5 (narrowing a rule is not complete until the narrowed-away case is placed) is the same doubt-falls-out rule.
- verdict: retire
- reason: row 478 (Gating litmus with paired members), dropped under the mechanism cut.
- passage: Unplaced: a member you cannot place, or place only without a clause to cite. Place it by intent and rewrite the definition until its own text places it too. An immaterial member is recorded instead as excluded under `## Assumptions` and in the recap, in the spec format's bullet form, so doubt falls out rather than in.
- ruled: cut 2026-09-30

### C088
- key: On an under-length result, rewrite the definition as well.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03, the gating-definitions plan installed the litmus's four results after a coordination ledger reached 201 KB against a 35 KB ceiling because its admission rule was read two ways.
- verdict: retire
- reason: row 478 (Gating litmus with paired members), dropped under the mechanism cut.
- passage: Under-length: fewer than three pairs with the reader's stated stopper. Rewrite the definition.
- ruled: cut 2026-09-30

### C089
- key: A pass, meaning all six placed as the reader placed them with clauses cited and features matched, is the ordinary result and costs nothing.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03, installed with the litmus as the fourth of its four results.
- verdict: retire
- reason: row 478 (Gating litmus with paired members), dropped under the mechanism cut.
- passage: Pass: all six placed as the reader placed them, clauses cited and features matched. It is the ordinary result and costs nothing.
- ruled: cut 2026-09-30

### C090
- key: Record `gating litmus: <n> definitions, <s> one-sided, <x> crossed, <p> unplaced, <u> under-length` in the handoff recap beside the blind-read line.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03, the litmus's record line, mirroring the blind-read line e872098 installed.
- verdict: retire
- reason: row 478 (Gating litmus with paired members), dropped under the mechanism cut.
- passage: Record `gating litmus: <n> definitions, <s> one-sided, <x> crossed, <p> unplaced, <u> under-length` in the handoff recap beside the blind-read line.
- ruled: cut 2026-09-30

### C091
- key: Record `gating litmus: none` for a spec carrying no gating definition.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03, installed with the record line so a silent absence is distinguishable from a skipped check.
- verdict: retire
- landed: 16c5e61 section 28
- reason: row 478 (Gating litmus with paired members), dropped under the mechanism cut.
- proposed: a spec carrying no gating definition records `gating litmus: none`.
- passage: A spec carrying no gating definition records `gating litmus: none`.
- ruled: cut 2026-09-30

### C092
- key: A spec that skipped the blind read skips the gating litmus too, and says so.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03, the litmus's skip clause, tied to the trivial-spec skip e872098 installed for the blind read.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: ead49db appended an identical skip clause for the plan review five days later; one sentence naming both dependents carries the same trigger and the same say-so duty without loss (A002). Lands merged with C103 at C103's site as 'A spec that skipped the blind read skips the gating litmus and the plan review with it, and says so;', the site chosen because the sentence names the plan review, which this entry's own site precedes; this entry's site keeps 'a spec carrying no gating definition records `gating litmus: none`.' and loses the skip clause after it, the comma becoming a period, which C091 records. Its landing respelled C091's keep sentence; C091 records the flip.
- proposed: (via A002) Merge C092 and C103 into one sentence: a spec that skipped the blind read skips the gating litmus and the plan review with it, and says so.
- baseline-test: yes
- passage: A spec that skipped the blind read skips the plan review with it, and says so.

### C093
- key: The instrument's known residual is that the reader's pairs may fall elsewhere than where two readings differ, passing silently; the separating feature is the second net, and the pairs' coverage of the boundary is not measured.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: c18afce 2026-09-03, recording the consult's finding that exclusions are an unbounded complement, so sampled pairs can miss where two readings differ.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The separating-feature act it motivates is stated on its own (C083) and the litmus is obeyed without the note. The limit it records: the pairs are samples of a boundary, not a measurement of it, so a pass is evidence rather than proof, and the separating feature is what exposes a divergent reading when the samples happen to coincide. Retired as the residual sentence, 'The instrument's known residual is that the reader's pairs may fall somewhere other than where two readings actually differ, in which case the check passes silently; the separating feature is the second net for that, because it exposes a reading even where the samples coincide, and the pairs' coverage of the boundary is not measured.', the plan-review lead following the litmus record sentence directly.
- proposed: Delete the residual sentence from step 10; this ledger carries the instrument's limit under C093.
- baseline-test: yes

### C094
- key: Run the plan review after the gating litmus and before the handoff recap.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: ead49db 2026-09-08, section 2 of the plan-review-and-recap plan, which added a fresh-context read of a spec against its own Goal before arming.
- verdict: keep
- reason: no finding. The order is the design: the litmus fixes the definitions the reviewer will read against, and the recap reports the review's result.
- passage: **The plan review follows the blind read and precedes the handoff recap.**

### C095
- key: Dispatch the `plan-reviewer` agent with the spec path alone, never the design conversation, at dispatch table row "Plan review" on executing-work's Reviewer Dispatch template.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: ead49db 2026-09-08, which set the charter's frontmatter effort to low for the Agent-tool fallback and routed the default dispatch through Workflow to reach high.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: The apparent conflicts with the consult's Agent-tool default and the charter's frontmatter low are one design: each judge's default route is whichever delivers Fable at high given its own frontmatter effort (A005). Brainstorming owns the dispatch; the charter's copy is the receiving side. Flipped from keep to rewrite at section 28's close: C096's retire took the clause after this sentence's semicolon, so the semicolon becomes a period, and the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Dispatch the `plan-reviewer` agent with the spec path alone, never the design conversation, at fable and effort high through Workflow's `agent()` on executing-work's Reviewer Dispatch template.
- passage: Dispatch the `plan-reviewer` agent with the spec path alone, never the design conversation, at dispatch table row "Plan review" on executing-work's Reviewer Dispatch template, after executing-work's capacity reading.

### C096
- key: The doctrine's standing Workflow grant covers the plan review, a read-only agent whose effort the Agent tool cannot set, and the plan review is none of executing-work's per-section rows.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: ead49db 2026-09-08, written to pre-empt a reader taking the Workflow route as a departure from executing-work's per-section effort table.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The doctrine's standing-dispatch bullet defines the covered class and C095 states the route outright, so the dispatch is obeyed without the argument. The why: the plan review sits in no per-section row, so lifting a Fable dispatch above its frontmatter effort through Workflow is the plan review's own rule rather than an exception to the table. Retired as the clause after the dispatch sentence's semicolon, from 'the doctrine's standing Workflow grant covers it' to 'rather than a departure from that table', the semicolon becoming a period. Its landing respelled C095's keep sentence; C095 records the flip.
- proposed: Delete the "the doctrine's standing Workflow grant covers it ... rather than a departure from that table" clause; the ledger entry for C096 carries why the route lifts the effort above the frontmatter value.
- baseline-test: yes

### C097
- key: Where Workflow is unavailable, dispatch the plan reviewer through the Agent tool at `model: 'fable'` and the charter's frontmatter effort, and record the effort it ran at beside the row's.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: ead49db 2026-09-08, the fallback route the frontmatter low exists for.
- verdict: keep
- reason: no finding. The record of the lower effort is what keeps the section from reading as reviewed at the tier the skill names.
- passage: Without Workflow, use the Agent tool at `model: 'fable'` and the charter's frontmatter effort, and record the effort it ran at beside the row's.

### C098
- key: Where fable cannot be run at all, or executing-work's capacity reading returned `-> downgrade`, wait rather than substitute a lower model, and record the wait.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: ead49db 2026-09-08, applying the operator's 2026-08-18 ruling (operator memory model-tier-substitution-for-review) that design and planning work specced at the top tier waits rather than dropping to Opus at max; docs/plans/claude-kit_capacity-gate_spec_v1.md section 4 2026-09-24 extended the wait to a measured downgrade.
- verdict: keep
- reason: The consult's Opus-at-max stand-in and this wait are the same ladder applied to two shapes of work: review-shaped substitutes, design-shaped waits, because design strength is the axis the tiers diverge on (A009).
- passage: Where fable cannot run at all, or that reading returned `-> downgrade`, wait rather than substitute a lower model, and record the wait.

### C099
- key: On a `NEEDS_CONTEXT` return, repair the Goal the reviewer could not read against and dispatch again.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: ead49db 2026-09-08, matching the charter's rule that a review against an invented goal reports the invention.
- verdict: keep
- reason: no finding. A Goal the reviewer cannot read is a spec defect, and re-dispatching without repairing it repeats the return.
- passage: On a `NEEDS_CONTEXT` return, repair the Goal it could not read against and dispatch again.

### C100
- key: Adjudicate each plan-review finding the same three ways as a blind-read question: fix it in the spec, declare it under `## Assumptions` and in the recap, or put it to the operator with a recommendation.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: ead49db 2026-09-08, reusing the three routes e872098 installed for blind-read questions, which are the doctrine's intake gap routes.
- verdict: keep
- reason: Brainstorming owns the adjudication per the ownership map; the third route is an operator-decision gate on a material spec gap, not loop maintenance (A012).
- passage: Adjudicate each finding the same three ways as a blind-read question.

### C101
- key: Rewrite the spec on a Critical finding before it ships, and treat one re-dispatch after that rewrite as the author's call rather than a loop.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: ead49db 2026-09-08, bounding the review to one optional re-dispatch so the plan review cannot become a review loop.
- verdict: keep
- reason: no finding. The one-re-dispatch bound is the loop guard; without it a Critical could cycle indefinitely at design time.
- passage: A Critical rewrites the spec before it ships, and one re-dispatch after that rewrite is the author's call rather than a loop.

### C102
- key: Record `plan review: <n> findings, <a> fixed, <b> assumed, <c> asked` beside the blind-read line.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: ead49db 2026-09-08, the plan review's record line beside the blind-read and litmus lines.
- verdict: keep
- reason: no finding. The three record lines together are the recap's evidence that step 10 ran whole.
- passage: Record `plan review: <n> findings, <a> fixed, <b> assumed, <c> asked` beside the blind-read line.

### C103
- key: A spec that skipped the blind read skips the plan review too, and says so.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: ead49db 2026-09-08, appended as the plan review's own skip clause beside the litmus's.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: Merges with C092 into one skip sentence naming both dependents (A002); the trigger and the say-so duty are identical. Lands as the merged skip sentence at this entry's site, 'A spec that skipped the blind read skips the gating litmus and the plan review with it, and says so;', C092's tagged proposal supplying the wording and this reason the merge; the external-engine clause after the semicolon stands.
- passage: A spec that skipped the blind read skips the plan review with it, and says so.

### C104
- key: A session that cannot dispatch records the plan-review skip under `## Assumptions`, and the external engine's own review stands in.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:30
- provenance: ead49db 2026-09-08, the external-engine carve-out matching executing-work's stand-down.
- verdict: keep
- reason: no finding. A worker under an external engine cannot dispatch, and the recorded skip is what keeps the spec from reading as reviewed.
- passage: A session that cannot dispatch (a worker under an external engine) records the skip under `## Assumptions`, and that engine's own review stands in.

### C105
- key: Agree the commit model with the operator and record it in the spec header.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:32
- provenance: no provenance found (the sentence dates from 656310e 2026-06-10, whose message states no reason; 83b81ac last touched the line).
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: ebd12d2 made Commit-and-Push the default with no ask and the header its record, so "agree" read as a separate question contradicts the history; the agreement is the sketch or recap approval that covers the header (A013). The three definitions beneath it stay because the author picks among them here. Lands as step 11's lead, '11. **Record the commit model in the spec header:** Commit-and-Push unless I name another, and the sketch approval covers it.', the three definitions beneath it; the old lead 'Agree on the commit model' is named by no file under `plugins/`, `home/`, `docs/`, `test/` or `README.md` (grep at the landing), so no pointer moves with it.
- proposed: (via A013) Reword step 11's lead to "Record the commit model in the spec header: Commit-and-Push unless I name another, and the sketch approval covers it", keeping the three definitions beneath it.
- baseline-test: yes
- passage: **Record the commit model in the spec header:** Commit-and-Push unless I name another, and the sketch approval covers it.
- flag: stale

### C106
- key: Under Review-Only, accumulate changes staged as sections complete and let `git diff --staged` be the operator's review surface before anything is committed.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:33
- provenance: 830ff28 2026-06-17, the fork port that made the three commit models the kit's set; a8770b3 reworded it to first person.
- verdict: retire
- reason: row 481 (Commit model in header), merge. Executing-work's step 7 bullet "**Review-Only:** stage the section's changes (`git add`); never commit. ... `git diff --staged` is my review surface." carries it, beside `curating-docs/SKILL.md`'s Commit Model contract row.
- passage: **Review-Only:** changes accumulate staged as sections complete, and `git diff --staged` is my review surface before anything is committed.

### C107
- key: Under Branch-and-PR, do the work on a feature branch and have finishing-work open a pull request.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:34
- provenance: ebd12d2 2026-09-02, which removed the repository-ownership routing from this entry after reviewers found two adjacent list members each declaring themselves the default.
- verdict: retire
- reason: row 481, merge. Executing-work's step 7 bullet "**Branch-and-PR:** commit the section's code with its Chapter to the feature branch" and finishing-work's step 7 "Apply the commit model" carry it.
- passage: **Branch-and-PR:** work happens on a feature branch and finishing-work opens a pull request.

### C108
- key: Under Commit-and-Push, commit and push to origin as sections complete, and have finishing-work merge any concurrency-forced worktree branch to main and tear it down.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:35
- provenance: ebd12d2 2026-09-02, the flip of the default to Commit-and-Push; the worktree clause is the finishing-work integration rule from 830ff28.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: The worktree-merge clause is finishing-work's integration act, restated whole by executing-work at its step; a chooser does not need it (A023). The motto "land it on main and leave no mess" is referenced at test/doctrine-parity.test.js:5444 and stays. Lands as '"land it on main and leave no mess." Commit and push to origin as sections complete.', the worktree-merge clause gone; the motto stays on the one line that performs the integration, which is what the `INTEGRATION_EXEMPT` anchor `land it on main and leave no mess` in `test/doctrine-parity.test.js` requires (the test named `every kit procedure performing a git integration names that action's lane or states its exemption`), and the test/doctrine-parity.test.js:5444 cite in this reason and its proposal sits at that anchor at the landing; prefer the anchor over the line.
- proposed: (via A023) Drop "if concurrency forced a worktree branch, finishing-work merges to main and tears it down" from the Commit-and-Push definition; keep the quoted motto and the commit-and-push-as-sections-complete clause, since test/doctrine-parity.test.js:5444 references the motto.
- baseline-test: yes
- passage: Commit-and-Push is "land it on main and leave no mess."
- flag: stale

### C109
- key: Choose Commit-and-Push by default when authoring a plan, and record that choice in the header.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:35
- provenance: ebd12d2 2026-09-02, the operator's ruling that commit and push are the default with no repository-ownership test, placed here because a header rule reaches an author only in the skill loaded at writing time (662e5e3).
- verdict: retire
- landed: 16c5e61 section 28
- reason: row 481, merge. C105's landed lead "Commit-and-Push unless I name another" carries the default, as does the doctrine's "Commit and push are the default".
- proposed: End the Commit-and-Push bullet with "The default choice when authoring a plan, which the header then records; another model takes a header or a direction that names it."
- baseline-test: yes
- passage: It is the default when authoring a plan, and the header records it. Another model needs a header or a direction that names it.

### C110
- key: Ask the operator rather than assuming the default where a plan doc carries no commit model the kit defines.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:35
- provenance: ebd12d2 2026-09-02, the ask that keeps a malformed header from licensing a push.
- verdict: retire
- landed: 16c5e61 section 28
- reason: A missing model is a state a run meets, never one an author produces at step 11, and the doctrine states the ask whole with its no-plan-doc carve-out and pins it; the gate is blast-radius and stays in the doctrine (A028, A030). Retired as the clause 'a plan doc carrying no commit model the kit defines takes the ask rather than this default, and', the bullet's closing sentence reading as C109's proposal has it; the doctrine carries the ask whole at `plugins/grimoire/skills/operating-instructions/SKILL.md` line 132 at the landing ('A plan doc whose commit model is absent or reads as none of the three the kit defines takes the ask too').
- proposed: (via A028) Delete "a plan doc carrying no commit model the kit defines takes the ask rather than this default" from the Commit-and-Push bullet; the doctrine's push-authorization bullet carries it.
- baseline-test: yes

### C111
- key: Assign a model tier to each Section of Work.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:37
- provenance: 9e124f7 2026-06-11, "Subagent Model Direction": offer cheaper models where scope and controls are well designed, keep review high.
- verdict: keep
- reason: The duty and the template's Model: field are one instruction and its recorded form; the ownership map gives the tier bands to brainstorming (A031).
- passage: **Assign a model tier to each Section of Work.**

### C112
- key: Implementation cost scales with the model, and quality is protected by spec precision plus strong-model review rather than by using the strongest model for every keystroke.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:37
- provenance: 9e124f7 2026-06-11, the founding reasoning of the tier scheme.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The tier duty and definitions are obeyed without it. The why: tiers exist because cost scales with model while quality is guarded by spec precision and by review one tier up, which is executing-work's reviewer rule. Retired as step 12's second sentence, the lead running straight into 'Tier picks the model; briefability picks the locus (dispatch versus main thread).'
- proposed: Delete "Implementation cost scales with the model; quality is protected by spec precision plus strong-model review, not by using the strongest model for every keystroke."
- baseline-test: yes

### C113
- key: Let tier pick the model and briefability pick the locus (dispatch versus main thread).
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:37
- provenance: b510edc 2026-07-01, which split model tier from locus and added implementer-fable.
- verdict: keep
- reason: The headline that names the two axes before the tier list; C121 carries the mechanic and C129 folds into it (A035).
- passage: Tier picks the model. Briefability picks the locus (dispatch versus main thread).

### C114
- key: Assign haiku only to pure transcription: an exact sibling to clone with substitutions, single-responsibility scope, and a self-surfacing gate, such as renames, sweeps, mirrored config or DTO additions, test data, and pin-test count updates.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:38
- provenance: 20cf885 2026-07-03, the haiku transcription tier added as cost structure ahead of a heavy-usage week, tracked as a provisional experiment.
- verdict: keep
- reason: The bound and the sonnet fallback were installed together and the fallback adds the judgment-call clause; no machinery assigns tiers (A037).
- passage: **haiku:** pure transcription: an exact sibling to clone with substitutions, single-responsibility scope, and a self-surfacing gate, a build or existing test that fails loudly on wrong output. Renames and sweeps, config or DTO additions mirroring a named sibling, test data, pin-test count updates. Assign it only where the section text names both the sibling and the gate.

### C115
- key: Assign `sonnet` instead of haiku to any section that leaves the sibling or the gate to be found, or that contains any judgment call.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:38
- provenance: 20cf885 2026-07-03, installed with the haiku tier as where a failed haiku assignment lands.
- verdict: keep
- reason: Names the fallback tier and the judgment-call exclusion the bound does not; the compress proposals are taste (A039).
- passage: A section that leaves either to be found, or holds any judgment call, is `sonnet`.

### C116
- key: Assign sonnet to mechanical or well-bounded work: clear contract, existing sibling pattern, single-responsibility scope, low integration risk, such as new procs or services, mappings, DTOs, tests, and CRUD surfaces.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:39
- provenance: 9e124f7 2026-06-11, the original sonnet band.
- verdict: keep
- reason: Describes dispatched work; the inline case takes C124's specific rule, so the two do not contend (A040).
- passage: **sonnet:** mechanical or well-bounded: a clear contract, an existing sibling pattern, single-responsibility scope, low integration risk. New procs or services on an established shape, mappings, DTOs, tests, CRUD surfaces.

### C117
- key: Assign opus to moderate complexity: multi-file coordination, nuanced refactors, performance-sensitive logic, or mild ambiguity within a clear design.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:40
- provenance: 9e124f7 2026-06-11, the original opus band.
- verdict: keep
- reason: no finding. The band between sonnet's mechanical shape and fable's novel one.
- passage: **opus:** moderate complexity: multi-file coordination, nuanced refactors, performance-sensitive logic, mild ambiguity within a clear design.
- flag: weak-reason

### C118
- key: Assign fable where the strongest model is needed: novel logic, security-sensitive surfaces, cross-cutting architecture, or subtle correctness.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:41
- provenance: abe0481 2026-07-02, the fable-metering close that reconciled the fable tier's wording with the override contract; the tier itself dates from b510edc.
- verdict: keep
- reason: no finding. The top band; with 53d9040 the tier is a model choice and never a spend decision.
- passage: **fable:** the strongest model: novel logic, security-sensitive surfaces, cross-cutting architecture, subtle correctness.

### C119
- key: Dispatch a fable-tier section to `implementer-fable`, which inherits the session model or takes an explicit `fable` override from a below-fable session.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:41
- provenance: abe0481 2026-07-02, which named the override mechanism (the model parameter on the Agent dispatch) after b510edc's inherits-the-session-model framing left the below-fable case unstated.
- verdict: keep
- reason: no finding. The inherit-or-override pair is what lets the top tier track the current model without a pin.
- passage: Dispatches to `implementer-fable`, which inherits the session model or takes an explicit `fable` override from a below-fable session.

### C120
- key: Put locus on its own line, never on the `Model:` line.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:42
- provenance: c2114e9 2026-08-01, after the decorated value "fable (inline)" was found to silently downgrade sections to sonnet under the external engine's parser (662e5e3).
- verdict: keep
- reason: The authoring rule at the moment the line is written; curating-docs' row records the parser fact and C140's back-reference is the copy that trims (A041, A042).
- passage: **Locus rides on its own line, never on the `Model:` line.**

### C121
- key: Give a section that cannot be briefed a `Locus: inline` line beneath its `Model:` line.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:42
- provenance: c2114e9 2026-08-01, the line that replaced the decorated tier value.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: Absorbs C129's "at any tier" so the briefability-decides-locus mechanic is stated once with its two failure cases (A035). Lands at line 42 as 'A section that cannot be briefed at any tier (the spec itself is likely to evolve in contact with the code, or the section is so small the brief would cost more than the work) carries `Locus: inline` beneath its `Model:` line.', C129's 'at any tier' folded in, and C129's clause gone from line 46. Its landing respelled C128's keep sentence; C128 records the flip.
- proposed: (via A035) Fold "at any tier" into C121's sentence at line 42 and delete C129's clause from line 46, leaving "Write to that standard or assign a higher tier" to follow the briefability test directly.
- baseline-test: yes
- passage: A section that cannot be briefed at any tier, because the spec will evolve in contact with the code or the brief would cost more than the work, carries `Locus: inline` beneath its `Model:` line, and is otherwise dispatched.

### C122
- key: Dispatch a section that carries no `Locus:` line.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:42
- provenance: c2114e9 2026-08-01, the omission semantics executing-work routes on.
- verdict: keep
- reason: The template field states its own omission meaning for the author and the process rule states the routing default; both were installed together (A047).
- passage: A section that cannot be briefed at any tier, because the spec will evolve in contact with the code or the brief would cost more than the work, carries `Locus: inline` beneath its `Model:` line, and is otherwise dispatched.

### C123
- key: Treat inline as the deliberate exception and the escalation ceiling, never the comfortable default, because the main thread is the most expensive place to write code.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:42
- provenance: dc128d8 2026-07-01, which tuned the kit for Fable as the session model and installed the dispatch default in the doctrine with the same reason; the escalation-ceiling fact is b510edc's.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: The reason clause is the doctrine's "Orchestration mechanics" bullet verbatim and the doctrine owns it; the exception-and-ceiling rule is brainstorming's and stays (A049). Lands as 'Inline is the deliberate exception and the escalation ceiling, never the comfortable default.', the main-thread-cost clause gone to the doctrine's owner sentence.
- proposed: (via A049) Reduce the sentence to "Inline is the deliberate exception and the escalation ceiling, never the comfortable default", dropping ": the main thread is the most expensive place to write code".
- baseline-test: yes
- passage: Inline is the deliberate exception and the escalation ceiling, never the comfortable default.

### C124
- key: Write `Model:` as the model that will actually run, so an inline section on the Opus-led execution session is `Model: opus`.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:44
- provenance: c2114e9 2026-08-01, after "fable (inline)" was found never to deliver Fable because the main thread runs at the session model.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: The specific rule for the inline case; the tier bands describe dispatched work (A040). Flipped from keep to rewrite at section 28's close: C125's rewrite recast line 44 as three rules and states this one's first as its proposal words it, so the 'Opus-led' naming and the main-thread-is-the-session clause leave this sentence (the first surviving at line 54, the second leaving the document with C147), and the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: `Model:` names the model that will actually run, so an inline section on the execution session is `Model: opus`.
- passage: `Model:` is a bare token naming the model that will actually run, with the reasoning in the section body, so an inline section on the execution session is `Model: opus`.

### C125
- key: Question rather than write the combination of `fable` plus `inline`.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:44
- provenance: c2114e9 2026-08-01, the corollary of C124 and the Fable-led-session-is-for-design rule.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: The paragraph recasts as its three rules once C126's parser rationale moves here (A051); the rule itself stands. Lands as line 44's three sentences: '`Model:` names the model that will actually run, so an inline section on the execution session is `Model: opus`. `fable` plus `inline` is a combination to question rather than write, since a Fable main thread exists only on a design session. Keep the value a bare token and put the reasoning in the section body.' The framing sentence 'Two reasons the two axes stay on separate lines, and both bite in practice.', the ordinals 'First,' and 'Second,' and the tail ', where a reader wants it anyway' leave with the recast, C126's sentence leaving beside them. Its landing respelled C124's keep sentence; C124 records the flip. Its landing respelled C127's keep sentence; C127 records the flip.
- proposed: Recast line 44 as three rules: Model: names the model that will actually run, so an inline section on the execution session is Model: opus; fable plus inline is a combination to question rather than write, since a Fable main thread exists only on a design session; keep the value a bare token and put the reasoning in the section body.
- baseline-test: yes
- passage: Question `fable` plus `inline`, since a Fable main thread exists only on a design session.

### C126
- key: An external engine parses the `Model:` line and accepts only bare tokens, silently substituting a default, so a decorated value or trailing rationale downgrades the section with no error anywhere.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:44
- provenance: 662e5e3 2026-08-01 found the engine downgrading decorated values to sonnet with no error, and c2114e9 2026-08-01 wrote the fact here as the bare-token rule's reason.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The bare-token rule is obeyed without it and curating-docs' section-model row, which brainstorming points at, states the failure mode as the owner. The why: the engine's parser accepts only the four bare tokens and substitutes sonnet silently for anything else. Retired as the sentence 'Second, an external engine parses the `Model:` line and accepts only the bare tokens, silently substituting a default for anything else, so a decorated value or a trailing rationale downgrades the section with no error anywhere.', with line 44's framing sentence and its ordinals under C125's recast; the bare-token rule stands as that recast's third sentence.
- proposed: Delete the "an external engine parses the Model: line ... with no error anywhere" clause; the ledger and the curating-docs row carry the failure mode.
- baseline-test: yes

### C127
- key: Keep the `Model:` value a bare token and put the reasoning in the section body.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:44
- provenance: c2114e9 2026-08-01, the authoring rule for the value the engine parses.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: The instruction stays in the skill loaded at writing time (662e5e3's reasoning); curating-docs owns the values, and C126's rationale leaves (A054). Flipped from keep to rewrite at section 28's close: C125's recast of line 44 dropped the tail ', where a reader wants it anyway' after this sentence's last clause, so the sentence ends at 'section body'; the round's blind lens found the keep standing on a changed sentence, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Keep the value a bare token and put the reasoning in the section body.
- passage: `Model:` is a bare token naming the model that will actually run, with the reasoning in the section body, so an inline section on the execution session is `Model: opus`.

### C128
- key: Give a section a cheap tier only if its spec is precise enough for an implementer with no conversation context to build it from the section text alone.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:46
- provenance: 9e124f7 2026-06-11, the briefability test; d66c58d 2026-08-23 last reworded the line.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: The test and its remedy (C130) are one rule with two moves; compression is taste (A056, A057). Flipped from keep to rewrite at section 28's close: C129's fold into C121 took the clause after this sentence's semicolon, so the semicolon becomes a period, and the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: A section only earns a cheap tier if its spec is precise enough that an implementer with no conversation context can build it from the section text alone.
- passage: A section earns a cheap tier only if an implementer with no conversation context could build it from the section text alone.

### C129
- key: Use the same briefability test to decide locus, and give `Locus: inline` to a section that fails it at any tier.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:46
- provenance: c2114e9 2026-08-01, restating C121 beside the briefability test.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: Its only addition to C121 is "at any tier", which folds into C121; the third statement of briefability-decides-locus leaves line 46 (A035). Lands folded into C121's sentence at line 42 as 'at any tier'; its own clause, '; the same test decides locus, and a section that fails it at any tier is the one that earns `Locus: inline`', leaves line 46, 'Write to that standard or assign a higher tier' following the briefability test directly. Its landing respelled C128's keep sentence; C128 records the flip.
- passage: A section that cannot be briefed at any tier, because the spec will evolve in contact with the code or the brief would cost more than the work, carries `Locus: inline` beneath its `Model:` line, and is otherwise dispatched.

### C130
- key: Write the section to that briefable standard, or assign it a higher tier.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:46
- provenance: 9e124f7 2026-06-11, the remedy when the briefability test fails.
- verdict: keep
- reason: The remedy is not the test restated; neither states the other (A056).
- passage: Write to that standard or assign a higher tier.

### C131
- key: Treat tier assignments as planning-time recommendations that executing-work may upgrade after a failed attempt or environment fault, and never downgrade mid-effort.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:46
- provenance: 9e124f7 2026-06-11 installed upgrade-only; d66c58d 2026-08-23 added the environment-fault trigger and assigned which upgrade to executing-work after three Fable reviewers wedged for 4.7 hours.
- verdict: keep
- reason: The boundary between planning-time tiers and execution-time escalation; downgrade is barred because it silently lowers the review a section earned (A057).
- passage: Tiers are planning-time recommendations. Executing-work may upgrade one after a failed attempt or an environment fault, and owns which, but never downgrades one mid-effort.

### C132
- key: Give a section carrying real behavioral risk a `Tests:` line naming the behaviors that earn a test and the risk driving each, in both directions where a guard or flag is involved.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:48
- provenance: da1a895 2026-07-14, extracted from the BMAD Test Architect idea after adjudicating its confinement risk; 4247725 2026-08-27 pointed it at testing-discipline and pinned the pointer.
- verdict: keep
- reason: The line's three constraints are its boundary against confining the implementer, and the pointer phrase is pinned at test/doctrine-parity.test.js:3871 (A059). The test/doctrine-parity.test.js:3871 cite sits at the test named `the five pointers to testing-discipline outside the doctrine copies are still present` at the landing (its assertion near line 3863); prefer the test name over the line.
- passage: Where a section carries real behavioral risk, give it a `Tests:` line naming the behaviors that earn one per the testing-discipline skill's litmus (`skills/testing-discipline/SKILL.md` under the kit plugin root), and the risk driving each, in both directions where a guard or flag is involved.

### C133
- key: Take the behaviors that earn a test from the testing-discipline skill's litmus at `skills/testing-discipline/SKILL.md` under the kit plugin root.
- class: pointer
- source: plugins/grimoire/skills/brainstorming/SKILL.md:48
- provenance: 4247725 2026-08-27, four surfaces stopped restating the litmus and the pointers earned a presence pin.
- verdict: keep
- reason: no finding. The pin exists because a pointer fails by going quiet; deleting this clause reds test/doctrine-parity.test.js:3871. The test/doctrine-parity.test.js:3871 cite sits at the test named `the five pointers to testing-discipline outside the doctrine copies are still present` at the landing (its assertion near line 3863); prefer the test name over the line.
- passage: the behaviors that earn one per the testing-discipline skill's litmus (`skills/testing-discipline/SKILL.md` under the kit plugin root)

### C134
- key: State intent in the `Tests:` line, never design: no fixtures, seams, or structure, which are implementation knowledge the plan does not have.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:48
- provenance: da1a895 2026-07-14, the first of the three constraints keeping implementer judgment intact.
- verdict: keep
- reason: Ruled with C132 (A059); the constraint is the rule's boundary, not its argument.
- passage: It states **intent, never design**: what to lock, never fixtures, seams or structure.

### C135
- key: Treat the `Tests:` line as a floor over the named contracts and a ceiling on neither which behaviors are covered nor how much coverage each takes.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:48
- provenance: da1a895 2026-07-14, the second constraint; d2e2f37 2026-09-05 split the ceiling into its two axes.
- verdict: keep
- reason: Ruled with C132 (A059); the two-axis ceiling is what keeps testing-discipline's shape bar in force past the line.
- passage: It is a floor over the named contracts and a ceiling on nothing, and it is amendable on contact with the code, with the delta flagged in the Chapter.

### C136
- key: Treat the `Tests:` line as amendable on contact with the code like any other spec claim, with the delta flagged in the Chapter.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:48
- provenance: da1a895 2026-07-14, the third constraint.
- verdict: keep
- reason: Ruled with C132 (A059); amendability with a flagged delta is the drift rule applied to this line.
- passage: It is a floor over the named contracts and a ceiling on nothing, and it is amendable on contact with the code, with the delta flagged in the Chapter.

### C137
- key: The cheaper the tier the more the `Tests:` line matters: haiku already requires its gate named, sonnet inherits judgment it need not re-derive, and at fable it is planning-Fable orienting implementing-Fable.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:48
- provenance: da1a895 2026-07-14, argued the line's value across the tiers; last reworded by d2e2f37.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The trigger and contents are stated above it and obeyed without it. The why: a cheaper implementer cannot re-derive which behaviors carry risk, so the line is where planning judgment reaches a tier that has none of its own. Retired as line 48's closing sentence, the line ending at 'with the delta flagged in the Chapter.'; the Tests:-line pointer phrase before it stands verbatim, which the `five pointers to testing-discipline outside the doctrine copies are still present` pin in `test/doctrine-parity.test.js` reads.
- proposed: Delete "The cheaper the tier, the more the line matters: ... planning-Fable orienting implementing-Fable."
- baseline-test: yes

### C138
- key: Where a section's deliverable is a document for a reader, carry the review inputs in its body: an `Audience:` line with each persona and knowledge level, the must-answer questions per persona, a `Voice:` line (`scott` | `company` | other), the fact-base paths, and a `Disclosure:` list.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:50
- provenance: a5fce80 2026-08-18, the document review battery, whose lenses need these inputs to be adjudicable.
- verdict: keep
- reason: no finding. The Audience: line is what summons executing-work's document pair; without it a docs section gets the code pair.
- passage: Where a section's deliverable is a document for a reader, its body carries the review inputs: an `Audience:` line naming each persona and its knowledge level, the questions the document must answer for each, a `Voice:` line (`scott` | `company` | other), and the fact-base paths its claims are checked against.
- passage: When any persona is outside the operator and the operator's own sessions, the body also carries a `Disclosure:` list of what the documents must not reveal.

### C139
- key: These lines exist for adjudication: without the audience line and the must-answer list, a blind reader's finding cannot be adjudicated, only shrugged at.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:50
- provenance: a5fce80 2026-08-18, the reason the review inputs were added to the section body.
- verdict: retire
- landed: 16c5e61 section 28
- reason: The list is complete without the account of its purpose. The why: a blind reader reports what it was left asking, and whether answering that was the document's job is decidable only against the persona and its must-answer list. Retired as the sentence 'These exist for adjudication: the blind reader reports what it was left asking, and whether answering X was the document's job for that reader is exactly what the audience line and the must-answer list settle, so without them a reader finding cannot be adjudicated, only shrugged at.', C140's sentence following the review-inputs sentence directly.
- proposed: Delete "These exist for adjudication: ... only shrugged at."
- baseline-test: yes

### C140
- key: Put all the document review inputs in the section body, never on the `Model:` line.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:50
- provenance: a5fce80 2026-08-18, seventeen days after c2114e9's bare-token rule, which the sentence itself cites as already forbidding the decoration.
- verdict: retire
- landed: 16c5e61 section 28
- reason: row 486 kept the inputs. The meaning "ride in the section body" is carried by C138's landed "its body carries the review inputs" and "the body also carries a `Disclosure:` list".
- proposed: (via A041) Reduce C140's sentence to "All of these ride in the section body", dropping "never on the Model: line, whose bare-token contract above already forbids decorating it"; C120 and C127 stay.
- baseline-test: yes
- passage: All of these ride in the section body.

### C141
- key: Give none of the document review lines to a docs-only section that names no audience, such as a plan doc edit or an index refresh.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:50
- provenance: a5fce80 2026-08-18, the boundary that keeps a plan-doc edit from drawing the document pair.
- verdict: keep
- reason: no finding. The boundary is what distinguishes a deliverable document from housekeeping prose.
- passage: A docs-only section that names no audience, such as a plan doc edit or an index refresh, carries none of them.
- flag: weak-reason

### C142
- key: Treat a tier choice as which model should do the work, never as whether to spend.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:52
- provenance: 53d9040 2026-08-15, which retired the cost hold and the Fable Spend header after a session conflated Fable unavailable with Fable held (kaizen/archive/2026-08-07-fable-unavailable-vs-cost-hold.md).
- verdict: keep
- reason: Incident-born and the incident recurs whenever a session hesitates at a fable tier as a bill; no machinery decides tiers (A063).
- passage: A tier answers which model should do the work, never whether to spend. Fable is included in the plan's allotment, and an exhausted allotment yields no work rather than a bill.

### C143
- key: Consult finishing-work's unavailability rule for what an exhausted allotment does to a dispatch and how a session detects it.
- class: pointer
- source: plugins/grimoire/skills/brainstorming/SKILL.md:52
- provenance: d66c58d 2026-08-23, which made finishing-work the owner of the wedge hallmark and turned brainstorming's restatement into a pointer.
- verdict: keep
- reason: no finding. The ownership map places the quiet-dispatch rule in finishing-work; this is the pointer that commit installed.
- passage: Executing-work's capacity reading and finishing-work's unavailability rule state how a session detects exhaustion and what it does to a dispatch.

### C144
- key: Treat a normal effort's Fable surface as standing and expected: fable-tier sections, per-section reviewer dispatches one tier above an opus or fable writer with Fable the ceiling, the finishing reviews at Fable by default, and any consult at Fable effort high.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:52
- provenance: d156f46 2026-07-31 installed the enumeration so the Fable Spend header could forecast spend; 53d9040 retired that header, and e181897, e00d1e3 and 0faeb51 each had to move this copy with the reviewer rule.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: The header it served is gone and every reviewer-rule change since has had to carry this copy, which is the drift the one-owner decision exists to stop; it becomes a pointer at executing-work's reviewer rule, finishing-work's reviews and consult's model rule (A064). Lands as 'A normal effort's Fable surface is standing and expected, and which dispatches draw it is stated by executing-work's reviewer rule, finishing-work's finishing reviews and the consult skill's model rule.', the enumeration gone.
- proposed: (via A064) Replace the enumeration with a pointer: a normal effort's Fable surface is standing and expected, and which dispatches draw it is stated by executing-work's reviewer rule, finishing-work's finishing reviews and the consult skill's model rule.
- baseline-test: yes
- passage: Executing-work's reviewer rule, finishing-work's finishing reviews and the consult skill's model rule state which dispatches draw Fable.

### C145
- key: Use a Fable-led session for design work: brainstorming, specs, adjudication, and the finishing pass of a high-stakes effort.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:54
- provenance: dc128d8 2026-07-01 tuned the kit for Fable as the session model; 5854b9b 2026-07-26 moved the session-mode rule from the doctrine into brainstorming.
- verdict: keep
- reason: no finding. The session-mode rule's positive half; the operator's 2026-08-18 ruling (model-tier-substitution-for-review) names design strength as where the tiers diverge.
- passage: A Fable-led session is for design: brainstorming, specs, adjudication, and the finishing pass of a high-stakes effort.

### C146
- key: Keep execution on a session running the execution model, Opus-led today.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:54
- provenance: dc128d8 2026-07-01 via 5854b9b 2026-07-26; 456ba81 and 53d9040 regrounded its reasoning as the metering facts changed.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: The rule with its tempting-exception rejection stays; C148 is its remedy and C147's reasoning moves here (A066, A067). Flipped from keep to rewrite at section 28's close: C147's retire took the because-clause after this sentence's comma, so the comma becomes a period, and the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Execution belongs to a session on the execution model (Opus-led today).
- passage: Execution belongs to a session on the execution model (Opus-led today), whatever the plan's size.

### C147
- key: A Fable-led execution session burns the shared allotment fastest where it adds least, and cannot fall back mid-session the way a dispatch can, because the session model is the session.
- class: rationale-example
- source: plugins/grimoire/skills/brainstorming/SKILL.md:54
- provenance: dc128d8 2026-07-01; regrounded by 456ba81 2026-07-18 (plan-usage metering) and 53d9040 2026-08-15 (allotment model).
- verdict: retire
- landed: 16c5e61 section 28
- reason: The rule is obeyed without it, and the reasoning has needed rewriting at every metering change. The why: a Fable-led session spends the shared allotment on execution keystrokes where cheaper tiers do the same work, and unlike a dispatch it cannot swap model mid-session. Retired as the clause ', because a Fable-led execution session burns the shared allotment fastest where it adds least, and it cannot fall back mid-session the way a dispatch can: the session model is the session', the comma becoming a period. `README.md` line 216 states the same reasoning on its own rather than pointing here; it is a second carrier, not a pointer, and stays. Its landing respelled C146's keep sentence; C146 records the flip. Fixed at section 28's close: `plugins/grimoire/skills/peer-sessions/SKILL.md` line 89 (the Worker row of its seat table) pointed at this skill's 'own rule that the session model is the session', the reasoning this entry retires; the round found the pointer aimed at nothing, and the close pass re-aimed it at the rule line 54 still states ('execution belongs to the execution model'), under executing-work step 5's re-open rule, the clause being un-keyed in the peer-sessions ledger.
- proposed: Delete "because a Fable-led execution session burns the shared allotment fastest where it adds least, and it cannot fall back mid-session the way a dispatch can: the session model is the session".
- baseline-test: yes

### C148
- key: When a Fable-led session is asked to execute, hand off the spec to a fresh execution-model session rather than doing the work.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:54
- provenance: 5854b9b 2026-07-26, the handoff as the remedy for the session-mode rule.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: States the act at a trigger the general rule does not name; C149's handoff mechanism folds into this sentence (A066, A070). Flipped from keep to rewrite at section 28's close: C149's rewrite folded its handoff mechanism into this sentence, so the parenthetical opens after 'not a favor' as a colon clause carrying the plan doc, and the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: When a Fable-led session is asked to execute, the move is a handoff, not a favor: the spec plus a fresh execution-model session, with the plan doc carrying the context.
- passage: When a Fable-led session is asked to execute, the move is a handoff, not a favor: the spec plus a fresh execution-model session, with the plan doc carrying the context.

### C149
- key: Keep resting context lean and hand off via the plan doc rather than carrying context, so a long stretch recovers from the doc alone.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:54
- provenance: 5854b9b 2026-07-26, carried over from the doctrine's session-mode guidance (dc128d8).
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: The doc-carries-state rule is the doctrine's and recover-from-the-doc-alone is executing-work's Chapter rule; the handoff mechanism folds into C148 and the recovery restatement leaves (A070). Lands folded into C148's sentence as 'the move is a handoff, not a favor: the spec plus a fresh execution-model session, with the plan doc carrying the context.', the clause order carrying the fold after C148's 'not a favor'; the resting-context clause leaves, line 54 ending 'Keep execution mains on the execution model, and leave the review tiers as rostered.' Its landing respelled C148's keep sentence; C148 records the flip.
- proposed: (via A070) Fold into C148: "the move is a handoff, the spec plus a fresh execution-model session, with the plan doc carrying the context", and drop "keep resting context lean (hand off via the plan doc rather than carrying context; a long stretch recovers from the doc alone)".
- baseline-test: yes
- passage: the spec plus a fresh execution-model session, with the plan doc carrying the context.
- flag: stale

### C150
- key: Leave the review tiers as rostered.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:54
- provenance: 5854b9b 2026-07-26, closing the session-mode paragraph so a Fable-led design session does not re-tier the roster it hands off.
- verdict: keep
- reason: Does not meet the plan review's dispatch, whose tier brainstorming rosters itself at step 10 (A072).
- passage: Leave the review tiers as rostered.

### C151
- key: Prefer rich references over prose: acceptance criteria as runnable checks or rubrics, and a mockup or reference implementation over a description for UI or visual work.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:58
- provenance: 5854b9b 2026-07-26, rich-references guidance absorbed from the doctrine.
- verdict: keep
- reason: no finding. A runnable check is the acceptance form the QA verifier can execute; prose acceptance is what it has to interpret.
- passage: Prefer rich references over prose: acceptance criteria as runnable checks or rubrics, and for UI or visual work a mockup or reference implementation over a description.

### C152
- key: Put the runnable check, rubric, mockup, or reference implementation on the section's `References:` line.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:58
- provenance: 5854b9b 2026-07-26, the template line the guidance rides on.
- verdict: keep
- reason: no finding. The line is where a dispatched implementer finds the reference without the conversation.
- passage: They ride on the `References:` line.

### C153
- key: Write the spec to the fixed template: title, then `Status:`, `Commit Model:` and `Created:` header lines, then Goal, Approach, Sections of Work, Out of Scope, Assumptions, Operator Verification, Open Questions, and Chapters.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:60
- provenance: no provenance found (the template dates from f8c0649 2026-06-10, the INIT commit; later sections were added by a00a4ea and e872098).
- verdict: keep
- reason: no finding. The template is the normative instance of curating-docs' frozen machine contract, which that skill says in terms.
- superseded-by: C181
- passage: Commit Model: Review-Only | Branch-and-PR | Commit-and-Push

### C154
- key: Write the Goal as one paragraph stating what exists when this is done and why it matters.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:67
- provenance: no provenance found (INIT-era template text, f8c0649 2026-06-10).
- verdict: keep
- reason: no finding. The Goal, with the `## Intent` record beside it, is what the plan reviewer reads against, so its shape is load-bearing since ead49db.
- passage: One paragraph. What exists when this is done, and why it matters.

### C155
- key: Write the Approach as the agreed design with key decisions and reasoning, so future sessions and post-compaction recovery understand intent rather than just steps.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:70
- provenance: no provenance found (INIT-era template text, f8c0649 2026-06-10).
- verdict: keep
- reason: no finding. The Approach is what a compacted session recovers intent from and what the plan reviewer reads as subject rather than contamination.
- passage: The agreed design, with key decisions and their reasoning, so a later or compacted session understands intent, not just steps.

### C156
- key: Record the sweep's result in the Approach: the searches run and the surfaces they found.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:73
- provenance: 83b81ac 2026-08-19, section 3 of the boundary-cadence plan, which found the scope rule demanded spec content the template had no slot for.
- verdict: keep
- reason: no finding in this range; the slot exists so step 10's coverage check has a list to read the sections against.
- passage: Where step 7's sweep ran, its result: the searches run and the surfaces they found.

### C157
- key: Give each numbered section a name, a `Model:` line of `haiku | sonnet | opus | fable`, an optional `Locus:` line, what gets built with acceptance criteria as verifiable statements, and a `Files in scope:` line derived from the Approach's sweep.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:75
- provenance: f8c0649 2026-06-10 INIT template; the Model: values from 9e124f7, the Locus: line from c2114e9, Files in scope from 83b81ac.
- verdict: keep
- reason: The template instances the contract rows curating-docs names as normatively instanced here; the duty (C111), the omission gloss (C122) and the field are one instruction (A073, A074). curating-docs' claim that this pick-list still carries a decorated value is stale since c2114e9 and is that document's to fix.
- passage: Model: haiku | sonnet | opus | fable
- passage: Files in scope: <derived from the Approach's sweep where one ran>.
- flag: stale

### C158
- key: Write Out of Scope as explicitly excluded items, so drift is detectable.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:86
- provenance: no provenance found (INIT-era template text, 656310e 2026-06-10).
- verdict: keep
- reason: no finding. Step 10's coverage check places swept surfaces here or in a section, so the section is load-bearing since 83b81ac.
- passage: Explicitly excluded items, so drift is detectable.

### C159
- key: Write one Assumptions bullet per assumption in the exact form `- assumed YYYY-MM-DD (<route: a source name | default>): <the assumption>; reversal: <what changing it costs>`.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:89
- provenance: e872098 2026-08-18, the intake-gap-check plan, with the line format locked in every brief so three parallel implementers could not drift.
- verdict: keep
- reason: The form governs both homes; the split by time (section at design, Chapter line at execution) is stated in the same block, so C161 does not contend (A076).
- passage: `- assumed YYYY-MM-DD (<route: a source name | default>): <the assumption>; reversal: <what changing it costs>`.

### C160
- key: Show an assumption to the operator in the recap first and record it in `## Assumptions` after, never the reverse.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:93
- provenance: dff4ef9 2026-08-18, the finishing review that propagated e872098's rule that an assumption never lives only in a document.
- verdict: keep
- reason: The ordering is the operative half of the doctrine's never-only-in-a-document rule at the moment the spec is written (A077).
- passage: An assumption is shown to me in the recap first and recorded here after, never the reverse.

### C161
- key: Freeze the `## Assumptions` section at approval: make no routine per-section append there.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:93
- provenance: dff4ef9 2026-08-18, after e872098's reviewers found routine appends would mutate the region the external engine's approval fingerprint covers.
- verdict: keep
- reason: Brainstorming states the freeze with its fingerprint reason and the deliberate-amendment carve-out; executing-work restates the conclusion (A080). The reason is the bound between the routine append and the deliberate amendment, which the same commit's Critical fix drew.
- passage: This section freezes at approval, because everything above `## Chapters` falls inside the external engine's approval-scoped fingerprint.

### C162
- key: Still make a deliberate spec amendment above the `## Chapters` line when the design changes, and record it in a Chapter as the drift it is.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:96
- provenance: dff4ef9 2026-08-18, the fix for a freeze rationale that over-proved and condemned deliberate amendments along with routine appends.
- verdict: keep
- reason: The general rule for any edit above the Chapters line; curating-docs states it for two headings and the doctrine routes finishing-time drift (A082).
- passage: The freeze bars the routine per-section append, never a deliberate spec amendment above that line when the design changes, which a Chapter records as drift.

### C163
- key: Put an assumption made during execution on the Chapter's `Assumptions:` line in the same bullet form with `, section N` added inside the parenthetical.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:99
- provenance: dff4ef9 2026-08-18, the execution-time home below the fingerprint boundary.
- verdict: keep
- reason: Brainstorming owns the bullet form and the section-number addition; executing-work's Chapter template names the field (A084).
- passage: An assumption made during execution rides the Chapter's `Assumptions:` line instead, in this form with `, section N` added inside the parenthetical.

### C164
- key: Use the optional `## Operator Verification` section for checks only the operator can run, each item naming what they run or observe and what outcome reopens the work.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:102
- provenance: a00a4ea 2026-08-06, a kaizen fix after an effort whose last gate was operator-only had no way to close (kaizen/archive/2026-08-06-operator-verification-handoff.md).
- verdict: keep
- reason: no finding. The handoff is content rather than a status because Complete is the frozen contract's only terminal value.
- passage: (Optional.) Checks only I can run: a customer window, a production deploy, a real-device action. Each item names what I run or observe and what outcome reopens the work.

### C165
- key: Never write an Operator Verification item as a Section of Work.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:105
- provenance: a00a4ea 2026-08-06, the prohibition whose incident was a plan stranded In Progress on a section Claude could not close.
- verdict: keep
- reason: Incident-born and the incident recurs on any operator-only criterion; no machinery refuses such a section (A086).
- passage: Never write one of these as a Section of Work.

### C166
- key: Read finishing-work for the completion semantics of Operator Verification items.
- class: pointer
- source: plugins/grimoire/skills/brainstorming/SKILL.md:106
- provenance: a00a4ea 2026-08-06, pointing at finishing-work's step 5 handoff.
- verdict: keep
- reason: no finding. Finishing-work owns whether pending operator checks hold the plan open.
- passage: Finishing-work owns their completion semantics.

### C167
- key: Write Open Questions as unresolved items with who owns each answer.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:109
- provenance: no provenance found (INIT-era template text, 656310e 2026-06-10).
- verdict: keep
- reason: no finding. The owner column is what turns a question into a routable item.
- passage: Unresolved items and who owns the answer.
- flag: weak-reason

### C168
- key: Leave `## Chapters` empty at creation; executing-work appends to it as sections complete.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:112
- provenance: no provenance found (INIT-era template text, 656310e 2026-06-10).
- verdict: keep
- reason: Already pointer-shaped: names executing-work as the appender and states only the template's own leave-empty rule (A087).
- passage: (Appended by executing-work as sections complete. Leave empty at creation.)

### C169
- key: Pick the `Status:` line at authoring: `In Progress` for a spec whose run starts now, `Ready` for one deliberately parked.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:116
- provenance: 897d921 2026-08-29, section 2 of the plan-lifecycle plan: Ready shipped with readers and no producer because the template still hardcoded In Progress, so two finished drafts on another machine went unseen.
- verdict: rewrite
- landed: 16c5e61 section 28
- reason: The pick is the producer's instruction and stays; the trailing "the run that starts it moves to In Progress" clause is executing-work's instruction without its external-engine carve-out and leaves (A089, A090). No machinery writes the value at authoring (A091). Lands as 'and one written and deliberately parked is born `Ready`, which session start surfaces as parked rather than offering for resume.', the moves-to-`In Progress` clause gone.
- proposed: (via A090) Drop "and which the run that starts it moves to In Progress" from line 116, keeping the pick and what Ready means at session start.
- baseline-test: yes
- passage: The `Status:` line is picked at authoring. A spec for a run that starts now is born `In Progress`, and one deliberately parked is born `Ready`, which session start surfaces as parked rather than offering for resume.

### C170
- key: See `curating-docs/SKILL.md`'s machine contract section for the frozen header and structure shape and which values it accepts, including `Model:`.
- class: pointer
- source: plugins/grimoire/skills/brainstorming/SKILL.md:118
- provenance: 662e5e3 2026-08-01, which declared the plan-doc machine contract in curating-docs with a pointer from brainstorming because a header rule reaches an author only in the skill loaded at writing time.
- verdict: keep
- reason: no finding. The pointer is the mechanism that commit chose; the contract is frozen v1 and owned there.
- passage: The header and structure above are a machine contract: `curating-docs/SKILL.md`'s machine contract section states its frozen shape and the values it accepts, including `Model:`.

### C171
- key: Keep `## Assumptions` outside `## Sections of Work`, whose block any foreign `##` heading ends early.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:118
- provenance: e872098 2026-08-18, written beside the pointer when the Assumptions section was added.
- verdict: retire
- landed: 16c5e61 section 28
- reason: curating-docs states the placement rule whole with its reason, the same sentence already points there, and the template places the section correctly; the clause is a copy beside a pointer (A093). Retired as the clause ', and it must stay outside `## Sections of Work`, whose block any foreign `##` heading ends early', line 118 ending at 'it is inert to the external parser.' `docs/architecture.md` line 69 attributes the placement rule to this skill's spec template ('required to stay outside `## Sections of Work`, whose block any foreign `##` heading ends early'), which the spec's Execution surface names as the known instance of executing-work step 5's re-open rule; fixed at section 28's close, after the round found the records step had routed it to the backlog instead: line 69 now reads 'its spec template holds the `## Assumptions` section, which is inert to the plan-doc parser and which `curating-docs` places outside `## Sections of Work`,'.
- proposed: (via A093) Delete "and it must stay outside ## Sections of Work, whose block any foreign ## heading ends early" from line 118, leaving the pointer and the parser-inertness note.
- baseline-test: yes

### C172
- key: Do not write a spec for a trivial fix or a small obvious change; just fix it under the global rules.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:122
- provenance: no provenance found (INIT-era text, 656310e 2026-06-10; a8770b3 reworded it to first person).
- verdict: keep
- reason: The skill's own stand-down boundary, which the doctrine's non-trivial bound does not state for a skill already loaded (A096).
- passage: A trivial fix or a small obvious change needs no spec. Just fix it under the global rules.

### C173
- key: Where a brainstorm request turns out to be trivial, say so and offer to just do it.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:122
- provenance: no provenance found (INIT-era text, 656310e 2026-06-10).
- verdict: keep
- reason: An operator-decision gate on the shape of a requested effort; overriding a request the operator made is covered by no standing grant, so it stays (A098).
- passage: If I ask to brainstorm something that turns out to be trivial, say so and offer to just do it.

### C174
- key: Read a write-up or case study forwarded into the design for its diagnosis, and set its remedy aside before the sketch.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:12
- provenance: docs/plans/claude-kit_goal-fit_spec_v1.md section 1 2026-09-19, on the operator's ruling of 2026-09-18 recorded in that plan's `## Intent` that a case study is illustrative, given after a reviewer question adopted from one was cut.
- verdict: keep
- reason: A forwarded write-up arrives with its own fix attached, and that fix was written for the writer's incident rather than for this plan's Goal. Reading for the diagnosis alone is what keeps the plan from adopting a remedy no Goal sentence asks for, and nothing else in the skill separates the two.
- passage: A write-up or case study forwarded into the design is read for its diagnosis, and its remedy is set aside before the sketch.

### C175
- key: Carry a one-line summary of the `## Intent` record beside the sketch's `Assumptions` block.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:34
- provenance: docs/plans/claude-kit_goal-fit_spec_v1.md section 1 2026-09-19.
- verdict: keep
- reason: The record is written in the operator's words and the operator approves the sketch, so the sketch is where the record's content is shown before it is written. A record first seen in the spec would reverse the order C160 fixes for an assumption.
- passage: Beside that block the sketch carries a one-line summary of the `## Intent` record the spec will hold.

### C176
- key: Write the `## Intent` section at step 9 from the design conversation while that conversation is still in the window, carrying what and why only.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:38
- provenance: docs/plans/claude-kit_goal-fit_spec_v1.md section 1 2026-09-19; the plan's Approach paragraph "The record." states the design.
- verdict: keep
- reason: The conversation is the only source of the operator's words and it is gone at the next session, so the write is anchored to the one step that still holds it. The what-and-why bound keeps the record out of the Approach's job, which the scope-adjudicator is blind to by design.
- passage: The `## Intent` section is written here, while the design conversation is still in the window. It carries what and why, never how.

### C177
- key: Write the record's parts in order: the frame in the operator's words, what done does and does not need to do, the refused alternatives one per line with their reasons, the dated rulings made after the spec ships, and a provenance line.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:38
- provenance: docs/plans/claude-kit_goal-fit_spec_v1.md section 1 2026-09-19; that plan's own `## Intent` is the first instance.
- verdict: keep
- reason: Each part answers a reader the Approach does not serve. The plan reviewer reads the not-done half and the refusals to tell service to the Goal from an addition, and the provenance line stands in for a transcript reference, which the plan refused as machine-local and too large.
- passage: Its parts, in order: the frame in my words where the session has them; what done does and does not need to do; the alternatives refused, each on one line with its reason; the rulings I make after the spec ships, each dated and appended the same turn; and a provenance line naming the session.

### C178
- key: Say in the refused-alternatives part that the conversation refused nothing where it did, and still make the not-done half refuse something.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:38
- provenance: docs/plans/claude-kit_goal-fit_spec_v1.md section 1 2026-09-19.
- verdict: keep
- reason: An omitted part reads the same as a forgotten one, so the empty case is stated for both parts that can be empty at the write. The rulings part is the usual empty one, since most rulings come after the spec ships, and step 10 would otherwise read its stated emptiness as the placeholder it removes. The not-done half is the half the add-decision reads against, and one that keeps nothing out makes every addition look like service to the Goal.
- passage: An empty part says so rather than being left out. The not-done half still has to refuse something.

### C179
- key: Write the record in the client-briefing register and bound it to about 4,000 bytes, read with `wc -c` over the section.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:38
- provenance: docs/plans/claude-kit_goal-fit_spec_v1.md section 1 2026-09-19, on the operator's ruling of 2026-09-18 on the relay thread that the record takes the register the operator reads.
- verdict: keep
- reason: The operator reads and approves this section, so it takes the register the doctrine fixes for what the operator decides from. The bound is one screen because a fresh reader reads the record whole before the spec, and a longer one becomes the design story that reader must not hold. The bound is read once, at the write, because a ruling is the operator's word and cutting one to fit would lose exactly what the rulings part exists to keep; trimming the earlier parts instead would rewrite an approved record on ordinary progress, which the freeze bars.
- passage: The record takes the doctrine's client-briefing register. It is bounded to about 4,000 bytes, read with `wc -c` over the section at the write. A ruling appended later may carry it past the bound and is never cut to fit.

### C180
- key: Append a ruling made after approval to `## Intent` the same turn, dated, as a deliberate amendment recorded in the Chapter as drift.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:147
- provenance: docs/plans/claude-kit_goal-fit_spec_v1.md section 1 2026-09-19.
- verdict: keep
- reason: C162 states the deliberate amendment for any edit above `## Chapters`, and this sentence names `## Intent` as one section that rule reaches, so a ruling has a home the fingerprint rule already accounts for. The sentence counts nothing, since the freeze's rule is stated over every heading above `## Chapters` rather than over an enumerated few, and a count would be wrong the next time one is added. Step 9's closing sentence points here rather than restating it. The same-turn bound is what keeps a ruling from dying with the conversation, which is the gap the section exists to close.
- passage: `## Intent` is a section such an amendment reaches: a ruling I make after the spec ships is appended there the same turn, dated, on the same terms, recorded in the Chapter as drift.

### C181
- key: Put `## Intent` in the spec template between `## Goal` and `## Approach`, described as what the operator asked for and why, in their words, what and why only.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:112
- provenance: docs/plans/claude-kit_goal-fit_spec_v1.md section 1 2026-09-19; supersedes the section order in C153.
- verdict: keep
- reason: The heading sits above `## Sections of Work`, so the parser's bounded blocks never meet it, which curating-docs states beside `## Assumptions`. It sits between the Goal and the Approach because the plan reviewer and every fresh reader read the what, then the why, then the how. The template line names the parts and points at step 9 for the rest, so the two do not drift.
- passage: What I asked for and why, in my words where the session has them: the frame, what done does and does not need to do, the refused alternatives with their reasons, later rulings, and a provenance line. What and why only. Step 9 states the parts, the register and the bound.

### C182
- key: In the spec self-review, read the `## Intent` record's not-done half with its refused alternatives beside it, name one mechanism the not-done half would refuse, and rewrite the record before the blind read where none can be named.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:52
- provenance: docs/plans/claude-kit_goal-fit_spec_v1.md section 4 2026-09-19; the plan-reviewer's `[unrefusable-frame]` question is the same check run by a fresh reader afterwards.
- verdict: retire
- reason: row 475 (Intent refusal naming test), dropped under the mechanism cut.
- passage: Read the `## Intent` record's not-done half, with the refused alternatives beside it, and name one mechanism it would refuse. Where you can name none, rewrite the record before the blind read.
- ruled: cut 2026-09-30

### C183
- key: In the spec self-review, run the Jev coverage tool over the spec between the inline pass and the blind read, re-read the thinnest sections against their lowest topics, and record its closing line in the handoff recap as it printed, or the by-hand not-run form where it printed none.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:54
- provenance: docs/plans/claude-kit_jev-coverage-check_spec_v1.md section 3 2026-09-21; the operator's six rounds of experiments on 2026-09-20 found that Jev answers a precise question cheaply and repeatably and cannot invent the question.
- verdict: retire
- reason: row 476 (Jev coverage check), dropped under the mechanism cut.
- passage: Record the tool's closing line in the handoff recap beside the blind-read line, in whichever of its three forms it printed: `jev coverage: <n> sections, thinnest <N> at <mean>`, `jev coverage: not checked (<reason>)`, or `jev coverage: not configured`. A not-checked or not-configured line is recorded as it printed and never retried into a pass. Where the tool printed no closing line, because the session could not run it or it refused its arguments, write the fourth form by hand: `jev coverage: not run (<why>)`.
- passage: No score reaches the blind reader or the plan reviewer. A spec that skips the blind read may still run this check.
- ruled: cut 2026-09-30

### W001
- key: Treat a paragraph's phrasing as design: have a `Tests:` line or an acceptance bullet name the direction, token or agreement a pin holds, never the sentence that carries it.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:92
- provenance: docs/plans/claude-kit_test-requirement-axis_spec_v1.md section 2 2026-09-20; one of the four single-lens additions the operator accepted on 2026-09-17.
- verdict: keep
- reason: Extends C134's intent-never-design constraint to wording. A spec that quotes a sentence as the thing to lock hands the implementer a wording pin by plan, which the testing-discipline skill retires as a pin on a choice, and the implementer would then be amending the line on contact at every such section. Naming the direction, token or agreement keeps the plan's `Tests:` line on the requirement. C135 and C136 stand unchanged: the floor over the named contracts and the line's amendability already agree with the dispatch brief's field as executing-work now states it.
- passage: Like an acceptance bullet, it names the direction, token or agreement a pin holds, never the sentence that carries it.

### P001
- key: State that a section's `Voice:` value names a voice reference in the `prose-register` skill or names none.
- class: mechanic
- source: plugins/grimoire/skills/brainstorming/SKILL.md:96
- provenance: docs/plans/claude-kit_prose-register_spec_v1.md section 4, which gave the voice layer one home and made the `Voice:` line a pointer into it; the line itself dates to a5fce80 2026-08-18, the document review battery.
- verdict: keep
- reason: C138 names the field and this states what its value means, which is what a plan author needs to fill it. The prose reviewer keys its voice branch on a named reference rather than on a fixed value, so a section writing a value that names none is choosing the register-alone read deliberately. The spec template's `Audience:` line carries the same meaning in the compressed form that block gives every field.
- passage: The `Voice:` value names a voice reference in the `prose-register` skill, or names none.

### D001
- key: Give the spec's title the doctrine's heading form with main words capitalized and no prefix.
- class: rule
- source: plugins/grimoire/skills/brainstorming/SKILL.md:28
- provenance: docs/plans/claude-kit_short-titles_spec_v1.md section 1, 2026-10-05, on the operator's ruling of 2026-10-03 recorded under its Intent.
- verdict: keep
- reason: A pull request's title is an UPPERCASE prefix naming the part of the system the work changes, then the plan's title (finishing-work's **Apply the commit model** step). A plan title already in the heading form therefore makes that title with no rewriting, and a prefix of its own would double the prefix. Existing plan titles are not retitled. The machine contract row for the title in curating-docs stays `free-form`, since the external engine's parse does not change.
- passage: The spec's title is in the doctrine's heading form, with its main words capitalized, and carries no prefix. Its pull request adds the prefix.
