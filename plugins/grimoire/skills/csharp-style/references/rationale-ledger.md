# Rationale ledger: csharp-style

This file is the rationale ledger for the documents the `csharp-style` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/csharp-style/SKILL.md

This document is the operator's personal C# house style: it defines how C# source is laid out, commented, named, and organized, what the antipatterns are, and what must be true before C# work is called complete. It owns the moments of writing or modifying any C# code (services, handlers, helpers, MediatR notifications, models, DI registration, refactors), the moment of choosing between this style and a repository's own conventions or formatter contract, and the moment of outlining a large C# file to find one thing in it rather than reading it whole. Its load class is `named-trigger`: the frontmatter says to use it whenever writing or modifying any C# code, and to trigger on any C# work even when style is not named.

Extracted at `6bc07fb`: whole document (`skills.csharp-style.SKILL.md`). Amended by `docs/plans/claude-kit_prose-register_spec_v1.md` section 4 on 2026-09-22 (`P` entries below). Redrafted on 2026-09-26 by section 9 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, landed at `b524a1ca` with its fix round at `5288cfb5`, so every live entry's `passage:` line quotes the text at `5288cfb5` and the `flag:` lines record that pass's flags.

### C001
- key: Load and apply this style whenever you write or modify any C# code, even when style is not mentioned.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:3
- provenance: f8c0649 2026-06-10, the INIT consolidation of the operator's working pattern; 7964c7e 2026-06-28 trimmed "static Serilog logger" from the trait list when ILogger became preferred. No incident narrated.
- verdict: keep
- reason: This is the frontmatter the harness matches to load the skill; the work-kind enumeration is what makes the skill load on a task that names a handler or a DI registration without naming style. Change it only to change when the skill loads.
- passage: Trigger on any C# work even when style is not named.

### C002
- key: Read references/csharp-style.md for the full pattern reference before writing code.
- class: pointer
- source: plugins/grimoire/skills/csharp-style/SKILL.md:8
- provenance: f8c0649 2026-06-10, INIT; a8770b3 2026-06-28 reworded to first person only.
- verdict: keep
- reason: No finding. This sentence is what makes SKILL.md and the reference one owner in two layers (philosophy always loaded, detail on demand), which is the basis for every same-owner ruling in this unit.
- passage: Read [references/csharp-style.md](references/csharp-style.md), the full pattern reference, before writing code.

### C003
- key: Put short `// Title.` comments above blocks to act as section headers marking where one thing ends and another begins.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:12
- provenance: f8c0649 2026-06-10, INIT; 058e3a3 2026-07-24 rewrote the surrounding sentences from the operator's hand-edit review of Claude-authored C# in the PrePass plugin.
- verdict: keep
- reason: The signature trait of the style and the thing no formatter produces; the reference §6 is this skill's own detail layer, not a second owner, so the philosophy statement stays whole.
- passage: A short `// Title.` comment heads each block as its section header.

### C004
- key: End every section comment with a period.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/SKILL.md:12
- provenance: f8c0649 2026-06-10, INIT, installed at once as philosophy, antipattern and checklist line.
- verdict: keep
- reason: CSharpier (format-on-edit.js) does not touch comment punctuation, so the prose is the only guard; the reference §11 match-the-file note is a legacy-file carve-out for `RegisterServices.cs` group labels, not a contradiction of this rule for a section comment a session writes.
- passage: **Every section comment ends with a period.**

### C005
- key: Write each section comment as a short, imperative, direct statement of what the next block is intended to do.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:12
- provenance: 058e3a3 2026-07-24, the operator's hand-edit review of Claude-authored C# (PrePass plugin, 2026-07-21) sharpened the comment voice; installed in the philosophy and reference §6 together.
- verdict: keep
- reason: Incident-born (wrong comment voice in shipped code), the incident recurs on every C# task, and no machinery checks voice. The antipattern bullet C038 is the observed-habit side of the same rule and was installed for that purpose.
- passage: 1. **Comments are visual structure.** A short `// Title.` comment heads each block as its section header. **Every section comment ends with a period.** It states imperatively what the next block does: "Validate Parameters." not "Now we check the inputs". Judge intent, not vocabulary: `// Abort if we don't have a Valid VIN, make no changes.` is in-voice. A comment never explains history, decisions, alternatives weighed or issues met. A WHY comment is rare, and its reason follows as its own sentence.

### C006
- key: Judge a comment by intent rather than vocabulary, so `// Abort if we don't have a Valid VIN, make no changes.` counts as in-voice while "Now we check the inputs" does not.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/SKILL.md:12
- provenance: 058e3a3 2026-07-24, the operator's clarification that an incidental "we" is fine.
- verdict: keep
- reason: The intent test cannot be applied without one instance whose casual "we" still passes; remove the specimen and a session bans the word instead of the voice, which is the misreading the operator corrected.
- passage: Judge intent, not vocabulary: `// Abort if we don't have a Valid VIN, make no changes.` is in-voice.

### C007
- key: Never let a comment explain history, decision-making, alternatives weighed, or issues encountered; keep WHY comments rare and exceptional.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:12
- provenance: 058e3a3 2026-07-24, the same hand-edit review; installed in this skill, its reference, and the SQL skill and reference for T-SQL sentence-style comments in one change.
- verdict: keep
- reason: Each style skill owns its language's comment forms (the SQL side carries a banner carve-out this side does not need), so the four copies are per-language statements, not one rule looking for an owner.
- passage: A comment never explains history, decisions, alternatives weighed or issues met.
- passage: A WHY comment is rare

### C008
- key: Write XML `/// <summary>` docs on public members only where they add something, and skip them where they would only restate the signature.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:12
- provenance: 7964c7e 2026-06-28, "Style Cleanups", which deleted the INIT antipattern banning XML doc comments and installed this qualified stance in the philosophy and checklist together; the message states no reason.
- verdict: retire
- reason: row 593 (XML docs only when earned), merged into one owner. The checklist line C063 carries it: "- [ ] XML `/// <summary>` docs on public members only where they earn their keep".
- passage: XML `/// <summary>` docs on public members are welcome when well written, never when they only restate the signature.

### C009
- key: Group related items and separate each group with a blank line and a label comment.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:13
- provenance: f8c0649 2026-06-10, INIT.
- verdict: retire
- reason: row 575 (Group and label related items), merged into the checklist. C051 "grouped with `// Group.` labels" and C061 "grouped by domain label" carry it.
- passage: 2. **Group related items; separate groups with whitespace and a label.**

### C010
- key: Structure a Variables region as `// Values.`, `// Mapper.`, and `// Services.` groups with blank lines between them.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/SKILL.md:13
- provenance: f8c0649 2026-06-10, INIT.
- verdict: retire
- landed: b608667 section 37
- reason: Reference §3 carries the label list whole (five labels, this sentence names three) with a cited file example, and checklist C051 still names the `// Group.` form in SKILL.md, so the grouping rule loses nothing. The labels, for the record: `// Values.` static comparers and computed defaults; `// Mapper.` the AutoMapper instance; `// Services.` injected dependencies; `// Settings.` `IOptionsMonitor<T>`; `// State.` mutable state, rare. Retired at section 37's close: the second sentence is gone from line 13, which carries C009's bold lead alone.
- proposed: (via A022) Cut the second sentence of philosophy point 2, leaving the grouping rule; the canonical labels live in reference §3.
- baseline-test: yes

### C011
- key: Register DI services with `.AsImplementedInterfaces().PreserveExistingDefaults()`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/SKILL.md:14
- provenance: f8c0649 2026-06-10, INIT.
- verdict: retire
- reason: row 576 (Idempotent DI registration), merged into the checklist. C061 carries the call: "`.AsImplementedInterfaces().PreserveExistingDefaults()`".
- passage: DI registration uses `.AsImplementedInterfaces().PreserveExistingDefaults()`.

### C012
- key: Write code that is idempotent, so it never breaks on re-execution.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:14
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: The SQL skill states the same principle for deployment scripts; each language's skill owns its own artifact, so neither points at the other.
- passage: **Idempotent by default.** Code never breaks on re-execution.

### C013
- key: Organize every class with `#region Title` / `#endregion` banners rather than inline narration.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:15
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: Signature trait; the canonical order lives in checklist C050 and reference §2 as the gate and the detail of this principle.
- passage: **Section banners over inline narration.** `#region Title` / `#endregion` organize every class.

### C014
- key: When in doubt, find an existing file solving a similar shape and follow its layout exactly.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:16
- provenance: f8c0649 2026-06-10, INIT; bounded to code already in this style by 830ff28 2026-06-17.
- verdict: keep
- reason: The "highly self-similar" clause is the premise that a sibling exists and the search is worth running; the Precedence section bounds it. The SQL twin is per-language.
- passage: When in doubt, follow the layout of an existing file of similar shape exactly.

### C015
- key: In a greenfield repo with no sibling to mimic, follow the exemplar in this document and the full template in the reference.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:16
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: Sends the reader to this language's exemplar and templates; a pointer to the SQL twin would name the wrong language.
- passage: With no sibling, use the exemplar below and the reference's section 1 file structure and section 2 skeleton.

### C016
- key: Let a repository's mechanically-enforced contract override this style, and nothing softer than one.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:20
- provenance: 830ff28 2026-06-17, "Fork Improvements and Session Mining", which installed style precedence in the doctrine and both style skills as one change.
- verdict: keep
- reason: The doctrine owns the principle; the skill's Precedence section is a deliberate whole copy for the path where a subagent holds this skill by path and not the doctrine (the 2026-07-30 kaizen brief records a reviewer that had neither). A pointer fails that path. The map's form for a copy is a parity pin, and none pins this section: that is a pin to add, not wording to cut.
- passage: The doctrine's house-style rule under Defaults decides when a repo's own contract overrides this style.
- flag: weak-reason

### C017
- key: Absent a mechanically-enforced contract, treat this style as the default authority and do not treat a legacy sibling as authority on its own.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:20
- provenance: 830ff28 2026-06-17, as C016.
- verdict: retire
- reason: row 579 (Style precedence over repo), merged to the doctrine's Defaults text "My house style is the default authority. It beats sibling code and implicit local convention." C018's landed sentence also carries it.
- passage: Otherwise this style is the default authority, and a legacy sibling is no authority by itself.

### C018
- key: Do not use the mimic-a-sibling rule as a reason to abandon this style in a foreign repo.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:20
- provenance: 830ff28 2026-06-17, as C016; the session mining found sessions dropping the style to match a foreign repo's siblings.
- verdict: keep
- reason: This clause closes the loophole philosophy point 5 opens; the SQL reference's unbounded sibling sentence is not a runtime conflict for a C# decision and sits under its own SKILL.md bound.
- passage: A sibling never takes you out of this style in a foreign repo.

### C019
- key: Write the section comments so that the comments alone tell the story of the method, as the exemplar method shows.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/SKILL.md:55
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: A self-check a session can run on its own method (read only the comments), which neither C003 nor C005 states; it is a procedure rather than a why.
- passage: The comments alone should tell the story of the method.

### C020
- key: To find one thing in a C# file past roughly 1,000 lines, take an outline in three greps instead of reading the file.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:59
- provenance: ddd6c72 2026-08-23, the process-rule-repairs plan: the doctrine's own language patterns failed against the corpus, a consult found language anchors cannot live in a language-agnostic surface, and the anchors moved here under a two-ended parity pin.
- verdict: keep
- reason: The ownership map assigns the principle to the doctrine and the recipe to this skill (rows 44 and 45); test/doctrine-parity.test.js:465-490 pins that the doctrine routes here and this section exists. The trigger clause is the minimum a recipe says about when it applies.
- passage: To find one thing in a C# file past roughly 1,000 lines, outline it with three greps, each with line numbers:

### C021
- key: Grep types with `^\s*((public|private|protected|internal|sealed|static|abstract|partial|readonly|file)\s+)*(class|interface|record|struct|enum)\s+\w`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/SKILL.md:61
- provenance: ddd6c72 2026-08-23, run against real files before landing; c6f08c5 corrected the nested-type accessibility prose beside it.
- verdict: keep
- reason: No finding. The optional modifier group is load-bearing (C028); nothing pins the pattern text, so a session that "tightens" it drops modifier-less nested types.
- passage: - Types: `^\s*((public|private|protected|internal|sealed|static|abstract|partial|readonly|file)\s+)*(class|interface|record|struct|enum)\s+\w`

### C022
- key: Grep members with `^\s*(public|private|protected|internal)\b.*\(`, piped through `grep -vE '^[^(]*= '` and `grep -v '{ get'`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/SKILL.md:62
- provenance: ddd6c72 2026-08-23, as C021.
- verdict: keep
- reason: No finding. The `\b` and the paren-anchored filter are load-bearing (C024, C026); this pattern returns nothing on an interface file (C030).
- passage: - Members: `^\s*(public|private|protected|internal)\b.*\(`, piped through `grep -vE '^[^(]*= '` and `grep -v '{ get'`

### C023
- key: Grep regions with `^\s*#region` and take the results verbatim.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/SKILL.md:63
- provenance: ddd6c72 2026-08-23, as C021.
- verdict: keep
- reason: No finding. On a file in canonical region order this grep alone is the map (C035).
- passage: - Regions: `^\s*#region`, taken verbatim

### C024
- key: Keep the `\b` in the member pattern so ordinary body statements stay out of the outline.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:65
- provenance: ddd6c72 2026-08-23; the plan's review demanded each load-bearing detail be stated with what breaks without it, and c6f08c5 re-measured the figures with the shipped patterns.
- verdict: retire
- landed: b608667 section 37
- reason: row 582 (Regex pitfall explanations), dropped under the mechanism cut.
- proposed: Keep each of the three rules with its failure shape (body-line collision, default-parameter destruction, modifier-less nested type dropped); move the measured counts and file sizes to this ledger.
- baseline-test: yes
- passage: Three details fail quietly. Keep the member pattern's `\b`:
- ruled: cut 2026-09-30

### C025
- key: Without the `\b`, `^\s*(public).*\(` matches a body line reading `publicKey.Validate(id);` and neither filter removes it.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/SKILL.md:65
- provenance: ddd6c72 2026-08-23; c6f08c5 records that this illustrative line came from the author's probe file rather than the corpus.
- verdict: retire
- landed: b608667 section 37
- reason: row 582 (Regex pitfall explanations), dropped under the mechanism cut.
- proposed: Keep the collision example; move the "rarer than it looks, costs nothing to keep" clause to the ledger.
- baseline-test: yes
- passage: without it `^\s*(public).*\(` matches `publicKey.Validate(id);`, and neither filter removes that.
- ruled: cut 2026-09-30

### C026
- key: Anchor the member filter before the paren rather than using a bare `grep -v '= '`.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:65
- provenance: ddd6c72 2026-08-23, as C024.
- verdict: retire
- landed: b608667 section 37
- reason: row 582 (Regex pitfall explanations), dropped under the mechanism cut.
- passage: Anchor the member filter before the paren.
- ruled: cut 2026-09-30

### C027
- key: A bare `grep -v '= '` destroyed 32 real signatures on a 4,347-line API client because default parameter values such as `CancellationToken cancellationToken = default` are this style's own idiom.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/SKILL.md:65
- provenance: ddd6c72 2026-08-23, measured on a real file; c6f08c5 confirmed the figures were re-measured with the shipped patterns.
- verdict: retire
- landed: b608667 section 37
- reason: row 582 (Regex pitfall explanations), dropped under the mechanism cut.
- proposed: Keep the default-parameter failure shape; move the count and file size to the ledger.
- baseline-test: yes
- passage: A bare `grep -v '= '` drops every method with a default parameter value, such as this style's own `CancellationToken cancellationToken = default`.
- ruled: cut 2026-09-30

### C028
- key: Keep the modifier group in the type pattern optional so modifier-less nested types are found.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:65
- provenance: ddd6c72 2026-08-23; c6f08c5 corrected the accessibility statement (a nested type with no modifier is implicitly private, not internal) after the reviewers caught it.
- verdict: retire
- landed: b608667 section 37
- reason: row 582 (Regex pitfall explanations), dropped under the mechanism cut.
- passage: Keep the type pattern's modifier group optional. A nested class with no modifier is legal and implicitly private (only a top-level type defaults to internal)
- ruled: cut 2026-09-30

### C029
- key: Requiring a modifier dropped `class RateLimitedClient` from a 3,290-line service, leaving an outline showing one owner for two types.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/SKILL.md:65
- provenance: ddd6c72 2026-08-23, measured on a real file.
- verdict: retire
- landed: b608667 section 37
- reason: row 582 (Regex pitfall explanations), dropped under the mechanism cut.
- proposed: Keep the nested-type failure shape; move the class name and file size to the ledger.
- baseline-test: yes
- passage: and requiring a modifier drops it, leaving one owner for two types.
- ruled: cut 2026-09-30

### C030
- key: On an interface file, take members with `^[[:space:]]+[A-Za-z_][^;=]*[[:space:]]+[A-Za-z_][A-Za-z0-9_<>]*[[:space:]]*\(` instead of the modifier-anchored member grep.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/SKILL.md:67
- provenance: c6f08c5 2026-08-23, the finishing pass of the process-rule-repairs plan, added because the anchored grep gives no sign that it missed anything on an interface.
- verdict: retire
- reason: row 582 (Regex pitfall explanations), dropped under the mechanism cut.
- passage: Interface members carry no access modifier, so on an interface file the member grep silently finds none. There, take members with `^[[:space:]]+[A-Za-z_][^;=]*[[:space:]]+[A-Za-z_][A-Za-z0-9_<>]*[[:space:]]*\(` instead.
- ruled: cut 2026-09-30

### C031
- key: Do not use the interface member pattern on an ordinary class file.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:67
- provenance: c6f08c5 2026-08-23, as C030.
- verdict: retire
- landed: b608667 section 37
- reason: row 582 (Regex pitfall explanations), dropped under the mechanism cut.
- proposed: Keep the hole, the interface pattern, the class-file prohibition with its declaration-versus-call reason, and the modifier-less-member note; move both measurements to the ledger.
- baseline-test: yes
- passage: A modifier-less class member is implicitly private and equally invisible to the anchored grep.
- ruled: cut 2026-09-30

### C032
- key: On a class file the interface pattern cannot tell a declaration from a call and returned 262 lines against 202 real members.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/SKILL.md:67
- provenance: c6f08c5 2026-08-23, measured.
- verdict: retire
- landed: b608667 section 37
- reason: row 582 (Regex pitfall explanations), dropped under the mechanism cut.
- proposed: Keep the declaration-versus-call clause; move the count to the ledger.
- baseline-test: yes
- passage: Never use that on a class file, where it cannot tell a declaration from a call.
- ruled: cut 2026-09-30

### C033
- key: When a declaration appears in both the type and member lists, read the repeat as confirmation rather than as two separate things.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:69
- provenance: ddd6c72 2026-08-23.
- verdict: keep
- reason: The positional-record and primary-constructor clause is the bound that tells a session when a repeat is expected; without it a repeat reads as a duplicate declaration.
- passage: A positional record or primary constructor shows in both lists, counted once.

### C034
- key: Take the `#region` labels verbatim rather than summarizing them.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:69
- provenance: ddd6c72 2026-08-23.
- verdict: keep
- reason: Region labels are the section structure in this style and carry intent the code does not state; a summarized label loses exactly that.
- passage: Take `#region` labels verbatim.

### C035
- key: Region labels carry the author intent and spec cross-references the code never states, and on a file in the canonical region order they are the whole map.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/SKILL.md:69
- provenance: ddd6c72 2026-08-23.
- verdict: keep
- reason: Half of it is a reading instruction (on a canonical file the region grep alone suffices) and the other half tells a session what summarizing would lose; neither is a bare why.
- passage: In canonical region order they are the whole map.

### C036
- key: Declare a namespace file-scoped (`namespace X;`) in a new file, and leave existing block-scoped files alone.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:73
- provenance: f8c0649 2026-06-10, INIT; 058e3a3 2026-07-24 re-scoped it to "when a new file declares a namespace at all" after the PrePass review, in the antipattern and reference §1 together.
- verdict: keep
- reason: Incident-born re-scoping; the reference is this skill's detail layer, not a second owner.
- passage: - ❌ Block-scoped namespaces in *new* files - a new file that declares a namespace uses file-scoped (`namespace X;`), and existing block-scoped files are left alone
- flag: weak-reason

### C037
- key: Keep namespaces coarse and minimal, and never map folders to sub-namespaces.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:73
- provenance: 058e3a3 2026-07-24, the PrePass hand-edit review: Claude had generated folder-mirroring sub-namespaces.
- verdict: keep
- reason: Incident-born, the habit recurs on every new file, and no analyzer in the kit enforces namespace shape.
- passage: - ❌ Fine-grained namespaces - keep them coarse and minimal, one root namespace per project where warranted, and never map folders to sub-namespaces

### C038
- key: Never write apologetic or explanatory comments such as "This handles the case where..."; write imperative section labels.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:74
- provenance: f8c0649 2026-06-10, INIT, in the "common AI habits" list; 058e3a3 confirmed the bans stand beside the sharpened voice rule.
- verdict: retire
- reason: shrink of row 574. The second specimen was an instance of a class already named. C005's landed sentence carries the act: "It states imperatively what the next block does: "Validate Parameters." not "Now we check the inputs".".
- passage: Validate Parameters." not "Now we check the inputs" or "This handles the case where

### C039
- key: Never write change-narrative comments; a comment states what the code does now, never the session, the change, or the prior version.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:75
- provenance: cabbf89 2026-06-28, the doc-closeout-discipline plan (docs/archive/claude-kit_doc-closeout-discipline_spec_v1.md): the doctrine's current-state rule, the two style-skill antipatterns and the implementer-brief forwarding, baseline-tested under mimicry and deferral pressure.
- verdict: retire
- reason: row 585 (No change-narrative comments), merged to the doctrine's "Documents ship the current state" bullet: "Code comments and shipped artifacts state what is true now, never how or when it was learned." C007's landed sentence also carries it in this document.
- passage: - ❌ Change-narrative comments ("Updated to...", "Now we...", "per the new spec") - the doctrine's current-state rule applies: a comment states what the code does now, never the session, the change, or the prior version

### C040
- key: Never leave a section comment without a terminating period: write `// Save Services.` not `// Save Services`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/SKILL.md:76
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: The right/wrong specimen is the antipattern surface of C004; the reference's match-the-file note governs editing legacy group labels in `RegisterServices.cs`, not a section comment a session writes.
- passage: - [ ] Section comments inside methods use `// Title.`, never `// Save Services`; blank line before each

### C041
- key: Give every `Task<T>` method the `Async` suffix.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:77
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: Antipattern surface; checklist C056 is its gate and widens it to all `Task` methods.
- passage: - [ ] `Async` suffix on every `Task` and `Task<T>` method; `CancellationToken` last and passed down the chain

### C042
- key: Place `CancellationToken` last in the parameter list.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:78
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: Antipattern surface; checklist C056 is its gate and adds the pass-down-the-chain clause.
- passage: `CancellationToken` last and passed down the chain

### C043
- key: Never remove `#region` blocks on the grounds that modern style dislikes them.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:79
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: No finding. Names the exact argument a model makes when refactoring, which is the habit the list guards.
- passage: - ❌ Removing `#region` blocks because "modern style" dislikes them

### C044
- key: Never use the null-forgiving operator `!`; use null-conditional and null-coalescing instead.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:80
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: Antipattern surface; reference §10 is the detail layer of the same owner.
- passage: - ❌ The null-forgiving operator `!` - use null-conditional and null-coalescing instead

### C045
- key: Never put inline SQL text in application code; route data access through stored procedures with `CommandType.StoredProcedure`.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:81
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: The doctrine's Defaults bullet owns the data-access default; this bullet carries the .NET call form, the language-scoped instance the map assigns to the style skill. Whole at the clause grain at section 37's close: line 81 ends at the closing parenthesis after `CommandType.StoredProcedure`, C046's clause gone after the semicolon.
- passage: - ❌ Inline SQL text in application code - call the stored procedure with `CommandType.StoredProcedure`, per the doctrine's Defaults

### C046
- key: The connection's principal is EXECUTE-only by design, so inline SQL is an architecture violation rather than a shortcut.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/SKILL.md:81
- provenance: f8c0649 2026-06-10, INIT.
- verdict: retire
- landed: b608667 section 37
- reason: The doctrine's Defaults bullet (operating-instructions/SKILL.md:36) states the EXECUTE-only fact whole and owns it; this copy is a duplicate. The why, for the record: the application connection principal holds EXECUTE only, so inline SQL fails at runtime under the intended grants and passes only where a developer widened them. Retired at section 37's close: the semicolon clause is gone from line 81, which carries C045's bullet alone; the doctrine's bullet stands at operating-instructions line 36 at HEAD.
- proposed: (via A077) Cut the clause after the semicolon in the inline-SQL antipattern; the doctrine and this ledger carry the why.
- baseline-test: yes

### C047
- key: Resolve configuration options lazily at request time rather than once at startup.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:82
- provenance: 6b3cbec 2026-07-26, the doctrine-rightsizing plan (docs/archive/claude-kit_doctrine-rightsizing_spec_v1.md, edit E11) relocated it from the doctrine's "Don't waste your own moves" to this skill as its point-of-action home, with item-by-item operator approval. The original doctrine install narrates no incident.
- verdict: keep
- reason: Deliberately relocated here; reference §11 carries the `IOptionsMonitor<T>` / `.CurrentValue` mechanic as the detail layer. Whole at the clause grain at section 37's close: line 82 ends at "request time", C048's clause gone after the spaced hyphen.
- passage: - ❌ Resolving configuration options once at startup instead of lazily at request time

### C048
- key: An eager startup read of configuration bakes in defaults and silently bypasses test overrides.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/SKILL.md:82
- provenance: 6b3cbec 2026-07-26, as C047.
- verdict: retire
- landed: b608667 section 37
- reason: The rule and the mechanic stand without it. The why, for the record: a value read once at startup is fixed before a test's configuration override is applied, so the override is silently ignored and the test exercises the default. Retired at section 37's close: the clause after the spaced hyphen is gone from line 82, which carries C047's bullet alone.
- proposed: Cut the clause after the dash in the configuration antipattern; the ledger carries the why.
- baseline-test: yes

### C049
- key: Order middleware by cost rather than convenience, putting cheap rejection such as rate limiting before expensive work such as authentication.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:83
- provenance: 6b3cbec 2026-07-26, as C047.
- verdict: keep
- reason: No finding. Relocated here on purpose; no analyzer checks pipeline order.
- passage: - ❌ Ordering middleware by convenience rather than cost - cheap rejection (rate limiting) belongs before expensive work (authentication)

### C050
- key: Wrap each major section in `#region` / `#endregion` in the canonical order: Constants, Variables, Constructor, public method-group regions, Private Methods.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/SKILL.md:87
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: The completion gate for C013 and the one place in SKILL.md the canonical order appears; the outline section (C035) relies on that order being known.
- passage: - [ ] Each major section wrapped in `#region` / `#endregion`; canonical order: Constants → Variables → Constructor → public method-group regions → Private Methods

### C051
- key: Name private fields `_camelCase`, mark injected dependencies `readonly`, and group fields under `// Group.` labels.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/SKILL.md:88
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: The gate for C009 plus the two naming mechanics; after C010 retires this is where SKILL.md names the `// Group.` label form.
- passage: - [ ] Private fields `_camelCase`, `readonly` for injected dependencies, grouped with `// Group.` labels

### C052
- key: With 2+ constructor parameters, put one per line eight spaces deeper than the signature line with the closing `)` on its own line at the signature line's indent, and open the body with `// Save Services.`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/SKILL.md:89
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: CSharpier via format-on-edit.js re-lays out parameters where a repo has it installed, which is the mechanically-enforced contract C016 already yields to; it is not machinery enforcing this line, so the line is not superseded.
- passage: - [ ] Constructor parameters one per line when 2+, eight spaces deeper than the signature line, closing `)` on its own line at the signature line's indent, body starts `// Save Services.`

### C053
- key: Write in-method section comments as `// Title.` with a terminating period and a blank line before each.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/SKILL.md:90
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: The gate for C004 and the only SKILL.md statement of the blank-line-before convention; the reference's "preferred" is the detail layer admitting the exception a gate does not.
- passage: - [ ] Section comments inside methods use `// Title.`, never `// Save Services`; blank line before each

### C054
- key: Use early returns with `default` rather than `null`, `is null` / `is not null` for null checks, and `??=` for late initialization.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/SKILL.md:91
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: The reference's early-return example (`if (document == null) return default;`) contradicts both this line and the reference's own `is null` rule two lines later; this line is the right side and the example gives way.
- passage: - [ ] Early returns with `default` (not `null`); `is null` / `is not null`; `??=` for late-init
- flag: stale

### C055
- key: Prefer collection expressions and spreads over older constructions: `[.. source.Where(...)]` over `.ToArray()`, `[item]` over `new[] { item }`, `[.. existing, item]` over `Append`/`Concat` plus `ToArray`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/SKILL.md:92
- provenance: 058e3a3 2026-07-24, grounded in a real data-loss bug: a discarded `Enumerable.Append` result in the source session.
- verdict: keep
- reason: Incident-born (a discarded `Append` return silently lost data) and the spread form makes that shape impossible; no analyzer enforces it.
- passage: - [ ] Collection expressions and spreads, such as `[.. existing, item]` not `Append`/`Concat` + `ToArray`

### C056
- key: Put the Async suffix on all `Task` methods and pass `CancellationToken` last and down the whole chain.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:93
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: The gate for C041 and C042, and the only SKILL.md statement of pass-down-the-chain and of the widening from `Task<T>` to all `Task`.
- passage: - [ ] `Async` suffix on every `Task` and `Task<T>` method; `CancellationToken` last and passed down the chain

### C057
- key: Order `using` lines with System.* first, then project and third-party namespaces with third-party placed where convenient, and no blank lines between groups.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/SKILL.md:94
- provenance: adf3d51 2026-07-24, a prior kit audit found the checklist prescribing a strict order its own reference contradicted and repaired it to match, recording that the reference stays the owner.
- verdict: keep
- reason: Already adjudicated once: a one-line summary with a §1 pointer, the reference owning the detail. Re-ordering the checklist against the reference is the drift that audit repaired.
- passage: `using` lines: System.* first, then project and third-party namespaces, third-party where convenient (reference §1), no blank lines between groups
- flag: weak-reason

### C058
- key: Do not write file-header comments.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:94
- provenance: f8c0649 2026-06-10, INIT (the line's last touch, adf3d51, changed only the using order beside it).
- verdict: retire
- reason: row 598 (No file header), dropped under the mechanism cut; the reference loses the rule, so the checklist gate line goes with it.
- passage: no file-header comments
- ruled: cut 2026-09-30

### C059
- key: Log via `ILogger<T>` as the preferred pattern, or the static Serilog `Log` where existing code uses it.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:95
- provenance: 7964c7e 2026-06-28, "Style Cleanups", which deleted the INIT antipattern banning `ILogger<T>` and made it the preferred pattern in the checklist and reference §8 together; the message states no reason.
- verdict: keep
- reason: A deliberate reversal of an INIT ban; the reference's match-the-surrounding-file bound is the detail layer of the same rule.
- passage: Logging via `ILogger<T>` (preferred) or the static Serilog `Log`

### C060
- key: End log messages with a period, as in `logger.LogError(ex, "Message.")` or `Log.Error(ex, "Message.")`.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:95
- provenance: f8c0649 2026-06-10, INIT; 7964c7e added the second example when `ILogger<T>` became preferred.
- verdict: keep
- reason: The two examples show the period inside the string literal for both logger shapes, which is the thing a session gets wrong.
- passage: messages end with a period: `logger.LogError(ex, "Message.")` or `Log.Error(ex, "Message.")`

### C061
- key: Put DI registration in `Assembly/RegisterServices.cs` using `.AsImplementedInterfaces().PreserveExistingDefaults()`, grouped by domain label.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/SKILL.md:96
- provenance: f8c0649 2026-06-10, INIT.
- verdict: keep
- reason: The gate for C011 with the file and grouping added; reference §11 is the detail layer.
- passage: - [ ] DI registration in `Assembly/RegisterServices.cs`: `.AsImplementedInterfaces().PreserveExistingDefaults()`, grouped by domain label

### C062
- key: Declare a class's interface inline as `public class FooService : IFooService` and put the interface in `Interfaces/IFooService.cs`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/SKILL.md:97
- provenance: f8c0649 2026-06-10, INIT; 058e3a3 2026-07-24 promoted the Interfaces/ placement from this checklist mention to an explicit reference §1 rule after the PrePass review found co-located interfaces.
- verdict: keep
- reason: Incident-born placement rule; the reference's rule was grown from this line on purpose, so both stand as gate and detail.
- passage: - [ ] Class declares its interface inline: `public class FooService : IFooService`; interface in `Interfaces/IFooService.cs`

### C063
- key: Add XML `/// <summary>` docs on public members where they earn their keep and are well written, not as boilerplate.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:97
- provenance: 7964c7e 2026-06-28, as C008: the reversal of the INIT "no XML docs" stance, installed in philosophy and checklist together.
- verdict: keep
- reason: The gate for C008; both landed in one edit as principle and gate.
- passage: - [ ] XML `/// <summary>` docs on public members only where they earn their keep

### C064
- key: Cite the 885-line service interface, which the anchored member grep returns as zero members though it carries 67, as evidence the anchored pattern misses interface members.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/SKILL.md:67
- provenance: c6f08c5 2026-08-23, measured in the finishing pass of the process-rule-repairs plan.
- verdict: retire
- landed: b608667 section 37
- reason: The hole statement (the anchored grep returns nothing on an interface file) stays as C030's bound; the measurement moves here: an 885-line service interface returned zero members under the anchored grep while carrying 67, all of which the interface pattern found. Retired at section 37's close: the clause is gone from line 67, whose second sentence ends at "one type with no members.", and the ", which finds all 67 there" tail of C030's sentence went with it.
- proposed: Cut the "measured, an 885-line service interface returns zero members under it while carrying 67" clause; the ledger carries it.
- baseline-test: yes

### P001
- key: Write a section comment as the rule alone in the `// Title.` form, and let the rare WHY comment follow the rule with its reason as its own sentence and at most one case.
- class: rule
- source: plugins/grimoire/skills/csharp-style/SKILL.md:12
- provenance: docs/plans/claude-kit_prose-register_spec_v1.md section 4, which made the register govern every piece written for a reader and pointed each style skill's comment rules at it.
- verdict: keep
- reason: C005 and C007 fix what a comment says and this fixes the order it says it in, which no rule in this skill stated. The doctrine owns the register, so the pointer form keeps this skill from becoming a second owner of a rule that governs every piece. A section comment carries the rule alone, so the pointer adds an order without loosening the rare-WHY bound the same item states.
- passage: A WHY comment is rare, and its reason follows as its own sentence.

## plugins/grimoire/skills/csharp-style/references/csharp-style.md

This document is the detailed pattern reference for the operator's C# house style, using a generic document-processing library as its worked example shape. It owns every moment in which C# is written or modified: file layout and using order, namespace shape, class organization into #region blocks, field naming and grouping, constructor form, method declarations, method-body section comments, async and cancellation patterns, logging, exception handling, null handling, Autofac DI registration, naming conventions, MediatR notifications, models and settings classes, whitespace and indentation, and the skeleton for a brand-new service. A session loads it before writing or changing any C# code, which is a named-trigger load class (inferred, since the document itself states no loading rule and its content is a per-act pattern reference rather than standing doctrine).

Extracted at `6bc07fb`: whole document (`skills.csharp-style.references.csharp-style.md`). Redrafted on 2026-09-26 by section 11 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, landed at `2b366196` with its fix round at `bac21117`, so every live entry's `passage:` line quotes the text at `bac21117`.

### C001
- key: Substitute the target project's own namespaces and type names for the example names rather than copying the example names literally.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:3
- provenance: 830ff28 2026-06-17, the fork-improvements commit that genericized the repo-specific example names (ASR.Eleos) after the reference had been written against one real library; a8770b3 2026-06-28 only reworded it to first person.
- verdict: keep
- reason: Nothing mechanical checks a generated file for copied placeholder names, so the copy-the-example-literally failure recurs; the SQL reference states the same rule for its own identifiers because neither document is loaded when the other language is written.
- passage: Substitute the project's own names for the `Acme` examples.

### C002
- key: Open a sibling file in the library and follow its layout exactly.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:3
- provenance: f8c0649 2026-06-10 installed the sibling instruction; 830ff28 2026-06-17 added the "already written in this style" bound alongside the SKILL's Precedence section.
- verdict: keep
- reason: The bound is the whole point: mimicry is for staying consistent inside code already in this style, never a reason to follow a foreign repo, and the SKILL's Precedence paragraph is what a session reads when the two collide.
- passage: Inside a repo already in this style, follow a sibling file's layout exactly.

### C003
- key: Order using statements System.* first, then convenient third-party such as Serilog, then project namespaces, then other third-party such as AutoMapper and MediatR.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:30
- provenance: f8c0649 2026-06-10, the kit's initial commit, which distilled the reference from the operator's own document-processing library.
- verdict: keep
- reason: The SKILL checklist cites "reference §1" for this ordering, so the reference is the only place the full order and its not-strictly-alphabetical bound are stated.
- passage: Order usings `System.*` first, then third-party where convenient (Serilog often mid-list), then project namespaces, then other third-party such as `AutoMapper` and `MediatR`. Order inside a group is loosely alphabetical.

### C004
- key: Put no blank lines between the using-statement groups.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:35
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: This is the owning statement of the rule, sitting inside the using-order list where a session reads it while writing the block; §15's repeat (C114) retires to it.
- passage: Put no blank lines between groups

### C005
- key: Put a single blank line between the using block and the namespace declaration.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:37
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; a formatter is optional in a target repo and the file-head shape is stated nowhere else.
- passage: one blank line before the namespace.

### C006
- key: Prefer the simplest namespace shape: plugin assemblies declare no namespace at all, and a warranted namespace is typically one root namespace per project.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:39
- provenance: 058e3a3 2026-07-24, delta 1 of the PrePass hand-edit review, where Claude-authored C# had declared namespaces the operator's plugin assemblies do not use.
- verdict: keep
- reason: Incident-born and unenforced by any hook; the counter-example namespaces name the exact shape the review rejected.
- passage: Keep namespaces coarse. Plugin assemblies declare none. A warranted namespace aligns to a plugin or large functional chunk, typically one root per project.
- flag: weak-reason

### C007
- key: Never let folders generate sub-namespaces mirroring the folder tree; folders organize files only.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:39
- provenance: 058e3a3 2026-07-24, same PrePass delta as C006.
- verdict: keep
- reason: Folder-mirrored namespaces are the default habit of every C# generator, and nothing in the tree refuses them mechanically.
- passage: Folders never generate sub-namespaces such as `Acme.Documents.Services`.

### C008
- key: Declare a namespace file-scoped with a semicolon.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:39
- provenance: f8c0649 2026-06-10 installed the file-scoped rule; 058e3a3 2026-07-24 rescoped it to "when a new file declares a namespace" so it no longer implied every file declares one.
- verdict: keep
- reason: The rescoping is load-bearing beside C006: without it the file-scoped rule reads as requiring a namespace in every file.
- passage: Where a new file declares a namespace, make it file-scoped:

### C009
- key: Write the file-scoped namespace as `namespace Acme.Documents;`.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:41
- provenance: f8c0649 2026-06-10 installed the specimen; a8770b3 2026-06-28 only replaced the real library name with the generic one.
- verdict: keep
- reason: Two words showing the semicolon terminator; the ledger cannot hold it more cheaply than the line does.
- passage: namespace Acme.Documents;

### C010
- key: Leave existing block-scoped namespace files as they are, and write only new files file-scoped.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:43
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The owning statement of the leave-alone rule, and it already names `Assembly/RegisterServices.cs` as its example, which is why §11's repeat (C089) retires to it.
- passage: Leave existing block-scoped files, such as `Assembly/RegisterServices.cs`, alone.

### C011
- key: Write no file-level header comments: no copyright, no author block, no license; begin files with `using`.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:45
- provenance: f8c0649 2026-06-10.
- verdict: retire
- reason: row 598 (No file header), dropped under the mechanism cut.
- passage: Write no file header: no copyright, author block or license. Files begin with `using`.
- ruled: cut 2026-09-30

### C012
- key: Put interfaces in an `Interfaces/` folder, never co-located with their implementations.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:47
- provenance: 058e3a3 2026-07-24, delta 2, which promoted this "from a s16/checklist mention to an explicit rule in reference s1" after the PrePass review found co-located interfaces.
- verdict: keep
- reason: The commit made this line the owner by design; §16's closing step (C119) is the procedure's pointer to it, not a rival.
- passage: Interfaces live in `Interfaces/`, never beside their implementations.
- flag: weak-reason

### C013
- key: Open a file with the ordered usings, a blank line, the file-scoped namespace, then the class declaration, as `Services/Build/FormService.cs:1-13` shows.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:49
- provenance: f8c0649 2026-06-10; 830ff28 2026-06-17 genericized the names inside it.
- verdict: retire
- reason: row 596 (Using-directive ordering) shrink removed the example block, which stated the order a second time. C003's landed sentence still carries the order, with Serilog mid-list and `AutoMapper` and `MediatR` after the project namespaces.
- passage: Example:
- passage: using System.Threading;

### C014
- key: Organize a class into `#region` blocks in the order Constants, Variables, Constructor, public method-group regions, Private Methods.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:68
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The canonical order is cited outside this skill (the outline recipe in `csharp-style/SKILL.md` reads regions as the file's map), so the full statement stays here.
- passage: Organize a class into `#region` blocks in this order:

### C015
- key: Put `private const string` declarations in `#region Constants`, and omit the region when there are none.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:70
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; the omit-if-empty clause is stated nowhere else.
- passage: 1. `#region Constants` - `private const string` declarations, omitted if none

### C016
- key: Put private fields in `#region Variables`, grouped by purpose with `// Group.` labels.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:71
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original).
- verdict: keep
- reason: No finding; the region's contents rule.
- passage: 2. `#region Variables` - private fields under `// Group.` labels
- flag: weak-reason

### C017
- key: Put the single constructor in `#region Constructor` with parameters one per line.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:72
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original).
- verdict: keep
- reason: Placement, not the single-constructor rule, which C030 owns; only the word "single" is shared.
- passage: 3. `#region Constructor` - the single constructor
- passage: With two or more parameters, put each on its own line

### C018
- key: Name each public method-group region for what its methods do, such as `#region Form Processing`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:73
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original).
- verdict: keep
- reason: No finding; the naming rule is what makes region labels carry author intent for the outline recipe.
- passage: 4. Public method-group regions named for what they do, such as `#region Form Processing`

### C019
- key: Put `#region Private Methods` at the bottom of the class, optionally with nested regions for sub-themes.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:74
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original).
- verdict: keep
- reason: The nested-region permission is stated only here.
- passage: 5. `#region Private Methods` - last, optionally with nested regions for sub-themes

### C020
- key: Close every `#region` with a matching `#endregion` and never leave a region open.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:76
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; an unclosed region breaks the file and no formatter in the kit's hook chain repairs one.
- passage: Close every region with a matching `#endregion`.

### C021
- key: Align `#region` and `#endregion` lines with the region's contents, four spaces inside a class, not with the class brace.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:78
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding, and this is one rule CSharpier does not impose, since preprocessor directives are left where the author put them.
- passage: Align both lines with the region's contents (four spaces inside a class), not the class brace.

### C022
- key: Lay a class out as the skeleton shows: Constants, Variables with group labels, Constructor, a named processing region, then Private Methods with nested themed regions.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:81
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The skeleton carries what the prose does not: the nested Private Methods regions indented a further four spaces, which C021 states only for the outer level.
- passage: Skeleton:
- passage: #region Form Handling

### C023
- key: Name private fields `_camelCase` with a leading underscore.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:139
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Reference §3 is the owner; the SKILL checklist carries the twelve-word summary.
- passage: Private fields are `_camelCase`

### C024
- key: Mark all injected dependencies `readonly`.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:140
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Reference §3 is the owner; nothing enforces it.
- passage: Injected dependencies are `readonly`.

### C025
- key: Use `private const` for compile-time constants, named `camelCase` for local scoped strings and `SCREAMING_SNAKE_CASE` for cross-cutting markers.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:141
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original).
- verdict: keep
- reason: No finding; the two-casing split is stated only here and contradicts the default C# convention, so it cannot be inferred.
- passage: `private const` names are `camelCase` for local strings (`downloadUrlSuffix`) and `SCREAMING_SNAKE_CASE` for cross-cutting markers (`EMAIL_SENT`).

### C026
- key: Name static computed comparison properties in PascalCase, such as `IgnoreCase` and `IgnoreCaseComparer`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:142
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; these look like fields and would otherwise take the `_camelCase` rule.
- passage: Static computed comparison properties are PascalCase: `IgnoreCase`.

### C027
- key: Inside `#region Variables`, group fields under single-line `// Group.` label comments with a blank line between groups.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:144
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The owning statement, stated where the grouping rule lives; §15's blank-line repeat (C112) retires to it.
- passage: In `#region Variables`, group fields under single-line `// Group.` labels, a blank line between groups.

### C028
- key: Use the common group labels `// Values.`, `// Mapper.`, `// Services.`, `// Settings.`, and `// State.` for their stated contents.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:146
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original).
- verdict: keep
- reason: All five labels with what each holds appear only here; the SKILL's checklist names the `// Group.` label form without naming any of the five (its philosophy point 2 named three until section 37's rewrite at b608667 reduced it to its bold lead).
- passage: Common labels: `// Values.` for static comparers and computed defaults, `// Mapper.` for AutoMapper, `// Services.` for injected services, `// Settings.` for `IOptionsMonitor<T>`, and `// State.` for rare mutable state.

### C029
- key: Write the Variables region as the `Services/Build/FormService.cs:20-31` example shows, with Values, Mapper, and Services groups separated by blank lines.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:152
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original); no commit narrates an incident for the second specimen.
- verdict: retire
- landed: 1dd5bee section 46
- reason: Safe because the §2 skeleton (lines 89-99) already shows the same Variables region with the same three group labels, differing by one comparer line; removing the §3 copy loses no form a session needs. Retired at section 46's close: the label, the block and the blank line after it are gone from §3, no pointer landed since this proposal makes the cross-reference optional and the document writes no section cross-reference anywhere; §3 closes on C028's label list at landed lines 146 to 150.
- proposed: Drop the §3 "Example - Services/Build/FormService.cs:20-31" block; point at the §2 skeleton's Variables region if a cross-reference is wanted.
- proposed: Same removal as A046.
- baseline-test: yes

### C030
- key: Give a class a single primary constructor only, with no overloads and no static factories.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:170
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: This is the rule; C017's "single constructor" is a description of the region's contents, so the two are not duplicates.
- passage: Write one primary constructor, with no overloads or static factories.

### C031
- key: Put constructor parameters on their own lines indented eight spaces deeper than the signature line.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:171
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original).
- verdict: keep
- reason: Eight spaces is right for constructors specifically; the document's own specimen (the `#region Constructor` skeleton) confirms it, and §15's over-generalized version (C115) retires.
- passage: With two or more parameters, put each on its own line, indented eight spaces deeper than the signature line.

### C032
- key: Put the constructor's closing `)` on its own line, at the signature line's indent.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:172
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The closing indent is stated in full here; the SKILL checklist repeats the column in the same words.
- passage: The closing `)` sits on its own line, at the signature line's indent.

### C033
- key: Open the constructor body with a section-comment block describing what gets assigned, then assign directly.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:173
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Stated generally here where the checklist names one specimen label, so the reference is what a session with a different assignment set reads.
- passage: The body opens with a section comment naming what gets assigned, then assigns directly.

### C034
- key: Treat `ArgumentNullException` guards on injected dependencies as optional; they are not required but are fine to add.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:174
- provenance: 7964c7e 2026-06-28, an operator hand-commit that softened the prior absolute "No `ArgumentNullException` checks" to optional; the commit carries no narrative beyond its title.
- verdict: keep
- reason: No finding, and the permission is the point: without it a session reads the older kit convention as a ban.
- passage: `ArgumentNullException` guards on injected dependencies are optional.

### C035
- key: Construct AutoMapper instances inline in the constructor under a `// Save Mapper.` comment.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:175
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; the inline mapper construction is unusual enough that it is inferable from nothing else in the document.
- passage: Construct AutoMapper inline under `// Save Mapper.`.

### C036
- key: Write the constructor as the `Services/Build/FormService.cs:33-50` example shows, assigning services under `// Save Services.` then building the mapper under `// Save Mapper.`.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:177
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original).
- verdict: retire
- reason: row 602 (Single constructor layout) shrink removed the constructor example, which repeated the section 2 skeleton's constructor. C035's landed sentence "Construct AutoMapper inline under `// Save Mapper.`." carries the act, and the section 2 skeleton carries the layout.
- passage: Example:
- passage: var mapConfig = new MapperConfiguration(c =>

### C037
- key: End every async method name in `Async`.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:200
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The reference states it positively for all async methods where the SKILL states it as an antipattern keyed on `Task<T>`.
- passage: Async method names end in `Async`.
- flag: stale

### C038
- key: Make `CancellationToken` the last parameter.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:201
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Same split: the positive statement lives here, the antipattern in the SKILL.
- passage: `CancellationToken` is the last parameter.
- flag: stale

### C039
- key: Break each parameter of a multi-parameter method onto its own line at a four-space indent, with the closing `)` on its own line at the method-signature indent.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:202
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Four spaces is the method case and eight the constructor case; every method specimen in the document (lines 209, 246, 483) is at four, so this side wins the contention against C115.
- passage: A multi-parameter method puts each parameter on its own line at a four-space indent, with the closing `)` on its own line at the signature's indent.

### C040
- key: Annotate return types as nullable, such as `Task<FilledForm?>`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:203
- provenance: f8c0649 2026-06-10.
- verdict: retire
- reason: merged into C079, which quotes the same landed sentence and whose key covers both returns and parameters. One rule was stated by two entries.
- passage: Annotate returns and parameters nullable where null is a valid value: `Task<FilledForm?>`, `Stream?`.
- flag: stale

### C041
- key: Put no method-level attributes on methods.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:204
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; the MediatR carve-out is stated only here.
- passage: Add no method-level attributes except where required, such as a MediatR handler signature.

### C042
- key: Write a method signature as the `Services/Build/FormService.cs:54-57` example shows, one parameter per line with the cancellation token last.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:206
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original); no commit narrates an incident for the second specimen.
- verdict: retire
- landed: 1dd5bee section 46
- reason: Safe because the §6 full-method example repeats these four lines verbatim (lines 245-248), so the signature shape survives the removal. Retired at section 46's close: the label, the block and the blank line after it are gone from §5, no pointer landed; the signature survives at landed lines 114 to 117 (the §2 skeleton) and 221 to 224 (the §6 example).
- proposed: Drop the §5 "Example - Services/Build/FormService.cs:54-57" block; the §6 example shows the same signature.
- baseline-test: yes

### C043
- key: Organize a method body as a sequence of named sections, each preceded by a `// Title.` comment naming what the next block does, not what it did or why.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:216
- provenance: f8c0649 2026-06-10 installed the section-comment rule; 058e3a3 2026-07-24 (delta 5) sharpened it after the PrePass hand-edit review found narrating comments in Claude-authored C#.
- verdict: keep
- reason: Incident-born, nothing mechanical checks comment voice, and the "heart of the style" opening tells a skimming session which section to weight.
- passage: This is the heart of the style. A method body is a sequence of sections, each under a `// Title.` comment naming what the next block does, not what it did or why.

### C044
- key: Write section-comment text in Title Case.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:219
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; Title Case is stated only here and is the visible signature of the style.
- passage: Comments are Title Case

### C045
- key: End every section comment with a period.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:220
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The skill's frontmatter names this a signature trait, and the reference's §6 conventions list is where the comment mechanics sit together.
- passage: end with a period: `// Validate Parameters.`

### C046
- key: Put one blank line before the section comment between sections.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:221
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The owning statement, and the only one carrying the "preferred rather than absolute" bound the checklist drops; §15's repeat (C113) retires to it.
- passage: Prefer one blank line before each section comment.

### C047
- key: Keep section comments short, imperative, direct statements of what the next block is intended to do, as a reading aid for someone scanning the method.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:222
- provenance: 058e3a3 2026-07-24, delta 5 of the PrePass hand-edit review plus its follow-up clarifications.
- verdict: keep
- reason: The specimen and the "incidental we" parenthetical are the resolution that commit recorded, and they are what draws the line the intent-not-vocabulary test asserts.
- passage: A comment is a short, imperative statement of the next block's intent, a reading aid for someone scanning.
- flag: weak-reason

### C048
- key: Avoid section comments opening with "Now we...", "Here we...", or "This will...".
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:222
- provenance: f8c0649 2026-06-10 installed the banned openings; 058e3a3 2026-07-24 records that they stand after the voice rule was sharpened.
- verdict: keep
- reason: The named openings are the exact drift the hand-edit review found, and the SKILL's antipattern names one of the same three specimens.
- passage: Avoid "Now we
- passage: , "Here we
- passage: This will

### C049
- key: Treat `// Abort if we don't have a Valid VIN, make no changes.` as in-voice.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:222
- provenance: 058e3a3 2026-07-24, the follow-up clarification to the PrePass review that fixed where the voice line falls.
- verdict: keep
- reason: The intent-over-vocabulary test cannot be stated without an instance whose informal "we" still passes.
- passage: The test is intent, not vocabulary: `// Abort if we don't have a Valid VIN, make no changes.` is in-voice, the incidental "we" included.

### C050
- key: Never let a comment explain history, decision-making, alternatives weighed, or issues encountered; keep WHY comments rare and exceptional.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:223
- provenance: 058e3a3 2026-07-24, delta 5; the doc-closeout-discipline plan later added the matching change-narrative antipattern to the SKILL.
- verdict: keep
- reason: Incident-born and unenforced; it is the C# face of the doctrine's current-state rule, and both copies were installed deliberately.
- passage: A comment never explains history, decisions, alternatives weighed or issues met. A WHY comment is rare.

### C051
- key: Use the common section comments `// Validate Parameters.`, `// Return Value.`, `// Declare Variables.`, `// Get X.` / `// Extract X.` / `// Build X.` / `// Apply X.`, and `// Return the Processed Result.` for their stated roles.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:225
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; the canonical label vocabulary is what makes two files written by different sessions read alike.
- passage: Common section comments: `// Validate Parameters.` for guard clauses, `// Return Value.` for the return variable, `// Declare Variables.` for locals used across try blocks, `// Get X.` / `// Extract X.` / `// Build X.` / `// Apply X.` for major operations, and `// Return the Processed Result.` at the bottom.

### C052
- key: Return early on null or invalid input, as in `if (document == null) return default;`.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:233
- provenance: f8c0649 2026-06-10, lifted with its guard text from the source library, whose legacy code used `== null`.
- verdict: rewrite
- landed: 1dd5bee section 46
- reason: The rule stands; only the worked guard changes to `is null`, which is what C054, the SKILL exemplar and the §16 template all already write, so the edit removes a contradiction without touching the rule. Lands at landed line 209 (section 46's close) as the proposal's bullet with the guard reading `is null`, and the §6 example's guard at landed line 227 reads the same, recorded on C061 as the one line of that block this proposal changed; `== null` survives on C054's rule line alone.
- proposed: Change the worked guard at line 233 and in the §6 example at line 251 to `if (document is null) return default;`, keeping the rule text unchanged.
- baseline-test: yes
- passage: Return early on null or invalid input: `if (document is null) return default;`

### C053
- key: Return the `default` keyword rather than `null` for null returns on nullable types.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:234
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The nullable-type bound is stated only here.
- passage: Return `default`, not `null`, on nullable types.

### C054
- key: Use `is null` and `is not null` rather than `== null` and `!= null`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:235
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: This is the side history upholds in the `== null` contention; the rejected forms are named only here.
- passage: `is null` / `is not null` over `== null` / `!= null`.

### C055
- key: Use `??=` for default assignment, as in `filledDocument ??= new();`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:236
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The owning statement, stated with its worked assignment beside the other body idioms; §10's repeat (C081) retires to it.
- passage: ??=` for default assignment: `filledDocument ??= new();

### C056
- key: Use `var` when the type is obvious from the right-hand side.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:237
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; the "obvious from the right-hand side" bound is what keeps `var` off ambiguous assignments.
- passage: `var` when the right-hand side makes the type obvious.

### C057
- key: Write LINQ as method chains, not query syntax.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:238
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; no formatter converts query syntax.
- passage: LINQ method chains, not query syntax.

### C058
- key: Use collection expressions and spreads over older constructions: `[.. source.Where(...)]` over `.ToArray()`, `[item]` over `new[] { item }`, `[.. existing, item]` over `Append`/`Concat` plus `ToArray`.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:239
- provenance: 058e3a3 2026-07-24, delta 3, grounded in a real data-loss bug: a discarded `Enumerable.Append` result in the source session; 75913a4 2026-07-24 then removed the rationale sentence from the reference, leaving the rule bare.
- verdict: keep
- reason: Incident-born with a data-loss consequence and no machinery catches a discarded `Append`; the three named substitutions are the rule's whole content, and the operator has already ruled once that the rationale does not ride in the prose.
- passage: Collection expressions and spreads: `[.. source.Where(
- passage: )]` over `.ToArray()`, `[item]` over `new[] { item }`, `[.. existing, item]` over `Append`/`Concat` + `ToArray`.
- flag: weak-reason

### C059
- key: Keep explicit constructor parentheses on named-type object initializers, writing `new FilledForm() { Title = docType }` rather than `new FilledForm { Title = docType }`.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:240
- provenance: 058e3a3 2026-07-24, delta 4 of the PrePass hand-edit review.
- verdict: keep
- reason: No finding; incident-born, contrary to the common C# habit, and the target-typed `new()` carve-out is what keeps it from over-firing.
- passage: Named-type object initializers keep explicit parens: `new FilledForm() { Title = docType }`, not `new FilledForm { Title = docType }`. Target-typed `new()` stays preferred where the type is inferable.

### C060
- key: Use string interpolation `$"..."` rather than `string.Format` or concatenation.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:241
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; no formatter rewrites `string.Format`.
- passage: String interpolation `$
- passage: ` over `string.Format` or concatenation.

### C061
- key: Write a method as the `Services/Build/FormService.cs:54-118` example shows: validate, declare the return value, do the work inside try under named section comments, log in catch, return at the bottom.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:243
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original).
- verdict: retire
- landed: 1dd5bee section 46
- reason: row 606 (Worked method body example) shrink removed the worked example, since one example would do. The csharp-style SKILL's `## Method Exemplar` block (row 580, keep) carries the same cadence: validate, `// Return Value.`, work inside try under section comments, log in catch, return at the bottom.
- proposed: The block is unchanged but for its guard line, which reads `if (document is null) return default;` per C052.
- passage: Example:
- passage: // Document Form is only known by "FormCode", Validate.

### C062
- key: Aim for section comments that alone tell the story of the method.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:293
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: This is the acceptance check for §6, applied to a session's own output, not a why; fourteen words and nothing checks it mechanically.
- passage: The comments alone should tell the story of the method.

### C063
- key: Pass cancellation tokens down the call chain.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:298
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Reference §7 gathers the async patterns; a token accepted and dropped compiles clean, so nothing catches the omission.
- passage: Pass cancellation tokens down the call chain.

### C064
- key: Use `Task.FromResult(...)` in synchronous helpers that return `Task<T>` for interface uniformity, rather than converting them to a sync signature.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:299
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; it settles the interface-uniformity question a session would otherwise resolve by narrowing the signature.
- passage: A synchronous helper keeps its `Task<T>` signature for interface uniformity and returns `Task.FromResult(

### C065
- key: Use `Task.CompletedTask` in synchronous helpers returning `Task`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:300
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; the non-generic counterpart of C064.
- passage: or `Task.CompletedTask` for `Task`.

### C066
- key: Use `ConfigureAwait(false)` in background services under `Services/Background/*` but not in regular services, matching the surrounding file.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:301
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; the split by folder is stated only here and no analyzer in the kit enforces either side.
- passage: Use `ConfigureAwait(false)` in background services (`Services/Background/*`), not regular services, matching the surrounding file.

### C067
- key: Return `Task` or `Task<T>` and never `ValueTask`.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:302
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original).
- verdict: keep
- reason: No finding; `ValueTask` is a common performance suggestion, so the ban has to be written.
- passage: Return `Task` or `Task<T>`, never `ValueTask`.

### C068
- key: Log through `ILogger<T>` injection for new code or the static Serilog `Log`, matching the surrounding file.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:306
- provenance: 7964c7e 2026-06-28, an operator hand-commit that replaced the prior absolute "No `ILogger<T>` is injected" with the preference plus fallback, in SKILL and reference together.
- verdict: keep
- reason: The reference carries the match-the-surrounding-file bound the checklist compresses away, and the reversal is recent enough that a session reading the old kit convention needs the current text.
- passage: Log through injected `ILogger<T>`, preferred for new code, or Serilog's static `Log`, matching the surrounding file.

### C069
- key: Include `using Serilog;` in the using list when the static `Log` is used.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:307
- provenance: 7964c7e 2026-06-28, which added the "when the static `Log` is used" condition once `ILogger<T>` became the preferred path.
- verdict: keep
- reason: No finding; without the condition the line would demand a Serilog using in files that inject a logger instead.
- passage: Add `using Serilog;` when the static `Log` is used.

### C070
- key: Write catch blocks in the standard shape `catch (Exception ex) { Log.Error(ex, "Failure Processing Document."); }`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:308
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; the specimen fixes the message form as well as the shape.
- passage: Catch blocks log in this shape:
- passage: Log.Error(ex, "Failure Processing Document.");

### C071
- key: Use `Log.Debug($"...")` with method-name-prefixed messages for trace-level diagnostics in output services.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:315
- provenance: f8c0649 2026-06-10 installed it; a8770b3 2026-06-28 only genericized the namespace inside the example string.
- verdict: keep
- reason: No finding; the method-name prefix convention appears nowhere else.
- passage: Output services trace with method-name-prefixed `Log.Debug($
- passage: )`: `Log.Debug($"Acme.Documents.PdfService.CreateFromHtmlAsync called with Html: {html}");`.

### C072
- key: End every log message with a period.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:316
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Reference §8 owns the logging conventions; the SKILL restates it with examples in its checklist.
- passage: Log messages end in a period.

### C073
- key: Use `try { ... } catch (Exception ex) { Log.Error(...); }` as the dominant shape, where the catch logs and the method returns `default`.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:320
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; the swallow-and-return-default contract is unusual enough that a session would otherwise rethrow.
- passage: The dominant shape is `try {
- passage: } catch (Exception ex) { Log.Error(
- passage: ); }`, where the catch logs and the method returns `default`.

### C074
- key: Add a `finally` block for delay or sleep loops in background services.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:321
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; it keeps a background loop from starving after a thrown iteration.
- passage: Background services add a `finally` for delay or sleep loops.
- flag: weak-reason

### C075
- key: Use bare `throw;` sparingly, only when the exception must propagate.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:322
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; it is the carve-out that keeps C073 from reading as an absolute swallow.
- passage: Use `throw;` only when the exception must propagate

### C076
- key: Never write `throw ex;`.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:322
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; `throw ex;` resets the stack trace and no analyzer is guaranteed present in a target repo.
- passage: never `throw ex;`.

### C077
- key: Do not define custom exception types; use the generic `Exception`.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:323
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original).
- verdict: keep
- reason: No finding; custom exception hierarchies are a standard generated-code habit this style rejects.
- passage: Define no custom exception types. Use the generic `Exception`.
- flag: weak-reason

### C078
- key: Enable nullable reference types with `<Nullable>enable</Nullable>` in the csproj.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:327
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; it is the precondition for the whole §10 set.
- passage: Enable nullable reference types (`<Nullable>enable</Nullable>` in the csproj).

### C079
- key: Put nullable annotations on returns and parameters, such as `Task<FilledForm?>` and `Stream?`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:328
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; C040 states it for returns, this line extends it to parameters.
- passage: Annotate returns and parameters nullable where null is a valid value: `Task<FilledForm?>`, `Stream?`.

### C080
- key: Suppress an unused return with a discard, as in `_ = values.TryGetValue("Key", out var value);`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:329
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; the discard form is stated only here and appears in the §6 worked method.
- passage: Discard an unused return: `_ = values.TryGetValue("Key", out var value);`.

### C081
- key: Use `??=` for late-init defaults.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:330
- provenance: f8c0649 2026-06-10, installed in the same commit as the §6 statement; no commit narrates a separate reason for the §10 repeat.
- verdict: retire
- landed: 1dd5bee section 46
- reason: Safe because C055 states the same rule in §6 with a worked assignment; the §10 line is four words that add nothing. Retired at section 46's close: the bullet is gone from §10 and the list runs from C080's discard bullet to C082's chains bullet at landed lines 305 and 306; C055's bullet at landed line 212 keeps the rule with its worked assignment.
- proposed: Drop the `??=` bullet from §10; §6 keeps the rule with its example.
- proposed: Same removal as A104.
- baseline-test: yes

### C082
- key: Use `??` chains for fallback values.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:331
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; paired with C083, it is the alternative the null-forgiving ban points at.
- passage: Use `??` chains for fallbacks.

### C083
- key: Do not use the null-forgiving operator `!`; rely on null-conditional and null-coalescing instead.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:332
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original).
- verdict: keep
- reason: Reference §10 gathers the null-handling set; the SKILL's antipattern line is the checklist face of the same rule.
- passage: Never use the null-forgiving operator `!`. Use null-conditional and null-coalescing instead.

### C084
- key: Register every type in the library's `Assembly/RegisterServices.cs` Autofac module the same way.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:336
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Reference §11 carries the file placement, the uniformity requirement and the code block; the checklist carries eleven words.
- passage: `Assembly/RegisterServices.cs` is the library's Autofac module, and every type registers the same way.

### C085
- key: Chain `.AsImplementedInterfaces()` on each registration so interfaces are inferred from the implementation.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:344
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original).
- verdict: retire
- reason: row 611 (Autofac registration shape) shrink. The landed section 11 block, under C088's landed sentence, carries the act of chaining `.AsImplementedInterfaces()`. What the call does is an explanation of the API, not a duty.
- passage: `.AsImplementedInterfaces()` infers interfaces from the implementation.

### C086
- key: Chain `.PreserveExistingDefaults()` on each registration so any prior registration is respected.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:345
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original).
- verdict: retire
- reason: row 611 (Autofac registration shape) shrink. The same section 11 block carries the act of chaining `.PreserveExistingDefaults()`. What the call does is an explanation of the API, not a duty.
- passage: `.PreserveExistingDefaults()` respects any prior registration.

### C087
- key: Group registrations by domain under uppercase label comments such as `// HANDLERS`, `// BACKGROUND.`, and `// SERVICES.`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:347
- provenance: f8c0649 2026-06-10.
- verdict: rewrite
- landed: 1dd5bee section 46
- reason: The uppercase label form and its examples appear only here; the checklist says "grouped by domain label". Flipped to rewrite at section 46's close by C088's proposal, which names this block's line 350: the sentence at landed line 322 is unchanged and the block at 324 to 339 is byte-identical to its source but for its first label, which reads `// HANDLERS.` so that the three labels agree with C088's sentence; the key's `// HANDLERS` example is the source form.
- proposed: The sentence and the block are unchanged but for the first label, which reads `// HANDLERS.` per C088.
- passage: Group registrations by domain under uppercase label comments
- passage: // HANDLERS.

### C088
- key: Match the surrounding file on whether a registration label comment ends in a period.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:366
- provenance: f8c0649 2026-06-10, an observation of the source library's own inconsistency carried into the reference; no incident installed it, and 830ff28 2026-06-17 later added style precedence to both style skills, which contradicts it.
- verdict: rewrite
- landed: 1dd5bee section 46
- reason: Safe because the doctrine's stay-in-scope rule already stops a session reformatting existing labels, so dropping the match-the-file licence changes only what a session writes new, and the period rule is the skill's own signature trait. Lands at landed line 341 (section 46's close) as 'Registration label comments end with a period, like every other label comment.', the parenthetical gone, and the registration block's first label at landed line 325 reads `// HANDLERS.`, recorded on C087 as the one line of that block this proposal changed; the paragraph-edit-unit read found no other carrier of the match-the-file claim (the phrase's other two occurrences, C066's and C068's lines, carry different claims and are unchanged).
- proposed: Replace the parenthetical at line 366 with one sentence: registration label comments end with a period like every other label comment; and make the `// HANDLERS` example at line 350 read `// HANDLERS.`.
- baseline-test: yes
- passage: Each label ends with a period, like every other label comment:

### C089
- key: Leave `RegisterServices.cs` as a block-scoped namespace file when editing it.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:368
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original), installed in the same commit as the §1 statement.
- verdict: retire
- landed: 1dd5bee section 46
- reason: Safe because C010 states the leave-existing-block-scoped-files-alone rule and already names `Assembly/RegisterServices.cs` as its example, so the file is covered without this line. Retired at section 46's close: the paragraph and one blank neighbour are gone from §11, which reads the fenced block, the C088 sentence and the IOptionsMonitor paragraph at landed lines 324 to 343; C010's rule at landed line 43 names the file.

### C090
- key: Inject `IOptionsMonitor<TSettings>` rather than `IOptions<T>` for settings, and read `.CurrentValue` at use time.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:370
- provenance: f8c0649 2026-06-10; the matching SKILL antipattern was relocated here from the doctrine by the doctrine-rightsizing plan, carrying its incident (an eager startup read bakes in defaults and bypasses test overrides).
- verdict: keep
- reason: The reference states the mechanic (which type, read where) and the SKILL states the failure it prevents; a session needs the type name from here.
- passage: For settings, inject `IOptionsMonitor<TSettings>`, not `IOptions<T>`, and read `.CurrentValue` at use time.

### C091
- key: Suffix types that perform core operations and orchestration with `Service`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:376
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; the suffix table is the naming contract the DI and folder rules assume.
- passage: Type suffixes: `Service` for core operations and orchestration

### C092
- key: Suffix MediatR notification handlers with `Handler`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:377
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; paired with the `Handlers/` folder rule.
- passage: `Handler` for MediatR notification handlers

### C093
- key: Suffix static utility method containers with `Helper`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:378
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; it is what keeps a static utility from being named `Service` and registered in DI.
- passage: `Helper` for static utility methods

### C094
- key: Suffix MediatR notifications with `Notification`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:379
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; part of the same suffix table.
- passage: `Notification` for MediatR notifications

### C095
- key: Use the `Repository` suffix only for older data-access objects.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:380
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding, and the legacy-only bound is the working part: it stops a session introducing a repository layer against the stored-procedure default.
- passage: and `Repository` only for legacy data-access objects.

### C096
- key: Prefix method names by verb: `Get*` to read or fetch, `Process*` to orchestrate a pipeline, `Create*` to build a new value, `Extract*` to pull data from a structure, `Build*` to construct a complex output, `Save*` or `Set*` to write or assign.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:382
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original).
- verdict: keep
- reason: No finding; the verb-to-role mapping is stated only here and is what makes method names predictable across files.
- passage: Method verb prefixes: `Get*` reads or fetches, `Process*` orchestrates a pipeline, `Create*` builds a new value, `Extract*` pulls data from a structure, `Build*` constructs a complex output, and `Save*` or `Set*` writes or assigns.

### C097
- key: Name interfaces with an `I` prefix matching the implementation, as `IDocumentService` to `DocumentService`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:390
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The reference states the naming rule the SKILL's example only demonstrates.
- passage: Interfaces take an `I` prefix matching the implementation.

### C098
- key: Keep MediatR notifications as simple data holders.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:394
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; it keeps behavior out of notifications and in handlers.
- passage: Notifications are simple data holders:
- flag: weak-reason

### C099
- key: Write a notification as a class implementing `INotification` with initialized auto-properties and a `CancellationToken` property, as `FileSaveNotification` shows.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:396
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: "Simple data holder" is obeyable only from the specimen: the initialized auto-properties, the `Caller` slot and the carried `CancellationToken` are what the phrase means here and the prose lists none of them.
- passage: public class FileSaveNotification : INotification

### C100
- key: Have handlers implement `INotificationHandler<T>`.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:406
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; the MediatR contract this style uses.
- passage: Handlers implement `INotificationHandler<T>`
- flag: weak-reason

### C101
- key: Put handlers in the `Handlers/` folder.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:406
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; the folder placement is stated only here.
- passage: live in `Handlers/`.

### C102
- key: Publish by awaiting `_mediator.Publish(...)` with the notification built inline as an object initializer across multiple lines.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:408
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; the multi-line publish shape is stated only here.
- passage: Publish with the notification built inline
- passage: await _mediator.Publish(

### C103
- key: Set `Caller = nameof(...)` on a published notification so handlers know who fired it.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:421
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; a convention handlers depend on at runtime, and nothing enforces it.
- passage: Set `Caller = nameof(...)` on it. Handlers read `Caller` to know who fired it:

### C104
- key: Put models under `Models/` organized by purpose: `Models/Database/`, `Models/Documents/`, `Models/Email/`, and `Models/Settings/`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:425
- provenance: 830ff28 2026-06-17 (em-dash replacement over the f8c0649 2026-06-10 original).
- verdict: keep
- reason: No finding; the folder taxonomy pairs with C007, since these folders generate no namespaces.
- passage: Models live under `Models/` by purpose: `Models/Database/` for DB-shaped data, `Models/Documents/` for domain documents and forms, `Models/Email/` for email shapes, and `Models/Settings/` for `IOptionsMonitor<T>` settings classes.

### C105
- key: Write settings classes as plain DTOs with `{ get; set; }` auto-properties.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:431
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; settable auto-properties are what `IOptionsMonitor` binding needs.
- passage: Settings classes are plain DTOs with `{ get; set; }` auto-properties

### C106
- key: Do not use records for settings classes.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:431
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; records are the modern default a generator reaches for, and they break options binding here.
- passage: never records.
- flag: weak-reason

### C107
- key: Use collection expressions for property init values where natural.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:433
- provenance: f8c0649 2026-06-10 for the property-init line; 058e3a3 2026-07-24 added the general collection-expression rule to §6 and the checklist.
- verdict: keep
- reason: §14 states the preference at the one site the general body rule does not obviously reach, a property declaration rather than a method body.
- passage: Property init values use collection expressions where natural:

### C108
- key: Initialize properties as `= []`, `= string.Empty`, and `= new()` on their declarations.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:434
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The four specimen properties are the only place the three init forms are matched to their property types; "where natural" alone does not say which a string or a class property takes.
- passage: public string FormCode { get; set; } = string.Empty;

### C109
- key: Indent with four spaces, never tabs.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:443
- provenance: f8c0649 2026-06-10.
- verdict: retire
- reason: row 616 (Whitespace basics), dropped under the mechanism cut.
- passage: Indent four spaces, never tabs.
- ruled: cut 2026-09-30

### C110
- key: Put one blank line between methods within a region.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:444
- provenance: f8c0649 2026-06-10.
- verdict: retire
- reason: row 616 (Whitespace basics), dropped under the mechanism cut.
- passage: Put one blank line between methods in a region
- ruled: cut 2026-09-30

### C111
- key: Put one blank line between regions, after `#endregion` and before the next `#region`.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:445
- provenance: f8c0649 2026-06-10.
- verdict: retire
- reason: row 616 (Whitespace basics), dropped under the mechanism cut.
- passage: and between regions.
- ruled: cut 2026-09-30

### C112
- key: Put one blank line between field groups, after the labeled comment's group finishes.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:446
- provenance: f8c0649 2026-06-10, installed in the same commit as the §3 statement; no commit narrates a separate reason for the §15 repeat.
- verdict: retire
- landed: 1dd5bee section 46
- reason: Safe because C027 states the blank line between groups in §3, where the grouping rule a session is applying already lives. Retired at section 46's close: the bullet is gone from §15, which closes on C111's bullet at landed line 418.

### C113
- key: Put one blank line between logical phases inside a method, right before each `// Section.` comment.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:447
- provenance: f8c0649 2026-06-10, installed in the same commit as the §6 statement; no commit narrates a separate reason for the §15 repeat.
- verdict: retire
- landed: 1dd5bee section 46
- reason: Safe because C046 states the same blank line with the same "preferred rather than absolute" bound in §6, beside the section-comment conventions. Retired at section 46's close: the bullet is gone from §15; C046's bullet at landed line 197 carries the convention with its 'preferred' bound.
- proposed: Drop the logical-phases bullet from §15; §6 keeps the blank-line convention with its "preferred" bound.
- proposed: Same removal as A125.
- baseline-test: yes

### C114
- key: Put no blank line between using statements.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:448
- provenance: f8c0649 2026-06-10, installed in the same commit as the §1 statement; no commit narrates a separate reason for the §15 repeat.
- verdict: retire
- landed: 1dd5bee section 46
- reason: Safe because C004 states the rule inside the using-order list, which is what a session reads while writing the using block. Retired at section 46's close: the bullet is gone from §15; C004's rule at landed line 35 is unchanged.

### C115
- key: Indent each parameter of a long parameter list eight spaces, with the closing `)` indented to the method signature column.
- class: mechanic
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:449
- provenance: f8c0649 2026-06-10, which over-generalized the constructor's eight-space indent to all parameter lists in the same commit that set methods at four.
- verdict: retire
- landed: 1dd5bee section 46
- reason: Safe and necessary: this line contradicts C039 and every method specimen in the document, so removing it leaves C031 owning constructors at eight spaces and C039 owning methods at four. Retired at section 46's close, where the ruling A061 on C039 lands: the bullet is gone from §15, C039's four-space rule at landed line 186 is unchanged, and the three surviving method specimens (landed lines 114, 221 and 451) sit at four.

### C116
- key: Use the full service skeleton when creating a brand-new service in `Services/Build/` or `Services/Process/`.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:453
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding; it is what makes the §16 template the greenfield path the SKILL points at when no sibling exists.
- passage: For a brand-new service in `Services/Build/` or `Services/Process/`, start from the section 2 skeleton.

### C117
- key: Build a new service as the `WidgetService` template shows: usings, file-scoped namespace, Variables, Constructor, a named processing region with validate/return-value/try/catch/return, and a Private Methods region.
- class: rationale-example
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:455
- provenance: f8c0649 2026-06-10.
- verdict: retire
- reason: row 617 (New service template) merge. The section 2 skeleton (C022, passage "Skeleton:") is the one canonical skeleton, and C116's landed sentence names it.
- passage: public class WidgetService : IWidgetService

### C118
- key: Register the new service in `Assembly/RegisterServices.cs` under the appropriate label comment.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:518
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: §16 is a procedure, and this is the step that keeps a new service from being written and never wired; §11 owns the registration form it points at.
- passage: Register it in `Assembly/RegisterServices.cs` under a label such as `// SERVICES.`.

### C119
- key: Declare the new service's interface in `Interfaces/I<Name>Service.cs`.
- class: rule
- source: plugins/grimoire/skills/csharp-style/references/csharp-style.md:526
- provenance: 7964c7e 2026-06-28 trimmed it to its current form when the XML-doc ban was withdrawn; the line itself dates from f8c0649 2026-06-10.
- verdict: keep
- reason: Seven words closing the §16 procedure; C012 owns the placement rule and this is the step that applies it, so removing it would end the walkthrough with the service unusable.
- passage: Declare its interface in `Interfaces/`.
