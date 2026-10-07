# Rationale ledger: writing-skills

This file is the rationale ledger for the documents the `writing-skills` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/writing-skills/SKILL.md

This document is the kit's rulebook for authoring and amending behavior-shaping prose. It owns the moments where a session decides whether a new skill earns a file at all, how a SKILL.md is shaped (frontmatter, body, one owner per rule, size-budget caps), how a description states its trigger, which rule form fixes which observed failure, what facts a rule may rest on, the three sentence-shape bars for any prose the kit ships in its own voice, the paragraph-as-edit-unit rule for correcting a claim in curated prose and how carriers of that claim on other surfaces are routed, and the RED/GREEN/REFACTOR probe discipline (including the probe-corpus before-and-after pair, doctrine-probe staging, and the contaminated-RED case) that must run before a wording change is trusted. Its load class is `named-trigger`: the frontmatter says to use it when creating or editing a skill, when judging whether a wording change will change behavior, or when amending curated prose the kit ships, with triggers such as adding a new SKILL.md, reworking a skill's rules, correcting a claim a curated document states, or a kaizen change to the kit's own skills.

Extracted at `6bc07fb`: whole document (`skills.writing-skills.SKILL.md`). Re-extracted at `4b2e64c` over the hunks the Section 8 merge changed (`S` entries below). Amended by `docs/plans/claude-kit_skill-guidance-alignment_spec_v1.md` section 1 on 2026-10-05 (H001 below, with C032 retired to it and C007 and S026 retired, as that section cut those sentences to pay for the description rule). Redrafted on 2026-09-26 by section 8 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, landed at `36998390` with its fix round at `6f26f01a`, so every live entry's `passage:` line the skill guidance alignment plan did not re-quote quotes the text at `6f26f01a` and the `flag:` lines record that pass's flags.

### C001
- key: Name the specific failure a skill change is meant to fix before writing the change.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:8
- provenance: 830ff28 2026-06-17, the writing-skills skill ported from a fork with the session-mined completion contract; no incident beyond the port.
- verdict: retire
- landed: 22eafd6 section 31
- reason: Line 33 (C036) owns the rule with the table that makes it actionable; line 8 is the opening summary, and the one-owner rule this file carries makes a summary restatement the copy. Safe because the owner sits in the same file and nothing loads line 8 without line 33. Lands at line 8 as 'Treat a skill change like a code change.', the three-clause summary cut under A001 with the untagged line's stop-at-"code change" option, which one wording satisfies with A001's cut; the two principle sentences before it stand word for word.
- proposed: Line 8 keeps "A skill is behavior-shaping prose, not documentation" and the decoration sentence, and the treat-it-like-code sentence stops at "code change" or points at the three sections.
- proposed: (via A001) Cut the three-clause summary from line 8, leaving the principle sentences; the sections below carry the three rules.
- baseline-test: yes

### C002
- key: Pick the rule form that fixes the named failure rather than any form you prefer.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:8
- provenance: 830ff28 2026-06-17, the fork port; no incident beyond the port.
- verdict: retire
- landed: 22eafd6 section 31
- reason: C036 owns the form-picking rule and the failure table; the line 8 clause is a restatement in the opening summary. Retired at line 8 with the three-clause summary, under A001's one cut over C001, C002 and C003.
- proposed: (via A001) Cut the three-clause summary from line 8, leaving the principle sentences; the sections below carry the three rules.
- baseline-test: yes

### C003
- key: Confirm the new wording actually works before trusting it.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:8
- provenance: 830ff28 2026-06-17, the fork port; no incident beyond the port.
- verdict: retire
- landed: 22eafd6 section 31
- reason: C083 at line 79 owns the rule with the method (watch an agent with and without the wording); the line 8 clause is the summary of it. Retired at line 8 with the three-clause summary, under A001's one cut over C001, C002 and C003.
- proposed: (via A001) Cut the three-clause summary from line 8, leaving the principle sentences; the sections below carry the three rules.
- baseline-test: yes

### C004
- key: Create a skill only where the technique is non-obvious, recurs across efforts, and is general.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:12
- provenance: 830ff28 2026-06-17, the fork port; no incident beyond the port.
- verdict: keep
- reason: No finding. The create test is the only statement of when a skill earns a file, and no hook or test judges it.
- passage: **Create when** the technique is non-obvious, recurs across efforts, and is general.

### C005
- key: Put a single project's convention in that project's CLAUDE.md, not in a skill.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:12
- provenance: 830ff28 2026-06-17, the fork port; no incident beyond the port.
- verdict: keep
- reason: No finding. The routing of a project convention away from the kit is unenforced and recurs at every kaizen change.
- passage: A single project's convention goes in that project's CLAUDE.md.

### C006
- key: Do not create a skill for a one-off, a restatement of standard practice, or anything a hook or regex can enforce.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:13
- provenance: 830ff28 2026-06-17, the fork port; no incident beyond the port.
- verdict: keep
- reason: No finding. The do-not-create list is the negative half of C004 and closes with the automate-the-mechanical class.
- passage: **Do not create** for a one-off, a restatement of standard practice, or anything a hook or regex can enforce.

### C007
- key: Automate mechanically enforceable rules and reserve skills for judgment.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:13
- provenance: 830ff28 2026-06-17, the fork port; no incident beyond the port.
- verdict: retire
- landed: 6c404674 section 1
- reason: Cut in skill-guidance-alignment section 1: the sentence restates C006's class (anything a hook or regex can enforce) as its positive form and adds no bound. The principle the audit's own retire-as-superseded verdict rests on stands in C006.
- passage: Automate the mechanical and keep skills for judgment.

### C008
- key: A new skill must beat the alternative of adding one more paragraph to an existing skill.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:14
- provenance: 830ff28 2026-06-17, the fork port; no incident beyond the port.
- verdict: keep
- reason: The bar stands as worded; the antipattern copy at line 100 (C132) retires and the cost claim (C010) moves here. The why: every skill is paid for in every session's skill list, since the skill catalog rides every session's prompt.
- passage: A new skill must beat one more paragraph in an existing skill.

### C009
- key: When in doubt, fold the guidance into an existing skill rather than adding a file.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:14
- provenance: 830ff28 2026-06-17, the fork port; no incident beyond the port.
- verdict: keep
- reason: The default stands as worded; the line 100 antipattern that restated it retires, and no machinery decides the fold-versus-file call.
- passage: When in doubt, fold it in rather than add a file.

### C010
- key: Weigh a new skill knowing every skill is paid for in every session's skill list.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:14
- provenance: 830ff28 2026-06-17, the fork port; no incident beyond the port.
- verdict: retire
- landed: 22eafd6 section 31
- reason: The lean bar (C008) is obeyed without the cost claim, so the why lives here: a skill's description sits in every session's skill list, so every skill costs every session context whether or not it loads. Retired at line 14: the sentence 'Every skill is paid for in every session's skill list.' left whole, and the bullet's lead and its two remaining sentences stand word for word.
- proposed: Move "Every skill is paid for in every session's skill list" to the ledger entry for C008.

### C011
- key: A curated file that grows raises its size cap in the same change, and one that shrinks lowers it.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:15
- provenance: c591c49 2026-09-08, the operator's mid-run ruling that Subtraction Bars was meant to encourage cutting and never to forbid adding, which turned the ratchet from a ceiling into a ledger and gave kit-size a sync verb.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: The rule holds; its sentence also carries the sync command and the shared-checkout reason at sixty words, which the file's own one-idea bar forbids. Split into rule, then command; the ratchet test (test/size-ratchet.test.js) reds a stale cap but nothing moves one for the session. Lands at line 15 as 'A file that grows raises its cap in the same change, and one that shrinks lowers it.' followed by the command as C012's own sentence, the shared-checkout reason (C013) gone, C014, C016, C017, C018, C133 and C134 standing word for word and A017's bare-form sentence landed under C015; the split keeps the command on the bullet's own markdown line, which `test/size-ratchet.test.js`'s test named `the writing-skills ledger bullet names a sync verb the script exports and flags its parser takes` (declared at line 3137 at dcb01e7) requires, a pin the spec's Wording pins line and the brief both missed. Its landing respelled C012's keep sentence; C012 records the flip.
- proposed: Split the sentence into the grow-and-shrink rule, then the command as its own sentence, with the shared-checkout reason (C013) moved to the ledger; keep C014, C016, C017, C018, C133, C134 as worded, and apply A017 to the bare-form sentence.
- baseline-test: yes
- passage: A file that grows raises its cap in `test/size-budget.json` in the same change, and one that shrinks lowers it.

### C012
- key: Move caps with `node <plugin-root>/scripts/kit-size.js sync --repo <project root> <path>...`, naming the files the change touched.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:15
- provenance: c591c49 2026-09-08, the sync verb added to kit-size.js in the same commit as the ledger rule.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: The ratchet test makes a stale cap visible but nothing runs sync for the session, and the path list is the writer's choice. The why of naming paths (C013, moved here): on a shared checkout the bare form would move the caps of a peer's in-flight files into your diff. Flipped from keep to rewrite at section 31's close: C011's split made this clause its own sentence with a leading verb, as C011's proposal orders, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Move the caps with `node <plugin-root>/scripts/kit-size.js sync --repo <the project's root> <path>...`, naming the files the change touched.
- passage: Move the caps with `node <plugin-root>/scripts/kit-size.js sync --repo <the project's root> <path>...`, naming the files the change touched, a new file's first cap included, tracked or not.

### C013
- key: Name the touched paths so a peer's in-flight files' caps stay out of your diff on a shared checkout.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:15
- provenance: c591c49 2026-09-08, written on a shared checkout where a peer's kaizen inbox was mid-edit.
- verdict: retire
- landed: 22eafd6 section 31
- reason: The instruction to name the touched paths is obeyed without the consequence, and the bare form's own refusal on a dirty tree covers the case mechanically; the why now lives under C012. Retired at line 15: the clause 'so that the caps of a peer's in-flight files on a shared checkout stay out of its diff' left with C011's split, and the path-naming instruction stands as C012's sentence.
- proposed: Move the shared-checkout consequence to the ledger entry for C012.

### C014
- key: Give a new curated file its first cap through the same sync command, whether or not it is added to git yet.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:15
- provenance: c591c49 2026-09-08, sync adds a first cap for a named path the budget lacks.
- verdict: keep
- reason: No finding of its own; it survives the line 15 split as its own sentence. The named-path form is what admits an untracked file, which the bare form refuses.
- passage: Move the caps with `node <plugin-root>/scripts/kit-size.js sync --repo <the project's root> <path>...`, naming the files the change touched, a new file's first cap included, tracked or not.

### C015
- key: Use the bare sync form with no paths only in an audit over a clean tree; it moves every cap and refuses on divergence from HEAD.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:15
- provenance: c591c49 2026-09-08, the bare form's clean-tree refusal designed in the same commit.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: The refusal conditions are enforced by plugins/grimoire/scripts/kit-size.js (usage text: sync runs "over a clean tree"; refusal at exit 2 on a file or the budget differing from HEAD, untracked or ignored), so the enumeration retires as superseded; the form-choice sentence stays because no program decides which form a writer reaches for. Lands at line 15 as 'The bare form with no paths moves every cap and belongs to an audit over a clean tree.', the enumerated refusal conditions gone; the script's usage text at `plugins/grimoire/scripts/kit-size.js` line 1918 and its two refusals at lines 1827 and 1833 at dcb01e7 report them.
- proposed: Keep "The bare form with no paths moves every cap and belongs to an audit over a clean tree"; drop the enumerated refusal conditions, which the script reports itself.
- passage: The bare form with no paths belongs to an audit over a clean tree.

### C016
- key: Read the net size change on the Chapter's Delta line.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:15
- provenance: c591c49 2026-09-08, the Delta line named as where the net is read.
- verdict: retire
- reason: row 1251 shrink. The net reading is what executing-work's Chapter template `Delta:` field quotes from `kit-size.js report` (`plugins/grimoire/skills/executing-work/SKILL.md` line 496), so the sentence only said where something else is said.
- passage: The net is read on the Chapter's Delta line.

### C017
- key: Do not treat a cap raise as a finding on its own; weigh whether the added words earn their place.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:15
- provenance: c591c49 2026-09-08, the operator's ruling that the ratchet never forbids adding.
- verdict: keep
- reason: It is the reviewer's duty that follows from the ledger principle (C133), which the principle does not state; the two are one bullet by design and no test weighs words.
- passage: A reviewer weighs only whether the added words earn their place, and a rewording takes the shrink where one is available.

### C018
- key: When rewording a passage, take the shrink where one is available.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:15
- provenance: c591c49 2026-09-08, the third clause of the ledger bullet.
- verdict: keep
- reason: No finding of its own; it is the subtraction half of the ledger rule and nothing enforces it.
- passage: A reviewer weighs only whether the added words earn their place, and a rewording takes the shrink where one is available.

### C019
- key: Write one SKILL.md in the kit's voice: direct, opinionated, anti-dogma, with no em dashes.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:19
- provenance: 830ff28 2026-06-17, the port, which installed the no-em-dash rule in the doctrine and here in one commit.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: The em-dash ban is the doctrine's Style bullet whole, with its scope; no test enforces it over the plugin payload, so it is a restatement rather than a superseded rule, and the doctrine owns it. Drop the item from the voice list; the rest of the line stands. Lands at line 19 as 'One SKILL.md, in the kit's voice: direct, opinionated, anti-dogma.' under A021, 'no em dashes' gone from the voice list and the rest of the line word for word; the doctrine's Style bullet (`plugins/grimoire/skills/operating-instructions/SKILL.md` line 24 at dcb01e7) owns the bar with its scope, and the landed file carries none.
- proposed: (via A021) Line 19 drops "no em dashes" from the voice list, the doctrine's Style bullet being the owner; the rest of the line stands.
- baseline-test: yes
- passage: One SKILL.md in the kit's voice: direct, opinionated, anti-dogma.

### C020
- key: Add a reference file only when the body outgrows the size of the kit's other skills, and gate it as csharp-style and sql-style do.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:19
- provenance: 830ff28 2026-06-17, the fork port; no incident beyond the port.
- verdict: keep
- reason: No finding. The reference-file gate is unenforced and the two style skills are its live instances.
- passage: Add a reference file only when the body outgrows the kit's other skills, gated the way csharp-style and sql-style gate theirs.

### C021
- key: Always quote the frontmatter description value.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:20
- provenance: 830ff28 2026-06-17 installed it; 73a485e 2026-07-15 found eight agent descriptions unquoted under it and quoted them.
- verdict: keep
- reason: The rule stands; its mechanism (C022) moves here: an unquoted value containing a colon-space breaks the YAML silently and drops all skill metadata, and no test parses the frontmatter for the writer.
- passage: **Frontmatter: always quote the description.**

### C022
- key: Quote it because an unquoted value containing a colon-space breaks the YAML silently and drops all skill metadata.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:20
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: retire
- landed: 22eafd6 section 31
- reason: The quote rule is mechanical and obeyed without the mechanism; the why now lives under C021. Retired at line 20: the sentence 'An unquoted value containing a colon-space breaks the YAML silently and drops all skill metadata.' left whole, and the bullet's lead and its last sentence stand word for word.
- proposed: Move the YAML-breakage sentence to the ledger entry for C021.

### C023
- key: Treat `name` and `description` as the only frontmatter fields that matter.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:20
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: keep
- reason: No finding. A harness fact the writer needs at authoring; note it is a harness claim and would fall under the line 96 antipattern if the harness gained a third field.
- passage: `name` and `description` are the two fields that matter.

### C024
- key: Build the body from the principle, the rules that carry judgment, and the antipatterns.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:21
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: keep
- reason: The anatomy every SKILL.md follows; the reader's compression of line 21 dropped it, which is why that compression was refused.
- passage: Body: the principle, the rules that carry judgment, the antipatterns.

### C025
- key: Use tables and lists for content that gets scanned and prose for the why.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:21
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: keep
- reason: Line 21's three sentences are each one idea and inside the bar; the compress finding was taste.
- passage: Tables for what gets scanned, prose for the why, and a flowchart only for a decision the agent might get wrong.

### C026
- key: Use a flowchart only for a decision where the agent might genuinely go wrong, never for linear steps.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:22
- provenance: 830ff28 2026-06-17, the fork port (the seed's 73a485e touched the line, not the sentence).
- verdict: keep
- reason: Stands with line 21; nothing to compress without loss.
- passage: Tables for what gets scanned, prose for the why, and a flowchart only for a decision the agent might get wrong.

### C027
- key: Give every rule exactly one owning site.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:22
- provenance: 73a485e 2026-07-15, the stabilization effort's authoring rule closing the drift generator it had reconciled (a dozen drifted copies, one in contradiction); the doctrine's "One owner per moment" bullet and the ownership map followed at 5cd8f22 2026-09-01.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: The doctrine now owns the principle with its form list and carve-outs and ranks above the skill for principles, so line 22 points at the doctrine's bullet and the map, keeping the authoring residue (C030). The why (C029, moved here): a rule stated twice is two rules a week later; the 2026-07-14 audit found a dozen drifted copies, one in outright contradiction. Lands at line 22 under A026 as 'The doctrine's one-owner bullet owns the principle and the forms a mention may take (`skills/operating-instructions/SKILL.md` under the kit plugin root). The ownership map that bullet names carries the owning document for each moment.', the bold lead word for word, C030's sentence standing as the authoring residue and C029's dated sentence gone.
- proposed: (via A026) Line 22 opens with a pointer at the doctrine's one-owner bullet and the ownership map, keeps C030 as the authoring residue, and drops C029 to the ledger (A032).
- baseline-test: yes
- passage: The doctrine's one-owner bullet and its ownership map own the principle and the forms a mention may take.

### C028
- key: Make every other mention of a rule a pointer or an operational residue at its point of action, never a restatement.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:22
- provenance: 73a485e 2026-07-15 installed the pointer form; ab3d766 2026-08-29 added the operational-residue form for the executing-work fix-round pointer.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: Real conflict with the doctrine's form list, which licenses a whole copy under a parity pin or build step; d2e2f37 confirmed that carve-out lives in the doctrine and the map and not here, and line 73 already treats the pinned set as a disposition. Line 22 gives way to a pointer at the doctrine's forms; the doctrine's list lacks the residue form and should gain it in the same change (the operating-instructions unit's finding). Lands at line 22 under A030 with the pointer C027 records and one sentence beside it, 'An operational residue at a rule's point of action is a form this kit ships that the doctrine's list does not name.', because the doctrine's landed bullet (`plugins/grimoire/skills/operating-instructions/SKILL.md` line 48 at dcb01e7, bold lead **One owner per moment, and the map names it**) lists the pointer and the whole copy under a parity pin or a build step and no residue form; the residue sentence leaves when that list gains the form, which stays the operating-instructions unit's finding as A030 ruled. Round 1 dropped that residue sentence: the doctrine's landed bullet admits a pointer or a whole copy and never a part, so a lower surface stating the residue form as a fact contradicted it, and the doctrine's missing form is the operating-instructions unit's finding, captured in the kaizen inbox on 2026-09-12.
- proposed: (via A030) Line 22 points at the doctrine's bullet for the forms a mention may take; the doctrine's list should gain the operational-residue form in the same change, which is a finding for the operating-instructions unit.
- baseline-test: yes
- passage: The doctrine's one-owner bullet and its ownership map own the principle and the forms a mention may take.

### C029
- key: Treat a rule stated twice as two rules a week later, as the 2026-07-14 stabilization audit's dozen drifted copies showed, one in outright contradiction.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:22
- provenance: 73a485e 2026-07-15, the stabilization audit's own finding.
- verdict: retire
- landed: 22eafd6 section 31
- reason: The rule is obeyed without the date and count, and a dated finding in a shipped document is journey under the doctrine's state-versus-journey bullet; the why now lives under C027. Retired at line 22: the sentence 'A rule stated twice is two rules a week later: the 2026-07-14 stabilization audit found a dozen drifted copies, one in outright contradiction.' left whole.
- proposed: Move the 2026-07-14 audit sentence to the ledger entry for C027.
- baseline-test: yes

### C030
- key: When editing a rule, grep its key phrases across the kit and fix the owning site rather than the nearest copy.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:22
- provenance: 73a485e 2026-07-15, the authoring mechanic of the one-owner rule.
- verdict: keep
- reason: The authoring residue the doctrine's principle does not carry; C076 at line 73 is its pointer-with-residue inside the carrier dispositions, not a duplicate, since ab3d766 found a three-disposition set defective.
- passage: When editing a rule, grep its key phrases across the kit and fix the owner, not the nearest copy.

### C031
- key: For the plan-doc header and structure, read and point at `curating-docs/SKILL.md`'s "machine contract" section rather than restating any of its lines.
- class: pointer
- source: plugins/grimoire/skills/writing-skills/SKILL.md:23
- provenance: 662e5e3 2026-08-01, an external engine parsing every plan doc case-sensitively with nothing telling an author which lines are load-bearing; curating-docs took the contract and this skill a pointer.
- verdict: keep
- reason: No finding. A pointer at a frozen shape external tooling parses; the pointer sits here because this is the skill loaded when a plan doc's shape is written.
- passage: Point at `curating-docs/SKILL.md`'s "Plan Doc Machine Contract" section for the plan-doc header and structure, never restating its lines.

### C032
- key: Write a skill description as "Use when..." plus the symptoms that pull it in, and stop there.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:27
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: retire
- superseded-by: H001
- landed: 81d70149 section 1
- reason: The opening-clause rule replaced this wording, and H001 holds the passage at its new text. Before that, the rule stood as worded; line 27's opening sentence on what a description is for, and the mechanism (C034), are rationale that move here: the description is how a future session decides whether to load the skill. Held at section 31's close: this keep's own reason moves line 27's opening sentence ('The description is how a future session decides whether to load the skill.') to the ledger, and no rewrite entry orders that move, so the sentence stands word for word as sections 23 to 30 left their like cases, and the trim goes to the operator's keep-held batch.
- passage: Write it as "Use when..." plus the symptoms that pull it in, and stop.

### C033
- key: Do not summarize the skill's process in its description.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:27
- provenance: 830ff28 2026-06-17, the fork port; fdd7b82 2026-07-15 collapsed the stale live specimen to the rule and its evidence.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: The rule stands; the antipattern copy at line 97 (C129) retires. The why (C034, C035 moved here): an agent that reads a process summary acts on the summary and skips the body, so a step the body insists on gets dropped; a description reading "code review between tasks" yielded one review where the body specified two. Flipped from keep to rewrite at section 31's close: C034's retirement took the colon clause after this sentence, so its terminal mark is now a period after 'there', and the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Do not summarize the skill's process there.
- passage: Do not summarize the skill's process there.

### C034
- key: Omit the process summary because an agent acts on the summary and skips the body, dropping a step the body insists on.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:27
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: retire
- landed: 22eafd6 section 31
- reason: The prohibition is obeyed without the mechanism; the why now lives under C033. Retired at line 27: the clause 'an agent that reads a process summary acts on the summary and skips the body, so a step the body insists on gets dropped' left with its colon, so C033's sentence ends at 'there'. Its retirement respelled C033's keep sentence; C033 records the flip.
- proposed: Move the acts-on-the-summary mechanism to the ledger entry for C033.
- baseline-test: yes

### C035
- key: Note that a description reading "code review between tasks" yields one review where the body specifies two.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:29
- provenance: 830ff28 2026-06-17 as a live specimen naming executing-work's old description; fdd7b82 2026-07-15 collapsed it to this general example when the description changed.
- verdict: retire
- landed: 22eafd6 section 31
- reason: A second illustration of the line 27 rule, which stands without either; the example now lives under C033. Retired at line 29: the paragraph 'A description that summarizes the workflow gets acted on in place of the body: a summary reading "code review between tasks" yields one review where the body specifies two.' left whole with its blank line, so the section is one paragraph.
- proposed: Move line 29 to the ledger entry for C033.
- baseline-test: yes

### C036
- key: Name the failure first, then pick the form that fixes that failure.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:33
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: keep
- reason: The owner of the name-then-pick rule, with the table and the bound that a form bulletproofing one failure backfires on another; C001 and C002 retire in its favour.
- passage: Name the failure first, then pick the form that fixes it. The form that fixes one failure backfires on another.

### C037
- key: For an agent that knows the rule but skips it under pressure, write a prohibition plus a rationalization table plus a red-flags list, not soft "prefer..." guidance.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:37
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: keep
- reason: No finding. A table row pairing a failure with its form; unenforced.
- passage: | Knows the rule, skips it under pressure | Prohibition, rationalization table and red-flags list | Soft "prefer
- passage: guidance |

### C038
- key: For compliant but wrong-shaped output, write a positive recipe stating what the output is and its parts in order, not a prohibition list.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:38
- provenance: 830ff28 2026-06-17, the fork port; 8cdb3f5 2026-09-04 records a section shipping the backfiring form this row names, which is the row's live incident.
- verdict: keep
- reason: The row owns the recipe rule with its backfire column; the antipattern copy at line 98 (C130) retires.
- passage: | Complies, but the output is wrong-shaped (bloated, buried, restated) | Positive recipe: what the output IS, its parts in order | Prohibition list ("don't restate") |

### C039
- key: For an omitted required element, add a structural slot: a REQUIRED field in the template the agent fills, not a prose reminder near the template.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:39
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: keep
- reason: No finding. A table row; unenforced.
- passage: | Omits a required element | Structural slot: a REQUIRED field in the template it fills | Prose reminder near the template |

### C040
- key: Where behavior should depend on a condition, write a conditional on an observable predicate, not an unconditional rule plus exemption clauses.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:40
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: keep
- reason: The table row pairs one failure with its form; line 44 (C042) governs how any exception in any rule is written. Two scopes, both kept.
- passage: | Behavior should depend on a condition | Conditional on an observable predicate ("if the brief exists, reference it") | Unconditional rule plus exemption clauses |

### C041
- key: Write no nuance clauses such as "don't X unless it matters", which reopen the negotiation.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:44
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: keep
- reason: Three short sentences each one idea; the compress finding was taste. The quoted clause defines the term for the reader.
- passage: **No nuance clauses.** "Don't X unless it matters" reopens the negotiation.

### C042
- key: Express a real exception as its own conditional on something observable.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:44
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: keep
- reason: Governs any rule, where C040 is one table row; not a duplicate.
- passage: Write a real exception as its own conditional on something observable.

### C043
- key: Where part of the output must be exempt, restructure the rule so it cannot reach that part rather than adding an exemption clause.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:45
- provenance: 830ff28 2026-06-17, the fork port; 8cdb3f5 2026-09-04 records a draft carrying an exemption clause against this rule, its live incident.
- verdict: keep
- reason: The rule and its bound (exemption clauses do not scope) stand; the example (C044, moved here): "this limit excludes code blocks" still suppresses code blocks.
- passage: **Exemption clauses do not scope.** Where part of the output must be exempt, restructure so the rule cannot reach it.

### C044
- key: Note that "this limit excludes code blocks" still suppresses code blocks.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:45
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: retire
- landed: 22eafd6 section 31
- reason: The restructure rule is obeyed without the instance; the example now lives under C043. Retired at line 43: the sentence '"This limit excludes code blocks" still suppresses code blocks.' left whole, and the bullet's lead and its rule sentence stand word for word.
- proposed: Move the code-blocks example to the ledger entry for C043.
- baseline-test: yes

### C045
- key: Close every enumeration by stating, where the list ends, the class its instances belong to.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:46
- provenance: 0605d85 2026-08-01, the capacity stop that rode a fatigue-shaped rationalization table no row of which matched a quality-shaped excuse.
- verdict: keep
- reason: Incident-born, recurrable at every list, and no machinery closes an enumeration; the two quoted closing phrases stay as the recipe. The why (C046, moved here): a list of instances reads as exhaustive the moment it ships, so an unlisted variant presents itself as licensed, and a class statement makes the novel variant meet the rule.
- passage: **Close every enumeration with its class.** Where the list ends, state its class ("the table is instances, not the boundary"; "the set is closed"), so a novel variant meets the rule.

### C046
- key: Close the list because it reads as exhaustive on shipping, so an unlisted variant presents itself as licensed; a class statement makes a novel variant meet the rule.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:46
- provenance: 0605d85 2026-08-01, the capacity stop.
- verdict: retire
- landed: 22eafd6 section 31
- reason: The close-the-list rule is obeyed without the licensing account; the why now lives under C045. Retired at line 44: the sentence 'A list of instances (a rationalization table, a blocker set, an antipattern list) reads as exhaustive the moment it ships, so an unlisted variant presents itself as licensed.' left whole, and the bullet's lead and its rule sentence stand word for word.
- proposed: Move the exhaustive-on-shipping sentence to the ledger entry for C045.
- baseline-test: yes

### C047
- key: Where two framings of one fact are both true, ship the one the reader can verify from where they sit.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:52
- provenance: a5e184b 2026-08-25, a review round whose three Majors were one defect: motivating clauses whose asserted mechanism the file's own contract or a grep denied.
- verdict: keep
- reason: Incident-born and unenforced. The why (C049, C135 moved here): "`memq recall` returns the whole memory store as one bounded digest" and "the memory store is available in bulk" are the same fact and only the first names something the reader can run; a rule taken on trust cannot be repaired when the fact under it moves, so the reader keeps obeying a rule that describes nothing.
- passage: Framing a fact so the reader can check it is the doctrine's "A claim is written in the form a reader can check" bullet.

### C048
- key: Name the file, command, observable event, or artifact the fact lives in, and pick the framing that makes it findable.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:52
- provenance: a5e184b 2026-08-25, the same round.
- verdict: retire
- reason: row 1257 merge. The doctrine's "A claim is written in the form a reader can check" bullet carries it ("a name over a description, a path over a location"). The pointer survives as C047's landed sentence.
- passage: Name the file, command, observable event or artifact the fact lives in, and pick the framing that makes it findable.

### C049
- key: Prefer "`memq recall` returns the whole memory store as one bounded digest" over "the memory store is available in bulk", because a rule taken on trust cannot be repaired when the fact underneath it moves.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:52
- provenance: a5e184b 2026-08-25, the same round.
- verdict: retire
- landed: 22eafd6 section 31
- reason: The rule names what a verifiable framing is (C048), so the pair demonstrates rather than defines; it now lives under C047. Retired at line 50: the `memq recall` pair sentence left whole, with C135's taken-on-trust sentence beside it, so the bullet reads its lead and C048's sentence alone; this file no longer points at the memory-system skill's description of the verb.
- proposed: Move the memq pair to the ledger entry for C047.
- baseline-test: yes

### C050
- key: State a list drawn from observed instances as open unless a contract closes it.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:53
- provenance: a5e184b 2026-08-25, the same round (a search key anchored on a set name the rule's own worked examples did not carry).
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: Merged with C052 into one rule, since the bullet's closing sentence restated its opening plus "say what would close it". The why (C136, moved here): an enumeration extracted from one fully-observed sample reads as exhaustive to its writer because every field was present and nothing contradicted it, so a reader branching on a field's absence is wrong for every instance the sample never contained. Lands at line 51 on both proposals together, read as complementary: the bold lead, then 'Closure comes from the contract (a schema, an enum, a validated surface with a published shape), never from the sample agreeing with itself.' (C051, word for word), then A051's one rule as the merged closing, 'So write the list as open and say what would close it, or cite the contract that already does.'; the fact-layer framing and C136's two sentences are gone.
- proposed: Line 53 keeps the bold rule, the closure-comes-from-the-contract sentence and the merged closing; the fact-layer framing and the fooled-writer sentences go to the ledger.
- proposed: (via A051) One rule: state a list drawn from observed instances as open and say what would close it, or cite the contract that already does.
- baseline-test: yes
- passage: **A list drawn from observed instances is stated as open unless a contract closes it.**
- passage: So write the list as open and say what would close it, or cite the contract that already does.

### C051
- key: Treat a list as closed only on a contract's authority: a schema, an enum, or a validated surface with a published shape, never a sample agreeing with itself.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:53
- provenance: a5e184b 2026-08-25, the same round.
- verdict: keep
- reason: The bound of C050, which the rule cannot be applied without; stays as its own sentence.
- passage: Closure comes from a contract (a schema, an enum, a validated surface with a published shape), never from the sample agreeing with itself.

### C052
- key: Write the list as open and say what would close it, or cite the contract that already closes it.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:53
- provenance: a5e184b 2026-08-25, the same round.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: Merged into C050; only the "say what would close it" clause is new and it rides in the merged sentence. Lands at line 51 inside C050's merged closing, 'So write the list as open and say what would close it, or cite the contract that already does.', the 'say what would close it' clause the only new words.
- passage: So write the list as open and say what would close it, or cite the contract that already does.

### C053
- key: Treat any fact a rule rests on that the reader cannot check or cannot see the edges of as inside this rule, even where no bullet names its form.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:55
- provenance: a5e184b 2026-08-25, the class closure this file's own line 46 requires.
- verdict: retire
- reason: row 1257 merge. The doctrine's "A claim is written in the form a reader can check" bullet carries the checkable-fact class, and C050's bullet carries the edges of a list.
- passage: Any fact a rule rests on that the reader cannot check, or whose edges they cannot see, is inside the rule.

### C054
- key: To decide whether a sentence belongs at all, read the doctrine's "Documents ship the current state; the journey lives in git" bullet in `skills/operating-instructions/SKILL.md` under the kit plugin root.
- class: pointer
- source: plugins/grimoire/skills/writing-skills/SKILL.md:59
- provenance: 8cdb3f5 2026-09-04, the subtraction-bars section 3 Critical: a delete test stated here reached append-only history and 94,000 words of reference documents, so whether a sentence belongs became the doctrine's call, pointed at.
- verdict: keep
- reason: No finding. The pointer is the repair for a widening both review lenses found independently; restating the litmus here is the defect it replaced.
- passage: Whether a sentence belongs is the doctrine's "Documents ship the current state; the journey lives in git" bullet's call.

### C055
- key: Write every sentence in the kit's own voice as one idea, in the literal phrase, pointing where another site owns the rule.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:61
- provenance: 8cdb3f5 2026-09-04 installed the three bars; d2e2f37 2026-09-05 touched the line in the finishing fix round.
- verdict: keep
- reason: The doctrine's plain-prose bullet names this file by path as carrying the sentence-shape bars for curated prose, so the overlap is a pointer already in place; two audiences (all operator-read prose; curated kit prose) by design.
- passage: Curated prose in the kit's own voice meets three sentence-shape bars:

### C056
- key: Make each sentence one idea, about twenty words.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:63
- provenance: 8cdb3f5 2026-09-04 installed the bar at forty words; 8b03bfb 2026-09-08 tightened it to twenty on the operator's relay request after reading a dense and a plain version of one plan sketch.
- verdict: keep
- reason: The doctrine points here for curated prose; scott-writing-style's 30-to-50-word sentences govern a document in the operator's voice, a different owner and audience. The shared figure is pinned on the doctrine's three copies (test/doctrine-parity.test.js) and not against this file, a drift risk to watch when either number moves.
- passage: A sentence is one idea, about twenty words.

### C057
- key: Write a rule and the bound that limits it as two sentences, the bound following the rule at once.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:63
- provenance: 8b03bfb 2026-09-08, the forty-word rule-plus-bound sentence being the exact shape the operator could not follow.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: The sentence stating this rule runs to about forty words with its exception clause inside, which is the bar's own failure; split into rule, bound and exception, nothing removed. Lands at line 61 as three sentences, 'A rule and the bound that limits it are two sentences, the bound following the rule at once. That way neither sentence is long and the rule is never read without its bound. They share one sentence only where the split would leave the rule readable alone.', nothing removed; the bullet's lead `- **One idea.**` stands at its line start, which the doctrine-parity test declared at line 787 pins.
- passage: A rule and the bound that limits it are two sentences, the bound right after the rule. They share one sentence only where the split would leave the rule readable alone.

### C058
- key: Use a word count past twenty as the diagnostic that finds a second idea, not as the bar itself.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:63
- provenance: 8b03bfb 2026-09-08, the twenty-word tightening.
- verdict: keep
- reason: Only this file says the twenty is a diagnostic rather than the bar; the doctrine points here.
- passage: A count past twenty is the diagnostic that finds a second idea, read per sentence and never as a target.

### C059
- key: Read the word count per sentence and never as a target, since uniform sentence length is its own defect.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:63
- provenance: 8b03bfb 2026-09-08, installed in the doctrine's core and here together.
- verdict: keep
- reason: The doctrine's copy is the pinned register core for operator communication; this one sits beside the count it qualifies for curated prose. The doctrine side is the operating-instructions unit's to rule.
- passage: A count past twenty is the diagnostic that finds a second idea, read per sentence and never as a target.

### C060
- key: Make each paragraph one point, or say inside the paragraph why its parts must be read together.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:63
- provenance: 8cdb3f5 2026-09-04, the one-idea bar's paragraph clause.
- verdict: keep
- reason: No finding of its own; survives the line 63 split as its own sentence.
- passage: A paragraph makes one point, or says why its parts must be read together.

### C061
- key: Use the literal phrase for the thing wherever one exists.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:64
- provenance: 8cdb3f5 2026-09-04 installed the literal-phrase bar naming mannered prose from Anthropic's guidance; 8b03bfb 2026-09-08 added the packed-sentence clause.
- verdict: keep
- reason: Stands as worded; the bullet's second sentence (C062) splits so the definition of mannered prose has its own sentence.
- passage: Where a literal phrase for the thing exists, the sentence uses it.

### C062
- key: Use a metaphor only where it is the established term for the thing; elsewhere it is mannered prose.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:64
- provenance: 8cdb3f5 2026-09-04, the literal-phrase bar.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: The sentence carries the rule and the three-clause definition of mannered prose; the definition is the term's meaning and the bar cannot be applied without it, so it stays as its own sentence rather than being cut. Lands at line 62 as two sentences, 'A metaphor stands where it is the established term for the thing and is mannered prose everywhere else. Mannered prose is metaphor and flourish substituted for direct statement, written to display the writer, dragging in connotations the writer did not choose.', the definition kept; the bullet's lead `- **The literal phrase.**` stands at its line start, which the doctrine-parity test declared at line 787 pins.
- passage: A metaphor stands only where it is the established term, and elsewhere it is mannered prose, flourish in place of direct statement, fixed by the literal phrase.

### C063
- key: Fix mannered prose by replacing it with the literal phrase.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:64
- provenance: 8cdb3f5 2026-09-04, the literal-phrase bar.
- verdict: keep
- reason: The fix sentence; the reader's compression dropped it, which is why that compression was refused.
- passage: A metaphor stands only where it is the established term, and elsewhere it is mannered prose, flourish in place of direct statement, fixed by the literal phrase.

### C064
- key: For the packed sentence, the nested qualification, and the reasoning-first order, read the doctrine's plain-prose bullet, which names each.
- class: pointer
- source: plugins/grimoire/skills/writing-skills/SKILL.md:64
- provenance: 8b03bfb 2026-09-08, the plain-prose bullet added to the doctrine's core.
- verdict: retire
- reason: row 1258 merge. The doctrine's "Plain prose, never mannered prose" bullet names the packed sentence and the nested qualification itself ("Never carry a second rule inside a rule's clause. Never nest a qualification..."). Its "The answer comes first" bullet carries the order.
- passage: The packed sentence, the nested qualification and the reasoning-first order are the same defect in other shapes, and the doctrine's plain-prose bullet names each.

### C065
- key: For which forms a mention of another site's rule may take, read the one-owner rule under Anatomy; this bar adds no form and no exception.
- class: pointer
- source: plugins/grimoire/skills/writing-skills/SKILL.md:65
- provenance: 8cdb3f5 2026-09-04, the third bar as a pointer at the Anatomy rule.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: Stands; once line 22 points at the doctrine's form list (C028), this pointer resolves through it. Flipped to rewrite at section 31's round 1: C027's pointer left this sentence saying Anatomy states the forms where it now points at the doctrine for them. Its landed sentence: 'The one-owner rule under Anatomy above points at the doctrine's bullet for the forms a mention may take; this bar adds no form to that list and no exception.'
- proposed: The one-owner rule under Anatomy above points at the doctrine's bullet for the forms a mention may take; this bar adds no form to that list and no exception.
- passage: The forms a mention may take are the doctrine's one-owner bullet's, and this bar adds none.

### C066
- key: Treat any prose that costs the reader more to read than it changes for them as inside the bar, even where none of the three bars names its form.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:67
- provenance: 8cdb3f5 2026-09-04, the class closure the review required after the draft's carve-out list did not close with its class.
- verdict: keep
- reason: The doctrine's re-read question is asked of a whole artifact; this is the class the three bars instance, which the doctrine's line defers to.
- passage: The three are instances of one class: prose that costs the reader more to read than it changes for them. A form none of them names is inside the bar.

### C067
- key: When an amendment corrects a claim a curated document states, edit the whole paragraph, never a single sentence.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:71
- provenance: ab3d766 2026-08-29, review-and-record section 9: a fix round shipped the sentence-patch defect it had just corrected, leaving sibling surfaces stating the superseded claim.
- verdict: keep
- reason: Incident-born, recurs at every main-thread correction, and pinned only as to owner and pointer (test/doctrine-parity.test.js), not enforced. The why (C072, moved here): a sentence patch leaves the seam speaking the old claim, so the paragraph self-contradicts where the fix and its neighbour disagree, or a sibling goes on stating the corrected version.
- passage: **When an amendment corrects a claim a curated document states, the edit unit is the paragraph, never the sentence.**

### C068
- key: Re-derive the whole paragraph from the corrected claim.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:71
- provenance: ab3d766 2026-08-29, section 9.
- verdict: keep
- reason: The method of C067; stands as worded in the line 71 split.
- passage: Re-derive the whole paragraph from the corrected claim.

### C069
- key: Check the claim's other carriers: the neighbouring clauses that qualified or restated it and any sibling surface stating the same behavior.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:71
- provenance: ab3d766 2026-08-29, section 9.
- verdict: keep
- reason: Stands as worded; the second round of that commit found three sibling surfaces left stating the superseded discriminator.
- passage: Check the claim's other carriers: the neighbouring clauses that qualified or restated it, and any sibling surface stating the same behavior.
- flag: weak-reason

### C070
- key: Treat the edit unit as the claim across every surface carrying it, whether or not this skill names that surface.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:71
- provenance: ab3d766 2026-08-29, the reach sentence rewritten after the fix round shipped one excluding two named carriers.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: The rule holds; it shares an eighty-word sentence with the carrier list (C071), and the split gives each its own sentence with nothing removed. Lands at line 69 as 'The unit is the claim across every surface carrying it, and the paragraph is that unit's smallest case. A surface carrying the claim is inside the rule whether or not anything here names it.', the carrier list (C071) its own sentence after it, nothing removed; the pinned lead sentence stands once, which the doctrine-parity test declared at line 5105 pins.
- passage: The unit is the claim on every surface carrying it, whether or not anything here names that surface.

### C071
- key: Expect carriers such as a doctrine parity copy, the output style's register block, an agent charter, a test's assertion message, a memory record, and a README's payload map, as instances rather than the boundary.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:71
- provenance: ab3d766 2026-08-29, each carrier a kind the round found left behind (a test's assertion message, a charter, a README payload map).
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: Kept in the document, not the ledger, because the rule cannot be reliably obeyed without it: the incident was carriers of unnamed kinds going unchecked. It becomes its own sentence, closed as instances. Lands at line 69 as its own sentence, 'The carriers this kit keeps producing are a doctrine parity copy, the output style's register block, an agent charter, a test's assertion message, a memory record, and a README's payload map, and that list is instances rather than the boundary too.', kept in the document as the reason orders.
- passage: Carriers include a doctrine parity copy, the output style's register block, an agent charter, a test's assertion message, a memory record and a README's payload map, and that list is not the boundary.
- flag: weak-reason

### C072
- key: Avoid a sentence patch because it leaves the seam speaking the old claim or a sibling still stating the version you just corrected.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:71
- provenance: ab3d766 2026-08-29, section 9.
- verdict: retire
- landed: 22eafd6 section 31
- reason: The paragraph rule is obeyed without the account of what a patch leaves; the why now lives under C067. Retired at line 69: the sentence 'A sentence patch leaves the seam speaking the old claim, so the paragraph reads as self-contradicting where the fix and its neighbour now disagree, or a sibling goes on stating the version you just corrected.' left whole; the kaizen prose batch's section 7 fold lands two sentences later in the same paragraph (the anchor re-emit rule and its control bound). At round 1 the fold moved out of this paragraph into its own paragraph directly after it, so the first paragraph keeps one point.
- proposed: Move the sentence-patch consequence to the ledger entry for C067.
- baseline-test: yes

### C073
- key: Give an amendment that corrects no claim whatever edit it needs, a typo fix, an added bullet, or a label rename among them.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:71
- provenance: ab3d766 2026-08-29, section 9's bound on the rule.
- verdict: keep
- reason: The observable predicate that keeps the paragraph rule from reaching a typo; stands as worded.
- passage: An amendment that corrects no claim, such as a typo fix, an added bullet or a label rename, takes whatever edit it needs.

### C074
- key: Do not assume a carrier on another surface is yours to edit in place.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:73
- provenance: ab3d766 2026-08-29, the four dispositions for a carrier on another surface.
- verdict: keep
- reason: The paragraph's rule over every carrier, which the dispositions instance; C075 is the closure for a carrier fitting none, not a duplicate.
- passage: A carrier on another surface is not automatically yours to edit in place:

### C075
- key: Name a carrier fitting none of the four dispositions as such and route it deliberately, never editing it in place by default.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:73
- provenance: ab3d766 2026-08-29, added when the fix round found a closed set of three dispositions with no home for the kit's dominant carrier shape.
- verdict: keep
- reason: The class closure the file's own line 46 requires; incident-born and unenforced.
- passage: A carrier fitting none of these is named as such and routed deliberately, never edited in place by default.

### C076
- key: Where the one-owner rule applies, fix the owning site rather than the nearest copy.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:73
- provenance: ab3d766 2026-08-29, the first disposition.
- verdict: keep
- reason: A pointer with its residue ("the one-owner rule above"), which is the form line 22 licenses, and one of four dispositions that a fix round found incomplete at three; not a duplicate of C030.
- passage: Where the one-owner rule applies, fix the owner rather than the nearest copy.

### C077
- key: Where the surfaces are a deliberate byte-identical set, land every copy in one edit or none.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:73
- provenance: ab3d766 2026-08-29, the second disposition, with the parity pins that commit landed.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: The rule holds and its bound (a partial edit reds the parity pin by design) is enforced by the pins in test/doctrine-parity.test.js; the fifty-word sentence carrying it, the bound and C078 splits into three, nothing removed. Lands at line 73 as three sentences, 'Where the surfaces are a deliberate byte-identical set, every copy lands in one edit or none does. A partial edit reds the parity pin by design.' and C078's own sentence after them, nothing removed. Its landing respelled C078's keep sentence; C078 records the flip.
- passage: A deliberate byte-identical set lands every copy in one edit or none, and the set is as large as the parity pin says.

### C078
- key: Take the byte-identical set's size from what the parity pin says, not from the pair you first thought of.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:73
- provenance: ab3d766 2026-08-29, the parity pins spanning five surfaces where the round had assumed two.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: Stands as its own sentence after the split; the reader's compression dropped it. Flipped from keep to rewrite at section 31's close: C077's split made this clause its own sentence, so its first letter is a capital, and the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: The set is as large as the pin says rather than as large as the pair you first thought of.
- passage: A deliberate byte-identical set lands every copy in one edit or none, and the set is as large as the parity pin says.

### C079
- key: Where the claim is a deliberate restatement across surfaces the section's scope already covers, land the correction on every one of them in the same edit.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:73
- provenance: ab3d766 2026-08-29, the third disposition.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: The rule holds; its reason clause (a restatement corrected on one surface alone is the drift the restatement was pinned against) is rationale and moves here. Lands at line 73 as 'Where the claim is a deliberate restatement across surfaces the section's scope already covers, it lands on every one of them in the same edit.', the reason clause gone.
- passage: A deliberate restatement across surfaces the section's scope already covers lands on all of them in the same edit.

### C080
- key: Where a carrier sits in a file the section's `Files in scope:` never listed, route it by the fix-round step in `skills/executing-work/SKILL.md` under the kit plugin root instead of editing it in place.
- class: pointer
- source: plugins/grimoire/skills/writing-skills/SKILL.md:73
- provenance: ab3d766 2026-08-29, the fourth disposition, its path shape pinned after the round shipped a repo-root-relative literal.
- verdict: keep
- reason: A pinned pointer at executing-work's fix-round step; the correct form.
- passage: A carrier in a file the section's `Files in scope:` never listed takes the fix-round step's route in `skills/executing-work/SKILL.md` under the kit plugin root, never an in-place edit.

### C081
- key: Apply this paragraph rule as a writer amending curated prose, whoever you are.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:75
- provenance: 6d2e6cc 2026-08-29, the finishing pass of review-and-record, where the main thread's own corrections had no reviewer between edit and commit.
- verdict: retire
- landed: 22eafd6 section 31
- reason: row 1268 (Correction rule binds every writer), dropped under the mechanism cut.
- proposed: Line 75 becomes: the rule binds every writer amending curated prose; assume no downstream backstop, since which pass reads which surface is finishing-work's and executing-work's to state; the origin story goes to the ledger.
- baseline-test: yes
- passage: The rule binds every writer amending curated prose.
- ruled: cut 2026-09-30

### C082
- key: Do not assume a downstream reviewer will catch the amendment; what stands downstream differs by surface.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:75
- provenance: 6d2e6cc 2026-08-29, three fix-round passes each finding a universal about which pass reads which surface false at some site.
- verdict: retire
- landed: 22eafd6 section 31
- reason: row 1268 (Correction rule binds every writer), dropped under the mechanism cut.
- passage: Assume no downstream backstop, since what stands downstream differs by surface. Which pass reads which surface is finishing-work's and executing-work's to state (`skills/finishing-work/SKILL.md` and `skills/executing-work/SKILL.md` under the kit plugin root).
- ruled: cut 2026-09-30

### C083
- key: Test a skill by watching an agent's behavior with and without the new wording rather than trusting untested prose.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:79
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: keep
- reason: The owner of the confirm-before-trusting rule; C003 retires in its favour.
- passage: An untested skill is a guess. Test it by watching an agent with and without the wording:

### C084
- key: RED: give a fresh subagent a realistic task that tempts the failure without the new guidance, watch it fail, and record the rationalization verbatim.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:81
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: keep
- reason: Four short sentences each one idea; the compress finding was taste.
- passage: **RED:** give a fresh subagent a realistic task that tempts the failure, without the new guidance. Watch it fail and record the rationalization verbatim.

### C085
- key: Stop and change nothing if the RED task does not fail.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:81
- provenance: 830ff28 2026-06-17, the fork port; b99a7fe 2026-08-09 records a declined brief on exactly this ground (RED did not reproduce).
- verdict: keep
- reason: Stands; the contaminated-RED paragraph (C121, C122) is its stated exception on an observable predicate.
- passage: If it does not fail, there is nothing to fix, so stop.

### C086
- key: GREEN: add the minimal guidance addressing that specific failure and re-run until the agent complies.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:82
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: keep
- reason: Three sentences of fifteen words; the compress finding was taste.
- passage: **GREEN:** add the minimal guidance for that specific failure, and re-run until the agent complies.

### C087
- key: REFACTOR: where the agent finds a new loophole, add the counter and re-run until it holds.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:83
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: keep
- reason: No finding.
- passage: **REFACTOR:** counter each new loophole and re-run until it holds.
- flag: weak-reason

### C088
- key: For discipline rules, combine pressures such as time plus sunk cost plus authority, since single pressures are weak tests.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:83
- provenance: 830ff28 2026-06-17, the fork port; b99a7fe 2026-08-09 ran its RED under exactly these combined pressures (fabricated prior verification, deadline, waiting authority).
- verdict: keep
- reason: No finding. Applied live and unenforced.
- passage: For discipline rules, combine pressures such as time, sunk cost and authority, since single pressures are weak tests.

### C089
- key: Run several reps, since one sample lies.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:85
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: keep
- reason: Not in real conflict with C113: a ruled probe's runner pair stands in for the reps by e0ef09c's design, on the observable predicate that the probe is ruled, with the paid-reader cost named and a cost ceiling declined in the plan's rounds.
- passage: Run several reps, since one sample lies.

### C090
- key: Read every flagged result yourself, since template echoes masquerade as both failures and successes.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:85
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: keep
- reason: No finding.
- passage: Read every flagged result yourself, since template echoes masquerade as both failures and successes.
- flag: weak-reason

### C091
- key: Apply this testing standard to any change to behavior-shaping content, the kit's own skills included.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:85
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: keep
- reason: No finding. This is the bar the audit's own baseline-test flag is derived from.
- passage: This standard covers any change to behavior-shaping content, the kit's own skills included.

### C092
- key: Run the probe runner's before-and-after pair for a moment when the change touches a file a probe's shape under `test/probes/` names, in a passage that probe's scenario turns on.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, scenario-probes sections 3 and 5, fifteen review rounds.
- verdict: retire
- superseded-by: S001
- reason: The trigger rule holds as worded; the paragraph around it splits into one sentence per record (see C101, C103, C109 for the three that change). Superseded at `4b2e64c` by S001 (the Section 8 merge; the verdict before it was keep).

### C093
- key: Check the changed and untracked paths, read against the same `<sha>` the before leg takes, against the shapes' `files:` lists, then the changed hunks against those probes' scenarios; a hunk no scenario turns on runs nothing and is recorded as such.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06.
- verdict: retire
- superseded-by: S002
- reason: No finding of its own; the check that derives the moment list, which the runner's `--touching` does at file grain only. Superseded at `4b2e64c` by S002 (the Section 8 merge; the verdict before it was keep).

### C094
- key: Where the probe is `ruled`, let the pair stand in for the reps as the RED and GREEN.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the plan's design that the pair is the RED and GREEN the skill already demands.
- verdict: retire
- superseded-by: S004
- reason: The observable predicate that reconciles C089 with C113. Superseded at `4b2e64c` by S004 (the Section 8 merge; the verdict before it was keep).

### C095
- key: Where the probe is `proposed`, run the after leg alone, record it as evidence for the operator's rulings batch, and still run the reps.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, rewrite 9 of section 3 (a proposed reading is rulings evidence).
- verdict: retire
- superseded-by: S005
- reason: No finding. Every probe was proposed at the plan's close, so this branch is the one that runs today. Superseded at `4b2e64c` by S005 (the Section 8 merge; the verdict before it was keep).

### C096
- key: Do not read a matching before leg as step 1's nothing-to-fix case; the pair measures movement rather than failure.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06.
- verdict: retire
- superseded-by: S008
- reason: No finding. The clause that keeps C085 from misfiring on a probe pair. Superseded at `4b2e64c` by S008 (the Section 8 merge; the verdict before it was keep).

### C097
- key: Read a matching pair on a moment the change did not mean to move as a reading that held.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the four closed readings.
- verdict: retire
- superseded-by: S011
- reason: One of the four readings this file owns (the plan's Chapter assigns them here); stays, as its own sentence. Superseded at `4b2e64c` by S011 (the Section 8 merge; the verdict before it was keep).

### C098
- key: Read a before-leg mismatch the after leg matches as the repair.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06.
- verdict: retire
- superseded-by: S012
- reason: One of the four readings; stays. Superseded at `4b2e64c` by S012 (the Section 8 merge; the verdict before it was keep).

### C099
- key: Record a mismatch both legs carry as the corpus's.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06.
- verdict: retire
- superseded-by: S013
- reason: One of the four readings; stays. Superseded at `4b2e64c` by S013 (the Section 8 merge; the verdict before it was keep).

### C100
- key: Take an after-leg mismatch the before leg lacks, and a matching pair on a moment the change meant to move, to the intent test; the latter is a finding rather than a reading that held.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06.
- verdict: retire
- superseded-by: S014
- reason: One of the four readings; stays. Superseded at `4b2e64c` by S014 (the Section 8 merge; the verdict before it was keep).

### C101
- key: Re-run an errored, unparsed, or leg-unavailable pair once as finishing-work's step 5 directs, and where it errors again run the reps, since it stands in for nothing.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06.
- verdict: retire
- superseded-by: S016
- reason: Line 87 itself assigns re-run mechanics to finishing-work's step 5 (C110), so the sentence restates its owner; it becomes a pointer with the residue a writer needs (a pair that errors twice stands in for nothing, so the reps run). Superseded at `4b2e64c` by S016 (the Section 8 merge; the verdict before it was rewrite). Amendment 2: the 'finishing-work's step 5' this superseded record names is step 6 at dcb01e7 (`55c5abc` renumbered the probe step when the finishing goal read became step 4); S016, its live successor, carries the current number, and this record stays as the bookkeeping it is.

### C102
- key: Take a designed shape's rows and a designed-agreed row to finishing-work's step 5 dispositions rather than the four readings.
- class: pointer
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06.
- verdict: retire
- superseded-by: S018
- reason: Already a pointer; stays. Superseded at `4b2e64c` by S018 (the Section 8 merge; the verdict before it was keep). Amendment 2: the step this superseded record's key points at is step 6 at dcb01e7 (`55c5abc` renumbered it); S018, its live successor, carries the current number, and this record stays as the bookkeeping it is.

### C103
- key: Treat rows from a shape naming no changed file as no reading at all, since both legs read one corpus.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06.
- verdict: retire
- superseded-by: S019
- reason: The README owns what each leg reads (C110), and this sentence restates a consequence of it; it becomes a pointer at tools/probe-corpus/README.md with the residue (such rows are no reading). Superseded at `4b2e64c` by S019 (the Section 8 merge; the verdict before it was rewrite).

### C104
- key: Run the before leg as `node tools/probe-corpus/run.mjs --only <moments> --before <sha>`.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, with the parity pin tying the flags to the runner's KNOWN_FLAGS.
- verdict: retire
- superseded-by: S020
- reason: A pinned copy: test/doctrine-parity.test.js requires writing-skills to spell `--only` and `--before` inside a run.mjs command span and refuses any flag the runner does not take. Keep verbatim. Superseded at `4b2e64c` by S020 (the Section 8 merge; the verdict before it was keep).

### C105
- key: Run the after leg as the same command with no `--before` and its own moment list.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06.
- verdict: retire
- superseded-by: S021
- reason: The second half of the pinned command pair; stays. Superseded at `4b2e64c` by S021 (the Section 8 merge; the verdict before it was keep).

### C106
- key: Set the after leg's `<moments>` to the comma-joined list of every moment the check kept, and the before leg's to that list narrowed to the `ruled` moments.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, rewrite 12 of section 3, which corrected a copy of finishing-work's economy that had made the RED unobtainable exactly where a fix worked.
- verdict: retire
- superseded-by: S022
- reason: Incident-born within the plan's own rounds; the moment-list derivation is this file's, not finishing-work's, and stays. Superseded at `4b2e64c` by S022 (the Section 8 merge; the verdict before it was keep).

### C107
- key: Set `<sha>` to the parent of the change's first commit resolved to a sha, or `HEAD` where the change is uncommitted.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06.
- verdict: retire
- superseded-by: S025
- reason: No finding of its own; the section-time before ref, distinct from finishing-work's base-ref derivation which the bound points at. Superseded at `4b2e64c` by S025 (the Section 8 merge; the verdict before it was keep).

### C108
- key: Run the pair once at the section's close over the section's whole change, not at each fix round.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the paid-reader economy.
- verdict: retire
- superseded-by: S027
- reason: Stands as worded in the split; a per-fix-round pair would spend about forty cents a pair per round (memory record the-probe-runner-is-a-paid-box-claimed-run). Superseded at `4b2e64c` by S027 (the Section 8 merge; the verdict before it was keep).

### C109
- key: Take the box claim step 5 names before the run, and run the section's lane once that claim is released.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06 wrote the claim clause; ddcb28e 2026-09-07 rewrote finishing-work's step 5 to "takes no heavy-process claim" (one network-bound reader holds neither processors nor memory), which the memory record of the first full run agrees with.
- verdict: retire
- superseded-by: S029
- reason: The claim is stale and false: the step 5 it points at names no box claim, so a session following this line would claim a slot the owner says the runner does not take and hold its lane for nothing. Drop the claim clause and point at finishing-work for the run's process standing; the doctrine's memory rule would have this corrected in the same turn as found, and the rewrite plan is that turn. Superseded at `4b2e64c` by S029 (the Section 8 merge; the verdict before it was rewrite). Amendment 2: the 'step 5' this superseded record names is step 6 at dcb01e7 (`55c5abc` renumbered it); S029, its live successor, carries the current number and landed at this section's close, and this record stays as the bookkeeping it is.

### C110
- key: Read `tools/probe-corpus/README.md` for what each leg reads and what each row status means, and finishing-work's step 5 for how the run is spawned, when a leg is re-run, and what each row counts for.
- class: pointer
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the ownership split the fifteen rounds settled on.
- verdict: retire
- superseded-by: S031
- reason: The ownership statement that C101 and C103 are rewritten to honour. Superseded at `4b2e64c` by S031 (the Section 8 merge; the verdict before it was keep). Amendment 2: the ownership this superseded record states sits at finishing-work's step 6 at dcb01e7 (`55c5abc` renumbered it from step 5); S031, its live successor, carries the current number, and this record stays as the bookkeeping it is.

### C111
- key: On a ruled probe's after-leg mismatch the before leg lacks, apply the intent test: a move the change intended is a re-ruling to ask the operator for, and any other is a finding.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, "what this bar adds"; the plan routes every proposed reading to the operator's rulings batch and treats a probe edit as a re-ruling by construction.
- verdict: retire
- superseded-by: S033
- reason: An operator-decision gate, not loop maintenance: the ruling is the operator's answer to what the prose should make a fresh session do, and a session re-ruling a probe its own change moved would grade its own change against a spec it just rewrote. Stays under the standing-grant precedent. Superseded at `4b2e64c` by S033 (the Section 8 merge; the verdict before it was keep).

### C112
- key: Where a change's only shape-named files are the repo's `home/*.md` files, run the reps with the cache staging instead, since neither leg sees it.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, kept over a reviewer's objection that it was anticipatory because the parser admits a home/ entry.
- verdict: retire
- superseded-by: S035
- reason: No finding. A conditional on an observable predicate (the runner reads home/ from the reader's home directory), which the plan chose to state. Superseded at `4b2e64c` by S035 (the Section 8 merge; the verdict before it was keep).

### C113
- key: Accept a matching leg pair as one sample and read the raw replies the runner keeps as you read flagged results.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the single-sample admission the rounds required (a match is single-sample evidence) with a cost ceiling declined.
- verdict: retire
- superseded-by: S037
- reason: Not in real conflict with C089; the sentence names the cost the reps rule is traded against and routes the reading through C090's read-it-yourself rule. Superseded at `4b2e64c` by S037 (the Section 8 merge; the verdict before it was keep).

### C114
- key: Record the reading, or both readings where a pair ran, on the line executing-work's Chapter template holds for it in `Decisions / Surprises`, or in the turn's close-out status where no section Chapter exists.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the Chapter slot added in the same commit.
- verdict: retire
- superseded-by: S040
- reason: Stands; the slot it names exists in executing-work's template and the pin checks the template names the summary prefix. Superseded at `4b2e64c` by S040 (the Section 8 merge; the verdict before it was keep).

### C115
- key: Run a GREEN probe for a doctrine change in a fresh session such as a headless `claude -p`, never as a subagent of the session that made the edit.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:89
- provenance: b99a7fe 2026-08-09, found when the first GREEN round silently re-tested the old wording; eb7d29d 2026-08-09 named the inheritance setting.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: Incident-born and unenforced. The why (C116, moved here): a same-session subagent at best inherits the CLAUDE.md snapshot taken at session start, or with subagent inheritance off sees no doctrine, so a subagent GREEN re-tests the old wording. Flipped from keep to rewrite at section 31's close: C116's retirement left this sentence opening the bullet after its bold lead and took the dash clause that followed it, so its first letter is a capital and its terminal mark a period, and the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: A GREEN probe for a doctrine change runs in a fresh session (a headless `claude -p`), never as a subagent of the session that made the edit.
- passage: A GREEN probe for a doctrine change runs in a fresh session (a headless `claude -p`), never as a subagent of the session that made the edit.

### C116
- key: Avoid the subagent GREEN because subagents at best inherit the CLAUDE.md snapshot taken at session start, or see no doctrine at all, so the probe silently re-tests the old wording.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:89
- provenance: b99a7fe 2026-08-09; eb7d29d 2026-08-09.
- verdict: retire
- landed: 22eafd6 section 31
- reason: The fresh-session rule is obeyed without the inheritance account, and removing a harness-injection fact from the prose is what the line 96 antipattern asks; the why now lives under C115. Retired at line 89: the inheritance account left, so C115's sentence opens the bullet after its bold lead and the dash clause 'a subagent GREEN silently re-tests the old wording' left with it. Its retirement respelled C115's keep sentence; C115 records the flip.
- proposed: Move the inheritance account to the ledger entry for C115.
- baseline-test: yes

### C117
- key: Do not stage probe wording in `~/.claude/grimoire-doctrine.md`.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:89
- provenance: b915f06 2026-08-09, the GREEN-round deploy reverted by the probe sessions themselves, the batch launch masking it.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: Incident-born; the hook defeats the staging silently rather than refusing it, so the prose is not superseded. The why (C118, moved here): plugins/grimoire/hooks/doctrine-refresh.js rewrites that file from the installed plugin's operating-instructions skill at every session start, the probe sessions' own starts included. Flipped from keep to rewrite at section 31's close: C118's retirement took the colon clause after this sentence, so its terminal mark is now a period after 'in', and the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: And `~/.claude/grimoire-doctrine.md` is not the file to stage the probe wording in.
- passage: Do not stage probe wording in `~/.claude/grimoire-doctrine.md`.

### C118
- key: Avoid that file because the doctrine-refresh hook rewrites it from the installed plugin's operating-instructions skill at every session start, so a hand-deployed copy dies at the first probe boot.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:89
- provenance: b915f06 2026-08-09.
- verdict: retire
- landed: 22eafd6 section 31
- reason: The ban is obeyed without the hook's behavior, which C119 replaces with the staging location; the why now lives under C117 naming the hook by path. Retired at line 89: the hook account left, so C117's sentence ends at 'in' and C119's 'that skill' lost its antecedent and now names the operating-instructions skill. Its retirement respelled C117's and C119's keep sentences; C117 and C119 record the flips.
- proposed: Move the hook account to the ledger entry for C117.
- baseline-test: yes

### C119
- key: Stage the candidate wording in the installed plugin cache's copy of the skill for the probe run and restore it afterwards.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:89
- provenance: b915f06 2026-08-09; e0ef09c 2026-09-06 bounded it to where the probe pair does not supply the GREEN.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: The staging recipe the incident produced; unenforced. Flipped from keep to rewrite at section 31's close: C118's retirement took the noun this sentence's 'that skill' pointed at, so the sentence now names 'the operating-instructions skill', and the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Where the probe pair above does not supply the GREEN, stage the candidate wording in the installed plugin cache's copy of the operating-instructions skill for the probe run and restore it after; the real change ships through the normal commit and goes live when the plugin updates.
- passage: Where the probe pair does not supply the GREEN, stage the candidate wording in the installed plugin cache's copy of the operating-instructions skill for the probe run and restore it after.

### C120
- key: Ship the real change through the normal commit; it goes live when the plugin updates.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:89
- provenance: b915f06 2026-08-09.
- verdict: keep
- reason: Stands; it is what keeps the cache staging from being mistaken for the delivery.
- passage: The real change ships through the normal commit and goes live when the plugin updates.

### C121
- key: Expect a contaminated RED for a doctrine-adjacent rule, since a test subagent inheriting the global CLAUDE.md already complies with doctrine.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:91
- provenance: 12ef61f 2026-07-09 installed the contaminated-RED guidance from the review-tension plan; eb7d29d 2026-08-09 added the inheritance-setting conditional.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: The complies-with-doctrine mechanism moves here; the setting-conditional in the bound (inheritance on: the RED is contaminated and production-faithful; off: a RED is genuine) stays as C122's bound, because C122 cannot be applied without knowing which state the harness is in. Lands at line 91 as 'Where the harness's subagent inheritance is on, that contamination is production-faithful rather than a test defect, and where the inheritance is off, a RED is genuine.', the complies-with-doctrine account gone; 'that contamination' takes its antecedent from the bold lead's 'contaminated RED'. Round 1 reordered the landed sentence to 'Where the harness's subagent inheritance is off, a RED is genuine, and where it is on, that contamination is production-faithful rather than a test defect.', so that C122's 'there' names the on-state rather than the genuine RED the earlier order left it beside.
- proposed: Keep one sentence naming the inheritance setting and what each state means for a RED; move the complies-with-doctrine account to the ledger.
- baseline-test: yes
- passage: Where the harness's subagent inheritance is off, a RED is genuine.

### C122
- key: Treat absence of failure in a doctrine-adjacent RED as weak evidence, not proof the rule is dead weight.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:91
- provenance: 12ef61f 2026-07-09, the review-tension plan.
- verdict: keep
- reason: Incident-born, recurs at every doctrine-adjacent rule, unenforced; b99a7fe declined a brief on this very reading.
- passage: Where it is on, absence of failure is weak evidence, not proof the rule is dead weight.

### C123
- key: Judge such a rule on its distinct value: point-of-action encoding survives compaction and reaches contexts the doctrine does not.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:91
- provenance: 12ef61f 2026-07-09.
- verdict: keep
- reason: Stands with its parenthetical contexts (a headless worker mid-loop, a session whose doctrine was summarized away), which are the observable instances the test needs.
- passage: Such a rule may ship on its point-of-action value, surviving compaction and reaching contexts the doctrine does not, and the record says it stands on that rationale.

### C124
- key: Where you ship a rule whose RED did not reproduce, record that it stands on the distinct-value rationale rather than on a demonstrated failure.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:91
- provenance: 12ef61f 2026-07-09.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: Stands as worded; its sentence loses the semicolon-joined C125 to its own sentence. Flipped from keep to rewrite at section 31's close: C125's split took the semicolon clause after this sentence, so its terminal mark is now a period after 'failure', and the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: If you ship a rule whose RED did not reproduce, record that it stands on that rationale, not on a demonstrated failure.
- passage: Such a rule may ship on its point-of-action value, surviving compaction and reaching contexts the doctrine does not, and the record says it stands on that rationale.

### C125
- key: Leave out a rule with neither a reproduced RED nor that rationale.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:91
- provenance: 12ef61f 2026-07-09.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: The rule holds; it shares a semicolon sentence with C124, which the doctrine's plain-prose bullet forbids, so it becomes its own sentence with nothing removed. Lands at line 91 as its own sentence, 'A rule with neither a reproduced RED nor that rationale is the guidance-from-imagination antipattern, so leave it out.', nothing removed. Its landing respelled C124's keep sentence; C124 records the flip.
- passage: A rule with neither a reproduced RED nor that rationale is left out.

### C126
- key: Do not write a narrative such as "the time we fixed X" in place of a reusable technique.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:95
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: retire
- reason: row 1269 shrink. The doctrine's "Documents ship the current state; the journey lives in git" bullet carries it ("state what is true now, never how or when it was learned").
- passage: A narrative ("the time we fixed X") instead of a reusable technique.

### C127
- key: Do not state a harness-injection fact as unconditional when it hinges on a user setting.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:96
- provenance: eb7d29d 2026-08-09, an inbox note on executing-work's subagent-memory sentence going false under a settings flip, and the sweep that found the class elsewhere.
- verdict: keep
- reason: No finding. Incident-born, no test catches a settings flip, and stated only here.
- passage: A harness-injection fact stated as unconditional ("subagents load X") when it hinges on a user setting.

### C128
- key: State the safe assumption instead, and where the fact must be stated, name the setting it depends on.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:96
- provenance: eb7d29d 2026-08-09.
- verdict: keep
- reason: No finding. The recipe half of C127, and the rule the C116 and C121 retirements follow.
- passage: State the safe assumption, and where the fact must be stated, name the setting it depends on.

### C129
- key: Do not write a description that summarizes the workflow.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:97
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: retire
- landed: 22eafd6 section 31
- reason: A restatement of C033 at line 27 in the antipattern list; the owner sits in the same file and the one-owner rule makes the list entry the copy. Retired from pre-edit line 97 of the antipattern list: the bullet '- A description that summarizes the workflow.' left whole.

### C130
- key: Do not aim a prohibition at a wrong-shaped-output problem; use a recipe.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:98
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: retire
- landed: 22eafd6 section 31
- reason: A restatement of the table row at line 38 (C038) with its backfire column; the row owns it. Retired from pre-edit line 98 of the antipattern list: the bullet '- A prohibition aimed at a wrong-shaped-output problem (use a recipe).' left whole.

### C131
- key: Do not write guidance from imagination instead of an observed failure.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:99
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: retire
- reason: row 1269 shrink. RED step 1 ("If it does not fail, there is nothing to fix, so stop.", C085) and C125's landed sentence carry the act.
- passage: Guidance written from imagination instead of an observed failure.

### C132
- key: Do not add a new skill where one paragraph in an existing skill would have done.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:100
- provenance: 830ff28 2026-06-17, the fork port.
- verdict: retire
- landed: 22eafd6 section 31
- reason: A restatement of C008 and C009 at line 14; the lean bullet owns the test and the default. Retired from pre-edit line 100 of the antipattern list: the bullet '- A new skill where one paragraph in an existing skill would have done.' left whole, so the list closes on the imagination bullet.

### C133
- key: Treat the size budget as a ledger that records growth, not a ceiling that forbids it.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:15
- provenance: c591c49 2026-09-08, the operator's ruling that the ratchet encourages cutting and never forbids adding; the ownership map row names this bullet as the owner.
- verdict: keep
- reason: The principle of the bullet, enforced as to visibility by test/size-ratchet.test.js and as to the moving of caps by kit-size.js sync, neither of which states the norm; C017 is its reviewer duty, not a duplicate.
- passage: **The size budget is a ledger rather than a ceiling.**

### C134
- key: The budget file lives at test/size-budget.json and the ratchet test at test/size-ratchet.test.js.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:15
- provenance: c591c49 2026-09-08.
- verdict: retire
- reason: row 1251 shrink. The budget file's path now rides in C011's landed sentence, and `test/size-ratchet.test.js` reports its own failures.
- passage: In the kit's own repository, `test/size-budget.json` holds the caps and `test/size-ratchet.test.js` makes growth visible, not forbidden.

### C135
- key: An unverifiable fact-framing leaves the reader unable to notice when the underlying fact changes, so they keep obeying a rule that no longer holds.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:52
- provenance: a5e184b 2026-08-25.
- verdict: retire
- landed: 22eafd6 section 31
- reason: The reason behind C047, which states its own instruction; it now lives under C047. Retired at line 50: the sentence 'A framing the reader cannot check is one they take on trust, and a rule taken on trust is one they cannot repair: when the fact underneath it moves, the reader has no way to notice, so they keep obeying a rule that now describes nothing.' left whole with C049's pair.
- proposed: Move the taken-on-trust sentence to the ledger entry for C047.
- baseline-test: yes

### C136
- key: An enumeration built from one fully-observed sample looks exhaustive to its writer, so a reader who branches on an absent field will be wrong for instances the sample never covered.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:53
- provenance: a5e184b 2026-08-25.
- verdict: retire
- landed: 22eafd6 section 31
- reason: The open-list rule and its contract bound read without the account of how the writer is fooled; it now lives under C050. Retired at line 51: the two sentences from 'This is the enumeration rule's failure in the fact layer' to 'every instance the sample never contained' left whole, and C050's merged bullet stands without them.
- proposed: Move the fooled-writer sentences to the ledger entry for C050.
- baseline-test: yes

### S001
- key: Run the probe runner's before-and-after pair for a moment whose probe shape names a file your change touched in a passage that probe's scenario turns on.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, scenario-probes sections 3 and 5, fifteen review rounds; line rewritten by 55c5abc 2026-09-09, which inserted the finishing goal read as step 4 and renumbered finishing-work's step 5 to step 6, this claim's words unchanged.
- verdict: keep
- reason: The trigger rule for the pair; the merge touched only the step number elsewhere in the line, and the paragraph still splits into one sentence per record with this as the lead.
- passage: In the kit's own repository, a change to a passage a probe's scenario turns on, in a file that probe's shape under `test/probes/` names, runs the probe runner's before-and-after pair.

### S002
- key: Check the changed and untracked paths against the shapes' `files:` lists, then check the changed hunks against those probes' scenarios.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the check that derives the moment list; line rewritten by 55c5abc 2026-09-09 (step renumbering), the claim's words unchanged.
- verdict: keep
- reason: The runner's `--touching` selects at file grain only, so the hunk-against-scenario half has no mechanical substitute and stays with the writer.
- passage: Match the changed and untracked paths since `<sha>` against the shapes' `files:` lists, then the changed hunks against those probes' scenarios.

### S003
- key: Run nothing for a hunk no scenario turns on, and record that it ran nothing.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the second half of the check sentence (shares C093's supersession with S002); line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: Nothing records a scenario-excluded hunk for the session, so the record-it clause is the writer's and stays as its own sentence in the split.
- passage: A hunk no scenario turns on runs nothing.

### S004
- key: Let the before-and-after pair stand in for the reps as the RED and the GREEN.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the plan's design that the pair is the RED and GREEN the skill already demands; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: The observable predicate that reconciles the reps rule (line 85) with the one-sample admission (S037); every probe is still `proposed`, so this branch is unexercised rather than dead.
- passage: For a `ruled` probe, the pair stands in for the reps as the RED and GREEN.
- flag: stale

### S005
- key: Run only the after leg and record it as evidence for the operator's rulings batch.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, rewrite 9 of section 3 (a proposed reading is rulings evidence); line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: The branch every probe takes today, and finishing-work's step 6 states the same routing for its own pass; two moments, one rule each.
- passage: For a `proposed` probe, only the after leg runs, as evidence for the operator's rulings batch, and the reps still run.
- flag: stale

### S006
- key: Skip the before leg on a proposed probe because it buys nothing for its paid readers.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the reason clause of the proposed-probe sentence (shares C095's supersession with S005); line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: retire
- landed: 22eafd6 section 31
- reason: S005 is obeyed without the reason, and finishing-work's step 6 states the same clause, so the document carried it twice. The why: a proposed probe's mismatch goes to the operator's rulings batch whichever leg carries it, so a before leg over it spends a paid reader on a reading nobody acts on. Retired at line 87: the clause 'since a before leg over a proposed probe buys nothing for its paid readers' left the S005 sentence, which now ends 'and the reps above stand'.
- proposed: Drop "since a before leg over a proposed probe buys nothing for its paid readers" from the S005 sentence; the reason lives under S006 in the ledger.

### S007
- key: Still run the reps described above when the probe is `proposed`.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the third clause of the proposed-probe sentence (shares C095's supersession with S005); line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: The bound that keeps a proposed probe's after leg from being read as the GREEN; unenforced.
- passage: For a `proposed` probe, only the after leg runs, as evidence for the operator's rulings batch, and the reps still run.

### S008
- key: Do not treat a before leg that matches as step 1's nothing-to-fix case, and do not stop on it.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: The clause that keeps line 81's stop rule from misfiring on a probe pair; unenforced. The why (S009, moved here): the pair measures movement rather than failure, so a matching before leg says the moment sat where it was ruled to sit, not that there is nothing to fix. Flipped from keep to rewrite at section 31's close: S009's retirement took the clause before this sentence, so its first letter is a capital, and the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: A before leg that matches is not step 1's nothing-to-fix case.
- passage: A before leg that matches is not step 1's nothing-to-fix case.

### S009
- key: Read the pair as a measure of movement rather than of failure.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the bound of the matching-before-leg sentence (shares C096's supersession with S008); line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: retire
- landed: 22eafd6 section 31
- reason: S008 is obeyed as a bare prohibition; the movement framing is why it holds rather than what to do, and now lives under S008. Retired at line 87: the clause 'The pair measures movement rather than failure, so' left, so S008's sentence opens the passage and S010's 'Its readings' lost its antecedent. Its retirement respelled S008's and S010's keep sentences; S008 and S010 record the flips.
- proposed: Drop "the pair measures movement rather than failure, so" and leave S008 as its own sentence; the why lives under S009 in the ledger.

### S010
- key: Sort every pair reading into exactly one of the four listed readings; the set is closed.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the closure written over the four readings when they were installed; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: retire
- landed: 22eafd6 section 31
- reason: row 1264 merge. `tools/probe-corpus/README.md` closes the pair statuses in its status list (line 110) and in "What a row counts for".
- proposed: The pair's readings close at four: a matching pair on a moment the change did not mean to move is a reading that held; a before-leg mismatch the after leg matches is the repair; a mismatch both legs carry is the corpus's, recorded as such; and an after-leg mismatch the before leg lacks takes the intent test below, as does a matching pair on a moment the change meant to move, which is a finding rather than a reading that held.
- passage: A pair reads exactly one of four ways.

### S011
- key: Read a matching pair on a moment the change did not mean to move as a reading that held.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the four closed readings; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: One of the four readings the plan's Chapter assigns to this file; stays as its own sentence.
- passage: A match on a moment the change meant to move is a finding, and any other match held.

### S012
- key: Read a before-leg mismatch that the after leg matches as the repair.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: One of the four readings; stays.
- passage: A before-leg mismatch the after leg matches is the repair.

### S013
- key: Read a mismatch both legs carry as the corpus's, and record it as such.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: retire
- reason: row 1264 merge. `tools/probe-corpus/README.md` "What a row counts for" says "A mismatch both legs carry is the corpus's.".
- passage: A mismatch both legs carry is the corpus's, recorded as such.

### S014
- key: Take an after-leg mismatch that the before leg lacks to the intent test.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: retire
- reason: row 1264 merge. S033's landed sentence ("The intent test covers a ruled probe's after-leg mismatch the before leg lacks.") carries the act.
- passage: An after-leg mismatch the before leg lacks takes the intent test

### S015
- key: Take a matching pair on a moment the change meant to move to the intent test, and treat it as a finding rather than a reading that held.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the second half of the intent-test reading (shares C100's supersession with S014); line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: A matching pair on an intended move is the one reading a session would misread as success, so the finding label is load-bearing.
- passage: A match on a moment the change meant to move is a finding, and any other match held.

### S016
- key: Re-run an errored, unparsed, or unavailable-leg pair once, as finishing-work's step 6 directs.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06 wrote it against finishing-work's step 5; 55c5abc 2026-09-09 renumbered the pointer to step 6 when the finishing goal read became step 4.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: Step 6 owns the re-run count and its triggers and states them, so the sentence restates its owner; it becomes a pointer, with S017 as the residue that follows. Baseline-test: yes. Lands at line 87 as 'An errored or unparsed pair, or one in a leg recorded unavailable, is none of these and is re-run as finishing-work's step 6 directs.', the re-run count gone, with S017 as its own sentence after it; the 'none of these' closure moved into this sentence from the errors-again clause the split left without a subject. Its landing respelled S017's and S018's keep sentences; S017 and S018 record the flips. Its landing also moved the 'none of these' closure onto the errored or unparsed pair before its re-run, so the closure covers the pair before and after the re-run, which the proposal did not order.
- proposed: Reduce to a pointer ("an errored or unparsed pair is re-run as finishing-work's step 6 directs"), keeping S017 as the residue sentence that follows it.
- baseline-test: yes
- passage: Read each row by `tools/probe-corpus/README.md`'s "What a row counts for" section, after the re-runs finishing-work's step 6 directs.

### S017
- key: Where the re-run errors again, count the pair for nothing and run the reps above instead.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the residue of the re-run sentence (shares C101's supersession with S016); line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: This file's own consequence, which step 6 does not state: a pair that errors twice stands in for nothing, so the reps run. Flipped from keep to rewrite at section 31's close: S016's landing made this clause its own sentence after the pointer, as S016's proposal orders, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Where it errors again it stands in for nothing, so the reps above run.
- passage: A pair that errors again stands in for nothing, and the reps run.

### S018
- key: Take finishing-work's step 6 dispositions for a designed shape's rows and for a designed-agreed row.
- class: pointer
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06 wrote it against step 5; 55c5abc 2026-09-09 renumbered the pointer to step 6.
- verdict: retire
- landed: 22eafd6 section 31
- reason: row 1264 merge. `tools/probe-corpus/README.md` "What a row counts for" disposes `designed` and `designed-agreed` rows, and finishing-work step 6 keeps them off the before-leg list.
- proposed: A designed shape's rows and a designed-agreed row are none of these either and take finishing-work's step 6 dispositions.
- passage: A designed shape's rows and a designed-agreed row are none of these either and take step 6's dispositions.

### S019
- key: Count rows from a shape that names no changed file as no reading at all.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: rewrite
- landed: 22eafd6 section 31
- reason: The runner README's "What the runner reads" section owns what each leg reads, and this sentence restates a consequence of it; it becomes a pointer at tools/probe-corpus/README.md with the residue that such rows are no reading. Baseline-test: yes. Lands at line 87 as 'Rows from a shape naming no changed file are no reading at all, which follows from what each leg reads in `tools/probe-corpus/README.md`'s "What the runner reads" section.', the pointer folded into the residue sentence rather than landed as a second standalone pointer, since S031's sentence later in the paragraph already points at that README for what each leg reads; the section named sits at `tools/probe-corpus/README.md` line 154 at dcb01e7.
- proposed: Point at tools/probe-corpus/README.md for what each leg reads and keep "such rows are no reading" as the residue.
- baseline-test: yes
- passage: Read each row by `tools/probe-corpus/README.md`'s "What a row counts for" section, after the re-runs finishing-work's step 6 directs.
- passage: Rows from a shape naming no changed file are no reading at all.

### S020
- key: Run the before leg as `node tools/probe-corpus/run.mjs --only <moments> --before <sha>`.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, with the parity pin tying the flags to the runner's KNOWN_FLAGS; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: A pinned copy: test/doctrine-parity.test.js requires writing-skills to spell `--only` and `--before` inside a run.mjs command span and refuses any flag the runner does not take. Keep verbatim.
- passage: The before leg is `node tools/probe-corpus/run.mjs --only <moments> --before <sha>`, over the `ruled` moments the check kept.

### S021
- key: Run the after leg as the same command with no `--before` and with its own moment list.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: The second half of the pinned command pair; stays.
- passage: The after leg is the same command without `--before`, over every kept moment.

### S022
- key: Set the after leg's `<moments>` to the comma-joined list of every moment the check kept.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, rewrite 12 of section 3, which corrected a copy of finishing-work's economy that had made the RED unobtainable exactly where a fix worked; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: Incident-born within the plan's own rounds; the moment-list derivation is this file's, where finishing-work derives its own list with `--touching`.
- passage: The after leg is the same command without `--before`, over every kept moment.

### S023
- key: Set the before leg's `<moments>` to that same list narrowed to the `ruled` moments.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the second half of the moment-list sentence (shares C106's supersession with S022); line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: The narrowing is what keeps the before leg off a proposed probe's paid readers. The why (S024, moved here): a pair is a reading only where both legs ran the moment, and a proposed probe runs the after leg alone.
- passage: The before leg is `node tools/probe-corpus/run.mjs --only <moments> --before <sha>`, over the `ruled` moments the check kept.

### S024
- key: Narrow the before leg because a pair is a reading only where both legs ran the moment.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the reason clause of the moment-list sentence (shares C106's supersession with S022); line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: retire
- landed: 22eafd6 section 31
- reason: S023 is obeyed without it and S005 already states that a proposed probe runs the after leg alone; the why now lives under S023. Retired at line 87: the clause 'since a pair is a reading only where both legs ran the moment' left the S023 sentence, which now ends 'narrowed to the `ruled` ones'.
- proposed: Drop "since a pair is a reading only where both legs ran the moment" from the S023 sentence; the reason lives under S024 in the ledger.

### S025
- key: Resolve `<sha>` to the parent of the change's first commit, or to `HEAD` where the change is uncommitted.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: The section-time before ref, distinct from finishing-work's base-ref derivation; nothing derives it for the session.
- passage: `<sha>` is the parent of the change's first commit resolved to a sha, or `HEAD` for an uncommitted change.

### S026
- key: For a root-commit change, take the `<sha>` from finishing-work's pre-step-1 derivation, which leaves the before leg unrun.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the bound of the before-ref sentence (shares C107's supersession with S025), written against step 5; 55c5abc 2026-09-09 renumbered the recording step to 6.
- verdict: retire
- landed: 81d70149 section 1
- reason: Cut in skill-guidance-alignment section 1 to pay for the description rule. The claim lives with its owner: finishing-work's step 6 states that the empty-tree base ref a root-commit effort yields leaves the before leg unrun and recorded as such.
- passage: A root-commit change leaves the before leg unrun.

### S027
- key: Run the pair once at the section's close over the section's whole change, not at each fix round.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the paid-reader economy; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: A per-fix-round pair would spend about forty cents a pair per round (memory record the-probe-runner-is-a-paid-box-claimed-run); nothing enforces the once.
- passage: The pair runs once at the section's close over its whole change, never at each fix round, and inside a finishing pass only finishing-work's step 6 runs the set.

### S028
- key: Inside a finishing pass, do not run the set yourself; only finishing-work's step 6 runs it.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the one-owner-per-moment split that gave the finishing pass its own run, written against step 5; 55c5abc 2026-09-09 renumbered it to step 6.
- verdict: keep
- reason: The bound that keeps a finishing pass from running the pair a second time beside step 6's run over the whole changeset, which that step states.
- passage: The pair runs once at the section's close over its whole change, never at each fix round, and inside a finishing pass only finishing-work's step 6 runs the set.

### S029
- key: Take the box claim that step 6 names before running the pair.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06 wrote the claim clause against step 5; ddcb28e 2026-09-07 rewrote that step to "takes no heavy-process claim" (one network-bound reader holds neither processors nor memory); 55c5abc 2026-09-09 renumbered the pointer to step 6 and left the clause as it was.
- verdict: retire
- landed: 22eafd6 section 31
- reason: row 1265 shrink. It was a pointer only, and finishing-work step 6 states how its run is backgrounded and re-run (lines 138 to 140).
- proposed: Drop the box-claim clause and point at finishing-work's step 6 for the run's process standing.
- baseline-test: yes
- passage: Finishing-work's step 6 owns the run's process standing, how it is spawned, when a leg is re-run and what each row counts for.

### S030
- key: Run the section's lane only once that box claim is released.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the second clause of the box-claim sentence (shares C109's supersession with S029); ddcb28e 2026-09-07 removed the claim the clause waits on; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: retire
- landed: 22eafd6 section 31
- reason: With no claim taken there is nothing to release, and the owner says the whole gate may run beside the runner, so the sequencing instruction has no content left once S029 points at step 6. Baseline-test: yes. Retired at line 87: the clause 'and the section's lane runs once that claim is released' left with S029's sentence, which now points at finishing-work's step 6.
- proposed: Delete "and the section's lane runs once that claim is released"; the lane's standing relative to the run is finishing-work's.
- baseline-test: yes

### S031
- key: Read `tools/probe-corpus/README.md` for what each leg reads and what each row status means.
- class: pointer
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the ownership split the fifteen rounds settled on; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: retire
- reason: row 1265 shrink. It was a pointer only, and S016's landed sentence points at the README's "What a row counts for" section.
- passage: `tools/probe-corpus/README.md` owns what each leg reads, in its "What the runner reads" section, and what each row status means.

### S032
- key: Read finishing-work's step 6 for how the run is spawned, when a leg is re-run, and what each row counts for.
- class: pointer
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the ownership split (shares C110's supersession with S031), written against step 5; 55c5abc 2026-09-09 renumbered the pointer to step 6.
- verdict: retire
- reason: row 1265 shrink. It was a pointer only, and S016's landed sentence points at finishing-work step 6 for re-runs.
- passage: Finishing-work's step 6 owns the run's process standing, how it is spawned, when a leg is re-run and what each row counts for.

### S033
- key: Where the intended move produced a ruled probe's after-leg mismatch, ask the operator for a re-ruling.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, "what this bar adds"; the plan routes every proposed reading to the operator's rulings batch and treats a probe edit as a re-ruling by construction; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: An operator-decision gate rather than loop maintenance: a session re-ruling a probe its own change moved would grade its change against a spec it just rewrote.
- passage: The intent test covers a ruled probe's after-leg mismatch the before leg lacks. A move the change intended is a re-ruling to ask the operator for

### S034
- key: Treat any such mismatch the change did not intend as a finding.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the second half of the intent test (shares C111's supersession with S033); line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: The finding label is what routes an unintended move into a fix round; unenforced.
- passage: and any other is a finding

### S035
- key: Where a change's only shape-named files are the repo's `home/*.md` files, run the reps above with the cache staging described below.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, kept over a reviewer's objection that it was anticipatory because the parser admits a home/ entry; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: A conditional on an observable file-path predicate, and the case is live: the repo's `home/` holds CLAUDE.md and grimoire-doctrine.md. The why (S036, moved here): the runner reads a `home/` entry from the reader's home directory rather than from the repo, so neither leg sees the change.
- passage: A change whose only shape-named files are the repo's `home/*.md` files is seen by neither leg, so it takes the reps with the cache staging below.

### S036
- key: Expect neither leg to see such a change, because the runner reads a `home/` entry from the reader's home directory rather than from the repo.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the mechanism clause of the home-files sentence (shares C112's supersession with S035); line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: retire
- landed: 22eafd6 section 31
- reason: S035 is obeyed on its predicate alone, the runner README owns where a `home/` entry is read from, and finishing-work's step 6 carries this clause word for word; the why now lives under S035. Retired at line 87: the clause 'since the runner reads a `home/` entry from the reader's home directory rather than from the repo' left, so S035's sentence reads 'is seen by neither leg, so it takes the reps above with the cache staging below'.
- proposed: Drop "since the runner reads a `home/` entry from the reader's home directory rather than from the repo"; the reason lives under S036 in the ledger.

### S037
- key: Accept a matching leg pair as one sample, and do not run a second.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the single-sample admission the rounds required with a cost ceiling declined; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: Reconciled with line 85's reps rule by S004's ruled-probe predicate. The why (S038, moved here): a second pair costs a paid reader per probe-and-shape pair, about forty cents each by the memory record, and buys a second sample of a reading the pair already gave.
- passage: A matching leg pair is one sample.

### S038
- key: Do not take a second sample, because it costs a paid reader per probe-and-shape pair.
- class: rationale-example
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the cost clause of the one-sample sentence (shares C113's supersession with S037); line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: retire
- landed: 22eafd6 section 31
- reason: S037 is obeyed without the price and S004 carries the predicate that keeps it from conflicting with the reps rule; the why now lives under S037 with the memory record's figure. Retired at line 87: the clause 'accepted as one because a second costs a paid reader per probe-and-shape pair' left, so S037's sentence reads 'A matching leg pair is one sample, and the raw replies the runner keeps are read as the flagged results above are.'
- proposed: Drop "accepted as one because a second costs a paid reader per probe-and-shape pair"; the reason lives under S038 in the ledger.

### S039
- key: Read the raw replies the runner keeps yourself, the same way you read the flagged results above.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the read-it-yourself residue (shares C113's supersession with S037); line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: retire
- reason: row 1265 shrink. C090 ("Read every flagged result yourself...") carries reading the runner's raw replies.
- passage: Read the raw replies the runner keeps as you read flagged results.

### S040
- key: Record the reading, or both readings where a pair ran, on the line executing-work's Chapter template holds for it in `Decisions / Surprises`.
- class: mechanic
- source: plugins/grimoire/skills/writing-skills/SKILL.md:87
- provenance: e0ef09c 2026-09-06, the Chapter slot added in the same commit; line rewritten by 55c5abc 2026-09-09, the claim's words unchanged.
- verdict: keep
- reason: A pinned pointer: test/doctrine-parity.test.js asserts this file names "executing-work's Chapter template" and "`Decisions / Surprises`" and that executing-work's line names the writing-skills slot.
- passage: Record the reading, or both where a pair ran, on the line executing-work's Chapter template holds for it in `Decisions / Surprises`, or in the close-out status where no section Chapter exists.

### S041
- key: For how an accepted lesson enters prose that already stands, read the kaizen skill's disposition step, which rewrites the owning passage with the lesson in mind and never appends to it, and read these bars over that rewrite's result.
- class: pointer
- source: plugins/grimoire/skills/writing-skills/SKILL.md:57, at the commit that lands section 5 of the corpus-rewrite follow-up plan, which added the sentences after the re-extraction commit.
- provenance: docs/backlog.md 2026-09-13, batch 2 ruling 26 of the corpus rewrite's rulings, landed by the corpus-rewrite follow-up plan's section 5, which placed the pointer in this section because the sentence bars live here.
- verdict: keep
- reason: The bars shape a sentence and say nothing about whether a lesson enters a standing passage as a rewrite or as a rider, which is the kaizen skill's rule at its disposition step; a writer who reaches these bars while landing a lesson needs the owner named, since a bar-compliant appended sentence is exactly the form the owner refuses. The pointer carries the rule's lead and no bound, per the one-owner rule under Anatomy. The paragraph it joins keeps C054's doctrine pointer word for word and closes on the bars being read over the rewrite's result, so the paragraph makes one point: whose call each question is before the bars apply.
- passage: An accepted lesson lands by the kaizen skill's rewrite-not-append rule (`skills/kaizen/SKILL.md` under the kit plugin root).

### H001
- key: Open a description with a third-person clause saying what the skill does, then "Use when..." and its symptoms, with no process summary, "the operator" for the operator outside a quoted utterance, and at most 1,024 characters, held by a test.
- class: rule
- source: plugins/grimoire/skills/writing-skills/SKILL.md:27
- provenance: skill-guidance-alignment section 1, ruled by the operator on 2026-10-05 after an audit of the shipped skills against Anthropic's skill-authoring guidance, which asks for a description saying what the skill does and when to use it, in the third person, at most 1,024 characters.
- verdict: keep
- reason: Replaces C032, whose "Use when..." and stop wording produced a description with no statement of what the skill does. The reason is the plan's Assumptions in docs/plans/claude-kit_skill-guidance-alignment_spec_v1.md: the person-word list is closed at eleven words with a quoted utterance skipped, and the test reads every plugins/*/skills/*/SKILL.md. The sentence naming the test claims only what test/skill-description.test.js asserts: the character limit, the opening word and the person words (a quoted utterance skipped, closed on a single quote followed by a non-word character or the end of the value), plus the frontmatter shape, the "Use when" text and the name matching its folder.
- passage: Open with a third-person clause saying what the skill does, then "Use when..." and its symptoms, and stop. Do not summarize the skill's process there. Write "the operator", never first- or second-person pronouns outside quoted utterances. Stay within 1,024 characters. `test/skill-description.test.js` holds the limit, the opening and person words.
