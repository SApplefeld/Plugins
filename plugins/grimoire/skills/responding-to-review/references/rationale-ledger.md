# Rationale ledger: responding-to-review

This file is the rationale ledger for the documents the `responding-to-review` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/responding-to-review/SKILL.md

This document governs how a session weighs and answers review output and operator feedback before acting on either. It owns the moments where a review agent returns findings, where the operator gives feedback or a correction, and where a session is about to implement a suggestion from either source, especially one that looks wrong, unclear, or larger than the problem; it also owns how a session counts corroboration across independent review lenses, how it treats a reviewer's clearance or a pair of contradicting verdicts, how it handles a claim finding's fix brief, and the tone of a review reply. It does not own severity triage itself, which it hands to executing-work's "Address findings" step, nor the claim-finding class and its dispositions, which it hands to executing-work, nor the docs-curator Drift Report route, which it hands to finishing-work. Load class: `named-trigger` - the skill is loaded before a specific act, when review output arrives to be adjudicated, when the operator gives feedback, or before implementing a suggestion from either.

Extracted at `6bc07fb`: whole document (`skills.responding-to-review.SKILL.md`). Re-extracted at `d9540ad` over the hunks the Section 5 merge changed (`R` entries below). Re-extracted at `4b2e64c` over the hunks the Section 8 merge changed (`S` entries below). Amended by `docs/plans/claude-kit_reviewer-reranking_spec_v1.md` section 1 on 2026-09-20 (S021 and S022 below, S010 retired). Redrafted on 2026-09-26 by section 8 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, landed at `f862acf0` with its fix round at `6f26f01a`, so every live entry's `passage:` line quotes the text at `6f26f01a` and the `flag:` lines record that pass's flags.

### C001
- key: Treat a review finding as an input to your judgment rather than an order, and evaluate it before you act on it.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:8
- provenance: 830ff28 2026-06-17, installed with the skill as ported from Daren's fork and session mining; no incident narrated.
- verdict: retire
- landed: 1de7db7 section 34
- reason: row 1111 (Opening framing line), merged into the Two Sources thesis. S001's landed sentence "**Review-agent findings**, from any lens, are input to your judgment, not orders." carries it.
- proposed: Reduce line 8 to the rule and its imperative, with the fallibility and operator-standing sentences moved to this ledger.
- baseline-test: yes
- passage: A review finding is an input to your judgment, not an order to execute. Evaluate before you act.

### C002
- key: Evaluate findings because the kit's fresh-context review agents catch what you missed yet are fallible and cannot see intent you never wrote down.
- class: rationale-example
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:8
- provenance: 830ff28 2026-06-17, installed with the skill; no incident narrated.
- verdict: retire
- landed: 1de7db7 section 34
- reason: Motivation only; the operative form (a finding can be wrong, out of scope, or built on context the agent lacked) stays at line 12. The why now lives here: fresh-context lenses see the diff and not the intent, so a finding can be confidently wrong about what the code was for. Retired at line 8 at section 34's close: the sentence is gone; line 12 keeps the operative form, "A finding can be wrong, out of scope, or built on context the agent lacked."
- proposed: Move the sentence to this ledger under C002; line 12 keeps the operative fallibility statement.

### C003
- key: Adjudicate every review-agent finding, giving each one an honest verdict.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: 830ff28 2026-06-17, installed with the skill; the enumeration grew in 12ef61f (blind lens) and a5fce80 (document battery, recorded as a deviation because the adjudication rule must reach the new lenses).
- verdict: retire
- superseded-by: S002
- reason: Survives the merge at HEAD line 12 verbatim (f26619c inserted a trace sentence beside it). No hook makes a session adjudicate a finding, and the enumeration is what binds each new lens to the rule; R001 and R003 are this sentence re-read and are retired as duplicates of it. Superseded at `4b2e64c` by S002 (the Section 8 merge; the verdict before it was keep).

### C004
- key: Do not rubber-stamp a finding and do not reflexively defer to it.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: 830ff28 2026-06-17, installed with the skill; no incident narrated.
- verdict: retire
- superseded-by: S005
- reason: Survives at HEAD line 12 verbatim. The two failure modes are the anti-sycophancy pair this skill exists for and nothing mechanical catches either; R004 is its duplicate. Superseded at `4b2e64c` by S005 (the Section 8 merge; the verdict before it was keep).

### C005
- key: Push back on a wrong finding and give the reason, treating that as correct rather than insubordinate.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: 830ff28 2026-06-17, installed with the skill; no incident narrated.
- verdict: retire
- superseded-by: S003
- reason: Survives at HEAD line 12 verbatim. The "not insubordinate" clause is the license a session needs against the pull to defer; R002 is its duplicate. Superseded at `4b2e64c` by S003 (the Section 8 merge; the verdict before it was keep).

### C006
- key: Route the docs-curator Drift Report to the operator and read finishing-work's step 4 for the adjudications that are yours and how to record them.
- class: pointer
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: 830ff28 2026-06-17 routed the report to the operator; dd5e568 2026-08-24 (verification-artifacts plan) replaced "exactly one" adjudication, which read as a cap and made an orchestrator refuse a required re-classification, with the class finishing-work step 4 defines.
- verdict: retire
- superseded-by: S011
- reason: Survives at HEAD line 12 verbatim. Finishing-work owns the stop on a `mistake` and this is the pointer a non-owner keeps; the gate is operator-decision class (A004, A005) because the resolution picks which of code, spec, or doc is the truth. R010 to R012 are this parenthetical re-read. Superseded at `4b2e64c` by S011 (the Section 8 merge; the verdict before it was keep).

### C007
- key: Implement the operator's feedback once you understand it.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:14
- provenance: 830ff28 2026-06-17, installed with the skill; a8770b3 reworded to first person.
- verdict: rewrite
- landed: 1de7db7 section 34
- reason: The rule stands; the paragraph loses only its third sentence (C010), a doctrine copy, under A006. Lands at line 14 (section 34's close) as "**My feedback** is trusted: implement once you understand it. Still verify scope when it is unclear, and still say so when you see a problem with it." The implement, verify-scope and say-so sentences are unchanged; the third sentence (C010) is gone.
- proposed: Drop the third sentence of line 14 to this ledger; keep the implement, verify-scope, and say-so sentences unchanged.
- baseline-test: yes
- passage: **My feedback** is trusted: implement once you understand it.

### C008
- key: Verify the scope of operator feedback when that scope is unclear.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:14
- provenance: 830ff28 2026-06-17, installed with the skill; no incident narrated.
- verdict: keep
- reason: An operator-decision gate (A007): the scope of the operator's own instruction is theirs to state, and the doctrine's intake gap check routes a material gap to them. Retiring it would have a session guess the scope of a trusted instruction.
- passage: Still verify scope when it is unclear, and still say so when you see a problem with it.

### C009
- key: Say so when you see a problem with the operator's feedback.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:14
- provenance: 830ff28 2026-06-17, installed with the skill; no incident narrated.
- verdict: keep
- reason: The skill's instance of the doctrine's Disagree-up-front bullet at the moment feedback arrives; unchanged by the line 14 rewrite.
- passage: Still verify scope when it is unclear, and still say so when you see a problem with it.

### C010
- key: Voice the disagreement because silence reads as agreement and the operator wants the disagreement when you have one.
- class: rationale-example
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:14
- provenance: 830ff28 2026-06-17, installed with the skill; the same sentence sits in the doctrine's Disagree-up-front bullet, which owns it.
- verdict: retire
- landed: 1de7db7 section 34
- reason: A verbatim doctrine copy; the doctrine keeps it and C009 is obeyable without it. The why: a session that says nothing has agreed in the operator's eyes, so an unvoiced objection is a shipped defect. Retired at line 14 at section 34's close: the sentence is gone; the doctrine's Disagree-up-front bullet keeps "Silence reads as agreement."
- proposed: Move to this ledger under C010; the doctrine keeps the sentence.

### C011
- key: Read the whole set of findings and understand it before you react or act.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:18
- provenance: 830ff28 2026-06-17, installed with the skill; no incident narrated.
- verdict: retire
- landed: 1de7db7 section 34
- reason: row 1098 (Read whole set first), dropped under the mechanism cut.
- proposed: Fold item 1 to its lead plus one sentence naming the finding-by-finding failure, with the interrelation reason moved to this ledger.
- baseline-test: yes
- passage: 1. **Read the whole set before reacting.** Understand the set, then act, not finding-by-finding in a panic.
- ruled: cut 2026-09-30

### C012
- key: Read the set first because findings interrelate and fixing one can moot another.
- class: rationale-example
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:18
- provenance: 830ff28 2026-06-17, installed with the skill.
- verdict: retire
- landed: 1de7db7 section 34
- reason: Motivation only. The why: findings interrelate, and a fix made finding-by-finding can moot or contradict a later one in the same set. Retired at line 18 at section 34's close: the sentence is gone.
- proposed: Move to this ledger under C012.

### C013
- key: Confirm a finding is real in the actual code and on this stack before implementing it.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:19
- provenance: 830ff28 2026-06-17, installed with the skill; the doctrine's a-finding-is-a-hypothesis bullet is its authority.
- verdict: rewrite
- landed: 1de7db7 section 34
- reason: The rule stands and this skill owns it (A011, A013); the item drops its reason sentence here (A012). The why: a reviewer reasoning from a diff can be wrong about code it could not see, and the blind lens sees only the diff by design. Lands at line 19 (section 34's close): the lead and the confirm-in-the-actual-code sentence stand word for word, the diff-reasoning sentence is gone, and the kaizen prose batch's section 6 fold follows them as two sentences, "A finding whose substance is an absence is a scope claim first, so re-read the spec section before you design the fix. An absence outside what the section asked for takes executing-work's out-of-scope route at its step 4 rather than a fix here." The second sentence's scope clause was reworded at round 1 to key on what the section asked for rather than on what its spec text spelled out, since a missing bound inside asked-for code is spec-traceable. The route sits under the bold lead "The out-of-scope route." at executing-work SKILL.md line 423 at HEAD.
- proposed: Keep the lead and the confirm-in-the-actual-code sentence; move the diff-reasoning reason to this ledger under C013.
- baseline-test: yes
- passage: Before implementing a finding, confirm it is real in the actual code and on this stack. A finding of an absence is a scope claim first: re-read the spec section before you design the fix, and send an absence outside what the section asked for to executing-work's out-of-scope route at its step 4.
- flag: stale

### C014
- key: Apply the YAGNI test to any push for configurability, an abstraction, or a "professional" feature: is it needed now?
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:20
- provenance: 830ff28 2026-06-17, installed with the skill; no incident narrated.
- verdict: retire
- reason: row 1100 (YAGNI check on suggestions), merged into the doctrine's "Write the minimum that solves the problem" bullet, whose text "No speculative abstractions, no configurability" carries it. C015's landed clause keeps the caller test.
- passage: A pushed-for configurability, abstraction, or "professional" feature must be needed now.

### C015
- key: Grep for the caller to decide whether the pushed-for addition is needed now.
- class: mechanic
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:20
- provenance: 830ff28 2026-06-17, installed with the skill.
- verdict: keep
- reason: no finding.
- passage: Grep for a pushed-for abstraction's caller, per the doctrine's write-the-minimum rule, and leave it out where none exists.

### C016
- key: Where the grep shows the thing is unused, say so and leave it out.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:20
- provenance: 830ff28 2026-06-17, installed with the skill.
- verdict: keep
- reason: The outcome half of item 3, kept with it under A015.
- passage: Grep for a pushed-for abstraction's caller, per the doctrine's write-the-minimum rule, and leave it out where none exists.

### C017
- key: When a finding is wrong, say why up front and show the evidence: the code, the test, or the constraint.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:21
- provenance: 830ff28 2026-06-17, installed with the skill.
- verdict: keep
- reason: The item is kept whole (A016) because the re-check clause inside it is baseline-tested wording and the proposed compression breaks it.
- passage: 2. **Push back with the reason, up front.** The doctrine's "Disagree up front" bullet governs.

### C018
- key: Hold your position under pushback and move only on a new fact, never on tone.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:21
- provenance: 830ff28 2026-06-17; the kaizen brief of 2026-08-08 required this no-move-on-tone rule to survive intact when the re-check clause was added.
- verdict: retire
- reason: row 1101 (Pushback and bare-challenge protocol), merged into the doctrine's "Disagree up front" bullet, which carries "Move only on a new fact, never on my tone.".
- passage: Hold under pushback. Move on a new fact, not on tone.

### C019
- key: On a bare challenge carrying no new fact, run exactly one re-verification of your cited evidence before restating: re-open the code, re-run the test.
- class: mechanic
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:21
- provenance: b99a7fe 2026-08-09, kaizen/archive/2026-08-08-bare-challenge-triggers-recheck.md: the hold-under-pushback rule had no path to discover thin evidence; RED 4 of 6 under combined pressure, GREEN 5 of 6 with the clause, old-wording control 1 of 3.
- verdict: retire
- reason: row 1101 merge. The doctrine's "Disagree up front" text carries it: "A bare challenge, such as a repeated "are you sure?", earns one re-check: re-read the file, re-run the command, re-pull the number.".
- passage: A bare challenge (pushback carrying no new fact) buys one re-verification of your cited evidence before you restate: re-open the code, re-run the test.

### C020
- key: Where the re-check reproduces your evidence, hold and say what you re-checked.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:21
- provenance: b99a7fe 2026-08-09, the same kaizen brief (the resolution rule's first half).
- verdict: retire
- reason: row 1101 merge. The doctrine's "Disagree up front" text carries it: "If it reproduces your evidence, hold and say what you re-checked.".
- passage: A re-check that reproduces the evidence means hold, saying what you re-checked.

### C021
- key: Where the re-check finds the evidence thinner than you claimed, treat that as the new fact and downgrade out loud.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:21
- provenance: b99a7fe 2026-08-09, the same kaizen brief (the resolution rule's second half).
- verdict: retire
- reason: row 1101 merge. The doctrine's "Disagree up front" text carries it: "If the evidence proves thinner, that is the new fact, so downgrade out loud.".
- passage: One that finds it thinner than you claimed is the new fact - downgrade out loud.

### C022
- key: If you pushed back and were wrong, say so plainly and implement, with no defense of why you pushed back.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:21
- provenance: 830ff28 2026-06-17, installed with the skill.
- verdict: keep
- reason: The closing rule of item 4, kept with it under A016; the "no defense" clause is the anti-sycophancy rule's mirror for the session's own error.
- passage: If you pushed back and were wrong, say so plainly and implement, with no defense.

### C023
- key: Handle Critical, Major and Minor findings exactly as executing-work's "Address findings" step defines, and read that step for the triage rule.
- class: pointer
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:22
- provenance: 830ff28 2026-06-17, installed with the skill.
- verdict: keep
- reason: no finding. The pointer at the owner of triage, and the sentence that settles the probe fork on C014.
- passage: 3. **Triage and record.** Critical, Major, Minor are handled exactly as executing-work's "Address findings" step defines. This skill governs how you weigh and answer a finding before that triage.

### C024
- key: When ordering fixes, weight convergence between two independent lenses on one defect above either finding's severity rating.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:26
- provenance: a5e184b 2026-08-25, kaizen-batch plan section 4; the rule produced its own first instance before it shipped, two reviewers with no contact landing on the same wrong sentence in section 2.
- verdict: keep
- reason: Incident-born, applied by name in later Chapters of the same plan, and no machinery counts convergence (A017).
- passage: When two lenses with no contact land on the same defect, weight that convergence above either finding's severity when you order the fixes.
- flag: weak-reason

### C025
- key: Put a corroborated Major ahead of a lone Critical in the fix order.
- class: rationale-example
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:26
- provenance: a5e184b 2026-08-25, kaizen-batch plan section 4.
- verdict: keep
- reason: The instance fixes the rule's reading (ordering, not a tie-break) and hosts the lone-Critical bound (A018).
- passage: So a corroborated Major goes ahead of a lone Critical, which still gets step 1's verification.

### C026
- key: Still verify a lone Critical against the code before implementing it.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:26
- provenance: a5e184b 2026-08-25, kaizen-batch plan section 4.
- verdict: keep
- reason: The bound that keeps the ordering rule from reading as a downgrade of an uncorroborated Critical (A017).
- passage: So a corroborated Major goes ahead of a lone Critical, which still gets step 1's verification.

### C027
- key: Credit convergence because the kit's lenses are built to share nothing: blind lenses get only the base ref or document, sighted ones hold the spec, and none reads another's output.
- class: rationale-example
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:26
- provenance: a5e184b 2026-08-25; the order clause repaired the section 4 round's finding that "run in parallel" was false for finishing's serial lenses; 6b7b384 2026-08-29 re-keyed the test on what the lenses share.
- verdict: retire
- reason: row 1104 (Lens independence accounting), shrink. The dispatch-order account is argument. Its act, that what the lenses share breaks independence, is carried by C029's landed sentence "Lenses sharing an input make one observation reported twice: ...".
- passage: The kit builds its lenses to have no contact. Blind lenses get only the base ref or the document, and sighted ones hold the spec. A round's lenses are dispatched together, and none reads another's output. Order does not break independence: finishing runs its qa-verifier before the reviews and its docs-curator after them. What breaks it is what the lenses share.

### C028
- key: Check what each lens was given, standing-brief content included, before counting two findings as two observations.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:28
- provenance: a5e184b 2026-08-25, kaizen-batch section 4 adversarial finding that Standing Brief Amendments break independence while the contamination test clears them.
- verdict: keep
- reason: Incident-born and recurring (a 2026-09-06 note records a brief carrying a prior adjudication that turned a lens into a restatement); nothing mechanical reads what a lens was given (A020).
- passage: Check what each lens was given before you count two.
- flag: weak-reason

### C029
- key: Do not count as corroboration two findings from one lens, a reviewer handed another's output, or two agents given the same contaminating framing.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:28
- provenance: a5e184b 2026-08-25, kaizen-batch plan section 4.
- verdict: keep
- reason: The disqualifier list.
- passage: Lenses sharing an input make one observation reported twice: one lens, a reviewer handed another's output, a shared framing, or shared standing-brief content, even content executing-work's contamination test clears.

### C030
- key: Do not count convergence produced by shared standing-brief content, such as a Standing Brief Amendments entry or a repo-wide defect class named in both briefs.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:28
- provenance: a5e184b 2026-08-25, the section 4 adversarial finding at docs/archive/claude-kit_kaizen-batch_spec_v1.md line 187.
- verdict: keep
- reason: The reconciliation with executing-work's contamination test is the whole point: that test clears the framing, so this rule is the only place the convergence it produces is discounted.
- passage: Lenses sharing an input make one observation reported twice: one lens, a reviewer handed another's output, a shared framing, or shared standing-brief content, even content executing-work's contamination test clears.

### C031
- key: Separate what the convergence is about before counting it: the effort's own artifacts as subject, versus those artifacts cited as evidence.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:30
- provenance: 6b7b384 2026-08-29, review-and-record plan section 7: a fixture invented a registry journal the directory contract does not define and two independent reviewers cited it as evidence.
- verdict: retire
- reason: row 1105 (Effort-authored artifacts not corroboration), shrink. The subject-versus-evidence split is carried by the C032 and C033 landed sentences.
- passage: So separate what the convergence is about.

### C032
- key: Count two lenses landing on the same defect in the effort's own artifacts as corroboration.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:30
- provenance: 6b7b384 2026-08-29, review-and-record plan section 7.
- verdict: keep
- reason: The positive half of C031; without it the evidence rule would discount every finding on a fixture the effort wrote.
- passage: Two lenses landing on one defect in an artifact this effort wrote corroborate.

### C033
- key: Count two lenses citing an effort-authored artifact as evidence of a fact the effort does not own as one finding, not two.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:30
- provenance: 6b7b384 2026-08-29, review-and-record plan section 7; the class sentence is pinned once on three surfaces by test/doctrine-parity.test.js.
- verdict: keep
- reason: The incident's own rule, and its class sentence is a pinned copy; operator memory two-surfaces-corroborate-only-if-no-upstream-reaches-both records the general form.
- passage: Two citing it as evidence of a fact the effort does not own, such as a contract or a tool's output, are one finding, and that fact needs evidence from outside the effort. Fixtures, stubs, golden files, sample payloads, and generated files are instances rather than the boundary: the class is any artifact this effort authored, cited as evidence of a fact the effort does not own.

### C034
- key: For a fact the effort does not own, take corroboration only from evidence originating outside the effort.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:30
- provenance: 6b7b384 2026-08-29, review-and-record plan section 7.
- verdict: keep
- reason: The remedy half of C033; unenforced by machinery.
- passage: Two citing it as evidence of a fact the effort does not own, such as a contract or a tool's output, are one finding, and that fact needs evidence from outside the effort.

### C035
- key: Count an artifact authored before this effort began toward independence, and do not use merge state as the test.
- class: mechanic
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:30
- provenance: 6b7b384 2026-08-29; the section 7 first draft keyed independence on merge state, which the plan's own commit model falsified within the hour, and the review round replaced it.
- verdict: keep
- reason: no finding. A review-caught repair; a session tempted to simplify the test back to merge state re-opens that defect.
- passage: An artifact predating the effort counts toward independence, and merge state is not the test.

### C036
- key: Cite the contract's owning surface for a claim about a contract, and treat it as outranking any artifact written to exercise it.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:30
- provenance: 6b7b384 2026-08-29, review-and-record plan section 7, designed as a multi-surface copy with the sighted charters because a charter inherits no skills.
- verdict: keep
- reason: The orchestrator's copy of a designed three-surface clause; the charter cannot be pointed at from a skill, and the blind lens has no fixture rule, so this is where a blind misread is caught (A022, A023).
- passage: A claim about a contract cites its owning surface, such as the schema or the tool source line that emits the output, which outranks any artifact exercising it.

### C037
- key: Take the owning surface to be wherever the fact's own producer defines it, never a copy that restates it.
- class: mechanic
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:30
- provenance: 6b7b384 2026-08-29; pinned once on all three surfaces at test/doctrine-parity.test.js lines 4932 to 4950 after the enumeration lost its tool leg on every surface.
- verdict: keep
- reason: A pinned copy keeps its copy; the pin fails on a pointer (A024, A025).
- passage: Those surfaces are instances rather than the boundary: the owning surface is wherever the fact's own producer defines it, never a copy that restates it.

### C038
- key: Where no owning surface states the contract, treat the contract as unstated and the asserting artifact as a proposal rather than the source.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:30
- provenance: 6b7b384 2026-08-29, review-and-record plan section 7.
- verdict: keep
- reason: The orchestrator's disposition generalized over the class, distinct from the reviewer's fixture diagnosis the parity test places on the charters alone (A026, A027).
- passage: Where none states it, the contract is unstated and the asserting artifact a proposal.

### C039
- key: Read executing-work's SKILL.md for the claim-finding class, its exceptions, and the dispositions at its step 4.
- class: pointer
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:34
- provenance: 5620b2b 2026-09-07, review-loop-exit plan section 2: a false sentence could hold a section open because the loop had no class-keyed exit.
- verdict: retire
- superseded-by: S015
- reason: no finding. The pointer at the owner; A028 strips the enumeration that rides beside it. Superseded at `4b2e64c` by S015 (the Section 8 merge; the verdict before it was keep).

### C040
- key: Never put a replacement sentence in a fix brief for a claim finding.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:34
- provenance: 5620b2b 2026-09-07, review-loop-exit plan section 2, which placed this rule here deliberately.
- verdict: retire
- superseded-by: S018
- reason: The rule stands; it gains C041 as its exception clause and loses the copied disposition list beside it (A028 to A030). The why: a rewritten sentence re-enters the class it was written to leave, so a fix brief that carries one restarts the loop it was meant to close. Superseded at `4b2e64c` by S018 (the Section 8 merge; the verdict before it was rewrite).

### C041
- key: Where a claim holds under either exception, owe it the behavior bar.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:34
- provenance: 5620b2b 2026-09-07; the exceptions themselves live in executing-work's KIT-CLAIM-CLASS region, pinned by test/claim-class-parity.test.js.
- verdict: retire
- superseded-by: S019
- reason: A restatement of the owner's bar that survives only as the bound on C040, since without it a security-boundary claim would be barred from a replacement sentence (A029). Superseded at `4b2e64c` by S019 (the Section 8 merge; the verdict before it was rewrite).

### C042
- key: Treat a reviewer's explicit clearance as a claim about the code, not a fact you inherit, and never adopt a load-bearing one on the agent's word alone.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:38
- provenance: a738710 2026-08-28, review-and-record plan section 1: a security lens cleared "no model-writable input can produce a deny", the prose lens rated the line Critical, and the trace proved the prose lens right.
- verdict: rewrite
- landed: 1de7db7 section 34
- reason: The rule, its examples and its step-2 parallel stand; the paragraph's motivating third sentence moves here (A031). The why: a clearance arrives looking like the settled state and costs nothing to adopt, which is why it is the harder half to remember. Lands at line 38 (section 34's close): the clearance definition, the examples and the step-2 parallel stand word for word, the paragraph now ending "and a load-bearing clearance owes the same before the section closes on it."; the motivating third sentence is gone.
- proposed: Drop the paragraph's third sentence to this ledger under C042; keep the clearance definition, the examples, and the step-2 parallel.
- baseline-test: yes
- passage: A reviewer's explicit clearance ("this line is fine", "no finding on X") is a claim about the code, not a fact you inherit. A load-bearing one owes step 1's verification before the section closes on it, never adoption on the agent's word.

### C043
- key: Verify a load-bearing clearance against the code before the section closes on it.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:38
- provenance: a738710 2026-08-28, review-and-record plan section 1.
- verdict: keep
- reason: The act the incident required; unchanged by A031.
- passage: A load-bearing one owes step 1's verification before the section closes on it, never adoption on the agent's word.

### C044
- key: Judge a clearance load-bearing when believing it retires a check you would otherwise have run.
- class: mechanic
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:40
- provenance: a738710 2026-08-28, review-and-record plan section 1.
- verdict: keep
- reason: no finding. The test C045's instances make recognizable.
- passage: A clearance is load-bearing when believing it retires a check you would otherwise run, such as that model-writable input cannot reach the sink.

### C045
- key: Verify the named property a clearance rests on, such as the trust boundary holding, model-writable input not reaching the sink, or the code refusing a case.
- class: rationale-example
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:40
- provenance: a738710 2026-08-28; the second instance is the incident itself.
- verdict: keep
- reason: The recognizer for C044's abstract test and the carrier of its imperative; the incident showed recognition is what sessions miss (A032).
- passage: A clearance is load-bearing when believing it retires a check you would otherwise run, such as that model-writable input cannot reach the sink.

### C046
- key: Do not go back into the full diff on a bare APPROVED verdict.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:40
- provenance: a738710 2026-08-28, review-and-record plan section 1.
- verdict: keep
- reason: Rule, discriminator and a pointer at executing-work's orchestrator-stays-lean rule, which owns the diff-reading bound (A033).
- passage: A bare `APPROVED` verdict retires no specific check, so it does not put you back in the diff.

### C047
- key: When two lenses return contradicting verdicts on one passage, adopt neither verdict and let the artifact settle which holds.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:42
- provenance: a738710 2026-08-28, review-and-record plan section 1, the split-verdict instance.
- verdict: keep
- reason: Incident-born; the corroboration section had no rule for contradicting verdicts before it (A034).
- passage: When two lenses contradict on one passage, adopt neither verdict.

### C048
- key: For a contradiction about what the code does, trace the code yourself and record the trace.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:42
- provenance: a738710 2026-08-28; tracing the gate's own branch order is what settled the incident.
- verdict: keep
- reason: The incident's remedy stated as the rule.
- passage: For what the code does, trace it yourself and record the evidence, such as the file:line, not the verdict you sided with.

### C049
- key: Record the trace's evidence, the branch order you read, the file:line and the path you followed, rather than the verdict you sided with.
- class: mechanic
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:42
- provenance: a738710 2026-08-28, review-and-record plan section 1.
- verdict: keep
- reason: What makes a recorded trace checkable later rather than a vote count.
- passage: For what the code does, trace it yourself and record the evidence, such as the file:line, not the verdict you sided with.

### C050
- key: For a contradiction about whether the code does what was asked, read the section's own words in the spec and record that reading.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:42
- provenance: a738710 2026-08-28, review-and-record plan section 1.
- verdict: keep
- reason: The intent half of the artifact rule; the code cannot settle it.
- passage: For whether it does what was asked, read the spec section's own words and record that reading.

### C051
- key: Do not break a contradiction tie on severity.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:42
- provenance: a738710 2026-08-28; in the incident the higher severity happened to be right, which is why severity is named as no tie-break.
- verdict: keep
- reason: Consistent with C024's currency distinction; unenforced.
- passage: Neither severity nor specialty breaks the tie, and a lens denied the relevant input rules only on what it held.

### C052
- key: Do not break a contradiction tie on the lens's specialty.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:42
- provenance: a738710 2026-08-28; the security lens cleared inside its own specialty and was wrong.
- verdict: keep
- reason: The incident's sharpest lesson, and the clause the compress proposal would have deleted (A034).
- passage: Neither severity nor specialty breaks the tie, and a lens denied the relevant input rules only on what it held.

### C053
- key: Treat a verdict from a lens structurally denied the relevant input as evidence about the artifact it held, never a ruling on the one it did not.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:42
- provenance: a738710 2026-08-28, review-and-record plan section 1.
- verdict: keep
- reason: Follows from the blind lens being denied the spec on purpose; it is how a blind clearance over a spec question is weighed.
- passage: Neither severity nor specialty breaks the tie, and a lens denied the relevant input rules only on what it held.

### C054
- key: Apply the kit doctrine's anti-sycophancy rule in full when replying to a review.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:46
- provenance: 830ff28 2026-06-17; fdd7b82 2026-07-15 repointed the reference at the doctrine; 5620b2b 2026-09-07 removed the doctrine restatement.
- verdict: keep
- reason: Already trimmed to a pointer plus the review-specific instances (A035).
- passage: 4. **No performative agreement.** Per the doctrine's no-flattery and skip-the-preamble bullets, a review reply carries no "Good catch", no "You're absolutely right", and no thanks for the finding.

### C055
- key: In a review reply, write no "Good catch", no "You're absolutely right", and no thanks to the reviewer or the operator for the finding.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:46
- provenance: 830ff28 2026-06-17, installed with the skill.
- verdict: keep
- reason: The skill's own instance list; the doctrine names different phrasings, so this is not a copy.
- passage: 4. **No performative agreement.** Per the doctrine's no-flattery and skip-the-preamble bullets, a review reply carries no "Good catch", no "You're absolutely right", and no thanks for the finding.

### C056
- key: State the fix or state the disagreement, and let the changed code show you heard it.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:46
- provenance: 830ff28 2026-06-17, installed with the skill.
- verdict: keep
- reason: The positive form of the reply; kept with the section under A035.
- passage: State the fix or the disagreement.

### C057
- key: Weigh operator feedback as usually right and always worth hearing, but never as infallible.
- class: rationale-example
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:8
- provenance: 830ff28 2026-06-17, installed with the skill; a8770b3 reworded to first person.
- verdict: retire
- landed: 1de7db7 section 34
- reason: Line 14 carries the operative rule and the doctrine carries the standing. The why: the operator is trusted as a source and still wrong sometimes, so feedback is implemented once understood and questioned when a problem is seen. Retired at line 8 at section 34's close: the sentence is gone; line 14 carries the operative rule.
- proposed: Move to this ledger under C057 as part of the line 8 rewrite (A001).

### C058
- key: Treat a severity rating and independent convergence as different kinds of evidence, not interchangeable.
- class: rationale-example
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:26
- provenance: a5e184b 2026-08-25, kaizen-batch plan section 4.
- verdict: retire
- landed: 1de7db7 section 34
- reason: Motivation for C024, which stands with its instance and its independence account. The why: a severity rating is one reviewer's judgment about a defect, while independent convergence is evidence about the defect itself. Retired at line 26 at section 34's close: the currency sentence is gone and the rest of the line stands word for word.
- proposed: Move the currency sentence to this ledger under C058; the rest of line 26 stands.
- baseline-test: yes

### C059
- key: Dispatch a round's review lenses together rather than feeding one lens's output into another.
- class: mechanic
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:26
- provenance: a5e184b 2026-08-25; the wording is the section 4 round's correction of "run in parallel", scoped to same-round dispatches.
- verdict: retire
- reason: row 1104 shrink. The act "none reads another's output" is carried by C029's landed clause "a reviewer handed another's output". The ledger's own reason gives the dispatch to executing-work step 3.
- passage: A round's lenses are dispatched together, and none reads another's output.

### R001
- key: Give every review-agent finding an honest verdict of your own.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: 830ff28 2026-06-17; the sentence pre-dates the merge and was re-read because f26619c 2026-09-08 changed line 12 beside it.
- verdict: retire
- superseded-by: S002
- reason: Duplicate ledger entry, no text change: the same sentence is held as C003, which keeps at HEAD line 12. C003 is superseded by S002, which carries the passage, so this record retires no passage of its own.

### R002
- key: Push back on a wrong finding and state your reason; treat doing so as correct rather than insubordinate.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: 830ff28 2026-06-17; re-read after f26619c 2026-09-08 changed line 12 beside it.
- verdict: retire
- superseded-by: S003
- reason: Duplicate ledger entry, no text change: held as C005, which keeps at HEAD line 12. C005 is superseded by S003, which carries the passage, so this record retires no passage of its own.

### R003
- key: Adjudicate every finding.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: 830ff28 2026-06-17; re-read after f26619c 2026-09-08 changed line 12 beside it.
- verdict: retire
- superseded-by: S004
- reason: Duplicate ledger entry, no text change: held as C003, which keeps at HEAD line 12. C003 is superseded by S002 and the passage at the merged commit is S004's, so this record retires no passage of its own.

### R004
- key: Do not rubber-stamp a finding and do not reflexively defer to one.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: 830ff28 2026-06-17; re-read after f26619c 2026-09-08 changed line 12 beside it.
- verdict: retire
- superseded-by: S005
- reason: Duplicate ledger entry, no text change: held as C004, which keeps at HEAD line 12. C004 is superseded by S005, which carries the passage, so this record retires no passage of its own.

### R005
- key: Read a finding's trace before you read its severity.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: f26619c 2026-09-08, review-loop-provenance plan section 2, from the twenty-round section of 2026-09-08 where a Major nobody asked for was built one repair per round (now a `migrated` kaizen issue).
- verdict: retire
- superseded-by: S006
- reason: New at HEAD, no finding, no duplicate in this range; the one sentence the plan directed this skill to carry as the adjudication-time pointer at executing-work's provenance read. Superseded at `4b2e64c` by S006 (the Section 8 merge; the verdict before it was keep).

### R006
- key: Re-trace a Major finding marked `trace: none` against the trace target yourself before holding anything on it.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: f26619c 2026-09-08, review-loop-provenance plan section 2.
- verdict: retire
- superseded-by: S007
- reason: New at HEAD, no finding; a `trace: none` is the lens's claim about the plan and is verified like any other claim before it is acted on, consistent with C013. Superseded at `4b2e64c` by S007 (the Section 8 merge; the verdict before it was keep).

### R007
- key: Send a re-traced `trace: none` Major to the provenance paragraph in executing-work's step 4 rather than into a fix.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: f26619c 2026-09-08, review-loop-provenance plan section 2.
- verdict: retire
- superseded-by: S008
- reason: New at HEAD, no finding; routes to the owner of the disposition, consistent with C023. Superseded at `4b2e64c` by S008 (the Section 8 merge; the verdict before it was keep).

### R008
- key: Trace a blind lens's findings yourself at adjudication.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: f26619c 2026-09-08, review-loop-provenance plan section 2 (the orchestrator supplies the blind lens's trace, recorded as orchestrator-made).
- verdict: retire
- superseded-by: S009
- reason: New at HEAD, no finding; the blind lens carries no trace by design, which is the same structural fact C053 rests on. Superseded at `4b2e64c` by S009 (the Section 8 merge; the verdict before it was keep).

### R009
- key: Keep a Critical finding, and any security finding of Critical or Major weight, on its own route whatever its trace says.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: f26619c 2026-09-08, review-loop-provenance plan section 2 (the exemption executing-work's provenance paragraph states).
- verdict: retire
- superseded-by: S010
- reason: New at HEAD, no finding; the bound R006 and R007 need so the provenance route never delays a Critical or a security finding. Superseded at `4b2e64c` by S010 (the Section 8 merge; the verdict before it was keep).

### R010
- key: Route docs-curator's Drift Report to the operator per finishing-work instead of adjudicating it yourself.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: 830ff28 2026-06-17 and dd5e568 2026-08-24; re-read after f26619c 2026-09-08 changed line 12 beside it.
- verdict: retire
- superseded-by: S011
- reason: Duplicate ledger entry, no text change: held as C006, which keeps at HEAD line 12. C006 is superseded by S011, which carries the passage, so this record retires no passage of its own.

### R011
- key: Read finishing-work's step 4 for which adjudications are yours, including the pre-change read a `mistake`'s `Basis:` line calls for.
- class: pointer
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: dd5e568 2026-08-24; re-read after f26619c 2026-09-08 changed line 12 beside it.
- verdict: retire
- superseded-by: S012
- reason: Duplicate ledger entry, no text change: held as C006, which keeps at HEAD line 12. C006 is superseded by S011 and the passage at the merged commit is S012's, so this record retires no passage of its own.

### R012
- key: Record each such adjudication as finishing-work's step 4 directs.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: dd5e568 2026-08-24; re-read after f26619c 2026-09-08 changed line 12 beside it.
- verdict: retire
- superseded-by: S014
- reason: Duplicate ledger entry, no text change: held as C006, which keeps at HEAD line 12. C006 is superseded by S011 and the passage at the merged commit is S014's, so this record retires no passage of its own.

### S001
- key: Treat every review-agent finding as fallible, because it can be wrong, out of scope, or built on context the agent lacked.
- class: rationale-example
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: 830ff28 2026-06-17, installed with the skill as ported from Daren's fork and session mining; 55c5abc 2026-09-09 changed only the step number beside it.
- verdict: keep
- reason: The three named failure modes are the recognizer a session adjudicates a finding against, and C002's retirement of the line 8 motivation rests on this operative form staying here; nothing mechanical checks a finding for any of the three.
- passage: **Review-agent findings**, from any lens, are input to your judgment, not orders. A finding can be wrong, out of scope, or built on context the agent lacked.

### S002
- key: Give every finding an honest verdict.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: 830ff28 2026-06-17, installed with the skill; the enumeration grew in 12ef61f (blind lens) and a5fce80 (document battery); 55c5abc 2026-09-09 changed only the step number beside it.
- verdict: keep
- reason: No hook makes a session return a verdict on a finding, and the enumeration is what binds each new lens to the rule; supersedes C003, of which R001 was a retired duplicate.
- passage: Adjudicate each with an honest verdict, never a rubber stamp or reflexive deference, and push back on a wrong one with the reason.

### S003
- key: Push back on a wrong finding and state the reason; treat doing so as correct rather than insubordinate.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: 830ff28 2026-06-17, installed with the skill; 55c5abc 2026-09-09 changed only the step number beside it.
- verdict: keep
- reason: The "not insubordinate" clause is the license a session needs against the pull to defer; supersedes C005, of which R002 was a retired duplicate.
- passage: Adjudicate each with an honest verdict, never a rubber stamp or reflexive deference, and push back on a wrong one with the reason.

### S004
- key: Adjudicate every finding.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: 830ff28 2026-06-17, installed with the skill; 55c5abc 2026-09-09 changed only the step number beside it.
- verdict: keep
- reason: Shares the C003 -> S002 supersession, C003's key having merged the two sentences; R003 was its retired duplicate. Unenforced by machinery and the sentence the whole skill hangs on.
- passage: Adjudicate each with an honest verdict, never a rubber stamp or reflexive deference, and push back on a wrong one with the reason.

### S005
- key: Do not rubber-stamp a finding and do not reflexively defer to it.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: 830ff28 2026-06-17, installed with the skill; 55c5abc 2026-09-09 changed only the step number beside it.
- verdict: keep
- reason: The two failure modes are the anti-sycophancy pair this skill exists for and nothing mechanical catches either; supersedes C004, of which R004 was a retired duplicate.
- passage: Adjudicate each with an honest verdict, never a rubber stamp or reflexive deference, and push back on a wrong one with the reason.

### S006
- key: Read a finding's trace before you read its severity.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: f26619c 2026-09-08, review-loop-provenance plan section 2, from the twenty-round section of 2026-09-08 where a Major nobody asked for was built one repair per round (now a `migrated` kaizen issue); 55c5abc 2026-09-09 changed only the step number beside it.
- verdict: keep
- reason: Incident-born and the one sentence the plan directed this skill to carry as the adjudication-time pointer at executing-work's provenance read; supersedes R005.
- passage: Executing-work's step 4 routes each finding, its trace and provenance read before its severity, claim findings included.

### S007
- key: Re-trace a Major carrying `trace: none` against the trace target yourself before holding anything on it.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:14
- provenance: f26619c 2026-09-08, review-loop-provenance plan section 2; 55c5abc 2026-09-09 changed only the step number beside it. goal-fit section 3 2026-09-19 widened the claim a `trace: none` makes to name the Intent clause beside the acceptance bullet and the Goal sentence, matching the provenance read's first value.
- verdict: retire
- reason: row 1096 (Trace-first routing of findings), merged into executing-work step 4, which carries "re-trace a `trace: none` against that target before holding anything on it".
- passage: A `trace: none` on a Major claims that no acceptance bullet, Goal sentence or Intent clause asked for what the finding names. Re-trace that claim against the trace target before holding anything on it.

### S008
- key: Send such a finding to the provenance paragraph in executing-work's step 4 instead of into a fix.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: f26619c 2026-09-08, review-loop-provenance plan section 2; 55c5abc 2026-09-09 changed only the step number beside it.
- verdict: keep
- reason: Routes to the owner of the disposition, consistent with C023, and the provenance paragraph still sits at executing-work's step 4 at HEAD (executing-work SKILL.md line 423); supersedes R007. Amendment 2 note at section 34's close: "line 423" describes executing-work before section 4; at HEAD the provenance paragraph sits at line 411, under the bold lead "A Major enters a fix round on its provenance, never on its severity alone.", inside step 4's block, and line 423 is the out-of-scope route. The claim holds.
- passage: Executing-work's step 4 routes each finding, its trace and provenance read before its severity, claim findings included.
- flag: stale

### S009
- key: Trace a blind lens's findings yourself at adjudication.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: f26619c 2026-09-08, review-loop-provenance plan section 2 (the orchestrator supplies the blind lens's trace, recorded as orchestrator-made); 55c5abc 2026-09-09 changed only the step number beside it.
- verdict: retire
- reason: row 1096 merge. Executing-work step 4 carries it: "The orchestrator traces the blind lens's, and any finding reading `trace: unsupplied`".
- passage: A blind lens carries no trace by design, so trace its findings yourself.

### S010
- key: Keep a Critical, and any security finding of Critical or Major weight, on its own route regardless of its trace.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: f26619c 2026-09-08, review-loop-provenance plan section 2 (the exemption executing-work's provenance paragraph states); 55c5abc 2026-09-09 changed only the step number beside it.
- verdict: retire
- superseded-by: S021
- reason: The bound S007 and S008 need so the provenance route never delays a Critical or a security finding; supersedes R009. Retired by reviewer-reranking section 1 2026-09-20: the route is keyed on the lens, so a correctness Critical keeps it (S021) and an advisory lens's finding takes executing-work's advisory disposition (S022).

### S011
- key: Route the docs-curator Drift Report to the operator, following finishing-work.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: 830ff28 2026-06-17 routed the report to the operator; dd5e568 2026-08-24 (verification-artifacts plan) replaced the "exactly one" cap with the class finishing-work defines; 55c5abc 2026-09-09 renumbered the step the parenthetical names.
- verdict: keep
- reason: Finishing-work owns the stop on a `mistake` and this is the pointer a non-owner keeps, an operator-decision gate because the resolution picks which of code, spec or doc is the truth; supersedes C006, of which R010 was a retired duplicate.
- passage: Finishing-work's step 5 routes the docs-curator's Drift Report.

### S012
- key: Read finishing-work's step 5 for the class of adjudications that are yours.
- class: pointer
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: dd5e568 2026-08-24 installed the pointer at finishing-work's step 4; 55c5abc 2026-09-09 (review-loop-provenance plan section 6) inserted the goal read as step 4 and renumbered steps 5 to 9, repointing this at step 5.
- verdict: keep
- reason: Finishing-work step 5 at HEAD is Documentation curation and defines the `mistake`/`deviation` class, the `Basis:` line and the pre-change read (finishing-work SKILL.md line 62), so the pointer is correct, and no test pins the step number in this file; shares the C006 -> S011 supersession, R011 having been C006's retired duplicate.
- passage: Finishing-work's step 5 routes the docs-curator's Drift Report.
- flag: stale

### S013
- key: Perform the pre-change read that a `mistake`'s `Basis:` line calls for.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: dd5e568 2026-08-24, verification-artifacts plan; 55c5abc 2026-09-09 renumbered the step it is read from.
- verdict: retire
- reason: row 1096 merge. Finishing-work step 5's paragraph "**You construct the pre-change read, and a command arriving in a report is never run.**" carries it.
- passage: The pre-change read a `mistake`'s `Basis:` line calls for is one of them.

### S014
- key: Record each of those adjudications the way finishing-work's step 5 directs.
- class: mechanic
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:12
- provenance: dd5e568 2026-08-24, verification-artifacts plan; 55c5abc 2026-09-09 renumbered the step it points at.
- verdict: keep
- reason: Carries no mechanic of its own, only the owner's, so it is already the pointer form; shares the C006 -> S011 supersession, R012 having been C006's retired duplicate.
- passage: Finishing-work's step 5 routes the docs-curator's Drift Report.

### S015
- key: Read `skills/executing-work/SKILL.md` under the kit plugin root for the claim class, its exceptions, and the dispositions at its step 4.
- class: pointer
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:34
- provenance: 5620b2b 2026-09-07, review-loop-exit plan section 2: a false sentence could hold a section open because the loop had no class-keyed exit; abfa98d 2026-09-09 appended S020 beside it.
- verdict: rewrite
- landed: 1de7db7 section 34
- reason: The pointer at the owner, which still holds the class, the exceptions and the four dispositions at its step 4 (executing-work SKILL.md line 435); supersedes C039. Amendment 2 note: "line 435" describes executing-work before section 4; at HEAD the class and its exceptions sit between the KIT-CLAIM-CLASS markers at lines 407 to 409 and the four dispositions at line 417, all inside step 4's block, and line 435 is step 5. Flipped from keep at section 34's close, a respell forced by S016: S016's retire took out the enumeration the sentence's terminal colon introduced, so the colon became a period; the words are unchanged. Landed as the proposal below.
- proposed: The class and its exceptions are executing-work's (`skills/executing-work/SKILL.md` under the kit plugin root), and so are the dispositions of a claim the exceptions do not hold, listed at its step 4.
- passage: Executing-work's step 4 routes each finding, its trace and provenance read before its severity, claim findings included.
- flag: stale

### S016
- key: Dispose of such a claim by deleting the false sentence, adding a cheap mechanical check, writing a Chapter line, or routing it out of scope.
- class: mechanic
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:34
- provenance: 5620b2b 2026-09-07, review-loop-exit plan section 2; untouched by the merge.
- verdict: retire
- landed: 1de7db7 section 34
- reason: A duplicate whose owner already carries it: executing-work step 4 states the same four forms verbatim at line 435, and the S015 pointer beside it names that step, so dropping the copy loses no instruction. Baseline-test: yes. Retired at line 34 at section 34's close: the four enumerated forms are gone and the S015 pointer is their sole carrier. Amendment 2 note: "line 435" describes executing-work before section 4; at HEAD the four forms sit verbatim at line 417, inside step 4's block under the bold lead "The loop ends on the class of what remains, never on a count or a rating:", and line 435 is step 5.
- proposed: Drop the enumerated four forms from line 34 and leave the S015 pointer at executing-work's step 4 as the sole carrier.
- baseline-test: yes

### S017
- key: Do not rewrite the sentence, because a rewritten sentence re-enters the class it was written to leave.
- class: rationale-example
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:34
- provenance: 5620b2b 2026-09-07, review-loop-exit plan section 2; untouched by the merge.
- verdict: retire
- landed: 1de7db7 section 34
- reason: Rationale S018 is obeyable without, and its why now lives here: a rewritten sentence re-enters the claim class it was written to leave, so a fix brief carrying one restarts the loop it was meant to close. Baseline-test: yes. Retired at line 34 at section 34's close: the clause is gone, and no other surface in the corpus carries it.
- proposed: Drop the "A rewritten sentence re-enters the class" clause from line 34; the ledger entries for S017 and S018 carry the why.
- baseline-test: yes

### S018
- key: Never put a replacement sentence in a fix brief for a claim finding.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:34
- provenance: 5620b2b 2026-09-07, review-loop-exit plan section 2, which placed this rule here deliberately; abfa98d 2026-09-09 appended S020 beside it.
- verdict: retire
- landed: 1de7db7 section 34
- reason: row 1107 (Claim finding fix routing), merged into executing-work step 4, which closes the exits: "A claim finding leaves only by one of four forms: deleting the false sentence, a cheap mechanical check where the claim earns keeping, a Chapter line naming the sentence left standing and why the finding does not hold, or the out-of-scope route".
- proposed: Compress line 34 to the S015 pointer plus one rule sentence: a claim finding's fix brief never carries a replacement sentence, a claim an exception holds is owed the behavior bar in the same fix round, and every other lands in the close pass executing-work's step 4 owns.
- baseline-test: yes
- passage: A fix brief for such a claim never carries a replacement sentence.

### S019
- key: Hold a claim to the behavior bar when either exception applies to it.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:34
- provenance: 5620b2b 2026-09-07; the exceptions themselves live in executing-work's KIT-CLAIM-CLASS region, pinned by test/claim-class-parity.test.js; abfa98d 2026-09-09 appended S020 beside it.
- verdict: retire
- landed: 1de7db7 section 34
- reason: row 1107 merge. Executing-work step 4 carries it: "A claim held to the behavior bar is dispositioned in the same fix round".
- proposed: Fold into the single rule sentence A018 names as its exception clause.
- baseline-test: yes
- passage: A claim an exception holds is owed the behavior bar in the same fix round.

### S020
- key: Land every other claim finding's fix in the section's close pass along with the other Minors.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:34
- provenance: abfa98d 2026-09-09, review-loop-provenance plan section 5: per-round Minor fixes at the writer tier grew the diff the next lenses read and bred text findings, so Minors and unexcepted claim findings now take one close pass per section; the plan directed this skill to carry one sentence.
- verdict: retire
- landed: 1de7db7 section 34
- reason: row 1107 merge. Executing-work step 4 carries it: "every other claim finding joins the Minors whatever its rating".
- proposed: Merge into A018's rule sentence as the "every other" half of the class split, naming executing-work's step 4 as the owner of the close pass rather than restating the pass.
- baseline-test: yes
- passage: Every other claim lands in the close pass that step owns.
- flag: stale

### S021
- key: Keep a Critical from a correctness lens on its own route whatever its trace.
- class: rule
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:14
- provenance: docs/plans/claude-kit_reviewer-reranking_spec_v1.md section 1 2026-09-20.
- verdict: retire
- reason: row 1096 merge. Executing-work step 4 carries it: "A Critical from a correctness lens is fixed before the section closes or raised to me, its provenance read for the Metrics line alone, so it is never held and never bucketed.".
- passage: A Critical from a correctness lens keeps its own route whatever its trace.

### S022
- key: Send an advisory lens's Critical or Major, the performance-reviewer's or the security-reviewer's, to executing-work's advisory disposition paragraph for its route rather than routing it here.
- class: pointer
- source: plugins/grimoire/skills/responding-to-review/SKILL.md:14
- provenance: docs/plans/claude-kit_reviewer-reranking_spec_v1.md section 1 2026-09-20.
- verdict: retire
- reason: row 1096 merge. Executing-work step 4 carries it: "**An advisory lens's Critical or Major is weighed and dispositioned, never routed.**".
- passage: An advisory lens's Critical or Major, the performance-reviewer's or the security-reviewer's, takes the advisory disposition paragraph at executing-work's step 4 for its route, and nothing here.
