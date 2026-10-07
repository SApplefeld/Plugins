# Rationale ledger: sql-style

This file is the rationale ledger for the documents the `sql-style` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/sql-style/SKILL.md

This document is the operator's personal T-SQL house style: the deployment idioms, layout rules, comment conventions, antipatterns, and a completion checklist for SQL work, plus a procedure exemplar and a recipe for outlining a large SQL file. It owns the moments in which a session writes or modifies any SQL (stored procedures, tables, functions, indexes, install or deployment scripts, ad-hoc queries), the moment a session decides whether a repository's own contract overrides the house style, the moment a session opens a large SQL file to find one thing, and the moment a session declares SQL work complete. Its frontmatter says to use it whenever writing or modifying any SQL, even when style is not named, so the load class is `named-trigger`: it is loaded before the act of writing or changing SQL rather than at session start or at every plan run.

Extracted at `6bc07fb`: whole document (`skills.sql-style.SKILL.md`). Amended by `docs/plans/claude-kit_prose-register_spec_v1.md` section 4 on 2026-09-22 (`P` entries below). Redrafted on 2026-09-26 by section 9 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, landed at `0c092893` with its fix round at `5288cfb5`, so every live entry's `passage:` line quotes the text at `5288cfb5` and the `flag:` lines record that pass's flags.

### C001
- key: Load and apply this T-SQL style before writing or modifying any SQL of any kind.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:3
- provenance: f8c0649 2026-06-10, the kit's initial consolidation of the operator's house style from prior artifacts; re-quoted at 830ff28 with the CATCH trait corrected and de-named at a8770b3, neither an incident.
- verdict: keep
- reason: The description is the harness's skill-selection text, so the object-kind enumeration and trait list are what make the skill fire on SQL work with style unnamed; shortening it changes load behaviour, not prose.
- passage: description: "The operator's T-SQL house style. Use whenever writing or modifying ANY SQL: stored procedures, tables, functions, indexes, install or deployment scripts, or ad-hoc queries. Signature traits: shell-then-ALTER deployment, banner-comment headers, leading commas, tab-aligned columns, leading semicolons, audit-logging CATCH blocks that do not re-throw. Trigger on any SQL work even when style is not named."

### C002
- key: Read references/sql-style.md for the detailed pattern reference before writing SQL code.
- class: pointer
- source: plugins/grimoire/skills/sql-style/SKILL.md:8
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: No finding. This sentence is what makes SKILL.md the summary layer and the reference the detail layer of one owner, which every overlap ruling in this unit rests on.
- passage: Read [references/sql-style.md](references/sql-style.md), the detailed pattern reference, before writing code.

### C003
- key: Deploy stored procedures with the shell-then-ALTER idiom.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:12
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: The philosophy point, the antipattern (C028) and the checklist (C042) are one rule at three moments, and no hook or lint enforces SQL style, so the repetition is the enforcement; the GRANT reason stays because `CREATE OR ALTER` is valid SQL a model defaults to.
- passage: Procedures use shell-then-ALTER, which preserves GRANTs, never `CREATE OR ALTER PROCEDURE`.

### C004
- key: Deploy functions by dropping and recreating them.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:12
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: Same three-moment structure as C003; reference §3 is the same owner's detail layer.
- passage: Functions are dropped and recreated.

### C005
- key: Guard table and index creation with IF NOT EXISTS.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:12
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: Same three-moment structure as C003; reference §4 and §5 fix the catalog views and placement, which is detail-layer content.
- passage: Tables and indexes guard with IF NOT EXISTS.

### C006
- key: Write every deployment script so it is idempotent and never breaks on re-execution.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:12
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: The C# skill's idempotence rule is about C# code; each style skill owns its own language under the ownership map and a cross-language pointer sends the reader to the wrong document.
- passage: **Idempotent deployment.**
- passage: A script never breaks on re-execution.

### C007
- key: Tab-align related values so names align, then types align, then defaults align.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:13
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: The reference's four restatements are per-construct templates of the same owner; "Non-negotiable" is emphasis that holds under pressure and no incident says it misfired.
- passage: **Tab alignment.** In parameter, DECLARE, column and SET lists, names align, then types, then defaults. Non-negotiable.

### C008
- key: Start each continuation line of a list with a leading comma so items line up.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:14
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: Antipattern (C029) and checklist (C048) are the same rule at the writing and completion moments; the reference §12 enumeration is the detail layer.
- passage: A comma starts each continuation line. The items then line up.

### C009
- key: Begin statements with a leading semicolon.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:14
- provenance: f8c0649 2026-06-10, the initial consolidation; ddd6c72 2026-08-23 cited this sentence's terminator reason as evidence the skill owns the idiom.
- verdict: keep
- reason: This is the general rule with its reason; the reference's four mentions are template annotations. The reason clause is referenced by the Outlining section at :73 and by the outline-first consult, so it is load-bearing beyond this line.
- passage: Statements lead with `;`. That guards against a missing terminator in the previous batch.
- flag: stale

### C010
- key: Divide every procedure into named phases using section banners rather than inline narration.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:15
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: Reference §10 is the same owner's detail layer carrying the phase order.
- passage: **Banners over narration.** `/********** TITLE **********/` banners divide every procedure into named phases.

### C011
- key: Write section banners in the form `/********** TITLE **********/`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/SKILL.md:15
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: The form is the skill's shorthand name for the banner style, used the same way in reference §17; the literal 92-character multi-line block is in this file's exemplar at :46-48 and in §10, so the contention with §10 is not real.
- passage: `/********** TITLE **********/` banners divide every procedure into named phases.

### C012
- key: When unsure, find an existing procedure or table of similar shape and copy its layout exactly.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:16
- provenance: f8c0649 2026-06-10 for the rule; 830ff28 2026-06-17 added the foreign-repo bound in the Precedence section, ported from a peer fork.
- verdict: keep
- reason: Each style skill owns the sibling rule for its language; the SKILL carries the foreign-repo carve-out and the reference's narrower in-library mentions are consistent with it.
- passage: **Mimic a sibling.** When unsure, copy a similar procedure or table's layout, or in a greenfield repo the exemplar below and the reference's templates.

### C013
- key: In a greenfield repository, follow the exemplar in this skill and the full templates in the reference.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:16
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: Each skill sends the reader to its own exemplar; a pointer to the C# skill points at the wrong language.
- passage: **Mimic a sibling.** When unsure, copy a similar procedure or table's layout, or in a greenfield repo the exemplar below and the reference's templates.

### C014
- key: Let a repository's mechanically-enforced contract override this style.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:20
- provenance: 830ff28 2026-06-17, the style-precedence rule installed in the doctrine and both style skills in one change, ported from a peer fork; the live incident class is kaizen/archive/2026-07-30-reviewer-style-skill-paths.md, a reviewer that judged by repo convention.
- verdict: keep
- reason: The ownership map makes the style skills the owners and the doctrine's Defaults bullet the pointer, and the copy here is the one a subagent reads because subagents do not inherit the doctrine. The third sentence bounds the sibling rule against the legacy-sibling reading and stays.
- passage: The doctrine's Defaults rule governs.
- passage: A messy legacy sibling in a foreign repo is no reason to drop the style.

### C015
- key: Treat this style as the default authority where no mechanically-enforced contract exists.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:20
- provenance: 830ff28 2026-06-17, as C014.
- verdict: retire
- reason: merged under row 1146 into the doctrine's Defaults bullet "My house style is the default authority. It beats sibling code and implicit local convention.", which C014's pointer sentence now names.
- passage: Otherwise this style is the default authority.

### C016
- key: Substitute the project's own schema and error-logging procedure for the exemplar's placeholders.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:24
- provenance: 830ff28 2026-06-17, written when a concrete client schema was replaced with placeholders in the same change.
- verdict: keep
- reason: Naming `<schema>`, `<schema_owner>` and `usp_AuditError` as placeholders is what stops them being copied as names; the reference's equivalent sentence covers its own examples, not this file's exemplar.
- passage: `<schema>`, `<schema_owner>` and `usp_AuditError` are placeholders for the project's own schema, owner and error-logging proc.

### C017
- key: Apply `WITH EXECUTE AS` only where the project uses owner-impersonation, and drop it where it does not.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:24
- provenance: 830ff28 2026-06-17; ce7b530 2026-06-28 is the incident, a reference that framed impersonation as universal and was aligned to this sentence.
- verdict: keep
- reason: This sentence conditions the `WITH EXECUTE AS` line in the exemplar it precedes; without it the exemplar reads as universal, which is exactly the defect ce7b530 repaired in the reference. The checklist (C043) gates the same rule at completion with the inline-TVF exclusion.
- passage: Keep `WITH EXECUTE AS` only where the project uses owner-impersonation.

### C018
- key: When opening a SQL file past roughly 1,000 lines to find one thing, grep the definitions first with line numbers.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:69
- provenance: ddd6c72 2026-08-23, the outline-first section of docs/archive/claude-kit_process-rule-repairs_spec_v1.md, after a consult ruled language anchors cannot live in the language-agnostic doctrine.
- verdict: keep
- reason: The doctrine owns the principle and this skill owns the recipe (ownership map row 44); this sentence is the recipe's condition, not a restatement of the principle, and test/doctrine-parity.test.js pins both ends of the chain.
- passage: In a SQL file past roughly 1,000 lines opened to find one thing, grep the definitions first, with line numbers, using this pattern as written:

### C019
- key: Use the pattern `^\s*;?\s*(CREATE|ALTER)(\s+OR\s+ALTER)?(\s+(UNIQUE|CLUSTERED|NONCLUSTERED|SPATIAL|COLUMNSTORE|FULLTEXT|XML))*\s+(PROCEDURE|TABLE|VIEW|FUNCTION|INDEX|TRIGGER|SCHEMA|TYPE)\b` to take definitions.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/SKILL.md:71
- provenance: ddd6c72 2026-08-23, each piece run against a real deployment corpus before landing; the earlier draft's simpler patterns were falsified in review.
- verdict: keep
- reason: No finding on the pattern itself. Every piece is load-bearing, and this entry is where the why now lives: the leading `;?` is needed because this style writes `;ALTER PROCEDURE` and a line-start anchor on the verb misses the defining line; the optional modifier group is needed because T-SQL writes `CREATE NONCLUSTERED INDEX`, and without it 843 of the 5,332 definitions on the measured corpus are silently dropped while `INDEX` still appears in the keyword list; the required object keyword is what keeps banner prose such as `CREATE TRANSACTION FOR PROCESSING.` out; the pattern is case-sensitive, costing 9 of 5,332 on that corpus, which only matters on a vendor script (C026); and `LOGIN`, `ROLE`, `SEQUENCE` and `SYNONYM` are outside the keyword list by design (C027).
- passage: ^\s*;?\s*(CREATE|ALTER)(\s+OR\s+ALTER)?(\s+(UNIQUE|CLUSTERED|NONCLUSTERED|SPATIAL|COLUMNSTORE|FULLTEXT|XML))*\s+(PROCEDURE|TABLE|VIEW|FUNCTION|INDEX|TRIGGER|SCHEMA|TYPE)\b
- passage: using this pattern as written:

### C020
- key: Keep every piece of the definitions pattern, since the optional `;?`, the modifier group, and the required object keyword each cover a case a simpler pattern misses.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/SKILL.md:73
- provenance: ddd6c72 2026-08-23, a deliberate decision to ship each piece with what breaks without it; c6f08c5 2026-08-23 corrected the figures in review.
- verdict: retire
- landed: e6f408d section 38
- reason: The pattern is obeyed by using it as written, so the per-piece justifications and the 843-of-5,332 measurement are rationale that now lives in the C019 entry above; the change is safe because nothing a session does differs once the pattern is copied verbatim, and the C055 read-past instruction survives as a clause. Retired at section 38's close: the per-piece justifications and the 843-of-5,332 measurement are gone from line 73, which lands as "Every piece of that shape is load-bearing, so use the pattern as written." with C055's instruction as its own second sentence rather than a clause, the two-sentence form taken on the writing-skills one-idea bar where one sentence packed two ideas.
- proposed: Replace the paragraph at :73 with one sentence saying every piece of the pattern is load-bearing and it is used as written, keeping the C055 read-past instruction as a clause (A092); the per-piece justifications and the measurement live in the ledger.
- baseline-test: yes

### C021
- key: Take the banner grep second, after the definitions grep.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:75
- provenance: ddd6c72 2026-08-23 installed the paragraph; c6f08c5 2026-08-23 repaired the ordering clause after review found it attributed a saving to ordering that ordering does not produce.
- verdict: rewrite
- landed: e6f408d section 38
- reason: The rule and every sibling instruction in the paragraph survive, C025's and C026's with their antecedents respelled; the rewrite removes only the two standalone rationale sentences retired under C024 and C056. The why for ordering, now here: on a 70,966-line vendor install script the banner grep returns 6,710 output lines where the definitions grep returns 820, and that volume is the price of true line numbers; taken second, only the banner hits near ranges already held are read. Lands at line 75 (section 38's close) with this sentence word for word, the measurement sentence (C024) and the dash-rule sentence (C056) gone, and C025's and C026's sentences respelled for the antecedents those retires took.
- proposed: Rewrite the paragraph at :75 keeping C021, C022, C023, C025, C026 and C027 verbatim with their bounds, and dropping the 6,710/70,966/820 measurement sentence and the dash-rule sentence, whose why now lives in the ledger.
- baseline-test: yes
- passage: Take banners second with `grep -n -A 1 -E '^\s*/\*{3,}'`

### C022
- key: Read past banner hits outside the ranges the definitions grep narrowed to instead of scoping the grep.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:75
- provenance: ddd6c72 2026-08-23, as C021.
- verdict: keep
- reason: The sentence survives verbatim in the C021 rewrite; its one-clause reason (range-restricting grep forms renumber their output) is the bound that stops a session scoping the grep under context pressure.
- passage: Read past hits outside the definitions' ranges rather than scoping the grep, since range-restricting forms renumber lines.

### C023
- key: Take banners with `grep -n -A 1 -E '^\s*/\*{3,}'`, where `-A 1` supplies the label line.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/SKILL.md:75
- provenance: ddd6c72 2026-08-23, run against a real vendor script before landing.
- verdict: keep
- reason: No finding on the mechanic itself; it survives verbatim in the C021 rewrite. The why, now here: the pattern anchors on the block-comment border alone because a dash rule is comment decoration in this style rather than section structure (C056), the border line carries no text so `-A 1` is what yields the label, a doubled border yields its second line as the label, and `GO` is never anchored on because it carries no structure and the measured script holds 936 of them (C025).
- passage: Take banners second with `grep -n -A 1 -E '^\s*/\*{3,}'`, where a doubled border's second line is the label.

### C024
- key: Accept the banner grep's volume as the price of true line numbers, which is why it runs second.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/SKILL.md:75
- provenance: ddd6c72 2026-08-23; the clause was repaired at c6f08c5 2026-08-23 after review caught a false attribution.
- verdict: retire
- landed: e6f408d section 38
- reason: The ordering rule (C021) is obeyed without the measurement, and the figures already drifted once in review, which a ledger record does not suffer; the 6,710 / 70,966 / 820 measurement is recorded under C021. Retired at section 38's close: the measurement sentence is gone from line 75, and its "a 70,966-line vendor install script" was the antecedent of C025's "that one install script", which respells to "one vendor install script".
- proposed: Drop the measurement sentence from :75 as part of A047; the ledger entry for C021 records the figures.
- baseline-test: yes

### C025
- key: Never anchor an outline grep on `GO`.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:75
- provenance: ddd6c72 2026-08-23, as C021.
- verdict: rewrite
- landed: e6f408d section 38
- reason: Survives in the C021 rewrite with its figure as the bound and its antecedent respelled; a `GO` anchor is the obvious wrong move on a T-SQL install script and the rule is what forecloses it. Respelled at section 38's close by C024's retire, which took the install script its "that one" pointed at; lands at line 75 as "Do not anchor on `GO` at all: it carries no structure, and one vendor install script holds 936 of them.", the rule and the figure unchanged.
- proposed: Do not anchor on `GO` at all: it carries no structure, and one vendor install script holds 936 of them.
- passage: Never anchor on `GO`, which carries no structure.

### C026
- key: Add `-i` to the definitions grep when reading a vendor script.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:75
- provenance: ddd6c72 2026-08-23, as C021.
- verdict: rewrite
- landed: e6f408d section 38
- reason: Survives in the C021 rewrite with its antecedent respelled; the case-sensitivity cost (9 of 5,332) is the bound that tells a session when the flag matters. Respelled at section 38's close by C020's retire on line 73, which took the deployment corpus its "that corpus" pointed at; lands at line 75 as "The pattern is case-sensitive where T-SQL is not, which costs 9 definitions out of 5,332 on one deployment corpus and matters only in a file this style did not write, so add `-i` when you are reading a vendor script.", the bound unchanged.
- proposed: The pattern is case-sensitive where T-SQL is not, which costs 9 definitions out of 5,332 on one deployment corpus and matters only in a file this style did not write, so add `-i` when you are reading a vendor script.
- passage: Add `-i` for a vendor script, since the definitions pattern is case-sensitive.

### C027
- key: Find `LOGIN`, `ROLE`, `SEQUENCE`, and `SYNONYM` objects by name rather than through the definitions pattern.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:75
- provenance: ddd6c72 2026-08-23, as C021.
- verdict: keep
- reason: Survives verbatim in the C021 rewrite; it names the pattern's deliberate exclusions so a session does not widen the keyword list.
- passage: Find `LOGIN`, `ROLE`, `SEQUENCE` and `SYNONYM` by name.

### C028
- key: Never use `CREATE OR ALTER PROCEDURE`; use shell-then-ALTER.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:79
- provenance: f8c0649 2026-06-10, the initial consolidation; 830ff28 only replaced the em dash.
- verdict: retire
- reason: row 1141 shrink. This is the same rule as C003. C003's landed sentence "Procedures use shell-then-ALTER, which preserves GRANTs, never `CREATE OR ALTER PROCEDURE`." now carries the named default.
- passage: ❌ `CREATE OR ALTER PROCEDURE` - shell-then-ALTER, which preserves GRANTs

### C029
- key: Never use trailing commas in any list.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:80
- provenance: f8c0649 2026-06-10, the initial consolidation; 830ff28 only replaced the em dash.
- verdict: retire
- reason: the ledger rules it with C008 as one rule. C008's "A comma starts each continuation line." carries it.
- passage: ❌ Trailing commas in any list - leading commas

### C030
- key: Write SQL keywords in uppercase.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:81
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: No finding.
- passage: ❌ Lowercase keywords - UPPERCASE
- flag: weak-reason

### C031
- key: Bracket every column name as `[ColumnName]`.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:82
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: Reference §12 is the same owner's detail layer with the even-when-unnecessary bound and reason.
- passage: ❌ Unbracketed columns - `[ColumnName]`

### C032
- key: Handle routine errors by calling the project's error-logging proc in CATCH, guarded by an OBJECT_ID check, rather than RAISERROR.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:83
- provenance: f8c0649 2026-06-10, the initial consolidation; 830ff28 genericized the proc name.
- verdict: keep
- reason: Names `RAISERROR`, the default a model writes, at the writing moment; the checklist (C052) gates the CATCH shape at completion and §11 owns the predicate and the THROW exception.
- passage: - ❌ `RAISERROR` for routine errors - `EXECUTE <schema>.usp_AuditError @p_ErrorData = ...` in CATCH, guarded by an OBJECT_ID check

### C033
- key: Never build dynamic SQL by string concatenation.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:84
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: No finding; the privilege-escalation bound is what lifts this out of style into security inside a `WITH EXECUTE AS` procedure.
- passage: ❌ Dynamic SQL built by string concatenation - a privilege-escalation vector inside a `WITH EXECUTE AS` procedure.
- flag: weak-reason

### C034
- key: Where dynamic SQL is truly unavoidable, use `sp_executesql` with typed parameters and a justifying comment.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:84
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: No finding; the carve-out of C033.
- passage: Where unavoidable, use `sp_executesql` with typed parameters and a justifying comment

### C035
- key: Put `;SET NOCOUNT ON` and `;SET TRANSACTION ISOLATION LEVEL` together at the top of the procedure.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:85
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: Names the omission at the writing moment; the checklist (C046) fixes the level per procedure kind at completion and §8 is the detail layer.
- passage: - ❌ Skipping `;SET NOCOUNT ON` + `;SET TRANSACTION ISOLATION LEVEL` - both required, paired, at the top: `READ UNCOMMITTED` for Get*, `READ COMMITTED` for writes

### C036
- key: Use a banner block carrying SCRIPT, AUTHOR, DATE, VERSION, and NOTES only, never verbose multi-paragraph header comments.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:86
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: retire
- reason: row 1144 shrink. The header field list was stated three times. C044's line "Banner header: SCRIPT / AUTHOR / DATE (ordinal English) / VERSION / NOTES only, ..." carries the "only" bound.
- passage: ❌ Verbose multi-paragraph header comments - banner blocks with SCRIPT/AUTHOR/DATE/VERSION/NOTES only

### C037
- key: Never write change-narrative comments; state what the code does now, not the session, the change, or the prior version.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:87
- provenance: cabbf89 2026-06-28, the doc-closeout-discipline plan (docs/archive/claude-kit_doc-closeout-discipline_spec_v1.md), which specified a one-line cross-reference to the doctrine's current-state rule in both style skills because implementers read the style skills and not the doctrine; baseline-tested under mimicry and deferral pressure.
- verdict: keep
- reason: The line already names the doctrine as owner, which is the pointer form, and its specimen phrases are the recognizable habit; compressing baseline-tested wording with no incident behind the compression is a re-baseline for nothing.
- passage: - ❌ Change-narrative comments - per the doctrine's current-state rule.

### C038
- key: Write sentence-style comments as short imperative statements of what the next block does, never history, decision narrative, or rationale essays.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:87
- provenance: 058e3a3 2026-07-24, six deltas distilled from the operator's hand-edit review of Claude-authored code; reference §17 set as owner, §10 pointing, this antipattern line extended in the same change.
- verdict: keep
- reason: The copy at the writing moment was the install decision, and the line names the SQL comment forms the C# skill does not govern.
- passage: Sentence-style comments (`/* Sub-Section Title. */`, `-- Comment.`) state only what the next block does.

### C039
- key: Use `SYSDATETIMEOFFSET()` rather than `GETDATE()` for audit timestamps.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:88
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: Reference §15 is the same owner's detail layer with the acceptable-`GETDATE()` case.
- passage: ❌ `GETDATE()` for audit timestamps - `SYSDATETIMEOFFSET()`

### C040
- key: Write SELECT aliases in the left-hand form `[Alias] = expression`, never `expr AS Alias`.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:89
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: Reference §13 is the same owner's detail layer.
- passage: ❌ Right-hand aliases (`expr AS Alias`) in SELECT - left-hand form: `[Alias] = expression`

### C041
- key: Never use `SELECT *` in result sets returned to callers.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:90
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: retire
- reason: row 1156 (No SELECT star to callers), dropped under the mechanism cut.
- passage: ❌ `SELECT *` in result sets returned to callers
- ruled: cut 2026-09-30

### C042
- key: Before declaring SQL work complete, verify procs use shell-then-ALTER, functions drop-and-recreate, and tables and indexes carry IF NOT EXISTS guards.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:94
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: retire
- reason: row 1141 shrink. This is the same rule as C003, C004 and C005, and Core Philosophy point 1 carries it whole.
- passage: - [ ] Procs shell-then-ALTER, functions drop-and-recreate, tables and indexes IF NOT EXISTS

### C043
- key: Put `WITH EXECUTE AS '<schema_owner>'` on procs and scalar or multi-statement functions where the codebase impersonates.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:95
- provenance: ce7b530 2026-06-28, SQL Server rejecting `WITH EXECUTE AS` on inline TVFs so two reference templates would not deploy; the checklist line gained the exclusion and the drop case.
- verdict: keep
- reason: The exclusion is a deployment-failure class, not style, and this line is where the completion gate catches it; the reference agrees by repair.
- passage: - [ ] `WITH EXECUTE AS '<schema_owner>'` on procs and scalar or multi-statement functions where the codebase impersonates, never on inline TVFs

### C044
- key: Write the banner header as SCRIPT / AUTHOR / DATE in ordinal English / VERSION / NOTES, and add a note line for a new version rather than rewriting history.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/SKILL.md:96
- provenance: f8c0649 2026-06-10, the initial consolidation; cabbf89 2026-06-28 installed the change-narrative antipattern into this file and left this line standing.
- verdict: keep
- reason: The contention with the doctrine's current-state rule is not real: that rule exempts append-only history in terms and a banner's NOTES block is a changelog. Reference §6 is the same owner's detail layer.
- passage: - [ ] Banner header: SCRIPT / AUTHOR / DATE (ordinal English) / VERSION / NOTES only, a new version adding a note line rather than rewriting history

### C045
- key: Write `BEGIN` after `AS` followed by a tab and the trailing label `-- PROCEDURE`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/SKILL.md:97
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: Reference §2 is the same owner's detail layer.
- passage: - [ ] `BEGIN	-- PROCEDURE` with tab + trailing label after `AS`

### C046
- key: Pair `;SET NOCOUNT ON` with `READ UNCOMMITTED` for Get* procedures and `READ COMMITTED` for writes.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/SKILL.md:98
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: retire
- reason: the ledger rules it with C035 as one rule. C035's landed line now carries the isolation level for each kind of procedure.
- passage: - [ ] `;SET NOCOUNT ON` paired with an isolation level: `READ UNCOMMITTED` for Get*, `READ COMMITTED` for writes

### C047
- key: Prefix parameters with `@p_`, name locals plain `@PascalCase`, and declare an `@True`/`@False` BIT pair when conditionals exist.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/SKILL.md:99
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: Reference §7, §9 and §18 are the same owner's detail layer; that the reference states each naming rule twice is the reference's concern, not this line's.
- passage: - [ ] `@p_` parameters, plain `@PascalCase` locals, an `@True`/`@False` BIT pair where conditionals exist

### C048
- key: Use leading commas with tab alignment in every multi-line list and give the first item a leading space.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:100
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: The completion gate for the layout rules; ruled with C008.
- passage: - [ ] First item of every multi-line list with a leading space

### C049
- key: End `/* Sub-Section. */` comments with a period and leave group labels without one.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/SKILL.md:101
- provenance: f8c0649 2026-06-10, the initial consolidation; 058e3a3 2026-07-24 set reference §17 as the owner of the sentence-versus-label convention.
- verdict: keep
- reason: The completion gate for the punctuation convention; §17 is the same owner's detail layer.
- passage: `/* Sub-Section. */` comments ending in a period, group labels without one

### C050
- key: Lay out tables with `/* Group Name */` column groups, audit fields (CreatedDt/UpdatedDt with SYSDATETIMEOFFSET defaults) at the bottom, and `PK_<Table>` last.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/SKILL.md:102
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: Reference §4 and §18 are the same owner's detail layer.
- passage: - [ ] Tables: `/* Group Name */` column groups, audit fields (CreatedDt/UpdatedDt, SYSDATETIMEOFFSET defaults) at the bottom, `PK_<Table>` last

### C051
- key: Name indexes `IX_<Table>_<Cols>`, give each its own IF NOT EXISTS block, and put it in the table's file.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/SKILL.md:103
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: Reference §5 and §18 are the same owner's detail layer.
- passage: - [ ] Indexes: `IX_<Table>_<Cols>`, own IF NOT EXISTS block, in the table's file

### C052
- key: Wrap main logic in TRY/CATCH where CATCH audits via the project's error-logging proc and does not re-throw.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:104
- provenance: adf3d51 2026-07-24, a kit-wide consistency audit that found this line unconditional while §11 sanctioned a nested THROW; the carve-out and §11 pointer were added with the reference staying owner.
- verdict: keep
- reason: The line already points at §11 for the exception and was repaired to agree with it; the completion gate is where an unconditional no-re-throw would otherwise be enforced wrongly.
- passage: - [ ] TRY/CATCH around main logic, re-throwing only from a nested CATCH whose error must propagate (reference §11)

### C053
- key: End every SQL file with `GO`.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:105
- provenance: f8c0649 2026-06-10, the initial consolidation; no incident narrative.
- verdict: keep
- reason: Reference §2 is the same owner's detail layer.
- passage: - [ ] File ends with `GO`

### C054
- key: For the exact banner header format, go read reference §6.
- class: pointer
- source: plugins/grimoire/skills/sql-style/SKILL.md:44
- provenance: f8c0649 2026-06-10, the initial consolidation; 830ff28 only replaced the em dash.
- verdict: keep
- reason: No finding; the exemplar's stand-in comment is already the pointer form.
- passage: /* Banner header: SCRIPT / AUTHOR / DATE / VERSION / NOTES - see reference §6. */

### C055
- key: When a banner sentence happens to open with a real object keyword and false-matches the definitions grep, read past it rather than trying to filter it out.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/SKILL.md:73
- provenance: ddd6c72 2026-08-23, as C019.
- verdict: rewrite
- landed: e6f408d section 38
- reason: The instruction (read past, never filter) is a rule a session obeys and survives as one clause beside the pattern; the surrounding justification of the object-keyword requirement is rationale recorded under C019. Safe because the obeyed instruction is unchanged in substance. Lands at line 73 (section 38's close) as its own sentence, "A banner sentence opening with a real object keyword still matches and is read past rather than filtered.", beside C020's replacement sentence rather than as a clause of it.
- proposed: Keep "a banner sentence opening with a real object keyword still matches and is read past rather than filtered" as a clause in the one-sentence replacement for :73; drop the surrounding justification.
- baseline-test: yes
- passage: A banner sentence opening with an object keyword still matches and is read past rather than filtered.

### C056
- key: Do not expect or search for dash-rule comments as section banners; only the block-comment border marks section structure.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/SKILL.md:75
- provenance: ddd6c72 2026-08-23, as C021.
- verdict: retire
- landed: e6f408d section 38
- reason: The banner pattern (C023) is obeyed as written and this sentence explains what its anchor excludes; that why is recorded under C023, so nothing a session does changes when the sentence leaves the document. Retired at section 38's close: the dash-rule sentence is gone from line 75.
- proposed: Drop the dash-rule sentence from :75 as part of A047; the ledger entry for C023 records why the pattern anchors on the block-comment border alone.
- baseline-test: yes

### P001
- key: Write a section comment as the rule alone in the sentence-style forms, and let the rare WHY comment follow the rule with its reason as its own sentence and at most one case.
- class: rule
- source: plugins/grimoire/skills/sql-style/SKILL.md:87
- provenance: docs/plans/claude-kit_prose-register_spec_v1.md section 4, which made the register govern every piece written for a reader and pointed each style skill's comment rules at it.
- verdict: keep
- reason: C038 fixes what a sentence-style comment says and this fixes the order it says it in, which no rule in this skill stated. The doctrine owns the register, so the pointer form keeps this skill from becoming a second owner of a rule that governs every piece. Banners and group labels stay outside it as titles, which the line's closing clause already says.
- passage: A rare WHY comment follows the doctrine's prose register. Banners and group labels are titles

## plugins/grimoire/skills/sql-style/references/sql-style.md

This document is the detailed pattern reference for the operator's T-SQL house style, modeled on a numbered-folder, procedure-only deployment database library. It owns the moments in which a session writes or modifies any SQL: folder placement and file naming, the shell-then-ALTER procedure deployment idiom, drop-and-recreate function deployment, defensive table and index existence checks, the procedure header banner, parameter and variable declarations, SET statements, in-body section banners, TRY/CATCH with non-rethrowing audit logging, leading-comma and tab alignment, SELECT/INSERT/UPDATE layout, JOIN and CTE form, preferred string, date and null functions, temp tables, comment voice and punctuation, naming conventions, and the full procedure, table and function skeletons. A session loads it as a `named-trigger` (inferred) reference: it is pulled in before writing or modifying SQL of any kind, when the governing style skill directs a session to the detailed patterns, and its opening line names it as the pattern reference rather than an always-on or plan-scoped surface.

Extracted at `6bc07fb`: whole document (`skills.sql-style.references.sql-style.md`). Redrafted on 2026-09-26 by section 11 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, landed at `18997a84` with its fix round at `bac21117`, so every live entry's `passage:` line quotes the text at `bac21117`.

### C001
- key: Substitute the project's own schema and procedure names for the example names rather than copying them literally.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:3
- provenance: 830ff28 2026-06-17, installed when the reference's one-project names (ELEOS) were genericized for team sharing ("genericize ELEOS/TMWSuite operational refs, patterns kept"); a8770b3 2026-06-28 replaced the remaining names with placeholders.
- verdict: keep
- reason: The sentence names the three identifiers a session must not copy; without it the placeholders read as the rule. Parallel lines in the SKILL exemplar and the C# reference name their own placeholders and are not duplicates.
- passage: `<schema>`, `usp_AuditError` and `WITH EXECUTE AS '<schema_owner>'` are one project's names, so substitute the project's own names rather than copying them.

### C002
- key: Inside a repository holding such a script library, open a sibling file in that library and follow its layout exactly.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:3
- provenance: f8c0649 2026-06-10 (INIT, "When in doubt, open a sibling file"); 830ff28 2026-06-17 added the repo-kind bound alongside the style-precedence rule in the SKILL.
- verdict: keep
- reason: The SKILL owns the mimic rule with its Precedence bound (SKILL.md:16, :20); this clause is the bounded restatement at the head of the reference and is no longer than a pointer. The unbounded copy at line 689 (C170) is what retires.
- passage: Inside such a repo, open a sibling file in that library and follow its layout exactly.

### C003
- key: Place each object in its numeric-prefixed folder: 0-Client, 3-Tables, 4-Functions, 5-Procedures, 9-System, Database.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:33
- provenance: f8c0649 2026-06-10, consolidated at kit initialization from the operator's deployment library.
- verdict: keep
- reason: No finding. The folder set is the library's layout and no machinery enforces it.
- passage: The library uses numeric prefixes to enforce execution order during deployment:
- passage: | `9-System` | System / TMS-specific procedures |
- passage: | `Database` | Bootstrap install scripts (a vendor database, LoadMaster, TL2000) |
- flag: environment

### C004
- key: Leave folder numbers 1, 2, 6, 7 and 8 unused and reserved for future categories.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:44
- provenance: f8c0649 2026-06-10 (830ff28 only replaced an em dash).
- verdict: keep
- reason: No finding.
- passage: Folder gaps (1, 2, 6, 7, 8) are reserved for potential future categories - leave them open.
- flag: environment

### C005
- key: Name each file `<schema>.<object>.sql`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:46
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Files are named `<schema>.<object>.sql`

### C006
- key: Omit the object-type prefix from table file names.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:49
- provenance: f8c0649 2026-06-10 (a8770b3 only replaced the schema name with a placeholder).
- verdict: keep
- reason: No finding.
- passage: table files omit the type prefix: `<schema>.usp_GetBackgroundMessages.sql` beside `<schema>.ApiCalls.sql`.

### C007
- key: Name variant procedures with the suffixes `_Default`, `_Maintenance`, `_Trailers`, `_TMS`, `_Debug` or `_Custom_*`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:51
- provenance: f8c0649 2026-06-10; both copies came in together, no incident behind the duplicate.
- verdict: retire
- landed: b17bc06 section 45
- reason: §18's suffix list (lines 517 to 522) carries every suffix with its meaning and folder; line 51's list is a strict subset. Safe because the owner keeps the whole and line 51's second sentence (helper suffixes, C008) stays. Retired at section 45's close: the suffix list is gone from line 51, which opens '§18 carries the variant procedure suffixes.' before C008's sentence, unchanged.
- proposed: (via A007) Drop the first sentence of line 51 and keep the helper sub-procedure sentence (C008), which §18 does not carry; point at §18 for variant suffixes.
- baseline-test: yes

### C008
- key: Name helper sub-procedures of a parent with the suffixes `_Data`, `_Sort`, `_Stops` or `_Trips`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:51
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding. §18 does not carry the helper suffixes, so this sentence is their only statement.
- passage: Helper sub-procedures of a parent use `_Data`, `_Sort`, `_Stops`, `_Trips`.
- flag: environment

### C009
- key: Always deploy a procedure by creating a shell if none exists and then ALTERing it; never use `CREATE OR ALTER PROCEDURE`.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:55
- provenance: f8c0649 2026-06-10 (830ff28 only replaced an em dash).
- verdict: keep
- reason: The idiom is the style's first signature trait and a model's default (CREATE OR ALTER) is the banned form; no hook or lint enforces it. The reference states it whole; the SKILL summarizes.
- passage: **Always shell-then-ALTER**, never `CREATE OR ALTER PROCEDURE`, as the §19 template shows.

### C010
- key: Use shell-then-ALTER because it preserves existing GRANTs and permissions across deployments.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:55
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: The why: CREATE OR ALTER re-creates the object's metadata on a drop path in some tooling and a DROP/CREATE loses GRANTs, while ALTER on an existing shell keeps every permission granted to the procedure across redeployment. The SKILL still carries "preserves GRANTs" at SKILL.md:12 and :79, so nothing leaves the corpus. Retired at section 45's close: the third sentence is gone from line 55, which closes on C009's two sentences unchanged; the SKILL cite above read :80 and reads :79 after section 38's rewrite, corrected in place.
- proposed: Drop the third sentence of line 55; the reason lives in this ledger under C010 and in the SKILL.
- baseline-test: yes

### C011
- key: Follow the shown shell-then-ALTER block: an `;IF OBJECT_ID(...) IS NULL` shell EXEC, `GO`, then `;ALTER PROCEDURE`, `WITH EXECUTE AS`, `AS`, `BEGIN`, `END`, `GO`.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:59
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: The §19 template at lines 528 to 588 carries the identical shape, so the §2 block is a duplicate specimen; the §2 key details read against §19 unchanged. Retired at section 45's close: the block and its 'The exact pattern:' lead are gone from §2, replaced by 'The §19 template carries the pattern.' at landed line 57; the Key details list is unchanged but for C013's rewrite. The §19 template shows the parenthesised parameter form; the parameterless older form the removed block showed is described in prose at landed line 140 and shown nowhere.
- proposed: Replace the §2 block with a pointer at §19.
- baseline-test: yes

### C012
- key: Indent the shell `EXEC` line by two spaces, not a tab.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:77
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding. A whitespace detail a template shows but prose must name.
- passage: Indent the shell `EXEC` line 2 spaces, not a tab.

### C013
- key: Put `WITH EXECUTE AS '<schema_owner>'` before `AS` only where the project uses owner impersonation, and drop the clause entirely where it does not.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:78
- provenance: ce7b530 2026-06-28, a defect fix: the reference framed impersonation as universal and contradicted the SKILL, and two inline-TVF templates would not deploy; surfaced by comparing against a fork of the kit.
- verdict: rewrite
- landed: b17bc06 section 45
- reason: The condition, placement and drop case stay verbatim. Only the parenthetical "(as the project's codebase does, for a vendor-driven security constraint)" goes: it read "as the ELEOS codebase does" until a8770b3 swapped the name, and now refers to no project while implying the reader's does impersonate. Lands at landed line 61 (section 45's close) with the parenthetical gone and every other word of the bullet unchanged, C014's and C171's clauses included.
- proposed: Drop the parenthetical; keep "appears before AS only where the project uses owner-impersonation; there the delegated security model runs every proc and scalar or multi-statement function as the schema owner. Drop the clause entirely where the codebase does not impersonate. It is invalid on inline table-valued functions ..., never put it there."
- baseline-test: yes
- passage: `WITH EXECUTE AS '<schema_owner>'` goes before `AS` only where the project uses owner-impersonation
- passage: Drop it where the codebase does not impersonate.

### C014
- key: Never put `WITH EXECUTE AS` on an inline table-valued function.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:78
- provenance: ce7b530 2026-06-28, the same defect fix: SQL Server rejects the clause on inline TVFs, which run under ownership chaining.
- verdict: keep
- reason: A template carrying the clause failed to deploy; the rule prevents a recurrence and nothing mechanical checks generated SQL.
- passage: It is invalid on inline table-valued functions (`RETURNS TABLE
- passage: AS RETURN`), so never put it there.

### C015
- key: Put a tab between `BEGIN` and the trailing inline `-- PROCEDURE` label comment.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:79
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: A signature whitespace detail; the reference states it beside its specimen and the SKILL checklist repeats it as a check.
- passage: `BEGIN	-- PROCEDURE` takes a tab before its label comment.

### C016
- key: End the file with `GO` after the closing `END`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:80
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The reference states the closing GO in position; the checklist restates as a check.
- passage: The file ends with `GO` after the `END`.

### C017
- key: Deploy functions by dropping and recreating them rather than by the shell-then-ALTER pattern.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:84
- provenance: f8c0649 2026-06-10.
- verdict: rewrite
- landed: b17bc06 section 45
- reason: The reference is the pattern owner and states the idiom with its contrast to procedures. Flipped to rewrite at section 45's close by C018's retire of the parenthetical and C019's retire of the block its colon introduced: the words are unchanged and the sentence closes on a period, the §21 pointer following it.
- proposed: Functions use **drop-and-recreate**.
- passage: Functions use **drop-and-recreate**, as the §21 template shows.

### C018
- key: Drop and recreate functions because they cannot be ALTERed the same way and drop-recreate is faster than the shell pattern.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:84
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: The why: the shell trick (`CREATE ... AS RETURN 0`) cannot stand in for a function whose return type the real definition sets, so a placeholder-then-ALTER path does not work for functions the way it does for procedures, and functions carry no GRANTs worth preserving in this library. Safe to drop from the document because C017 is obeyed without it. Retired at section 45's close: the parenthetical is gone from line 84, which reads 'Functions use **drop-and-recreate**. The §21 template carries the pattern.' at landed line 67; C017's entry records the terminal mark.
- proposed: Drop the parenthetical at line 84; the reason lives in this ledger under C018.
- baseline-test: yes

### C019
- key: Follow the shown function block: `;IF OBJECT_ID(...) IS NOT NULL` with a `DROP FUNCTION` EXEC, `GO`, then `;CREATE FUNCTION`, parameters, `RETURNS TABLE`, `AS`, `RETURN ( ... )`, `GO`.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:86
- provenance: f8c0649 2026-06-10; ce7b530 2026-06-28 removed the invalid EXECUTE AS line.
- verdict: retire
- landed: b17bc06 section 45
- reason: The §21 template at lines 644 to 674 carries the identical shape; the §3 block is a duplicate specimen. Retired at section 45's close: the block is gone from §3 and the pointer sits on C017's line, which C018's entry quotes.
- proposed: Replace the §3 block with a pointer at §21.
- baseline-test: yes

### C020
- key: For scalar functions put `RETURN` on its own line followed by the expression.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:104
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: A scalar function puts `RETURN` on its own line before the expression.

### C021
- key: For inline table-valued functions write `RETURN ( ... query ... )`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:104
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: An inline TVF uses `RETURN (
- passage: query

### C022
- key: Guard a table creation with a defensive existence check on `sys.schemas` joined to `sys.tables`, not with `OBJECT_ID`.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:108
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The reference is the only surface naming the catalog views and ruling out OBJECT_ID; the SKILL says IF NOT EXISTS only. C026 is its in-section restatement and retires.
- passage: Tables guard with a **defensive existence check on `sys.schemas` joined to `sys.tables`**, not just `OBJECT_ID`, as the §20 template shows.

### C023
- key: Use the sys.schemas/sys.tables check because it reads better in the diff and protects against name collisions across schemas.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:108
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: The why: the join form names schema and table on separate lines so a diff shows which changed, and it cannot match a same-named table in another schema. C022 is obeyed without it. Retired at section 45's close: the second sentence is gone from line 108 (landed 73), which closes on C022's sentence unchanged.
- proposed: Drop the second sentence of line 108; the reasons live in this ledger under C023.
- baseline-test: yes

### C024
- key: Follow the shown ApiCalls table script: banner, `;IF NOT EXISTS` schema/table check, `BEGIN`, `;CREATE TABLE` with grouped tab-aligned columns and a trailing PK constraint, `END`, `GO`.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:110
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: The §20 template at lines 594 to 638 carries the same shape end to end; the one construct only the ApiCalls script shows, a PERSISTED computed column, is stated in prose at line 163. Retired at section 45's close: the block is gone from §4, replaced by 'The §20 template carries the pattern.' at landed line 75; the key-details list stays but for C026's bullet.
- proposed: Replace the §4 block with a pointer at §20; keep the key-details list.
- baseline-test: yes

### C025
- key: Start a table file with the `/* TABLE: <Name> */` banner comment.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:153
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Start with the `/* TABLE: <Name> */` banner comment.

### C026
- key: Write the `IF NOT EXISTS` block as `sys.schemas` LEFT JOIN `sys.tables`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:154
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: A key-details bullet restating C022 forty-six lines later in the same section with no added content (A030, A031). Safe because C022 stays and the template shows the join. Retired at section 45's close: the bullet is gone from the §4 key-details list, whose first two bullets are the banner comment and the BEGIN and END wrap.

### C027
- key: Wrap the `CREATE TABLE` in `BEGIN` and `END`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:155
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Wrap the semicolon-led `;CREATE TABLE` in `BEGIN` and `END`.

### C028
- key: Lead the `CREATE TABLE` statement with a semicolon.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:156
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The reference carries no general leading-semicolon rule; it states the semicolon per construct while the SKILL (SKILL.md:14) states the general rule with its reason. The bullet is the reference's only statement for CREATE TABLE.
- passage: the semicolon-led `;CREATE TABLE`

### C029
- key: Give the first column a leading space before `[` and every subsequent column a leading comma.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:157
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: §12's enumeration of where the layout applies names temp-table columns but not CREATE TABLE columns, so this bullet is the explicit statement for permanent tables (A114).
- passage: The first column takes a leading space before `[`, and each later column a leading comma.

### C030
- key: Tab-align table columns name, then type, then nullability, then default.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:158
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The only surface stating the four-column order with nullability; §12 states the mechanism (tabs), not the order.
- passage: Tab-align name → type → nullability → default.

### C031
- key: Group related columns with `/* Group Name */` block comments.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:159
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The reference states the form with the canonical group names; the checklist restates as a check.
- passage: Group related columns under `/* Group Name */` comments, such as Request Fields or Audit Fields.

### C032
- key: Put a blank line between column groups.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:160
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Put a blank line between groups.

### C033
- key: Always put the audit fields `CreatedDt` and `UpdatedDt` at the bottom of the column list, defaulted to `SYSDATETIMEOFFSET()` rather than `GETDATE()`.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:161
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Stated where the columns are defined; the SKILL antipattern and checklist summarize it.
- passage: **Audit fields** `CreatedDt` and `UpdatedDt` go at the bottom, defaulted to `SYSDATETIMEOFFSET()`, not `GETDATE()`.

### C034
- key: Write default constraints inline as `DEFAULT(...)` rather than naming them separately.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:162
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Default constraints are inline `DEFAULT(
- passage: )`, never named.

### C035
- key: Write computed columns as `AS ( expression ) PERSISTED`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:163
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding. After C024 retires this line is the only statement of the computed-column form.
- passage: Computed columns use `AS ( expression ) PERSISTED`.

### C036
- key: Put the primary key last, name it `PK_<TableName>`, and put the name on its own line with `PRIMARY KEY CLUSTERED ( [Col] )` indented underneath.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:164
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Carries position and the two-line layout, which the §18 naming row does not; only the name pattern is shared.
- passage: The PK comes last as `PK_<TableName>`, its name on its own line and `PRIMARY KEY CLUSTERED ( [Col] )` indented under it.

### C037
- key: Put indexes in the same file as the table they support and give each index its own `IF NOT EXISTS` block.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:168
- provenance: f8c0649 2026-06-10.
- verdict: rewrite
- landed: b17bc06 section 45
- reason: The reference states placement and the per-index block; the checklist restates. Flipped to rewrite at section 45's close by C038's retire of the block its colon introduced: the words are unchanged and the second sentence closes on a period, the §20 pointer following it.
- proposed: Indexes go in the same file as the table they support. Each index gets its own `IF NOT EXISTS` block.
- passage: Indexes live in their table's file. Each sits in its own `IF NOT EXISTS` block, as the end of the §20 template shows.

### C038
- key: Follow the shown index block: a `-- Check for and Create ...` comment, `;IF NOT EXISTS` over `sys.indexes`, `BEGIN`, `;CREATE NONCLUSTERED INDEX` with a leading-comma column list, `END`, `GO`.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:170
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: The §20 template ends with the identical index block at lines 627 to 637; the §5 block is a duplicate specimen and the §5 bullets read against §20. Retired at section 45's close: the block is gone from §5 and C037's line closes 'The §20 template ends with the index block.' at landed line 92, which C037's entry records; the §5 bullets stay but for C039's.
- proposed: Replace the §5 block with a pointer at §20's index block.
- baseline-test: yes

### C039
- key: Name indexes `IX_<TableName>_<ColumnList>`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:184
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: The §18 row at line 512 carries the same pattern and the same example; §18 owns naming. Safe because the SKILL checklist also carries the pattern. Retired at section 45's close: the bullet reads '- Naming: see §18.' at landed line 94, the reduced form this proposal allows and the form C118's and C131's bullets take.
- proposed: (via A049) Drop the naming bullet at line 184 or reduce it to "Naming: see §18".
- baseline-test: yes

### C040
- key: Write each index existence check against `sys.indexes` using `OBJECT_ID(...)` and `[name] = '...'`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:185
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Check `sys.indexes` with `OBJECT_ID(
- passage: )` and `[name] = '

### C041
- key: Write the index column list inside `( ... )` in the leading-comma and tab-alignment style.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:186
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Already reads as a pointer at the §12 style rather than a restatement of its shape (A114).
- passage: Lay out the column list inside `(
- passage: )` per §12.

### C042
- key: Introduce each index block with a short `-- Check for and Create <IndexName>.` comment.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:187
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Introduce the block with `-- Check for and Create <IndexName>.`

### C043
- key: Give every procedure a metadata banner inside `BEGIN -- PROCEDURE` documenting purpose, author, version and history, and never skip it.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:191
- provenance: f8c0649 2026-06-10.
- verdict: rewrite
- landed: b17bc06 section 45
- reason: The contents and the never-skip fold into one sentence; the two emphasis sentences add no instruction. The doctrine's current-state rule does not conflict: the NOTES block is an append-only per-object changelog, which the doctrine exempts by name (A051). Lands at landed line 101 (section 45's close) as the proposal's sentence, with the backticks around BEGIN -- PROCEDURE the line carried.
- proposed: One sentence: "Inside BEGIN -- PROCEDURE, every procedure has a metadata banner documenting its purpose, author, version and history; never skip it."
- baseline-test: yes
- passage: Every procedure carries the metadata banner the §19 template shows, inside `BEGIN -- PROCEDURE`, giving its purpose, author, version and history. Never skip it.

### C044
- key: Follow the shown banner: two asterisk rows, SCRIPT/AUTHOR/DATE/VERSION lines, an asterisk row, a NOTES entry, then two closing asterisk rows.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:196
- provenance: f8c0649 2026-06-10; a8770b3 2026-06-28 replaced the author and company with placeholders.
- verdict: retire
- reason: row 1170 (Procedure header metadata banner), shrink. The §6 specimen printed the banner a third time. C048 carries the worked ordinal date, C049 carries the NOTES entry form, and the §19 template (C163) carries the banner's rows.
- passage: SCRIPT:		<schema>.usp_GetBackgroundMessages
- passage: NOTES:		v1.0 - 02/16/2025 - <AUTHOR NAME> - <COMPANY>

### C045
- key: Make the banner's top and bottom rows about 92 asterisks wide, counted by eye rather than strictly.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:211
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Sizes the header banner and admits eyeballing; C082 sizes a different object.
- passage: A doubled asterisk row of about 92, counted by eye, opens and closes it, and one row separates VERSION from NOTES.

### C046
- key: Bookend the SCRIPT/AUTHOR/DATE/VERSION block with two adjacent asterisk lines.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:212
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: A doubled asterisk row of about 92, counted by eye, opens and closes it

### C047
- key: Separate the metadata block from the NOTES section with one asterisk line.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:213
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: and one row separates VERSION from NOTES.

### C048
- key: Write the banner DATE in ordinal English format such as "February 16th, 2025", not "2025-02-16".
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:214
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The reference states the format with a worked date and counter-example; the checklist says "ordinal English".
- passage: DATE is **ordinal English** ("February 16th, 2025", not "2025-02-16").

### C049
- key: Lead each NOTES entry with `vN.N - MM/DD/YYYY - AUTHOR NAME - COMPANY` and indent the body underneath.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:215
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Each NOTES entry leads with `vN.N - MM/DD/YYYY - AUTHOR NAME - COMPANY`, its body indented under it.

### C050
- key: Write AUTHOR as the author's name alone or as `<Author Name> / <Company>`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:216
- provenance: f8c0649 2026-06-10; a8770b3 2026-06-28 replaced the operator's name and company with placeholders.
- verdict: keep
- reason: No finding.
- passage: AUTHOR is `<Author Name>` or `<Author Name> / <Company>`.

### C051
- key: When bumping the version, add a new note line above the previous one and do not rewrite the existing history.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:217
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The NOTES block is an append-only changelog, exempt from the doctrine's current-state rule by name (A060); the reference states the rule with the note's position and the checklist restates.
- passage: A version bump **adds** a note line above the last one. Never rewrite history.

### C052
- key: Declare procedure parameters inside parentheses after the procedure name.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:221
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Parameters sit in parentheses after the procedure name

### C053
- key: Make the first row inside the parameter list a comment row showing the PARAMETER NAME, DATATYPE and DEFAULT column headings.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:221
- provenance: f8c0649 2026-06-10.
- verdict: rewrite
- landed: b17bc06 section 45
- reason: No finding. Flipped to rewrite at section 45's close by C054's retire of the block its colon introduced: the words are unchanged and the sentence closes on a period, the §19 pointer following it; C052's sentence before it is unchanged.
- proposed: The first row inside is a comment row showing the column headings.
- passage: headed by a comment row naming the columns, as the §19 template shows.

### C054
- key: Follow the shown parameter block: heading comment row, a first parameter with a leading space, subsequent parameters with leading commas, then `)`, `WITH EXECUTE AS`, `AS`, `BEGIN`.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:223
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: The §19 template at lines 535 to 545 carries the identical parameter block shape; the §7 block is a duplicate specimen and the §7 conventions read against §19. Retired at section 45's close: the block is gone from §7 and C053's line closes 'The §19 template carries the parameter block.' at landed line 131, which C053's entry records; the conventions list stays but for C055's and C056's bullets.
- proposed: Replace the §7 block with a pointer at §19; keep the conventions list.
- baseline-test: yes

### C055
- key: Prefix input parameter names with `@p_`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:242
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: The §18 row at line 508 carries the same pattern and example and the SKILL checklist carries the prefix; C076 still bars @p_ on locals. Nothing leaves the corpus. Retired at section 45's close: the bullet is gone from the §7 conventions list, its bold lead with it; the list opens on C057's bullet.
- proposed: (via A064) Drop the bullet at line 242; §18 owns the parameter pattern and C076 still bars @p_ on locals.
- baseline-test: yes

### C056
- key: Give the first parameter a leading space and every subsequent parameter a leading comma.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:243
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: A pure instance of C096, and §12's enumeration names parameter lists explicitly (A114). Retired at section 45's close: the bullet is gone from the §7 conventions list.

### C057
- key: Tab-align the parameter name column, then the type column, then the default column.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:244
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: §12 states tabs and leading commas but not the name/type/default order; this bullet is the reference's statement of the order for parameters.
- passage: - Tab-align name → type → default.

### C058
- key: Default parameters to `= NULL` by default, `= 0` for counts and numerics, and `= 1` for flags meaning on.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:245
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Default to `= NULL`, with `= 0` for counts and numerics and `= 1` for "on" flags.

### C059
- key: Put `OUTPUT` parameters at the end of the parameter list.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:246
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: `OUTPUT` parameters are rare and go last.

### C060
- key: Declare table-valued parameters with `READONLY`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:247
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Table-valued parameters take `READONLY`: `@p_FormData <schema>.FormFieldType READONLY`.

### C061
- key: Put the closing `)` and the `WITH EXECUTE AS '<schema_owner>'` line at the procedure-signature column.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:248
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: The closing `)` and `WITH EXECUTE AS '<schema_owner>'` sit at the signature column.

### C062
- key: Match the surrounding files when choosing between the parenthesized parameter wrapper and the older no-parentheses style; either is acceptable.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:250
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Both wrapper forms are house style, so matching siblings picks between two house-approved forms and defers to no foreign convention; the SKILL's Precedence section governs a sibling written outside the style (A070).
- passage: Older procedures such as `usp_GetBackgroundMessages` omit the parentheses and keep the comment row. Both styles are fine, so **match the surrounding files**.

### C063
- key: Open every procedure body with two paired SET statements inside their own banner section.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:254
- provenance: f8c0649 2026-06-10.
- verdict: rewrite
- landed: b17bc06 section 45
- reason: The reference states the pair with its banner; the SKILL antipattern bars skipping them. C068 adds the banner wording latitude. Flipped to rewrite at section 45's close by C064's retire of the block its colon introduced: the words are unchanged and the sentence closes on a period, the §19 pointer following it.
- proposed: Every procedure body opens with two paired SET statements, inside their own banner section.
- passage: Every procedure body opens with a banner section holding two paired, semicolon-led SET statements, as the §19 template shows.

### C064
- key: Follow the shown opening: a banner reading "SET PROCESSING VARIABLES TO INCREASE SPEED AND DATA ACCESS." then `;SET NOCOUNT ON` and `;SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED`.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:256
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: The §19 template at lines 559 to 563 carries the block verbatim, banner wording included. Retired at section 45's close: the block is gone from §8 and C063's line closes 'The §19 template carries the SET block.' at landed line 144, which C063's entry records; the bullets stay.
- proposed: Replace the §8 block with a pointer at §19; keep the bullets.
- baseline-test: yes

### C065
- key: Always include `SET NOCOUNT ON`.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:264
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The reference states it as mandatory; the SKILL restates as antipattern and check.
- passage: **`SET NOCOUNT ON`** is mandatory.

### C066
- key: Pair the SET with `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED` for read-heavy procedures and `READ COMMITTED` for write, transactional and audit procedures.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:265
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The reference states both levels with the procedure families; the checklist summarizes.
- passage: **`SET TRANSACTION ISOLATION LEVEL`** is `READ UNCOMMITTED` for read-heavy procs and the default for `Get*`. It is `READ COMMITTED` for write, transactional and audit procs, and the default for `Save*` and `Process*`.

### C067
- key: Lead both SET statements with a semicolon.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:268
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: As C028: the reference states the semicolon per construct and carries no general rule; the SKILL owns the general rule.
- passage: two paired, semicolon-led SET statements

### C068
- key: Wrap the SET statements in a section banner naming what they are for.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:269
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The two banner wordings it gives end in a period because they are imperative sentences; the contradiction with C081 is real and C081 is the side that gives way.
- passage: The banner names their purpose in its own words, such as "SET PROCESSING VARIABLES TO SUPPRESS OUTPUT."

### C069
- key: Do not use `SET XACT_ABORT`; handle errors with TRY/CATCH instead.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:271
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: `SET XACT_ABORT` is **not used**. TRY/CATCH handles errors.

### C070
- key: Declare variables in grouped `;DECLARE` blocks, grouped by purpose, with tabs aligned.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:275
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Variables go in `;DECLARE` blocks grouped by purpose, as the §19 template shows.

### C071
- key: Follow the shown DECLARE block: a banner reading "DECLARE VARIABLES FOR PROCESSING." then `;DECLARE @True BIT = 1` with subsequent variables on leading-comma lines, tab-aligned.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:277
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: The §19 template at lines 565 to 569 carries the DECLARE block with the same banner and alignment. Retired at section 45's close: the block is gone from §9 and C070's line gains 'The §19 template carries the DECLARE block.' after its own two sentences at landed line 157, C070's words unchanged; the conventions list stays.
- proposed: Replace the §9 block with a pointer at §19; keep the conventions list.
- baseline-test: yes

### C072
- key: Introduce a declaration block with one `;DECLARE` keyword and continue subsequent variables with a leading comma.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:288
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The single-DECLARE-keyword instruction is content §12 does not carry; only the leading-comma continuation is shared.
- passage: One `;DECLARE` opens a block, and later variables continue with a leading comma.

### C073
- key: Tab-align the variable name, then type, then default.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:289
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: As C057: the reference's only statement of the column order for DECLARE blocks; §12 does not carry the order.
- passage: - Tab-align name → type → default.

### C074
- key: Declare `@True BIT = 1` and `@False BIT = 0` at the top of a procedure with conditional logic and use them in place of literal `1` and `0`.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:290
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Instructs declaring and using the pair; the §18 row only names and types it.
- passage: A procedure with conditional logic declares `@True BIT = 1` and `@False BIT = 0` at the top and uses them instead of literal 1 and 0.

### C075
- key: Name local variables plain `@PascalCase` with no `@v_` or `@local_` prefix.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:291
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Names the rejected prefixes, which neither the SKILL nor the §18 row carries.
- passage: Locals are plain `@PascalCase`, with no `@v_` or `@local_` prefix

### C076
- key: Never use the `@p_` prefix for a local variable; reserve it for parameters.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:292
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding. After C055 retires this line still bars the prefix on locals.
- passage: A local never takes `@p_`. That prefix is reserved for parameters.

### C077
- key: Use multiple `;DECLARE` blocks with separate banners when a procedure has many conceptually distinct variable groups.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:293
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Many distinct variable groups take several `;DECLARE` blocks, each with its own banner.

### C078
- key: Introduce every logical phase inside the procedure body with a section banner.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:297
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The reference states the rule with the phase order beneath it; the SKILL philosophy line summarizes.
- passage: Every logical phase of the body opens with a section banner.

### C079
- key: Order the standard phases: SET processing variables, DECLARE variables, temporary tables, retrieve or populate base data, validation and guard checks, main logic, output result sets, then cleanup and finalization.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:299
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: The standard phases, in order:
- passage: 8. CLEANUP / FINALIZATION

### C080
- key: Follow the shown banner form: an asterisk line, an indented uppercase title such as `DATASET 1: MESSAGE HEADER`, then a closing asterisk line.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:310
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The document's only specimen of a label-style banner without a period; after C081's rewrite it is the label half of the sentence-versus-label pair.
- passage: DATASET 1: MESSAGE HEADER

### C081
- key: Write the banner-internal title in uppercase with no terminating period.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:316
- provenance: f8c0649 2026-06-10.
- verdict: rewrite
- landed: b17bc06 section 45
- reason: Four of the document's five banner specimens (lines 258, 279, 331, 572) end in a period and one (312) does not; the specimens are copied from the operator's library and follow §17's sentence-versus-label convention, so the flat "no period" was an authored over-generalization. Rewrite to: uppercase; a period when the title is an imperative sentence, none when it is a label, per §17. Lands at landed line 188 (section 45's close) as 'Banner-internal title is uppercase. It takes a period where the title is an imperative sentence and none where it is a label, per §17.', two sentences from this reason; C082's and C083's sentences after it are unchanged, and the line now agrees with C068's bullet, the side A081 (text not in tree) upheld. The §17 closing sentence that called banners titles rather than sentences is brought current at the close pass, recorded on C141.
- passage: The title is uppercase, with a period where it is an imperative sentence and none where it is a label, per §17.

### C082
- key: Make the banner asterisk lines 92 characters wide.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:316
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The SKILL's `/********** TITLE **********/` is the style's shorthand name, not a competing single-line shape; the SKILL's own exemplar renders the 92-asterisk multi-line form (A094).
- passage: The asterisk lines are 92 characters wide.

### C083
- key: Indent the banner title by one leading space plus a tab inside the banner.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:316
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: The title sits one space plus a tab inside.

### C084
- key: Introduce a sub-section inside a banner with a single-line `/* Sub-Section Title. */` block comment ending in a period, stating briefly what the next block does.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:318
- provenance: 058e3a3 2026-07-24, the PrePass hand-edit review: the operator's review of Claude-authored code found narrative comments, and the fix made §17 the voice owner with §10 pointing at it.
- verdict: rewrite
- landed: b17bc06 section 45
- reason: The commit that owns this passage shaped it as the in-context pointer at §17; it carries the form and period at the moment of use and is already the pointer shape the one-owner rule asks for. Flipped to rewrite at section 45's close by C086's retire of the specimen its colon introduced: the words are unchanged and the sentence closes on a period; C085's parenthetical inside it is unchanged.
- proposed: For sub-sections inside a banner (smaller groupings), use a single-line `/* Sub-Section Title. */` block comment with a terminating period - a short imperative statement of what the next block does (see §17 for the comment voice).
- passage: Sub-sections take a single-line `/* Sub-Section Title. */` comment ending in a period, in the §17 comment voice.

### C085
- key: Read section 17 for the comment voice when writing sub-section comments.
- class: pointer
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:318
- provenance: 058e3a3 2026-07-24.
- verdict: keep
- reason: No finding. This is the pointer 058e3a3 installed.
- passage: in the §17 comment voice.

### C086
- key: Write a sub-section comment like `/* Make Table to Track the Messages to Resend. */` immediately above the statement it introduces.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:320
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: The §19 template shows a sub-section comment above the statement it introduces at line 575; the §10 specimen duplicates it. Retired at section 45's close: the block is gone from §10 with no pointer added, as this proposal says; C084's line closes on a period, which C084's entry records.
- proposed: Drop the §10 specimen block; §19 shows the placement.
- baseline-test: yes

### C087
- key: Wrap the main logic of every non-trivial procedure in a `BEGIN TRY` / `BEGIN CATCH` block.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:327
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The reference states the wrapping with its non-trivial bound; the checklist restates.
- passage: Every non-trivial procedure wraps its main logic in `BEGIN TRY` / `BEGIN CATCH`, as the §19 template shows.

### C088
- key: Have the CATCH call `usp_AuditError` to log the failure and not re-throw, so the caller does not fail.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:327
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: A signature trait the SKILL description names; the reference states the call, the non-rethrow and its reason. The nested-CATCH exception lives at C094, not here.
- passage: The CATCH logs through `usp_AuditError` and does **not** re-throw, so the caller does not fail.

### C089
- key: Follow the shown TRY/CATCH block: a banner, `;BEGIN TRY` with commented sub-blocks doing the upsert, `END TRY`, `BEGIN CATCH` with a guarded `usp_AuditError` call, `END CATCH`.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:329
- provenance: f8c0649 2026-06-10.
- verdict: retire
- reason: row 1175 (Non-rethrowing audit CATCH), shrink. The upsert specimen repeated other text. C113 carries the upsert shape with SCOPE_IDENTITY, C093 carries `END ELSE BEGIN`, C091 carries the guard, and the §19 template (C163) shows the guarded CATCH in context.
- passage: UPSERT THE INFORMATION TO THE API CALLS TABLE.

### C090
- key: Put `;BEGIN TRY`, `END TRY`, `BEGIN CATCH` and `END CATCH` each on their own line.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:360
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: `;BEGIN TRY`, `END TRY`, `BEGIN CATCH` and `END CATCH` each take their own line.

### C091
- key: Guard the error-logger call with `IF (OBJECT_ID('<schema>.usp_AuditError') IS NOT NULL)`.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:361
- provenance: f8c0649 2026-06-10.
- verdict: rewrite
- landed: b17bc06 section 45
- reason: The reference gives the exact predicate; the SKILL says "guarded by OBJECT_ID check". Flipped to rewrite at section 45's close by C092's retire of the clause after its spaced hyphen: the words are unchanged and the bullet closes on a period.
- proposed: The `IF (OBJECT_ID('<schema>.usp_AuditError') IS NOT NULL)` guard is defensive.
- passage: Guard the logging call with `IF (OBJECT_ID('<schema>.usp_AuditError') IS NOT NULL)`.

### C092
- key: Guard the logger call because it protects against deployments where the error logger is not yet present.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:361
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: The why: procedures deploy in folder order and a partial or first deployment can run a procedure before usp_AuditError exists, and an unguarded EXECUTE of a missing procedure inside CATCH raises a second error that escapes to the caller. C091 is obeyed without it. Retired at section 45's close: the clause after the spaced hyphen is gone and the bullet reads '- The `IF (OBJECT_ID('<schema>.usp_AuditError') IS NOT NULL)` guard is defensive.' at landed line 228, which C091's entry records.
- proposed: Reduce line 361 to the guard itself; the reason lives in this ledger under C092.
- baseline-test: yes

### C093
- key: Write `END ELSE BEGIN` on a single line with one space on each side of `ELSE`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:362
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: `END ELSE BEGIN` sits on one line, one space each side of `ELSE`.

### C094
- key: Use `THROW` only inside a nested CATCH where the error genuinely needs to propagate.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:363
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The only prose statement of the THROW exception; the SKILL checklist cites §11 for it (SKILL.md:104), so retiring it would break that pointer.
- passage: `THROW` is rare, for a nested CATCH whose error must propagate.

### C095
- key: Apply the leading-comma and tab-alignment layout to parameter lists, variable declarations, SELECT, INSERT and temp-table column lists, INSERT VALUES rows, UPDATE SET clauses, ORDER BY, GROUP BY and PARTITION BY clauses, and any list that wraps across lines.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:367
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: §12 is the layout owner; this states where it applies and C096 states the shape.
- passage: Every list that wraps across lines takes the leading-comma layout below: parameters, variables, SELECT, INSERT and temp-table columns, VALUES rows, UPDATE SET clauses, and ORDER BY, GROUP BY and PARTITION BY.

### C096
- key: Give the first list item a leading space and each subsequent item a leading comma sitting in a column aligned with the previous comma.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:378
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The owner's statement of the shape; the per-construct instances in §4, §5, §7 and §9 were ruled individually (C056 retires, C029, C041 and C072 keep).
- passage: **The first item takes a leading space, and each later item a leading comma** aligned under the one above.

### C097
- key: Write a wrapped SELECT list like `;SELECT [MessageId] = M.[MessageId]` with following columns on leading-comma lines aligned by tabs.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:380
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The owner section's specimen of the comma column across continuation rows; no template shows a multi-column SELECT with continuation lines, and prose cannot carry where the columns fall.
- passage: ;SELECT	 [MessageId]			= M.[MessageId]

### C098
- key: Do the alignment with tab characters rather than spaces, treating one tab as four columns of width.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:386
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The only surface fixing the tab width.
- passage: Tabs, never spaces, do the alignment, and one tab is 4 columns.

### C099
- key: Always wrap column names in square brackets, even where they are not required.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:388
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The reference states the even-when-unnecessary bound; the SKILL antipattern summarizes.
- passage: **Always bracket column names as `[...]`**, even where not needed, for visual consistency.

### C100
- key: Always alias output columns in the left-hand `[Alias] = expression` form.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:393
- provenance: f8c0649 2026-06-10.
- verdict: rewrite
- landed: b17bc06 section 45
- reason: The positive statement of the alias form; the SKILL antipattern bars the other. Flipped to rewrite at section 45's close by C101's retire of the block its colon introduced: the words are unchanged and the bullet closes on a period.
- proposed: Output columns always aliased with `[Alias] = expression` form (left-hand alias).
- passage: Output columns always take the left-hand `[Alias] = expression` form.

### C101
- key: Write output aliases like `SELECT [DriverId] = D.[Id]` followed by `,[FullName] = CONCAT(D.[First], ' ', D.[Last])`.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:394
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: The §12 specimen fourteen lines earlier (C097) shows the identical shape with continuation rows; this two-line block adds nothing. Retired at section 45's close: the two-line block is gone and C100's bullet closes on a period at landed line 260, which C100's entry records.
- proposed: Drop the two-line block at 394 to 397; C100's bullet stands with the §12 specimen as its illustration.
- baseline-test: yes

### C102
- key: Alias tables in FROM and JOIN clauses with a short identifier and no `AS` keyword.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:398
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Tables in FROM/JOIN take a short alias with no `AS`:

### C103
- key: Write a FROM/JOIN like `FROM <schema>.DocumentHistory H` with the `LEFT JOIN` indented under it and its `ON` clause indented further.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:399
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The JOIN-under-FROM and ON-under-JOIN indentation appears in no prose sentence; the specimen is the layout's only statement.
- passage: FROM <schema>.DocumentHistory H

### C104
- key: Use single-letter table aliases, switching to multi-letter mnemonics only where letters collide.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:404
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Aliases are single letters (`H`, `F`, `D`, `S`), or mnemonics on a collision (`LD` for Loads, `ST` for Stops).

### C105
- key: Never use `SELECT *` in production SELECTs that return result sets to callers.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:406
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Carries the SELECT * INTO carve-out the SKILL antipattern omits.
- passage: **Never `SELECT *`** in a production result set returned to callers. It is allowed only in `SELECT * INTO #TempTable FROM <schema>.udf_X(
- passage: )`, where the source schema is controlled.

### C106
- key: Write an INSERT as `;INSERT INTO <table> (` with a leading-comma column list, then a SELECT using the `[Alias] = value` form with COALESCE defaults.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:411
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No template shows an INSERT; the right-aligned closing paren and the SELECT-fed form are visible only here.
- passage: ;INSERT INTO <schema>.APICalls (

### C107
- key: Align the closing `)` of an INSERT column list to the right, after a tab.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:426
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: The column list's closing `)` sits right, after a tab.

### C108
- key: Write the SELECT feeding an INSERT in the same `[Alias] = value` form as a regular SELECT.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:427
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: The SELECT feeding it uses the regular `[Alias] = value` form.

### C109
- key: Write an UPDATE as `;UPDATE C` then a standalone `SET` with leading-comma assignments, then `FROM` and `WHERE` aligned with `SET`.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:432
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No template shows a full UPDATE; the FROM/WHERE column alignment with SET is a position only the specimen carries.
- passage: SET		 [RequestMethod]	= COALESCE(@p_RequestMethod, C.[RequestMethod])

### C110
- key: Lead the `UPDATE` statement with a semicolon.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:440
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: As C028.
- passage: `;UPDATE` leads with a semicolon.

### C111
- key: Put the `SET` keyword on its own and give the first assignment a leading space.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:441
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: `SET` stands alone, with a leading space before the first assignment.

### C112
- key: Align `FROM` and `WHERE` with `SET`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:442
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: `FROM` and `WHERE` align with `SET`.

### C113
- key: Write an upsert as `IF (@p_Id > 0) BEGIN /* update */ END ELSE BEGIN /* insert; SCOPE_IDENTITY() */ END`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:444
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: **Upsert:** `IF (@p_Id > 0) BEGIN /* update */ END ELSE BEGIN /* insert; SCOPE_IDENTITY() */ END`, as in `usp_AuditApiCall`.

### C114
- key: Write `LEFT JOIN` rather than `LEFT OUTER JOIN`, and `INNER JOIN` rather than bare `JOIN`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:449
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Write `LEFT JOIN`, not `LEFT OUTER JOIN`, and `INNER JOIN`, not bare `JOIN`.

### C115
- key: Wrap multi-condition `ON` clauses in parentheses and align the `AND`s.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:450
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Wrap a multi-condition `ON` in parentheses where it aids clarity, with the `AND`s aligned:

### C116
- key: Write a multi-condition ON like `ON ( H.[Id] = TRY_PARSE(...) AND H.[EmployeeStatusCode] = 'A' ) OR H.[DriverId] = @p_UserName` with the operators aligned.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:451
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The only specimen of the parenthesized, operator-aligned ON clause C115 describes.
- passage: ON (		H.[Id] = TRY_PARSE(@p_UserName AS INT)

### C117
- key: Use `OUTER APPLY` freely for correlated subqueries.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:457
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: **OUTER APPLY** is used freely for correlated subqueries, especially in table-valued functions.

### C118
- key: Name CTEs `cte<Name>`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:460
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: The §18 row at line 515 carries the same pattern and example; §18 owns naming. Retired at section 45's close: the bullet reads '- Naming: see §18.' at landed line 323, the reduced form; the ;WITH, body, chaining and recursive bullets are unchanged.
- proposed: (via A132) Drop the naming bullet at line 460 or reduce it to "Naming: see §18"; keep the ;WITH, body and chaining bullets.
- baseline-test: yes

### C119
- key: Lead the `WITH` with a semicolon prefix.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:461
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: As C028.
- passage: Lead CTEs with `;WITH`

### C120
- key: Write each CTE body inside `( ... )` following the standard SELECT layout.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:462
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: )` out as a standard SELECT
- passage: Lay each body `( ... )` out as a standard SELECT.

### C121
- key: Separate chained CTEs with a comma followed by a new `cte<Name> AS ( ... )`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:463
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Chain CTEs with `,` then `cte<Name> AS ( ... )`.

### C122
- key: Use recursive CTEs freely where geographic or hierarchical traversal is needed.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:464
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Recursive CTEs are fine for geographic or hierarchical traversal.

### C123
- key: Prefer `CONCAT` over `+` for string concatenation because it is null-safe.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:468
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: **CONCAT** over `+`. It is null-safe.

### C124
- key: Prefer `COALESCE` over `ISNULL` for value defaulting.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:469
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: **COALESCE** over `ISNULL` for defaulting, especially with 3+ fallbacks.

### C125
- key: Use `IS NULL` for existence checks in WHERE clauses.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:470
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: **`IS NULL`** for existence checks in WHERE.

### C126
- key: Use `TRY_PARSE` or `TRY_CONVERT` for safe casts, which return NULL on failure.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:471
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: **TRY_PARSE / TRY_CONVERT** for safe casts, which return NULL on failure.

### C127
- key: Use `FORMAT` for user-facing strings.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:472
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: **FORMAT** for user-facing strings, such as `FORMAT(@Date, 'dddd, MMMM d, yyyy, h:mm tt')`.

### C128
- key: Use `CONVERT` for internal conversions because it is more performant than FORMAT.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:473
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: **CONVERT** for internal conversions. It outperforms FORMAT.

### C129
- key: Use `SYSDATETIMEOFFSET()` for audit timestamps in preference to `GETDATE()`.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:474
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Stated beside the GETDATE() carve-out (C130); the SKILL antipattern summarizes.
- passage: **SYSDATETIMEOFFSET()** for audit timestamps, over `GETDATE()`.

### C130
- key: Use `GETDATE()` only for transient or comparison logic where timezone does not matter.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:475
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: **GETDATE()** only for transient or comparison logic where timezone does not matter.

### C131
- key: Name temp tables `#PascalCase`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:479
- provenance: f8c0649 2026-06-10; a8770b3 2026-06-28 genericized one example name.
- verdict: retire
- landed: b17bc06 section 45
- reason: The §18 row at line 514 carries the same pattern with overlapping examples; §18 owns naming. Retired at section 45's close: the bullet reads '- Naming: see §18.' at landed line 342, the reduced form; the other four bullets are unchanged.
- proposed: (via A138) Drop the naming bullet at line 479 or reduce it to "Naming: see §18"; keep the existence-check, comment, scoping and SELECT INTO bullets.
- baseline-test: yes

### C132
- key: Always check `IF (OBJECT_ID('tempdb..#Name') IS NULL)` before creating a temp table.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:480
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Composes with C135: the guard wraps whatever creates the table, SELECT INTO included (A140).
- passage: Check existence first, whatever creates the table: `IF (OBJECT_ID('tempdb..#Name') IS NULL)`.

### C133
- key: Comment the purpose of a temp table with a sentence-style block comment above it.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:481
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: Comment the purpose: `/* Make Table to Track the Messages to Resend. */`.

### C134
- key: Declare temp tables shared with nested EXEC calls in the outer procedure and rely on temp-table scoping.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:482
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: A temp table shared with nested EXEC calls is declared in the outer procedure, relying on temp-table scoping.

### C135
- key: Use `SELECT INTO #Name FROM ...` where you want to inherit the schema from a function or query.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:483
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: Sanctions a creation form; C132's guard still wraps it (A140).
- passage: `SELECT INTO #Name FROM
- passage: ` is fine to inherit the schema of a function or query.

### C136
- key: Use the `/********** TITLE **********/` banner style for major section dividers inside a procedure.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:489
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The table's shorthand label for the banner style whose exact shape §10 shows; not a competing single-line form (A142).
- passage: | `/********** TITLE **********/` (banner) | Major section dividers inside a procedure |

### C137
- key: Use `/* Sub-section Title. */` single-line block comments for smaller groupings and end them with a period.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:490
- provenance: f8c0649 2026-06-10; 058e3a3 2026-07-24 made §17 the comment-voice owner.
- verdict: keep
- reason: §17 owns the comment forms; the checklist restates the period as a check.
- passage: | `/* Sub-section Title. */` | Single-line block comments for smaller groupings; **end with period** |

### C138
- key: Use `/* Group Name */` with no period for group dividers inside a CREATE TABLE column list.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:491
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: §17 owns the comment forms.
- passage: | `/* Group Name */` (no period) | Group dividers inside a CREATE TABLE column list |

### C139
- key: Use `-- Comment.` ending in a period for inline comments and labels above blocks.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:492
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: | `-- Comment.` | Inline comments and labels above blocks; **end with period** |

### C140
- key: Use `-- TITLE.` for top-of-file pre-banner comments.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:493
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: | `-- TITLE.` | Top-of-file pre-banner comments (e.g. `-- CREATE A SHELL PROCEDURE IF NONE EXISTS.`) |

### C141
- key: End comments that are sentences with a period and leave comments that are labels or titles without one.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:495
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The governing convention the checklist forms instantiate; after C081's rewrite it also governs banner titles. At section 45's close pass line 497's closing sentence, which no entry keys, was brought current with that reach: 'Banners and group labels are titles, not sentences, and are unaffected.' reads 'Group labels are titles, not sentences, and are unaffected. A banner title takes §10's period rule.' at landed line 360, the blind lens having read the old sentence as denying the rule C081's sentence points at §17 for.
- passage: **A comment that is a sentence ends with a period, and a label or title does not.** So `/* Request Fields */` takes none and `/* Validate Upsert Operation. */` takes one. Banner titles follow the same rule.

### C142
- key: Keep sentence-style comments short imperative statements of what the next block does, as a reading aid for someone scanning the procedure.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:497
- provenance: 058e3a3 2026-07-24, the operator's hand-edit review of Claude-authored code (2026-07-21) found narrative comments; the voice rule was installed in the C# reference, the SQL reference and the SQL SKILL in one commit.
- verdict: keep
- reason: Incident-born and unenforced by any hook; each surface governs its own comment syntax, so the parallel C# and SKILL lines are installs, not duplicates.
- passage: Sentence comments, the `/* Sub-Section Title. */` blocks and inline `-- Comment.` lines, are short imperative statements of what the next block does.

### C143
- key: Never put history, decision narrative, rationale essays or issues encountered into comments, and keep WHY comments rare and exceptional.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:497
- provenance: 058e3a3 2026-07-24, same incident as C142.
- verdict: keep
- reason: The four-item list is the incident's content (what the review found comments carrying); compressing it drops "issues encountered", which the operator named.
- passage: A WHY comment is rare, and no comment carries history, under the doctrine's "Documents ship the current state" rule.

### C144
- key: Use a single schema, referenced as `<schema>`, for all objects.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:503
- provenance: f8c0649 2026-06-10; a8770b3 2026-06-28 replaced the schema name with a placeholder.
- verdict: keep
- reason: No finding.
- passage: | Schema | `<schema>` (single schema) | `<schema>.usp_GetLoads` |

### C145
- key: Name tables in PascalCase with no prefix.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:504
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: | Table | PascalCase, no prefix | `ApiCalls`, `WorkflowReport` |

### C146
- key: Name procedures `usp_<PascalCase>`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:505
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: | Procedure | `usp_<PascalCase>` | `usp_GetBackgroundMessages` |

### C147
- key: Name functions `udf_<PascalCase>`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:506
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: | Function | `udf_<PascalCase>` | `udf_DocumentFields` |

### C148
- key: Name triggers and jobs `JOB.<schema>.<Name>`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:507
- provenance: f8c0649 2026-06-10; a8770b3 2026-06-28 replaced the schema name with a placeholder.
- verdict: keep
- reason: No finding.
- passage: | Trigger / Job | `JOB.<schema>.<Name>` | `JOB.<schema>.WorkflowReport` |

### C149
- key: Name parameters `@p_<PascalCase>`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:508
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: §18 is the naming owner; the §7 copy (C055) retires in its favor.
- passage: | Parameter | `@p_<PascalCase>` | `@p_ApiCallId` |

### C150
- key: Name local variables `@<PascalCase>`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:509
- provenance: f8c0649 2026-06-10.
- verdict: retire
- reason: row 1183 (Object naming convention table), shrink. The row restated the locals rule. C075's "Locals are plain `@PascalCase`, with no `@v_` or `@local_` prefix" in §9 carries the pattern.
- passage: | Local variable | `@<PascalCase>` | `@DriverCode`, `@OrderNumber` |

### C151
- key: Name boolean locals `@True` and `@False`, typed BIT with values 1 and 0, declared at the top of procedures that use them.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:510
- provenance: f8c0649 2026-06-10.
- verdict: retire
- reason: row 1183 (Object naming convention table), shrink. The row restated C074's "A procedure with conditional logic declares `@True BIT = 1` and `@False BIT = 0` at the top and uses them instead of literal 1 and 0." in §9, which carries the names, type, values and placement.
- passage: | Boolean local | `@True`, `@False` (BIT 1, 0) | declared at top of procs that use them |

### C152
- key: Name primary keys `PK_<TableName>`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:511
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: §18 is the naming owner; C036 keeps beside it for position and layout.
- passage: | Primary key | `PK_<TableName>` | `PK_ApiCalls` |

### C153
- key: Name indexes `IX_<TableName>_<ColList>`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:512
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: §18 is the naming owner; the §5 copy (C039) retires in its favor.
- passage: | Index | `IX_<TableName>_<ColList>` | `IX_ApiCalls_RequestUriDate` |

### C154
- key: Name types `<schema>.<PascalCase>`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:513
- provenance: f8c0649 2026-06-10; a8770b3 2026-06-28 replaced the schema name with a placeholder.
- verdict: keep
- reason: No finding.
- passage: | Type | `<schema>.<PascalCase>` | `<schema>.FormFieldType` |

### C155
- key: Name temp tables `#<PascalCase>`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:514
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: §18 is the naming owner; the §16 copy (C131) retires in its favor.
- passage: | Temp table | `#<PascalCase>` | `#Loads`, `#ResendMessages` |

### C156
- key: Name CTEs `cte<PascalCase>`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:515
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: §18 is the naming owner; the §14 copy (C118) retires in its favor.
- passage: | CTE | `cte<PascalCase>` | `cteStopSequences` |

### C157
- key: Use the `_Default` suffix for the default variant of a procedure.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:518
- provenance: f8c0649 2026-06-10 (830ff28 only replaced an em dash).
- verdict: keep
- reason: §18 owns the suffix conventions with their meanings; the §1 list (C007) retires in its favor.
- passage: `_Default` - default variant (e.g. `usp_GetDocumentXML_Default`)

### C158
- key: Use the `_Maintenance` and `_Trailers` suffixes for domain-specific variants.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:519
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: As C157.
- passage: `_Maintenance`, `_Trailers` - domain-specific variants
- flag: environment

### C159
- key: Use the `_TMS` suffix for a TMS-specific entry point and put it in `9-System/`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:520
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: As C157; also the only line carrying the folder for the TMS variant.
- passage: `_TMS` - TMS-specific entry point (lives in `9-System/`)
- flag: environment

### C160
- key: Use the `_Debug` suffix for the debugging counterpart of a procedure.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:521
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: As C157.
- passage: `_Debug` - debugging counterpart of a procedure

### C161
- key: Use the `_Custom_<Vendor>` suffix for client or vendor-specific custom processing.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:522
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: As C157.
- passage: `_Custom_<Vendor>` - client/vendor-specific custom processing

### C162
- key: Build a new procedure in `5-Procedures/` from the full procedure skeleton given here.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:526
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: A new procedure in `5-Procedures/` starts from this skeleton:

### C163
- key: Follow the full procedure skeleton: shell EXEC, ALTER with parameter block, `WITH EXECUTE AS`, `BEGIN -- PROCEDURE`, header banner, SET banner, DECLARE banner, MAIN LOGIC TRY/CATCH, `END`, `GO`.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:528
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The rule's object, and after this pass the owner of the procedure shapes that §2, §7, §8 and §9 point at from section 45's close (C011, C054, C064, C071), §10 having dropped its specimen with no pointer (C086).
- passage: -- CREATE A SHELL PROCEDURE IF NONE EXISTS.
- passage: MAIN LOGIC

### C164
- key: Build a new table in `3-Tables/` from the full table skeleton given here.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:592
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: A new table in `3-Tables/` starts from this skeleton:

### C165
- key: Follow the full table skeleton: TABLE banner, `;IF NOT EXISTS` schema/table check, `CREATE TABLE` with grouped columns, Audit Fields and the PK, `GO`, then an index existence block.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:594
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: The rule's object, and after this pass the owner of the table and index shapes §4 and §5 point at (C024, C038).
- passage: TABLE: <schema>.<TableName>

### C166
- key: Build a new inline table-valued function in `4-Functions/` from the full function skeleton given here.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:642
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: A new inline TVF in `4-Functions/` starts from this skeleton:

### C167
- key: Follow the full function skeleton: drop check and `GO`, `;CREATE FUNCTION` with parameters, `RETURNS TABLE`, `AS RETURN (`, header banner, SELECT body, `)`, `GO`.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:644
- provenance: f8c0649 2026-06-10; ce7b530 2026-06-28 removed the invalid EXECUTE AS line from this template.
- verdict: keep
- reason: The rule's object, and after this pass the owner of the function shape §3 points at (C019). Do not re-add WITH EXECUTE AS here: it does not deploy on an inline TVF.
- passage: EXEC ('DROP FUNCTION <schema>.udf_DoSomething;')

### C168
- key: For a scalar function replace `RETURNS TABLE ... RETURN ( SELECT ... )` with `RETURNS <type>`, `WITH EXECUTE AS`, `AS`, `BEGIN`, a declared result variable, and `RETURN @Result`.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:676
- provenance: f8c0649 2026-06-10.
- verdict: keep
- reason: No finding.
- passage: For a scalar function, replace `RETURNS TABLE
- passage: RETURN ( SELECT
- passage: )` with:

### C169
- key: Write a scalar function body as `RETURNS VARCHAR(MAX)`, `WITH EXECUTE AS '<schema_owner>'`, `AS BEGIN`, `DECLARE @Result VARCHAR(MAX) = ''`, then `RETURN @Result` and `END`.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:678
- provenance: f8c0649 2026-06-10; ce7b530 2026-06-28 deliberately kept the EXECUTE AS clause here (valid on scalar functions).
- verdict: keep
- reason: C168's sentence is "replace X with:" and has no content without this block; the clause is shown unconditionally as on every procedure skeleton, with C013 governing when to drop it.
- passage: DECLARE @Result VARCHAR(MAX) = ''

### C170
- key: When in doubt about a layout decision, find a sibling file in the same folder that solves a similar shape of problem and copy its layout exactly.
- class: rule
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:689
- provenance: f8c0649 2026-06-10; the bound it lacks was installed by 830ff28 2026-06-17 in the SKILL's Precedence section and in line 3.
- verdict: retire
- landed: b17bc06 section 45
- reason: The third statement of the mimic rule and the only one without the foreign-repo bound; SKILL.md:16 with :20 owns it whole and line 3 restates it bounded. Safe because a session reaching this line has already loaded both. Retired at section 45's close: the line and the blank line before it are gone, and the document ends on the scalar-function block's closing fence at landed line 550.
- proposed: (via A169) Drop line 689; line 3 and the SKILL's philosophy point 5 with its Precedence bound carry the rule.
- baseline-test: yes

### C171
- key: Where the project impersonates the schema owner, apply WITH EXECUTE AS to every procedure and to scalar or multi-statement functions, not only procedures.
- class: mechanic
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:78
- provenance: ce7b530 2026-06-28, the same defect fix as C013 and C014.
- verdict: keep
- reason: States which object kinds the clause reaches, which C013 does not; the SKILL checklist carries the same reach as a check. C013's rewrite trims only the dangling parenthetical beside it.
- passage: There it goes on every proc and on scalar or multi-statement functions.

### C172
- key: Order the numbered deployment folders so each runs only after the dependencies it needs already exist.
- class: rationale-example
- source: plugins/grimoire/skills/sql-style/references/sql-style.md:35
- provenance: f8c0649 2026-06-10.
- verdict: retire
- landed: b17bc06 section 45
- reason: The why: deployment runs the folders in numeric order, so tables (3) must exist before functions (4) reference them, functions before procedures (5), and the system entry points (9) last against the full schema, with 0-Client first for environment values. C003's placement is obeyed from the Folder and Contents columns alone. Retired at section 45's close: the table at lines 35 to 42 carries two columns, Folder and Contents, each row's first two cells unchanged.
- proposed: Drop the third column of the folder table at lines 35 to 42; the dependency reasoning lives in this ledger under C172.
- baseline-test: yes
